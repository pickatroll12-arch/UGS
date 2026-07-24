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

---

### §6.1 — CLAUDE (Constructor) — Fase 1 del reset: motor lógico reescrito — 2026-07-24
**Observación:** reescritos desde cero los tres [COMPONENTES LÓGICOS] que el reset eliminó,
construyendo SOBRE la infraestructura conservada (core/data/render/save/editor sin reescribir):
- `src/nav.js` — pathfinding **click→ruta** (A* 8-direcciones, sin corner-cutting). Respeta el
  contrato de colisión validado: **toda pared 'full' bloquea su tile completo** (el peón nunca la
  atraviesa — el bug que hundió la versión anterior). `buildWalkGrid` / `crossBlocked` / `findPath`.
- `src/engine.js` — **lógica pre-cargada por Nexo (nivel)**: ejecuta de forma determinista el
  movimiento declarado por cada sala en datos (shift/rotate/orbit/carousel) y las transiciones de
  fase. **NADA de life-sim en tiempo real ni simulación global de agentes autónomos.** `stop()`
  restaura la pose autorada (el juego no ensucia el mapa guardado). Lógica pura: **no importa el
  render** (la matemática de rotación vive en core).
- `src/agents.js` — **un solo PCJ** controlable por click. Sin PNJ (eso es OBJP-2). Se mueve sólo
  cuando el jugador ordena una ruta; avanza en el 'tick' determinista del engine; emite
  `pawn:arrived` (de ahí cuelga el ascensor entre fases). El pawn expone exactamente la forma que
  lee `render.drawAgents`.
- Reinsertados los `<script>` en `index.html` (orden por dependencias: nav → engine → agents → editor).
**Evidencia:**
- `npm test` → **169 passed, 0 failed** (7 suites): 114 de infra + **55 nuevos**
  (nav 20 · engine 23 · agents 12).
- `npm run smoke` → **48 passed, 0 failed** (Chromium headless sobre el `index.html` real):
  arranque/menú, click→ruta del PCJ con llegada, transición de fase por ascensor con la animación
  intacta a ambos lados, pausa/velocidad, **colisión de tile completo**, **cámara cenital top-down**
  (celdas cuadradas, sin inclinación diagonal), y **sin vocabulario dev en modo Juego** — los tres
  puntos del feedback humano que motivaron el reset quedan cubiertos por asserts. 0 errores de consola.
**Riesgo / qué NO probé:**
- El engine reconstruye el movimiento de salas (orbit/carousel/shift/rotate) porque el editor
  conservado lo AUTORA y el render lo dibuja; lo mantuve para no romper la app. Si ustedes deciden
  que ese movimiento cuenta como "life-sim" a descartar, es decisión humana (yo no lo elimino sin
  aprobación). Es determinista y no continúa tras `stop()`.
- **NO** implementé la rotación de cámara (ver decisión pendiente abajo): es trabajo de render/editor,
  no del núcleo lógico de esta Fase 1.
- No hay playtest humano, ni prueba en hardware modesto, ni input táctil. El verde es requisito, no
  prueba suficiente.
**Recomendación:** que Kimi K3 revise y emita veredicto. Si APROBADO + validación humana, propongo
como SIGUIENTE slice (dentro de OBJP-1, no ahora) la **cámara cenital + rotación por inclinación
sobre el eje horizontal** que los humanos ya resolvieron (ver decisión). Sigo enfocado sólo en OBJP-1.
**Archivos afectados:** `src/nav.js`, `src/engine.js`, `src/agents.js` (nuevos),
`src/nav.test.js`, `src/engine.test.js`, `src/agents.test.js` (nuevos),
`index.html` (script tags), `tests/smoke/smoke.mjs` (cobertura del núcleo lógico + framing post-reset).
**Pruebas necesarias (humano · -FROMO / -BX):**
- [ ] Nueva estación → modo Juego: clic en un tile libre → el MONO camina por la ruta y se detiene.
- [ ] Clic contra/detrás de una pared: el MONO NO la atraviesa (rodea o no se mueve).
- [ ] Importar una estación con ascensor: caminar al ascensor cambia de fase y el peón reaparece.
- [ ] Cámara cenital plana (Q/E hasta top-down): mapa cuadrado, sin giro diagonal de 45°.
- [ ] Modo Juego: no aparece "simulando" ni chips de desarrollo.
**Decisión pendiente:** la (1) del §6.0 (cámara) fue **resuelta por los humanos**: *cenital + rotación
por inclinación sobre el eje horizontal* (imagen adjunta por -XONO). Queda pendiente confirmar por los
3 antes de que yo la implemente como próximo slice. La (2) (quién redacta el árbol de hitos) sigue abierta.
