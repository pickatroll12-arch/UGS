/* UGS — tests de engine (nav + engine + agents) y picking del renderizador.
   node tests/engine.test.js */
'use strict';
const D = require('../src/core/data.js');
const R = require('../src/render/render.js');
const NAV = require('../src/engine/nav.js');
const ENG = require('../src/engine/engine.js');
const AGT = require('../src/engine/agents.js');
const BP = require('../src/engine/blueprint.js');

let passed = 0, failed = 0;
const check = (n, c) => { if (c) { passed++; console.log('  ok  ', n); } else { failed++; console.error('  FAIL', n); } };

console.log('UGS engine/nav/agents/render-math tests\n');

function mkRoom(w = 6, h = 6) { return D.createRoom('R', w, h); }

// ---- nav: contratos C1-C3 --------------------------------------------------
{
  const r = mkRoom();
  const path = NAV.findPath(r, 1, 1, 4, 1);
  check('ruta en suelo abierto', Array.isArray(path) && path.length === 3 && path[2].x === 4);
  r.tiles[2][2].wall = D.createWall('diagonal', 45);
  check('C1: pared diagonal bloquea su tile', !NAV.walkable(r, 2, 2));
  r.tiles[2][2].wall = null;
  r.tiles[2][2].floor = 'void';
  check('C3: void no transitable', !NAV.walkable(r, 2, 2));
}
{
  const r = mkRoom();
  r.tiles[2][2].wall = D.createWall('bay', 0);
  check('K2: muralla bay se crea y sigue bloqueando al PCJ (C1)', r.tiles[2][2].wall.kind === 'bay' && !NAV.walkable(r, 2, 2));
  const fp = R.wallFootprintWorld(2.5, 2.5, 'bay', 0);
  check('K2: bay tiene huella propia (4 puntos)', Array.isArray(fp) && fp.length === 4);
  const w2 = D.normalizeWall({ kind: 'bay', orientation: 90 });
  check('K2: normalizeWall conserva bay (save round-trip del kind)', w2.kind === 'bay');
}
{
  const r = mkRoom();
  const door = D.createObjectInstance('door', 3, 1);
  r.objects.push(door);
  check('C2: puerta cerrada bloquea', !NAV.walkable(r, 3, 1));
  door.open = true;
  check('C2: puerta abierta deja pasar', NAV.walkable(r, 3, 1));
  const plant = D.createObjectInstance('plant', 4, 4);
  r.objects.push(plant);
  check('decoración no sólida atraviesa', NAV.walkable(r, 4, 4));
}
{
  const r = mkRoom(5, 3);
  for (let x = 0; x < 5; x++) r.tiles[1][x].wall = D.createWall('block', 0);
  check('sin ruta a través de muro completo → null', NAV.findPath(r, 2, 0, 2, 2) === null);
  const a = NAV.findPath(mkRoom(), 0, 0, 5, 5), b = NAV.findPath(mkRoom(), 0, 0, 5, 5);
  check('rutas deterministas', JSON.stringify(a) === JSON.stringify(b));
}

