/*
 * UGS — engine  (POST-RESET rewrite · OBJP-1)
 * ==================================================================
 * Game logic, PRE-CARGADA POR NEXO (Nexo = level). There is NO global,
 * always-on life-sim: when a Nexo starts, the engine loads THAT Nexo's
 * declared logic (its rooms' motion events) and executes it deterministically;
 * when it stops, everything is torn down. Declarative data in, behavior out.
 *
 * What lives here:
 *   - start/stop(level): load/unload a Nexo's declared logic.
 *   - update(level, dt): advance the active Nexo one FIXED step (determinism
 *     comes from editor.js feeding us a FixedTimestep — never wall-clock).
 *   - fire(room, ev): run a 'manual'-trigger event once (editor test button).
 *   - addSystem(fn): extra per-step systems (agents.js pawn movement hooks in
 *     here, keeping LOGIC out of the renderer and out of this core).
 *   - bus: synchronous EventBus (from UGS.core) — e.g. 'pawn:arrived'.
 *   - activeCount(): how many logic tracks are animating (render invalidation).
 *
 * Event kinds (declared per room in the phase-construction suite):
 *   shift    { to:{x,y}, duration }            — glide the room to a pose
 *   rotate   { by, duration }                  — spin the room around its pivot
 *   orbit    { center, radius, period, direction, selfRotate } — circle a point
 *   carousel { poses:[{x,y,rotation}…], interval } — step through poses
 * trigger: { type:'time' } runs while the Nexo runs (looping); 'manual' only
 * via fire(). ev.enabled === false skips. Loop policy: shift ping-pongs,
 * rotate keeps advancing, orbit/carousel are cyclic by nature.
 *
 * Runs in the browser (window.UGS.engine) and Node (module.exports).
 */
(function (root, factory) {
  const coreApi = (root.UGS && root.UGS.core)
    || (typeof require !== 'undefined' ? require('./core.js') : null);
  const renderApi = (root.UGS && root.UGS.render)
    || (typeof require !== 'undefined' ? require('./render.js') : null);
  const api = factory(coreApi, renderApi);
  root.UGS = root.UGS || {};
  root.UGS.engine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CORE, R) {
  'use strict';

  function create() {
    const bus = new CORE.EventBus();
    const systems = [];            // fn(level, dt, bus) — hooked-in logic (agents)
    const tracks = new Map();      // roomId -> runtime track state (this Nexo only)
    let running = false;
    let time = 0;

    // ---- pose math (rooms rotate around their pivot; x,y is the origin) ----
    function poseOf(room) { const t = room.transform; return { x: t.x, y: t.y, rotation: t.rotation || 0 }; }
    function applyPose(room, p) {
      room.transform.x = p.x; room.transform.y = p.y; room.transform.rotation = ((p.rotation % 360) + 360) % 360;
    }
    // place the room so its CENTRE sits at (cx,cy) without changing rotation
    function applyPoseCentred(room, cx, cy, rotation) {
      const t = room.transform;
      const off = R.rotatePoint(room.size.w / 2, room.size.h / 2, rotation, t.pivot);
      applyPose(room, { x: cx - off.x, y: cy - off.y, rotation });
    }

    const smooth = (p) => p * p * (3 - 2 * p);   // smoothstep easing, deterministic

    // Build the runtime track for one declared event (called on start/fire).
    function makeTrack(room, ev) {
      const base = poseOf(room);
      const rc = R.roomCenterWorld(room);
      const track = { ev, room, t: 0, dir: 1, base, baseCenter: rc, phase: 0 };
      const a = ev.action || {};
      if (a.kind === 'orbit') {
        track.angle = Math.atan2(rc.y - a.center.y, rc.x - a.center.x);
        track.radius = a.radius != null ? Number(a.radius) : Math.hypot(rc.x - a.center.x, rc.y - a.center.y);
      }
      return track;
    }

    function stepTrack(track, dt) {
      const { ev, room } = track;
      const a = ev.action || {};
      track.t += dt * track.dir;
      switch (a.kind) {
        case 'shift': {
          const dur = Math.max(0.01, Number(a.duration) || 1);
          const p = Math.min(1, track.t / dur);
          const e = smooth(p);
          applyPose(room, {
            x: track.base.x + (a.to.x - track.base.x) * e,
            y: track.base.y + (a.to.y - track.base.y) * e,
            rotation: track.base.rotation
          });
          if (p >= 1) {                       // ping-pong loops; one-shot manuals stop
            if (ev.loop) { track.dir = -track.dir; track.t = 0; const b = poseOf(room); track.base = b; }
            else return retire(track);
          }
          break;
        }
        case 'rotate': {
          const dur = Math.max(0.01, Number(a.duration) || 1);
          const p = Math.min(1, track.t / dur);
          applyPose(room, { x: track.base.x, y: track.base.y, rotation: track.base.rotation + (Number(a.by) || 90) * smooth(p) });
          if (p >= 1) {
            if (ev.loop) { track.t = 0; track.base = poseOf(room); }   // keep advancing
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
          break;                              // cyclic: never retires while running
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

    function retire(track) { tracks.delete(track.room.id + ':' + track.ev.id); }
    function key(room, ev) { return room.id + ':' + ev.id; }

    // ---- public API -------------------------------------------------------
    function start(level) {
      tracks.clear(); time = 0; running = true;
      // PRE-CARGA: load this Nexo's declared time-triggered events.
      for (const room of level.rooms) {
        for (const ev of (room.events || [])) {
          if (ev.enabled === false || !ev.action) continue;
          if (!ev.trigger || ev.trigger.type === 'time') tracks.set(key(room, ev), makeTrack(room, ev));
        }
      }
    }
    function stop() { running = false; tracks.clear(); }
    function update(level, dt) {
      if (!running) return;
      time += dt;
      for (const track of Array.from(tracks.values())) stepTrack(track, dt);
      for (const fn of systems) fn(level, dt, bus);
    }
    // manual trigger (editor "test" button): runs the event once from its current pose
    function fire(room, ev) {
      if (!ev || !ev.action) return;
      if (!running) running = true;
      tracks.set(key(room, ev), makeTrack(room, ev));
    }
    function activeCount() { return tracks.size; }
    function addSystem(fn) { systems.push(fn); return () => { const i = systems.indexOf(fn); if (i >= 0) systems.splice(i, 1); }; }

    return {
      start, stop, update, fire, addSystem,
      bus,
      activeCount,
      get time() { return time; },
      get running() { return running; }
    };
  }

  return { create };
});
