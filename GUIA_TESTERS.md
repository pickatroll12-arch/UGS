# GUÍA DE TESTERS — Ciclo OBJP-1.1 · 2026-07-28

Para **-FROMO** y **-BX** (y -XONO cuando quiera romper cosas).
Todo lo de abajo es **nuevo o cambiado en este ciclo**. Si algo no se comporta como
dice la columna «debe pasar», **es un bug** y hay que anotarlo.

- **Dónde probar:** `https://pickatroll12-arch.github.io/UGS/`
- **Dónde reportar:** archivo `Feedback humano` del repo, con la plantilla de siempre
  (un feedback = un problema). Al final de esta guía hay una versión corta de la plantilla.
- **Tiempo estimado del recorrido completo:** 35-45 min.

> **Antes de empezar:** el HUD (arriba a la derecha) debe decir **`· 3D`**. Si dice `· 2D`,
> anótalo y sigue — significa que el 3D no cargó y eso ya es un bug de por sí.

---

## PASO 0 — Arranque (2 min)

| # | Qué hacer | Qué debe pasar |
|---|---|---|
| 0.1 | Abrir la web | Menú con logo, fondo del kit visible (no negro) y retícula de fondo |
| 0.2 | Mirar abajo a la derecha | Control de **MÚSICA** visible y **clicable** desde el menú |
| 0.3 | Subir el volumen | Empieza a sonar música ambiente tras el primer toque |
| 0.4 | Pulsar **Jugar** | Entra al juego · HUD dice `· 3D` y unos 60fps |
| 0.5 | Mirar el encuadre | **La estación entra entera en pantalla**, ni gigante ni recortada |

---

## PASO 1 — Música (5 min, se puede dejar de fondo)

| # | Qué hacer | Qué debe pasar |
|---|---|---|
| 1.1 | Escuchar 3 minutos seguidos | Al acabar una pista **entra la siguiente sin corte ni silencio** (crossfade de 6 s) |
| 1.2 | Mover el slider | El volumen cambia al instante |
| 1.3 | Pulsar el altavoz | Silencia; el icono cambia a 🔇 |
| 1.4 | Recargar la página | **Recuerda** el volumen y el mute |
| 1.5 | Pasar de Juego → Dev → Menú | La música **no se corta ni se reinicia** |

**Ojo a esto:** no debería sonar NUNCA música de tensión ni de combate. Si suena algo
que no sea ambiente tranquilo, es un bug (esa música existe en el repo pero no debe
estar conectada todavía).

---

## PASO 2 — Suite Dev: la barra de herramientas nueva (8 min)

Entra en **Modo Dev** (botón 🛠 arriba o Back en el mando).

| # | Qué hacer | Qué debe pasar |
|---|---|---|
| 2.1 | Mirar el borde inferior | Fila de **rombos** con un número pequeño en cada uno |
| 2.2 | Pulsar `1`…`9` y `0` | El rombo activo cambia y arriba sale el nombre de la herramienta |
| 2.3 | Clicar un rombo con el ratón/dedo | Se activa igual que con la tecla |
| 2.4 | Clicar un rombo y luego el mapa **justo debajo de la barra** | El click de la barra **NO debe pintar el mapa** por debajo |
| 2.5 | **`2` (Suelo) y arrastrar** | **DRAG BOX**: se pinta un rectángulo entero al soltar |
| 2.6 | **`3` (Pared) y arrastrar** | Se levanta el contorno de la sala |
| 2.7 | **`4` (Borrar) y arrastrar** | Se vacía un rectángulo entero |
| 2.8 | `Ctrl+Z` | Deshace **el rectángulo completo**, no tile a tile |
| 2.9 | Pasar a **DISEÑAR MÓDULOS** | Los rombos `8`, `9` y `0` se ven **apagados** |
| 2.10 | Pulsar `8` en Módulos | No hace nada y avisa de que es solo de Nexo |
| 2.11 | Volver a **DISEÑAR NEXO** y pulsar `8` | Vuelve a funcionar (**el número no se lo quedó otra herramienta**) |
| 2.12 | Pasar el ratón por los 3 rombos del final | Salen **bloqueados** (PNJ, Evento, Zona) con su etapa congelada |

> **El DRAG BOX es sagrado.** Si en algún momento pintar deja de funcionar por
> arrastre y pasa a ser click suelto, es el bug más grave que podéis encontrar.

---

## PASO 3 — Objetos nuevos (6 min)

