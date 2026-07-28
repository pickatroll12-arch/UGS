/* UGS — tests de la capa estratégica (core/rng + engine/station).
   Las defs usadas aquí son FIXTURES DE TEST, no contenido del juego:
   el contenido F1 del árbol humano es OBJP-1.1 (congelado).
   node tests/station.test.js */
'use strict';
const CORE = require('../src/core/core.js');
const RNG = require('../src/core/rng.js');
const D = require('../src/core/data.js');
const S = require('../src/core/save.js');
const ST = require('../src/engine/station.js');

let passed = 0, failed = 0;
const check = (n, c) => { if (c) { passed++; console.log('  ok  ', n); } else { failed++; console.error('  FAIL', n); } };

console.log('UGS station/rng tests\n');

// ---- rng: determinismo ------------------------------------------------------
{
  const a = RNG.create('semilla'), b = RNG.create('semilla');
  const sa = [a.next(), a.next(), a.next()].join(',');
  const sb = [b.next(), b.next(), b.next()].join(',');
  check('misma semilla → misma secuencia', sa === sb);
  const c = RNG.create('otra');
  check('semilla distinta → secuencia distinta', c.next() !== a.next() || c.next() !== a.next());
  const r = RNG.create(42);
  check('range() respeta límites', Array.from({ length: 50 }, () => r.range(2, 5)).every(v => v >= 2 && v <= 5));
  const p = RNG.create('p');
  check('chance(0) nunca, chance(1) siempre', !p.chance(0) && p.chance(1));
  const q = RNG.create('s');
  const st = q.state; const v1 = q.next();
  q.state = st;
  check('state restaurable reproduce el valor', q.next() === v1);
}

// ---- fixtures ---------------------------------------------------------------
function mkStation(cred) { const s = D.createStation('T'); s.state.cred = cred || 0; return s; }
function mkEngine(withBus) {
  const bus = withBus === true ? new CORE.EventBus() : (withBus || null);
  const st = ST.create({ bus, rng: RNG.create('test') });
  st.defineModule({ id: 'gen', name: 'Generador', cost: 0, free: true, energyUse: 0, provides: { energy: 100 } });
  st.defineModule({ id: 'almacen', name: 'Almacén', cost: 200, free: true, energyUse: 5, provides: { storage: 30 } });
  st.defineModule({ id: 'hab', name: 'Habitacional', cost: 100, free: true, energyUse: 5, provides: { pnjCapacity: 12 } });
  return st;
}
function mkRoomAt(name, w, h, x, y) {
  const r = D.createRoom(name, w, h);
  r.transform.x = x; r.transform.y = y;
  return r;
}

// ---- economía -----------------------------------------------------------------
{
  const st = mkEngine();
  const s = mkStation(500);
  check('canAfford/pay', st.canAfford(s, 300) && st.pay(s, 300) && s.state.cred === 200 && !st.pay(s, 300));
  st.earn(s, 50);
  check('earn suma CRED', s.state.cred === 250);
  check('sin almacén no cabe nada (storageCap 0)', st.addItem(s, 'mineral', 5) === 0);
  s.state.storageCap = 30;
  check('addItem respeta el tope UD', st.addItem(s, 'mineral', 40) === 30 && st.storedTotal(s) === 30);
  check('removeItem descuenta en UD', st.removeItem(s, 'mineral', 12) === 12 && st.storedTotal(s) === 18);
}

