# KIMI_FIXES_SUITE_DEV.md — Orden de trabajo para Kimi (K3 / Kimi CLI)

> **Documento exclusivo del agente Kimi.** Plan de arreglos de la Suite Dev.
> **ESTADO: PLAN — NO EJECUTADO.** Esperando orden explícita del organizador (-XONO).
> Fuente: 4 reportes del organizador (2026-07-25) + `test.json` (save real) + capturas image(12/13/14).
> Repo: `pickatroll12-arch/UGS`, rama `main`. Base verificada: 148 checks verdes, head `8d76fca`.
> Gobernanza: al ejecutar, cerrar con handoff **§6.8** en `AGENTIC_REVIEW.md` y actualizar `README.md`.
> **PROHIBIDO tocar contenido OBJP-1.1** (sigue congelado hasta 3 firmas). Estos arreglos son suite/motor, no contenido F1.

---

## Diagnóstico confirmado (evidencia, no hipótesis)

Del `test.json` del usuario: biblioteca con 2 módulos — `HANGAR` (industria, 40×10, **0 paredes**,
260 tiles de suelo) y `dssgffgdasMódulo 2` (general, 8×6, anillo de paredes). Nexo 1 con 4 salas:
hub `Room 1` (12×9 en 0,0, con anillo de paredes), dos HANGAR colocados en (-14,9) y (-16,19),
un `dssgffgdasMódulo 2` en (-8,1). Colocaciones válidas según `placementCheck` (arista compartida).

- **Bug 1 (PCJ no avanza):** image(12) muestra al PCJ pegado a la pared del hub con el suelo del
  módulo al otro lado. Tres causas encadenadas, todas confirmadas en código:
  1. La arista compartida queda **tapiada**: el hub conserva su anillo de paredes (C1: toda pared
     bloquea su tile). Aunque el HANGAR no tiene paredes, la pared del hub basta para bloquear.
  2. `nav.js` solo tiene `findPath(room, …)` **mono-sala** (coords locales); no existe ruta entre salas.
  3. `gameClick` (app.js) rechaza clics fuera de la sala del peón (resuelve contra SU sala; fuera de
     rango → return silencioso).
- **Bug 2 (borrar módulo no lo retira del nexo):** `bpDel` (app.js) solo filtra `moduleLibrary`;
  las salas ya colocadas con ese `bpId` permanecen en `nexo.rooms` (en test.json hay 3 instancias colocadas).
- **Bug 3 (import/export desaparecen con biblioteca vacía):** `index.html` líneas 147-151 — el bloque
  "BIBLIOTECA (ARCHIVO)" con `bpExport`/`bpImport` vive **dentro de `#bpForm`**, y `refreshBpList()`
  oculta `#bpForm` cuando no hay módulo activo. Con biblioteca vacía no se puede importar (callejón sin salida).
  Confirmado en image(14). `bpFileInput` (línea 170) ya está fuera: correcto.
- **Bug 4 (export por biblioteca obliga a rotar el archivo):** `bpExport` descarga un único
  `ugs_modulos.json` con TODA la biblioteca. Los 3 humanos no pueden trabajar en paralelo.
  El import ya acepta objeto suelto | array | `{moduleLibrary}` (app.js, handler de `bpFileInput`).

---

## ARREGLO 1 — PCJ puede caminar del Nexo al módulo (bug 1)

Diseño: abrir paso al colocar + navegación a nivel de Nexo (grid mundial unificada).

### 1A. `src/engine/blueprint.js` — nueva op `openSharedEdge(nexo, room, touch)`
- Recibe el `touch` devuelto por `placementCheck` (`{roomId, edge}` con intervalo `x0..x1` o `y0..y1`).
- Para cada tile del intervalo, en AMBAS salas (la colocada y la sala del nexo tocada):
  si hay pared → quitarla (`wall = null`); si el suelo quedó `void` → poner `floor = 'deck'`.
- Devuelve cuántas paredes se quitaron (para status). Sin paredes → no-op (0).
- Exportarla en el API del módulo.

