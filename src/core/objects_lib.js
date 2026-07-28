/*
 * UGS — core/objects_lib  (librería de objetos decorativos)
 * ==================================================================
 * [COMPONENTES LÓGICOS] — Catálogo DATA-DRIVEN de objetos de atrezo para la
 * suite (OBJP-1.1 · T1 del BRIEF_CLAUDE_OBJP11.md). Datos puros: sin DOM, sin
 * canvas, cargable en Node. Quien coloca es `app/app.js`; quien dibuja es el
 * renderizador. Aquí solo se DECLARA qué existe.
 *
 * Def: { id, name, footprint:{w,h}, h, colors:{top,side}, colorKey, solid, cat }
 *   h .......... altura en tiles (referencia para la extrusión del renderer)
 *   colorKey ... nombre simbólico para que el Rector mapee paleta en
 *                render/render3d sin depender de los hex de aquí
 *   solid ...... contrato C2: si es sólido, bloquea el tile
 *
 * La CONSOLA queda FUERA de este catálogo a propósito: tiene herramienta
 * dedicada (tecla 7) y sprite propio. Orden expresa de -XONO, y hay un test
 * que falla si alguien la mete aquí.
 *
 * Registro: al cargarse, extiende la tabla de defs de `core/data.js` mediante
 * `registerObjectDefs` para que `createObjectInstance` resuelva bien `solid`
 * — también al releer un save. Sin esto, un objeto de la librería volvería
 * como sólido por defecto tras exportar/importar y rompería el pathfinding.
 *
 * Corre en navegador (window.UGS.objectsLib) y en Node (module.exports).
 */
(function (root, factory) {
  const api = factory(root.UGS && root.UGS.data ? root.UGS.data : require('./data.js'));
  root.UGS = root.UGS || {};
  root.UGS.objectsLib = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (D) {
  'use strict';

  const ONE = { w: 1, h: 1 };

  /*
   * 12 defs de arranque. Todas ocupan 1 tile: el esquema admite footprints
   * mayores, pero la COLOCACIÓN multi-tile no está implementada todavía, así
   * que no se declara ninguna que la app no sepa poner (hay un test que lo
   * vigila para que nadie declare una mentira).
   */
  const CATALOG = [
    { id: 'bed',           name: 'Cama',             h: 0.38, colorKey: 'fabric',  solid: true,  colors: { top: '#4a6070', side: '#33454f' } },
    { id: 'locker',        name: 'Taquilla',         h: 0.95, colorKey: 'metal',   solid: true,  colors: { top: '#6b7784', side: '#49535e' } },
    { id: 'table',         name: 'Mesa',             h: 0.45, colorKey: 'metal',   solid: true,  colors: { top: '#7a838f', side: '#525b66' } },
    { id: 'chair',         name: 'Silla',            h: 0.50, colorKey: 'metal',   solid: true,  colors: { top: '#5f6a76', side: '#414a54' } },
    { id: 'data_rack',     name: 'Rack de datos',    h: 1.05, colorKey: 'tech',    solid: true,  colors: { top: '#3f5566', side: '#2a3a47' } },
    { id: 'server',        name: 'Servidor',         h: 1.10, colorKey: 'tech',    solid: true,  colors: { top: '#37505f', side: '#243541' } },
    { id: 'control_panel', name: 'Panel de control', h: 0.80, colorKey: 'screen',  solid: true,  colors: { top: '#2f6b7a', side: '#1e4753' } },
    { id: 'wall_lamp',     name: 'Luz de pared',     h: 0.60, colorKey: 'light',   solid: false, colors: { top: '#d8e9f0', side: '#8fb6c4' } },
    { id: 'crate',         name: 'Contenedor',       h: 0.55, colorKey: 'cargo',   solid: true,  colors: { top: '#8a7346', side: '#5e4e2f' } },
    { id: 'pipe_valve',    name: 'Válvula',          h: 0.50, colorKey: 'metal',   solid: false, colors: { top: '#6f6257', side: '#4b423a' } },
    { id: 'planter',       name: 'Jardinera',        h: 0.42, colorKey: 'organic', solid: true,  colors: { top: '#4f7a4a', side: '#365434' } },
    // 'plant' ya existe en OBJECT_DEFS de data.js: se lista para que aparezca
    // en el selector, respetando su solid original (no sólido).
    { id: 'plant',         name: 'Planta',           h: 0.60, colorKey: 'organic', solid: false, colors: { top: '#5c9257', side: '#3d6640' } },
    // Pieza central del Reactor (T2). Decorativa: la energía la aporta el
    // MÓDULO vía provides.energy, no el objeto.
    { id: 'reactor_core',  name: 'Núcleo de reactor', h: 1.45, colorKey: 'energy', solid: true,  colors: { top: '#62e0ef', side: '#1d5c68' } }
  ];

  // completa el esquema (footprint y categoría son fijos hoy)
  for (const d of CATALOG) { d.footprint = d.footprint || ONE; d.cat = d.cat || 'decor'; }

  const byId = (id) => CATALOG.find(d => d.id === id) || null;
  const ids = () => CATALOG.map(d => d.id);
  /* opciones para el sub-selector de la herramienta Objeto */
  const options = () => CATALOG.map(d => ({ id: d.id, name: d.name }));

  // Extiende la resolución de defs de data.js SIN pisar las base
  // (console/door/elevator/plant conservan su definición original).
  if (typeof D.registerObjectDefs === 'function') {
    D.registerObjectDefs(CATALOG.map(d => ({ type: d.id, solid: d.solid, openable: false })));
  }

  return { CATALOG, byId, ids, options };
});
