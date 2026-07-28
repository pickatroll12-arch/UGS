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
    { id: 'bed',           name: 'Cama',             h: 0.38, colorKey: 'fabric',  solid: true,  colors: { top: '#4a6070', side: '#33454f' },
      parts: [{ x:0, y:0, w:.56, d:.86, z:0, h:.10, tone:'dark' }, { x:0, y:.06, w:.50, d:.70, z:.10, h:.16, tone:'body' }, { x:0, y:-.28, w:.44, d:.20, z:.26, h:.09, tone:'accent' }] },
    { id: 'locker',        name: 'Taquilla',         h: 0.95, colorKey: 'metal',   solid: true,  colors: { top: '#6b7784', side: '#49535e' },
      parts: [{ x:0, y:0, w:.58, d:.36, z:0, h:.90, tone:'body' }, { x:0, y:-.17, w:.46, d:.04, z:.10, h:.66, tone:'dark' }, { x:.14, y:-.19, w:.06, d:.04, z:.44, h:.06, tone:'accent' }] },
    { id: 'table',         name: 'Mesa',             h: 0.45, colorKey: 'metal',   solid: true,  colors: { top: '#7a838f', side: '#525b66' },
      parts: [{ x:0, y:0, w:.20, d:.20, z:0, h:.34, tone:'dark' }, { x:0, y:0, w:.78, d:.56, z:.34, h:.08, tone:'body' }] },
    { id: 'chair',         name: 'Silla',            h: 0.50, colorKey: 'metal',   solid: true,  colors: { top: '#5f6a76', side: '#414a54' },
      parts: [{ x:0, y:0, w:.12, d:.12, z:0, h:.22, tone:'dark' }, { x:0, y:0, w:.38, d:.38, z:.22, h:.07, tone:'body' }, { x:0, y:-.16, w:.38, d:.07, z:.29, h:.24, tone:'body' }] },
    { id: 'data_rack',     name: 'Rack de datos',    h: 1.05, colorKey: 'tech',    solid: true,  colors: { top: '#3f5566', side: '#2a3a47' },
      parts: [{ x:0, y:0, w:.56, d:.44, z:0, h:.98, tone:'body' }, { x:0, y:-.21, w:.46, d:.04, z:.18, h:.08, tone:'accent' }, { x:0, y:-.21, w:.46, d:.04, z:.42, h:.08, tone:'accent' }, { x:0, y:-.21, w:.46, d:.04, z:.66, h:.08, tone:'accent' }] },
    { id: 'server',        name: 'Servidor',         h: 1.10, colorKey: 'tech',    solid: true,  colors: { top: '#37505f', side: '#243541' },
      parts: [{ x:0, y:0, w:.60, d:.50, z:0, h:1.02, tone:'body' }, { x:0, y:-.24, w:.50, d:.04, z:.12, h:.78, tone:'dark' }, { x:-.16, y:-.26, w:.08, d:.04, z:.80, h:.06, tone:'glow' }] },
    { id: 'control_panel', name: 'Panel de control', h: 0.80, colorKey: 'screen',  solid: true,  colors: { top: '#2f6b7a', side: '#1e4753' },
      parts: [{ x:0, y:.08, w:.62, d:.30, z:0, h:.34, tone:'body' }, { x:0, y:-.04, w:.58, d:.14, z:.34, h:.34, tone:'dark' }, { x:0, y:-.07, w:.50, d:.04, z:.40, h:.24, tone:'glow' }] },
    { id: 'wall_lamp',     name: 'Luz de pared',     h: 0.60, colorKey: 'light',   solid: false, colors: { top: '#d8e9f0', side: '#8fb6c4' },
      parts: [{ x:0, y:.14, w:.10, d:.10, z:.46, h:.10, tone:'dark' }, { x:0, y:.02, w:.38, d:.14, z:.52, h:.08, tone:'glow' }] },
    { id: 'crate',         name: 'Contenedor',       h: 0.55, colorKey: 'cargo',   solid: true,  colors: { top: '#8a7346', side: '#5e4e2f' },
      parts: [{ x:0, y:0, w:.62, d:.62, z:0, h:.46, tone:'body' }, { x:0, y:0, w:.68, d:.68, z:.46, h:.06, tone:'dark' }, { x:0, y:-.30, w:.24, d:.04, z:.14, h:.16, tone:'accent' }] },
    { id: 'pipe_valve',    name: 'Válvula',          h: 0.50, colorKey: 'metal',   solid: false, colors: { top: '#6f6257', side: '#4b423a' },
      parts: [{ x:0, y:0, w:.76, d:.16, z:.06, h:.16, tone:'body' }, { x:0, y:0, w:.24, d:.24, z:.22, h:.20, tone:'accent' }] },
    { id: 'planter',       name: 'Jardinera',        h: 0.42, colorKey: 'organic', solid: true,  colors: { top: '#4f7a4a', side: '#365434' },
      parts: [{ x:0, y:0, w:.52, d:.52, z:0, h:.24, tone:'dark' }, { x:0, y:0, w:.44, d:.44, z:.24, h:.16, tone:'body' }] },
    // 'plant' ya existe en OBJECT_DEFS de data.js: se lista para que aparezca
    // en el selector, respetando su solid original (no sólido).
    { id: 'plant',         name: 'Planta',           h: 0.60, colorKey: 'organic', solid: false, colors: { top: '#5c9257', side: '#3d6640' },
      parts: [{ x:0, y:0, w:.32, d:.32, z:0, h:.16, tone:'dark' }, { x:0, y:0, w:.09, d:.09, z:.16, h:.18, tone:'body' }, { x:0, y:0, w:.42, d:.42, z:.34, h:.24, tone:'body' }] },
    // Pieza central del Reactor (T2). Decorativa: la energía la aporta el
    // MÓDULO vía provides.energy, no el objeto.
    { id: 'reactor_core',  name: 'Núcleo de reactor', h: 1.45, colorKey: 'energy', solid: true,  colors: { top: '#62e0ef', side: '#1d5c68' },
      parts: [{ x:0, y:0, w:.74, d:.74, z:0, h:.22, tone:'dark' }, { x:0, y:0, w:.36, d:.36, z:.22, h:.92, tone:'glow' }, { x:0, y:0, w:.56, d:.56, z:1.14, h:.20, tone:'body' }] },
  ];

  // completa el esquema (footprint y categoría son fijos hoy)
  for (const d of CATALOG) { d.footprint = d.footprint || ONE; d.cat = d.cat || 'decor'; }

  /*
   * ---- SILUETAS "SEMI-PLACEHOLDER" (-XONO, 2026-07-28) ---------------------
   * Cada def declara `parts`: 2-4 prismas que componen su forma. No es arte
   * final — es lo justo para que un tester distinga una cama de una taquilla
   * sin leer la etiqueta. Los renderers NO saben qué es una cama: dibujan
   * piezas. Añadir un objeto nuevo es añadir datos aquí, cero código.
   *
   * Pieza: { x, y, w, d, z, h, tone }
   *   x,y ... desplazamiento respecto al CENTRO del tile, en tiles
   *   w,d ... ancho y fondo de la pieza, en tiles (≤1 para no invadir vecinos)
   *   z ..... altura de la base (0 = apoyada en el suelo)
   *   h ..... altura de la pieza
   *   tone .. papel visual: body (color de la def) · dark (base/sombra) ·
   *           accent (detalle) · glow (parte encendida)
   */
  const TONES = ['body', 'dark', 'accent', 'glow'];

  const hexToRgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const shade = (rgb, f) => rgb.map(v => Math.max(0, Math.min(255, Math.round(v * f))));
  const toHex = (rgb) => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');

  /*
   * Color de una pieza a partir de la paleta de su def. Devuelve el formato que
   * espera el renderer 2D: `top` en hex y `side` en RGB (para la iluminación).
   */
  function partColor(def, part) {
    const base = hexToRgb(def.colors.top);
    switch (part && part.tone) {
      case 'dark':   return { top: toHex(shade(base, 0.55)), side: shade(base, 0.42) };
      case 'accent': return { top: toHex(shade(base, 1.35)), side: shade(base, 1.05) };
      case 'glow':   return { top: '#62e0ef', side: [46, 150, 168] };
      default:       return { top: def.colors.top, side: hexToRgb(def.colors.side) };
    }
  }
  /* piezas de un tipo de objeto (vacío si el tipo no está en el catálogo) */
  function partsOf(type) {
    const d = byId(type);
    return (d && d.parts) || [];
  }
  /* altura real de una def, deducida de sus piezas (para validar `h`) */
  function heightOf(def) {
    return (def.parts || []).reduce((mx, p) => Math.max(mx, p.z + p.h), 0);
  }

  const byId = (id) => CATALOG.find(d => d.id === id) || null;
  const ids = () => CATALOG.map(d => d.id);
  /* opciones para el sub-selector de la herramienta Objeto */
  const options = () => CATALOG.map(d => ({ id: d.id, name: d.name }));

  // Extiende la resolución de defs de data.js SIN pisar las base
  // (console/door/elevator/plant conservan su definición original).
  if (typeof D.registerObjectDefs === 'function') {
    D.registerObjectDefs(CATALOG.map(d => ({ type: d.id, solid: d.solid, openable: false })));
  }

  return { CATALOG, TONES, byId, ids, options, partColor, partsOf, heightOf };
});
