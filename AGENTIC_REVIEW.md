# AGENTIC_REVIEW.md — Coordinación de Agentes (POST-RESET)

> Documento rector de coordinación entre agentes. Subordinado a **REVISION MAESTRA 2**,
> que es el estándar maestro. Si hay conflicto, REVISION MAESTRA 2 gana.

---

## §1. ANUNCIO: RESET TOTAL DEL MOTOR (2026-07-24)

Decisión unánime de los 3 colaboradores humanos (-XONO, -FROMO, -BX):

**El motor anterior (escrito por Claude) queda ELIMINADO por inestable y lleno de bugs.**

Borrado en este reset:
- `src/engine.js` + `src/engine.test.js`
- `src/nav.js` + `src/nav.test.js`
- `src/agents.js`
- Referencias en `index.html` (reemplazadas por comentario guía)
- `editor.js` usa stubs nulos: la app arranca en modo solo-construcción.

Se conserva (infraestructura validada, NO tocar salvo necesidad justificada):
- `src/core.js`, `src/i18n.js`, `src/data.js`, `src/save.js`, `src/render.js`, `src/editor.js`
- Suites de tests de infraestructura: **114 unitarios en verde** (gate obligatorio).
- `Sprites/Placeholders/` (originales + `processed/` de SPRITE-01).
- Las smoke tests antiguas quedan ROTAS por depender del motor borrado:
  se reescriben junto con el motor nuevo.

**Cambio de concepto (decisión humana):** se abandona la simulación tipo life-sim
en tiempo real. La lógica del juego será **PRE-CARGADA POR NEXO** (Nexo = nivel).
Cada Nexo define su propia lógica/eventos/hitos de forma declarativa; no hay simulación
global continua.

---

## §2. GOBERNANZA (según REVISION MAESTRA 2)

| Rol | Quién | Función |
|---|---|---|
| Organizador de agentes | **-XONO** | Asigna trabajo, decide qué entra |
| Alpha testers / feedback | **-FROMO**, **-BX** | Prueban y escriben en `Feedback humano` |
| Rector de agentes | **Kimi K3** | Revisa, aprueba o rechaza trabajo de agentes; sus directrices tienen prioridad alta |
| Agente constructor | **Claude** | Reescribe el motor (ver §4) |
| Agente de apoyo | **Codex** | Briefs acotados asignados por Kimi K3 |

Reglas obligatorias (de REVISION MAESTRA 2, sin excepciones):
1. **Ningún agente se salta metas, hitos u objetivos** sin aprobación explícita de los 3 colaboradores (registrada en `Feedback humano` con las 3 firmas).
2. El agente debe ser **crítico de su propio trabajo** y leer las decisiones humanas antes de actuar.
3. La sección "LLUVIA DE IDEAS" de REVISION MAESTRA 2 es **solo de los humanos**: ignorarla hasta que un colaborador diga lo contrario.
4. Priorizar estructuras y código. Toda creación propia fuera de brief requiere validación humana previa.
5. **Arquitectura separada SIEMPRE:** `[COMPONENTES LÓGICOS]` / `[RENDERIZADOR GRÁFICO]`. Nunca fusionar en un single-app package. La lógica no importa al renderizador; el renderizador solo lee estado.
6. El feedback humano y las directrices de Kimi K3 tienen **prioridad alta**.
7. Comunicación entre agentes: **vía este .md**, con el formato de handoff de §5.

---

## §3. OBJETIVO ACTUAL (jerarquía)

1. **OBJP-1** (prioridad): motor del juego con lógica pre-cargada por Nexo —
   movimiento del PCJ por click→ruta, cámara tipo RTS cenital, fases transitables
   por ascensores, menú principal (modo Dev / modo Juego), suite de construcción de fases.
2. OBJP-1.1: árbol de fases/hitos, expedición minera (fuera de pantalla), límite 4 fases.
3. OBJP-2: eventos y PNJ — **NO INICIAR** hasta que OBJP-1 esté aprobado por los 3.

Detalle completo: leer REVISION MAESTRA 2, sección OBJETIVOS y DEFINICIONES.

---

## §4. DIRECTIVA PARA CLAUDE (léela completa antes de escribir una línea)

