/*
 * UGS — agents (PCJ) self-test.  Run: node src/agents.test.js
 * One click-controllable pawn: spawn, click→route order, deterministic
 * movement on the engine tick, arrival event, and phase-transition place().
 */
'use strict';
const data = require('./data.js');
const engineMod = require('./engine.js');
const agentsMod = require('./agents.js');

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  ok  ', name); }
  else { failed++; console.error('  FAIL', name); }
}
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-6 : eps);

function room(w, h) {
  const r = data.createRoom('t', w, h);
  r.tiles = Array.from({ length: h }, () => Array.from({ length: w }, () => data.createTile('deck')));
  return r;
}

console.log('UGS agents self-test\n');

// ── spawn / shape / selection ─────────────────────────────────────────────
const eng = engineMod.create();
const agents = agentsMod.create(eng);
const r = room(5, 1);
const level = { id: 'L', rooms: [r] };
const pawn = agents.spawn('L', r.id, 0, 0);
check('spawn adds one pawn and selects it', agents.pawns.length === 1 && agents.selected === pawn);
check('pawn has the render-facing shape', pawn.levelId === 'L' && pawn.roomId === r.id && pawn.x === 0 && pawn.y === 0 && Array.isArray(pawn.path) && pawn.moving === false && pawn.facingLocal && pawn.facingLocal.y === 1);

// ── order: reachable vs blocked ───────────────────────────────────────────
check('order to a reachable tile returns true and sets a path', agents.order(pawn, r, 4, 0) === true && pawn.moving === true && pawn.path.length === 4);
// block the only corridor with a full wall → unreachable
const blocked = room(5, 1);
blocked.tiles[0][2].wall = data.createWall('block', 0, 'hull');
const p2 = agents.spawn('L', blocked.id, 0, 0);
check('order to an unreachable tile returns false', agents.order(p2, blocked, 4, 0) === false && p2.moving === false);
agents.clear();
check('clear removes every pawn', agents.pawns.length === 0 && agents.selected === null);

// ── deterministic movement + arrival event ────────────────────────────────
const pw = agents.spawn('L', r.id, 0, 0);
agents.order(pw, r, 4, 0);
agents.step(level, 0.1);    // speed 4 * 0.1 = 0.4 tile
check('a small step advances the pawn partway (still moving)', near(pw.x, 0.4) && pw.moving === true);
check('facing points along the route (east)', near(pw.facingLocal.x, 1) && near(pw.facingLocal.y, 0));

let arrived = null;
eng.bus.on('pawn:arrived', (ev) => { arrived = ev; });
agents.step(level, 5);      // plenty of budget to finish
check('the pawn arrives at the target', pw.x === 4 && pw.y === 0 && pw.moving === false && pw.path.length === 0);
check("'pawn:arrived' fires with integer coords", !!arrived && arrived.pawn === pw && arrived.x === 4 && arrived.y === 0);

// ── step ignores pawns on other levels ────────────────────────────────────
const otherPawn = agents.spawn('OTHER', r.id, 0, 0);
agents.order(otherPawn, r, 4, 0);
agents.step(level, 5);      // level is 'L'; otherPawn is on 'OTHER'
check('step only advances pawns on the given level', otherPawn.x === 0 && otherPawn.moving === true);

// ── place() teleports across a phase transition ───────────────────────────
agents.place(pw, 'DECK2', 'roomB', 2, 3);
check('place moves the pawn to another deck/room and clears its route', pw.levelId === 'DECK2' && pw.roomId === 'roomB' && pw.x === 2 && pw.y === 3 && pw.moving === false && pw.path.length === 0);

// ── install: movement rides the engine tick end-to-end ────────────────────
const eng2 = engineMod.create();
const ag2 = agentsMod.create(eng2);
ag2.install();
const r2 = room(5, 1);
const lvl2 = data.createLevel('Nexo'); lvl2.rooms = [r2];
const p3 = ag2.spawn(lvl2.id, r2.id, 0, 0);
ag2.order(p3, r2, 4, 0);
eng2.start(lvl2);
eng2.update(lvl2, 5);       // engine tick → agents.step
check('install wires movement onto the engine tick', p3.x === 4 && p3.moving === false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