// ---- módulos: colocación con conexión física ------------------------------------
{
  const st = mkEngine();
  const s = mkStation(1000);
  const nexo = s.nexos[0];
  const main = nexo.rooms[0];   // 12×9 en (0,0)
  // primero el generador (gratis, provee energía)
  const r1 = st.placeModule(s, nexo, 'gen', mkRoomAt('Gen', 4, 4, 12, 0));
  check('placeModule generador conectado al Nexo', r1.ok && s.state.energy.capacity === 100);
  // almacén pegado al generador (12..16 en x → pegar en x=16)
  const r2 = st.placeModule(s, nexo, 'almacen', mkRoomAt('Alm', 4, 4, 16, 0));
  check('placeModule almacén conectado módulo→módulo', r2.ok && s.state.storageCap === 35 && s.state.cred === 800);  // 30 del def + 5 base del Nexo
  // desconectado: flotando lejos
  const r3 = st.placeModule(s, nexo, 'hab', mkRoomAt('Hab', 4, 4, 40, 40));
  check('placeModule rechaza sala desconectada', !r3.ok && /conexión/.test(r3.reason));
  // energía insuficiente: 2 almacenes más (5+5+5=15 ≤ 100 ok) — forzamos con def cara energéticamente
  st.defineModule({ id: 'devorador', cost: 0, free: true, energyUse: 200 });
  const r4 = st.placeModule(s, nexo, 'devorador', mkRoomAt('Dev', 2, 2, 0, 9));
  check('placeModule rechaza sin headroom energético', !r4.ok && /energía/.test(r4.reason));
  st.defineModule({ id: 'radar', name: 'Radar', cost: 0, energyUse: 0 });   // NO free: exige hito
  const r5 = st.placeModule(s, nexo, 'radar', mkRoomAt('Rad', 2, 2, 0, 9));
  check('placeModule rechaza módulo sin hito (no buildable)', !r5.ok && /hito/.test(r5.reason));
  check('blackout se calcula en recompute', (() => { s.state.modules.push({ id: 'x', defId: 'devorador' }); st.recompute(s); return s.state.blackout === true; })());
}

// ---- hitos y fases -----------------------------------------------------------------
{
  const st = mkEngine();
  st.defineHito({ id: 'h1', phase: 1, cost: 100, grants: { modules: ['almacen'] } });
  st.defineHito({ id: 'h2', phase: 1, cost: 50, requires: ['h1'], grants: { abilities: ['dar_tareas'] } });
  st.defineHito({ id: 'h3', phase: 2, cost: 10 });
  const s = mkStation(1000);
  check('h2 bloqueado por requires', !st.hitoStatus(s, 'h2').ok);
  check('hito desconocido rechazado', !st.hitoStatus(s, 'nope').ok);
  check('unlock h1 otorga módulo construible', st.unlockHito(s, 'h1').ok && s.state.buildable.includes('almacen') && s.state.cred === 900);
  check('unlock h2 otorga habilidad', st.unlockHito(s, 'h2').ok && s.state.abilities.includes('dar_tareas'));
  check('fase avanza al completar sus hitos', s.state.phase === 2);
  check('doble unlock rechazado', !st.unlockHito(s, 'h1').ok);
  check('nexoLimit = min(fase, 3)', st.nexoLimit(s) === 2 && (s.state.phase = 5, st.nexoLimit(s) === 3));
}

// ---- scheduler RNG ------------------------------------------------------------------
{
  const bus = new CORE.EventBus();
  const st = mkEngine(bus);
  const s = mkStation(0);
  let fired = 0;
  bus.on('station:event', () => fired++);
  st.addTimer({ id: 'falla_gen', interval: 10, chance: 1 });   // 100% para el test
  for (let i = 0; i < 25; i++) st.update(s, 1);                 // 25 s → 2 disparos
  check('timer dispara por intervalo', fired === 2);
  // con chance real: determinista por semilla
  const run = () => {
    const b2 = new CORE.EventBus();
    const e = ST.create({ bus: b2, rng: RNG.create('suerte') });
    let n = 0; b2.on('station:event', () => n++);
    e.addTimer({ id: 'x', interval: 1, chance: 0.5 });
    const s2 = mkStation(0);
    for (let i = 0; i < 100; i++) e.update(s2, 1);
    return n;
  };
  check('scheduler RNG determinista por semilla', run() === run());
}

