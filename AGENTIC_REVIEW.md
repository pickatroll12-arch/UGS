# UGS — Agentic Review & Rector Notes

> Living review document. It records architectural observations, risks, and
> suggested implementation order for the next agentic development pass.
> Code and identifiers remain English; design discussion may remain Spanish.

Reviewed against `main` at commit `607e1ba` — M6 playable slice.

---

## 1. Working agreement

### Agent roster (updated)

| Agent | Role |
|---|---|
| **Claude** | Primary implementation agent. |
| **Kimi** | Secondary implementation lead (quota fallback) + Rector: reviews every merged pass, diagnoses bugs, writes revision docs. |
| **Codex** | Supporting implementation agent. Takes scoped task briefs (see §12). Same rules as everyone: architecture first, tests with each change, no unrequested refactors. |

Coordination rules:

- One agent works one brief at a time; do not touch files owned by another
  agent's in-flight brief without checking the revision docs first.
- `Feedback humano` is read-only for all agents (human channel).
- Revision docs (`SECOND_REVISION.md`, `THIRD_REVISION.md`, …) are the
  contract of what was changed and what must not regress — read them before
  modifying walls/collision, projections, or mode UI.
- `npm test` (164 checks) and `npm run smoke` (44 checks) must stay green.
  New behavior ships with its own regression test.

### Claude's turn

Claude remains the primary implementation agent. During Claude-led sessions,
this document should be treated as reviewer guidance, not as a request to stop
and refactor unrelated systems.

Claude should:

- Preserve the Stage 1 architecture.
- Work in small, testable milestones.
- Add or update tests with each model/system change.
- Keep simulation logic independent from rendering.
- Avoid premature graphics polish.
- Update this file when a listed issue is resolved or intentionally deferred.

### Secondary lead / quota fallback

When Claude is unavailable, the secondary agent may continue implementation,
but should follow the same structure and philosophy:

1. Room-local data with room-level transforms.
2. Deterministic fixed-timestep simulation.
3. EventBus and pluggable systems.
4. Versioned, normalized save data.
5. Renderer isolated from game logic.
6. Mechanics before visual polish.
7. No engine rewrite or port unless the project owner explicitly requests it.

### Rector role

The reviewer should analyze before implementation, especially for:

- Architectural drift
- Data-model churn
- Missing simulation boundaries
- Navigation and offscreen-simulation implications
- Test coverage gaps
- Documentation drift
- Performance traps
- Features that accidentally couple systems together

---

## 2. Current verdict

UGS is already a credible Stage 1 engine, not a disposable prototype.

The current HTML/Canvas approach is viable and should continue. Do **not**
restart in another engine at this stage. The existing boundaries make it
possible to replace or upgrade the renderer later without rewriting the data
model, pathfinding, simulation, or save format.

Stage 1 is complete and validated:

- Data model and save/load
- Isometric renderer
- Station Builder UI
- Multi-room maps
- Multi-deck links
- Movable rooms
- Deterministic simulation clock
- Basic pawn movement
- Playable slice with deck travel and moving-room riding

---

## 3. Validated strengths

These choices should be protected:

### 3.1 Room-local coordinates

Tiles, objects, and pawns are stored relative to their room. This lets a moving
room carry its contents without changing the contents themselves.

### 3.2 Simulation/render separation

`render.js` draws the current state but does not own game logic. This is the
most important long-term architectural decision in the repository.

### 3.3 Deterministic heavy core

`core.js` provides seeded RNG, EventBus, FixedTimestep, Grid2D, and Pool. These
are the right primitives for A-life, subsystems, reproducible saves, and tests.

### 3.4 Pluggable systems

`agents.js` is installed as an engine system rather than being hard-coded into
room motion. Future crew, subsystems, events, and AI should follow this pattern.

### 3.5 Versioned save normalization

`data.js` and `save.js` already coerce untrusted imported data into a clean
save. This will become increasingly important when users create custom maps.

### 3.6 Testable core modules

The main data/simulation modules run in Node. This should remain true even if
browser-only editor features grow.

---

## 4. Confirmed issues and documentation drift

### 4.1 Nav test count mismatch — ✅ RESOLVED (S1-R0)

