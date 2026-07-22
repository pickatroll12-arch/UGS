# UGS — Current Objective & Revised Stage 1 Plan

> Follow-up to `AGENTIC_REVIEW.md`.
>
> This document replaces the assumption that Stage 1 is ready to move directly
> into Stage 2. The current objective is to **continue developing Stage 1:
> engine, editor, and core mechanics** until the foundation is genuinely
> comfortable, understandable, and extensible.

---

## 1. Current direction

The project should **not** start Stage 2 yet.

Crew roles, autonomous NPC routines, A-life, economy, and station subsystems
are still future work. Before those systems begin, the existing Stage 1 engine
needs another development pass focused on:

- Editor usability
- Room editing depth
- Core-mechanic clarity
- UI language support
- Better separation between tools, inspector, map, and simulation state
- More complete room manipulation
- A less cramped and more intuitive build experience

The current playable slice proves the architecture, but the builder itself is
not yet polished enough to serve as the long-term foundation.

---

## 2. Human feedback to address

Feedback from human testing:

> “Build menu too cramped, un-intuitive, no Spanish support.”

This should be treated as a core milestone, not cosmetic polish.

A builder that users cannot understand will produce bad maps and make every
future system harder to test. The editor is part of the engine.

### Required response

The next pass must improve:

1. **Layout** — reduce cramped controls and group actions more clearly.
2. **Learnability** — make tools explain themselves through labels, hints,
   tooltips, and predictable behavior.
3. **Localization** — support English and Spanish from the UI layer upward.
4. **Mode clarity** — make Build and Play feel like two states of one
   workspace, not two unrelated screens.
5. **Room control** — rooms must be editable as real structural units,
   including resizing.

---

## 3. Current known gaps

### 3.1 Rooms cannot be resized at will

Rooms currently have a fixed `size.w` / `size.h` after creation. The demo can
seed different sizes, and imported data can contain different sizes, but the
editor does not provide a proper resize workflow.

A real station builder needs:

- Resize existing rooms
- Add/remove rows and columns
- Preserve existing tiles and objects where possible
- Choose or understand the resize anchor
- Avoid silently deleting content
- Keep entry points, pawns, links, and room events valid
- Undo/redo the operation safely

### 3.2 Build and Play share the same workspace, but not clearly enough

Build and Play already live in the same page/canvas. That is correct.

The problem is not that they need separate menus. The problem is that the mode
transition should feel more intentional:

- Same station
- Same camera context
- Same level
- Clear mode state
- Clear restrictions while playing
- Safe return to editing
- No accidental destructive edits during simulation

The goal is **one workspace with two modes**, not two separate apps.

### 3.3 The build UI is too dense

The current side panel packs too many controls into a narrow column:

- Mode controls
- Deck controls
- Tabs
- Tools
- Palettes
- Filters
- Layers
- Room controls
- Save controls
- Inspector
- Motion controls

The information is functional but not yet comfortable.

### 3.4 No localization layer

UI strings are hard-coded in `index.html` and `editor.js`. Spanish support
cannot be added cleanly without introducing a localization system first.

### 3.5 Documentation currently says Stage 1 is complete

Stage 1 was complete as an **engineering milestone**, but it is not complete as
a **usable editor/core experience**.

The roadmap should eventually distinguish:

- Stage 1 engineering slice: complete
- Stage 1 revised production foundation: in progress

---

## 4. Revised objective statement

> Build UGS into a usable, bilingual, room-oriented station editor and runtime
> where maps can be constructed, resized, connected, animated, tested, saved,
> and understood without fighting the interface.

Stage 2 begins only after that is true.

---

## 5. Proposed revised Stage 1 plan

The following milestones extend Stage 1 rather than replacing it.

---

# Phase S1-R0 — Baseline and safety net

Before changing the editor, make the current state easier to test.

## Goals

- Keep every existing test green.
- Make tests easier to run.
- Prevent regressions while UI and room logic change.

## Tasks

1. Add a minimal `package.json`.
2. Add a single test command that runs:
   - `src/core.test.js`
   - `src/data.test.js`
   - `src/engine.test.js`
   - `src/nav.test.js`
3. Fix the nav-test count mismatch in `ROADMAP.md`.
4. Expand `README.md` with:
   - How to open the app
   - How to run tests
   - Current project structure
   - Link to `ROADMAP.md`
   - Link to `AGENTIC_REVIEW.md`
