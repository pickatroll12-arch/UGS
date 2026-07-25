/* UGS — tests de audio/music (director musical).  node tests/audio.test.js */
'use strict';
const RNG = require('../src/core/rng.js');
const M = require('../src/audio/music.js');

let passed = 0, failed = 0;
const check = (n, c) => { if (c) { passed++; console.log('  ok  ', n); } else { failed++; console.error('  FAIL', n); } };
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-6 : eps);

console.log('UGS audio/music tests\n');

/*
 * Driver simulado: hace de <audio> sin navegador. Ejecuta los comandos del
 * director y avanza la posición de las ranuras que están sonando, igual que
 * haría el elemento real. Así el crossfade se prueba entero en Node.
 */
function makeSim(music, dur) {
  const st = {
    a: { src: null, pos: 0, dur: NaN, ended: false, playing: false, gain: 0 },
    b: { src: null, pos: 0, dur: NaN, ended: false, playing: false, gain: 0 }
  };
  const log = [];
  function exec(cmds) {
    for (const c of cmds) {
      log.push(c);
      const s = st[c.slot];
      if (c.type === 'load') { s.src = c.src; s.dur = dur; s.pos = 0; s.ended = false; }
      else if (c.type === 'play') { s.playing = true; s.pos = 0; s.ended = false; }
      else if (c.type === 'stop') { s.playing = false; }
      else if (c.type === 'gain') { s.gain = c.value; }
    }
  }
  function step(dt) {
    for (const k of ['a', 'b']) {
      const s = st[k];
      if (!s.playing) continue;
      s.pos += dt;
      if (isFinite(s.dur) && s.pos >= s.dur) { s.pos = s.dur; s.ended = true; }
    }
    exec(music.update(dt, st));
  }
  function run(seconds, dt) {
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) step(dt);
  }
  return { st, log, exec, step, run };
}

// ---- barajado determinista ---------------------------------------------------
{
  const list = ['1', '2', '3', '4', '5', '6'];
  const s1 = M.shuffle(list, RNG.create('semilla'));
  const s2 = M.shuffle(list, RNG.create('semilla'));
  const s3 = M.shuffle(list, RNG.create('otra'));
  check('shuffle es determinista por semilla', s1.join() === s2.join());
  check('shuffle no muta la entrada', list.join() === '1,2,3,4,5,6');
  check('shuffle es permutación', s1.slice().sort().join() === list.slice().sort().join());
  check('semillas distintas → órdenes distintos', s1.join() !== s3.join());
}

// ---- catálogo idle -----------------------------------------------------------
{
  check('cama idle tiene 4 pistas', M.IDLE_TRACKS.length === 4);
  check('todas apuntan a Deck_Idle_Mu', M.IDLE_TRACKS.every(t => t.indexOf('!_UGS/Fx/Music/Deck_Idle_Mu/') === 0));
  check('todas son .ogg', M.IDLE_TRACKS.every(t => /\.ogg$/.test(t)));
  check('sin pistas duplicadas', new Set(M.IDLE_TRACKS).size === M.IDLE_TRACKS.length);
  // la música por evento es OBJP-2: no debe estar cableada aquí
  check('no cablea música de evento (OBJP-2)', M.IDLE_TRACKS.every(t => !/Tension|Aggresive/.test(t)));
}

// ---- arranque con fundido de entrada ----------------------------------------
{
  const music = M.create({ rng: RNG.create('t'), fade: 4, lead: 10, volume: 0.8 });
  check('arranca en stopped', music.phase === 'stopped');
  const sim = makeSim(music, 60);
  sim.exec(music.start());
  check('start carga la ranura a', sim.st.a.src != null && sim.st.a.playing);
  check('start arranca en silencio', sim.st.a.gain === 0);
  check('start pasa a fadein', music.phase === 'fadein');
  check('start dos veces no reinicia', music.start().length === 0);

  sim.run(2, 0.1);                              // mitad del fundido
  check('fadein a mitad ≈ sin(45°)·vol', near(music.gainOf('a'), Math.sin(Math.PI / 4) * 0.8, 0.05));
  sim.run(2.5, 0.1);
  check('fadein termina en volumen pleno', near(music.gainOf('a'), 0.8, 1e-9));
  check('tras el fundido queda en playing', music.phase === 'playing');
}

// ---- crossfade de potencia constante ----------------------------------------
{
  const music = M.create({ rng: RNG.create('t'), fade: 6, lead: 10, volume: 1 });
  const sim = makeSim(music, 60);
  sim.exec(music.start());
  sim.run(20, 0.1);
  check('durante la pista solo suena una ranura', sim.st.b.src === null);

  sim.run(25, 0.1);                             // quedan ~15 s: entra la precarga (fade+lead=16)
  check('precarga la siguiente pista con antelación', sim.st.b.src != null && !sim.st.b.playing);
  check('la precarga es OTRA pista', sim.st.b.src !== sim.st.a.src);

  sim.run(9, 0.1);                              // quedan ~6 s: arranca el crossfade
  check('el crossfade arranca solo', music.phase === 'crossfade');
  check('la nueva pista ya suena', sim.st.b.playing);

  sim.run(3, 0.1);                              // mitad del crossfade
  const ga = music.gainOf('a'), gb = music.gainOf('b');
  check('a mitad de crossfade ambas suenan', ga > 0.1 && gb > 0.1);
  check('potencia constante (a²+b² ≈ vol²)', near(ga * ga + gb * gb, 1, 0.02));

  sim.run(4, 0.1);
  check('al terminar, la vieja se detiene', !sim.st.a.playing && sim.st.a.gain === 0);
  check('la nueva queda a volumen pleno', near(music.gainOf('b'), 1, 1e-9));
  check('vuelve a playing', music.phase === 'playing');
  check('nowPlaying es la pista nueva', music.nowPlaying === sim.st.b.src);
}

