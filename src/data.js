/*
 * UGS — core data model  (Stage 1 · Milestone 1)
 * ------------------------------------------------------------------
 * Pure data layer: schemas, factories, registries and validation.
 * No rendering, no DOM, no game logic — this is the shape of the world
 * and the contract every other layer (engine, editor, renderer) builds on.
 *
 * Coordinate model (important):
 *   SaveFile ─▶ Level ─▶ Room ─▶ Tile / ObjectInstance
 *   - Tiles and objects live in ROOM-LOCAL coordinates.
 *   - Each Room carries a `transform` (offset + rotation + pivot), so a room
 *     can be shifted / rotated / carouselled without touching its contents.
 *   - The engine composes rooms into world space each frame.
 *
 * Runs both in the browser (attaches to window.UGS.data) and in Node
 * (module.exports) so the core can be unit-tested headlessly.
 */
(function (root, factory) {
  const api = factory();
  root.UGS = root.UGS || {};
  root.UGS.data = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Bump when the on-disk shape changes in a non-backward-compatible way.
  const FORMAT = 'ugs-station';
  const FORMAT_VERSION = 2;   // v2: walls are pieces {kind,orientation,collision,material} (R2-06)

  // ---- small helpers ------------------------------------------------------
  let idSeq = 0;
  function uid(prefix) {
    idSeq += 1;
    return `${prefix}-${Date.now().toString(36)}-${idSeq.toString(36)}`;
  }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
  function str(v, fallback = '') { return v == null ? fallback : String(v); }
  function bool(v, fallback = false) { return v == null ? fallback : Boolean(v); }

  // ---- registries ---------------------------------------------------------
  // Materials are "slots": today they render as flat colours; later the same
  // id maps to a texture, with NO change to any saved map. That is how we keep
  // "polish the graphics later" honest — data references an id, not a look.
  const MATERIALS = {
    deck:     { id: 'deck',     label: 'Deck',      kind: 'floor', color: '#2d2d31', line: '#414147' },
    dark:     { id: 'dark',     label: 'Dark',      kind: 'floor', color: '#222225', line: '#37373d' },
    light:    { id: 'light',    label: 'Light',     kind: 'floor', color: '#3b3b40', line: '#53535a' },
    roundPad: { id: 'roundPad', label: 'Round pad', kind: 'floor', color: '#29292d', line: '#45454b' },
    service:  { id: 'service',  label: 'Service',   kind: 'floor', color: '#25262d', line: '#424755' },
    catwalk:  { id: 'catwalk',  label: 'Catwalk',   kind: 'floor', color: '#33333a', line: '#6d6d78', raised: true },
    hull:     { id: 'hull',     label: 'Hull',      kind: 'wall',  color: '#494950', line: '#5c5c64' },
    glass:    { id: 'glass',    label: 'Glass',     kind: 'wall',  color: '#4a5a66', line: '#8fb0c4', glass: true }
  };

  // Wall shapes are geometry, independent of material.
  // Legacy (format v1): a plain string 'solid' | 'diagA' | 'diagB'.
  const WALL_SHAPES = ['solid', 'diagA', 'diagB'];
  // R2-06: a wall is now a piece — { kind, orientation, collision, material }.
  //   kind        : 'block' | 'diagonal' | 'rounded'
  //   orientation : 0..315 in 45° steps (which corner a diagonal/rounded cuts)
  //   collision   : 'full' | 'partial'   (Phase 1 keeps 'full'; nav treats any
  //                 wall as blocking until partial-collision nav lands)
  //   material    : wall material id ('hull' | 'glass')
  const WALL_KINDS = ['block', 'diagonal', 'rounded'];
  // legacy string → piece
  const LEGACY_WALL = {
    solid: { kind: 'block', orientation: 0 },
    diagA: { kind: 'diagonal', orientation: 0 },     // "/"
    diagB: { kind: 'diagonal', orientation: 90 }     // "\"
  };
  function isWallKind(k) { return WALL_KINDS.indexOf(k) !== -1; }

  function createWall(kind, orientation, material, collision) {
    const k = isWallKind(kind) ? kind : 'block';
    // A block fills the tile (full collision); diagonal/rounded pieces occupy
    // only part of it, so they default to partial collision (nav lets a pawn
    // pass the open side — R2-06 phase 2). An explicit value always wins.
    const col = collision ? (collision === 'partial' ? 'partial' : 'full') : (k === 'block' ? 'full' : 'partial');
    return { kind: k, orientation: snapAngle(orientation), collision: col, material: isMaterial(material) ? material : 'hull' };
  }
  // Coerce any stored/legacy wall value into a piece (or null). `legacyMat` is
  // the old sibling tile.wallMaterial, folded into the piece when upgrading.
  function normalizeWall(raw, legacyMat) {
    if (!raw) return null;
    if (typeof raw === 'string') {
      const L = LEGACY_WALL[raw]; if (!L) return null;
      return createWall(L.kind, L.orientation, isMaterial(legacyMat) ? legacyMat : 'hull');   // collision defaults by kind
    }
    if (typeof raw === 'object') {
      if (!isWallKind(raw.kind)) return null;
      return createWall(raw.kind, raw.orientation, isMaterial(raw.material) ? raw.material : legacyMat, raw.collision);
    }
    return null;
  }
  // does a wall block movement? (Phase 1: any wall blocks; partial nav is Phase 2)
  function wallBlocks(wall) { return !!wall; }

  // Build layers — used to toggle visibility and filter selection.
  const LAYERS = ['structural', 'decor', 'electrical', 'traversal'];

  // Object catalogue. `category`: interactive | decorative | functional | structural.
  // `layer` groups objects for the layer toggles. `openable` marks doors/airlocks
  // (they carry an `open` state; collision applies only while closed). `vlink`
  // marks vertical-traversal anchors (stairs/ladders/ramps/elevator) that Stage 1
  // M5 will bind to actual level links. `power`/`heat` are reserved subsystem
  // fields (Stage 4) so the format never has to churn.
  const OBJECT_DEFS = {
    console:  { type: 'console',  label: 'Console',       category: 'interactive', layer: 'electrical', collision: true,  interactive: true,  power: 2, heat: 1 },
    crate:    { type: 'crate',    label: 'Storage crate', category: 'functional',  layer: 'decor',      collision: true,  interactive: false, power: 0, heat: 0 },
    light:    { type: 'light',    label: 'Wall light',    category: 'decorative',  layer: 'electrical', collision: false, interactive: false, power: 1, heat: 0 },
    plant:    { type: 'plant',    label: 'Plant',         category: 'decorative',  layer: 'decor',      collision: false, interactive: false, power: 0, heat: 0 },
    elevator: { type: 'elevator', label: 'Elevator pad',  category: 'functional',  layer: 'traversal',  collision: false, interactive: true,  power: 3, heat: 1, vlink: true },
    miner:    { type: 'miner',    label: 'Mining rig',    category: 'functional',  layer: 'electrical', collision: true,  interactive: true,  power: 5, heat: 4 },
    pillar:   { type: 'pillar',   label: 'Pillar',        category: 'structural',  layer: 'structural', collision: true,  interactive: false, power: 0, heat: 0 },
    door:     { type: 'door',     label: 'Door',          category: 'interactive', layer: 'structural', collision: true,  interactive: true,  power: 1, heat: 0, openable: true },
    airlock:  { type: 'airlock',  label: 'Airlock',       category: 'interactive', layer: 'structural', collision: true,  interactive: true,  power: 2, heat: 0, openable: true },
    stairs:   { type: 'stairs',   label: 'Stairs',        category: 'functional',  layer: 'traversal',  collision: false, interactive: true,  power: 0, heat: 0, vlink: true },
    ladder:   { type: 'ladder',   label: 'Ladder',        category: 'functional',  layer: 'traversal',  collision: false, interactive: true,  power: 0, heat: 0, vlink: true },
    ramp:     { type: 'ramp',     label: 'Ramp',          category: 'functional',  layer: 'traversal',  collision: false, interactive: true,  power: 0, heat: 0, vlink: true }
  };

  function isMaterial(id) { return Object.prototype.hasOwnProperty.call(MATERIALS, id); }
  function isObjectType(t) { return Object.prototype.hasOwnProperty.call(OBJECT_DEFS, t); }
  function isWallShape(s) { return WALL_SHAPES.indexOf(s) !== -1; }
  function isLayer(l) { return LAYERS.indexOf(l) !== -1; }

  // ---- factories ----------------------------------------------------------
  // 'void' is a valid floor sentinel meaning "no floor" (not rendered, not
  // walkable) — used by the erase tool. It is not a material in the registry.
  function isFloor(id) { return id === 'void' || isMaterial(id); }

  function createTile(floor = 'deck') {
    return { floor: isFloor(floor) ? floor : 'deck', wall: null };
  }

  // Authoring rotation step (degrees). Objects, rooms, and gizmo handles all
  // snap to this; it divides 360 evenly and keeps legacy 0/90/180/270 valid.
  const ROT_STEP = 45;
  function snapAngle(deg) { return ((Math.round(num(deg) / ROT_STEP) * ROT_STEP) % 360 + 360) % 360; }

  function createTransform(x = 0, y = 0, rotation = 0) {
    // rotation is stored in degrees, snapped to the 45° authoring step.
    return { x: num(x), y: num(y), rotation: snapAngle(rotation), pivot: { x: 0, y: 0 } };
  }

  function createRoom(name = 'Room', w = 8, h = 8) {
    w = clamp(Math.round(num(w, 8)), 1, 64);
    h = clamp(Math.round(num(h, 8)), 1, 64);
    return {
      id: uid('room'),
      name: str(name, 'Room'),
      size: { w, h },
      transform: createTransform(0, 0, 0),
      // local-coordinate grid [h][w]
      tiles: Array.from({ length: h }, () => Array.from({ length: w }, () => createTile())),
      objects: [],
      movable: false,
      events: []      // RoomEvent[] — shift / rotate / carousel / script
    };
  }

  // R2-05: free-form room shapes. A cell is "outside" the room when its floor is
  // 'void'; presets stamp such cut-outs into the bounding-box grid so a room can
  // be a corridor, L, T or U without changing the storage model (the cell-set
  // storage refactor is a later refinement). shapeMask(w,h,shape) returns a
  // boolean grid [y][x] — true = inside the shape. Pure and testable.
  const ROOM_SHAPES = ['rect', 'corridor', 'L', 'T', 'U'];
  function shapeMask(w, h, shape) {
    w = clamp(Math.round(num(w, 1)), 1, 64); h = clamp(Math.round(num(h, 1)), 1, 64);
    const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
    const armW = Math.max(1, Math.ceil(w / 3)), barH = Math.max(1, Math.ceil(h / 3));
    const inside = (x, y) => {
      switch (shape) {
        case 'corridor': return y === cy || (h > 1 && y === cy - 1);         // 2-tall horizontal band
        case 'L': return !(x > cx && y < cy);                                // drop the top-right block
        case 'T': return y < barH || x === cx || (w > 1 && x === cx - 1);    // top bar + centre stem
        case 'U': return x < armW || x >= w - armW || y >= h - barH;         // two arms + bottom bar
        case 'rect': default: return true;
      }
    };
    const m = [];
    for (let y = 0; y < h; y++) { const row = []; for (let x = 0; x < w; x++) row.push(inside(x, y)); m.push(row); }
    return m;
  }

  // Resize a room's tile grid, preserving overlapping content.
  //
  //   resizeRoom(room, newW, newH, opts) -> result
  //     opts.anchor : 'nw' | 'center' | 'se'  (where old content stays put)
  //     opts.fill   : floor id for newly exposed tiles (default 'deck')
  //     opts.force  : when shrinking would drop objects, only actually drop
  //                   them if force===true; otherwise abort untouched.
  //     opts.dryRun : assess only — never mutate the room. Returns the same
  //                   result shape (wouldDrop / trimmedTiles / trimmedWalls /
  //                   pivotClamped / offset) so the caller can preview a
  //                   destructive resize and decide before committing.
  //
  // The function is pure w.r.t. the caller's decision-making: when it would
  // lose objects and force is not set (or dryRun is set), it does NOT mutate the
  // room, so the editor can warn/confirm first WITHOUT pushing an undo entry. On
  // a real commit it mutates the room (tiles, size, object coords, pivot) and
  // returns the applied { dx, dy } offset plus structured counts of what was
  // trimmed so the caller can report it (localized) and repair external
  // references (level entry, links, selection).
  function resizeRoom(room, newW, newH, opts) {
    opts = opts || {};
    const anchor = opts.anchor || 'nw';
    const fill = isFloor(opts.fill) ? opts.fill : 'deck';
    const oldW = room.size.w, oldH = room.size.h;
    newW = clamp(Math.round(num(newW, oldW)), 1, 64);
    newH = clamp(Math.round(num(newH, oldH)), 1, 64);

    // offset mapping old (x,y) -> new (x+dx, y+dy). Anchor is per-axis: ax/ay in
    // {'lo','mid','hi'} say which edge stays fixed on each axis. The string
    // `anchor` (nw/center/se) is a shorthand; explicit opts.ax/opts.ay win. Edge
    // and corner handles (R2-04) use the per-axis form (e.g. west edge = ax:'hi').
    const axMap = { nw: 'lo', center: 'mid', se: 'hi' };
    const ax = opts.ax || axMap[anchor] || 'lo';
    const ay = opts.ay || axMap[anchor] || 'lo';
    const off = (a, delta) => a === 'hi' ? delta : (a === 'mid' ? Math.floor(delta / 2) : 0);
    const dx = off(ax, newW - oldW), dy = off(ay, newH - oldH);

    const inBounds = (x, y) => x >= 0 && y >= 0 && x < newW && y < newH;

    // assess: objects that would fall outside, and floor/wall tiles trimmed
    const wouldDrop = room.objects.filter(o => !inBounds(o.x + dx, o.y + dy));
    let trimmedTiles = 0, trimmedWalls = 0;
    for (let y = 0; y < oldH; y++) {
      for (let x = 0; x < oldW; x++) {
        if (inBounds(x + dx, y + dy)) continue;
        const src = room.tiles[y][x]; if (!src) continue;
        if (src.wall) trimmedWalls++;
        if (src.floor && src.floor !== 'void') trimmedTiles++;
      }
    }
    const pivotP = room.transform && room.transform.pivot;
    const pivotClamped = !!pivotP && (clamp(num(pivotP.x) + dx, 0, newW) !== pivotP.x || clamp(num(pivotP.y) + dy, 0, newH) !== pivotP.y);

    const warnings = [];
    if (trimmedTiles || trimmedWalls) warnings.push(`${trimmedTiles + trimmedWalls} tile(s) trimmed off the edge`);
    if (pivotClamped) warnings.push('rotation pivot clamped to new bounds');

    const assessment = { wouldDrop, dropped: [], offset: { dx, dy }, newW, newH, trimmedTiles, trimmedWalls, pivotClamped, warnings };

    // abort untouched when it would lose objects (unless forced) or on a dry run
    if (opts.dryRun) return Object.assign({ ok: !wouldDrop.length }, assessment);
    if (wouldDrop.length && !opts.force) return Object.assign({ ok: false }, assessment);

    // commit: mutate the room
    const grid = Array.from({ length: newH }, () => Array.from({ length: newW }, () => createTile(fill)));
    for (let y = 0; y < oldH; y++) {
      for (let x = 0; x < oldW; x++) {
        const nx = x + dx, ny = y + dy;
        if (inBounds(nx, ny)) { const s = room.tiles[y][x]; grid[ny][nx] = { floor: s.floor, wall: (s.wall && typeof s.wall === 'object') ? Object.assign({}, s.wall) : (s.wall || null) }; }
      }
    }
    room.tiles = grid;
    room.size = { w: newW, h: newH };
    const dropped = wouldDrop;
    if (dropped.length) room.objects = room.objects.filter(o => inBounds(o.x + dx, o.y + dy));
    for (const o of room.objects) { o.x += dx; o.y += dy; }
    if (pivotP) room.transform.pivot = { x: clamp(num(pivotP.x) + dx, 0, newW), y: clamp(num(pivotP.y) + dy, 0, newH) };

    return Object.assign({ ok: true }, assessment, { wouldDrop: [], dropped });
  }

  function createObjectInstance(type, x, y) {
    const def = OBJECT_DEFS[type] || OBJECT_DEFS.crate;
    const inst = {
      id: uid('obj'),
      type: def.type,
      name: def.label,
      x: Math.round(num(x)),
      y: Math.round(num(y)),
      rotation: 0,
      layer: def.layer,
      interactive: def.interactive,
      collision: def.collision,
      power: def.power,
      heat: def.heat,
      properties: {}
    };
    if (def.openable) inst.open = false;          // doors/airlocks start closed
    return inst;
  }

  // Effective collision accounts for door/airlock open state.
  function objectBlocks(obj) {
    const def = OBJECT_DEFS[obj.type];
    if (def && def.openable) return !obj.open;
    return !!obj.collision;
  }

  // A RoomEvent moves/animates a room. `action` is either a preset or a script.
  //   preset.kind: 'shift'    { to:{x,y}, duration }
  //                'rotate'   { by:90, duration }
  //                'carousel' { poses:[{x,y,rotation}...], interval, loop }
  //   script: steps[] mini-DSL, e.g. [{op:'move',x,y,duration},{op:'wait',t},...]
  function createRoomEvent(name = 'Event') {
    return {
      id: uid('evt'),
      name: str(name, 'Event'),
      enabled: true,
      trigger: { type: 'manual' },      // manual | time | signal
      action: { kind: 'shift', to: { x: 0, y: 0 }, duration: 1.0 },
      loop: false
    };
  }

  // A Link is an edge in the level graph — an elevator/door/etc. connecting a
  // source tile to a spawn point, possibly in another level.
  //   mode: 'preload' (target kept in memory) | 'stream' (load on demand)
  function createLink(fromLevelId, toLevelId) {
    return {
      id: uid('link'),
      kind: 'elevator',                 // elevator | door | hatch | ...
      mode: 'stream',
      bidirectional: true,
      from: { levelId: str(fromLevelId), roomId: null, x: 0, y: 0 },
      to:   { levelId: str(toLevelId),   roomId: null, x: 0, y: 0 }
    };
  }

  function createLevel(name = 'Level') {
    const room = createRoom('Main', 12, 10);
    return {
      id: uid('level'),
      name: str(name, 'Level'),
      rooms: [room],
      entry: { roomId: room.id, x: 2, y: 2 },
      metadata: {}
    };
  }

  // The SaveFile is the whole package: a graph of levels plus global data.
  function createSaveFile(name = 'Untitled Station') {
    const level = createLevel('Deck 1');
    return {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      id: uid('save'),
      name: str(name, 'Untitled Station'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startLevelId: level.id,
      // deterministic world seed — feeds the core RNG so procedural content,
      // A-life, and mid-sim saves replay identically.
      seed: (Math.random() * 0xffffffff) >>> 0,
      levels: [level],
      links: [],
      // reserved for later stages (crew roster, resources, flags). Kept out of
      // the way now but declared so the format doesn't churn later.
      reserved: { crew: [], resources: {}, flags: {} },
      metadata: { createdBy: 'ugs-core', engine: FORMAT_VERSION }
    };
  }

  // ---- validation / normalisation ----------------------------------------
  // normalizeSave() takes untrusted input (an imported file, hand-edited JSON)
  // and returns a clean, fully-formed SaveFile, collecting warnings for
  // anything it had to coerce or drop. It never throws on recoverable issues.
  function normalizeSave(input) {
    const warnings = [];
    if (!isObj(input)) throw new Error('Save file is not an object.');

    const out = createSaveFile(str(input.name, 'Imported Station'));
    out.id = str(input.id, out.id);
    out.formatVersion = FORMAT_VERSION;
    if (input.seed != null && Number.isFinite(Number(input.seed))) out.seed = Number(input.seed) >>> 0;
    if (input.createdAt) out.createdAt = str(input.createdAt);
    out.updatedAt = new Date().toISOString();
    if (isObj(input.reserved)) out.reserved = { ...out.reserved, ...input.reserved };
    if (isObj(input.metadata)) out.metadata = { ...out.metadata, ...input.metadata };

    const levels = Array.isArray(input.levels) ? input.levels : [];
    if (!levels.length) {
      warnings.push('No levels found; created an empty Deck 1.');
      return { save: out, warnings };
    }

    out.levels = levels.map((lvl, li) => normalizeLevel(lvl, li, warnings));

    // links: keep only those whose endpoints resolve to real levels
    const levelIds = new Set(out.levels.map(l => l.id));
    const rawLinks = Array.isArray(input.links) ? input.links : [];
    out.links = rawLinks
      .map(lk => normalizeLink(lk))
      .filter(lk => {
        const ok = levelIds.has(lk.from.levelId) && levelIds.has(lk.to.levelId);
        if (!ok) warnings.push(`Dropped link ${lk.id}: endpoint level missing.`);
        return ok;
      });

    // start level must exist
    out.startLevelId = levelIds.has(str(input.startLevelId)) ? str(input.startLevelId) : out.levels[0].id;
    return { save: out, warnings };
  }

  function normalizeLevel(input, index, warnings) {
    const lvl = { id: uid('level'), name: `Level ${index + 1}`, rooms: [], entry: null, metadata: {} };
    if (!isObj(input)) { warnings.push(`Level ${index} was not an object; replaced with empty.`); lvl.rooms = [createRoom()]; lvl.entry = { roomId: lvl.rooms[0].id, x: 0, y: 0 }; return lvl; }
    lvl.id = str(input.id, lvl.id);
    lvl.name = str(input.name, lvl.name);
    if (isObj(input.metadata)) lvl.metadata = { ...input.metadata };

    const rooms = Array.isArray(input.rooms) ? input.rooms : [];
    lvl.rooms = rooms.length ? rooms.map(r => normalizeRoom(r, warnings)) : [createRoom()];

    const roomIds = new Set(lvl.rooms.map(r => r.id));
    const e = isObj(input.entry) ? input.entry : {};
    const entryRoom = roomIds.has(str(e.roomId)) ? str(e.roomId) : lvl.rooms[0].id;
    lvl.entry = { roomId: entryRoom, x: Math.round(num(e.x)), y: Math.round(num(e.y)) };
    return lvl;
  }

  function normalizeRoom(input, warnings) {
    if (!isObj(input)) { warnings.push('A room was not an object; replaced with empty 8x8.'); return createRoom(); }
    const w = clamp(Math.round(num(input.size && input.size.w, 8)), 1, 64);
    const h = clamp(Math.round(num(input.size && input.size.h, 8)), 1, 64);
    const room = createRoom(str(input.name, 'Room'), w, h);
    room.id = str(input.id, room.id);
    room.movable = bool(input.movable, false);

    // transform
    const t = isObj(input.transform) ? input.transform : {};
    room.transform = createTransform(num(t.x), num(t.y), num(t.rotation));
    if (isObj(t.pivot)) room.transform.pivot = { x: num(t.pivot.x), y: num(t.pivot.y) };

    // tiles (local grid)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const src = input.tiles && input.tiles[y] && input.tiles[y][x];
        const floor = src && isFloor(src.floor) ? src.floor : 'deck';
        const wall = src ? normalizeWall(src.wall, src.wallMaterial) : null;
        room.tiles[y][x] = { floor, wall };
      }
    }

    // objects (clamped to local bounds, unknown types dropped)
    const objs = Array.isArray(input.objects) ? input.objects : [];
    room.objects = objs.filter(o => o && isObjectType(o.type)).map(o => {
      const inst = createObjectInstance(o.type, clamp(Math.round(num(o.x)), 0, w - 1), clamp(Math.round(num(o.y)), 0, h - 1));
      const def = OBJECT_DEFS[o.type];
      inst.id = str(o.id, inst.id);
      inst.name = str(o.name, inst.name);
      inst.rotation = snapAngle(o.rotation);
      inst.layer = isLayer(o.layer) ? o.layer : def.layer;
      if (o.interactive != null) inst.interactive = bool(o.interactive);
      if (o.collision != null) inst.collision = bool(o.collision);
      if (o.power != null) inst.power = num(o.power);
      if (o.heat != null) inst.heat = num(o.heat);
      if (def.openable) inst.open = bool(o.open, false);
      if (isObj(o.properties)) inst.properties = { ...o.properties };
      return inst;
    });

    // room events (movement presets / scripts)
    const evs = Array.isArray(input.events) ? input.events : [];
    room.events = evs.filter(isObj).map(ev => normalizeRoomEvent(ev));
    return room;
  }

  function normalizeRoomEvent(input) {
    const ev = createRoomEvent(str(input.name, 'Event'));
    ev.id = str(input.id, ev.id);
    ev.enabled = bool(input.enabled, true);
    ev.loop = bool(input.loop, false);
    if (isObj(input.trigger)) ev.trigger = { type: str(input.trigger.type, 'manual'), ...input.trigger };
    if (isObj(input.action)) {
      const a = input.action;
      const kind = ['shift', 'rotate', 'orbit', 'carousel', 'script'].indexOf(a.kind) !== -1 ? a.kind : 'shift';
      if (kind === 'shift')    ev.action = { kind, to: { x: num(a.to && a.to.x), y: num(a.to && a.to.y) }, duration: num(a.duration, 1) };
      if (kind === 'rotate')   ev.action = { kind, by: num(a.by, 90), duration: num(a.duration, 1) };
      if (kind === 'orbit')    ev.action = { kind, center: { x: num(a.center && a.center.x), y: num(a.center && a.center.y) }, radius: num(a.radius, 5), period: num(a.period, 4), direction: a.direction === 'ccw' ? 'ccw' : 'cw', selfRotate: bool(a.selfRotate, false) };
      if (kind === 'carousel') ev.action = { kind, poses: Array.isArray(a.poses) ? a.poses.map(p => ({ x: num(p.x), y: num(p.y), rotation: num(p.rotation) })) : [], interval: num(a.interval, 2), loop: bool(a.loop, true) };
      if (kind === 'script')   ev.action = { kind, steps: Array.isArray(a.steps) ? a.steps : [] };
    }
    return ev;
  }

  function normalizeLink(input) {
    const lk = createLink('', '');
    if (!isObj(input)) return lk;
    lk.id = str(input.id, lk.id);
    lk.kind = str(input.kind, 'elevator');
    lk.mode = input.mode === 'preload' ? 'preload' : 'stream';
    lk.bidirectional = bool(input.bidirectional, true);
    const f = isObj(input.from) ? input.from : {};
    const t = isObj(input.to) ? input.to : {};
    lk.from = { levelId: str(f.levelId), roomId: f.roomId != null ? str(f.roomId) : null, x: Math.round(num(f.x)), y: Math.round(num(f.y)) };
    lk.to   = { levelId: str(t.levelId), roomId: t.roomId != null ? str(t.roomId) : null, x: Math.round(num(t.x)), y: Math.round(num(t.y)) };
    return lk;
  }

  return {
    FORMAT, FORMAT_VERSION,
    MATERIALS, WALL_SHAPES, WALL_KINDS, LAYERS, OBJECT_DEFS, ROOM_SHAPES, shapeMask,
    isMaterial, isFloor, isObjectType, isWallShape, isWallKind, isLayer, objectBlocks,
    createWall, normalizeWall, wallBlocks,
    uid, clamp, snapAngle, ROT_STEP,
    createTile, createTransform, createRoom, resizeRoom, createObjectInstance,
    createRoomEvent, createLink, createLevel, createSaveFile,
    normalizeSave, normalizeLevel, normalizeRoom, normalizeRoomEvent, normalizeLink
  };
});