5. Optionally add GitHub Actions after the test command exists.

## Acceptance criteria

- One command runs all current Node tests.
- Current tests still pass.
- README explains the project without requiring outside context.

---

# Phase S1-R1 — Localization foundation

Spanish support should be added as a system, not by manually replacing labels.

## Goals

- English and Spanish UI support.
- Centralized strings.
- Easy addition of more languages later.
- No hard-coded user-facing copy inside tool logic.

## Tasks

1. Add `src/i18n.js`.
2. Create dictionaries:
   - `en`
   - `es`
3. Add a language selector to the UI.
4. Add a `t(key, params)` translation helper.
5. Add support for `data-i18n` attributes in static HTML.
6. Move dynamic editor/status strings into translation keys.
7. Persist the selected language in `localStorage`.
8. Default to browser language when available, falling back to English.

## Initial translation scope

- Mode names
- Tool names
- Tab names
- Material names
- Object names
- Inspector labels
- Common status messages
- Save/load messages
- Error messages
- Play controls

## Acceptance criteria

- Switching language updates the visible UI without reloading.
- Unknown translation keys fail visibly during development.
- English and Spanish both work.
- The save format remains language-neutral.

---

# Phase S1-R2 — Editor layout redesign

The current left panel should be broken into clearer regions.

## Recommended layout

```text
┌──────────────────────────────────────────────────────────┐
│ Top bar: UGS · language · deck · Build/Play · save state │
├───────┬──────────────────────────────────────┬───────────┤
│ Tool  │                                      │ Inspector │
│ rail  │              Map canvas              │ / context │
│       │                                      │ panel     │
├───────┴──────────────────────────────────────┴───────────┤
│ Bottom bar: palettes · hints · current action/status    │
└──────────────────────────────────────────────────────────┘
```

## Goals

- Keep the map visible.
- Make frequently used tools easy to reach.
- Move contextual options away from the main tool list.
- Avoid forcing the user to scroll through unrelated controls.

## Tasks

1. Add a compact top bar:
   - Project/save name
   - Current deck
   - Build/Play toggle
   - Language selector
   - Import/export indicator
2. Add a vertical tool rail:
   - Select
   - Floor
   - Wall
   - Object
   - Entry
   - Erase
   - Fill
   - Link
3. Add a right inspector panel:
   - Tile details
   - Object details
   - Room details
   - Link details
   - Motion controls
4. Add a contextual bottom bar:
   - Current brush/material/object
   - Current action hint
   - Current selection summary
5. Keep the existing tabbed controls temporarily as a fallback if needed, but
   move toward the clearer layout.

## UX rules

- Every tool needs a short hint.
- Destructive actions need clearer visual treatment.
- Current mode must always be visible.
- Current brush must always be visible.
- Save/load controls should not dominate the build workflow.

## Acceptance criteria

- The user can reach every core tool without scrolling the main panel.
- The inspector only shows context-relevant controls.
- The map has more visible space than in the current build.
- The interface remains usable at approximately 1280×720.

---

# Phase S1-R3 — Room resizing

Rooms must become editable structural units.

## Goals

- Resize any existing room.
- Preserve as much content as possible.
- Make destructive changes explicit.
- Keep all dependent data valid.

## Tasks

### Data/model

1. Add a pure room-resize function to the data layer.
2. Support:
   - New width
   - New height
   - Resize anchor
3. Preserve overlapping tiles.
4. Preserve objects that remain inside the new bounds.
5. Decide what happens to objects outside the new bounds:
   - Block the resize
   - Move them
   - Delete them only after confirmation
6. Keep room events attached to the room.
7. Keep the room transform valid.

### Editor

1. Add room size controls to the room inspector.
2. Add width/height inputs.
3. Add resize anchor choices:
   - Top-left
   - Center
   - Bottom-right
4. Show a preview before applying shrink operations.
5. Warn when resizing would remove tiles or objects.
6. Add full undo/redo support.

### Dependent data

After resize, validate or repair:

- Level entry point
- Pawn location
- Link endpoints
- Room event handles
- Room outlines
- Navigation grid
- Selection state

## Acceptance criteria

- Enlarging a room preserves all existing content.
- Shrinking a room cannot silently delete objects.
- Entry points never point outside a room.
- Links never point outside a room after resize.
- Undo restores the previous size and contents.
- Data-layer tests cover resize behavior.