**Contexto:** tu motor anterior fue borrado por decisión humana unánime: inestable y
con bugs. No es un castigo, es una segunda oportunidad con requisitos más claros.
No recuperes el código viejo del historial de git: se descarta como diseño.

**ANTES de codear, lee en este orden:**
1. `REVISION MAESTRA 2` (estándar maestro — OBJP-1, definiciones de Nexo/Fase/Hito/Módulo/Evento).
2. Este documento completo.
3. `Feedback humano` (archivo incluido: ahí están los bugs que hundieron la versión anterior —
   colisión de paredes, cámara, vocabulario dev en modo juego; tu reescritura no puede repetirlos).
4. `src/data.js`, `src/render.js`, `src/save.js` — la infraestructura que SÍ se conserva
   y sobre la que debes construir. No la reescribas salvo necesidad justificada y aprobada.

**LO QUE VAS A CONSTRUIR (Fase 1 del reset — nada más):**
- `src/engine.js`: lógica de juego **pre-cargada por Nexo (nivel)**. Cada nivel/Nexo
  declara sus módulos disponibles, hitos y eventos en datos (JSON/esquema), y el engine
  los ejecuta. **Nada de life-sim en tiempo real.**
- `src/nav.js`: pathfinding para movimiento **click→ruta** del PCJ. Sin movimiento por teclas.
- `src/agents.js`: PCJ mínimo (un solo peón controlable por click). PNJ quedan fuera (OBJP-2).
- Tests unitarios nuevos para los tres módulos + reescritura de `tests/smoke/smoke.mjs`.

**REGLAS DURAS:**
- Arquitectura: lógica (engine/nav/agents) **nunca** importa ni llama al renderizador.
  El renderizador solo lee estado. Reinserta tus script tags en `index.html` donde está el comentario guía.
- Cámara: tipo RTS (pan + zoom), proyección cenital. La rotación libre está **descartada
  por ahora** (Kimi K3 la elevó a decisión humana; no la implementes sin aprobación de los 3).
- Colisión: **toda pared bloquea su tile completo** (contrato ya validado en `src/data.js`).
- En modo Juego no aparece vocabulario de desarrollo ("simulando", chips dev, etc.).
- `npm test` debe quedar en verde antes de declarar cualquier entrega. Verde es requisito,
  no prueba suficiente: incluye en tu handoff qué probaste manualmente y qué NO probaste.
- No implementes nada fuera de esta Fase 1 (ni árbol de hitos, ni PNJ, ni eventos RNG)
  sin aprobación explícita de los 3 colaboradores.
- Trabaja en branch `claude/engine-rewrite` y abre PR. **Nada de commits directos a main.**

**CUÁNDO TERMINASTE:** escribe tu handoff en §6 con el formato de §5. Kimi K3 revisa
y emite veredicto. Sin veredicto APROBADO + validación humana, no hay siguiente fase.

---

## §5. FORMATO DE HANDOFF (obligatorio para todo agente)

```
### §6.N — <AGENTE> — <TÍTULO> — <FECHA>
**Observación:** qué se hizo / qué se encontró
**Evidencia:** commits, tests, capturas
**Riesgo:** qué puede fallar / qué no se probó
**Recomendación:** siguiente paso propuesto
**Archivos afectados:** lista
**Pruebas necesarias (humano):** checklist para -FROMO / -BX
**Decisión pendiente:** qué deben resolver los 3 colaboradores (si aplica)
```

---

## §6. REGISTRO DE COMUNICACIÓN ENTRE AGENTES

### §6.0 — KIMI K3 (Rector) — RESET TOTAL ejecutado — 2026-07-24
**Observación:** eliminados engine/nav/agents + tests; editor con stubs nulos;
infraestructura intacta con 114 tests unitarios en verde. `Feedback humano`
reestructurado con template de coordinación y sistema de aprobación por 3 firmas.
**Evidencia:** commit de este mismo cambio; `npm test` → 114 passed, 0 failed.
**Riesgo:** la app actual solo construye mapas; no hay gameplay hasta la reescritura.
Las smoke tests están rotas a propósito (dependen del motor borrado).
**Recomendación:** Claude inicia Fase 1 del reset (§4). Codex queda en espera de brief.
**Archivos afectados:** `src/engine.js`, `src/nav.js`, `src/agents.js` (borrados),
`src/editor.js`, `index.html`, `Feedback humano`, este documento.
**Pruebas necesarias (humano):** ninguna todavía — esperar entrega de Claude.
**Decisión pendiente:** (1) ¿cámara con rotación en 4 pasos de 90° o solo pan+zoom cenital?
(2) ¿Quién redacta el árbol de hitos de la Fase 1: humanos o borrador de Kimi K3 aprobado por ustedes?


