/*
 * UGS — data + save layer self-test.  Run: node src/data.test.js
 * (was core.test.js before the core foundation took that name)
 */
'use strict';
const data = require('./data.js');
const save = require('./save.js');

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  ok  ', name); }
  else { failed++; console.error('  FAIL', name); }
}

console.log('UGS data/save self-test\n');

// 1. a fresh save is well-formed
const s = data.createSaveFile('Test Station');
check('save has format tag', s.format === data.FORMAT && s.formatVersion === data.FORMAT_VERSION);
check('save has one level', s.levels.length === 1);
check('level has one room', s.levels[0].rooms.length === 1);
check('startLevelId points at a real level', s.levels.some(l => l.id === s.startLevelId));
check('room tiles match declared size', (() => {
  const r = s.levels[0].rooms[0];
  return r.tiles.length === r.size.h && r.tiles[0].length === r.size.w;
})());
check('room has a transform with normalised rotation', (() => {
  const t = s.levels[0].rooms[0].transform;
  return typeof t.x === 'number' && [0, 90, 180, 270].includes(t.rotation);
})());

// 2. building it up
const lvlA = s.levels[0];
const roomA = lvlA.rooms[0];
roomA.objects.push(data.createObjectInstance('console', 3, 3));
roomA.objects.push(data.createObjectInstance('miner', 5, 4));
roomA.movable = true;
roomA.events.push(data.createRoomEvent('slide open'));

const lvlB = data.createLevel('Deck 2');
s.levels.push(lvlB);
const link = data.createLink(lvlA.id, lvlB.id);
link.from = { levelId: lvlA.id, roomId: roomA.id, x: 5, y: 4 };
link.to = { levelId: lvlB.id, roomId: lvlB.rooms[0].id, x: 2, y: 2 };
s.links.push(link);

check('object carries reserved subsystem fields', roomA.objects[1].power === 5 && roomA.objects[1].heat === 4);
check('object carries a layer', roomA.objects[0].layer === 'electrical');
check('link endpoints reference real levels', link.from.levelId === lvlA.id && link.to.levelId === lvlB.id);

// 3. round-trip
const json = save.serialize(s);
const { save: s2, warnings } = save.deserialize(json);
check('round-trip parses without warnings', warnings.length === 0);
check('round-trip preserves level count', s2.levels.length === 2);
check('round-trip preserves objects', s2.levels[0].rooms[0].objects.length === 2);
check('round-trip preserves link', s2.links.length === 1 && s2.links[0].to.levelId === lvlB.id);
check('round-trip preserves room movability + event', (() => {
  const r = s2.levels[0].rooms[0];
  return r.movable === true && r.events.length === 1;
})());
check('round-trip keeps startLevelId valid', s2.levels.some(l => l.id === s2.startLevelId));

// 3b. orbit event round-trips with all fields (regression)
const orbitSave = data.createSaveFile('orb');
const oev = data.createRoomEvent('o');
oev.action = { kind: 'orbit', center: { x: 3, y: 4 }, radius: 7, period: 5, direction: 'ccw', selfRotate: true };
orbitSave.levels[0].rooms[0].events.push(oev);
const oe2 = save.deserialize(save.serialize(orbitSave)).save.levels[0].rooms[0].events[0];
check('orbit event survives round-trip', oe2.action.kind === 'orbit' && oe2.action.radius === 7 && oe2.action.direction === 'ccw' && oe2.action.selfRotate === true);

// 4. robustness: garbage input coerced, not crashed
const dirty = {
  format: data.FORMAT,
  name: 'Dirty',
  startLevelId: 'does-not-exist',
  levels: [{
    id: 'L1',
    rooms: [{
      id: 'R1',
      size: { w: 3, h: 2 },
      tiles: [[{ floor: 'NOPE', wall: 'bogus' }, null, {}], [{ floor: 'deck', wall: 'solid' }]],
      objects: [{ type: 'ghost', x: 99, y: 99 }, { type: 'crate', x: 1, y: 1 }],
      transform: { x: 4, y: 4, rotation: 47 }
    }]
  }],
  links: [{ from: { levelId: 'L1' }, to: { levelId: 'MISSING' } }]
};
const { save: s3, warnings: w3 } = save.deserialize(dirty);
check('bad floor material coerced to deck', s3.levels[0].rooms[0].tiles[0][0].floor === 'deck');
check('bad wall shape coerced to null', s3.levels[0].rooms[0].tiles[0][0].wall === null);
check('unknown object type dropped, valid kept', s3.levels[0].rooms[0].objects.length === 1 && s3.levels[0].rooms[0].objects[0].type === 'crate');
check('out-of-bounds object clamped into room', (() => { const o = s3.levels[0].rooms[0].objects[0]; return o.x <= 2 && o.y <= 1; })());
check('odd rotation snapped to the 45° step', [0, 45, 90, 135, 180, 225, 270, 315].includes(s3.levels[0].rooms[0].transform.rotation) && s3.levels[0].rooms[0].transform.rotation === 45);
check('dangling link dropped with a warning', s3.links.length === 0 && w3.some(w => /link/i.test(w)));
check('invalid startLevelId repaired', s3.levels.some(l => l.id === s3.startLevelId));

// 5. foreign format rejected
let rejected = false;
try { save.deserialize({ format: 'some-other-game', levels: [] }); } catch (e) { rejected = true; }
check('foreign format is rejected', rejected);

