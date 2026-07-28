# UGS — Station Builder

Constructor de estaciones espaciales en el navegador. **Vanilla JS, sin build.** Única dependencia
de runtime: **three.js vendorizado** en `vendor/three/` (no CDN) para el renderer 3D.

> ⚠️ **ESTADO: REVAMP TOTAL (2026-07-24).** Todo el código anterior fue purgado por decisión de los 3 colaboradores humanos. Esta es la base nueva, construida desde cero siguiendo `REVISION MAESTRA 2` y la filosofía de estructura de `PROMPT_MAESTRO.md`. Léelos antes de tocar nada.

## Documentos rectores (en este orden)

1. **`REVISION MAESTRA 2`** — la visión y el estándar maestro del proyecto (objetivos OBJP-1/1.1/2, definiciones, gobernanza).
2. **`PROMPT_MAESTRO.md`** — la estructura del código y las reglas de trabajo para TODO agente (actual o futuro). Es el "prompt" que cualquier IA debe seguir.
3. **`AGENTIC_REVIEW.md`** — registro de coordinación entre agentes (handoffs, veredictos del Rector).
4. **`Feedback humano`** — canal exclusivo de los 3 colaboradores humanos. Los agentes solo leen.
5. **`GUIA_TESTERS.md`** — recorrido paso a paso para -FROMO y -BX: qué probar, qué debe pasar
   y lista de todo lo añadido en el ciclo vigente.

## Estructura del código

```
index.html            shell: canvas + menú + topbar + suite Dev (sin lógica de juego)
src/
  core/               [COMPONENTES LÓGICOS — base]
    core.js           ids, EventBus síncrono, FixedTimestep, helpers
    rng.js            RNG determinista sembrado (mulberry32); TODA probabilidad pasa aquí
    data.js           modelo: Estación → Nexo → Sala → Tile/Pared/Objeto (+contratos C1-C3),
                      blueprints de módulo, moduleLibrary, station.state
    save.js           persistencia JSON (formato v1, sin legacy)
    objects_lib.js    catálogo data-driven de objetos decorativos (OBJP-1.1 T1);
                      registra sus defs en data.js para que `solid` sobreviva al save
    content_f1.js     CONTENIDO de la Fase 1: árbol de hitos, módulos y ruta minera
                      veta_k7 (OBJP-1.1 K3+K4). Datos puros: el runtime está en station.js
  input/              [ENTRADA]
    gamepad.js        mando estándar (Odin 2 Portal): zona muerta radial, flancos,
                      auto-repetición y mapa de acciones. Sin DOM → Node-testeable
  engine/             [COMPONENTES LÓGICOS — juego]
    engine.js         runtime PRE-CARGADO POR NEXO (eventos declarativos de sala)
    nav.js            A* click→ruta (4-dir, determinista)
    station.js        capa estratégica tipo Xenonauts 2: economía CRED/UD/energía/PNJ,
                      módulos con conexión física, hitos/fases, scheduler RNG, expediciones
    blueprint.js      lógica de la suite Dev: ops de edición de salas (rectángulos, relleno,
                      redimensión), deshacer/rehacer, puente blueprint→defs de station.js
    agents.js         el PCJ ("mono"): movimiento solo por click→ruta
  render/             [RENDERIZADOR GRÁFICO]
    render.js         canvas 2D, vista ¾ ortogonal tipo Xenonauts (C4): diamante, paredes extruidas, fade de oclusión
    render3d.js       misma escena en WebGL (three.js), proyección y picking delegados a render.js.
                      Todo grupo entra/sale de la escena por `swapGroup`: uno vivo por ranura, sin fantasmas
  audio/              [AUDIO]
    music.js          director: decide qué pista suena y con qué ganancia (crossfade de
                      potencia constante, orden barajado por rng.js). Sin DOM → Node-testeable
    player.js         driver: ejecuta los comandos del director sobre dos <audio>; autoplay/unlock
  app/
    app.js            pegamento: modos (menú/dev/juego), suite Dev (Nexo/Módulos), cámara, input, bucle
!_UGS/ux/             kit UX del equipo (logo, botones, tarjetas) — referenciado in-situ por el shell
tests/
  run.js              runner sin dependencias (node tests/run.js)
  core.test.js        core + data + save (contratos de colisión incluidos)
  engine.test.js      nav + engine + agents + matemáticas de picking/yaw
  station.test.js     capa estratégica: RNG, economía, módulos, hitos, expediciones
  blueprint.test.js   suite Dev: blueprints, ops de edición, puente a station.js
  audio.test.js       director musical: barajado, fundidos, crossfade, bucle infinito
  objects.test.js     OBJP-1.1: catálogo de objetos + reactor como OBJETO (TW por núcleo)
  content_f1.test.js  OBJP-1.1: árbol de fases F1 + expedición minera determinista
  toolbox.test.js     barra de herramientas: DRAG BOX, teclas, geometría
  gamepad.test.js     mando: zona muerta, flancos, repetición, mapa de acciones
  render3d.test.js    contabilidad de la escena 3D: un grupo por ranura, sin fantasmas
vendor/three/         three.js r160 (MIT) vendorizado — ver su README.txt antes de actualizar
```

