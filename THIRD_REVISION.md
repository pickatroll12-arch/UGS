# THIRD REVISION (REV3) — fixes from direct human feedback

> Written by the secondary implementation lead (Kimi) and **already implemented**
> in this branch. This document tells Claude (and future agents) WHAT changed,
> WHY, and what is explicitly off-limits for regression.
>
> Source of truth for the complaints: `Feedback humano` (read-only, do NOT edit
> that file — it's the human's direct channel).

---

## HF-01 — Non-block walls had "no collision" (the pawn walked through them)

**Human report:** diagonal/rounded walls don't collide; the pawn passes through.

**Diagnosis:** the R2-06 phase-2 partial collision was working *numerically*
(closed side blocked, open side passable), but a partial wall's tile stays
walkable and the pawn renders at the tile CENTRE — visually inside the drawn
wall triangle. Read from the player's seat: "it walks through the wall".

**Fix (implemented):**
- `src/data.js — createWall()`: **every** wall kind now defaults to
  `collision: 'full'` (block, diagonal, rounded alike). A default diagonal or
  rounded wall blocks its whole tile; the pawn cannot enter it.
- Partial collision is now **opt-in** per piece (`createWall(kind, deg, mat,
  'partial')`). The entire partial-collision nav machinery (R2-06 ph2:
  `dirClosed`, `crossBlocked`, quadrant table) is intact and tested — do not
  remove it; real partial collision returns in Stage 2 with sub-tile pawn
  positions, and at that point the default can be revisited.

**Regression guards:** `src/data.test.js` (all kinds default full, explicit
partial wins), `src/nav.test.js` (default diagonal tile unwalkable + full
opt-in partial suite), smoke `REV3: default diagonal wall blocks its whole
tile`.

## HF-02 — Camera: the "45° turn" just slides the map diagonally; wanted: true flat top-down view

**Human report:** Q/E is useless — it only skews the map. What works would be
a view from straight above: flat map, no tilt at all.

**Diagnosis:** R2-03 only changed the iso diamond's height (32↔52px). It never
rotated anything and never produced a plan view.

**Fix (implemented):**
- `src/render.js`: new third projection **`topDown`** — a true orthographic
  plan: axis-aligned **square** cells (64×64 @ zoom 1), zero tilt.
  - `worldToScreen`/`screenToWorld` branch for `topDown`; everything else
    (room transforms, picking, camera anchoring) still routes through those
    two functions, so nothing else had to change conceptually.
  - New `tileAt()` primitive: diamond in iso, square in plan (floors,
    highlights). `wallPolygon()` accepts a `topDown` flag and uses the square
    corners (TL,TR,BR,BL) — same index order, so orientation semantics carry
    over.
  - Walls render **flat** in plan view (no vertical extrusion); objects render
    as flat inset pads with a rotation tick (`drawObjectFlat`); the pawn
    renders as a disc with a heading tick (`drawPawnFigureFlat`), with facing
    math switched to plan coordinates.
  - `pickTopmost()` hit-tests flat silhouettes in plan view.
  - `isTopDown(cam)` is exported for any future projection-aware code.
- Q/E cycles `isoTilted → isoFlat → topDown` (editor's `cycleProjection` reads
  `PROJECTION_IDS`, so it picked the new view up with no editor change).
- i18n: `proj.topDown` = "Top-down (plan)" / "Cenital (plano)".

**Regression guards:** smoke `REV3 projection: E reaches the top-down plan
view`, `top-down uses square axis-aligned cells`, `picking round-trips in the
plan view`.

## HF-03 — Game mode still shows "Simulating"

**Human report:** in game mode the UI says "simulación" — it shouldn't (and is
it really simulating or is it a bug?).

**Diagnosis:** it IS really simulating (smoke asserts `running === true` in
Game mode). The chip is dev vocabulary leaking into the game fiction.

**Fix (implemented):**
- `index.html` CSS: `#simChip` now shows only under `body.mode-dev.playing`
  (Dev test-play). In Game mode (`mode-game`) it stays hidden. The simulation
  itself is untouched.

**Regression guards:** smoke `REV3: "Simulating" chip hidden in Game mode` +
`REV3: "Simulating" chip still shown in Dev test-play`.

---

## Verification status

- `npm test` — **164 passed, 0 failed** (6 suites).
- `npm run smoke` — **44 passed, 0 failed** (incl. all BUG-01 elevator
  round-trips and the 8 new REV3 checks).
- Visual check: plan view renders square cells, flat diagonal/block walls,
  object pads with rotation ticks, pawn disc with heading.
- REV3.1 verified against the human's own TEST map: 18 stored partial walls
  migrate to full on import; all 18 tiles report blocked in nav.

## Notes for Claude

- **REV3.1 (second feedback round):** REV3 changed the *default*, but saves
  authored before it store `collision: 'partial'` explicitly — importing such
  a map re-introduced the walk-through-walls bug. `normalizeSave()` now coerces
  every stored partial wall to `'full'` and reports the count as a warning.
  Guard: `src/data.test.js` "REV3.1: stored partial walls become full on load".
- Do **not** re-enable partial-by-default wall collision without sub-tile pawn
  positions — that's the exact bug the human reported.
- `Feedback humano` is read-only for agents. New human feedback arriving there
  gets its own REV document (REV4, …) triaged the same way.
- Stage 2 remains gated: the wall/nav simplification here is a Stage-1
  decision; sub-tile movement + real partial collision is Stage-2 scope.