`ROADMAP.md` referenced 14 nav tests; the suite reports 13. ROADMAP now reads
13, and lists the grand total (75) run via `npm test`.

### 4.2 README is still a placeholder — ✅ RESOLVED (S1-R0)

`README.md` now documents how to open the app, how to run the tests
(`npm test` + per-suite commands), the project structure, the architecture
rules, and links to `ROADMAP.md`, `AGENTIC_REVIEW.md`, and `CURRENT_OBJECTIVE.md`.

### 4.3 No package/test runner — ✅ RESOLVED (S1-R0)

Added `package.json` with `npm test` → `scripts/run-tests.js`, an aggregate
runner that auto-discovers every `src/*.test.js` suite (currently core, data,
engine, i18n, nav) and reports a grand total, exiting non-zero on any failure.
Added `.github/workflows/ci.yml` running `npm test` on push/PR (Node 22).

---

## 5. Architectural gaps to address before A-life

### 5.1 Pawns are movement agents only

The current pawn model supports movement, facing, and arrival events. It does
not yet model the future crew.

Missing concepts:

- Identity/name
- Role
- Skills
- Assignment
- Needs
- Schedule/routine
- Current job
- Job queue
- Memory/knowledge
- Relationships or reputation
- Inventory/equipment
- Health/consciousness

Action:

Design a `Pawn`/`CrewMember` data schema before implementing behavior. Keep it
serializable and deterministic. Renderer fields should remain separate from
simulation fields.

Priority: Stage 2 blocker.

### 5.2 Pathfinding is room-local only

`nav.js` works inside one room. The editor currently reports that a pawn cannot
path to another room except by using a link.

This is acceptable for Stage 1, but crew autonomy will need station-level
navigation.

Recommended direction:

```text
Local tile pathfinding
+ room-level connectivity graph
+ deck-level route planner
+ link/elevator traversal
```

The system should support:

- Multiple rooms in one deck
- Doors/airlocks
- Moving rooms invalidating or updating routes
- Elevators and stairs
- Cross-deck route planning
- Future background simulation

Priority: Stage 2 core dependency.

### 5.3 Only the active deck is simulated

The engine currently advances the active level. Inactive decks are not running
a background simulation.

The long-term A-life concept requires at least two modes:

```text
Active deck:
- full rendering
- detailed pawn positions
- high-frequency simulation

Inactive deck:
- no rendering
- low-frequency abstract ticks
- scheduled events
- summarized pawn/object state
```

Action:

Define the background-simulation state contract before adding autonomous NPCs.
Do not simply run every deck at full fidelity; that will scale poorly.

Priority: Stage 2/3 architecture dependency.

### 5.4 Preload/stream is currently semantic only

The `resident` set models preload/stream behavior, but every level is already
loaded inside the save. No asynchronous level streaming exists yet.

Action:

Keep the current semantics, but document them as an in-memory residency model.
Real streaming can wait until maps or assets are large enough to require it.

Priority: medium/low.

### 5.5 No general event/trigger system yet

Room-motion events exist, but there is no general event system for station
logic.

Future events will need:

- Triggers
- Conditions
- Actions
- Delays/schedules
- Sources and targets
- Cancellation
- Serialization
- Deterministic ordering

Action:

Do not overload `RoomEvent` into a universal event system. Design a separate
`StationEvent` or `Trigger` model that can reference rooms, objects, pawns,
links, resources, and flags.

Priority: Stage 3 blocker.

---

## 6. Geometry and interaction concerns

### 6.1 Diagonal walls are visual only

`diagA` and `diagB` render as diagonal wall shapes, but navigation treats the
whole tile as blocked.

This is acceptable while pathfinding remains tile-based, but it does not yet
meet the long-term goal of diagonal/curved geometry without a voxel look.

Action:

Decide whether Stage 2 keeps full-tile blocking or introduces partial-tile
collision/navigation. Do not silently imply diagonal walkability in the editor.

Priority: medium.

### 6.2 Rotation granularity is inconsistent — ✅ RESOLVED (S1-R7)

Unified on a single 45° authoring step (owner delegated the choice). Objects,
room gizmo, and save normalization all snap via `data.snapAngle` / `ROT_STEP`;
45° divides 360 evenly and keeps legacy 0/90/180/270 rooms valid. Diagonal
walls are documented in the wall-tool hint as full-tile blockers. Original note
retained below for context.



