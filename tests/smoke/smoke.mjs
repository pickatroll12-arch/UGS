/*
 * UGS — browser smoke tests.  Run: npm run smoke
 *
 * A reproducible Playwright/Chromium headless pass over the real app. It is the
 * safety net for the whole thing: boot, i18n statuses, destructive resize
 * warning, the top-down plan camera + full-tile wall collision (human feedback
 * that motivated the reset), the reset's [COMPONENTES LÓGICOS] (engine / nav /
 * agents — click→route PCJ, per-Nexo declared room-motion), and a full elevator
 * round-trip that proves motion survives phase transitions, incl. pause/speed.
 *
 * Playwright is resolved from local node_modules first (CI: devDependency),
 * then from a known global install (this managed environment). Chromium is the
 * pre-installed browser (PLAYWRIGHT_BROWSERS_PATH); we never download one.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const require = createRequire(import.meta.url);

function loadPlaywright() {
  const candidates = ['playwright', '@playwright/test', '/opt/node22/lib/node_modules/playwright'];
  for (const c of candidates) {
    try { return require(c); } catch (_) { /* try next */ }
  }
  throw new Error('Playwright not found. Install it (npm i -D playwright) or run in the managed environment.');
}

const { chromium } = loadPlaywright();
const INDEX = pathToFileURL(path.join(ROOT, 'index.html')).href;
const FIXTURE = path.join(__dirname, 'two-deck-orbit.json');

