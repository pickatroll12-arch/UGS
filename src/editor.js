/*
 * UGS — editor  (Stage 1 · Milestone 3)
 * ------------------------------------------------------------------
 * The application: owns all mutable state and the build tools.
 *
 * M2 gave us render + shell (camera, pick, select, Build/Play).
 * M3 adds the actual editing: floor/wall brushes, object placement,
 * erase, entry point, object move/rotate/delete, and undo/redo.
 *
 * Tools operate in ROOM-LOCAL space: pick() returns the room under the
 * cursor plus local (lx,ly), so painting a rotated/offset room Just Works.
 */
(function () {
  'use strict';
  const D = window.UGS.data;
  const R = window.UGS.render;
  const S = window.UGS.save;
  const CORE = window.UGS.core;
  const I = window.UGS.i18n;
  const t = (k, p) => I.t(k, p);
  const engine = window.UGS.engine.create();
  const simClock = new CORE.FixedTimestep(30, 6);   // 30 Hz deterministic sim
  let needsRender = true;                            // render-on-demand (idle editor draws nothing)
  function invalidate() { needsRender = true; }

  // ---- state --------------------------------------------------------------
  const app = {
    save: null,
    activeLevelId: null,
    mode: 'build',
    tool: 'select',                // select | floor | wall | object | entry | erase | fill
    brush: { floor: 'deck', wallShape: 'solid', wallMat: 'hull', object: 'console', objectRotation: 0 },
    camera: { x: 0, y: 0, zoom: 1, minZoom: 0.4, maxZoom: 2.4 },
    hover: null,
    selection: null,               // { roomId, lx, ly, objectId }
    selectFilter: 'all',           // all | floor | object | wall
    hiddenLayers: new Set(),       // layer names toggled off
    clock: { paused: false, speed: 1 },   // Play-mode simulation clock
    pendingLink: null,             // { levelId, roomId, lx, ly } source awaiting a target
    selectedLinkId: null,          // id of the link highlighted in the Links list
    resident: new Set(),           // level ids currently "loaded" (preload/stream model)
  };
  const undoStack = [];
  const redoStack = [];
  const keys = new Set();
  const mouse = { x: 0, y: 0, down: false, lastX: 0, lastY: 0 };
  // interaction sub-states resolved per gesture
  let painting = false, panning = false, dragged = false;
  let movingObj = null;            // { roomId, objectId }
  let dragHandle = null;           // { roomId, eventId, kind, poseIndex }
  let agents = null;               // pawn manager (Play mode)
  let strokeChanged = false;       // did the current gesture actually mutate?
  let lastPaintKey = '';           // dedupe repeated paints on the same tile

  let canvas, ctx, hud, inspector, statusEl, levelSelect;

  function activeLevel() { return app.save.levels.find(l => l.id === app.activeLevelId) || app.save.levels[0]; }
  function roomById(id) { return activeLevel().rooms.find(r => r.id === id) || null; }
  // Select/Erase act on what you SEE (raised walls/objects); the painting/place
  // tools act on the flat ground tile under the cursor.
  function pickHit(px, py) {
    if (app.tool === 'select') return R.pickTopmost(app.camera, activeLevel(), px, py, { hiddenLayers: app.hiddenLayers, filter: app.selectFilter });
    if (app.tool === 'erase') return R.pickTopmost(app.camera, activeLevel(), px, py, { hiddenLayers: app.hiddenLayers });
    return R.pick(app.camera, activeLevel(), px, py);
  }
  function setStatus(m) { if (statusEl) statusEl.textContent = m; }
  function clone(o) { return typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)); }

  // ---- history ------------------------------------------------------------
  function pushHistory() { undoStack.push(clone(app.save)); if (undoStack.length > 80) undoStack.shift(); redoStack.length = 0; }
  function discardHistory() { undoStack.pop(); }        // for gestures that changed nothing
  // guard: editing mutations only apply in Build. Returns false (+ status) in Play.
  function requireBuild() { if (app.mode === 'play') { setStatus(t('status.editInBuild')); return false; } return true; }
  function undo() {
    if (!requireBuild()) return;
    if (!undoStack.length) return setStatus(t('status.nothingUndo'));
    redoStack.push(clone(app.save)); app.save = undoStack.pop(); afterRestore('Undo.');
  }
  function redo() {
    if (!requireBuild()) return;
    if (!redoStack.length) return setStatus(t('status.nothingRedo'));
    undoStack.push(clone(app.save)); app.save = redoStack.pop(); afterRestore('Redo.');
  }
  function afterRestore(msg) {
    if (!activeLevel()) app.activeLevelId = app.save.levels[0].id;
    // keep selection only if it still resolves
    if (app.selection && !roomById(app.selection.roomId)) app.selection = null;
    refreshLevelSelect(); updateInspector(); setStatus(msg);
  }

  // ---- demo seed (same as M2) --------------------------------------------
  // A clean starting station: one deck, one room, floor + ring walls + entry.
  // No objects, no extra decks, no motion, no links — the user builds from here.
  function blankStation() {
    const save = D.createSaveFile('Untitled Station');
    const level = save.levels[0]; level.name = 'Deck 1';
    const a = level.rooms[0];
    a.name = 'Room 1'; a.size = { w: 12, h: 9 };
    a.tiles = grid(12, 9, 'deck'); ringWalls(a);
    level.entry = { roomId: a.id, x: 2, y: 2 };
    return save;
  }
  function grid(w, h, floor) { return Array.from({ length: h }, () => Array.from({ length: w }, () => D.createTile(floor))); }
  function ringWalls(room) {
    const w = room.size.w, h = room.size.h;
    for (let x = 0; x < w; x++) { setWall(room, x, 0); setWall(room, x, h - 1); }
    for (let y = 0; y < h; y++) { setWall(room, 0, y); setWall(room, w - 1, y); }
  }
  function setWall(room, x, y) { room.tiles[y][x] = { floor: 'deck', wall: 'solid', wallMaterial: 'hull' }; }

  // ---- lifecycle ----------------------------------------------------------
  function loadSave(save, msg) {
    app.save = save; app.activeLevelId = save.startLevelId || save.levels[0].id;
    app.selection = null; undoStack.length = 0; redoStack.length = 0;
    R.centerOn(app.camera, activeLevel(), canvas.clientWidth, canvas.clientHeight);
    refreshLevelSelect(); updateInspector(); refreshRoomList(); refreshLinkList(); setStatus(msg || t('status.loaded'));
  }
  function setMode(mode) {
    if (mode === app.mode) return;
    if (mode === 'play') {
      engine.start(activeLevel()); app.clock.paused = false; app.clock.speed = 1; app.selection = null;
      // resident model: the active deck + every preload-linked target is "loaded";
      // stream targets load on first visit (see doTransition).
      app.resident = new Set([app.activeLevelId]);
      for (const k of app.save.links) {
        if (k.mode === 'preload') { app.resident.add(k.from.levelId); app.resident.add(k.to.levelId); }
      }
      spawnPawnAtEntry();
    } else { engine.stop(activeLevel()); app.pendingLink = null; if (agents) agents.clear(); }
    app.mode = mode;
    document.getElementById('buildBtn').classList.toggle('active', mode === 'build');
    document.getElementById('playBtn').classList.toggle('active', mode === 'play');
    document.body.classList.toggle('playing', mode === 'play');
    // BUG-02: the top-bar deck selector is disabled in Play. Changing the active
    // deck manually would leave the pawn stranded on the previous deck; during
    // Play the deck may only change through in-world travel (links / elevators).
    if (levelSelect) levelSelect.disabled = mode === 'play';
    updatePlayBar();
    updateInspector();
    setStatus(t(mode === 'play' ? 'status.playMode' : 'status.buildMode'));
  }

  function updatePlayBar() {
    const bar = document.getElementById('playBar');
    if (!bar) return;
    bar.style.display = app.mode === 'play' ? 'flex' : 'none';
    const pb = document.getElementById('pauseBtn');
    if (pb) pb.textContent = app.clock.paused ? t('play.resume') : t('play.pause');
    [1, 2, 3].forEach(sp => { const el = document.getElementById('speed' + sp); if (el) el.classList.toggle('active', app.clock.speed === sp && !app.clock.paused); });
  }
  // which contextual palette group the bottom bar shows for each tool
  const TOOL_GROUP = { select: 'select', floor: 'floor', fill: 'floor', wall: 'wall', object: 'object' };
  function syncToolContext(tool) {
    document.querySelectorAll('#bb-palettes .bb-grp').forEach(g =>
      g.classList.toggle('on', g.dataset.grp === TOOL_GROUP[tool]));
    const hintEl = document.getElementById('toolHint');
    if (hintEl) hintEl.textContent = t('tool.' + tool + '.hint');
  }
  // hotkeys must not fire while typing in a form field (R2-01)
  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
  }
  // R rotates the selected object; with no object selected it cycles the angle
  // that the Object tool will stamp onto the next piece it places.
  function rotateBrushOrPiece() {
    if (app.mode !== 'build') return;
    if (app.selection && app.selection.objectId) { rotateSelectedObject(); return; }
    app.brush.objectRotation = ((app.brush.objectRotation || 0) + D.ROT_STEP) % 360;
    setTool('object');
    setStatus(t('status.brushRotated', { deg: app.brush.objectRotation }));
  }
  function setTool(tool) {
    if (app.tool === 'link' && tool !== 'link') app.pendingLink = null;
    app.tool = tool;
    document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';
    syncToolContext(tool);
    if (tool === 'link') linkStartTool();
    else setStatus(t('status.tool', { tool: t('tool.' + tool) }));
  }

  // ---- tool mutations (each returns whether it changed anything) ----------
  function tileAt(hit) { const r = roomById(hit.roomId); return r ? r.tiles[hit.ly][hit.lx] : null; }

  function applyPaint(hit) {
    const room = roomById(hit.roomId); if (!room) return false;
    const tile = room.tiles[hit.ly][hit.lx]; if (!tile) return false;
    const kkey = hit.roomId + ':' + hit.lx + ',' + hit.ly + ':' + app.tool;
    if (kkey === lastPaintKey) return false; lastPaintKey = kkey;

    if (app.tool === 'floor') {
      if (tile.floor === app.brush.floor) return false;
      tile.floor = app.brush.floor; return true;
    }
    if (app.tool === 'wall') {
      if (tile.wall === app.brush.wallShape && tile.wallMaterial === app.brush.wallMat) return false;
      if (tile.floor === 'void') tile.floor = 'deck';
      tile.wall = app.brush.wallShape; tile.wallMaterial = app.brush.wallMat; return true;
    }
    if (app.tool === 'erase') {
      const obj = room.objects.find(o => o.x === hit.lx && o.y === hit.ly);
      if (obj) { room.objects = room.objects.filter(o => o !== obj); if (app.selection && app.selection.objectId === obj.id) app.selection = null; return true; }
      if (tile.wall) { tile.wall = null; tile.wallMaterial = null; return true; }
      if (tile.floor !== 'void') { tile.floor = 'void'; return true; }
      return false;
    }
    return false;
  }

  function placeObject(hit) {
    const room = roomById(hit.roomId); if (!room) return setStatus(t('status.placeOnRoom'));
    const tile = room.tiles[hit.ly][hit.lx];
    if (!tile || tile.floor === 'void' || tile.wall) return setStatus(t('status.objectNeedsFloor'));
    if (room.objects.some(o => o.x === hit.lx && o.y === hit.ly)) return setStatus(t('status.tileHasObject'));
    pushHistory();
    const obj = D.createObjectInstance(app.brush.object, hit.lx, hit.ly);
    obj.rotation = D.snapAngle(app.brush.objectRotation || 0);   // R2-01: place at the brush angle
    room.objects.push(obj);
    app.selection = { roomId: room.id, lx: hit.lx, ly: hit.ly, objectId: obj.id };
    updateInspector(); setStatus(t('status.objectPlaced', { name: I.label('obj.' + obj.type, obj.name) }));
  }

  function setEntry(hit) {
    const room = roomById(hit.roomId); if (!room) return;
    const tile = room.tiles[hit.ly][hit.lx];
    if (!tile || tile.floor === 'void' || tile.wall) return setStatus(t('status.entryWalkable'));
    pushHistory();
    activeLevel().entry = { roomId: room.id, x: hit.lx, y: hit.ly };
    setStatus(t('status.entrySet', { x: hit.lx, y: hit.ly }));
  }

  // ---- levels (decks) -----------------------------------------------------
  function levelName(id) { const l = app.save.levels.find(x => x.id === id); return l ? l.name : '?'; }
  function addLevel() {
    if (!requireBuild()) return;
    pushHistory();
    const lvl = D.createLevel('Deck ' + (app.save.levels.length + 1));
    app.save.levels.push(lvl);
    switchLevel(lvl.id); refreshLevelSelect();
    setStatus(t('status.deckAdded', { name: lvl.name }));
  }
  function deleteLevel() {
    if (!requireBuild()) return;
    if (app.save.levels.length <= 1) return setStatus(t('status.cantDeleteLastDeck'));
    pushHistory();
    const id = app.activeLevelId;
    app.save.levels = app.save.levels.filter(l => l.id !== id);
    app.save.links = app.save.links.filter(k => k.from.levelId !== id && k.to.levelId !== id);
    app.selectedLinkId = null;   // BUG-03: a selected link may have just been dropped
    if (app.save.startLevelId === id) app.save.startLevelId = app.save.levels[0].id;
    switchLevel(app.save.levels[0].id); refreshLevelSelect();
    setStatus(t('status.deckDeleted'));
  }
  function renameLevel(name) {
    const lvl = activeLevel(); if (!lvl) return;
    pushHistory(); lvl.name = String(name).trim() || lvl.name; refreshLevelSelect();
  }
  function switchLevel(id) {
    if (app.mode === 'play') engine.stop(activeLevel());
    app.activeLevelId = id; app.selection = null;
    if (app.mode === 'play') engine.start(activeLevel());
    R.centerOn(app.camera, activeLevel(), canvas.clientWidth, canvas.clientHeight);
    updateInspector(); refreshRoomList(); refreshLinkList();
  }

  // ---- links (level graph) ------------------------------------------------
  // A link matches a tile if its `from` endpoint sits there, or (bidirectional)
  // its `to` endpoint does. Returns { link, target, spawn } for a transition.
  function linkAt(levelId, roomId, lx, ly) {
    for (const k of app.save.links) {
      if (k.from.levelId === levelId && (k.from.roomId == null || k.from.roomId === roomId) && k.from.x === lx && k.from.y === ly)
        return { link: k, target: k.to.levelId, spawn: k.to };
      if (k.bidirectional && k.to.levelId === levelId && (k.to.roomId == null || k.to.roomId === roomId) && k.to.x === lx && k.to.y === ly)
        return { link: k, target: k.from.levelId, spawn: k.from };
    }
    return null;
  }
  function linkStartTool() { app.pendingLink = null; setStatus(t('status.linkStart')); }
  function handleLinkClick(hit) {
    if (!app.pendingLink) {
      app.pendingLink = { levelId: app.activeLevelId, roomId: hit.roomId, lx: hit.lx, ly: hit.ly };
      setStatus(t('status.linkSource', { deck: levelName(app.activeLevelId), x: hit.lx, y: hit.ly }));
      return;
    }
    if (app.pendingLink.levelId === app.activeLevelId && app.pendingLink.roomId === hit.roomId && app.pendingLink.lx === hit.lx && app.pendingLink.ly === hit.ly) {
      return setStatus(t('status.linkPickOther'));
    }
    pushHistory();
    const link = D.createLink(app.pendingLink.levelId, app.activeLevelId);
    link.from = { levelId: app.pendingLink.levelId, roomId: app.pendingLink.roomId, x: app.pendingLink.lx, y: app.pendingLink.ly };
    link.to = { levelId: app.activeLevelId, roomId: hit.roomId, x: hit.lx, y: hit.ly };
    app.save.links.push(link);
    app.pendingLink = null;
    refreshLinkList();
    setStatus(t('status.linked', { from: levelName(link.from.levelId), to: levelName(link.to.levelId), mode: t('mode.' + (link.mode === 'preload' ? 'preload' : 'stream')) }));
  }
  // marker list for the active level (both endpoints that live here + pending)
  function linkMarkers() {
    const id = app.activeLevelId, out = [];
    for (const k of app.save.links) {
      const sel = k.id === app.selectedLinkId;
      if (k.from.levelId === id) out.push({ roomId: k.from.roomId, x: k.from.x, y: k.from.y, kind: 'source', sel, label: '↑ ' + levelName(k.to.levelId) });
      if (k.to.levelId === id) out.push({ roomId: k.to.roomId, x: k.to.x, y: k.to.y, kind: 'spawn', sel, label: levelName(k.from.levelId) });
    }
    if (app.pendingLink && app.pendingLink.levelId === id) out.push({ roomId: app.pendingLink.roomId, x: app.pendingLink.lx, y: app.pendingLink.ly, kind: 'pending', label: 'source' });
    return out;
  }

  // ---- pawn / play (Milestone 6) -----------------------------------------
  function spawnPawnAtEntry() {
    if (!agents) return;
    agents.clear();
    const lvl = activeLevel();
    const e = lvl.entry || { roomId: lvl.rooms[0].id, x: 1, y: 1 };
    const room = lvl.rooms.find(r => r.id === e.roomId) || lvl.rooms[0];
    agents.spawn(lvl.id, room.id, e.x, e.y);
  }
  // Fired by the engine bus when a pawn finishes its path. If it landed on a
  // link tile, travel to the target deck (moving the pawn + following the view).
  function onPawnArrived(ev) {
    const pawn = ev.pawn;
    const match = linkAt(pawn.levelId, pawn.roomId, ev.x, ev.y);
    if (!match) return;
    const target = app.save.levels.find(l => l.id === match.target); if (!target) return;
    const spawnRoom = target.rooms.find(r => r.id === match.spawn.roomId) || target.rooms[0];
    if (app.mode === 'play') engine.stop(activeLevel());
    agents.place(pawn, target.id, spawnRoom.id, match.spawn.x, match.spawn.y);
    app.activeLevelId = target.id; app.selection = null; app.resident.add(target.id);
    if (app.mode === 'play') engine.start(activeLevel());
    const c = R.tileCenterWorld(spawnRoom, match.spawn.x, match.spawn.y);
    const s = R.worldToScreen({ x: 0, y: 0, zoom: app.camera.zoom }, c.x, c.y);
    app.camera.x = canvas.clientWidth / 2 - s.x; app.camera.y = canvas.clientHeight / 2 - s.y;
    refreshLevelSelect(); invalidate();
    setStatus(t('status.traveled', { kind: I.label('linkKind.' + (match.link.kind || 'custom'), match.link.kind), deck: levelName(target.id), mode: t('mode.' + (match.link.mode === 'preload' ? 'preload' : 'stream')) }));
  }
  // Play-mode click: toggle a door, else order the pawn to walk there.
  function playClick(hit) {
    if (!hit) return;
    if (hit.object && D.OBJECT_DEFS[hit.object.type].openable) {
      hit.object.open = !hit.object.open;
      setStatus(t(hit.object.open ? 'status.objectOpened' : 'status.objectClosed', { name: I.label('obj.' + hit.object.type, hit.object.name) })); return;
    }
    const pawn = agents && agents.selected; if (!pawn) return;
    if (hit.roomId !== pawn.roomId) { setStatus(t('status.pawnNoCrossRoom')); return; }
    const room = roomById(pawn.roomId);
    if (agents.order(pawn, room, hit.lx, hit.ly)) setStatus(t('status.pawnMoving', { x: hit.lx, y: hit.ly }));
    else setStatus(t('status.noPath'));
  }

  function deleteSelectedObject() {
    if (!app.selection || !app.selection.objectId) return;
    const room = roomById(app.selection.roomId); if (!room) return;
    pushHistory();
    room.objects = room.objects.filter(o => o.id !== app.selection.objectId);
    app.selection.objectId = null; updateInspector(); setStatus(t('status.objectDeleted'));
  }
  function rotateSelectedObject() {
    if (!app.selection || !app.selection.objectId) return;
    const room = roomById(app.selection.roomId); if (!room) return;
    const obj = room.objects.find(o => o.id === app.selection.objectId); if (!obj) return;
    pushHistory(); obj.rotation = ((obj.rotation || 0) + 45) % 360; updateInspector();
  }

  // Flood-fill floor within a room's connected same-floor region. Walls act as
  // barriers, so this fills one enclosed area rather than the whole grid.
  function floodFill(hit) {
    const room = roomById(hit.roomId); if (!room) return;
    const from = room.tiles[hit.ly][hit.lx].floor, to = app.brush.floor;
    if (from === to) return setStatus(t('status.alreadyFloor'));
    pushHistory();
    const stack = [[hit.lx, hit.ly]]; const seen = new Set(); let n = 0;
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= room.size.w || y >= room.size.h) continue;
      const k = x + ',' + y; if (seen.has(k)) continue; seen.add(k);
      const ti = room.tiles[y][x];
      if (ti.wall || ti.floor !== from) continue;   // barrier / different region
      ti.floor = to; n++;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    if (!n) discardHistory(); else setStatus(t('status.filled', { n }));
  }

  function duplicateSelectedObject() {
    if (!app.selection || !app.selection.objectId) return;
    const room = roomById(app.selection.roomId); if (!room) return;
    const src = room.objects.find(o => o.id === app.selection.objectId); if (!src) return;
    // find a free nearby tile
    const spots = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
    let tx = src.x, ty = src.y, found = false;
    for (const [dx, dy] of spots) {
      const nx = src.x + dx, ny = src.y + dy;
      if (nx < 0 || ny < 0 || nx >= room.size.w || ny >= room.size.h) continue;
      const ti = room.tiles[ny][nx];
      if (ti.floor !== 'void' && !ti.wall && !room.objects.some(o => o.x === nx && o.y === ny)) { tx = nx; ty = ny; found = true; break; }
    }
    if (!found) return setStatus(t('status.noFreeTile'));
    pushHistory();
    const copy = clone(src); copy.id = D.uid('obj'); copy.x = tx; copy.y = ty;
    room.objects.push(copy);
    app.selection = { roomId: room.id, lx: tx, ly: ty, objectId: copy.id };
    updateInspector(); setStatus(t('status.objectDuplicated', { name: I.label('obj.' + copy.type, copy.name) }));
  }

  function duplicateActiveRoom() {
    if (!requireBuild()) return;
    const src = app.selection ? roomById(app.selection.roomId) : activeLevel().rooms[0];
    if (!src) return;
    pushHistory();
    const copy = clone(src); copy.id = D.uid('room'); copy.name = src.name + ' copy';
    copy.objects.forEach(o => { o.id = D.uid('obj'); });
    copy.events.forEach(e => { e.id = D.uid('evt'); });
    copy.transform = D.createTransform(src.transform.x + src.size.w + 2, src.transform.y, src.transform.rotation);
    activeLevel().rooms.push(copy);
    selectRoom(copy);
    setStatus(t('status.roomDuplicated', { name: src.name }));
  }

  // ---- room list & room-level actions (S1-R4) -----------------------------
  // free world-x just right of the current rightmost room, so a new/added room
  // does not overlap existing ones.
  function nextRoomX(level) {
    let maxR = 0;
    for (const r of level.rooms) maxR = Math.max(maxR, num(r.transform && r.transform.x) + r.size.w);
    return maxR + 2;
  }
  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

  function selectRoom(room) {
    if (!room) return;
    app.selection = { roomId: room.id, lx: Math.floor(room.size.w / 2), ly: Math.floor(room.size.h / 2), objectId: null };
    updateInspector(); invalidate();   // updateInspector refreshes the room list
  }

  function refreshRoomList() {
    const wrap = document.getElementById('roomList'); if (!wrap) return;
    const lvl = activeLevel(); wrap.innerHTML = '';
    if (!lvl.rooms.length) { wrap.innerHTML = `<span class="muted" style="font-size:11px">${t('rooms.empty')}</span>`; }
    for (const room of lvl.rooms) {
      const b = document.createElement('button');
      const sel = app.selection && app.selection.roomId === room.id;
      b.classList.toggle('active', !!sel);
      b.innerHTML = `<span>${esc(room.name)}</span><span class="rl-meta">${room.size.w}×${room.size.h}${room.objects.length ? ' · ' + room.objects.length : ''}</span>`;
      b.addEventListener('click', () => selectRoom(room));
      wrap.appendChild(b);
    }
    const nameEl = document.getElementById('roomName');
    if (nameEl) { const r = selectedRoom(); nameEl.value = r ? r.name : ''; nameEl.disabled = !r; }
  }

  function addRoom() {
    if (!requireBuild()) return;
    const lvl = activeLevel();
    pushHistory();
    const room = D.createRoom('Room ' + (lvl.rooms.length + 1), 8, 8);
    room.tiles = grid(8, 8, 'deck'); ringWalls(room);
    room.transform = D.createTransform(nextRoomX(lvl), 0, 0);
    room.transform.pivot = { x: 4, y: 4 };
    lvl.rooms.push(room);
    selectRoom(room);
    setStatus(t('status.roomAdded', { name: room.name }));
  }

  function deleteSelectedRoom() {
    if (!requireBuild()) return;
    const lvl = activeLevel();
    const room = selectedRoom(); if (!room) return;
    if (lvl.rooms.length <= 1) { setStatus(t('status.cantDeleteLastRoom')); return; }
    if (!window.confirm(t('confirm.deleteRoom', { name: room.name }))) return;
    pushHistory();
    const name = room.name;
    lvl.rooms = lvl.rooms.filter(r => r !== room);
    // drop links whose endpoints reference this room
    if (app.save.links) app.save.links = app.save.links.filter(k =>
      !(k.from && k.from.roomId === room.id) && !(k.to && k.to.roomId === room.id));
    // repoint the deck entry if it lived in the deleted room
    if (lvl.entry && lvl.entry.roomId === room.id) {
      const first = lvl.rooms[0];
      lvl.entry = { roomId: first.id, x: Math.min(2, first.size.w - 1), y: Math.min(2, first.size.h - 1) };
    }
    // BUG-03: the Links list must reflect the links we just dropped, and any
    // link that was selected may no longer exist.
    app.selectedLinkId = null;
    selectRoom(lvl.rooms[0]);
    refreshLinkList();
    setStatus(t('status.roomDeleted', { name }));
  }

  // ---- link list & link-level actions (S1-R8) -----------------------------
  const LINK_KINDS = ['elevator', 'door', 'hatch', 'custom'];
  // is a link endpoint still valid (its level + room exist)?
  function endpointOk(ep) {
    const lvl = app.save.levels.find(l => l.id === ep.levelId); if (!lvl) return false;
    return ep.roomId == null || lvl.rooms.some(r => r.id === ep.roomId);
  }
  function linkBroken(k) { return !endpointOk(k.from) || !endpointOk(k.to); }

  function refreshLinkList() {
    const wrap = document.getElementById('linkList'); if (!wrap) return;
    wrap.innerHTML = '';
    const links = app.save.links || [];
    if (!links.length) { wrap.innerHTML = `<span class="muted" style="font-size:11px">${t('links.empty')}</span>`; return; }
    for (const k of links) {
      const row = document.createElement('div'); row.className = 'linkrow';
      if (k.id === app.selectedLinkId) row.classList.add('active');
      const broken = linkBroken(k);
      const name = document.createElement('button'); name.className = 'lk-name';
      name.innerHTML = `${broken ? '⚠ ' : ''}${esc(levelName(k.from.levelId))} → ${esc(levelName(k.to.levelId))}`;
      name.title = broken ? t('warn.brokenLink') : '';
      name.addEventListener('click', () => selectLink(k.id));
      const kindSel = document.createElement('select'); kindSel.className = 'lk-kind';
      for (const kk of LINK_KINDS) { const o = document.createElement('option'); o.value = kk; o.textContent = t('linkKind.' + kk); o.selected = k.kind === kk; kindSel.appendChild(o); }
      kindSel.addEventListener('change', e => setLinkKind(k.id, e.target.value));
      const modeBtn = document.createElement('button'); modeBtn.className = 'lk-mode';
      modeBtn.textContent = t('mode.' + (k.mode === 'preload' ? 'preload' : 'stream'));
      modeBtn.title = t('mode.hint'); modeBtn.addEventListener('click', () => toggleLinkMode(k.id));
      const del = document.createElement('button'); del.className = 'danger lk-del'; del.textContent = '✕';
      del.title = t('links.delete'); del.addEventListener('click', () => deleteLink(k.id));
      row.append(name, kindSel, modeBtn, del);
      wrap.appendChild(row);
    }
  }
  function selectLink(id) {
    const k = (app.save.links || []).find(x => x.id === id); if (!k) return;
    app.selectedLinkId = id;
    // jump to the source deck so at least one highlighted endpoint is on screen
    if (k.from.levelId !== app.activeLevelId) switchLevel(k.from.levelId);
    refreshLinkList(); invalidate();
    setStatus(t('status.linkSelected', { kind: I.label('linkKind.' + (k.kind || 'custom'), k.kind), from: levelName(k.from.levelId), to: levelName(k.to.levelId), mode: t('mode.' + (k.mode === 'preload' ? 'preload' : 'stream')) }));
  }
  function deleteLink(id) {
    if (!requireBuild()) return;
    if (!(app.save.links || []).some(k => k.id === id)) return;
    pushHistory();
    app.save.links = app.save.links.filter(k => k.id !== id);
    if (app.selectedLinkId === id) app.selectedLinkId = null;
    refreshLinkList(); invalidate(); setStatus(t('status.linkDeleted'));
  }
  function setLinkKind(id, kind) {
    if (!requireBuild()) return;
    const k = (app.save.links || []).find(x => x.id === id); if (!k) return;
    pushHistory(); k.kind = LINK_KINDS.includes(kind) ? kind : 'custom';
    refreshLinkList();
  }
  function toggleLinkMode(id) {
    if (!requireBuild()) return;
    const k = (app.save.links || []).find(x => x.id === id); if (!k) return;
    pushHistory(); k.mode = k.mode === 'preload' ? 'stream' : 'preload';
    refreshLinkList(); setStatus(t('status.linkModeChanged', { mode: t('mode.' + (k.mode === 'preload' ? 'preload' : 'stream')) }));
  }

  function renameSelectedRoom(name) {
    if (!requireBuild()) return;
    const room = selectedRoom(); if (!room) return;
    const clean = (name || '').trim(); if (!clean || clean === room.name) return;
    pushHistory(); room.name = clean;
    refreshRoomList(); updateInspector();
    setStatus(t('status.roomRenamed', { name: clean }));
  }

  function toggleSelectedDoor() {
    if (!app.selection || !app.selection.objectId) return false;
    const room = roomById(app.selection.roomId); if (!room) return false;
    const obj = room.objects.find(o => o.id === app.selection.objectId); if (!obj) return false;
    if (!D.OBJECT_DEFS[obj.type].openable) return false;
    obj.open = !obj.open; updateInspector(); setStatus(t(obj.open ? 'status.objectOpened' : 'status.objectClosed', { name: I.label('obj.' + obj.type, obj.name) })); return true;
  }

  // ---- input --------------------------------------------------------------
  function updateMouse(e) { const r = canvas.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    updateMouse(e); mouse.down = true; dragged = false;
    mouse.lastX = e.clientX; mouse.lastY = e.clientY;
    lastPaintKey = ''; strokeChanged = false;
    painting = panning = false; movingObj = null; dragHandle = null;

    if (app.mode !== 'build') { panning = true; return; }

    // motion handles take priority when a room is selected with the Select tool
    if (app.tool === 'select' && app.selection) {
      const room = roomById(app.selection.roomId);
      if (room) {
        const hs = R.motionHandles(app.camera, room);
        const h = hs.find(hh => Math.abs(hh.sx - mouse.x) + Math.abs(hh.sy - mouse.y) < 12);
        if (h) { dragHandle = { roomId: room.id, eventId: h.eventId, kind: h.kind, poseIndex: h.poseIndex }; pushHistory(); return; }
      }
    }

    const hit = pickHit(mouse.x, mouse.y);

    if (app.tool === 'floor' || app.tool === 'wall' || app.tool === 'erase') {
      pushHistory(); painting = true;
      if (hit) strokeChanged = applyPaint(hit) || strokeChanged;
    } else if (app.tool === 'select' && hit && hit.object) {
      movingObj = { roomId: hit.roomId, objectId: hit.object.id };
      pushHistory();
    } else {
      panning = true;                 // select-on-empty, object, entry → allow pan
    }
  }

  function onPointerMove(e) {
    updateMouse(e);
    const moved = Math.abs(e.clientX - mouse.lastX) + Math.abs(e.clientY - mouse.lastY);
    if (mouse.down && moved > 2) dragged = true;

    if (dragHandle) {
      const room = roomById(dragHandle.roomId);
      if (room) {
        const P = R.screenToWorld(app.camera, mouse.x, mouse.y);
        const rc = R.roomCenterWorld(room), t = room.transform;
        if (dragHandle.kind === 'room-move') {
          t.x = Math.round(t.x + (P.x - rc.x)); t.y = Math.round(t.y + (P.y - rc.y)); strokeChanged = true;
        } else if (dragHandle.kind === 'room-rotate') {
          const ang = Math.atan2(P.y - rc.y, P.x - rc.x) * 180 / Math.PI;
          const rot = D.snapAngle(ang + 90);   // grip points "up" at rot 0; snaps to the 45° step
          const before = R.roomCenterWorld(room);
          t.rotation = rot;
          const after = R.roomCenterWorld(room);
          t.x += before.x - after.x; t.y += before.y - after.y;                  // pivot around centre
          strokeChanged = true;
        } else {
          const ev = room.events.find(e => e.id === dragHandle.eventId);
          if (ev) {
            if (dragHandle.kind === 'shift-to') ev.action.to = { x: t.x + (P.x - rc.x), y: t.y + (P.y - rc.y) };
            else if (dragHandle.kind === 'orbit-center') ev.action.center = { x: P.x, y: P.y };
            else if (dragHandle.kind === 'orbit-radius') ev.action.radius = Math.max(0.3, Math.hypot(P.x - ev.action.center.x, P.y - ev.action.center.y));
            else if (dragHandle.kind === 'carousel-pose') { const p = ev.action.poses[dragHandle.poseIndex]; if (p) { p.x = t.x + (P.x - rc.x); p.y = t.y + (P.y - rc.y); } }
            strokeChanged = true;
          }
        }
      }
      return;
    }
    if (painting) {
      const hit = pickHit(mouse.x, mouse.y);
      if (hit) strokeChanged = applyPaint(hit) || strokeChanged;
      return;
    }
    if (movingObj) {
      const hit = R.pick(app.camera, activeLevel(), mouse.x, mouse.y);
      if (hit && hit.roomId === movingObj.roomId) {
        const room = roomById(movingObj.roomId);
        const tile = room.tiles[hit.ly][hit.lx];
        const occupied = room.objects.some(o => o.id !== movingObj.objectId && o.x === hit.lx && o.y === hit.ly);
        if (tile && tile.floor !== 'void' && !tile.wall && !occupied) {
          const obj = room.objects.find(o => o.id === movingObj.objectId);
          if (obj && (obj.x !== hit.lx || obj.y !== hit.ly)) { obj.x = hit.lx; obj.y = hit.ly; strokeChanged = true; app.selection = { roomId: room.id, lx: hit.lx, ly: hit.ly, objectId: obj.id }; }
        }
      }
      return;
    }
    if (panning && mouse.down && dragged) {
      app.camera.x += e.clientX - mouse.lastX; app.camera.y += e.clientY - mouse.lastY;
      mouse.lastX = e.clientX; mouse.lastY = e.clientY; app.hover = null; return;
    }
    app.hover = pickHit(mouse.x, mouse.y);
  }

  function onPointerUp() {
    if (mouse.down && app.mode === 'play' && !dragged) {
      // Play mode: click an openable door/airlock to toggle it; otherwise click
      // a movable room to fire its manual events.
      const hit = R.pickTopmost(app.camera, activeLevel(), mouse.x, mouse.y, { hiddenLayers: app.hiddenLayers });
      playClick(hit);
    } else if (mouse.down && app.mode === 'build') {
      if (dragHandle) {
        if (!strokeChanged) discardHistory();
      } else if (movingObj) {
        // grabbed an object: a drag moved it; a plain click just selects it
        if (!strokeChanged) {
          discardHistory();
          const room = roomById(movingObj.roomId);
          const obj = room && room.objects.find(o => o.id === movingObj.objectId);
          if (obj) app.selection = { roomId: room.id, lx: obj.x, ly: obj.y, objectId: obj.id };
        }
        updateInspector();
      } else if (painting) {
        if (!strokeChanged) discardHistory();   // no-op gesture: drop the snapshot
        else updateInspector();
      } else if (!dragged) {
        // a click
        const hit = pickHit(mouse.x, mouse.y);
        if (app.tool === 'object') { if (hit) placeObject(hit); }
        else if (app.tool === 'entry') { if (hit) setEntry(hit); }
        else if (app.tool === 'fill') { if (hit) floodFill(hit); }
        else if (app.tool === 'link') { if (hit) handleLinkClick(hit); }
        else { // select (default)
          app.selection = hit ? { roomId: hit.roomId, lx: hit.lx, ly: hit.ly, objectId: hit.object ? hit.object.id : null } : null;
          updateInspector();
        }
      }
    }
    mouse.down = false; painting = panning = false; movingObj = null; dragHandle = null; dragged = false;
  }

  function onWheel(e) {
    e.preventDefault();
    const before = R.screenToWorld(app.camera, mouse.x, mouse.y);
    const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    app.camera.zoom = Math.max(app.camera.minZoom, Math.min(app.camera.maxZoom, app.camera.zoom * f));
    const after = R.screenToWorld(app.camera, mouse.x, mouse.y);
    const s1 = R.worldToScreen(Object.assign({}, app.camera, { x: 0, y: 0 }), before.x, before.y);
    const s2 = R.worldToScreen(Object.assign({}, app.camera, { x: 0, y: 0 }), after.x, after.y);
    app.camera.x += s1.x - s2.x; app.camera.y += s1.y - s2.y;
  }

  function updateCamera(dt) {
    const pan = 520 * dt; let moved = false;
    if (keys.has('w') || keys.has('arrowup')) { app.camera.y += pan; moved = true; }
    if (keys.has('s') || keys.has('arrowdown')) { app.camera.y -= pan; moved = true; }
    if (keys.has('a') || keys.has('arrowleft')) { app.camera.x += pan; moved = true; }
    if (keys.has('d') || keys.has('arrowright')) { app.camera.x -= pan; moved = true; }
    return moved;
  }

  // ---- inspector ----------------------------------------------------------
  function updateInspector() {
    const lvl = activeLevel();
    refreshRoomList();
    if (!app.selection) { inspector.innerHTML = `<span class="muted">${esc(t('insp.empty'))}</span>`; return; }
    const room = roomById(app.selection.roomId);
    if (!room) { inspector.innerHTML = '<span class="muted">—</span>'; return; }
    const obj = app.selection.objectId ? room.objects.find(o => o.id === app.selection.objectId) : null;
    const tile = room.tiles[app.selection.ly] && room.tiles[app.selection.ly][app.selection.lx];

    let h = `<div class="row"><b>${esc(t('insp.room'))}</b><span>${esc(room.name)}</span></div>`;
    h += `<div class="row"><b>${esc(t('insp.transform'))}</b><span>@${fmt(room.transform.x)},${fmt(room.transform.y)} · ${fmt(room.transform.rotation)}°</span></div>`;
    h += `<div class="row"><b>${esc(t('insp.size'))}</b><span>${room.size.w} × ${room.size.h}</span></div>`;
    h += `<div class="resize">`
      + `<input type="number" data-rz="w" min="1" max="64" value="${room.size.w}" title="W">`
      + `<span class="rz-x">×</span>`
      + `<input type="number" data-rz="h" min="1" max="64" value="${room.size.h}" title="H">`
      + `<select data-rz="anchor" title="${esc(t('insp.anchor'))}">`
      + `<option value="nw">${esc(t('anchor.nw'))}</option>`
      + `<option value="center">${esc(t('anchor.center'))}</option>`
      + `<option value="se">${esc(t('anchor.se'))}</option>`
      + `</select>`
      + `<button data-act="resize">${esc(t('insp.applySize'))}</button>`
      + `</div>`;
    h += `<div class="row"><b>${esc(t('insp.localTile'))}</b><span>${app.selection.lx}, ${app.selection.ly}</span></div>`;
    if (tile) {
      h += `<div class="row"><b>${esc(t('insp.floor'))}</b><span>${esc(floorLabel(tile.floor))}</span></div>`;
      h += `<div class="row"><b>${esc(t('insp.wall'))}</b><span>${tile.wall ? esc(I.label('wall.' + tile.wall, tile.wall)) : esc(t('val.none'))}</span></div>`;
    }
    if (obj) {
      const def = D.OBJECT_DEFS[obj.type];
      h += `<hr><div class="row"><b>${esc(t('insp.object'))}</b><span>${esc(I.label('obj.' + obj.type, obj.name))}</span></div>`;
      h += `<div class="row"><b>${esc(t('insp.type'))}</b><span>${obj.type} · ${obj.rotation || 0}°</span></div>`;
      h += `<div class="row"><b>${esc(t('insp.layer'))}</b><span>${esc(I.label('layer.' + obj.layer, obj.layer))}</span></div>`;
      h += `<div class="row"><b>${esc(t('insp.flags'))}</b><span>${obj.interactive ? esc(t('val.interactive')) + ' ' : ''}${obj.collision ? esc(t('val.solid')) : ''}</span></div>`;
      if (def.openable) h += `<div class="row"><b>${esc(t('insp.state'))}</b><span>${esc(t(obj.open ? 'val.open' : 'val.closed'))}</span></div>`;
      h += `<div class="row"><b>${esc(t('insp.powerHeat'))}</b><span>${obj.power} / ${obj.heat}</span></div>`;
      h += `<div class="mini"><button data-act="rotate">${esc(t('insp.rotate45'))}</button><button data-act="dup">${esc(t('insp.duplicate'))}</button>`;
      if (def.openable) h += `<button data-act="toggle">${esc(t(obj.open ? 'insp.close' : 'insp.open'))}</button>`;
      h += `<button class="danger" data-act="delete">${esc(t('insp.delete'))}</button></div>`;
    }

    // --- Room motion (Milestone 4) ---
    h += `<hr><div class="row"><b>${esc(t('insp.movable'))}</b><span><input type="checkbox" data-act="movable" ${room.movable ? 'checked' : ''}></span></div>`;
    if (room.events && room.events.length) {
      for (const ev of room.events) {
        const kind = ev.action ? ev.action.kind : '?';
        const extra = kind === 'orbit' ? ` ${ev.action.direction === 'ccw' ? '⟲' : '⟳'}` : (ev.loop ? ' ⟳' : '');
        const trig = ev.trigger ? ev.trigger.type : 'manual';
        const issue = eventIssue(ev);
        const off = ev.enabled === false;
        h += `<div class="row" style="margin-top:6px${off ? ';opacity:.5' : ''}">`
          + `<b><label style="cursor:pointer"><input type="checkbox" data-act="evt-toggle" data-id="${ev.id}" ${off ? '' : 'checked'}> ${issue ? '<span title="' + esc(issue) + '">⚠</span> ' : ''}${esc(ev.name)}</label></b>`
          + `<span>${esc(I.label('motionKind.' + kind, kind))}${extra} · ${esc(I.label('trigger.' + trig, trig))}</span></div>`;
        if (issue) h += `<div class="hint" style="margin:2px 0 0;color:#e0a24a">${esc(issue)}</div>`;
        h += `<div class="mini"><button data-act="evt-fire" data-id="${ev.id}">${esc(t('insp.test'))}</button>`;
        if (kind === 'orbit') h += `<button data-act="evt-orbitdir" data-id="${ev.id}">${esc(t('insp.flip'))}</button>`;
        h += `<button class="danger" data-act="evt-del" data-id="${ev.id}">✕</button></div>`;
      }
    } else {
      h += `<div class="row"><span class="muted">${esc(t('insp.noMotion'))}</span></div>`;
    }
    h += `<div class="mini"><button data-act="evt-shift">${esc(t('insp.addShift'))}</button><button data-act="evt-rotate">${esc(t('insp.addRotate'))}</button></div>`;
    h += `<div class="mini"><button data-act="evt-orbit">${esc(t('insp.addOrbit'))}</button><button data-act="evt-carousel">${esc(t('insp.addCarousel'))}</button></div>`;
    h += `<div class="hint" style="margin-top:6px">${esc(t('insp.mapHint'))}</div>`;
    inspector.innerHTML = h;
  }
  function floorLabel(id) { return id === 'void' ? I.label('mat.void', 'void (empty)') : I.label('mat.' + id, (D.MATERIALS[id] || {}).label || id); }
  function fmt(n) { return Math.abs(n - Math.round(n)) < 0.01 ? String(Math.round(n)) : n.toFixed(1); }
  function esc(v) { return String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ---- room motion authoring ---------------------------------------------
  function selectedRoom() { return app.selection ? roomById(app.selection.roomId) : null; }

  // Resize the selected room from the inspector inputs. Non-destructive: it
  // assesses the change first (dryRun, no undo entry). A destructive resize —
  // dropping objects OR trimming floor/wall tiles — is confirmed before any
  // mutation, so a cancelled resize leaves NO trace in the undo history
  // (BUG-04). On commit it repairs the level entry, links, and selection by the
  // applied offset, and reports the trimmed tiles/walls (localized).
  function resizeSelectedRoom() {
    if (!requireBuild()) return;
    const room = selectedRoom(); if (!room) return;
    const wEl = inspector.querySelector('[data-rz="w"]');
    const hEl = inspector.querySelector('[data-rz="h"]');
    const aEl = inspector.querySelector('[data-rz="anchor"]');
    if (!wEl || !hEl) return;
    const nw = Math.round(+wEl.value), nh = Math.round(+hEl.value);
    const anchor = aEl ? aEl.value : 'nw';
    if (!(nw >= 1) || !(nh >= 1)) return;
    if (nw === room.size.w && nh === room.size.h) { setStatus(t('status.sizeUnchanged')); return; }

    // assess without mutating and without touching the undo stack
    const dry = D.resizeRoom(room, nw, nh, { anchor, dryRun: true });
    const lostObjects = dry.wouldDrop.length, lostTiles = dry.trimmedTiles, lostWalls = dry.trimmedWalls;
    if (lostObjects || lostTiles || lostWalls) {
      const msg = t('confirm.resizeLoss', { objects: lostObjects, tiles: lostTiles, walls: lostWalls });
      if (!window.confirm(msg)) { setStatus(t('status.resizeCancelled')); return; }   // no history touched
    }

    pushHistory();
    const res = D.resizeRoom(room, nw, nh, { anchor, force: true });
    const { dx, dy } = res.offset;
    repairAfterResize(room, dx, dy, res.newW, res.newH);
    if (app.selection && app.selection.roomId === room.id) {
      app.selection.lx = CORE.clamp(app.selection.lx + dx, 0, res.newW - 1);
      app.selection.ly = CORE.clamp(app.selection.ly + dy, 0, res.newH - 1);
    }
    updateInspector(); refreshLevelSelect(); refreshLinkList(); invalidate();
    let msg = t('status.resized', { w: res.newW, h: res.newH });
    if (res.trimmedTiles || res.trimmedWalls) msg += ' ' + t('status.resizeTrimmed', { tiles: res.trimmedTiles, walls: res.trimmedWalls });
    if (res.dropped.length) msg += ' ' + t('status.droppedN', { n: res.dropped.length });
    setStatus(msg);
  }

  // After a room resize, shift/clamp everything that references its tiles.
  function repairAfterResize(room, dx, dy, w, h) {
    const clampX = (x) => CORE.clamp(Math.round(x), 0, w - 1);
    const clampY = (y) => CORE.clamp(Math.round(y), 0, h - 1);
    // level entry (entry lives on the level, not the room)
    for (const lvl of app.save.levels) {
      if (lvl.entry && lvl.entry.roomId === room.id) {
        lvl.entry.x = clampX(lvl.entry.x + dx);
        lvl.entry.y = clampY(lvl.entry.y + dy);
      }
    }
    // link endpoints that land in this room
    for (const k of (app.save.links || [])) {
      if (k.from && k.from.roomId === room.id) { k.from.x = clampX(k.from.x + dx); k.from.y = clampY(k.from.y + dy); }
      if (k.to && k.to.roomId === room.id) { k.to.x = clampX(k.to.x + dx); k.to.y = clampY(k.to.y + dy); }
    }
  }
  function addRoomEvent(room, kind) {
    pushHistory();
    room.movable = true;
    const tr = room.transform, ev = D.createRoomEvent(kind[0].toUpperCase() + kind.slice(1));
    ev.trigger = { type: 'time' }; ev.loop = true;
    if (kind === 'shift') ev.action = { kind: 'shift', to: { x: tr.x + 4, y: tr.y }, duration: 2 };
    else if (kind === 'rotate') ev.action = { kind: 'rotate', by: 90, duration: 2 };
    else if (kind === 'orbit') { const rc = R.roomCenterWorld(room); ev.action = { kind: 'orbit', center: { x: rc.x, y: rc.y - 5 }, radius: 5, period: 4, direction: 'cw', selfRotate: false }; }
    else if (kind === 'carousel') ev.action = { kind: 'carousel', interval: 1.8, loop: true, poses: [
      { x: tr.x + 4, y: tr.y, rotation: tr.rotation }, { x: tr.x + 4, y: tr.y + 4, rotation: tr.rotation + 90 }, { x: tr.x, y: tr.y + 4, rotation: tr.rotation + 180 }
    ] };
    room.events.push(ev);
    updateInspector(); setStatus(t('status.eventAdded', { kind: I.label('motionKind.' + kind, kind) }));
  }
  // Validate a motion event; returns a human warning string, or '' if fine.
  function eventIssue(ev) {
    const a = ev.action || {};
    if (a.kind === 'orbit') {
      if (!a.center || !Number.isFinite(+a.center.x) || !Number.isFinite(+a.center.y)) return t('warn.orbitCenter');
      if (!(+a.radius > 0)) return t('warn.orbitRadius');
    }
    if (a.kind === 'carousel') {
      if (!Array.isArray(a.poses) || a.poses.length < 2) return t('warn.carouselPoses');
    }
    if (a.kind === 'shift' && !a.to) return t('warn.shiftTarget');
    return '';
  }
  function toggleRoomEvent(room, id) {
    if (!requireBuild()) return;
    const ev = room.events.find(e => e.id === id); if (!ev) return;
    pushHistory(); ev.enabled = ev.enabled === false ? true : false;
    updateInspector();
    setStatus(t(ev.enabled === false ? 'status.eventDisabled' : 'status.eventEnabled', { name: ev.name }));
  }
  function deleteRoomEvent(room, id) { pushHistory(); room.events = room.events.filter(e => e.id !== id); updateInspector(); }
  function testRoomEvent(room, id) {
    const ev = room.events.find(e => e.id === id); if (!ev) return;
    if (app.mode !== 'play') { setMode('play'); }
    engine.fire(room, ev); setStatus(t('status.eventTesting', { name: ev.name }));
  }

  function refreshLevelSelect() {
    levelSelect.innerHTML = '';
    for (const lvl of app.save.levels) {
      const o = document.createElement('option'); o.value = lvl.id; o.textContent = lvl.name;
      if (lvl.id === app.activeLevelId) o.selected = true; levelSelect.appendChild(o);
    }
    const nameInput = document.getElementById('levelName');
    if (nameInput) nameInput.value = (activeLevel() || {}).name || '';
  }

  // ---- render loop --------------------------------------------------------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const camMoved = updateCamera(dt);
    if (camMoved) invalidate();

    // deterministic fixed-timestep simulation (Play only). Speed multiplies the
    // number of fixed slices, so each slice stays a constant dt (reproducible).
    if (app.mode === 'play' && !app.clock.paused) {
      const lvl0 = activeLevel();
      simClock.advance(dt, (fdt) => { for (let i = 0; i < app.clock.speed; i++) engine.update(lvl0, fdt); });
      if (engine.activeCount() > 0 || (agents && agents.pawns.some(p => p.moving))) invalidate();
    }

    // render on demand: an idle editor (no input, nothing animating) skips the
    // whole draw — keeps a laptop/handheld cool instead of pegging a core.
    if (!needsRender) { requestAnimationFrame(frame); return; }
    needsRender = false;

    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    const lvl = activeLevel();
    R.drawLevel(ctx, app.camera, lvl, {
      view: { w: canvas.clientWidth, h: canvas.clientHeight },
      animating: app.mode === 'play' || !!dragHandle || !!movingObj || painting,
      hover: app.mode === 'build' && !panning ? app.hover : null,
      hoverFill: app.tool === 'erase' ? 'rgba(220,90,90,0.22)' : undefined,
      hoverStroke: app.tool === 'erase' ? '#e06a6a' : undefined,
      selection: app.selection,
      entry: lvl.entry,
      linkMarkers: linkMarkers(),
      hiddenLayers: app.hiddenLayers,
      activeRoomId: app.selection ? app.selection.roomId : null,
      previewRoom: (app.mode === 'build' && app.selection) ? roomById(app.selection.roomId) : null,
      showRoomOutlines: app.mode === 'build'
    });
    if (agents && agents.pawns.length) R.drawAgents(ctx, app.camera, lvl, agents.pawns, { selectedId: agents.selected && agents.selected.id, time: engine.time });
    hud.textContent = `${app.save.name} · ${lvl.name}  [${app.mode}·${app.tool}]\n` +
      `rooms:${lvl.rooms.length}  zoom:${app.camera.zoom.toFixed(2)}` +
      (app.hover ? `  tile:${app.hover.lx},${app.hover.ly}` : '');
    requestAnimationFrame(frame);
  }

  function resize() {
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(canvas.clientWidth * scale);
    canvas.height = Math.floor(canvas.clientHeight * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  // ---- palette wiring ------------------------------------------------------
  // Chip labels come from i18n (translated by id) so they follow the active
  // language. Rebuilt on language change; wraps are cleared first (idempotent).
  function matLabel(m) { return I.label('mat.' + m.id, m.label); }
  function objLabel(def) { return I.label('obj.' + def.type, def.label); }
  function wallShapeLabel(id, fallback) { return I.label('wall.' + id, fallback); }
  function layerLabel(id) { return I.label('layer.' + id, id); }

  function buildPalettes() {
    // floor materials
    const floors = Object.values(D.MATERIALS).filter(m => m.kind === 'floor');
    const fWrap = document.getElementById('floorPalette'); fWrap.innerHTML = '';
    for (const m of floors) fWrap.appendChild(chip(matLabel(m), () => { app.brush.floor = m.id; markActive(fWrap, m.id); setTool('floor'); }, m.id, app.brush.floor === m.id));
    fWrap.appendChild(chip(I.label('mat.void', 'Void'), () => { app.brush.floor = 'void'; markActive(fWrap, 'void'); setTool('floor'); }, 'void', app.brush.floor === 'void'));
    // objects
    const oWrap = document.getElementById('objectPalette'); oWrap.innerHTML = '';
    for (const def of Object.values(D.OBJECT_DEFS)) oWrap.appendChild(chip(objLabel(def), () => { app.brush.object = def.type; markActive(oWrap, def.type); setTool('object'); }, def.type, app.brush.object === def.type));
    // wall shapes
    const wWrap = document.getElementById('wallPalette'); wWrap.innerHTML = '';
    [['solid', 'Solid'], ['diagA', 'Diag /'], ['diagB', 'Diag \\']].forEach(([id, label]) =>
      wWrap.appendChild(chip(wallShapeLabel(id, label), () => { app.brush.wallShape = id; markActive(wWrap, id); setTool('wall'); }, id, app.brush.wallShape === id)));
    // wall materials (hull vs glass/windows)
    const wmWrap = document.getElementById('wallMatPalette'); wmWrap.innerHTML = '';
    Object.values(D.MATERIALS).filter(m => m.kind === 'wall').forEach(m =>
      wmWrap.appendChild(chip(matLabel(m), () => { app.brush.wallMat = m.id; markActive(wmWrap, m.id); setTool('wall'); }, m.id, app.brush.wallMat === m.id)));
    // layer visibility toggles
    const lWrap = document.getElementById('layerToggles'); lWrap.innerHTML = '';
    D.LAYERS.forEach(name => {
      const b = document.createElement('button'); b.textContent = layerLabel(name); b.dataset.key = name;
      b.classList.toggle('active', !app.hiddenLayers.has(name));
      b.addEventListener('click', () => {
        if (app.hiddenLayers.has(name)) app.hiddenLayers.delete(name); else app.hiddenLayers.add(name);
        b.classList.toggle('active', !app.hiddenLayers.has(name));
        setStatus(t(app.hiddenLayers.has(name) ? 'status.layerHidden' : 'status.layerShown', { layer: layerLabel(name) }));
      });
      lWrap.appendChild(b);
    });
  }
  function chip(label, onClick, key, active) {
    const b = document.createElement('button'); b.textContent = label; b.dataset.key = key;
    if (active) b.classList.add('active'); b.addEventListener('click', onClick); return b;
  }

  // ---- help overlay (first-run onboarding) --------------------------------
  const HELP_SEEN_KEY = 'ugs.helpSeen';
  function showHelp(on) {
    const ov = document.getElementById('helpOverlay'); if (!ov) return;
    ov.classList.toggle('on', on !== false);
  }
  function setupHelp() {
    const ov = document.getElementById('helpOverlay');
    const btn = document.getElementById('helpBtn');
    const close = document.getElementById('helpClose');
    if (btn) btn.addEventListener('click', () => showHelp(true));
    if (close) close.addEventListener('click', () => { showHelp(false); try { localStorage.setItem(HELP_SEEN_KEY, '1'); } catch (e) {} });
    if (ov) ov.addEventListener('click', e => { if (e.target === ov) { showHelp(false); try { localStorage.setItem(HELP_SEEN_KEY, '1'); } catch (e2) {} } });
    let seen = false; try { seen = localStorage.getItem(HELP_SEEN_KEY) === '1'; } catch (e) {}
    if (!seen) showHelp(true);
  }

  // ---- language wiring -----------------------------------------------------
  function setupLanguage() {
    const sel = document.getElementById('langSelect');
    if (sel) {
      sel.innerHTML = '';
      I.languages().forEach(code => {
        const o = document.createElement('option');
        o.value = code; o.textContent = t('lang.' + code); o.selected = code === I.getLang();
        sel.appendChild(o);
      });
      sel.value = I.getLang();
      sel.addEventListener('change', e => I.setLang(e.target.value));
    }
    // Anything generated in JS (palettes, inspector, status, play bar) must be
    // re-rendered when the language flips; static [data-i18n] nodes are handled
    // by I.apply() inside setLang.
    I.subscribe((lang) => {
      buildPalettes();
      updateInspector();
      refreshRoomList();
      refreshLinkList();
      updatePlayBar();
      syncToolContext(app.tool);
      if (sel) sel.value = lang;
      setStatus(t('status.langChanged', { lang: t('lang.' + lang) }));
    });
    I.apply(document);   // paint the initial language onto the static markup
  }
  function markActive(wrap, key) { wrap.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.key === key)); }

  // ---- boot ---------------------------------------------------------------
  function boot() {
    canvas = document.getElementById('game'); ctx = canvas.getContext('2d');
    hud = document.getElementById('hud'); inspector = document.getElementById('inspector');
    statusEl = document.getElementById('status'); levelSelect = document.getElementById('levelSelect');

    resize(); window.addEventListener('resize', () => { resize(); invalidate(); });
    canvas.addEventListener('pointermove', e => { onPointerMove(e); invalidate(); });
    canvas.addEventListener('pointerdown', e => { onPointerDown(e); invalidate(); });
    window.addEventListener('pointerup', () => { onPointerUp(); invalidate(); });
    canvas.addEventListener('pointerleave', () => { app.hover = null; invalidate(); });
    canvas.addEventListener('wheel', e => { onWheel(e); invalidate(); }, { passive: false });
    // catch-all: any UI click/change/key repaints once (render-on-demand net)
    document.addEventListener('click', invalidate, true);
    document.addEventListener('change', invalidate, true);
    window.addEventListener('keydown', invalidate);
    window.addEventListener('keyup', invalidate);
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      // R2-01: hotkeys are ignored while the user is typing in a field, so
      // e.g. renaming a room or editing a resize value never fires a tool.
      if (isTypingTarget(e.target)) return;
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(); return; }
      if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); duplicateSelectedObject(); return; }
      if (k === 'delete' || k === 'backspace') { if (app.mode === 'build') deleteSelectedObject(); return; }
      if (k === 'escape') {
        const ov = document.getElementById('helpOverlay');
        if (ov && ov.classList.contains('on')) { showHelp(false); return; }
        app.selection = null; updateInspector(); return;
      }
      if (app.mode === 'play') {
        if (k === ' ') { e.preventDefault(); app.clock.paused = !app.clock.paused; updatePlayBar(); return; }
        if (k === '1' || k === '2' || k === '3') { app.clock.speed = +k; app.clock.paused = false; updatePlayBar(); return; }
        return;   // no build hotkeys while simulating
      }
      if (e.ctrlKey || e.metaKey) return;
      // R rotates the selected object, or the object brush's placement angle.
      if (k === 'r') { rotateBrushOrPiece(); return; }
      // R2-01 tool hotkeys: numbers 1–8 (doc map) + the original letters as aliases.
      const NUM_TOOLS = { '1': 'select', '2': 'erase', '3': 'floor', '4': 'wall', '5': 'object', '6': 'entry', '7': 'fill', '8': 'link' };
      const LETTER_TOOLS = { v: 'select', f: 'floor', g: 'wall', b: 'object', n: 'entry', x: 'erase', k: 'fill', l: 'link' };
      const tool = NUM_TOOLS[e.key] || LETTER_TOOLS[k];
      if (tool) { setTool(tool); return; }
      keys.add(k);
    });
    window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

    document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

    document.getElementById('buildBtn').addEventListener('click', () => setMode('build'));
    document.getElementById('playBtn').addEventListener('click', () => setMode('play'));
    document.getElementById('undoBtn').addEventListener('click', undo);
    document.getElementById('redoBtn').addEventListener('click', redo);
    document.getElementById('newBtn').addEventListener('click', () => loadSave(blankStation(), t('status.newStation')));
    document.getElementById('exportBtn').addEventListener('click', () => {
      try { setStatus(t('status.exported', { file: S.exportToFile(app.save) })); } catch (err) { setStatus(t('status.exportFailed', { err: err.message })); }
    });
    const fileInput = document.getElementById('fileInput');
    document.getElementById('importBtn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const { save, warnings } = await S.importFromFile(file);
        loadSave(save, warnings.length ? t('status.importedWarnings', { name: save.name, n: warnings.length }) : t('status.imported', { name: save.name }));
        if (warnings.length) console.warn(warnings);
      }
      catch (err) { setStatus(t('status.importFailed', { err: err.message })); } finally { fileInput.value = ''; }
    });
    levelSelect.addEventListener('change', e => { switchLevel(e.target.value); refreshLevelSelect(); });

    // Play-bar controls
    document.getElementById('pauseBtn').addEventListener('click', () => { app.clock.paused = !app.clock.paused; updatePlayBar(); });
    [1, 2, 3].forEach(sp => document.getElementById('speed' + sp).addEventListener('click', () => { app.clock.speed = sp; app.clock.paused = false; updatePlayBar(); }));
    inspector.addEventListener('click', e => {
      const act = e.target.dataset.act; if (!act) return;
      const room = selectedRoom();
      if (act === 'rotate') rotateSelectedObject();
      else if (act === 'resize') resizeSelectedRoom();
      else if (act === 'dup') duplicateSelectedObject();
      else if (act === 'toggle') { pushHistory(); if (!toggleSelectedDoor()) discardHistory(); }
      else if (act === 'delete') deleteSelectedObject();
      else if (act === 'evt-shift' && room) addRoomEvent(room, 'shift');
      else if (act === 'evt-rotate' && room) addRoomEvent(room, 'rotate');
      else if (act === 'evt-orbit' && room) addRoomEvent(room, 'orbit');
      else if (act === 'evt-carousel' && room) addRoomEvent(room, 'carousel');
      else if (act === 'evt-del' && room) deleteRoomEvent(room, e.target.dataset.id);
      else if (act === 'evt-fire' && room) testRoomEvent(room, e.target.dataset.id);
      else if (act === 'evt-orbitdir' && room) { const ev = room.events.find(x => x.id === e.target.dataset.id); if (ev) { pushHistory(); ev.action.direction = ev.action.direction === 'ccw' ? 'cw' : 'ccw'; updateInspector(); } }
    });
    inspector.addEventListener('change', e => {
      const act = e.target.dataset.act;
      if (act === 'movable') { const room = selectedRoom(); if (room) { pushHistory(); room.movable = e.target.checked; } }
      else if (act === 'evt-toggle') { const room = selectedRoom(); if (room) toggleRoomEvent(room, e.target.dataset.id); }
    });

    document.getElementById('dupRoomBtn').addEventListener('click', duplicateActiveRoom);
    document.getElementById('addRoomBtn').addEventListener('click', addRoom);
    document.getElementById('delRoomBtn').addEventListener('click', deleteSelectedRoom);
    document.getElementById('roomName').addEventListener('change', e => renameSelectedRoom(e.target.value));
    document.getElementById('addLevelBtn').addEventListener('click', addLevel);
    document.getElementById('delLevelBtn').addEventListener('click', deleteLevel);
    document.getElementById('levelName').addEventListener('change', e => renameLevel(e.target.value));
    const filterSel = document.getElementById('selectFilter');
    filterSel.addEventListener('change', e => { app.selectFilter = e.target.value; setStatus(t('status.filter', { filter: t('filter.' + e.target.value) })); });

    // agent manager + deterministic movement system (Play mode)
    agents = window.UGS.agents.create(engine);
    agents.install();
    if (engine.bus) engine.bus.on('pawn:arrived', onPawnArrived);

    setupLanguage();
    setupHelp();
    buildPalettes();
    loadSave(blankStation(), t('status.emptyReady'));
    setMode('build'); setTool('select');
    requestAnimationFrame(frame);

    // debug/test hook (harmless): lets headless tests inspect live state
    window.UGS.editorApp = app;
    window.UGS._agents = agents;
    window.UGS._engine = engine;   // debug/test hook: lets smoke tests read activeCount()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
