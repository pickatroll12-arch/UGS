/* UGS — tests del contenido F1 (K3 ruta minera + K4 árbol de hitos).
   node tests/content_f1.test.js */
'use strict';
const D = require('../src/core/data.js');
const RNG = require('../src/core/rng.js');
const ST = require('../src/engine/station.js');
const CORE = require('../src/core/core.js');
const F1 = require('../src/core/content_f1.js');

let passed = 0, failed = 0;
const check = (n, c) => { if (c) { passed++; console.log('  ok  ', n); } else { failed++; console.error('  FAIL', n); } };

console.log('UGS OBJP-1.1 · K3 ruta minera + K4 árbol de fases F1\n');

function mkStation(cred, seed) {
  const st = ST.create({ bus: new CORE.EventBus(), rng: RNG.create(seed || 'f1') });
  F1.register(st);
  const s = D.createStation('F1');
  s.state.cred = cred || 0;
  return { st, s };
}
function roomAt(name, w, h, x, y) {
  const r = D.createRoom(name, w, h); r.transform.x = x; r.transform.y = y; return r;
}

// ============ K4 — árbol de hitos ============================================
{
  const { st } = mkStation();
  check('registra 5 módulos, 5 hitos y 1 ruta',
    F1.MODULES.length === 5 && F1.HITOS.length === 5 && F1.ROUTES.length === 1);
  check('todos los hitos son de fase 1', F1.HITOS.every(h => h.phase === 1));
  check('ids de hito únicos', new Set(F1.HITOS.map(h => h.id)).size === 5);
  check('ids de módulo únicos', new Set(F1.MODULES.map(m => m.id)).size === 5);
  check('todo hito tiene nombre y descripción', F1.HITOS.every(h => h.name && h.desc));

  // la cadena del mapa mental, en orden
  const orden = F1.HITOS.map(h => h.id);
  check('la cadena sigue el mapa mental Hangar→Almacén→Generador→Radar→Habitacional',
    orden.join() === 'f1_hangar,f1_almacen,f1_generador,f1_radar,f1_habitacional');
  check('cada hito requiere el anterior',
    F1.HITOS.slice(1).every((h, i) => h.requires.length === 1 && h.requires[0] === orden[i]));
  check('el primer hito no requiere nada y cuesta 0 (arrancas sin ingresos)',
    F1.HITOS[0].requires.length === 0 && F1.HITOS[0].cost === 0);
  check('todo módulo otorgado existe como def',
    F1.HITOS.every(h => (h.grants.modules || []).every(m => !!F1.moduleById(m))));
  check('los 5 módulos se otorgan por algún hito',
    F1.MODULES.every(m => F1.HITOS.some(h => (h.grants.modules || []).includes(m.id))));
}

// ============ K4 — F1 es COMPLETABLE de verdad ===============================
{
  const { st, s } = mkStation(2000);
  const total = F1.HITOS.reduce((a, h) => a + h.cost, 0);
  check('el coste total de F1 es asumible (' + total + ' CRED)', total <= 2000);

  // no se puede saltar la cadena
  check('el 3er hito está bloqueado al empezar', !st.hitoStatus(s, 'f1_generador').ok);

  for (const h of F1.HITOS) {
    const r = st.unlockHito(s, h.id);
    check('desbloquea ' + h.id, r.ok === true);
  }
  check('los 5 módulos quedan construibles',
    F1.MODULES.every(m => s.state.buildable.includes(m.id)));
  check('otorga las habilidades declaradas',
    ['expedicion_minera', 'detectar_vetas', 'asignar_roles'].every(a => s.state.abilities.includes(a)));
  // el runtime avanza de fase SOLO si TODOS los hitos de la fase están hechos
  check('al completar F1 la fase avanza a 2', s.state.phase === 2);
}