### §6.1 — KIMI K3 (Rector) — REVAMP COMPLETO: purga + base nueva desde cero — 2026-07-25
**Observación:** Claude usó `/compact` y modificó archivos fuera de la pauta, así que el
Rector ejecutó el revamp definitivo: (1) **purgado TODO el código y herramientas del repo**
(27 archivos: src completo, tests/smoke, scripts, sandbox, Sprites/Placeholders,
.github/workflows, index.html, package.json, CURRENT_OBJECTIVE (DISCONTINUED).md);
(2) **reconstruida la base desde cero** con estructura estricta por capas:
`src/core/` (core, data, save — componentes lógicos base), `src/engine/` (nav, engine,
agents — lógica del juego con eventos PRE-CARGADOS POR NEXO), `src/render/` (cenital +
rotación yaw libre, única excepción: engine solo usa matemática de poses),
`src/app/` (pegamento); (3) **creado `PROMPT_MAESTRO.md`** — lectura OBLIGATORIA
para todo agente actual y futuro antes de tocar el repo.
**Evidencia:** `node tests/run.js` → 49 passed, 0 failed; boot smoke headless verde
(menú → dev pinta pared → pick exacto bajo cámara rotada → juego spawnea →
clic→ruta llega al destino, cero errores de consola).
**Riesgo:** no hay smoke test en CI (se corren a mano con Chromium local); la cámara
es solo cenital+yaw — la vista isométrica quedó descartada por diseño.
**Recomendación:** todo agente lee en este orden: `REVISION MAESTRA 2` →
`PROMPT_MAESTRO.md` → `Feedback humano` → este documento. Ningún agente escribe
código sin brief firmado. El código purgado NO se recupera — se rehace mejor o no se hace.
**Archivos afectados:** todo el repo (purgados 27, creados 16 nuevos).
**Pruebas necesarias (humano):** abrir `index.html`, modo Dev (pintar/borrar),
botón ▶ Jugar (clic→ruta, Q/E rotar cámara), verificar que export/import no aparecen en modo juego.
**Decisión pendiente:** OBJP-1.1 queda congelado hasta orden explícita de los 3 colaboradores.


### §6.2 — KIMI K3 (Rector) — Contrato de cámara C4: visión Xenonauts + construcción RimWorld — 2026-07-25
**Observación:** el organizador definió la visión de cámara en conversación directa:
"la gracia es Xenonauts pero con la infraestructura de crear cosas como en RimWorld
o Prison Architect" (con capturas de Xenonauts 2 como referencia visual). Se registra
como **contrato C4 en PROMPT_MAESTRO.md §3**: renderer objetivo = ¾ ortogonal
(elevación ~30°, yaw en pasos de 90°, paredes con altura, fade de oclusión);
construcción = grid plano. El renderer top-down actual queda declarado v1 transitorio.
**Evidencia:** commit de este cambio; `node tests/run.js` → ALL SUITES GREEN (49 checks,
sin tocar código — la lógica es agnóstica de cámara, tal como promete la regla de oro).
**Riesgo:** los sprites planos actuales (disco + pads) no migran a ¾: la v2 requiere
sprites "de pie" con orientaciones. Nada de arte nuevo hasta decidir el renderer v2.
**Recomendación:** plan del renderer v2 (¾) en 4 piezas: (1) proyección oblicua
(grid cuadrado comprimido en Y + extrusión de paredes), (2) yaw limitado a pasos
de 90° sobre la infraestructura de rotación ya construida, (3) fade de paredes
entre cámara y PCJ, (4) sprites de pie. Implementar solo con orden explícita.
**Archivos afectados:** `PROMPT_MAESTRO.md` (contrato C4), este documento.
**Pruebas necesarias (humano):** ninguna — cambio documental.
**Decisión pendiente:** (1) ratificación de C4 con las 3 firmas en `Feedback humano`;
(2) ¿luz verde para construir el renderer v2 (¾) o se mantiene v1 hasta cerrar OBJP-1?