El kit del equipo se referencia **in-situ** (cero duplicación binaria): `!_UGS/ux/` para la
UI y `!_UGS/Fx/Music/` para la música (`Deck_Idle_Mu` en uso; `Tension_Events_MU` y
`Aggresive_Events_Mu` NO están cableadas: música por evento es OBJP-2, congelado).

## Reglas de oro (resumen; el detalle está en PROMPT_MAESTRO.md)

- **Lógica y renderizador NUNCA se mezclan.** `core/` y `engine/` no importan nada de `render/` (excepción única: `engine.js` usa matemáticas de pose de `render.js`; `render.js` jamás muta estado).
- **Lógica PRE-CARGADA POR NEXO** (Nexo = nivel/fase). No hay life-sim global: cada Nexo declara su lógica en datos y el engine la ejecuta solo mientras ese Nexo está cargado.
- **Toda pared bloquea su tile completo.** Siempre. (Contrato C1, nacido del feedback humano.)
- **Determinismo:** el engine avanza a paso fijo (`FixedTimestep`), nunca con wall-clock.
- **La música es presentación, no simulación:** el director decide en lógica pura (Node-testeable),
  el driver solo ejecuta. Ninguna capa de juego sabe que existe el audio.
- **Tests en verde antes de cualquier entrega:** `npm test` (506 checks hoy; solo crece).

## Cómo correr

- **App:** abrir `index.html` en un navegador (o GitHub Pages del repo).
- **Tests:** `npm test` (requiere solo Node ≥ 18).

## Lenguaje visual (sci-fi de estación)

Derivado del kit del equipo en `!_UGS/ux/`, no inventado aparte:

- **Chaflán en vez de esquina redonda** — la silueta sale del botón hexagonal de
  `botones.svg`; vive en la variable CSS `--chamfer` y la repite el raíl de la barra
  de herramientas dibujado en canvas, para que HTML y canvas hablen igual.
- **Cian `#62e0ef`** como único acento (el que ya usaba la suite). Ámbar y verde quedan
  reservados a *estado* (aviso / correcto), no a decoración.
- **Neutros sesgados a azul**, nunca gris puro: un gris neutro junto al cian se ve sucio.
- **Etiquetas técnicas en monoespaciada** con tracking amplio; el texto corrido sigue
  en sans para que se lea.
- **El brillo marca lo ACTIVO**, no adorna: si algo brilla, es porque está seleccionado,
  encendido o pidiendo atención.
- Animación mínima y con `prefers-reduced-motion` respetado.

## Barra de herramientas (suite Dev)

Fila de rombos en el borde inferior, una tecla fija por herramienta:

| `1` | `2` | `3` | `4` | `5` | `6` | `7` | `8` | `9` | `0` |
|---|---|---|---|---|---|---|---|---|---|
| Seleccionar | Suelo | Pared | Borrar | Relleno | Objeto | Consola | Entrada | Ascensor | Módulo |

**Suelo, Pared y Borrar son DRAG BOX**: se arrastra un rectángulo y se aplica al soltar
(utilidad declarada intocable por el organizador; `tests/toolbox.test.js` falla si se pierde).
La tecla **no se reasigna** al cambiar de sección: Entrada/Ascensor/Módulo solo valen en
DISEÑAR NEXO y allí se ven apagadas, pero su número no se lo queda otra herramienta.
Al final de la barra hay tres rombos **bloqueados** (PNJ, Evento, Zona): hueco reservado
para OBJP-2 y OBJP-1.1, sin funcionalidad hasta las 3 firmas.

## Mando (Odin 2 Portal y cualquier gamepad estándar)

El juego se apunta con el ratón, así que el mando mueve un **cursor virtual**: todo lo que
ya funcionaba (caminar, puertas, ascensores, colocar) sirve igual sin lógica duplicada.
Se detecta solo al conectarlo.

| Control | Acción |
|---|---|
| Stick izq | mover cursor |
| Stick der | paneo de cámara |
| A | confirmar / caminar · **Dev: mantener + stick = DRAG BOX** |
| B | cancelar (ESC) |
| X | Juego: expedir nave · **Dev: deshacer** |
| Y | Juego: pausa · **Dev: rehacer** |
| LB / RB | rotar vista ∓90° |
| LT / RT | alejar / acercar |
| D-pad ← → | herramienta anterior / siguiente (en Dev) |
| Back | cambiar Dev ↔ Juego |
| Start | menú |

El mapa vive en `input/gamepad.js` como **datos**, así que la tabla de arriba y el
comportamiento no se pueden desincronizar.

## Controles (base actual)