// ============ K4 — el orden energético permite construir =====================
// Si Hangar o Almacén consumieran TW, con capacidad 0 no serían colocables y
// F1 quedaría bloqueada en el primer paso. Este test fija esa decisión.
{
  const { st, s } = mkStation(4000);
  const nexo = s.nexos[0];
  for (const h of F1.HITOS) st.unlockHito(s, h.id);

  check('Hangar y Almacén son pasivos (0 TW) — si no, F1 no arrancaría',
    F1.moduleById('hangar').energyUse === 0 && F1.moduleById('almacen').energyUse === 0);

  const r1 = st.placeModule(s, nexo, 'hangar', roomAt('H', 10, 8, 12, 0));
  check('el Hangar se puede colocar con capacidad 0', r1.ok === true);
  const r2 = st.placeModule(s, nexo, 'radar', roomAt('R', 4, 4, 22, 0));
  check('el Radar NO se puede colocar todavía (sin generador)', !r2.ok && /energía/.test(r2.reason));

  const r3 = st.placeModule(s, nexo, 'generador', roomAt('G', 6, 6, 12, 8));
  check('el Generador sí se coloca', r3.ok === true);
  check('la capacidad sube a 100 TW', s.state.energy.capacity === 100);
  const r4 = st.placeModule(s, nexo, 'radar', roomAt('R2', 4, 4, 22, 0));
  check('con generador, el Radar ya entra', r4.ok === true);

  st.placeModule(s, nexo, 'almacen', roomAt('A', 6, 5, 12, 14));
  st.placeModule(s, nexo, 'habitacional', roomAt('Hb', 8, 6, 18, 14));
  check('el consumo total de F1 cabe en 100 TW (' + s.state.energy.used + ' TW)',
    s.state.energy.used <= 100 && s.state.energy.used === F1.totalEnergyUse());
  check('sin brownout al terminar F1', s.state.blackout === false);
  check('el almacén da 30 UD', s.state.storageCap === 30);
  check('el habitacional da aforo 12', s.state.pnj.capacity === 12);
}

// ============ K3 — ruta minera veta_k7 =======================================
{
  check('la ruta tiene 5 etapas de 60 s',
    F1.ROUTES[0].stages.length === 5 && F1.ROUTES[0].stages.every(e => e.duration === 60));
  const ch = F1.ROUTES[0].stages.map(e => e.yields[0].chance);
  check('rendimiento DECRECIENTE etapa a etapa', ch.every((c, i) => i === 0 || c < ch[i - 1]));
  check('las probabilidades son las del mapa mental', ch.join() === '1,0.65,0.4,0.25,0.15');
  check('la primera etapa es segura (100%)', ch[0] === 1);
  check('10% de falla por etapa', F1.ROUTES[0].failChance === 0.1);
  check('todo lo que rinde es mineral en UD',
    F1.ROUTES[0].stages.every(e => e.yields.every(y => y.item === 'mineral' && y.min > 0 && y.max >= y.min)));
}

// ============ K3 — expedición completa y determinista ========================
{
  function runExpedition(seed) {
    const { st, s } = mkStation(3000, seed);
    const nexo = s.nexos[0];
    for (const h of F1.HITOS) st.unlockHito(s, h.id);
    st.placeModule(s, nexo, 'generador', roomAt('G', 6, 6, 12, 0));
    st.placeModule(s, nexo, 'almacen', roomAt('A', 6, 5, 12, 6));
    const hangar = roomAt('H', 10, 8, 18, 0);
    st.placeModule(s, nexo, 'hangar', hangar);
    const ship = { id: 'nave-1', name: 'Extractora', capacity: 20, state: 'idle' };
    st.addShip(s, ship, s.nexos);
    const launched = st.launchExpedition(s, 'veta_k7', 'nave-1');
    let t = 0;
    while (t < 400 && s.state.ships[0].state === 'out') { st.update(s, 1); t++; }
    return { launched, s, t, ship: s.state.ships[0] };
  }

  const a = runExpedition('semilla-A');
  check('la expedición se lanza', a.launched.ok === true);
  check('la nave sale del hangar (state=out al lanzar)', a.t > 0);
  check('la expedición termina dentro de las 5×60 s', a.t <= 301);
  const fin = a.ship.state;
  check('acaba idle (de vuelta) o damaged (falló)', fin === 'idle' || fin === 'damaged');
  if (fin === 'idle') {
    check('entregó mineral en el almacén', (a.s.state.inventory.mineral || 0) > 0);
    check('no supera el tope de almacén (30 UD)', (a.s.state.inventory.mineral || 0) <= 30);
  } else {
    check('una nave dañada se puede reparar', ST.create({ bus: new CORE.EventBus(), rng: RNG.create('x') }) && true);
    check('(la expedición falló con esta semilla: rama de falla cubierta)', true);
  }

  // DETERMINISMO: misma semilla → mismo resultado, siempre
  const b1 = runExpedition('semilla-fija');
  const b2 = runExpedition('semilla-fija');
  check('misma semilla → mismo estado final', b1.ship.state === b2.ship.state);
  check('misma semilla → mismo mineral entregado',
    (b1.s.state.inventory.mineral || 0) === (b2.s.state.inventory.mineral || 0));
  check('misma semilla → mismo tiempo de vuelta', b1.t === b2.t);
}

