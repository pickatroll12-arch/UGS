# PROMPT MAESTRO — Cómo se trabaja en UGS (para TODO agente, actual o futuro)

> Si eres un agente de IA asignado a este proyecto: **lee esto PRIMERO, entero, antes de escribir una línea.**
> Luego lee `REVISION MAESTRA 2` (la visión) y el `AGENTIC_REVIEW.md` (el historial de coordinación).
> Este documento es la estructura y la disciplina del proyecto. No es negociable.

---

## §0. Por qué existe este documento

El proyecto ya sufrió dos resets por la misma causa: agentes que partieron de *ideas* en vez de
*estructura*, se saltaron pasos, y entregaron motores inestables sin supervisión. El error humano
fue no tener un supervisor ni una estructura escrita. Este documento ES esa estructura.
Quien la ignore, repite el reset.

---

## §1. Filosofía del proyecto (3 pilares)

1. **Estructura antes que ideas.** Nada se implementa si no encaja en la estructura de §2/§3.
   ¿No encaja? Se propone en `AGENTIC_REVIEW.md` y espera aprobación humana. No se improvisa.
2. **Lógica declarativa, pre-cargada por Nexo.** El juego NO es una simulación continua tipo
   life-sim. Cada Nexo (nivel/fase) declara su lógica en datos (eventos, hitos, módulos) y el
   engine solo ejecuta la lógica del Nexo cargado. Datos entran, comportamiento sale.
3. **El humano manda, el agente ejecuta.** Feedback humano y directrices del Rector (Kimi K3)
   tienen prioridad alta. Un agente nunca se salta metas/hitos ni decide alcance por su cuenta.

---

## §2. LA regla de oro: separación LÓGICA / RENDERIZADOR

```
[COMPONENTES LÓGICOS]          [RENDERIZADOR GRÁFICO]
  src/core/*                     src/render/*
  src/engine/*                        ↑
        │  NUNCA importan render      │  NUNCA muta modelo
        └────── (única excepción: ────┘   NUNCA importa engine
                engine.js usa SOLO         NUNCA conoce reglas de juego
                matemáticas de pose
                de render.js)
```

- **Prohibido** fusionar lógica y render en un solo "app package". `src/app/` es solo
  *pegamento* (modos, input, bucle): orquesta llamadas, no contiene reglas del juego.
- El renderizador **lee** estado y dibuja. Toda la geometría pasa por
  `worldToScreen/screenToWorld` (una sola fuente de verdad → rotar la cámara fue editar UNA función).
- La lógica corre en Node sin DOM: todo módulo de `core/` y `engine/` debe poder
  `require()`arse en un test de Node. Si tu lógica toca `document`, está mal puesta.

**Test de la regla:** ¿puedo correr la lógica del juego completa en un terminal, sin navegador?
Hoy sí. Debe seguir siendo sí siempre.

---

## §3. Estructura vigente (base revamp, 2026-07-24)

| Módulo | Capa | Responsabilidad | Puede importar |
|---|---|---|---|
| `core/core.js` | lógica base | ids, EventBus síncrono, FixedTimestep, helpers | nada |
| `core/rng.js` | lógica base | RNG determinista sembrado (mulberry32); TODA probabilidad del juego pasa aquí | nada |
| `core/data.js` | lógica base | modelo (Estación→Nexo→Sala→Tile), catálogos, **contratos C1-C3**, normalización | core |
| `core/save.js` | lógica base | persistencia JSON v1 (sin legacy) | data |
| `engine/nav.js` | lógica juego | A* click→ruta, walkable (aplica C1-C3) | nada |
| `engine/engine.js` | lógica juego | runtime por Nexo: eventos shift/rotate/orbit/carousel, bus, paso fijo | core, render (solo pose math) |
| `engine/station.js` | lógica juego | capa estratégica (tipo geoscape Xenonauts): economía CRED/UD/energía/PNJ, módulos (conexión física), hitos/fases, scheduler RNG, expediciones por etapas | core, rng |
| `engine/agents.js` | lógica juego | PCJ: spawn/place/order/step, facing, 'pawn:arrived' | core, nav |
| `engine/blueprint.js` | lógica juego | suite Dev: ops de edición de salas (rectángulos, relleno, redimensión), snapshots deshacer/rehacer, puente blueprint→defs de station.js | core, data |
| `render/render.js` | renderizador | proyección ¾ ortogonal tipo Xenonauts (C4), picking en plano de suelo, dibujo de Nexo/salas/PCJ | data (solo catálogos) |
| `audio/music.js` | audio (director) | decide QUÉ pista suena y con qué ganancia: barajado sembrado, fundidos y crossfade de potencia constante. Sin DOM → corre en Node y tiene tests | core, rng |
| `audio/player.js` | audio (driver) | ejecuta los comandos del director sobre dos `<audio>`; política de autoplay/unlock. Única pieza del audio que toca el navegador | nada (recibe el director) |
| `app/app.js` | pegamento | shell menú/dev/juego, cámara RTS, input, bucle rAF | todo lo anterior |

**Contratos del modelo (C1-C3), INQUEBRANTABLES** (nacidos del feedback humano):
- **C1:** TODA pared (block/diagonal/rounded) bloquea su tile completo. Sin excepciones.
- **C2:** Objeto sólido bloquea; puerta/compuerta ABIERTA deja pasar.
- **C3:** `floor:'void'` no es transitable.

