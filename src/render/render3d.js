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
 * RENDIMIENTO (§6.15): la escena NO se reconstruye por frame. Un firma
 * estructural (keyOf) decide cuándo reconstruir el grupo estático
 * (suelos/paredes/objetos): solo si cambia el MAPA o el yaw. El PCJ es
 * persistente (se actualizan posiciones in-situ), el fade de paredes es
 * un intercambio de materiales sobre meshes cacheados, y los marcadores
 * dev son un grupo dinámico diminuto que se regenera por frame sucio.
 *
 * REGLA DE LA ESCENA (§6.28): la escena es la dueña de lo que se dibuja, no
 * nuestras variables. Todo grupo entra y sale por `swapGroup`; poner una
 * variable a null NO borra nada de la escena.
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
  let gl = null;      // { renderer, scene, camera, canvas }
  let sheet = null;   // textura de la hoja de consolas v3 (o 'loading'/'error')
  let sheetReady = false;
  const viewGeo = {};            // yaw → ShapeGeometry horneada de la consola (compartida)
  let stat = null;               // escena estática { key, group, geos, walls }
  let dyn = null;                // marcadores dev { group, geos }
  const pawns3 = new Map();      // pawnId → meshes persistentes del PCJ
  let lastSize = { w: 0, h: 0 };

  /*
   * ÚNICA puerta para meter/sacar un grupo de la escena (regresión 2026-07-28).
   * Soltar la referencia a un grupo NO lo saca de la escena: three.js sigue
   * dibujándolo para siempre. Aquel `stat = null` suelto dejó la sala anterior
   * calcada encima de TODAS las vistas (módulos y nexos), y como el modelo no
   * la contenía, clicar su suelo fantasma no movía al PCJ.
   *
   * Invariante: como mucho UN grupo vivo por ranura. Pasar `next = null`
   * VACÍA la ranura (quitar + liberar), nunca la abandona.
   * Puro salvo por scene.add/remove: `scene` solo necesita add/remove y cada
   * geometría un dispose() — por eso se puede testear en Node sin three.js.
   */
  function swapGroup(scene, prev, next) {
    if (prev === next) return next;
    if (prev) {
      if (scene) scene.remove(prev.group);
      for (const geo of (prev.geos || [])) if (geo && geo.dispose) geo.dispose();
    }
    if (next && scene) scene.add(next.group);
    return next || null;
  }

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
    gl = { renderer, scene, camera, canvas };
    // hoja de consolas (misma que el sprite 2D)
    sheet = 'loading';
    new THREE.TextureLoader().load(encodeURI(R2.CONSOLE_SPRITE.src), (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      sheet = t;
      sheetReady = true;
      // la firma incluye sheetReady → hay que reconstruir con sprite. El grupo
      // viejo se SACA de la escena aquí: soltar la referencia lo dejaría
      // dibujándose para siempre (ver swapGroup).
      stat = swapGroup(scene, stat, null);
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
    // setSize resetea el buffer del canvas aunque el tamaño no cambie: solo si cambió
    if (w !== lastSize.w || h !== lastSize.h) {
      gl.renderer.setSize(w, h, false);
      lastSize = { w, h };
    }
  }

  // ---- materiales ------------------------------------------------------------
  const MAT = {};
  function mat(key, maker) { if (!MAT[key]) MAT[key] = maker(); return MAT[key]; }
  const lam = (c) => new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide });
  const basic = (c, o) => new THREE.MeshBasicMaterial({
    color: c, transparent: o != null, opacity: o == null ? 1 : o, side: THREE.DoubleSide
  });
  function wallMats(faded) {
    return faded
      ? [mat('wallCapFade', () => new THREE.MeshBasicMaterial({ color: COLORS.wallTop, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide })),
         mat('wallSideFade', () => new THREE.MeshLambertMaterial({ color: 'rgb(104,114,134)', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }))]
      : [mat('wallCap', () => new THREE.MeshBasicMaterial({ color: COLORS.wallTop, side: THREE.DoubleSide })),
         mat('wallSide', () => new THREE.MeshLambertMaterial({ color: 'rgb(104,114,134)', side: THREE.DoubleSide }))];
  }

  function mesh(geo, material) {
    const m = new THREE.Mesh(geo, material);
    m.frustumCulled = false;
    return m;
  }

  // ---- firma estructural del mapa ---------------------------------------------
  // La escena estática solo se reconstruye cuando cambia ESTA firma (contenido
  // del mapa + yaw de cámara + disponibilidad de la hoja). Pan/zoom y el
  // movimiento del PCJ NO la tocan → esos frames cuestan ~nada.
  function keyOf(nexo, yawDeg, sheetOk) {
    let k = (sheetOk ? 'S' : 's') + '@' + yawDeg;
    for (const room of nexo.rooms) {
      const t = room.transform;
      k += '|' + room.id + ',' + t.x + ',' + t.y + ',' + (t.rotation || 0) + ',' + room.size.w + 'x' + room.size.h;
      for (let y = 0; y < room.size.h; y++) {
        for (let x = 0; x < room.size.w; x++) {
          const tile = room.tiles[y][x];
          if (!tile) { k += ',.'; continue; }
          k += ',' + tile.floor + (tile.wall ? ':' + tile.wall.kind + tile.wall.orientation : '');
        }
      }
      for (const o of room.objects) k += ';' + o.type + o.x + ',' + o.y + (o.rotation || 0) + (o.open ? 1 : 0);
    }
    return k;
  }

  // ---- consola: geometría de vista horneada una vez por yaw -------------------
  function consoleGeo(yaw) {
    if (viewGeo[yaw]) return viewGeo[yaw];
    const v = R2.CONSOLE_SPRITE.VIEWS[yaw];
    const k3 = 0.62 * Math.SQRT2 / v.topW;        // mundo por px de hoja
    const shape = new THREE.Shape(v.hex.map(p => new THREE.Vector2((p[0] - v.fp[0]) * k3, (v.fp[1] - p[1]) * k3)));
    const geo = new THREE.ShapeGeometry(shape);
    // UV: px de hoja → uv de textura (flipY por defecto)
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i) / k3 + v.fp[0], py = v.fp[1] - pos.getY(i) / k3;
      uv.setXY(i, px / sheet.image.width, 1 - py / sheet.image.height);
    }
    geo.rotateX(Math.PI / 2);                     // y del sprite → z mundo
    viewGeo[yaw] = geo;
    return geo;
  }

  // ---- piezas de la escena estática (unidades = tiles, z-up) ------------------
  function addFloor(g, track, room, x, y, tile) {
    const c = R2.tileCenterWorld(room, x, y);
    const color = (DATA.FLOORS[tile.floor] || DATA.FLOORS.deck).color;
    // sin iluminar: color plano de paleta, idéntico al 2D (deck/dark/light distinguibles)
    const m = track(mesh(new THREE.PlaneGeometry(1, 1), mat('floor:' + color, () => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }))));
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
    track(line);
    g.add(line);
  }

  function addWall(g, track, walls, room, x, y, wall) {
    // muralla de hangar (K2 · OBJP-1.1): apertura oscura + marco luminoso
    if (wall.kind === 'bay') {
      const c00 = R2.localToWorld(room, x, y), c10 = R2.localToWorld(room, x + 1, y);
      const c11 = R2.localToWorld(room, x + 1, y + 1), c01 = R2.localToWorld(room, x, y + 1);
      const dark = track(mesh(new THREE.ShapeGeometry(new THREE.Shape(
        [c00, c10, c11, c01].map(p => new THREE.Vector2(p.x, p.y)))),
        mat('bayDark', () => new THREE.MeshBasicMaterial({ color: '#05070c', side: THREE.DoubleSide }))));
      dark.position.set(0, 0, 0.005);
      g.add(dark);
      const post3 = (a, b, h) => {
        const dx = b.x - a.x, dy = b.y - a.y, nl = Math.hypot(dx, dy) || 1;
        const ox = -dy / nl * 0.045, oy = dx / nl * 0.045;
        const shp = new THREE.Shape([
          new THREE.Vector2(a.x + ox, a.y + oy), new THREE.Vector2(b.x + ox, b.y + oy),
          new THREE.Vector2(b.x - ox, b.y - oy), new THREE.Vector2(a.x - ox, a.y - oy)
        ]);
        const m = track(mesh(new THREE.ExtrudeGeometry(shp, { depth: h, bevelEnabled: false }),
          mat('bayFrame', () => new THREE.MeshBasicMaterial({ color: '#d8f4ff', side: THREE.DoubleSide }))));
        g.add(m);
      };
      post3(c00, c10, WALL_H);
      post3(c00, c01, WALL_H);
      post3(c10, c11, WALL_H);
      post3(c01, c11, 0.12);
      // la apertura NO entra en el mapa de fades: una boca de hangar no se desvanece
      return;
    }
    const fpLocal = R2.wallFootprintWorld(x + 0.5, y + 0.5, wall.kind, wall.orientation);
    const wfp = fpLocal.map(p => R2.localToWorld(room, p.x, p.y));
    const shape = new THREE.Shape(wfp.map(p => new THREE.Vector2(p.x, p.y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: WALL_H, bevelEnabled: false });
    // dos materiales (grupos de ExtrudeGeometry: 0=tapas, 1=laterales):
    // tapa CLARA sin iluminar (#a9b3c6) y laterales OSCUROS con sombreado 3D,
    // el mismo contraste que el 2D — las paredes se leen sólidas, no fantasma.
    const m = track(mesh(geo, wallMats(false)));
    g.add(m);
    // registro para el fade por intercambio de material (sin reconstruir)
    walls.set(room.id + ':' + x + ':' + y, { mesh: m, c: R2.tileCenterWorld(room, x, y), faded: false });
  }

  function addObject(g, track, room, o, cam) {
    const c = R2.tileCenterWorld(room, o.x, o.y);
    if (o.type === 'console' && sheetReady) {
      const yawDeg = Math.round((((cam.rot || 0) * 180 / Math.PI) % 360 + 360) % 360);
      const keys = [45, 135, 225, 315];
      let best = keys[0], bd = Infinity;
      for (const k of keys) { const dd = Math.abs(yawDeg - k); if (dd < bd) { bd = dd; best = k; } }
      // geometría compartida (horneada por yaw): NO se trackea ni se dispone
      const m = mesh(consoleGeo(best), mat('consSheet', () => new THREE.MeshBasicMaterial({ map: sheet, side: THREE.DoubleSide })));
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
      const pad = track(mesh(new THREE.CircleGeometry(0.42, 4), basic('#22333c')));
      pad.rotation.z = Math.PI / 4 + (o.rotation || 0) * Math.PI / 180;
      pad.position.set(c.x, c.y, 0.02);
      g.add(pad);
      const ring = track(mesh(new THREE.RingGeometry(0.15, 0.19, 32), basic(COLORS.link)));
      ring.position.set(c.x, c.y, 0.025);
      g.add(ring);
      return;
    }
    /*
     * Objetos del catálogo (core/objects_lib): mismas PIEZAS que en el 2D, aquí
     * como cajas de three. El renderer no conoce ningún objeto por su nombre —
     * lee datos. Si el 2D y el 3D difieren visualmente, es que uno de los dos
     * no está leyendo la misma def.
     */
    const lib = (typeof window !== 'undefined' && window.UGS && window.UGS.objectsLib) || null;
    const def = lib && lib.byId(o.type);
    if (def && def.parts && def.parts.length) {
      const rot = ((o.rotation || 0) + (room.transform.rotation || 0)) * Math.PI / 180;
      const cr = Math.cos(rot), sr = Math.sin(rot);
      for (const pt of def.parts) {
        const col = lib.partColor(def, pt);
        const sideCss = 'rgb(' + col.side.join(',') + ')';
        const sM = mat('pSide:' + sideCss, () => new THREE.MeshLambertMaterial({ color: sideCss, side: THREE.DoubleSide }));
        const tM = mat('pTop:' + col.top, () => new THREE.MeshBasicMaterial({ color: col.top, side: THREE.DoubleSide }));
        const bx = track(mesh(new THREE.BoxGeometry(pt.w, pt.d, pt.h), [sM, sM, sM, sM, tM, sM]));
        bx.rotation.z = rot;
        bx.position.set(c.x + pt.x * cr - pt.y * sr, c.y + pt.x * sr + pt.y * cr, pt.z + pt.h / 2);
        g.add(bx);
      }
      return;
    }

    const OCOL = {
      door: o.open ? { top: '#3f6b52', side: 'rgb(42,74,56)' } : { top: '#5c6675', side: 'rgb(70,78,92)' },
      console: { top: '#3c4c5c', side: 'rgb(44,56,70)' },
      plant: { top: '#4a6b44', side: 'rgb(58,84,52)' },
      ship: { top: '#3a4a5e', side: 'rgb(40,52,68)' }
    }[o.type] || { top: COLORS.objTop, side: 'rgb(56,64,78)' };
    const h = o.openable && o.open ? 0.1 : OBJ_H;
    // BoxGeometry: grupos 0-3 laterales, 4 = tapa (+z), 5 = base
    const sideM = mat('objSide:' + OCOL.side, () => new THREE.MeshLambertMaterial({ color: OCOL.side, side: THREE.DoubleSide }));
    const topM = mat('objTop:' + OCOL.top, () => new THREE.MeshBasicMaterial({ color: OCOL.top, side: THREE.DoubleSide }));
    const m = track(mesh(new THREE.BoxGeometry(0.62, 0.62, h), [sideM, sideM, sideM, sideM, topM, sideM]));
    m.rotation.z = ((o.rotation || 0) + (room.transform.rotation || 0)) * Math.PI / 180;
    m.position.set(c.x, c.y, h / 2);
    g.add(m);
    // tick luminoso superior (las naves no lo llevan, como en el 2D)
    if (o.type !== 'ship') {
      const tick = track(mesh(new THREE.PlaneGeometry(0.1, 0.05), basic(COLORS.objLine)));
      tick.position.set(c.x, c.y, h + 0.005);
      g.add(tick);
    }
  }

  function rebuildStatic(nexo, cam, key) {
    const g = new THREE.Group();
    const geos = [];
    const walls = new Map();
    const track = (m) => { geos.push(m.geometry); return m; };
    // 1) suelos
    for (const room of nexo.rooms) {
      for (let y = 0; y < room.size.h; y++) {
        for (let x = 0; x < room.size.w; x++) {
          const tile = room.tiles[y][x];
          if (!tile || tile.floor === 'void') continue;
          addFloor(g, track, room, x, y, tile);
        }
      }
    }
    // 2) paredes + objetos (el z-buffer resuelve la oclusión)
    for (const room of nexo.rooms) {
      for (let y = 0; y < room.size.h; y++) {
        for (let x = 0; x < room.size.w; x++) {
          const tile = room.tiles[y][x];
          if (tile && tile.wall) addWall(g, track, walls, room, x, y, tile.wall);
        }
      }
      for (const o of room.objects) addObject(g, track, room, o, cam);
    }
    stat = swapGroup(gl.scene, stat, { key, group: g, geos, walls });
  }

  // ---- fade de paredes: intercambio de material (sin reconstruir) --------------
  function updateFades(cam, nexo, pawns) {
    if (!stat) return;
    const MN = wallMats(false), MF = wallMats(true);
    for (const wm of stat.walls.values()) {
      let faded = false;
      for (const p of pawns) {
        const pr = nexo.rooms.find(r => r.id === p.roomId); if (!pr) continue;
        const pc = R2.localToWorld(pr, p.x + 0.5, p.y + 0.5);
        if (R2.wallFadesPawn(cam, wm.c, pc)) { faded = true; break; }
      }
      if (faded !== wm.faded) { wm.faded = faded; wm.mesh.material = faded ? MF : MN; }
    }
  }

  // ---- PCJ persistente: se crea una vez y se actualizan posiciones -------------
  function makePawn3() {
    const root = new THREE.Group();
    const sh = mesh(new THREE.CircleGeometry(0.15, 24), basic(0x000000, 0.35));
    sh.position.z = 0.005;
    const bodyM = new THREE.MeshBasicMaterial({ color: COLORS.pawnBody, side: THREE.DoubleSide });
    const body = mesh(new THREE.CapsuleGeometry(0.086, 0.33, 4, 12), bodyM);
    body.geometry.rotateX(Math.PI / 2);             // eje de la cápsula → z
    const head = mesh(new THREE.SphereGeometry(0.1, 14, 10), basic(COLORS.pawnDark));
    const visGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0.1, 0, 0)]);
    const vis = new THREE.Line(visGeo, mat('visor', () => new THREE.LineBasicMaterial({ color: COLORS.pawnVisor })));
    vis.frustumCulled = false;
    const ring = mesh(new THREE.RingGeometry(0.17, 0.2, 32), basic(COLORS.pawnSel));
    ring.position.z = 0.008;
    root.add(sh, body, head, vis, ring);
    return { root, sh, body, bodyM, head, visGeo, ring, trail: null, trailKey: '' };
  }

  // trail como UNA geometría fusionada (WebGL ignora lineWidth): quad por segmento
  function trailGeo(nexo, p) {
    if (!p.path || !p.path.length) return null;
    const room = nexo.rooms.find(r => r.id === p.roomId); if (!room) return null;
    const pts = [];
    pts.push(R2.localToWorld(room, p.x + 0.5, p.y + 0.5));
    for (const wp of p.path) {
      const wr = (wp.roomId && nexo.rooms.find(r => r.id === wp.roomId)) || room;
      pts.push(R2.tileCenterWorld(wr, wp.x, wp.y));
    }
    const HW = 0.024, verts = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const nx = -dy / len * HW, ny = dx / len * HW;
      verts.push(
        a.x + nx, a.y + ny, 0.02, b.x + nx, b.y + ny, 0.02, b.x - nx, b.y - ny, 0.02,
        a.x + nx, a.y + ny, 0.02, b.x - nx, b.y - ny, 0.02, a.x - nx, a.y - ny, 0.02
      );
    }
    if (!verts.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    return geo;
  }

  function syncPawns(nexo, list, selectedId) {
    const seen = new Set();
    for (const p of list) {
      seen.add(p.id);
      let pm = pawns3.get(p.id);
      if (!pm) { pm = makePawn3(); pawns3.set(p.id, pm); gl.scene.add(pm.root); }
      const room = nexo.rooms.find(r => r.id === p.roomId);
      if (!room) { pm.root.visible = false; continue; }
      pm.root.visible = true;
      const c = R2.localToWorld(room, p.x + 0.5, p.y + 0.5);
      pm.sh.position.set(c.x, c.y, 0.005);
      pm.body.position.set(c.x, c.y, 0.29);
      pm.head.position.set(c.x, c.y, 0.6);
      // visor hacia el facing (actualizado in-situ, sin geometría nueva)
      const wf = R2.rotatePoint(p.facingLocal.x, p.facingLocal.y, room.transform.rotation || 0, { x: 0, y: 0 });
      const l = Math.hypot(wf.x, wf.y) || 1;
      const pos = pm.visGeo.attributes.position;
      pos.setXYZ(0, c.x, c.y, 0.6);
      pos.setXYZ(1, c.x + (wf.x / l) * 0.11, c.y + (wf.y / l) * 0.11, 0.6);
      pos.needsUpdate = true;
      pm.bodyM.color.set(selectedId === p.id ? COLORS.pawnSel : COLORS.pawnBody);
      pm.ring.visible = selectedId === p.id;
      pm.ring.position.set(c.x, c.y, 0.008);
      // trail: solo se regenera si cambió la ruta o la posición
      const tk = (p.path ? p.path.length : 0) + '|' + p.x.toFixed(3) + ',' + p.y.toFixed(3);
      if (tk !== pm.trailKey) {
        pm.trailKey = tk;
        if (pm.trail) { pm.root.remove(pm.trail); pm.trail.geometry.dispose(); pm.trail = null; }
        const geo = trailGeo(nexo, p);
        if (geo) { pm.trail = mesh(geo, mat('trail', () => basic(COLORS.path, 0.55))); pm.root.add(pm.trail); }
      }
    }
    for (const [id, pm] of [...pawns3]) {
      if (!seen.has(id)) {
        gl.scene.remove(pm.root);
        pm.root.traverse(o => { if (o.geometry) o.geometry.dispose(); });
        pawns3.delete(id);
      }
    }
  }

  // ---- marcadores dev (grupo dinámico diminuto, se regenera por frame sucio) ----
  function rebuildMarkers(nexo, opts) {
    const g = new THREE.Group();
    const geos = [];
    const put = (m) => { geos.push(m.geometry); g.add(m); return m; };
    if (opts.entry) {
      const room = nexo.rooms.find(r => r.id === opts.entry.roomId);
      if (room) {
        const c = R2.tileCenterWorld(room, opts.entry.x, opts.entry.y);
        const ring = put(mesh(new THREE.RingGeometry(0.14, 0.17, 32), basic(COLORS.entry)));
        ring.position.set(c.x, c.y, 0.03);
      }
    }
    if (opts.linkMarkers) {
      for (const mk of opts.linkMarkers) {
        const room = nexo.rooms.find(r => r.id === mk.roomId); if (!room) continue;
        const c = R2.tileCenterWorld(room, mk.x, mk.y);
        const s = 0.1;
        const shape = new THREE.Shape([new THREE.Vector2(0, s), new THREE.Vector2(s, 0), new THREE.Vector2(0, -s), new THREE.Vector2(-s, 0)]);
        const m = put(mesh(new THREE.ShapeGeometry(shape), basic(COLORS.link)));
        m.position.set(c.x, c.y, 0.03);
      }
    }
    if (opts.hover) {
      const room = nexo.rooms.find(r => r.id === opts.hover.roomId);
      if (room) {
        const hx = opts.hover.lx, hy = opts.hover.ly;
        const shape = new THREE.Shape([
          R2.localToWorld(room, hx, hy), R2.localToWorld(room, hx + 1, hy),
          R2.localToWorld(room, hx + 1, hy + 1), R2.localToWorld(room, hx, hy + 1)
        ].map(p => new THREE.Vector2(p.x, p.y)));
        const m = put(mesh(new THREE.ShapeGeometry(shape), basic(0xffffff, 0.14)));
        m.position.set(0, 0, 0.02);
      }
    }
    if (opts.ghost) {
      const room = nexo.rooms.find(r => r.id === opts.ghost.roomId);
      if (room) {
        const gh = opts.ghost;
        const x0 = Math.min(gh.x0, gh.x1), x1 = Math.max(gh.x0, gh.x1) + 1;
        const y0 = Math.min(gh.y0, gh.y1), y1 = Math.max(gh.y0, gh.y1) + 1;
        const shape = new THREE.Shape([
          R2.localToWorld(room, x0, y0), R2.localToWorld(room, x1, y0),
          R2.localToWorld(room, x1, y1), R2.localToWorld(room, x0, y1)
        ].map(p => new THREE.Vector2(p.x, p.y)));
        const m = put(mesh(new THREE.ShapeGeometry(shape), basic(COLORS.link, 0.16)));
        m.position.set(0, 0, 0.03);
      }
    }
    dyn = swapGroup(gl.scene, dyn, { group: g, geos });
  }

  // ---- API principal ----------------------------------------------------------
  function drawNexo(_ctx, cam, nexo, opts) {
    if (!gl) return;
    opts = opts || {};
    const canvas = gl.canvas;
    updateCamera(cam, canvas.clientWidth, canvas.clientHeight);
    const yawDeg = Math.round((((cam.rot || 0) * 180 / Math.PI) % 360 + 360) % 360);
    const key = keyOf(nexo, yawDeg, sheetReady);
    if (!stat || stat.key !== key) rebuildStatic(nexo, cam, key);
    updateFades(cam, nexo, opts.pawns || []);
    syncPawns(nexo, opts.pawns || [], opts.selectedPawnId);
    rebuildMarkers(nexo, opts);
    gl.renderer.render(gl.scene, gl.camera);
  }

  function clear() { /* el fondo lo pinta el propio WebGL (scene.background) */ }

  // ---- export: misma superficie que render.js (delegación) + init ------------
  const dbg = () => gl;
  return Object.assign({}, R2, {
    TILE, TILT, WALL_H, OBJ_H, COLORS,
    available, init, drawNexo, clear, dbg, keyOf, swapGroup
  });
});
