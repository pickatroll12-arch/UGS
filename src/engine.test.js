/*
 * UGS — engine self-test.  Run: node src/engine.test.js
 * The engine executes each Nexo's DECLARED room-motion deterministically —
 * no life-sim. Checks start/stop/update/fire, pose restore, and the bus.
 */
'use strict';
const data = require('./data.js');
const engineMod = require('./engine.js');

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  ok  ', name); }
  else { failed++; console.error('  FAIL', name); }
}
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-6 : eps);

// a level whose single room declares one time-triggered event
function levelWith(action, opts) {
  opts = opts || {};
  const lvl = data.createLevel('Nexo');
  const room = lvl.rooms[0];
  room.transform = data.createTransform(0, 0, 0);
  room.movable = true;
  const ev = data.createRoomEvent('E');
  ev.trigger = { type: opts.manual ? 'manual' : 'time' };
  ev.loop = !!opts.loop;
  ev.action = action;
  room.events = [ev];
  return { lvl, room, ev };
}

console.log('UGS engine self-test\n');

// ── fresh state ───────────────────────────────────────────────────────────
const e0 = engineMod.create();
check('fresh engine is not running', e0.isRunning() === false && e0.activeCount() === 0);
check('fresh engine exposes a bus and a clock', !!e0.bus && e0.time === 0);

// ── start only auto-arms TIME events; manual waits for fire() ─────────────
const man = levelWith({ kind: 'shift', to: { x: 4, y: 0 }, duration: 1 }, { manual: true });
const em = engineMod.create();
em.start(man.lvl);
check('start runs the Nexo', em.isRunning() === true);
check('manual events do NOT auto-start', em.activeCount() === 0);
em.fire(man.room, man.ev);
check('fire() arms a manual event', em.activeCount() === 1);

// ── shift moves the transform and completes (non-looping) ─────────────────
const sh = levelWith({ kind: 'shift', to: { x: 4, y: 0 }, duration: 2 });
const es = engineMod.create();
es.start(sh.lvl);
check('a time event auto-arms on start', es.activeCount() === 1);
es.update(sh.lvl, 1);
check('shift is halfway after 1s of 2s', near(sh.room.transform.x, 2));
check('engine time accumulates', near(es.time, 1));
es.update(sh.lvl, 1);
check('shift reaches its target', near(sh.room.transform.x, 4));
check('a finished non-looping event drops out of activeCount', es.activeCount() === 0);

// ── stop restores the authored pose (no drift into the saved map) ─────────
const sh2 = levelWith({ kind: 'shift', to: { x: 6, y: 0 }, duration: 2 }, { loop: false });
const es2 = engineMod.create();
es2.start(sh2.lvl);
es2.update(sh2.lvl, 1);     // move to x=3
check('play mutated the transform', sh2.room.transform.x > 0);
es2.stop(sh2.lvl);
check('stop restores the authored transform', near(sh2.room.transform.x, 0) && sh2.room.transform.rotation === 0);
check('stop leaves the engine idle', es2.isRunning() === false);

// ── rotate ────────────────────────────────────────────────────────────────
const ro = levelWith({ kind: 'rotate', by: 90, duration: 2 });
const er = engineMod.create();
er.start(ro.lvl);
er.update(ro.lvl, 1);
check('rotate is halfway (45° of 90°)', near(ro.room.transform.rotation, 45));
er.update(ro.lvl, 1);
check('rotate finishes at 90°', near(ro.room.transform.rotation, 90));
check('rotate drops out when done', er.activeCount() === 0);

// ── orbit runs until the Nexo stops and moves the room centre ─────────────
const or = levelWith({ kind: 'orbit', center: { x: 0, y: 0 }, radius: 5, period: 4, direction: 'cw' }, { loop: true });
const eo = engineMod.create();
eo.start(or.lvl);
const beforeX = or.room.transform.x, beforeY = or.room.transform.y;
eo.update(or.lvl, 0.5);
check('orbit moves the room', or.room.transform.x !== beforeX || or.room.transform.y !== beforeY);
check('orbit keeps running (never self-completes)', eo.activeCount() === 1);

// ── carousel settles on the last pose when not looping ────────────────────
const ca = levelWith({ kind: 'carousel', interval: 1, poses: [
  { x: 0, y: 0, rotation: 0 }, { x: 2, y: 0, rotation: 0 }, { x: 2, y: 2, rotation: 0 }
] });
const ec = engineMod.create();
ec.start(ca.lvl);
ec.update(ca.lvl, 0.5);
check('carousel interpolates between poses', near(ca.room.transform.x, 1));
ec.update(ca.lvl, 5);     // way past the end
check('carousel settles on the final pose', near(ca.room.transform.x, 2) && near(ca.room.transform.y, 2));
check('carousel drops out after settling', ec.activeCount() === 0);

// ── bus: 'tick' fires each update; update on an unstarted level is a no-op ─
const tk = levelWith({ kind: 'rotate', by: 90, duration: 2 }, { loop: true });
const et = engineMod.create();
let ticks = 0, lastDt = 0;
et.bus.on('tick', (p) => { ticks++; lastDt = p.dt; });
et.start(tk.lvl);
et.update(tk.lvl, 0.25);
check("'tick' fires on update with dt", ticks === 1 && near(lastDt, 0.25));
const other = data.createLevel('Other');
et.update(other, 0.25);
check('update on an unstarted level does nothing', ticks === 1);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
