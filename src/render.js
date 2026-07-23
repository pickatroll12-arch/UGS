/*
 * UGS — isometric renderer  (Stage 1 · Milestone 2)
 * ------------------------------------------------------------------
 * Draws a Level from the UGS.data model, composing each Room through its
 * transform (offset + 90° rotation + pivot) into world space, then iso-
 * projecting to the screen. Stateless: every function takes an explicit
 * camera so the editor owns all mutable state.
 *
 * The whole point of Stage 1's "rooms are transformable" decision lives
 * here: tiles/objects are stored in room-local coords and only become
 * world coords at draw time, so a room can be shifted/rotated/animated
 * (Milestone 4) with zero change to its contents.
 *
 * Canvas 2D on purpose (see ROADMAP): the sim never talks to this file,
 * so a WebGL renderer can replace it later for polish without touching
 * game logic.
 */
(function (root, factory) {
  const dataApi = (root.UGS && root.UGS.data)
    || (typeof require !== 'undefined' ? require('./data.js') : null);
  const api = factory(dataApi);
  root.UGS = root.UGS || {};
  root.UGS.render = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (data) {
  'use strict';

  const TILE_W = 64;   // iso tile width  (screen px at zoom 1)
  const TILE_H = 32;   // iso tile height (screen px at zoom 1)
  const WALL_H = 34;   // raised wall height
  const OBJ_H  = 20;   // object base height

  // How far up each object's art reaches (px @ zoom 1) — drives the pick box so
  // flat pads don't intercept clicks on the tile behind them.
  const OBJ_PICK_TOP = {
    console: 30, crate: 22, light: 34, plant: 26, elevator: 10, miner: 28,
    pillar: 44, door: 40, airlock: 40, stairs: 22, ladder: 36, ramp: 12
  };

  // SPRITE-01: presentation-only pawn art. Browser images load once and
// remain optional; Node tests and failed assets keep the vector placeholder.
const PAWN_SPRITE_PATHS = {
  front: 'Sprites/Placeholders/processed/pawn_front.png',
  side: 'Sprites/Placeholders/processed/pawn_side.png',
  back: 'Sprites/Placeholders/processed/pawn_back.png'
};
const pawnSpriteSlots = {
  front: { image: null, failed: false },
  side: { image: null, failed: false },
  back: { image: null, failed: false }
};
let pawnSpriteLoadStarted = false;
function ensurePawnSprites() {
  if (pawnSpriteLoadStarted || typeof Image === 'undefined') return;
  pawnSpriteLoadStarted = true;
  for (const key of Object.keys(PAWN_SPRITE_PATHS)) {
    const slot = pawnSpriteSlots[key];
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => { slot.image = image; };
    image.onerror = () => { slot.failed = true; slot.image = null; };
    image.src = PAWN_SPRITE_PATHS[key];
  }
}
function pawnSpriteForFacing(facing) {
  ensurePawnSprites();
  const dx = Math.cos(facing), dy = Math.sin(facing);
  let key = 'side', mirror = false;
  if (Math.abs(dy) >= Math.abs(dx)) key = dy >= 0 ? 'front' : 'back';
  else mirror = dx < 0;
  return { image: pawnSpriteSlots[key].image, mirror };
}
ensurePawnSprites();

  // ---- projection ---------------------------------------------------------
  // R2-03: the camera carries a projection. The two iso projections only change
  // the iso tile HEIGHT (steeper "tilted" vs flatter view). REV3 (human
  // feedback) adds `topDown`: a TRUE plan view — axis-aligned square cells, no
  // tilt at all, as requested ("vista desde arriba, mapa plano sin ningun tipo
  // de inclinacion"). topDown uses its own world<->screen branch; every draw
  // still routes through worldToScreen, so room transforms, picking and camera
  // anchoring keep working unchanged.
  const PROJECTIONS = { isoTilted: 32, isoFlat: 52, topDown: 64 };
  const PROJECTION_IDS = ['isoTilted', 'isoFlat', 'topDown'];
  function isTopDown(cam) { return !!(cam && cam.projection === 'topDown'); }
  function projH(cam) { return (cam && PROJECTIONS[cam.projection]) || TILE_H; }

  function worldToScreen(cam, wx, wy) {
    if (isTopDown(cam)) {
      return { x: wx * TILE_W * cam.zoom + cam.x, y: wy * TILE_W * cam.zoom + cam.y };
    }
    const sx = (wx - wy) * (TILE_W / 2);
    const sy = (wx + wy) * (projH(cam) / 2);
    return { x: sx * cam.zoom + cam.x, y: sy * cam.zoom + cam.y };
  }
  function screenToWorld(cam, px, py) {
    if (isTopDown(cam)) {
      return { x: (px - cam.x) / (TILE_W * cam.zoom), y: (py - cam.y) / (TILE_W * cam.zoom) };
    }
    const sx = (px - cam.x) / cam.zoom;
    const sy = (py - cam.y) / cam.zoom;
    const th = projH(cam);
    return {
      x: (sx / (TILE_W / 2) + sy / (th / 2)) / 2,
      y: (sy / (th / 2) - sx / (TILE_W / 2)) / 2
    };
  }

  // ---- room transform math (arbitrary angle, so animation is smooth) -------
  // Exact for 0/90/180/270 (matches the old switch) and continuous in between.
  function rotatePoint(px, py, rotation, pivot) {
    const rad = rotation * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const rx = px - pivot.x, ry = py - pivot.y;
    return { x: rx * cos - ry * sin + pivot.x, y: rx * sin + ry * cos + pivot.y };
  }
  // continuous local (u,v) → world
  function localToWorld(room, u, v) {
    const t = room.transform;
    const r = rotatePoint(u, v, t.rotation, t.pivot);
    return { x: r.x + t.x, y: r.y + t.y };
  }
  // world → continuous local (inverse of localToWorld)
  function worldToLocal(room, wx, wy) {
    const t = room.transform;
    const inv = (360 - (((t.rotation % 360) + 360) % 360)) % 360;
    return rotatePoint(wx - t.x, wy - t.y, inv, t.pivot);
  }
  // world position of the CENTRE of local tile (lx,ly)
  function tileCenterWorld(room, lx, ly) {
    return localToWorld(room, lx + 0.5, ly + 0.5);
  }

  // ---- picking ------------------------------------------------------------
  // pick(): FLAT ground pick — the tile whose floor is under the cursor,
  // ignoring raised geometry. Used by floor/wall/object/entry tools.
  // Topmost room wins (rooms checked in reverse draw order).
  function pick(cam, level, px, py, opts) {
    const hidden = opts && opts.hiddenLayers;
    const w = screenToWorld(cam, px, py);
    for (let i = level.rooms.length - 1; i >= 0; i--) {
      const room = level.rooms[i];
      const loc = worldToLocal(room, w.x, w.y);
      const lx = Math.floor(loc.x), ly = Math.floor(loc.y);
      if (lx >= 0 && ly >= 0 && lx < room.size.w && ly < room.size.h) {
        const object = room.objects.find(o => o.x === lx && o.y === ly && !(hidden && hidden.has(o.layer))) || null;
        return { roomId: room.id, lx, ly, object };
      }
    }
    return null;
  }

  function pointInDiamond(px, py, cx, cy, hw, hh) {
    return Math.abs(px - cx) / hw + Math.abs(py - cy) / hh <= 1;
  }
  function pointInPoly(px, py, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  // pickTopmost(): HEIGHT-AWARE pick. Tests raised walls and objects by their
  // drawn silhouette, front-most first, so clicking the visible body of a wall
  // or object selects/erases IT — not the tile hiding behind it. Falls back to
  // the flat ground pick when no raised entity is hit. Used by Select/Erase.
  // opts: { hiddenLayers:Set, filter:'all'|'floor'|'object'|'wall' }
  function pickTopmost(cam, level, px, py, opts) {
    opts = opts || {};
    const hidden = opts.hiddenLayers, filter = opts.filter || 'all';
    const hw = (TILE_W / 2) * cam.zoom, hh = (projH(cam) / 2) * cam.zoom;
    const H = WALL_H * cam.zoom, z = cam.zoom;
    const ents = [];
    if (filter !== 'floor' && filter !== 'object') {
      for (const room of level.rooms) {
        for (let ly = 0; ly < room.size.h; ly++) {
          for (let lx = 0; lx < room.size.w; lx++) {
            const t = room.tiles[ly][lx];
            if (t && t.wall) {
              const c = tileCenterWorld(room, lx, ly);
              ents.push({ kind: 'wall', room, lx, ly, s: worldToScreen(cam, c.x, c.y), depth: c.x + c.y });
            }
          }
        }
      }
    }
    if (filter !== 'floor' && filter !== 'wall') {
      for (const room of level.rooms) {
        for (const o of room.objects) {
          if (hidden && hidden.has(o.layer)) continue;
          const c = tileCenterWorld(room, o.x, o.y);
          ents.push({ kind: 'obj', room, o, lx: o.x, ly: o.y, s: worldToScreen(cam, c.x, c.y), depth: c.x + c.y + 0.01 });
        }
      }
    }
    ents.sort((a, b) => b.depth - a.depth);   // front-most first
    const td = isTopDown(cam);
    for (const e of ents) {
      const s = e.s;
      let hit = false;
      if (e.kind === 'wall') {
        if (td) {
          // plan view: walls are flat footprints — hit-test the ground polygon
          const wall = (e.room.tiles[e.ly] && e.room.tiles[e.ly][e.lx] && e.room.tiles[e.ly][e.lx].wall) || {};
          hit = pointInPoly(px, py, wallPolygon(s, hw, hh, wall.kind || 'block', wall.orientation || 0, true));
        } else {
          // hexagonal silhouette of a raised diamond block
          const poly = [
            { x: s.x, y: s.y - hh - H }, { x: s.x + hw, y: s.y - H }, { x: s.x + hw, y: s.y },
            { x: s.x, y: s.y + hh }, { x: s.x - hw, y: s.y }, { x: s.x - hw, y: s.y - H }
          ];
          hit = pointInPoly(px, py, poly);
        }
      } else if (td) {
        // plan view: objects are flat pads (see drawObjectFlat)
        hit = px >= s.x - 20 * z && px <= s.x + 20 * z && py >= s.y - 20 * z && py <= s.y + 20 * z;
      } else {
        // bounding box matched to the object art's actual height, so FLAT objects
        // (elevator pad, ramp) don't grab the tile drawn behind them while TALL
        // ones (pillar, door) stay clickable by their body.
        const top = OBJ_PICK_TOP[e.o.type] != null ? OBJ_PICK_TOP[e.o.type] : 30;
        hit = px >= s.x - 19 * z && px <= s.x + 19 * z && py >= s.y - top * z && py <= s.y + 12 * z;
      }
      if (hit) {
        const object = e.kind === 'obj' ? e.o : (e.room.objects.find(o => o.x === e.lx && o.y === e.ly) || null);
        return { roomId: e.room.id, lx: e.lx, ly: e.ly, object };
      }
    }
    if (filter === 'object' || filter === 'wall') return null;   // nothing of that kind here
    return pick(cam, level, px, py, opts);
  }

  // ---- primitives ---------------------------------------------------------
  function diamondAt(ctx, s, hw, hh, fill, stroke, alpha) {
    ctx.save();
    if (alpha != null) ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - hh);
    ctx.lineTo(s.x + hw, s.y);
    ctx.lineTo(s.x, s.y + hh);
    ctx.lineTo(s.x - hw, s.y);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
    ctx.restore();
  }

  function squareAt(ctx, s, hw, hh, fill, stroke, alpha) {
    ctx.save();
    if (alpha != null) ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.rect(s.x - hw, s.y - hh, hw * 2, hh * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
    ctx.restore();
  }

  // REV3: one tile primitive per projection — diamond in iso, square in topDown.
  function tileAt(ctx, cam, s, hw, hh, fill, stroke, alpha) {
    if (isTopDown(cam)) squareAt(ctx, s, hw, hh, fill, stroke, alpha);
    else diamondAt(ctx, s, hw, hh, fill, stroke, alpha);
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, (n >> 16) + amt));
    const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
    const b = Math.max(0, Math.min(255, (n & 255) + amt));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  function blockAt(ctx, s, hw, hh, H, topCol, sideCol) {
    // left face
    ctx.fillStyle = sideCol;
    ctx.beginPath();
    ctx.moveTo(s.x - hw, s.y);
    ctx.lineTo(s.x, s.y + hh);
    ctx.lineTo(s.x, s.y + hh - H);
    ctx.lineTo(s.x - hw, s.y - H);
    ctx.closePath(); ctx.fill();
    // right face
    ctx.fillStyle = shade(sideCol, -18);
    ctx.beginPath();
    ctx.moveTo(s.x + hw, s.y);
    ctx.lineTo(s.x, s.y + hh);
    ctx.lineTo(s.x, s.y + hh - H);
    ctx.lineTo(s.x + hw, s.y - H);
    ctx.closePath(); ctx.fill();
    // top
    ctx.fillStyle = topCol;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - hh - H);
    ctx.lineTo(s.x + hw, s.y - H);
    ctx.lineTo(s.x, s.y + hh - H);
    ctx.lineTo(s.x - hw, s.y - H);
    ctx.closePath(); ctx.fill();
  }

  // R2-06: extrude an arbitrary ground polygon (screen-space points) up by H,
  // drawing its side faces then the top. Used to render oriented wall pieces
  // (a full block is the whole diamond; a diagonal is half of it; a rounded
  // wall bows the cut edge inward).
  function extrudeAt(ctx, pts, H, topCol, sideCol) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      // outward-ish faces get a slightly darker right side for depth
      ctx.fillStyle = (a.x + b.x) / 2 > pts.reduce((s, p) => s + p.x, 0) / pts.length ? shade(sideCol, -18) : sideCol;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.lineTo(b.x, b.y - H); ctx.lineTo(a.x, a.y - H);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = topCol;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y - H);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y - H);
    ctx.closePath(); ctx.fill();
  }
  // Ground-plane polygon for a wall piece, in screen space around centre s.
  // REV3: in topDown the cell is an axis-aligned square, so the piece corners
  // are the SQUARE corners (TL,TR,BR,BL) instead of the iso diamond's (T,R,B,L)
  // — same index order, so orientation semantics carry over unchanged.
  function wallPolygon(s, hw, hh, kind, orientation, topDown) {
    const C = topDown
      ? [{ x: s.x - hw, y: s.y - hh }, { x: s.x + hw, y: s.y - hh }, { x: s.x + hw, y: s.y + hh }, { x: s.x - hw, y: s.y + hh }]
      : [{ x: s.x, y: s.y - hh }, { x: s.x + hw, y: s.y }, { x: s.x, y: s.y + hh }, { x: s.x - hw, y: s.y }]; // T,R,B,L
    if (kind === 'block') return C;
    const i = (Math.round(((orientation % 360) + 360) % 360 / 90)) % 4;   // 0..3
    const tri = [C[i], C[(i + 1) % 4], C[(i + 2) % 4]];
    if (kind === 'diagonal') return tri;
    // rounded: bow the cut (hypotenuse from tri[0] to tri[2]) inward toward the 4th corner
    const opp = C[(i + 3) % 4];
    const mid = { x: (tri[0].x + tri[2].x) / 2, y: (tri[0].y + tri[2].y) / 2 };
    const inner = { x: mid.x + (opp.x - mid.x) * 0.55, y: mid.y + (opp.y - mid.y) * 0.55 };
    return [tri[0], tri[1], tri[2], inner];
  }

  // REV3: flat wall rendering for the top-down plan view — no vertical
  // extrusion, just the ground footprint filled and stroked.
  function flatWallAt(ctx, pts, fillCol, lineCol) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fillStyle = fillCol; ctx.fill();
    ctx.strokeStyle = lineCol; ctx.lineWidth = 1; ctx.stroke();
  }

  // ---- object art (flat placeholders, swapped for sprites later) ----------
  function drawObject(ctx, s, zoom, obj, selected) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.scale(zoom, zoom);

    // shadow
    ctx.globalAlpha = 0.28; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(0, 8, 18, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    if (selected) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.ellipse(0, 8, 25, 12, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.rotate((obj.rotation || 0) * Math.PI / 180);
    switch (obj.type) {
      case 'console':
        ctx.fillStyle = '#2f2f34'; ctx.fillRect(-16, -11, 32, 20);
        ctx.fillStyle = '#55555d'; ctx.fillRect(-12, -25, 24, 15);
        ctx.fillStyle = '#bdbdc4'; ctx.fillRect(-8, -21, 16, 7);
        ctx.strokeStyle = '#77777f'; ctx.strokeRect(-16, -11, 32, 20); break;
      case 'crate':
        ctx.fillStyle = '#343438'; ctx.fillRect(-16, -18, 32, 27);
        ctx.fillStyle = '#4c4c53'; ctx.fillRect(-16, -18, 32, 7);
        ctx.strokeStyle = '#696970'; ctx.strokeRect(-16, -18, 32, 27); break;
      case 'light':
        ctx.strokeStyle = '#77777f'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(0, 9); ctx.lineTo(0, -25); ctx.stroke();
        ctx.fillStyle = '#f0f0f2'; ctx.beginPath(); ctx.arc(0, -29, 6, 0, Math.PI * 2); ctx.fill(); break;
      case 'plant':
        ctx.strokeStyle = '#b8b8bd'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(0, -18);
        ctx.moveTo(0, -7); ctx.lineTo(-10, -17); ctx.moveTo(0, -11); ctx.lineTo(10, -22); ctx.stroke();
        ctx.fillStyle = '#48484e'; ctx.fillRect(-10, 3, 20, 9); break;
      case 'elevator':
        ctx.strokeStyle = '#85858c'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(22, 0); ctx.lineTo(0, 16); ctx.lineTo(-22, 0); ctx.closePath(); ctx.stroke();
        ctx.fillStyle = '#c8c8cd';
        ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(7, 0); ctx.lineTo(0, 9); ctx.lineTo(-7, 0); ctx.closePath(); ctx.fill(); break;
      case 'miner':
        ctx.fillStyle = '#3a3a40'; ctx.fillRect(-15, -14, 30, 24);
        ctx.strokeStyle = '#7a7a82'; ctx.lineWidth = 2; ctx.strokeRect(-15, -14, 30, 24);
        ctx.strokeStyle = '#9a9aa2';
        ctx.beginPath(); ctx.moveTo(-8, -14); ctx.lineTo(0, -26); ctx.lineTo(8, -14); ctx.stroke(); break;
      case 'pillar':
        ctx.fillStyle = '#43434a'; ctx.fillRect(-9, -40, 18, 50);
        ctx.fillStyle = '#54545c'; ctx.fillRect(-9, -40, 18, 6);
        ctx.fillStyle = '#33333a'; ctx.fillRect(-11, 6, 22, 6);
        ctx.strokeStyle = '#6c6c74'; ctx.strokeRect(-9, -40, 18, 50); break;
      case 'door':
      case 'airlock': {
        const open = !!obj.open, wide = obj.type === 'airlock';
        const fw = wide ? 15 : 12;
        // frame
        ctx.strokeStyle = wide ? '#9aa6b0' : '#84848c'; ctx.lineWidth = 3;
        ctx.strokeRect(-fw, -34, fw * 2, 44);
        // panels (slid apart when open)
        ctx.fillStyle = open ? '#2c3a34' : (wide ? '#4a5560' : '#50505a');
        const gap = open ? fw * 0.75 : 0;
        ctx.fillRect(-fw + 2, -32, (fw - 3) - gap, 40);
        ctx.fillRect(gap + 1, -32, (fw - 3) - gap, 40);
        // status light
        ctx.fillStyle = open ? '#8ee0a0' : '#e08a8a';
        ctx.beginPath(); ctx.arc(0, -38, 3, 0, Math.PI * 2); ctx.fill(); break;
      }
      case 'stairs':
        ctx.fillStyle = '#3c3c44';
        for (let i = 0; i < 4; i++) ctx.fillRect(-14 + i * 5, 6 - i * 7, 12, 6);
        ctx.strokeStyle = '#7a7a82'; ctx.lineWidth = 1.5;
        for (let i = 0; i < 4; i++) ctx.strokeRect(-14 + i * 5, 6 - i * 7, 12, 6); break;
      case 'ladder':
        ctx.strokeStyle = '#9a9aa2'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(-5, 10); ctx.lineTo(-5, -34); ctx.moveTo(5, 10); ctx.lineTo(5, -34); ctx.stroke();
        ctx.lineWidth = 2;
        for (let y = 6; y >= -32; y -= 8) { ctx.beginPath(); ctx.moveTo(-5, y); ctx.lineTo(5, y); ctx.stroke(); } break;
      case 'ramp':
        ctx.fillStyle = '#3a3a42';
        ctx.beginPath(); ctx.moveTo(-16, 10); ctx.lineTo(16, 10); ctx.lineTo(16, -8); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#7a7a82'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(-16, 10); ctx.lineTo(16, -8); ctx.stroke(); break;
      default:
        ctx.fillStyle = '#555'; ctx.fillRect(-12, -12, 24, 22);
    }

    // interactive marker
    if (obj.interactive) {
      ctx.fillStyle = '#f4f4f5';
      ctx.beginPath(); ctx.arc(15, -26, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // ---- draw a whole level -------------------------------------------------
  // opts: { hover:{roomId,lx,ly}, selection:{roomId,lx,ly,objectId}, activeRoomId, showRoomOutlines }
  function drawLevel(ctx, cam, level, opts) {
    opts = opts || {};
    const hw = (TILE_W / 2) * cam.zoom;
    const hh = (projH(cam) / 2) * cam.zoom;

    // viewport-culling bounds (world screen px + a generous margin so tall
    // walls/objects and moving rooms near the edge still draw). Skips draw calls
    // for everything off-screen — the main perf lever when zoomed in.
    const vw = opts.view ? opts.view.w : (typeof window !== 'undefined' ? window.innerWidth : 1e5);
    const vh = opts.view ? opts.view.h : (typeof window !== 'undefined' ? window.innerHeight : 1e5);
    const mx = 3 * TILE_W * cam.zoom, my = 3 * projH(cam) * cam.zoom + WALL_H * cam.zoom;
    const onScreen = (s) => s.x >= -mx && s.x <= vw + mx && s.y >= -my && s.y <= vh + my;

    // --- pass 1: floors (depth-sorted across all rooms) ---
    const floors = [];
    for (const room of level.rooms) {
      for (let ly = 0; ly < room.size.h; ly++) {
        for (let lx = 0; lx < room.size.w; lx++) {
          const tile = room.tiles[ly][lx];
          if (!tile || tile.floor === 'void') continue;
          const c = tileCenterWorld(room, lx, ly);
          if (!onScreen(worldToScreen(cam, c.x, c.y))) continue;
          floors.push({ room, lx, ly, tile, wx: c.x, wy: c.y, depth: c.x + c.y });
        }
      }
    }
    floors.sort((a, b) => a.depth - b.depth);
    for (const f of floors) {
      const mat = data.MATERIALS[f.tile.floor] || data.MATERIALS.deck;
      const s = worldToScreen(cam, f.wx, f.wy);
      tileAt(ctx, cam, s, hw, hh, mat.color, mat.line);
      if (mat.raised) {   // catwalk: inset plate to read as a raised walkway
        tileAt(ctx, cam, { x: s.x, y: s.y }, hw * 0.62, hh * 0.62, null, mat.line);
      }
    }

    // --- room outlines (editor aid) ---
    if (opts.showRoomOutlines) {
      for (const room of level.rooms) {
        const active = room.id === opts.activeRoomId;
        const stroke = active ? '#e6e6ea' : 'rgba(150,150,160,0.5)', width = active ? 2 : 1;
        if (roomIsRect(room)) outlineRoom(ctx, cam, room, stroke, width);
        else outlineRoomCells(ctx, cam, room, stroke, width);   // free-form silhouette
      }
    }

    // --- entry marker ---
    if (opts.entry) drawEntry(ctx, cam, level, opts.entry, hw, hh);

    // --- link markers (level graph) ---
    if (opts.linkMarkers && opts.linkMarkers.length) drawLinkMarkers(ctx, cam, level, opts.linkMarkers);

    // --- room motion preview (Build aid) ---
    if (opts.previewRoom) drawRoomMotion(ctx, cam, opts.previewRoom);

    // --- room resize handles (R2-04) ---
    if (opts.resizeRoom) drawResizeHandles(ctx, cam, opts.resizeRoom, opts.resizeGhost);

    // --- hover / selection tile highlight ---
    if (opts.hover) highlightTile(ctx, cam, level, opts.hover, opts.hoverFill || 'rgba(255,255,255,0.14)', opts.hoverStroke || '#cfcfd6', hw, hh);
    if (opts.selection) highlightTile(ctx, cam, level, opts.selection, 'rgba(255,255,255,0.05)', '#ffffff', hw, hh);

    // --- pass 2: walls + objects (depth-sorted across all rooms) ---
    const hidden = opts.hiddenLayers;
    const ents = [];
    for (const room of level.rooms) {
      for (let ly = 0; ly < room.size.h; ly++) {
        for (let lx = 0; lx < room.size.w; lx++) {
          const tile = room.tiles[ly][lx];
          if (tile && tile.wall) {
            const c = tileCenterWorld(room, lx, ly);
            if (!onScreen(worldToScreen(cam, c.x, c.y))) continue;
            ents.push({ kind: 'wall', tile, wx: c.x, wy: c.y, depth: c.x + c.y });
          }
        }
      }
      for (const obj of room.objects) {
        if (hidden && hidden.has(obj.layer)) continue;
        const c = tileCenterWorld(room, obj.x, obj.y);
        if (!onScreen(worldToScreen(cam, c.x, c.y))) continue;
        const sel = opts.selection && opts.selection.objectId === obj.id;
        ents.push({ kind: 'obj', obj, sel, wx: c.x, wy: c.y, depth: c.x + c.y + 0.01 });
      }
    }
    ents.sort((a, b) => a.depth - b.depth);
    const td = isTopDown(cam);
    for (const e of ents) {
      const s = worldToScreen(cam, e.wx, e.wy);
      if (e.kind === 'wall') {
        const wall = e.tile.wall || {};
        const mat = data.MATERIALS[wall.material] || data.MATERIALS[e.tile.wallMaterial] || data.MATERIALS.hull;
        const pts = wallPolygon(s, hw, hh, wall.kind || 'block', wall.orientation || 0, td);
        if (td) {
          // plan view: walls are flat footprints, not raised blocks (REV3)
          ctx.save();
          if (mat.glass) ctx.globalAlpha = 0.55;
          flatWallAt(ctx, pts, shade(mat.color, 22), mat.color);
          ctx.restore();
        } else if (mat.glass) {
          ctx.save(); ctx.globalAlpha = 0.5;
          extrudeAt(ctx, pts, WALL_H * 0.82 * cam.zoom, shade(mat.color, 30), mat.color);
          ctx.restore();
        } else {
          extrudeAt(ctx, pts, WALL_H * cam.zoom, shade(mat.color, 22), mat.color);
        }
      } else if (td) {
        drawObjectFlat(ctx, s, cam.zoom, e.obj, e.sel);
      } else {
        drawObject(ctx, s, cam.zoom, e.obj, e.sel);
      }
    }
  }

  // REV3: plan-view object marker — a flat inset pad coloured per type, with a
  // rotation tick, an interactive dot and a selection ring. Upright iso art
  // would lie sideways on a plan; these placeholders stay readable instead.
  const OBJ_TOPDOWN_COLORS = {
    console: '#5d5d66', crate: '#4c4c53', light: '#e8e8ec', plant: '#6d8a62',
    elevator: '#8a8a93', miner: '#4a4a52', pillar: '#54545c',
    door: '#50505a', airlock: '#4a5560', stairs: '#4c4c55', ladder: '#6a6a72', ramp: '#46464e'
  };
  function drawObjectFlat(ctx, s, zoom, obj, selected) {
    const z = zoom, a = 20 * z;   // pad half-size (inset inside the 32*z cell)
    ctx.save();
    ctx.translate(s.x, s.y);
    if (selected) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([6 * z, 4 * z]);
      ctx.beginPath(); ctx.arc(0, 0, 26 * z, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.rotate((obj.rotation || 0) * Math.PI / 180);
    const open = (obj.type === 'door' || obj.type === 'airlock') && obj.open;
    ctx.fillStyle = open ? '#2c3a34' : (OBJ_TOPDOWN_COLORS[obj.type] || '#55555c');
    ctx.strokeStyle = 'rgba(230,230,238,0.75)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.rect(-a, -a, a * 2, a * 2); ctx.fill(); ctx.stroke();
    // rotation tick toward local +X
    ctx.strokeStyle = 'rgba(240,240,245,0.9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(a * 0.8, 0); ctx.stroke();
    ctx.restore();
    if (obj.interactive) {
      ctx.fillStyle = '#f4f4f5';
      ctx.beginPath(); ctx.arc(s.x + a, s.y - a, 3.5 * z, 0, Math.PI * 2); ctx.fill();
    }
  }

  function highlightTile(ctx, cam, level, ref, fill, stroke, hw, hh) {
    const room = level.rooms.find(r => r.id === ref.roomId);
    if (!room) return;
    if (ref.lx < 0 || ref.ly < 0 || ref.lx >= room.size.w || ref.ly >= room.size.h) return;
    const c = tileCenterWorld(room, ref.lx, ref.ly);
    tileAt(ctx, cam, worldToScreen(cam, c.x, c.y), hw, hh, fill, stroke);
  }

  // Link markers: source/spawn endpoints of the level graph on THIS level.
  // markers: [{ roomId, x, y, label, kind:'source'|'spawn'|'pending' }]
  function drawLinkMarkers(ctx, cam, level, markers) {
    for (const m of markers) {
      const room = level.rooms.find(r => r.id === m.roomId) || level.rooms[0];
      if (!room) continue;
      const c = tileCenterWorld(room, m.x, m.y);
      const s = worldToScreen(cam, c.x, c.y);
      const col = m.kind === 'spawn' ? '#8fe0a0' : (m.kind === 'pending' ? '#ffd060' : '#8fd0ff');
      ctx.save();
      if (m.sel) {   // selected link: bright halo around both endpoints
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3.5;
        ctx.beginPath(); ctx.ellipse(s.x, s.y, 18 * cam.zoom, 9 * cam.zoom, 0, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2;
      ctx.setLineDash(m.kind === 'pending' ? [4, 3] : []);
      ctx.beginPath(); ctx.ellipse(s.x, s.y, 14 * cam.zoom, 7 * cam.zoom, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      // chevron up for a source/portal, down-dot for a spawn
      ctx.beginPath();
      if (m.kind === 'spawn') { ctx.arc(s.x, s.y, 2.5 * cam.zoom, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.moveTo(s.x - 5 * cam.zoom, s.y + 2 * cam.zoom); ctx.lineTo(s.x, s.y - 5 * cam.zoom); ctx.lineTo(s.x + 5 * cam.zoom, s.y + 2 * cam.zoom); ctx.stroke(); }
      if (m.label) {
        ctx.fillStyle = col; ctx.font = `${10 * cam.zoom}px ui-monospace, monospace`; ctx.textAlign = 'center';
        ctx.fillText(m.label, s.x, s.y - 12 * cam.zoom);
      }
      ctx.restore();
    }
  }

  function drawEntry(ctx, cam, level, entry, hw, hh) {
    const room = level.rooms.find(r => r.id === entry.roomId);
    if (!room) return;
    const c = tileCenterWorld(room, entry.x, entry.y);
    const s = worldToScreen(cam, c.x, c.y);
    ctx.save();
    ctx.strokeStyle = '#f0f0f2'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.ellipse(s.x, s.y, hw * 0.5, hh * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#f0f0f2'; ctx.font = `${10 * cam.zoom}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('ENTRY', s.x, s.y - hh * 0.7);
    ctx.restore();
  }

  // world centre of a room at its current pose
  function roomCenterWorld(room) {
    const t = room.transform;
    const rc = rotatePoint(room.size.w / 2, room.size.h / 2, t.rotation, t.pivot);
    return { x: rc.x + t.x, y: rc.y + t.y };
  }

  function arrowLine(ctx, a, b, color) {
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    const ang = Math.atan2(b.y - a.y, b.x - a.x), h = 8;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - h * Math.cos(ang - 0.4), b.y - h * Math.sin(ang - 0.4));
    ctx.lineTo(b.x - h * Math.cos(ang + 0.4), b.y - h * Math.sin(ang + 0.4));
    ctx.closePath(); ctx.fill();
  }
  function handleDot(ctx, s, color) {
    ctx.fillStyle = '#14141a'; ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  function crossMark(ctx, s, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(s.x - 6, s.y); ctx.lineTo(s.x + 6, s.y); ctx.moveTo(s.x, s.y - 6); ctx.lineTo(s.x, s.y + 6); ctx.stroke();
  }

  function orbitRadius(room, a) {
    if (a.radius != null) return Number(a.radius);
    const rc = roomCenterWorld(room);
    return Math.hypot(rc.x - a.center.x, rc.y - a.center.y);
  }

  // Preview the motion path/direction of a room's events (Build aid), plus
  // the room move/rotate gizmo.
  function drawRoomMotion(ctx, cam, room) {
    if (!room) return;
    const rc = roomCenterWorld(room), t = room.transform;
    const w = (x, y) => worldToScreen(cam, x, y);

    // --- room move/rotate gizmo ---
    const grip = localToWorld(room, room.size.w / 2, -1);
    ctx.save();
    ctx.strokeStyle = 'rgba(230,230,238,0.6)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(w(rc.x, rc.y).x, w(rc.x, rc.y).y); ctx.lineTo(w(grip.x, grip.y).x, w(grip.x, grip.y).y); ctx.stroke();
    const ms = w(rc.x, rc.y);                                  // move handle (square)
    ctx.fillStyle = '#14141a'; ctx.strokeStyle = '#e6e6ee'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.rect(ms.x - 6, ms.y - 6, 12, 12); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ms.x - 3, ms.y); ctx.lineTo(ms.x + 3, ms.y); ctx.moveTo(ms.x, ms.y - 3); ctx.lineTo(ms.x, ms.y + 3); ctx.stroke();
    handleDot(ctx, w(grip.x, grip.y), '#e6e6ee');              // rotate grip (circle)
    ctx.restore();

    if (!room.events || !room.events.length) return;
    for (const ev of room.events) {
      const a = ev.action; if (!a) continue;
      ctx.save();
      if (a.kind === 'shift') {
        const to = { x: rc.x + (a.to.x - t.x), y: rc.y + (a.to.y - t.y) };
        arrowLine(ctx, w(rc.x, rc.y), w(to.x, to.y), '#8fd0ff');
        handleDot(ctx, w(to.x, to.y), '#8fd0ff');
      } else if (a.kind === 'orbit') {
        const C = a.center, Rr = orbitRadius(room, a);
        ctx.strokeStyle = 'rgba(255,196,120,0.85)'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i <= 48; i++) { const th = i / 48 * Math.PI * 2; const p = w(C.x + Rr * Math.cos(th), C.y + Rr * Math.sin(th)); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
        ctx.stroke(); ctx.setLineDash([]);
        const dir = a.direction === 'ccw' ? -1 : 1, th0 = Math.atan2(rc.y - C.y, rc.x - C.x);
        arrowLine(ctx, w(C.x + Rr * Math.cos(th0), C.y + Rr * Math.sin(th0)), w(C.x + Rr * Math.cos(th0 + dir * 0.5), C.y + Rr * Math.sin(th0 + dir * 0.5)), '#ffc478');
        crossMark(ctx, w(C.x, C.y), '#ffc478'); handleDot(ctx, w(C.x, C.y), '#ffc478');
        // radius handle sits on the ring toward the room
        handleDot(ctx, w(C.x + Rr * Math.cos(th0), C.y + Rr * Math.sin(th0)), '#ffe0a0');
      } else if (a.kind === 'rotate') {
        const piv = localToWorld(room, t.pivot.x, t.pivot.y);
        crossMark(ctx, w(piv.x, piv.y), '#c8a8ff');
        const s = w(rc.x, rc.y);
        ctx.strokeStyle = '#c8a8ff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.x, s.y, 14, -0.6, 2.2); ctx.stroke();
      } else if (a.kind === 'carousel') {
        ctx.strokeStyle = '#a8ffb0'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5;
        const pts = [rc, ...(a.poses || []).map(p => ({ x: rc.x + (p.x - t.x), y: rc.y + (p.y - t.y) }))];
        ctx.beginPath(); pts.forEach((p, i) => { const s = w(p.x, p.y); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); ctx.stroke(); ctx.setLineDash([]);
        pts.forEach((p, i) => { if (i) handleDot(ctx, w(p.x, p.y), '#a8ffb0'); });
      }
      ctx.restore();
    }
  }

  // Draggable handles for a room's move/rotate gizmo and its motion events
  // (screen coords for hit-testing). Room handles come first so they win ties.
  function motionHandles(cam, room) {
    const out = []; if (!room) return out;
    const rc = roomCenterWorld(room), t = room.transform;
    const ms = worldToScreen(cam, rc.x, rc.y);
    out.push({ kind: 'room-move', sx: ms.x, sy: ms.y });
    const grip = localToWorld(room, room.size.w / 2, -1);
    const gs = worldToScreen(cam, grip.x, grip.y);
    out.push({ kind: 'room-rotate', sx: gs.x, sy: gs.y });
    for (const ev of (room.events || [])) {
      const a = ev.action; if (!a) continue;
      if (a.kind === 'shift') { const wx = rc.x + (a.to.x - t.x), wy = rc.y + (a.to.y - t.y); const s = worldToScreen(cam, wx, wy); out.push({ eventId: ev.id, kind: 'shift-to', sx: s.x, sy: s.y }); }
      else if (a.kind === 'orbit') {
        const s = worldToScreen(cam, a.center.x, a.center.y); out.push({ eventId: ev.id, kind: 'orbit-center', sx: s.x, sy: s.y });
        const Rr = orbitRadius(room, a), th0 = Math.atan2(rc.y - a.center.y, rc.x - a.center.x);
        const rs = worldToScreen(cam, a.center.x + Rr * Math.cos(th0), a.center.y + Rr * Math.sin(th0));
        out.push({ eventId: ev.id, kind: 'orbit-radius', sx: rs.x, sy: rs.y });
      }
      else if (a.kind === 'carousel') { (a.poses || []).forEach((p, idx) => { const wx = rc.x + (p.x - t.x), wy = rc.y + (p.y - t.y); const s = worldToScreen(cam, wx, wy); out.push({ eventId: ev.id, kind: 'carousel-pose', poseIndex: idx, sx: s.x, sy: s.y }); }); }
    }
    return out;
  }

  // R2-04: 8 resize handles (edge midpoints + corners) in screen space. Each
  // carries the per-axis anchor (ax/ay) and which edges it moves, so the editor
  // can compute a new size and keep the opposite edge fixed. Positions go
  // through localToWorld→worldToScreen, so they respect the active projection.
  function resizeHandles(cam, room) {
    const out = []; if (!room) return out;
    const w = room.size.w, h = room.size.h;
    const H = [
      { kind: 'nw', u: 0, v: 0, ax: 'hi', ay: 'hi', we: 'w', he: 'n' },
      { kind: 'n', u: w / 2, v: 0, ax: 'lo', ay: 'hi', we: null, he: 'n' },
      { kind: 'ne', u: w, v: 0, ax: 'lo', ay: 'hi', we: 'e', he: 'n' },
      { kind: 'e', u: w, v: h / 2, ax: 'lo', ay: 'lo', we: 'e', he: null },
      { kind: 'se', u: w, v: h, ax: 'lo', ay: 'lo', we: 'e', he: 's' },
      { kind: 's', u: w / 2, v: h, ax: 'lo', ay: 'lo', we: null, he: 's' },
      { kind: 'sw', u: 0, v: h, ax: 'hi', ay: 'lo', we: 'w', he: 's' },
      { kind: 'w', u: 0, v: h / 2, ax: 'hi', ay: 'lo', we: 'w', he: null }
    ];
    for (const hh of H) { const wpt = localToWorld(room, hh.u, hh.v); const s = worldToScreen(cam, wpt.x, wpt.y); out.push(Object.assign({ sx: s.x, sy: s.y }, hh)); }
    return out;
  }
  function drawResizeHandles(ctx, cam, room, ghost) {
    const hs = resizeHandles(cam, room);
    // ghost footprint (prospective bounds) while dragging
    if (ghost) {
      const g = { transform: { x: ghost.x, y: ghost.y, rotation: room.transform.rotation, pivot: room.transform.pivot }, size: { w: ghost.w, h: ghost.h } };
      const c = [localToWorld(g, 0, 0), localToWorld(g, g.size.w, 0), localToWorld(g, g.size.w, g.size.h), localToWorld(g, 0, g.size.h)].map(p => worldToScreen(cam, p.x, p.y));
      ctx.save();
      ctx.fillStyle = 'rgba(120,190,255,0.10)'; ctx.strokeStyle = '#7ac0ff'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(c[0].x, c[0].y); for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y); ctx.closePath();
      ctx.fill(); ctx.stroke(); ctx.restore();
    }
    ctx.save();
    for (const h of hs) {
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#1b6fb0'; ctx.lineWidth = 1.5;
      const r = (h.kind.length === 2 ? 5 : 4);   // corners a touch bigger
      ctx.beginPath(); ctx.rect(h.sx - r, h.sy - r, r * 2, r * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  // R2-05: trace the silhouette of a free-form room by drawing the outer edges
  // of its occupied cells (floor !== 'void'), so L/T/U/corridor rooms outline
  // correctly instead of showing their bounding box. Falls back to the bbox
  // outline when the room is a full rectangle (cheaper, identical result).
  function roomIsRect(room) {
    for (let y = 0; y < room.size.h; y++) for (let x = 0; x < room.size.w; x++) {
      const t = room.tiles[y] && room.tiles[y][x];
      if (!t || t.floor === 'void') return false;
    }
    return true;
  }
  function outlineRoomCells(ctx, cam, room, stroke, width) {
    const occ = (x, y) => { const t = room.tiles[y] && room.tiles[y][x]; return !!t && t.floor !== 'void'; };
    ctx.save();
    ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.setLineDash([5, 4]);
    ctx.beginPath();
    const seg = (ax, ay, bx, by) => {
      const a = worldToScreen(cam, localToWorld(room, ax, ay).x, localToWorld(room, ax, ay).y);
      const b = worldToScreen(cam, localToWorld(room, bx, by).x, localToWorld(room, bx, by).y);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    };
    for (let y = 0; y < room.size.h; y++) {
      for (let x = 0; x < room.size.w; x++) {
        if (!occ(x, y)) continue;
        if (!occ(x, y - 1)) seg(x, y, x + 1, y);           // top edge
        if (!occ(x + 1, y)) seg(x + 1, y, x + 1, y + 1);   // right edge
        if (!occ(x, y + 1)) seg(x + 1, y + 1, x, y + 1);   // bottom edge
        if (!occ(x - 1, y)) seg(x, y + 1, x, y);           // left edge
      }
    }
    ctx.stroke(); ctx.restore();
  }

  function outlineRoom(ctx, cam, room, stroke, width) {
    // trace the 4 transformed corners of the room footprint
    const corners = [
      localToWorld(room, 0, 0),
      localToWorld(room, room.size.w, 0),
      localToWorld(room, room.size.w, room.size.h),
      localToWorld(room, 0, room.size.h)
    ].map(w => worldToScreen(cam, w.x, w.y));
    ctx.save();
    ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath(); ctx.stroke();
    ctx.restore();
  }

  // ---- agents / pawns -----------------------------------------------------
  // Pawns are stored in room-local coords, so they render through the room
  // transform (a moving room carries them). opts: { selectedId, time, showPaths }
  function drawAgents(ctx, cam, level, pawns, opts) {
    opts = opts || {};
    const z = cam.zoom, hw = (TILE_W / 2) * z, hh = (projH(cam) / 2) * z;
    // depth-sorted so nearer pawns overlap farther ones
    const list = pawns.filter(p => p.levelId === level.id).map(p => {
      const room = level.rooms.find(r => r.id === p.roomId) || level.rooms[0];
      const c = localToWorld(room, p.x + 0.5, p.y + 0.5);
      return { p, room, wx: c.x, wy: c.y, depth: c.x + c.y };
    }).sort((a, b) => a.depth - b.depth);

    // paths first (under the figures)
    if (opts.showPaths !== false) for (const e of list) {
      if (!e.p.path.length) continue;
      ctx.save(); ctx.globalAlpha = 0.5; ctx.strokeStyle = '#dfe6ee'; ctx.lineWidth = Math.max(2, 2 * z); ctx.lineJoin = 'round';
      ctx.beginPath();
      const s0 = worldToScreen(cam, e.wx, e.wy); ctx.moveTo(s0.x, s0.y);
      for (const n of e.p.path) { const c = localToWorld(e.room, n.x + 0.5, n.y + 0.5); const s = worldToScreen(cam, c.x, c.y); ctx.lineTo(s.x, s.y); }
      ctx.stroke();
      const last = e.p.path[e.p.path.length - 1]; const lc = localToWorld(e.room, last.x + 0.5, last.y + 0.5); const ls = worldToScreen(cam, lc.x, lc.y);
      ctx.beginPath(); ctx.moveTo(ls.x - 5 * z, ls.y - 5 * z); ctx.lineTo(ls.x + 5 * z, ls.y + 5 * z); ctx.moveTo(ls.x + 5 * z, ls.y - 5 * z); ctx.lineTo(ls.x - 5 * z, ls.y + 5 * z); ctx.stroke();
      ctx.restore();
    }

    const td = isTopDown(cam);
    for (const e of list) {
      const s = worldToScreen(cam, e.wx, e.wy);
      // facing: local dir -> world (room rotation) -> screen angle
      const wd = rotatePoint(e.p.facingLocal.x, e.p.facingLocal.y, e.room.transform.rotation, { x: 0, y: 0 });
      const facing = td
        ? Math.atan2(wd.y, wd.x)                                        // plan: x right, y down
        : Math.atan2((wd.x + wd.y) * (projH(cam) / TILE_W), wd.x - wd.y); // iso diamond angle
      if (td) drawPawnFigureFlat(ctx, s, z, e.p, facing, e.p.id === opts.selectedId, opts.time || 0);
      else drawPawnFigure(ctx, s, z, e.p, facing, e.p.id === opts.selectedId, opts.time || 0);
    }
  }

  // REV3: plan-view pawn — a disc with a heading tick (upright figure would lie
  // sideways on a plan view).
  function drawPawnFigureFlat(ctx, s, z, pawn, facing, selected, time) {
    const pulse = pawn.moving ? 1 + Math.sin(time * 11) * 0.06 : 1;
    ctx.save();
    ctx.globalAlpha = 0.30; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(s.x + 2 * z, s.y + 2 * z, 13 * z, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    if (selected) {
      ctx.strokeStyle = '#f2f2f4'; ctx.lineWidth = 1.6 * z; ctx.setLineDash([6 * z, 4 * z]);
      ctx.beginPath(); ctx.arc(s.x, s.y, 18 * z, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.beginPath(); ctx.arc(s.x, s.y, 12 * z * pulse, 0, Math.PI * 2);
    ctx.fillStyle = '#dcdcde'; ctx.fill(); ctx.strokeStyle = '#8a8a92'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.strokeStyle = '#2a2a2e'; ctx.lineWidth = 2.4 * z;
    ctx.beginPath(); ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + Math.cos(facing) * 12 * z, s.y + Math.sin(facing) * 12 * z); ctx.stroke();
    ctx.restore();
  }

  function drawPawnPlaceholder(ctx, s, z, facing, bob) {
  const fx = Math.cos(facing), fy = Math.sin(facing) * 0.6;
  const bodyH = 34 * z;
  ctx.beginPath(); ctx.ellipse(s.x, s.y - bodyH * 0.45 + bob, 9 * z, bodyH * 0.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#dcdcde'; ctx.fill(); ctx.strokeStyle = '#8a8a92'; ctx.lineWidth = 1.4; ctx.stroke();
  const hy = s.y - bodyH + bob;
  ctx.beginPath(); ctx.arc(s.x, hy, 7 * z, 0, Math.PI * 2); ctx.fillStyle = '#ededf0'; ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(s.x + fx * 6 * z, hy + fy * 6 * z, 2 * z, 0, Math.PI * 2); ctx.fillStyle = '#2a2a2e'; ctx.fill();
}

function drawPawnFigure(ctx, s, z, pawn, facing, selected, time) {
  const bob = pawn.moving ? Math.sin(time * 11) * 1.6 * z : 0;
  ctx.save();
  ctx.globalAlpha = 0.34; ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(s.x, s.y, 11 * z, 5.5 * z, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  if (selected) {
    ctx.strokeStyle = '#f2f2f4'; ctx.lineWidth = 1.6 * z; ctx.setLineDash([6 * z, 4 * z]);
    ctx.beginPath(); ctx.ellipse(s.x, s.y, 15 * z, 7.5 * z, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  const sprite = pawnSpriteForFacing(facing);
  if (sprite.image) {
    const drawH = 42 * z;
    const naturalW = sprite.image.naturalWidth || sprite.image.width || 1;
    const naturalH = sprite.image.naturalHeight || sprite.image.height || 1;
    const drawW = drawH * naturalW / naturalH;
    ctx.save();
    ctx.translate(s.x, s.y + bob);
    if (sprite.mirror) ctx.scale(-1, 1);
    ctx.drawImage(sprite.image, -drawW / 2, -drawH, drawW, drawH);
    ctx.restore();
  } else {
    drawPawnPlaceholder(ctx, s, z, facing, bob);
  }
  ctx.restore();
}

  // centre a camera on a level's overall footprint at a given viewport size
  function centerOn(cam, level, viewW, viewH) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const room of level.rooms) {
      for (const [u, v] of [[0, 0], [room.size.w, 0], [room.size.w, room.size.h], [0, room.size.h]]) {
        const w = localToWorld(room, u, v);
        minX = Math.min(minX, w.x); minY = Math.min(minY, w.y);
        maxX = Math.max(maxX, w.x); maxY = Math.max(maxY, w.y);
      }
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const s = worldToScreen({ x: 0, y: 0, zoom: cam.zoom, projection: cam.projection }, cx, cy);
    cam.x = viewW / 2 - s.x;
    cam.y = viewH / 2 - s.y;
  }

  return {
    TILE_W, TILE_H, WALL_H, OBJ_H, PROJECTION_IDS, projH, isTopDown,
    worldToScreen, screenToWorld,
    rotatePoint, localToWorld, worldToLocal, tileCenterWorld, roomCenterWorld,
    pick, pickTopmost, drawLevel, drawObject, drawRoomMotion, motionHandles, resizeHandles, drawLinkMarkers, drawAgents, centerOn, shade
  };
});
