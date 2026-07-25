/*
 * UGS — engine/agents  (REVAMP · base nueva)
 * ==================================================================
 * [COMPONENTES LÓGICOS] — el PCJ ("mono"). UN peón controlable; los PNJ son
 * OBJP-2 y están ausentes a propósito. Movimiento EXCLUSIVAMENTE click→ruta:
 * order() pide ruta a nav.js y el peón la camina. Sin control por teclado.
 *
 * El estado del peón es LOCAL A LA SALA (coords continuas de tile): una sala
 * en movimiento transporta a su peón gratis, y el renderizador lo dibuja a
 * través del transform de la sala. El avance ocurre dentro de engine.update
 * (vía addSystem): hereda el paso fijo determinista y solo corre en el Nexo
 * cargado. Al completar una ruta emite 'pawn:arrived' en el bus del engine
 * (app.js lo usa para viajar por ascensores/links entre Nexos).
 *
 * Corre en navegador (window.UGS.agents) y en Node (module.exports).
 */
(function (root, factory) {
  const coreApi = (root.UGS && root.UGS.core)
    || (typeof require !== 'undefined' ? require('../core/core.js') : null);
  const navApi = (root.UGS && root.UGS.nav)
    || (typeof require !== 'undefined' ? require('./nav.js') : null);
  const api = factory(coreApi, navApi);
  root.UGS = root.UGS || {};
  root.UGS.agents = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CORE, NAV) {
  'use strict';

  const SPEED = 3.2;   // tiles/segundo de tiempo de simulación (no wall-clock)

  function create(engine) {
    const pawns = [];
    let unhook = null;

    const mgr = {
      pawns,
      selected: null,

      install() {
        if (unhook || !engine) return;
        unhook = engine.addSystem((nexo, dt, bus) => {
          for (const p of pawns) {
            if (p.nexoId !== nexo.id || !p.moving) continue;
            step(p, dt, bus, nexo);
          }
        });
      },

      clear() { pawns.length = 0; mgr.selected = null; },

      spawn(nexoId, roomId, x, y) {
        const pawn = {
          id: CORE.uid('pawn'), nexoId, roomId,
          x: Math.round(x), y: Math.round(y),
          path: [], moving: false,
          facingLocal: { x: 0, y: 1 }
        };
        pawns.push(pawn);
        mgr.selected = pawn;
        return pawn;
      },

      // teletransporte (viaje entre Nexos): sin ruta ni evento de llegada
      place(pawn, nexoId, roomId, x, y) {
        pawn.nexoId = nexoId; pawn.roomId = roomId;
        pawn.x = Math.round(x); pawn.y = Math.round(y);
        pawn.path = []; pawn.moving = false;
      },

      // CLICK→RUTA. false = sin ruta (tile inalcanzable/bloqueado).
      order(pawn, room, tx, ty) {
        if (!pawn || !room) return false;
        const pawnRoom = room;  // compat: si es la misma sala, comportamiento actual
        if (room.id === pawn.roomId) {
          const path = NAV.findPath(room, Math.round(pawn.x), Math.round(pawn.y), tx, ty);
          if (!path) return false;
          pawn.path = path;
          pawn.moving = path.length > 0;
          if (!pawn.moving && engine && engine.bus) {
            engine.bus.emit('pawn:arrived', { pawn, x: Math.round(pawn.x), y: Math.round(pawn.y) });
          }
          return true;
        }
        // multi-sala: convertir a mundo, buscar ruta, actualizar roomId por paso
        const nexo = engine && engine.nexo;  // necesitamos el nexo activo
        if (!nexo) return false;
        const fromRoom = nexo.rooms.find(r => r.id === pawn.roomId);
        if (!fromRoom) return false;
        const worldSx = fromRoom.transform.x + Math.round(pawn.x);
        const worldSy = fromRoom.transform.y + Math.round(pawn.y);
        const worldTx = room.transform.x + tx;
        const worldTy = room.transform.y + ty;
        const path = NAV.findPathNexo(nexo, worldSx, worldSy, worldTx, worldTy);
        if (!path) return false;
        pawn.path = path;
        pawn.moving = path.length > 0;
        if (!pawn.moving && engine && engine.bus) {
          engine.bus.emit('pawn:arrived', { pawn, x: Math.round(pawn.x), y: Math.round(pawn.y) });
        }
        return true;
      }
    };

    // El movimiento se calcula en COORDS MUNDO: cada paso del path puede vivir en
    // otra sala (multi-sala) y las coords locales de salas distintas no se pueden
    // restar entre sí (los transforms son traslaciones; rotación=0 la garantiza
    // findPathNexo). Al completar el paso se adopta la sala y el marco local del
    // paso. Durante el cruce la posición local puede quedar fuera de rango: es
    // solo una proyección, el render la dibuja igual de bien.
    function step(p, dt, bus, nexo) {
      let budget = SPEED * dt;
      while (budget > 0 && p.path.length) {
        const next = p.path[0];
        let roomFrom = null, roomTo = null;
        if (nexo) {
          roomFrom = nexo.rooms.find(r => r.id === p.roomId) || null;
          roomTo = (next.roomId && nexo.rooms.find(r => r.id === next.roomId)) || roomFrom;
        }
        const fx = roomFrom ? roomFrom.transform.x : 0, fy = roomFrom ? roomFrom.transform.y : 0;
        const tx = roomTo ? roomTo.transform.x : fx, ty = roomTo ? roomTo.transform.y : fy;
        const wx = fx + p.x, wy = fy + p.y;            // peón en mundo
        const dx = (tx + next.x) - wx, dy = (ty + next.y) - wy;
        const dist = Math.hypot(dx, dy);
        if (dist <= budget) {
          if (roomTo) p.roomId = roomTo.id;            // adoptar sala del paso
          p.x = next.x; p.y = next.y;
          p.facingLocal = { x: dx / (dist || 1), y: dy / (dist || 1) };
          budget -= dist;
          p.path.shift();
        } else {
          p.facingLocal = { x: dx / dist, y: dy / dist };
          p.x = wx + p.facingLocal.x * budget - fx;    // de vuelta al marco actual
          p.y = wy + p.facingLocal.y * budget - fy;
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
