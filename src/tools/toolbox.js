/*
 * UGS — tools/toolbox  (barra de herramientas de la suite Dev)
 * ==================================================================
 * [HERRAMIENTAS] — Catálogo, disponibilidad, teclas rápidas, geometría y
 * dibujo de la barra inferior de rombos. NO ejecuta ninguna edición: solo
 * dice QUÉ herramienta está activa y dónde se ha clicado. Quien edita sigue
 * siendo `engine/blueprint.js` a través de `app/app.js` (PROMPT_MAESTRO §2).
 *
 * Igual que audio/ y screens/: el estado y la geometría son lógica pura sin
 * DOM (corre en Node y tiene tests); `draw` solo LEE y pinta en un ctx 2D.
 *
 * Reglas del catálogo:
 *   - `key` es FIJA por herramienta (1..9,0). No se reasigna sola al cambiar
 *     de sección: si una herramienta no aplica, su rombo se ve apagado pero
 *     su número no se lo queda otra. La memoria muscular no se rompe.
 *   - `gesture:'rect'` = DRAG BOX: se arrastra un rectángulo y se aplica al
 *     soltar. Es la utilidad que el organizador declaró intocable — hay un
 *     test que falla si algún día desaparece de suelo/pared/borrar.
 *   - `RESERVED` declara herramientas de etapas FUTURAS (OBJP-1.1 y OBJP-2,
 *     ambas CONGELADAS). Se dibujan bloqueadas y sin tecla: son un hueco
 *     reservado en la UI, no funcionalidad adelantada.
 *
 * Corre en navegador (window.UGS.toolbox) y en Node (module.exports).
 */
