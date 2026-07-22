# UGS — Segunda Revisión de Stage 1

> Documento de dirección para la siguiente iteración.
>
> Conclusión del owner y feedback humano: **UGS todavía no debe avanzar a Stage 2**.
> Antes de crew, NPCs autónomos, economía avanzada o A-life, hay que corregir
> errores estructurales y convertir el editor/runtime en una base realmente usable.

Esta revisión amplía `CURRENT_OBJECTIVE.md` y responde al QA posterior a la
primera revisión. No reemplaza la arquitectura principal: room-local data,
deterministic simulation, renderer separado, save versionado y sistemas
plugables deben mantenerse.

---

## 1. Estado actual

Stage 1 demostró que el motor puede funcionar:

- Editor isométrico
- Rooms rectangulares
- Decks múltiples
- Links entre decks
- Pawn de prueba
- Pathfinding
- Eventos de movimiento de rooms
- Import/export JSON
- UI rediseñada
- i18n parcial
- 118 pruebas unitarias pasando

Pero el QA encontró que todavía hay errores importantes de motor, UI y datos.
Además, el feedback humano confirma que el editor todavía no es lo bastante
intuitivo ni flexible para sostener Stage 2.

**Decisión:** Stage 2 queda bloqueada hasta completar esta segunda revisión.

---

# 2. Gate obligatorio: errores a solucionar primero

Estos errores tienen prioridad sobre cualquier mejora visual o nueva feature.

---

## BUG-01 — Los eventos de sala mueren al cambiar de deck

**Severidad:** crítica  
**Archivo principal:** `src/engine.js`

### Síntoma

Después de viajar por un ascensor/link:

- La sala orbitatoria del nuevo deck no orbita.
- Al volver al deck inicial, su evento `shift` tampoco se mueve.
- El pawn sigue funcionando.
- Pausa y velocidad siguen afectando al pawn.
- `engineRunning = true`, pero `activeCount = 0`.

### Diagnóstico

El cambio de deck ocurre dentro de `engine.update(oldLevel)`.

Secuencia:

1. `frame()` captura el level viejo.
2. El pawn llega al link.
3. `onPawnArrived()` cambia `activeLevelId`.
4. `engine.start(newLevel)` crea runtimes para el nuevo deck.
5. El `engine.update(oldLevel)` original continúa ejecutándose.
6. No encuentra las rooms nuevas en el level viejo.
7. Ejecuta `runs.delete(id)`.
8. Los eventos del nuevo level mueren en el mismo tick.

### Corrección mínima

No eliminar runtimes desconocidos desde un update de otro level.

### Corrección estructural recomendada

Hacer los runtimes level-aware:

```text
levelId + roomId → runtime
```

o diferir `engine.start(newLevel)` hasta terminar el tick actual.

### Regression test obligatorio

```text
engine.start(levelB) llamado durante engine.update(levelA)
→ no debe eliminar los eventos de levelB
→ levelB debe moverse en el siguiente tick
```

---

## BUG-02 — Cambiar de deck durante Play deja al pawn atrás

**Severidad:** alta  
**Archivo principal:** `src/editor.js`

### Síntoma

Si el usuario cambia de deck con el selector superior durante Play:

- El deck activo cambia.
- El pawn permanece en el deck anterior.
- El usuario queda mirando un deck sin pawn controlable.

### Corrección recomendada para Stage 1

Desactivar el selector de deck durante Play.

Los cambios de deck durante Play deben ocurrir solamente por:

- Ascensores
- Escaleras
- Links
- Eventos futuros del juego

Más adelante puede existir un modo espectador, pero debe ser explícito.

---

## BUG-03 — Lista de links no se actualiza al borrar una room enlazada

**Severidad:** media  
**Archivo principal:** `src/editor.js`

### Síntoma

Al borrar una room que participa en un link:

- `save.links` queda correctamente en `0`.
- La lista visual de links sigue mostrando el link eliminado.

### Corrección

Después de borrar una room:

```js
refreshLinkList();
app.selectedLinkId = null;
```

Revisar también cualquier otra operación que elimine rooms, decks o endpoints.

---

## BUG-04 — Resize destructivo no advierte pérdida de tiles/paredes

**Severidad:** media  
**Archivos:** `src/data.js`, `src/editor.js`

### Síntoma

Al reducir una room, los tiles/paredes del borde pueden desaparecer sin
confirmación ni advertencia.

`resizeRoom()` ya devuelve warnings, pero el editor no los muestra.

### Corrección

Antes de aplicar shrink:

- Calcular tiles, paredes y objetos que se perderán.
- Mostrar confirmación o advertencia.
- Después del resize, mostrar el resultado:

```text
Room resized to 10×8. 14 tiles and 8 walls were trimmed.
```

Debe estar localizado.

---

## BUG-05 — Mensajes dinámicos todavía no están en español

**Severidad:** media  
**Archivos:** `src/editor.js`, `src/i18n.js`

### Síntoma

La interfaz principal cambia a español, pero muchos mensajes dinámicos siguen
en inglés:

```text
Nothing to undo.
Nothing to redo.
Place on a room tile.
Object needs an empty floor tile.
Tile already has an object.
Entry must be a walkable tile.
Cannot delete the last deck.
No path there.
Import failed: ...
Export failed: ...
```

### Corrección

Mover todos los `setStatus()` a claves de i18n.

Añadir una prueba que falle si aparece un nuevo mensaje hardcodeado:

```js
setStatus('raw text')
```

---

## BUG-06 — No existe smoke test reproducible del navegador

**Severidad:** media/baja

Los commits dicen “headless verified”, pero el repo no contiene una prueba de
navegador repetible.

### Corrección

Añadir un comando como:

```bash
npm run smoke
```

Debe cubrir como mínimo:

- Overlay inicial
- Cambio de idioma
- Resize
- Play/Build guard
- Link/deck transition
- Console errors

---

# 3. Segunda revisión — nuevas direcciones del owner

Las siguientes mejoras forman parte de Stage 1/core. No son Stage 2.

---

# R2-01 — Hotkeys y cursores por herramienta

## Objetivo

Hacer el editor más rápido y legible sin depender de clics repetidos en la
toolbox.

## Hotkeys propuestos

| Tecla | Herramienta |
|---|---|
| `1` | Select |
| `2` | Erase |
| `3` | Floor |
| `4` | Wall |
| `5` | Object |
| `6` | Entry |
| `7` | Fill |
| `8` | Link |
| `R` | Rotar orientación del brush/pieza |
| `Q` / `E` | Cambiar orientación o proyección de cámara |
| `Esc` | Cancelar selección/acción |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |

## Cursor contextual

El cursor debe cambiar según herramienta:

- Select: cursor normal/pointer
- Erase: cursor de borrado
- Floor: cursor de pincel/piso
- Wall: cursor de muro
- Object: cursor de colocación
- Entry: cursor de punto de entrada
- Fill: cursor de relleno
- Link: cursor de conexión

## Notas de implementación

- No usar solo cambios de color.
- El cursor debe seguir funcionando sobre canvas.
- Los hotkeys deben ignorarse cuando el usuario escribe en inputs.
- Las teclas deben aparecer en tooltips y ayuda.

---

# R2-02 — Separar selección de objeto y selección de room

## Problema actual

El selector actual mezcla demasiadas cosas: tile, object y room.

## Propuesta

- **Click simple:** seleccionar object si existe.
- **Doble click:** seleccionar room.
- **Click simple en tile vacío:** seleccionar tile o limpiar selección.
- **Alt + click:** forzar selección de tile aunque haya object encima.

## Comportamiento esperado

### Click simple

Prioridad:

```text
object > tile/empty
```

### Doble click

Selecciona la room completa y muestra:

- Nombre
- Bounds
- Resize handles
- Eventos
- Links relacionados
- Acciones de room

## Riesgo

Doble click puede entrar en conflicto con pintura rápida si se implementa mal.
Solo debe aplicar a la herramienta Select.

---

# R2-03 — Rotación/proyección de cámara con Q y E

## Propuesta

Permitir cambiar la perspectiva de cámara usando `Q` y `E`.

## Decisión pendiente del owner

Hay dos interpretaciones distintas:

### Opción A — Cambiar proyección

Alternar entre:

- Vista isométrica inclinada actual
- Vista isométrica/top-down más directa, similar a RimWorld/Factorio

Esto cambia la proyección visual y el picking.

### Opción B — Rotar orientación del mapa

Rotar la vista en pasos de 90°:

```text
NW → NE → SE → SW
```

Esto mantiene la proyección, pero cambia la orientación de rooms, paredes y
objetos en pantalla.

## Recomendación técnica

Implementar primero **proyección como configuración de cámara**, separada del
mapa:

```js
camera = {
  x,
  y,
  zoom,
  projection: 'isoTilted' | 'isoFlat',
  orientation: 0 | 90 | 180 | 270
}
```

Después decidir si `Q/E` cambia proyección, orientación, o ambos en modos
distintos.

## Riesgo

No es solo visual. También afecta:

- `worldToScreen`
- `screenToWorld`
- Picking
- Wall/object art
- Orden de dibujo
- Selección de tiles
- Handles de rooms

