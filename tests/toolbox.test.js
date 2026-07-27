/* UGS — tests de tools/toolbox (barra de herramientas).  node tests/toolbox.test.js */
'use strict';
const TB = require('../src/tools/toolbox.js');

let passed = 0, failed = 0;
const check = (n, c) => { if (c) { passed++; console.log('  ok  ', n); } else { failed++; console.error('  FAIL', n); } };

console.log('UGS tools/toolbox tests\n');

// ---- DRAG BOX: utilidad declarada INTOCABLE por el organizador --------------
// Si algún rediseño futuro convierte suelo/pared/borrar en click suelto, este
// bloque falla y para la entrega. Es el guardián de la utilidad.
{
  for (const id of ['floor', 'wall', 'erase']) {
    const t = TB.byId(id);
    check('DRAG BOX intacto en ' + id, !!t && t.gesture === 'rect');
  }
  const rect = TB.TOOLS.filter(t => t.gesture === 'rect').map(t => t.id).sort().join();
  check('DRAG BOX cubre exactamente suelo/pared/borrar', rect === 'erase,floor,wall');
  check('las herramientas rect anuncian DRAG BOX en su pista',
    TB.TOOLS.filter(t => t.gesture === 'rect').every(t => /DRAG BOX/.test(t.hint)));
}

// ---- teclas rápidas ---------------------------------------------------------
{
  const keys = TB.TOOLS.map(t => t.key);
  check('hay 10 herramientas activas', TB.TOOLS.length === 10);
  check('teclas únicas', new Set(keys).size === keys.length);
  check('teclas son 1..9 y 0 en orden', keys.join() === '1,2,3,4,5,6,7,8,9,0');
  check('byKey resuelve la tecla 1', TB.byKey('1').id === 'select');
  check('byKey resuelve la tecla 0', TB.byKey('0').id === 'module');
  check('byKey ignora teclas ajenas', TB.byKey('x') === null && TB.byKey('') === null);
  check('byId devuelve null si no existe', TB.byId('nope') === null);
  check('toda herramienta tiene glifo, nombre y pista',
    TB.TOOLS.every(t => t.glyph && t.name && t.hint && t.gesture));
}

// ---- disponibilidad por sección --------------------------------------------
{
  const nexoOnly = ['entry', 'link', 'module'];
  for (const id of nexoOnly) {
    check(id + ' solo en sección Nexo',
      TB.isAvailable(TB.byId(id), { section: 'nexo' }) && !TB.isAvailable(TB.byId(id), { section: 'modules' }));
  }
  for (const id of ['select', 'floor', 'wall', 'erase', 'fill', 'object', 'console']) {
    check(id + ' disponible en ambas secciones',
      TB.isAvailable(TB.byId(id), { section: 'nexo' }) && TB.isAvailable(TB.byId(id), { section: 'modules' }));
  }
  check('isAvailable(null) es false', TB.isAvailable(null, { section: 'nexo' }) === false);
  // la tecla NO se reasigna al cambiar de sección: la memoria muscular aguanta
  check('la tecla 8 sigue siendo entrada en sección módulos', TB.byKey('8').id === 'entry');
}

// ---- etapas futuras: declaradas pero bloqueadas -----------------------------
{
  check('hay 3 huecos reservados', TB.RESERVED.length === 3);
  check('ningún reservado gasta tecla', TB.RESERVED.every(t => !t.key));
  check('todo reservado declara su etapa congelada',
    TB.RESERVED.every(t => t.stage === 'OBJP-1.1' || t.stage === 'OBJP-2'));
  check('los reservados no están en el catálogo activo',
    TB.RESERVED.every(t => TB.byId(t.id) === null));
  const slots = TB.slotsFor();
  check('slotsFor mezcla activas + reservadas', slots.length === 13);
  check('slotsFor marca locked solo en las reservadas',
    slots.filter(s => s.locked).length === 3 && slots.slice(0, 10).every(s => !s.locked));
}

