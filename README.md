# UGS

**UGS** is an isometric, top-down space-station builder and life-sim engine,
built with plain HTML5 + Canvas 2D — **no build step, no bundler, no server**.
The long-term vision is a station manager with STALKER-style autonomous NPCs
(A-life). The current work is **Stage 1**: a solid map/level engine plus a
**Station Builder** editor.

> Design philosophy: **mechanics before graphics**, and a strict
> **simulation / rendering separation** so the renderer can be upgraded later
> without rewriting the data model, pathfinding, simulation, or save format.

---

## Running the app

There is no build step. Open the editor directly in a browser:

```
# just open the file — file:// works, no server needed
index.html
```

All game code lives under `src/` as classic `<script>` files that hang off a
single `window.UGS` namespace, loaded in dependency order by `index.html`.

- **Build mode** — paint floors/walls, place objects, set entry points, link
  decks, and author room motion (shift / rotate / orbit / carousel).
- **Play mode** — run the deterministic simulation: click a floor tile to walk
  the pawn, a door to open it, an elevator to change deck. Pause + 1×/2×/3×.

Maps export/import to a versioned JSON save file (file-picker only — no fetch).

---

## Running the tests

The core, data, simulation, and navigation modules run headlessly in Node
(they use UMD tails, so the same files load in the browser and in Node).

```
npm test          # runs every src/*.test.js suite and prints a grand total
```

Or run a single suite directly:

```
node src/core.test.js
node src/data.test.js
node src/engine.test.js
node src/nav.test.js
```

The runner (`scripts/run-tests.js`) auto-discovers any new `src/*.test.js`.

### Browser smoke tests

A headless Playwright/Chromium pass exercises the real editor end to end (boot,
i18n statuses, destructive-resize warning, and a full elevator round-trip that
proves room motion survives deck transitions — incl. pause and speed 3):

```
npm install                                   # first time only (Playwright)
npx playwright install --with-deps chromium   # first time only (browser)
npm run smoke
```

In the managed dev environment Chromium is pre-installed and the runner finds
Playwright automatically, so `npm run smoke` works without the install steps.

---

## Project structure

```
index.html            Station Builder app (loads src/* in dependency order)
package.json           npm test → scripts/run-tests.js
scripts/run-tests.js   aggregate Node test runner

src/
  core.js     heavy-core foundation: seeded RNG, EventBus, FixedTimestep,
              Grid2D, Pool, math helpers            (+ core.test.js)
  data.js     schemas / factories / registries: materials, objects, layers,
              rooms, room events, save file          (+ data.test.js)
  save.js     serialize / deserialize, versioned migrations, export/import
  render.js   stateless isometric renderer (world<->screen, picking, draw)
  engine.js   deterministic fixed-step simulation, room-motion runtime
              (+ engine.test.js)
  nav.js      8-directional A* pathfinding (binary heap, typed arrays)
              (+ nav.test.js)
  agents.js   pawn manager installed as an engine system
  editor.js   the Station Builder application (tools, inspector, modes)

sandbox/      early movement prototype (kept for reference, not the app)
```

Rooms store their tiles, objects, and pawns in **room-local coordinates**; a
room-level transform (offset + rotation + pivot) composes them into world space
at draw time, so a moving room carries its contents unchanged.

---

## Documentation

- [`ROADMAP.md`](ROADMAP.md) — vision, the Captain + 3-crew MVP, and the Stage 1
  milestones (M1–M6) with per-milestone notes.
- [`AGENTIC_REVIEW.md`](AGENTIC_REVIEW.md) — reviewer/rector notes: validated
  strengths, architectural gaps, and performance considerations.
- [`CURRENT_OBJECTIVE.md`](CURRENT_OBJECTIVE.md) — the active plan: a revised
  Stage 1 usability pass (editor layout, localization, room resizing) that must
  land before Stage 2 begins.

---

## Architecture rules (do not break)

1. Room-local coordinates; room transforms are first-class data.
2. Simulation / render separation — `render.js` never owns game logic.
3. Deterministic fixed-timestep simulation (seeded RNG, reproducible saves).
4. Versioned, normalized save/load; save data stays language-neutral.
5. Pluggable engine systems (agents, and future crew/events, install as systems).
6. Mechanics before graphics.
