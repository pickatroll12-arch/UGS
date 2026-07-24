/*
 * UGS — app/app  (REVAMP · base nueva)
 * ==================================================================
 * El pegamento: shell (menú → Dev/Juego), cámara RTS y bucle principal.
 * Vive ENTRE la lógica y el renderizador: orquesta, pero las reglas del
 * juego están en engine/ y los píxeles en render/ (ver PROMPT_MAESTRO.md §2).
 *
 * Cámara (decisión del Rector): vista CENITAL con rotación yaw libre.
 *   Q/E ............ rotar la vista (el mundo gira bajo la cámara)
 *   rueda .......... zoom anclado al cursor
 *   arrastrar ...... pan (botón izquierdo en vacío / medio / derecho)
 *
 * Modos: MENU → DEV (construir: suelo/pared/borrar/entrada/nexo/link) o
 * JUEGO (click→ruta del PCJ, puertas, viaje por ascensores). En JUEGO no
 * aparece vocabulario de desarrollo (regla del feedback humano).
 */
(function () {
  'use strict';
  const CORE = window.UGS.core;
  const D = window.UGS.data;
  const S = window.UGS.save;
  const R = window.UGS.render;
  const NAV = window.UGS.nav;

  const engine = window.UGS.engine.create();
  const agents = window.UGS.agents.create(engine);
  agents.install();

  const app = {
    mode: 'menu',                    // menu | dev | game
    station: D.createStation('Untitled Station'),
    nexoId: null,
    tool: 'floor',                   // dev: floor | wall | erase | entry | link
    brush: { floor: 'deck', wallKind: 'block', wallOrient: 0 },
    cam: { x: 0, y: 0, zoom: 1, rot: 0 },
    hover: null,
    pendingLink: null,
    paused: false
  };
  app.nexoId = app.station.startNexoId;

  const nexo = () => app.station.nexos.find(n => n.id === app.nexoId) || app.station.nexos[0];
  const roomById = (id) => nexo().rooms.find(r => r.id === id) || null;

  let canvas, ctx, statusEl, hudEl;
  const sim = new CORE.FixedTimestep(30, 6);
  let dirty = true;
  const invalidate = () => { dirty = true; };
  const setStatus = (m) => { if (statusEl) statusEl.textContent = m; };

  // ---- modos ---------------------------------------------------------------
  function setMode(mode) {
    app.mode = mode;
    document.body.dataset.mode = mode;
    if (mode === 'game') {
      engine.start(nexo());
      spawnAtEntry();
      app.paused = false;
      setStatus('Click: caminar · puerta: abrir · ascensor: viajar · Q/E rotar');
    } else {
      engine.stop();
      agents.clear();
      if (mode === 'dev') setStatus('Dev: pinta suelo/paredes, marca la entrada, añade nexos y links.');
    }
    syncChrome();
    invalidate();
  }
  function syncChrome() {
    document.getElementById('toolbar').style.display = app.mode === 'dev' ? 'flex' : 'none';
    document.getElementById('menu').style.display = app.mode === 'menu' ? 'flex' : 'none';
    document.getElementById('topbar').style.display = app.mode === 'menu' ? 'none' : 'flex';
    document.getElementById('tPlay').textContent = app.mode === 'game' ? '🛠 Dev' : '▶ Jugar';
  }

  function spawnAtEntry() {
    agents.clear();
    const n = nexo();
    const e = n.entry || { roomId: n.rooms[0].id, x: 1, y: 1 };
    agents.spawn(n.id, e.roomId, e.x, e.y);
  }

  // ---- viaje entre Nexos (ascensores) --------------------------------------
  engine.bus.on('pawn:arrived', ({ pawn, x, y }) => {
    const link = linkAt(pawn.nexoId, pawn.roomId, x, y);
    if (!link) return;
    const target = app.station.nexos.find(n => n.id === link.target);
    if (!target) return;
    const spawnRoom = target.rooms.find(r => r.id === link.spawn.roomId) || target.rooms[0];
    engine.stop();
    agents.place(pawn, target.id, spawnRoom.id, link.spawn.x, link.spawn.y);
    app.nexoId = target.id;
    engine.start(target);
    R.centerOn(app.cam, target, canvas.clientWidth, canvas.clientHeight);
    invalidate();
    setStatus('Ascensor → ' + target.name);
  });
  function linkAt(nexoId, roomId, x, y) {
    for (const k of app.station.links) {
      if (k.from.nexoId === nexoId && k.from.x === x && k.from.y === y) return { link: k, target: k.to.nexoId, spawn: k.to };
      if (k.bidirectional && k.to.nexoId === nexoId && k.to.x === x && k.to.y === y) return { link: k, target: k.from.nexoId, spawn: k.from };
    }
    return null;
  }
  function linkMarkers() {
    const out = [];
    for (const k of app.station.links) {
      if (k.from.nexoId === app.nexoId) out.push({ roomId: k.from.roomId, x: k.from.x, y: k.from.y });
      if (k.to.nexoId === app.nexoId) out.push({ roomId: k.to.roomId, x: k.to.x, y: k.to.y });
    }
    return out;
  }

  // ---- cámara RTS ----------------------------------------------------------
  function rotateCam(drot) {
    const cx = canvas.clientWidth / 2, cy = canvas.clientHeight / 2;
    const anchor = R.screenToWorld(app.cam, cx, cy);
    app.cam.rot = ((app.cam.rot + drot) % (Math.PI * 2));
    const s = R.worldToScreen({ x: 0, y: 0, zoom: app.cam.zoom, rot: app.cam.rot }, anchor.x, anchor.y);
    app.cam.x = cx - s.x; app.cam.y = cy - s.y;
    invalidate();
  }
  function zoomAt(f, px, py) {
    const before = R.screenToWorld(app.cam, px, py);
    app.cam.zoom = CORE.clamp(app.cam.zoom * f, 0.4, 2.4);
    const after = R.worldToScreen({ x: 0, y: 0, zoom: app.cam.zoom, rot: app.cam.rot }, before.x, before.y);
    app.cam.x = px - after.x; app.cam.y = py - after.y;
    invalidate();
  }

  // ---- input ----------------------------------------------------------------
  const mouse = { x: 0, y: 0, down: false, button: 0, lastX: 0, lastY: 0, dragged: false };
  function updateMouse(e) { const r = canvas.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; }

  canvas = document.getElementById('game');
  ctx = canvas.getContext('2d');
  statusEl = document.getElementById('status');
  hudEl = document.getElementById('hud');

  canvas.addEventListener('pointerdown', (e) => {
    updateMouse(e); mouse.down = true; mouse.button = e.button;
    mouse.lastX = e.clientX; mouse.lastY = e.clientY; mouse.dragged = false;
    if (e.button !== 0) e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    updateMouse(e);
    if (mouse.down) {
      const dx = e.clientX - mouse.lastX, dy = e.clientY - mouse.lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) mouse.dragged = true;
      if (mouse.dragged) {                       // arrastrar = pan (todos los modos)
        app.cam.x += dx; app.cam.y += dy;
        mouse.lastX = e.clientX; mouse.lastY = e.clientY;
        invalidate();
        return;
      }
    }
    app.hover = R.pick(app.cam, nexo(), mouse.x, mouse.y);
    invalidate();
  });
  window.addEventListener('pointerup', (e) => {
    if (!mouse.down) return;
    mouse.down = false;
    if (mouse.dragged) { mouse.dragged = false; return; }
    updateMouse(e);
    handleClick(mouse.x, mouse.y);
  });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, mouse.x, mouse.y); }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (k === 'q') rotateCam(-Math.PI / 12);
    else if (k === 'e') rotateCam(Math.PI / 12);
    else if (k === ' ' && app.mode === 'game') { e.preventDefault(); app.paused = !app.paused; setStatus(app.paused ? 'Pausa' : 'Click: caminar · puerta: abrir · ascensor: viajar'); }
  });
  window.addEventListener('resize', () => { resize(); invalidate(); });

  // ---- clicks por modo ------------------------------------------------------
  function handleClick(px, py) {
    const hit = R.pick(app.cam, nexo(), px, py);
    if (app.mode === 'game') return gameClick(hit);
    if (app.mode === 'dev' && hit) return devClick(hit);
  }
  function gameClick(hit) {
    if (!hit) return;
    const pawn = agents.selected; if (!pawn) return;
    if (hit.object && hit.object.openable) { hit.object.open = !hit.object.open; invalidate(); return; }
    // el PCJ camina en SU sala: resolver el punto contra ella si hay solape
    let room = roomById(hit.roomId), lx = hit.lx, ly = hit.ly;
    if (hit.roomId !== pawn.roomId) {
      const pawnRoom = roomById(pawn.roomId); if (!pawnRoom) return;
      const w = R.screenToWorld(app.cam, mouse.x, mouse.y);
      const loc = R.worldToLocal(pawnRoom, w.x, w.y);
      lx = Math.floor(loc.x); ly = Math.floor(loc.y);
      if (lx < 0 || ly < 0 || lx >= pawnRoom.size.w || ly >= pawnRoom.size.h) return;
      room = pawnRoom;
    }
    if (!agents.order(pawn, room, lx, ly)) setStatus('Sin ruta hasta ahí.');
    invalidate();
  }
  function devClick(hit) {
    const room = roomById(hit.roomId); if (!room) return;
    const tile = room.tiles[hit.ly][hit.lx];
    if (app.tool === 'floor') { if (!tile.wall) tile.floor = app.brush.floor; }
    else if (app.tool === 'wall') { if (tile.floor === 'void') tile.floor = 'deck'; tile.wall = D.createWall(app.brush.wallKind, app.brush.wallOrient); }
    else if (app.tool === 'erase') {
      const i = room.objects.findIndex(o => o.x === hit.lx && o.y === hit.ly);
      if (i >= 0) room.objects.splice(i, 1);
      else if (tile.wall) tile.wall = null;
      else tile.floor = 'void';
    }
    else if (app.tool === 'entry') {
      if (NAV.walkable(room, hit.lx, hit.ly)) { nexo().entry = { roomId: room.id, x: hit.lx, y: hit.ly }; setStatus('Entrada marcada.'); }
    }
    else if (app.tool === 'object') {
      if (NAV.walkable(room, hit.lx, hit.ly) && !room.objects.some(o => o.x === hit.lx && o.y === hit.ly)) {
        room.objects.push(D.createObjectInstance(document.getElementById('objSel').value, hit.lx, hit.ly));
      }
    }
    else if (app.tool === 'link') {
      if (!app.pendingLink) { app.pendingLink = { nexoId: app.nexoId, roomId: room.id, x: hit.lx, y: hit.ly }; setStatus('Link origen marcado. Cambia de nexo y clica el destino.'); }
      else {
        const p = app.pendingLink;
        if (p.nexoId === app.nexoId) { setStatus('El destino debe ser OTRO nexo.'); return; }
        const link = D.createLink(p.nexoId, app.nexoId);
        link.from = { nexoId: p.nexoId, roomId: p.roomId, x: p.x, y: p.y };
        link.to = { nexoId: app.nexoId, roomId: room.id, x: hit.lx, y: hit.ly };
        app.station.links.push(link);
        app.pendingLink = null;
        setStatus('Link (ascensor) creado.');
      }
    }
    invalidate();
  }

  // ---- bucle ---------------------------------------------------------------
  function resize() {
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(canvas.clientWidth * scale);
    canvas.height = Math.floor(canvas.clientHeight * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (app.mode === 'game' && !app.paused) {
      sim.advance(dt, (fdt) => engine.update(nexo(), fdt));
      if (engine.activeCount() > 0 || agents.pawns.some(p => p.moving)) invalidate();
    }
    if (dirty) {
      dirty = false;
      R.clear(ctx, canvas.clientWidth, canvas.clientHeight);
      R.drawNexo(ctx, app.cam, nexo(), {
        entry: nexo().entry,
        linkMarkers: linkMarkers(),
        pawns: agents.pawns.filter(p => p.nexoId === app.nexoId),
        selectedPawnId: agents.selected && agents.selected.id,
        hover: app.mode === 'dev' ? app.hover : null
      });
      hudEl.textContent = app.station.name + ' · ' + nexo().name + '  zoom:' + app.cam.zoom.toFixed(2) + '  rot:' + Math.round((app.cam.rot * 180 / Math.PI + 360) % 360) + '°';
    }
    requestAnimationFrame(frame);
  }

  // ---- chrome (menú / toolbar) ----------------------------------------------
  function bind(id, fn) { document.getElementById(id).addEventListener('click', fn); }
  bind('mDev', () => setMode('dev'));
  bind('mGame', () => setMode('game'));
  bind('tMenu', () => setMode('menu'));
  bind('tPlay', () => setMode(app.mode === 'game' ? 'dev' : 'game'));
  bind('tNexo', () => {
    const n = D.createNexo('Nexo ' + (app.station.nexos.length + 1));
    const r = D.createRoom('Room 1', 10, 8); D.ringWalls(r);
    n.rooms.push(r); n.entry = { roomId: r.id, x: 2, y: 2 };
    app.station.nexos.push(n);
    refreshNexoSel(); app.nexoId = n.id; document.getElementById('nexoSel').value = n.id;
    R.centerOn(app.cam, nexo(), canvas.clientWidth, canvas.clientHeight);
    setStatus(n.name + ' añadido.'); invalidate();
  });
  bind('tExport', () => S.exportToFile(app.station));
  bind('tImport', () => document.getElementById('fileInput').click());
  document.getElementById('fileInput').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      app.station = S.deserialize(await f.text());
      app.nexoId = app.station.startNexoId;
      refreshNexoSel();
      R.centerOn(app.cam, nexo(), canvas.clientWidth, canvas.clientHeight);
      setStatus('Estación importada.'); invalidate();
    } catch (err) { setStatus('Error al importar: ' + err.message); }
    e.target.value = '';
  });
  document.getElementById('nexoSel').addEventListener('change', (e) => {
    app.nexoId = e.target.value;
    app.pendingLink = null;
    R.centerOn(app.cam, nexo(), canvas.clientWidth, canvas.clientHeight);
    invalidate();
  });
  function refreshNexoSel() {
    const sel = document.getElementById('nexoSel'); sel.innerHTML = '';
    for (const n of app.station.nexos) {
      const o = document.createElement('option'); o.value = n.id; o.textContent = n.name;
      if (n.id === app.nexoId) o.selected = true; sel.appendChild(o);
    }
  }
  document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => {
    app.tool = b.dataset.tool;
    document.querySelectorAll('[data-tool]').forEach(x => x.classList.toggle('active', x === b));
    invalidate();
  }));
  document.getElementById('floorSel').addEventListener('change', (e) => { app.brush.floor = e.target.value; });
  document.getElementById('wallSel').addEventListener('change', (e) => { app.brush.wallKind = e.target.value; });

  // ---- boot ------------------------------------------------------------------
  resize();
  refreshNexoSel();
  R.centerOn(app.cam, nexo(), canvas.clientWidth, canvas.clientHeight);
  setMode('menu');
  requestAnimationFrame(frame);

  // hook de depuración/tests
  window.UGS.app = app;
  window.UGS._engine = engine;
  window.UGS._agents = agents;
})();
