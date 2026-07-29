/*
 * UGS — engine/station  (REVAMP · capa estratégica — OBJP-1 upgrade)
 * ==================================================================
 * [COMPONENTES LÓGICOS] — la CAPA ESTRATÉGICA del juego (lo que en
 * Xenonauts 2 es el geoscape/base). Complementa la capa táctica
 * (engine.js + agents.js dentro de un Nexo) sin mezclarse con ella.
 *
 * Capacidades (formatos DECLARATIVOS + runtime; el contenido F1 del
 * árbol de hitos humano llega como DATOS cuando OBJP-1.1 se firme):
 *
 *   ECONOMÍA ..... CRED (moneda), inventario en UD con tope de
 *                  almacenamiento, energía (capacidad vs consumo TW),
 *                  población PNJ (count/capacity). Estado en
 *                  station.state → viaja en los saves.
 *   MÓDULOS ...... defs con coste/energía/provisión; placeModule()
 *                  valida: hito desbloqueado, CRED, headroom energético
 *                  y CONEXIÓN FÍSICA (la sala nueva comparte arista con
 *                  una sala existente del Nexo — REVISION MAESTRA 2).
 *   HITOS ........ defs {phase, cost, requires[], grants{modules,
 *                  abilities}}; desbloquear todos los de una fase
 *                  avanza station.state.phase (tope 4 fases / 3 nexos).
 *   SCHEDULER .... temporizadores RNG deterministas (ej. "falla del
 *                  generador: 20% cada 20 min") que emiten eventos.
 *   EXPEDICIONES . rutas por ETAPAS con rendimientos probabilísticos
 *                  (la forma exacta de la "ruta de extracción" del
 *                  árbol humano); naves con capacidad/falla/reparación;
 *                  ocurre FUERA DE PANTALLA: solo estado + eventos.
 *
 * Toda probabilidad pasa por core/rng (semilla en station.state.seed):
 * misma semilla + mismos pasos → mismo resultado (PROMPT_MAESTRO §4).
 *
 * Corre en navegador (window.UGS.station) y en Node (module.exports).
 */