### 1B. `src/app/app.js` — llamarla al colocar
En el handler de colocación (`handleClick`, rama `app.placing`), tras `nexo().rooms.push(room)`:
`const opened = BP.openSharedEdge(nexo(), room, chk.touch);` y mencionar en el status si se abrió paso.
También aplicar el mismo criterio al **retirar** (click derecho): NO se restauran paredes
(limitación conocida — el hueco se repinta con la herramienta Pared; documentarlo en §6.8).

### 1C. `src/engine/nav.js` — navegación multi-sala `findPathNexo(nexo, sx, sy, tx, ty)` (coords MUNDO)
- Construir mapa de walkability mundial por llamada: para cada sala del nexo, para cada tile:
  clave `wx,wy = transform + local`; walkable = existe tile && `floor !== 'void'` && `!wall` && sin objeto bloqueante.
  Guardar también `roomId` por clave (para re-resolver sala por paso).
- A* 4-dir sobre ese mapa (reusar la misma lógica de `findPath`, generalizada a claves mundo).
- Devolver ruta como lista de pasos **`{roomId, x, y}` en coords LOCALES de la sala de cada paso**
  (así el bucle de movimiento de agents apenas cambia).
- Guard: si alguna sala tiene `transform.rotation !== 0`, fallback a comportamiento mono-sala
  (la rotación existe en el modelo pero no se usa hoy; documentar).
- Mantener `findPath(room, …)` intacto (lo usan tests y lógica actual).

### 1D. `src/engine/agents.js` — `order()` multi-sala
- Si `room === pawn.roomId` (o la sala resuelta es la del peón) → comportamiento actual.
- Si es OTRA sala del mismo nexo: convertir posición del peón a mundo (su sala + local), llamar
  `findPathNexo`, y al caminar **actualizar `pawn.roomId` en cada paso** a la sala del paso actual
  (necesario para eventos de sala del engine y para el fade de oclusión del render).
- Verificar cómo dibuja el render a los peones (`roomId` + local): al actualizar `roomId` por paso
  el dibujo sigue correcto; confirmarlo en el smoke con captura a mitad de cruce.

### 1E. `src/app/app.js` — `gameClick` acepta cualquier sala del nexo
- Eliminar la restricción "solo la sala del peón": resolver `hit.roomId` directamente y pasar esa
  sala + coords a `agents.order`. Mantener el rechazo si el tile no es alcanzable ("Sin ruta hasta ahí.").

**Tests (tests/engine.test.js o nuevo bloque):**
- `openSharedEdge`: quita paredes en ambos lados del intervalo; pone suelo si queda void; no-op sin paredes.
- `findPathNexo`: ruta cruza hub→módulo por la abertura; sin abertura devuelve null; rechaza destino void/pared.
- `agents.order` multi-sala: el peón llega y termina con `roomId` = sala del módulo.

---

## ARREGLO 2 — Borrar módulo retira sus instancias colocadas (bug 2)

`src/app/app.js`, handler `bpDel`: además de filtrar la biblioteca, recorrer TODOS los nexos y
eliminar las salas con ese `bpId` (`n.rooms = n.rooms.filter(r => r.bpId !== bp.id)`), contándolas.
Status: `'Módulo eliminado (biblioteca + N instancia(s) retiradas del nexo).'`
Si el peón estuviera dentro de una sala retirada (caso raro: borrar en dev estando colocado),
no aplica: el borrado es solo en modo dev y el peón solo existe en juego. Sin riesgo.

---

## ARREGLO 3 — Import/export siempre visibles (bug 3)

`index.html`: mover el bloque `<h3>BIBLIOTECA (ARCHIVO)</h3>` + la fila `bpExport`/`bpImport`
**fuera de `#bpForm`** (queda dentro de `#secModules`, tras el cierre de `bpForm`).
`#bpForm` sigue ocultándose sin módulo activo; el archivo de biblioteca queda siempre operativo.
Sin cambios en app.js para este punto (los `bind` son por id y no cambian).

---

## ARREGLO 4 — Export individual por módulo + import múltiple (bug 4)

