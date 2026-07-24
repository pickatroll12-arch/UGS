/*
 * UGS — nav  (POST-RESET rewrite · OBJP-1)
 * ==================================================================
 * Grid pathfinding for the PCJ's CLICK→ROUTE movement. No keyboard-driven
 * movement exists anywhere in the game: the player clicks a tile, this module
 * answers with a route (or null), and agents.js walks it.
 *
 * Collision contract (REV3 + AGENTIC_REVIEW §4, non-negotiable):
 *   - ANY wall piece blocks its whole tile (block / diagonal / rounded).
 *   - A solid object blocks its tile, UNLESS it is an openable door/airlock
 *     currently open.
 *   - 'void' floor is not walkable.
 *
 * Deterministic A* (4-directional; diagonals could corner-cut through wall
 * pieces, so they are deliberately excluded). Ties break toward the target
 * and then by insertion order, so equal-cost routes are reproducible.
 *
 * Runs in the browser (window.UGS.nav) and Node (module.exports).
 */
(function (root, factory) {
  const api = factory();
  root.UGS = root.UGS || {};
  root.UGS.nav = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // Is the local tile (x,y) of `room` walkable right now?
  function walkable(room, x, y) {
    if (!room || x < 0 || y < 0 || x >= room.size.w || y >= room.size.h) return false;
    const tile = room.tiles[y] && room.tiles[y][x];
    if (!tile || tile.floor === 'void') return false;
    if (tile.wall) return false;                              // contract: every wall blocks
    for (const o of room.objects) {
      if (o.x !== x || o.y !== y) continue;
      if (!o.collision) continue;                             // decor passes through
      if (o.open) continue;                                   // an open door/airlock lets you in
      return false;
    }
    return true;
  }

  // A* from (sx,sy) to (tx,ty) inside ONE room. Returns an array of waypoints
  // {x,y} EXCLUDING the start and INCLUDING the target, or null if unreachable.
  function findPath(room, sx, sy, tx, ty, opts) {
    sx |= 0; sy |= 0; tx |= 0; ty |= 0;
    const maxExpand = (opts && opts.maxExpand) || 4096;
    if (!walkable(room, tx, ty)) return null;
    if (sx === tx && sy === ty) return [];
    if (!walkable(room, sx, sy)) return null;

    const W = room.size.w, H = room.size.h;
    const idx = (x, y) => y * W + x;
    const gScore = new Map();
    const cameFrom = new Map();
    // tiny binary-heap-free open list: rooms are ≤ 64×64 and routes are short;
    // a sorted array with lazy deletion is deterministic and fast enough here.
    const h = (x, y) => Math.abs(x - tx) + Math.abs(y - ty);
    const open = [{ x: sx, y: sy, f: h(sx, sy), n: 0 }];
    let counter = 1;
    gScore.set(idx(sx, sy), 0);

    let expanded = 0;
    while (open.length) {
      // pop lowest f (ties: lowest h-adjacent insertion order → deterministic)
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f || (open[i].f === open[bi].f && open[i].n < open[bi].n)) bi = i;
      const cur = open.splice(bi, 1)[0];
      const ck = idx(cur.x, cur.y);
      const g = gScore.get(ck);
      if (cur.x === tx && cur.y === ty) {
        // reconstruct
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