| # | Qué hacer | Qué debe pasar |
|---|---|---|
| 3.1 | Tecla `6` (Objeto) y abrir el selector del panel | **12 objetos con nombre legible** (Cama, Taquilla, Mesa…) |
| 3.2 | Comprobar la lista | **NO debe aparecer «console»** en ella |
| 3.3 | Colocar 5 o 6 objetos distintos | **Cada uno tiene forma propia — ninguno es una caja lisa** |
| 3.4 | **Mirarlos y decirnos si se entienden** | ¿Se distingue una cama de una taquilla sin leer nada? |
| 3.5 | Rotar la cámara (Q/E) | Las formas se ven bien desde los 4 ángulos |
| 3.6 | Tecla `7` (Consola) y colocar | Coloca una consola con su sprite (herramienta aparte, no del catálogo) |
| 3.7 | Colocar una **Luz de pared** y entrar en Juego | El PCJ **puede caminar por encima** (no bloquea) |
| 3.8 | **Exportar** la estación, **Importar**la de nuevo, volver a Juego | El PCJ **sigue pudiendo pasar** por la luz de pared |

> El 3.8 es importante: había un bug que hacía que **todos** los objetos se volvieran
> sólidos tras guardar y recargar. Si el PCJ ya no puede pasar, ha vuelto.

---

## PASO 4 — Seleccionar e inspeccionar (3 min)

| # | Qué hacer | Qué debe pasar |
|---|---|---|
| 4.1 | Tecla `1` (Seleccionar) y clicar un tile | La barra de abajo dice sala, coordenadas, suelo, pared y objeto |
| 4.2 | Clicar un tile **con objeto** y pulsar `Supr` | El objeto desaparece |
| 4.3 | `Ctrl+Z` | El objeto vuelve |
| 4.4 | Pulsar `Supr` sobre un tile vacío | Avisa de que no hay objeto (no debe romperse) |

---

## PASO 5 — Módulos y núcleo de reactor (6 min)

Ve a **DISEÑAR MÓDULOS**. **El reactor ya NO es una sala**: es un **objeto** que colocas
donde quieras, y el módulo que lo contenga pasa a generar energía. Por eso ya no existe
el botón «+ Reactor».

| # | Qué hacer | Qué debe pasar |
|---|---|---|
| 5.1 | **+ Nuevo módulo** y elegir **Núcleo de reactor** en OBJETO (tecla `6`) | Se coloca una columna alta y luminosa que ocupa su tile |
| 5.2 | Mirar bajo «PROVEE ENERGÍA (TW)» | Aparece **+100 TW de núcleos colocados** |
| 5.3 | Colocar un segundo núcleo | Sube a **+200 TW**: cada núcleo suma |
| 5.4 | Borrarlos (herramienta `4` o `Supr`) | Vuelve a «sin núcleos de reactor dentro» |
| 5.5 | **Exportar módulo** y volver a **Importar** | Vuelve con sus núcleos y sus TW |
| 5.6 | Poner tamaño **20×20** y aplicar | La sala crece y **la cámara la reencuadra sola** (debe caber entera) |
| 5.7 | Crear un segundo módulo de otro tamaño y **alternar entre los dos** | Solo se ve el módulo activo: **ni rastro del anterior** ⚠️ regresión conocida |
| 5.8 | Borrar un módulo que esté colocado en un Nexo | Desaparece también **del Nexo**, no solo de la biblioteca |
| 5.9 | Con la herramienta Objeto, pulsar **`R`** y colocar | El objeto sale **girado 90°**; `Shift+R` gira al revés |
| 5.10 | Con **Seleccionar `[1]`**, clicar un objeto y pulsar **`R`** | Gira ese objeto ya colocado. `Ctrl+Z` lo devuelve |

### PASO 5-bis — Energía de verdad (3 min)

Ve a **DISEÑAR NEXO** con un módulo que tenga un núcleo dentro.

| # | Qué hacer | Qué debe pasar |
|---|---|---|
| 5b.1 | Mirar el HUD arriba a la derecha | `⚡0/0TW` |
| 5b.2 | **Activar colocación** y colocar el módulo pegado al Nexo | El HUD sube a **⚡100/0TW** y el aviso dice `+100 TW` |
| 5b.3 | **Ctrl+Z** | La sala se va **y la energía vuelve a 0** |
| 5b.4 | **Ctrl+Y** | Vuelven sala y energía |
| 5b.5 | Seleccionar la sala con `[1]` y **🗑 Eliminar sala** | Se va, y la energía baja |
| 5b.6 | **Ctrl+Z** | Vuelve con su energía |
| 5b.7 | Intentar eliminar la **última** sala del Nexo | Se niega y lo explica |
| 5b.8 | Colocar un núcleo con `[6]` **dentro de una sala ya montada** | La energía sube **en el acto**, sin recolocar nada |

