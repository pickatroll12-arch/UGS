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

  // ---- projection ---------------------------------------------------------
  function worldToScreen(cam, wx, wy) {
    const sx = (wx - wy) * (TILE_W / 2);
    const sy = (wx + wy) * (TILE_H / 2);
    return { x: sx * cam.zoom + cam.x, y: sy * cam.zoom + cam.y };
  }
  function screenToWorld(cam, px, py) {
    const sx = (px - cam.x) / cam.zoom;
    const sy = (py - cam.y) / cam.zoom;
    return {
      x: (sx / (TILE_W / 2) + sy / (TILE_H / 2)) / 2,
      y: (sy / (TILE_H / 2) - sx / (TILE_W / 2)) / 2
    };
  }

  // ---- room transform math (90° steps) ------------------------------------
  function rotatePoint(px, py, rotation, pivot) {
    const rx = px - pivot.x, ry = py - pivot.y;
    let x, y;
    switch (((rotation % 360) + 360) % 360) {
      case 90:  x = -ry; y = rx; break;
      case 180: x = -rx; y = -ry; break;
      case 270: x = ry;  y = -rx; break;
      default:  x = rx;  y = ry;  break;   // 0
    }
    return { x: x + pivot.x, y: y + pivot.y };
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
  function pick(cam, level, px, py) {
    const w = screenToWorld(cam, px, py);
    for (let i = level.rooms.length - 1; i >= 0; i--) {
      const room = level.rooms[i];
      const loc = worldToLocal(room, w.x, w.y);
      const lx = Math.floor(loc.x), ly = Math.floor(loc.y);
      if (lx >= 0 && ly >= 0 && lx < room.size.w && ly < room.size.h) {
        const object = room.objects.find(o => o.x === lx && o.y === ly) || null;
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
  function pickTopmost(cam, level, px, py) {
    const hw = (TILE_W / 2) * cam.zoom, hh = (TILE_H / 2) * cam.zoom;
    const H = WALL_H * cam.zoom, z = cam.zoom;
    const ents = [];
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
      for (const o of room.objects) {
        const c = tileCenterWorld(room, o.x, o.y);
        ents.push({ kind: 'obj', room, o, lx: o.x, ly: o.y, s: worldToScreen(cam, c.x, c.y), depth: c.x + c.y + 0.01 });
      }
    }
    ents.sort((a, b) => b.depth - a.depth);   // front-most first
    for (const e of ents) {
      const s = e.s;
      let hit = false;
      if (e.kind === 'wall') {
        // hexagonal silhouette of a raised diamond block
        const poly = [
          { x: s.x, y: s.y - hh - H }, { x: s.x + hw, y: s.y - H }, { x: s.x + hw, y: s.y },
          { x: s.x, y: s.y + hh }, { x: s.x - hw, y: s.y }, { x: s.x - hw, y: s.y - H }
        ];
        hit = pointInPoly(px, py, poly);
      } else {
        // bounding box roughly matching the object art (see drawObject)
        hit = px >= s.x - 20 * z && px <= s.x + 20 * z && py >= s.y - 34 * z && py <= s.y + 14 * z;
      }
      if (hit) {
        const object = e.kind === 'obj' ? e.o : (e.room.objects.find(o => o.x === e.lx && o.y === e.ly) || null);
        return { roomId: e.room.id, lx: e.lx, ly: e.ly, object };
      }
    }
    return pick(cam, level, px, py);
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
    const hh = (TILE_H / 2) * cam.zoom;

    // --- pass 1: floors (depth-sorted across all rooms) ---
    const floors = [];
    for (const room of level.rooms) {
      for (let ly = 0; ly < room.size.h; ly++) {
        for (let lx = 0; lx < room.size.w; lx++) {
          const tile = room.tiles[ly][lx];
          if (!tile || tile.floor === 'void') continue;
          const c = tileCenterWorld(room, lx, ly);
          floors.push({ room, lx, ly, tile, wx: c.x, wy: c.y, depth: c.x + c.y });
        }
      }
    }
    floors.sort((a, b) => a.depth - b.depth);
    for (const f of floors) {
      const mat = data.MATERIALS[f.tile.floor] || data.MATERIALS.deck;
      diamondAt(ctx, worldToScreen(cam, f.wx, f.wy), hw, hh, mat.color, mat.line);
    }

    // --- room outlines (editor aid) ---
    if (opts.showRoomOutlines) {
      for (const room of level.rooms) {
        const active = room.id === opts.activeRoomId;
        outlineRoom(ctx, cam, room, active ? '#e6e6ea' : 'rgba(150,150,160,0.5)', active ? 2 : 1);
      }
    }

    // --- entry marker ---
    if (opts.entry) drawEntry(ctx, cam, level, opts.entry, hw, hh);

    // --- hover / selection tile highlight ---
    if (opts.hover) highlightTile(ctx, cam, level, opts.hover, opts.hoverFill || 'rgba(255,255,255,0.14)', opts.hoverStroke || '#cfcfd6', hw, hh);
    if (opts.selection) highlightTile(ctx, cam, level, opts.selection, 'rgba(255,255,255,0.05)', '#ffffff', hw, hh);

    // --- pass 2: walls + objects (depth-sorted across all rooms) ---
    const ents = [];
    for (const room of level.rooms) {
      for (let ly = 0; ly < room.size.h; ly++) {
        for (let lx = 0; lx < room.size.w; lx++) {
          const tile = room.tiles[ly][lx];
          if (tile && tile.wall) {
            const c = tileCenterWorld(room, lx, ly);
            ents.push({ kind: 'wall', tile, wx: c.x, wy: c.y, depth: c.x + c.y });
          }
        }
      }
      for (const obj of room.objects) {
        const c = tileCenterWorld(room, obj.x, obj.y);
        const sel = opts.selection && opts.selection.objectId === obj.id;
        ents.push({ kind: 'obj', obj, sel, wx: c.x, wy: c.y, depth: c.x + c.y + 0.01 });
      }
    }
    ents.sort((a, b) => a.depth - b.depth);
    for (const e of ents) {
      const s = worldToScreen(cam, e.wx, e.wy);
      if (e.kind === 'wall') {
        const mat = data.MATERIALS[e.tile.wallMaterial] || data.MATERIALS.hull;
        blockAt(ctx, s, hw, hh, WALL_H * cam.zoom, shade(mat.color, 22), mat.color);
      } else {
        drawObject(ctx, s, cam.zoom, e.obj, e.sel);
      }
    }
  }

  function highlightTile(ctx, cam, level, ref, fill, stroke, hw, hh) {
    const room = level.rooms.find(r => r.id === ref.roomId);
    if (!room) return;
    if (ref.lx < 0 || ref.ly < 0 || ref.lx >= room.size.w || ref.ly >= room.size.h) return;
    const c = tileCenterWorld(room, ref.lx, ref.ly);
    diamondAt(ctx, worldToScreen(cam, c.x, c.y), hw, hh, fill, stroke);
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
    const s = worldToScreen({ x: 0, y: 0, zoom: cam.zoom }, cx, cy);
    cam.x = viewW / 2 - s.x;
    cam.y = viewH / 2 - s.y;
  }

  return {
    TILE_W, TILE_H, WALL_H, OBJ_H,
    worldToScreen, screenToWorld,
    rotatePoint, localToWorld, worldToLocal, tileCenterWorld,
    pick, pickTopmost, drawLevel, drawObject, centerOn, shade
  };
});