Debe hacerse antes o durante el rediseño de rooms libres, no después.

---

# R2-04 — Resize de rooms mediante handles

## Problema actual

Solo se puede cambiar tamaño escribiendo valores numéricos.

## Propuesta

Añadir handles visuales:

- Norte
- Sur
- Este
- Oeste
- Esquinas

## Comportamiento

- Arrastrar un handle muestra ghost bounds.
- Soltar aplica resize.
- El preview muestra:
  - Nuevo tamaño
  - Tiles preservados
  - Tiles que se perderán
  - Objects que serían eliminados
  - Links afectados
- `Esc` cancela antes de soltar.
- Undo restaura el estado anterior.

## Reglas

- Tamaño mínimo configurable.
- Snap a tile por defecto.
- No permitir shrink destructivo sin confirmación.
- Los handles deben respetar la proyección de cámara activa.

## Relación con rooms libres

Los handles rectangulares deben seguir funcionando para rooms rectangulares.
Cuando existan rooms libres:

- Rectangular: handles cambian bounds.
- Freeform: el usuario agrega/quita celdas con brush.

---

# R2-05 — Replantear rooms como formas libres

## Problema actual

Cada room es un rectángulo cerrado:

```text
Room
├─ size.w
├─ size.h
└─ tiles[y][x]
```

Eso impide hacer:

- Pasillos entre rooms
- Rooms en L
- Rooms radiales
- Rooms triangulares
- Corredores orgánicos
- Construcción estilo The Sims

## Objetivo

Permitir que una room sea una forma arbitraria compuesta por celdas de grid.

## Modelo recomendado

Migrar de una matriz rectangular obligatoria a un modelo basado en celdas:

```text
Room
├─ id
├─ name
├─ transform
├─ bounds
├─ cells
│  ├─ "0,0"
│  ├─ "1,0"
│  ├─ "2,0"
│  └─ ...
├─ tilesByCell
├─ objects
├─ events
└─ metadata
```

Una room rectangular actual sería simplemente una colección completa de celdas.

## Presets iniciales

- Rectangular
- Pasillo recto
- L
- T
- U
- Radial/circular aproximada
- Triangular aproximada

## Herramientas

- Brush para agregar celdas a una room
- Brush para quitar celdas
- Selección de preset
- Flood fill de room shape
- Convertir selección de tiles a room

## Conexión entre rooms

Los pasillos no deberían requerir “fusionar” rooms. Mejor:

```text
Room A
→ opening/door/shared edge
→ Corridor room
→ opening/door/shared edge
→ Room B
```

Las puertas funcionales deben ser openings u objects colocados sobre bordes,
no una propiedad mágica de una room entera.

## Impacto

Este cambio afecta a:

- Save format
- Migraciones
- Renderer
- Picking
- Pathfinding
- Resize
- Room events
- Links
- Room outlines
- Duplicate/delete
- Tests

Por eso debe tratarse como un milestone grande, no como un ajuste visual.

## Migración recomendada

Crear save version siguiente:

- Rooms antiguas rectangulares se convierten automáticamente a `cells`.
- Mantener compatibilidad de importación.
- Exportar solo el nuevo formato después de migrar.

---

# R2-06 — Paredes diagonales y cornisas

## Problema actual

`diagA` y `diagB` son visuales, pero bloquean todo el tile.

## Propuesta del owner

Tipos de muralla:

- Bloque completo
- Cornisa diagonal
- Cornisa redondeada

Y con `R` cambiar orientación.

## Modelo recomendado

La pared debe dejar de ser solo un string:

```js
wall: "diagA"
```

y pasar a ser una pieza:

```js
wall: {
  kind: 'block' | 'diagonal' | 'rounded',
  orientation: 0 | 45 | 90 | 135 | 180 | 225 | 270 | 315,
  collision: 'full' | 'partial',
  material: 'wall'
}
```

## Fases

### Fase 1 — Orientación y visual

- `R` rota el brush de pared.
- Diagonal tiene orientaciones.
- Rounded tiene orientaciones.
- Collision sigue siendo full-tile temporalmente.

### Fase 2 — Collision parcial

- Diagonal/rounded ocupan solo parte del tile.
- Nav permite pasar por el lado abierto.
- Corners no permiten corte ilegal.

### Fase 3 — Geometría avanzada

- Paredes por edge en vez de por tile.
- Curvas reales o segmentadas.
- Integración con rooms libres.

## Advertencia

No implementar collision parcial antes de que el nav pueda representarla.
Si se hace visual primero, la UI debe indicar:

> “Diagonal walls currently block the full tile.”

---

# R2-07 — Separar Modo Dev, Modo Prueba y Modo Juego

