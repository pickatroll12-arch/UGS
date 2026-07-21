# UGS — Roadmap & Diseño

> Documento vivo. Capturamos aquí la visión a largo plazo y el plan por etapas.
> El código y los identificadores van en inglés; las notas de diseño en español.

---

## Visión (largo plazo)

Simulador / administrador y **life-sim de estación espacial**, con NPCs dinámicos
al estilo del sistema **A-life de STALKER** (agentes autónomos que "viven" su
rutina independientemente del jugador).

### Pilares

1. **Simulador + administrador** de estación espacial.
2. **Perspectiva del jugador**: encarnas al **Capitán** (rol concreto).
   Un modo "dios" / omnisciente queda como opción futura.
3. **NPCs dinámicos** (A-life): con diálogo, y *opcionalmente* una IA enchufable
   para que el jugador escriba y el NPC responda.
4. **Eventos de estación**: sobrecalentamiento, sobrecarga, incursión / abordaje,
   base de abastecimiento, y quizá **diplomacia**.
5. **Expansión** de estación, **gestión de recursos**, **minería espacial**,
   **reclutamiento**, y tal vez **exploración**.
6. **Combate** automático o por turnos tipo **XCOM**.

---

## Escenario inicial (MVP de juego)

- Juegas como **Capitán**; tomas las decisiones críticas (p. ej. expansión).
- Tripulación inicial: **jugador + 3 NPC**, cada uno con un rol:
  - **Commander Officer**
  - **Supplies & Resources**
  - **Deck Monitoring**
- Estación **pequeña**: operable por ~5 personas, pero con dificultad.
- Progresión: **expandir base y personal** mediante **minería espacial** y
  **reclutamiento**.

---

## Principio rector

**Separar la simulación del render.** La lógica del juego (estado, entidades,
pathfinding, eventos) no sabe nada de cómo se dibuja. Los gráficos son
*placeholders* (colores planos / "slots" de material con ID) y se pulen después
**sin tocar la lógica ni el formato de datos**.

---

## Etapa 1 — Motor de Mapas/Niveles + Station Builder *(EN CURSO)*

El editor y el motor que cargan/guardan mapas. Es la base de todo.

- [x] **M1 · Modelo de datos + formato de guardado** *(núcleo puro, sin UI)* ✅
  Esquemas Level / Room / Tile / Object / Link / Event; save file = colección de
  niveles + grafo de links + versión; serializar / validar / import-export.
  → `src/data.js` (esquemas, factories, registries, normalización),
    `src/save.js` (serialize/deserialize, versión + migración, import/export),
    `src/core.test.js` (22 tests headless, `node src/core.test.js`). Todo verde.
- [x] **M2 · Renderer + shell del editor** ✅
  Render isométrico que dibuja las salas **a través de su transform**; toggle
  Build/Play, cámara (pan/zoom), selección de tile con picking que invierte el
  transform (world→room-local). → `src/render.js`, `src/editor.js`, `index.html`
  (app builder). Demo con 2 salas (una desplazada + rotada 90°) que prueba el
  pipeline. Verificado en Chromium headless: render OK, picking OK, sin errores.
- [x] **M3 · Herramientas de construcción** ✅
  Pincel de suelo (materiales + void), muros, colocar objetos, borrar, punto de
  entrada, seleccionar/mover/rotar/borrar objeto, **undo/redo** (Ctrl+Z/Y),
  atajos de teclado y paletas. Pintar opera en coords room-local (funciona en
  salas rotadas). → `src/editor.js` (reescrito), paletas en `index.html`,
  marcador de entrada en `src/render.js`, `void` como suelo válido en `data.js`.
  Verificado headless: paint, place, undo/redo (5→6→5→6), round-trip export/
  import, void persiste, picking en sala rotada. Sin errores.
  **Ampliación del toolbox (M3+):** nuevos construibles — Pillar, Door, Airlock,
  Stairs, Ladder, Ramp (objetos), Glass wall (ventanas), Catwalk (piso sobre
  vacío). QoL — Fill/bote, Duplicate (objeto Ctrl+D + sala), Layers con toggles
  de visibilidad, Selection filter (All/Objects/Walls/Floors), y puertas que
  abren/cierran en modo Play. Escaleras/rampas quedan como anclas de traversía
  para el M5. Diferido: escalar/estirar muros y clonar selección rectangular.
  Verificado headless: fill, door toggle (collision on/off), duplicate obj+room,
  glass, layer-hide bloquea el pick, filtro de selección, round-trip de campos
  nuevos. Todo verde.
- [ ] **M4 · Salas como unidades móviles**
  Agrupar tiles en salas con nombre; transform (posición + rotación + pivote);
  presets de evento (**shift / rotación / carrusel**) + mini-DSL de script;
  timeline con **tiempo real + pausa/velocidad**.
- [ ] **M5 · Links & multi-mapa**
  Enlazar tile/objeto (ascensor) → nivel destino + spawn; modos de carga
  **preload** vs **stream**; transición en Play mode; el save contiene todo el
  grafo de niveles.
- [ ] **M6 · Slice jugable (test)**
  Meter el pawn de prueba, caminar, disparar un link y un evento de sala de punta
  a punta para validar el motor.

---

## Decisiones de arquitectura

- **Render** — ✅ **Canvas 2D (HTML5)** por ahora, no WebGL. El render está
  aislado del sim, así que se puede cambiar a WebGL/PixiJS más adelante solo para
  el pulido visual, sin tocar mecánicas.
- **Estructura de código** — ✅ varios archivos `.js` clásicos bajo un namespace
  global `UGS`, incluidos desde el HTML. Se abre con doble clic (sin servidor ni
  build) y ya queda modular. Restricción: cargar mapas va por file-picker /
  import-export, no por `fetch` (bloqueado en `file://`). Los módulos del core
  llevan cola UMD para poder testearse en Node.
- **Salas transformables** — ✅ **sí**, salas como entidades de primera clase con
  transform (offset + rotación + pivote) desde el inicio; mover/rotar/carrusel es
  nativo en el data model.
- **Modelo de entidades** — pawns y objetos como "entidades con propiedades".
  Desde M1 se **reservan** campos aunque no se simulen: en pawns `role` / `skills`
  / `assignment`; en objetos `power` / `heat` / subsistemas.

---

## Etapas futuras (borrador, se planifican una por una)

- **Etapa 2 · Entidades & tripulación** — pawns con rol/skills; controlador del
  jugador (el Capitán); selección y órdenes; roster inicial (jugador + 3 NPC).
- **Etapa 3 · Sistema de eventos/triggers general** — reutiliza el timeline de
  salas; base para los eventos de estación.
- **Etapa 4 · Subsistemas de estación** — energía, calor, atmósfera →
  habilita sobrecalentamiento / sobrecarga.
- **Etapa 5 · Economía** — recursos, minería espacial, reclutamiento, expansión.
- **Etapa 6 · A-life / IA de NPCs** — rutinas autónomas, diálogo, IA enchufable
  opcional.
- **Etapa 7 · Combate** — automático o por turnos tipo XCOM.

---

## Estado actual del repo

- `index.html` — **app Station Builder** (Etapa 1). Carga `src/data.js`,
  `src/save.js`, `src/render.js`, `src/editor.js` como scripts clásicos.
- `src/` — el núcleo: data model, save/load, renderer iso, shell del editor,
  y `core.test.js` (tests headless del núcleo de datos).
- `sandbox/placeholder.html` — el placeholder isométrico original (sala + pawn
  con click-to-move y A*). **Sandbox de movimiento/IA** para etapas posteriores.