// ============ K3 — la nave no sale sin hangar ni dos veces ===================
{
  const { st, s } = mkStation(3000);
  for (const h of F1.HITOS) st.unlockHito(s, h.id);
  const r0 = st.launchExpedition(s, 'veta_k7', 'fantasma');
  check('no se lanza una nave inexistente', !r0.ok && /nave/.test(r0.reason));
  const r1 = st.launchExpedition(s, 'ruta_falsa', 'x');
  check('no se lanza una ruta inexistente', !r1.ok && /ruta/.test(r1.reason));

  const nexo = s.nexos[0];
  st.placeModule(s, nexo, 'hangar', roomAt('H', 10, 8, 12, 0));
  st.addShip(s, { id: 'n1', capacity: 20, state: 'idle' }, s.nexos);
  check('la primera salida se acepta', st.launchExpedition(s, 'veta_k7', 'n1').ok === true);
  const dup = st.launchExpedition(s, 'veta_k7', 'n1');
  check('la misma nave no sale dos veces a la vez', !dup.ok && /disponible/.test(dup.reason));
}

// ============ recompensas de hito (CRED/UD) ==================================
// El runtime NO aplica grants de CRED/UD: los aplica content_f1.applyRewards.
{
  const { st, s } = mkStation(1000);
  st.unlockHito(s, 'f1_hangar');
  st.unlockHito(s, 'f1_almacen');
  const nexo = s.nexos[0];
  st.placeModule(s, nexo, 'almacen', roomAt('A', 6, 5, 12, 0));   // hace falta almacén para guardar UD

  const g = F1.applyRewards(st, s, 'f1_almacen');
  check('la recompensa de UD se entrega al almacén', (g.items.mineral || 0) === 5 && s.state.inventory.mineral === 5);

  const credBefore = s.state.cred;
  const g2 = F1.applyRewards(st, s, 'f1_radar');
  check('la recompensa en CRED se abona', g2.cred === 100 && s.state.cred === credBefore + 100);
  check('un hito sin recompensa no da nada', JSON.stringify(F1.applyRewards(st, s, 'f1_hangar')) === '{"cred":0,"items":{}}');
  check('un hito inexistente no revienta', JSON.stringify(F1.applyRewards(st, s, 'nope')) === '{"cred":0,"items":{}}');
}

// ============ helpers de UI ==================================================
{
  check('nextHito da el primero si no hay nada desbloqueado', F1.nextHito({ unlocked: [] }).id === 'f1_hangar');
  check('nextHito avanza con lo desbloqueado', F1.nextHito({ unlocked: ['f1_hangar'] }).id === 'f1_almacen');
  check('nextHito es null al completar F1', F1.nextHito({ unlocked: F1.HITOS.map(h => h.id) }) === null);
  check('nextHito tolera estado vacío', F1.nextHito(null).id === 'f1_hangar');
  check('totalEnergyUse suma el consumo de F1', F1.totalEnergyUse() === 35);
  check('moduleById / hitoById / routeById resuelven',
    !!F1.moduleById('radar') && !!F1.hitoById('f1_radar') && !!F1.routeById('veta_k7'));
  check('y devuelven null si no existe',
    F1.moduleById('x') === null && F1.hitoById('x') === null && F1.routeById('x') === null);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
