# RELEVO A KIMI CODE CLI — Terminar la publicación del PR de reparaciones (2026-07-29)

> **Para Kimi Code CLI:** esto es un relevo mecánico. Todo el trabajo pesado (debug, fixes,
> tests, smokes) YA ESTÁ HECHO y VERIFICADO. Solo falta publicar. Sigue los pasos en orden,
> verifica con md5 tras cada push (protocolo del proyecto: NUNCA subas placeholder ni
> contenido truncado; tras cada push compara md5 local vs remoto y re-sube si difiere).

## 1. Estado actual (verificado 2026-07-29)

- Rama: `rector/game-ui-hitos-energia-hangar` en `pickatroll12-arch/UGS`.
- La entrega contiene **9 archivos** (4 fixes del debug OBJP-1.1 + handoff §6.31).
- **8 de 9 archivos YA están subidos a la rama y verificados byte-exactos por md5**
  (src/engine/station.js, src/core/content_f1.js, src/engine/blueprint.js, src/app/app.js,
  tests/station.test.js, tests/blueprint.test.js, tests/content_f1.test.js, index.html).
- **FALTA 1 archivo: `AGENTIC_REVIEW.md`** — hay que añadirle la entrada §6.31 (texto completo
  más abajo en §4 de este documento) y subirlo.
- Estado de la entrega ya probado en el clon local (commit `7ef26c4`):
  `node tests/run.js` → **554 checks ALL SUITES GREEN** · smoke del game UI en Chromium
  **18/18** · regresión suite Dev **48/48** · bucle API **15/15**. El cambio que falta es
  SOLO documental (un .md de registro), no puede romper código.

## 2. Qué repara esta entrega (contexto para el PR)

1. **GAP-UI-01** — No existía UI de hitos ni de compra/colocación de módulos en modo Juego
   (el PASO 7 de GUIA_TESTERS era imposible a mano). Implementado: panel de FASE (botón
   `◈ Fase` en topbar): desbloquear hitos con coste/motivo, comprar y colocar módulos con
   ghost validado + puertas reales de `placeModule`, sección NAVES con reparación,
   CRED en el HUD.
2. **BUG-ENERGÍA-01** — `placeModule` rechazaba generadores durante brownout; la puerta ya
   cuenta `provides.energy` (el productor que resuelve el brownout sí pasa; el consumidor
   sigue rechazado).
3. **BUG-HANGAR-01** — `attachModule` propaga `room.hangar` desde el def: el hangar colocado
   en partida ya dibuja el placeholder de la nave (capacidad room-first intacta).
4. **GAP-ECON-01** — el bucle F1 era imposible desde 0 CRED (sin almacén no hay descarga →
   0 venta → hito Almacén inalcanzable). Reparación propuesta: **bodega base del Nexo de
   5 UD** (`BASE_STORAGE`, pendiente de validación humana). Además la venta al volver vende
   todo lo vendible del almacén (orden §6.24).

## 3. Pasos (en orden)

```bash
git clone https://github.com/pickatroll12-arch/UGS.git
cd UGS
git checkout rector/game-ui-hitos-energia-hangar
```

1. **Añade §6.31 al final de `AGENTIC_REVIEW.md`** (texto íntegro en §4 de este documento:
   dos líneas en blanco y luego el bloque). Haz commit:
   `docs(review): §6.31 — debug extensivo + reparaciones UI juego/energía/hangar/bodega`
2. **Push** de la rama. Verifica tras el push:
   `curl -s https://raw.githubusercontent.com/pickatroll12-arch/UGS/rector/game-ui-hitos-energia-hangar/AGENTIC_REVIEW.md | md5sum`
   contra `md5sum AGENTIC_REVIEW.md` — deben coincidir. Si no, re-sube.
3. **Sanity:** `node tests/run.js` → debe seguir **554 checks ALL SUITES GREEN**.
4. **Abre el PR** (base `main`, head `rector/game-ui-hitos-energia-hangar`) con el título y
   cuerpo de §5 de este documento.
