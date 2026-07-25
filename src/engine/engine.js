/*
 * UGS — engine/engine  (REVAMP · base nueva)
 * ==================================================================
 * [COMPONENTES LÓGICOS] — el runtime del juego. LÓGICA PRE-CARGADA POR NEXO:
 * start(nexo) carga la lógica DECLARADA de ese Nexo (eventos de sala) y la
 * ejecuta; stop() la desmonta. NO hay simulación global continua (life-sim
 * descartado por decisión humana — REVISIÓN MAESTRA 2).
 *
 * API:
 *   start(nexo) / stop()      — cargar/descargar el Nexo activo
 *   update(nexo, dt)          — avanzar UN paso fijo (el paso lo da app.js
 *                               con FixedTimestep: determinismo garantizado)
 *   fire(room, ev)            — disparar un evento 'manual' una vez
 *   addSystem(fn)             — sistemas por paso (agents.js se engancha aquí)
 *   bus                       — EventBus síncrono ('pawn:arrived', …)
 *   activeCount()             — pistas de lógica animando (repintado)
 *
 * Eventos declarativos (se crean en core/data.js:createRoomEvent):
 *   shift    { to:{x,y}, duration }
 *   rotate   { by, duration }
 *   orbit    { center:{x,y}, radius, period, direction:'cw'|'ccw', selfRotate }
 *   carousel { poses:[{x,y,rotation}…], interval }
 * trigger 'time' corre en bucle mientras el Nexo corre; 'manual' solo fire().
 *
 * Corre en navegador (window.UGS.engine) y en Node (module.exports).
 */
(function (root, factory) {
  const coreApi = (root.UGS && root.UGS.core)
    || (typeof require !== 'undefined' ? require('../core/core.js') : null);
  const renderApi = (root.UGS && root.UGS.render)
    || (typeof require !== 'undefined' ? require('../render/render.js') : null);
  const api = factory(coreApi, renderApi);
  root.UGS = root.UGS || {};
  root.UGS.engine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CORE, R) {
  'use strict';

  function create() {
    const bus = new CORE.EventBus();
    const systems = [];
    const tracks = new Map();       // roomId:evId → pista runtime (solo este Nexo)
    let running = false;
    let time = 0;

    const poseOf = (room) => { const t = room.transform; return { x: t.x, y: t.y, rotation: t.rotation || 0 }; };
    function applyPose(room, p) {
      room.transform.x = p.x; room.transform.y = p.y;
      room.transform.rotation = ((p.rotation % 360) + 360) % 360;
    }
    // colocar la sala por su CENTRO (órbitas) sin cambiar la rotación
    function applyPoseCentred(room, cx, cy, rotation) {
      const off = R.rotatePoint(room.size.w / 2, room.size.h / 2, rotation, room.transform.pivot);
      applyPose(room, { x: cx - off.x, y: cy - off.y, rotation });
    }

    function makeTrack(room, ev) {
      const base = poseOf(room);
      const rc = R.roomCenterWorld(room);
      const track = { ev, room, t: 0, dir: 1, base, phase: 0 };
      const a = ev.action || {};
      if (a.kind === 'orbit') {
        track.angle = Math.atan2(rc.y - a.center.y, rc.x - a.center.x);
        track.radius = a.radius != null ? Number(a.radius) : Math.hypot(rc.x - a.center.x, rc.y - a.center.y);
      }
      return track;
    }

    const key = (room, ev) => room.id + ':' + ev.id;
    const retire = (track) => tracks.delete(key(track.room, track.ev));

    function stepTrack(track, dt) {
      const { ev, room } = track;
      const a = ev.action || {};
      track.t += dt * track.dir;
      switch (a.kind) {
        case 'shift': {
          const dur = Math.max(0.01, Number(a.duration) || 1);
          const p = Math.min(1, track.t / dur);
          const e = CORE.smooth(p);
          applyPose(room, { x: track.base.x + (a.to.x - track.base.x) * e, y: track.base.y + (a.to.y - track.base.y) * e, rotation: track.base.rotation });
          if (p >= 1) {
            if (ev.loop) { track.dir = -track.dir; track.t = 0; track.base = poseOf(room); }   // ping-pong
            else return retire(track);
          }
          break;
        }
        case 'rotate': {
          const dur = Math.max(0.01, Number(a.duration) || 1);
          const p = Math.min(1, track.t / dur);
          applyPose(room, { x: track.base.x, y: track.base.y, rotation: track.base.rotation + (Number(a.by) || 90) * CORE.smooth(p) });
          if (p >= 1) {
            if (ev.loop) { track.t = 0; track.base = poseOf(room); }
            else return retire(track);
          }
          break;
        }
        case 'orbit': {
          const period = Math.max(0.05, Number(a.period) || 4);
          const dirSgn = a.direction === 'ccw' ? -1 : 1;
          track.angle += dirSgn * (dt * 2 * Math.PI / period);
          const cx = a.center.x + track.radius * Math.cos(track.angle);
          const cy = a.center.y + track.radius * Math.sin(track.angle);
          const rot = a.selfRotate ? track.base.rotation + dirSgn * (track.t * 360 / period) : track.base.rotation;
          applyPoseCentred(room, cx, cy, rot);
          break;
        }
        case 'carousel': {
          const poses = Array.isArray(a.poses) ? a.poses : [];
          if (poses.length < 2) return retire(track);
          const interval = Math.max(0.05, Number(a.interval) || 1);
          if (track.t >= interval) {
            track.t = 0;
            track.phase = (track.phase + 1) % poses.length;
            const p = poses[track.phase];
            applyPose(room, { x: p.x, y: p.y, rotation: p.rotation != null ? p.rotation : track.base.rotation });
            if (!ev.loop && track.phase === poses.length - 1) return retire(track);
          }
          break;
        }
        default:
          return retire(track);
      }
      return null;
    }

    function start(nexo) {
      tracks.clear(); time = 0; running = true;
      api.nexo = nexo;  // expuesto para agents.js (multi-sala)
      // PRE-CARGA: solo la lógica declarada de ESTE Nexo.
      for (const room of nexo.rooms) {
        for (const ev of (room.events || [])) {
          if (ev.enabled === false || !ev.action) continue;
          if (!ev.trigger || ev.trigger.type === 'time') tracks.set(key(room, ev), makeTrack(room, ev));
        }
      }
    }
    function stop() { running = false; tracks.clear(); api.nexo = null; }
    function update(nexo, dt) {
      if (!running) return;
      time += dt;
      for (const track of Array.from(tracks.values())) stepTrack(track, dt);
      for (const fn of systems) fn(nexo, dt, bus);
    }
    function fire(room, ev) {
      if (!ev || !ev.action) return;
      if (!running) running = true;
      tracks.set(key(room, ev), makeTrack(room, ev));
    }
    function activeCount() { return tracks.size; }
    function addSystem(fn) { systems.push(fn); return () => { const i = systems.indexOf(fn); if (i >= 0) systems.splice(i, 1); }; }

    const api = {
      start, stop, update, fire, addSystem, bus, activeCount,
      nexo: null,  // Nexo activo (para agents.js)
      get time() { return time; },
      get running() { return running; }
    };
    return api;
  }

  return { create };
});