// ---- render math: proyección ¾ dimétrica (contrato C4) ----------------------
{
  const cam = { x: 100, y: 50, zoom: 1, rot: 0 };
  const s = R.worldToScreen(cam, 2, 3, 0);
  check('¾: eje X sin compresión', s.x === 100 + 2 * R.TILE);
  check('¾: eje Y comprimido por TILT', Math.abs(s.y - (50 + 3 * R.TILE * R.TILT)) < 1e-9);
  check('¾: la altura z sube en pantalla', R.worldToScreen(cam, 0, 0, 1).y === 50 - R.TILE);
  cam.rot = Math.PI / 6;
  const w = R.screenToWorld(cam, ...(() => { const p = R.worldToScreen(cam, 2.5, -1.5, 0); return [p.x, p.y]; })());
  check('yaw: screenToWorld invierte worldToScreen', Math.abs(w.x - 2.5) < 1e-9 && Math.abs(w.y + 1.5) < 1e-9);
  const s0 = R.worldToScreen({ ...cam, rot: 0 }, 2.5, -1.5, 0);
  const s1 = R.worldToScreen(cam, 2.5, -1.5, 0);
  check('yaw: la rotación mueve el punto en pantalla', Math.hypot(s1.x - s0.x, s1.y - s0.y) > 1);
}
{
  // a 45° (diamante Xenonauts) las caras +x e +y miran a la cámara; -x/-y no
  const r = Math.PI / 4;
  check('C4: cara este visible a 45°', R.faceVisible(1, 0, r));
  check('C4: cara sur visible a 45°', R.faceVisible(0, 1, r));
  check('C4: cara oeste oculta a 45°', !R.faceVisible(-1, 0, r));
  check('C4: cara norte oculta a 45°', !R.faceVisible(0, -1, r));
  // tras girar 90° se invierten
  check('C4: girar 90° oculta la cara sur', !R.faceVisible(0, 1, r + Math.PI / 2) || R.faceVisible(1, 0, r + Math.PI / 2));
}
{
  // fade de oclusión: una pared delante del PCJ (hacia la cámara) se desvanece
  const cam = { x: 0, y: 0, zoom: 1, rot: 0 };
  check('C4: pared delante del PCJ → fade', R.wallFadesPawn(cam, { x: 5, y: 6 }, { x: 5, y: 5 }));
  check('C4: pared detrás del PCJ → sin fade', !R.wallFadesPawn(cam, { x: 5, y: 4 }, { x: 5, y: 5 }));
  check('C4: pared lejos lateral → sin fade', !R.wallFadesPawn(cam, { x: 9, y: 6 }, { x: 5, y: 5 }));
}
{
  // sprite de consola (hoja v3): integridad de las vistas medidas
  const V = R.CONSOLE_SPRITE.VIEWS, SHEET_W = 2048, SHEET_H = 2102;
  check('sprite consola: 4 vistas de yaw', [45, 135, 225, 315].every(k => V[k]));
  let okHex = true, okRect = true, okFp = true, okTopW = true;
  for (const k of [45, 135, 225, 315]) {
    const v = V[k];
    if (!Array.isArray(v.hex) || v.hex.length !== 6 || v.hex.some(p => p.length !== 2)) okHex = false;
    const [sx, sy, sw, sh] = v.rect;
    if (!(sx >= 0 && sy >= 0 && sw > 0 && sh > 0 && sx + sw <= SHEET_W && sy + sh <= SHEET_H)) okRect = false;
    if (!(v.fp[0] >= sx && v.fp[0] <= sx + sw && v.fp[1] >= sy && v.fp[1] <= sy + sh)) okFp = false;
    if (!(v.topW > 0)) okTopW = false;
    // la silueta hexagonal debe caber en su rect de recorte
    if (v.hex.some(p => p[0] < sx - 5 || p[0] > sx + sw + 5 || p[1] < sy - 5 || p[1] > sy + sh + 5)) okRect = false;
  }
  check('sprite consola: hexágonos de 6 puntos', okHex);
  check('sprite consola: rects dentro de la hoja y contienen la silueta', okRect);
  check('sprite consola: ancla fp dentro del rect', okFp);
  check('sprite consola: topW positivo (escala de huella)', okTopW);
}
{
  // render3d (three.js): en Node no hay WebGL — debe cargar y delegar la matemática
  const R3 = require('../src/render/render3d.js');
  check('render3d: carga en Node sin THREE', !!R3);
  const a = R.worldToScreen({ x: 10, y: 20, zoom: 2, rot: 0.7 }, 1.5, -2.5, 0.3);
  const b = R3.worldToScreen({ x: 10, y: 20, zoom: 2, rot: 0.7 }, 1.5, -2.5, 0.3);
  check('render3d: worldToScreen idéntico al 2D', a.x === b.x && a.y === b.y);
  check('render3d: available() es false sin WebGL', R3.available() === false);
  check('render3d: drawNexo sin init es no-op seguro', (() => { try { R3.drawNexo(null, {}, { rooms: [] }, {}); return true; } catch (e) { return false; } })());
  const kn = { rooms: [(() => { const r = D.createRoom('K', 3, 3); r.tiles[1][1].wall = D.createWall('block', 0); return r; })()] };
  const ka = R3.keyOf(kn, 45, false);
  check('render3d keyOf: estable sin cambios', ka === R3.keyOf(kn, 45, false));
  kn.rooms[0].tiles[1][1].wall = null;
  check('render3d keyOf: cambia al editar el mapa', R3.keyOf(kn, 45, false) !== ka);
  check('render3d keyOf: el yaw cambia la firma (billboard)', R3.keyOf(kn, 135, false) !== R3.keyOf(kn, 45, false));
  check('render3d keyOf: la hoja lista cambia la firma (rebuild al cargar)', R3.keyOf(kn, 45, true) !== R3.keyOf(kn, 45, false));
}
{
  const room = D.createRoom('R', 4, 4);
  room.transform.rotation = 90;
  const w = R.localToWorld(room, 1, 1);
  const l = R.worldToLocal(room, w.x, w.y);
  check('local↔world con sala rotada', Math.abs(l.x - 1) < 1e-9 && Math.abs(l.y - 1) < 1e-9);
}

