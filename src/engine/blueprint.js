/*
 * UGS — engine/blueprint  (suite Dev: diseño de MÓDULOS y edición de salas)
 * ==================================================================
 * [COMPONENTES LÓGICOS] — lógica de DISEÑO (tiempo de editor, sin DOM):
 *   · Ops de edición de salas compartidas por las secciones NEXO y MÓDULOS
 *     de la suite Dev (rectángulos de suelo, contornos de pared, borrado,
 *     bote de relleno, redimensión, limpieza).
 *   · Snapshots para deshacer/rehacer.
 *   · Puente blueprint → capa estratégica: toModuleDef() produce defs
 *     compatibles con engine/station.js (defineModule/placeModule) y
 *     instantiateRoom() crea salas frescas con ids nuevos para colocar.
 *
 * Un "module blueprint" (definido en core/data.js) es una sala + metadatos
 * de diseño (coste CRED, energyUse TW, provides). Es DATO puro: el contenido
 * F1 del árbol humano sigue congelado (OBJP-1.1); aquí solo hay formato.
 *
 * Corre en navegador (window.UGS.blueprint) y en Node (module.exports).
 */
(function (root, factory) {
  const coreApi = (root.UGS && root.UGS.core)
    || (typeof require !== 'undefined' ? require('../core/core.js') : null);
  const dataApi = (root.UGS && root.UGS.data)
    || (typeof require !== 'undefined' ? require('../core/data.js') : null);
  const api = factory(coreApi, dataApi);
  root.UGS = root.UGS || {};
  root.UGS.blueprint = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CORE, D) {
  'use strict';

  // ---- helpers ---------------------------------------------------------------
  function normRect(room, x0, y0, x1, y1) {
    let ax = Math.min(x0, x1) | 0, bx = Math.max(x0, x1) | 0;
    let ay = Math.min(y0, y1) | 0, by = Math.max(y0, y1) | 0;
    ax = CORE.clamp(ax, 0, room.size.w - 1); bx = CORE.clamp(bx, 0, room.size.w - 1);
    ay = CORE.clamp(ay, 0, room.size.h - 1); by = CORE.clamp(by, 0, room.size.h - 1);
    return { ax, ay, bx, by };
  }
  const inBounds = (room, x, y) => x >= 0 && y >= 0 && x < room.size.w && y < room.size.h;

  // ---- ops de edición de salas (compartidas NEXO / MÓDULOS) -------------------

  // Suelo por rectángulo: no pisa tiles con pared (la pared manda, contrato C1).
  function paintFloorRect(room, x0, y0, x1, y1, floorId) {
    if (!D.FLOORS[floorId]) return 0;
    const { ax, ay, bx, by } = normRect(room, x0, y0, x1, y1);
    let n = 0;
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
      const t = room.tiles[y][x];
      if (!t.wall && t.floor !== floorId) { t.floor = floorId; n++; }
    }
    return n;
  }

  // Pared en CONTORNO de rectángulo (dibuja habitaciones de un gesto).
  // Donde la pared cae en suelo 'void', el tile pasa a 'deck' (como la tool vieja).
  function paintWallOutline(room, x0, y0, x1, y1, kind, orient) {
    const { ax, ay, bx, by } = normRect(room, x0, y0, x1, y1);
    let n = 0;
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
      if (x !== ax && x !== bx && y !== ay && y !== by) continue;   // solo perímetro
      const t = room.tiles[y][x];
      if (t.floor === 'void') t.floor = 'deck';
      t.wall = D.createWall(kind || 'block', orient || 0);
      n++;
    }
    return n;
  }

  // Borrado por rectángulo: objetos + paredes + suelo → void.
  function eraseRect(room, x0, y0, x1, y1) {
    const { ax, ay, bx, by } = normRect(room, x0, y0, x1, y1);
    let n = 0;
    room.objects = room.objects.filter(o => {
      const inside = o.x >= ax && o.x <= bx && o.y >= ay && o.y <= by;
      if (inside) n++;
      return !inside;
    });
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
      const t = room.tiles[y][x];
      if (t.wall || t.floor !== 'void') n++;
      t.wall = null; t.floor = 'void';
    }
    return n;
  }

  // Bote de relleno: flood fill sobre región contigua del MISMO suelo, sin cruzar paredes.
  function floodFillFloor(room, x, y, floorId) {
    if (!D.FLOORS[floorId] || !inBounds(room, x, y)) return 0;
    const start = room.tiles[y][x];
    if (start.wall || start.floor === floorId) return 0;
    const target = start.floor;
    let n = 0;
    const q = [[x, y]];
    const seen = new Set([x + ',' + y]);
    while (q.length) {
      const [cx, cy] = q.pop();
      room.tiles[cy][cx].floor = floorId; n++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, k = nx + ',' + ny;
        if (!inBounds(room, nx, ny) || seen.has(k)) continue;
        const t = room.tiles[ny][nx];
        if (t.wall || t.floor !== target) continue;
        seen.add(k); q.push([nx, ny]);
      }
    }
    return n;
  }

  // Vaciar sala: todo void + sin objetos (los eventos declarados se conservan).
  function clearRoom(room) {
    for (let y = 0; y < room.size.h; y++) for (let x = 0; x < room.size.w; x++) {
      room.tiles[y][x].wall = null; room.tiles[y][x].floor = 'void';
    }
    room.objects = [];
  }

  // Redimensionar conservando el contenido RECENTRADO (objetos fuera se pierden).
  function resizeRoom(room, w, h) {
    w = CORE.clamp(w | 0, 1, 64); h = CORE.clamp(h | 0, 1, 64);
    if (w === room.size.w && h === room.size.h) return room;
    const dx = Math.round((w - room.size.w) / 2), dy = Math.round((h - room.size.h) / 2);
    const tiles = Array.from({ length: h }, () => Array.from({ length: w }, () => D.createTile('void')));
    for (let y = 0; y < room.size.h; y++) for (let x = 0; x < room.size.w; x++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) tiles[ny][nx] = room.tiles[y][x];
    }
    room.objects = room.objects
      .map(o => Object.assign(o, { x: o.x + dx, y: o.y + dy }))
      .filter(o => o.x >= 0 && o.y >= 0 && o.x < w && o.y < h);
    room.size = { w, h };
    room.tiles = tiles;
    room.transform.pivot = { x: w / 2, y: h / 2 };
    return room;
  }

  // ---- snapshots (deshacer / rehacer) ------------------------------------------
  function snapshotRoom(room) {
    return JSON.parse(JSON.stringify({
      name: room.name, size: room.size, transform: room.transform,
      tiles: room.tiles, objects: room.objects, events: room.events
    }));
  }
  function restoreRoom(room, snap) {
    room.name = snap.name;
    room.size = JSON.parse(JSON.stringify(snap.size));
    room.transform = JSON.parse(JSON.stringify(snap.transform));
    room.tiles = JSON.parse(JSON.stringify(snap.tiles));
    room.objects = JSON.parse(JSON.stringify(snap.objects));
    room.events = JSON.parse(JSON.stringify(snap.events));
    return room;
  }

  // ---- puente blueprint → capa estratégica --------------------------------------
  // Def compatible con engine/station.js defineModule(): los campos extra
  // (layout, category, notes) viajan como datos y no molestan al runtime.
  function toModuleDef(bp) {
    return {
      id: bp.id, name: bp.name,
      cost: Math.max(0, Number(bp.cost) | 0),
      energyUse: Math.max(0, Number(bp.energyUse) | 0),
      provides: {
        energy: Math.max(0, Number(bp.provides && bp.provides.energy) | 0),
        storage: Math.max(0, Number(bp.provides && bp.provides.storage) | 0),
        pnjCapacity: Math.max(0, Number(bp.provides && bp.provides.pnjCapacity) | 0)
      },
      category: bp.category || 'general',
      layout: bp.room
    };
  }

  // Sala FRESCA desde un blueprint (ids nuevos: colocar dos veces el mismo
  // módulo nunca comparte ids). `pos` fija transform.x/y (conexión física).
  function instantiateRoom(bp, pos) {
    const room = D.normalizeRoom(bp.room);
    room.id = CORE.uid('room');
    room.name = bp.name || room.name;
    room.objects = room.objects.map(o => Object.assign(o, { id: CORE.uid('obj') }));
    if (pos) { room.transform.x = Number(pos.x) || 0; room.transform.y = Number(pos.y) || 0; }
    return room;
  }

  return {
    paintFloorRect, paintWallOutline, eraseRect, floodFillFloor, clearRoom, resizeRoom,
    snapshotRoom, restoreRoom,
    toModuleDef, instantiateRoom
  };
});
