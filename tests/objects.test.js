/* UGS — tests de OBJP-1.1 T1 (librería de objetos) y T2 (Reactor ≥5×5).
   node tests/objects.test.js */
'use strict';
const D = require('../src/core/data.js');
const OL = require('../src/core/objects_lib.js');
const BP = require('../src/engine/blueprint.js');
const S = require('../src/core/save.js');
const NAV = require('../src/engine/nav.js');

let passed = 0, failed = 0;
const check = (n, c) => { if (c) { passed++; console.log('  ok  ', n); } else { failed++; console.error('  FAIL', n); } };

console.log('UGS OBJP-1.1 · T1 librería de objetos + T2 Reactor\n');

// ============ T1 — catálogo ==================================================
{
  const cat = OL.CATALOG;
  check('el catálogo trae 8-12 defs (hay ' + cat.length + ')', cat.length >= 8 && cat.length <= 13);
  const ids = cat.map(d => d.id);
  check('ids únicos', new Set(ids).size === ids.length);
  check('todas las defs traen el esquema completo',
    cat.every(d => d.id && d.name && d.footprint && typeof d.h === 'number' &&
      d.colors && d.colors.top && d.colors.side && typeof d.solid === 'boolean' && d.cat === 'decor'));
  check('alturas positivas y razonables', cat.every(d => d.h > 0 && d.h <= 3));
  check('paletas en formato hex', cat.every(d => /^#[0-9a-f]{6}$/i.test(d.colors.top) && /^#[0-9a-f]{6}$/i.test(d.colors.side)));
  check('toda def declara colorKey para el mapeo del Rector', cat.every(d => typeof d.colorKey === 'string' && d.colorKey));

  // ORDEN EXPRESA DE -XONO: la consola es herramienta dedicada (tecla 7) y no
  // se mezcla con el atrezo. Si alguien la mete aquí, esto para la entrega.
  check('la CONSOLA no está en el catálogo genérico', OL.byId('console') === null);
  check('la consola tampoco aparece en el sub-selector', OL.options().every(o => o.id !== 'console'));
  check('door y elevator tampoco (son funcionales, no atrezo)', !OL.byId('door') && !OL.byId('elevator'));

  check('byId resuelve una def conocida', OL.byId('bed') && OL.byId('bed').name === 'Cama');
  check('byId devuelve null si no existe', OL.byId('nope') === null);
  check('options() da {id,name} para el selector',
    OL.options().length === cat.length && OL.options().every(o => o.id && o.name));

  // la colocación multi-tile NO está implementada: ninguna def puede mentir
  check('ninguna def declara footprint que la suite no sepa colocar',
    cat.every(d => d.footprint.w === 1 && d.footprint.h === 1));
}

// ============ T1 — solid y contrato C2 =======================================
{
  const room = D.createRoom('T1', 6, 6);
  BP.paintFloorRect(room, 0, 0, 5, 5, 'deck');

  const solidDef = OL.CATALOG.find(d => d.solid);
  const freeDef = OL.CATALOG.find(d => !d.solid);
  check('el catálogo tiene objetos sólidos y no sólidos', !!solidDef && !!freeDef);

  const o1 = D.createObjectInstance(solidDef.id, 1, 1);
  const o2 = D.createObjectInstance(freeDef.id, 2, 2);
  check('un objeto sólido de la librería nace sólido', o1.solid === true);
  check('un objeto no sólido nace no sólido', o2.solid === false);

  room.objects.push(o1, o2);
  check('C2: el sólido bloquea su tile', NAV.walkable(room, 1, 1) === false);
  check('C2: el no sólido deja pasar', NAV.walkable(room, 2, 2) === true);

  // 'plant' es def BASE de data.js: la librería no puede pisarla
  check('la librería no pisa las defs base (plant sigue no sólido)',
    D.createObjectInstance('plant', 0, 0).solid === false);

  // REGRESIÓN: normalizeRoom reconstruye los objetos desde su `type`. Sin el
  // registro de defs extra, al recargar un save todo volvería sólido.
  const st = D.createStation('T1');
  st.nexos[0].rooms[0] = room;
  const back = D.normalizeStation(JSON.parse(JSON.stringify(st)));
  const r2 = back.nexos[0].rooms[0];
  const b1 = r2.objects.find(o => o.type === solidDef.id);
  const b2 = r2.objects.find(o => o.type === freeDef.id);
  check('tras round-trip del save, el sólido sigue sólido', b1 && b1.solid === true);
  check('tras round-trip del save, el no sólido NO se vuelve sólido', b2 && b2.solid === false);
  check('tras round-trip, la colisión se mantiene', NAV.walkable(r2, 2, 2) === true && NAV.walkable(r2, 1, 1) === false);
}

/* ============ REACTOR = OBJETO, no sala =====================================
 * -XONO, 2026-07-28: «el reactor debe ser un objeto no una sala como tal».
 * Ya no existe plantilla de módulo-Reactor: el núcleo se coloca con la
 * herramienta Objeto y es ÉL quien aporta los TW al módulo que lo contiene.
 */
{
  check('YA NO existe la plantilla de módulo-Reactor',
    typeof BP.createReactorBlueprint === 'undefined');
  check('el núcleo existe en el catálogo T1', !!OL.byId('reactor_core'));
  check('el núcleo declara los 100 TW', OL.byId('reactor_core').provides.energy === 100);
  check('el núcleo es sólido (ocupa su tile)', OL.byId('reactor_core').solid === true);
  check('data.js resuelve los TW del núcleo por tipo', D.objectEnergy('reactor_core') === 100);
  check('un objeto normal no aporta TW', D.objectEnergy('bed') === 0);
  check('un tipo desconocido no aporta TW', D.objectEnergy('no_existe') === 0);

  // un módulo cualquiera se vuelve generador al meterle un núcleo
  const bp = D.createModuleBlueprint({ name: 'Sala técnica', w: 8, h: 6 });
  check('sin núcleos el módulo no genera', BP.energyFromObjects(bp.room) === 0);
  check('sin núcleos toModuleDef da 0 TW', BP.toModuleDef(bp).provides.energy === 0);
  bp.room.objects.push(D.createObjectInstance('reactor_core', 3, 3));
  check('con un núcleo el módulo genera 100 TW', BP.energyFromObjects(bp.room) === 100);
  check('toModuleDef lleva los TW del objeto a la capa estratégica',
    BP.toModuleDef(bp).provides.energy === 100);
  bp.room.objects.push(D.createObjectInstance('reactor_core', 5, 3));
  check('dos núcleos suman 200 TW', BP.toModuleDef(bp).provides.energy === 200);
  // los TW declarados a mano y los de los objetos SUMAN
  bp.provides.energy = 50;
  check('los TW del formulario y los de los núcleos se suman',
    BP.toModuleDef(bp).provides.energy === 250);
  // borrar el núcleo quita los TW: el módulo deja de ser generador
  bp.room.objects = [];
  bp.provides.energy = 0;
  check('sin núcleos el módulo deja de generar', BP.toModuleDef(bp).provides.energy === 0);
  check('energyFromObjects tolera una sala vacía o inválida',
    BP.energyFromObjects(null) === 0 && BP.energyFromObjects({}) === 0);
}

// ============ T2 — minSize (mecanismo genérico por blueprint) ================
{
  const bp = D.createModuleBlueprint({ name: 'Con mínimo', w: 6, h: 6, minSize: { w: 5, h: 5 } });
  // la suite RECHAZA por debajo del mínimo, no recorta en silencio
  const bad = BP.resizeBlueprint(bp, 4, 4);
  check('rechaza 4×4', bad.ok === false && /5×5/.test(bad.reason));
  check('tras el rechazo la sala NO cambió', bp.room.size.w === 6 && bp.room.size.h === 6);
  check('rechaza también 5×4 (mínimo en ambos ejes)', BP.resizeBlueprint(bp, 5, 4).ok === false);
  check('acepta exactamente 5×5', BP.resizeBlueprint(bp, 5, 5).ok === true && bp.room.size.w === 5);
  const ok9 = BP.resizeBlueprint(bp, 9, 7);
  check('acepta tamaños mayores', ok9.ok === true && bp.room.size.w === 9 && bp.room.size.h === 7);

  const plain = D.createModuleBlueprint({ name: 'Normal', w: 8, h: 6 });
  check('un módulo normal tiene mínimo 1×1', BP.minSizeOf(plain).w === 1);
  check('un módulo normal sí admite 2×2', BP.resizeBlueprint(plain, 2, 2).ok === true);
  check('minSizeOf tolera un blueprint sin campo', BP.minSizeOf({}).w === 1);
}

// ============ T2 — los metadatos viajan en el save ===========================
{
  const st = D.createStation('T2');
  const bp = D.createModuleBlueprint({ name: 'Generador', w: 6, h: 6, minSize: { w: 5, h: 5 } });
  bp.room.objects.push(D.createObjectInstance('reactor_core', 3, 3));
  st.moduleLibrary.push(bp);
  const back = S.deserialize(S.serialize(st));
  const r = back.moduleLibrary.find(b => b.name === 'Generador');
  check('el módulo sobrevive al export/import', !!r);
  check('minSize viaja en el save (la restricción no se pierde)', r.minSize.w === 5 && r.minSize.h === 5);
  check('el núcleo viaja en el save', r.room.objects.some(o => o.type === 'reactor_core'));
  check('tras reimportar sigue rechazando 4×4', BP.resizeBlueprint(r, 4, 4).ok === false);
  // los TW NO viajan en el save: los aporta el catálogo por tipo de objeto,
  // así que reequilibrar el reactor no obliga a migrar saves viejos
  check('tras reimportar el núcleo sigue aportando sus TW',
    BP.toModuleDef(r).provides.energy === 100);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