let pass = 0, fail = 0;
const ck = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.error('  FAIL', name, extra != null ? '· ' + JSON.stringify(extra) : ''); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const run = async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto(INDEX);
  await page.waitForFunction(() => !!(window.UGS && window.UGS.editorApp), { timeout: 10000 });
  await page.waitForTimeout(300);

  // SPRITE-01: all renderer sprite assets must resolve from file:// and Pages.
  const spriteAssets = await page.evaluate(async () => {
    const paths = [
      'Sprites/Placeholders/processed/pawn_front.png',
      'Sprites/Placeholders/processed/pawn_side.png',
      'Sprites/Placeholders/processed/pawn_back.png',
    ];
    return Promise.all(paths.map(src => new Promise(resolve => {
      const image = new Image();
      image.onload = () => resolve({ src, ok: image.naturalWidth > 0 && image.naturalHeight > 0, width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => resolve({ src, ok: false, width: 0, height: 0 });
      image.src = new URL(src, document.baseURI).href;
    })));
  });
  ck('sprites: processed pawn assets load', spriteAssets.every(asset => asset.ok), spriteAssets);

  // ── 1. boot: main menu, default station in memory (R2-07) ────────────────
  const boot = await page.evaluate(() => {
    const app = window.UGS.editorApp;
    const lvl = app.save.levels[0];
    return {
      appMode: app.appMode, menuShown: document.body.classList.contains('mode-menu'),
      levels: app.save.levels.length, rooms: lvl.rooms.length,
      objects: lvl.rooms.reduce((n, r) => n + r.objects.length, 0),
    };
  });
  ck('boot: opens on the main menu', boot.appMode === 'menu' && boot.menuShown === true, boot);
  ck('boot: default station is one empty room', boot.levels === 1 && boot.rooms === 1 && boot.objects === 0, boot);

  // enter Dev mode via "New station"; first-run help overlay then shows
  await page.click('#mmNew');
  await page.waitForTimeout(150);
  const dev = await page.evaluate(() => ({
    dev: window.UGS.editorApp.appMode === 'dev',
    help: document.getElementById('helpOverlay').classList.contains('on'),
  }));
  ck('menu: New station enters Dev mode', dev.dev === true);
  ck('dev: first-run help overlay shows on first entry', dev.help === true);
  await page.click('#helpClose');

  // ── 2. language change translates a dynamic status ───────────────────────
  await page.selectOption('#langSelect', 'es');
  await page.waitForTimeout(150);
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
  await page.waitForTimeout(80);
  const esStatus = await page.evaluate(() => document.getElementById('status').textContent);
  ck('i18n: undo status is Spanish', /deshacer/i.test(esStatus), esStatus);

  // ── 3. destructive resize shows a localized warning, cancel leaves no trace ─
  const resize = await page.evaluate(() => {
    const app = window.UGS.editorApp; const r = app.save.levels[0].rooms[0];
    app.selection = { roomId: r.id, lx: 1, ly: 1, objectId: null };
    window.UGS.i18n.setLang('es', { force: true });
    return { w: r.size.w, h: r.size.h };
  });
  await page.waitForTimeout(60);
  // accept the confirm dialog, shrink 12x9 -> 5x5 (trims walls+tiles)
  page.once('dialog', d => d.accept());
  await page.fill('#inspector [data-rz="w"]', '5');
  await page.fill('#inspector [data-rz="h"]', '5');
  await page.click('#inspector [data-act="resize"]');
  await page.waitForTimeout(120);
  const resizeStatus = await page.evaluate(() => document.getElementById('status').textContent);
  ck('resize: localized trim warning shown', /recortad/i.test(resizeStatus) && /5×5/.test(resizeStatus), resizeStatus);

  // ── 3b. tool hotkeys (R2-01): numbers, letter alias, typing guard, R ─────
  const tool = () => page.evaluate(() => window.UGS.editorApp.tool);
  await page.mouse.move(640, 360);
  await page.keyboard.press('3'); ck('hotkey 3 selects Floor', (await tool()) === 'floor');
  await page.keyboard.press('8'); ck('hotkey 8 selects Link', (await tool()) === 'link');
  await page.keyboard.press('v'); ck('letter alias v selects Select', (await tool()) === 'select');
  // typing guard: a key pressed while a field is focused must NOT switch tools
  await page.focus('#levelName');
  await page.keyboard.press('4');
  ck('hotkeys ignored while typing in a field', (await tool()) === 'select');
  await page.evaluate(() => document.getElementById('levelName').blur());
  // R rotates the object brush angle (no object selected) and picks Object tool
  await page.keyboard.press('Escape');
  const brushBefore = await page.evaluate(() => window.UGS.editorApp.brush.objectRotation);
  await page.keyboard.press('r');
  const afterR = await page.evaluate(() => ({ rot: window.UGS.editorApp.brush.objectRotation, tool: window.UGS.editorApp.tool }));
  ck('R rotates the object brush by 45° and selects Object', afterR.rot === (brushBefore + 45) % 360 && afterR.tool === 'object', afterR);

  // contextual cursor changes per tool (R2-01)
  const cursorFor = async (key) => { await page.keyboard.press(key); return page.evaluate(() => document.getElementById('game').style.cursor); };
  const curSelect = await cursorFor('1');
  const curFloor = await cursorFor('3');
  const curWall = await cursorFor('4');
  ck('cursor differs between tools (not colour-only)', curSelect !== curFloor && curFloor !== curWall, { curSelect, curFloor });
  ck('paint tools use a custom svg cursor', /svg/.test(curFloor) && /svg/.test(curWall));
  await page.keyboard.press('1');

  // ── 3b'. camera projection (R2-03): E/Q switch, picking survives both ─────
  const proj0 = await page.evaluate(() => window.UGS.editorApp.camera.projection);
  await page.keyboard.press('e'); await page.waitForTimeout(60);
  const proj1 = await page.evaluate(() => window.UGS.editorApp.camera.projection);
  const pickRoundTrips = await page.evaluate(() => {
    const app = window.UGS.editorApp, R = window.UGS.render;
    const c = R.tileCenterWorld(app.save.levels[0].rooms[0], 5, 4);
    const s = R.worldToScreen(app.camera, c.x, c.y);
    const w = R.screenToWorld(app.camera, s.x, s.y);
    return Math.abs(w.x - c.x) < 0.02 && Math.abs(w.y - c.y) < 0.02;
  });
  await page.keyboard.press('q'); await page.waitForTimeout(40);
  const proj2 = await page.evaluate(() => window.UGS.editorApp.camera.projection);
  ck('projection: E/Q switch and back', proj0 === 'isoTilted' && proj1 === 'isoFlat' && proj2 === 'isoTilted', { proj0, proj1, proj2 });
  ck('projection: picking round-trips in the flat view', pickRoundTrips);

  // ── 3b''. REV3: Q/E now also reaches the TRUE top-down plan view ──────────
  await page.keyboard.press('e'); await page.keyboard.press('e'); await page.waitForTimeout(80);
  const projTD = await page.evaluate(() => window.UGS.editorApp.camera.projection);
  const tdChecks = await page.evaluate(() => {
    const app = window.UGS.editorApp, R = window.UGS.render;
    // plan view: axis-aligned square cells — world x maps straight to screen x
    const a = R.worldToScreen({ x: 0, y: 0, zoom: 1, projection: 'topDown' }, 2, 3);
    const squareCells = a.x === 2 * R.TILE_W && a.y === 3 * R.TILE_W;
    // picking round-trips in the plan view too
    const c = R.tileCenterWorld(app.save.levels[0].rooms[0], 5, 4);
    const s = R.worldToScreen(app.camera, c.x, c.y);
    const w = R.screenToWorld(app.camera, s.x, s.y);
    const roundTrips = Math.abs(w.x - c.x) < 0.02 && Math.abs(w.y - c.y) < 0.02;
    return { squareCells, roundTrips };
  });
  ck('REV3 projection: E reaches the top-down plan view', projTD === 'topDown', { projTD });
  ck('REV3 projection: top-down uses square axis-aligned cells', tdChecks.squareCells, tdChecks);
  ck('REV3 projection: picking round-trips in the plan view', tdChecks.roundTrips, tdChecks);
  await page.keyboard.press('q'); await page.keyboard.press('q'); await page.waitForTimeout(60);   // back to isoTilted

  // ── 3c. selection model (R2-02): click object / dblclick room / alt+click ─
  const sm = await page.evaluate(() => {
    const app = window.UGS.editorApp, D = window.UGS.data, R = window.UGS.render;
    const room = app.save.levels[0].rooms[0];
    const o = D.createObjectInstance('console', 5, 4); room.objects.push(o);
    const c1 = R.tileCenterWorld(room, 5, 4), c2 = R.tileCenterWorld(room, 3, 3);
    const s1 = R.worldToScreen(app.camera, c1.x, c1.y), s2 = R.worldToScreen(app.camera, c2.x, c2.y);
    return { obj: s1, empty: s2 };
  });
  const selKind = () => page.evaluate(() => (window.UGS.editorApp.selection || {}).kind || null);
  await page.mouse.click(sm.obj.x, sm.obj.y); await page.waitForTimeout(60);
  ck('select: single click selects the object', (await selKind()) === 'object');
  await page.keyboard.down('Alt'); await page.mouse.click(sm.obj.x, sm.obj.y); await page.keyboard.up('Alt'); await page.waitForTimeout(60);
  ck('select: Alt+click forces the tile under an object', (await selKind()) === 'tile');
  await page.mouse.dblclick(sm.empty.x, sm.empty.y); await page.waitForTimeout(80);
  ck('select: double-click selects the whole room', (await selKind()) === 'room');
  // clean the object back out so later sections start tidy
  await page.evaluate(() => { const r = window.UGS.editorApp.save.levels[0].rooms[0]; r.objects = r.objects.filter(o => !(o.x === 5 && o.y === 4)); window.UGS.editorApp.selection = null; });

  // ── 3d. resize handles (R2-04): drag the east handle to grow width ───────
  page.on('dialog', d => d.accept());   // trimming confirm, if any
  const rz = await page.evaluate(() => {
    const app = window.UGS.editorApp, R = window.UGS.render;
    const r = app.save.levels[0].rooms[0];
    app.selection = { kind: 'room', roomId: r.id, lx: Math.floor(r.size.w / 2), ly: Math.floor(r.size.h / 2), objectId: null };
    const h = R.resizeHandles(app.camera, r).find(x => x.kind === 'e');
    const tgtW = R.localToWorld(r, r.size.w + 3, r.size.h / 2);
    const tgt = R.worldToScreen(app.camera, tgtW.x, tgtW.y);
    return { hx: h.sx, hy: h.sy, tx: tgt.x, ty: tgt.y, w0: r.size.w };
  });
  await page.mouse.move(rz.hx, rz.hy); await page.mouse.down();
  await page.mouse.move(rz.tx, rz.ty, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(80);
  const w1 = await page.evaluate(() => window.UGS.editorApp.save.levels[0].rooms[0].size.w);
  ck('resize handle: dragging the east handle grows width', w1 > rz.w0, { w0: rz.w0, w1 });
  await page.evaluate(() => { window.UGS.editorApp.selection = null; });

  // ── 3f. free-form room shapes (R2-05): apply an L, cells go void + nav ────
  await page.evaluate(() => {
    const app = window.UGS.editorApp, r = app.save.levels[0].rooms[0];
    app.selection = { kind: 'room', roomId: r.id, lx: Math.floor(r.size.w / 2), ly: Math.floor(r.size.h / 2), objectId: null };
    window.UGS.i18n.setLang('en', { force: true });
  });
  await page.waitForTimeout(60);
  await page.click('#shapePalette button:nth-child(3)');   // "L"
  await page.waitForTimeout(80);
  const shape = await page.evaluate(() => {
    const app = window.UGS.editorApp, N = window.UGS.data, r = app.save.levels[0].rooms[0];
    let voids = 0; for (const row of r.tiles) for (const t of row) if (t.floor === 'void') voids++;
    const g = window.UGS.nav.buildWalkGrid(r, N.objectBlocks);
    let voidBlocked = true;
    for (let y = 0; y < r.size.h; y++) for (let x = 0; x < r.size.w; x++) if (r.tiles[y][x].floor === 'void' && g.get(x, y) !== 0) voidBlocked = false;
    return { voids, voidBlocked };
  });
  ck('shape L: cut-out cells become void and unwalkable', shape.voids > 0 && shape.voidBlocked, shape);
  await page.click('#shapePalette button:nth-child(1)');   // restore Rectangle
  await page.evaluate(() => { window.UGS.editorApp.selection = null; });

  // ── 3e. wall collision (REV3): default diagonal blocks its whole tile; ────
  //      opt-in partial keeps the R2-06 ph2 nav behaviour ────────────────────
  const pw = await page.evaluate(() => {
    const D = window.UGS.data, N = window.UGS.nav;
    const mk = (w, h) => { const r = D.createRoom('t', w, h); r.tiles = Array.from({ length: h }, () => Array.from({ length: w }, () => D.createTile('deck'))); return r; };
    const rFull = mk(3, 3);
    rFull.tiles[1][1].wall = D.createWall('diagonal', 0, 'hull');              // REV3 default → full
    const r = mk(3, 3);
    r.tiles[1][1].wall = D.createWall('diagonal', 0, 'hull', 'partial');       // opt-in partial, closes E/S/SE
    const grid = N.buildWalkGrid(r, D.objectBlocks);
    return {
      defaultFullBlocked: N.buildWalkGrid(rFull, D.objectBlocks).get(1, 1) === 0,
      walkable: grid.get(1, 1) === 1, eastBlocked: N.crossBlocked(r, 1, 1, 1, 0), westOpen: !N.crossBlocked(r, 1, 1, -1, 0)
    };
  });
  ck('REV3: default diagonal wall blocks its whole tile', pw.defaultFullBlocked, pw);
  ck('partial wall (opt-in): tile walkable, closed side blocked, open side passable', pw.walkable && pw.eastBlocked && pw.westOpen, pw);

  // ── 3e'. reset [COMPONENTES LÓGICOS]: engine/nav/agents API + click→route ──
  const core = await page.evaluate(() => {
    const U = window.UGS;
    const api = {
      engine: !!(U.engine && typeof U.engine.create === 'function'),
      nav: !!(U.nav && typeof U.nav.findPath === 'function' && typeof U.nav.buildWalkGrid === 'function'),
      agents: !!(U.agents && typeof U.agents.create === 'function'),
      engineRuns: !!(U._engine && typeof U._engine.isRunning === 'function' && typeof U._engine.activeCount === 'function'),
    };
    // click→route on the live deck: a path exists on open floor, and none
    // crosses a full wall (the pawn can never walk through it).
    const D = U.data, N = U.nav;
    const room = U.editorApp.save.levels[0].rooms[0];
    const path = N.findPath(room, 2, 2, 5, 4, D.objectBlocks);
    const sealed = D.createRoom('s', 3, 3);
    sealed.tiles = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => D.createTile('deck')));
    for (const [x, y] of [[1, 0], [0, 1], [2, 1], [1, 2]]) sealed.tiles[y][x].wall = D.createWall('block', 0, 'hull');
    return { api, hasPath: Array.isArray(path) && path.length > 0, endsAtTarget: !!path && path[path.length - 1].x === 5 && path[path.length - 1].y === 4, walledOff: N.findPath(sealed, 0, 0, 1, 1, D.objectBlocks) === null };
  });
  ck('logic core: engine/nav/agents modules are loaded with their API', core.api.engine && core.api.nav && core.api.agents && core.api.engineRuns, core.api);
  ck('nav: click→route returns a path that reaches the target', core.hasPath && core.endsAtTarget, core);
  ck('nav: no route through a fully walled-off tile (never walks through walls)', core.walledOff, core);

  // ── 4. import the two-deck fixture through the real file input ────────────
  await page.setInputFiles('#fileInput', FIXTURE);
  await page.waitForFunction(() => window.UGS.editorApp.save.levels.length === 2, { timeout: 5000 });
  const imported = await page.evaluate(() => {
    const app = window.UGS.editorApp;
    window.__d1 = app.save.levels[0].id; window.__d2 = app.save.levels[1].id;
    return { levels: app.save.levels.length, links: app.save.links.length };
  });
  ck('import: two-deck fixture loaded', imported.levels === 2 && imported.links === 1, imported);
  // R2-06: the fixture is a v1 save (string walls) — it must migrate to v2 pieces
  const migrated = await page.evaluate(() => {
    const app = window.UGS.editorApp;
    for (const lvl of app.save.levels) for (const room of lvl.rooms) for (const row of room.tiles) for (const tl of row) {
      if (tl.wall) return { obj: typeof tl.wall === 'object', kind: tl.wall.kind, ver: app.save.formatVersion };
    }
    return null;
  });
  ck('migration: legacy string walls became v2 pieces', !!migrated && migrated.obj && !!migrated.kind, migrated);

  // order the pawn onto a tile in the active deck (no deck change expected)
  async function walkTo(tx, ty) {
    await page.evaluate(({ tx, ty }) => {
      const a = window.UGS._agents, app = window.UGS.editorApp;
      const pawn = a.selected || a.pawns[0];
      const lvl = app.save.levels.find(l => l.id === app.activeLevelId);
      const room = lvl.rooms.find(r => r.id === pawn.roomId) || lvl.rooms[0];
      a.order(pawn, room, tx, ty);
    }, { tx, ty });
  }
  // order the pawn onto a link tile and wait until the active deck flips
  async function travelTo(targetVar, tx, ty) {
    await walkTo(tx, ty);
    await page.waitForFunction((v) => window.UGS.editorApp.activeLevelId === window[v], targetVar, { timeout: 12000 });
  }
  // sample the moving room's transform, wait, sample again → did it change?
  async function motionChanges(sampleMs = 350) {
    const before = await page.evaluate(() => {
      const app = window.UGS.editorApp;
      const lvl = app.save.levels.find(l => l.id === app.activeLevelId);
      const mv = lvl.rooms.find(r => r.movable && r.events && r.events.length);
      return mv ? { x: mv.transform.x, y: mv.transform.y, rot: mv.transform.rotation } : null;
    });
    await page.waitForTimeout(sampleMs);
    const after = await page.evaluate(() => {
      const app = window.UGS.editorApp;
      const lvl = app.save.levels.find(l => l.id === app.activeLevelId);
      const mv = lvl.rooms.find(r => r.movable && r.events && r.events.length);
      return mv ? { x: mv.transform.x, y: mv.transform.y, rot: mv.transform.rotation } : null;
    });
    return { before, after, changed: !!before && !!after && (before.x !== after.x || before.y !== after.y || before.rot !== after.rot) };
  }
  const activeCount = () => page.evaluate(() => window.UGS._engine.activeCount());

  // ── 5. enter Play; deck 1 orbit is running ───────────────────────────────
  await page.click('#playBtn');
  await page.waitForTimeout(400);
  ck('play: deck 1 has active motion', (await activeCount()) > 0);
  ck('play: deck 1 orbit room is moving', (await motionChanges()).changed);

  // ── 6. travel deck1 → deck2 via the elevator; BUG-01 core check ──────────
  await travelTo('__d2', 6, 4);
  await page.waitForTimeout(300);
  const ac2 = await activeCount();
  ck('BUG-01: engine still running after A→B', await page.evaluate(() => window.UGS._engine.isRunning()));
  ck('BUG-01: new deck has active motion after A→B (activeCount>0)', ac2 > 0, { activeCount: ac2 });
  ck('BUG-01: deck 2 moving room keeps animating after transition', (await motionChanges()).changed);

  // pause during travel-side: motion must freeze
  await page.evaluate(() => { window.UGS.editorApp.clock.paused = true; });
  const paused = await motionChanges(250);
  ck('pause: motion frozen while paused', paused.changed === false, paused);
  await page.evaluate(() => { window.UGS.editorApp.clock.paused = false; window.UGS.editorApp.clock.speed = 3; });
  ck('speed 3: motion resumes and advances', (await motionChanges()).changed);

  // ── 7. round trip deck2 → deck1; events still alive ──────────────────────
  await page.evaluate(() => { window.UGS.editorApp.clock.speed = 1; });
  // the pawn spawned ON the deck-2 elevator (2,2); walk it away first, then
  // back onto the elevator so 'pawn:arrived' actually re-fires the link
  await walkTo(7, 5);
  await sleep(1600);
  await travelTo('__d1', 2, 2);
  await page.waitForTimeout(300);
  ck('BUG-01: return trip keeps active motion (activeCount>0)', (await activeCount()) > 0);
  ck('BUG-01: deck 1 orbit animates again after return', (await motionChanges()).changed);

  // ── 7b. app shell (R2-07): menu ⇄ dev ⇄ game routing ─────────────────────
  await page.click('#menuBtn'); await page.waitForTimeout(120);
  ck('shell: top-bar Menu returns to the main menu', await page.evaluate(() => window.UGS.editorApp.appMode === 'menu' && document.body.classList.contains('mode-menu')));
  await page.click('#mmPlay'); await page.waitForTimeout(200);
  const game = await page.evaluate(() => ({
    mode: window.UGS.editorApp.appMode,
    railHidden: getComputedStyle(document.getElementById('toolrail')).display === 'none',
    sideHidden: getComputedStyle(document.getElementById('sidepanel')).display === 'none',
    gameBar: getComputedStyle(document.getElementById('gameBar')).display !== 'none',
    running: window.UGS._engine.isRunning(),
  }));
  ck('shell: Play enters Game mode (dev toolbox hidden, game bar shown, sim running)', game.mode === 'game' && game.railHidden && game.sideHidden && game.gameBar && game.running, game);

  // ── 7b'. REV3: the "Simulating" chip is dev-only language ────────────────
  const chipHiddenInGame = await page.evaluate(() => {
    const el = document.getElementById('simChip');
    return getComputedStyle(el).display === 'none';
  });
  ck('REV3: "Simulating" chip hidden in Game mode', chipHiddenInGame);
  await page.click('#gMenu'); await page.waitForTimeout(120);
  await page.click('#mmDev'); await page.waitForTimeout(150);
  await page.click('#playBtn'); await page.waitForTimeout(150);
  const chipShownInDevPlay = await page.evaluate(() => {
    const el = document.getElementById('simChip');
    return getComputedStyle(el).display !== 'none';
  });
  ck('REV3: "Simulating" chip still shown in Dev test-play', chipShownInDevPlay);
  await page.click('#menuBtn'); await page.waitForTimeout(120);

  await page.click('#mmPlay'); await page.waitForTimeout(200);   // back into Game mode for the next section
  await page.click('#gMenu'); await page.waitForTimeout(120);
  ck('shell: Game "Menu" returns to the main menu', await page.evaluate(() => window.UGS.editorApp.appMode === 'menu'));

  // ── 7c. Game Build economy (R2-08): construction charges credits ─────────
  await page.click('#mmPlay'); await page.waitForTimeout(150);
  await page.click('#gExpand'); await page.waitForTimeout(150);
  const gbState = await page.evaluate(() => ({ mode: window.UGS.editorApp.appMode, credits: window.UGS.editorApp.save.resources.credits }));
  const paintTarget = await page.evaluate(() => {
    const app = window.UGS.editorApp, R = window.UGS.render;
    const c = R.tileCenterWorld(app.save.levels[0].rooms[0], 5, 5);
    const s = R.worldToScreen(app.camera, c.x, c.y);
    app.tool = 'floor'; app.brush.floor = 'dark';
    return { x: s.x, y: s.y };
  });
  await page.mouse.click(paintTarget.x, paintTarget.y); await page.waitForTimeout(80);
  const afterPaint = await page.evaluate(() => window.UGS.editorApp.save.resources.credits);
  ck('game build: painting a floor charges credits', gbState.mode === 'gamebuild' && afterPaint === gbState.credits - 1, { before: gbState.credits, afterPaint });
  await page.evaluate(() => { window.UGS.editorApp.save.resources.credits = 0; });
  const t2 = await page.evaluate(() => {
    const app = window.UGS.editorApp, R = window.UGS.render;
    const c = R.tileCenterWorld(app.save.levels[0].rooms[0], 6, 6);
    const s = R.worldToScreen(app.camera, c.x, c.y); app.brush.floor = 'light';
    return { x: s.x, y: s.y };
  });
  await page.mouse.click(t2.x, t2.y); await page.waitForTimeout(80);
  ck('game build: zero credits blocks construction', await page.evaluate(() => window.UGS.editorApp.save.levels[0].rooms[0].tiles[6][6].floor !== 'light'));
  await page.click('#bDone'); await page.waitForTimeout(60);
  await page.click('#gMenu'); await page.waitForTimeout(80);

  // ── 8. no console errors across the whole run ────────────────────────────
  ck('no console/page errors during smoke run', errors.length === 0, errors);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  return fail;
};

run().then((f) => process.exit(f ? 1 : 0)).catch((e) => { console.error(e); process.exit(1); });
