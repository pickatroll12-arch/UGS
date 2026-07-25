/*
 * UGS — audio/music  (director musical)
 * ==================================================================
 * [AUDIO · DIRECTOR] — decide QUÉ suena y CON QUÉ GANANCIA. No toca el DOM,
 * no crea elementos <audio>, no sabe qué es un navegador: es una máquina de
 * estados pura que consume dt y devuelve COMANDOS para el driver
 * (audio/player.js), igual que la lógica devuelve estado y el render lo lee.
 * Por eso corre en Node y tiene tests (PROMPT_MAESTRO.md §2 y §4.2).
 *
 * Modelo: dos ranuras (a/b) y crossfade de POTENCIA CONSTANTE entre pistas
 * (sin/cos): la suma de energía se mantiene, así la transición no "hunde" el
 * volumen a mitad de camino. La lista se baraja con core/rng.js sembrado
 * (nada de Math.random, §4.1) y se vuelve a barajar al agotarse, evitando
 * repetir la última pista → bucle infinito sin costura audible.
 *
 * Alcance: SOLO la cama 'idle' (Deck_Idle_Mu). Las carpetas Tension_Events_MU
 * y Aggresive_Events_Mu existen en !_UGS/Fx pero NO se cablean aquí: la música
 * por evento es OBJP-2, congelado.
 *
 * Corre en navegador (window.UGS.music) y en Node (module.exports).
 */