| Acción | Control |
|---|---|
| Rotar vista (¾, pasos de 90°) | `Q` / `E` |
| Zoom anclado al cursor | rueda del ratón |
| Pan | arrastrar (botón izquierdo en vacío / medio / derecho) |
| Pausa (en juego) | `Espacio` |
| Caminar (en juego) | click en un tile |
| Abrir puerta (en juego) | click en la puerta |
| Viajar de Nexo (en juego) | click en el ascensor (▣) |
| Expedir nave a la veta (en juego) | `X` (requiere hito Hangar y una nave amarrada) |
| Elegir herramienta (dev) | `1`…`9`, `0` o click en su rombo de la barra inferior |
| **DRAG BOX** (dev) | arrastrar con Suelo `2` / Pared `3` / Borrar `4` |
| Inspeccionar / retirar objeto (dev) | Seleccionar `1` + click · `Supr` retira |
| Deshacer / Rehacer (dev) | `Ctrl+Z` / `Ctrl+Y` (o `Ctrl+Shift+Z`) |
| Silenciar / volumen de música | control 🔊 abajo a la derecha (visible en todos los modos) |

## Qué significa "F1"

**F1 = Fase 1**, y va en el id y en el nombre para hacer explícito que son los módulos
de **nivel 1**: `hangar_f1` / "Hangar F1" es el hangar básico, y más adelante habrá
Hangar F2/F3/F4 — misma familia, mejor versión, atada a la fase que la desbloquea.
No es un prefijo de organización de archivos: es el **tier** del módulo.
Regla: todo módulo declara `tier` y su id termina en `_f<tier>`. Los **hitos** usan
`f1_…` por la FASE a la que pertenecen, que es otra cosa.

## Economía (Fase 1)

Se empieza con **0 CRED** y **1 nave extractora**. Los módulos de F1 son **gratis**:
lo que se paga es el PROGRESO (los hitos, 1100 CRED en total). El dinero sale de la
**venta**: cuando una expedición vuelve, su carga se convierte en CRED al precio de
`content_f1.PRICES` (mineral base 100 CRED/UD, escala del mapa mental 100/250/500) y
el almacén queda libre para el siguiente viaje.

### Impuesto UGS

**UGS = Unión Galáctica del Sistema Sol** — de ahí el nombre del proyecto. Toda venta
tributa: **un tercio del bruto se lo queda la UGS**, y se muestra desglosado al vender
(`400 CRED brutos − 133 de impuesto UGS = +267`). No es una constante de balance
cualquiera: es lore, y el jugador tiene que ver quién le cobra.

### Ritmo (medido, no estimado)

Una expedición falla el **40%** de las veces (10% por etapa × 5 etapas) y, cuando
vuelve, deja **~194 CRED netos** de media. Con F1 costando 1100 CRED, completar la
fase pide **~5,7 expediciones ≈ 28 minutos**. Las palancas para ajustarlo son los
`min/max` de `ROUTES` y los `cost` de `HITOS`.

## Música

Cama ambiente **idle** de la cubierta: las 4 pistas de `!_UGS/Fx/Music/Deck_Idle_Mu/` se
encadenan en bucle infinito con **crossfade de potencia constante** (6 s), orden barajado
por `core/rng.js` (semilla propia `ugs-music`: la música nunca consume el RNG de la partida)
y sin repetir pista dos veces seguidas. Entra con fundido y para con fundido. El navegador
bloquea el audio hasta el primer gesto del usuario: mientras tanto la transición se congela
(no se consume en silencio) y arranca sola con el primer click. Volumen y mute persisten en
`localStorage`.

## Suite Dev (diseño)

Dos secciones conmutables en la barra superior:

- **DISEÑAR NEXO** — 3 slots de Nexo (uno por fase, tope duro), que actúan como
  *conectores centrales*: tarjetas con estado de desbloqueo por fase, herramientas
  de entrada/links, overlay de "frontera de conexión" y **colocación de módulos
  con ghost**: preview del footprint con validación en vivo (conexión por arista
  compartida + no-solape, la misma regla de `engine/station.js`); click coloca,
  click derecho retira, `ESC` sale. Las salas colocadas guardan su `bpId` de origen.
- **DISEÑAR MÓDULOS** — biblioteca de blueprints reutilizables: sala de diseño +
  metadatos (coste CRED, consumo TW, provides energía/almacén/PNJ, categoría, tamaño).
  Tarjetas con **iconos del kit UX por categoría** (rayo=energía, grano=almacén,
  cubierto=hábitat, laboratorio=industria, O2=general; verde=con suelo, naranja=vacío).
  La biblioteca viaja en el save (`moduleLibrary`) y se exporta/importa como JSON.
  `engine/blueprint.js` convierte un blueprint en def compatible con `station.js`.

Herramientas compartidas: suelo por rectángulo, pared por contorno, borrado por
rectángulo, bote de relleno, objetos, auto-bordes, vaciar, deshacer/rehacer.

## Gobernanza

Los agentes de IA (Kimi K3, Claude, Codex) trabajan bajo supervisión humana obligatoria: nada entra a `main` sin handoff en `AGENTIC_REVIEW.md` y validación de los 3 colaboradores. Ver `REVISION MAESTRA 2` §GOBERNANZA y `PROMPT_MAESTRO.md` §6.
