/*
 * UGS — render/render  (v2 · vista ¾ tipo Xenonauts — contrato C4)
 * ==================================================================
 * [RENDERIZADOR GRÁFICO] — canvas 2D, vista aérea ¾ ORTOGONAL:
 * grid cuadrado en diamante (yaw base 45° + pasos de 90°), eje Y
 * comprimido (dimetría), paredes EXTRUIDAS con caras laterales
 * sombreadas, sprites "de pie" y fade de paredes que ocluyen al PCJ.
 * La CONSTRUCCIÓN sigue siendo grid plano tipo RimWorld: la lógica no
 * sabe nada de esto (regla de oro, PROMPT_MAESTRO.md §2).
 *
 * Geometría: worldToScreen(cam, wx, wy, z) es la ÚNICA fuente de verdad.
 *   sx = rot(wx,wy).x · TILE · zoom + cam.x
 *   sy = rot(wx,wy).y · TILE · TILT · zoom + cam.y − z · TILE · zoom
 * screenToWorld() es su inversa exacta en el plano del suelo (z=0):
 * el picking NUNCA se engaña con la altura visual de las paredes.
 *
 * Painter's algorithm: suelos primero; luego paredes/objetos/PCJ
 * ordenados por profundidad (rot y, luego rot x).
 *
 * Corre en navegador (window.UGS.render) y en Node (module.exports,
 * para matemáticas de picking/proyección en tests).
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

  const TILE = 64;                 // px por tile a zoom 1
  const TILT = 0.55;               // compresión del eje Y (dimetría ¾)
  const WALL_H = 0.72;             // altura de pared (en tiles)
  const OBJ_H = 0.34;              // altura de objetos
  const COLORS = {
    bg: '#0b0d12',
    wallTop: '#a9b3c6', wallSide: [104, 114, 134], wallLine: 'rgba(10,12,16,0.55)',
    objTop: '#4c5666', objSide: [56, 64, 78], objLine: '#62e0ef',
    pawnBody: '#8b97a8', pawnDark: '#3a4250', pawnVisor: '#62e0ef',
    pawnSel: '#ffd24a', path: 'rgba(98,224,239,0.5)',
    entry: '#7ee08a', link: '#62e0ef',
    shadow: 'rgba(0,0,0,0.35)'
  };
  // luz de escena: arriba-izquierda (las caras "sur" son las más claras)
  const LIGHT = (() => { const l = Math.hypot(-0.45, 0.89); return { x: -0.45 / l, y: 0.89 / l }; })();

  // ---- proyección (la ÚNICA fuente de verdad geométrica) -------------------
  function worldToScreen(cam, wx, wy, z) {
    const r = cam.rot || 0;
    const cos = Math.cos(r), sin = Math.sin(r);
    const rx = wx * cos - wy * sin, ry = wx * sin + wy * cos;
    return {
      x: rx * TILE * cam.zoom + cam.x,
      y: ry * TILE * TILT * cam.zoom + cam.y - (z || 0) * TILE * cam.zoom
    };
  }
  // inversa exacta en el plano del suelo (z=0): la base del tile manda
  function screenToWorld(cam, px, py) {
    const ux = (px - cam.x) / (TILE * cam.zoom), uy = (py - cam.y) / (TILE * TILT * cam.zoom);
    const r = cam.rot || 0;
    const cos = Math.cos(r), sin = Math.sin(r);
    return { x: ux * cos + uy * sin, y: -ux * sin + uy * cos };
  }
  // dirección (en el suelo) desde la escena HACIA la cámara
  function camDir2D(rot) { return { x: Math.sin(rot || 0), y: Math.cos(rot || 0) }; }
  // ¿la cara con normal (nx,ny) en mundo mira a la cámara?
  function faceVisible(nx, ny, rot) { const d = camDir2D(rot); return nx * d.x + ny * d.y > 0.05; }

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

  // ---- picking (plano del suelo; la altura de las paredes no engaña) -------
  function pick(cam, nexo, px, py) {
    const w = screenToWorld(cam, px, py);
    for (let i = nexo.rooms.length - 1; i >= 0; i--) {
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

  // ---- huellas de pared en espacio MUNDO (para extruir) ---------------------
  function wallFootprintWorld(wx, wy, kind, orientation) {
    const C = [
      { x: wx - 0.5, y: wy - 0.5 }, { x: wx + 0.5, y: wy - 0.5 },
      { x: wx + 0.5, y: wy + 0.5 }, { x: wx - 0.5, y: wy + 0.5 }
    ];
    if (kind === 'block') return C;
    const i = (Math.round(((orientation % 360) + 360) % 360 / 90)) % 4;
    const tri = [C[i], C[(i + 1) % 4], C[(i + 2) % 4]];
    if (kind === 'diagonal') return tri;
    const opp = C[(i + 3) % 4];
    const mid = { x: (tri[0].x + tri[2].x) / 2, y: (tri[0].y + tri[2].y) / 2 };
    return [tri[0], tri[1], tri[2], { x: mid.x + (opp.x - mid.x) * 0.55, y: mid.y + (opp.y - mid.y) * 0.55 }];
  }

  // ---- fade de oclusión (paredes entre la cámara y el PCJ) -----------------
  function rotatedXY(cam, wx, wy) {
    const r = cam.rot || 0, cos = Math.cos(r), sin = Math.sin(r);
    return { rx: wx * cos - wy * sin, ry: wx * sin + wy * cos };
  }
  function wallFadesPawn(cam, wallC, pawnC) {
    const w = rotatedXY(cam, wallC.x, wallC.y), p = rotatedXY(cam, pawnC.x, pawnC.y);
    return w.ry > p.ry + 0.15 && (w.ry - p.ry) < 2.8 && Math.abs(w.rx - p.rx) < 1.4;
  }

  // ---- primitivas de dibujo -------------------------------------------------
  function poly(ctx, pts, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke();
    }
  }
  function shade(rgb, f) {
    return 'rgb(' + Math.round(rgb[0] * f) + ',' + Math.round(rgb[1] * f) + ',' + Math.round(rgb[2] * f) + ')';
  }
  // extrusión de un polígono de suelo: caras visibles + tapa
  // hiddenEdges[i] = true fuerza ocultar la cara i (pared vecina compartida)
  function extrude(ctx, cam, footprint, h, topColor, sideRGB, lineColor, alpha, hiddenEdges) {
    const base = footprint.map(p => worldToScreen(cam, p.x, p.y, 0));
    const top = footprint.map(p => worldToScreen(cam, p.x, p.y, h));
    const cx = footprint.reduce((a, p) => a + p.x, 0) / footprint.length;
    const cy = footprint.reduce((a, p) => a + p.y, 0) / footprint.length;
    ctx.save();
    if (alpha != null) ctx.globalAlpha = alpha;
    // caras laterales (solo las que miran a la cámara)
    for (let i = 0; i < footprint.length; i++) {
      if (hiddenEdges && hiddenEdges[i]) continue;
      const j = (i + 1) % footprint.length;
      const mx = (footprint[i].x + footprint[j].x) / 2 - cx;
      const my = (footprint[i].y + footprint[j].y) / 2 - cy;
      const nl = Math.hypot(mx, my) || 1;
      const nx = mx / nl, ny = my / nl;
      if (!faceVisible(nx, ny, cam.rot)) continue;
      const f = 0.55 + 0.45 * Math.max(0, nx * LIGHT.x + ny * LIGHT.y);
      poly(ctx, [base[i], base[j], top[j], top[i]], shade(sideRGB, f), lineColor);
    }
    // tapa
    poly(ctx, top, topColor, lineColor);
    ctx.restore();
  }

  // ---- suelo ---------------------------------------------------------------
  function drawFloorTile(ctx, cam, room, x, y, tile) {
    const corner = (lx, ly, z) => { const w = localToWorld(room, lx, ly); return worldToScreen(cam, w.x, w.y, z); };
    const mat = DATA.FLOORS[tile.floor] || DATA.FLOORS.deck;
    poly(ctx, [corner(x, y, 0), corner(x + 1, y, 0), corner(x + 1, y + 1, 0), corner(x, y + 1, 0)], mat.color, 'rgba(0,0,0,0.35)');
    // línea de panel interior (detalle tipo Xenonauts)
    poly(ctx, [corner(x + 0.12, y + 0.12, 0), corner(x + 0.88, y + 0.12, 0), corner(x + 0.88, y + 0.88, 0), corner(x + 0.12, y + 0.88, 0)], null, 'rgba(255,255,255,0.05)');
  }

  // ---- paredes (extruidas) ---------------------------------------------------
  function drawWall(ctx, cam, room, x, y, wall, alpha) {
    // huella en espacio LOCAL del tile → localToWorld (sigue la rotación de la sala)
    const fpLocal = wallFootprintWorld(x + 0.5, y + 0.5, wall.kind, wall.orientation);
    const fp = fpLocal.map(p => localToWorld(room, p.x, p.y));
    // paredes block: ocultar caras compartidas con una pared vecina (sin costuras)
    let hidden = null;
    if (wall.kind === 'block') {
      const hasWall = (tx, ty) => !!(room.tiles[ty] && room.tiles[ty][tx] && room.tiles[ty][tx].wall);
      // aristas del cuadrado: 0→norte(0,-1) 1→este(1,0) 2→sur(0,1) 3→oeste(-1,0)
      hidden = [hasWall(x, y - 1), hasWall(x + 1, y), hasWall(x, y + 1), hasWall(x - 1, y)];
    }
    extrude(ctx, cam, fp, WALL_H, COLORS.wallTop, COLORS.wallSide, COLORS.wallLine, alpha, hidden);
  }

  // ---- objetos (cajas extruidas) ---------------------------------------------
  function objectColors(o) {
    switch (o.type) {
      case 'door': return o.open ? { top: '#3f6b52', side: [42, 74, 56] } : { top: '#5c6675', side: [70, 78, 92] };
      case 'console': return { top: '#3c4c5c', side: [44, 56, 70] };
      case 'elevator': return { top: '#2c4a56', side: [36, 62, 72] };
      case 'plant': return { top: '#4a6b44', side: [58, 84, 52] };
      default: return { top: COLORS.objTop, side: COLORS.objSide };
    }
  }
  // ---- sprite de consola (hoja v3 del equipo de arte) ----------------------
  // La hoja `!_UGS/RECURSOS/Processed/Console_control_v3.png` trae la consola
  // en los 4 yaws sobre placa negra y fondo blanco. NO se procesa píxel a
  // píxel: se recorta con la silueta hexagonal medida de cada vista (clip de
  // canvas), así funciona incluso bajo file:// (sin getImageData). Anclaje:
  // el centro de la huella (fp) se mapea al centro del tile en el suelo y el
  // ancho de la cara superior (topW) a la huella 0.62 tiles del contrato.
  const CONSOLE_SPRITE = {
    src: '!_UGS/RECURSOS/Processed/Console_control_v3.png',
    state: 'idle', img: null,
    VIEWS: {
      45:  { hex: [[494, 26], [826, 240], [824, 445], [494, 631], [164, 445], [163, 240]],
             topW: 663, fp: [494.5, 445], rect: [159, 22, 671, 613] },
      135: { hex: [[1545, 26], [1879, 295], [1872, 442], [1546, 643], [1218, 442], [1211, 295]],
             topW: 668, fp: [1545, 442], rect: [1207, 22, 676, 625] },
      225: { hex: [[1024, 716], [1299, 930], [1298, 1045], [1024, 1222], [750, 1045], [748, 930]],
             topW: 551, fp: [1023.5, 1045], rect: [744, 712, 559, 514] },
      315: { hex: [[501, 1316], [798, 1500], [801, 1655], [501, 1872], [201, 1655], [203, 1500]],
             topW: 595, fp: [500.5, 1655], rect: [197, 1312, 608, 564] }
    },
    ensure() {
      if (this.state !== 'idle' || typeof Image === 'undefined') return;
      this.state = 'loading';
      const im = new Image();
      im.onload = () => { this.img = im; this.state = 'ready'; };
      im.onerror = () => { this.img = null; this.state = 'error'; };
      im.src = encodeURI(this.src);
    },
    // vista para el yaw de cámara (pasos de 90° sobre base 45°); null si no lista
    view(cam) {
      if (this.state === 'idle') this.ensure();
      if (this.state !== 'ready') return null;
      let d = ((cam.rot || 0) * 180 / Math.PI) % 360;
      if (d < 0) d += 360;
      const keys = [45, 135, 225, 315];
      let best = keys[0], bd = Infinity;
      for (const k of keys) { const dd = Math.abs(d - k); if (dd < bd) { bd = dd; best = k; } }
      return this.VIEWS[best];
    }
  };

  function drawObject(ctx, cam, room, o) {
    const c = tileCenterWorld(room, o.x, o.y);
    if (o.type === 'console') {
      // sprite del arte si está listo; si no, cae a la caja procedural
      const v = CONSOLE_SPRITE.view(cam);
      if (v) {
        const s = worldToScreen(cam, c.x, c.y, 0);
        // span esquina a esquina de la huella 0.62×0.62 a yaw 45+k·90° (|cos|+|sin| = √2)
        const k = 0.62 * Math.SQRT2 * TILE * cam.zoom / v.topW;
        const mx = p => s.x + (p[0] - v.fp[0]) * k, my = p => s.y + (p[1] - v.fp[1]) * k;
        ctx.save();
        ctx.beginPath();
        v.hex.forEach((p, i) => { if (i) ctx.lineTo(mx(p), my(p)); else ctx.moveTo(mx(p), my(p)); });
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(CONSOLE_SPRITE.img, v.rect[0], v.rect[1], v.rect[2], v.rect[3],
          s.x + (v.rect[0] - v.fp[0]) * k, s.y + (v.rect[1] - v.fp[1]) * k,
          v.rect[2] * k, v.rect[3] * k);
        ctx.restore();
        return;
      }
    }
    if (o.type === 'elevator') {
      // pad plano con anillo luminoso
      const q = [0, 1, 2, 3].map(k => {
        const a = (o.rotation || 0) * Math.PI / 180 + k * Math.PI / 2 + Math.PI / 4;
        return worldToScreen(cam, c.x + Math.cos(a) * 0.42, c.y + Math.sin(a) * 0.42, 0.02);
      });
      poly(ctx, q, '#22333c', COLORS.link);
      const s = worldToScreen(cam, c.x, c.y, 0.02);
      ctx.strokeStyle = COLORS.link; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(s.x, s.y, 12 * cam.zoom, 12 * TILT * cam.zoom, 0, 0, Math.PI * 2); ctx.stroke();
      return;
    }
    const h = o.openable && o.open ? 0.1 : OBJ_H;
    const half = 0.31;
    const a = ((o.rotation || 0) + (room.transform.rotation || 0)) * Math.PI / 180;
    const ca = Math.cos(a), sa = Math.sin(a);
    const fp = [[-half, -half], [half, -half], [half, half], [-half, half]].map(([lx, ly]) => ({
      x: c.x + lx * ca - ly * sa, y: c.y + lx * sa + ly * ca
    }));
    const col = objectColors(o);
    extrude(ctx, cam, fp, h, col.top, col.side, COLORS.wallLine, null);
    // detalle: pantalla/tick luminoso en la cara superior
    const s = worldToScreen(cam, c.x, c.y, h);
    ctx.fillStyle = COLORS.objLine;
    ctx.fillRect(s.x - 3 * cam.zoom, s.y - 1.5 * cam.zoom, 6 * cam.zoom, 3 * cam.zoom);
  }

  // ---- PCJ "de pie" ------------------------------------------------------------
  function drawPawn(ctx, cam, room, p, selected) {
    const c = localToWorld(room, p.x + 0.5, p.y + 0.5);
    const z = cam.zoom;
    const s0 = worldToScreen(cam, c.x, c.y, 0);
    // sombra
    ctx.fillStyle = COLORS.shadow;
    ctx.beginPath(); ctx.ellipse(s0.x, s0.y, 11 * z, 11 * TILT * z, 0, 0, Math.PI * 2); ctx.fill();
    // cuerpo (cápsula vertical)
    const sFeet = worldToScreen(cam, c.x, c.y, 0.04);
    const sChest = worldToScreen(cam, c.x, c.y, 0.5);
    ctx.strokeStyle = selected ? COLORS.pawnSel : COLORS.pawnBody;
    ctx.lineWidth = 11 * z; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(sFeet.x, sFeet.y); ctx.lineTo(sChest.x, sChest.y); ctx.stroke();
    // casco
    const sHead = worldToScreen(cam, c.x, c.y, 0.6);
    ctx.fillStyle = COLORS.pawnDark;
    ctx.beginPath(); ctx.arc(sHead.x, sHead.y, 6.5 * z, 0, Math.PI * 2); ctx.fill();
    // visor hacia el facing (local sala → mundo → pantalla)
    const wf = rotatePoint(p.facingLocal.x, p.facingLocal.y, room.transform.rotation || 0, { x: 0, y: 0 });
    const fr = cam.rot || 0, cos = Math.cos(fr), sin = Math.sin(fr);
    const sx = wf.x * cos - wf.y * sin, sy = (wf.x * sin + wf.y * cos) * TILT;
    const sl = Math.hypot(sx, sy) || 1;
    ctx.strokeStyle = COLORS.pawnVisor; ctx.lineWidth = 2 * z;
    ctx.beginPath(); ctx.moveTo(sHead.x, sHead.y);
    ctx.lineTo(sHead.x + (sx / sl) * 6 * z, sHead.y + (sy / sl) * 6 * z); ctx.stroke();
    if (selected) {
      ctx.strokeStyle = COLORS.pawnSel; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(s0.x, s0.y, 13 * z, 13 * TILT * z, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // ---- dibujo principal --------------------------------------------------------
  function drawNexo(ctx, cam, nexo, opts) {
    opts = opts || {};
    // 1) suelos (no se solapan entre sí)
    for (const room of nexo.rooms) {
      for (let y = 0; y < room.size.h; y++) {
        for (let x = 0; x < room.size.w; x++) {
          const tile = room.tiles[y][x];
          if (!tile || tile.floor === 'void') continue;
          drawFloorTile(ctx, cam, room, x, y, tile);
        }
      }
    }
    // 2) ítems con profundidad: paredes, objetos, PCJ (painter's algorithm)
    const items = [];
    for (const room of nexo.rooms) {
      for (let y = 0; y < room.size.h; y++) {
        for (let x = 0; x < room.size.w; x++) {
          const tile = room.tiles[y][x];
          if (tile && tile.wall) {
            const c = tileCenterWorld(room, x, y);
            items.push({ c, draw: (a) => drawWall(ctx, cam, room, x, y, tile.wall, a), wall: true });
          }
        }
      }
      for (const o of room.objects) {
        const c = tileCenterWorld(room, o.x, o.y);
        items.push({ c, draw: () => drawObject(ctx, cam, room, o), wall: false });
      }
    }
    if (opts.pawns) {
      for (const p of opts.pawns) {
        const room = nexo.rooms.find(r => r.id === p.roomId); if (!room) continue;
        const c = localToWorld(room, p.x + 0.5, p.y + 0.5);
        items.push({ c, draw: () => drawPawn(ctx, cam, room, p, opts.selectedPawnId === p.id), wall: false });
      }
    }
    for (const it of items) {
      const r = rotatedXY(cam, it.c.x, it.c.y);
      it.key = r.ry * 4096 + r.rx;
    }
    items.sort((a, b) => a.key - b.key);
    for (const it of items) {
      let alpha = null;
      if (it.wall && opts.pawns) {
        for (const p of opts.pawns) {
          const room = nexo.rooms.find(r => r.id === p.roomId); if (!room) continue;
          const pc = localToWorld(room, p.x + 0.5, p.y + 0.5);
          if (wallFadesPawn(cam, it.c, pc)) { alpha = 0.35; break; }
        }
      }
      it.draw(alpha);
    }
    // 3) ruta del PCJ (línea sobre el suelo, alpha bajo para legibilidad)
    if (opts.pawns) {
      for (const p of opts.pawns) {
        if (!p.path || !p.path.length) continue;
        const room = nexo.rooms.find(r => r.id === p.roomId); if (!room) continue;
        ctx.strokeStyle = COLORS.path; ctx.lineWidth = 3 * cam.zoom; ctx.lineCap = 'round';
        ctx.beginPath();
        const s0 = worldToScreen(cam, ...Object.values(localToWorld(room, p.x + 0.5, p.y + 0.5)), 0.02);
        ctx.moveTo(s0.x, s0.y);
        for (const wp of p.path) {
          // cada paso vive en SU sala (multi-sala); sin roomId = sala actual del peón
          const wr = (wp.roomId && nexo.rooms.find(r => r.id === wp.roomId)) || room;
          const c = tileCenterWorld(wr, wp.x, wp.y);
          const s = worldToScreen(cam, c.x, c.y, 0.02);
          ctx.lineTo(s.x, s.y);
        }
        ctx.stroke();
      }
    }
    // 4) marcadores de entrada / links / hover
    if (opts.entry) {
      const room = nexo.rooms.find(r => r.id === opts.entry.roomId);
      if (room) {
        const c = tileCenterWorld(room, opts.entry.x, opts.entry.y);
        const s = worldToScreen(cam, c.x, c.y, 0.03);
        ctx.strokeStyle = COLORS.entry; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(s.x, s.y, 10 * cam.zoom, 10 * TILT * cam.zoom, 0, 0, Math.PI * 2); ctx.stroke();
      }
    }
    if (opts.linkMarkers) {
      for (const m of opts.linkMarkers) {
        const room = nexo.rooms.find(r => r.id === m.roomId); if (!room) continue;
        const c = tileCenterWorld(room, m.x, m.y);
        const s = worldToScreen(cam, c.x, c.y, 0.03);
        ctx.fillStyle = COLORS.link;
        ctx.font = `${Math.max(11, 13 * cam.zoom)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('▣', s.x, s.y);
      }
    }
    if (opts.hover) {
      const room = nexo.rooms.find(r => r.id === opts.hover.roomId);
      if (room) {
        const hx = opts.hover.lx, hy = opts.hover.ly;
        const corner = (lx, ly) => { const w = localToWorld(room, lx, ly); return worldToScreen(cam, w.x, w.y, 0.02); };
        poly(ctx, [corner(hx, hy), corner(hx + 1, hy), corner(hx + 1, hy + 1), corner(hx, hy + 1)], 'rgba(255,255,255,0.14)', '#ffffff');
      }
    }
    // ghost: preview del rectángulo de arrastre (suite dev: suelo/pared/borrar)
    if (opts.ghost) {
      const room = nexo.rooms.find(r => r.id === opts.ghost.roomId);
      if (room) {
        const g = opts.ghost;
        const gx0 = Math.min(g.x0, g.x1), gx1 = Math.max(g.x0, g.x1) + 1;
        const gy0 = Math.min(g.y0, g.y1), gy1 = Math.max(g.y0, g.y1) + 1;
        const corner = (lx, ly) => { const w = localToWorld(room, lx, ly); return worldToScreen(cam, w.x, w.y, 0.03); };
        poly(ctx, [corner(gx0, gy0), corner(gx1, gy0), corner(gx1, gy1), corner(gx0, gy1)], 'rgba(98,224,239,0.16)', 'rgba(98,224,239,0.9)');
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
    const s = worldToScreen({ x: 0, y: 0, zoom: cam.zoom, rot: cam.rot || 0 }, cx, cy, 0);
    cam.x = viewW / 2 - s.x; cam.y = viewH / 2 - s.y;
  }

  return {
    TILE, TILT, WALL_H, OBJ_H, COLORS, CONSOLE_SPRITE,
    worldToScreen, screenToWorld, camDir2D, faceVisible, wallFadesPawn,
    rotatePoint, localToWorld, worldToLocal, tileCenterWorld, roomCenterWorld,
    pick, wallFootprintWorld, drawNexo, clear, centerOn
  };
});
