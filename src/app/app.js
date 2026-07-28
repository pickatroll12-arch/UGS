/*
 * UGS — app/app  (REVAMP · base nueva)
 * ==================================================================
 * El pegamento: shell (menú → Dev/Juego), cámara RTS y bucle principal.
 * Vive ENTRE la lógica y el renderizador: orquesta, pero las reglas del
 * juego están en engine/ y los píxeles en render/ (ver PROMPT_MAESTRO.md §2).
 *
 * Cámara (contrato C4): vista ¾ ORTOGONAL tipo Xenonauts.
 *   Q/E ............ rotar la vista en pasos de 90° (el mundo gira bajo la cámara)
 *   rueda .......... zoom anclado al cursor
 *   arrastrar ...... pan (botón izquierdo en vacío / medio / derecho)
 *
 * SUITE DEV (v2): dos secciones — DISEÑAR NEXO (3 slots, 1 por fase,
 * conectores centrales) y DISEÑAR MÓDULOS (biblioteca de blueprints con
 * metadatos CRED/TW/provides + editor de sala). Herramientas compartidas:
 * suelo por rectángulo, pared por contorno, borrado por rectángulo, bote
 * de relleno, objetos, auto-bordes, vaciar, deshacer/rehacer (Ctrl+Z/Y).
 * Las ops de edición viven en engine/blueprint.js (lógica, Node-testeable).
 *
 * Modos: MENU → DEV (suite de diseño) o JUEGO (click→ruta del PCJ, puertas,
 * ascensores). En JUEGO no aparece vocabulario de desarrollo.
 */
