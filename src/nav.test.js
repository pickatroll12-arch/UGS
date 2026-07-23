/*
 * UGS — navigation self-test.  Run: node src/nav.test.js
 */
'use strict';
const nav = require('./nav.js');
const data = require('./data.js');

let pass = 0, fail = 0;
const ck = (n, c) => { if (c) { pass++; console.log('  ok  ', n); } else { fail++; console.error('  FAIL', n); } };
console.log('UGS nav self-test\n');

function room(w, h) {
  const r = data.createRoom('t', w, h);
  r.tiles = Array.from({ length: h }, () => Array.from({ length: w }, () => data.createTile('deck')));
  return r;
}
function wall(r, x, y) { r.tiles[y][x] = { floor: 'deck', wall: 'solid', wallMaterial: 'hull' }; }

// --- straight path in open room ---
{
  const r = room(8, 6);
  const p = nav.findPath(r, 0, 0, 7, 5, data.objectBlocks);
  ck('open path found', Array.isArray(p) && p.length > 0);
  ck('path ends at goal', p[p.length - 1].x === 7 && p[p.length - 1].y === 5);
  ck('path steps are adjacent', p.every((n, i) => i === 0 || (Math.abs(n.x - p[i - 1].x) <= 1 && Math.abs(n.y - p[i - 1].y) <= 1)));
}

// --- routes around a wall ---
{
  const r = room(7, 7);
  for (let y = 0; y < 6; y++) wall(r, 3, y);          // vertical wall with a gap at bottom
  const p = nav.findPath(r, 0, 3, 6, 3, data.objectBlocks);
  ck('path around wall exists', !!p && p.length > 0);
  ck('path never steps on a wall', p.every(n => !r.tiles[n.y][n.x].wall));
}

// --- fully walled off → no path ---
{
  const r = room(7, 7);
  for (let y = 0; y < 7; y++) wall(r, 3, y);          // full divider
  const p = nav.findPath(r, 0, 3, 6, 3, data.objectBlocks);
  ck('no path through solid divider', p === null);
}

// --- diagonal corner cutting is prevented ---
{
  const r = room(4, 4);
  wall(r, 1, 0); wall(r, 0, 1);                        // corner block at (0,0)->(1,1)
  const p = nav.findPath(r, 0, 0, 1, 1, data.objectBlocks);
  // must not be a single diagonal squeeze between the two walls
  ck('no diagonal corner cut', !p || !(p.length === 1 && p[0].x === 1 && p[0].y === 1));
}

// --- closed door blocks, open door passes ---
{
  const r = room(5, 3);
  for (let y = 0; y < 3; y++) if (y !== 1) wall(r, 2, y);   // wall column with a doorway at (2,1)
  const door = data.createObjectInstance('door', 2, 1);     // closed by default
  r.objects.push(door);
  const blocked = nav.findPath(r, 0, 1, 4, 1, data.objectBlocks);
  ck('closed door blocks the only route', blocked === null);
  door.open = true;
  const open = nav.findPath(r, 0, 1, 4, 1, data.objectBlocks);
  ck('open door lets the path through', !!open && open.some(n => n.x === 2 && n.y === 1));
}

// --- blocked start is snapped to nearest walkable ---
{
  const r = room(6, 6);
  wall(r, 2, 2);
  const p = nav.findPath(r, 2, 2, 5, 5, data.objectBlocks);   // start on a wall
  ck('blocked start snapped, still paths', !!p && p.length > 0);
}

// --- walk grid reflects collisions ---
{
  const r = room(4, 4);
  wall(r, 1, 1);
  r.objects.push(data.createObjectInstance('crate', 2, 2));    // crate collides
  const g = nav.buildWalkGrid(r, data.objectBlocks);
  ck('grid marks wall blocked', g.get(1, 1) === 0);
  ck('grid marks crate blocked', g.get(2, 2) === 0);
  ck('grid marks open floor walkable', g.get(0, 0) === 1);
}

// --- partial-wall (diagonal) collision: walkable tile, closed side blocks (R2-06 ph2) ---
// REV3: partial collision is now OPT-IN (4th arg) — the default for every wall
// kind is full, so a default diagonal blocks its whole tile (human feedback).
{
  const r = room(3, 3);
  r.tiles[1][1].wall = data.createWall('diagonal', 0, 'hull', 'partial');   // opt-in partial, closes E/S/SE
  const g = nav.buildWalkGrid(r, data.objectBlocks);
  ck('partial wall keeps its tile walkable', g.get(1, 1) === 1);
  ck('dirClosed: east closed at orient 0', nav.dirClosed(r.tiles[1][1].wall, 1, 0) === true);
  ck('dirClosed: west open at orient 0', nav.dirClosed(r.tiles[1][1].wall, -1, 0) === false);
  ck('cross east off a partial wall is blocked', nav.crossBlocked(r, 1, 1, 1, 0) === true);
  ck('cross west off a partial wall is allowed', nav.crossBlocked(r, 1, 1, -1, 0) === false);

  const r2 = room(3, 3);
  r2.tiles[1][1].wall = data.createWall('block', 0, 'hull');     // full block
  ck('a full block tile is NOT walkable', nav.buildWalkGrid(r2, data.objectBlocks).get(1, 1) === 0);

  const r3 = room(3, 3);
  r3.tiles[1][1].wall = data.createWall('diagonal', 0, 'hull');  // REV3: default diagonal → full
  ck('REV3: a default diagonal wall tile is NOT walkable', nav.buildWalkGrid(r3, data.objectBlocks).get(1, 1) === 0);
}
// a partial wall that closes the only 1-wide corridor blocks the path
{
  const r = room(3, 5);
  for (let y = 0; y < 5; y++) { wall(r, 0, y); wall(r, 2, y); }        // walls either side → column 1 corridor
  r.tiles[2][1].wall = data.createWall('diagonal', 180, 'hull', 'partial'); // closes W/N/NW → can't be entered from the north
  const p = nav.findPath(r, 1, 0, 1, 4, data.objectBlocks);
  ck('partial wall closing the only corridor blocks the path', p === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