5. **Verifica `mergeable_state: clean`** y, con confirmación de -XONO, **mergea** con método
   `merge` y el mensaje de §6.
6. **Post-merge:** clon limpio de `main` → `node tests/run.js` (debe dar 554 verdes) y
   reporta. Si GitHub Pages está activo, la build publicada incluirá el panel de FASE.

## 4. Texto de §6.31 para AGENTIC_REVIEW.md

(Añadir al final del archivo, precedido de DOS líneas en blanco)

### §6.31 — KIMI K3 (Rector) — Debug extensivo + reparaciones: UI de juego (hitos/módulos/naves), energía, hangar y bodega base — 2026-07-29
**Observación:** por orden de -XONO se hizo DEBUG EXTENSIVO del ciclo OBJP-1.1
contra `GUIA_TESTERS.md` (la "lista de Claude"; su artifact externo no es
accesible por Cloudflare/sesión) y los handoffs §6.22-§6.30. Método: clon limpio
+ 4 lotes automatizados en Chromium/WebGL real (~130 checks: arranque, música,
toolbox, objetos, módulos, energía, hangar, bucle económico, mando emulado,
regresión click→ruta/multi-sala/links). Resultado del debug: casi todo verde
(verificado ítem a ítem), con **4 hallazgos reales** que esta entrega repara:

1. **GAP-UI-01 (estructural): no existía UI de hitos ni de compra/colocación de
   módulos en modo Juego.** El PASO 7 de la guía era imposible a mano y OBJP-1
   ("en modo juego solo se pueden comprar y conectar módulos") seguía sin
   cumplirse. **Implementado:** panel de FASE en modo Juego (`◈ Fase` en el
   topbar): hitos de la fase con estado y botón Desbloquear (con coste y
   motivo de bloqueo), módulos construibles con coste/provisión y botón
   Colocar (ghost con validación en vivo, ESC/click derecho cancela), sección
   NAVES con estado y botón **Reparar** (sin ella, una nave dañada era
   soft-lock: falla ~40% por viaje), y CRED visible en el HUD. Las puertas de
   `placeModule` (hito/CRED/energía/conexión) se aplican de verdad; la sala la
   genera `blueprint.roomFromDef` desde la huella `room` añadida a cada def
   F1 (placeholder honesto hasta que los módulos se diseñen en la suite).
2. **BUG-ENERGÍA-01: durante un brownout, `placeModule` rechazaba colocar un
   GENERADOR** ('energía insuficiente') aunque consume 0 TW y provee 100 —
   la puerta `used + energyUse > capacity` ignoraba `provides.energy`, así que
   el único camino para salir del brownout era retirar consumo (con el evento
   de fallo de generador del mapa mental, soft-lock). Ahora la puerta mira la
   capacidad TRAS colocar. Con test: productor admitido en brownout, consumidor
   sigue rechazado.
3. **BUG-HANGAR-01: un hangar colocado por `placeModule` no dibujaba el
   placeholder de la nave** (la capacidad sí contaba, `roomCapOf` lee el def):
   `hangarRooms()` solo reconoce `room.hangar/shipCap` y `attachModule` no lo
   propagaba. Ahora `attachModule` marca `room.hangar` cuando el def provee
   shipCap (sin pisar shipCap explícitos — capacidad room-first intacta).
