# RELEVO A CLAUDE — Situación completa y tareas (2026-07-27)

Claude: por orden de -XONO, el Rector te releva de sus tareas pendientes.
**Todo lo tuyo + todo lo suyo queda en tus manos.** Lee primero
`PROMPT_MAESTRO.md`, `AGENTIC_REVIEW.md` (§6.20-§6.21) y `BRIEF_CLAUDE_OBJP11.md`.

---

## 1. Estado del repo (verificado hoy, clon limpio)

- **Tests: 293 checks, ALL SUITES GREEN** (audio 49, blueprint 56, core 25,
  engine 66, station 45, toolbox 52 + screens).
- Renderer por defecto: **three.js** (`render3d.js`, §6.14); `?renderer=2d` =
  clásico. Rendimiento resuelto por firma estructural `keyOf` (§6.19) — NO
  reconstruyas la escena por frame, respeta ese patrón.
- OBJP-1.1 **desbloqueado** por orden del organizador (§6.20); firmas
  retroactivas 3/3 pendientes en `Feedback humano` (recuérdalo en tu handoff).

## 2. Hecho por el Rector — NO lo repitas

- **K1 — Energía TW** (commits `8ef60b8`, `db869e3`): agregado
  capacidad/consumo, readout `⚡used/cap TW` en HUD, evento
  `station:blackout` + marca ¡BROWNOUT!, gating de placeModule (ya existía),
  limpieza de instancias al retirar módulos (bug histórico corregido).
- **K2 — Hangar** (`113ac29`, `eaa2931`, `a12fdc6`, `8e7b5bf`, `2ba6938`,
  `c2c15b6`): wall kind `bay` (apertura oscura + marco luminoso, bloquea al
  PCJ como toda pared), objeto `ship` placeholder, capacidad room-first
  (`room.shipCap` seteable con `[`/`]` en dev, `provides.shipCap` por def),
  `station.shipCapacity/freeBerth/addShip` gateado, sync placeholders↔naves
  (tecla `n` amarra, eventos expedition lanzan/retiran), persistencia
  `hangar/shipCap/shipId`, ciclo de pared con tecla `b`.
- Coordinación original del split: `BRIEF_CLAUDE_OBJP11.md` (tu T1/T2 sigue
  vigente tal cual).

## 3. Tus tareas (las tuyas del brief)

- **T1 — Librería de objetos decorativos** (`src/core/objects_lib.js`, datos
  puros): 8-12 defs (cama, rack de datos, taquilla, luz, etc.),
  sub-selector en toolbox bajo "Objeto" (6). **La consola (7) queda FUERA
  del catálogo** (orden expresa). Color por def: declara `colorKey/colors` y
  márcalo "Integración pendiente Rector" en tu handoff.
- **T2 — Reactor placeholder**: blueprint ≥5×5 (rechaza menor),
  `provides.energy = 100` — el puente a energía ya funciona vía
  toModuleDef→recompute. NO toques station.js.

## 4. Relevadas del Rector (eran K3/K4, ahora tuyas)

- **K3 — Expedición minera F1**: ruta `veta_k7` con 5 etapas ×60 s y
  rendimiento decreciente por etapa (chances 1.0 / 0.65 / 0.4 / 0.25 / 0.15 —
  mapa mental §6.4), yields `mineral` en UD, `failChance 0.1` (reparación ya
  existe: `repairShip`). El runtime YA existe (`defineRoute`, `launchExpedition`,
  `stepExpeditions`, eventos): tu trabajo es el CONTENIDO (def de la ruta
  registrada al boot en app.js) + **UI de lanzamiento**: en modo juego, con una
  nave idle en hangar, una acción "Expedir nave" (tecla o botón sencillo) que
  llame `station.launchExpedition(station, 'veta_k7', shipId)`, más estado en
  HUD/barra (fuera: etapa X/5; de vuelta: entregado). Los placeholders ya se
  sincronizan solos (K2). Tests: determinismo de la ruta completa con semilla.
- **K4 — Árbol de fases F1 (contenido)**: defs de hitos del mapa mental (§6.4):
  F1 = Hangar → Almacén (30UD) → Generador (100TW) → Radar → Habitacional
  (12 PNJ), con `requires` encadenados y `grants.modules` que hagan
  construibles esos módulos vía `s.buildable` (placeModule ya gatea por hito
  cuando el def no es `free`). Límite: `MAX_PHASE=4` ya existe. Recompensas:
  grants en CRED/UD según veas (documéntalo). Registra los defs en app.js al
  boot (o un archivo `src/core/content_f1.js` de datos puros — preferible).
  Ojo: el runtime avanza de fase SOLO cuando TODOS los hitos de la fase están
  desbloqueados — diseña el árbol para que F1 sea completable.
- **§6.21 en AGENTIC_REVIEW.md**: el Rector no llegó a registrar K2 completo;
  incluye en tu próxima entrada una línea de cierre (K1/K2 done, commits
  listados arriba) y luego tu handoff §6.22+.

## 5. Decisiones humanas pendientes de respuesta (preséntalas en tu handoff)

- §6.18: ¿milestone **GLB** (modelos 3D) o **spec sprites v4**?
- §6.13: sprite de consola ¿v3 aprobada o iterar a v1? ¿mismo formato para
  puerta/ascensor/planta?
- §6.12/§6.13: wiring de pantallas **denegado por ahora** — no enganches
  screens.js hasta nueva orden.
- §6.14: ¿vendorizar three.js (~600 KB) o CDN con fallback 2D?

## 6. Lecciones de operación (ahórrate mis fallos)

1. **Canal de pushes**: el MCP `push_files` reemplaza archivos enteros.
   Emisiones >40KB funcionan pero verifica SIEMPRE tras cada push:
   `md5` local vs remoto + `diff`. NUNCA emitas un push con contenido
   placeholder (pasó dos veces: se reparó, quedó registrado).
2. **Binarios**: no emitas PNG/binario por MCP (corrupción de tamaño);
   los assets van referenciados in-situ o los sube un humano.
3. **Sandbox**: `/tmp` se borra sin aviso → clona fresco y guarda copias en
   `/mnt/agents/output/ugs_work/`. El servidor local de smokes muere con cada
   shell: reenciéndolo (`python3 -m http.server 8123`).
4. **Palabra de seguridad**: los pushes directos del CLI del Rector quedan
   `CLI_RECTOR_PUSH` PENDIENTES hasta que **preguntes a -XONO la palabra**
   (ella NO está en el repo; nunca la escribas). Tu flujo es rama+PR y no la
   necesitas.
5. **Tests verdes son requisito, no prueba suficiente**: en tu handoff di qué
   probaste a mano y qué NO (yo verifiqué K2 end-to-end con teclas reales:
   `]`×2 → `n`×2 → 3ª rechazada; haz lo equivalente para T1/T2/K3/K4).

— Kimi K3 (Rector), en relevo por orden de -XONO
