/*
 * UGS — render/render3d  (vista ¾ sobre WebGL con three.js — contrato C4)
 * ==================================================================
 * [RENDERIZADOR GRÁFICO] — alternativa WebGL de render/render.js
 * (decisión humana 2026-07-26, AGENTIC_REVIEW §6.14): dibuja la MISMA
 * escena con three.js manteniendo EXACTAMENTE la misma proyección y el
 * MISMO picking (toda la matemática se delega a render.js — la fuente
 * de verdad sigue siendo worldToScreen/screenToWorld de render.js).
 *
 * Cómo se logra la equivalencia exacta:
 *  - La cámara NO usa lookAt: se construye la matriz de proyección
 *    directamente desde la fórmula 2D (sx = rx·TILE·zoom + cam.x,
 *    sy = ry·TILE·TILT·zoom − z·TILE·zoom + cam.y), con NDCz lineal
 *    para el z-buffer. Así overlays 2D y picking coinciden al píxel.
 *  - Mundo z-up en unidades de tile: paredes extruidas (ExtrudeGeometry
 *    desde las mismas huellas de render.js), objetos caja, PCJ cápsula,
 *    consola = plano vertical recortado por la silueta hexagonal medida
 *    de la hoja v3 (misma técnica que el sprite 2D) mirando a la cámara.
 *
 * Sin three.js (CDN caído) o sin WebGL → available() = false y app.js
 * usa el renderer 2D. En Node carga sin tocar DOM (para tests).
 */
