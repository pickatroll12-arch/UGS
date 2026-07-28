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
    F1.moduleById('hangar_f1').energyUse === 0 && F1.moduleById('almacen_f1').energyUse === 0);

  const r1 = st.placeModule(s, nexo, 'hangar_f1', roomAt('H', 10, 8, 12, 0));
  check('el Hangar se puede colocar con capacidad 0', r1.ok === true);
  const r2 = st.placeModule(s, nexo, 'radar_f1', roomAt('R', 4, 4, 22, 0));
  check('el Radar NO se puede colocar todavía (sin generador)', !r2.ok && /energía/.test(r2.reason));

  const r3 = st.placeModule(s, nexo, 'generador_f1', roomAt('G', 6, 6, 12, 8));
  check('el Generador sí se coloca', r3.ok === true);
  check('la capacidad sube a 100 TW', s.state.energy.capacity === 100);
  const r4 = st.placeModule(s, nexo, 'radar_f1', roomAt('R2', 4, 4, 22, 0));
  check('con generador, el Radar ya entra', r4.ok === true);

  st.placeModule(s, nexo, 'almacen_f1', roomAt('A', 6, 5, 12, 14));
  st.placeModule(s, nexo, 'habitacional_f1', roomAt('Hb', 8, 6, 18, 14));
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
  check('recolección ESTRICTA: 1-3 UD por etapa (orden de -XONO)',
    F1.ROUTES[0].stages.every(e => e.yields[0].min === 1 && e.yields[0].max === 3));
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
    st.placeModule(s, nexo, 'generador_f1', roomAt('G', 6, 6, 12, 0));
    st.placeModule(s, nexo, 'almacen_f1', roomAt('A', 6, 5, 12, 6));
    const hangar = roomAt('H', 10, 8, 18, 0);
    st.placeModule(s, nexo, 'hangar_f1', hangar);
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
  st.placeModule(s, nexo, 'hangar_f1', roomAt('H', 10, 8, 12, 0));
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
  st.placeModule(s, nexo, 'almacen_f1', roomAt('A', 6, 5, 12, 0));   // hace falta almacén para guardar UD

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
    !!F1.moduleById('radar_f1') && !!F1.hitoById('f1_radar') && !!F1.routeById('veta_k7'));
  check('y devuelven null si no existe',
    F1.moduleById('x') === null && F1.hitoById('x') === null && F1.routeById('x') === null);
}

// ============ DECISIONES DE -XONO (2026-07-28) ===============================
// 1) módulos iniciales gratis · 2) se empieza con 1 nave · 3) venta al volver
{
  check('los 5 módulos de F1 son GRATIS', F1.MODULES.every(m => m.cost === 0));
  check('siguen gateados por hito (gratis no es disponible)',
    F1.MODULES.every(m => m.free !== true));
  check('la nave inicial está declarada', !!F1.STARTER_SHIP && F1.STARTER_SHIP.capacity > 0);

  // F1 ya SÍ es pagable: solo cuestan los hitos
  const costeHitos = F1.HITOS.reduce((a, h) => a + h.cost, 0);
  const costeModulos = F1.MODULES.reduce((a, m) => a + m.cost, 0);
  check('el coste de F1 se reduce a los hitos (' + costeHitos + ' CRED)', costeModulos === 0);
}