---

# Phase S1-R4 — Room selection and manipulation UX

Room operations should not depend on selecting an arbitrary tile first.

## Goals

- Make rooms first-class selectable entities.
- Make room boundaries and controls obvious.

## Tasks

1. Add a dedicated room selection mode or improve Select behavior.
2. Show clear room outlines.
3. Show room name near the outline or inspector.
4. Add room-level actions:
   - Rename
   - Resize
   - Duplicate
   - Move
   - Rotate
   - Delete
5. Add a room list in the inspector or deck panel.
6. Make clicking a room outline or room list select the whole room.
7. Keep tile/object selection available without conflict.

## Acceptance criteria

- The user can identify which room is selected.
- The user can find resize and motion controls without hunting.
- Room-level operations do not interfere with tile painting.

---

# Phase S1-R5 — Build/Play workspace model

Build and Play should remain in the same place, but the transition needs to be
clearer and safer.

## Goals

- One shared workspace.
- Explicit mode state.
- No accidental edits while simulation is running.
- Smooth return to Build.

## Tasks

1. Replace the small mode buttons with a visible mode switch in the top bar.
2. Add a clear Play overlay or status chip:
   - Simulation running
   - Paused
   - Speed
3. Disable or hide destructive editing tools in Play.
4. Preserve camera position when switching modes.
5. Preserve the active deck when possible.
6. On returning to Build:
   - Stop the simulation
   - Restore authored room poses
   - Restore editing tools
7. Make it obvious when undo/redo are unavailable in Play.

## Acceptance criteria

- The user always knows whether they are building or simulating.
- The map does not jump unexpectedly when switching modes.
- Play mode cannot accidentally mutate the saved design.
- Build mode restores the authored state reliably.

---

# Phase S1-R6 — Tool clarity and onboarding

The editor should explain itself while remaining compact.

## Tasks

1. Add tooltips to every tool.
2. Add a bottom hint line that changes with the active tool.
3. Add small empty-state explanations:
   - No selection
   - No room selected
   - No links yet
   - No motion events yet
4. Improve tool grouping:
   - Paint tools
   - Structure tools
   - Object tools
   - Deck/link tools
5. Add icons only when labels remain clear.
6. Add a short first-run help overlay, dismissible and available later.

## Acceptance criteria

- A new user can identify what each tool does without reading the source.
- Spanish and English hints both work.
- The UI does not depend on emoji alone.

---

# Phase S1-R7 — Geometry and rotation consistency

The long-term goal is tile-like control without a voxel-looking station.

## Current problem

The editor currently mixes:

- 90° room rotation
- 45° object rotation
- Smooth runtime room animation
- Diagonal wall visuals that still block the full tile

## Tasks

1. Decide the official authoring rotation step:
   - 30°
   - 45°
   - 90°
   - configurable
2. Apply that rule consistently to:
   - Object rotation
   - Room rotation
   - Rotation handles
   - Save normalization
3. Decide whether diagonal walls remain full-tile blockers for now.
4. If they remain blockers, document that clearly in the UI.
5. Reserve future support for:
   - Circular room outlines
   - Partial-tile collision
   - Polygonal navigation

## Acceptance criteria

- Rotation behavior is predictable.
- Rotation steps are documented in the editor.
- Diagonal wall behavior is not misleading.

---

# Phase S1-R8 — Link and deck workflow polish

Multi-deck support exists, but its authoring flow can be made easier.

## Tasks

1. Show existing links in a deck/link list.
2. Allow selecting a link from the list.
3. Highlight both endpoints when a link is selected.
4. Allow deleting a link without finding its tile manually.
5. Add link type selection:
   - Elevator
   - Door
   - Hatch
   - Custom placeholder
6. Clarify preload vs stream in the UI.
7. Add warnings for links attached to moved/resized/deleted rooms.

## Acceptance criteria

- Links can be inspected without reading the save JSON.
- Broken or suspicious links are visible.
- The user understands what preload and stream currently mean.

---

# Phase S1-R9 — Motion/event editor polish

Room motion is powerful but needs clearer authoring.

## Tasks

1. Show all motion events in the room inspector.
2. Explain trigger types:
   - Manual
   - Time
   - Signal placeholder
