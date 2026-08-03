/* =============================================================================
 * preview.js — Preview view: browse students, zoom, search, and per-student
 * editing (field text + photo replace / rotate / flip / fit / brightness /
 * contrast / saturation / scale / position).
 * =========================================================================== */
(function (IDCS) {
  'use strict';
  var U = IDCS.U, Store = IDCS.Store;
  var zoom = 0.42, bg = null, container = null;

  function filtered() {
    var s = Store.get(); var f = s.filters;
    var q = U.norm(f.text);
    return s.students.map(function (st, i) { return { st: st, i: i }; }).filter(function (o) {
      var d = o.st.data;
      if (f.std && U.norm(d.std) !== U.norm(f.std)) return false;
      if (f.div && U.norm(d.div) !== U.norm(f.div)) return false;
      if (!q) return true;
      return [d.name, d.cid, d.std, d.div, d.grno].some(function (v) { return U.norm(v).indexOf(q) !== -1; });
    });
  }

  function mount(host) {
    container = host;
    var s = Store.get();
    host.innerHTML = '';
    if (!s.students.length) { host.appendChild(emptyState()); return; }

    var wrap = U.el('div', { class: 'preview-wrap' });

    // ---- left: student list + search/filter
    var left = U.el('div', { class: 'panel', style: 'display:flex;flex-direction:column;min-height:0' });
    left.appendChild(U.el('div', { class: 'body', style: 'border-bottom:1px solid var(--line)' }, [
      U.el('input', { class: 'inp', type: 'search', placeholder: 'Search name / C-ID / class…', value: s.filters.text,
        oninput: function (e) { Store.commit(function (st) { st.filters.text = e.target.value; }, { noHistory: true }); renderList(); } }),
      U.el('div', { class: 'row', style: 'margin-top:8px' }, [
        U.el('input', { class: 'inp', style: 'flex:1', placeholder: 'Class', value: s.filters.std,
          oninput: function (e) { Store.commit(function (st) { st.filters.std = e.target.value; }, { noHistory: true }); renderList(); } }),
        U.el('input', { class: 'inp', style: 'flex:1', placeholder: 'Div', value: s.filters.div,
          oninput: function (e) { Store.commit(function (st) { st.filters.div = e.target.value; }, { noHistory: true }); renderList(); } })
      ])
    ]));
    var list = U.el('div', { class: 'stu-list body', id: 'stuList', style: 'flex:1;min-height:0' });
    left.appendChild(list);

    // ---- middle: card canvas + toolbar
    var mid = U.el('div', { class: 'panel', style: 'min-height:0' });
    mid.appendChild(U.el('div', { class: 'body preview-stage' }, [
      U.el('div', { class: 'pv-toolbar' }, [
        btn('◀ Prev', function () { step(-1); }),
        U.el('span', { id: 'pvPos', class: 'help' }),
        btn('Next ▶', function () { step(1); }),
        U.el('span', { class: 'divider' }),
        btn('－', function () { zoom = U.clamp(zoom - 0.06, 0.15, 1.2); draw(); }),
        U.el('span', { id: 'pvZoom', class: 'help' }),
        btn('＋', function () { zoom = U.clamp(zoom + 0.06, 0.15, 1.2); draw(); })
      ]),
      U.el('canvas', { id: 'pvCanvas' })
    ]));

    // ---- right: edit panel
    var right = U.el('div', { class: 'panel editpanel', id: 'editPanel' });

    wrap.appendChild(left); wrap.appendChild(mid); wrap.appendChild(right);
    host.appendChild(wrap);

    IDCS.Renderer.loadImage(s.templateSrc).then(function (img) { bg = img; renderList(); draw(); renderEditPanel(); });
  }

  function btn(label, on) { return U.el('button', { class: 'btn small', onclick: on, text: label }); }

  function renderList() {
    var host = U.$('#stuList'); if (!host) return;
    host.innerHTML = '';
    var items = filtered(); var sel = Store.get().selection;
    U.$('#pvPos') && (U.$('#pvPos').textContent = (items.findIndex(function (o) { return o.i === sel; }) + 1) + ' / ' + items.length);
    items.forEach(function (o) {
      var d = o.st.data;
      var row = U.el('div', { class: 'stu' + (o.i === sel ? ' sel' : ''), onclick: function () { select(o.i); } }, [
        o.st.photoUrl ? U.el('img', { class: 'th', src: o.st.photoUrl }) : U.el('div', { class: 'th' }),
        U.el('div', {}, [
          U.el('div', { class: 'nm', text: d.name || '(no name)' }),
          U.el('div', { class: 'sub', text: 'C-ID ' + (d.cid || '—') + ' · ' + (d.std || '') + (d.div ? '-' + d.div : '') })
        ])
      ]);
      host.appendChild(row);
    });
  }

  function select(i) { Store.commit(function (s) { s.selection = i; }, { noHistory: true }); renderList(); draw(); renderEditPanel(); }

  function step(dir) {
    var items = filtered(); if (!items.length) return;
    var pos = items.findIndex(function (o) { return o.i === Store.get().selection; });
    pos = U.clamp(pos + dir, 0, items.length - 1);
    select(items[pos].i);
  }

  function draw() {
    var s = Store.get(); var cv = U.$('#pvCanvas'); if (!cv || !s.students[s.selection]) return;
    var student = s.students[s.selection];
    U.$('#pvZoom') && (U.$('#pvZoom').textContent = Math.round(zoom * 100) + '%');
    cv.width = Math.round(IDCS.CARD_W * zoom); cv.height = Math.round(IDCS.CARD_H * zoom);
    var ctx = cv.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    ctx.scale(zoom, zoom);
    IDCS.Renderer.preload(s.templateSrc, [student]).then(function () {
      IDCS.Renderer.renderCard(ctx, bg, s.fields, student);
    });
  }

  /* Right-hand per-student editor. */
  function renderEditPanel() {
    var host = U.$('#editPanel'); if (!host) return;
    var s = Store.get(); var student = s.students[s.selection]; if (!student) { host.innerHTML = ''; return; }
    var ov = student.overrides.photo = student.overrides.photo || {};
    host.innerHTML = '';
    host.appendChild(U.el('h2', { text: 'Edit — ' + (student.data.name || 'student') }));
    var b = U.el('div', { class: 'body' });

    // editable text fields
    b.appendChild(U.el('div', { class: 'section-title', text: 'Field values' }));
    s.fields.filter(function (f) { return f.bind && f.type === 'text'; }).forEach(function (f) {
      b.appendChild(U.el('div', { class: 'prop-row' }, [
        U.el('label', { text: f.label.replace(' (value)', '') }),
        U.el('input', { type: 'text', value: student.data[f.bind] || '',
          oninput: function (e) { student.data[f.bind] = e.target.value; Store.touch(); draw(); renderList(); } })
      ]));
    });

    // photo tools
    b.appendChild(U.el('div', { class: 'spacer' }));
    b.appendChild(U.el('div', { class: 'section-title', text: 'Photo' }));
    b.appendChild(U.el('div', { class: 'row', style: 'margin-bottom:10px' }, [
      fileBtn('Replace', 'image/*', function (file) { IDCS.Photos.setPhoto(student, file).then(function () { Store.touch(); draw(); renderList(); }); }),
      btn('Rotate 90°', function () { ov.imgRotation = ((ov.imgRotation || 0) + 90) % 360; Store.touch(); draw(); }),
      btn('Flip H', function () { ov.flipH = !ov.flipH; Store.touch(); draw(); }),
      btn('Flip V', function () { ov.flipV = !ov.flipV; Store.touch(); draw(); })
    ]));
    b.appendChild(U.el('div', { class: 'prop-row' }, [
      U.el('label', { text: 'Fit' }),
      selectEl(['cover', 'contain', 'fill'], ov.fit || 'cover', function (v) { ov.fit = v; Store.touch(); draw(); })
    ]));
    [['brightness', 0.4, 1.8, 0.02], ['contrast', 0.4, 1.8, 0.02], ['saturation', 0, 2, 0.02],
     ['scale', 0.5, 2.5, 0.02], ['offsetX', -300, 300, 2], ['offsetY', -300, 300, 2]].forEach(function (row) {
      var key = row[0]; var def = key === 'offsetX' || key === 'offsetY' ? 0 : (key === 'scale' ? 1 : 1);
      var val = ov[key] != null ? ov[key] : def;
      var out = U.el('span', { text: (+val).toFixed(2) });
      b.appendChild(U.el('div', { class: 'slider-row' }, [
        U.el('span', { text: key }),
        U.el('input', { type: 'range', min: row[1], max: row[2], step: row[3], value: val,
          oninput: function (e) { ov[key] = parseFloat(e.target.value); out.textContent = ov[key].toFixed(2); Store.touch(); draw(); } }),
        out
      ]));
    });
    b.appendChild(U.el('button', { class: 'btn small', style: 'margin-top:6px', text: 'Reset photo adjustments',
      onclick: function () { student.overrides.photo = {}; Store.touch(); draw(); renderEditPanel(); } }));

    host.appendChild(b);
  }

  function fileBtn(label, accept, cb) {
    var inp = U.el('input', { type: 'file', accept: accept, style: 'display:none', onchange: function (e) { if (e.target.files[0]) cb(e.target.files[0]); } });
    var b = U.el('button', { class: 'btn small', text: label, onclick: function () { inp.click(); } });
    b.appendChild(inp); return b;
  }
  function selectEl(opts, val, cb) {
    return U.el('select', { onchange: function (e) { cb(e.target.value); } },
      opts.map(function (o) { return U.el('option', { value: o, text: o, selected: o === val ? 'selected' : null }); }));
  }
  function emptyState() {
    return U.el('div', { class: 'panel' }, [U.el('div', { class: 'body help', html: 'No students yet. Go to <b>Data</b> and upload your Excel file and photos first.' })]);
  }

  IDCS.Preview = {
    mount: mount,
    step: step,
    refresh: function () { if (container) { renderList(); draw(); renderEditPanel(); } }
  };
})(window.IDCS = window.IDCS || {});
