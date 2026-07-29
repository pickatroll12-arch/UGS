/*
 * UGS — core/content_f1  (CONTENIDO de la Fase 1)
 * ==================================================================
 * [COMPONENTES LÓGICOS] — DATOS del árbol de hitos F1, sus módulos y la ruta
 * de extracción minera. Relevado del Rector (K3 + K4) según `RELEVO_CLAUDE.md`
 * §4, sobre el mapa mental de -XONO registrado en AGENTIC_REVIEW §6.4.
 *
 * Esto es CONTENIDO, no motor: el runtime ya existe en `engine/station.js`
 * (defineModule / defineHito / defineRoute / launchExpedition /
 * stepExpeditions) y no se toca. Aquí solo se declara qué hay en F1.
 *
 * Terminología oficial (§6.4): TW = energía · UD = unidad de ítem · CRED = moneda.
 *
 * NOTA DE DISEÑO IMPORTANTE (energía y orden de la cadena):
 * la estación arranca con `energy.capacity = 0`, y `placeModule` rechaza
 * cualquier módulo cuyo consumo supere la capacidad. Como el mapa mental pone
 * Hangar y Almacén ANTES del Generador, si esos dos consumieran TW **nadie
 * podría colocarlos** al empezar: F1 quedaría bloqueada en el primer paso.
 * Por eso Hangar y Almacén se declaran PASIVOS (0 TW) y el consumo de F1
 * recae en Radar (15) + Habitacional (20) = 35 TW de los 100 del Generador.
 * Queda por debajo del 63-70 TW del mapa mental: es una decisión abierta para
 * los humanos (ver §6.23), no un descuido.
 *
 * Corre en navegador (window.UGS.contentF1) y en Node (module.exports).
 */