(function (root, factory) {
  const r2 = (root.UGS && root.UGS.render)
    || (typeof require !== 'undefined' ? require('./render.js') : null);
  const dataApi = (root.UGS && root.UGS.data)
    || (typeof require !== 'undefined' ? require('../core/data.js') : null);
  const api = factory(r2, dataApi);
  root.UGS = root.UGS || {};
  root.UGS.render3d = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R2, DATA) {
  'use strict';

  const TILE = R2.TILE, TILT = R2.TILT, WALL_H = R2.WALL_H, OBJ_H = R2.OBJ_H;
  const COLORS = R2.COLORS;
  const EL = Math.asin(TILT);            // elevación implícita de la dimetría
  const CEL = Math.cos(EL);

  // ---- estado GL ------------------------------------------------------------
  let gl = null;      // { renderer, scene, camera, group, canvas }
  let sheet = null;   // textura de la hoja de consolas v3 (o 'loading'/'error')

  function available() {
    if (typeof THREE === 'undefined' || typeof document === 'undefined') return false;
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (e) { return false; }
  }

  function init(canvas, onReady) {
    if (!available()) return false;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.bg);
    // modelo de luz calibrado con la fórmula 2D (f = 0.55 + 0.45·max(0, n·L)):
    // ambient 0.55 + direccional 0.45 casi horizontal → laterales con el mismo
    // sombreado por orientación que el 2D (ni quemados ni fantasma).
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 0.45);
    sun.position.set(-0.45, 0.89, 0.35).normalize();
    scene.add(sun);
    const camera = new THREE.OrthographicCamera();
    gl = { renderer, scene, camera, group: null, canvas };
    // hoja de consolas (misma que el sprite 2D)
    sheet = 'loading';
    new THREE.TextureLoader().load(encodeURI(R2.CONSOLE_SPRITE.src), (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      sheet = t;
      if (onReady) onReady();
    }, undefined, () => { sheet = 'error'; });
    return true;
  }

  // ---- cámara: proyección EXACTA de la fórmula 2D ----------------------------
  function updateCamera(cam, w, h) {
    const S = TILE * cam.zoom;
    const r = cam.rot || 0, cos = Math.cos(r), sin = Math.sin(r);
    const nx = (2 / w) * S, ny = (2 / h) * S;      // px → NDC
    const ox = (2 * cam.x / w) - 1, oy = 1 - (2 * cam.y / h);
    const dz = 1 / 50;                              // profundidad → [-1,1]
    // rx = wx·cos − wy·sin ; ry = wx·sin + wy·cos
    // NDCx = rx·nx + ox ; NDCy = −ry·TILT·ny + z·ny + oy
    // NDCz = (−ry·CEL − z·sin(EL))·dz
    const m = new THREE.Matrix4();
    m.set(
      cos * nx,         -sin * nx,          0,             ox,
      -sin * TILT * ny, -cos * TILT * ny,   ny,            oy,
      -sin * CEL * dz,  -cos * CEL * dz,    -Math.sin(EL) * dz, 0,
      0, 0, 0, 1
    );
    const cam3 = gl.camera;
    cam3.projectionMatrix.copy(m);
    cam3.projectionMatrixInverse.copy(m).invert();
    cam3.matrixWorld.identity();
    cam3.matrixWorldInverse.identity();
    gl.renderer.setSize(w, h, false);
  }

  // ---- materiales ------------------------------------------------------------
  const MAT = {};
  function mat(key, maker) { if (!MAT[key]) MAT[key] = maker(); return MAT[key]; }
  const lam = (c) => new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide });
  const basic = (c, o) => new THREE.MeshBasicMaterial({
    color: c, transparent: o != null, opacity: o == null ? 1 : o, side: THREE.DoubleSide
  });

  function mesh(geo, material) {
    const m = new THREE.Mesh(geo, material);
    m.frustumCulled = false;
    return m;
  }

  // ---- piezas de escena (unidades = tiles, z-up) ------------------------------
  function addFloor(g, room, x, y, tile) {
    const c = R2.tileCenterWorld(room, x, y);
    const color = (DATA.FLOORS[tile.floor] || DATA.FLOORS.deck).color;
    // sin iluminar: color plano de paleta, idéntico al 2D (deck/dark/light distinguibles)
    const m = mesh(new THREE.PlaneGeometry(1, 1), mat('floor:' + color, () => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })));
    m.position.set(c.x, c.y, 0);
    g.add(m);
    // línea de panel interior (detalle tipo Xenonauts)
    const pts = [[0.12, 0.12], [0.88, 0.12], [0.88, 0.88], [0.12, 0.88]].map(([lx, ly]) => {
      const w = R2.localToWorld(room, x + lx, y + ly);
      return new THREE.Vector3(w.x, w.y, 0.005);
    });
    const line = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(pts),
      mat('panel', () => new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07 })));
    line.frustumCulled = false;
    g.add(line);
  }

  function addWall(g, room, x, y, wall, alpha) {
    const fpLocal = R2.wallFootprintWorld(x + 0.5, y + 0.5, wall.kind, wall.orientation);
    const wfp = fpLocal.map(p => R2.localToWorld(room, p.x, p.y));
    const shape = new THREE.Shape(wfp.map(p => new THREE.Vector2(p.x, p.y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: WALL_H, bevelEnabled: false });
    // dos materiales (grupos de ExtrudeGeometry: 0=tapas, 1=laterales):
    // tapa CLARA sin iluminar (#a9b3c6) y laterales OSCUROS con sombreado 3D,
    // el mismo contraste que el 2D — las paredes se leen sólidas, no fantasma.
    const faded = alpha != null;
    const capM = faded
      ? mat('wallCapFade', () => new THREE.MeshBasicMaterial({ color: COLORS.wallTop, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }))
      : mat('wallCap', () => new THREE.MeshBasicMaterial({ color: COLORS.wallTop, side: THREE.DoubleSide }));
    const sideM = faded
      ? mat('wallSideFade', () => new THREE.MeshLambertMaterial({ color: 'rgb(104,114,134)', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }))
      : mat('wallSide', () => new THREE.MeshLambertMaterial({ color: 'rgb(104,114,134)', side: THREE.DoubleSide }));
    const m = mesh(geo, [capM, sideM]);
    g.add(m);
  }

  function addObject(g, room, o, cam) {
    const c = R2.tileCenterWorld(room, o.x, o.y);
    if (o.type === 'console' && sheet && sheet !== 'loading' && sheet !== 'error') {
      const yawDeg = Math.round((((cam.rot || 0) * 180 / Math.PI) % 360 + 360) % 360);
      const keys = [45, 135, 225, 315];
      let best = keys[0], bd = Infinity;
      for (const k of keys) { const dd = Math.abs(yawDeg - k); if (dd < bd) { bd = dd; best = k; } }
      const v = R2.CONSOLE_SPRITE.VIEWS[best];
      const k3 = 0.62 * Math.SQRT2 / v.topW;        // mundo por px de hoja
      const shape = new THREE.Shape(v.hex.map(p => new THREE.Vector2((p[0] - v.fp[0]) * k3, (v.fp[1] - p[1]) * k3)));
      const geo = new THREE.ShapeGeometry(shape);
      // UV: px de hoja → uv de textura (flipY por defecto)
      const pos = geo.attributes.position, uv = geo.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i) / k3 + v.fp[0], py = v.fp[1] - pos.getY(i) / k3;
        uv.setXY(i, px / sheet.image.width, 1 - py / sheet.image.height);
      }
      const m = mesh(geo, new THREE.MeshBasicMaterial({ map: sheet, side: THREE.DoubleSide }));
      m.geometry.rotateX(Math.PI / 2);              // y del sprite → z mundo
      m.rotation.z = -(cam.rot || 0);               // eje x del sprite → eje x de pantalla
      // empuje leve HACIA la cámara (dirección de proyección d = (sin,cos,TILT)):
      // no mueve el sprite en pantalla (proyección oblícua) y evita que la
      // punta frontal de la base (z<0 en el billboard) quede bajo el suelo.
      const r3 = cam.rot || 0, push = 0.30;
      m.position.set(c.x + Math.sin(r3) * push, c.y + Math.cos(r3) * push, 0.01 + TILT * push);
      g.add(m);
      return;
    }
    if (o.type === 'elevator') {
      const pad = mesh(new THREE.CircleGeometry(0.42, 4), basic('#22333c'));
      pad.rotation.z = Math.PI / 4 + (o.rotation || 0) * Math.PI / 180;
      pad.position.set(c.x, c.y, 0.02);
      g.add(pad);
      const ring = mesh(new THREE.RingGeometry(0.15, 0.19, 32), basic(COLORS.link));
      ring.position.set(c.x, c.y, 0.025);
      g.add(ring);
      return;
    }
    const OCOL = {
      door: o.open ? { top: '#3f6b52', side: 'rgb(42,74,56)' } : { top: '#5c6675', side: 'rgb(70,78,92)' },
      console: { top: '#3c4c5c', side: 'rgb(44,56,70)' },
      plant: { top: '#4a6b44', side: 'rgb(58,84,52)' }
    }[o.type] || { top: COLORS.objTop, side: 'rgb(56,64,78)' };
    const h = o.openable && o.open ? 0.1 : OBJ_H;
    // BoxGeometry: grupos 0-3 laterales, 4 = tapa (+z), 5 = base
    const sideM = mat('objSide:' + OCOL.side, () => new THREE.MeshLambertMaterial({ color: OCOL.side, side: THREE.DoubleSide }));
    const topM = mat('objTop:' + OCOL.top, () => new THREE.MeshBasicMaterial({ color: OCOL.top, side: THREE.DoubleSide }));
    const m = mesh(new THREE.BoxGeometry(0.62, 0.62, h), [sideM, sideM, sideM, sideM, topM, sideM]);
    m.rotation.z = ((o.rotation || 0) + (room.transform.rotation || 0)) * Math.PI / 180;
    m.position.set(c.x, c.y, h / 2);
    g.add(m);
    // tick luminoso superior
    const tick = mesh(new THREE.PlaneGeometry(0.1, 0.05), basic(COLORS.objLine));
    tick.position.set(c.x, c.y, h + 0.005);
    g.add(tick);
  }

  function addPawn(g, nexo, p, selected) {
    const room = nexo.rooms.find(r => r.id === p.roomId); if (!room) return;
    const c = R2.localToWorld(room, p.x + 0.5, p.y + 0.5);
    const sh = mesh(new THREE.CircleGeometry(0.15, 24), basic(0x000000, 0.35));
    sh.position.set(c.x, c.y, 0.005);
    g.add(sh);
    const body = mesh(new THREE.CapsuleGeometry(0.086, 0.33, 4, 12),
      basic(selected ? COLORS.pawnSel : COLORS.pawnBody));
    body.geometry.rotateX(Math.PI / 2);             // eje de la cápsula → z
    body.position.set(c.x, c.y, 0.29);
    g.add(body);
    const head = mesh(new THREE.SphereGeometry(0.1, 14, 10), basic(COLORS.pawnDark));
    head.position.set(c.x, c.y, 0.6);
    g.add(head);
    // visor hacia el facing
    const wf = R2.rotatePoint(p.facingLocal.x, p.facingLocal.y, room.transform.rotation || 0, { x: 0, y: 0 });
    const l = Math.hypot(wf.x, wf.y) || 1;
    const vg = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(c.x, c.y, 0.6),
      new THREE.Vector3(c.x + (wf.x / l) * 0.11, c.y + (wf.y / l) * 0.11, 0.6)
    ]);
    const vis = new THREE.Line(vg, mat('visor', () => new THREE.LineBasicMaterial({ color: COLORS.pawnVisor })));
    vis.frustumCulled = false;
    g.add(vis);
    if (selected) {
      const ring = mesh(new THREE.RingGeometry(0.17, 0.2, 32), basic(COLORS.pawnSel));
      ring.position.set(c.x, c.y, 0.008);
      g.add(ring);
    }
  }

  function addTrail(g, nexo, p) {
    if (!p.path || !p.path.length) return;
    const room = nexo.rooms.find(r => r.id === p.roomId); if (!room) return;
    const pts = [];
    const c0 = R2.localToWorld(room, p.x + 0.5, p.y + 0.5);
    pts.push(new THREE.Vector3(c0.x, c0.y, 0.02));
    for (const wp of p.path) {
      const wr = (wp.roomId && nexo.rooms.find(r => r.id === wp.roomId)) || room;
      const c = R2.tileCenterWorld(wr, wp.x, wp.y);
      pts.push(new THREE.Vector3(c.x, c.y, 0.02));
    }
    // cinta plana (WebGL ignora lineWidth): quad por segmento
    const HW = 0.024;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const nx = -dy / len * HW, ny = dx / len * HW;
      const geo = new THREE.BufferGeometry();
      const v = new Float32Array([
        a.x + nx, a.y + ny, 0.02, b.x + nx, b.y + ny, 0.02, b.x - nx, b.y - ny, 0.02,
        a.x + nx, a.y + ny, 0.02, b.x - nx, b.y - ny, 0.02, a.x - nx, a.y - ny, 0.02
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
      g.add(mesh(geo, mat('trail', () => basic(COLORS.path, 0.55))));
    }
  }

  function flatQuad(g, corners, color, opacity, z) {
    const shape = new THREE.Shape(corners.map(p => new THREE.Vector2(p.x, p.y)));
    const m = mesh(new THREE.ShapeGeometry(shape), basic(color, opacity));
    m.position.set(0, 0, z);
    g.add(m);
  }

  // ---- API principal ----------------------------------------------------------
  function drawNexo(_ctx, cam, nexo, opts) {
    if (!gl) return;
    opts = opts || {};
    const canvas = gl.canvas;
    updateCamera(cam, canvas.clientWidth, canvas.clientHeight);
    // reconstruir la escena (drawNexo solo se llama cuando hay cambios)
    if (gl.group) {
      gl.scene.remove(gl.group);
      gl.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    }
    const g = new THREE.Group();
    // 1) suelos
    for (const room of nexo.rooms) {
      for (let y = 0; y < room.size.h; y++) {
        for (let x = 0; x < room.size.w; x++) {
          const tile = room.tiles[y][x];
          if (!tile || tile.floor === 'void') continue;
          addFloor(g, room, x, y, tile);
        }
      }
    }
    // 2) paredes / objetos / PCJ (el z-buffer resuelve la oclusión; el fade
    //    sigue la misma regla que en 2D)
    for (const room of nexo.rooms) {
      for (let y = 0; y < room.size.h; y++) {
        for (let x = 0; x < room.size.w; x++) {
          const tile = room.tiles[y][x];
          if (tile && tile.wall) {
            let alpha = null;
            if (opts.pawns) {
              const wc = R2.tileCenterWorld(room, x, y);
              for (const p of opts.pawns) {
                const pr = nexo.rooms.find(r => r.id === p.roomId); if (!pr) continue;
                const pc = R2.localToWorld(pr, p.x + 0.5, p.y + 0.5);
                if (R2.wallFadesPawn(cam, wc, pc)) { alpha = 0.35; break; }
              }
            }
            addWall(g, room, x, y, tile.wall, alpha);
          }
        }
      }
      for (const o of room.objects) addObject(g, room, o, cam);
    }
    if (opts.pawns) {
      for (const p of opts.pawns) addPawn(g, nexo, p, opts.selectedPawnId === p.id);
      for (const p of opts.pawns) addTrail(g, nexo, p);
    }
    // 3) marcadores
    if (opts.entry) {
      const room = nexo.rooms.find(r => r.id === opts.entry.roomId);
      if (room) {
        const c = R2.tileCenterWorld(room, opts.entry.x, opts.entry.y);
        const ring = mesh(new THREE.RingGeometry(0.14, 0.17, 32), basic(COLORS.entry));
        ring.position.set(c.x, c.y, 0.03);
        g.add(ring);
      }
    }
    if (opts.linkMarkers) {
      for (const mk of opts.linkMarkers) {
        const room = nexo.rooms.find(r => r.id === mk.roomId); if (!room) continue;
        const c = R2.tileCenterWorld(room, mk.x, mk.y);
        const s = 0.1;
        const shape = new THREE.Shape([new THREE.Vector2(0, s), new THREE.Vector2(s, 0), new THREE.Vector2(0, -s), new THREE.Vector2(-s, 0)]);
        const m = mesh(new THREE.ShapeGeometry(shape), basic(COLORS.link));
        m.position.set(c.x, c.y, 0.03);
        g.add(m);
      }
    }
    if (opts.hover) {
      const room = nexo.rooms.find(r => r.id === opts.hover.roomId);
      if (room) {
        const hx = opts.hover.lx, hy = opts.hover.ly;
        flatQuad(g, [
          R2.localToWorld(room, hx, hy), R2.localToWorld(room, hx + 1, hy),
          R2.localToWorld(room, hx + 1, hy + 1), R2.localToWorld(room, hx, hy + 1)
        ], 0xffffff, 0.14, 0.02);
      }
    }
    if (opts.ghost) {
      const room = nexo.rooms.find(r => r.id === opts.ghost.roomId);
      if (room) {
        const gh = opts.ghost;
        const x0 = Math.min(gh.x0, gh.x1), x1 = Math.max(gh.x0, gh.x1) + 1;
        const y0 = Math.min(gh.y0, gh.y1), y1 = Math.max(gh.y0, gh.y1) + 1;
        flatQuad(g, [
          R2.localToWorld(room, x0, y0), R2.localToWorld(room, x1, y0),
          R2.localToWorld(room, x1, y1), R2.localToWorld(room, x0, y1)
        ], COLORS.link, 0.16, 0.03);
      }
    }
    gl.group = g;
    gl.scene.add(g);
    gl.renderer.render(gl.scene, gl.camera);
  }

  function clear() { /* el fondo lo pinta el propio WebGL (scene.background) */ }

  // ---- export: misma superficie que render.js (delegación) + init ------------
  const dbg = () => gl;
  return Object.assign({}, R2, {
    TILE, TILT, WALL_H, OBJ_H, COLORS,
    available, init, drawNexo, clear, dbg
  });
});