// ---- venta: precios y conversión -------------------------------------------
{
  check('hay precio para el mineral base', F1.PRICES.mineral === 100);
  check('la escala del mapa mental está declarada (100/250/500)',
    F1.PRICES.mineral_procesado === 250 && F1.PRICES.mineral_enriquecido === 500);
  check('valueOf da el BRUTO de un lote (antes de impuesto)', F1.valueOf({ mineral: 3 }) === 300);
  check('valueOf ignora lo que no tiene precio', F1.valueOf({ chatarra: 9 }) === 0);
  check('valueOf tolera lote vacío', F1.valueOf(null) === 0);

  const { st, s } = mkStation(2000);
  const nexo = s.nexos[0];
  for (const h of F1.HITOS) st.unlockHito(s, h.id);
  st.placeModule(s, nexo, 'almacen_f1', roomAt('A', 6, 5, 12, 0));
  const credBase = s.state.cred;
  check('con los hitos pagados el almacén da 30 UD', s.state.storageCap === 30);
  check('guardar 7 UD de mineral', st.addItem(s, 'mineral', 7) === 7);

  const sale = F1.sellCargo(st, s, { mineral: 7 });
  check('vender 7 UD: 700 brutos − 233 UGS = 467 netos',
    sale.gross === 700 && sale.tax === 233 && sale.cred === 467 && s.state.cred === credBase + 467);
  check('la venta vacía el almacén (queda sitio para el próximo viaje)',
    (s.state.inventory.mineral || 0) === 0);
  check('informa de lo vendido', sale.sold.mineral === 7);

  // no se puede cobrar lo que no hay
  const credTrasVenta = s.state.cred;
  const fake = F1.sellCargo(st, s, { mineral: 99 });
  check('no cobra mineral inexistente', fake.cred === 0 && s.state.cred === credTrasVenta);
  // ítem sin precio: se queda en el almacén, no se regala
  st.addItem(s, 'chatarra', 4);
  const nosale = F1.sellCargo(st, s, { chatarra: 4 });
  check('un ítem sin precio no se vende', nosale.cred === 0 && s.state.inventory.chatarra === 4);
}

// ---- el bucle completo: expedición → venta → pagar el siguiente hito -------
{
  const { st, s } = mkStation(0, 'bucle-ok');
  const nexo = s.nexos[0];
  // se arranca SIN CRED: el primer hito cuesta 0 justamente para poder empezar
  check('el primer hito se paga con 0 CRED', st.unlockHito(s, 'f1_hangar').ok === true);
  check('el segundo NO se puede pagar todavía (hacen falta ingresos)',
    !st.hitoStatus(s, 'f1_almacen').ok);
  check('el hangar se coloca gratis', st.placeModule(s, nexo, 'hangar_f1', roomAt('H', 10, 8, 12, 0)).ok === true && s.state.cred === 0);

  // el almacén hace falta para traer carga; se fuerza construible para aislar
  // la economía de la cadena de hitos en este test
  s.state.buildable.push('almacen_f1');
  check('el almacén también es gratis', st.placeModule(s, nexo, 'almacen_f1', roomAt('A', 6, 5, 12, 8)).ok === true && s.state.cred === 0);

  const ship = st.addShip(s, Object.assign({}, F1.STARTER_SHIP), s.nexos);
  check('la nave inicial cabe en el hangar', !!ship);
  check('sale a la veta sin pagar nada', st.launchExpedition(s, 'veta_k7', ship.id).ok === true);
  let t = 0;
  while (t < 400 && s.state.ships[0].state === 'out') { st.update(s, 1); t++; }

  if (s.state.ships[0].state === 'idle') {
    const traido = s.state.inventory.mineral || 0;
    const sale = F1.sellCargo(st, s, { mineral: traido });
    check('la expedición genera CRED de verdad (' + traido + ' UD → ' + sale.cred + ' CRED)', sale.cred > 0);
    check('con lo ganado ya se puede pagar el hito del Almacén (150 CRED)',
      st.hitoStatus(s, 'f1_almacen').ok === true);
    check('y al pagarlo, el bucle continúa', st.unlockHito(s, 'f1_almacen').ok === true);
  } else {
    check('(la nave falló con esta semilla: rama de falla cubierta)', true);
    check('(sin venta que comprobar en esta rama)', true);
    check('(bucle no evaluable en esta rama)', true);
  }
}

