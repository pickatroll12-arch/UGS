/*
 * UGS — room-motion engine  (Stage 1 · Milestone 4)
 * ------------------------------------------------------------------
 * Plays RoomEvents on a timeline: shift / rotate / carousel / script.
 * It animates each room's `transform` (position + rotation) over time,
 * driven by a clock the caller advances — so pause and speed are just
 * "how much dt you pass in" (real-time + pause/speed, per the roadmap).
 *
 * Non-destructive: on start() it snapshots every room's authored transform
 * and on stop() restores it, so playing never mutates the saved design.
 *
 * Pure math + data — no DOM, no render. Runs in browser (window.UGS.engine)
 * and Node (module.exports) for headless testing.
 */
(function (root, factory) {
  const api = factory();
  root.UGS = root.UGS || {};
  root.UGS.engine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function pose(x, y, rotation) { return { x, y, rotation }; }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function lerpPose(a, b, k) { return pose(lerp(a.x, b.x, k), lerp(a.y, b.y, k), lerp(a.rotation, b.rotation, k)); }
  function poseOfRoom(room) { return pose(room.transform.x, room.transform.y, room.transform.rotation); }
  function applyPose(room, p) { room.transform.x = p.x; room.transform.y = p.y; room.transform.rotation = p.rotation; }

  // rotate a local point by `deg` around pivot (matches render.rotatePoint)
  function rot(u, v, deg, piv) {
    const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    const x = u - piv.x, y = v - piv.y;
    return { x: x * c - y * s + piv.x, y: x * s + y * c + piv.y };
  }
  // world position of a room's centre for a given rotation
  function roomCenterWorld(room, rotation) {
    const t = room.transform;
    const rc = rot(room.size.w / 2, room.size.h / 2, rotation, t.pivot);
    return { x: rc.x + t.x, y: rc.y + t.y };
  }

  // Expand a RoomEvent into a flat list of interpolated segments, starting from
  // the room's current pose `cur`. Each segment: { from, to, dur }.
  function buildSegments(event, cur) {
    const a = event.action || {}, segs = [];
    const dur = Math.max(0.0001, Number(a.duration) || 1);
    if (a.kind === 'shift') {
      const target = pose(Number(a.to && a.to.x) || 0, Number(a.to && a.to.y) || 0, cur.rotation);
      segs.push({ from: cur, to: target, dur });
      if (event.loop) segs.push({ from: target, to: cur, dur });          // ping-pong
    } else if (a.kind === 'rotate') {
      const target = pose(cur.x, cur.y, cur.rotation + (Number(a.by) || 90));
      segs.push({ from: cur, to: target, dur });
      if (event.loop) segs.push({ from: target, to: cur, dur });
    } else if (a.kind === 'carousel') {
      const iv = Math.max(0.0001, Number(a.interval) || 2);
      let prev = cur;
      for (const p of (a.poses || [])) {
        const to = pose(Number(p.x) || 0, Number(p.y) || 0, Number(p.rotation) || 0);
        segs.push({ from: prev, to, dur: iv }); prev = to;
      }
      if (event.loop && segs.length) segs.push({ from: prev, to: cur, dur: iv });  // cycle home
    } else if (a.kind === 'script') {
      let prev = cur;
      for (const st of (a.steps || [])) {
        if (st.op === 'move') { const to = pose(Number(st.to && st.to.x) || 0, Number(st.to && st.to.y) || 0, prev.rotation); segs.push({ from: prev, to, dur: Math.max(0.0001, Number(st.duration) || 1) }); prev = to; }
        else if (st.op === 'rotate') { const to = pose(prev.x, prev.y, prev.rotation + (Number(st.by) || 90)); segs.push({ from: prev, to, dur: Math.max(0.0001, Number(st.duration) || 1) }); prev = to; }
        else if (st.op === 'wait') { segs.push({ from: prev, to: prev, dur: Math.max(0.0001, Number(st.t) || 1) }); }
      }
      if (event.loop && segs.length) segs.push({ from: prev, to: cur, dur: 0.5 });
    }
    return segs;
  }

  // Orbit: the room revolves around an invisible axis (a world point), tracing a
  // circle. Continuous (always looping). If selfRotate, the room also turns to
  // keep its facing along the orbit.
  function buildOrbitRuntime(room, event) {
    const a = event.action || {};
    const center = { x: Number(a.center && a.center.x) || 0, y: Number(a.center && a.center.y) || 0 };
    const baseRot = room.transform.rotation;
    const wc = roomCenterWorld(room, baseRot);
    // radius is explicit (adjustable independently of the axis); fall back to the
    // room's current distance to the axis only if not authored.
    const R = a.radius != null ? Number(a.radius) : Math.hypot(wc.x - center.x, wc.y - center.y);
    const theta0 = Math.atan2(wc.y - center.y, wc.x - center.x);
    const period = Math.max(0.1, Number(a.period) || 4);
    return {
      kind: 'orbit', center, R, theta0, baseRot,
      omega: 2 * Math.PI / period,
      dir: a.direction === 'ccw' ? -1 : 1,
      selfRotate: !!a.selfRotate, t: 0
    };
  }

  function buildRuntime(room, event) {
    if (event.action && event.action.kind === 'orbit') return buildOrbitRuntime(room, event);
    return { kind: 'segments', segs: buildSegments(event, poseOfRoom(room)), i: 0, t: 0, loop: !!event.loop };
  }

  function create() {
    const base = new Map();      // roomId -> authored pose (restored on stop)
    const runs = new Map();      // roomId -> runtime ({kind:'segments'|'orbit', ...})
    let running = false;

    function findRoom(level, id) { return level.rooms.find(r => r.id === id) || null; }

    function fire(room, event) {
      const rt = buildRuntime(room, event);
      if (rt.kind === 'orbit' || rt.segs.length) runs.set(room.id, rt);
    }

    function start(level) {
      stop(level);
      base.clear(); runs.clear();
      for (const room of level.rooms) base.set(room.id, poseOfRoom(room));
      // auto-fire time-triggered events
      for (const room of level.rooms) {
        for (const ev of (room.events || [])) {
          if (ev.enabled !== false && ev.trigger && ev.trigger.type === 'time') fire(room, ev);
        }
      }
      running = true;
    }

    function stop(level) {
      if (level) for (const room of level.rooms) { const b = base.get(room.id); if (b) applyPose(room, b); }
      base.clear(); runs.clear(); running = false;
    }

    // Fire a room's manual events (used when the player clicks a movable room).
    function trigger(room) {
      let fired = 0;
      for (const ev of (room.events || [])) {
        if (ev.enabled !== false && (!ev.trigger || ev.trigger.type === 'manual')) { fire(room, ev); fired++; }
      }
      return fired;
    }

    function update(level, dt) {
      if (!running || dt <= 0) return;
      for (const [id, rt] of runs) {
        const room = findRoom(level, id); if (!room) { runs.delete(id); continue; }
        if (rt.kind === 'orbit') {
          rt.t += dt;
          const theta = rt.theta0 + rt.dir * rt.omega * rt.t;
          const rotation = rt.selfRotate ? rt.baseRot + (theta - rt.theta0) * 180 / Math.PI : rt.baseRot;
          const rc = rot(room.size.w / 2, room.size.h / 2, rotation, room.transform.pivot);
          room.transform.x = rt.center.x + rt.R * Math.cos(theta) - rc.x;
          room.transform.y = rt.center.y + rt.R * Math.sin(theta) - rc.y;
          room.transform.rotation = rotation;
          continue;
        }
        rt.t += dt;
        let seg = rt.segs[rt.i];
        while (seg && rt.t >= seg.dur) {
          rt.t -= seg.dur; applyPose(room, seg.to); rt.i++;
          if (rt.i >= rt.segs.length) { if (rt.loop) rt.i = 0; else { rt.done = true; break; } }
          seg = rt.segs[rt.i];
        }
        if (rt.done) { runs.delete(id); continue; }
        if (seg) applyPose(room, lerpPose(seg.from, seg.to, seg.dur > 0 ? rt.t / seg.dur : 1));
      }
    }

    return {
      start, stop, update, fire, trigger,
      isRunning: () => running,
      activeCount: () => runs.size,
      isAnimating: (roomId) => runs.has(roomId)
    };
  }

  return { create, buildSegments, roomCenterWorld };
});
