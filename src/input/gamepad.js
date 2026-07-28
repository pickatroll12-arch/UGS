/*
 * UGS — input/gamepad  (soporte de mando)
 * ==================================================================
 * [ENTRADA] — Traduce el estado crudo de un mando (Gamepad API) a ACCIONES
 * del juego. No toca el DOM ni conoce la cámara: recibe la lista de pads y un
 * dt, y devuelve qué se acaba de pulsar, qué se mantiene y cuánto se han
 * movido los sticks. Por eso corre en Node y tiene tests: la lógica de
 * entrada es donde más se cuelan bugs de "se dispara dos veces".
 *
 * Pensado para el **Odin 2 Portal** (Android, mapping 'standard' de la
 * Gamepad API) pero vale para cualquier mando estándar: Xbox, DualSense,
 * 8BitDo… Si el mando reporta un mapping no estándar, se leen los índices
 * igualmente — la mayoría los respeta.
 *
 * Índices estándar (W3C): 0 A · 1 B · 2 X · 3 Y · 4 LB · 5 RB · 6 LT · 7 RT
 * 8 Back · 9 Start · 10 L3 · 11 R3 · 12 ↑ · 13 ↓ · 14 ← · 15 →
 *
 * Corre en navegador (window.UGS.gamepad) y en Node (module.exports).
 */
