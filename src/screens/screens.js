/*
 * UGS — screens/screens  (pantallas de consola)
 * ==================================================================
 * [PANTALLAS] — El ENTORNO de pantalla que se abre cuando el PCJ interactúa
 * con una consola. Este módulo NO decide qué hace cada consola: es el marco
 * común (estética BIOS) + un REGISTRO de tipos de pantalla, para que más
 * adelante a cada consola del mapa se le asigne el tipo que le toque:
 *
 *     screens.define({ id:'…', title:'…', init, update, draw, key, click })
 *     const s = screens.open('radar');   // ← una consola abre SU pantalla
 *     s.update(dt); s.draw(ctx, w, h);   // el shell la pinta como overlay
 *     s.key('Escape');  s.click(px, py);
 *
 * Doctrina de la casa (PROMPT_MAESTRO.md §2), igual que audio y render:
 *   - el ESTADO de una pantalla es lógica pura: `init`/`update`/`key`/`click`
 *     no tocan el DOM, así el módulo se carga y se prueba en Node;
 *   - `draw` sólo LEE ese estado y pinta en un ctx 2D; jamás lo muta.
 * Nada de core/ ni engine/ importa este módulo: las pantallas son
 * presentación, no reglas del juego.
 *
 * Incluye una única pantalla, 'radar', que es la PRUEBA DE ENTORNO pedida:
 * un sondeo en progreso con barrido animado y contactos. Es un simulacro
 * (datos falsos, sembrados) — no está conectada a ninguna mecánica.
 *
 * Corre en navegador (window.UGS.screens) y en Node (module.exports).
 */