// ---- engine: lógica pre-cargada por Nexo ------------------------------------
function mkNexo() {
  const n = D.createNexo('Nexo T');
  const r = D.createRoom('Room', 8, 8);
  n.rooms.push(r); n.entry = { roomId: r.id, x: 1, y: 1 };
  return { n, r };
}
{
  const { n, r } = mkNexo();
  const ev = D.createRoomEvent('Slide');
  ev.action = { kind: 'shift', to: { x: 4, y: 0 }, duration: 1 };
  ev.loop = false;
  r.events.push(ev);
  const eng = ENG.create();
  check('sin pistas antes de start', eng.activeCount() === 0);
  eng.start(n);
  check('start pre-carga eventos time del Nexo', eng.activeCount() === 1);
  for (let i = 0; i < 30; i++) eng.update(n, 1 / 30);
  check('shift alcanza su pose', Math.abs(r.transform.x - 4) < 1e-9);
  eng.update(n, 1 / 30);   // 1/30 acumulado en float puede quedar un paso por debajo de 1.0
  check('one-shot se retira', eng.activeCount() === 0 && Math.abs(eng.time - 31 / 30) < 1e-9);
  eng.stop();
  check('stop desmonta el Nexo', !eng.running);
}
{
  const { n, r } = mkNexo();
  const ev = D.createRoomEvent('Spin');
  ev.action = { kind: 'rotate', by: 90, duration: 1 }; ev.loop = false;
  r.events.push(ev);
  const eng = ENG.create();
  eng.start(n);
  for (let i = 0; i < 30; i++) eng.update(n, 1 / 30);
  check('rotate llega a 90°', Math.abs(r.transform.rotation - 90) < 1e-9);
}
{
  const { n, r } = mkNexo();
  const ev = D.createRoomEvent('Orbit');
  ev.action = { kind: 'orbit', center: { x: 10, y: 4 }, radius: 6, period: 2, direction: 'cw' };
  r.events.push(ev);
  const eng = ENG.create();
  eng.start(n);
  for (let i = 0; i < 15; i++) eng.update(n, 1 / 30);
  const rc = R.roomCenterWorld(r);
  check('orbit mantiene el radio', Math.abs(Math.hypot(rc.x - 10, rc.y - 4) - 6) < 1e-6);
}
{
  const { n, r } = mkNexo();
  const ev = D.createRoomEvent('Car');
  ev.action = { kind: 'carousel', interval: 0.5, poses: [{ x: 0, y: 0, rotation: 0 }, { x: 5, y: 0, rotation: 90 }] };
  r.events.push(ev);
  const eng = ENG.create();
  eng.start(n);
  for (let i = 0; i < 16; i++) eng.update(n, 1 / 30);
  check('carousel salta a la pose 2', r.transform.x === 5 && r.transform.rotation === 90);
}
{
  const { n, r } = mkNexo();
  const ev = D.createRoomEvent('Manual');
  ev.trigger = { type: 'manual' }; ev.loop = false;
  ev.action = { kind: 'shift', to: { x: 2, y: 2 }, duration: 1 };
  r.events.push(ev);
  const eng = ENG.create();
  eng.start(n);
  check('manual NO se pre-carga', eng.activeCount() === 0);
  eng.fire(r, ev);
  for (let i = 0; i < 30; i++) eng.update(n, 1 / 30);
  check('fire() ejecuta el manual', Math.abs(r.transform.x - 2) < 1e-9 && Math.abs(r.transform.y - 2) < 1e-9);
}
{
  const run = () => {
    const { n, r } = mkNexo();
    const ev = D.createRoomEvent('S');
    ev.action = { kind: 'shift', to: { x: 3, y: 1 }, duration: 0.8 }; ev.loop = false;
    r.events.push(ev);
    const eng = ENG.create(); eng.start(n);
    for (let i = 0; i < 24; i++) eng.update(n, 1 / 30);
    return JSON.stringify(r.transform);
  };
  check('mismo Nexo + mismos pasos → misma pose (determinismo)', run() === run());
}