(function (root, factory) {
  const api = factory();
  root.UGS = root.UGS || {};
  root.UGS.gamepad = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const BUTTONS = ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'back', 'start', 'l3', 'r3', 'up', 'down', 'left', 'right'];
  // botones que se auto-repiten al mantenerlos (navegación); el resto son de
  // pulsación única: mantener A no debe encadenar veinte clics.
  const REPEATABLE = ['up', 'down', 'left', 'right', 'lb', 'rb'];

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /*
   * Zona muerta RADIAL con re-escalado: por debajo del umbral el stick es 0,
   * y justo por encima empieza en 0 (no salta a 0.22). Sin esto el cursor
   * "brinca" al mover el stick lo mínimo.
   */
  function stick(x, y, dz) {
    const m = Math.hypot(x, y);
    if (m <= dz) return { x: 0, y: 0, m: 0 };
    // el módulo se limita a 1 ANTES de repartir en ejes: un stick de puerta
    // cuadrada llega a (1,1) = módulo 1.41, y sin este tope las diagonales
    // irían un 41% más rápido que las direcciones puras.
    const mag = Math.min(1, (m - dz) / (1 - dz));
    const k = mag / m;
    return { x: clamp(x * k, -1, 1), y: clamp(y * k, -1, 1), m: mag };
  }

  function create(opts) {
    opts = opts || {};
    const dz = opts.deadzone == null ? 0.22 : opts.deadzone;
    const trigger = opts.triggerThreshold == null ? 0.5 : opts.triggerThreshold;
    const repeatDelay = opts.repeatDelay == null ? 0.38 : opts.repeatDelay;
    const repeatRate = opts.repeatRate == null ? 0.11 : opts.repeatRate;

    let prev = {};              // estado del frame anterior por botón
    const timers = {};          // acumulador de auto-repetición
    let connectedId = null;

    /* toma el primer mando conectado de la lista cruda */
    function firstPad(pads) {
      for (const p of (pads || [])) if (p && p.connected !== false) return p;
      return null;
    }

    /*
     * poll(pads, dt) → estado de acciones de este frame.
     *   pressed  — se acaba de pulsar (flanco de bajada)
     *   released — se acaba de soltar
     *   held     — sigue pulsado
     *   repeated — pulsación efectiva incluyendo auto-repetición (para navegar)
     */
    function poll(pads, dt) {
      dt = Math.max(0, Number(dt) || 0);
      const pad = firstPad(pads);
      const out = {
        connected: !!pad, id: pad ? (pad.id || '') : null,
        axes: { lx: 0, ly: 0, rx: 0, ry: 0, lm: 0, rm: 0 },
        pressed: [], released: [], held: [], repeated: []
      };
      if (!pad) { prev = {}; connectedId = null; return out; }
      connectedId = out.id;

      const ax = pad.axes || [];
      const L = stick(ax[0] || 0, ax[1] || 0, dz);
      const Rr = stick(ax[2] || 0, ax[3] || 0, dz);
      out.axes = { lx: L.x, ly: L.y, rx: Rr.x, ry: Rr.y, lm: L.m, rm: Rr.m };

      const raw = pad.buttons || [];
      for (let i = 0; i < BUTTONS.length; i++) {
        const name = BUTTONS[i];
        const b = raw[i];
        // un gatillo analógico cuenta como pulsado a partir del umbral
        const val = b == null ? 0 : (typeof b === 'number' ? b : (b.value != null ? b.value : (b.pressed ? 1 : 0)));
        const down = (name === 'lt' || name === 'rt') ? val >= trigger : (b && b.pressed) || val >= trigger;

        if (down) out.held.push(name);
        if (down && !prev[name]) {
          out.pressed.push(name);
          out.repeated.push(name);
          timers[name] = -repeatDelay;                 // margen antes de repetir
        } else if (!down && prev[name]) {
          out.released.push(name);
          timers[name] = 0;
        } else if (down && REPEATABLE.indexOf(name) >= 0) {
          timers[name] = (timers[name] || 0) + dt;
          while (timers[name] >= repeatRate) { timers[name] -= repeatRate; out.repeated.push(name); }
        }
        prev[name] = down;
      }
      return out;
    }

    return {
      poll,
      get connectedId() { return connectedId; },
      BUTTONS, REPEATABLE,
      reset() { prev = {}; for (const k of Object.keys(timers)) delete timers[k]; }
    };
  }

  /*
   * Mapa de acciones por defecto. Se declara aquí (dato, no código) para que
   * cambiarlo sea editar una tabla y para que la ayuda en pantalla y el
   * comportamiento no se puedan desincronizar.
   */
  const ACTIONS = {
    a:     { game: 'click',     dev: 'click',      desc: 'Confirmar / caminar / colocar' },
    b:     { game: 'cancel',    dev: 'cancel',     desc: 'Cancelar (ESC)' },
    x:     { game: 'expedite',  dev: 'undo',       desc: 'Juego: expedir nave · Dev: deshacer' },
    y:     { game: 'pause',     dev: 'redo',       desc: 'Juego: pausa · Dev: rehacer' },
    lb:    { game: 'rotL',      dev: 'rotL',       desc: 'Rotar vista −90°' },
    rb:    { game: 'rotR',      dev: 'rotR',       desc: 'Rotar vista +90°' },
    lt:    { game: 'zoomOut',   dev: 'zoomOut',    desc: 'Alejar' },
    rt:    { game: 'zoomIn',    dev: 'zoomIn',     desc: 'Acercar' },
    left:  { game: null,        dev: 'toolPrev',   desc: 'Herramienta anterior' },
    right: { game: null,        dev: 'toolNext',   desc: 'Herramienta siguiente' },
    up:    { game: null,        dev: 'objRotR',    desc: 'Girar objeto +90°' },
    down:  { game: null,        dev: 'objRotL',    desc: 'Girar objeto −90°' },
    start: { game: 'menu',      dev: 'menu',       desc: 'Menú' },
    back:  { game: 'mode',      dev: 'mode',       desc: 'Cambiar Dev / Juego' }
  };
  /* acción de un botón según el modo; null si ese botón no hace nada ahí */
  function actionFor(button, mode) {
    const a = ACTIONS[button];
    if (!a) return null;
    return (mode === 'dev' ? a.dev : a.game) || null;
  }

  return { create, stick, BUTTONS, REPEATABLE, ACTIONS, actionFor };
});