3. Add event enable/disable controls.
4. Add preview playback for a selected event.
5. Add clearer trajectory colors and labels.
6. Add validation for missing orbit center/radius or empty carousel poses.
7. Keep script events structured rather than free-form code for now.

## Acceptance criteria

- A user can tell what an event will do before pressing Play.
- Invalid or incomplete events are visibly marked.
- Motion authoring works in both English and Spanish.

---

# Phase S1-R10 — Stage 1 revised exit criteria

Stage 2 can begin only when all of the following are true:

## Editor

- The UI is not cramped at normal desktop sizes.
- Core tools are accessible without excessive scrolling.
- English and Spanish UI are available.
- The user can identify the current mode, tool, brush, room, and selection.

## Rooms

- Rooms can be created.
- Rooms can be selected clearly.
- Rooms can be resized safely.
- Rooms can be moved, rotated, duplicated, and deleted.
- Dependent data remains valid after resize.

## Runtime

- Build and Play feel like one workspace.
- Play mode cannot accidentally corrupt the authored design.
- Pawns still move correctly.
- Links still work.
- Moving rooms still carry pawns.

## Data

- Save/load round-trips all new fields.
- Resize operations are covered by data tests.
- New UI strings are outside the save format.

## Tests

- All previous suites remain green.
- New room-resize tests exist.
- New localization tests exist where practical.
- Editor smoke tests cover the redesigned layout.

---

## 7. Recommended implementation order

The safest order is:

1. **S1-R0** — baseline test command and docs
2. **S1-R1** — localization foundation
3. **S1-R2** — layout redesign
4. **S1-R3** — room resizing
5. **S1-R4** — room selection/manipulation UX
6. **S1-R5** — Build/Play workspace clarity
7. **S1-R6** — tool onboarding and hints
8. **S1-R7** — geometry/rotation consistency
9. **S1-R8** — links/deck polish
10. **S1-R9** — motion/event polish

This order avoids redesigning the UI twice and prevents room resizing from
being built on top of unclear selection behavior.

---

## 8. What not to build yet

Do not start these during the revised Stage 1 pass:

- NPC routines
- A-life
- Crew jobs
- Needs or schedules
- Economy
- Mining gameplay
- Combat
- Research
- Diplomacy
- General station subsystem simulation
- Final graphics
- Texture packs
- Audio

Those features depend on the editor and engine becoming comfortable first.

---

## 9. Architecture rules for this phase

All revised Stage 1 work must preserve:

1. Room-local coordinates.
2. Room transforms as first-class data.
3. Simulation/render separation.
4. Deterministic fixed-step simulation.
5. Versioned save/load.
6. Pluggable systems.
7. Language-neutral save data.
8. Mechanics before graphics.

UI polish in this phase is not “visual polish.” It is usability work required
for the engine to be viable.

---

## 10. Rector note

This revision is correct. Stage 1 proved that the engine can work; it did not
yet prove that a human can comfortably build with it.

The next objective is therefore not “more features.” It is:

> Make the existing engine understandable, resizeable, bilingual, and safe to
> use before adding autonomous complexity.

---

## 11. Progress log

- **S1-R0 — Baseline & safety net — ✅ done.** `package.json` + `npm test`
  running an auto-discovering aggregate runner (`scripts/run-tests.js`); CI
  workflow; rewritten `README.md`; ROADMAP nav-count fix. All suites green.
- **Owner decision — default station — ✅ done.** App start and `New` now
  produce one deck, one empty room (floor + ring walls + entry) — no seeded
  objects, decks, motion, or links.
- **S1-R1 — Localization foundation — ✅ done.** `src/i18n.js` (en/es
  dictionaries, `t()` with interpolation, English fallback, visible ⟦marker⟧
  for missing keys, `data-i18n` / `data-i18n-attr` DOM binding, `localStorage`
  persistence, browser-language default). Language selector in the panel;
  static markup, palettes, inspector, status, and play bar all switch language
  live without reload. Materials/objects/layers/wall-shapes translate **by id**,
  so the save format stays language-neutral. `src/i18n.test.js` (19 tests,
  incl. en/es key parity). Rotation-step decision (owner: segmented/360°)
  deferred to S1-R7.
