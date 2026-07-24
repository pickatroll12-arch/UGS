/*
 * UGS — engine + agents self-test (POST-RESET).  Run: node src/engine.test.js
 * Lógica pre-cargada por Nexo (room events), PCJ click→route, determinism.
 */
'use strict';
const data = require('./data.js');
require('./render.js');            // engine depends on render pose math
const engineMod = require('./engine.js');
const agentsMod = require('./agents.js');

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  ok  ', name); }
  else { failed++; console.error('  FAIL', name); }
}

console.log('UGS engine/agents self-test\n');

function level(w = 8, h = 8) {
  const lvl = data.createLevel('Nexo 1');
  const r = lvl.rooms[0];
  r.size = { w, h };
  r.transform = data.createTransform(0, 0, 0);
  r.tiles = Array.from({ length: h }, () => Array.from({ length: w }, () => data.createTile('deck')));
  lvl.entry = { roomId: r.id, x: 1, y: 1 };
  return { lvl, room: r };
}

// ---- Nexo pre-carga -------------------------------------------------------
// 1. start() loads time-triggered events; stop() tears them down
{
  const { lvl, room } = level();
  const ev = data.createRoomEvent('Slide');
  ev.trigger = { type: 'time' }; ev.loop = true;
  ev.action = { kind: 'shift', to: { x: 4, y: 0 }, duration: 1 };
  room.movable = true; room.events.push(ev);
  const eng = engineMod.create();
  check('no tracks before start', eng.activeCount() === 0);
  eng.start(lvl);
  check('start pre-loads the Nexo time event', eng.activeCount() === 1);
  eng.stop(lvl);
  check('stop tears the Nexo down', eng.activeCount() === 0 && !eng.running);
}

// 2. disabled events are not pre-loaded
{
  const { lvl, room } = level();
  const ev = data.createRoomEvent('Off');
  ev.enabled = false; ev.trigger = { type: 'time' };
  ev.action = { kind: 'shift', to: { x: 4, y: 0 }, duration: 1 };
  room.events.push(ev);
  const eng = engineMod.create();
  eng.start(lvl);
  check('disabled event is not pre-loaded', eng.activeCount() === 0);
}

// 3. shift event moves the room deterministically
{
  const { lvl, room } = level();
  const ev = data.createRoomEvent('Slide');
  ev.trigger = { type: 'time' }; ev.loop = false;
  ev.action = { kind: 'shift', to: { x: 4, y: 0 }, duration: 1 };
  room.events.push(ev);
  const eng = engineMod.create();
  eng.start(lvl);
  for (let i = 0; i < 30; i++) eng.update(lvl, 1 / 30);   // 1.0s total
  check('shift reaches its target pose', Math.abs(room.transform.x - 4) < 1e-9 && Math.abs(room.transform.y) < 1e-9);
  for (let i = 0; i < 30; i++) eng.update(lvl, 1 / 30);
  check('one-shot shift retires', eng.activeCount() === 0);
  check('engine time tracks fixed steps', Math.abs(eng.time - 2) < 1e-9);
}

// 4. rotate event spins around the pivot
{
  const { lvl, room } = level();
  const ev = data.createRoomEvent('Spin');
  ev.trigger = { type: 'time' }; ev.loop = false;
  ev.action = { kind: 'rotate', by: 90, duration: 1 };
  room.events.push(ev);
  const eng = engineMod.create();
  eng.start(lvl);
  for (let i = 0; i < 30; i++) eng.update(lvl, 1 / 30);
  const rot = ((room.transform.rotation % 360) + 360) % 360;
  check('rotate reaches 90°', Math.abs(rot - 90) < 1e-9);
}

// 5. orbit event keeps the room centre on the circle
{
  const { lvl, room } = level();
  const render = require('./render.js');
  const rc = render.roomCenterWorld(room);
  const ev = data.createRoomEvent('Orbit');
  ev.trigger = { type: 'time' }; ev.loop = true;
  ev.action = { kind: 'orbit', center: { x: rc.x, y: rc.y - 6 }, radius: 6, period: 2, direction: 'cw' };
  room.events.push(ev);
  const eng = engineMod.create();
  eng.start(lvl);
  for (let i = 0; i < 15; i++) eng.update(lvl, 1 / 30);   // 0.5s = quarter turn
  const rc2 = render.roomCenterWorld(room);
  const dist = Math.hypot(rc2.x - ev.action.center.x, rc2.y - ev.action.center.y);
  check('orbit keeps the radius', Math.abs(dist - 6) < 1e-6);
  check('orbit moved the room', Math.hypot(rc2.x - rc.x, rc2.y - rc.y) > 1);
}

// 6. carousel snaps through poses
{
  const { lvl, room } = level();
  const ev = data.createRoomEvent('Carousel');
  ev.trigger = { type: 'time' }; ev.loop = true;
  ev.action = { kind: 'carousel', interval: 0.5, poses: [
    { x: 0, y: 0, rotation: 0 }, { x: 5, y: 0, rotation: 90 }, { x: 5, y: 5, rotation: 180 }
  ] };
  room.events.push(ev);
  const eng = engineMod.create();
  eng.start(lvl);
  for (let i = 0; i < 16; i++) eng.update(lvl, 1 / 30);   // > 0.5s
  check('carousel reached pose 2', room.transform.x === 5 && Math.abs(room.transform.rotation - 90) < 1e-9);
}

