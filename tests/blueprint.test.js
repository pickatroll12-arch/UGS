/* UGS — tests de la suite Dev de diseño (core/data blueprints + engine/blueprint).
   Los blueprints/defs usados aquí son FIXTURES DE TEST, no contenido del juego:
   el contenido F1 del árbol humano es OBJP-1.1 (congelado).
   node tests/blueprint.test.js */
'use strict';
const CORE = require('../src/core/core.js');
const RNG = require('../src/core/rng.js');
const D = require('../src/core/data.js');
const S = require('../src/core/save.js');
const ST = require('../src/engine/station.js');
const BP = require('../src/engine/blueprint.js');

let passed = 0, failed = 0;
const check = (n, c) => { if (c) { passed++; console.log('  ok  ', n); } else { failed++; console.error('  FAIL', n); } };

console.log('UGS blueprint/devsuite tests\n');

// ---- modelo: createModuleBlueprint -------------------------------------------
{
  const bp = D.createModuleBlueprint({ name: 'Almacén T', w: 6, h: 4, cost: 200, energyUse: 5, provides: { storage: 30 } });
  check('blueprint: id bp-* y nombre', /^bp-/.test(bp.id) && bp.name === 'Almacén T');
  check('blueprint: sala del tamaño pedido', bp.room.size.w === 6 && bp.room.size.h === 4);
  check('blueprint: nace con muros perimetrales', bp.room.tiles[0][0].wall && bp.room.tiles[3][5].wall && !bp.room.tiles[1][1].wall);
  check('blueprint: metadatos', bp.cost === 200 && bp.energyUse === 5 && bp.provides.storage === 30 && bp.provides.energy === 0);
  const bad = D.createModuleBlueprint({ cost: -50, energyUse: -1 });
  check('blueprint: costes negativos se claman a 0', bad.cost === 0 && bad.energyUse === 0);
  check('blueprint: categoría por defecto general', bad.category === 'general' && bad.notes === '');
}

// ---- modelo: normalizeModuleBlueprint + moduleLibrary en save -----------------
{
  const bp = D.createModuleBlueprint({ name: 'Hab T', w: 5, h: 5, provides: { pnjCapacity: 12 } });
  bp.room.objects.push(D.createObjectInstance('plant', 2, 2));
  const n = D.normalizeModuleBlueprint(JSON.parse(JSON.stringify(bp)));
  check('normalize blueprint: conserva id/nombre/provides', n.id === bp.id && n.name === 'Hab T' && n.provides.pnjCapacity === 12);
  check('normalize blueprint: sala y objetos sobreviven', n.room.size.w === 5 && n.room.objects.length === 1 && n.room.objects[0].type === 'plant');
  const junk = D.normalizeModuleBlueprint(null);
  check('normalize blueprint: basura → blueprint válido', /^bp-/.test(junk.id) && junk.room.size.w >= 1);

  const st = D.createStation('T');
  st.moduleLibrary.push(bp);
  const rt = S.deserialize(S.serialize(st));
  check('save round-trip conserva moduleLibrary', rt.moduleLibrary.length === 1 && rt.moduleLibrary[0].id === bp.id);
  const old = S.deserialize(JSON.stringify({ name: 'vieja', nexos: [], links: [] }));
  check('save viejo sin moduleLibrary → []', Array.isArray(old.moduleLibrary) && old.moduleLibrary.length === 0);
  check('NEXO_SLOTS = 3 (tope de diseño, 1 por fase)', D.NEXO_SLOTS === 3);
}

// ---- ops: suelo por rectángulo -------------------------------------------------
{
  const r = D.createRoom('r', 8, 6);
  const n = BP.paintFloorRect(r, 2, 1, 5, 3, 'dark');
  check('paintFloorRect: pinta el rectángulo', n === 12 && r.tiles[2][4].floor === 'dark');
  check('paintFloorRect: fuera no se toca', r.tiles[0][0].floor === 'deck');
  r.tiles[4][4].wall = D.createWall('block', 0);
  const m = BP.paintFloorRect(r, 4, 4, 4, 4, 'light');
  check('paintFloorRect: no pisa tiles con pared', m === 0 && r.tiles[4][4].floor === 'deck');
  const c = BP.paintFloorRect(r, -3, -3, 1, 1, 'light');
  check('paintFloorRect: clampa coords fuera de rango', c === 4 && r.tiles[0][0].floor === 'light');
  check('paintFloorRect: suelo inválido = 0', BP.paintFloorRect(r, 0, 0, 2, 2, 'neon') === 0);
}

// ---- ops: contorno de pared -----------------------------------------------------
{
  const r = D.createRoom('r', 10, 8);
  BP.eraseRect(r, 0, 0, 9, 7);                                  // todo void
  const n = BP.paintWallOutline(r, 2, 1, 7, 6, 'block', 0);
  check('paintWallOutline: perímetro = 2(w+h)-4', n === 2 * (6 + 6) - 4);
  check('paintWallOutline: esquina con pared', !!r.tiles[1][2].wall);
  check('paintWallOutline: interior sin pared', !r.tiles[3][3].wall);
  check('paintWallOutline: void→deck bajo la pared', r.tiles[1][2].floor === 'deck');
  check('paintWallOutline: 1x1 = una sola pared', BP.paintWallOutline(r, 0, 0, 0, 0, 'block', 0) === 1 && !!r.tiles[0][0].wall);
}