// ---- bucle infinito sin agotarse ni repetir ---------------------------------
{
  const music = M.create({ rng: RNG.create('bucle'), fade: 3, lead: 5, volume: 1 });
  const sim = makeSim(music, 20);
  sim.exec(music.start());
  const heard = [];
  let prev = null;
  for (let i = 0; i < 4000; i++) {              // ~200 s = 10+ pistas encadenadas
    sim.step(0.05);
    const np = music.nowPlaying;
    if (np && np !== prev) { heard.push(np); prev = np; }
  }
  check('encadena muchas pistas sin quedarse sin cola', heard.length >= 8);
  check('nunca suena dos veces seguidas la misma', heard.every((t, i) => i === 0 || t !== heard[i - 1]));
  check('sigue sonando al final del bucle', music.phase === 'playing' || music.phase === 'crossfade');
  check('la música nunca cae a silencio', music.gainOf('a') + music.gainOf('b') > 0.9);
}

// ---- una sola pista: hace bucle consigo misma -------------------------------
{
  const only = ['solo.ogg'];
  const music = M.create({ tracks: only, rng: RNG.create('x'), fade: 2, lead: 4, volume: 1 });
  const sim = makeSim(music, 20);
  sim.exec(music.start());
  sim.run(19, 0.05);
  check('pista única entra en crossfade consigo misma', music.phase === 'crossfade');
  sim.run(3, 0.05);
  check('pista única sigue sonando tras el bucle', music.nowPlaying === 'solo.ogg' && music.gainOf(music.gainOf('a') > 0 ? 'a' : 'b') > 0.9);
}

// ---- sin metadatos: no programa crossfade, cae al corte por 'ended' ---------
{
  const music = M.create({ rng: RNG.create('t'), fade: 3, lead: 5, volume: 1 });
  const sim = makeSim(music, NaN);              // duración desconocida
  sim.exec(music.start());
  sim.run(30, 0.1);
  check('sin duración no precarga ni cruza', sim.st.b.src === null && music.phase === 'playing');

  const first = music.nowPlaying;
  sim.st.a.ended = true;                        // el elemento avisa de que terminó
  sim.step(0.1);
  check('ended fuerza corte duro a la siguiente', music.nowPlaying !== first && music.nowPlaying != null);
  check('tras el corte duro suena a volumen pleno', near(music.gainOf(sim.st.b.playing ? 'b' : 'a'), 1, 1e-9));
}

// ---- regresión: la pista saliente termina A MITAD del crossfade -------------
// (detectado en el smoke de Chromium: el driver contaba una pista terminada
//  como "audio bloqueado" y congelaba la transición para siempre)
{
  const music = M.create({ rng: RNG.create('t'), fade: 6, lead: 2, volume: 1 });
  const sim = makeSim(music, 20);
  sim.exec(music.start());
  while (music.phase !== 'crossfade') sim.step(0.1);
  sim.st.a.ended = true; sim.st.a.playing = false;   // la vieja se acaba antes de tiempo
  sim.run(7, 0.1);
  check('el crossfade completa aunque la vieja termine antes', music.phase === 'playing');
  check('tras completar, la nueva suena a volumen pleno', near(music.gainOf(sim.st.b.playing ? 'b' : 'a'), 1, 1e-9));
}

// ---- volumen maestro ---------------------------------------------------------
{
  const music = M.create({ rng: RNG.create('t'), fade: 2, lead: 4, volume: 1 });
  const sim = makeSim(music, 60);
  sim.exec(music.start());
  sim.run(3, 0.1);
  music.setVolume(0.25);
  sim.step(0.1);
  check('setVolume propaga a la ranura activa', near(music.gainOf('a'), 0.25, 1e-9));
  check('setVolume recorta fuera de rango', music.setVolume(9) === 1 && music.setVolume(-3) === 0);
}

// ---- parada con fundido de salida y parada seca -----------------------------
{
  const music = M.create({ rng: RNG.create('t'), fade: 4, lead: 6, volume: 1 });
  const sim = makeSim(music, 60);
  sim.exec(music.start());
  sim.run(6, 0.1);
  sim.exec(music.stop());
  check('stop entra en fadeout', music.phase === 'fadeout');
  sim.run(2, 0.1);
  check('fadeout baja pero aún suena', music.gainOf('a') > 0.05 && music.gainOf('a') < 0.95);
  sim.run(2.5, 0.1);
  check('fadeout termina en stopped', music.phase === 'stopped');
  check('fadeout deja ambas ranuras paradas', !sim.st.a.playing && !sim.st.b.playing);
  check('update tras stopped no hace nada', music.update(1, sim.st).length === 0);

  const m2 = M.create({ rng: RNG.create('t'), fade: 4, volume: 1 });
  const s2 = makeSim(m2, 60);
  s2.exec(m2.start());
  s2.run(6, 0.1);
  s2.exec(m2.stop({ immediate: true }));
  check('stop immediate corta en seco', m2.phase === 'stopped' && !s2.st.a.playing && s2.st.a.gain === 0);
}

// ---- dt=0 (autoplay bloqueado) congela la transición ------------------------
{
  const music = M.create({ rng: RNG.create('t'), fade: 4, lead: 6, volume: 1 });
  const sim = makeSim(music, 60);
  sim.exec(music.start());
  for (let i = 0; i < 50; i++) sim.exec(music.update(0, sim.st));   // driver estancado
  check('con dt=0 el fundido no se consume', music.phase === 'fadein' && music.gainOf('a') === 0);
  sim.run(4.5, 0.1);
  check('al desbloquear, el fundido corre normal', music.phase === 'playing' && near(music.gainOf('a'), 1, 1e-9));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
