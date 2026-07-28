/* UGS — tests de render/render3d: contabilidad de la ESCENA.
   node tests/render3d.test.js

   REGRESIÓN 2026-07-28 (-XONO): «se duplica la sala en todo. modulos/Nexo …
   queda permanentemente duplicado … y lo peor pierde la logica de
   desplazamiento (navegacion)».

   Causa: al terminar de cargar la hoja de consolas, render3d hacía
   `stat = null` para forzar la reconstrucción. Soltar la referencia NO saca
   el grupo de la escena: three.js seguía dibujando la sala anterior encima
   de TODAS las vistas, para siempre. Como esa sala fantasma no existía en el
   modelo, su suelo no era clicable → el PCJ no se movía.

   Aquí se prueba el invariante que lo impide: `swapGroup` es la ÚNICA puerta
   de la escena y deja como mucho UN grupo vivo por ranura. Es pura salvo por
   scene.add/remove, así que se testea en Node con dobles — sin three.js. */
'use strict';
const R3 = require('../src/render/render3d.js');

let passed = 0, failed = 0;
const check = (n, c) => { if (c) { passed++; console.log('  ok  ', n); } else { failed++; console.error('  FAIL', n); } };

console.log('UGS render3d · contabilidad de la escena\n');

// dobles mínimos: una escena que solo sabe add/remove y geometrías que cuentan
// sus dispose(). Nada de esto necesita WebGL ni three.js.
function fakeScene() {
  const children = [];
  return {
    children,
    add(g) { children.push(g); },
    remove(g) { const i = children.indexOf(g); if (i >= 0) children.splice(i, 1); }
  };
}
let disposed = 0;
const fakeGeo = () => ({ dispose() { disposed++; } });
const entry = (name) => ({ name, group: { name }, geos: [fakeGeo(), fakeGeo()] });

// ---- el módulo carga en Node y expone la puerta -----------------------------
check('render3d carga en Node sin three.js', typeof R3.swapGroup === 'function');
check('sin three.js, available() es false (la app cae al 2D)', R3.available() === false);

// ---- invariante: una ranura, un grupo ---------------------------------------
{
  const scene = fakeScene();
  const a = entry('a');
  let slot = R3.swapGroup(scene, null, a);
  check('el primer grupo entra en la escena', scene.children.length === 1 && scene.children[0] === a.group);
  check('swapGroup devuelve la ranura ocupada', slot === a);

  const b = entry('b');
  slot = R3.swapGroup(scene, slot, b);
  check('reconstruir NO acumula grupos', scene.children.length === 1);
  check('el grupo vivo es el nuevo', scene.children[0] === b.group);
  check('el grupo viejo salió de la escena', !scene.children.includes(a.group));
}

// ---- el caso exacto que rompió: vaciar la ranura ----------------------------
{
  const scene = fakeScene();
  const a = entry('a');
  let slot = R3.swapGroup(scene, null, a);
  // esto es lo que hace el callback de la textura al quedar lista
  slot = R3.swapGroup(scene, slot, null);
  check('vaciar la ranura SACA el grupo de la escena (no solo la referencia)',
    scene.children.length === 0);
  check('la ranura queda vacía', slot === null);

  // …y la siguiente reconstrucción no revive al fantasma
  const b = entry('b');
  slot = R3.swapGroup(scene, slot, b);
  check('tras vaciar, la reconstrucción deja UN solo grupo', scene.children.length === 1);
  check('y es el nuevo, no el fantasma', scene.children[0] === b.group);
}

// ---- 20 reconstrucciones seguidas: la escena no crece -----------------------
{
  const scene = fakeScene();
  let slot = null;
  for (let i = 0; i < 20; i++) slot = R3.swapGroup(scene, slot, entry('g' + i));
  check('20 reconstrucciones → 1 grupo en escena', scene.children.length === 1);
  check('el superviviente es el último', scene.children[0].name === 'g19');
}

// ---- memoria: las geometrías del grupo saliente se liberan ------------------
{
  const scene = fakeScene();
  disposed = 0;
  const a = entry('a');
  let slot = R3.swapGroup(scene, null, a);
  check('al entrar no se libera nada', disposed === 0);
  slot = R3.swapGroup(scene, slot, entry('b'));
  check('al salir se liberan sus geometrías (2)', disposed === 2);
  R3.swapGroup(scene, slot, null);
  check('vaciar también libera', disposed === 4);
}

// ---- bordes ------------------------------------------------------------------
{
  const scene = fakeScene();
  const a = entry('a');
  const slot = R3.swapGroup(scene, null, a);
  disposed = 0;
  const same = R3.swapGroup(scene, a, a);
  check('cambiar un grupo por sí mismo no lo saca ni lo libera',
    same === a && scene.children.length === 1 && disposed === 0);
  check('swapGroup(scene, null, null) no rompe', R3.swapGroup(scene, null, null) === null);
  check('tolera una entrada sin geos', (() => {
    const s2 = fakeScene();
    const e = { group: { name: 'x' } };
    const k = R3.swapGroup(s2, null, e);
    return R3.swapGroup(s2, k, null) === null && s2.children.length === 0;
  })());
  void slot;
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