// 7. manual fire() runs a manual event from the current pose
{
  const { lvl, room } = level();
  const ev = data.createRoomEvent('Manual');
  ev.trigger = { type: 'manual' }; ev.loop = false;
  ev.action = { kind: 'shift', to: { x: 2, y: 2 }, duration: 1 };
  room.events.push(ev);
  const eng = engineMod.create();
  eng.start(lvl);
  check('manual event is not pre-loaded', eng.activeCount() === 0);
  eng.fire(room, ev);
  check('fire() starts the manual event', eng.activeCount() === 1);
  for (let i = 0; i < 30; i++) eng.update(lvl, 1 / 30);
  check('manual shift reaches target', Math.abs(room.transform.x - 2) < 1e-9 && Math.abs(room.transform.y - 2) < 1e-9);
}

// 8. determinism: two fresh engines, same inputs → same poses
{
  function run() {
    const { lvl, room } = level();
    const ev = data.createRoomEvent('Slide');
    ev.trigger = { type: 'time' }; ev.loop = false;
    ev.action = { kind: 'shift', to: { x: 3, y: 1 }, duration: 0.8 };
    room.events.push(ev);
    const eng = engineMod.create();
    eng.start(lvl);
    for (let i = 0; i < 24; i++) eng.update(lvl, 1 / 30);
    return JSON.stringify(room.transform);
  }
  check('same Nexo + same steps → same pose', run() === run());
}

// ---- PCJ click→route ------------------------------------------------------
// 9. pawn spawns, walks a route, and emits pawn:arrived
{
  const { lvl, room } = level();
  const eng = engineMod.create();
  const agents = agentsMod.create(eng);
  agents.install();
  eng.start(lvl);
  const pawn = agents.spawn(lvl.id, room.id, 1, 1);
  check('spawn selects the pawn', agents.selected === pawn);
  let arrived = null;
  eng.bus.on('pawn:arrived', (p) => { arrived = p; });
  check('order() accepts a reachable tile', agents.order(pawn, room, 5, 1) === true);
  check('pawn starts moving', pawn.moving === true);
  for (let i = 0; i < 60; i++) eng.update(lvl, 1 / 30);   // 2s at 3.2 t/s ≈ 6.4 tiles
  check('pawn reached the target tile', Math.round(pawn.x) === 5 && Math.round(pawn.y) === 1);
  check('pawn stopped', pawn.moving === false);
  check('pawn:arrived fired with arrival tile', arrived && arrived.x === 5 && arrived.y === 1);
  check('arrival payload carries the pawn', arrived && arrived.pawn === pawn);
}

// 10. order() rejects an unreachable tile (wall) and the pawn stays put
{
  const { lvl, room } = level();
  room.tiles[3][3] = { floor: 'deck', wall: data.createWall('diagonal', 0, 'hull') };
  const eng = engineMod.create();
  const agents = agentsMod.create(eng);
  agents.install();
  eng.start(lvl);
  const pawn = agents.spawn(lvl.id, room.id, 1, 1);
  check('order to a wall tile is refused', agents.order(pawn, room, 3, 3) === false);
  for (let i = 0; i < 30; i++) eng.update(lvl, 1 / 30);
  check('refused pawn does not move', pawn.x === 1 && pawn.y === 1 && !pawn.moving);
}

// 11. place() teleports without an arrival event (deck travel)
{
  const { lvl, room } = level();
  const eng = engineMod.create();
  const agents = agentsMod.create(eng);
  agents.install();
  eng.start(lvl);
  const pawn = agents.spawn(lvl.id, room.id, 1, 1);
  let fired = false;
  eng.bus.on('pawn:arrived', () => { fired = true; });
  agents.place(pawn, 'other-level', room.id, 4, 4);
  for (let i = 0; i < 30; i++) eng.update(lvl, 1 / 30);
  check('place() teleports', pawn.levelId === 'other-level' && pawn.x === 4 && pawn.y === 4);
  check('place() does not emit pawn:arrived', fired === false);
}

// 12. pawn movement only advances on the loaded Nexo
{
  const { lvl } = level();
  const other = data.createLevel('Nexo 2');
  const eng = engineMod.create();
  const agents = agentsMod.create(eng);
  agents.install();
  eng.start(other);                                     // loaded Nexo = "other"
  const { lvl: lvl2, room } = level();
  const pawn = agents.spawn(lvl2.id, room.id, 1, 1);
  agents.order(pawn, room, 5, 1);
  for (let i = 0; i < 30; i++) eng.update(other, 1 / 30);
  check('pawn on an unloaded Nexo does not advance', pawn.x === 1 && pawn.y === 1);
}

// 13. facing follows the walk direction (sprites pick front/back/side)
{
  const { lvl, room } = level();
  const eng = engineMod.create();
  const agents = agentsMod.create(eng);
  agents.install();
  eng.start(lvl);
  const pawn = agents.spawn(lvl.id, room.id, 1, 1);
  agents.order(pawn, room, 5, 1);
  eng.update(lvl, 1 / 30);
  check('facing east while walking east', pawn.facingLocal.x > 0.9 && Math.abs(pawn.facingLocal.y) < 0.1);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
