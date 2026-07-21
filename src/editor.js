/*
 * UGS — editor shell  (Stage 1 · Milestone 2)
 * ------------------------------------------------------------------
 * The application: owns all mutable state (current save, active level,
 * mode, camera, selection), runs the render loop, and wires input.
 *
 * Milestone 2 scope = SHELL: render the level, pan/zoom, hover + click to
 * select/inspect a tile/object/room, toggle Build/Play, export/import.
 * The actual painting tools (floor/wall/object brushes, undo-redo) are
 * Milestone 3 and slot into the `tools` seam left here.
 */
(function () {
  'use strict';
  const D = window.UGS.data;
  const R = window.UGS.render;

  // ---- state --------------------------------------------------------------
  const app = {
    save: null,
    activeLevelId: null,
    mode: 'build',                 // 'build' | 'play'
    camera: { x: 0, y: 0, zoom: 1, minZoom: 0.4, maxZoom: 2.4 },
    hover: null,                   // { roomId, lx, ly, object }
    selection: null,               // { roomId, lx, ly, objectId }
  };
  const keys = new Set();
  const mouse = { x: 0, y: 0, down: false, dragging: false, lastX: 0, lastY: 0 };

  let canvas, ctx, hud, inspector, statusEl, levelSelect;

  function activeLevel() {
    return app.save.levels.find(l => l.id === app.activeLevelId) || app.save.levels[0];
  }
  function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }

  // ---- a demo station so M2 shows something (and proves transforms) -------
  function seedDemo() {
    const save = D.createSaveFile('Demo Station');
    const level = save.levels[0];
    level.name = 'Deck 1';

    // Room A: the main hall, at origin
    const a = level.rooms[0];
    a.name = 'Main Hall';
    a.size = { w: 12, h: 9 };
    a.tiles = Array.from({ length: 9 }, () => Array.from({ length: 12 }, () => D.createTile('deck')));
    ringWalls(a);
    a.tiles[4][6].floor = 'roundPad';
    a.objects.push(at(D.createObjectInstance('console', 2, 2)));
    a.objects.push(at(D.createObjectInstance('crate', 9, 6)));
    a.objects.push(at(D.createObjectInstance('plant', 3, 6)));
    a.objects.push(at(D.createObjectInstance('elevator', 6, 4)));

    // Room B: an annex, OFFSET and ROTATED 90° — this is the transform proof
    const b = D.createRoom('Annex', 6, 6);
    b.tiles = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => D.createTile('service')));
    ringWalls(b);
    b.movable = true;
    b.transform = D.createTransform(12, 1, 90);   // shifted right, rotated
    b.objects.push(at(D.createObjectInstance('miner', 2, 2)));
    b.objects.push(at(D.createObjectInstance('light', 4, 1)));
    level.rooms.push(b);

    return save;
  }
  function at(o) { return o; }
  function ringWalls(room) {
    const w = room.size.w, h = room.size.h;
    for (let x = 0; x < w; x++) { setWall(room, x, 0); setWall(room, x, h - 1); }
    for (let y = 0; y < h; y++) { setWall(room, 0, y); setWall(room, w - 1, y); }
  }
  function setWall(room, x, y) { room.tiles[y][x] = { floor: 'deck', wall: 'solid', wallMaterial: 'hull' }; }

  // ---- lifecycle ----------------------------------------------------------
  function loadSave(save, statusMsg) {
    app.save = save;
    app.activeLevelId = save.startLevelId || save.levels[0].id;
    app.selection = null;
    R.centerOn(app.camera, activeLevel(), canvas.clientWidth, canvas.clientHeight);
    refreshLevelSelect();
    updateInspector();
    setStatus(statusMsg || 'Loaded.');
  }

  function setMode(mode) {
    app.mode = mode;
    document.getElementById('buildBtn').classList.toggle('active', mode === 'build');
    document.getElementById('playBtn').classList.toggle('active', mode === 'play');
    document.body.classList.toggle('playing', mode === 'play');
    app.selection = null;
    updateInspector();
    setStatus(mode === 'play' ? 'Play mode (runtime preview).' : 'Build mode.');
  }

  // ---- input --------------------------------------------------------------
  function updateMouse(e) {
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left;
    mouse.y = e.clientY - r.top;
  }

  function onPointerMove(e) {
    updateMouse(e);
    if (mouse.down && (Math.abs(e.clientX - mouse.lastX) + Math.abs(e.clientY - mouse.lastY) > 2)) {
      mouse.dragging = true;
    }
    if (mouse.dragging) {
      app.camera.x += e.clientX - mouse.lastX;
      app.camera.y += e.clientY - mouse.lastY;
      mouse.lastX = e.clientX; mouse.lastY = e.clientY;
      app.hover = null;
      return;
    }
    app.hover = R.pick(app.camera, activeLevel(), mouse.x, mouse.y);
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    updateMouse(e);
    mouse.down = true; mouse.dragging = false;
    mouse.lastX = e.clientX; mouse.lastY = e.clientY;
  }

  function onPointerUp() {
    if (mouse.down && !mouse.dragging) {
      // a click (not a drag) → select whatever is under the cursor
      const hit = R.pick(app.camera, activeLevel(), mouse.x, mouse.y);
      if (hit) {
        app.selection = { roomId: hit.roomId, lx: hit.lx, ly: hit.ly, objectId: hit.object ? hit.object.id : null };
      } else {
        app.selection = null;
      }
      updateInspector();
    }
    mouse.down = false; mouse.dragging = false;
  }

  function onWheel(e) {
    e.preventDefault();
    const before = R.screenToWorld(app.camera, mouse.x, mouse.y);
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    app.camera.zoom = Math.max(app.camera.minZoom, Math.min(app.camera.maxZoom, app.camera.zoom * factor));
    const after = R.screenToWorld(app.camera, mouse.x, mouse.y);
    // keep the world point under the cursor fixed
    const s1 = R.worldToScreen(Object.assign({}, app.camera, { x: 0, y: 0 }), before.x, before.y);
    const s2 = R.worldToScreen(Object.assign({}, app.camera, { x: 0, y: 0 }), after.x, after.y);
    app.camera.x += s1.x - s2.x;
    app.camera.y += s1.y - s2.y;
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
    const room = lvl.rooms.find(r => r.id === app.selection.roomId);
    if (!room) { inspector.innerHTML = '<span class="muted">—</span>'; return; }
    const obj = app.selection.objectId ? room.objects.find(o => o.id === app.selection.objectId) : null;
    const tile = room.tiles[app.selection.ly] && room.tiles[app.selection.ly][app.selection.lx];

    let html = `<div class="row"><b>Room</b><span>${esc(room.name)}</span></div>`;
    html += `<div class="row"><b>Transform</b><span>@${room.transform.x},${room.transform.y} · ${room.transform.rotation}°${room.movable ? ' · movable' : ''}</span></div>`;
    html += `<div class="row"><b>Local tile</b><span>${app.selection.lx}, ${app.selection.ly}</span></div>`;
    if (tile) {
      html += `<div class="row"><b>Floor</b><span>${esc((D.MATERIALS[tile.floor] || {}).label || tile.floor)}</span></div>`;
      html += `<div class="row"><b>Wall</b><span>${tile.wall || 'none'}</span></div>`;
    }
    if (obj) {
      html += `<hr><div class="row"><b>Object</b><span>${esc(obj.name)}</span></div>`;
      html += `<div class="row"><b>Type</b><span>${obj.type}</span></div>`;
      html += `<div class="row"><b>Flags</b><span>${obj.interactive ? 'interactive ' : ''}${obj.collision ? 'solid' : ''}</span></div>`;
      html += `<div class="row"><b>Power/Heat</b><span>${obj.power} / ${obj.heat}</span></div>`;
    }
    inspector.innerHTML = html;
  }
  function esc(v) { return String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ---- level select -------------------------------------------------------
  function refreshLevelSelect() {
    levelSelect.innerHTML = '';
    for (const lvl of app.save.levels) {
      const opt = document.createElement('option');
      opt.value = lvl.id; opt.textContent = lvl.name;
      if (lvl.id === app.activeLevelId) opt.selected = true;
      levelSelect.appendChild(opt);
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
      hover: app.mode === 'build' && !mouse.dragging ? app.hover : null,
      selection: app.selection,
      activeRoomId: app.selection ? app.selection.roomId : null,
      showRoomOutlines: app.mode === 'build'
    });
    hud.textContent =
      `${app.save.name} · ${lvl.name}  [${app.mode}]\n` +
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

  // ---- boot ---------------------------------------------------------------
  function boot() {
    canvas = document.getElementById('game');
    ctx = canvas.getContext('2d');
    hud = document.getElementById('hud');
    inspector = document.getElementById('inspector');
    statusEl = document.getElementById('status');
    levelSelect = document.getElementById('levelSelect');

    resize();
    window.addEventListener('resize', () => { resize(); });

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', () => { app.hover = null; });
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if (k === 'escape') { app.selection = null; updateInspector(); return; }
      keys.add(k);
    });
    window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

    document.getElementById('buildBtn').addEventListener('click', () => setMode('build'));
    document.getElementById('playBtn').addEventListener('click', () => setMode('play'));
    document.getElementById('newBtn').addEventListener('click', () => loadSave(seedDemo(), 'New demo station.'));
    document.getElementById('exportBtn').addEventListener('click', () => {
      try { const name = window.UGS.save.exportToFile(app.save); setStatus(`Exported ${name}`); }
      catch (err) { setStatus('Export failed: ' + err.message); }
    });
    const fileInput = document.getElementById('fileInput');
    document.getElementById('importBtn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const { save, warnings } = await window.UGS.save.importFromFile(file);
        loadSave(save, `Imported "${save.name}"` + (warnings.length ? ` (${warnings.length} warnings)` : ''));
        if (warnings.length) console.warn('Import warnings:', warnings);
      } catch (err) { setStatus('Import failed: ' + err.message); }
      finally { fileInput.value = ''; }
    });
    levelSelect.addEventListener('change', e => {
      app.activeLevelId = e.target.value; app.selection = null;
      R.centerOn(app.camera, activeLevel(), canvas.clientWidth, canvas.clientHeight);
      updateInspector();
    });

    loadSave(seedDemo(), 'Milestone 2 — renderer + editor shell ready.');
    setMode('build');
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
