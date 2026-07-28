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
 *   · Colocación de módulos sobre el Nexo: placementCheck() valida el
 *     ghost de la suite Dev (no-solape + arista compartida).
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

  /*
   * Tamaño mínimo de un blueprint (OBJP-1.1 · T2). La suite debe RECHAZAR
   * redimensionar por debajo, no recortar en silencio: si el usuario pide 4×4
   * en un Reactor, se le dice por qué y no se toca la sala.
   */
  function minSizeOf(bp) {
    const m = bp && bp.minSize;
    return { w: Math.max(1, Number(m && m.w) || 1), h: Math.max(1, Number(m && m.h) || 1) };
  }
  function resizeBlueprint(bp, w, h) {
    if (!bp || !bp.room) return { ok: false, reason: 'blueprint inválido' };
    const min = minSizeOf(bp);
    w = w | 0; h = h | 0;
    if (w < min.w || h < min.h) {
      return { ok: false, reason: bp.name + ' no admite menos de ' + min.w + '×' + min.h, min };
    }
    resizeRoom(bp.room, w, h);
    return { ok: true, size: { w: bp.room.size.w, h: bp.room.size.h }, min };
  }

  /*
   * TW que aporta una sala por los OBJETOS que contiene (-XONO, 2026-07-28:
   * «el reactor debe ser un objeto no una sala como tal»). Ya no hay plantilla
   * de módulo-Reactor: colocas núcleos con la herramienta Objeto y el módulo
   * se vuelve generador. Data-driven: quien aporta y cuánto lo dice el
   * catálogo (core/objects_lib → registerObjectDefs), no este archivo.
   */
  function energyFromObjects(room) {
    if (!room || !Array.isArray(room.objects)) return 0;
    let tw = 0;
    for (const o of room.objects) tw += D.objectEnergy(o.type);
    return tw;
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
  /*
   * La def lleva SOLO la energía declarada a mano en el formulario. Los TW de
   * los núcleos NO se meten aquí a propósito: los cuenta la INSTANCIA colocada
   * (station.attachModule → objEnergy), leyendo su propia sala. Sumarlos en los
   * dos sitios los contaba dos veces, y además la sala colocada puede divergir
   * del blueprint (se le añaden o quitan núcleos después de colocarla), así que
   * la instancia es la única fuente honesta. `energyFromObjects` sigue
   * existiendo para la vista previa del formulario en la suite.
   */
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
    room.bpId = bp.id;
    room.objects = room.objects.map(o => Object.assign(o, { id: CORE.uid('obj') }));
    if (pos) { room.transform.x = Number(pos.x) || 0; room.transform.y = Number(pos.y) || 0; }
    return room;
  }

  // ---- colocación de módulos sobre el Nexo (ghost de la suite Dev) ------------
  const rectsOverlap = (ax, ay, aw, ah, bx, by, bw, bh) =>
    ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;

  // arista compartida con solape positivo entre dos rects axis-aligned;
  // devuelve el segmento compartido {side,...} o null (las esquinas NO cuentan)
  function sharedEdge(ax, ay, aw, ah, bx, by, bw, bh) {
    const ovY = Math.min(ay + ah, by + bh) - Math.max(ay, by);
    const ovX = Math.min(ax + aw, bx + bw) - Math.max(ax, bx);
    if (ax + aw === bx && ovY > 0) return { side: 'W', x: bx, y0: Math.max(ay, by), y1: Math.min(ay + ah, by + bh) };
    if (bx + bw === ax && ovY > 0) return { side: 'E', x: ax, y0: Math.max(ay, by), y1: Math.min(ay + ah, by + bh) };
    if (ay + ah === by && ovX > 0) return { side: 'N', y: by, x0: Math.max(ax, bx), x1: Math.min(ax + aw, bx + bw) };
    if (by + bh === ay && ovX > 0) return { side: 'S', y: ay, x0: Math.max(ax, bx), x1: Math.min(ax + aw, bx + bw) };
    return null;
  }

  // ¿puedo colocar un módulo de `size` en `pos` sobre este Nexo? (diseño, suite Dev)
  // Reglas: no solapa con ninguna sala Y comparte arista con al menos una (conector).
  function placementCheck(nexo, size, pos) {
    const mw = size.w | 0, mh = size.h | 0;
    const mx = Math.round(pos.x), my = Math.round(pos.y);
    let touch = null;
    for (const room of nexo.rooms) {
      const t = room.transform;
      if (rectsOverlap(mx, my, mw, mh, t.x, t.y, room.size.w, room.size.h)) {
        return { ok: false, reason: 'solapa con ' + (room.name || 'una sala'), x: mx, y: my, touch: null };
      }
      const edge = sharedEdge(mx, my, mw, mh, t.x, t.y, room.size.w, room.size.h);
      if (edge && !touch) touch = { roomId: room.id, edge };
    }
    if (!touch) return { ok: false, reason: 'sin conexión: comparte una arista con el Nexo', x: mx, y: my, touch: null };
    return { ok: true, reason: '', x: mx, y: my, touch };
  }

  // Abre paso entre dos salas que comparten arista: quita paredes en el intervalo
  // compartido y pone suelo 'deck' si queda void. Devuelve cuántas paredes quitó.
  function openSharedEdge(nexo, room, touch) {
    if (!touch || !touch.edge) return 0;
    const other = nexo.rooms.find(r => r.id === touch.roomId);
    if (!other) return 0;
    const e = touch.edge;
    let removed = 0;

    if (e.side === 'W' || e.side === 'E') {
      // arista vertical: intervalo y0..y1 (coords mundo)
      // side W: room está al OESTE de other → room east wall (lx=size.w-1), other west wall (ox=0)
      // side E: room está al ESTE de other → room west wall (lx=0), other east wall (ox=size.w-1)
      const roomLx = e.side === 'W' ? room.size.w - 1 : 0;
      const otherOx = e.side === 'W' ? 0 : other.size.w - 1;
      for (let wy = e.y0; wy < e.y1; wy++) {
        const ly = wy - room.transform.y;
        if (ly >= 0 && ly < room.size.h) {
          const t = room.tiles[ly][roomLx];
          if (t.wall) { t.wall = null; removed++; }
          if (t.floor === 'void') t.floor = 'deck';
        }
        const oy = wy - other.transform.y;
        if (oy >= 0 && oy < other.size.h) {
          const t = other.tiles[oy][otherOx];
          if (t.wall) { t.wall = null; removed++; }
          if (t.floor === 'void') t.floor = 'deck';
        }
      }
    } else {
      // arista horizontal: intervalo x0..x1 (coords mundo)
      // side N: room está al NORTE de other → room south wall (ly=size.h-1), other north wall (oy=0)
      // side S: room está al SUR de other → room north wall (ly=0), other south wall (oy=size.h-1)
      const roomLy = e.side === 'N' ? room.size.h - 1 : 0;
      const otherOy = e.side === 'N' ? 0 : other.size.h - 1;
      for (let wx = e.x0; wx < e.x1; wx++) {
        const lx = wx - room.transform.x;
        if (lx >= 0 && lx < room.size.w) {
          const t = room.tiles[roomLy][lx];
          if (t.wall) { t.wall = null; removed++; }
          if (t.floor === 'void') t.floor = 'deck';
        }
        const ox = wx - other.transform.x;
        if (ox >= 0 && ox < other.size.w) {
          const t = other.tiles[otherOy][ox];
          if (t.wall) { t.wall = null; removed++; }
          if (t.floor === 'void') t.floor = 'deck';
        }
      }
    }
    return removed;
  }

  // ---- salas generadas desde defs de la capa estratégica ---------------------
  /*
   * roomFromDef(def) — fábrica de salas para el MODO JUEGO (GAP-UI-01). Las
   * defs de content_f1 traen `room: {w, h, bay?}` como huella placeholder:
   * cuando los módulos F1 se diseñen en la suite, la sala vendrá de la
   * biblioteca; hasta entonces el jugador coloca una sala honesta generada
   * aquí (anillo de paredes; el hangar abre su arista este como muralla
   * `bay`). Sin objetos dentro: la energía la da el def (provides.energy),
   * no un núcleo, así que no hay doble conteo.
   */
  function roomFromDef(def) {
    const spec = (def && def.room) || {};
    const w = CORE.clamp(spec.w || 6, 3, 64), h = CORE.clamp(spec.h || 6, 3, 64);
    const room = D.createRoom(def && def.name || 'Módulo', w, h);
    D.ringWalls(room);
    if (spec.bay) {
      // una arista como muralla `bay` (apertura oscura con marco luminoso, K2)
      const edge = String(spec.bay).toUpperCase();
      if (edge === 'E') for (let y = 0; y < h; y++) room.tiles[y][w - 1].wall = D.createWall('bay', 0);
      else if (edge === 'W') for (let y = 0; y < h; y++) room.tiles[y][0].wall = D.createWall('bay', 0);
      else if (edge === 'N') for (let x = 0; x < w; x++) room.tiles[0][x].wall = D.createWall('bay', 0);
      else if (edge === 'S') for (let x = 0; x < w; x++) room.tiles[h - 1][x].wall = D.createWall('bay', 0);
    }
    return room;
  }

  return {
    paintFloorRect, paintWallOutline, eraseRect, floodFillFloor, clearRoom, resizeRoom,
    minSizeOf, resizeBlueprint, energyFromObjects,
    snapshotRoom, restoreRoom,
    toModuleDef, instantiateRoom, roomFromDef,
    rectsOverlap, sharedEdge, placementCheck, openSharedEdge
  };
});
