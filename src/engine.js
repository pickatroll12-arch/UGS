/*
 * UGS — engine  ([COMPONENTES LÓGICOS] · reescritura post-reset)
 * ==================================================================
 * La lógica del juego está PRE-CARGADA POR NEXO (nivel): cada nivel declara
 * en datos qué hace (por ahora, el movimiento mecánico de sus salas: shift /
 * rotate / orbit / carousel, y las transiciones por ascensor a través de los
 * agentes). El engine EJECUTA esos datos de forma determinista.
 *
 * NO hay life-sim en tiempo real ni simulación global continua de agentes
 * autónomos (decisión humana del reset). El único agente vivo es el PCJ, que
 * se mueve por click→ruta (ver agents.js / nav.js).
 *
 * Arquitectura (AGENTIC_REVIEW §4): esto es lógica pura. NUNCA importa ni
 * llama al renderizador. El render sólo lee el estado que esto deja en
 * room.transform y en los pawns. Toda la matemática de rotación vive en core.
 *
 * Contrato consumido por el editor conservado (src/editor.js):
 *   create() -> engine
 *   engine.start(level)          arranca la lógica de un Nexo
 *   engine.stop(level)           la detiene y restaura las poses autoradas
 *   engine.update(level, dt)     avanza un paso fijo determinista
 *   engine.fire(room, ev)        dispara un evento de sala manualmente (test)
 *   engine.activeCount()         nº de movimientos activos ahora mismo
 *   engine.isRunning()           ¿hay algún Nexo en marcha?
 *   engine.time                  reloj acumulado (para animación de render)
 *   engine.bus                   EventBus ('tick', 'pawn:arrived', ...)
 *
 * Corre en navegador (window.UGS.engine) y Node (module.exports) para tests.
 */
