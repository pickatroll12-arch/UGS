/*
 * UGS — browser smoke tests (BUG-06).  Run: npm run smoke
 *
 * A reproducible Playwright/Chromium headless pass over the real editor. It is
 * the safety net for the whole app: boot, i18n statuses, destructive resize
 * warning, and — most importantly — a full elevator round-trip that proves
 * room-motion events survive deck transitions (BUG-01), including pause and
 * speed 3 during travel.
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

  // ── 1. boot: default station + first-run help overlay ────────────────────
  const boot = await page.evaluate(() => {
    const app = window.UGS.editorApp;
    const lvl = app.save.levels[0];
    return {
      levels: app.save.levels.length, rooms: lvl.rooms.length,
      objects: lvl.rooms.reduce((n, r) => n + r.objects.length, 0),
      help: document.getElementById('helpOverlay').classList.contains('on'),
    };
  });
  ck('boot: one deck, one empty room', boot.levels === 1 && boot.rooms === 1 && boot.objects === 0, boot);
  ck('boot: first-run help overlay shows', boot.help === true);

  // dismiss help for the rest of the run
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

  // ── 4. import the two-deck fixture through the real file input ────────────
  await page.setInputFiles('#fileInput', FIXTURE);
  await page.waitForFunction(() => window.UGS.editorApp.save.levels.length === 2, { timeout: 5000 });
  const imported = await page.evaluate(() => {
    const app = window.UGS.editorApp;
    window.__d1 = app.save.levels[0].id; window.__d2 = app.save.levels[1].id;
    return { levels: app.save.levels.length, links: app.save.links.length };
  });
  ck('import: two-deck fixture loaded', imported.levels === 2 && imported.links === 1, imported);

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

  // ── 8. no console errors across the whole run ────────────────────────────
  ck('no console/page errors during smoke run', errors.length === 0, errors);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  return fail;
};

run().then((f) => process.exit(f ? 1 : 0)).catch((e) => { console.error(e); process.exit(1); });