(function (root, factory) {
  const coreApi = (root.UGS && root.UGS.core)
    || (typeof require !== 'undefined' ? require('../core/core.js') : null);
  const dataApi = (root.UGS && root.UGS.data)
    || (typeof require !== 'undefined' ? require('../core/data.js') : null);
  const api = factory(coreApi, dataApi);
  root.UGS = root.UGS || {};
  root.UGS.station = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CORE, D) {
  'use strict';

  const MAX_PHASE = 4;        // REVISION MAESTRA 2: límite de fases
  const MAX_NEXOS = 3;        // REVISION MAESTRA 2: 3 nexos, 1 por nivel
  const EPS = 1e-6;

  function create(deps) {
    deps = deps || {};
    const bus = deps.bus || null;          // EventBus compartido (opcional)
    const rng = deps.rng || null;          // core/rng (opcional en tests puros)

    const moduleDefs = new Map();
    const hitoDefs = new Map();
    const routeDefs = new Map();
    const timers = [];

    const emit = (evt, payload) => { if (bus) bus.emit(evt, payload); };

    /*
     * Bodega base del Nexo (GAP-ECON-01, debug 2026-07-28): sin ella el bucle
     * F1 era IMPOSIBLE — la primera expedición volvía sin poder descargar
     * (storageCap 0 hasta colocar el Almacén), la venta daba 0 CRED y el hito
     * del Almacén (150 CRED) quedaba fuera de alcance para siempre. 5 UD de
     * bodega de emergencia bastan para arrancar la economía sin tocar los
     * costes de hito documentados: el Almacén sigue siendo el techo real (30).
     * PROPUESTA pendiente de validación humana: se ajusta en una constante.
     */
    const BASE_STORAGE = 5;

    // ---- estado -------------------------------------------------------------
    function ensure(station) {
      if (!station.state) station.state = {};
      const s = station.state;
      if (typeof s.cred !== 'number') s.cred = 0;
      if (!s.seed) s.seed = 'ugs-station';
      if (typeof s.phase !== 'number') s.phase = 1;
      if (!s.energy) s.energy = { capacity: 0, used: 0 };
      if (typeof s.blackout !== 'boolean') s.blackout = s.energy.used > s.energy.capacity;
      if (!s.inventory) s.inventory = {};
      if (typeof s.storageCap !== 'number') s.storageCap = 0;
      if (!s.pnj) s.pnj = { count: 1, capacity: 0 };
      if (!Array.isArray(s.unlocked)) s.unlocked = [];
      if (!Array.isArray(s.abilities)) s.abilities = [];
      if (!Array.isArray(s.buildable)) s.buildable = [];
      if (!Array.isArray(s.modules)) s.modules = [];
      if (!Array.isArray(s.ships)) s.ships = [];
      return s;
    }

    // ---- registro de defs ---------------------------------------------------
    function defineModule(def) { moduleDefs.set(def.id, def); return def; }
    function defineHito(def) { hitoDefs.set(def.id, Object.assign({ requires: [], grants: {} }, def)); return def; }
    function defineRoute(def) { routeDefs.set(def.id, def); return def; }

    // ---- economía -------------------------------------------------------------
    function canAfford(station, cost) { return ensure(station).cred >= (cost || 0); }
    function pay(station, cost) {
      const s = ensure(station);
      if (s.cred < (cost || 0)) return false;
      s.cred -= cost || 0;
      return true;
    }
    function earn(station, n) { ensure(station).cred += n || 0; }

    function storedTotal(station) {
      const inv = ensure(station).inventory;
      return Object.values(inv).reduce((a, n) => a + n, 0);
    }
    // añade hasta el tope de almacenamiento; devuelve lo REALMENTE añadido
    function addItem(station, item, n) {
      const s = ensure(station);
      const room = Math.max(0, s.storageCap - storedTotal(station));
      const added = Math.min(room, n);
      if (added > 0) s.inventory[item] = (s.inventory[item] || 0) + added;
      return added;
    }
    function removeItem(station, item, n) {
      const s = ensure(station);
      const have = s.inventory[item] || 0;
      const taken = Math.min(have, n);
      if (taken > 0) s.inventory[item] = have - taken;
      return taken;
    }

    // recomputar agregados desde los módulos instalados
    function recompute(station) {
      const s = ensure(station);
      let cap = 0, used = 0, storage = 0, pnjCap = 0;
      for (const m of s.modules) {
        const def = moduleDefs.get(m.defId);
        if (!def) continue;
        used += def.energyUse || 0;
        // TW que aportan los OBJETOS realmente colocados en la sala de esta
        // instancia (núcleos de reactor). Lo mantiene al día syncModuleEnergy;
        // viaja en el save para que la energía sobreviva a recargar.
        cap += Math.max(0, Number(m.objEnergy) | 0);
        if (def.provides) {
          cap += def.provides.energy || 0;
          storage += def.provides.storage || 0;
          pnjCap += def.provides.pnjCapacity || 0;
        }
      }
      s.energy.capacity = cap; s.energy.used = used;
      s.storageCap = BASE_STORAGE + storage; s.pnj.capacity = pnjCap;
      const was = !!s.blackout;
      s.blackout = used > cap;
      if (s.blackout !== was) emit('station:blackout', { station, blackout: s.blackout });
      return s;
    }

    // ---- hitos / fases ----------------------------------------------------------
    function hitoStatus(station, hitoId) {
      const s = ensure(station);
      const def = hitoDefs.get(hitoId);
      if (!def) return { ok: false, reason: 'hito desconocido' };
      if (s.unlocked.includes(hitoId)) return { ok: false, reason: 'ya desbloqueado' };
      const missing = def.requires.filter(r => !s.unlocked.includes(r));
      if (missing.length) return { ok: false, reason: 'requiere: ' + missing.join(', ') };
      if (!canAfford(station, def.cost)) return { ok: false, reason: 'CRED insuficiente' };
      return { ok: true };
    }
    function unlockHito(station, hitoId) {
      const chk = hitoStatus(station, hitoId);
      if (!chk.ok) return chk;
      const s = ensure(station);
      const def = hitoDefs.get(hitoId);
      pay(station, def.cost);
      s.unlocked.push(hitoId);
      for (const m of (def.grants.modules || [])) if (!s.buildable.includes(m)) s.buildable.push(m);
      for (const a of (def.grants.abilities || [])) if (!s.abilities.includes(a)) s.abilities.push(a);
      emit('station:hito', { station, hitoId, def });
      // ¿fase completada? → avanzar (tope MAX_PHASE)
      const ofPhase = [...hitoDefs.values()].filter(h => (h.phase || 1) === s.phase);
      if (ofPhase.length && ofPhase.every(h => s.unlocked.includes(h.id)) && s.phase < MAX_PHASE) {
        s.phase += 1;
        emit('station:phase', { station, phase: s.phase });
      }
      return { ok: true };
    }
    // nexos disponibles según fase (1 por nivel, tope 3)
    function nexoLimit(station) { return Math.min(MAX_NEXOS, ensure(station).phase); }

    // ---- módulos (colocación física en un Nexo) ----------------------------------
    function rectsTouch(a, b) {
      const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > EPS;
      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > EPS;
      const touchX = Math.abs(a.x + a.w - b.x) < EPS || Math.abs(b.x + b.w - a.x) < EPS;
      const touchY = Math.abs(a.y + a.h - b.y) < EPS || Math.abs(b.y + b.h - a.y) < EPS;
      return (touchX && overlapY) || (touchY && overlapX);
    }
    const roomRect = (room) => ({ x: room.transform.x, y: room.transform.y, w: room.size.w, h: room.size.h });

    function placeModule(station, nexo, defId, room) {
      const s = ensure(station);
      const def = moduleDefs.get(defId);
      if (!def) return { ok: false, reason: 'módulo desconocido' };
      if (!def.free && !s.buildable.includes(defId)) return { ok: false, reason: 'requiere hito' };
      if (!canAfford(station, def.cost)) return { ok: false, reason: 'CRED insuficiente' };
      const energyAfter = s.energy.used + (def.energyUse || 0);
      // La puerta debe mirar la capacidad DESPUÉS de colocar: un productor
      // (provides.energy) no puede quedar bloqueado por el consumo que él
      // mismo viene a resolver. Antes de este arreglo, reponer un generador
      // durante un brownout (used > capacity) se rechazaba con 'energía
      // insuficiente' — el jugador solo podía salir retirando consumo.
      const capAfter = s.energy.capacity + ((def.provides && def.provides.energy) || 0);
      if (energyAfter > capAfter) return { ok: false, reason: 'energía insuficiente' };
      // CONEXIÓN FÍSICA: la sala debe compartir una arista con alguna sala del Nexo
      const r = roomRect(room);
      const connected = nexo.rooms.some(other => rectsTouch(r, roomRect(other)));
      if (!connected) return { ok: false, reason: 'sin conexión física al Nexo' };
      pay(station, def.cost);
      nexo.rooms.push(room);
      const inst = attachModule(station, nexo, defId, room);
      emit('station:module', { station, nexo, module: inst, def });
      return { ok: true, module: inst };
    }

    /*
     * ENGANCHE de una sala YA colocada a la capa estratégica (-XONO, 2026-07-28:
     * «tampoco funciona la generacion de energia»). La suite Dev empuja salas
     * directamente al Nexo, sin pasar por placeModule, así que la instancia
     * nunca existía en state.modules y la energía se quedaba en 0/0 TW pasara
     * lo que pasara. Esto es la MITAD CONTABLE de placeModule, sin las puertas
     * de coste/hito/energía: en la suite se diseña, no se paga.
     */
    function attachModule(station, nexo, defId, room) {
      const s = ensure(station);
      detachModule(station, room.id);                 // idempotente: recolocar no duplica
      const def = moduleDefs.get(defId);
      // Un hangar colocado por placeModule no heredaba la marca que la UI
      // reconoce (hangarRooms lee room.hangar/shipCap): la nave se amarraba
      // bien (roomCapOf lee el def) pero el placeholder nunca se dibujaba.
      // Se propaga la marca desde el def; shipCap se deja SIN setear para que
      // roomCapOf siga leyendo el def (capacidad room-first: un shipCap
      // explícito del diseñador manda sobre el def y no se pisa).
      if (def && def.provides && def.provides.shipCap && typeof room.shipCap !== 'number') room.hangar = true;
      const inst = {
        id: CORE.uid('mod'), defId, nexoId: nexo.id, roomId: room.id,
        objEnergy: energyOfRoom(room)
      };
      s.modules.push(inst);
      recompute(station);
      return inst;
    }
    function detachModule(station, roomId) {
      const s = ensure(station);
      const before = s.modules.length;
      s.modules = s.modules.filter(m => m.roomId !== roomId);
      if (s.modules.length !== before) recompute(station);
      return before - s.modules.length;
    }

    // TW que aportan los objetos de una sala (el catálogo dice cuánto vale cada
    // tipo; ver core/data.js objectEnergy). Sin data cargado, 0.
    function energyOfRoom(room) {
      if (!room || !Array.isArray(room.objects) || !D || !D.objectEnergy) return 0;
      let tw = 0;
      for (const o of room.objects) tw += D.objectEnergy(o.type);
      return tw;
    }

    /*
     * Reevalúa los TW de objeto de TODAS las instancias contra las salas reales
     * y recomputa. Se llama tras editar objetos: colocar un núcleo en una sala
     * ya montada tiene que encender la energía en el acto.
     */
    function syncModuleEnergy(station, nexos) {
      const s = ensure(station);
      let changed = false;
      for (const m of s.modules) {
        let room = null;
        for (const n of (nexos || [])) {
          const r = n.rooms.find(x => x.id === m.roomId);
          if (r) { room = r; break; }
        }
        const tw = energyOfRoom(room);
        if (tw !== (m.objEnergy || 0)) { m.objEnergy = tw; changed = true; }
      }
      if (changed) recompute(station);
      return changed;
    }

    // ---- scheduler RNG -------------------------------------------------------------
    function addTimer(t) { timers.push(Object.assign({ acc: 0, chance: null }, t)); }
    function stepTimers(station, dt) {
      for (const t of timers) {
        t.acc += dt;
        if (t.acc < t.interval) continue;
        t.acc -= t.interval;
        if (t.chance == null || (rng && rng.chance(t.chance))) {
          emit('station:event', { station, id: t.id, event: t.event || t.id });
        }
      }
    }

    // ---- hangar: capacidad de naves (K2 · OBJP-1.1) ----------------------------------
    // Una sala actúa de hangar si (a) su def declara provides.shipCap, o (b) tiene
    // room.shipCap explícito (seteable en dev, viaja en el save; tiene prioridad).
    function roomCapOf(room, s) {
      if (!room) return 0;
      if (typeof room.shipCap === 'number') return room.shipCap;
      const m = s.modules.find(mm => mm.roomId === room.id);
      const def = m && moduleDefs.get(m.defId);
      return (def && def.provides && def.provides.shipCap) || 0;
    }
    function shipCapacity(station, nexos) {
      const s = ensure(station);
      let cap = 0;
      for (const n of (nexos || [])) for (const r of n.rooms) cap += roomCapOf(r, s);
      return cap;
    }
    // primera sala de hangar con amarre libre (para asignar nave nueva)
    function freeBerth(station, nexos) {
      const s = ensure(station);
      for (const n of (nexos || [])) {
        for (const room of n.rooms) {
          const cap = roomCapOf(room, s);
          if (!cap) continue;
          const docked = s.ships.filter(sh => sh.hangarRoomId === room.id && sh.state !== 'out').length;
          if (docked < cap) return { roomId: room.id, room };
        }
      }
      return null;
    }

    // ---- expediciones (fuera de pantalla) -------------------------------------------
    function addShip(station, ship, nexos) {
      const s = ensure(station);
      if (nexos && s.ships.length >= shipCapacity(station, nexos)) return null;   // sin amarre libre
      const berth = nexos ? freeBerth(station, nexos) : null;
      const sh = Object.assign({ id: CORE.uid('ship'), state: 'idle', capacity: 5, cargo: null }, ship);
      if (berth && !sh.hangarRoomId) sh.hangarRoomId = berth.roomId;
      s.ships.push(sh);
      return sh;
    }
    function launchExpedition(station, routeId, shipId) {
      const s = ensure(station);
      const route = routeDefs.get(routeId);
      const ship = s.ships.find(sh => sh.id === shipId);
      if (!route) return { ok: false, reason: 'ruta desconocida' };
      if (!ship) return { ok: false, reason: 'nave desconocida' };
      if (ship.state !== 'idle') return { ok: false, reason: 'nave no disponible' };
      ship.state = 'out';
      ship.routeId = routeId;
      ship.stage = 0;
      ship.t = 0;
      ship.cargo = {};
      emit('station:expedition:launch', { station, ship, route });
      return { ok: true };
    }
    function stepExpeditions(station, dt) {
      const s = ensure(station);
      for (const ship of s.ships) {
        if (ship.state !== 'out') continue;
        const route = routeDefs.get(ship.routeId);
        if (!route) { ship.state = 'idle'; continue; }
        ship.t += dt;
        const stage = route.stages[ship.stage];
        if (ship.t < stage.duration) continue;
        ship.t -= stage.duration;
        // falla de la nave en esta etapa (árbol: 10% por expedición)
        if (route.failChance && rng && rng.chance(route.failChance)) {
          ship.state = 'damaged';
          emit('station:expedition:failed', { station, ship, stage: ship.stage });
          continue;
        }
        // rendimientos probabilísticos de la etapa, con tope de capacidad
        let load = Object.values(ship.cargo).reduce((a, n) => a + n, 0);
        for (const y of (stage.yields || [])) {
          if (!rng || rng.chance(y.chance)) {
            const amount = y.min === y.max ? y.min : rng.range(y.min, y.max);
            const space = Math.max(0, ship.capacity - load);
            const got = Math.min(space, amount);
            if (got > 0) { ship.cargo[y.item] = (ship.cargo[y.item] || 0) + got; load += got; }
          }
        }
        ship.stage += 1;
        if (ship.stage >= route.stages.length) {
          // regreso: descargar en el almacén (lo que quepa)
          const delivered = {};
          for (const [item, n] of Object.entries(ship.cargo)) {
            const added = addItem(station, item, n);
            if (added > 0) delivered[item] = added;
          }
          ship.state = 'idle';
          ship.routeId = null; ship.stage = 0; ship.t = 0;
          const cargo = ship.cargo; ship.cargo = null;
          emit('station:expedition:done', { station, ship, cargo, delivered });
        }
      }
    }
    function repairShip(station, shipId, cost) {
      const s = ensure(station);
      const ship = s.ships.find(sh => sh.id === shipId);
      if (!ship || ship.state !== 'damaged') return { ok: false, reason: 'nada que reparar' };
      if (!pay(station, cost || 0)) return { ok: false, reason: 'CRED insuficiente' };
      ship.state = 'idle';
      emit('station:ship:repaired', { station, ship });
      return { ok: true };
    }

    // ---- paso fijo ------------------------------------------------------------------
    function update(station, dt) {
      stepTimers(station, dt);
      stepExpeditions(station, dt);
    }

    return {
      MAX_PHASE, MAX_NEXOS,
      ensure, recompute,
      defineModule, defineHito, defineRoute,
      canAfford, pay, earn, addItem, removeItem, storedTotal,
      hitoStatus, unlockHito, nexoLimit,
      rectsTouch, placeModule, attachModule, detachModule, syncModuleEnergy,
      addTimer, addShip, launchExpedition, repairShip,
      shipCapacity, freeBerth,
      update
    };
  }

  return { create };
});
