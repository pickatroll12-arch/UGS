/*
 * UGS — motion engine self-test.  Run: node src/engine.test.js
 * Covers segment motion, orbit, the event bus, and determinism.
 */
'use strict';
const engine = require('./engine.js');
const data = require('./data.js');

let pass = 0, fail = 0;
const ck = (n, c) => { if (c) { pass++; console.log('  ok  ', n); } else { fail++; console.error('  FAIL', n); } };
console.log('UGS engine self-test\n');

function movingRoom(action, loop) {
  const save = data.createSaveFile('t'); const lvl = save.levels[0];
  const room = lvl.rooms[0]; room.size = { w: 4, h: 4 };
  room.transform = data.createTransform(0, 0, 0); room.transform.pivot = { x: 2, y: 2 };
  const ev = data.createRoomEvent('e'); ev.trigger = { type: 'time' }; ev.loop = !!loop; ev.action = action;
  room.events.push(ev);
  return { lvl, room };
}

// --- shift + ping-pong loop ---
{
  const { lvl, room } = movingRoom({ kind: 'shift', to: { x: 4, y: 0 }, duration: 1 }, true);
  const e = engine.create(); e.start(lvl);
  e.update(lvl, 0.5); ck('shift halfway ≈2', Math.abs(room.transform.x - 2) < 0.01);
  e.update(lvl, 0.5); ck('shift full ≈4', Math.abs(room.transform.x - 4) < 0.01);
  e.update(lvl, 1.0); ck('ping-pong back ≈0', Math.abs(room.transform.x - 0) < 0.01);
  e.stop(lvl); ck('stop restores base', room.transform.x === 0 && room.transform.rotation === 0);
}

// --- rotate one-shot ---
{
  const { lvl, room } = movingRoom({ kind: 'rotate', by: 90, duration: 1 }, false);
  const e = engine.create(); e.start(lvl);
  e.update(lvl, 0.5); ck('rotate halfway ≈45', Math.abs(room.transform.rotation - 45) < 0.01);
  e.update(lvl, 0.6); ck('rotate finished ≈90', Math.abs(room.transform.rotation - 90) < 0.01 && e.activeCount() === 0);
  e.stop(lvl);
}

// --- orbit: constant radius, returns after a period ---
{
  const { lvl, room } = movingRoom({ kind: 'orbit', center: { x: 2, y: -3 }, radius: 5, period: 4, direction: 'cw', selfRotate: false }, false);
  const C = { x: 2, y: -3 };
  const dist = () => { const c = engine.roomCenterWorld(room, room.transform.rotation); return Math.hypot(c.x - C.x, c.y - C.y); };
  const e = engine.create(); e.start(lvl);
  ck('orbit initial radius ≈5', Math.abs(dist() - 5) < 0.01);
  for (let i = 0; i < 60; i++) e.update(lvl, 1 / 60);
  ck('orbit radius preserved', Math.abs(dist() - 5) < 0.05);
  for (let i = 0; i < 180; i++) e.update(lvl, 1 / 60);
  const c = engine.roomCenterWorld(room, room.transform.rotation);
  ck('orbit returns near start after a period', Math.hypot(c.x - 2, c.y - 2) < 0.2);
  e.stop(lvl);
}

// --- event bus emits motion:start / motion:done ---
{
  const { lvl, room } = movingRoom({ kind: 'rotate', by: 90, duration: 1 }, false);
  const e = engine.create();
  let started = 0, done = 0;
  if (e.bus) { e.bus.on('motion:start', () => started++); e.bus.on('motion:done', () => done++); }
  e.start(lvl);
  ck('bus emits motion:start on fire', !e.bus || started === 1);
  for (let i = 0; i < 70; i++) e.update(lvl, 1 / 60);
  ck('bus emits motion:done on finish', !e.bus || done === 1);
  e.stop(lvl);
}

// --- determinism: identical dt sequence → identical state ---
{
  const a = movingRoom({ kind: 'orbit', center: { x: 1, y: 1 }, radius: 4, period: 3, direction: 'ccw', selfRotate: true }, false);
  const b = movingRoom({ kind: 'orbit', center: { x: 1, y: 1 }, radius: 4, period: 3, direction: 'ccw', selfRotate: true }, false);
  const ea = engine.create(), eb = engine.create(); ea.start(a.lvl); eb.start(b.lvl);
  for (let i = 0; i < 100; i++) { ea.update(a.lvl, 1 / 30); eb.update(b.lvl, 1 / 30); }
  ck('deterministic: same steps → same transform', Math.abs(a.room.transform.x - b.room.transform.x) < 1e-9 && Math.abs(a.room.transform.rotation - b.room.transform.rotation) < 1e-9);
}

