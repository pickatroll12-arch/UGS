/*
 * UGS — navigation  ([COMPONENTES LÓGICOS] · reescritura post-reset)
 * ==================================================================
 * Pathfinding for the PCJ's click→route movement. Pure logic: it reads the
 * room's tile grid and returns a route; it NEVER imports or calls the
 * renderer (AGENTIC_REVIEW §4, regla dura de arquitectura).
 *
 * Collision contract (validado en data.js, feedback humano):
 *   - Toda pared con colisión 'full' bloquea su TILE COMPLETO. El peón no
 *     puede pisar ese tile (nunca lo atraviesa — ese fue el bug que hundió
 *     la versión anterior).
 *   - Una pared 'partial' (opt-in, no por defecto) deja el tile pisable pero
 *     cierra los lados de su triángulo sólido: eso lo resuelve crossBlocked,
 *     no la rejilla.
 *   - Un objeto con colisión efectiva (objectBlocks) bloquea su tile.
 *   - Un suelo 'void' no es transitable.
 *
 * API pública:
 *   buildWalkGrid(room, objectBlocks) -> Grid2D  (1 = transitable, 0 = bloqueado)
 *   crossBlocked(room, x, y, dx, dy) -> bool      (cruce cerrado por pared parcial)
 *   findPath(room, sx, sy, tx, ty, objectBlocks) -> [{x,y}, ...] | null
 *
 * Corre en navegador (window.UGS.nav) y Node (module.exports) para tests.
 */
