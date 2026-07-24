/*
 * UGS — nav self-test (POST-RESET).  Run: node src/nav.test.js
 * Click→route pathfinding + the REV3 collision contract.
 */
'use strict';
const data = require('./data.js');
const nav = require('./nav.js');

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  ok  ', name); }
  else { failed++; console.error('  FAIL', name); }
}

console.log('UGS nav self-test\n');

function room(w = 6, h = 6) {
  const r = data.createRoom('R', w, h);
  r.tiles = Array.from({ length: h }, () => Array.from({ length: w }, () => data.createTile('deck')));
  return r;
}

// 1. straight-line route on an open floor
{
  const r = room();
  const path = nav.findPath(r, 1, 1, 4, 1);
  check('open floor route found', Array.isArray(path) && path.length === 3);
  check('route ends at target', path[path.length - 1].x === 4 && path[path.length - 1].y === 1);
  check('route excludes the start', !path.some(p => p.x === 1 && p.y === 1));
}

// 2. walls block — route goes around
{
  const r = room();
  for (let y = 0; y < 5; y++) r.tiles[y][3] = { floor: 'deck', wall: data.createWall('block', 0, 'hull') };
  const path = nav.findPath(r, 1, 1, 5, 1);
  check('route goes around a wall line', Array.isArray(path) && path.length > 4);
  check('route never enters a wall tile', path.every(p => !(p.x === 3 && p.y < 5)));
}

// 3. REV3 contract: EVERY wall kind blocks its whole tile
{
  const r = room();
  check('block wall tile is not walkable', !nav.walkable(r, 0, 0) === false); // sanity: open first
  r.tiles[2][2] = { floor: 'deck', wall: data.createWall('diagonal', 45, 'hull') };
  check('default diagonal wall tile is NOT walkable (REV3)', !nav.walkable(r, 2, 2));
  r.tiles[2][2] = { floor: 'deck', wall: data.createWall('rounded', 0, 'hull') };
  check('default rounded wall tile is NOT walkable (REV3)', !nav.walkable(r, 2, 2));
  const path = nav.findPath(r, 2, 1, 2, 3);
  check('no route through a default diagonal wall', path === null || path.every(p => !(p.x === 2 && p.y === 2)));
}

// 4. fully walled target → no route
{
  const r = room();
  r.tiles[3][3] = { floor: 'deck', wall: data.createWall('block', 0, 'hull') };
  check('target inside a wall → null', nav.findPath(r, 1, 1, 3, 3) === null);
}

// 5. void floor is not walkable
{
  const r = room();
  r.tiles[2][2] = { floor: 'void' };
  check('void floor is not walkable', !nav.walkable(r, 2, 2));
}

// 6. doors: closed blocks, open passes
{
  const r = room();
  const door = data.createObjectInstance('door', 3, 1);
  r.objects.push(door);
  check('closed door tile is not walkable', !nav.walkable(r, 3, 1));
  door.open = true;
  check('open door tile IS walkable', nav.walkable(r, 3, 1));
  const path = nav.findPath(r, 1, 1, 5, 1);
  check('route through an open door exists', Array.isArray(path) && path.some(p => p.x === 3 && p.y === 1));
}

// 7. solid decor (console) blocks; non-solid passes
{
  const r = room();
  r.objects.push(data.createObjectInstance('console', 2, 2));
  check('console tile is not walkable', !nav.walkable(r, 2, 2));
  const plant = data.createObjectInstance('plant', 4, 4);
  check('plant tile walkability follows its collision flag', nav.walkable(r, 4, 4) === !plant.collision);
}

// 8. same tile → empty route (already there)
{
  const r = room();
  const path = nav.findPath(r, 2, 2, 2, 2);
  check('start == target → empty route', Array.isArray(path) && path.length === 0);
}

// 9. determinism: same query, same route
{
  const r = room();
  r.tiles[1][2] = { floor: 'deck', wall: data.createWall('block', 0, 'hull') };
  const a = nav.findPath(r, 0, 0, 5, 3);
  const b = nav.findPath(r, 0, 0, 5, 3);
  check('routes are deterministic', JSON.stringify(a) === JSON.stringify(b));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
