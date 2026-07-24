/* UGS — tests de core/core + core/data + core/save.  node tests/core.test.js */
'use strict';
const CORE = require('../src/core/core.js');
const D = require('../src/core/data.js');
const S = require('../src/core/save.js');

let passed = 0, failed = 0;
const check = (n, c) => { if (c) { passed++; console.log('  ok  ', n); } else { failed++; console.error('  FAIL', n); } };

console.log('UGS core/data/save tests\n');

// ids
check('ids únicos', CORE.uid('x') !== CORE.uid('x'));

// EventBus síncrono
{
  const bus = new CORE.EventBus();
  const order = [];
  bus.on('a', () => order.push(1));
  bus.on('a', () => order.push(2));
  bus.emit('a');
  check('bus emite en orden de suscripción', order.join(',') === '1,2');
  const off = bus.on('b', () => order.push(3));
  off(); bus.emit('b');
  check('bus off funciona', order.length === 2);
}

// FixedTimestep
{
  const ft = new CORE.FixedTimestep(30, 6);
  let steps = 0, acc = 0;
  ft.advance(0.1, (dt) => { steps++; acc += dt; });
  check('100 ms reales → 3 pasos de 30 Hz', steps === 3 && Math.abs(acc - 0.1) < 1 / 30);
  check('paso fijo constante', Math.abs(ft.step - 1 / 30) < 1e-12);
}

// data: estación por defecto válida
{
  const st = D.createStation('Test');
  check('estación tiene 1 Nexo con 1 sala', st.nexos.length === 1 && st.nexos[0].rooms.length === 1);
  check('entry apunta a sala existente', st.nexos[0].rooms.some(r => r.id === st.nexos[0].entry.roomId));
  const n = st.nexos[0];
  check('anillo de paredes en la sala inicial', n.rooms[0].tiles[0][0].wall && n.rooms[0].tiles[0][0].wall.kind === 'block');
}

// C1: TODA pared bloquea (createWall + normalizeWall)
{
  for (const kind of D.WALL_KINDS) {
    check('createWall ' + kind + ' nace full', D.createWall(kind, 45).collision === 'full');
  }
  check('normalizeWall fuerza full aunque venga partial', D.normalizeWall({ kind: 'diagonal', orientation: 0, collision: 'partial' }).collision === 'full');
  check('normalizeWall repara kind desconocido', D.normalizeWall({ kind: '???' }).kind === 'block');
}

// save: round-trip
{
  const st = D.createStation('Viaje');
  st.nexos[0].rooms[0].objects.push(D.createObjectInstance('door', 3, 3));
  const back = S.deserialize(S.serialize(st));
  check('round-trip conserva nombre', back.name === 'Viaje');
  check('round-trip conserva objetos', back.nexos[0].rooms[0].objects.length === 1 && back.nexos[0].rooms[0].objects[0].type === 'door');
  check('round-trip conserva paredes full', back.nexos[0].rooms[0].tiles[0][0].wall.collision === 'full');
}

// save: basura no rompe, esquema se repara
{
  const fixed = S.deserialize(JSON.stringify({ name: 5, nexos: [{ id: 'n1', rooms: [{ size: { w: 4, h: 4 }, tiles: [[[{ floor: 'void', wall: { kind: 'x' } }]]] }] }] }));
  check('normalize repara estación rota', fixed.nexos.length === 1 && fixed.nexos[0].rooms[0].size.w === 4);
  check('JSON inválido lanza error claro', (() => { try { S.deserialize('{no'); return false; } catch (e) { return /invalid JSON/.test(e.message); } })());
}

// links: solo válidos entre Nexos existentes
{
  const st = D.createStation();
  const a = st.nexos[0], b = D.createNexo('Nexo 2');
  st.nexos.push(b);
  st.links.push(D.createLink(a.id, b.id));
  st.links.push(D.createLink(a.id, 'fantasma'));
  const back = S.deserialize(S.serialize(st));
  check('links fantasma se descartan', back.links.length === 1);
  check('link válido sobrevive', back.links[0].to.nexoId === b.id);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