// ---- expedición (fuera de pantalla) ----------------------------------------------------
{
  const bus = new CORE.EventBus();
  const mk = () => {
    const e = ST.create({ bus, rng: RNG.create('ruta') });
    e.defineRoute({
      id: 'extraccion', failChance: 0.1,
      stages: [
        { duration: 60, yields: [{ chance: 1, item: 'mineral', min: 1, max: 1 }] },              // etapa 1: 1UD segura
        { duration: 60, yields: [{ chance: 0.65, item: 'mineral', min: 1, max: 1 }] },           // etapa 3 del árbol
        { duration: 60, yields: [{ chance: 0.15, item: 'mineral', min: 5, max: 5 }] }            // etapa 5 del árbol
      ]
    });
    return e;
  };
  const run = () => {
    const e = mk();
    const s = mkStation(0);
    s.state.storageCap = 30;
    const ship = e.addShip(s, { id: 'n1', capacity: 5 });
    e.launchExpedition(s, 'extraccion', 'n1');
    for (let i = 0; i < 300 * 30; i++) e.update(s, 1 / 30);   // 5 min de simulación (margen float)
    return JSON.stringify({ inv: s.state.inventory, ship: ship.state });
  };
  const a = run(), b = run();
  check('expedición completa es determinista', a === b);
  const res = JSON.parse(a);
  check('la nave vuelve (idle o damaged)', res.ship === 'idle' || res.ship === 'damaged');
  if (res.ship === 'idle') check('descarga respeta UD/capacidad', (res.inv.mineral || 0) <= 5);
  // estados de la nave
  const e = mk();
  const s = mkStation(0);
  check('launch con ruta desconocida falla', !e.launchExpedition(s, 'nada', 'n1').ok);
  const sh = e.addShip(s, { id: 'n1' });
  sh.state = 'out';
  check('launch con nave ocupada falla', !e.launchExpedition(s, 'extraccion', 'n1').ok);
  sh.state = 'damaged';
  s.state.cred = 100;
  check('reparar nave cuesta CRED y la deja idle', e.repairShip(s, 'n1', 50).ok && sh.state === 'idle' && s.state.cred === 50);
}

// ---- persistencia de la capa estratégica --------------------------------------------------
{
  const st = mkEngine();
  const s = mkStation(777);
  s.state.inventory.mineral = 9;
  s.state.phase = 3;
  s.state.unlocked.push('h1');
  const back = S.deserialize(S.serialize(s));
  check('save round-trip conserva la capa estratégica', back.state.cred === 777 && back.state.inventory.mineral === 9 && back.state.phase === 3 && back.state.unlocked[0] === 'h1');
  check('save viejo sin state se repara', (() => { const b2 = S.deserialize(JSON.stringify({ name: 'x', nexos: [] })); return b2.state && b2.state.phase === 1 && b2.state.cred === 0; })());
}

// ---- energía TW: agregado, brownout y evento (K1 · OBJP-1.1) -------------------
{
  const bus = new CORE.EventBus();
  const st = mkEngine(bus);
  const s = mkStation(1000);
  const nexo = s.nexos[0];   // sala main 12×9 en (0,0)
  let boEvt = null;
  bus.on('station:blackout', e => { boEvt = e.blackout; });
  check('reactor aporta capacidad TW',
    st.placeModule(s, nexo, 'gen', mkRoomAt('Gen', 4, 4, 12, 0)).ok && s.state.energy.capacity === 100);
  check('módulo consumidor suma uso sin brownout',
    st.placeModule(s, nexo, 'almacen', mkRoomAt('Alm', 4, 4, 16, 0)).ok && s.state.energy.used === 5 && !s.state.blackout);
  // perder el reactor CON consumo activo (retirada como hace la app: splice + recompute)
  s.state.modules = s.state.modules.filter(m => m.defId !== 'gen');
  st.recompute(s);
  check('perder el reactor → brownout + evento', s.state.blackout === true && boEvt === true);
  const rt = S.deserialize(S.serialize(s));
  check('blackout sobrevive al save', rt.state.blackout === true && rt.state.energy.used === 5);
  const r = st.placeModule(s, nexo, 'almacen', mkRoomAt('A2', 4, 4, 12, 5));
  check('gating: sin capacidad no se coloca consumo', !r.ok && r.reason === 'energía insuficiente');
  s.state.modules = s.state.modules.filter(m => m.defId !== 'almacen');
  st.recompute(s);
  check('brownout se restablece al quitar consumo', s.state.blackout === false && boEvt === false && s.state.energy.used === 0);
}

