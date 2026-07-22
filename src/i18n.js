/*
 * UGS — internationalisation (i18n)
 * ==================================================================
 * A small, dependency-free localisation layer. UI strings live here as
 * keyed dictionaries (en / es) instead of being hard-coded in markup or
 * editor logic, so the whole interface can switch language at runtime and
 * more languages can be added later without touching feature code.
 *
 * Design rules
 *   - Save data stays language-neutral: materials, objects, layers, etc.
 *     are stored by id; only the *display* of an id is translated here
 *     (keys like `mat.deck`, `obj.console`, `wall.solid`).
 *   - English is the fallback language; a key missing in the active
 *     language falls back to English, and a key missing everywhere returns
 *     a visible ⟦key⟧ marker (and warns once) so gaps surface in dev.
 *   - `t(key, params)` interpolates `{name}` placeholders from `params`.
 *   - DOM binding is opt-in via data-* attributes (see `apply`).
 *
 * Runs in the browser (window.UGS.i18n) and Node (module.exports); browser-
 * only concerns (localStorage, navigator, document) are all guarded.
 */
(function (root, factory) {
  const api = factory();
  root.UGS = root.UGS || {};
  root.UGS.i18n = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FALLBACK = 'en';
  const STORE_KEY = 'ugs.lang';

  // -------------------------------------------------------------------------
  // Dictionaries. Keep keys sorted by area. English is the source of truth;
  // every key present in `en` should have a matching `es` entry.
  // -------------------------------------------------------------------------
  const DICTS = {
    en: {
      // app shell
      'app.title': 'UGS — Station Builder',
      'app.brand': 'UGS · STATION BUILDER',
      'app.subtitle': 'Stage 1 · revised — usable builder pass',

      // modes
      'mode.build': 'Build',
      'mode.play': 'Play',

      // tabs
      'tab.build': 'Build',
      'tab.rooms': 'Rooms',
      'tab.save': 'Save',

      // sections
      'section.tools': 'Tools',

      // tools
      'tool.select': 'Select',
      'tool.floor': 'Floor',
      'tool.wall': 'Wall',
      'tool.object': 'Object',
      'tool.entry': 'Entry',
      'tool.erase': 'Erase',
      'tool.fill': 'Fill',
      'tool.link': 'Link',

      // tool hints (bottom line / tooltips)
      'tool.select.hint': 'Click a tile, object, wall, or room to inspect and edit it.',
      'tool.floor.hint': 'Paint floor tiles with the selected material.',
      'tool.wall.hint': 'Raise walls on tile edges with the selected shape and material.',
      'tool.object.hint': 'Place the selected object. Some are interactive in Play.',
      'tool.entry.hint': 'Set the deck spawn point where the pawn appears in Play.',
      'tool.erase.hint': 'Remove the topmost thing under the cursor (object, then wall, then floor).',
      'tool.fill.hint': 'Flood-fill connected floor with the selected material.',
      'tool.link.hint': 'Connect decks: click a source tile, switch deck, click the spawn.',

      // select filter
      'filter.label': 'Select filter',
      'filter.all': 'All',
      'filter.object': 'Objects only',
      'filter.wall': 'Walls only',
      'filter.floor': 'Floors only',

      // palettes
      'palette.floorMat': 'Floor material',
      'palette.wallShape': 'Wall shape',
      'palette.wallMat': 'Wall material',
      'palette.objects': 'Objects',

      // decks / links
      'decks.title': 'Decks (levels)',
      'decks.namePlaceholder': 'Deck name',
      'decks.add': '+ Add deck',
      'decks.delete': 'Delete deck',
      'decks.linkHint': 'Use the Link tool to connect decks: click a source tile (e.g. an elevator), switch deck, click the spawn. In Play, click the link to travel.',

      // layers / room
      'layers.title': 'Layers',
      'room.duplicate': 'Duplicate room',
      'motion.title': 'Room motion',
      'motion.hint': 'Select a room (Select tool) — its motion events appear in the Inspector below. Add Shift / Rotate / Orbit / Carousel, then drag the coloured handle on the map to aim it. Hit Play to watch.',

      // save tab
      'history.title': 'History',
      'action.undo': 'Undo',
      'action.redo': 'Redo',
      'package.title': 'Package',
      'action.export': 'Export',
      'action.import': 'Import',
      'action.new': 'New',

      // inspector
      'inspector.title': 'Inspector',
      'inspector.empty': 'Nothing selected.',

      // play bar
      'play.title': 'PLAY',
      'play.pause': '❚❚ Pause',
      'play.resume': '▶ Resume',
      'play.hint': 'Click a floor tile to walk the pawn · a door to open it · an elevator to change deck · Space pause · 1/2/3 speed',

      // language selector
      'lang.label': 'Language',
      'lang.en': 'English',
      'lang.es': 'Español',

      // status messages
      'status.loading': 'Loading…',
      'status.newStation': 'New station — one empty room. Paint floors, raise walls, place objects.',
      'status.emptyReady': 'Empty room ready. Paint floors and raise walls, or hit Play to walk the pawn.',
      'status.layerHidden': 'Layer {layer} hidden.',
      'status.layerShown': 'Layer {layer} shown.',
      'status.filter': 'Select filter: {filter}.',
      'status.langChanged': 'Language: {lang}.',

      // floor materials (by id)
      'mat.deck': 'Deck',
      'mat.dark': 'Dark',
      'mat.light': 'Light',
      'mat.roundPad': 'Round pad',
      'mat.service': 'Service',
      'mat.catwalk': 'Catwalk',
      'mat.hull': 'Hull',
      'mat.glass': 'Glass',
      'mat.void': 'void (empty)',

      // wall shapes (by id)
      'wall.solid': 'Solid',
      'wall.diagA': 'Diag /',
      'wall.diagB': 'Diag \\',

      // objects (by id)
      'obj.console': 'Console',
      'obj.crate': 'Storage crate',
      'obj.light': 'Wall light',
      'obj.plant': 'Plant',
      'obj.elevator': 'Elevator pad',
      'obj.miner': 'Mining rig',
      'obj.pillar': 'Pillar',
      'obj.door': 'Door',
      'obj.airlock': 'Airlock',
      'obj.stairs': 'Stairs',
      'obj.ladder': 'Ladder',
      'obj.ramp': 'Ramp',

      // layers (by id)
      'layer.structural': 'Structural',
      'layer.decor': 'Decor',
      'layer.electrical': 'Electrical',
      'layer.traversal': 'Traversal',

      // inspector — field labels
      'insp.empty': 'Nothing selected. Click a tile or object.',
      'insp.room': 'Room',
      'insp.transform': 'Transform',
      'insp.localTile': 'Local tile',
      'insp.floor': 'Floor',
      'insp.wall': 'Wall',
      'insp.object': 'Object',
      'insp.type': 'Type',
      'insp.layer': 'Layer',
      'insp.flags': 'Flags',
      'insp.state': 'State',
      'insp.powerHeat': 'Power/Heat',
      'insp.movable': 'Movable',
      'insp.noMotion': 'No motion events.',
      'insp.mapHint': 'On the map: drag the white ▪ to move the room, the white ● to rotate it. Coloured handles aim each motion (orbit: orange = axis, yellow = radius).',
      // inspector — action buttons
      'insp.rotate45': 'Rotate 45°',
      'insp.duplicate': 'Duplicate',
      'insp.delete': 'Delete',
      'insp.open': 'Open',
      'insp.close': 'Close',
      'insp.test': 'Test ▶',
      'insp.flip': 'Flip ⟳⟲',
      'insp.addShift': '+ Shift',
      'insp.addRotate': '+ Rotate',
      'insp.addOrbit': '+ Orbit',
      'insp.addCarousel': '+ Carousel',
      // shared values
      'val.none': 'none',
      'val.interactive': 'interactive',
      'val.solid': 'solid',
      'val.open': 'open',
      'val.closed': 'closed'
    },

    es: {
      'app.title': 'UGS — Constructor de Estación',
      'app.brand': 'UGS · CONSTRUCTOR',
      'app.subtitle': 'Etapa 1 · revisada — constructor usable',

      'mode.build': 'Construir',
      'mode.play': 'Jugar',

      'tab.build': 'Construir',
      'tab.rooms': 'Salas',
      'tab.save': 'Guardar',

      'section.tools': 'Herramientas',

      'tool.select': 'Seleccionar',
      'tool.floor': 'Piso',
      'tool.wall': 'Pared',
      'tool.object': 'Objeto',
      'tool.entry': 'Entrada',
      'tool.erase': 'Borrar',
      'tool.fill': 'Rellenar',
      'tool.link': 'Enlace',

      'tool.select.hint': 'Haz clic en un tile, objeto, pared o sala para inspeccionar y editar.',
      'tool.floor.hint': 'Pinta tiles de piso con el material seleccionado.',
      'tool.wall.hint': 'Levanta paredes en los bordes con la forma y material elegidos.',
      'tool.object.hint': 'Coloca el objeto seleccionado. Algunos son interactivos al Jugar.',
      'tool.entry.hint': 'Fija el punto de aparición del pawn en el deck al Jugar.',
      'tool.erase.hint': 'Quita lo que esté encima del cursor (objeto, luego pared, luego piso).',
      'tool.fill.hint': 'Rellena el piso conectado con el material seleccionado.',
      'tool.link.hint': 'Conecta decks: clic en tile origen, cambia de deck, clic en el destino.',

      'filter.label': 'Filtro de selección',
      'filter.all': 'Todo',
      'filter.object': 'Solo objetos',
      'filter.wall': 'Solo paredes',
      'filter.floor': 'Solo pisos',

      'palette.floorMat': 'Material de piso',
      'palette.wallShape': 'Forma de pared',
      'palette.wallMat': 'Material de pared',
      'palette.objects': 'Objetos',

      'decks.title': 'Decks (niveles)',
      'decks.namePlaceholder': 'Nombre del deck',
      'decks.add': '+ Añadir deck',
      'decks.delete': 'Borrar deck',
      'decks.linkHint': 'Usa la herramienta Enlace para conectar decks: clic en un tile origen (p. ej. un ascensor), cambia de deck, clic en el destino. Al Jugar, haz clic en el enlace para viajar.',

      'layers.title': 'Capas',
      'room.duplicate': 'Duplicar sala',
      'motion.title': 'Movimiento de sala',
      'motion.hint': 'Selecciona una sala (herramienta Seleccionar) — sus eventos de movimiento aparecen en el Inspector. Añade Desplazar / Rotar / Orbitar / Carrusel, luego arrastra el tirador de color en el mapa para orientarlo. Pulsa Jugar para verlo.',

      'history.title': 'Historial',
      'action.undo': 'Deshacer',
      'action.redo': 'Rehacer',
      'package.title': 'Paquete',
      'action.export': 'Exportar',
      'action.import': 'Importar',
      'action.new': 'Nuevo',

      'inspector.title': 'Inspector',
      'inspector.empty': 'Nada seleccionado.',

      'play.title': 'JUGAR',
      'play.pause': '❚❚ Pausa',
      'play.resume': '▶ Reanudar',
      'play.hint': 'Clic en un tile de piso para caminar · en una puerta para abrir · en un ascensor para cambiar de deck · Espacio pausa · 1/2/3 velocidad',

      'lang.label': 'Idioma',
      'lang.en': 'English',
      'lang.es': 'Español',

      'status.loading': 'Cargando…',
      'status.newStation': 'Nueva estación — una sala vacía. Pinta pisos, levanta paredes, coloca objetos.',
      'status.emptyReady': 'Sala vacía lista. Pinta pisos y levanta paredes, o pulsa Jugar para mover el pawn.',
      'status.layerHidden': 'Capa {layer} oculta.',
      'status.layerShown': 'Capa {layer} visible.',
      'status.filter': 'Filtro de selección: {filter}.',
      'status.langChanged': 'Idioma: {lang}.',

      'mat.deck': 'Cubierta',
      'mat.dark': 'Oscuro',
      'mat.light': 'Claro',
      'mat.roundPad': 'Plataforma',
      'mat.service': 'Servicio',
      'mat.catwalk': 'Pasarela',
      'mat.hull': 'Casco',
      'mat.glass': 'Cristal',
      'mat.void': 'vacío',

      'wall.solid': 'Sólida',
      'wall.diagA': 'Diag /',
      'wall.diagB': 'Diag \\',

      'obj.console': 'Consola',
      'obj.crate': 'Caja de carga',
      'obj.light': 'Luz de pared',
      'obj.plant': 'Planta',
      'obj.elevator': 'Plataforma de ascensor',
      'obj.miner': 'Perforadora',
      'obj.pillar': 'Pilar',
      'obj.door': 'Puerta',
      'obj.airlock': 'Esclusa',
      'obj.stairs': 'Escaleras',
      'obj.ladder': 'Escalerilla',
      'obj.ramp': 'Rampa',

      'layer.structural': 'Estructural',
      'layer.decor': 'Decoración',
      'layer.electrical': 'Eléctrico',
      'layer.traversal': 'Tránsito',

      'insp.empty': 'Nada seleccionado. Haz clic en un tile u objeto.',
      'insp.room': 'Sala',
      'insp.transform': 'Transform',
      'insp.localTile': 'Tile local',
      'insp.floor': 'Piso',
      'insp.wall': 'Pared',
      'insp.object': 'Objeto',
      'insp.type': 'Tipo',
      'insp.layer': 'Capa',
      'insp.flags': 'Flags',
      'insp.state': 'Estado',
      'insp.powerHeat': 'Energía/Calor',
      'insp.movable': 'Movible',
      'insp.noMotion': 'Sin eventos de movimiento.',
      'insp.mapHint': 'En el mapa: arrastra el ▪ blanco para mover la sala, el ● blanco para rotarla. Los tiradores de color orientan cada movimiento (órbita: naranja = eje, amarillo = radio).',
      'insp.rotate45': 'Rotar 45°',
      'insp.duplicate': 'Duplicar',
      'insp.delete': 'Borrar',
      'insp.open': 'Abrir',
      'insp.close': 'Cerrar',
      'insp.test': 'Probar ▶',
      'insp.flip': 'Invertir ⟳⟲',
      'insp.addShift': '+ Desplazar',
      'insp.addRotate': '+ Rotar',
      'insp.addOrbit': '+ Orbitar',
      'insp.addCarousel': '+ Carrusel',
      'val.none': 'ninguno',
      'val.interactive': 'interactivo',
      'val.solid': 'sólido',
      'val.open': 'abierto',
      'val.closed': 'cerrado'
    }
  };

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  let current = FALLBACK;
  const listeners = new Set();
  const warned = new Set();

  function languages() { return Object.keys(DICTS); }
  function has(key, lang) { const d = DICTS[lang || current]; return !!(d && key in d); }
  function getLang() { return current; }

  // Interpolate {name} placeholders from params.
  function interp(str, params) {
    if (!params) return str;
    return str.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
  }

  /**
   * Translate a key. Falls back to English, then to a visible ⟦key⟧ marker.
   * @param {string} key
   * @param {object} [params] values for {placeholder} interpolation
   */
  function t(key, params) {
    let str = DICTS[current] && DICTS[current][key];
    if (str == null) str = DICTS[FALLBACK] && DICTS[FALLBACK][key];
    if (str == null) {
      if (!warned.has(key)) {
        warned.add(key);
        if (typeof console !== 'undefined') console.warn('[i18n] missing key:', key);
      }
      return '⟦' + key + '⟧';
    }
    return interp(str, params);
  }

  // Optional translate-or-default: for data-driven ids where a label already
  // exists (keeps palettes working even if a key was not added yet).
  function label(key, fallback) { return has(key) || has(key, FALLBACK) ? t(key) : fallback; }

  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function notify() { for (const fn of listeners) { try { fn(current); } catch (e) { /* isolate */ } }

  }

  function persist(lang) {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(STORE_KEY, lang); }
    catch (e) { /* private mode / disabled storage */ }
  }

  /**
   * Set the active language. Persists, re-applies DOM bindings, and notifies
   * subscribers so dynamic UI can re-render. No-op for unknown languages.
   */
  function setLang(lang, opts) {
    if (!DICTS[lang] || lang === current) { if (lang === current && !(opts && opts.force)) return current; }
    if (DICTS[lang]) current = lang;
    persist(current);
    if (typeof document !== 'undefined') apply(document);
    notify();
    return current;
  }

  // Resolve the initial language: stored choice → browser language → English.
  function resolveInitial() {
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem(STORE_KEY);
        if (saved && DICTS[saved]) return saved;
      }
    } catch (e) { /* ignore */ }
    try {
      if (typeof navigator !== 'undefined' && navigator.language) {
        const base = navigator.language.slice(0, 2).toLowerCase();
        if (DICTS[base]) return base;
      }
    } catch (e) { /* ignore */ }
    return FALLBACK;
  }

  // -------------------------------------------------------------------------
  // DOM binding (browser only). Elements opt in with data attributes:
  //   data-i18n="key"                → textContent = t(key)
  //   data-i18n-attr="placeholder:key;title:key2" → set those attributes
  //   data-i18n-html="key"           → innerHTML = t(key)   (trusted copy only)
  // -------------------------------------------------------------------------
  function apply(rootEl) {
    if (typeof document === 'undefined') return;
    const scope = rootEl || document;

    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    scope.querySelectorAll('[data-i18n-html]').forEach((el) => {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });
    scope.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      el.getAttribute('data-i18n-attr').split(';').forEach((pair) => {
        const idx = pair.indexOf(':');
        if (idx < 0) return;
        const attr = pair.slice(0, idx).trim();
        const key = pair.slice(idx + 1).trim();
        if (attr && key) el.setAttribute(attr, t(key));
      });
    });
    // keep <html lang> and document title honest
    if (scope === document) {
      if (document.documentElement) document.documentElement.setAttribute('lang', current);
      if (has('app.title') || has('app.title', FALLBACK)) document.title = t('app.title');
    }
  }

  // Initialise `current` from environment at load (safe in Node: returns 'en').
  current = resolveInitial();

  return {
    t, label, has, languages, getLang, setLang, subscribe, apply,
    resolveInitial, FALLBACK,
    // exposed for tests / advanced use
    _dicts: DICTS
  };
});