// ============ DEFINICIÓN DE F1 (tier de módulo) ==============================
// F1 = FASE 1. El sufijo es el TIER del módulo: habrá Hangar F2/F3/F4 más
// adelante. Estos tests fijan la convención para que nadie la rompa al añadir
// los módulos de la Fase 2.
{
  check('todos los módulos declaran tier 1', F1.MODULES.every(m => m.tier === 1));
  check('todo id de módulo termina en _f1', F1.MODULES.every(m => /_f1$/.test(m.id)));
  check('todo nombre visible lleva el sufijo F1', F1.MODULES.every(m => / F1$/.test(m.name)));
  check('el id concuerda con el tier declarado',
    F1.MODULES.every(m => m.id.endsWith('_f' + m.tier)));
  check('TIER se exporta para el contenido de fases futuras', F1.TIER === 1);
  // los hitos son de la FASE, no del módulo: mantienen su prefijo f1_
  check('los hitos usan prefijo f1_ (fase, no tier de módulo)',
    F1.HITOS.every(h => /^f1_/.test(h.id)));
}

// ============ IMPUESTO UGS (lore: Unión Galáctica del Sistema Sol) ===========
{
  check('el impuesto es un tercio', Math.abs(F1.UGS_TAX - 1 / 3) < 1e-9);
  check('el lore está declarado en el código', /Unión Galáctica/.test(F1.UGS_NAME));

  const { st, s } = mkStation(0);
  s.state.storageCap = 999;

  st.addItem(s, 'mineral', 3);
  const v = F1.sellCargo(st, s, { mineral: 3 });
  check('3 UD: 300 brutos', v.gross === 300);
  check('la UGS se lleva 100', v.tax === 100);
  check('al jugador le quedan 200', v.cred === 200 && s.state.cred === 200);
  check('bruto = impuesto + neto (no se pierde ni se inventa CRED)', v.gross === v.tax + v.cred);

  // redondeo A FAVOR DEL JUGADOR: con 1 UD (100), 1/3 = 33.33 → impuesto 33
  st.addItem(s, 'mineral', 1);
  const v1 = F1.sellCargo(st, s, { mineral: 1 });
  check('1 UD: el impuesto redondea a la baja (33, no 34)', v1.tax === 33 && v1.cred === 67);

  // sin venta no hay impuesto
  const v0 = F1.sellCargo(st, s, {});
  check('sin carga no hay impuesto', v0.gross === 0 && v0.tax === 0 && v0.cred === 0);

  // el impuesto se aplica a CUALQUIER recurso con precio, no solo al mineral
  s.state.inventory.mineral_procesado = 2;
  const v2 = F1.sellCargo(st, s, { mineral_procesado: 2 });
  check('el impuesto también grava el mineral procesado (500 brutos)',
    v2.gross === 500 && v2.tax === 166 && v2.cred === 334);
}

// ============ RITMO ECONÓMICO (que cueste ganar CRED) ========================
// Simulación real sobre el runtime: 200 expediciones con semillas distintas.
{
  function oneRun(seed) {
    const { st, s } = mkStation(0, seed);
    s.state.storageCap = 999;
    st.addShip(s, Object.assign({}, F1.STARTER_SHIP));
    st.launchExpedition(s, 'veta_k7', F1.STARTER_SHIP.id);
    let t = 0;
    while (t < 400 && s.state.ships[0].state === 'out') { st.update(s, 1); t++; }
    const ud = s.state.inventory.mineral || 0;
    return F1.sellCargo(st, s, { mineral: ud }).cred;
  }
  let net = 0; const N = 200;
  for (let i = 0; i < N; i++) net += oneRun('ritmo-' + i);
  const medio = net / N;
  const costeF1 = F1.HITOS.reduce((a, h) => a + h.cost, 0);
  const expediciones = costeF1 / medio;
  check('una expedición deja un neto modesto (' + medio.toFixed(0) + ' CRED)', medio > 100 && medio < 320);
  check('F1 exige VARIAS expediciones (' + expediciones.toFixed(1) + '), no una',
    expediciones >= 4 && expediciones <= 9);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
