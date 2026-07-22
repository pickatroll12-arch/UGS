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

      // top bar
      'topbar.deck': 'Deck',
      'topbar.menu': '☰ Menu',

      // main menu (R2-07)
      'menu.subtitle': 'Space-station builder',
      'menu.continue': 'Continue',
      'menu.new': 'New station',
      'menu.load': 'Load station…',
      'menu.dev': 'Dev mode',
      'menu.play': 'Play',
      'menu.options': 'Options',

      // app modes
      'mode.dev': 'Dev',
      'mode.game': 'Game',
      'mode.gamebuild': 'Build',
      'game.expand': 'Expand station',
      'game.menu': 'Menu',
      'gamebuild.done': 'Done',
      'status.enterDev': 'Dev mode — full toolbox. Build, then Play to test.',
      'status.enterGame': 'Game mode — you are aboard the station.',
      'status.enterGameBuild': 'Expand station — construction costs credits.',
      'status.noCredits': 'Not enough credits: need {need}, have {have}.',

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
      'tool.select.hint': 'Click selects an object (or the tile); double-click selects the whole room; Alt+click forces the tile under an object.',
      'tool.floor.hint': 'Paint floor tiles with the selected material.',
      'tool.wall.hint': 'Raise walls with the selected kind and material. Blocks fill the tile; diagonal/rounded pieces block only their closed side (pawns pass the open side). Press R to rotate the piece.',
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
      'links.title': 'Links',
      'links.empty': 'No links yet.',
      'links.delete': 'Delete link',
      'linkKind.elevator': 'Elevator',
      'linkKind.door': 'Door',
      'linkKind.hatch': 'Hatch',
      'linkKind.custom': 'Custom',
      'mode.preload': 'Preload',
      'mode.stream': 'Stream',
      'mode.hint': 'Preload = the linked deck stays loaded with this one. Stream = it loads on first visit.',
      'warn.brokenLink': 'This link points at a room or deck that no longer exists.',

      // rooms
      'rooms.title': 'Rooms',
      'rooms.namePlaceholder': 'Room name',
      'rooms.add': '+ Room',
      'rooms.duplicate': 'Duplicate',
      'rooms.delete': 'Delete',
      'rooms.empty': 'No rooms.',
      'rooms.shape': 'Shape',
      'shape.rect': 'Rectangle',
      'shape.corridor': 'Corridor',
      'shape.L': 'L',
      'shape.T': 'T',
      'shape.U': 'U',
      'confirm.shapeDrop': 'This shape removes {n} object(s) outside it. Continue?',
      'status.shapeApplied': 'Room shape: {shape}.',

      // layers / room
      'layers.title': 'Layers',
      'room.duplicate': 'Duplicate room',
      'motion.title': 'Room motion',
      'motionKind.shift': 'Shift',
      'motionKind.rotate': 'Rotate',
      'motionKind.orbit': 'Orbit',
      'motionKind.carousel': 'Carousel',
      'motionKind.script': 'Script',
      'trigger.manual': 'manual',
      'trigger.time': 'auto',
      'trigger.signal': 'signal',
      'warn.orbitCenter': 'Orbit needs a valid centre — drag the orange handle.',
      'warn.orbitRadius': 'Orbit radius must be greater than 0 — drag the yellow handle.',
      'warn.carouselPoses': 'Carousel needs at least two poses.',
      'warn.shiftTarget': 'Shift needs a target — drag the handle on the map.',
      'status.eventEnabled': 'Event "{name}" enabled.',
      'status.eventDisabled': 'Event "{name}" disabled.',
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
      'play.simRunning': '● Simulating',
      'play.pause': '❚❚ Pause',
      'play.resume': '▶ Resume',
      'play.hint': 'Click a floor tile to walk the pawn · a door to open it · an elevator to change deck · Space pause · 1/2/3 speed',

      // help overlay
      'help.open': 'Help',
      'help.title': 'Welcome to the Station Builder',
      'help.intro': 'Design a space station deck by deck, then press Play to walk it. Nothing is saved to a server — export a file to keep your work.',
      'help.modesTitle': 'Build & Play',
      'help.modes': 'Use the top-right switch. Build edits the station; Play runs the live simulation (the pawn walks, doors open, rooms move). Editing is locked while simulating.',
      'help.toolsTitle': 'Tools',
      'help.tools': 'Pick a tool on the left rail, or press its number key 1–8. The bottom bar shows that tool\'s palette (floor material, wall shape, objects) and a one-line hint. Press R to rotate the selected object or the object brush.',
      'help.roomsTitle': 'Rooms & decks',
      'help.rooms': 'A deck holds one or more rooms. Select a room to rename, resize, move, rotate, or give it motion. Link decks with the Link tool to travel between them in Play.',
      'help.saveTitle': 'Saving',
      'help.save': 'Export packages the whole station to a JSON file; Import loads one back. New starts an empty room.',
      'help.gotit': 'Got it',

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
      'status.tool': '{tool} tool.',
      'status.buildMode': 'Build mode.',
      'status.playMode': 'Play mode — sim running. Space to pause, 1/2/3 speed.',
      'status.editInBuild': 'Switch to Build to edit.',

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

      // wall shapes (legacy) + kinds (R2-06)
      'wall.solid': 'Solid',
      'wall.diagA': 'Diag /',
      'wall.diagB': 'Diag \\',
      'wall.block': 'Block',
      'wall.diagonal': 'Diagonal',
      'wall.rounded': 'Rounded',

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
      'insp.kind.room': 'Room selected',
      'insp.kind.tile': 'Tile selected',
      'insp.kind.object': 'Object selected',
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
      'insp.mapHint': 'On the map: drag the white ▪ to move the room, the white ● to rotate it (45° steps). Coloured handles aim each motion (orbit: orange = axis, yellow = radius).',
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
      // inspector — room resize
      'insp.size': 'Size',
      'insp.applySize': 'Resize',
      'insp.anchor': 'Anchor',
      'anchor.nw': 'Top-left',
      'anchor.center': 'Center',
      'anchor.se': 'Bottom-right',
      'confirm.dropObjects': 'Shrinking removes {n} object(s) that fall outside the new size. Continue?',
      'confirm.resizeLoss': 'Resizing removes {objects} object(s), {tiles} floor tile(s) and {walls} wall(s). Continue?',
      'status.resized': 'Room resized to {w}×{h}.',
      'status.resizeTrimmed': '{tiles} tile(s) and {walls} wall(s) were trimmed.',
      'status.droppedN': '{n} object(s) removed.',
      'status.resizeCancelled': 'Resize cancelled.',
      'status.sizeUnchanged': 'Size unchanged.',
      'status.roomAdded': 'Room "{name}" added.',
      'status.roomDeleted': 'Room "{name}" deleted.',
      'status.roomRenamed': 'Room renamed to "{name}".',
      'status.cantDeleteLastRoom': 'A deck needs at least one room.',
      'status.linkDeleted': 'Link deleted.',
      'status.linkModeChanged': 'Link set to {mode}.',
      'status.linkSelected': '{kind}: {from} → {to} · {mode}',
      'status.nothingUndo': 'Nothing to undo.',
      'status.nothingRedo': 'Nothing to redo.',
      'status.placeOnRoom': 'Place on a room tile.',
      'status.objectNeedsFloor': 'Object needs an empty floor tile.',
      'status.tileHasObject': 'Tile already has an object.',
      'status.objectPlaced': '{name} placed.',
      'status.entryWalkable': 'Entry must be a walkable tile.',
      'status.entrySet': 'Entry set to {x},{y}.',
      'status.deckAdded': 'Added {name}.',
      'status.cantDeleteLastDeck': 'Cannot delete the last deck.',
      'status.deckDeleted': 'Deck deleted.',
      'status.linkStart': 'Link: click a source tile (e.g. an elevator). Then switch deck and click the spawn.',
      'status.linkSource': 'Source set on {deck} @{x},{y}. Switch to the target deck and click the spawn.',
      'status.linkPickOther': 'Pick a spawn on a different deck (or another tile).',
      'status.linked': 'Linked {from} → {to} ({mode}).',
      'status.traveled': '{kind} → {deck} · {mode}',
      'status.objectOpened': '{name} opened.',
      'status.objectClosed': '{name} closed.',
      'status.pawnNoCrossRoom': "The pawn can't path to another room yet — use a link.",
      'status.pawnMoving': 'Moving to {x},{y}.',
      'status.noPath': 'No path there.',
      'status.objectDeleted': 'Object deleted.',
      'status.alreadyFloor': 'Already that floor.',
      'status.filled': 'Filled {n} tiles.',
      'status.noFreeTile': 'No free tile to duplicate into.',
      'status.objectDuplicated': '{name} duplicated.',
      'status.roomDuplicated': 'Room "{name}" duplicated.',
      'status.eventAdded': 'Added {kind} event. Drag the handle to aim it, hit Play to see it.',
      'status.eventTesting': 'Testing "{name}".',
      'status.exported': 'Exported {file}.',
      'status.exportFailed': 'Export failed: {err}',
      'status.imported': 'Imported "{name}".',
      'status.importedWarnings': 'Imported "{name}" ({n} warnings).',
      'status.importFailed': 'Import failed: {err}',
      'status.loaded': 'Loaded.',
      'status.brushRotated': 'Object brush angle: {deg}°.',
      'status.wallRotated': 'Wall orientation: {deg}°.',
      'status.projection': 'View: {name}.',
      'proj.isoTilted': 'Isometric (tilted)',
      'proj.isoFlat': 'Isometric (flat)',
      'confirm.deleteRoom': 'Delete room "{name}" and everything in it? This also removes any links attached to it.',
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

      'topbar.deck': 'Deck',
      'topbar.menu': '☰ Menú',

      'menu.subtitle': 'Constructor de estación espacial',
      'menu.continue': 'Continuar',
      'menu.new': 'Nueva estación',
      'menu.load': 'Cargar estación…',
      'menu.dev': 'Modo Dev',
      'menu.play': 'Jugar',
      'menu.options': 'Opciones',

      'mode.dev': 'Dev',
      'mode.game': 'Juego',
      'mode.gamebuild': 'Construir',
      'game.expand': 'Expandir estación',
      'game.menu': 'Menú',
      'gamebuild.done': 'Listo',
      'status.enterDev': 'Modo Dev — caja de herramientas completa. Construye y pulsa Jugar para probar.',
      'status.enterGame': 'Modo Juego — estás a bordo de la estación.',
      'status.enterGameBuild': 'Expandir estación — construir cuesta créditos.',
      'status.noCredits': 'Créditos insuficientes: necesitas {need}, tienes {have}.',

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

      'tool.select.hint': 'Clic selecciona un objeto (o el tile); doble-clic selecciona toda la sala; Alt+clic fuerza el tile bajo un objeto.',
      'tool.floor.hint': 'Pinta tiles de piso con el material seleccionado.',
      'tool.wall.hint': 'Levanta paredes con el tipo y material elegidos. El bloque llena el tile; diagonal/redondeada bloquean solo su lado cerrado (el pawn pasa por el lado abierto). Pulsa R para rotar la pieza.',
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
      'links.title': 'Enlaces',
      'links.empty': 'Sin enlaces.',
      'links.delete': 'Borrar enlace',
      'linkKind.elevator': 'Ascensor',
      'linkKind.door': 'Puerta',
      'linkKind.hatch': 'Escotilla',
      'linkKind.custom': 'Personalizado',
      'mode.preload': 'Precargar',
      'mode.stream': 'Streaming',
      'mode.hint': 'Precargar = el deck enlazado se mantiene cargado con este. Streaming = se carga en la primera visita.',
      'warn.brokenLink': 'Este enlace apunta a una sala o deck que ya no existe.',

      'rooms.title': 'Salas',
      'rooms.namePlaceholder': 'Nombre de sala',
      'rooms.add': '+ Sala',
      'rooms.duplicate': 'Duplicar',
      'rooms.delete': 'Borrar',
      'rooms.empty': 'Sin salas.',
      'rooms.shape': 'Forma',
      'shape.rect': 'Rectángulo',
      'shape.corridor': 'Pasillo',
      'shape.L': 'L',
      'shape.T': 'T',
      'shape.U': 'U',
      'confirm.shapeDrop': 'Esta forma elimina {n} objeto(s) fuera de ella. ¿Continuar?',
      'status.shapeApplied': 'Forma de sala: {shape}.',

      'layers.title': 'Capas',
      'room.duplicate': 'Duplicar sala',
      'motion.title': 'Movimiento de sala',
      'motionKind.shift': 'Desplazar',
      'motionKind.rotate': 'Rotar',
      'motionKind.orbit': 'Orbitar',
      'motionKind.carousel': 'Carrusel',
      'motionKind.script': 'Script',
      'trigger.manual': 'manual',
      'trigger.time': 'auto',
      'trigger.signal': 'señal',
      'warn.orbitCenter': 'La órbita necesita un centro válido — arrastra el tirador naranja.',
      'warn.orbitRadius': 'El radio de órbita debe ser mayor que 0 — arrastra el tirador amarillo.',
      'warn.carouselPoses': 'El carrusel necesita al menos dos poses.',
      'warn.shiftTarget': 'Desplazar necesita un destino — arrastra el tirador en el mapa.',
      'status.eventEnabled': 'Evento "{name}" activado.',
      'status.eventDisabled': 'Evento "{name}" desactivado.',
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
      'play.simRunning': '● Simulando',
      'play.pause': '❚❚ Pausa',
      'play.resume': '▶ Reanudar',
      'play.hint': 'Clic en un tile de piso para caminar · en una puerta para abrir · en un ascensor para cambiar de deck · Espacio pausa · 1/2/3 velocidad',

      'help.open': 'Ayuda',
      'help.title': 'Bienvenido al Constructor de Estación',
      'help.intro': 'Diseña una estación deck por deck y pulsa Jugar para recorrerla. Nada se guarda en un servidor — exporta un archivo para conservar tu trabajo.',
      'help.modesTitle': 'Construir y Jugar',
      'help.modes': 'Usa el interruptor arriba a la derecha. Construir edita la estación; Jugar corre la simulación en vivo (el pawn camina, las puertas abren, las salas se mueven). La edición se bloquea al simular.',
      'help.toolsTitle': 'Herramientas',
      'help.tools': 'Elige una herramienta en la barra izquierda, o pulsa su tecla 1–8. La barra inferior muestra su paleta (material de piso, forma de pared, objetos) y una pista de una línea. Pulsa R para rotar el objeto seleccionado o el brush de objeto.',
      'help.roomsTitle': 'Salas y decks',
      'help.rooms': 'Un deck contiene una o más salas. Selecciona una sala para renombrar, redimensionar, mover, rotar o darle movimiento. Conecta decks con la herramienta Enlace para viajar entre ellos al Jugar.',
      'help.saveTitle': 'Guardar',
      'help.save': 'Exportar empaqueta toda la estación en un archivo JSON; Importar la carga de vuelta. Nuevo inicia una sala vacía.',
      'help.gotit': 'Entendido',

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
      'status.tool': 'Herramienta {tool}.',
      'status.buildMode': 'Modo construir.',
      'status.playMode': 'Modo jugar — simulación activa. Espacio para pausar, 1/2/3 velocidad.',
      'status.editInBuild': 'Cambia a Construir para editar.',

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
      'wall.block': 'Bloque',
      'wall.diagonal': 'Diagonal',
      'wall.rounded': 'Redondeada',

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
      'insp.kind.room': 'Sala seleccionada',
      'insp.kind.tile': 'Tile seleccionado',
      'insp.kind.object': 'Objeto seleccionado',
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
      'insp.mapHint': 'En el mapa: arrastra el ▪ blanco para mover la sala, el ● blanco para rotarla (pasos de 45°). Los tiradores de color orientan cada movimiento (órbita: naranja = eje, amarillo = radio).',
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
      'insp.size': 'Tamaño',
      'insp.applySize': 'Redimensionar',
      'insp.anchor': 'Anclaje',
      'anchor.nw': 'Sup-izq',
      'anchor.center': 'Centro',
      'anchor.se': 'Inf-der',
      'confirm.dropObjects': 'Encoger elimina {n} objeto(s) que quedan fuera del nuevo tamaño. ¿Continuar?',
      'confirm.resizeLoss': 'Redimensionar elimina {objects} objeto(s), {tiles} tile(s) de piso y {walls} pared(es). ¿Continuar?',
      'status.resized': 'Sala redimensionada a {w}×{h}.',
      'status.resizeTrimmed': '{tiles} tile(s) y {walls} pared(es) recortados.',
      'status.droppedN': '{n} objeto(s) eliminados.',
      'status.resizeCancelled': 'Redimensión cancelada.',
      'status.sizeUnchanged': 'Tamaño sin cambios.',
      'status.roomAdded': 'Sala "{name}" añadida.',
      'status.roomDeleted': 'Sala "{name}" borrada.',
      'status.roomRenamed': 'Sala renombrada a "{name}".',
      'status.cantDeleteLastRoom': 'Un deck necesita al menos una sala.',
      'status.linkDeleted': 'Enlace borrado.',
      'status.linkModeChanged': 'Enlace en modo {mode}.',
      'status.linkSelected': '{kind}: {from} → {to} · {mode}',
      'status.nothingUndo': 'Nada que deshacer.',
      'status.nothingRedo': 'Nada que rehacer.',
      'status.placeOnRoom': 'Coloca sobre un tile de sala.',
      'status.objectNeedsFloor': 'El objeto necesita un tile de piso vacío.',
      'status.tileHasObject': 'El tile ya tiene un objeto.',
      'status.objectPlaced': '{name} colocado.',
      'status.entryWalkable': 'La entrada debe ser un tile transitable.',
      'status.entrySet': 'Entrada fijada en {x},{y}.',
      'status.deckAdded': '{name} añadido.',
      'status.cantDeleteLastDeck': 'No se puede borrar el último deck.',
      'status.deckDeleted': 'Deck borrado.',
      'status.linkStart': 'Enlace: clic en un tile origen (p. ej. un ascensor). Luego cambia de deck y clic en el destino.',
      'status.linkSource': 'Origen fijado en {deck} @{x},{y}. Cambia al deck destino y clic en el spawn.',
      'status.linkPickOther': 'Elige un destino en otro deck (u otro tile).',
      'status.linked': 'Enlazado {from} → {to} ({mode}).',
      'status.traveled': '{kind} → {deck} · {mode}',
      'status.objectOpened': '{name} abierto.',
      'status.objectClosed': '{name} cerrado.',
      'status.pawnNoCrossRoom': 'El pawn aún no puede ir a otra sala — usa un enlace.',
      'status.pawnMoving': 'Yendo a {x},{y}.',
      'status.noPath': 'No hay ruta.',
      'status.objectDeleted': 'Objeto borrado.',
      'status.alreadyFloor': 'Ya es ese piso.',
      'status.filled': '{n} tiles rellenados.',
      'status.noFreeTile': 'No hay tile libre para duplicar.',
      'status.objectDuplicated': '{name} duplicado.',
      'status.roomDuplicated': 'Sala "{name}" duplicada.',
      'status.eventAdded': 'Evento {kind} añadido. Arrastra el tirador para orientarlo, pulsa Jugar para verlo.',
      'status.eventTesting': 'Probando "{name}".',
      'status.exported': 'Exportado {file}.',
      'status.exportFailed': 'Exportación fallida: {err}',
      'status.imported': 'Importado "{name}".',
      'status.importedWarnings': 'Importado "{name}" ({n} avisos).',
      'status.importFailed': 'Importación fallida: {err}',
      'status.loaded': 'Cargado.',
      'status.brushRotated': 'Ángulo del brush de objeto: {deg}°.',
      'status.wallRotated': 'Orientación de pared: {deg}°.',
      'status.projection': 'Vista: {name}.',
      'proj.isoTilted': 'Isométrica (inclinada)',
      'proj.isoFlat': 'Isométrica (plana)',
      'confirm.deleteRoom': '¿Borrar la sala "{name}" y todo lo que contiene? También elimina los enlaces asociados.',
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