// ---- hangar: capacidad de naves seteable (K2 · OBJP-1.1) ------------------------
{
  const st = mkEngine();
  st.defineModule({ id: 'hangar', name: 'Hangar', cost: 0, free: true, energyUse: 10, provides: { shipCap: 2 } });
  const s = mkStation(1000);
  const nexo = s.nexos[0];
  st.placeModule(s, nexo, 'gen', mkRoomAt('Gen', 4, 4, 12, 0));        // energía para el hangar
  st.placeModule(s, nexo, 'hangar', mkRoomAt('Hangar', 8, 6, 12, 4));
  const hroom = nexo.rooms.find(r => r.name === 'Hangar');
  check('capacidad de naves desde provides.shipCap', st.shipCapacity(s, [nexo]) === 2);
  const s1 = st.addShip(s, { capacity: 5 }, [nexo]);
  const s2 = st.addShip(s, { capacity: 5 }, [nexo]);
  check('dos naves caben en el hangar', s1 && s2 && s.state.ships.length === 2);
  check('amarre asignado a la sala del hangar', s1.hangarRoomId === hroom.id);
  check('sin amarre libre: tercera nave rechazada', st.addShip(s, {}, [nexo]) === null);
  check('override por sala (seteable): shipCap=1', (() => { hroom.shipCap = 1; return st.shipCapacity(s, [nexo]) === 1; })());
  hroom.shipCap = 2;
  s.state.ships[0].state = 'out';
  check('una nave fuera libera su amarre', st.freeBerth(s, [nexo]) !== null);
  check('sin nexos (tests puros): addShip no gatea', !!st.addShip(s, { id: 'libre' }));
}

/* ---- PUENTE suite Dev → energía (-XONO, 2026-07-28) --------------------------
 * «tampoco funciona la generacion de energia». La suite empuja salas
 * directamente al Nexo sin pasar por placeModule, así que la instancia nunca
 * existía en state.modules y la energía se quedaba en 0/0 TW. attachModule es
 * la mitad contable de placeModule, sin las puertas de coste/hito/energía.
 */
{
  const st = mkEngine();
  const s = mkStation(0);
  const nexo = s.nexos[0];
  require('../src/core/objects_lib.js');            // registra reactor_core y sus TW

  // una sala empujada a mano (como hace la suite) NO cuenta hasta engancharla
  const room = mkRoomAt('Técnica', 6, 6, 12, 0);
  nexo.rooms.push(room);
  st.recompute(s);
  check('sala empujada a mano: sigue sin energía', s.state.energy.capacity === 0);

  st.defineModule({ id: 'libre', name: 'Libre', cost: 999, energyUse: 0, provides: { energy: 0 } });
  const inst = st.attachModule(s, nexo, 'libre', room);
  check('attachModule registra la instancia', s.state.modules.length === 1 && inst.roomId === room.id);
  check('attachModule NO cobra (en la suite se diseña, no se paga)', s.state.cred === 0);
  check('sin núcleos aún no hay energía', s.state.energy.capacity === 0);

  // colocar un núcleo EN LA SALA YA MONTADA debe encender la energía
  room.objects.push(D.createObjectInstance('reactor_core', 3, 3));
  check('antes de sincronizar la energía no ha cambiado', s.state.energy.capacity === 0);
  check('syncModuleEnergy detecta el núcleo', st.syncModuleEnergy(s, s.nexos) === true);
  check('el núcleo enciende los 100 TW', s.state.energy.capacity === 100);
  check('sincronizar dos veces no duplica', st.syncModuleEnergy(s, s.nexos) === false && s.state.energy.capacity === 100);

  room.objects.push(D.createObjectInstance('reactor_core', 4, 3));
  st.syncModuleEnergy(s, s.nexos);
  check('dos núcleos → 200 TW', s.state.energy.capacity === 200);

  // los TW de objeto viajan en el save: recargar no apaga el reactor
  const rt = S.deserialize(S.serialize(s));
  check('objEnergy sobrevive al save', rt.state.modules[0].objEnergy === 200);
  check('la energía sobrevive al save', rt.state.energy.capacity === 200);

  // quitar el núcleo apaga
  room.objects = [];
  st.syncModuleEnergy(s, s.nexos);
  check('sin núcleos vuelve a 0 TW', s.state.energy.capacity === 0);

  // enganchar dos veces la misma sala no duplica la instancia
  st.attachModule(s, nexo, 'libre', room);
  st.attachModule(s, nexo, 'libre', room);
  check('attachModule es idempotente por sala', s.state.modules.filter(m => m.roomId === room.id).length === 1);

  // detachModule limpia y recomputa
  room.objects.push(D.createObjectInstance('reactor_core', 3, 3));
  st.syncModuleEnergy(s, s.nexos);
  check('reengancha con energía', s.state.energy.capacity === 100);
  check('detachModule retira la instancia', st.detachModule(s, room.id) === 1 && s.state.modules.length === 0);
  check('tras detach la energía se apaga', s.state.energy.capacity === 0);
  check('detachModule de una sala que no está no rompe', st.detachModule(s, 'no-existe') === 0);

  // una instancia cuya sala desapareció cuenta 0 (no arrastra energía fantasma)
  const ghost = mkRoomAt('Fantasma', 4, 4, 30, 0);
  ghost.objects.push(D.createObjectInstance('reactor_core', 1, 1));
  st.attachModule(s, nexo, 'libre', ghost);          // nunca entró en nexo.rooms
  check('sala fuera del nexo → sin energía tras sincronizar',
    st.syncModuleEnergy(s, s.nexos) === true && s.state.energy.capacity === 0);
}

