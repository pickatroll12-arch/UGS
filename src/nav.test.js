/*
 * UGS — nav (pathfinding) self-test.  Run: node src/nav.test.js
 * Verifies the full-tile wall-collision contract (the bug that sank the old
 * engine: pawns walking THROUGH walls) and the click→route A*.
 */
'use strict';
const data = require('./data.js');
const nav = require('./nav.js');

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  ok  ', name); }
  else { failed++; console.error('  FAIL', name); }
}

// helper: a plain w×h deck room, all 'deck' floor, no walls
function room(w, h) {
  const r = data.createRoom('t', w, h);
  r.tiles = Array.from({ length: h }, () => Array.from({ length: w }, () => data.createTile('deck')));
  return r;
}

console.log('UGS nav self-test\n');

// ── walk grid basics ──────────────────────────────────────────────────────
const open = room(4, 4);
const g0 = nav.buildWalkGrid(open, data.objectBlocks);
check('open room is fully walkable', (() => { let all = true; for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (!g0.get(x, y)) all = false; return all; })());
check('outside the grid reads as blocked', g0.get(-1, 0) === 0 && g0.get(4, 0) === 0);

const voidRoom = room(3, 3);
voidRoom.tiles[1][1].floor = 'void';
check('void floor is not walkable', nav.buildWalkGrid(voidRoom, data.objectBlocks).get(1, 1) === 0);

// ── wall collision contract (feedback humano) ─────────────────────────────
const blockRoom = room(3, 3);
blockRoom.tiles[1][1].wall = data.createWall('block', 0, 'hull');
check('a full block wall blocks its whole tile', nav.buildWalkGrid(blockRoom, data.objectBlocks).get(1, 1) === 0);

const diagFull = room(3, 3);
diagFull.tiles[1][1].wall = data.createWall('diagonal', 0, 'hull');   // REV3 default → full
check('REV3: a diagonal wall defaults to full and blocks its tile', nav.buildWalkGrid(diagFull, data.objectBlocks).get(1, 1) === 0);

const diagPartial = room(3, 3);
diagPartial.tiles[1][1].wall = data.createWall('diagonal', 0, 'hull', 'partial');   // opt-in
const gp = nav.buildWalkGrid(diagPartial, data.objectBlocks);
check('partial diagonal keeps its tile walkable', gp.get(1, 1) === 1);
check('partial diagonal (orient 0) seals the EAST edge', nav.crossBlocked(diagPartial, 1, 1, 1, 0) === true);
check('partial diagonal (orient 0) leaves the WEST edge open', nav.crossBlocked(diagPartial, 1, 1, -1, 0) === false);
check('partial seal is symmetric from the neighbour side', nav.crossBlocked(diagPartial, 2, 1, -1, 0) === true);

// ── object collision ──────────────────────────────────────────────────────
const objRoom = room(3, 3);
objRoom.objects.push(data.createObjectInstance('crate', 1, 1));       // solid
check('a solid object blocks its tile', nav.buildWalkGrid(objRoom, data.objectBlocks).get(1, 1) === 0);
const doorRoom = room(3, 3);
const door = data.createObjectInstance('door', 1, 1); door.open = true;
doorRoom.objects.push(door);
check('an OPEN door does not block its tile', nav.buildWalkGrid(doorRoom, data.objectBlocks).get(1, 1) === 1);

// ── A* pathfinding ────────────────────────────────────────────────────────
const line = room(5, 1);
const p1 = nav.findPath(line, 0, 0, 4, 0, data.objectBlocks);
check('straight path reaches the target', !!p1 && p1[p1.length - 1].x === 4 && p1[p1.length - 1].y === 0);
check('straight path excludes the start tile', !!p1 && p1.length === 4 && p1[0].x === 1);
check('path to the same tile is empty', Array.isArray(nav.findPath(line, 2, 0, 2, 0, data.objectBlocks)) && nav.findPath(line, 2, 0, 2, 0, data.objectBlocks).length === 0);

// wall in the middle forces a detour (never steps on the wall tile)
const maze = room(5, 3);
for (let y = 0; y < 2; y++) maze.tiles[y][2].wall = data.createWall('block', 0, 'hull');   // partial vertical wall
const p2 = nav.findPath(maze, 0, 0, 4, 0, data.objectBlocks);
check('A* routes around a wall', !!p2 && p2[p2.length - 1].x === 4);
check('A* never steps on a blocking wall tile', !!p2 && p2.every(n => !(n.x === 2 && (n.y === 0 || n.y === 1))));

// fully walled-off target → no path
const sealed = room(3, 3);
for (const [x, y] of [[1, 0], [0, 1], [2, 1], [1, 2]]) sealed.tiles[y][x].wall = data.createWall('block', 0, 'hull');
check('no path to a fully walled-off tile', nav.findPath(sealed, 0, 0, 1, 1, data.objectBlocks) === null);
check('path to an out-of-bounds tile is null', nav.findPath(open, 0, 0, 9, 9, data.objectBlocks) === null);

// diagonal must not cut a wall corner: with (1,0) walled, the (0,0)->(1,1)
// diagonal is forbidden, so the pawn detours through (0,1) instead of clipping
// the corner of the wall.
const corner = room(3, 3);
corner.tiles[0][1].wall = data.createWall('block', 0, 'hull');   // north-of-start-diagonal
const p3 = nav.findPath(corner, 0, 0, 2, 2, data.objectBlocks);
check('A* reaches past a corner wall', !!p3 && p3[p3.length - 1].x === 2 && p3[p3.length - 1].y === 2);
check('A* does not cut the wall corner on the first step', !!p3 && !(p3[0].x === 1 && p3[0].y === 1));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