---

## PASO 6 — Energía y hangar (5 min) *(trabajo de Kimi)*

| # | Qué hacer | Qué debe pasar |
|---|---|---|
| 6.1 | Mirar el HUD | Lectura **⚡usados/capacidad TW** |
| 6.2 | Colocar módulos que consuman sin generador | Rechaza por energía insuficiente |
| 6.3 | Colocar un generador | La capacidad sube a 100 TW |
| 6.4 | Forzar consumo por encima de la capacidad | Sale **¡BROWNOUT!** en el HUD |
| 6.5 | Quitar el módulo que sobra | El brownout desaparece (no debe quedarse «energía fantasma») |
| 6.6 | En una sala de hangar, teclas `[` y `]` | Cambia la capacidad de amarre de la sala |
| 6.7 | Tecla `n` | Amarra una nave; el placeholder se ve |
| 6.8 | Amarrar más naves de las que caben | Rechaza con «Sin amarre libre» |
| 6.9 | Tecla `b` sobre una pared | Cicla el tipo de pared, incluida la **muralla bay** del hangar |

---

## PASO 7 — El bucle económico completo (10 min) ⭐ **el más importante**

Esto es lo que hay que jugar de principio a fin. Entra en **Juego**.

| # | Qué hacer | Qué debe pasar |
|---|---|---|
| 7.1 | Mirar CRED y naves al empezar | **0 CRED** y **1 nave** (Extractora I) |
| 7.2 | Desbloquear el hito **Hangar operativo** | Cuesta **0 CRED** (por eso se puede empezar sin dinero) |
| 7.3 | Colocar el **Hangar F1** | **No cuesta nada** — los módulos de F1 son gratis |
| 7.4 | Comprobar la nave | Toma plaza sola en el hangar recién construido |
| 7.5 | Pulsar **`X`** | «Nave en ruta a Veta K-7 — 5 etapas de sondeo» |
| 7.6 | Mirar el HUD | **⛏Veta K-7 etapa N/5** mientras está fuera |
| 7.7 | Pulsar **`X`** otra vez | Avisa de que la nave está fuera (no la manda dos veces) |
| 7.8 | Esperar los 5 minutos de la ruta | Vuelve **o falla** (hay 10% de fallo por etapa; ~40% por viaje) |
| 7.9 | Si vuelve, **leer la barra de estado** | `Venta: N UD de mineral · X CRED brutos − Y de impuesto UGS = +Z CRED` |
| 7.10 | Comprobar el almacén | Queda **vacío** tras la venta (listo para el siguiente viaje) |
| 7.11 | Seguir la cadena de hitos | Almacén → Generador → Radar → Habitacional |
| 7.12 | Al desbloquear el quinto | **Sube a Fase 2** |

**Lo que más nos interesa de este paso — decidnos:**
- ¿**Cuántas expediciones** os costó completar F1? (nuestra estimación: unas 6)
- ¿**Cuánto tiempo real** os llevó? (estimación: ~28 min)
- ¿Se hace **corto, largo o justo**?
- El **impuesto UGS de un tercio**, ¿se nota? ¿duele lo suficiente?

---

## PASO 8 — Mando (Odin 2 Portal u otro) (5 min)

| # | Qué hacer | Qué debe pasar |
|---|---|---|
| 8.1 | Conectar el mando | Avisa «Mando conectado…» y aparece un **cursor en cruz** |
| 8.2 | Stick izquierdo | Mueve el cursor (¿va a buena velocidad?) |
| 8.3 | Stick derecho | Mueve la cámara |
| 8.4 | **A** en Juego | El PCJ camina hasta el cursor |
| 8.5 | **A mantenido + stick** en Dev | **DRAG BOX con mando**: se pinta un rectángulo |
| 8.6 | **X** en Dev / **X** en Juego | Deshace / expide nave |
| 8.7 | **Y** en Dev / **Y** en Juego | Rehace / pausa |
| 8.8 | **B** | Cancela (colocación, link pendiente) |
| 8.9 | **LB / RB** | Rotan la vista 90° |
| 8.10 | **LT / RT** | Alejan / acercan |
| 8.11 | **D-pad ← →** en Dev | Cambia de herramienta |
| 8.12 | **Back / Start** | Cambia Dev↔Juego / abre menú |