- **S1-R2 — Editor layout redesign — ✅ done.** Replaced the single cramped
  250 px panel with four regions: a top bar (brand · deck switcher · language ·
  Build/Play toggle), a vertical left tool rail (8 tools + undo/redo, icon +
  label), a right side panel (Inspector always on top; collapsible Decks /
  Layers / Room motion / Package sections), and a contextual bottom bar that
  shows only the active tool's palette (select-filter / floor / wall / object)
  plus a live tool hint. Play mode hides the bottom bar and shows the play bar.
  Verified headless at 1280×720: all regions present, no overflow, palettes
  switch per tool, EN/ES live — no clipping (the old Spanish clipping is gone).
- **S1-R3 — Room resizing — ✅ done.** Pure `data.resizeRoom(room, w, h, {anchor,
  fill, force})`: clamps 1..64, anchors nw/center/se, preserves overlapping
  tiles + objects, fills new tiles, clamps the rotation pivot, and (owner rule)
  a shrink that would drop objects returns `{ok:false, wouldDrop}` **without
  mutating** unless `force` is set — it never deletes silently. Inspector gains
  a size row (W × H + anchor + Resize); the editor confirms before a
  destructive shrink, then repairs the level entry, link endpoints, and
  selection by the applied offset, all under one undo step. Tests: +12 in
  `data.test.js` (enlarge/center/blocked-shrink/forced-shrink/pivot/clamp);
  headless-verified the full UI flow incl. confirm accept/dismiss and undo.
- **S1-R4 — Room selection & manipulation UX — ✅ done.** New "Rooms" side-panel
  section lists the active deck's rooms (name + size + object count); clicking a
  row selects the whole room and highlights it (the renderer already draws a
  bright outline for the active room). Consolidated room-level actions: Add
  (empty floor+walls room, auto-placed clear of others), Duplicate, Delete, and
  inline Rename. Delete guards the last room, confirms first, drops attached
  links, and repoints the deck entry to a surviving room. Room list stays in
  sync on selection, deck switch, and language change. Headless-verified
  add/duplicate/rename/select/delete + last-room guard + entry repair.
- **S1-R5 — Build/Play workspace model — ✅ done.** One workspace, two clearly
  separated modes. Entering Play shows a pulsing "● Simulating" chip in the top
  bar and makes every editing control inert — the tool rail and the mutating
  side-panel sections (Decks, Rooms, Package) are dimmed + `pointer-events:none`
  + grayscale; the bottom-bar palette is hidden and the play bar shows instead.
  Defense in depth: a `requireBuild()` guard no-ops undo/redo and every
  room/deck/resize mutation in Play (translated "Switch to Build to edit."
  status). Camera and active deck are preserved across the switch; returning to
  Build stops the sim and restores authored room poses (engine is
  non-destructive). Headless-verified: chip shown, rail inert, room animates in
  Play then snaps back to its authored transform in Build, edits blocked,
  camera identical across modes.
- **S1-R6 — Tool clarity & onboarding — ✅ done.** Every tool already has a
  tooltip (data-i18n-attr title) and a live one-line hint in the bottom bar;
  empty states are covered (Inspector "nothing selected", Rooms "no rooms",
  "no motion events"). Added a dismissible first-run help overlay (Welcome +
  Build/Play, Tools, Rooms/decks, Saving) shown once via a `localStorage`
  flag, reopenable with a top-bar "?" button, closable via Got it / backdrop /
  Escape, fully localized. Headless-verified first-run show, persist, reopen,
  Escape, es localization, and no-show on the second run.
- **S1-R7 — Geometry & rotation consistency — ✅ done.** Unified the authoring
  rotation step on **45°** (owner delegated the choice). `data.snapAngle` +
  `ROT_STEP` are the single source: objects rotate 45°, the room rotate gizmo
  snaps via `snapAngle`, and `createTransform` / object normalization snap on
  load — so a 45°/135° pose now survives a save round-trip (previously rooms
  snapped to 0/90/180/270). 45° divides 360 evenly and keeps legacy cardinal
  rooms valid. Documented in the UI: the wall-tool hint states diagonal shapes
  still block the whole tile; the room map hint notes 45° steps. Tests: +5 in
  `data.test.js` (snapAngle rounding/wrap/cardinals, createTransform snap);
  engine/orbit suites unaffected (rotate-by-90 motion still valid).
- **Next: S1-R8 — Link & deck workflow polish** (list existing links, select +
  highlight endpoints, delete without hunting the tile, clarify preload/stream).