Current behavior:

- Room move/rotate gizmo: 90° steps
- Object rotation: 45° steps
- Runtime room animation: arbitrary interpolation
- Desired design direction: segmented 360° rotation, potentially 30° steps

Action:

Choose one authoring rule before expanding room mechanics:

- 30°
- 45°
- 90°
- configurable step per room/event

Then align the editor, save normalization, motion handles, and path/collision
behavior with that choice.

Priority: medium.

### 6.3 Moving-room navigation invalidation

Pawns can ride moving rooms, but path planning does not yet account for routes
that become invalid because a room moved, rotated, or disconnected.

Action:

When room motion and multi-room navigation are combined, add route invalidation
events and repathing rules.

Priority: Stage 2/3.

---

## 7. Performance considerations

The current performance foundation is good:

- Typed-array grid
- Binary-heap A*
- Viewport culling
- Render-on-demand
- Fixed-timestep catch-up cap
- Object pooling primitives

Future risks:

- Many pawns each rebuilding walk grids
- Re-pathing every frame
- Rendering large decks with many objects
- Running full-fidelity simulation on every deck
- Unbounded event history or logs
- Excessive undo snapshots of large saves

Suggested rules:

1. Cache walk grids per room version.
2. Recalculate navigation only when room data changes.
3. Use event-driven repathing where possible.
4. Keep inactive decks abstract.
5. Profile before switching renderer technology.

---

## 8. Recommended Stage 2 order

Stage 2 should not begin with NPC personalities or dialogue. Build the crew
foundation first.

### Stage 2.0 — Engineering hygiene

- Add `package.json` and `npm test`.
- Add a small all-tests runner.
- Fix the roadmap nav-test count.
- Expand `README.md`.
- Optionally add CI.

### Stage 2.1 — Crew data model

Design serializable schemas for:

- `Pawn`
- `Role`
- `SkillSet`
- `Assignment`
- `NeedState`
- `Schedule`
- `Job`
- `JobQueue`

Keep fields reserved but normalized, as Stage 1 did for object `power`/`heat`.

### Stage 2.2 — Crew roster

Implement the initial roster:

- Captain/player
- Commander Officer
- Supplies & Resources
- Deck Monitoring

The Captain does not need full control mechanics yet. Start with selection,
inspection, and simple orders.

### Stage 2.3 — Station navigation graph

Add a room/deck connectivity layer above local A*:

- Room nodes
- Door/opening edges
- Elevator/link edges
- Cross-room route planning
- Route invalidation hooks

### Stage 2.4 — Job system skeleton

Start with simple deterministic jobs:

- Move to location
- Operate console
- Inspect object
- Wait
- Follow schedule block

Jobs should be engine systems, not editor behavior.

### Stage 2.5 — Background simulation contract

Before autonomous routines spread across decks, define:

- What is stored for inactive decks
- Which systems tick in background
- How time catches up
- How detailed state is restored
- Which events are summarized

---

## 9. Suggested immediate task queue for Claude

1. Add `package.json` with a single test command.
2. Add a test runner for all four suites.
3. Fix nav test-count documentation.
4. Expand `README.md` with run/test instructions.
5. Add a `crew` reserved schema to the save model without behavior.
6. Add tests for crew schema normalization and round-trip.
7. Prototype a station-level navigation graph as a pure data module.
8. Only then begin NPC roles/jobs.

---

## 10. Questions for the project owner

These decisions should come from the owner before implementation assumptions:

1. Should the Captain be directly controlled like a pawn, or primarily issue
   orders through a command interface?
2. Should room rotation authoring use 30°, 45°, 90°, or configurable steps?
3. Should inactive decks simulate every NPC abstractly, or only key NPCs and
   station events?
4. Should Stage 2 keep strict room-local pathfinding with a station graph, or
   move toward partial-tile/polygon navigation?
5. Should custom scripts remain structured data, or is Lua/JS embedding a real
   requirement for the first scripting pass?

---

## 11. Rector summary

Continue the current repository and architecture. Do not restart.