**Decidnos:** ¿el cursor va **nervioso, lento o fino**? Son dos números y se ajustan.

---

## PASO 9 — Lo de siempre, que no se haya roto (5 min)

| # | Qué hacer | Qué debe pasar |
|---|---|---|
| 9.1 | Click→ruta del PCJ | Camina sin quedarse atascado |
| 9.2 | Cruzar del Nexo a un módulo colocado | Cruza (se abre paso en la arista compartida) |
| 9.3 | El rastro de navegación | Se dibuja bien también al cruzar de sala |
| 9.4 | Crear un **link** entre dos Nexos | Marca origen ▣, cambias de Nexo, marcas destino, **se crea** |
| 9.5 | En Juego, clicar el ascensor | Viaja al otro Nexo |
| 9.6 | Ponerse detrás de una pared | La pared se desvanece |
| 9.7 | Mirar la interfaz en modo **Juego** | **Cero vocabulario de desarrollo** (nada de «simulando», sin chips dev) |
| 9.8 | En Juego, buscar Exportar/Importar | **No deben estar** |

---

## Lista completa de lo añadido en este ciclo

### Jugabilidad y contenido (OBJP-1.1)
- **Árbol de fases F1** — 5 hitos encadenados: Hangar → Almacén (30 UD) → Generador (100 TW) → Radar → Habitacional (12 PNJ). Al completarlo, sube a Fase 2.
- **Ruta minera `veta_k7`** — 5 etapas × 60 s, rendimiento decreciente (100/65/40/25/15 %), 1-3 UD por etapa lograda, 10 % de fallo por etapa.
- **Expedición con tecla `X`** y seguimiento de etapa en el HUD.
- **Economía cerrada**: se empieza con 0 CRED y 1 nave · módulos de F1 gratis · **venta automática** al volver · **impuesto UGS de 1/3** (Unión Galáctica del Sistema Sol — de ahí el nombre del juego).
- **Energía TW** con lectura en HUD y **brownout** *(Kimi)*.
- **Hangar**: muralla `bay`, naves placeholder, capacidad por sala con `[` `]`, amarre con `n` *(Kimi)*.

### Suite de construcción
- **Barra de herramientas de rombos** abajo, con teclas fijas `1`-`9` y `0`.
- **Seleccionar (`1`)**: inspecciona tile y `Supr` retira objetos.
- **Consola (`7`)** como herramienta dedicada.
- **Librería de 12 objetos** con selector por nombre.
- **Objetos con silueta propia** (2-4 piezas cada uno), idénticos en 2D y 3D.
- **Reactor como OBJETO**: el núcleo aporta 100 TW al módulo que lo contiene (ya no hay módulo-Reactor).
- **Tamaño mínimo por módulo** que **rechaza y explica** en vez de recortar en silencio.
- **Módulo `screens`** — pantallas de consola: existe pero **NO está conectado** (decisión vuestra pendiente).

### Presentación
- **Interfaz sci-fi** derivada del kit del equipo: chaflán del botón hexagonal, cian como único acento, etiquetas técnicas en monoespaciada, brillo solo en lo activo.
- **Música idle**: 4 pistas en bucle infinito con crossfade de potencia constante, orden barajado, volumen y mute persistentes.
- **three.js vendorizado** — el 3D ya no depende de un CDN y funciona sin conexión.
- **Encaje automático de cámara** para que la estación quepa en pantallas pequeñas.

### Soporte de mando
- **Gamepad estándar** (Odin 2 Portal, Xbox, DualSense…) con cursor virtual, zona muerta radial y mapa de botones configurable.

---

## Plantilla corta para reportar

Copiad esto en `Feedback humano`:

```
FEEDBACK #N | FECHA: 2026-__-__ | AUTOR: -FROMO / -BX
PRIORIDAD: ALTA / MEDIA / BAJA
MODO: MENU / DEV / JUEGO      PASO DE LA GUÍA: __
¿QUÉ HICE?:
¿QUÉ ESPERABA?:
¿QUÉ PASÓ EN REALIDAD?:
EVIDENCIA: (captura / save exportado)
DECISIÓN REQUERIDA: (solo si es diseño, no bug)
```

## Las 4 preguntas que más nos sirven

1. **Ritmo**: ¿cuántas expediciones y cuánto tiempo real os costó completar F1?
2. **Objetos**: ¿se entienden a simple vista o hay alguno que no se sabe qué es?
3. **Mando**: ¿el cursor va fino, nervioso o lento?
4. **Impuesto UGS**: ¿se nota? ¿os parece justo o abusivo?