(function (root, factory) {
  const api = factory(
    root.UGS && root.UGS.core ? root.UGS.core : require('../core/core.js'),
    root.UGS && root.UGS.rng ? root.UGS.rng : require('../core/rng.js')
  );
  root.UGS = root.UGS || {};
  root.UGS.music = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CORE, RNG) {
  'use strict';

  // Cama IDLE — rutas in-situ del kit Fx (cero duplicación binaria en el repo).
  // OJO: nombres sensibles a mayúsculas ('Deck_idle_02' va con i minúscula).
  const IDLE_TRACKS = [
    '!_UGS/Fx/Music/Deck_Idle_Mu/Deck_Idle_01.ogg',
    '!_UGS/Fx/Music/Deck_Idle_Mu/Deck_idle_02.ogg',
    '!_UGS/Fx/Music/Deck_Idle_Mu/Deck_Idle_Calm_01.ogg',
    '!_UGS/Fx/Music/Deck_Idle_Mu/Deck_Idle_Calm_02.ogg'
  ];

  const SLOTS = ['a', 'b'];
  const EPS = 1e-3;

  // Fisher-Yates determinista (copia; no muta la entrada).
  function shuffle(list, rng) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }

  /*
   * create({ tracks, rng, fade, lead, volume })
   *   tracks — lista de rutas (por defecto la cama idle)
   *   rng    — instancia de core/rng.js (por defecto semilla 'ugs-music')
   *   fade   — segundos de crossfade / fundido de entrada y salida (def. 6)
   *   lead   — segundos de margen para pedir la precarga de la siguiente (def. 12)
   *   volume — ganancia maestra 0..1 (def. 0.6)
   *
   * Ciclo de vida: start() → update(dt, report) cada frame → stop().
   * `report` lo rellena el driver con lo que de verdad está pasando en cada
   * ranura: { a: {pos, dur, ended}, b: {...} }. `dur` puede ser NaN mientras
   * los metadatos no han cargado: en ese caso no se programa crossfade y se
   * cae al corte por 'ended' (peor transición, pero nunca silencio).
   */
  function create(opts) {
    opts = opts || {};
    const tracks = (Array.isArray(opts.tracks) && opts.tracks.length ? opts.tracks : IDLE_TRACKS).slice();
    const rng = opts.rng || RNG.create('ugs-music');
    const fade = Number(opts.fade) > 0 ? Number(opts.fade) : 6;
    const lead = Number(opts.lead) >= 0 ? Number(opts.lead) : 12;

    let volume = CORE.clamp(opts.volume == null ? 0.6 : Number(opts.volume), 0, 1);
    let phase = 'stopped';            // stopped | fadein | playing | crossfade | fadeout
    let active = 'a';
    let queue = [];
    let last = null;                  // última pista servida (evita repetir al rebarajar)
    let staged = null;                // pista ya pedida al driver para la otra ranura
    let t = 0;                        // reloj de la transición en curso
    let fadeFrom = { a: 0, b: 0 };    // ganancias al empezar un fundido de salida
    const gains = { a: 0, b: 0 };
    const srcs = { a: null, b: null };

    const other = () => (active === 'a' ? 'b' : 'a');
    // curvas de potencia constante: in² + out² = 1
    const gainIn = (p) => Math.sin(p * Math.PI / 2);
    const gainOut = (p) => Math.cos(p * Math.PI / 2);

    // Solo emite si la ganancia cambia de verdad (el driver no recibe ruido).
    // `force` salta el umbral: los valores TERMINALES de cada transición
    // (0 exacto, volumen exacto) deben llegar al driver aunque el último paso
    // del fundido sea más pequeño que el umbral; si no, una pista se queda
    // parada en 0.998 y la otra no llega nunca a silencio real.
    function setGain(out, slot, v, force) {
      v = CORE.clamp(v, 0, 1);
      if (!force && Math.abs(gains[slot] - v) < EPS) return;
      if (gains[slot] === v) return;
      gains[slot] = v;
      out.push({ type: 'gain', slot, value: v });
    }

    function nextTrack() {
      if (!queue.length) {
        queue = tracks.length > 1 ? shuffle(tracks, rng) : tracks.slice();
        // no encadenar la misma pista dos veces al rebarajar
        if (queue.length > 1 && queue[0] === last) queue.push(queue.shift());
      }
      last = queue.shift();
      return last;
    }

    // corte duro: la pista terminó sin que hubiera crossfade programado
    function hardCut(out) {
      const slot = other();
      const src = staged || nextTrack();
      staged = null;
      if (srcs[slot] !== src) { srcs[slot] = src; out.push({ type: 'load', slot, src }); }
      setGain(out, slot, 0);
      out.push({ type: 'play', slot });
      setGain(out, slot, volume);
      setGain(out, active, 0);
      out.push({ type: 'stop', slot: active });
      active = slot;
      phase = 'playing';
      t = 0;
    }

    const api = {
      get phase() { return phase; },
      get volume() { return volume; },
      get nowPlaying() { return srcs[active]; },
      get tracks() { return tracks.slice(); },
      // expuesto para tests/depuración: ganancia efectiva por ranura
      gainOf(slot) { return gains[slot]; },

      start() {
        const out = [];
        if (phase !== 'stopped') return out;
        active = 'a'; staged = null; t = 0;
        gains.a = 0; gains.b = 0;
        srcs.a = nextTrack(); srcs.b = null;
        phase = 'fadein';
        out.push({ type: 'load', slot: 'a', src: srcs.a });
        out.push({ type: 'gain', slot: 'a', value: 0 });
        out.push({ type: 'play', slot: 'a' });
        return out;
      },

      // Fundido de salida (grato) salvo immediate:true → corte seco.
      stop(o) {
        const out = [];
        if (phase === 'stopped') return out;
        if (o && o.immediate) {
          for (const s of SLOTS) { setGain(out, s, 0); out.push({ type: 'stop', slot: s }); srcs[s] = null; }
          phase = 'stopped'; t = 0; staged = null;
          return out;
        }
        fadeFrom = { a: gains.a, b: gains.b };
        phase = 'fadeout'; t = 0;
        return out;
      },

      setVolume(v) {
        volume = CORE.clamp(Number(v) || 0, 0, 1);
        return volume;                 // el próximo update() propaga la ganancia
      },

      /*
       * Avanza la transición y devuelve los comandos del frame.
       * dt en segundos; el driver pasa dt=0 mientras el navegador tenga el
       * audio bloqueado (autoplay), así el fundido no corre en silencio.
       */
      update(dt, report) {
        const out = [];
        if (phase === 'stopped') return out;
        dt = Math.max(0, Number(dt) || 0);
        const rep = report || {};
        const cur = rep[active] || {};

        if (phase === 'fadein') {
          t += dt;
          const p = CORE.clamp(t / fade, 0, 1);
          setGain(out, active, gainIn(p) * volume, p >= 1);
          if (p >= 1) { phase = 'playing'; t = 0; }
          return out;
        }

        if (phase === 'playing') {
          setGain(out, active, volume);
          const dur = Number(cur.dur);
          const pos = Number(cur.pos) || 0;
          const rem = (isFinite(dur) && dur > 0) ? dur - pos : Infinity;

          if (cur.ended) { hardCut(out); return out; }

          // 1) pedir con antelación la siguiente pista (streaming, no bloquea)
          if (!staged && rem <= fade + lead) {
            staged = nextTrack();
            srcs[other()] = staged;
            out.push({ type: 'load', slot: other(), src: staged });
          }
          // 2) arrancar el crossfade cuando queda justo el fundido
          if (staged && rem <= fade) {
            setGain(out, other(), 0);
            out.push({ type: 'play', slot: other() });
            phase = 'crossfade'; t = 0;
          }
          return out;
        }

        if (phase === 'crossfade') {
          t += dt;
          const p = CORE.clamp(t / fade, 0, 1);
          setGain(out, active, gainOut(p) * volume, p >= 1);
          setGain(out, other(), gainIn(p) * volume, p >= 1);
          if (p >= 1) {
            const done = active;
            setGain(out, done, 0, true);
            setGain(out, other(), volume, true);
            out.push({ type: 'stop', slot: done });
            srcs[done] = null;
            active = other();
            staged = null;
            phase = 'playing'; t = 0;
          }
          return out;
        }

        // fadeout
        t += dt;
        const p = CORE.clamp(t / fade, 0, 1);
        for (const s of SLOTS) setGain(out, s, fadeFrom[s] * gainOut(p), p >= 1);
        if (p >= 1) {
          for (const s of SLOTS) { out.push({ type: 'stop', slot: s }); srcs[s] = null; }
          phase = 'stopped'; t = 0; staged = null;
        }
        return out;
      }
    };

    return api;
  }

  return { create, shuffle, IDLE_TRACKS, SLOTS };
});
