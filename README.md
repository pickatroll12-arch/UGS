# UGS — Station Builder

Constructor de estaciones espaciales en el navegador. **Vanilla JS + Canvas 2D, sin build, sin dependencias de runtime.**

> ⚠️ **ESTADO: REVAMP TOTAL (2026-07-24).** Todo el código anterior fue purgado por decisión de los 3 colaboradores humanos. Esta es la base nueva, construida desde cero siguiendo `REVISION MAESTRA 2` y la filosofía de estructura de `PROMPT_MAESTRO.md`. Léelos antes de tocar nada.

## Documentos rectores (en este orden)

1. **`REVISION MAESTRA 2`** — la visión y el estándar maestro del proyecto (objetivos OBJP-1/1.1/2, definiciones, gobernanza).
2. **`PROMPT_MAESTRO.md`** — la estructura del código y las reglas de trabajo para TODO agente (actual o futuro). Es el "prompt" que cualquier IA debe seguir.
3. **`AGENTIC_REVIEW.md`** — registro de coordinación entre agentes (handoffs, veredictos del Rector).
4. **`Feedback humano`** — canal exclusivo de los 3 colaboradores humanos. Los agentes solo leen.

## Estructura del código

```
index.html            shell: canvas + menú + topbar (sin lógica de juego)
src/
  core/               [COMPONENTES LÓGICOS — base]
    core.js           ids, EventBus síncrono, FixedTimestep, helpers
    data.js           modelo: Estación → Nexo → Sala → Tile/Pared/Objeto (+contratos C1-C3)
    save.js           persistencia JSON (formato v1, sin legacy)
  engine/             [COMPONENTES LÓGICOS — juego]
    engine.js         runtime PRE-CARGADO POR NEXO (eventos declarativos de sala)
    nav.js            A* click→ruta (4-dir, determinista)
    agents.js         el PCJ ("mono"): movimiento solo por click→ruta
  render/             [RENDERIZADOR GRÁFICO]
    render.js         canvas 2D, vista ¾ ortogonal tipo Xenonauts (C4): diamante, paredes extruidas, fade de oclusión
  app/
    app.js            pegamento: modos (menú/dev/juego), cámara, input, bucle
tests/
  run.js              runner sin dependencias (node tests/run.js)
  core.test.js        core + data + save (contratos de colisión incluidos)
  engine.test.js      nav + engine + agents + matemáticas de picking/yaw
```

## Reglas de oro (resumen; el detalle está en PROMPT_MAESTRO.md)

- **Lógica y renderizador NUNCA se mezclan.** `core/` y `engine/` no importan nada de `render/` (excepción única: `engine.js` usa matemáticas de pose de `render.js`; `render.js` jamás muta estado).
- **Lógica PRE-CARGADA POR NEXO** (Nexo = nivel/fase). No hay life-sim global: cada Nexo declara su lógica en datos y el engine la ejecuta solo mientras ese Nexo está cargado.
- **Toda pared bloquea su tile completo.** Siempre. (Contrato C1, nacido del feedback humano.)
- **Determinismo:** el engine avanza a paso fijo (`FixedTimestep`), nunca con wall-clock.
- **Tests en verde antes de cualquier entrega:** `npm test` (59 checks hoy; solo crece).

## Cómo correr

- **App:** abrir `index.html` en un navegador (o GitHub Pages del repo).
- **Tests:** `npm test` (requiere solo Node ≥ 18).

## Controles (base actual)

| Acción | Control |
|---|---|
| Rotar vista (¾, pasos de 90°) | `Q` / `E` |
| Zoom anclado al cursor | rueda del ratón |
| Pan | arrastrar (cualquier botón) |
| Pausa (en juego) | `Espacio` |
| Caminar (en juego) | click en un tile |
| Abrir puerta (en juego) | click en la puerta |
| Viajar de Nexo (en juego) | click en el ascensor (▣) |

## Gobernanza

Los agentes de IA (Kimi K3, Claude, Codex) trabajan bajo supervisión humana obligatoria: nada entra a `main` sin handoff en `AGENTIC_REVIEW.md` y validación de los 3 colaboradores. Ver `REVISION MAESTRA 2` §GOBERNANZA y `PROMPT_MAESTRO.md` §6.