(function (root, factory) {
  const core = (root.UGS && root.UGS.core)
    || (typeof require !== 'undefined' ? require('./core.js') : null);
  if (!core) throw new Error('UGS.engine requires UGS.core to be loaded first.');
  const api = factory(core);
  root.UGS = root.UGS || {};
  root.UGS.engine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';

  const DEG = Math.PI / 180;
  function clone(o) { return typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)); }
  // room-local (u,v) rotated by the room's transform → world (mirrors the render
  // math, kept here so the LOGIC owns it and never reaches into the renderer).
  function rotatePoint(px, py, deg, piv) {
    const rad = deg * DEG, c = Math.cos(rad), s = Math.sin(rad);
    const rx = px - piv.x, ry = py - piv.y;
    return { x: rx * c - ry * s + piv.x, y: rx * s + ry * c + piv.y };
  }
  function roomCenterWorld(room) {
    const t = room.transform, pv = t.pivot || { x: 0, y: 0 };
    const rc = rotatePoint(room.size.w / 2, room.size.h / 2, t.rotation, pv);
    return { x: rc.x + t.x, y: rc.y + t.y };
  }
  // set the transform offset so the room's CENTRE lands on world point (cx,cy)
  // at the given rotation (used by orbit).
  function placeCenterAt(room, cx, cy, rotationDeg) {
    const pv = room.transform.pivot || { x: 0, y: 0 };
    const rc = rotatePoint(room.size.w / 2, room.size.h / 2, rotationDeg, pv);
    room.transform.rotation = rotationDeg;
    room.transform.x = cx - rc.x;
    room.transform.y = cy - rc.y;
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  const triWave = (p) => { p = ((p % 1) + 1) % 1; return p < 0.5 ? p * 2 : 2 - p * 2; };   // 0→1→0 ping-pong

  function create() {
    const bus = new core.EventBus();
    // started Nexos: levelId -> { level, base:Map(roomId->transformClone), entries:[] }
    const started = new Map();

    const engine = {
      bus,
      time: 0,

      isRunning() { return started.size > 0; },
      activeCount() { let n = 0; for (const s of started.values()) n += s.entries.length; return n; },

      start(level) {
        if (!level || started.has(level.id)) return;
        const base = new Map();
        const entries = [];
        for (const room of level.rooms) {
          base.set(room.id, clone(room.transform));
          if (!room.movable || !Array.isArray(room.events)) continue;
          for (const ev of room.events) {
            if (ev.enabled === false) continue;
            // only auto (time) events start on their own; manual events wait for fire()
            const trig = ev.trigger && ev.trigger.type;
            if (trig === 'time') entries.push(makeEntry(room, ev));
          }
        }
        started.set(level.id, { level, base, entries });
      },

      stop(level) {
        if (!level) return;
        const s = started.get(level.id);
        if (!s) return;
        // restore each room's authored pose so Build/export never keep a
        // mid-animation transform.
        for (const room of level.rooms) {
          const b = s.base.get(room.id);
          if (b) room.transform = clone(b);
        }
        started.delete(level.id);
      },

      update(level, dt) {
        if (!level) return;
        const s = started.get(level.id);
        if (!s || !(dt > 0)) return;
        this.time += dt;
        for (let i = s.entries.length - 1; i >= 0; i--) {
          const done = stepEntry(s.entries[i], dt);
          if (done) s.entries.splice(i, 1);
        }
        bus.emit('tick', { level, dt, time: this.time });
      },

      // manual trigger (inspector "Test"): (re)start this event now, regardless
      // of its trigger type. Attaches to whichever started Nexo owns the room.
      fire(room, ev) {
        if (!room || !ev) return;
        for (const s of started.values()) {
          if (s.level.rooms.indexOf(room) === -1) continue;
          for (let i = s.entries.length - 1; i >= 0; i--) if (s.entries[i].ev === ev) s.entries.splice(i, 1);
          s.entries.push(makeEntry(room, ev));
          return;
        }
      }
    };

    // ---- motion runtime ----------------------------------------------------
    function makeEntry(room, ev) {
      const origin = clone(room.transform);
      const entry = { room, ev, t: 0, origin };
      if (ev.action && ev.action.kind === 'orbit') {
        const rc = roomCenterWorld(room), c = ev.action.center || { x: 0, y: 0 };
        entry.ang0 = Math.atan2(rc.y - c.y, rc.x - c.x);
        entry.radius = ev.action.radius != null ? Number(ev.action.radius) : Math.hypot(rc.x - c.x, rc.y - c.y);
      }
      return entry;
    }
    // advance one entry by dt; return true when a NON-looping event has finished.
    function stepEntry(entry, dt) {
      const a = entry.ev.action; if (!a) return true;
      entry.t += dt;
      const loop = !!entry.ev.loop;
      const room = entry.room, o = entry.origin;
      switch (a.kind) {
        case 'shift': {
          const dur = Math.max(0.01, Number(a.duration) || 1);
          const to = a.to || { x: o.x, y: o.y };
          const raw = entry.t / dur;
          const p = loop ? triWave(raw) : Math.min(1, raw);
          room.transform.x = lerp(o.x, to.x, p);
          room.transform.y = lerp(o.y, to.y, p);
          return !loop && raw >= 1;
        }
        case 'rotate': {
          const dur = Math.max(0.01, Number(a.duration) || 1);
          const by = Number(a.by) || 0;
          const raw = entry.t / dur;
          const p = loop ? raw : Math.min(1, raw);
          room.transform.rotation = o.rotation + by * p;
          return !loop && raw >= 1;
        }
        case 'orbit': {
          const c = a.center || { x: 0, y: 0 };
          const period = Math.max(0.01, Number(a.period) || 4);
          const dir = a.direction === 'ccw' ? -1 : 1;
          const ang = entry.ang0 + dir * (2 * Math.PI / period) * entry.t;
          const R = entry.radius;
          const cx = c.x + R * Math.cos(ang), cy = c.y + R * Math.sin(ang);
          const rot = a.selfRotate ? o.rotation + (ang - entry.ang0) / DEG : o.rotation;
          placeCenterAt(room, cx, cy, rot);
          return false;   // orbits run until the Nexo stops
        }
        case 'carousel': {
          const poses = Array.isArray(a.poses) ? a.poses : [];
          if (poses.length < 2) return true;
          const interval = Math.max(0.01, Number(a.interval) || 2);
          const total = poses.length;                       // segments if looping
          const rawSeg = entry.t / interval;
          if (!loop && rawSeg >= total - 1) {               // settle on the last pose
            const last = poses[total - 1];
            room.transform.x = last.x; room.transform.y = last.y; room.transform.rotation = last.rotation;
            return true;
          }
          const seg = Math.floor(rawSeg) % total;
          const p = rawSeg - Math.floor(rawSeg);
          const from = poses[seg], to = poses[(seg + 1) % total];
          room.transform.x = lerp(from.x, to.x, p);
          room.transform.y = lerp(from.y, to.y, p);
          room.transform.rotation = lerp(from.rotation, to.rotation, p);
          return false;
        }
        default:
          return true;   // unknown action: drop it
      }
    }

    return engine;
  }

  return { create };
});
