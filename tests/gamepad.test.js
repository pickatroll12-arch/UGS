/* UGS — tests de input/gamepad (soporte de mando).  node tests/gamepad.test.js */
'use strict';
const GP = require('../src/input/gamepad.js');

let passed = 0, failed = 0;
const check = (n, c) => { if (c) { passed++; console.log('  ok  ', n); } else { failed++; console.error('  FAIL', n); } };
const near = (a, b, e) => Math.abs(a - b) <= (e == null ? 1e-6 : e);

console.log('UGS input/gamepad tests\n');

// mando falso con mapping estándar (como reporta el Odin 2 Portal)
function pad(opts) {
  opts = opts || {};
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  for (const name of (opts.down || [])) {
    const i = GP.BUTTONS.indexOf(name);
    buttons[i] = { pressed: true, value: 1 };
  }
  for (const [name, v] of Object.entries(opts.analog || {})) {
    buttons[GP.BUTTONS.indexOf(name)] = { pressed: false, value: v };
  }
  return { id: 'Odin2 Portal (STANDARD GAMEPAD)', mapping: 'standard', connected: true,
    axes: opts.axes || [0, 0, 0, 0], buttons };
}

// ---- zona muerta ------------------------------------------------------------
{
  const c = GP.stick(0.1, 0.1, 0.22);
  check('dentro de la zona muerta el stick es 0', c.x === 0 && c.y === 0);
  const d = GP.stick(0.23, 0, 0.22);
  check('justo fuera de la zona muerta arranca cerca de 0 (sin salto)', d.x > 0 && d.x < 0.05);
  const e = GP.stick(1, 0, 0.22);
  check('a tope el stick llega a 1', near(e.x, 1, 1e-6));
  const f = GP.stick(-1, 0, 0.22);
  check('funciona en negativo', near(f.x, -1, 1e-6));
  const g = GP.stick(0.9, 0.9, 0.22);
  check('la zona muerta es RADIAL, no por eje', g.m > 0 && Math.hypot(g.x, g.y) <= 1.0001);
}

// ---- flancos: pulsar no es mantener ----------------------------------------
{
  const g = GP.create();
  let r = g.poll([pad({ down: ['a'] })], 0.016);
  check('A recién pulsado sale en pressed', r.pressed.includes('a'));
  check('y también en held', r.held.includes('a'));

  r = g.poll([pad({ down: ['a'] })], 0.016);
  check('manteniendo A ya NO vuelve a salir en pressed', !r.pressed.includes('a'));
  check('pero sigue en held', r.held.includes('a'));
  check('A no se auto-repite (no es navegación)', !r.repeated.includes('a'));

  r = g.poll([pad({})], 0.016);
  check('al soltar sale en released', r.released.includes('a'));
  check('y ya no está en held', !r.held.includes('a'));

  r = g.poll([pad({})], 0.016);
  check('soltado no repite released', !r.released.includes('a'));
}

// ---- auto-repetición del d-pad ---------------------------------------------
{
  const g = GP.create({ repeatDelay: 0.3, repeatRate: 0.1 });
  let r = g.poll([pad({ down: ['right'] })], 0.016);
  check('la primera pulsación de → cuenta ya', r.repeated.filter(x => x === 'right').length === 1);

  let total = 0;
  for (let i = 0; i < 10; i++) {           // 10 frames de 0.05 s = 0.5 s
    r = g.poll([pad({ down: ['right'] })], 0.05);
    total += r.repeated.filter(x => x === 'right').length;
  }
  check('tras el retardo empieza a repetir (' + total + ' repeticiones en 0.5 s)', total >= 1 && total <= 4);
  check('el retardo evita el chorro inmediato', total < 10);
}

// ---- gatillos analógicos ----------------------------------------------------
{
  const g = GP.create({ triggerThreshold: 0.5 });
  let r = g.poll([pad({ analog: { rt: 0.2 } })], 0.016);
  check('un gatillo apenas rozado no cuenta', !r.held.includes('rt'));
  r = g.poll([pad({ analog: { rt: 0.8 } })], 0.016);
  check('pasado el umbral, el gatillo cuenta como pulsado', r.pressed.includes('rt'));
}

