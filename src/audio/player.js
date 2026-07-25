/*
 * UGS — audio/player  (driver de audio)
 * ==================================================================
 * [AUDIO · DRIVER] — la única pieza del subsistema que toca el navegador.
 * No decide nada: ejecuta los comandos del director (audio/music.js) sobre
 * dos elementos <audio> (ranuras a/b) y le devuelve el parte de lo que
 * realmente está sonando. Misma relación que render↔lógica: el driver lee
 * decisiones, jamás las inventa.
 *
 * Autoplay: los navegadores bloquean el audio hasta el primer gesto del
 * usuario. Si play() es rechazado se marca la ranura como pendiente y el
 * driver reporta 'stalled'; mientras esté estancado, app.js alimenta al
 * director con dt=0 para que el fundido no se consuma en silencio. El
 * primer click/tecla llama a unlock() y reintenta.
 *
 * Solo navegador (window.UGS.audioPlayer). En Node no se carga: la lógica
 * musical testeable vive entera en audio/music.js.
 */
(function (root, factory) {
  const api = factory();
  root.UGS = root.UGS || {};
  root.UGS.audioPlayer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SLOTS = ['a', 'b'];

  /*
   * create({ music, base })
   *   music — director de audio/music.js
   *   base  — prefijo de ruta opcional (por si el shell se sirve anidado)
   */
  function create(opts) {
    opts = opts || {};
    const music = opts.music;
    const base = opts.base || '';
    const el = {};
    const want = { a: false, b: false };   // ranuras que DEBERÍAN estar sonando
    let blocked = false;                   // autoplay bloqueado por el navegador
    let failed = null;                     // último error de carga (diagnóstico)

    for (const s of SLOTS) {
      const a = new Audio();
      a.preload = 'none';                  // ~5 MB por pista: nada se baja hasta que hace falta
      a.loop = false;                      // el bucle lo teje el director con crossfade
      a.volume = 0;
      a.addEventListener('error', () => { failed = a.currentSrc || a.src; });
      el[s] = a;
    }

    function tryPlay(slot) {
      const p = el[slot].play();
      if (p && typeof p.catch === 'function') {
        p.then(() => { blocked = false; }).catch(() => { blocked = true; });
      }
    }

    function exec(cmds) {
      for (const c of cmds) {
        const a = el[c.slot];
        if (!a) continue;
        if (c.type === 'load') {
          a.preload = 'auto';
          a.src = base + c.src;
          a.load();
        } else if (c.type === 'play') {
          want[c.slot] = true;
          try { a.currentTime = 0; } catch (_) { /* aún sin metadatos: arranca en 0 igual */ }
          tryPlay(c.slot);
        } else if (c.type === 'gain') {
          a.volume = c.value;
        } else if (c.type === 'stop') {
          want[c.slot] = false;
          a.pause();
        }
      }
    }

    function report() {
      const r = {};
      for (const s of SLOTS) {
        r[s] = { pos: el[s].currentTime || 0, dur: el[s].duration, ended: !!el[s].ended };
      }
      return r;
    }

    // ¿Hay alguna ranura que debería sonar y el navegador no la deja arrancar?
    // OJO: una pista que llegó a su final también está `paused`, y NO es un
    // bloqueo — si se contara como tal, un crossfade cuya pista saliente
    // termina antes de acabar el fundido congelaría la música para siempre.
    function stalled() {
      return SLOTS.some(s => want[s] && el[s].paused && !el[s].ended);
    }

    return {
      get blocked() { return blocked; },
      get failedSrc() { return failed; },
      get music() { return music; },
      el,

      start() { exec(music.start()); },
      stop(o) { exec(music.stop(o)); },
      setVolume(v) { music.setVolume(v); },

      // Reintento tras el primer gesto del usuario (política de autoplay).
      unlock() {
        for (const s of SLOTS) if (want[s] && el[s].paused) tryPlay(s);
      },

      update(dt) {
        exec(music.update(stalled() ? 0 : dt, report()));
      }
    };
  }

  return { create, SLOTS };
});