// ---- brownout: la puerta de energía deja pasar al productor que la resuelve ----
{
  const st = mkEngine();
  const s = mkStation(500);
  const nexo = s.nexos[0];
  const g = st.placeModule(s, nexo, 'gen', mkRoomAt('Gen', 4, 4, 12, 0));
  st.placeModule(s, nexo, 'almacen', mkRoomAt('Alm', 4, 4, 16, 0));   // used 5
  st.detachModule(s, g.module.roomId);          // brownout: used 5 > cap 0
  check('brownout declarado al retirar el generador', s.state.blackout === true);
  const back = st.placeModule(s, nexo, 'gen', mkRoomAt('Gen2', 4, 4, 20, 0));
  check('productor ADMITIDO durante brownout (él mismo lo resuelve)', back.ok === true);
  check('brownout desaparece tras reponer generación', s.state.blackout === false && s.state.energy.capacity === 100);
  st.detachModule(s, back.module.roomId);       // brownout otra vez
  const cons = st.placeModule(s, nexo, 'hab', mkRoomAt('Hab', 4, 4, 20, 0));
  check('consumidor sigue RECHAZADO durante brownout', !cons.ok && /energía/.test(cons.reason));
}

// ---- hangar: la marca llega a la sala desde el def (placeholder visible) ----
{
  const st = mkEngine();
  st.defineModule({ id: 'hangar', name: 'Hangar', cost: 0, free: true, energyUse: 0, provides: { shipCap: 2 } });
  const s = mkStation(0);
  const nexo = s.nexos[0];
  const room = mkRoomAt('Hangar', 4, 4, 12, 0);
  st.placeModule(s, nexo, 'hangar', room);
  check('placeModule marca la sala como hangar (la UI la reconoce)', room.hangar === true);
  check('shipCap sin setear: la capacidad la lee del def (room-first)',
    typeof room.shipCap !== 'number' && st.shipCapacity(s, s.nexos) === 2);
  const room2 = mkRoomAt('Hangar2', 4, 4, 16, 0);
  room2.shipCap = 5;
  st.attachModule(s, nexo, 'hangar', room2);
  check('un shipCap explícito del diseñador NO se pisa con el def', room2.shipCap === 5);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