(function (root, factory) {
  const core = (root.UGS && root.UGS.core)
    || (typeof require !== 'undefined' ? require('./core.js') : null);
  if (!core) throw new Error('UGS.nav requires UGS.core to be loaded first.');
  const api = factory(core);
  root.UGS = root.UGS || {};
  root.UGS.nav = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';

  const Grid2D = core.Grid2D;

  // ---- wall geometry -------------------------------------------------------
  // A wall piece stores { kind:'block'|'diagonal'|'rounded', orientation, collision }.
  // Corner indexing matches render.js wallPolygon EXACTLY (so the collision the
  // player sees is the collision they get): C = [0:top/TL, 1:right/TR, 2:bottom/BR,
  // 3:left/BL]. The four tile EDGES map to orthogonal neighbours:
  //   north (dy<0): corners 0-1 · east (dx>0): 1-2 · south (dy>0): 2-3 · west (dx<0): 3-0
  function fullBlocksTile(wall) {
    // Only a full-collision wall removes its whole tile from the walk grid.
    return !!wall && (wall.collision || 'full') !== 'partial';
  }
  // Which corners a PARTIAL piece fills (its solid side). null = not partial.
  function solidCorners(wall) {
    if (!wall || (wall.collision || 'full') !== 'partial') return null;
    if (wall.kind === 'block') return [true, true, true, true];
    // diagonal / rounded: solid triangle is corners [i, i+1, i+2]
    const i = Math.round((((wall.orientation || 0) % 360) + 360) % 360 / 90) % 4;
    const s = [false, false, false, false];
    s[i] = s[(i + 1) % 4] = s[(i + 2) % 4] = true;
    return s;
  }
  function dirEdge(dx, dy) {
    if (dy < 0) return [0, 1];   // north
    if (dx > 0) return [1, 2];   // east
    if (dy > 0) return [2, 3];   // south
    if (dx < 0) return [3, 0];   // west
    return null;
  }
  function wallAt(room, x, y) {
    if (x < 0 || y < 0 || x >= room.size.w || y >= room.size.h) return null;
    const row = room.tiles[y]; const t = row && row[x];
    return t ? t.wall : null;
  }
  // Is one orthogonal edge of a tile sealed by that tile's partial wall?
  function edgeSealed(wall, edge) {
    const s = solidCorners(wall);
    if (!s || !edge) return false;
    return s[edge[0]] && s[edge[1]];
  }

  // ---- public: walk grid ---------------------------------------------------
  function buildWalkGrid(room, objectBlocks) {
    const w = room.size.w, h = room.size.h;
    const g = new Grid2D(w, h, Uint8Array, 1);
    for (let y = 0; y < h; y++) {
      const row = room.tiles[y] || [];
      for (let x = 0; x < w; x++) {
        const t = row[x];
        if (!t || t.floor === 'void' || fullBlocksTile(t.wall)) g.set(x, y, 0);
      }
    }
    if (objectBlocks) {
      for (const o of (room.objects || [])) {
        if (objectBlocks(o) && o.x >= 0 && o.y >= 0 && o.x < w && o.y < h) g.set(o.x, o.y, 0);
      }
    }
    return g;
  }

  // ---- public: partial-wall crossing --------------------------------------
  // Blocks a step (x,y)->(x+dx,y+dy) when a partial wall seals that shared edge,
  // from either side. Full walls are handled by the grid (tile already 0).
  function crossBlocked(room, x, y, dx, dy) {
    const edge = dirEdge(dx, dy);
    if (!edge) return false;
    if (edgeSealed(wallAt(room, x, y), edge)) return true;                 // sealed leaving here
    if (edgeSealed(wallAt(room, x + dx, y + dy), dirEdge(-dx, -dy))) return true; // sealed entering there
    return false;
  }

  // ---- public: A* pathfinding ---------------------------------------------
  // 8-directional. A diagonal step is only allowed when BOTH orthogonal cells it
  // squeezes past are walkable and not cross-blocked, so the pawn can never clip
  // a wall corner. Deterministic: ties break by lower f, then insertion order.
  const DIRS = [
    { dx: 1, dy: 0, c: 1 }, { dx: -1, dy: 0, c: 1 }, { dx: 0, dy: 1, c: 1 }, { dx: 0, dy: -1, c: 1 },
    { dx: 1, dy: 1, c: Math.SQRT2 }, { dx: 1, dy: -1, c: Math.SQRT2 },
    { dx: -1, dy: 1, c: Math.SQRT2 }, { dx: -1, dy: -1, c: Math.SQRT2 }
  ];
  function octile(ax, ay, bx, by) {
    const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
    return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
  }
  function findPath(room, sx, sy, tx, ty, objectBlocks) {
    const w = room.size.w, h = room.size.h;
    sx |= 0; sy |= 0; tx |= 0; ty |= 0;
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) return null;
    const grid = buildWalkGrid(room, objectBlocks);
    if (!grid.get(tx, ty)) return null;          // target unreachable by definition
    if (sx === tx && sy === ty) return [];        // already there

    const idx = (x, y) => y * w + x;
    const gScore = new Float64Array(w * h).fill(Infinity);
    const came = new Int32Array(w * h).fill(-1);
    const closed = new Uint8Array(w * h);
    const open = [];                              // simple binary-heap-free frontier
    let seq = 0;
    gScore[idx(sx, sy)] = 0;
    open.push({ x: sx, y: sy, f: octile(sx, sy, tx, ty), seq: seq++ });

    const canStep = (x, y, d) => {
      const nx = x + d.dx, ny = y + d.dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) return false;
      if (!grid.get(nx, ny)) return false;
      if (d.dx && d.dy) {                          // diagonal: no corner cutting
        if (!grid.get(x + d.dx, y) || !grid.get(x, y + d.dy)) return false;
        if (crossBlocked(room, x, y, d.dx, 0) || crossBlocked(room, x, y, 0, d.dy)) return false;
        if (crossBlocked(room, x, y + d.dy, d.dx, 0) || crossBlocked(room, x + d.dx, y, 0, d.dy)) return false;
      } else if (crossBlocked(room, x, y, d.dx, d.dy)) return false;
      return true;
    };

    while (open.length) {
      // pop lowest f (ties: lowest seq) — small frontiers, linear scan is fine
      let bi = 0;
      for (let i = 1; i < open.length; i++) {
        if (open[i].f < open[bi].f || (open[i].f === open[bi].f && open[i].seq < open[bi].seq)) bi = i;
      }
      const cur = open.splice(bi, 1)[0];
      const ci = idx(cur.x, cur.y);
      if (closed[ci]) continue;
      closed[ci] = 1;
      if (cur.x === tx && cur.y === ty) break;
      for (const d of DIRS) {
        if (!canStep(cur.x, cur.y, d)) continue;
        const nx = cur.x + d.dx, ny = cur.y + d.dy, ni = idx(nx, ny);
        if (closed[ni]) continue;
        const ng = gScore[ci] + d.c;
        if (ng < gScore[ni]) {
          gScore[ni] = ng; came[ni] = ci;
          open.push({ x: nx, y: ny, f: ng + octile(nx, ny, tx, ty), seq: seq++ });
        }
      }
    }

    const ti = idx(tx, ty);
    if (came[ti] === -1 && !(sx === tx && sy === ty)) return null;   // no route
    // reconstruct (exclude the start tile; first element is the first step)
    const path = [];
    let ci = ti;
    while (ci !== -1 && ci !== idx(sx, sy)) { path.push({ x: ci % w, y: (ci / w) | 0 }); ci = came[ci]; }
    path.reverse();
    return path.length ? path : null;
  }

  return { buildWalkGrid, crossBlocked, findPath };
});