(function (root, factory) {
  const api = factory();
  root.UGS = root.UGS || {};
  root.UGS.contentF1 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /*
   * ---- QUÉ ES "F1" (definición oficial, -XONO 2026-07-28) ------------------
   * F1 = **FASE 1**. El sufijo va en el id y en el nombre para hacer EXPLÍCITO
   * que son los módulos de nivel 1: el "Hangar F1" es el hangar básico, y más
   * adelante habrá "Hangar F2/F3/F4" — misma familia, mejor versión, atada a la
   * fase que la desbloquea. No es un prefijo de organización de archivos: es el
   * TIER del módulo. Cuando se diseñe la Fase 2, sus módulos serán `*_f2` y
   * convivirán con estos.
   * Regla: todo módulo declara `tier` y su id termina en `_f<tier>`.
   */
  const TIER = 1;

  // COSTE 0 por decisión de -XONO: "los módulos iniciales deben ser gratis".
  // Lo que se paga en F1 es el PROGRESO (los hitos), no el equipamiento de
  // partida. Siguen gateados por hito: gratis ≠ disponible.
  //
  // `room` (2026-07-28, GAP-UI-01): huella PLACEHOLDER de la sala que el
  // jugador coloca en modo Juego. Cuando los devs diseñen los módulos F1 en la
  // suite, esta huella la da el blueprint de la biblioteca; hasta entonces la
  // fábrica de blueprint.js genera una sala honesta (anillo de paredes; el
  // hangar abre su arista este como muralla `bay` de K2).
  const MODULES = [
    { id: 'hangar_f1',       tier: TIER, name: 'Hangar F1',       cost: 0, energyUse: 0,  provides: { shipCap: 2 },
      room: { w: 8, h: 6, bay: 'E' },
      notes: 'Amarre para 2 naves mineras. Pasivo: no consume TW.' },
    { id: 'almacen_f1',      tier: TIER, name: 'Almacén F1',      cost: 0, energyUse: 0,  provides: { storage: 30 },
      room: { w: 6, h: 5 },
      notes: '30 UD de capacidad: es el tope de lo que una expedición puede traer.' },
    { id: 'generador_f1',    tier: TIER, name: 'Generador F1',    cost: 0, energyUse: 0,  provides: { energy: 100 },
      room: { w: 7, h: 7 },
      notes: '100 TW. Es lo que desbloquea el resto del consumo de la fase.' },
    { id: 'radar_f1',        tier: TIER, name: 'Radar F1',        cost: 0, energyUse: 15, provides: {},
      room: { w: 5, h: 5 },
      notes: 'Detección de vetas y contactos.' },
    { id: 'habitacional_f1', tier: TIER, name: 'Habitacional F1', cost: 0, energyUse: 20, provides: { pnjCapacity: 12 },
      room: { w: 8, h: 6 },
      notes: '12 PNJ de aforo.' }
  ];

  /*
   * VENTA (decisión de -XONO 2026-07-28): lo que la expedición entrega se
   * convierte en CRED al volver. Precios en CRED por UD, con la escala del
   * mapa mental §6.4 (base 100 → procesado 250 → enriquecido 500): hoy solo
   * existe el mineral base; los otros dos quedan declarados para cuando exista
   * la cadena de procesamiento.
   * Es LA fuente de ingresos del juego: sin esto F1 no se puede pagar.
   */
  const PRICES = { mineral: 100, mineral_procesado: 250, mineral_enriquecido: 500 };

  /*
   * ---- IMPUESTO UGS (LORE, -XONO 2026-07-28) -------------------------------
   * **UGS = Unión Galáctica del Sistema Sol**, y de ahí sale el nombre del
   * proyecto. Toda venta de recursos tributa: **un tercio de la ganancia bruta
   * se lo queda la UGS**. No es un modificador de balance que se pueda quitar
   * alegremente — es la razón de ser del título y debe VERSE en la UI: el
   * jugador tiene que notar quién le está cobrando.
   * Se aplica sobre el bruto y se redondea a favor del jugador (Math.floor
   * sobre el impuesto), para que un lote de 1 UD nunca se coma más de lo justo.
   */
  const UGS_TAX = 1 / 3;
  const UGS_NAME = 'Unión Galáctica del Sistema Sol';

  /* Nave con la que se empieza la partida (una extractora, orden de -XONO). */
  const STARTER_SHIP = { id: 'nave-1', name: 'Extractora I', capacity: 20, state: 'idle' };

  /*
   * Árbol de hitos de F1 — cadena del mapa mental §6.4:
   *   Hangar → Almacén(30UD) → Generador(100TW) → Radar → Habitacional(12 PNJ)
   * El runtime avanza de fase SOLO cuando TODOS los hitos de la fase están
   * desbloqueados, así que la cadena está pensada para ser completable:
   * el primero cuesta 0 CRED (no se puede empezar sin ingresos) y el resto se
   * paga con lo que rinde la minería.
   */
  const HITOS = [
    { id: 'f1_hangar', name: 'Hangar operativo', phase: 1, cost: 0, requires: [],
      grants: { modules: ['hangar_f1'], abilities: ['expedicion_minera'] },
      rewards: { cred: 0, items: {} },
      desc: 'Habilita el hangar y el envío de naves extractoras.' },
    { id: 'f1_almacen', name: 'Bodega presurizada', phase: 1, cost: 150, requires: ['f1_hangar'],
      grants: { modules: ['almacen_f1'] },
      rewards: { cred: 0, items: { mineral: 5 } },
      desc: '30 UD de almacenamiento. Sin bodega no hay dónde descargar.' },
    { id: 'f1_generador', name: 'Generador principal', phase: 1, cost: 300, requires: ['f1_almacen'],
      grants: { modules: ['generador_f1'] },
      rewards: { cred: 0, items: {} },
      desc: '100 TW: a partir de aquí se pueden colocar módulos que consumen.' },
    { id: 'f1_radar', name: 'Radar de sondeo', phase: 1, cost: 250, requires: ['f1_generador'],
      grants: { modules: ['radar_f1'], abilities: ['detectar_vetas'] },
      rewards: { cred: 100, items: {} },
      desc: 'Detecta vetas y contactos alrededor de la estación.' },
    { id: 'f1_habitacional', name: 'Módulo habitacional', phase: 1, cost: 400, requires: ['f1_radar'],
      grants: { modules: ['habitacional_f1'], abilities: ['asignar_roles'] },
      rewards: { cred: 0, items: {} },
      desc: 'Aforo para 12 PNJ. Último hito de F1: al desbloquearlo, avanza la fase.' }
  ];

  /*
   * Ruta de extracción `veta_k7` — 5 etapas de 60 s con rendimiento
   * DECRECIENTE (mapa mental §6.4: 100% → 65% → 40% → 25% → 15%): la veta se
   * agota conforme la nave la trabaja. 10% de falla por etapa; una nave dañada
   * se recupera con `repairShip` (ya existe en el runtime).
   */
  const ROUTES = [{
    id: 'veta_k7',
    name: 'Veta K-7',
    failChance: 0.1,
    stages: [
      { duration: 60, yields: [{ chance: 1.00, item: 'mineral', min: 1, max: 3 }] },
      { duration: 60, yields: [{ chance: 0.65, item: 'mineral', min: 1, max: 3 }] },
      { duration: 60, yields: [{ chance: 0.40, item: 'mineral', min: 1, max: 3 }] },
      { duration: 60, yields: [{ chance: 0.25, item: 'mineral', min: 1, max: 3 }] },
      { duration: 60, yields: [{ chance: 0.15, item: 'mineral', min: 1, max: 3 }] }
    ]
  }];

  // ---- registro en el runtime ------------------------------------------------
  function register(st) {
    if (!st) throw new Error('content_f1.register necesita el API de station');
    for (const m of MODULES) st.defineModule(m);
    for (const h of HITOS) st.defineHito(h);
    for (const r of ROUTES) st.defineRoute(r);
    return { modules: MODULES.length, hitos: HITOS.length, routes: ROUTES.length };
  }

  /*
   * Recompensas de hito. `unlockHito` del runtime solo aplica grants.modules y
   * grants.abilities — CRED y UD NO los conoce. Para no declarar premios que
   * nadie entrega, se aplican aquí, y app.js llama a esto al oír 'station:hito'.
   * Función pura sobre el API: testeable en Node y sin tocar station.js.
   */
  function applyRewards(st, station, hitoId) {
    const def = HITOS.find(h => h.id === hitoId);
    if (!def || !def.rewards) return { cred: 0, items: {} };
    const given = { cred: 0, items: {} };
    if (def.rewards.cred) { st.earn(station, def.rewards.cred); given.cred = def.rewards.cred; }
    for (const [item, n] of Object.entries(def.rewards.items || {})) {
      const added = st.addItem(station, item, n);      // respeta el tope de almacén
      if (added > 0) given.items[item] = added;
    }
    return given;
  }

  /*
   * VENTA de lo que trae una expedición. `delivered` es lo que el runtime ya
   * metió en el almacén al volver (respetando el tope): aquí se saca del
   * inventario y se abona en CRED, así el almacén queda libre para el
   * siguiente viaje. Función pura sobre el API → testeable en Node.
   * Devuelve { cred, sold:{item:UD} } para que la UI cuente lo ocurrido.
   */
  function sellCargo(st, station, delivered) {
    const out = { gross: 0, tax: 0, cred: 0, sold: {} };
    for (const [item, n] of Object.entries(delivered || {})) {
      const price = PRICES[item];
      if (!price || n <= 0) continue;                 // sin precio no se vende: se queda en el almacén
      const taken = st.removeItem(station, item, n);  // solo se cobra lo que de verdad había
      if (taken <= 0) continue;
      out.sold[item] = taken;
      out.gross += taken * price;
    }
    // impuesto UGS: un tercio del bruto, redondeado a favor del jugador
    out.tax = Math.floor(out.gross * UGS_TAX);
    out.cred = out.gross - out.tax;
    if (out.cred > 0) st.earn(station, out.cred);
    return out;
  }
  /* valor en CRED de un lote, sin tocar el estado (para previsualizar) */
  function valueOf(items) {
    return Object.entries(items || {}).reduce((a, [it, n]) => a + (PRICES[it] || 0) * n, 0);
  }

  const hitoById = (id) => HITOS.find(h => h.id === id) || null;
  const moduleById = (id) => MODULES.find(m => m.id === id) || null;
  const routeById = (id) => ROUTES.find(r => r.id === id) || null;
  /* siguiente hito de F1 que aún no está desbloqueado (para la UI) */
  function nextHito(state) {
    const done = (state && state.unlocked) || [];
    return HITOS.find(h => !done.includes(h.id)) || null;
  }
  /* consumo total de F1 si se colocan los 5 módulos */
  const totalEnergyUse = () => MODULES.reduce((a, m) => a + (m.energyUse || 0), 0);

  return {
    MODULES, HITOS, ROUTES, PRICES, STARTER_SHIP, UGS_TAX, UGS_NAME, TIER,
    register, applyRewards, sellCargo, valueOf,
    hitoById, moduleById, routeById, nextHito, totalEnergyUse
  };
});
