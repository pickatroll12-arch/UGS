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
    brush: { floor: 'deck', wallShape: 'solid', wallMat: 'hull', object: 'console' },
    camera: { x: 0, y: 0, zoom: 1, minZoom: 0.4, maxZoom: 2.4 },
    hover: null,
    selection: null,               // { roomId, lx, ly, objectId }
    selectFilter: 'all',           // all | floor | object | wall
    hiddenLayers: new Set(),       // layer names toggled off
    clock: { paused: false, speed: 1 },   // Play-mode simulation clock
    pendingLink: null,             // { levelId, roomId, lx, ly } source awaiting a target
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
  function undo() {
    if (app.mode === 'play') return setStatus('Stop Play to undo.');
    if (!undoStack.length) return setStatus('Nothing to undo.');
    redoStack.push(clone(app.save)); app.save = undoStack.pop(); afterRestore('Undo.');
  }
  function redo() {
    if (app.mode === 'play') return setStatus('Stop Play to redo.');
    if (!redoStack.length) return setStatus('Nothing to redo.');
    undoStack.push(clone(app.save)); app.save = redoStack.pop(); afterRestore('Redo.');
  }
  function afterRestore(msg) {
    if (!activeLevel()) app.activeLevelId = app.save.levels[0].id;
    // keep selection only if it still resolves
    if (app.selection && !roomById(app.selection.roomId)) app.selection = null;
    refreshLevelSelect(); updateInspector(); setStatus(msg);
  }

  // ---- demo seed (same as M2) --------------------------------------------
  function seedDemo() {
    const save = D.createSaveFile('Demo Station');
    const level = save.levels[0]; level.name = 'Deck 1';
    const a = level.rooms[0];
    a.name = 'Main Hall'; a.size = { w: 12, h: 9 };
    a.tiles = grid(12, 9, 'deck'); ringWalls(a);
    a.tiles[4][6].floor = 'roundPad';
    a.objects.push(D.createObjectInstance('console', 2, 2));
    a.objects.push(D.createObjectInstance('crate', 9, 6));
    a.objects.push(D.createObjectInstance('plant', 3, 6));
    a.objects.push(D.createObjectInstance('elevator', 6, 4));
    level.entry = { roomId: a.id, x: 2, y: 7 };

    const b = D.createRoom('Annex', 6, 6);
    b.tiles = grid(6, 6, 'service'); ringWalls(b); b.movable = true;
    b.transform = D.createTransform(6, 11, 90);   // below the hall, no overlap
    b.transform.pivot = { x: 3, y: 3 };           // rotate in place if rotated
    b.objects.push(D.createObjectInstance('miner', 2, 2));
    b.objects.push(D.createObjectInstance('light', 4, 1));
    // authored motion: slides sideways and back forever (visible on Play)
    const slide = D.createRoomEvent('slide');
    slide.trigger = { type: 'time' }; slide.loop = true;
    slide.action = { kind: 'shift', to: { x: 12, y: 11 }, duration: 2.2 };
    b.events.push(slide);
    level.rooms.push(b);

    // second deck + an elevator link (Deck 1 elevator <-> Deck 2 spawn)
    const deck2 = D.createLevel('Deck 2');
    deck2.rooms[0].name = 'Upper Hall'; deck2.rooms[0].size = { w: 10, h: 8 };
    deck2.rooms[0].tiles = grid(10, 8, 'dark'); ringWalls(deck2.rooms[0]);
    deck2.rooms[0].objects.push(D.createObjectInstance('elevator', 2, 2));
    deck2.rooms[0].objects.push(D.createObjectInstance('console', 6, 3));
    deck2.entry = { roomId: deck2.rooms[0].id, x: 3, y: 3 };
    save.levels.push(deck2);
    const link = D.createLink(level.id, deck2.id); link.kind = 'elevator'; link.mode = 'preload';
    link.from = { levelId: level.id, roomId: a.id, x: 6, y: 4 };            // the Deck 1 elevator
    link.to = { levelId: deck2.id, roomId: deck2.rooms[0].id, x: 2, y: 2 }; // the Deck 2 elevator
    save.links.push(link);
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
    refreshLevelSelect(); updateInspector(); setStatus(msg || 'Loaded.');
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
    } else { engine.stop(activeLevel()); app.pendingLink = null; }
    app.mode = mode;
    document.getElementById('buildBtn').classList.toggle('active', mode === 'build');
    document.getElementById('playBtn').classList.toggle('active', mode === 'play');
    document.body.classList.toggle('playing', mode === 'play');
    updatePlayBar();
    updateInspector();
    setStatus(mode === 'play' ? 'Play mode — sim running. Space to pause, 1/2/3 speed.' : 'Build mode.');
  }

  function updatePlayBar() {
    const bar = document.getElementById('playBar');
    if (!bar) return;
    bar.style.display = app.mode === 'play' ? 'flex' : 'none';
    const pb = document.getElementById('pauseBtn');
    if (pb) pb.textContent = app.clock.paused ? '▶ Resume' : '❚❚ Pause';
    [1, 2, 3].forEach(sp => { const el = document.getElementById('speed' + sp); if (el) el.classList.toggle('active', app.clock.speed === sp && !app.clock.paused); });
  }
  function setTool(tool) {
    if (app.tool === 'link' && tool !== 'link') app.pendingLink = null;
    app.tool = tool;
    document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';
    if (tool === 'link') linkStartTool();
    else setStatus(tool[0].toUpperCase() + tool.slice(1) + ' tool.');
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
    const room = roomById(hit.roomId); if (!room) return setStatus('Place on a room tile.');
    const tile = room.tiles[hit.ly][hit.lx];
    if (!tile || tile.floor === 'void' || tile.wall) return setStatus('Object needs an empty floor tile.');
    if (room.objects.some(o => o.x === hit.lx && o.y === hit.ly)) return setStatus('Tile already has an object.');
    pushHistory();
    const obj = D.createObjectInstance(app.brush.object, hit.lx, hit.ly);
    room.objects.push(obj);
    app.selection = { roomId: room.id, lx: hit.lx, ly: hit.ly, objectId: obj.id };
    updateInspector(); setStatus(`${obj.name} placed.`);
  }

  function setEntry(hit) {
    const room = roomById(hit.roomId); if (!room) return;
    const tile = room.tiles[hit.ly][hit.lx];
    if (!tile || tile.floor === 'void' || tile.wall) return setStatus('Entry must be a walkable tile.');
    pushHistory();
    activeLevel().entry = { roomId: room.id, x: hit.lx, y: hit.ly };
    setStatus(`Entry set to ${hit.lx},${hit.ly}.`);
  }

  // ---- levels (decks) -----------------------------------------------------
  function levelName(id) { const l = app.save.levels.find(x => x.id === id); return l ? l.name : '?'; }
  function addLevel() {
    pushHistory();
    const lvl = D.createLevel('Deck ' + (app.save.levels.length + 1));
    app.save.levels.push(lvl);
    switchLevel(lvl.id); refreshLevelSelect();
    setStatus(`Added ${lvl.name}.`);
  }
  function deleteLevel() {
    if (app.save.levels.length <= 1) return setStatus('Cannot delete the last deck.');
    pushHistory();
    const id = app.activeLevelId;
    app.save.levels = app.save.levels.filter(l => l.id !== id);
    app.save.links = app.save.links.filter(k => k.from.levelId !== id && k.to.levelId !== id);
    if (app.save.startLevelId === id) app.save.startLevelId = app.save.levels[0].id;
    switchLevel(app.save.levels[0].id); refreshLevelSelect();
    setStatus('Deck deleted.');
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
    updateInspector();
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
  function linkStartTool() { app.pendingLink = null; setStatus('Link: click a source tile (e.g. an elevator). Then switch deck and click the spawn.'); }
  function handleLinkClick(hit) {
    if (!app.pendingLink) {
      app.pendingLink = { levelId: app.activeLevelId, roomId: hit.roomId, lx: hit.lx, ly: hit.ly };
      setStatus(`Source set on ${levelName(app.activeLevelId)} @${hit.lx},${hit.ly}. Switch to the target deck and click the spawn.`);
      return;
    }
    if (app.pendingLink.levelId === app.activeLevelId && app.pendingLink.roomId === hit.roomId && app.pendingLink.lx === hit.lx && app.pendingLink.ly === hit.ly) {
      return setStatus('Pick a spawn on a different deck (or another tile).');
    }
    pushHistory();
    const link = D.createLink(app.pendingLink.levelId, app.activeLevelId);
    link.from = { levelId: app.pendingLink.levelId, roomId: app.pendingLink.roomId, x: app.pendingLink.lx, y: app.pendingLink.ly };
    link.to = { levelId: app.activeLevelId, roomId: hit.roomId, x: hit.lx, y: hit.ly };
    app.save.links.push(link);
    const msg = `Linked ${levelName(link.from.levelId)} → ${levelName(link.to.levelId)} (${link.mode}).`;
    app.pendingLink = null;
    setStatus(msg);
  }
  // marker list for the active level (both endpoints that live here + pending)
  function linkMarkers() {
    const id = app.activeLevelId, out = [];
    for (const k of app.save.links) {
      if (k.from.levelId === id) out.push({ roomId: k.from.roomId, x: k.from.x, y: k.from.y, kind: 'source', label: '↑ ' + levelName(k.to.levelId) });
      if (k.to.levelId === id) out.push({ roomId: k.to.roomId, x: k.to.x, y: k.to.y, kind: 'spawn', label: levelName(k.from.levelId) });
    }
    if (app.pendingLink && app.pendingLink.levelId === id) out.push({ roomId: app.pendingLink.roomId, x: app.pendingLink.lx, y: app.pendingLink.ly, kind: 'pending', label: 'source' });
    return out;
  }
  // Play-mode transition when a link tile is used.
  function doTransition(match) {
    const mode = match.link.mode;
    const already = app.resident.has(match.target);
    engine.stop(activeLevel());
    app.activeLevelId = match.target; app.selection = null;
    app.resident.add(match.target);
    const spawnRoom = activeLevel().rooms.find(r => r.id === match.spawn.roomId) || activeLevel().rooms[0];
    const c = R.tileCenterWorld(spawnRoom, match.spawn.x, match.spawn.y);
    const s = R.worldToScreen({ x: 0, y: 0, zoom: app.camera.zoom }, c.x, c.y);
    app.camera.x = canvas.clientWidth / 2 - s.x; app.camera.y = canvas.clientHeight / 2 - s.y;
    engine.start(activeLevel());
    refreshLevelSelect();
    setStatus(`${match.link.kind} → ${levelName(match.target)} · ${mode === 'stream' ? (already ? 'stream (resident)' : 'streaming…') : 'preload'}`);
  }

  function deleteSelectedObject() {
    if (!app.selection || !app.selection.objectId) return;
    const room = roomById(app.selection.roomId); if (!room) return;
    pushHistory();
    room.objects = room.objects.filter(o => o.id !== app.selection.objectId);
    app.selection.objectId = null; updateInspector(); setStatus('Object deleted.');
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
    if (from === to) return setStatus('Already that floor.');
    pushHistory();
    const stack = [[hit.lx, hit.ly]]; const seen = new Set(); let n = 0;
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= room.size.w || y >= room.size.h) continue;
      const k = x + ',' + y; if (seen.has(k)) continue; seen.add(k);
      const t = room.tiles[y][x];
      if (t.wall || t.floor !== from) continue;   // barrier / different region
      t.floor = to; n++;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    if (!n) discardHistory(); else setStatus(`Filled ${n} tiles.`);
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
      const t = room.tiles[ny][nx];
      if (t.floor !== 'void' && !t.wall && !room.objects.some(o => o.x === nx && o.y === ny)) { tx = nx; ty = ny; found = true; break; }
    }
    if (!found) return setStatus('No free tile to duplicate into.');
    pushHistory();
    const copy = clone(src); copy.id = D.uid('obj'); copy.x = tx; copy.y = ty;
    room.objects.push(copy);
    app.selection = { roomId: room.id, lx: tx, ly: ty, objectId: copy.id };
    updateInspector(); setStatus(`${copy.name} duplicated.`);
  }

  function duplicateActiveRoom() {
    const src = app.selection ? roomById(app.selection.roomId) : activeLevel().rooms[0];
    if (!src) return;
    pushHistory();
    const copy = clone(src); copy.id = D.uid('room'); copy.name = src.name + ' copy';
    copy.objects.forEach(o => { o.id = D.uid('obj'); });
    copy.events.forEach(e => { e.id = D.uid('evt'); });
    copy.transform = D.createTransform(src.transform.x + src.size.w + 2, src.transform.y, src.transform.rotation);
    activeLevel().rooms.push(copy);
    setStatus(`Room "${src.name}" duplicated.`);
  }

  function toggleSelectedDoor() {
    if (!app.selection || !app.selection.objectId) return false;
    const room = roomById(app.selection.roomId); if (!room) return false;
    const obj = room.objects.find(o => o.id === app.selection.objectId); if (!obj) return false;
    if (!D.OBJECT_DEFS[obj.type].openable) return false;
    obj.open = !obj.open; updateInspector(); setStatus(`${obj.name} ${obj.open ? 'opened' : 'closed'}.`); return true;
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
          const rot = ((Math.round((ang + 90) / 90) * 90) % 360 + 360) % 360;   // grip points "up" at rot 0
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
      const match = hit ? linkAt(app.activeLevelId, hit.roomId, hit.lx, hit.ly) : null;
      if (match) {
        doTransition(match);
      } else if (hit && hit.object && D.OBJECT_DEFS[hit.object.type].openable) {
        hit.object.open = !hit.object.open;
        setStatus(`${hit.object.name} ${hit.object.open ? 'opened' : 'closed'}.`);
      } else if (hit) {
        const room = roomById(hit.roomId);
        if (room && room.movable) { const n = engine.trigger(room); if (n) setStatus(`Fired ${n} event(s) on ${room.name}.`); }
      }
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
    if (!app.selection) { inspector.innerHTML = '<span class="muted">Nothing selected. Click a tile or object.</span>'; return; }
    const room = roomById(app.selection.roomId);
    if (!room) { inspector.innerHTML = '<span class="muted">—</span>'; return; }
    const obj = app.selection.objectId ? room.objects.find(o => o.id === app.selection.objectId) : null;
    const tile = room.tiles[app.selection.ly] && room.tiles[app.selection.ly][app.selection.lx];

    let h = `<div class="row"><b>Room</b><span>${esc(room.name)}</span></div>`;
    h += `<div class="row"><b>Transform</b><span>@${fmt(room.transform.x)},${fmt(room.transform.y)} · ${fmt(room.transform.rotation)}°</span></div>`;
    h += `<div class="row"><b>Local tile</b><span>${app.selection.lx}, ${app.selection.ly}</span></div>`;
    if (tile) {
      h += `<div class="row"><b>Floor</b><span>${esc(floorLabel(tile.floor))}</span></div>`;
      h += `<div class="row"><b>Wall</b><span>${tile.wall || 'none'}</span></div>`;
    }
    if (obj) {
      const def = D.OBJECT_DEFS[obj.type];
      h += `<hr><div class="row"><b>Object</b><span>${esc(obj.name)}</span></div>`;
      h += `<div class="row"><b>Type</b><span>${obj.type} · ${obj.rotation || 0}°</span></div>`;
      h += `<div class="row"><b>Layer</b><span>${obj.layer}</span></div>`;
      h += `<div class="row"><b>Flags</b><span>${obj.interactive ? 'interactive ' : ''}${obj.collision ? 'solid' : ''}</span></div>`;
      if (def.openable) h += `<div class="row"><b>State</b><span>${obj.open ? 'open' : 'closed'}</span></div>`;
      h += `<div class="row"><b>Power/Heat</b><span>${obj.power} / ${obj.heat}</span></div>`;
      h += `<div class="mini"><button data-act="rotate">Rotate 45°</button><button data-act="dup">Duplicate</button>`;
      if (def.openable) h += `<button data-act="toggle">${obj.open ? 'Close' : 'Open'}</button>`;
      h += `<button class="danger" data-act="delete">Delete</button></div>`;
    }

    // --- Room motion (Milestone 4) ---
    h += `<hr><div class="row"><b>Movable</b><span><input type="checkbox" data-act="movable" ${room.movable ? 'checked' : ''}></span></div>`;
    if (room.events && room.events.length) {
      for (const ev of room.events) {
        const kind = ev.action ? ev.action.kind : '?';
        const extra = kind === 'orbit' ? ` ${ev.action.direction === 'ccw' ? '⟲' : '⟳'}` : (ev.loop ? ' ⟳' : '');
        h += `<div class="row" style="margin-top:4px"><b>${esc(ev.name)}</b><span>${kind}${extra} · ${ev.trigger ? ev.trigger.type : 'manual'}</span></div>`;
        h += `<div class="mini"><button data-act="evt-fire" data-id="${ev.id}">Test ▶</button>`;
        if (kind === 'orbit') h += `<button data-act="evt-orbitdir" data-id="${ev.id}">Flip ⟳⟲</button>`;
        h += `<button class="danger" data-act="evt-del" data-id="${ev.id}">✕</button></div>`;
      }
    } else {
      h += `<div class="row"><span class="muted">No motion events.</span></div>`;
    }
    h += `<div class="mini"><button data-act="evt-shift">+ Shift</button><button data-act="evt-rotate">+ Rotate</button></div>`;
    h += `<div class="mini"><button data-act="evt-orbit">+ Orbit</button><button data-act="evt-carousel">+ Carousel</button></div>`;
    h += `<div class="hint" style="margin-top:6px">On the map: drag the white ▪ to move the room, the white ● to rotate it. Coloured handles aim each motion (orbit: orange = axis, yellow = radius).</div>`;
    inspector.innerHTML = h;
  }
  function floorLabel(id) { return id === 'void' ? 'void (empty)' : ((D.MATERIALS[id] || {}).label || id); }
  function fmt(n) { return Math.abs(n - Math.round(n)) < 0.01 ? String(Math.round(n)) : n.toFixed(1); }
  function esc(v) { return String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ---- room motion authoring ---------------------------------------------
  function selectedRoom() { return app.selection ? roomById(app.selection.roomId) : null; }
  function addRoomEvent(room, kind) {
    pushHistory();
    room.movable = true;
    const t = room.transform, ev = D.createRoomEvent(kind[0].toUpperCase() + kind.slice(1));
    ev.trigger = { type: 'time' }; ev.loop = true;
    if (kind === 'shift') ev.action = { kind: 'shift', to: { x: t.x + 4, y: t.y }, duration: 2 };
    else if (kind === 'rotate') ev.action = { kind: 'rotate', by: 90, duration: 2 };
    else if (kind === 'orbit') { const rc = R.roomCenterWorld(room); ev.action = { kind: 'orbit', center: { x: rc.x, y: rc.y - 5 }, radius: 5, period: 4, direction: 'cw', selfRotate: false }; }
    else if (kind === 'carousel') ev.action = { kind: 'carousel', interval: 1.8, loop: true, poses: [
      { x: t.x + 4, y: t.y, rotation: t.rotation }, { x: t.x + 4, y: t.y + 4, rotation: t.rotation + 90 }, { x: t.x, y: t.y + 4, rotation: t.rotation + 180 }
    ] };
    room.events.push(ev);
    updateInspector(); setStatus(`Added ${kind} event. Drag the handle to aim it, hit Play to see it.`);
  }
  function deleteRoomEvent(room, id) { pushHistory(); room.events = room.events.filter(e => e.id !== id); updateInspector(); }
  function testRoomEvent(room, id) {
    const ev = room.events.find(e => e.id === id); if (!ev) return;
    if (app.mode !== 'play') { setMode('play'); }
    engine.fire(room, ev); setStatus(`Testing "${ev.name}".`);
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
      if (engine.activeCount() > 0) invalidate();     // something is moving → redraw
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
  function buildPalettes() {
    // floor materials
    const floors = Object.values(D.MATERIALS).filter(m => m.kind === 'floor');
    const fWrap = document.getElementById('floorPalette');
    for (const m of floors) fWrap.appendChild(chip(m.label, () => { app.brush.floor = m.id; markActive(fWrap, m.id); setTool('floor'); }, m.id, app.brush.floor === m.id));
    fWrap.appendChild(chip('Void', () => { app.brush.floor = 'void'; markActive(fWrap, 'void'); setTool('floor'); }, 'void', false));
    // objects
    const oWrap = document.getElementById('objectPalette');
    for (const def of Object.values(D.OBJECT_DEFS)) oWrap.appendChild(chip(def.label, () => { app.brush.object = def.type; markActive(oWrap, def.type); setTool('object'); }, def.type, app.brush.object === def.type));
    // wall shapes
    const wWrap = document.getElementById('wallPalette');
    [['solid', 'Solid'], ['diagA', 'Diag /'], ['diagB', 'Diag \\']].forEach(([id, label]) =>
      wWrap.appendChild(chip(label, () => { app.brush.wallShape = id; markActive(wWrap, id); setTool('wall'); }, id, app.brush.wallShape === id)));
    // wall materials (hull vs glass/windows)
    const wmWrap = document.getElementById('wallMatPalette');
    Object.values(D.MATERIALS).filter(m => m.kind === 'wall').forEach(m =>
      wmWrap.appendChild(chip(m.label, () => { app.brush.wallMat = m.id; markActive(wmWrap, m.id); setTool('wall'); }, m.id, app.brush.wallMat === m.id)));
    // layer visibility toggles
    const lWrap = document.getElementById('layerToggles');
    D.LAYERS.forEach(name => {
      const b = document.createElement('button'); b.textContent = name; b.dataset.key = name; b.classList.add('active');
      b.addEventListener('click', () => {
        if (app.hiddenLayers.has(name)) app.hiddenLayers.delete(name); else app.hiddenLayers.add(name);
        b.classList.toggle('active', !app.hiddenLayers.has(name));
        setStatus(`Layer ${name} ${app.hiddenLayers.has(name) ? 'hidden' : 'shown'}.`);
      });
      lWrap.appendChild(b);
    });
  }
  function chip(label, onClick, key, active) {
    const b = document.createElement('button'); b.textContent = label; b.dataset.key = key;
    if (active) b.classList.add('active'); b.addEventListener('click', onClick); return b;
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
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(); return; }
      if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); duplicateSelectedObject(); return; }
      if (k === 'delete' || k === 'backspace') { if (app.mode === 'build') deleteSelectedObject(); return; }
      if (k === 'escape') { app.selection = null; updateInspector(); return; }
      if (app.mode === 'play') {
        if (k === ' ') { e.preventDefault(); app.clock.paused = !app.clock.paused; updatePlayBar(); return; }
        if (k === '1' || k === '2' || k === '3') { app.clock.speed = +k; app.clock.paused = false; updatePlayBar(); return; }
      }
      const toolKeys = { v: 'select', f: 'floor', g: 'wall', b: 'object', n: 'entry', x: 'erase', k: 'fill', l: 'link' };
      if (toolKeys[k] && !e.ctrlKey && !e.metaKey) { setTool(toolKeys[k]); return; }
      keys.add(k);
    });
    window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

    document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

    // tab switching
    document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => {
      const name = btn.dataset.tab;
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === btn));
      document.querySelectorAll('[data-tabpanel]').forEach(p => { p.hidden = p.dataset.tabpanel !== name; });
    }));
    document.getElementById('buildBtn').addEventListener('click', () => setMode('build'));
    document.getElementById('playBtn').addEventListener('click', () => setMode('play'));
    document.getElementById('undoBtn').addEventListener('click', undo);
    document.getElementById('redoBtn').addEventListener('click', redo);
    document.getElementById('newBtn').addEventListener('click', () => loadSave(seedDemo(), 'New demo station.'));
    document.getElementById('exportBtn').addEventListener('click', () => {
      try { setStatus('Exported ' + S.exportToFile(app.save)); } catch (err) { setStatus('Export failed: ' + err.message); }
    });
    const fileInput = document.getElementById('fileInput');
    document.getElementById('importBtn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      try { const { save, warnings } = await S.importFromFile(file); loadSave(save, `Imported "${save.name}"` + (warnings.length ? ` (${warnings.length} warnings)` : '')); if (warnings.length) console.warn(warnings); }
      catch (err) { setStatus('Import failed: ' + err.message); } finally { fileInput.value = ''; }
    });
    levelSelect.addEventListener('change', e => { switchLevel(e.target.value); refreshLevelSelect(); });

    // Play-bar controls
    document.getElementById('pauseBtn').addEventListener('click', () => { app.clock.paused = !app.clock.paused; updatePlayBar(); });
    [1, 2, 3].forEach(sp => document.getElementById('speed' + sp).addEventListener('click', () => { app.clock.speed = sp; app.clock.paused = false; updatePlayBar(); }));
    inspector.addEventListener('click', e => {
      const act = e.target.dataset.act; if (!act) return;
      const room = selectedRoom();
      if (act === 'rotate') rotateSelectedObject();
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
      if (e.target.dataset.act === 'movable') { const room = selectedRoom(); if (room) { pushHistory(); room.movable = e.target.checked; } }
    });

    document.getElementById('dupRoomBtn').addEventListener('click', duplicateActiveRoom);
    document.getElementById('addLevelBtn').addEventListener('click', addLevel);
    document.getElementById('delLevelBtn').addEventListener('click', deleteLevel);
    document.getElementById('levelName').addEventListener('change', e => renameLevel(e.target.value));
    const filterSel = document.getElementById('selectFilter');
    filterSel.addEventListener('change', e => { app.selectFilter = e.target.value; setStatus(`Select filter: ${e.target.value}.`); });

    buildPalettes();
    loadSave(seedDemo(), 'Milestone 3 — build tools ready.');
    setMode('build'); setTool('select');
    requestAnimationFrame(frame);

    // debug/test hook (harmless): lets headless tests inspect live state
    window.UGS.editorApp = app;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