// ---- geometría de la barra --------------------------------------------------
{
  const lay = TB.layout(1400, 800);
  check('un slot por herramienta', lay.slots.length === 13);
  check('la barra queda abajo', lay.cy > 800 * 0.85 && lay.cy < 800);
  check('la barra está centrada',
    Math.abs((lay.slots[0].cx + lay.slots[lay.slots.length - 1].cx) / 2 - 700) < 1);
  const gaps = lay.slots.slice(1).map((s, i) => s.cx - lay.slots[i].cx);
  check('paso constante entre rombos', new Set(gaps).size === 1);
  check('los rombos no se solapan', gaps[0] >= lay.hw * 2);
  check('el raíl envuelve a los rombos',
    lay.rail.x < lay.slots[0].cx - lay.hw && lay.rail.x + lay.rail.w > lay.slots[12].cx + lay.hw);

  // con panel lateral la barra se centra en el ÁREA LIBRE, no bajo el panel
  {
    const off = TB.layout(1400, 800, { left: 252 });
    check('la barra respeta el panel lateral', off.rail.x >= 252);
    check('la barra se centra en el área libre',
      Math.abs((off.rail.x + off.rail.w / 2) - (252 + (1400 - 252) / 2)) < 2);
    check('sin panel la barra se centra en el lienzo',
      Math.abs((lay.rail.x + lay.rail.w / 2) - 700) < 2);
    // si el panel no deja sitio, la barra no se sale de pantalla
    const tight = TB.layout(900, 700, { left: 800 });
    check('con poco sitio la barra sigue dentro', tight.rail.x + tight.rail.w <= 900 + 20);
  }

  // en pantallas estrechas la barra se encoge en vez de desbordar
  const nar = TB.layout(700, 500);
  check('la barra escala en pantalla estrecha', nar.hw < lay.hw);
  check('la barra estrecha sigue cabiendo', nar.rail.x >= 0 && nar.rail.x + nar.rail.w <= 700);
}

// ---- hit-test del rombo -----------------------------------------------------
{
  const lay = TB.layout(1400, 800);
  const s = lay.slots[3];
  check('acierta en el centro del rombo', TB.hitTest(lay, s.cx, s.cy).id === s.id);
  check('acierta cerca del borde interior', TB.hitTest(lay, s.cx + s.hw * 0.4, s.cy) !== null);
  // las esquinas del bounding-box quedan FUERA del rombo: eso es lo que
  // diferencia un rombo de un botón cuadrado
  check('las esquinas del rombo no cuentan',
    TB.hitTest(lay, s.cx + s.hw * 0.95, s.cy + s.hh * 0.95) === null);
  check('fuera de la barra no hay acierto', TB.hitTest(lay, 20, 20) === null);
  check('inBar detecta la zona de la barra', TB.inBar(lay, 700, lay.cy) === true);
  check('inBar es falso en el centro del mapa', TB.inBar(lay, 700, 300) === false);
  const hitLocked = TB.hitTest(lay, lay.slots[11].cx, lay.slots[11].cy);
  check('el hit-test también devuelve los bloqueados (para su tooltip)',
    hitLocked !== null && hitLocked.locked === true);
}

// ---- draw() no toca el DOM y es tolerante -----------------------------------
{
  const calls = [];
  const stub = new Proxy({}, {
    get(_, p) {
      if (p === 'canvas') return undefined;
      return (...a) => { calls.push(p); return undefined; };
    },
    set() { return true; }
  });
  const lay = TB.draw(stub, 1400, 800, { active: 'floor', hoverId: 'wall', section: 'nexo' });
  check('draw devuelve el layout usado', lay && lay.slots.length === 13);
  check('draw pinta rombos y texto', calls.includes('fill') && calls.includes('fillText'));
  check('draw equilibra save/restore',
    calls.filter(c => c === 'save').length === calls.filter(c => c === 'restore').length);
  check('draw sin opciones no revienta', TB.draw(stub, 900, 600) !== null);
  // contexto sin gradientes (mock reducido): degrada a color plano, no revienta
  check('draw tolera un ctx sin createLinearGradient', TB.draw(stub, 1200, 700, { active: 'select' }) !== null);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