**Contrato de cámara (C4, visión aprobada por el organizador 2026-07-25):**
- La VISIÓN de cámara es **¾ ortogonal tipo Xenonauts**: vista aérea inclinada
  (~30° de elevación), paredes con altura visible, sprites "de pie", yaw en pasos
  de 90°, y fade/cutaway de paredes que ocluyan la acción.
- La CONSTRUCCIÓN es sobre grid plano tipo **RimWorld / Prison Architect**
  (todo tile a tile, sin perspectiva de punto de fuga NUNCA).
- El renderer actual (top-down plano) es **v1 transitorio**: la lógica es
  agnóstica de cámara y NO se toca al migrar al renderer ¾ (v2). La migración
  solo reescribe `render/render.js` + sprites. Ningún agente "reinterpreta"
  este contrato: la cámara final es ¾, el plano es el peldaño técnico.

**Regla del audio (misma doctrina que el render, 2026-07-25):** el audio es
PRESENTACIÓN, no simulación. La decisión musical vive en lógica pura y testeable
(`audio/music.js`), el navegador solo obedece (`audio/player.js`). Ninguna capa de
juego sabe que existe el audio: `core/`, `engine/` y `render/` no lo importan jamás.
La música corre con dt real fuera del paso fijo — no puede influir en el determinismo
del engine — y usa **semilla propia** (`ugs-music`), nunca el RNG de la partida.

**Reglas de módulos:**
- Un módulo = una responsabilidad = un archivo. Si crece otra responsabilidad, nace otro módulo.
- Todo módulo lógico usa el patrón UMD del repo (navegador `window.UGS.*` + Node `module.exports`).
- Dependencias solo "hacia abajo" en la tabla. Nada de ciclos.
- Catálogos (materiales, objetos) crecen **por necesidad aprobada**, no por ocio.

---

## §4. Determinismo y calidad (definition of done)

1. El engine avanza a paso fijo (`FixedTimestep` en app.js → `engine.update(nexo, dtFijo)`).
   Nada de `Date.now()`/`Math.random()` en lógica de juego: TODA probabilidad usa
   `core/rng.js` con la semilla del save (`station.state.seed`).
2. **Todo módulo nuevo llega con su test en Node** (`tests/*.test.js`, runner `tests/run.js`).
   `npm test` debe quedar en verde. Verde es requisito, no prueba suficiente:
   en tu handoff declaras qué probaste manualmente y qué NO probaste.
3. Los tests existentes NO se borran ni se relajan para hacer pasar tu código. Si un test
   viejo contradice un requisito nuevo aprobado, se documenta el cambio en el handoff.
4. Nada de dependencias npm de runtime. Vanilla JS + Canvas. Playwright solo para smoke (dev).

---

## §5. Flujo de trabajo del agente (SIEMPRE)

1. **Lee:** `PROMPT_MAESTRO.md` → `REVISION MAESTRA 2` → `AGENTIC_REVIEW.md` (§ últimos handoffs)
   → `Feedback humano` (solo lectura).
2. **Encuadra:** tu tarea debe venir de un objetivo aprobado (OBJP-1 hoy; OBJP-1.1 está
   BLOQUEADO hasta las 3 firmas humanas). Si tu encargo excede el objetivo vigente, pide
   confirmación antes de escribir.
3. **Branch + PR**, nunca commits directos a `main` (salvo Kimi K3 ejerciendo de Rector).
4. **Implementa** respetando §2/§3/§4. Código y comentarios en inglés; documentos en español.
5. **Entrega con handoff** en `AGENTIC_REVIEW.md` (formato §6) y espera veredicto del Rector.

**Prohibido:** saltarse hitos · implementar fuera de alcance · recuperar código purgado del
historial de git · tocar `Feedback humano` · "optimizar" módulos ajenos sin brief · dejar
`npm test` en rojo · declarar éxito solo porque los tests pasan.

---

## §6. Formato de handoff (obligatorio)

```md
### §<sección>.N — <AGENTE> — <TÍTULO> — <FECHA>
**Observación:** qué se hizo / qué se encontró
**Evidencia:** commits, salida de tests, capturas
**Riesgo:** qué puede fallar / qué NO se probó
**Recomendación:** siguiente paso propuesto
**Archivos afectados:** lista
**Pruebas necesarias (humano):** checklist concreto para los alpha testers
**Decisión pendiente:** qué deben resolver los 3 colaboradores (si aplica)
```

---

## §7. Roles vigentes

| Rol | Quién | Qué hace |
|---|---|---|
| Colaboradores humanos | -XONO (organiza), -FROMO y -BX (alpha testers) | aprueban hitos (3 firmas en `Feedback humano`) |
| Rector de agentes | **Kimi K3** | estructura, veredictos, directrices prioritarias |
| Agente constructor | **Claude** | briefs de construcción (cuando tenga cuota) |
| Agente de apoyo | **Codex** | briefs acotados y bien especificados |

Cualquier agente futuro: leer §0-§7, presentarse en `AGENTIC_REVIEW.md` con el formato de §6,
y esperar brief. Bienvenido. No rompas la estructura.