## Problema actual

Build/Play son útiles, pero todavía representan un modo híbrido de desarrollo.

## Nueva estructura propuesta

### 1. Main Menu

Pantalla inicial con:

- Continuar
- Nueva estación
- Cargar estación
- Modo Dev
- Jugar
- Opciones
- Idioma

### 2. Modo Dev

Para desarrolladores/modders.

Incluye:

- Toolbox completa
- Crear/editar decks
- Crear/editar rooms
- Import/export
- Eventos
- Links
- Dev Test con pawn
- Sin costes

Dentro de Modo Dev:

```text
Dev Edit  → construir libremente
Dev Test  → probar con pawn sin cambiar el diseño
```

### 3. Modo Juego

Para el jugador normal.

No muestra la toolbox de Dev por defecto.

El jugador interactúa con la estación desde la perspectiva del juego.

### 4. Expandir estación dentro del Modo Juego

Un botón como:

```text
[Expandir estación]
```

cambia a una suite de construcción de jugador, no a Dev completo.

En ese modo:

- Construir tiles cuesta créditos
- Colocar objects cuesta créditos
- Crear rooms cuesta créditos
- Expandir rooms cuesta créditos
- Crear decks cuesta créditos
- Algunas herramientas pueden estar bloqueadas por progreso futuro

## Diferencia importante

```text
Dev Edit  ≠ Game Build
Dev Test  ≠ Game Runtime
```

No deben compartir permisos ni costes.

---

# R2-08 — Créditos y costes de construcción

## Objetivo

Convertir construcción en mecánica de juego, no solo herramienta de editor.

## Datos necesarios

```text
save.resources.credits
save.buildCosts
```

## Costes iniciales sugeridos

| Acción | Coste sugerido |
|---|---:|
| Pintar floor tile | 1 |
| Cambiar floor material | 1 |
| Colocar wall | 2 |
| Colocar object básico | 5 |
| Colocar door/elevator | 10 |
| Expandir room por tile | 1 |
| Crear room pequeña | 20 |
| Crear deck nuevo | 100 |

Los valores reales deben definirse después junto con la economía.

## Reglas

- Modo Dev no cobra.
- Modo Juego sí cobra.
- Si no hay créditos suficientes:
  - Mostrar coste faltante.
  - No aplicar la acción.
- Undo no debería devolver créditos automáticamente sin una regla clara.
- Deconstruct puede devolver un porcentaje futuro.

## Advertencia

Esto todavía no es economía Stage 2. Es solo el sistema base de costes para
construcción de jugador.

---

# R2-09 — Interfaz sci-fi ligera

## Objetivo

Mejorar identidad visual sin sacrificar legibilidad.

## Recomendación

No hacer un skin complejo todavía. Aplicar una capa visual controlada:

- Paleta sci-fi oscura
- Paneles con bordes luminosos sutiles
- Estados activos más claros
- Mejor jerarquía tipográfica
- Iconos simples para herramientas
- Indicadores de modo Dev/Test/Game
- Animaciones breves de paneles, no excesivas

## No hacer todavía

- Fondos animados pesados
- Efectos que reduzcan contraste
- Iconos sin texto
- UI excesivamente decorada
- Cambios que rompan Spanish/English layout

---

# 4. Orden recomendado de implementación

## Fase 0 — Bugfix gate

1. BUG-01 motor de eventos al cambiar deck
2. BUG-02 selector de deck durante Play
3. BUG-03 lista de links obsoleta
4. BUG-04 warnings de resize
5. BUG-05 i18n dinámico
6. BUG-06 smoke test de navegador

**Nada más debería empezar antes de esto.**

---

## Fase 1 — App shell y modos

1. Main Menu
2. Separar:
   - MainMenu
   - DevEdit
   - DevTest
   - GameRuntime
   - GameBuild
3. Guardar/exportar desde los modos correctos
4. i18n para todos los modos

Motivo: si esto se hace tarde, habrá que rehacer la toolbox y los permisos.

---

## Fase 2 — Input model

1. Hotkeys
2. Cursor contextual
3. Click simple para object
4. Doble click para room
5. Alt+click para tile
6. Ayuda actualizada

---

## Fase 3 — Resize handles

1. Handles N/S/E/O
2. Ghost preview
3. Warnings
4. Undo
5. Tests de navegador

---

## Fase 4 — Paredes orientadas

1. Modelo `wall.kind + orientation`
2. `R` para rotar brush
3. Diagonal/rounded visuals
4. Save migration
5. Collision parcial queda para después

---

## Fase 5 — Cámara/proyección