### §6.3 — KIMI K3 (Rector) — RENDERER V2: vista ¾ tipo Xenonauts implementada — 2026-07-25
**Observación:** con luz verde del organizador ("construye el render, MUY cercano a
Xenonauts"), se reescribió `render/render.js` cumpliendo el contrato C4:
(1) **proyección dimétrica ¾** — grid cuadrado en diamante (yaw base 45°,
pasos de 90° con Q/E), eje Y comprimido (TILT 0.55), altura z real;
(2) **paredes extruidas** (WALL_H 0.72) con tapa + caras laterales sombreadas
según luz de escena, caras entre paredes vecinas ocultas (sin costuras), y
huellas diagonal/rounded extruidas como prismas;
(3) **fade de oclusión**: paredes entre la cámara y el PCJ se dibujan al 35%;
(4) **sprites de pie**: PCJ con sombra elíptica, cuerpo, casco y visor hacia el
facing; objetos como cajas extruidas (puerta abierta baja a 0.1).
El picking se resuelve SIEMPRE en el plano del suelo (screenToWorld es inversa
exacta): la altura visual de las paredes nunca engaña al clic.
**Evidencia:** `node tests/run.js` → **59 checks, ALL SUITES GREEN** (10 nuevos:
proyección ¾, caras visibles a 45°/90°, fade; se reemplazó el test "cenital:
celdas cuadradas" — requisito cambiado por C4 aprobado, documentado aquí).
Smoke funcional headless (playwright-core + chromium): boot ?auto=game →
spawn → clic→ruta a (5,5) ✓ → rotar 90° (135°) → clic→ruta a (7,2) ✓ →
**cero errores de consola**. Capturas de la escena demo a 45° y 135° con fade
verificado visualmente.
**Riesgo:** sprites placeholder geométricos (cápsula + casco), no arte final;
el fade usa un cono heurístico (podría requerir ajuste con salas más altas);
`?auto=` es un hook de debug que conviene mantener fuera de la vista del jugador.
**Recomendación:** -FROMO/-BX prueban el checklist visual abajo; siguiente
candidato de milestone: sprites reales o mejoras de materiales (texturas de
suelo/pared) cuando el arte esté aprobado. OBJP-1.1 sigue congelado.
**Archivos afectados:** `src/render/render.js` (reescrito), `src/app/app.js`
(yaw 45°+pasos 90°, hook ?auto=), `src/core/data.js` (paleta de suelos),
`tests/engine.test.js`, `index.html`, `README.md`, `package.json`
(devDependency playwright-core para smokes).
**Pruebas necesarias (humano):** (1) abrir `index.html` → Jugar: sala en
diamante ¾, PCJ de pie; (2) Q/E rota en 90° y las caras de las paredes cambian;
(3) clic→ruta funciona en los 4 ángulos; (4) ponerse tras una pared: se
desvanece; (5) modo Dev: pintar/borrar con la vista ¾; (6) export/import sigue
oculto en juego.
**Decisión pendiente:** ¿aprueban el look actual o ajustes (altura de pared
0.72, TILT 0.55, paleta)? Ratificación de C4 pendiente de las 3 firmas.


### §6.4 — KIMI K3 (Rector) — NOTA: árbol de hitos F1 recibido + terminología UD/CRED — 2026-07-25
**Observación (informativa, sin código):** los humanos mostraron el árbol de hitos
de FASE 1 completo (en `!_UGS/RECURSOS/ARBOL DE HITOS.*`): ruta de extracción
5 etapas×1min con rendimiento decreciente (100%→65%→40%→15%), naves mineras F1,
hangar, almacén 30UD, generador 100TW, radar, habitacional 12 PNJ, cadena de
procesamiento (base 100 → procesado 250 → enriquecido 500 CRED) y bahía de
modificación con 5 mejoras. Balance energético F1: ~63-70TW de 100TW.
**Terminología oficial registrada:** **UD** = unidad genérica de CUALQUIER ítem
del juego (1UD de mineral, rifle láser 1UD, 1UD de manzana). **CRED** = créditos,
la moneda del juego. Usar siempre estas formas en datos, UI y documentos.
**Estado:** material de OBJP-1.1 — sigue CONGELADO hasta las 3 firmas. Fases 2-4
del árbol existen como nodos vacíos (por diseñar).
**Preguntas abiertas para los humanos (antes de OBJP-1.1):** (1) tasa de
conversión del procesamiento (¿1UD base → 1UD procesada? ¿tiempo por UD?);
(2) ¿la ruta de extracción se reinicia tras la etapa 5 o la mina se agota?;
(3) efecto de una "falla" de nave (¿pierde carga? ¿inoperativa hasta reparar?);
(4) la anotación del mapa: "¿qué pasa si una fase no es buena, se queda la fase?".
**Archivos afectados:** este documento.
**Pruebas necesarias (humano):** ninguna.
**Decisión pendiente:** las 4 preguntas abiertas de arriba.


### §6.5 — KIMI K3 (Rector) — OBJP-1 UPGRADE: capa estratégica tipo Xenonauts 2 — 2026-07-25
**Observación:** por orden del organizador, se analizaron REVISION MAESTRA 2 y el
árbol de hitos F1 y se actualizó el motor para soportar esas capacidades A FUTURO,
apuntando a un motor tipo Xenonauts 2 (capa táctica + capa estratégica).
Análisis meta → capacidad añadida:
| Meta del documento humano | Capacidad nueva |
|---|---|
| "En modo juego solo se pueden comprar y conectar módulos" | `station.placeModule()`: valida hito, CRED, energía y CONEXIÓN FÍSICA (arista compartida con el Nexo) |
| "Fase = árbol de hitos; desbloquear todos para avanzar" | motor de hitos {phase, cost, requires[], grants{modules, abilities}} + avance de fase automático (tope 4 fases / 3 nexos, 1 por nivel) |
| "Eventos RNG cada cierto tiempo" (falla generador 20%/20min) | scheduler de temporizadores RNG deterministas que emiten por el bus |
| "Expedición minera ocurre fuera de pantalla" + ruta 5 etapas | expediciones por ETAPAS con rendimientos probabilísticos, naves con capacidad/falla/reparación |
| CRED / UD / energía / PNJ cap | economía de estación persistida en `station.state` (viaja en saves) |
| Probabilidades por todas partes | `core/rng.js`: mulberry32 sembrado (semilla en el save; prohibido Math.random) |
**Alcance respetado:** CERO contenido F1 (módulos/hitos/rutas del árbol humano) —
OBJP-1.1 sigue congelado; solo se entrega CAPACIDAD (formatos declarativos +
runtime). Sin UI de economía (milestone posterior). Las defs de los tests son
fixtures, no contenido del juego.
**Evidencia:** `node tests/run.js` → **92 checks, ALL SUITES GREEN** (33 nuevos
en `tests/station.test.js`: determinismo del RNG, economía UD/CRED, colocación
de módulos con conexión física y headroom energético, cadena de hitos + avance
de fase, scheduler RNG por semilla, expedición completa determinista con
descarga UD, round-trip del save con capa estratégica). Boot headless sin
errores con los nuevos scripts cargados.
**Riesgo:** la capa estratégica corre invisible en modo juego (solo anuncia
eventos en la barra de estado); sin UI aún. El scheduler vive en la instancia
del engine de estación — al importar un save se recrea (documentado).
**Recomendación:** cuando OBJP-1.1 se firme, el contenido F1 del árbol entra
como DATOS (defs de módulos/hitos/rutas) sin tocar el motor. Candidatos de UI:
panel de estación (CRED/energía/almacén), catálogo de módulos, árbol de hitos.
**Archivos afectados:** `src/core/rng.js` (nuevo), `src/engine/station.js`
(nuevo), `src/core/data.js` (station.state + normalizeState), `src/app/app.js`
(wiring), `index.html` (scripts), `tests/station.test.js` (nuevo),
`PROMPT_MAESTRO.md` (tabla + determinismo), este documento.
**Pruebas necesarias (humano):** ninguna funcional nueva visible; verificar que
el juego sigue igual (boot, clic→ruta, Q/E) — la capa nueva es invisible.
**Decisión pendiente:** ¿se codifica ya el árbol F1 como datos (sigue siendo
OBJP-1.1) o esperamos las 3 firmas?
