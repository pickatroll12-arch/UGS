/*
 * UGS — agents  (POST-RESET rewrite · OBJP-1)
 * ==================================================================
 * The PCJ ("mono"). ONE controllable pawn for now — NPCs are OBJP-2 and are
 * deliberately absent. Movement is exclusively CLICK→ROUTE: order() asks
 * nav.js for a route and the pawn walks it; there is no keyboard control.
 *
 * Pawn state is ROOM-LOCAL (continuous tile coords), so a moving room carries
 * its pawn for free, and the renderer draws it through the room transform.
 * Movement advances inside engine.update (registered via engine.addSystem),
 * so it inherits the fixed-timestep determinism and only runs on the Nexo
 * that is currently loaded.
 *
 * Events: emits 'pawn:arrived' on the engine bus when a route completes
 * (editor.js listens to trigger deck travel on link/elevator tiles).
 *
 * Runs in the browser (window.UGS.agents) and Node (module.exports).
 */
(function (root, factory) {
  const coreApi = (root.UGS && root.UGS.core)
    || (typeof require !== 'undefined' ? require('./core.js') : null);
  const navApi = (root.UGS && root.UGS.nav)
    || (typeof require !== 'undefined' ? require('./nav.js') : null);
  const api = factory(coreApi, navApi);
  root.UGS = root.UGS || {};
  root.UGS.agents = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CORE, NAV) {
  'use strict';

  const SPEED = 3.2;   // tiles per second (fixed-sim time, not wall time)

  function create(engine) {
    const ids = CORE.makeIds ? CORE.makeIds('pawn') : (() => { let n = 0; return () => 'pawn-' + (++n); })();
    const pawns = [];
    let unhook = null;

    const mgr = {
      pawns,
      selected: null,

      // hook pawn movement into the engine's fixed-step update (call once)
      install() {
        if (unhook || !engine) return;
        unhook = engine.addSystem((level, dt, bus) => {
          for (const p of pawns) {
            if (p.levelId !== level.id || !p.moving) continue;
            step(p, dt, bus);
          }
        });
      },

      clear() { pawns.length = 0; mgr.selected = null; },

      spawn(levelId, roomId, x, y) {
        const pawn = {
          id: ids.next ? ids.next('pawn') : ids(),
          levelId, roomId,
          x: Math.round(x), y: Math.round(y),
          path: [], moving: false,
          facingLocal: { x: 0, y: 1 }        // face "south" (front sprite)
        };
        pawns.push(pawn);
        mgr.selected = pawn;
        return pawn;
      },

      // teleport (deck travel): no route, no arrival event
      place(pawn, levelId, roomId, x, y) {
        pawn.levelId = levelId; pawn.roomId = roomId;
        pawn.x = Math.round(x); pawn.y = Math.round(y);
        pawn.path = []; pawn.moving = false;
      },

      // CLICK→ROUTE: ask nav for a route and start walking. False = no route.
      order(pawn, room, tx, ty) {
        if (!pawn || !room) return false;
        const path = NAV.findPath(room, Math.round(pawn.x), Math.round(pawn.y), tx, ty);
        if (!path) return false;
        pawn.path = path;
        pawn.moving = path.length > 0;
        if (!pawn.moving && engine && engine.bus) {
          // already standing on the target: counts as arrived (link tiles work)
          engine.bus.emit('pawn:arrived', { pawn, x: Math.round(pawn.x), y: Math.round(pawn.y) });
        }
        return true;
      }
    };

    function step(p, dt, bus) {
      let budget = SPEED * dt;
      while (budget > 0 && p.path.length) {
        const next = p.path[0];
        const dx = next.x - p.x, dy = next.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= budget) {
          p.x = next.x; p.y = next.y;
          p.facingLocal = { x: dx / (dist || 1), y: dy / (dist || 1) };
          budget -= dist;
          p.path.shift();
        } else {
          p.facingLocal = { x: dx / dist, y: dy / dist };
          p.x += p.facingLocal.x * budget;
          p.y += p.facingLocal.y * budget;
          budget = 0;
        }
      }
      if (!p.path.length && p.moving) {
        p.moving = false;
        if (bus) bus.emit('pawn:arrived', { pawn: p, x: Math.round(p.x), y: Math.round(p.y) });
      }
    }

    return mgr;
  }

  return { create, SPEED };
});