(function () {
  'use strict';
  const CORE = window.UGS.core;
  const D = window.UGS.data;
  const S = window.UGS.save;
  let R = window.UGS.render;
  const NAV = window.UGS.nav;
  const BP = window.UGS.blueprint;
  const TB = window.UGS.toolbox;

  const engine = window.UGS.engine.create();
  const agents = window.UGS.agents.create(engine);
  agents.install();
  // capa estratégica (OBJP-1 upgrade): RNG sembrado desde el save + runtime
  // de estación. Hoy corre invisible (sin UI de economía — eso es OBJP-1.1);
  // sus eventos solo se anuncian en la barra de estado.
  const rng = window.UGS.rng.create('ugs-station');
  const station = window.UGS.station.create({ bus: engine.bus, rng });
  engine.bus.on('station:event', ({ id }) => setStatus('Evento de estación: ' + id));
  engine.bus.on('station:phase', ({ phase }) => setStatus('¡Fase ' + phase + ' alcanzada!'));
  engine.bus.on('station:expedition:done', ({ delivered }) => { setStatus('Expedición de vuelta: ' + JSON.stringify(delivered)); syncShipObjects(); invalidate(); });
  engine.bus.on('station:expedition:failed', () => setStatus('Una nave minera ha fallado.'));
  engine.bus.on('station:expedition:launch', () => { syncShipObjects(); invalidate(); });
  engine.bus.on('station:ship:repaired', () => { syncShipObjects(); invalidate(); });
  // CONTENIDO F1 (OBJP-1.1 · K3+K4, relevados del Rector): árbol de hitos,
  // módulos y ruta minera. Son DATOS — el runtime ya existe en station.js.
  const F1 = window.UGS.contentF1;
  if (F1) F1.register(station);
  // El runtime no reparte CRED/UD por hito: lo hace el contenido (applyRewards).
  engine.bus.on('station:hito', ({ hitoId }) => {
    if (!F1) return;
    const def = F1.hitoById(hitoId);
    const given = F1.applyRewards(station, app.station, hitoId);
    const extra = [];
    if (given.cred) extra.push('+' + given.cred + ' CRED');
    for (const [it, n] of Object.entries(given.items)) extra.push('+' + n + ' UD de ' + it);
    setStatus('Hito desbloqueado: ' + ((def && def.name) || hitoId) + (extra.length ? ' · ' + extra.join(' · ') : ''));
  });
  engine.bus.on('station:blackout', ({ blackout }) => {
    const e = app.station.state.energy;
    setStatus(blackout ? '⚠ BROWNOUT: el consumo (' + e.used + ' TW) supera la capacidad (' + e.capacity + ' TW)' : 'Energía restablecida.');
  });

  const app = {
    mode: 'menu',                    // menu | dev | game
    station: D.createStation('Untitled Station'),
    nexoId: null,
    devSection: 'nexo',              // dev: nexo | modules
    bpId: null,                      // blueprint activo (sección módulos)
    tool: 'select',                  // id del catálogo de tools/toolbox.js (arranca inocuo)
    brush: { floor: 'deck', wallKind: 'block', wallOrient: 0 },
    selection: null,                 // herramienta Seleccionar: {roomId, x, y, objId}
    toolHover: null,                 // rombo bajo el puntero (barra inferior)
    toolLayout: null,                // último layout de la barra (hit-test sin recalcular)
    cam: { x: 0, y: 0, zoom: 1, rot: Math.PI / 4 },   // C4: yaw base 45° (diamante)
    hover: null,
    drag: null,                      // gesto rect activo {tool, roomId, x0,y0,x1,y1}
    pendingLink: null,
    showConn: false,
    placing: null,                   // colocación de módulo activa {bpId} (sección Nexo)
    mouseWorld: null,                // última posición del ratón en coords de mundo
    paused: false,
    undoStack: [], redoStack: [], editKey: null, editRoomRef: null
  };
  app.nexoId = app.station.startNexoId;

  const nexo = () => app.station.nexos.find(n => n.id === app.nexoId) || app.station.nexos[0];
  const roomById = (id) => nexo().rooms.find(r => r.id === id) || null;
  const activeBp = () => app.station.moduleLibrary.find(b => b.id === app.bpId) || null;
  // lo que muestra el canvas: en dev/módulos, el blueprint activo envuelto como Nexo
  const viewNexo = () => {
    if (app.mode === 'dev' && app.devSection === 'modules') {
      const bp = activeBp();
      if (bp) return { id: '__bp__', name: bp.name + ' (módulo)', rooms: [bp.room], entry: null, links: [] };
    }
    return nexo();
  };

  let canvas, ctx, statusEl, hudEl, fxCanvas = null;
  const sim = new CORE.FixedTimestep(30, 6);
  let dirty = true;
  const invalidate = () => { dirty = true; };
  const setStatus = (m) => { if (statusEl) statusEl.textContent = m; };
  const $ = (id) => document.getElementById(id);

  // ---- música idle (cama ambiente de la cubierta) ---------------------------
  // El director (audio/music.js) decide qué suena y con qué ganancia; el driver
  // (audio/player.js) lo ejecuta sobre dos <audio>. Aquí solo se cablean las
  // preferencias del usuario y el pulso del bucle. Semilla propia: la música NO
  // debe consumir el RNG de la partida (eso rompería el determinismo del save).
  const MUSIC_PREFS_KEY = 'ugs.music';
  const music = window.UGS.music.create({ rng: window.UGS.rng.create('ugs-music'), volume: 0.6 });
  const player = window.UGS.audioPlayer.create({ music });
  let musicVol = 0.6, musicMuted = false;

  function loadMusicPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(MUSIC_PREFS_KEY) || '{}');
      if (typeof p.volume === 'number') musicVol = CORE.clamp(p.volume, 0, 1);
      musicMuted = !!p.muted;
    } catch (_) { /* almacenamiento no disponible: se usan los valores por defecto */ }
  }
  function saveMusicPrefs() {
    try { localStorage.setItem(MUSIC_PREFS_KEY, JSON.stringify({ volume: musicVol, muted: musicMuted })); }
    catch (_) { /* idem */ }
  }
  function applyMusicPrefs() {
    const silent = musicMuted || musicVol === 0;
    player.setVolume(silent ? 0 : musicVol);
    const btn = $('muBtn');
    btn.textContent = silent ? '🔇' : '🔊';
    btn.classList.toggle('off', silent);
    $('muVol').value = String(Math.round(musicVol * 100));
  }

  // ---- iconos del kit UX por categoría de módulo (dirección de arte §6.7) ----
  // variantes: neutral / ok (barra verde) / warn (barra naranja)
  const BP_ICONS = {
    general:   { base: 'IconD03', ok: 'IconD08', warn: 'IconD13' },   // O2 (utilidad)
    energia:   { base: 'IconD05', ok: 'IconD11', warn: 'IconD10' },   // rayo
    almacen:   { base: 'IconD01', ok: 'IconD06', warn: 'IconD15' },   // grano/suministros
    habitat:   { base: 'IconD04', ok: 'IconD09', warn: 'IconD12' },   // cubierto (vida a bordo)
    industria: { base: 'IconD02', ok: 'IconD07', warn: 'IconD14' }    // laboratorio/procesado
  };
  // estado del diseño: warn si no tiene suelo abierto (claramente sin terminar)
  function bpState(bp) {
    for (const row of bp.room.tiles) for (const t of row) if (!t.wall && t.floor !== 'void') return 'ok';
    return 'warn';
  }
  function bpIconUrl(bp) {
    const set = BP_ICONS[bp.category] || BP_ICONS.general;
    return '!_UGS/ux/Elements/' + (bpState(bp) === 'ok' ? set.ok : set.warn) + '.png';
  }

  // ---- deshacer / rehacer (snapshots de engine/blueprint) ----------------------
  function resetEdit() { app.undoStack = []; app.redoStack = []; app.editKey = null; app.editRoomRef = null; }
  function ensureEditKey(room) {
    const key = app.devSection + ':' + (app.devSection === 'modules' ? app.bpId : app.nexoId) + ':' + room.id;
    if (key !== app.editKey) { app.editKey = key; app.editRoomRef = room; app.undoStack = []; app.redoStack = []; }
  }
  function pushUndo(room) {
    ensureEditKey(room);
    app.undoStack.push(BP.snapshotRoom(room));
    if (app.undoStack.length > 50) app.undoStack.shift();
    app.redoStack = [];
  }
  function doUndo() {
    if (!app.undoStack.length || !app.editRoomRef) return setStatus('Nada que deshacer.');
    const room = app.editRoomRef;
    app.redoStack.push(BP.snapshotRoom(room));
    BP.restoreRoom(room, app.undoStack.pop());
    invalidate(); refreshBpForm(); setStatus('Deshecho.');
  }
  function doRedo() {
    if (!app.redoStack.length || !app.editRoomRef) return setStatus('Nada que rehacer.');
    const room = app.editRoomRef;
    app.undoStack.push(BP.snapshotRoom(room));
    BP.restoreRoom(room, app.redoStack.pop());
    invalidate(); refreshBpForm(); setStatus('Rehecho.');
  }

  // ---- modos ---------------------------------------------------------------
  function setMode(mode) {
    app.mode = mode;
    document.body.dataset.mode = mode;
    if (mode === 'game') {
      engine.start(nexo());
      spawnAtEntry();
      app.paused = false;
      setStatus('Click: caminar · puerta: abrir · ascensor: viajar · Q/E rotar 90°');
    } else {
      engine.stop();
      agents.clear();
      app.placing = null; syncPlacing();
      if (mode === 'dev') setStatus('Suite Dev: elige sección (Nexo/Módulos) y diseña. Arrastra para pintar rectángulos.');
    }
    syncChrome();
    invalidate();
  }
  function syncChrome() {
    $('devpanel').style.display = app.mode === 'dev' ? 'flex' : 'none';
    $('menu').style.display = app.mode === 'menu' ? 'flex' : 'none';
    $('topbar').style.display = app.mode === 'menu' ? 'none' : 'flex';
    $('tPlay').textContent = app.mode === 'game' ? '🛠 Dev' : '▶ Jugar';
  }

  function spawnAtEntry() {
    agents.clear();
    const n = nexo();
    const e = n.entry || { roomId: n.rooms[0].id, x: 1, y: 1 };
    agents.spawn(n.id, e.roomId, e.x, e.y);
  }

  // ---- sección dev: DISEÑAR NEXO / DISEÑAR MÓDULOS -----------------------------
  function setDevSection(sec) {
    if (app.devSection === sec) return;
    app.devSection = sec;
    app.hover = null; app.drag = null; app.pendingLink = null;
    app.placing = null; syncPlacing();
    app.selection = null; app.toolHover = null;
    // si la herramienta activa no existe en la sección nueva, vuelve a Seleccionar
    if (!TB.isAvailable(TB.byId(app.tool), { section: sec })) app.tool = 'select';
    resetEdit();
    $('secBtnNexo').classList.toggle('active', sec === 'nexo');
    $('secBtnModules').classList.toggle('active', sec === 'modules');
    $('secNexo').style.display = sec === 'nexo' ? 'block' : 'none';
    $('secModules').style.display = sec === 'modules' ? 'block' : 'none';
    if (sec === 'modules') {
      if (activeBp()) R.centerOn(app.cam, viewNexo(), canvas.clientWidth, canvas.clientHeight);
      setStatus('Módulos: biblioteca de blueprints. Crea uno o selecciona para editar.');
    } else {
      R.centerOn(app.cam, nexo(), canvas.clientWidth, canvas.clientHeight);
      setStatus('Nexos: 3 slots (1 por fase), conectores centrales de la estación.');
    }
    refreshSlots(); refreshBpList();
    invalidate();
  }

  // ---- slots de Nexo (3, uno por fase) ------------------------------------------
  function refreshSlots() {
    const el = $('nexoSlots'); el.innerHTML = '';
    const phase = app.station.state.phase;
    for (let i = 0; i < D.NEXO_SLOTS; i++) {
      const n = app.station.nexos[i];
      const card = document.createElement('div');
      if (n) {
        const unlocked = phase >= i + 1;
        card.className = 'card' + (unlocked ? '' : ' locked') + (n.id === app.nexoId && app.devSection === 'nexo' ? ' sel' : '');
        card.innerHTML = '<div class="t">' + n.name + ' · FASE ' + (i + 1) + '</div>' +
          '<div class="s">' + n.rooms.length + ' sala(s) · ' + (unlocked ? 'desbloqueado en partida' : 'se desbloquea en Fase ' + (i + 1)) + '</div>';
        card.addEventListener('click', () => {
          // NO limpiar pendingLink: el origen del link debe sobrevivir al cambio
          // de nexo (el flujo es: marca origen → cambia de nexo → clica destino)
          app.nexoId = n.id; app.hover = null; resetEdit();
          R.centerOn(app.cam, nexo(), canvas.clientWidth, canvas.clientHeight);
          refreshSlots(); invalidate();
        });
      } else if (i === app.station.nexos.length) {
        card.className = 'card empty';
        card.textContent = '+ Crear Nexo ' + (i + 1) + ' (Fase ' + (i + 1) + ')';
        card.addEventListener('click', () => createNexoSlot(i));
      } else {
        card.className = 'card empty';
        card.style.opacity = '.45';
        card.textContent = 'Nexo ' + (i + 1) + ' · crea antes el Nexo ' + i;
      }
      el.appendChild(card);
    }
  }
  function createNexoSlot(i) {
    if (app.station.nexos.length >= D.NEXO_SLOTS) return setStatus('Máximo ' + D.NEXO_SLOTS + ' Nexos (1 por fase).');
    const n = D.createNexo('Nexo ' + (i + 1));
    const hub = D.createRoom('Hub central', 10, 8); D.ringWalls(hub);
    n.rooms.push(hub); n.entry = { roomId: hub.id, x: 2, y: 2 };
    app.station.nexos.push(n);
    app.nexoId = n.id; resetEdit();
    R.centerOn(app.cam, n, canvas.clientWidth, canvas.clientHeight);
    refreshSlots(); invalidate();
    setStatus(n.name + ' creado (slot Fase ' + (i + 1) + ').');
  }

  // ---- biblioteca de módulos ------------------------------------------------------
  function refreshBpList() {
    const el = $('bpList'); el.innerHTML = '';
    const lib = app.station.moduleLibrary;
    if (!lib.length) {
      const c = document.createElement('div');
      c.className = 'card empty'; c.textContent = 'Biblioteca vacía: crea tu primer módulo.';
      el.appendChild(c);
    }
    for (const bp of lib) {
      const card = document.createElement('div');
      card.className = 'card' + (bp.id === app.bpId ? ' sel' : '');
      card.innerHTML = '<div class="in"><img class="bpicon" src="' + bpIconUrl(bp) + '" alt=""><div>' +
        '<div class="t">' + bp.name + '</div>' +
        '<div class="s">' + bp.room.size.w + '×' + bp.room.size.h + ' · ' + bp.cost + ' CRED · ' + bp.energyUse + ' TW · ' + bp.category + '</div>' +
        '</div></div>';
      card.addEventListener('click', () => selectBp(bp.id));
      el.appendChild(card);
    }
    $('bpForm').style.display = activeBp() ? 'block' : 'none';
    refreshBpForm();
    refreshPlaceSel();
  }
  // selector de módulo a colocar (sección Nexo → COLOCAR MÓDULO)
  function refreshPlaceSel() {
    const sel = $('placeSel'); if (!sel) return;
    const lib = app.station.moduleLibrary;
    const prev = sel.value;
    sel.innerHTML = '';
    for (const bp of lib) {
      const o = document.createElement('option');
      o.value = bp.id;
      o.textContent = bp.name + ' (' + bp.room.size.w + '×' + bp.room.size.h + ')';
      sel.appendChild(o);
    }
    if (lib.some(b => b.id === prev)) sel.value = prev;
    $('placeToggle').disabled = !lib.length;
    if (app.placing && !lib.some(b => b.id === app.placing.bpId)) { app.placing = null; syncPlacing(); }
  }
  function syncPlacing() {
    const b = $('placeToggle'); if (!b) return;
    b.classList.toggle('active', !!app.placing);
    b.textContent = app.placing ? '▣ Colocación activa (ESC sale)' : '▣ Activar colocación';
  }
  function refreshBpForm() {
    const bp = activeBp(); if (!bp) return;
    if (document.activeElement && /^(bpName|bpCat|bpCost|bpEnergyUse|bpProvEnergy|bpProvStorage|bpProvPnj|bpW|bpH)$/.test(document.activeElement.id)) return; // no pisar mientras se escribe
    $('bpName').value = bp.name;
    $('bpCat').value = bp.category;
    $('bpCost').value = bp.cost;
    $('bpEnergyUse').value = bp.energyUse;
    $('bpProvEnergy').value = bp.provides.energy;
    $('bpProvStorage').value = bp.provides.storage;
    $('bpProvPnj').value = bp.provides.pnjCapacity;
    $('bpW').value = bp.room.size.w;
    $('bpH').value = bp.room.size.h;
    $('bpFormIcon').src = bpIconUrl(bp);
  }
  function selectBp(id) {
    app.bpId = id; resetEdit();
    if (app.devSection === 'modules' && activeBp()) R.centerOn(app.cam, viewNexo(), canvas.clientWidth, canvas.clientHeight);
    refreshBpList(); invalidate();
  }
  function downloadJson(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
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
    // origen pendiente: visible como ▣ mientras se completa el link
    if (app.pendingLink && app.pendingLink.nexoId === app.nexoId)
      out.push({ roomId: app.pendingLink.roomId, x: app.pendingLink.x, y: app.pendingLink.y });
    return out;
  }

  // ---- hangar: placeholders de nave ↔ station.ships (K2 · OBJP-1.1) ------------
  // Una nave amarrada (idle/damaged) tiene un objeto 'ship' en su sala de hangar;
  // al zarpar desaparece (fuera de pantalla) y al volver reaparece.
  function hangarRooms() {
    const out = [];
    for (const n of app.station.nexos) for (const r of n.rooms) if (r.hangar || typeof r.shipCap === 'number') out.push(r);
    return out;
  }
  /*
   * Expedición minera (K3): manda la primera nave libre a la veta. La salida y
   * el retorno los gestiona el runtime; los placeholders del hangar se
   * sincronizan solos por los eventos (K2 del Rector).
   */
  function launchMining() {
    if (!F1) return;
    const s = app.station.state;
    if (!s.abilities.includes('expedicion_minera')) return setStatus('Aún no tienes la habilidad de expedición minera (hito Hangar).');
    const ship = s.ships.find(sh => sh.state === 'idle');
    if (!ship) {
      const out = s.ships.filter(sh => sh.state === 'out').length;
      const bad = s.ships.filter(sh => sh.state === 'damaged').length;
      if (!s.ships.length) return setStatus('No hay naves amarradas en el hangar.');
      return setStatus(out ? 'Todas las naves están fuera (' + out + ' en ruta).' : bad + ' nave(s) dañada(s): hay que repararlas.');
    }
    const route = F1.routeById('veta_k7');
    const r = station.launchExpedition(app.station, 'veta_k7', ship.id);
    if (!r.ok) return setStatus('No se pudo expedir: ' + r.reason + '.');
    setStatus('Nave en ruta a ' + route.name + ' — ' + route.stages.length + ' etapas de sondeo.');
  }
  /* resumen de expediciones para el HUD (solo en juego) */
  function expeditionHud() {
    const s = app.station.state;
    if (!F1 || !s.ships.length) return '';
    const out = s.ships.filter(sh => sh.state === 'out');
    if (out.length) {
      const sh = out[0];
      const route = F1.routeById(sh.routeId);
      const total = route ? route.stages.length : 5;
      return '  ⛏' + (route ? route.name : sh.routeId) + ' etapa ' + Math.min(sh.stage + 1, total) + '/' + total +
        (out.length > 1 ? ' (+' + (out.length - 1) + ')' : '');
    }
    const bad = s.ships.filter(sh => sh.state === 'damaged').length;
    if (bad) return '  ⛏' + bad + ' nave(s) dañada(s)';
    return '  ⛏X: expedir nave';
  }

  function syncShipObjects() {
    const docked = app.station.state.ships.filter(sh => sh.state !== 'out');
    const rooms = hangarRooms();
    for (const r of rooms) r.objects = r.objects.filter(o => o.type !== 'ship' || docked.some(sh => sh.id === o.shipId));
    for (const sh of docked) {
      const room = rooms.find(r => r.id === sh.hangarRoomId) || rooms[0];
      if (!room) continue;
      if (room.objects.some(o => o.type === 'ship' && o.shipId === sh.id)) continue;
      for (let y = 0; y < room.size.h; y++) {
        let put = false;
        for (let x = 0; x < room.size.w; x++) {
          if (NAV.walkable(room, x, y) && !room.objects.some(o => o.x === x && o.y === y)) {
            const obj = D.createObjectInstance('ship', x, y);
            obj.shipId = sh.id;
            room.objects.push(obj);
            put = true;
            break;
          }
        }
        if (put) break;
      }
    }
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

  canvas = $('game');
  // Renderer 3D (three.js) por defecto — decisión humana (AGENTIC_REVIEW §6.14).
  // ?renderer=2d fuerza el clásico; si no hay CDN/WebGL, cae a 2D solo.
  const want3D = (new URLSearchParams(location.search).get('renderer') || '3d') !== '2d';
  if (want3D && window.UGS.render3d && UGS.render3d.available() && UGS.render3d.init(canvas, () => invalidate())) {
    R = UGS.render3d;
    fxCanvas = document.createElement('canvas');
    fxCanvas.id = 'gamefx';
    canvas.parentNode.insertBefore(fxCanvas, canvas.nextSibling);
    ctx = fxCanvas.getContext('2d');          // overlays 2D (frontera/ghost) sobre el WebGL
  } else {
    ctx = canvas.getContext('2d');
  }
  statusEl = $('status');
  hudEl = $('hud');

  canvas.addEventListener('pointerdown', (e) => {
    updateMouse(e); mouse.down = true; mouse.button = e.button;
    mouse.lastX = e.clientX; mouse.lastY = e.clientY; mouse.dragged = false;
    if (e.button !== 0) e.preventDefault();
    // la barra de herramientas se come el click: nunca se pinta el mapa por debajo
    if (app.mode === 'dev' && app.toolLayout && TB.inBar(app.toolLayout, mouse.x, mouse.y)) {
      app.drag = null;
      if (e.button === 0) {
        const slot = TB.hitTest(app.toolLayout, mouse.x, mouse.y);
        if (slot && slot.locked) setStatus(slot.tool.name + ' — ' + slot.tool.hint);
        else if (slot) setTool(slot.id);
      }
      return;
    }
    // colocación de módulo activa: el click lo gestiona handleClick/drawPlacementGhost
    if (app.placing && app.mode === 'dev') { app.drag = null; return; }
    // dev: botón izquierdo sobre una sala con herramienta = gesto de edición
    if (app.mode === 'dev' && e.button === 0) {
      const hit = R.pick(app.cam, viewNexo(), mouse.x, mouse.y);
      if (hit) { app.drag = { tool: app.tool, roomId: hit.roomId, x0: hit.lx, y0: hit.ly, x1: hit.lx, y1: hit.ly }; return; }
    }
    app.drag = null;
  });
  canvas.addEventListener('pointermove', (e) => {
    updateMouse(e);
    app.mouseWorld = R.screenToWorld(app.cam, mouse.x, mouse.y);
    // sobre la barra: resaltar el rombo y NO hacer hover en el mapa
    if (app.mode === 'dev' && app.toolLayout && !mouse.down) {
      const over = TB.inBar(app.toolLayout, mouse.x, mouse.y);
      const slot = over ? TB.hitTest(app.toolLayout, mouse.x, mouse.y) : null;
      const id = slot ? slot.id : null;
      if (id !== app.toolHover) { app.toolHover = id; invalidate(); }
      if (over) { if (app.hover) { app.hover = null; invalidate(); } return; }
    }
    if (app.placing) { invalidate(); }
    if (mouse.down && app.drag) {                       // gesto de edición activo
      const hit = R.pick(app.cam, viewNexo(), mouse.x, mouse.y);
      if (hit && hit.roomId === app.drag.roomId) { app.drag.x1 = hit.lx; app.drag.y1 = hit.ly; }
      app.hover = hit; invalidate();
      return;
    }
    if (mouse.down) {
      const dx = e.clientX - mouse.lastX, dy = e.clientY - mouse.lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) mouse.dragged = true;
      if (mouse.dragged) {                              // pan (vacío / medio / derecho)
        app.cam.x += dx; app.cam.y += dy;
        mouse.lastX = e.clientX; mouse.lastY = e.clientY;
        invalidate();
        return;
      }
    }
    app.hover = R.pick(app.cam, viewNexo(), mouse.x, mouse.y);
    invalidate();
  });
  window.addEventListener('pointerup', (e) => {
    if (!mouse.down) return;
    mouse.down = false;
    updateMouse(e);
    if (app.drag) { const g = app.drag; app.drag = null; applyGesture(g); invalidate(); return; }
    if (mouse.dragged) { mouse.dragged = false; return; }
    // colocación activa: click derecho retira un módulo colocado (nunca salas del nexo)
    if (app.placing && e.button === 2 && app.mode === 'dev') {
      const hit = R.pick(app.cam, nexo(), mouse.x, mouse.y);
      if (hit) {
        const room = roomById(hit.roomId);
        if (room && room.bpId) {
          nexo().rooms = nexo().rooms.filter(r => r !== room);
          // limpieza estratégica: la instancia sale de station.modules y se recomputa energía
          app.station.state.modules = app.station.state.modules.filter(m => m.roomId !== room.id);
          station.recompute(app.station);
          setStatus('Módulo retirado del nexo.'); invalidate();
        } else setStatus('Solo se retiran salas colocadas desde la biblioteca.');
      }
      return;
    }
    handleClick(mouse.x, mouse.y);
  });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, mouse.x, mouse.y); }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if ((e.ctrlKey || e.metaKey) && k === 'z' && app.mode === 'dev') { e.preventDefault(); return e.shiftKey ? doRedo() : doUndo(); }
    if ((e.ctrlKey || e.metaKey) && k === 'y' && app.mode === 'dev') { e.preventDefault(); return doRedo(); }
    // teclas 1..9,0 = herramientas (la tecla es fija por herramienta)
    if (app.mode === 'dev' && !e.ctrlKey && !e.metaKey && !e.altKey && TB.byKey(e.key)) {
      e.preventDefault(); setTool(TB.byKey(e.key).id); return;
    }
    // Supr retira el objeto seleccionado con la herramienta Seleccionar
    if (app.mode === 'dev' && app.tool === 'select' && (k === 'delete' || k === 'backspace')) {
      e.preventDefault();
      const s = app.selection;
      const room = s && viewNexo().rooms.find(r => r.id === s.roomId);
      const obj = room && room.objects.find(o => o.x === s.x && o.y === s.y);
      if (!obj) return setStatus('No hay objeto seleccionado.');
      pushUndo(room);
      room.objects = room.objects.filter(o => o !== obj);
      setStatus('Objeto retirado (' + obj.type + ').');
      invalidate();
      return;
    }
    else if (k === 'b' && app.mode === 'dev') {
      // ciclar el tipo de pared del pincel (incluye 'bay', la muralla de hangar)
      const kinds = D.WALL_KINDS;
      const i = (kinds.indexOf(app.brush.wallKind) + 1) % kinds.length;
      app.brush.wallKind = kinds[i];
      setStatus('Pared: ' + kinds[i] + (kinds[i] === 'bay' ? ' (muralla de hangar: apertura para naves)' : ''));
    }
    else if ((k === '[' || k === ']') && app.mode === 'dev') {
      // capacidad de hangar seteable sobre la sala seleccionada/actual
      const room = (app.selection && viewNexo().rooms.find(r => r.id === app.selection.roomId)) || currentEditRoom();
      if (!room) return;
      const cur = typeof room.shipCap === 'number' ? room.shipCap : 0;
      const next = Math.max(0, cur + (k === ']' ? 1 : -1));
      if (next === 0) { delete room.shipCap; delete room.hangar; setStatus(room.name + ' ya no es hangar.'); }
      else { room.shipCap = next; room.hangar = true; setStatus(room.name + ': hangar con capacidad de ' + next + ' nave(s).'); }
      syncShipObjects(); invalidate();
    }
    else if (k === 'n' && app.mode !== 'menu') {
      const sh = station.addShip(app.station, { capacity: 5 }, app.station.nexos);
      if (!sh) { setStatus('Sin amarre libre: marca capacidad de hangar en una sala con [ ].'); return; }
      syncShipObjects(); invalidate();
      setStatus('Nave amarrada (' + app.station.state.ships.length + '/' + station.shipCapacity(app.station, app.station.nexos) + ' amarres).');
    }
    else if (k === 'q') rotateCam(-Math.PI / 2);            // C4: yaw en pasos de 90°
    else if (k === 'e') rotateCam(Math.PI / 2);
    else if (k === 'escape') {
      if (app.placing) { app.placing = null; app.tool = 'select'; syncPlacing(); setStatus('Colocación cancelada.'); invalidate(); }
      app.pendingLink = null;
    }
    // X = expedir nave a la veta (K3). En juego, con una nave amarrada e idle.
    else if (k === 'x' && app.mode === 'game') { e.preventDefault(); launchMining(); }
    else if (k === ' ' && app.mode === 'game') { e.preventDefault(); app.paused = !app.paused; setStatus(app.paused ? 'Pausa' : 'Click: caminar · puerta: abrir · ascensor: viajar · X expedir nave · Q/E rotar 90°'); }
  });
  window.addEventListener('resize', () => { resize(); invalidate(); });

  // ---- barra de herramientas (rombos, abajo) ---------------------------------
  // El catálogo, las teclas y la geometría viven en tools/toolbox.js; aquí solo
  // se conecta con el estado de la app. `app.tool` sigue siendo la única fuente
  // de verdad de qué herramienta está activa.
  function setTool(id, silent) {
    const t = TB.byId(id);
    if (!t) return false;
    if (!TB.isAvailable(t, { section: app.devSection })) {
      setStatus(t.name + ': solo en la sección DISEÑAR NEXO.');
      return false;
    }
    // salir de la colocación con ghost al cambiar a otra herramienta
    if (app.placing && id !== 'module') { app.placing = null; syncPlacing(); }
    app.tool = id;
    if (id === 'module') startPlacing();
    if (!silent) setStatus(t.name + ' [' + t.key + '] · ' + t.hint);
    invalidate();
    return true;
  }
  function startPlacing() {
    if (app.placing) return;
    const sel = $('placeSel');
    const bpId = sel && sel.value;
    if (!bpId) return setStatus('No hay módulos en la biblioteca: crea uno en DISEÑAR MÓDULOS.');
    app.placing = { bpId };
    syncPlacing();
  }
  function drawToolbar() {
    if (app.mode !== 'dev') { app.toolLayout = null; return; }
    const panel = $('devpanel');
    app.toolLayout = TB.draw(ctx, canvas.clientWidth, canvas.clientHeight, {
      active: app.tool,
      hoverId: app.toolHover,
      section: app.devSection,
      left: panel ? panel.offsetWidth : 0     // centrar en el área libre, no bajo el panel
    });
  }
  // marcador de la herramienta Seleccionar (mismo camino que drawConnOverlay:
  // matemática de render.js, así vale igual en el renderer 2D y en el 3D)
  function drawSelection() {
    const s = app.selection;
    if (!s || app.mode !== 'dev' || app.tool !== 'select') return;
    const room = viewNexo().rooms.find(r => r.id === s.roomId);
    if (!room) return;
    const pts = [[s.x, s.y], [s.x + 1, s.y], [s.x + 1, s.y + 1], [s.x, s.y + 1]].map(([lx, ly]) => {
      const w = R.localToWorld(room, lx, ly);
      return R.worldToScreen(app.cam, w.x, w.y, 0.03);
    });
    ctx.save();
    ctx.strokeStyle = '#62e0ef'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath(); ctx.stroke();
    ctx.restore();
  }
  function describeSelection(room, x, y) {
    const tile = room.tiles[y] && room.tiles[y][x];
    if (!tile) return 'Fuera de la sala.';
    const obj = room.objects.find(o => o.x === x && o.y === y);
    const parts = [room.name + ' (' + x + ',' + y + ')', 'suelo: ' + tile.floor];
    if (tile.wall) parts.push('pared: ' + tile.wall.kind);
    if (obj) parts.push('objeto: ' + obj.type + ' — Supr lo retira');
    return parts.join(' · ');
  }

  // ---- gestos de edición (suite dev) -------------------------------------------
  const RECT_TOOLS = ['floor', 'wall', 'erase'];
  function applyGesture(g) {
    const view = viewNexo();
    const room = view.rooms.find(r => r.id === g.roomId);
    if (!room) return;
    const x1 = g.x1 == null ? g.x0 : g.x1, y1 = g.y1 == null ? g.y0 : g.y1;
    if (RECT_TOOLS.includes(g.tool)) {
      pushUndo(room);
      let n = 0;
      if (g.tool === 'floor') n = BP.paintFloorRect(room, g.x0, g.y0, x1, y1, app.brush.floor);
      else if (g.tool === 'wall') n = BP.paintWallOutline(room, g.x0, g.y0, x1, y1, app.brush.wallKind, app.brush.wallOrient);
      else n = BP.eraseRect(room, g.x0, g.y0, x1, y1);
      setStatus(n ? 'Editado (' + n + ' tiles).' : 'Sin cambios.');
    } else if (g.tool === 'fill') {
      pushUndo(room);
      const n = BP.floodFillFloor(room, g.x0, g.y0, app.brush.floor);
      setStatus(n ? 'Relleno (' + n + ' tiles).' : 'Sin cambios.');
    } else if (g.tool === 'object' || g.tool === 'console') {
      // 'console' es un atajo de 'object' fijado al tipo consola: es la pieza
      // que se está construyendo ahora (sprite v3 + módulo screens).
      // 'console' es herramienta dedicada (tecla 7) y NO está en el catálogo;
      // 'object' (tecla 6) usa el sub-selector poblado desde core/objects_lib.
      const type = g.tool === 'console' ? 'console' : $('objSel').value;
      if (!NAV.walkable(room, g.x0, g.y0) || room.objects.some(o => o.x === g.x0 && o.y === g.y0)) return setStatus('Ahí no cabe el objeto.');
      pushUndo(room);
      room.objects.push(D.createObjectInstance(type, g.x0, g.y0));
      setStatus(g.tool === 'console' ? 'Consola colocada.' : 'Objeto colocado.');
    } else if (g.tool === 'select') {
      app.selection = { roomId: room.id, x: g.x0, y: g.y0 };
      setStatus(describeSelection(room, g.x0, g.y0));
    } else if (g.tool === 'entry') {
      if (app.devSection !== 'nexo') return setStatus('La entrada se marca en la sección Nexo.');
      if (NAV.walkable(room, g.x0, g.y0)) { nexo().entry = { roomId: room.id, x: g.x0, y: g.y0 }; setStatus('Entrada marcada.'); }
    } else if (g.tool === 'link') {
      if (app.devSection !== 'nexo') return setStatus('Los links se crean en la sección Nexo.');
      if (!app.pendingLink) {
        app.pendingLink = { nexoId: app.nexoId, roomId: room.id, x: g.x0, y: g.y0 };
        setStatus('Link origen marcado (▣ visible). Cambia de nexo — la marca se conserva — y clica el destino.');
      } else {
        const p = app.pendingLink;
        if (p.nexoId === app.nexoId) { setStatus('El destino debe ser OTRO nexo.'); return; }
        const link = D.createLink(p.nexoId, app.nexoId);
        link.from = { nexoId: p.nexoId, roomId: p.roomId, x: p.x, y: p.y };
        link.to = { nexoId: app.nexoId, roomId: room.id, x: g.x0, y: g.y0 };
        app.station.links.push(link);
        app.pendingLink = null;
        setStatus('Link (ascensor) creado.');
      }
    }
  }

  // ---- clicks por modo ------------------------------------------------------
  function handleClick(px, py) {
    if (app.mode === 'game') return gameClick(R.pick(app.cam, viewNexo(), px, py));
    // colocación de módulo: click izquierdo coloca si la posición es válida
    if (app.mode === 'dev' && app.placing) {
      const bp = app.station.moduleLibrary.find(b => b.id === app.placing.bpId);
      if (!bp) { app.placing = null; syncPlacing(); return; }
      const w = R.screenToWorld(app.cam, px, py);
      const size = bp.room.size;
      const chk = BP.placementCheck(nexo(), size, { x: w.x - size.w / 2, y: w.y - size.h / 2 });
      if (!chk.ok) return setStatus('No se puede colocar: ' + chk.reason + '.');
      const room = BP.instantiateRoom(bp, { x: chk.x, y: chk.y });
      nexo().rooms.push(room);
      // abrir paso entre la sala colocada y la sala del nexo tocada
      const opened = BP.openSharedEdge(nexo(), room, chk.touch);
      invalidate();
      setStatus(bp.name + ' colocado (' + nexo().rooms.length + ' salas en ' + nexo().name + ')' +
        (opened ? ' · paso abierto (' + opened + ' paredes)' : ''));
      return;
    }
  }
  function gameClick(hit) {
    if (!hit) return;
    const pawn = agents.selected; if (!pawn) return;
    if (hit.object && hit.object.openable) { hit.object.open = !hit.object.open; invalidate(); return; }
    // multi-sala: resolver contra la sala clicada directamente
    const room = roomById(hit.roomId);
    if (!room) return;
    if (!agents.order(pawn, room, hit.lx, hit.ly)) setStatus('Sin ruta hasta ahí.');
    invalidate();
  }

  // ---- overlay: frontera de conexión (los Nexos son conectores centrales) -------
  function drawConnOverlay() {
    if (!(app.mode === 'dev' && app.devSection === 'nexo' && app.showConn)) return;
    ctx.save();
    ctx.setLineDash([7, 5]);
    ctx.strokeStyle = 'rgba(98,224,239,0.9)';
    ctx.lineWidth = 2;
    for (const room of nexo().rooms) {
      const pts = [[0, 0], [room.size.w, 0], [room.size.w, room.size.h], [0, room.size.h]].map(([lx, ly]) => {
        const w = R.localToWorld(room, lx, ly);
        return R.worldToScreen(app.cam, w.x, w.y, 0.02);
      });
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath(); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(98,224,239,0.85)';
    ctx.font = '12px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('frontera de conexión: los módulos se enchufan compartiendo una arista con el Nexo', 14, canvas.clientHeight - 12);
    ctx.restore();
  }

  // ---- ghost de colocación de módulo (preview + validación en vivo) -------------
  function drawPlacementGhost() {
    if (!(app.mode === 'dev' && app.devSection === 'nexo' && app.placing && app.mouseWorld)) return;
    const bp = app.station.moduleLibrary.find(b => b.id === app.placing.bpId);
    if (!bp) return;
    const size = bp.room.size;
    const chk = BP.placementCheck(nexo(), size, { x: app.mouseWorld.x - size.w / 2, y: app.mouseWorld.y - size.h / 2 });
    const col = chk.ok ? '126,217,87' : '239,98,98';
    const pts = [[0, 0], [size.w, 0], [size.w, size.h], [0, size.h]]
      .map(([lx, ly]) => R.worldToScreen(app.cam, chk.x + lx, chk.y + ly, 0.02));
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(' + col + ',0.16)'; ctx.fill();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = 'rgba(' + col + ',0.9)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.setLineDash([]);
    if (chk.ok && chk.touch) {          // arista compartida: resaltado sólido
      const e = chk.touch.edge;
      const a = e.x != null ? { x: e.x, y: e.y0 } : { x: e.x0, y: e.y };
      const b = e.x != null ? { x: e.x, y: e.y1 } : { x: e.x1, y: e.y };
      const sa = R.worldToScreen(app.cam, a.x, a.y, 0.03), sb = R.worldToScreen(app.cam, b.x, b.y, 0.03);
      ctx.strokeStyle = 'rgba(126,217,87,0.95)'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(' + col + ',0.95)';
    ctx.font = '12px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(bp.name + ' ' + size.w + '×' + size.h + (chk.ok ? ' · conexión OK — click para colocar' : ' · ' + chk.reason), mouse.x + 14, mouse.y - 10);
    ctx.restore();
  }

  // ---- bucle ---------------------------------------------------------------
  function resize() {
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(canvas.clientWidth * scale);
    canvas.height = Math.floor(canvas.clientHeight * scale);
    if (fxCanvas) { fxCanvas.width = canvas.width; fxCanvas.height = canvas.height; }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }
  // ---- fps: contador en HUD + tope opcional ?fps=N ----------------------------
  // El juego NO tiene tope artificial: requestAnimationFrame sigue al refresco
  // de la pantalla (60/120/144 Hz según el monitor). ?fps=N (24-240) limita
  // por debajo del refresco nativo (p. ej. ahorro de batería).
  const FPS_CAP = (() => {
    const v = parseInt(new URLSearchParams(location.search).get('fps') || '0', 10);
    return v >= 24 && v <= 240 ? v : 0;
  })();
  let fpsFrames = 0, fpsAt = performance.now(), fpsNow = 0, lastFrame = 0, hudFpsShown = -1, shipSig = '';
  function hudText() {
    const view = viewNexo();
    const e = app.station.state.energy;
    const tw = ' · ⚡' + e.used + '/' + e.capacity + 'TW' + (app.station.state.blackout ? ' ¡BROWNOUT!' : '');
    return app.station.name + ' · ' + view.name + tw +
      (app.mode === 'game' ? expeditionHud() : '') +
      (app.mode === 'dev' ? ' · [' + (app.devSection === 'modules' ? 'MÓDULOS' : 'NEXO') + ']' : '') +
      '  zoom:' + app.cam.zoom.toFixed(2) + '  rot:' + Math.round((app.cam.rot * 180 / Math.PI + 360) % 360) + '°' +
      (fxCanvas ? ' · 3D' : ' · 2D') + ' · ' + fpsNow + 'fps';
  }
  let last = performance.now();
  function frame(now) {
    if (FPS_CAP && now - lastFrame < 1000 / FPS_CAP - 0.4) { requestAnimationFrame(frame); return; }
    lastFrame = now;
    fpsFrames++;
    if (now - fpsAt >= 500) { fpsNow = Math.round(fpsFrames * 1000 / (now - fpsAt)); fpsFrames = 0; fpsAt = now; }
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    // la música corre en TODOS los modos (menú incluido) y con dt real: es
    // presentación, no simulación — no pasa por el paso fijo del engine.
    player.update(dt);
    // hangar: re-sync de placeholders si cambió algo (eventos, retiradas manuales)
    if (app.mode !== 'menu') {
      let ph = 0;
      for (const n of app.station.nexos) for (const r of n.rooms) for (const o of r.objects) if (o.type === 'ship') ph++;
      const sig = app.station.state.ships.length + ':' + app.station.state.ships.map(sh => sh.state).join(',') + ':' + ph;
      if (sig !== shipSig) { shipSig = sig; syncShipObjects(); invalidate(); }
    }
    if (app.mode === 'game' && !app.paused) {
      sim.advance(dt, (fdt) => { engine.update(nexo(), fdt); station.update(app.station, fdt); });
      if (engine.activeCount() > 0 || agents.pawns.some(p => p.moving)) invalidate();
    }
    if (dirty) {
      dirty = false;
      const view = viewNexo();
      R.clear(ctx, canvas.clientWidth, canvas.clientHeight);
      if (fxCanvas) ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      R.drawNexo(ctx, app.cam, view, {
        entry: app.mode === 'dev' && app.devSection === 'nexo' ? view.entry : (app.mode === 'game' ? view.entry : null),
        linkMarkers: app.devSection === 'nexo' ? linkMarkers() : [],
        pawns: agents.pawns.filter(p => p.nexoId === app.nexoId),
        selectedPawnId: agents.selected && agents.selected.id,
        hover: app.mode === 'dev' ? app.hover : null,
        ghost: app.drag && RECT_TOOLS.includes(app.drag.tool) ? app.drag : null
      });
      drawConnOverlay();
      drawPlacementGhost();
      drawSelection();
      drawToolbar();
      hudEl.textContent = hudText();
      hudFpsShown = fpsNow;
    }
    // el contador fps vive fuera del repintado (dirty): actualiza solo el texto
    if (hudEl && fpsNow !== hudFpsShown) { hudFpsShown = fpsNow; hudEl.textContent = hudText(); }
    requestAnimationFrame(frame);
  }

  // ---- chrome (menú / suite) ----------------------------------------------
  function bind(id, fn) { $(id).addEventListener('click', fn); }
  bind('mDev', () => setMode('dev'));
  bind('mGame', () => setMode('game'));
  bind('tMenu', () => setMode('menu'));
  bind('tPlay', () => setMode(app.mode === 'game' ? 'dev' : 'game'));
  // música: mute + volumen (persistentes). El navegador bloquea el audio hasta
  // el primer gesto del usuario: por eso todo click/tecla reintenta el unlock.
  bind('muBtn', () => { musicMuted = !(musicMuted || musicVol === 0); if (!musicMuted && musicVol === 0) musicVol = 0.6; saveMusicPrefs(); applyMusicPrefs(); player.unlock(); });
  $('muVol').addEventListener('input', (e) => {
    musicVol = CORE.clamp((Number(e.target.value) || 0) / 100, 0, 1);
    if (musicVol > 0) musicMuted = false;
    saveMusicPrefs(); applyMusicPrefs(); player.unlock();
  });
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => player.unlock(), { capture: true });

  bind('secBtnNexo', () => setDevSection('nexo'));
  bind('secBtnModules', () => setDevSection('modules'));
  bind('tExport', () => S.exportToFile(app.station));
  bind('tImport', () => $('fileInput').click());
  $('fileInput').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      app.station = S.deserialize(await f.text());
      app.nexoId = app.station.startNexoId;
      app.bpId = app.station.moduleLibrary.length ? app.station.moduleLibrary[0].id : null;
      app.pendingLink = null; resetEdit();
      refreshSlots(); refreshBpList();
      R.centerOn(app.cam, viewNexo(), canvas.clientWidth, canvas.clientHeight);
      setStatus('Estación importada.'); invalidate();
    } catch (err) { setStatus('Error al importar: ' + err.message); }
    e.target.value = '';
  });

  // La selección de herramienta vive en la barra inferior de rombos
  // (tools/toolbox.js). El panel lateral solo conserva las OPCIONES de cada
  // herramienta (tipo de suelo/pared/objeto) y las acciones de sala.
  $('floorSel').addEventListener('change', (e) => { app.brush.floor = e.target.value; });
  $('wallSel').addEventListener('change', (e) => { app.brush.wallKind = e.target.value; });
  $('connToggle').addEventListener('change', (e) => { app.showConn = e.target.checked; invalidate(); });

  // sala objetivo de botones de sala: en módulos el blueprint; en nexo la sala bajo el hover (o la primera)
  function currentEditRoom() {
    if (app.devSection === 'modules') { const bp = activeBp(); return bp ? bp.room : null; }
    if (app.hover && app.hover.roomId) { const r = roomById(app.hover.roomId); if (r) return r; }
    return nexo().rooms[0] || null;
  }
  bind('tRing', () => {
    const room = currentEditRoom(); if (!room) return setStatus('Nada que bordear.');
    pushUndo(room); D.ringWalls(room); invalidate(); setStatus('Auto-bordes aplicados.');
  });
  bind('tClear', () => {
    const room = currentEditRoom(); if (!room) return setStatus('Nada que vaciar.');
    pushUndo(room); BP.clearRoom(room); invalidate(); setStatus('Sala vaciada.');
  });
  bind('tUndo', doUndo);
  bind('tRedo', doRedo);

  // colocación de módulo desde biblioteca (sección Nexo)
  bind('placeToggle', () => {
    if (app.placing) { app.placing = null; app.tool = 'select'; syncPlacing(); invalidate(); return; }
    const bpId = $('placeSel').value;
    if (!bpId) return setStatus('La biblioteca está vacía: crea un módulo en DISEÑAR MÓDULOS.');
    app.placing = { bpId };
    app.tool = 'module';
    syncPlacing(); invalidate();
    setStatus('Colocación: mueve el ratón (verde = conexión OK) · click coloca · click derecho retira · ESC sale.');
  });

  // biblioteca de módulos
  bind('bpNew', () => {
    const bp = D.createModuleBlueprint({ name: 'Módulo ' + (app.station.moduleLibrary.length + 1), w: 8, h: 6 });
    app.station.moduleLibrary.push(bp);
    selectBp(bp.id);
    setStatus('Blueprint creado: edítalo con las herramientas y ajusta sus metadatos.');
  });
  bind('bpDup', () => {
    const bp = activeBp(); if (!bp) return;
    const copy = D.normalizeModuleBlueprint(JSON.parse(JSON.stringify(bp)));
    copy.id = CORE.uid('bp'); copy.name = bp.name + ' copia';
    app.station.moduleLibrary.push(copy);
    selectBp(copy.id);
    setStatus('Módulo duplicado.');
  });
  bind('bpDel', () => {
    const bp = activeBp(); if (!bp) return;
    // contar instancias colocadas antes de eliminar
    let removedCount = 0;
    const removedRoomIds = [];
    for (const n of app.station.nexos) {
      const before = n.rooms.length;
      removedRoomIds.push(...n.rooms.filter(r => r.bpId === bp.id).map(r => r.id));
      n.rooms = n.rooms.filter(r => r.bpId !== bp.id);
      removedCount += before - n.rooms.length;
    }
    app.station.state.modules = app.station.state.modules.filter(m => !removedRoomIds.includes(m.roomId));
    station.recompute(app.station);
    app.station.moduleLibrary = app.station.moduleLibrary.filter(b => b.id !== bp.id);
    app.bpId = app.station.moduleLibrary.length ? app.station.moduleLibrary[0].id : null;
    resetEdit(); refreshBpList(); invalidate();
    setStatus('Módulo eliminado (biblioteca + ' + removedCount + ' instancia(s) retiradas del nexo).');
  });
  bind('bpResize', () => {
    const bp = activeBp(); if (!bp) return;
    const w = CORE.clamp(Number($('bpW').value) || bp.room.size.w, 1, 64);
    const h = CORE.clamp(Number($('bpH').value) || bp.room.size.h, 1, 64);
    pushUndo(bp.room);
    // el mínimo por blueprint RECHAZA, no recorta en silencio (T2)
    const res = BP.resizeBlueprint(bp, w, h);
    if (!res.ok) {
      app.undoStack.pop();
      refreshBpForm();
      return setStatus('Tamaño rechazado: ' + res.reason + '.');
    }
    refreshBpList(); invalidate();
    setStatus('Tamaño aplicado: ' + w + '×' + h + ' (contenido recentrado).');
  });
  // plantilla Reactor (OBJP-1.1 · T2): 6×6 con mínimo duro 5×5 y 100 TW
  bind('bpNewReactor', () => {
    const bp = BP.createReactorBlueprint({ name: 'Reactor ' + (app.station.moduleLibrary.filter(b => b.category === 'energia').length + 1) });
    app.station.moduleLibrary.push(bp);
    selectBp(bp.id);
    setStatus('Reactor creado: 100 TW, mínimo 5×5 (la suite rechaza tamaños menores).');
  });
  bind('bpExport', () => {
    downloadJson('ugs_modulos.json', { moduleLibrary: app.station.moduleLibrary });
    setStatus('Biblioteca exportada (' + app.station.moduleLibrary.length + ' módulos).');
  });
  bind('bpExportOne', () => {
    const bp = activeBp(); if (!bp) return;
    const slug = (bp.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || bp.id);
    downloadJson('ugs_modulo_' + slug + '.json', bp);
    setStatus('Módulo exportado: ' + bp.name);
  });
  bind('bpImport', () => $('bpFileInput').click());
  $('bpFileInput').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []); if (!files.length) return;
    let totalAdded = 0;
    try {
      for (const f of files) {
        const raw = JSON.parse(await f.text());
        const result = D.normalizeModuleLibraryInput(raw, app.station.moduleLibrary.map(b => b.id));
        app.station.moduleLibrary.push(...result.added);
        totalAdded += result.count;
      }
      if (totalAdded && !app.bpId) app.bpId = app.station.moduleLibrary[0].id;
      refreshBpList(); invalidate();
      setStatus('Biblioteca importada: +' + totalAdded + ' módulo(s) desde ' + files.length + ' archivo(s).');
    } catch (err) { setStatus('Error al importar módulos: ' + err.message); }
    e.target.value = '';
  });

  // formulario de metadatos del módulo activo
  function bindBpField(id, fn) { $(id).addEventListener('change', (e) => { const bp = activeBp(); if (!bp) return; fn(bp, e.target.value); refreshBpList(); invalidate(); }); }
  bindBpField('bpName', (bp, v) => { bp.name = String(v).trim() || bp.name; bp.room.name = bp.name; });
  bindBpField('bpCat', (bp, v) => { bp.category = v; });
  bindBpField('bpCost', (bp, v) => { bp.cost = Math.max(0, Number(v) | 0); });
  bindBpField('bpEnergyUse', (bp, v) => { bp.energyUse = Math.max(0, Number(v) | 0); });
  bindBpField('bpProvEnergy', (bp, v) => { bp.provides.energy = Math.max(0, Number(v) | 0); });
  bindBpField('bpProvStorage', (bp, v) => { bp.provides.storage = Math.max(0, Number(v) | 0); });
  bindBpField('bpProvPnj', (bp, v) => { bp.provides.pnjCapacity = Math.max(0, Number(v) | 0); });

  // ---- boot ------------------------------------------------------------------
  resize();
  refreshSlots();
  refreshBpList();
  // sub-selector de la herramienta Objeto, poblado desde el catálogo (T1).
  // La consola NO entra aquí: tiene herramienta propia.
  (function fillObjectSelector() {
    const sel = $('objSel'); if (!sel || !window.UGS.objectsLib) return;
    sel.innerHTML = '';
    for (const o of window.UGS.objectsLib.options()) {
      const opt = document.createElement('option');
      opt.value = o.id; opt.textContent = o.name;
      sel.appendChild(opt);
    }
  })();
  loadMusicPrefs();
  applyMusicPrefs();
  player.start();                 // suena en cuanto el navegador lo permita (unlock)
  R.centerOn(app.cam, viewNexo(), canvas.clientWidth, canvas.clientHeight);
  // debug/smoke hook: ?auto=dev|game salta el menú (&sec=modules fuerza sección)
  const qs = new URLSearchParams(location.search);
  const auto = qs.get('auto');
  setMode(auto === 'dev' || auto === 'game' ? auto : 'menu');
  if (auto === 'dev' && qs.get('sec') === 'modules') setDevSection('modules');
  syncShipObjects();
  requestAnimationFrame(frame);

  // hook de depuración/tests
  window.UGS.app = app;
  window.UGS._engine = engine;
  window.UGS._agents = agents;
  window.UGS._station = station;
  window.UGS._rng = rng;
  window.UGS._music = music;
  window.UGS._player = player;
})();
