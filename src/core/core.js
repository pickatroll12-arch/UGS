/*
 * UGS — core/core  (REVAMP · base nueva)
 * ==================================================================
 * [COMPONENTES LÓGICOS] — utilidades puras, sin DOM, sin canvas.
 * Todo módulo lógico del proyecto depende de aquí; NADA aquí depende
 * del renderizador. Regla de oro de la casa: ver PROMPT_MAESTRO.md §2.
 *
 * Contenido: ids, EventBus (síncrono), FixedTimestep, helpers numéricos.
 * Corre en navegador (window.UGS.core) y en Node (module.exports).
 */
(function (root, factory) {
  const api = factory();
  root.UGS = root.UGS || {};
  root.UGS.core = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Generador de ids únicos legibles: uid('room') → 'room-1', 'room-2', …
  let counter = 0;
  function uid(prefix) { return (prefix || 'id') + '-' + (++counter); }

  // Bus de eventos síncrono. La lógica emite; quien escucha decide.
  // Síncrono a propósito: el orden de ejecución queda determinista.
  class EventBus {
    constructor() { this._map = new Map(); }
    on(evt, fn) {
      if (!this._map.has(evt)) this._map.set(evt, []);
      this._map.get(evt).push(fn);
      return () => { const a = this._map.get(evt); const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); };
    }
    emit(evt, payload) {
      const a = this._map.get(evt);
      if (a) for (const fn of a.slice()) fn(payload);
    }
    clear() { this._map.clear(); }
  }

  // Paso fijo: acumula dt real y entrega slices constantes. El motor NUNCA
  // consume wall-clock directamente — así dos ejecuciones con el mismo
  // input producen el mismo estado (determinismo exigido por REVISION MAESTRA 2).
  class FixedTimestep {
    constructor(hz, maxSlices) {
      this.step = 1 / (hz || 30);
      this.maxSlices = maxSlices || 6;
      this.acc = 0;
    }
    advance(dtReal, fn) {
      this.acc += dtReal;
      let n = 0;
      while (this.acc >= this.step && n < this.maxSlices) {
        fn(this.step);
        this.acc -= this.step;
        n++;
      }
      if (this.acc >= this.step) this.acc = 0;   // anti espiral de la muerte
      return n;
    }
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  // easing suave y determinista (smoothstep)
  const smooth = (p) => p * p * (3 - 2 * p);

  return { uid, EventBus, FixedTimestep, clamp, lerp, smooth };
});
