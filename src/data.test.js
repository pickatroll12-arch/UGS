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
check('odd rotation snapped to a right angle', [0, 90, 180, 270].includes(s3.levels[0].rooms[0].transform.rotation));
check('dangling link dropped with a warning', s3.links.length === 0 && w3.some(w => /link/i.test(w)));
check('invalid startLevelId repaired', s3.levels.some(l => l.id === s3.startLevelId));

// 5. foreign format rejected
let rejected = false;
try { save.deserialize({ format: 'some-other-game', levels: [] }); } catch (e) { rejected = true; }
check('foreign format is rejected', rejected);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
