/*
 * UGS — engine/nav  (REVAMP · base nueva)
 * ==================================================================
 * [COMPONENTES LÓGICOS] — pathfinding para el movimiento CLICK→RUTA del PCJ.
 * El jugador clica un tile; este módulo responde con una ruta (o null) y
 * agents.js la camina. No existe movimiento por teclado en el juego.
 *
 * Contratos de colisión: ver core/data.js (C1-C3). A* 4-direccional
 * determinista (las diagonales podrían cortar esquinas entre paredes).
 *
 * Corre en navegador (window.UGS.nav) y en Node (module.exports).
 */
(function (root, factory) {
  const api = factory();
  root.UGS = root.UGS || {};
  root.UGS.nav = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function walkable(room, x, y) {
    if (!room || x < 0 || y < 0 || x >= room.size.w || y >= room.size.h) return false;
    const tile = room.tiles[y] && room.tiles[y][x];
    if (!tile || tile.floor === 'void') return false;          // C3
    if (tile.wall) return false;                               // C1: TODA pared bloquea
    for (const o of room.objects) {
      if (o.x !== x || o.y !== y) continue;
      if (!o.solid) continue;                                  // decoración atraviesa
      if (o.openable && o.open) continue;                      // C2: puerta abierta deja pasar
      return false;
    }
    return true;
  }

  // A* dentro de UNA sala. Devuelve waypoints {x,y} SIN el origen y CON el
  // destino, o null si no hay ruta. Determinista: desempates por inserción.
  function findPath(room, sx, sy, tx, ty, opts) {
    sx |= 0; sy |= 0; tx |= 0; ty |= 0;
    const maxExpand = (opts && opts.maxExpand) || 4096;
    if (!walkable(room, tx, ty)) return null;
    if (sx === tx && sy === ty) return [];
    if (!walkable(room, sx, sy)) return null;

    const W = room.size.w;
    const idx = (x, y) => y * W + x;
    const gScore = new Map();
    const cameFrom = new Map();
    const h = (x, y) => Math.abs(x - tx) + Math.abs(y - ty);
    const open = [{ x: sx, y: sy, f: h(sx, sy), n: 0 }];
    let counter = 1;
    gScore.set(idx(sx, sy), 0);

    let expanded = 0;
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f || (open[i].f === open[bi].f && open[i].n < open[bi].n)) bi = i;
      const cur = open.splice(bi, 1)[0];
      const ck = idx(cur.x, cur.y);
      const g = gScore.get(ck);
      if (cur.x === tx && cur.y === ty) {
        const path = [];
        let k = ck;
        while (cameFrom.has(k)) {
          const px = k % W, py = (k - px) / W;
          path.push({ x: px, y: py });
          k = cameFrom.get(k);
        }
        path.reverse();
        return path;
      }
      if (++expanded > maxExpand) return null;
      for (const [dx, dy] of DIRS) {
        const nx = cur.x + dx, ny = cur.y + dy;
        if (!walkable(room, nx, ny)) continue;
        const nk = idx(nx, ny);
        const ng = g + 1;
        if (gScore.has(nk) && gScore.get(nk) <= ng) continue;
        gScore.set(nk, ng);
        cameFrom.set(nk, ck);
        open.push({ x: nx, y: ny, f: ng + h(nx, ny), n: counter++ });
      }
    }
    return null;
  }

  return { walkable, findPath, DIRS };
});
