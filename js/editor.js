/* =============================================================================
 * editor.js — Visual drag-and-drop template field editor.
 *
 * Renders the fixed background with a live sample student, overlays draggable /
 * resizable boxes for every field, and exposes a full property inspector
 * (position, size, rotation, opacity, font, weight, italic, underline, colour,
 * alignment, spacing, line-height, transform, fit, radius, border, QR/barcode…).
 * =========================================================================== */
(function (IDCS) {
  'use strict';
  var U = IDCS.U, Store = IDCS.Store;
  var scale = 0.3, bg = null, selId = null, sample = null, host = null;

  function sampleStudent() {
    var s = Store.get();
    if (s.students.length) return s.students[Store.get().selection] || s.students[0];
    // synthetic sample so the editor is usable before data is loaded
    return { data: { name: 'STUDENT FULL NAME', std: '9', div: 'A', dob: '05-Jun-2012', grno: 'S6561',
      mob: '8591038216, 9930453594', address: '135, Gurukrupa Satyam, 10th floor, Vikhroli (E), Mumbai.', cid: '627240' },
      photoUrl: null, overrides: {} };
  }

  function mount(container) {
    host = container; sample = sampleStudent();
    container.innerHTML = '';
    var wrap = U.el('div', { class: 'editor-wrap' });

    var stage = U.el('div', { class: 'stage' });
    var inner = U.el('div', { class: 'stage-inner', id: 'stageInner' });
    inner.appendChild(U.el('canvas', { id: 'edCanvas' }));
    inner.appendChild(U.el('div', { id: 'boxLayer', style: 'position:absolute;inset:0' }));
    stage.appendChild(inner);

    var side = U.el('div', { class: 'panel props' });
    side.appendChild(U.el('h2', { text: 'Fields' }));
    var sb = U.el('div', { class: 'body' });
    sb.appendChild(U.el('div', { class: 'field-list', id: 'fieldList' }));
    sb.appendChild(U.el('div', { class: 'row', style: 'margin-bottom:8px' }, [
      U.el('button', { class: 'btn small', text: '+ Text', onclick: function () { addField('text'); } }),
      U.el('button', { class: 'btn small', text: '+ Image', onclick: function () { addField('image'); } }),
      U.el('button', { class: 'btn small', text: '+ QR', onclick: function () { addField('qr'); } }),
      U.el('button', { class: 'btn small', text: '+ Barcode', onclick: function () { addField('barcode'); } })
    ]));
    sb.appendChild(U.el('div', { class: 'row', style: 'margin-bottom:12px' }, [
      U.el('button', { class: 'btn small', title: 'Restore the exact original card layout & styling',
        text: '↺ Reset to design default', onclick: function () {
          Store.commit(function (st) { st.fields = IDCS.clonePresetFields(); st.fieldsVersion = IDCS.PRESET_VERSION; });
          selId = null; draw(); renderBoxes(); renderFieldList(); renderInspector(); IDCS.U.toast('Fields reset to the original design', 'success');
        } })
    ]));
    sb.appendChild(U.el('div', { id: 'propInspector' }));
    side.appendChild(sb);

    wrap.appendChild(stage); wrap.appendChild(side);
    container.appendChild(wrap);

    IDCS.Renderer.loadImage(Store.get().templateSrc).then(function (img) {
      bg = img; fitScale(stage); draw(); renderBoxes(); renderFieldList(); renderInspector();
    });
  }

  function fitScale(stage) {
    var avail = Math.min(stage.clientWidth - 60, 520);
    scale = U.clamp(avail / IDCS.CARD_W, 0.18, 0.5);
  }

  function draw() {
    var cv = U.$('#edCanvas'); if (!cv) return;
    cv.width = Math.round(IDCS.CARD_W * scale); cv.height = Math.round(IDCS.CARD_H * scale);
    var ctx = cv.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.scale(scale, scale);
    IDCS.Renderer.preload(Store.get().templateSrc, [sample]).then(function () {
      IDCS.Renderer.renderCard(ctx, bg, Store.get().fields, sample);
    });
    var inner = U.$('#stageInner'); if (inner) { inner.style.width = cv.width + 'px'; inner.style.height = cv.height + 'px'; }
  }

  /* Display box (screen px) for a field. */
  function boxOf(f) {
    if (f.type !== 'text') return { x: f.x, y: f.y, w: f.w || 200, h: f.h || 200 };
    var w = f.w || f.maxWidth || 300;
    var h = (f.fontSize || 40) * 1.25;
    var x = f.align === 'center' ? f.x + (f.w ? 0 : 0) : f.x;
    // baseline y -> top of box
    return { x: f.x, y: f.y - (f.fontSize || 40), w: w, h: h };
  }

  function renderBoxes() {
    var layer = U.$('#boxLayer'); if (!layer) return; layer.innerHTML = '';
    Store.get().fields.forEach(function (f) {
      var b = boxOf(f);
      var el = U.el('div', { class: 'fieldbox' + (f.id === selId ? ' sel' : ''),
        style: 'left:' + (b.x * scale) + 'px;top:' + (b.y * scale) + 'px;width:' + (b.w * scale) + 'px;height:' + (b.h * scale) + 'px;' });
      el.dataset.id = f.id;
      var handle = U.el('div', { class: 'handle' });
      el.appendChild(handle);
      layer.appendChild(el);
      makeDraggable(el, handle, f);
    });
  }

  function makeDraggable(el, handle, f) {
    var mode = null, sx, sy, ox, oy, ow, oh;
    // Pointer events unify mouse + touch (touch-action:none prevents page scroll).
    el.addEventListener('pointerdown', function (e) {
      if (e.target === handle) return;
      selId = f.id; renderFieldList(); renderInspector(); highlight();
      mode = 'move'; sx = e.clientX; sy = e.clientY; ox = f.x; oy = f.y;
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    handle.addEventListener('pointerdown', function (e) {
      selId = f.id; mode = 'resize'; sx = e.clientX; sy = e.clientY;
      ow = f.w || f.maxWidth || 200; oh = f.h || (f.fontSize || 40) * 1.25;
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault(); e.stopPropagation();
    });
    function onMove(e) {
      if (!mode) return;
      var dx = (e.clientX - sx) / scale, dy = (e.clientY - sy) / scale;
      if (mode === 'move') {
        f.x = Math.round(ox + dx); f.y = Math.round(oy + dy);
        el.style.left = (boxOf(f).x * scale) + 'px'; el.style.top = (boxOf(f).y * scale) + 'px';
      } else {
        if (f.type === 'text') { f.maxWidth = Math.max(40, Math.round(ow + dx)); if (f.autoShrink) f.w = f.maxWidth; }
        else { f.w = Math.max(20, Math.round(ow + dx)); f.h = Math.max(20, Math.round(oh + dy)); }
        el.style.width = (boxOf(f).w * scale) + 'px'; el.style.height = (boxOf(f).h * scale) + 'px';
      }
    }
    function onUp() {
      if (mode) { Store.commit(function () {}, { event: 'fields' }); draw(); renderInspector(); }
      mode = null;
    }
    el.addEventListener('pointermove', onMove);
    handle.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    handle.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  function highlight() { U.$$('.fieldbox').forEach(function (el) { el.classList.toggle('sel', el.dataset.id === selId); }); }

  function renderFieldList() {
    var host = U.$('#fieldList'); if (!host) return; host.innerHTML = '';
    Store.get().fields.forEach(function (f) {
      host.appendChild(U.el('div', { class: 'fl' + (f.id === selId ? ' sel' : ''), onclick: function () { selId = f.id; renderFieldList(); renderInspector(); highlight(); } }, [
        U.el('span', { text: ({ text: '🅃', image: '🖼', qr: '▦', barcode: '❘❘❘' })[f.type] || '•' }),
        U.el('span', { style: 'flex:1', text: f.label || f.id }),
        U.el('span', { style: 'cursor:pointer;color:var(--muted)', text: f.hidden ? '🚫' : '👁',
          onclick: function (e) { e.stopPropagation(); f.hidden = !f.hidden; Store.commit(function () {}); draw(); renderFieldList(); } })
      ]));
    });
  }

  /* Property inspector for the selected field. */
  function renderInspector() {
    var host = U.$('#propInspector'); if (!host) return; host.innerHTML = '';
    var f = Store.get().fields.find(function (x) { return x.id === selId; });
    if (!f) { host.appendChild(U.el('div', { class: 'help', text: 'Select a field to edit its properties.' })); return; }

    host.appendChild(U.el('div', { class: 'section-title', text: f.label || f.id }));
    num('X', 'x'); num('Y', 'y');
    if (f.type !== 'text') { num('Width', 'w'); num('Height', 'h'); }
    else { num('Max width', 'maxWidth'); }
    num('Rotation', 'rotation'); range('Opacity', 'opacity', 0, 1, 0.05);

    if (f.type === 'text') {
      var cols = Store.get().columns;
      host.appendChild(row('Bind', selectC(['(static)'].concat(bindOptions()), f.bind || '(static)', function (v) { f.bind = v === '(static)' ? null : v; commit(); })));
      if (!f.bind) host.appendChild(row('Text', inputT(f.text, function (v) { f.text = v; commit(); })));
      host.appendChild(row('Prefix', inputT(f.prefix, function (v) { f.prefix = v; commit(); })));
      num('Font size', 'fontSize'); num('Line height', 'lineHeight'); num('Letter sp.', 'letterSpacing');
      host.appendChild(row('Colour', color(f.color, function (v) { f.color = v; commit(); })));
      host.appendChild(row('Align', selectC(['left', 'center', 'right'], f.align, function (v) { f.align = v; commit(); })));
      host.appendChild(row('Transform', selectC(['none', 'upper', 'lower', 'capitalize'], f.transform, function (v) { f.transform = v; commit(); })));
      host.appendChild(row('Style', toggles([
        ['B', 'bold'], ['I', 'italic'], ['U', 'underline'], ['Shrink', 'autoShrink']
      ], f)));
    } else if (f.type === 'image') {
      host.appendChild(row('Bind', selectC(bindOptions().concat(['photo']), f.bind || 'photo', function (v) { f.bind = v; commit(); })));
      host.appendChild(row('Fit', selectC(['cover', 'contain', 'fill'], f.fit, function (v) { f.fit = v; commit(); })));
      num('Radius', 'borderRadius'); num('Border', 'borderWidth');
      host.appendChild(row('Border col', color(f.borderColor || '#cccccc', function (v) { f.borderColor = v; commit(); })));
      host.appendChild(row('Shape', toggles([['Circle', 'circle']], f)));
    } else if (f.type === 'qr') {
      host.appendChild(row('QR data', inputT(f.qrData || '{cid}', function (v) { f.qrData = v; commit(); })));
      host.appendChild(row('ECC', selectC(['L', 'M', 'Q', 'H'], f.ecc, function (v) { f.ecc = v; commit(); })));
      host.appendChild(row('Dark', color(f.dark, function (v) { f.dark = v; commit(); })));
      host.appendChild(row('Light', color(f.light, function (v) { f.light = v; commit(); })));
      num('Margin', 'margin');
    } else if (f.type === 'barcode') {
      host.appendChild(row('Bind', selectC(bindOptions(), f.bind || 'cid', function (v) { f.bind = v; commit(); })));
      host.appendChild(row('Format', selectC(['CODE128', 'CODE39', 'EAN13', 'EAN8', 'UPC'], f.barFormat, function (v) { f.barFormat = v; commit(); })));
      host.appendChild(row('Show text', toggles([['Text', 'displayValue']], f)));
    }

    host.appendChild(U.el('button', { class: 'btn small danger', style: 'margin-top:12px',
      text: 'Delete field', onclick: function () {
        Store.commit(function (s) { s.fields = s.fields.filter(function (x) { return x.id !== f.id; }); });
        selId = null; draw(); renderBoxes(); renderFieldList(); renderInspector();
      } }));

    // --- local helpers bound to f ---
    function num(label, key) { host.appendChild(row(label, U.el('input', { type: 'number', value: f[key] != null ? f[key] : 0,
      oninput: function (e) { f[key] = parseFloat(e.target.value) || 0; commit(); } }))); }
    function range(label, key, mn, mx, st) { host.appendChild(row(label, U.el('input', { type: 'range', min: mn, max: mx, step: st, value: f[key] != null ? f[key] : 1,
      oninput: function (e) { f[key] = parseFloat(e.target.value); commitLive(); } }))); }
  }

  function commit() { Store.commit(function () {}, { event: 'fields' }); draw(); renderBoxes(); renderFieldList(); }
  function commitLive() { Store.touch(); draw(); renderBoxes(); }

  function bindOptions() {
    var canon = Object.keys(IDCS.FIELD_ALIASES);
    var cols = Store.get().columns.map(function (c) { return 'col:' + c; });
    return canon.concat(cols);
  }
  function addField(type) {
    var f = IDCS.makeField({ id: U.uid(), label: 'New ' + type, type: type,
      x: 200, y: type === 'text' ? 300 : 300, w: type === 'text' ? 0 : 200, h: type === 'text' ? 0 : 200,
      bind: type === 'image' ? 'photo' : (type === 'barcode' ? 'cid' : null),
      qrData: type === 'qr' ? '{cid}' : '', text: type === 'text' ? 'Text' : '' });
    Store.commit(function (s) { s.fields.push(f); });
    selId = f.id; draw(); renderBoxes(); renderFieldList(); renderInspector();
  }

  // small UI atoms
  function row(label, control) { return U.el('div', { class: 'prop-row' }, [U.el('label', { text: label }), control]); }
  function inputT(v, cb) { return U.el('input', { type: 'text', value: v || '', oninput: function (e) { cb(e.target.value); } }); }
  function color(v, cb) { return U.el('input', { type: 'color', value: v || '#000000', oninput: function (e) { cb(e.target.value); } }); }
  function selectC(opts, val, cb) { return U.el('select', { onchange: function (e) { cb(e.target.value); } },
    opts.map(function (o) { return U.el('option', { value: o, text: o, selected: o === val ? 'selected' : null }); })); }
  function toggles(defs, f) {
    return U.el('div', { class: 'toggles' }, defs.map(function (d) {
      return U.el('button', { class: f[d[1]] ? 'on' : '', text: d[0], onclick: function () { f[d[1]] = !f[d[1]]; commit(); } });
    }));
  }

  IDCS.Editor = { mount: mount, refresh: function () { if (host) { sample = sampleStudent(); draw(); renderBoxes(); } } };
})(window.IDCS = window.IDCS || {});