1. Separar proyección y orientación en camera state
2. Q/E
3. Picking por proyección
4. Render order por proyección
5. Tests de coordinate conversion

---

## Fase 6 — Rooms libres

1. Diseñar modelo `cells`
2. Migración de saves
3. Renderer por celdas
4. Picking por celdas
5. Nav por celdas
6. Presets
7. Corredores y openings
8. Tests extensivos

Este es el milestone más grande de la segunda revisión.

---

## Fase 7 — Game Build con créditos

1. `resources.credits`
2. Costes por acción
3. UI de coste
4. Permisos por modo
5. Reglas de insuficiencia de créditos

---

## Fase 8 — Sci-fi UI pass

Después de estabilizar comportamiento:

1. Tema sci-fi
2. Iconos
3. Estados activos
4. Animaciones ligeras
5. QA visual English/Spanish

---

# 5. Riesgos principales

## 5.1 Rooms libres puede romper la arquitectura actual si se hace como parche

No debe implementarse agregando excepciones a `tiles[y][x]`.

Debe hacerse como migración de modelo:

```text
rectangular matrix → cell set
```

con tests y migración.

---

## 5.2 Cámara y freeform rooms están acoplados

La proyección, picking y room outlines deben funcionar antes de hacer formas
complejas. Si se cambian ambos al mismo tiempo sin tests, será difícil saber
qué se rompió.

---

## 5.3 Paredes parciales requieren nav nuevo

No prometer collision parcial hasta que el nav pueda representarla.

---

## 5.4 Modo Juego no debe ser una skin sobre Dev

GameBuild necesita permisos y costes diferentes. Compartir demasiado estado con
Dev haría que el jugador pudiera hacer acciones de desarrollador por accidente.

---

## 5.5 i18n debe ir primero que el nuevo UI copy

Si se diseña la interfaz sci-fi antes de terminar i18n, habrá el doble de
trabajo de traducción.

---

# 6. Criterios de salida de la segunda revisión

Stage 2 puede reconsiderarse solo cuando:

## Motor

- Los eventos de rooms sobreviven transiciones entre decks.
- El pawn no puede quedar abandonado por cambiar deck manualmente.
- Links y rooms eliminadas no dejan UI obsoleta.
- Las transiciones tienen regression tests.

## Editor

- Hotkeys y cursores funcionan.
- Click/doble click distinguen object/room.
- Rooms se pueden redimensionar con handles.
- Resize destructivo muestra advertencia.
- Diagonal/rounded walls tienen orientación clara.

## Rooms

- Existe un plano de datos para formas libres.
- Al menos rectangular + pasillo + L están implementados como presets.
- Las rooms libres mantienen eventos, links, pathfinding y save/load.

## Modos

- Main Menu existe.
- Dev Edit y Dev Test están separados.
- Game Runtime no muestra Dev toolbox.
- Game Build existe y cobra créditos.

## UI/i18n

- English y Spanish cubren mensajes dinámicos.
- La interfaz sci-fi no reduce legibilidad.
- Layout funciona en 1280×720.

## Tests

- `npm test` sigue verde.
- `npm run smoke` cubre flujo básico de navegador.
- Hay tests para freeform rooms, hotkeys y transiciones.

---

# 7. Preguntas que el owner debe confirmar

1. ¿El mapa final de hotkeys es el propuesto aquí?
2. ¿`Q/E` debe cambiar proyección, rotar el mapa 90°, o ambos mediante otro modificador?
3. ¿El selector debe usar doble click para room, o prefieres `R`/`Tab` para cambiar capa de selección?
4. ¿Las paredes redondeadas son solo visuales al principio o deben tener collision parcial desde la primera implementación?
5. ¿Cuáles son los valores iniciales de créditos y costes?
6. ¿Game Build permite crear decks desde el principio o se desbloquea más tarde?
7. ¿Las rooms libres deben conservar “room type” para futuros sistemas, o solo metadata/tag?

---

# 8. Resumen del Rector

La decisión de no avanzar a Stage 2 es correcta.

El motor ya prueba que UGS puede existir, pero todavía no prueba que:

- Las transiciones entre decks sean estables.
- El editor sea cómodo.
- Las rooms puedan crecer más allá de rectángulos.
- El jugador tenga una separación clara entre juego y desarrollo.
- La interfaz pueda ser usada por personas ajenas al proyecto.

La segunda revisión debe priorizar:

1. Bugs estructurales.
2. Modos de aplicación.
3. Input/UX.
4. Resize y paredes.
5. Cámara.
6. Rooms libres.
7. Créditos.
8. Estilo sci-fi.

Solo después de eso tiene sentido hablar de crew, NPCs o A-life.