4. **GAP-ECON-01 (el más serio, encontrado por el propio smoke de la
   reparación): el bucle F1 era IMPOSIBLE desde 0 CRED.** Sin Almacén
   (storageCap 0) la primera expedición no podía descargar → venta 0 → el hito
   del Almacén (150 CRED) inalcanzable para siempre. El test del bucle lo
   escondía forzando `buildable` a mano. **Reparación PROPUESTA (validación
   pendiente): bodega base del Nexo de 5 UD** (`BASE_STORAGE` en station.js,
   una constante). La primera expedición ya vende (~194 netos) y el bucle
   arranca sin tocar los costes de hito documentados. Test nuevo del bucle
   SIN trampas. **Bonus alineado con §6.24:** la venta al volver ahora vende
   TODO lo vendible del almacén (el regalo del hito Almacén, 5 UD, ya no se
   queda eterno sin vender; "el almacén queda libre", como decía la orden).

**Evidencia:** `node tests/run.js` → **554 checks, ALL SUITES GREEN** (+27:
puerta de energía, marca hangar, roomFromDef, huellas F1, bucle real sin
trampas). Smoke del game UI en Chromium **18/18**: panel visible con FASE 1 ·
0 CRED, desbloqueo por botón, ghost + colocación del Hangar con paso abierto
gratis, **la nave toma plaza Y SE VE el placeholder** (fixes 3+4), ESC cancela,
venta desglosada con impuesto, panel refleja CRED y habilita Almacén,
desbloqueo por botón con CRED ganado (267→117), rechazo lejos del Nexo con
explicación, toggle ◈ Fase, **cero vocabulario dev en Juego**, export/import
ocultos, cero errores de consola. Regresión: lote Dev 48/48, bucle API 15/15.
**Riesgo / lo que NO se probó:** el panel no se probó en el Odin (cruceta
arriba/abajo del mando no navega el panel: los botones son DOM, el mando sigue
sirviendo para el mapa); la huella `room` de las defs es placeholder mío
(8×6 hangar con bay este, 6×5, 7×7, 5×5, 8×6) — pendiente del diseño real en
suite; la bodega base de 5 UD es PROPUESTA mía (balance); la venta-total
asume que acumular recursos a propósito aún no es mecánica (no hay crafting).
**Recomendación:** humanos reintentan el PASO 7 de la guía de principio a fin
POR LA UI (ya es jugable) y nos dicen ritmo real. Si la bodega base se valida,
queda; si no, se ajusta la constante.
**Archivos afectados:** `src/engine/station.js` (puerta energía, marca hangar,
BASE_STORAGE), `src/core/content_f1.js` (huellas room), `src/engine/blueprint.js`
(roomFromDef), `src/app/app.js` (panel, colocación en juego, ghost, venta total,
HUD CRED), `index.html` (panel + ◈ Fase + CSS), `tests/station.test.js`,
`tests/blueprint.test.js`, `tests/content_f1.test.js`, este documento.
**Pruebas necesarias (humano):** (1) Juego → panel: desbloquear Hangar (0 CRED),
colocar Hangar F1 gratis junto al Nexo — la nave toma plaza y SE VE; (2) X y
esperar el retorno: venta desglosada con impuesto; (3) con lo ganado,
desbloquear Bodega presurizada (150) por botón y colocar el Almacén; (4) si la
nave falla: botón Reparar en NAVES; (5) ◈ Fase oculta/muestra el panel;
(6) seguir la cadena hasta Fase 2 y decirnos expediciones/tiempo real;
(7) valorar la bodega base de 5 UD (¿arranque justo o regalo?).
**Decisión pendiente:** (1) validar BASE_STORAGE=5 o ajustar; (2) huellas
placeholder de los módulos F1 vs diseñarlas en la suite; (3) ¿la venta sigue
total al volver o queréis acumular para una futura cadena de procesamiento?;
(4) siguen abiertas las de §6.26 (firmas 3/3, GLB vs sprites v4, impuesto fijo
o variable, módulos F2).

## 5. Título y cuerpo del PR

**Título:** `fix(debug OBJP-1.1): UI de juego (hitos/módulos/naves) + energía + hangar + bodega base (§6.31)`

**Cuerpo:**