The current engine is strong enough to justify investing in Stage 2. The main
risk is not Canvas performance; it is uncontrolled growth of AI, navigation,
background simulation, and event logic without clear data contracts.

The next implementation should therefore prioritize:

1. Test/CI hygiene
2. Crew data model
3. Station navigation graph
4. Job system skeleton
5. Background simulation contract

Graphics and texture polish should remain deferred until those systems are
stable — with one sanctioned exception: the pawn placeholder figure, which the
owner has now provided real sprite art for (see §12, task SPRITE-01).

---

## 12. Task briefs for Codex

### SPRITE-01 — Implement the pawn sprite (assigned to Codex)

**Mission:** replace the placeholder pawn figure with the owner's sprite art
from the newly uploaded folder `Sprites/Placeholders/`:

```text
Sprites/Placeholders/Player_front.png      (2048×2048, RGBA)
Sprites/Placeholders/Player_side.png       (2048×2048, RGBA)
Sprites/Placeholders/player_backside.png   (2048×2048, RGBA)
```

**What these files actually are (verified):** single static renders of an
armored soldier, one pose per file — NOT animation sheets. Each has an opaque
grey background, a baked-in floor shadow ellipse, a baked-in "Soldado" text
label at the bottom, and a small sparkle artifact at the bottom-right.

**Required work:**

1. **Preprocess into web-ready assets** (commit the derivatives, keep the
   originals untouched):
   - Crop to the character bounding box (drop the baked shadow, the "Soldado"
     label and the sparkle).
   - Make the grey background transparent.
   - Downscale to a sane game size (the pawn renders ~34px tall at zoom 1;
     a sprite of ~96–128px tall covers zoom levels crisply). Do NOT ship
     5 MB PNGs to the browser.
   - Suggested output: `Sprites/Placeholders/processed/pawn_front.png`,
     `pawn_side.png`, `pawn_back.png` (small, transparent).
2. **Wire into the renderer** (`src/render.js`, `drawPawnFigure`):
   - Load the three processed images once (async, cached); until they are
     ready — and forever if they fail to load — keep drawing the current
     placeholder figure. The placeholder is the fallback, not deleted.
   - Direction selection: the pawn's `facing` angle picks the sprite —
     front for south-ish, back for north-ish, side for east/west with the
     side image **mirrored horizontally** for one of them. Iso diagonals map
     to the nearest of the four.
   - Draw anchored at the feet (tile centre), scaled by `cam.zoom`. Keep the
     selection ring and keep the existing shadow under the sprite.
   - Top-down view (`drawPawnFigureFlat`): keep the current disc — sprites
     stay an iso-view feature for now.
3. **Hard constraints:**
   - Renderer stays isolated from game logic: no sim/data/nav changes. The
     sprite is a pure presentation concern.
   - No layout shifts in `index.html`; no new dependencies; classic-script
     style like the rest of `src/`.
   - `npm test` and `npm run smoke` stay green. Add one smoke check: the
     sprite `<img>` assets referenced by the renderer actually load (HTTP 200
     via the Pages path / file URL).

**Acceptance:** in iso views the pawn renders as the armored soldier, changes
sprite with facing (front/back/side+mirror), scaled with zoom, selected ring
intact; broken/missing asset → placeholder, never a blank pawn.

---

## 13. Punto de coordinación — Codex → Kimi K3

> **Estado: NO-GO para implementación.** Esta sección se añadió por instrucción
> directa del owner. Codex no iniciará `SPRITE-01` ni ningún cambio de código,
> datos, render, navegación, interfaz o arquitectura hasta que Kimi responda y
> el owner transmita o apruebe el acuerdo de coordinación.

### Contexto de equipo comunicado por el owner

- **Owner:** autoridad final de producto y de transición entre etapas.
- **Kimi K3:** rector principal y responsable de coherencia arquitectónica.
- **Claude:** implementador principal; puede proponer direcciones, pero no debe
  autorizar por sí solo un cambio de etapa.
- **Codex:** implementador/revisor de briefs acotados, actualmente bloqueado a
  la espera de coordinación.
- **Build tester / colaborador de feedback:** validación humana del build; sus
  hallazgos deben evaluarse junto con las pruebas automatizadas.

### Preguntas para Kimi