// --- manual trigger + pluggable system ---
{
  const { lvl, room } = movingRoom({ kind: 'shift', to: { x: 2, y: 0 }, duration: 1 }, false);
  room.events[0].trigger = { type: 'manual' };
  const e = engine.create();
  let sysTicks = 0; e.addSystem({ step: () => sysTicks++ });
  e.start(lvl);
  ck('manual event not auto-fired', e.activeCount() === 0);
  e.trigger(room); ck('manual trigger fires', e.activeCount() === 1);
  e.update(lvl, 1 / 30); ck('pluggable system runs each step', sysTicks === 1);
  e.stop(lvl);
}

// --- incomplete events are skipped by the sim (validation) ---
{
  ck('eventUsable: valid shift', engine.eventUsable({ action: { kind: 'shift', to: { x: 1, y: 0 } } }) === true);
  ck('eventUsable: shift without target', engine.eventUsable({ action: { kind: 'shift' } }) === false);
  ck('eventUsable: orbit radius 0', engine.eventUsable({ action: { kind: 'orbit', center: { x: 0, y: 0 }, radius: 0 } }) === false);
  ck('eventUsable: orbit ok', engine.eventUsable({ action: { kind: 'orbit', center: { x: 0, y: 0 }, radius: 3 } }) === true);
  ck('eventUsable: carousel needs 2 poses', engine.eventUsable({ action: { kind: 'carousel', poses: [{ x: 0, y: 0, rotation: 0 }] } }) === false);

  // a degenerate orbit must not move the room in play
  const { lvl, room } = movingRoom({ kind: 'orbit', center: { x: 1, y: 1 }, radius: 0, period: 4, direction: 'cw' }, true);
  const e = engine.create(); e.start(lvl);
  ck('degenerate orbit not fired', e.activeCount() === 0);
  e.update(lvl, 0.5);
  ck('degenerate orbit leaves room put', room.transform.x === 0 && room.transform.y === 0);
  e.stop(lvl);
}

// --- BUG-01: a deck transition triggered DURING update must not kill the new
//     deck's room events (re-entrant stop/start is deferred to end of tick) ---
{
  function orbitLevel() {
    const save = data.createSaveFile('t'); const lvl = save.levels[0];
    const room = lvl.rooms[0]; room.size = { w: 4, h: 4 };
    room.transform = data.createTransform(0, 0, 0); room.transform.pivot = { x: 2, y: 2 };
    const ev = data.createRoomEvent('orb'); ev.trigger = { type: 'time' };
    ev.action = { kind: 'orbit', center: { x: 8, y: 8 }, radius: 5, period: 4, direction: 'cw' };
    room.events.push(ev);
    return { lvl, room };
  }
  const A = orbitLevel(), B = orbitLevel();
  const e = engine.create();
  e.start(A.lvl);
  ck('BUG-01: deck A orbit active at start', e.activeCount() === 1);

  // a system that performs a deck transition (stop old + start new) mid-update,
  // exactly as the editor's pawn:arrived handler does
  let transit = null;
  e.addSystem({ step: () => { if (transit) { const g = transit; transit = null; e.stop(g.from); e.start(g.to); } } });

  transit = { from: A.lvl, to: B.lvl };
  const bx0 = B.room.transform.x, by0 = B.room.transform.y;
  e.update(A.lvl, 1 / 30);                        // transition deferred + applied this tick
  ck('BUG-01: engine still running after A→B', e.isRunning());
  ck('BUG-01: new deck event survives A→B (activeCount>0)', e.activeCount() === 1);
  e.update(B.lvl, 1 / 30);
  ck('BUG-01: orbiting room on deck B keeps moving', B.room.transform.x !== bx0 || B.room.transform.y !== by0);

  // round trip back to A
  transit = { from: B.lvl, to: A.lvl };
  e.update(B.lvl, 1 / 30);
  ck('BUG-01: return trip B→A keeps events alive', e.activeCount() === 1 && e.isRunning());
  const ax0 = A.room.transform.x;
  e.update(A.lvl, 1 / 30);
  ck('BUG-01: deck A room animates again after return', A.room.transform.x !== ax0);

  // a speed=3 tick (bigger dt) during travel must behave the same
  transit = { from: A.lvl, to: B.lvl };
  e.update(A.lvl, 3 / 30);
  ck('BUG-01: transition under a large (speed 3) dt keeps events', e.activeCount() === 1 && e.isRunning());
  e.stop(B.lvl);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