// ---- agents: PCJ click→ruta --------------------------------------------------
{
  const { n, r } = mkNexo();
  const eng = ENG.create();
  const agents = AGT.create(eng);
  agents.install();
  eng.start(n);
  const pawn = agents.spawn(n.id, r.id, 1, 1);
  let arrived = null;
  eng.bus.on('pawn:arrived', (p) => { arrived = p; });
  check('order() acepta tile alcanzable', agents.order(pawn, r, 5, 1) === true);
  for (let i = 0; i < 60; i++) eng.update(n, 1 / 30);
  check('el PCJ llega al tile', Math.round(pawn.x) === 5 && Math.round(pawn.y) === 1 && !pawn.moving);
  check('pawn:arrived emitido con la casilla', arrived && arrived.x === 5 && arrived.y === 1 && arrived.pawn === pawn);
  r.tiles[3][3].wall = D.createWall('block', 0);
  check('order() rechaza pared', agents.order(pawn, r, 3, 3) === false);
  check('rechazado no se mueve', pawn.x === 5 && pawn.y === 1);
  agents.place(pawn, 'otro', r.id, 2, 2);
  check('place() teletransporta sin evento', pawn.nexoId === 'otro' && pawn.x === 2);
}

// ---- blueprint: openSharedEdge ----------------------------------------------
{
  const nexo = D.createNexo('Nexo T');
  const hub = D.createRoom('Hub', 10, 8);
  D.ringWalls(hub);
  hub.transform.x = 0; hub.transform.y = 0;
  nexo.rooms.push(hub);
  const bp = D.createModuleBlueprint({ name: 'Test', w: 6, h: 6 });
  const room = BP.instantiateRoom(bp, { x: 10, y: 1 });
  const chk = BP.placementCheck(nexo, { w: 6, h: 6 }, { x: 10, y: 1 });
  check('placementCheck encuentra arista compartida', chk.ok && chk.touch);
  nexo.rooms.push(room);
  const removed = BP.openSharedEdge(nexo, room, chk.touch);
  check('openSharedEdge quita paredes', removed > 0);
  // E edge: room west wall (x=0) and hub east wall (x=9) should be removed
  check('paso abierto es transitable', !room.tiles[0][0].wall && !hub.tiles[1][9].wall);
}

