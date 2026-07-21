/*
 * UGS — core foundation  (heavy-core rework)
 * ==================================================================
 * The capable primitives every other module stands on. Deliberately
 * dependency-free, allocation-conscious, and deterministic so the game
 * can scale to an ambitious simulation (many autonomous agents, station
 * subsystems, combat) while staying smooth on modest hardware.
 *
 * Contents
 *   - math:    clamp / lerp / smooth / angle helpers, Vec2 ops
 *   - rng:     seeded, deterministic PRNG (reproducible worlds + saves)
 *   - ids:     monotonic id allocator (stable across a session)
 *   - events:  a small synchronous EventBus (system decoupling)
 *   - time:    FixedTimestep accumulator (sim decoupled from framerate)
 *   - data:    Grid2D dense typed-array grid (cache-friendly, no GC churn)
 *   - pool:    Pool for recycling short-lived objects in hot loops
 *
 * Runs in the browser (window.UGS.core) and Node (module.exports).
 */
(function (root, factory) {
  const api = factory();
  root.UGS = root.UGS || {};
  root.UGS.core = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TAU = Math.PI * 2;

  // ---- scalar math --------------------------------------------------------
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function invLerp(a, b, v) { return a === b ? 0 : (v - a) / (b - a); }
  function smoothstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function approx(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-6 : eps); }
  // shortest signed angular delta (radians), for turning toward a heading
  function angleDelta(from, to) { let d = (to - from) % TAU; if (d < -Math.PI) d += TAU; if (d > Math.PI) d -= TAU; return d; }

  // ---- Vec2 (plain {x,y}; functions avoid allocation where they can) -------
  const vec = {
    of: (x, y) => ({ x, y }),
    add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
    sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
    scale: (a, s) => ({ x: a.x * s, y: a.y * s }),
    dot: (a, b) => a.x * b.x + a.y * b.y,
    len: (a) => Math.hypot(a.x, a.y),
    len2: (a) => a.x * a.x + a.y * a.y,
    dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    dist2: (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; },
    lerp: (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }),
    norm: (a) => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; },
    rot: (a, rad, piv) => {
      const px = piv ? piv.x : 0, py = piv ? piv.y : 0;
      const c = Math.cos(rad), s = Math.sin(rad), x = a.x - px, y = a.y - py;
      return { x: x * c - y * s + px, y: x * s + y * c + py };
    }
  };

  // ---- seeded PRNG (mulberry32) ------------------------------------------
  // Deterministic and fast. Same seed → same sequence, so worlds/AI replay
  // identically and saves can restore mid-simulation state.
  function makeRNG(seed) {
    let s = (seed >>> 0) || 0x9e3779b9;
    const next = () => {
      s |= 0; s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      next,                                   // float [0,1)
      int: (n) => Math.floor(next() * n),     // int [0,n)
      range: (lo, hi) => lo + next() * (hi - lo),
      pick: (arr) => arr[Math.floor(next() * arr.length)],
      chance: (p) => next() < p,
      sign: () => (next() < 0.5 ? -1 : 1),
      get seed() { return s >>> 0; },
      setSeed: (v) => { s = (v >>> 0) || 0x9e3779b9; },
      fork: () => makeRNG((s ^ 0x85ebca6b) >>> 0)   // independent sub-stream
    };
  }

  // ---- id allocator -------------------------------------------------------
  function makeIds() {
    let n = 0;
    return {
      next: (prefix) => `${prefix || 'id'}-${(n = (n + 1) | 0).toString(36)}-${Date.now().toString(36)}`,
      short: (prefix) => `${prefix || 'id'}${(n = (n + 1) | 0)}`,
      get count() { return n; }
    };
  }

  // ---- EventBus -----------------------------------------------------------
  // Synchronous pub/sub so systems (motion, subsystems, AI, links) talk
  // without hard references. emit() is allocation-free on the hot path.
  class EventBus {
    constructor() { this._m = new Map(); }
    on(type, fn) { let s = this._m.get(type); if (!s) this._m.set(type, s = new Set()); s.add(fn); return () => this.off(type, fn); }
    once(type, fn) { const off = this.on(type, (p) => { off(); fn(p); }); return off; }
    off(type, fn) { const s = this._m.get(type); if (s) s.delete(fn); }
    emit(type, payload) { const s = this._m.get(type); if (!s) return; for (const fn of s) fn(payload, type); }
    clear(type) { if (type) this._m.delete(type); else this._m.clear(); }
  }

  // ---- FixedTimestep ------------------------------------------------------
  // Accumulates real time and releases it in fixed slices, so the simulation
  // advances at a stable rate regardless of the render framerate. Returns the
  // interpolation alpha for smooth rendering between sim states. Caps catch-up
  // steps to avoid the "spiral of death" on a slow frame (Steam-Machine safe).
  class FixedTimestep {
    constructor(hz = 30, maxSteps = 5) { this.dt = 1 / hz; this.max = maxSteps; this.acc = 0; this.steps = 0; }
    // call each frame with real seconds; invokes step(fixedDt) 0..max times
    advance(realDt, step) {
      this.acc += Math.min(realDt, this.dt * this.max);   // clamp huge stalls
      this.steps = 0;
      while (this.acc >= this.dt && this.steps < this.max) { step(this.dt); this.acc -= this.dt; this.steps++; }
      return this.acc / this.dt;                          // alpha in [0,1)
    }
    reset() { this.acc = 0; this.steps = 0; }
  }

  // ---- Grid2D -------------------------------------------------------------
  // Dense grid backed by a typed array: O(1) lookups, contiguous memory, zero
  // per-cell GC. The right structure for large station decks and the tile
  // queries an agent-heavy sim will hammer (occupancy, cost fields, flow).
  class Grid2D {
    constructor(w, h, Ctor, fill) {
      this.w = w | 0; this.h = h | 0;
      this.data = new (Ctor || Int16Array)(this.w * this.h);
      if (fill) this.data.fill(fill);
    }
    idx(x, y) { return y * this.w + x; }
    inside(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
    get(x, y) { return this.inside(x, y) ? this.data[y * this.w + x] : 0; }
    set(x, y, v) { if (this.inside(x, y)) this.data[y * this.w + x] = v; }
    fill(v) { this.data.fill(v); return this; }
    forEach(fn) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) fn(this.data[y * this.w + x], x, y); }
  }

  // ---- Pool ---------------------------------------------------------------
  // Recycle short-lived objects (path nodes, particles, transient vecs) to
  // keep hot loops off the allocator and the GC quiet during heavy sim frames.
  class Pool {
    constructor(factory, reset, initial) {
      this._make = factory; this._reset = reset || (() => {}); this._free = [];
      for (let i = 0; i < (initial || 0); i++) this._free.push(factory());
    }
    acquire() { return this._free.length ? this._free.pop() : this._make(); }
    release(o) { this._reset(o); this._free.push(o); }
    get size() { return this._free.length; }
  }

  return {
    TAU, clamp, lerp, invLerp, smoothstep, approx, angleDelta,
    vec, makeRNG, makeIds,
    EventBus, FixedTimestep, Grid2D, Pool
  };
});
