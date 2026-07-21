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

  // ---- state --------------------------------------------------------------
  const app = {
    save: null,
    activeLevelId: null,
    mode: 'build',
    tool: 'select',                // select | floor | wall | object | entry | erase
    brush: { floor: 'deck', wallShape: 'solid', wallMat: 'hull', object: 'console' },
    camera: { x: 0, y: 0, zoom: 1, minZoom: 0.4, maxZoom: 2.4 },
    hover: null,
    selection: null,               // { roomId, lx, ly, objectId }
  };
  const undoStack = [];
  const redoStack = [];
  const keys = new Set();
  const mouse = { x: 0, y: 0, down: false, lastX: 0, lastY: 0 };
  // interaction sub-states resolved per gesture
  let painting = false, panning = false, dragged = false;
  let movingObj = null;            // { roomId, objectId }
  let strokeChanged = false;       // did the current gesture actually mutate?
  let lastPaintKey = '';           // dedupe repeated paints on the same tile

  let canvas, ctx, hud, inspector, statusEl, levelSelect;

  function activeLevel() { return app.save.levels.find(l => l.id === app.activeLevelId) || app.save.levels[0]; }
  function roomById(id) { return activeLevel().rooms.find(r => r.id === id) || null; }
  // Select/Erase act on what you SEE (raised walls/objects); the painting/place
  // tools act on the flat ground tile under the cursor.
  function pickHit(px, py) {
    return (app.tool === 'select' || app.tool === 'erase')
      ? R.pickTopmost(app.camera, activeLevel(), px, py)
      : R.pick(app.camera, activeLevel(), px, py);
  }
  function setStatus(m) { if (statusEl) statusEl.textContent = m; }
  function clone(o) { return typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)); }

  // ---- history ------------------------------------------------------------
  function pushHistory() { undoStack.push(clone(app.save)); if (undoStack.length > 80) undoStack.shift(); redoStack.length = 0; }
  function discardHistory() { undoStack.pop(); }        // for gestures that changed nothing
  function undo() {
    if (!undoStack.length) return setStatus('Nothing to undo.');
    redoStack.push(clone(app.save)); app.save = undoStack.pop(); afterRestore('Undo.');
  }
  function redo() {
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
    b.objects.push(D.createObjectInstance('miner', 2, 2));
    b.objects.push(D.createObjectInstance('light', 4, 1));
    level.rooms.push(b);
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
    app.mode = mode;
    document.getElementById('buildBtn').classList.toggle('active', mode === 'build');
    document.getElementById('playBtn').classList.toggle('active', mode === 'play');
    if (mode === 'play') app.selection = null;
    updateInspector();
    setStatus(mode === 'play' ? 'Play mode (runtime preview).' : 'Build mode.');
  }
  function setTool(tool) {
    app.tool = tool;
    document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';
    setStatus(tool[0].toUpperCase() + tool.slice(1) + ' tool.');
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

  // ---- input --------------------------------------------------------------
  function updateMouse(e) { const r = canvas.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    updateMouse(e); mouse.down = true; dragged = false;
    mouse.lastX = e.clientX; mouse.lastY = e.clientY;
    lastPaintKey = ''; strokeChanged = false;
    painting = panning = false; movingObj = null;

    if (app.mode !== 'build') { panning = true; return; }
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
    if (mouse.down && app.mode === 'build') {
      if (painting || movingObj) {
        if (!strokeChanged) discardHistory();   // no-op gesture: drop the snapshot
        else updateInspector();
      } else if (!dragged) {
        // a click
        const hit = pickHit(mouse.x, mouse.y);
        if (app.tool === 'object') { if (hit) placeObject(hit); }
        else if (app.tool === 'entry') { if (hit) setEntry(hit); }
        else { // select (default)
          app.selection = hit ? { roomId: hit.roomId, lx: hit.lx, ly: hit.ly, objectId: hit.object ? hit.object.id : null } : null;
          updateInspector();
        }
      }
    }
    mouse.down = false; painting = panning = false; movingObj = null; dragged = false;
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
    const pan = 520 * dt;
    if (keys.has('w') || keys.has('arrowup')) app.camera.y += pan;
    if (keys.has('s') || keys.has('arrowdown')) app.camera.y -= pan;
    if (keys.has('a') || keys.has('arrowleft')) app.camera.x += pan;
    if (keys.has('d') || keys.has('arrowright')) app.camera.x -= pan;
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
    h += `<div class="row"><b>Transform</b><span>@${room.transform.x},${room.transform.y} · ${room.transform.rotation}°${room.movable ? ' · movable' : ''}</span></div>`;
    h += `<div class="row"><b>Local tile</b><span>${app.selection.lx}, ${app.selection.ly}</span></div>`;
    if (tile) {
      h += `<div class="row"><b>Floor</b><span>${esc(floorLabel(tile.floor))}</span></div>`;
      h += `<div class="row"><b>Wall</b><span>${tile.wall || 'none'}</span></div>`;
    }
    if (obj) {
      h += `<hr><div class="row"><b>Object</b><span>${esc(obj.name)}</span></div>`;
      h += `<div class="row"><b>Type</b><span>${obj.type} · ${obj.rotation || 0}°</span></div>`;
      h += `<div class="row"><b>Flags</b><span>${obj.interactive ? 'interactive ' : ''}${obj.collision ? 'solid' : ''}</span></div>`;
      h += `<div class="row"><b>Power/Heat</b><span>${obj.power} / ${obj.heat}</span></div>`;
      h += `<div class="mini"><button data-act="rotate">Rotate 45°</button><button class="danger" data-act="delete">Delete</button></div>`;
    }
    inspector.innerHTML = h;
  }
  function floorLabel(id) { return id === 'void' ? 'void (empty)' : ((D.MATERIALS[id] || {}).label || id); }
  function esc(v) { return String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function refreshLevelSelect() {
    levelSelect.innerHTML = '';
    for (const lvl of app.save.levels) {
      const o = document.createElement('option'); o.value = lvl.id; o.textContent = lvl.name;
      if (lvl.id === app.activeLevelId) o.selected = true; levelSelect.appendChild(o);
    }
  }

  // ---- render loop --------------------------------------------------------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    updateCamera(dt);
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    const lvl = activeLevel();
    R.drawLevel(ctx, app.camera, lvl, {
      hover: app.mode === 'build' && !panning ? app.hover : null,
      hoverFill: app.tool === 'erase' ? 'rgba(220,90,90,0.22)' : undefined,
      hoverStroke: app.tool === 'erase' ? '#e06a6a' : undefined,
      selection: app.selection,
      entry: lvl.entry,
      activeRoomId: app.selection ? app.selection.roomId : null,
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

    resize(); window.addEventListener('resize', resize);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', () => { app.hover = null; });
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(); return; }
      if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
      if (k === 'delete' || k === 'backspace') { if (app.mode === 'build') deleteSelectedObject(); return; }
      if (k === 'escape') { app.selection = null; updateInspector(); return; }
      const toolKeys = { v: 'select', f: 'floor', g: 'wall', b: 'object', n: 'entry', x: 'erase' };
      if (toolKeys[k] && !e.ctrlKey && !e.metaKey) { setTool(toolKeys[k]); return; }
      keys.add(k);
    });
    window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

    document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
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
    levelSelect.addEventListener('change', e => {
      app.activeLevelId = e.target.value; app.selection = null;
      R.centerOn(app.camera, activeLevel(), canvas.clientWidth, canvas.clientHeight); updateInspector();
    });
    inspector.addEventListener('click', e => {
      const act = e.target.dataset.act; if (!act) return;
      if (act === 'rotate') rotateSelectedObject();
      if (act === 'delete') deleteSelectedObject();
    });

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