1. **Jerarquía de fuentes:** ¿confirmas esta prioridad para resolver conflictos?
   `owner + Feedback humano` → última revisión (`REVn`) → veredicto del rector →
   `AGENTIC_REVIEW.md` → documentos de planificación anteriores. Si no, indica
   el orden correcto.
2. **Gate de etapa:** los documentos no son totalmente consistentes sobre si
   Stage 2 está lista, bloqueada o simplemente pendiente de autorización.
   ¿Cuál es tu veredicto rector actual y qué criterios faltan, si falta alguno?
3. **Autoridad de transición:** ¿confirmas que una etapa solo puede comenzar o
   declararse completa con aprobación explícita del owner, después de revisión
   de Kimi y validación práctica del build tester, aunque las pruebas estén verdes?
4. **Brief autorizado para Codex:** ¿`SPRITE-01` sigue siendo mi siguiente tarea,
   debe redefinirse, o prefieres que primero haga una revisión/documentación de
   estado sin tocar implementación?
5. **Trabajo en curso:** ¿qué briefs, ramas o archivos están actualmente bajo
   trabajo de Claude o Kimi? Indica una lista de archivos o subsistemas que Codex
   no debe tocar para evitar colisiones.
6. **Criterio de aceptación por brief:** ¿confirmas como gate mínimo:
   pruebas unitarias + smoke, ausencia de regresiones contra las REV, revisión
   manual del build tester cuando aplique, revisión del rector y un handoff claro?
7. **Canal de comunicación:** ¿prefieres que los intercambios Codex↔Kimi se
   mantengan en esta sección, en una nueva `REV`, en comentarios de PR o mediante
   otro documento? Define también cuándo una conversación se considera cerrada.
8. **Formato de handoff:** propongo usar siempre:
   `observación → evidencia → riesgo → recomendación → archivos afectados →
   pruebas necesarias → decisión pendiente`. ¿Lo apruebas o deseas otro formato?
9. **Feedback frente a tests:** cuando el build tester reporta un problema que
   no rompe pruebas, ¿confirmas que el problema sigue siendo real y que deben
   añadirse criterios/pruebas nuevas en lugar de descartarlo por estar verde?
10. **Documentación desactualizada:** ¿debemos normalizar ahora los conteos de
    pruebas, estados de etapa y prioridades antiguas, o conservar los documentos
    previos como registro histórico y añadir únicamente una fuente de verdad actual?
11. **Orden previo a Stage 2:** entre esquema de crew, grafo de navegación de
    estación y contrato de simulación en background, ¿cuál debe diseñarse primero
    y qué artefacto de diseño mínimo exiges antes de autorizar código?
12. **Geometría/nav:** ¿se mantiene como contrato actual la colisión completa por
    tile y se difiere cualquier retorno a colisión parcial hasta disponer de
    posiciones sub-tile, tal como establece REV3?
13. **Gobernanza de Claude:** ¿confirmas que Claude conserva libertad técnica de
    implementación dentro de un brief, pero que cambios de alcance, arquitectura
    o etapa deben volver al rector y al owner antes de ejecutarse?
14. **Riesgos actuales:** sin implementar nada todavía, ¿hay algún subsistema de
    `main` que quieras que Codex inspeccione especialmente y te reporte?

### Respuesta solicitada a Kimi

Para que el handoff sea inequívoco, responde con:

1. **Veredicto rector actual.**
2. **Stage gate:** GO / NO-GO y motivo.
3. **Trabajo en curso y archivos protegidos.**
4. **Brief autorizado para Codex.**
5. **Pruebas y QA obligatorios.**
6. **Documento/canal donde continuar la coordinación.**
7. **Decisiones que todavía requieren al owner.**
8. **Autorización explícita:** `GO` o `NO-GO` para comenzar implementación.

### Compromiso de Codex mientras espera

- No comenzar implementación antes de la respuesta del rector.
- No modificar `Feedback humano`.
- Trabajar un solo brief por vez.
- Evitar archivos o subsistemas en curso de otro agente.
- No convertir una propuesta propia en decisión de proyecto.
- Mantener simulación/render separados y todas las REV como contratos de no
  regresión.
- Informar incertidumbres y conflictos documentales antes de escribir código.
