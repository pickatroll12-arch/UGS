/*
 * UGS — agents  ([COMPONENTES LÓGICOS] · reescritura post-reset)
 * ==================================================================
 * El PCJ ("MONO"): UN solo peón controlable por click. Sin PNJ, sin IA de
 * multitudes — eso es OBJP-2 y NO se inicia hasta aprobación de los 3
 * (AGENTIC_REVIEW §4). Nada de life-sim: el peón sólo se mueve cuando el
 * jugador le ordena una ruta (nav.findPath), y avanza de forma determinista
 * en cada 'tick' del engine.
 *
 * Arquitectura: lógica pura. No importa el renderizador. El render sólo LEE
 * el estado del pawn. El pawn expone exactamente la forma que espera
 * render.drawAgents:
 *   { id, levelId, roomId, x, y (tile local, fraccional), path:[{x,y}],
 *     facingLocal:{x,y}, moving:bool }
 *
 * Contrato consumido por editor.js:
 *   create(engine) -> agents
 *   agents.install()                      engancha el paso al bus del engine
 *   agents.clear()                        borra el peón
 *   agents.spawn(levelId, roomId, x, y)   crea el PCJ y lo selecciona
 *   agents.place(pawn, levelId, roomId, x, y)  teleporta (transición de fase)
 *   agents.order(pawn, room, tx, ty) -> bool   ordena caminar a un tile
 *   agents.pawns  / agents.selected
 *
 * Al terminar una ruta emite engine.bus 'pawn:arrived' { pawn, x, y } — de ahí
 * cuelga el editor la transición por ascensor entre fases.
 */
(function (root, factory) {
  const core = (root.UGS && root.UGS.core)
    || (typeof require !== 'undefined' ? require('./core.js') : null);
  const nav = (root.UGS && root.UGS.nav)
    || (typeof require !== 'undefined' ? require('./nav.js') : null);
  const data = (root.UGS && root.UGS.data)
    || (typeof require !== 'undefined' ? require('./data.js') : null);
  if (!core || !nav) throw new Error('UGS.agents requires UGS.core and UGS.nav loaded first.');
  const api = factory(core, nav, data);
  root.UGS = root.UGS || {};
  root.UGS.agents = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, nav, data) {
  'use strict';

  const SPEED = 4;          // tiles per second — brisk but readable
  const ARRIVE = 1e-3;      // snap distance to a path node (tile units)
  const objectBlocks = data ? data.objectBlocks : null;

  function create(engine) {
    let ids = 0;
    const agents = {
      pawns: [],
      selected: null,

      install() {
        // The engine drives time; agents ride its 'tick' so movement stays on the
        // same deterministic fixed-timestep as the rest of the logic.
        if (engine && engine.bus) engine.bus.on('tick', (p) => agents.step(p.level, p.dt));
      },

      clear() { agents.pawns.length = 0; agents.selected = null; },

      spawn(levelId, roomId, x, y) {
        const p = {
          id: 'pawn-' + (++ids),
          levelId, roomId,
          x: x | 0, y: y | 0,
          path: [],
          facingLocal: { x: 0, y: 1 },   // south / front by default
          moving: false,
          speed: SPEED
        };
        agents.pawns.push(p);
        agents.selected = p;
        return p;
      },

      // move a pawn to another deck/room instantly (phase transition via elevator)
      place(pawn, levelId, roomId, x, y) {
        if (!pawn) return;
        pawn.levelId = levelId; pawn.roomId = roomId;
        pawn.x = x | 0; pawn.y = y | 0;
        pawn.path = []; pawn.moving = false;
      },

      // order a click→route. Returns false when no path exists (blocked target).
      order(pawn, room, tx, ty) {
        if (!pawn || !room) return false;
        const path = nav.findPath(room, Math.round(pawn.x), Math.round(pawn.y), tx | 0, ty | 0, objectBlocks);
        if (!path || !path.length) return false;
        pawn.path = path;
        pawn.moving = true;
        return true;
      },

      // advance every moving pawn on `level` by dt (called from the engine tick)
      step(level, dt) {
        if (!level || !(dt > 0)) return;
        for (const p of agents.pawns) {
          if (!p.moving || p.levelId !== level.id) continue;
          let budget = p.speed * dt;
          while (budget > 0 && p.path.length) {
            const n = p.path[0];
            const dx = n.x - p.x, dy = n.y - p.y;
            const dist = Math.hypot(dx, dy);
            if (dist <= ARRIVE) { p.x = n.x; p.y = n.y; p.path.shift(); continue; }
            p.facingLocal = { x: dx / dist, y: dy / dist };
            if (budget >= dist) { p.x = n.x; p.y = n.y; p.path.shift(); budget -= dist; }
            else { p.x += dx / dist * budget; p.y += dy / dist * budget; budget = 0; }
          }
          if (!p.path.length) {
            p.moving = false;
            p.x = Math.round(p.x); p.y = Math.round(p.y);
            if (engine && engine.bus) engine.bus.emit('pawn:arrived', { pawn: p, x: p.x, y: p.y });
          }
        }
      }
    };
    return agents;
  }

  return { create };
});