```
Reparaciones del debug extensivo del ciclo OBJP-1.1 (handoff completo en AGENTIC_REVIEW.md §6.31).

**4 hallazgos del debug, 4 reparaciones:**
1. **GAP-UI-01** — No existía UI de hitos ni de compra/colocación de módulos en modo Juego (el PASO 7 de GUIA_TESTERS era imposible a mano). Implementado: panel de FASE (◈ Fase): desbloquear hitos con coste/motivo, comprar y colocar módulos con ghost validado y puertas reales de placeModule, sección NAVES con reparación (el soft-lock de nave dañada), CRED en el HUD.
2. **BUG-ENERGÍA-01** — placeModule rechazaba generadores durante brownout: la puerta ya cuenta provides.energy (el productor que resuelve el brownout sí puede colocarse; el consumidor sigue rechazado).
3. **BUG-HANGAR-01** — attachModule propaga room.hangar desde el def: el hangar colocado en partida ya dibuja el placeholder de la nave (capacidad room-first intacta).
4. **GAP-ECON-01** — el bucle F1 era imposible desde 0 CRED (sin almacén no hay descarga → 0 CRED → hito Almacén inalcanzable). Reparación propuesta: bodega base del Nexo de 5 UD (BASE_STORAGE, pendiente de validación humana). Además la venta al volver ahora vende todo lo vendible (orden §6.24).

**Verificación:** node tests/run.js → 554 checks ALL SUITES GREEN (+27 nuevos). Smoke Chromium del game UI 18/18 (panel, desbloqueo por botón, colocación con ghost, placeholder de nave, venta desglosada con impuesto, desbloqueo con CRED ganado, rechazo con explicación, toggle del panel, cero vocabulario dev, cero errores de consola). Regresión: suite Dev 48/48, bucle API 15/15.

**Pendiente de validación humana:** bodega base 5 UD · huellas placeholder de los módulos F1 · venta total vs acumulación.
```

## 6. Mensaje del merge commit

**Título:** `fix(debug OBJP-1.1): UI de juego (hitos/módulos/naves) + energía + hangar + bodega base (§6.31)`

**Detalle:**

```
Debug extensivo del ciclo OBJP-1.1 (GUIA_TESTERS + handoffs §6.22-§6.30):
4 hallazgos reales reparados.
- GAP-UI-01: panel de FASE en modo Juego (hitos, compra/colocacion de modulos
  con puertas reales, reparacion de naves, CRED en HUD) — OBJP-1 por fin jugable.
- BUG-ENERGIA-01: placeModule admite productores durante brownout (provides.energy).
- BUG-HANGAR-01: attachModule propaga room.hangar desde el def (placeholder visible).
- GAP-ECON-01: bodega base del Nexo (5 UD, BASE_STORAGE — propuesta pendiente de
  validacion) — el bucle F1 era imposible sin ella.
- Venta al volver: se vende todo lo vendible del almacen (orden §6.24).
Tests: 554 checks ALL SUITES GREEN (+27). Smoke game UI 18/18, regresion 48/48+15/15.
Handoff: AGENTIC_REVIEW.md §6.31.
```

## 7. Trabajo posterior (NO es parte de este PR; solo si -XONO lo pide)

- Actualizar `GUIA_TESTERS.md`: el PASO 6 (energía) y el PASO 7 (bucle) ya se hacen
  POR LA UI — la guía puede simplificar los pasos de "colocar módulos" al panel de FASE.
- Integración pendiente del Rector (§6.22): mapeo `colorKey`→paleta y extrusión por `h`
  — OJO: §6.27 dice que los objetos ya usan siluetas por `parts`; revisar si sigue
  habiendo algo pendiente antes de tocar render.
- Decisiones humanas abiertas: firmas 3/3 OBJP-1.1 en `Feedback humano`, balance F1,
  impuesto fijo/variable, GLB vs sprites v4, tope de núcleos por módulo (§6.29).

— Kimi K3 (Rector), relevo a CLI por orden de -XONO