// ---- nav: findPathNexo multi-sala -------------------------------------------
{
  const nexo = D.createNexo('Nexo T');
  const hub = D.createRoom('Hub', 10, 8);
  D.ringWalls(hub);
  hub.transform.x = 0; hub.transform.y = 0;
  nexo.rooms.push(hub);
  const bp = D.createModuleBlueprint({ name: 'Test', w: 6, h: 6 });
  const room = BP.instantiateRoom(bp, { x: 10, y: 1 });
  const chk = BP.placementCheck(nexo, { w: 6, h: 6 }, { x: 10, y: 1 });
  nexo.rooms.push(room);
  BP.openSharedEdge(nexo, room, chk.touch);
  const path = NAV.findPathNexo(nexo, 2, 2, 12, 3);
  check('findPathNexo cruza salas', Array.isArray(path) && path.length > 0);
  check('ruta termina en sala destino', path[path.length - 1].roomId === room.id);
  check('sin ruta sin abertura', NAV.findPathNexo(nexo, 2, 2, 20, 20) === null);
}

// ---- agents: multi-sala ------------------------------------------------------
{
  const nexo = D.createNexo('Nexo T');
  const hub = D.createRoom('Hub', 10, 8);
  D.ringWalls(hub);
  hub.transform.x = 0; hub.transform.y = 0;
  nexo.rooms.push(hub);
  const bp = D.createModuleBlueprint({ name: 'Test', w: 6, h: 6 });
  const room = BP.instantiateRoom(bp, { x: 10, y: 1 });
  const chk = BP.placementCheck(nexo, { w: 6, h: 6 }, { x: 10, y: 1 });
  nexo.rooms.push(room);
  BP.openSharedEdge(nexo, room, chk.touch);
  const eng = ENG.create();
  const agents = AGT.create(eng);
  agents.install();
  eng.start(nexo);
  const pawn = agents.spawn(nexo.id, hub.id, 2, 2);
  check('order() multi-sala acepta destino en otro cuarto', agents.order(pawn, room, 2, 2) === true);
  for (let i = 0; i < 120; i++) eng.update(nexo, 1 / 30);
  check('el PCJ llega y cambia de sala', Math.round(pawn.x) === 2 && Math.round(pawn.y) === 2 && pawn.roomId === room.id);
}

// ---- agents: cruce multi-sala CONTINUO (regresión: sin teletransporte) ---------
{
  const nexo = D.createNexo('Nexo T');
  const hub = D.createRoom('Hub', 10, 8);
  D.ringWalls(hub);
  hub.transform.x = 0; hub.transform.y = 0;
  nexo.rooms.push(hub);
  const bp = D.createModuleBlueprint({ name: 'Test', w: 6, h: 6 });
  const room = BP.instantiateRoom(bp, { x: 10, y: 1 });
  const chk = BP.placementCheck(nexo, { w: 6, h: 6 }, { x: 10, y: 1 });
  nexo.rooms.push(room);
  BP.openSharedEdge(nexo, room, chk.touch);
  const eng = ENG.create();
  const ag = AGT.create(eng); ag.install();
  eng.start(nexo);
  const pawn = ag.spawn(nexo.id, hub.id, 2, 2);
  check('order() multi-sala (continuidad)', ag.order(pawn, room, 2, 2) === true);
  const worldPos = () => {
    const r = nexo.rooms.find(rr => rr.id === pawn.roomId);
    return { x: r.transform.x + pawn.x, y: r.transform.y + pawn.y };
  };
  const dt = 1 / 30;
  let prev = worldPos(), maxJump = 0;
  for (let i = 0; i < 200 && pawn.moving; i++) {
    eng.update(nexo, dt);
    const w = worldPos();
    maxJump = Math.max(maxJump, Math.hypot(w.x - prev.x, w.y - prev.y));
    prev = w;
  }
  check('cruce sin teletransporte: desplazamiento por frame ≤ velocidad', maxJump <= AGT.SPEED * dt * 1.5 + 1e-9);
  check('llega caminando a la sala destino', pawn.roomId === room.id && Math.round(pawn.x) === 2 && Math.round(pawn.y) === 2);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