(function (root, factory) {
  const api = factory();
  root.UGS = root.UGS || {};
  root.UGS.toolbox = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // secciones de la suite Dev en las que cada herramienta tiene sentido
  const BOTH = ['nexo', 'modules'];
  const NEXO = ['nexo'];

  /*
   * gesture:
   *   'rect'  — DRAG BOX (arrastrar rectángulo, aplicar al soltar)
   *   'point' — un click en un tile
   *   'flood' — un click que se propaga (bote de relleno)
   *   'mode'  — activa un modo aparte (colocación de módulo con ghost)
   */
  const TOOLS = [
    { id: 'select', key: '1', glyph: '▷', name: 'Seleccionar', gesture: 'point', sections: BOTH,
      hint: 'Click: inspeccionar tile/objeto · Supr: retirar el objeto seleccionado' },
    { id: 'floor',  key: '2', glyph: '▦', name: 'Suelo',       gesture: 'rect',  sections: BOTH,
      hint: 'DRAG BOX: arrastra para pintar un rectángulo de suelo' },
    { id: 'wall',   key: '3', glyph: '▤', name: 'Pared',       gesture: 'rect',  sections: BOTH,
      hint: 'DRAG BOX: arrastra y se levanta el contorno de la sala' },
    { id: 'erase',  key: '4', glyph: '⌫', name: 'Borrar',      gesture: 'rect',  sections: BOTH,
      hint: 'DRAG BOX: arrastra para vaciar un rectángulo (Ctrl+Z lo deshace)' },
    { id: 'fill',   key: '5', glyph: '▨', name: 'Relleno',     gesture: 'flood', sections: BOTH,
      hint: 'Bote: rellena el área contigua con el suelo activo' },
    { id: 'object', key: '6', glyph: '◈', name: 'Objeto',      gesture: 'point', sections: BOTH,
      hint: 'Coloca el objeto elegido en el panel lateral' },
    { id: 'console', key: '7', glyph: '◉', name: 'Consola',    gesture: 'point', sections: BOTH,
      hint: 'Coloca una consola (su pantalla se asignará cuando screens se cablee)' },
    { id: 'entry',  key: '8', glyph: '⚑', name: 'Entrada',     gesture: 'point', sections: NEXO,
      hint: 'Marca dónde aparece el PCJ al entrar en este Nexo' },
    { id: 'link',   key: '9', glyph: '⛓', name: 'Ascensor',    gesture: 'point', sections: NEXO,
      hint: 'Click origen → cambia de Nexo → click destino (la marca ▣ se conserva)' },
    { id: 'module', key: '0', glyph: '▣', name: 'Módulo',      gesture: 'mode',  sections: NEXO,
      hint: 'Colocación con ghost: verde si comparte arista con el Nexo' }
  ];

  // Etapas futuras: hueco declarado, NO funcional (requiere las 3 firmas).
  const RESERVED = [
    { id: 'pnj',   glyph: '☺', name: 'PNJ',    stage: 'OBJP-2',   hint: 'Rutinas y roles de PNJ — OBJP-2, congelado' },
    { id: 'event', glyph: '✦', name: 'Evento', stage: 'OBJP-2',   hint: 'Disparadores de evento por sala — OBJP-2, congelado' },
    { id: 'zone',  glyph: '▩', name: 'Zona',   stage: 'OBJP-1.1', hint: 'Zonas de trabajo / hitos de fase — OBJP-1.1, congelado' }
  ];

  // Paleta alineada con el chrome (index.html): neutros sesgados a azul y el
  // brillo reservado a lo ACTIVO. Cian = acento del kit del equipo.
  const PAL = {
    rail: 'rgba(9,15,24,0.94)', railLine: '#1c3040', railGlow: 'rgba(98,224,239,0.20)',
    slot: '#0d1622', slotDeep: '#0a121c', slotLine: '#24405a', slotHover: '#2c536b',
    accent: '#62e0ef', accentDeep: '#3fc4d6', accentInk: '#04161d',
    glyph: '#cfe2ec', glyphOff: '#3f5164',
    key: '#7d94a8', locked: 'rgba(28,48,64,0.35)',
    text: '#dceaf2', muted: '#7d94a8'
  };

  const byId = (id) => TOOLS.find(t => t.id === id) || null;
  const byKey = (k) => TOOLS.find(t => t.key === k) || null;

  // ¿la herramienta aplica en la sección actual de la suite?
  function isAvailable(tool, ctx) {
    if (!tool) return false;
    const section = (ctx && ctx.section) || 'nexo';
    return tool.sections.indexOf(section) >= 0;
  }

  // Todas las herramientas se dibujan SIEMPRE (la tecla no se mueve);
  // las que no aplican salen apagadas.
  function slotsFor() {
    return TOOLS.map(t => ({ tool: t, locked: false }))
      .concat(RESERVED.map(t => ({ tool: t, locked: true })));
  }

  /*
   * Geometría de la barra: fila de rombos centrada abajo. Devuelve un slot por
   * herramienta con su centro y semiejes, para dibujar y para el hit-test.
   * El rombo va ligeramente achatado en Y, como los tiles de la vista ¾.
   */
  function layout(w, h, opts) {
    opts = opts || {};
    const items = slotsFor();
    const scale = Math.min(1, w / 1180);
    const hw = Math.round((opts.hw || 32) * scale);
    const hh = Math.round((opts.hh || 24) * scale);
    const gap = Math.round((opts.gap || 7) * scale);
    const pitch = hw * 2 + gap;
    const bottom = opts.bottom == null ? 26 : opts.bottom;
    const cy = Math.round(h - bottom - hh);
    const totalW = pitch * items.length - gap;
    // `left` = ancho del panel lateral: la barra se centra en el ÁREA LIBRE,
    // no en el lienzo entero, o queda pisada por el panel de la suite.
    const left = Math.max(0, Math.min(opts.left || 0, w - totalW));
    const x0 = Math.round(left + (w - left - totalW) / 2 + hw);

    const slots = items.map((it, i) => ({
      id: it.tool.id, tool: it.tool, locked: it.locked, index: i,
      cx: x0 + i * pitch, cy, hw, hh
    }));
    return {
      slots, hw, hh, cy, scale,
      rail: { x: x0 - hw - 10, y: cy - hh - 9, w: totalW + 20, h: hh * 2 + 18 }
    };
  }

  // rombo = |dx|/hw + |dy|/hh <= 1
  function hitTest(lay, px, py) {
    for (const s of lay.slots) {
      const dx = Math.abs(px - s.cx) / s.hw, dy = Math.abs(py - s.cy) / s.hh;
      if (dx + dy <= 1) return s;
    }
    return null;
  }
  // ¿el puntero está sobre la barra (para no pintar el mapa por debajo)?
  function inBar(lay, px, py) {
    const r = lay.rail;
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }

  /*
   * Degradado vertical tolerante: si el contexto no sabe hacer gradientes
   * (mocks, contextos reducidos), cae a color plano en vez de reventar.
   * El dibujo nunca debe ser el motivo de que se caiga la suite.
   */
  function vgrad(ctx, x, y0, y1, from, to) {
    if (typeof ctx.createLinearGradient !== 'function') return from;
    const g = ctx.createLinearGradient(x, y0, x, y1);
    if (!g || typeof g.addColorStop !== 'function') return from;
    g.addColorStop(0, from); g.addColorStop(1, to);
    return g;
  }

  function diamond(ctx, s, inset) {
    const hw = s.hw - (inset || 0), hh = s.hh - (inset || 0);
    ctx.beginPath();
    ctx.moveTo(s.cx, s.cy - hh);
    ctx.lineTo(s.cx + hw, s.cy);
    ctx.lineTo(s.cx, s.cy + hh);
    ctx.lineTo(s.cx - hw, s.cy);
    ctx.closePath();
  }

  /*
   * draw(ctx, w, h, { active, hoverId, section })
   * Devuelve el layout usado, para que quien llama reutilice el hit-test sin
   * recalcularlo.
   */
  function draw(ctx, w, h, opts) {
    opts = opts || {};
    const lay = layout(w, h, opts);
    const section = opts.section || 'nexo';

    const cxBar = lay.rail.x + lay.rail.w / 2;

    ctx.save();
    // raíl con chaflán (misma silueta que el chrome, tomada del kit)
    const r = lay.rail;
    const cut = Math.max(6, Math.round(9 * lay.scale));
    ctx.beginPath();
    ctx.moveTo(r.x + cut, r.y);
    ctx.lineTo(r.x + r.w, r.y);
    ctx.lineTo(r.x + r.w, r.y + r.h - cut);
    ctx.lineTo(r.x + r.w - cut, r.y + r.h);
    ctx.lineTo(r.x, r.y + r.h);
    ctx.lineTo(r.x, r.y + cut);
    ctx.closePath();
    ctx.fillStyle = PAL.rail;
    ctx.fill();
    ctx.strokeStyle = PAL.railLine; ctx.lineWidth = 1; ctx.stroke();
    // filo superior encendido: el raíl parece alimentado
    ctx.strokeStyle = PAL.railGlow;
    ctx.beginPath();
    ctx.moveTo(r.x + cut, r.y + 0.5); ctx.lineTo(r.x + r.w, r.y + 0.5);
    ctx.stroke();

    for (const s of lay.slots) {
      const active = !s.locked && s.id === opts.active;
      const usable = !s.locked && isAvailable(s.tool, { section });
      const hover = !s.locked && s.id === opts.hoverId && usable;

      diamond(ctx, s, 0);
      if (s.locked) {
        ctx.fillStyle = PAL.locked;
        ctx.fill();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = PAL.glyphOff;
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        if (active) {
          ctx.fillStyle = vgrad(ctx, s.cx, s.cy - s.hh, s.cy + s.hh, PAL.accent, PAL.accentDeep);
          ctx.shadowColor = PAL.accent; ctx.shadowBlur = 16 * lay.scale;
        } else {
          ctx.fillStyle = vgrad(ctx, s.cx, s.cy - s.hh, s.cy + s.hh, PAL.slot, PAL.slotDeep);
        }
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = active ? PAL.accent : (hover ? PAL.slotHover : PAL.slotLine);
        ctx.lineWidth = active ? 2 : 1;
        ctx.stroke();
        // faceta interior: da volumen al rombo sin añadir ruido
        if (!active) {
          diamond(ctx, s, Math.max(3, 4 * lay.scale));
          ctx.strokeStyle = hover ? 'rgba(98,224,239,0.30)' : 'rgba(98,224,239,0.09)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // glifo
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = Math.round(17 * lay.scale) + 'px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = active ? PAL.accentInk : (usable ? PAL.glyph : PAL.glyphOff);
      ctx.fillText(s.tool.glyph, s.cx, s.cy + 1);

      // número de tecla (solo herramientas reales; las reservadas no la gastan)
      if (!s.locked) {
        ctx.font = '700 ' + Math.round(9.5 * lay.scale) + 'px ui-monospace, monospace';
        ctx.fillStyle = active ? PAL.accentInk : PAL.key;
        ctx.fillText(s.tool.key, s.cx + s.hw * 0.46, s.cy - s.hh * 0.40);
      }
    }

    // etiqueta: herramienta activa + pista de uso
    const cur = byId(opts.active);
    const hov = opts.hoverId ? (byId(opts.hoverId) || RESERVED.find(t => t.id === opts.hoverId)) : null;
    const show = hov || cur;
    if (show) {
      const blocked = hov && RESERVED.indexOf(hov) >= 0;
      const off = !blocked && show.sections && !isAvailable(show, { section });
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.font = '700 ' + Math.round(11 * lay.scale) + 'px ui-monospace, "DejaVu Sans Mono", monospace';
      ctx.fillStyle = blocked || off ? PAL.muted : PAL.accent;
      const tag = show.name.toUpperCase() +
        (blocked ? '  ·  BLOQUEADO (' + show.stage + ')' : (show.key ? '  ·  [' + show.key + ']' : ''));
      ctx.fillText(tag, cxBar, r.y - 15);
      ctx.font = Math.round(10 * lay.scale) + 'px ui-monospace, "DejaVu Sans Mono", monospace';
      ctx.fillStyle = PAL.muted;
      ctx.fillText(off ? 'Solo en la sección DISEÑAR NEXO' : show.hint, cxBar, r.y - 2);
    }
    ctx.restore();
    return lay;
  }

  return { TOOLS, RESERVED, PAL, byId, byKey, isAvailable, slotsFor, layout, hitTest, inBar, draw };
});