// ---- ops: borrado por rectángulo --------------------------------------------------
{
  const r = D.createRoom('r', 6, 6);
  D.ringWalls(r);
  r.objects.push(D.createObjectInstance('console', 2, 2));
  const n = BP.eraseRect(r, 1, 1, 3, 3);
  check('eraseRect: elimina objetos del rect', !r.objects.length && n >= 1);
  check('eraseRect: interior a void', r.tiles[2][2].floor === 'void' && !r.tiles[2][2].wall);
  check('eraseRect: muro perimetral intacto fuera del rect', !!r.tiles[0][0].wall);
}

// ---- ops: bote de relleno ----------------------------------------------------------
{
  const r = D.createRoom('r', 8, 8);
  D.ringWalls(r);
  const n = BP.floodFillFloor(r, 3, 3, 'light');
  check('floodFill: rellena el interior contiguo (6x6)', n === 36 && r.tiles[5][5].floor === 'light');
  check('floodFill: no cruza paredes', r.tiles[0][0].floor === 'deck');
  check('floodFill: mismo color = 0', BP.floodFillFloor(r, 3, 3, 'light') === 0);
  check('floodFill: empezar en pared = 0', BP.floodFillFloor(r, 0, 0, 'dark') === 0);
  // región partida por pared interna
  const r2 = D.createRoom('r2', 8, 8);
  D.ringWalls(r2);
  for (let y = 1; y < 7; y++) r2.tiles[y][4].wall = D.createWall('block', 0);
  const m = BP.floodFillFloor(r2, 2, 2, 'dark');
  check('floodFill: se detiene en pared interna (3x6)', m === 18 && r2.tiles[2][6].floor === 'deck');
}

// ---- ops: redimensión / limpieza ------------------------------------------------------
{
  const r = D.createRoom('r', 6, 6);
  D.ringWalls(r);
  r.objects.push(D.createObjectInstance('console', 3, 3));
  BP.resizeRoom(r, 10, 8);
  check('resizeRoom grow: tamaño nuevo', r.size.w === 10 && r.size.h === 8);
  check('resizeRoom grow: contenido recentrado', r.objects[0].x === 5 && r.objects[0].y === 4 && !!r.tiles[2][2].wall);
  check('resizeRoom grow: pivot actualizado', r.transform.pivot.x === 5 && r.transform.pivot.y === 4);
  r.objects[0].x = 9; r.objects[0].y = 7;               // esquina lejana: al encoger cae fuera
  BP.resizeRoom(r, 4, 4);
  check('resizeRoom shrink: objeto fuera se pierde', r.objects.length === 0);
  const before = JSON.stringify(r.size);
  BP.resizeRoom(r, 4, 4);
  check('resizeRoom mismo tamaño = no-op', JSON.stringify(r.size) === before);
  BP.clearRoom(r);
  check('clearRoom: todo void y sin objetos', r.tiles.flat().every(t => t.floor === 'void' && !t.wall) && r.objects.length === 0);
}

// ---- snapshots (deshacer/rehacer) -------------------------------------------------------
{
  const r = D.createRoom('r', 6, 6);
  const id = r.id;
  const snap = BP.snapshotRoom(r);
  BP.paintWallOutline(r, 0, 0, 5, 5, 'block', 0);
  BP.restoreRoom(r, snap);
  check('snapshot/restore: vuelve al estado previo', !r.tiles[0][0].wall && r.tiles[0][0].floor === 'deck');
  check('snapshot/restore: conserva el id de sala', r.id === id);
}

// ---- puente a capa estratégica ------------------------------------------------------------
{
  const bus = new CORE.EventBus();
  const st = ST.create({ bus, rng: RNG.create('t') });
  const station = D.createStation('T');
  station.state.cred = 1000;
  const nexo = station.nexos[0];
  // hub del nexo en (0,0) de 4x4 → el módulo debe tocar una arista
  nexo.rooms = [];
  const hub = D.createRoom('hub', 4, 4); D.ringWalls(hub);
  hub.transform.x = 0; hub.transform.y = 0;
  nexo.rooms.push(hub);

  const bp = D.createModuleBlueprint({ name: 'Gen T', w: 3, h: 3, cost: 100, energyUse: 0, provides: { energy: 50 } });
  const def = BP.toModuleDef(bp);
  check('toModuleDef: campos mapeados + layout', def.id === bp.id && def.cost === 100 && def.provides.energy === 50 && !!def.layout);
  st.defineModule(Object.assign({ free: true }, def));   // free: el fixture no exige hito

  const room1 = BP.instantiateRoom(bp, { x: 4, y: 0 });  // arista compartida con hub (x=4)
  check('instantiateRoom: id fresco y posición', room1.id !== bp.room.id && room1.transform.x === 4);
  const res = st.placeModule(station, nexo, def.id, room1);
  check('placeModule acepta sala de blueprint conectada', res.ok === true);
  check('placeModule: energía recomputada', station.state.energy.capacity === 50);

  const room2 = BP.instantiateRoom(bp, { x: 20, y: 20 }); // lejos: sin arista
  const res2 = st.placeModule(station, nexo, def.id, room2);
  check('placeModule rechaza blueprint desconectado', !res2.ok && /conexión/.test(res2.reason));
  check('dos instancias del mismo blueprint → ids distintos', room1.id !== room2.id);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