- **Export individual:** botón nuevo `⇩ Exportar módulo` DENTRO de `#bpForm` (junto a Duplicar/Eliminar).
  Descarga `ugs_modulo_<slug>.json` con el blueprint suelto (formato ya aceptado por el import).
  `slug = name.toLowerCase().replace(/[^a-z0-9]+/g,'-') || bp.id`. Reusar `downloadJson()`.
- **Import múltiple:** `bpFileInput` gana atributo `multiple`. El handler itera `e.target.files`,
  parsea cada archivo (objeto suelto | array | `{moduleLibrary}`), normaliza con
  `D.normalizeModuleBlueprint`, regenera id en colisión (lógica ya existente) y suma al contador.
  Status: `'Biblioteca importada: +N módulo(s) desde M archivo(s).'`
- **Extraíble a lógica (Node-testeable):** helper puro en `src/core/data.js`:
  `normalizeModuleLibraryInput(raw, existingIds)` → `{added: [bp…], count}` — unit-testeable;
  app.js solo hace el I/O de archivos.
- **Renombrar botones para claridad:** el de biblioteca pasa a `Exportar biblioteca` (mismo id `bpExport`).
- Flujo resultante para los 3 humanos: cada uno diseña y exporta SUS módulos como archivos sueltos;
  cualquiera importa varios archivos a la vez para fusionar. La exportación de biblioteca completa
  se conserva como backup.

**Tests (tests/core.test.js o blueprint.test.js):**
- `normalizeModuleLibraryInput` con objeto suelto, array, `{moduleLibrary}`; colisión de ids → ids nuevos;
  entrada inválida → error controlado.

---

## Plan de verificación (obligatorio antes de declarar entrega)

1. `node tests/run.js` → 148 + nuevos checks, ALL SUITES GREEN.
2. Smoke nuevo `.smoke_fixes.mjs` (playwright-core + chromium, NO se sube al repo):
   - colocar módulo junto al hub → entrar a Juego → clic dentro del módulo → **el peón cruza y llega**
     (assert `pawn.roomId` = sala del módulo) → cero errores de consola;
   - borrar el módulo de la biblioteca → las instancias colocadas desaparecen del estado;
   - biblioteca vacía → botones Importar/Exportar biblioteca visibles;
   - export individual → evento de descarga con nombre `ugs_modulo_*.json`;
   - import con 2 archivos → +2 módulos.
3. Capturas: cruce del peón a mitad de la abertura; panel con biblioteca vacía mostrando import/export.
4. Regresión: smoke existente (18/18 y 9/9) debe seguir verde.

## Plan de push (MCP `push_files`, límite ~30KB por respuesta)

1. Lógica: `src/engine/nav.js` + `src/engine/agents.js` + `src/engine/blueprint.js` + `src/core/data.js`.
2. Tests: `tests/engine.test.js` (+ el que toque).
3. `index.html` (solo).
4. `src/app/app.js` (**solo, respuesta sin texto extra**; verificar md5 tras el push — 36KB+Δ).
5. Docs: `README.md`, luego `AGENTIC_REVIEW.md` (§6.8, solo).
6. Verificación final: clon limpio → diff de los 8 archivos → `node tests/run.js` verde.

## Limitaciones conocidas que quedan (declarar en §6.8)

- Deshacer/rehacer NO cubre colocación/retirada de módulos ni la apertura de paso (opera por sala editada).
- Al retirar un módulo, la abertura hecha en la pared del hub permanece (se repinta con Pared).
- `findPathNexo` asume salas axis-aligned sin rotación (la rotación del modelo no se usa hoy).
- El mapeo categoría→icono sigue pendiente de aprobación humana (§6.7).

## Decisiones por defecto propuestas (cambiables por los humanos sin re-trabajo)

- La apertura se hace en **todo el intervalo de la arista compartida** (conexión abierta tipo Xenonauts),
  no una puerta de 1 tile. Si prefieren puerta centrada: acotar el intervalo en `openSharedEdge`.
- Nombre de archivo individual: `ugs_modulo_<slug>.json`.