// 6. resizeRoom — pure resize with content preservation
function mkRoom(w, h) {
  const r = data.createRoom('R', w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) r.tiles[y][x] = data.createTile('deck');
  return r;
}
// enlarge (nw): existing tiles/objects preserved, new tiles added
{
  const r = mkRoom(4, 4);
  r.tiles[1][1] = { floor: 'dark', wall: 'solid', wallMaterial: 'hull' };
  r.objects.push(data.createObjectInstance('crate', 2, 2));
  const res = data.resizeRoom(r, 6, 5, { anchor: 'nw' });
  check('enlarge ok', res.ok === true && r.size.w === 6 && r.size.h === 5);
  check('enlarge preserves a painted tile', r.tiles[1][1].floor === 'dark' && r.tiles[1][1].wall === 'solid');
  check('enlarge keeps object in place (nw offset 0)', r.objects[0].x === 2 && r.objects[0].y === 2);
  check('enlarge adds default floor tiles', r.tiles[4][5].floor === 'deck');
}
// center anchor shifts content
{
  const r = mkRoom(2, 2);
  r.objects.push(data.createObjectInstance('crate', 0, 0));
  const res = data.resizeRoom(r, 4, 4, { anchor: 'center' });
  check('center offset applied to object', res.offset.dx === 1 && res.offset.dy === 1 && r.objects[0].x === 1 && r.objects[0].y === 1);
}
// shrink that would drop an object: blocked without force, untouched
{
  const r = mkRoom(5, 5);
  r.objects.push(data.createObjectInstance('crate', 4, 4));
  const res = data.resizeRoom(r, 3, 3, { anchor: 'nw' });
  check('shrink dropping objects is blocked', res.ok === false && res.wouldDrop.length === 1);
  check('blocked shrink does not mutate the room', r.size.w === 5 && r.objects.length === 1);
}
// shrink with force: object dropped and reported
{
  const r = mkRoom(5, 5);
  r.objects.push(data.createObjectInstance('crate', 4, 4));
  r.objects.push(data.createObjectInstance('crate', 1, 1));
  const res = data.resizeRoom(r, 3, 3, { anchor: 'nw', force: true });
  check('forced shrink applies and drops out-of-bounds object', res.ok === true && res.dropped.length === 1 && r.objects.length === 1);
  check('forced shrink keeps in-bounds object', r.objects[0].x === 1 && r.objects[0].y === 1);
  check('forced shrink reports trimmed tiles', res.warnings.some(w => /trim/i.test(w)));
}
// pivot clamped into new bounds on shrink
{
  const r = mkRoom(6, 6);
  r.transform.pivot = { x: 6, y: 6 };
  const res = data.resizeRoom(r, 3, 3, { anchor: 'nw', force: true });
  check('pivot clamped to new size', r.transform.pivot.x <= 3 && r.transform.pivot.y <= 3 && res.ok === true);
}
// clamps absurd sizes into 1..64
{
  const r = mkRoom(3, 3);
  data.resizeRoom(r, 999, 0, { force: true });
  check('resize clamps size to 1..64', r.size.w === 64 && r.size.h === 1);
}

// 6b. resizeRoom dryRun + structured trim counts (BUG-04)
{
  const r = mkRoom(5, 5);
  // paint a wall on the far edge that a shrink will trim
  r.tiles[4][4] = { floor: 'deck', wall: 'solid', wallMaterial: 'hull' };
  r.objects.push(data.createObjectInstance('crate', 4, 0));   // will fall outside a 3x3 nw shrink
  const dry = data.resizeRoom(r, 3, 3, { anchor: 'nw', dryRun: true });
  check('dryRun does not mutate the room', r.size.w === 5 && r.size.h === 5 && r.objects.length === 1);
  check('dryRun reports objects that would drop', dry.wouldDrop.length === 1);
  check('dryRun reports trimmed walls and tiles separately', dry.trimmedWalls === 1 && dry.trimmedTiles > 0);
  const real = data.resizeRoom(r, 3, 3, { anchor: 'nw', force: true });
  check('real resize returns the same trim counts', real.trimmedWalls === 1 && real.trimmedTiles === dry.trimmedTiles);
  check('real resize actually shrank', r.size.w === 3 && r.size.h === 3);
}

// 6c. per-axis anchor for edge/corner resize handles (R2-04)
{
  const r = mkRoom(4, 4);
  r.objects.push(data.createObjectInstance('crate', 1, 1));
  // grow width to the left (west edge): ax 'hi' shifts content right by the delta
  const res = data.resizeRoom(r, 6, 4, { ax: 'hi', ay: 'lo' });
  check('ax:hi shifts content on x only', res.offset.dx === 2 && res.offset.dy === 0);
  check('ax:hi moved the object right', r.objects[0].x === 3 && r.objects[0].y === 1);
  const r2 = mkRoom(4, 4);
  const res2 = data.resizeRoom(r2, 6, 6, { ax: 'lo', ay: 'hi' });   // NE corner: grow right + top
  check('corner anchor offsets each axis independently', res2.offset.dx === 0 && res2.offset.dy === 2);
}

// 7. rotation authoring step (45°)
check('ROT_STEP is 45', data.ROT_STEP === 45);
check('snapAngle rounds to nearest 45', data.snapAngle(47) === 45 && data.snapAngle(30) === 45 && data.snapAngle(20) === 0);
check('snapAngle keeps cardinals', data.snapAngle(90) === 90 && data.snapAngle(270) === 270);
check('snapAngle wraps negatives and >=360', data.snapAngle(-45) === 315 && data.snapAngle(360) === 0);
check('createTransform snaps rotation to 45', data.createTransform(0, 0, 100).rotation === 90 && data.createTransform(0, 0, 115).rotation === 135);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
