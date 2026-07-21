/*
 * UGS — agents  (Stage 1 · Milestone 6)
 * ==================================================================
 * Pawns and their movement, as a pluggable engine SYSTEM. Runs on the
 * deterministic fixed-timestep step, so pawn motion is reproducible and
 * framerate-independent — the foundation the eventual A-life colony sim
 * grows from.
 *
 * A pawn lives in ROOM-LOCAL coordinates (levelId + roomId + fractional
 * x,y tile), so it rides its room's transform automatically: a room that
 * shifts/rotates/orbits carries the pawn with it. Pathing is per-room A*
 * (nav.js). Cross-deck travel is decoupled: on arrival the system emits
 * `pawn:arrived` on the engine bus and the editor decides whether that tile
 * is a link and performs the transition.
 *
 * Runs in browser (window.UGS.agents) and Node (module.exports).
 */
(function (root, factory) {
  const core = (root.UGS && root.UGS.core) || (typeof require !== 'undefined' ? require('./core.js') : null);
  const nav = (root.UGS && root.UGS.nav) || (typeof require !== 'undefined' ? require('./nav.js') : null);
  const data = (root.UGS && root.UGS.data) || (typeof require !== 'undefined' ? require('./data.js') : null);
  const api = factory(core, nav, data);
  root.UGS = root.UGS || {};
  root.UGS.agents = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, nav, data) {
  'use strict';

  const blocks = data ? data.objectBlocks : (o) => !!o.collision;
  let seq = 0;

  function create(engine) {
    const pawns = [];
    let selected = null;

    function roomOf(level, id) { return level.rooms.find(r => r.id === id) || level.rooms[0]; }

    function spawn(levelId, roomId, x, y) {
      const p = {
        id: 'pawn-' + (++seq), levelId, roomId,
        x: x + 0.0, y: y + 0.0,            // fractional local tile position
        path: [], target: null,
        speed: 4.2, moving: false,
        facingLocal: { x: 0, y: 1 }        // last local move dir (for rendering)
      };
      pawns.push(p); if (!selected) selected = p;
      return p;
    }
    function clear() { pawns.length = 0; selected = null; }

    // Issue a move order: path from the pawn's tile to (tx,ty) in its room.
    function order(pawn, room, tx, ty) {
      const path = nav.findPath(room, Math.round(pawn.x), Math.round(pawn.y), tx, ty, blocks);
      if (!path) { pawn.path = []; pawn.target = null; return false; }
      pawn.path = path; pawn.target = { x: tx, y: ty };
      // if we're already sitting on the first node, drop it
      if (path.length && Math.round(pawn.x) === path[0].x && Math.round(pawn.y) === path[0].y) path.shift();
      return true;
    }

    // Relocate a pawn onto another deck/room (used by the editor on a link).
    function place(pawn, levelId, roomId, x, y) {
      pawn.levelId = levelId; pawn.roomId = roomId;
      pawn.x = x; pawn.y = y; pawn.path = []; pawn.target = null; pawn.moving = false;
    }

    // The engine system: advance every pawn on the active level.
    const system = {
      step(level, dt, ctx) {
        for (const pawn of pawns) {
          if (pawn.levelId !== level.id) { pawn.moving = false; continue; }
          if (!pawn.path.length) { pawn.moving = false; continue; }
          const room = roomOf(level, pawn.roomId);
          const node = pawn.path[0];
          // re-validate: if the next tile just became blocked (e.g. a door shut), stop
          if (!nav.tileWalkable(room, node.x, node.y, blocks)) { pawn.path = []; pawn.target = null; pawn.moving = false; continue; }
          const dx = node.x - pawn.x, dy = node.y - pawn.y;
          const dist = Math.hypot(dx, dy) || 1e-6;
          if (dist > 1e-4) pawn.facingLocal = { x: dx / dist, y: dy / dist };
          const stepLen = pawn.speed * dt;
          pawn.moving = true;
          if (dist <= stepLen) {
            pawn.x = node.x; pawn.y = node.y; pawn.path.shift();
            if (!pawn.path.length) {
              pawn.moving = false;
              if (engine && engine.bus) engine.bus.emit('pawn:arrived', { pawn, x: node.x, y: node.y });
            }
          } else {
            pawn.x += (dx / dist) * stepLen;
            pawn.y += (dy / dist) * stepLen;
          }
        }
      }
    };

    function install() { if (engine && engine.addSystem) engine.addSystem(system); return system; }

    return {
      pawns, system, install, spawn, clear, order, place,
      get selected() { return selected; },
      select(p) { selected = p; },
      onLevel(levelId) { return pawns.filter(p => p.levelId === levelId); }
    };
  }

  return { create };
});
