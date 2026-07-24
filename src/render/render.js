/*
 * UGS — render/render  (REVAMP · base nueva)
 * ==================================================================
 * [RENDERIZADOR GRÁFICO] — canvas 2D, vista CENITAL con rotación libre yaw
 * (decisión del Rector: cámara tipo RTS; el mundo gira bajo la cámara).
 * SOLO lee estado: jamás muta modelo ni importa módulos de lógica.
 *
 * Todo el dibujo pasa por worldToScreen(), por eso la rotación yaw es un
 * detalle de UNA función — picking incluido, porque screenToWorld() es su
 * inversa exacta. cam.rot = ángulo yaw en radianes.
 *
 * Primitivas planas: tiles (cuadrados), paredes (huella plana; las formas
 * diagonal/rounded se construyen en espacio MUNDO y luego se proyectan, así
 * siguen el yaw), objetos (pads), PCJ (disco + tick de dirección + ruta).
 *
 * Corre en navegador (window.UGS.render) y en Node (module.exports, para
 * matemáticas de picking en tests).
 */
(function (root, factory) {
  const dataApi = (root.UGS && root.UGS.data)
    || (typeof require !== 'undefined' ? require('../core/data.js') : null);
  const api = factory(dataApi);
  root.UGS = root.UGS || {};
  root.UGS.render = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (DATA) {
  'use strict';

  const TILE = 64;               // px por tile a zoom 1
  const COLORS = {
    bg: '#0a0c10', grid: 'rgba(255,255,255,0.05)',
    wallFill: '#6b7688', wallLine: '#8b96a8',
    objFill: '#2c3440', objLine: '#62e0ef',
    pawn: '#62e0ef', pawnSel: '#ffd24a', path: 'rgba(98,224,239,0.35)',
    entry: '#7ee08a', link: '#ffd24a'
  };

  // ---- proyección (la ÚNICA fuente de verdad geométrica) -------------------
  function worldToScreen(cam, wx, wy) {
    const r = cam.rot || 0;
    if (r) {
      const cos = Math.cos(r), sin = Math.sin(r);
      const rx = wx * cos - wy * sin, ry = wx * sin + wy * cos;
      return { x: rx * TILE * cam.zoom + cam.x, y: ry * TILE * cam.zoom + cam.y };
    }
    return { x: wx * TILE * cam.zoom + cam.x, y: wy * TILE * cam.zoom + cam.y };
  }
  function screenToWorld(cam, px, py) {
    const ux = (px - cam.x) / (TILE * cam.zoom), uy = (py - cam.y) / (TILE * cam.zoom);
    const r = cam.rot || 0;
    if (r) {
      const cos = Math.cos(r), sin = Math.sin(r);
      return { x: ux * cos + uy * sin, y: -ux * sin + uy * cos };
    }
    return { x: ux, y: uy };
  }

  // ---- espacio de sala (transform con pivote; las salas pueden moverse) ----
  function rotatePoint(x, y, deg, pivot) {
    const r = (deg || 0) * Math.PI / 180;
    const cos = Math.cos(r), sin = Math.sin(r);
    const px = pivot ? pivot.x : 0, py = pivot ? pivot.y : 0;
    const dx = x - px, dy = y - py;
    return { x: px + dx * cos - dy * sin, y: py + dx * sin + dy * cos };
  }
  function localToWorld(room, lx, ly) {
    const t = room.transform;
    const p = rotatePoint(lx, ly, t.rotation, t.pivot);
    return { x: p.x + t.x, y: p.y + t.y };
  }
  function worldToLocal(room, wx, wy) {
    const t = room.transform;
    const r = -(t.rotation || 0) * Math.PI / 180;
    const cos = Math.cos(r), sin = Math.sin(r);
    const px = t.pivot ? t.pivot.x : 0, py = t.pivot ? t.pivot.y : 0;
    const dx = wx - t.x - px, dy = wy - t.y - py;
    return { x: px + dx * cos - dy * sin, y: py + dx * sin + dy * cos };
  }
  function tileCenterWorld(room, lx, ly) { return localToWorld(room, lx + 0.5, ly + 0.5); }
  function roomCenterWorld(room) { return localToWorld(room, room.size.w / 2, room.size.h / 2); }

  // ---- picking -------------------------------------------------------------
  // devuelve { nexoId?, roomId, lx, ly, object? } del tile bajo el cursor
  function pick(cam, nexo, px, py) {
    const w = screenToWorld(cam, px, py);
    for (let i = nexo.rooms.length - 1; i >= 0; i--) {   // sala superior primero
      const room = nexo.rooms[i];
      const loc = worldToLocal(room, w.x, w.y);
      const lx = Math.floor(loc.x), ly = Math.floor(loc.y);
      if (lx >= 0 && ly >= 0 && lx < room.size.w && ly < room.size.h) {
        const obj = room.objects.find(o => o.x === lx && o.y === ly) || null;
        return { roomId: room.id, lx, ly, object: obj };
      }
    }
    return null;
  }

  // ---- dibujo --------------------------------------------------------------
  function poly(ctx, pts, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }
  function tileQuad(cam, wx, wy, half) {
    return [
      worldToScreen(cam, wx - half, wy - half), worldToScreen(cam, wx + half, wy - half),
      worldToScreen(cam, wx + half, wy + half), worldToScreen(cam, wx - half, wy + half)
    ];
  }
  // huella de pared construida en espacio mundo → sigue el yaw de la cámara
  function wallFootprint(cam, wx, wy, kind, orientation) {
    const C = [
      { x: wx - 0.5, y: wy - 0.5 }, { x: wx + 0.5, y: wy - 0.5 },
      { x: wx + 0.5, y: wy + 0.5 }, { x: wx - 0.5, y: wy + 0.5 }
    ];
    let pts = C;
    if (kind !== 'block') {
      const i = (Math.round(((orientation % 360) + 360) % 360 / 90)) % 4;
      const tri = [C[i], C[(i + 1) % 4], C[(i + 2) % 4]];
      if (kind === 'diagonal') pts = tri;
      else {
        const opp = C[(i + 3) % 4];
        const mid = { x: (tri[0].x + tri[2].x) / 2, y: (tri[0].y + tri[2].y) / 2 };
        pts = [tri[0], tri[1], tri[2], { x: mid.x + (opp.x - mid.x) * 0.55, y: mid.y + (opp.y - mid.y) * 0.55 }];
      }
    }
    return pts.map(p => worldToScreen(cam, p.x, p.y));
  }

  function drawNexo(ctx, cam, nexo, opts) {
    opts = opts || {};
    for (const room of nexo.rooms) {
      // tiles
      for (let y = 0; y < room.size.h; y++) {
        for (let x = 0; x < room.size.w; x++) {
          const tile = room.tiles[y][x];
          if (!tile || tile.floor === 'void') continue;
          const c = tileCenterWorld(room, x, y);
          const mat = DATA.FLOORS[tile.floor] || DATA.FLOORS.deck;
          poly(ctx, tileQuad(cam, c.x, c.y, 0.5), mat.color, mat.line);
          if (tile.wall) poly(ctx, wallFootprint(cam, c.x, c.y, tile.wall.kind, tile.wall.orientation), COLORS.wallFill, COLORS.wallLine);
        }
      }
      // objetos (pads planos que rotan con el mundo)
      for (const o of room.objects) {
        const c = tileCenterWorld(room, o.x, o.y);
        const s = worldToScreen(cam, c.x, c.y);
        const a = 20 * cam.zoom;
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate((o.rotation || 0) * Math.PI / 180 + (cam.rot || 0));
        ctx.fillStyle = o.openable && o.open ? '#3a5a44' : COLORS.objFill;
        ctx.strokeStyle = COLORS.objLine;
        ctx.fillRect(-a, -a, a * 2, a * 2);
        ctx.strokeRect(-a, -a, a * 2, a * 2);
        ctx.fillStyle = COLORS.objLine;
        ctx.fillRect(0, -2, a, 4);                 // tick de orientación
        ctx.restore();
      }
      // marcador de entrada del Nexo
      if (opts.entry && opts.entry.roomId === room.id) {
        const c = tileCenterWorld(room, opts.entry.x, opts.entry.y);
        const s = worldToScreen(cam, c.x, c.y);
        ctx.strokeStyle = COLORS.entry; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.x, s.y, 10 * cam.zoom, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // marcadores de links (ascensores)
    if (opts.linkMarkers) {
      for (const m of opts.linkMarkers) {
        const room = nexo.rooms.find(r => r.id === m.roomId); if (!room) continue;
        const c = tileCenterWorld(room, m.x, m.y);
        const s = worldToScreen(cam, c.x, c.y);
        ctx.fillStyle = COLORS.link;
        ctx.font = `${Math.max(11, 13 * cam.zoom)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('▣', s.x, s.y);
      }
    }
    // PCJ
    if (opts.pawns) {
      for (const p of opts.pawns) {
        const room = nexo.rooms.find(r => r.id === p.roomId); if (!room) continue;
        // ruta pendiente
        if (p.path && p.path.length) {
          ctx.strokeStyle = COLORS.path; ctx.lineWidth = 3 * cam.zoom; ctx.lineCap = 'round';
          ctx.beginPath();
          const s0 = worldToScreen(cam, ...Object.values(localToWorld(room, p.x + 0.5, p.y + 0.5)));
          ctx.moveTo(s0.x, s0.y);
          for (const wp of p.path) {
            const c = tileCenterWorld(room, wp.x, wp.y);
            const s = worldToScreen(cam, c.x, c.y);
            ctx.lineTo(s.x, s.y);
          }
          ctx.stroke();
        }
        const c = localToWorld(room, p.x + 0.5, p.y + 0.5);
        const s = worldToScreen(cam, c.x, c.y);
        const r = 14 * cam.zoom;
        ctx.fillStyle = (opts.selectedPawnId === p.id) ? COLORS.pawnSel : COLORS.pawn;
        ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill();
        // tick de dirección (sigue el yaw: ángulo mundo + rot de cámara)
        const ang = Math.atan2(p.facingLocal.y, p.facingLocal.x) + (room.transform.rotation || 0) * Math.PI / 180 + (cam.rot || 0);
        ctx.strokeStyle = '#06202a'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x + Math.cos(ang) * r, s.y + Math.sin(ang) * r); ctx.stroke();
      }
    }
    // hover (editor)
    if (opts.hover) {
      const room = nexo.rooms.find(r => r.id === opts.hover.roomId);
      if (room) {
        const c = tileCenterWorld(room, opts.hover.lx, opts.hover.ly);
        poly(ctx, tileQuad(cam, c.x, c.y, 0.5), 'rgba(255,255,255,0.14)', '#ffffff');
      }
    }
  }

  function clear(ctx, w, h) { ctx.fillStyle = COLORS.bg; ctx.fillRect(0, 0, w, h); }

  // centrar la cámara en el Nexo (respeta zoom y rot)
  function centerOn(cam, nexo, viewW, viewH) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const room of nexo.rooms) {
      for (const [lx, ly] of [[0, 0], [room.size.w, 0], [room.size.w, room.size.h], [0, room.size.h]]) {
        const w = localToWorld(room, lx, ly);
        minX = Math.min(minX, w.x); maxX = Math.max(maxX, w.x);
        minY = Math.min(minY, w.y); maxY = Math.max(maxY, w.y);
      }
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const s = worldToScreen({ x: 0, y: 0, zoom: cam.zoom, rot: cam.rot || 0 }, cx, cy);
    cam.x = viewW / 2 - s.x; cam.y = viewH / 2 - s.y;
  }

  return {
    TILE, COLORS,
    worldToScreen, screenToWorld,
    rotatePoint, localToWorld, worldToLocal, tileCenterWorld, roomCenterWorld,
    pick, wallFootprint, drawNexo, clear, centerOn
  };
});
