/*
 * UGS — core/data  (REVAMP · base nueva)
 * ==================================================================
 * [COMPONENTES LÓGICOS] — el MODELO DE DATOS del juego. Define las formas;
 * no sabe nada de píxeles ni de input.
 *
 * Jerarquía (REVISIÓN MAESTRA 2, DEFINICIONES):
 *   Estación (save)
 *     └─ Nexo  (= nivel/fase; unidad de lógica PRE-CARGADA)
 *          └─ Room (rectángulo de tiles + objetos + eventos declarados)
 *               └─ Tile { floor, wall? }   Wall SIEMPRE bloquea su tile.
 *
 * Contratos inquebrantables (vienen del feedback humano, no negociables):
 *   C1. TODA pieza de pared bloquea su tile completo (block/diagonal/rounded).
 *   C2. Un objeto sólido bloquea su tile, salvo puerta/compuerta ABIERTA.
 *   C3. floor 'void' no es transitable.
 *
 * station.state = estado de la CAPA ESTRATÉGICA (engine/station.js).
 *
 * Corre en navegador (window.UGS.data) y en Node (module.exports).
 */
(function (root, factory) {
  const coreApi = (root.UGS && root.UGS.core)
    || (typeof require !== 'undefined' ? require('./core.js') : null);
  const api = factory(coreApi);
  root.UGS = root.UGS || {};
  root.UGS.data = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CORE) {
  'use strict';

  const SAVE_FORMAT = 1;
  const NEXO_SLOTS = 3;   // tope físico de diseño: 3 Nexos, 1 por fase (station.MAX_NEXOS)

  // ---- materiales / catálogos mínimos (crecen por necesidad, no por ocio) --
  const FLOORS = {
    deck:  { id: 'deck',  color: '#475061', line: '#4a5468' },
    dark:  { id: 'dark',  color: '#39404d', line: '#3a4250' },
    light: { id: 'light', color: '#5d6880', line: '#5a6678' }
  };
  const WALL_KINDS = ['block', 'diagonal', 'rounded', 'bay'];   // bay: muralla de hangar (apertura para naves; C1 sigue bloqueando al PCJ)
  const OBJECT_DEFS = {
    console:  { type: 'console',  solid: true,  openable: false },
    door:     { type: 'door',     solid: true,  openable: true  },
    elevator: { type: 'elevator', solid: false, openable: false },   // viaje entre Nexos (OBJP-1)
    plant:    { type: 'plant',    solid: false, openable: false },
    ship:     { type: 'ship',     solid: false, openable: false }    // placeholder de nave en hangar (sync desde station.ships)
  };

  // ---- constructores -------------------------------------------------------
  function createTile(floor) { return { floor: floor || 'deck', wall: null }; }

  // C1: collision es SIEMPRE 'full'. El parámetro existe solo para que el
  // esquema lo declare; cualquier valor se normaliza a 'full' (ver normalizeWall).
  function createWall(kind, orientation) {
    return { kind: WALL_KINDS.includes(kind) ? kind : 'block', orientation: ((orientation || 0) % 360 + 360) % 360, collision: 'full' };
  }

  function createObjectInstance(type, x, y) {
    const def = OBJECT_DEFS[type] || { type, solid: true, openable: false };
    return { id: CORE.uid('obj'), type, x: x | 0, y: y | 0, rotation: 0, solid: def.solid, openable: def.openable, open: false };
  }

  // Evento declarativo de sala: la lógica del Nexo se DECLARA en datos y el
  // engine la ejecuta. kind: shift | rotate | orbit | carousel (ver engine.js).
  function createRoomEvent(name) {
    return { id: CORE.uid('evt'), name: name || 'Event', enabled: true, trigger: { type: 'time' }, loop: true, action: null };
  }

  function createRoom(name, w, h) {
    w = CORE.clamp(w || 8, 1, 64); h = CORE.clamp(h || 8, 1, 64);
    return {
      id: CORE.uid('room'), name: name || 'Room',
      bpId: null,           // blueprint de origen si la sala se colocó desde la biblioteca (suite Dev)
      size: { w, h },
      transform: { x: 0, y: 0, rotation: 0, pivot: { x: w / 2, y: h / 2 } },
      tiles: Array.from({ length: h }, () => Array.from({ length: w }, () => createTile('deck'))),
      objects: [],
      events: []
    };
  }

  // Nexo = nivel = fase. `logic` es el bloque declarativo PRE-CARGADO del Nexo:
  // aquí vivirán hitos/módulos/eventos de fase (OBJP-1.1 los poblará).
  function createNexo(name) {
    return { id: CORE.uid('nexo'), name: name || 'Nexo', rooms: [], entry: null, links: [], logic: {} };
  }

  // Link (ascensor) entre Nexos: única forma de cambiar de fase en juego.
  function createLink(fromNexo, toNexo) {
    return {
      id: CORE.uid('link'), kind: 'elevator', bidirectional: true,
      from: { nexoId: fromNexo, roomId: null, x: 0, y: 0 },
      to:   { nexoId: toNexo,   roomId: null, x: 0, y: 0 }
    };
  }

  function createStation(name) {
    const nexo = createNexo('Nexo 1');
    const room = createRoom('Room 1', 12, 9);
    ringWalls(room);
    nexo.rooms.push(room);
    nexo.entry = { roomId: room.id, x: 2, y: 2 };
    return { formatVersion: SAVE_FORMAT, name: name || 'Untitled Station', nexos: [nexo], links: [], startNexoId: nexo.id, state: createState(), moduleLibrary: [] };
  }

  // ---- blueprints de módulo (suite Dev, sección MÓDULOS) ----------------------
  // Un blueprint = sala de diseño + metadatos que luego alimentan las defs de
  // la capa estratégica (engine/station.js). Es DATO de diseño, no contenido F1.
  function createModuleBlueprint(opts) {
    opts = opts || {};
    const p = opts.provides || {};
    const room = createRoom(opts.name || 'Módulo', opts.w || 8, opts.h || 6);
    ringWalls(room);
    return {
      id: CORE.uid('bp'),
      name: String(opts.name || 'Módulo'),
      category: String(opts.category || 'general'),
      cost: Math.max(0, Number(opts.cost) | 0),
      energyUse: Math.max(0, Number(opts.energyUse) | 0),
      provides: {
        energy: Math.max(0, Number(p.energy) | 0),
        storage: Math.max(0, Number(p.storage) | 0),
        pnjCapacity: Math.max(0, Number(p.pnjCapacity) | 0)
      },
      notes: String(opts.notes || ''),
      room
    };
  }
  function normalizeModuleBlueprint(bp) {
    if (!bp || typeof bp !== 'object') return createModuleBlueprint({});
    const out = createModuleBlueprint(bp);
    out.room = normalizeRoom(bp.room);
    if (bp.id) out.id = String(bp.id);
    return out;
  }

  // Normaliza entrada de biblioteca de módulos (objeto suelto | array | {moduleLibrary})
  // y regenera ids en colisión. Devuelve {added: [bp…], count}.
  function normalizeModuleLibraryInput(raw, existingIds) {
    if (!raw || (typeof raw !== 'object')) return { added: [], count: 0 };
    const arr = Array.isArray(raw) ? raw : (Array.isArray(raw.moduleLibrary) ? raw.moduleLibrary : [raw]);
    const added = [];
    const ids = new Set(existingIds || []);
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      const bp = normalizeModuleBlueprint(item);
      if (ids.has(bp.id)) bp.id = CORE.uid('bp');
      ids.add(bp.id);
      added.push(bp);
    }
    return { added, count: added.length };
  }

  // Estado de la CAPA ESTRATÉGICA (engine/station.js): economía, hitos,
  // módulos instalados, naves. Viaja con el save; la semilla del RNG también.
  function createState() {
    return {
      cred: 0, seed: 'ugs-station', phase: 1,
      energy: { capacity: 0, used: 0 }, blackout: false,
      inventory: {}, storageCap: 0,
      pnj: { count: 1, capacity: 0 },
      unlocked: [], abilities: [], buildable: [], modules: [], ships: []
    };
  }

  function ringWalls(room) {
    const { w, h } = room.size;
    for (let x = 0; x < w; x++) { room.tiles[0][x].wall = createWall('block', 0); room.tiles[h - 1][x].wall = createWall('block', 0); }
    for (let y = 0; y < h; y++) { room.tiles[y][0].wall = createWall('block', 0); room.tiles[y][w - 1].wall = createWall('block', 0); }
  }

  // ---- normalización (entrada de datos externos: archivos, editor) ---------
  // C1 aplicado: una pared guardada NUNCA puede quedar con colisión parcial.
  function normalizeWall(w) {
    if (!w || typeof w !== 'object') return null;
    return { kind: WALL_KINDS.includes(w.kind) ? w.kind : 'block', orientation: ((Number(w.orientation) || 0) % 360 + 360) % 360, collision: 'full' };
  }
  function normalizeTile(t) {
    if (!t || typeof t !== 'object') return createTile('void');
    return { floor: FLOORS[t.floor] ? t.floor : (t.floor === 'void' ? 'void' : 'deck'), wall: normalizeWall(t.wall) };
  }
  function normalizeRoom(r) {
    const room = createRoom(r && r.name, r && r.size && r.size.w, r && r.size && r.size.h);
    if (r && r.id) room.id = String(r.id);
    if (r && r.bpId) room.bpId = String(r.bpId);
    if (r && r.hangar === true) room.hangar = true;                       // K2: marcador de hangar
    if (r && typeof r.shipCap === 'number') room.shipCap = r.shipCap;     // K2: capacidad de naves (seteable)
    if (r && r.transform) room.transform = {
      x: Number(r.transform.x) || 0, y: Number(r.transform.y) || 0,
      rotation: ((Number(r.transform.rotation) || 0) % 360 + 360) % 360,
      pivot: r.transform.pivot || { x: room.size.w / 2, y: room.size.h / 2 }
    };
    if (r && Array.isArray(r.tiles)) {
      for (let y = 0; y < room.size.h; y++) for (let x = 0; x < room.size.w; x++) room.tiles[y][x] = normalizeTile(r.tiles[y] && r.tiles[y][x]);
    }
    room.objects = (r && Array.isArray(r.objects) ? r.objects : []).map(o => {
      const inst = createObjectInstance(o.type, o.x, o.y);
      if (o.id) inst.id = String(o.id);
      if (o.shipId) inst.shipId = String(o.shipId);                       // K2: vínculo placeholder↔nave
      inst.rotation = ((Number(o.rotation) || 0) % 360 + 360) % 360;
      inst.open = !!o.open;
      return inst;
    }).filter(o => o.x >= 0 && o.y >= 0 && o.x < room.size.w && o.y < room.size.h);
    room.events = (r && Array.isArray(r.events) ? r.events : []).map(e => Object.assign(createRoomEvent(e.name), e, { id: e.id ? String(e.id) : CORE.uid('evt') }));
    return room;
  }
  function normalizeNexo(n) {
    const nexo = createNexo(n && n.name);
    if (n && n.id) nexo.id = String(n.id);
    nexo.rooms = (n && Array.isArray(n.rooms) ? n.rooms : []).map(normalizeRoom);
    if (!nexo.rooms.length) nexo.rooms.push(createRoom('Room 1', 8, 8));
    nexo.entry = n && n.entry && nexo.rooms.some(r => r.id === n.entry.roomId)
      ? { roomId: String(n.entry.roomId), x: n.entry.x | 0, y: n.entry.y | 0 }
      : { roomId: nexo.rooms[0].id, x: 1, y: 1 };
    nexo.logic = (n && n.logic && typeof n.logic === 'object') ? n.logic : {};
    return nexo;
  }
  function normalizeStation(s) {
    if (!s || typeof s !== 'object') throw new Error('not a station save');
    const out = { formatVersion: SAVE_FORMAT, name: String(s.name || 'Untitled Station'), nexos: [], links: [], startNexoId: null };
    out.nexos = (Array.isArray(s.nexos) ? s.nexos : []).map(normalizeNexo);
    if (!out.nexos.length) out.nexos.push(normalizeNexo(null));
    out.links = (Array.isArray(s.links) ? s.links : []).filter(k =>
      k && k.from && k.to && out.nexos.some(n => n.id === k.from.nexoId) && out.nexos.some(n => n.id === k.to.nexoId)
    ).map(k => ({
      id: k.id ? String(k.id) : CORE.uid('link'), kind: k.kind || 'elevator', bidirectional: k.bidirectional !== false,
      from: { nexoId: String(k.from.nexoId), roomId: k.from.roomId || null, x: k.from.x | 0, y: k.from.y | 0 },
      to:   { nexoId: String(k.to.nexoId),   roomId: k.to.roomId || null,   x: k.to.x | 0,   y: k.to.y | 0 }
    }));
    out.startNexoId = out.nexos.some(n => n.id === s.startNexoId) ? s.startNexoId : out.nexos[0].id;
    out.state = normalizeState(s.state);
    out.moduleLibrary = (Array.isArray(s.moduleLibrary) ? s.moduleLibrary : []).map(normalizeModuleBlueprint);
    return out;
  }

  // estado estratégico: reparar/completar lo que falte (saves viejos o rotos)
  function normalizeState(st) {
    const base = createState();
    if (!st || typeof st !== 'object') return base;
    const out = Object.assign(base, st);
    out.cred = Number(out.cred) || 0;
    out.phase = CORE.clamp(Number(out.phase) || 1, 1, 4);
    out.energy = { capacity: Number(out.energy && out.energy.capacity) || 0, used: Number(out.energy && out.energy.used) || 0 };
    out.inventory = (out.inventory && typeof out.inventory === 'object') ? out.inventory : {};
    out.pnj = { count: Number(out.pnj && out.pnj.count) || 0, capacity: Number(out.pnj && out.pnj.capacity) || 0 };
    for (const k of ['unlocked', 'abilities', 'buildable', 'modules', 'ships']) if (!Array.isArray(out[k])) out[k] = [];
    return out;
  }

  return {
    SAVE_FORMAT, NEXO_SLOTS, FLOORS, WALL_KINDS, OBJECT_DEFS,
    createTile, createWall, createObjectInstance, createRoomEvent, createRoom, createNexo, createLink, createStation, createState, ringWalls,
    createModuleBlueprint, normalizeModuleBlueprint, normalizeModuleLibraryInput,
    normalizeWall, normalizeTile, normalizeRoom, normalizeNexo, normalizeStation, normalizeState
  };
});
