/*
 * UGS — navigation  (Stage 1 · Milestone 6)
 * ==================================================================
 * Grid pathfinding for agents, built on the heavy-core Grid2D.
 *
 * Works in ROOM-LOCAL space: a walkability grid is derived from a room's
 * tiles + objects (void floor, walls, and colliding objects — closed doors —
 * block; open doors pass). A* is 8-directional with corner-cut prevention,
 * backed by typed arrays and a binary heap so it scales to large decks and
 * many agents without churning the GC.
 *
 * Because pathing is local, an agent standing in a room rides that room's
 * transform for free (see agents.js) — a moving room carries its occupants.
 *
 * Runs in browser (window.UGS.nav) and Node (module.exports).
 */
(function (root, factory) {
  const core = (root.UGS && root.UGS.core) || (typeof require !== 'undefined' ? require('./core.js') : null);
  const data = (root.UGS && root.UGS.data) || (typeof require !== 'undefined' ? require('./data.js') : null);
  const api = factory(core, data);
  root.UGS = root.UGS || {};
  root.UGS.nav = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, data) {
  'use strict';

  const SQRT2 = Math.SQRT2;
  const DIRS = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2]
  ];

  // A wall blocks a whole tile only when it is a FULL block. A partial wall
  // (diagonal / rounded, R2-06 phase 2) leaves the tile standable — the pawn may
  // occupy the open side — so it does not make the tile unwalkable; instead it
  // blocks crossing to its closed side (see crossBlocked).
  function wallBlocksTile(wall) { return !!wall && wall.collision !== 'partial'; }

  // The three movement directions a partial wall closes off, by orientation
  // quadrant (0/90/180/270). Each entry is a set of "dx,dy" keys.
  const BLOCKED_DIRS = [
    ['1,0', '0,1', '1,1'],      // 0°   → E, S, SE closed
    ['0,1', '-1,0', '-1,1'],    // 90°  → S, W, SW closed
    ['-1,0', '0,-1', '-1,-1'],  // 180° → W, N, NW closed
    ['0,-1', '1,0', '1,-1']     // 270° → N, E, NE closed
  ].map(a => new Set(a));
  function dirClosed(wall, dx, dy) {
    if (!wall || wall.collision !== 'partial') return false;
    const q = ((Math.round((wall.orientation || 0) / 90) % 4) + 4) % 4;
    return BLOCKED_DIRS[q].has(dx + ',' + dy);
  }
  // Is moving from (cx,cy) to (cx+dx,cy+dy) blocked by a partial wall's closed
  // side on either the tile we leave or the tile we enter?
  function crossBlocked(room, cx, cy, dx, dy) {
    const from = room.tiles[cy] && room.tiles[cy][cx];
    const to = room.tiles[cy + dy] && room.tiles[cy + dy][cx + dx];
    if (dirClosed(from && from.wall, dx, dy)) return true;
    if (dirClosed(to && to.wall, -dx, -dy)) return true;
    return false;
  }

  // A room tile is walkable when its floor isn't void, it isn't a full wall, and
  // no blocking object sits on it. `blocks` decides object collision (door state).
  function tileWalkable(room, x, y, blocks) {
    if (x < 0 || y < 0 || x >= room.size.w || y >= room.size.h) return false;
    const t = room.tiles[y][x];
    if (!t || t.floor === 'void' || wallBlocksTile(t.wall)) return false;
    for (const o of room.objects) if (o.x === x && o.y === y && blocks(o)) return false;
    return true;
  }

  // Dense walkability grid (1 = walkable, 0 = blocked) for a room.
  function buildWalkGrid(room, blocks) {
    blocks = blocks || (data ? data.objectBlocks : (o) => !!o.collision);
    const g = new core.Grid2D(room.size.w, room.size.h, Int8Array, 1);
    for (let y = 0; y < room.size.h; y++) {
      for (let x = 0; x < room.size.w; x++) {
        const t = room.tiles[y][x];
        if (!t || t.floor === 'void' || wallBlocksTile(t.wall)) g.set(x, y, 0);
      }
    }
    for (const o of room.objects) if (blocks(o)) g.set(o.x, o.y, 0);
    return g;
  }

  // Nearest walkable cell to (x,y) via an outward ring search on a walk grid.
  function nearestWalkable(g, x, y) {
    x = Math.round(x); y = Math.round(y);
    if (g.get(x, y) === 1) return { x, y };
    const R = Math.max(g.w, g.h);
    for (let r = 1; r <= R; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = x + dx, ny = y + dy;
          if (g.inside(nx, ny) && g.get(nx, ny) === 1) return { x: nx, y: ny };
        }
      }
    }
    return null;
  }

  // ---- binary min-heap keyed by f-score (indices into the grid) -----------
  function makeHeap() {
    const items = [];      // grid indices
    const f = [];          // parallel f-scores
    return {
      get size() { return items.length; },
      push(idx, fScore) {
        items.push(idx); f.push(fScore);
        let i = items.length - 1;
        while (i > 0) { const p = (i - 1) >> 1; if (f[p] <= f[i]) break; swap(i, p); i = p; }
      },
      pop() {
        const top = items[0], n = items.length - 1;
        items[0] = items[n]; f[0] = f[n]; items.pop(); f.pop();
        let i = 0;
        while (true) {
          const l = 2 * i + 1, r = 2 * i + 2; let m = i;
          if (l < items.length && f[l] < f[m]) m = l;
          if (r < items.length && f[r] < f[m]) m = r;
          if (m === i) break; swap(i, m); i = m;
        }
        return top;
      }
    };
    function swap(a, b) { const ti = items[a]; items[a] = items[b]; items[b] = ti; const tf = f[a]; f[a] = f[b]; f[b] = tf; }
  }

  // A* on a room's walk grid. Returns an array of {x,y} local tiles from the
  // tile AFTER the start through the goal, or null if unreachable. `grid` may
  // be passed in (cached) to avoid rebuilding on every call.
  function findPath(room, sx, sy, tx, ty, blocks, grid) {
    const g = grid || buildWalkGrid(room, blocks);
    const w = g.w, h = g.h;
    tx = Math.round(tx); ty = Math.round(ty);
    if (!g.inside(tx, ty) || g.get(tx, ty) === 0) return null;
    const start = nearestWalkable(g, sx, sy); if (!start) return null;
    sx = start.x; sy = start.y;
    if (sx === tx && sy === ty) return [];

    const N = w * h;
    const gScore = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const idx = (x, y) => y * w + x;
    const h2 = (x, y) => { const dx = Math.abs(x - tx), dy = Math.abs(y - ty); return (dx + dy) + (SQRT2 - 2) * Math.min(dx, dy); };

    const heap = makeHeap();
    const s = idx(sx, sy); gScore[s] = 0; heap.push(s, h2(sx, sy));

    while (heap.size) {
      const cur = heap.pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % w, cy = (cur / w) | 0;
      if (cx === tx && cy === ty) {
        const path = []; let c = cur;
        while (c !== s) { path.push({ x: c % w, y: (c / w) | 0 }); c = came[c]; }
        path.reverse();
        return path;
      }
      for (const [dx, dy, cost] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = idx(nx, ny);
        if (g.data[ni] === 0 || closed[ni]) continue;
        if (dx !== 0 && dy !== 0) {                     // don't cut wall corners
          if (g.data[idx(cx + dx, cy)] === 0 || g.data[idx(cx, cy + dy)] === 0) continue;
        }
        if (crossBlocked(room, cx, cy, dx, dy)) continue;   // R2-06 phase 2: partial-wall closed side
        const ng = gScore[cur] + cost;
        if (ng < gScore[ni]) { gScore[ni] = ng; came[ni] = cur; heap.push(ni, ng + h2(nx, ny)); }
      }
    }
    return null;   // no path
  }

  return { tileWalkable, buildWalkGrid, nearestWalkable, findPath, wallBlocksTile, dirClosed, crossBlocked };
});