// ---- sin mando --------------------------------------------------------------
{
  const g = GP.create();
  const r = g.poll([], 0.016);
  check('sin mando, connected es false', r.connected === false);
  check('sin mando no hay ejes ni botones', r.axes.lx === 0 && r.pressed.length === 0);
  check('poll(null) no revienta', g.poll(null, 0.016).connected === false);
  check('un hueco null en la lista se ignora', g.poll([null, pad({ down: ['b'] })], 0.016).pressed.includes('b'));
}

// ---- desconexión a media pulsación -----------------------------------------
// Si el mando se desconecta con A pulsado, al reconectar NO debe dispararse
// un "pressed" fantasma ni quedarse A pegado.
{
  const g = GP.create();
  g.poll([pad({ down: ['a'] })], 0.016);
  const off = g.poll([], 0.016);
  check('al desconectar no quedan botones pegados', off.held.length === 0);
  const back = g.poll([pad({ down: ['a'] })], 0.016);
  check('al reconectar con A pulsado se cuenta como pulsación nueva', back.pressed.includes('a'));
}

// ---- mapa de acciones -------------------------------------------------------
{
  check('A confirma en ambos modos',
    GP.actionFor('a', 'game') === 'click' && GP.actionFor('a', 'dev') === 'click');
  check('B cancela', GP.actionFor('b', 'game') === 'cancel');
  check('X expide en juego y deshace en dev (ningún botón muerto)',
    GP.actionFor('x', 'game') === 'expedite' && GP.actionFor('x', 'dev') === 'undo');
  check('Y pausa en juego y rehace en dev',
    GP.actionFor('y', 'game') === 'pause' && GP.actionFor('y', 'dev') === 'redo');
  // ningún botón de "letra" puede quedarse sin acción en ningún modo: fue el
  // fallo reportado desde el Odin 2 real ("funciona todo menos las letras")
  check('A/B/X/Y hacen algo en LOS DOS modos',
    ['a','b','x','y'].every(k => GP.actionFor(k,'game') && GP.actionFor(k,'dev')));
  check('el d-pad cambia de herramienta SOLO en dev',
    GP.actionFor('left', 'dev') === 'toolPrev' && GP.actionFor('left', 'game') === null);
  // girar objetos con la cruceta (-XONO: «tampoco se pueden rotar los objetos»)
  check('la cruceta arriba/abajo gira objetos en dev',
    GP.actionFor('up', 'dev') === 'objRotR' && GP.actionFor('down', 'dev') === 'objRotL');
  check('girar objetos no existe en juego (allí no se edita)',
    GP.actionFor('up', 'game') === null && GP.actionFor('down', 'game') === null);
  check('ningún botón de la cruceta queda muerto en dev',
    ['up','down','left','right'].every(k => GP.actionFor(k, 'dev')));
  check('la rotación de objeto se auto-repite (mantener gira varias veces)',
    GP.REPEATABLE.includes('up') && GP.REPEATABLE.includes('down'));
  check('los bumpers rotan la cámara en ambos modos',
    GP.actionFor('lb', 'game') === 'rotL' && GP.actionFor('rb', 'dev') === 'rotR');
  check('un botón desconocido no tiene acción', GP.actionFor('nope', 'game') === null);
  check('toda acción declarada tiene descripción para la ayuda',
    Object.values(GP.ACTIONS).every(a => typeof a.desc === 'string' && a.desc));
  check('hay 16 botones estándar mapeados', GP.BUTTONS.length === 16);
  check('los botones de acción NO se auto-repiten',
    !GP.REPEATABLE.includes('a') && !GP.REPEATABLE.includes('b') && !GP.REPEATABLE.includes('x'));
}

// ---- reset ------------------------------------------------------------------
{
  const g = GP.create();
  g.poll([pad({ down: ['start'] })], 0.016);
  g.reset();
  check('tras reset, mantener el botón vuelve a contar como pulsación',
    g.poll([pad({ down: ['start'] })], 0.016).pressed.includes('start'));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