(function (root, factory) {
  const api = factory(root.UGS && root.UGS.rng ? root.UGS.rng : require('../core/rng.js'));
  root.UGS = root.UGS || {};
  root.UGS.screens = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (RNG) {
  'use strict';

  // ---- paleta EGA de 16 colores (la de una BIOS de verdad) ------------------
  const PAL = {
    bg: '#0000a8', frame: '#c0c0c0', frameDim: '#4a4ab0',
    title: '#ffff55', label: '#ffffff', value: '#ffff55', dim: '#7a7ac8',
    ok: '#55ff55', warn: '#ffff55', bad: '#ff5555', accent: '#55ffff',
    selBg: '#c0c0c0', selFg: '#0000a8', scope: '#000040', grid: '#3a3aa8'
  };

  const MONO = 'ui-monospace, "DejaVu Sans Mono", "Courier New", monospace';
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /*
   * Rejilla de caracteres: una BIOS es texto en cuadrícula, no cajas sueltas.
   * Todo el chrome se coloca por (columna, fila) para que las columnas queden
   * alineadas a cualquier tamaño de lienzo, como en la pantalla real.
   */
  function makeGrid(w, h, cols) {
    cols = cols || 80;
    const cw = w / cols;
    const fs = Math.max(8, Math.round(cw / 0.6));   // monospace ≈ 0.6em de ancho
    const ch = Math.round(fs * 1.28);
    return {
      cols, cw, ch, fs, rows: Math.floor(h / ch),
      font: fs + 'px ' + MONO,
      x: (col) => col * cw,
      y: (row) => row * ch,
      cx: (col) => (col + 0.5) * cw,
      cy: (row) => (row + 0.5) * ch
    };
  }

  function text(ctx, g, str, col, row, color, align) {
    ctx.font = g.font;
    ctx.fillStyle = color || PAL.label;
    ctx.textBaseline = 'middle';
    ctx.textAlign = align || 'left';
    const x = align === 'center' ? g.cx(col) : (align === 'right' ? g.x(col + 1) : g.x(col));
    ctx.fillText(str, x, g.cy(row));
  }

  // línea doble: el borde característico del setup de una BIOS
  function doubleBox(ctx, x, y, w, h, color) {
    ctx.strokeStyle = color || PAL.frame;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
    ctx.strokeRect(Math.round(x) + 3.5, Math.round(y) + 3.5, Math.round(w) - 6, Math.round(h) - 6);
  }

  // barra de texto resaltada (fondo claro, tinta azul) — el "selected" de BIOS
  function bar(ctx, g, str, col, row, width) {
    ctx.fillStyle = PAL.selBg;
    ctx.fillRect(g.x(col), g.y(row) + 1, g.cw * width, g.ch - 2);
    text(ctx, g, str, col, row, PAL.selFg);
  }

  /*
   * Chrome común a TODAS las pantallas de consola: marco exterior, cabecera
   * con título, panel de ayuda a la derecha y barra de teclas abajo. Una
   * pantalla nueva sólo rellena su área de trabajo y su lista de ayuda.
   */
  function drawChrome(ctx, g, w, h, opts) {
    ctx.fillStyle = PAL.bg;
    ctx.fillRect(0, 0, w, h);

    // cabecera
    doubleBox(ctx, g.x(1), g.y(0.4), g.cw * (g.cols - 2), g.ch * 2.6, PAL.frame);
    text(ctx, g, opts.title, g.cols / 2, 1, PAL.title, 'center');
    text(ctx, g, opts.subtitle, g.cols / 2, 2, PAL.label, 'center');

    // cuerpo: área de trabajo (izquierda) + panel de ayuda (derecha)
    const bodyTop = g.y(3.4), bodyH = g.ch * (g.rows - 5.2);
    const helpCol = g.cols - 22;
    doubleBox(ctx, g.x(1), bodyTop, g.cw * (helpCol - 2), bodyH, PAL.frame);
    doubleBox(ctx, g.x(helpCol), bodyTop, g.cw * (g.cols - helpCol - 1), bodyH, PAL.frame);

    // título del panel de ayuda, en vídeo inverso como el "Item Help" original
    bar(ctx, g, center(opts.helpTitle || 'Item Help', g.cols - helpCol - 3), helpCol + 1, 4, g.cols - helpCol - 3);

    // barra de teclas
    const legendRow = g.rows - 1;
    ctx.strokeStyle = PAL.frame;
    ctx.beginPath();
    ctx.moveTo(g.x(1), g.y(legendRow) - 4);
    ctx.lineTo(g.x(g.cols - 1), g.y(legendRow) - 4);
    ctx.stroke();
    text(ctx, g, opts.legend, g.cols / 2, legendRow, PAL.label, 'center');

    return {
      work: { x: g.x(2), y: bodyTop + g.ch * 0.6, w: g.cw * (helpCol - 4), h: bodyH - g.ch * 1.2 },
      help: { col: helpCol + 1, row: 6, cols: g.cols - helpCol - 3, rows: Math.floor((bodyH - g.ch * 3) / g.ch) }
    };
  }

  function center(s, width) {
    const pad = Math.max(0, Math.floor((width - s.length) / 2));
    return ' '.repeat(pad) + s;
  }

  // barra de progreso con bloques, como las de un POST de BIOS
  function progressBar(p, width) {
    const full = Math.round(clamp(p, 0, 1) * width);
    return '█'.repeat(full) + '░'.repeat(Math.max(0, width - full));
  }

  // ---- registro de tipos de pantalla ----------------------------------------
  const registry = new Map();

  function define(def) {
    if (!def || !def.id) throw new Error('screen def needs an id');
    if (registry.has(def.id)) throw new Error('screen already defined: ' + def.id);
    registry.set(def.id, def);
    return def.id;
  }

  const has = (id) => registry.has(id);
  const list = () => Array.from(registry.values()).map(d => ({ id: d.id, title: d.title }));

  /*
   * open(id, opts) — instancia la pantalla de una consola.
   *   opts.rng   — RNG sembrado (por defecto semilla propia por pantalla:
   *                el simulacro no debe consumir el RNG de la partida)
   *   opts.seed  — semilla legible alternativa
   * Devuelve la sesión que el shell alimenta: update/draw/key/click/close.
   */
  function open(id, opts) {
    const def = registry.get(id);
    if (!def) throw new Error('unknown screen: ' + id);
    opts = opts || {};
    const rng = opts.rng || RNG.create(opts.seed || ('ugs-screen-' + id));
    const st = { id, t: 0, rng, closed: false, dirty: true };
    if (def.init) def.init(st, opts);

    return {
      id,
      get title() { return def.title; },
      get state() { return st; },
      get closed() { return st.closed; },
      update(dt) {
        if (st.closed) return st;
        dt = Math.max(0, Number(dt) || 0);
        st.t += dt;
        if (def.update) def.update(st, dt);
        return st;
      },
      draw(ctx, w, h) {
        const g = makeGrid(w, h, def.cols || 80);
        const areas = drawChrome(ctx, g, w, h, {
          title: def.title,
          subtitle: typeof def.subtitle === 'function' ? def.subtitle(st) : (def.subtitle || ''),
          helpTitle: def.helpTitle,
          legend: typeof def.legend === 'function' ? def.legend(st) : (def.legend || '')
        });
        if (def.draw) def.draw(st, ctx, g, areas.work);
        if (def.help) {
          const lines = def.help(st) || [];
          for (let i = 0; i < lines.length && i < areas.help.rows; i++) {
            const ln = lines[i];
            if (ln == null) continue;
            const s = typeof ln === 'string' ? { s: ln, c: PAL.label } : ln;
            text(ctx, g, s.s, areas.help.col, areas.help.row + i, s.c || PAL.label);
          }
        }
        st.dirty = false;
        return areas;
      },
      key(k) {
        if (st.closed) return false;
        if (k === 'Escape') { st.closed = true; return true; }
        return def.key ? !!def.key(st, k) : false;
      },
      click(px, py, w, h) {
        if (st.closed || !def.click) return false;
        const g = makeGrid(w, h, def.cols || 80);
        const bodyTop = g.y(3.4), bodyH = g.ch * (g.rows - 5.2);
        const helpCol = g.cols - 22;
        const work = { x: g.x(2), y: bodyTop + g.ch * 0.6, w: g.cw * (helpCol - 4), h: bodyH - g.ch * 1.2 };
        return !!def.click(st, px, py, work);
      },
      close() { st.closed = true; }
    };
  }

  // =========================================================================
  // PANTALLA 'radar' — simulacro de sondeo. Prueba del entorno, sin mecánica.
  // =========================================================================
  // Convención de radar: la marcación 000° apunta ARRIBA y crece en sentido
  // horario. En canvas el ángulo 0 mira a la derecha, así que todo lo que se
  // dibuja gira un cuarto de vuelta. Los ángulos del ESTADO son de marcación,
  // no de pantalla: sólo el dibujo aplica este desfase.
  const NORTH = -Math.PI / 2;
  const RANGES = [25, 50, 100, 200];      // km por anillo exterior
  const KINDS = [
    { k: 'CARGUERO', c: PAL.ok },
    { k: 'ASTEROIDE', c: PAL.dim },
    { k: 'CHATARRA', c: PAL.dim },
    { k: 'SIN IDENT.', c: PAL.warn },
    { k: 'BALIZA', c: PAL.accent }
  ];

  define({
    id: 'radar',
    title: 'UGS - CONSOLA DE SENSORES',
    subtitle: (st) => 'Sondeo de Sector' + (st.paused ? '  [ PAUSA ]' : ''),
    helpTitle: 'Item Help',
    legend: '↑↓:Contacto  ←→:Alcance  Espacio:Pausa  G:Ganancia  ESC:Salir',

    init(st) {
      st.sweep = 0;                 // ángulo del barrido (rad)
      st.speed = 0.95;              // rad/s ≈ 6.6 s por vuelta
      st.rangeIx = 2;
      st.gain = 2;                  // 1..3, persistencia de la estela
      st.paused = false;
      st.sel = 0;
      st.scan = 0;                  // progreso del sondeo 0..1
      st.pass = 1;                  // nº de pasada completada
      st.contacts = [];
      const n = 7;
      for (let i = 0; i < n; i++) {
        st.contacts.push({
          id: 'C' + String(i + 1).padStart(2, '0'),
          ang: st.rng.next() * Math.PI * 2,
          dist: 0.18 + st.rng.next() * 0.78,        // fracción del radio
          drift: (st.rng.next() - 0.5) * 0.06,      // deriva angular rad/s
          vr: (st.rng.next() - 0.5) * 0.012,        // deriva radial
          glow: 0,
          kind: KINDS[Math.floor(st.rng.next() * KINDS.length)],
          vel: Math.round(20 + st.rng.next() * 260)
        });
      }
    },

    update(st, dt) {
      if (!st.paused) {
        const prev = st.sweep;
        st.sweep = (st.sweep + st.speed * dt) % (Math.PI * 2);
        // progreso del sondeo = vuelta completa del barrido
        st.scan = st.sweep / (Math.PI * 2);
        if (st.sweep < prev) st.pass++;

        for (const c of st.contacts) {
          c.ang = (c.ang + c.drift * dt + Math.PI * 2) % (Math.PI * 2);
          c.dist = clamp(c.dist + c.vr * dt, 0.12, 0.97);
          if (c.dist <= 0.12 || c.dist >= 0.97) c.vr = -c.vr;   // rebota en los bordes
          // el barrido "ilumina" el contacto al pasar por encima
          const crossed = prev <= st.sweep
            ? (c.ang > prev && c.ang <= st.sweep)
            : (c.ang > prev || c.ang <= st.sweep);
          if (crossed) c.glow = 1;
          else c.glow = Math.max(0, c.glow - dt / (0.7 + st.gain * 0.55));
        }
      }
      st.sel = clamp(st.sel, 0, st.contacts.length - 1);
    },

    key(st, k) {
      const n = st.contacts.length;
      if (k === 'ArrowUp') { st.sel = (st.sel - 1 + n) % n; return true; }
      if (k === 'ArrowDown') { st.sel = (st.sel + 1) % n; return true; }
      if (k === 'ArrowLeft') { st.rangeIx = clamp(st.rangeIx - 1, 0, RANGES.length - 1); return true; }
      if (k === 'ArrowRight') { st.rangeIx = clamp(st.rangeIx + 1, 0, RANGES.length - 1); return true; }
      if (k === ' ' || k === 'Spacebar') { st.paused = !st.paused; return true; }
      if (k === 'g' || k === 'G') { st.gain = st.gain % 3 + 1; return true; }
      return false;
    },

    // click en el osciloscopio: selecciona el contacto más cercano al puntero
    click(st, px, py, work) {
      const s = scopeOf(work);
      let best = -1, bestD = Infinity;
      for (let i = 0; i < st.contacts.length; i++) {
        const p = contactXY(st.contacts[i], s);
        const d = Math.hypot(p.x - px, p.y - py);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0 && bestD <= s.r * 0.14) { st.sel = best; return true; }
      return false;
    },

    help(st) {
      const c = st.contacts[st.sel];
      const km = RANGES[st.rangeIx];
      return [
        { s: 'Contacto sel.', c: PAL.label },
        { s: '  ' + c.id + ' ' + c.kind.k, c: c.kind.c },
        { s: '  Rango ' + (c.dist * km).toFixed(1) + ' km', c: PAL.value },
        { s: '  Marc. ' + Math.round(c.ang * 180 / Math.PI).toString().padStart(3, '0') + '°', c: PAL.value },
        { s: '  Vel.  ' + c.vel + ' m/s', c: PAL.value },
        null,
        { s: 'Alcance  [' + km + ' km]', c: PAL.label },
        { s: 'Ganancia [' + '█'.repeat(st.gain) + '░'.repeat(3 - st.gain) + ']', c: PAL.label },
        { s: 'Barrido  [' + (st.paused ? 'PAUSA' : 'ACTIVO') + ']', c: st.paused ? PAL.warn : PAL.ok },
        null,
        { s: 'Contactos: ' + st.contacts.length, c: PAL.dim },
        { s: 'Pasada:    ' + st.pass, c: PAL.dim }
      ];
    },

    draw(st, ctx, g, work) {
      const s = scopeOf(work);

      // --- osciloscopio -----------------------------------------------------
      ctx.save();
      ctx.beginPath(); ctx.arc(s.cx, s.cy, s.r, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = PAL.scope;
      ctx.fillRect(s.cx - s.r, s.cy - s.r, s.r * 2, s.r * 2);

      // estela del barrido: cuña de segmentos que se apagan hacia atrás
      const tail = 0.5 + st.gain * 0.30;                 // rad de persistencia
      const steps = 26;
      for (let i = 0; i < steps; i++) {
        const a0 = st.sweep + NORTH - tail * (i + 1) / steps;
        const a1 = st.sweep + NORTH - tail * i / steps;
        ctx.beginPath();
        ctx.moveTo(s.cx, s.cy);
        ctx.arc(s.cx, s.cy, s.r, a0, a1);
        ctx.closePath();
        ctx.fillStyle = 'rgba(85,255,85,' + (0.16 * (1 - i / steps)).toFixed(3) + ')';
        ctx.fill();
      }
      ctx.restore();

      // anillos de alcance + retícula
      ctx.strokeStyle = PAL.grid; ctx.lineWidth = 1;
      for (let i = 1; i <= 4; i++) {
        ctx.beginPath(); ctx.arc(s.cx, s.cy, s.r * i / 4, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(s.cx - s.r, s.cy); ctx.lineTo(s.cx + s.r, s.cy);
      ctx.moveTo(s.cx, s.cy - s.r); ctx.lineTo(s.cx, s.cy + s.r);
      ctx.stroke();
      ctx.strokeStyle = PAL.frame; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(s.cx, s.cy, s.r, 0, Math.PI * 2); ctx.stroke();

      // marcas de rumbo cada 30°
      ctx.fillStyle = PAL.dim;
      ctx.font = Math.round(g.fs * 0.72) + 'px ' + MONO;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let a = 0; a < 360; a += 30) {
        const r = a * Math.PI / 180 + NORTH;
        ctx.fillText(String(a).padStart(3, '0'),
          s.cx + Math.cos(r) * (s.r + g.fs * 0.85),
          s.cy + Math.sin(r) * (s.r + g.fs * 0.85));
      }

      // línea viva del barrido
      ctx.strokeStyle = PAL.ok; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.cx, s.cy);
      ctx.lineTo(s.cx + Math.cos(st.sweep + NORTH) * s.r, s.cy + Math.sin(st.sweep + NORTH) * s.r);
      ctx.stroke();

      // contactos: brillan al ser barridos y se apagan luego
      for (let i = 0; i < st.contacts.length; i++) {
        const c = st.contacts[i];
        const p = contactXY(c, s);
        const a = 0.30 + c.glow * 0.70;      // nunca invisible del todo: es un eco que decae
        ctx.globalAlpha = a;
        ctx.fillStyle = c.kind.c;
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.5 + c.glow * 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        if (i === st.sel) {                       // retícula del seleccionado
          ctx.strokeStyle = PAL.accent; ctx.lineWidth = 1;
          const b = 7 + c.glow * 2;
          ctx.strokeRect(p.x - b, p.y - b, b * 2, b * 2);
          ctx.fillStyle = PAL.accent;
          ctx.font = Math.round(g.fs * 0.72) + 'px ' + MONO;
          ctx.textAlign = 'left';
          ctx.fillText(c.id, p.x + b + 3, p.y);
        }
      }

      // --- lecturas a la derecha del osciloscopio ---------------------------
      // la columna de lecturas arranca DESPUÉS de las marcas de rumbo
      const col = Math.ceil((s.cx + s.r + g.fs * 2.6) / g.cw);
      const row0 = Math.round(work.y / g.ch) + 1;
      const km = RANGES[st.rangeIx];
      text(ctx, g, 'SONDEO EN PROGRESO', col, row0, PAL.title);
      text(ctx, g, progressBar(st.scan, 18), col, row0 + 1, PAL.ok);
      text(ctx, g, String(Math.round(st.scan * 100)).padStart(3, ' ') + '%   PASADA ' + st.pass, col, row0 + 2, PAL.value);

      text(ctx, g, 'MARCACION  ' + String(Math.round(st.sweep * 180 / Math.PI)).padStart(3, '0') + '°', col, row0 + 4, PAL.label);
      text(ctx, g, 'ALCANCE    ' + String(km).padStart(3, ' ') + ' km', col, row0 + 5, PAL.label);
      text(ctx, g, 'ESTADO     ' + (st.paused ? 'EN PAUSA' : 'NOMINAL'), col, row0 + 6, st.paused ? PAL.warn : PAL.ok);

      // lista de contactos, estilo tabla de BIOS
      text(ctx, g, 'CONTACTOS', col, row0 + 8, PAL.title);
      for (let i = 0; i < st.contacts.length; i++) {
        const c = st.contacts[i];
        const line = c.id + ' ' + c.kind.k.padEnd(11, ' ') + (c.dist * km).toFixed(1).padStart(6, ' ') + ' km';
        if (i === st.sel) bar(ctx, g, ' ' + line, col - 1, row0 + 9 + i, line.length + 2);
        else text(ctx, g, line, col, row0 + 9 + i, c.glow > 0.5 ? c.kind.c : PAL.dim);
      }
    }
  });

  /*
   * Geometría del osciloscopio dentro del área de trabajo. El margen deja
   * sitio a las marcas de rumbo, que se dibujan POR FUERA del círculo.
   */
  function scopeOf(work) {
    const m = Math.max(20, work.h * 0.075);
    const r = Math.min(work.h, work.w * 0.44) / 2 - m;
    return { cx: work.x + r + m, cy: work.y + work.h / 2, r };
  }
  function contactXY(c, s) {
    const a = c.ang + NORTH;
    return { x: s.cx + Math.cos(a) * c.dist * s.r, y: s.cy + Math.sin(a) * c.dist * s.r };
  }

  return { define, open, has, list, PAL, MONO, makeGrid, drawChrome, text, doubleBox, bar, progressBar, RANGES };
});
