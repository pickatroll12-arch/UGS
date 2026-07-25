/*
 * UGS — core/rng  (REVAMP · base nueva)
 * ==================================================================
 * [COMPONENTES LÓGICOS] — RNG DETERMINISTA con semilla (mulberry32).
 * Todas las mecánicas con probabilidad del diseño humano (fallas de
 * naves, rendimientos de extracción, eventos RNG) pasan por aquí:
 * misma semilla + mismas llamadas → misma secuencia. La semilla viaja
 * en station.state.seed, así un save recargado sigue la MISMA suerte.
 * JAMÁS usar Math.random() en lógica de juego (PROMPT_MAESTRO.md §4).
 *
 * Corre en navegador (window.UGS.rng) y en Node (module.exports).
 */
(function (root, factory) {
  const api = factory();
  root.UGS = root.UGS || {};
  root.UGS.rng = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // hash de string → uint32 (para semillas legibles tipo 'ugs-station')
  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function create(seed) {
    let a = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed == null ? 'ugs' : seed);
    const rng = {
      // float uniforme [0, 1)
      next() {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      // entero en [min, max] inclusive
      range(min, max) { return min + Math.floor(rng.next() * (max - min + 1)); },
      // true con probabilidad p (0..1)
      chance(p) { return rng.next() < p; },
      // elemento aleatorio de un array
      pick(arr) { return arr[Math.floor(rng.next() * arr.length)]; },
      // estado serializable (para guardar a mitad de secuencia si hiciera falta)
      get state() { return a >>> 0; },
      set state(v) { a = v >>> 0; }
    };
    return rng;
  }

  return { create, hashSeed };
});
