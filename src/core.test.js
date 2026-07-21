/*
 * UGS — core foundation self-test.  Run: node src/core.test.js
 * (renamed the old data-layer test to data.test.js)
 */
'use strict';
const C = require('./core.js');

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.error('  FAIL', name); } }

console.log('UGS core foundation self-test\n');

// --- math ---
check('clamp', C.clamp(5, 0, 3) === 3 && C.clamp(-1, 0, 3) === 0);
check('lerp/invLerp', C.lerp(0, 10, 0.5) === 5 && C.invLerp(0, 10, 5) === 0.5);
check('smoothstep bounds', C.smoothstep(-1) === 0 && C.smoothstep(2) === 1);
check('angleDelta wraps shortest', Math.abs(C.angleDelta(0.1, 6.2) - (6.2 - 0.1 - C.TAU)) < 1e-9);

// --- vec ---
check('vec dist', C.vec.dist({ x: 0, y: 0 }, { x: 3, y: 4 }) === 5);
check('vec rot 90deg', (() => { const r = C.vec.rot({ x: 1, y: 0 }, Math.PI / 2); return C.approx(r.x, 0) && C.approx(r.y, 1); })());

// --- rng determinism ---
const r1 = C.makeRNG(12345), r2 = C.makeRNG(12345);
const seqA = [r1.next(), r1.next(), r1.next()];
const seqB = [r2.next(), r2.next(), r2.next()];
check('same seed → same sequence', seqA.every((v, i) => v === seqB[i]));
check('different seed → different sequence', C.makeRNG(1).next() !== C.makeRNG(2).next());
check('rng int in range', (() => { const r = C.makeRNG(7); for (let i = 0; i < 1000; i++) { const v = r.int(6); if (v < 0 || v > 5 || v % 1) return false; } return true; })());
check('fork is independent + deterministic', (() => { const a = C.makeRNG(9).fork(), b = C.makeRNG(9).fork(); return a.next() === b.next(); })());

// --- ids ---
const ids = C.makeIds();
check('ids unique + monotonic count', (() => { const a = ids.short('x'), b = ids.short('x'); return a !== b && ids.count === 2; })());

// --- event bus ---
const bus = new C.EventBus();
let got = 0, payload = null;
const off = bus.on('tick', p => { got++; payload = p; });
bus.emit('tick', 42);
bus.emit('tick', 43);
check('bus delivers + payload', got === 2 && payload === 43);
off(); bus.emit('tick', 1);
check('bus off() unsubscribes', got === 2);
let onceN = 0; bus.once('boom', () => onceN++); bus.emit('boom'); bus.emit('boom');
check('bus once fires exactly once', onceN === 1);

// --- fixed timestep ---
const fs = new C.FixedTimestep(60, 5);
let steps = 0;
let alpha = fs.advance(1 / 60, () => steps++);           // exactly one frame
check('fixed step: one slice for one frame', steps === 1);
steps = 0; fs.reset();
fs.advance(3.5 / 60, () => steps++);                     // 3 full slices, .5 remainder
check('fixed step: accumulates whole slices', steps === 3);
steps = 0; fs.reset();
alpha = fs.advance(0.5 / 60, () => steps++);             // partial → no step, alpha ~0.5
check('fixed step: partial gives alpha, no step', steps === 0 && Math.abs(alpha - 0.5) < 1e-6);
steps = 0; fs.reset();
fs.advance(100, () => steps++);                          // huge stall clamped to maxSteps
check('fixed step: clamps catch-up (no spiral)', steps === 5);

// --- grid2d ---
const g = new C.Grid2D(8, 4, Int16Array, 0);
g.set(3, 2, 9);
check('grid set/get', g.get(3, 2) === 9 && g.get(0, 0) === 0);
check('grid bounds-safe', g.get(-1, 0) === 0 && (g.set(99, 99, 1), true));
let sum = 0; g.forEach(v => sum += v);
check('grid forEach visits all', sum === 9);

// --- pool ---
let made = 0;
const pool = new C.Pool(() => ({ v: ++made }), o => { o.v = 0; }, 2);
const a = pool.acquire(), b = pool.acquire();      // from prefill
check('pool serves prefilled', made === 2);
pool.release(a);
const c = pool.acquire();
check('pool recycles (no new alloc)', made === 2 && c === a && c.v === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
