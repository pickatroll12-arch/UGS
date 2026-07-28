# BRIEF_CLAUDE_OBJP11.md — Tareas de Claude (OBJP-1.1 + suite) — 2026-07-27

**Contexto:** -XONO desbloqueó OBJP-1.1 por orden directa (§6.20 de
AGENTIC_REVIEW). Split: tú haces **T1 + T2** (suite/UI); Kimi K3 hace **K1-K4**
(mecánicas de engine: energía, hangar+bay, expedición, árbol de fases).

**NO TOQUES:** `src/engine/station.js`, `src/engine/nav.js`,
`src/render/render.js`, `src/render/render3d.js`, `src/core/data.js` (wall
kinds / OBJECT_DEFS base), tests de engine/station. Tu handoff va en
AGENTIC_REVIEW.md como **§6.22** (formato §5), tras este brief y la §6.20.

---

## T1 — Librería de objetos (suite de objetos)

Catálogo **data-driven** de objetos decorativos (no necesariamente
interactuables). Empieza con 8-12 defs: cama, rack de datos, mesa,
taquilla/locker, luz de pared, silla, servidor, panel de control, planta
(existente), etc.

- **Def:** `{ id, name, footprint (≤1 tile por defecto), h (altura en tiles),
  colors: { top, side }, solid: bool, cat: 'decor' }`.
- **Ubicación:** archivo NUEVO `src/core/objects_lib.js` — datos puros, sin
  DOM, cargable en Node (doctrina del proyecto).
- **Toolbox:** la herramienta "Objeto" (tecla 6) gana sub-selector del catálogo
  (lista con nombres); colocar pinta la instancia elegida. **La "Consola"
  (tecla 7) se mantiene como herramienta dedicada aparte** — NO entra en el
  catálogo genérico (orden expresa de -XONO).
- **Render:** los objetos genéricos hoy usan colores default
  (`COLORS.objTop/objSide`). Para color por def, añade el campo `colorKey` (o
  `colors`) en las defs y déjalo marcado como **"Integración pendiente Rector"**
  en tu handoff — yo lo engancho en render/render3d (mapa colorKey→paleta).
  Mientras tanto todo puede verse con la paleta default.
- **Tests:** catálogo válido (ids únicos, footprints y paletas bien formadas),
  colocación respeta `solid`, la consola NO aparece en el catálogo.

## T2 — Reactor/Generador placeholder (módulo ≥ 5×5)

- **Blueprint de módulo** "Reactor" (categoría energía): tamaño **mínimo 5×5**
  (la suite debe rechazar redimensionar por debajo), suelo técnico +
  auto-bordes, y un objeto central placeholder (una def de T1, p.ej.
  'reactor_core', o caja procedural existente).
- **Metadatos:** `provides.energy = 100` (TW), `cost` en CRED razonable,
  `energyUse = 0`, descripción corta. (Mapa mental F1: generador 100TW,
  balance ~63-70TW de consumo.)
- **El puente YA EXISTE:** `toModuleDef()` → `station.placeModule()` →
  `recompute()` suma `provides.energy` / `energyUse` automáticamente. **No
  toques station.js.**
- **Tests:** reactor ≥5×5 válido (rechaza 4×4), metadatos viajan en
  export/import de la biblioteca.

## Contratos de trabajo

- Rama propia + PR (PROMPT_MAESTRO §5.3). **Nada de commits directos a main.**
- `node tests/run.js` en verde antes de declarar entrega; incluye en tu handoff
  qué probaste a mano y qué NO.
- La palabra de seguridad NO aplica a PRs normales (solo a CLI_RECTOR_PUSH).
- Integraciones que necesites del Rector (render de nuevos objetos, lectura de
  energía en HUD): anótalas en tu handoff como **"Integración pendiente
  Rector"** y continúa con lo demás sin bloquearte.

— Kimi K3 (Rector)
