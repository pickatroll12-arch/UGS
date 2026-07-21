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

## Núcleo pesado (heavy-core rework) — capacidad + rendimiento

Refuerzo transversal (M1→M5) para soportar metas ambiciosas (muchos NPCs
autónomos / A-life, subsistemas, combate) y correr fluido en specs modestas
(clase Steam Machine: pocos cores, GPU floja, 2D nunca debe sudar).

- **`src/core.js` — fundación** (dependency-free, determinista, consciente de
  asignaciones): RNG sembrado (mulberry32 → mundos/saves reproducibles),
  `EventBus` (desacople de sistemas), `FixedTimestep` (sim desacoplada del
  framerate, con tope de catch-up anti-espiral), `Grid2D` (grid denso sobre
  typed arrays, sin GC — para mapas grandes y consultas de muchos agentes),
  `vec` (math 2D), `Pool` (reciclaje en bucles calientes). 23 tests.
- **Engine → Sim determinista** dirigida por **fixed timestep** (30 Hz): motion
  determinista e independiente del framerate; `EventBus` (`motion:start/done`);
  `addSystem()` para sistemas futuros (subsistemas/IA); `time`/`tick`. 15 tests.
- **Render performante**: **viewport culling** (no dibuja lo fuera de pantalla)
  y **render-on-demand** en el editor (un editor inactivo no repinta → no quema
  un core). El sim en Play sí anima y repinta.
- **Data**: `seed` determinista en el save (round-trip) para contenido
  procedural/A-life reproducible.

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
- [x] **M4 · Salas como unidades móviles** ✅
  Motor de movimiento (`src/engine.js`) que anima el `transform` de las salas:
  presets **shift / rotación / carrusel** + runner de **script** (move/rotate/
  wait), con loop (ping-pong / ciclo). Timeline con **tiempo real + pausa +
  velocidad** (Space pausa, 1/2/3 velocidad). No destructivo: snapshot del
  transform autoral al entrar a Play y restaurado al salir. Autoría en el
  inspector (Movable + añadir/Test/borrar eventos); en Play, clic en sala
  movible dispara sus eventos manuales, clic en puerta la abre/cierra.
  `rotatePoint` generalizado a ángulo arbitrario (animación suave; exacto en
  0/90/180/270). Verificado headless: engine (11 tests) + integración (slide,
  pausa congela, 3× escala, Build restaura la pose base, autoría de evento).
  **Refinamiento M4+:** modo **Orbit** real (la sala orbita alrededor de un eje
  invisible, radio constante, dirección cw/ccw, opción self-rotate) — distinto
  del carrusel de poses. **Previsualización** en Build de la trayectoria de cada
  evento (flecha de shift, anillo de órbita + dirección, arco de rotación,
  polilínea de carrusel) con **handles arrastrables** para apuntar el movimiento
  libremente (destino del shift, centro de la órbita, poses del carrusel). Menú
  reorganizado en **pestañas con iconos** (Build / Rooms / Save). Verificado
  headless: pestañas, +Orbit, arrastre de handle mueve el centro, flip de
  dirección, y órbita con radio constante en Play. Sin errores.
  **Debugging M4++:** (1) BUG de raíz — `normalizeRoomEvent` no manejaba
  `orbit`, así que al guardar/cargar se convertía en `shift`; arreglado (+ el
  round-trip preserva center/radius/period/direction/selfRotate). (2) **Radio
  de órbita** ahora es explícito e independiente del eje: mover el eje mantiene
  el radio; hay un **handle de radio** (amarillo) aparte para ajustarlo. (3)
  **Mover/rotar salas**: gizmo con handle ▪ (mover, snap a tiles enteros) y ●
  (rotar en pasos de 90° pivotando sobre el centro). Verificado headless:
  round-trip de orbit, radio independiente del eje, mover/rotar sala, y smoke
  test general sin errores de consola.
  **Debug a fondo (sesión final):** (a) BUG — clic en un objeto no lo
  seleccionaba (se agarraba como movingObj y al soltar sin arrastrar solo se
  descartaba el historial); arreglado → clic selecciona; esto además restauró
  poder seleccionar/alternar puertas en Build. (b) BUG — los objetos planos
  (elevator/ramp) interceptaban el clic del tile de atrás porque todos usaban
  una caja de pick alta; arreglado con altura de caja por tipo (OBJ_PICK_TOP).
  (c) Robustez — undo/redo bloqueados en modo Play para no desincronizar el
  motor. Verificado: suites unitarias, tests dirigidos (selección objeto/tile/
  puerta/pilar, place-en-void rechazado, round-trip, cámara finita) y **fuzz de
  1200 acciones** sin excepciones ni errores de consola.
- [x] **M5 · Links & multi-mapa** ✅
  Herramienta **Link** (2 clics: origen → cambiar de deck → spawn) que crea un
  enlace en `save.links`. Gestión de **decks**: añadir/borrar/renombrar niveles.
  **Marcadores** de portal/spawn/pending dibujados en el mapa. **Transición en
  Play**: clic en un tile de enlace viaja al deck destino y centra en el spawn
  (bidireccional). Modos de carga con semántica real: **preload** marca el
  destino como residente al arrancar Play; **stream** lo carga en la primera
  visita (Set `resident`). El save contiene todo el grafo (links round-trip).
  La demo trae Deck 1 + Deck 2 con un ascensor enlazado. Verificado headless
  (11 checks): transición ida/vuelta, autoría de link, add deck, preload vs
  stream, round-trip (2 links, 0 warnings, 3 decks). Sin errores.
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
