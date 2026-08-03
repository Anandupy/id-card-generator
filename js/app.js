/* =============================================================================
 * app.js — application shell / orchestrator.
 * Wires the toolbar, sidebar navigation, Data + Export views, keyboard
 * shortcuts, theme, autosave indicator, and the generate pipeline.
 * =========================================================================== */
(function (IDCS) {
  'use strict';
  var U = IDCS.U, Store = IDCS.Store;
  var currentView = 'data';
  var genControl = { cancelled: false };
  var dlControl = { cancelled: false };
  var lastImageReport = { failed: [], missing: [] };
  // Friendly labels for the mapping table.
  var FIELD_LABELS = {
    name: 'Student Name', std: 'Std / Class', div: 'Division', dob: 'D.O.B',
    grno: 'Gr No', mob: 'Mob No (Parent 1)', mob2: 'Parent 2 No', address: 'Address',
    cid: 'C-ID', photo: 'Photo / Image URL'
  };

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    U.$('#genOverlay').hidden = true;   // ensure the progress overlay starts hidden
    // restore autosave if present
    Store.loadAutosave();
    var s = Store.get();
    document.documentElement.setAttribute('data-theme', s.theme || 'light');
    U.$('#projName').value = s.projectName;

    bindToolbar();
    bindNav();
    bindShortcuts();

    U.bus.on('state', function () { updateStats(); refreshActiveView(); });
    U.bus.on('autosaved', function () { var d = U.$('#autosaveDot'); d.classList.add('show'); setTimeout(function () { d.classList.remove('show'); }, 1400); });

    showView('data');
    updateStats();
    U.toast('Loaded preset: Shree Siddhi Vinayagar card', 'success');
  }

  /* ---------------- toolbar ---------------- */
  function bindToolbar() {
    U.$('#projName').addEventListener('input', function (e) { Store.commit(function (s) { s.projectName = e.target.value; }, { noHistory: true }); });
    U.$('#btnUndo').onclick = Store.undo;
    U.$('#btnRedo').onclick = Store.redo;
    U.$('#btnTheme').onclick = toggleTheme;
    U.$('#btnSave').onclick = function () { IDCS.Project.save(Store.get()); U.toast('Project saved', 'success'); };
    U.$('#btnOpen').onclick = openProject;
    U.$('#btnGenerate').onclick = function () { showView('export'); setTimeout(function () { generate(); }, 60); };
    U.$('#btnCancelGen').onclick = function () { genControl.cancelled = true; U.$('#genOverlay').hidden = true; };
  }

  function toggleTheme() {
    Store.commit(function (s) { s.theme = s.theme === 'dark' ? 'light' : 'dark'; }, { noHistory: true });
    document.documentElement.setAttribute('data-theme', Store.get().theme);
    U.$('#btnTheme').textContent = Store.get().theme === 'dark' ? '☀️' : '🌙';
  }

  function openProject() {
    pick('.idcs,application/json', false, function (files) {
      IDCS.Project.load(files[0]).then(function (p) { Store.hydrate(p); U.$('#projName').value = p.projectName || 'Project';
        document.documentElement.setAttribute('data-theme', p.theme || 'light'); U.toast('Project loaded', 'success'); showView('data');
      }).catch(function (e) { U.toast('Could not load project: ' + e.message, 'error'); });
    });
  }

  /* ---------------- navigation ---------------- */
  function bindNav() {
    U.$$('.nav-item').forEach(function (b) { b.onclick = function () { showView(b.dataset.view); }; });
  }
  function showView(view) {
    currentView = view;
    U.$$('.nav-item').forEach(function (b) { b.classList.toggle('active', b.dataset.view === view); });
    var host = U.$('#content'); host.innerHTML = '';
    if (view === 'data') renderData(host);
    else if (view === 'design') IDCS.Editor.mount(host);
    else if (view === 'preview') IDCS.Preview.mount(host);
    else if (view === 'export') renderExport(host);
  }
  function refreshActiveView() { if (currentView === 'preview' && IDCS.Preview.refresh) IDCS.Preview.refresh(); }

  /* ---------------- Data view ---------------- */
  function renderData(host) {
    var s = Store.get();
    var grid = U.el('div', { class: 'grid', style: 'grid-template-columns:1fr 1fr' });

    // Template
    var tpl = panel('1 · ID Card Template', [
      U.el('div', { class: 'row' }, [
        U.el('img', { src: s.templateSrc, style: 'width:120px;border-radius:8px;border:1px solid var(--line)' }),
        U.el('div', {}, [
          U.el('div', { style: 'font-weight:700', text: 'Baked preset active' }),
          U.el('div', { class: 'help', text: s.templateNative.w + ' × ' + s.templateNative.h + ' px — exact original design' }),
          U.el('div', { class: 'spacer' }),
          dropSmall('Replace template (PNG/JPG)', 'image/png,image/jpeg', false, onTemplate)
        ])
      ])
    ]);

    // Excel
    var xls = panel('2 · Student Data (Excel)', [
      dropzone('📄', 'Drop XLSX / XLS / CSV', 'Columns are auto-detected — no limit', '.xlsx,.xls,.csv', false, onExcel),
      U.el('div', { id: 'mapWrap' })
    ]);

    // Photos — Method 1 (local folder) + Method 2 (Excel Image URLs)
    var pho = panel('3 · Student Photos', [
      U.el('div', { class: 'section-title', text: 'Method 1 · Upload local folder' }),
      dropzone('🖼', 'Drop a photos folder', 'Auto-matched by C-ID / admission / roll / filename', 'image/*', true, onPhotos),
      U.el('div', { class: 'spacer' }),
      U.el('div', { class: 'section-title', text: 'Method 2 · Image URLs from Excel' }),
      U.el('div', { class: 'row', style: 'align-items:center' }, [
        U.el('button', { class: 'btn', id: 'btnFetchUrls', text: '⇩ Fetch images from URLs', onclick: fetchUrlImages }),
        U.el('button', { class: 'btn', title: 'Best for offline/file:// use — downloads photos outside the browser (no CORS issues)',
          text: '⤓ Get downloader script (.ps1)', onclick: function () {
            var s = Store.get(); if (!IDCS.Images.hasAnyUrls(s.students)) { U.toast('No image URLs found', 'warn'); return; }
            IDCS.Images.downloadPS1(s.students, 'download-photos'); U.toast('Saved download-photos.ps1 — right-click > Run with PowerShell', 'success');
          } }),
        U.el('span', { id: 'urlHint', class: 'help' })
      ]),
      U.el('div', { class: 'help', style: 'margin-top:6px',
        html: 'Opening the app via <b>file://</b> (double-click) blocks browser downloads. If “Fetch” fails, use the <b>.ps1 downloader</b> (no CORS issues) or run the app from a local web server.' }),
      U.el('div', { id: 'dlProgress', style: 'margin-top:10px' }),
      U.el('div', { id: 'photoWrap', class: 'help', style: 'margin-top:10px' })
    ]);

    // Validation
    var val = panel('4 · Validation Report', [U.el('div', { id: 'valWrap' }, [U.el('div', { class: 'help', text: 'Load data to see the report.' })])]);

    grid.appendChild(tpl); grid.appendChild(xls); grid.appendChild(pho); grid.appendChild(val);
    host.appendChild(grid);

    if (s.columns.length) renderMapping();
    if (s.students.length) { renderPhotoSummary(); renderValidation(); }
  }

  function onTemplate(files) {
    U.fileToDataURL(files[0]).then(function (url) {
      var img = new Image();
      img.onload = function () {
        Store.commit(function (s) { s.templateSrc = url; s.templateNative = { w: img.naturalWidth, h: img.naturalHeight }; });
        IDCS.CARD_W = img.naturalWidth; IDCS.CARD_H = img.naturalHeight;
        U.toast('Template replaced — arrange fields in Design', 'success'); showView('design');
      };
      img.src = url;
    });
  }

  function onExcel(files) {
    setStatus('Parsing spreadsheet…');
    IDCS.Excel.load(files[0]).then(function (r) {
      Store.commit(function (s) { s.columns = r.columns; s.mapping = r.mapping; s.students = r.students; s.selection = 0; });
      // re-attach photos already loaded (if any) by re-matching would need files; skip
      setStatus('Loaded ' + r.students.length + ' students, ' + r.columns.length + ' columns');
      U.toast('Loaded ' + r.students.length + ' students', 'success');
      renderMapping(); renderValidation();
    }).catch(function (e) { U.toast('Excel error: ' + e.message, 'error'); });
  }

  function onPhotos(files) {
    var s = Store.get();
    if (!s.students.length) { U.toast('Load the Excel file first', 'warn'); return; }
    setStatus('Matching ' + files.length + ' photos…');
    IDCS.Photos.match(files, s.students).then(function (res) {
      Store.commit(function (st) { st.unmatchedPhotos = res.unmatched; });
      setStatus('Matched ' + res.matched + ' of ' + res.total + ' photos');
      U.toast('Matched ' + res.matched + ' photos (' + res.unmatched.length + ' unmatched)', res.unmatched.length ? 'warn' : 'success');
      renderPhotoSummary(); renderValidation();
    });
  }

  function renderMapping() {
    var wrap = U.$('#mapWrap'); if (!wrap) return; var s = Store.get();
    var tbl = U.el('table', { class: 'map' });
    tbl.appendChild(U.el('tr', {}, [th('Field'), th('Mapped column'), th('')]));
    Object.keys(IDCS.FIELD_ALIASES).forEach(function (bind) {
      var sel = U.el('select', { onchange: function (e) { Store.commit(function (st) { st.mapping[bind] = e.target.value || null; remapStudents(st); }); renderValidation(); IDCS.Preview.refresh && IDCS.Preview.refresh(); } },
        [U.el('option', { value: '', text: '— none —' })].concat(s.columns.map(function (c) {
          return U.el('option', { value: c, text: c, selected: s.mapping[bind] === c ? 'selected' : null });
        })));
      var ok = s.mapping[bind];
      tbl.appendChild(U.el('tr', {}, [
        U.el('td', { text: FIELD_LABELS[bind] || bind }),
        U.el('td', {}, [sel]),
        U.el('td', {}, [U.el('span', { class: 'badge ' + (ok ? 'ok' : 'warn'), text: ok ? 'mapped' : 'unset' })])
      ]));
    });
    wrap.innerHTML = ''; wrap.appendChild(U.el('div', { class: 'spacer' }));
    wrap.appendChild(U.el('div', { class: 'section-title', text: 'Column mapping (auto-detected)' }));
    wrap.appendChild(tbl);
  }
  function remapStudents(st) {
    st.students.forEach(function (stu) {
      Object.keys(st.mapping).forEach(function (b) { if (st.mapping[b]) stu.data[b] = stu.data['col:' + st.mapping[b]] || ''; });
      // Recombine Parent 1 + Parent 2 into Mob No after any mapping change.
      var p1 = st.mapping.mob ? (stu.data['col:' + st.mapping.mob] || '') : '';
      var p2 = st.mapping.mob2 ? (stu.data['col:' + st.mapping.mob2] || '') : '';
      stu.data.mob = IDCS.Excel.combineMobile(p1, p2);
    });
  }

  function renderPhotoSummary() {
    var wrap = U.$('#photoWrap'); if (!wrap) return; var s = Store.get();
    var withPhoto = s.students.filter(function (x) { return x.photoUrl; }).length;
    var urlCount = s.students.filter(function (x) { return !x.photoUrl && IDCS.Images.urlFor(x); }).length;
    var hint = U.$('#urlHint');
    if (hint) hint.textContent = IDCS.Images.hasAnyUrls(s.students)
      ? (urlCount ? urlCount + ' student(s) have a URL to download' : 'all URL images loaded')
      : 'no Image-URL column detected';
    wrap.innerHTML = '';
    wrap.appendChild(U.el('div', { class: 'row' }, [
      U.el('span', { class: 'badge ok', text: withPhoto + ' with photo' }),
      U.el('span', { class: 'badge warn', text: (s.students.length - withPhoto) + ' missing' }),
      U.el('span', { class: 'badge err', text: (s.unmatchedPhotos.length) + ' extra local' })
    ]));
    if (lastImageReport.failed.length || IDCS.Images.missingImageList(s.students).length) {
      var missing = IDCS.Images.missingImageList(s.students);
      wrap.appendChild(U.el('div', { class: 'row', style: 'margin-top:8px' }, [
        U.el('span', { class: 'badge err', text: lastImageReport.failed.length + ' failed downloads' }),
        U.el('button', { class: 'btn small', text: 'Report CSV', onclick: function () { IDCS.Images.exportReportCSV(lastImageReport.failed, missing, 'image_report'); } }),
        U.el('button', { class: 'btn small', text: 'Report Excel', onclick: function () { IDCS.Images.exportReportXLSX(lastImageReport.failed, missing, 'image_report'); } })
      ]));
    }
  }

  /* Method 2 — download images from the Excel URL column (local photos win). */
  function fetchUrlImages() {
    var s = Store.get();
    if (!s.students.length) { U.toast('Load the Excel file first', 'warn'); return; }
    if (!IDCS.Images.hasAnyUrls(s.students)) { U.toast('No image URLs found in this Excel', 'warn'); return; }
    var box = U.$('#dlProgress'); dlControl = { cancelled: false };
    box.innerHTML = '';
    var bar = U.el('div', { class: 'bar' });
    var txt = U.el('div', { class: 'help', style: 'margin-top:4px' , text: 'Starting…' });
    box.appendChild(U.el('div', { class: 'progress', style: 'margin:0' }, [bar]));
    box.appendChild(txt);
    box.appendChild(U.el('button', { class: 'btn small', style: 'margin-top:6px', text: 'Cancel', onclick: function () { dlControl.cancelled = true; } }));
    U.$('#btnFetchUrls').disabled = true;

    IDCS.Images.downloadAll(s.students, {
      control: dlControl,
      onProgress: function (p) {
        bar.style.width = Math.round(p.done / p.total * 100) + '%';
        txt.textContent = 'Downloading images  ' + p.done + ' / ' + p.total + '   ·   ~' + p.eta + 's remaining';
      }
    }).then(function (res) {
      lastImageReport = { failed: res.failed, missing: IDCS.Images.missingImageList(s.students) };
      U.$('#btnFetchUrls').disabled = false;
      txt.textContent = 'Done — ' + res.downloaded + ' downloaded, ' + res.failed.length + ' failed';
      Store.touch();
      if (res.downloaded === 0 && res.failed.length)
        U.toast('Browser blocked downloads (file:// / CORS). Use the “.ps1 downloader” button instead.', 'error');
      else
        U.toast(res.downloaded + ' images downloaded' + (res.failed.length ? ', ' + res.failed.length + ' failed' : ''), res.failed.length ? 'warn' : 'success');
      renderPhotoSummary(); renderValidation(); updateStats(); IDCS.Preview.refresh && IDCS.Preview.refresh();
    }).catch(function (e) { U.$('#btnFetchUrls').disabled = false; U.toast('Download error: ' + e.message, 'error'); });
  }

  function renderValidation() {
    var wrap = U.$('#valWrap'); if (!wrap) return;
    var rep = IDCS.Validation.run(Store.get());
    wrap.innerHTML = '';
    wrap.appendChild(U.el('div', { class: 'row', style: 'margin-bottom:10px' }, [
      U.el('span', { class: 'badge err', text: rep.counts.error + ' errors' }),
      U.el('span', { class: 'badge warn', text: rep.counts.warn + ' warnings' }),
      U.el('span', { class: 'badge ok', text: rep.withPhoto + '/' + rep.students + ' with photo' })
    ]));
    var list = U.el('div', { class: 'issues' });
    if (!rep.issues.length) list.appendChild(U.el('div', { class: 'help', text: 'No issues found ✓' }));
    rep.issues.slice(0, 300).forEach(function (it) {
      list.appendChild(U.el('div', { class: 'issue ' + it.level }, [
        U.el('span', { class: 'dot' }), U.el('span', { class: 'who', text: it.who }), U.el('span', { text: it.msg })
      ]));
    });
    wrap.appendChild(list);
    U.$('#issueSummary').textContent = rep.counts.error + ' err · ' + rep.counts.warn + ' warn';
  }

  /* ---------------- Export view ---------------- */
  function renderExport(host) {
    var s = Store.get(); var set = s.settings;
    var p = panel('Export settings', []);
    var b = p.querySelector('.body');

    b.appendChild(U.el('div', { class: 'section-title', text: 'Output mode' }));
    b.appendChild(tiles([['single', 'Single PDF'], ['individual-pdf', 'Individual PDFs (ZIP)'], ['png-zip', 'PNG images (ZIP)']], set.mode, function (v) { setSetting('mode', v); }));

    b.appendChild(U.el('div', { class: 'spacer' }));
    var opt = U.el('div', { class: 'opt-grid' });
    opt.appendChild(field('Page size', selectC(['A4', 'Letter', 'A3', 'custom'], set.pageSize, function (v) { setSetting('pageSize', v); })));
    opt.appendChild(field('Orientation', selectC(['portrait', 'landscape'], set.orientation, function (v) { setSetting('orientation', v); })));
    opt.appendChild(field('Columns', numI(set.cols, function (v) { setSetting('cols', v); })));
    opt.appendChild(field('Rows', numI(set.rows, function (v) { setSetting('rows', v); })));
    opt.appendChild(field('Gap X (mm)', numI(set.gapX, function (v) { setSetting('gapX', v); })));
    opt.appendChild(field('Gap Y (mm)', numI(set.gapY, function (v) { setSetting('gapY', v); })));
    opt.appendChild(field('Margin (mm)', numI(set.marginMM, function (v) { setSetting('marginMM', v); })));
    opt.appendChild(field('DPI', selectC(['150', '300', '600'], String(set.dpi), function (v) { setSetting('dpi', parseInt(v)); })));
    b.appendChild(opt);

    b.appendChild(U.el('div', { class: 'row', style: 'margin-top:10px' }, [
      checkbox('Rotate cards 90° (10 per A4 page)', set.rotateCards, function (v) { setSetting('rotateCards', v); }),
      checkbox('Crop marks', set.cropMarks, function (v) { setSetting('cropMarks', v); }),
      checkbox('Only filtered students', false, function (v) { host._onlyFiltered = v; })
    ]));

    b.appendChild(U.el('div', { class: 'spacer' }));
    b.appendChild(U.el('div', { id: 'layoutInfo', class: 'help' }));

    b.appendChild(U.el('div', { class: 'row', style: 'margin-top:16px' }, [
      U.el('button', { class: 'btn primary', text: 'Generate ' + labelForMode(set.mode), onclick: function () { host._generate = true; generate(host._onlyFiltered); } }),
      U.el('span', { class: 'divider' }),
      U.el('button', { class: 'btn', text: 'Export CSV', onclick: function () { IDCS.Project.exportCSV(Store.get()); } }),
      U.el('button', { class: 'btn', text: 'Export Excel', onclick: function () { IDCS.Project.exportXLSX(Store.get()); } }),
      U.el('button', { class: 'btn', text: 'Export JSON', onclick: function () { IDCS.Project.exportJSON(Store.get()); } })
    ]));

    host.appendChild(p);
    updateLayoutInfo();
  }

  function labelForMode(m) { return m === 'single' ? 'PDF' : (m === 'png-zip' ? 'PNG ZIP' : 'PDF ZIP'); }
  function setSetting(k, v) { Store.commit(function (s) { s.settings[k] = v; }, { noHistory: true }); updateLayoutInfo(); if (k === 'mode') showView('export'); }

  function updateLayoutInfo() {
    var el = U.$('#layoutInfo'); if (!el) return; var s = Store.get();
    var L = IDCS.PDF.layout(s.settings);
    var n = s.students.length; var pages = Math.ceil(n / L.perPage) || 0;
    el.innerHTML = '<b>' + L.perPage + '</b> cards/page · card ≈ ' + L.cardW.toFixed(0) + '×' + L.cardH.toFixed(0) + ' mm · <b>' + n + '</b> students → <b>' + pages + '</b> page(s)';
  }

  /* ---------------- generate pipeline ---------------- */
  function generate(onlyFiltered) {
    var s = Store.get();
    if (!s.students.length) { U.toast('No students to generate', 'warn'); showView('data'); return; }
    var students = s.students;
    if (onlyFiltered && IDCS.Preview && IDCS.Preview.filteredStudents) students = IDCS.Preview.filteredStudents();

    genControl = { cancelled: false };
    var ov = U.$('#genOverlay'); ov.hidden = false;
    var bar = U.$('#genBar'), txt = U.$('#genText');
    bar.style.width = '0%'; txt.textContent = 'Preparing…';

    // Priority 2: make sure URL-only students have their images before rendering.
    ensureImages(students, bar, txt).then(function () {
      if (genControl.cancelled) { ov.hidden = true; U.toast('Cancelled', 'warn'); return null; }
      txt.textContent = 'Rendering cards…'; bar.style.width = '0%';
      return IDCS.PDF.generate(s, {
        students: students, control: genControl,
        onProgress: function (p) { var pct = Math.round(p.done / p.total * 100); bar.style.width = pct + '%'; txt.textContent = p.done + ' / ' + p.total + ' cards'; }
      }).then(function (result) {
        ov.hidden = true;
        if (!result) { U.toast('Generation cancelled', 'warn'); return; }
        IDCS.PDF.download(result);
        var miss = lastImageReport.failed.length + IDCS.Images.missingImageList(students).length;
        U.toast('Done — ' + result.name + (miss ? ' (' + miss + ' without photo)' : ''), miss ? 'warn' : 'success');
      });
    }).catch(function (e) { ov.hidden = true; U.toast('Generate failed: ' + e.message, 'error'); console.error(e); });
  }

  /* Download any URL images the selected students still need (local wins). */
  function ensureImages(students, bar, txt) {
    var need = students.filter(function (x) { return !x.photoUrl && IDCS.Images.urlFor(x); });
    if (!need.length) return Promise.resolve();
    txt.textContent = 'Downloading images…';
    return IDCS.Images.downloadAll(students, {
      control: genControl,
      onProgress: function (p) { bar.style.width = Math.round(p.done / p.total * 100) + '%'; txt.textContent = 'Downloading images  ' + p.done + ' / ' + p.total + '  · ~' + p.eta + 's'; }
    }).then(function (res) { lastImageReport = { failed: res.failed, missing: IDCS.Images.missingImageList(students) }; });
  }

  /* ---------------- shortcuts ---------------- */
  function bindShortcuts() {
    window.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? Store.redo() : Store.undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); Store.redo(); }
      else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); IDCS.Project.save(Store.get()); U.toast('Project saved', 'success'); }
      else if (mod && e.key.toLowerCase() === 'g') { e.preventDefault(); showView('export'); setTimeout(function () { generate(); }, 60); }
      else if (!mod && currentView === 'preview') {
        if (e.key === 'ArrowRight') IDCS.Preview.step && IDCS.Preview.step(1);
        if (e.key === 'ArrowLeft') IDCS.Preview.step && IDCS.Preview.step(-1);
      }
    });
  }

  /* ---------------- helpers ---------------- */
  function updateStats() {
    var s = Store.get();
    U.$('#statStudents').textContent = s.students.length;
    U.$('#statPhotos').textContent = s.students.filter(function (x) { return x.photoUrl; }).length;
  }
  function setStatus(m) { U.$('#statusMsg').textContent = m; }

  function panel(title, children) {
    var p = U.el('div', { class: 'panel' }, [U.el('h2', { text: title }), U.el('div', { class: 'body' }, children || [])]);
    return p;
  }
  function th(t) { return U.el('th', { text: t }); }
  function field(label, control) { return U.el('div', {}, [U.el('div', { class: 'help', style: 'margin-bottom:4px', text: label }), control]); }
  function selectC(opts, val, cb) { return U.el('select', { class: 'inp', style: 'width:100%', onchange: function (e) { cb(e.target.value); } },
    opts.map(function (o) { return U.el('option', { value: o, text: o, selected: o === val ? 'selected' : null }); })); }
  function numI(val, cb) { return U.el('input', { class: 'inp', style: 'width:100%', type: 'number', value: val, oninput: function (e) { cb(parseFloat(e.target.value) || 0); } }); }
  function checkbox(label, val, cb) {
    var c = U.el('input', { type: 'checkbox', onchange: function (e) { cb(e.target.checked); } }); if (val) c.checked = true;
    return U.el('label', { class: 'row', style: 'gap:6px;cursor:pointer' }, [c, U.el('span', { text: label })]);
  }
  function tiles(opts, val, cb) {
    return U.el('div', { class: 'radio-tiles' }, opts.map(function (o) {
      return U.el('div', { class: 'tile' + (o[0] === val ? ' on' : ''), text: o[1], onclick: function () { cb(o[0]); } });
    }));
  }
  function dropzone(icon, big, sub, accept, dir, cb) {
    var inp = U.el('input', { type: 'file', accept: accept, multiple: 'multiple', style: 'display:none', onchange: function (e) { if (e.target.files.length) cb(Array.prototype.slice.call(e.target.files)); } });
    if (dir) { inp.setAttribute('webkitdirectory', ''); inp.setAttribute('directory', ''); }
    var d = U.el('div', { class: 'drop', onclick: function () { inp.click(); } }, [
      U.el('div', { class: 'ic', text: icon }), U.el('div', { class: 'big', text: big }), U.el('div', { class: 'sub', text: sub }), inp
    ]);
    dnd(d, cb);
    return d;
  }
  function dropSmall(label, accept, dir, cb) {
    var inp = U.el('input', { type: 'file', accept: accept, style: 'display:none', onchange: function (e) { if (e.target.files.length) cb(Array.prototype.slice.call(e.target.files)); } });
    var b = U.el('button', { class: 'btn small', text: label, onclick: function () { inp.click(); } }); b.appendChild(inp); return b;
  }
  function dnd(el, cb) {
    ['dragover', 'dragenter'].forEach(function (ev) { el.addEventListener(ev, function (e) { e.preventDefault(); el.classList.add('drag'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { el.addEventListener(ev, function (e) { e.preventDefault(); el.classList.remove('drag'); }); });
    el.addEventListener('drop', function (e) {
      var items = e.dataTransfer.files; if (items && items.length) cb(Array.prototype.slice.call(items));
    });
  }
  function pick(accept, multiple, cb) {
    var inp = U.el('input', { type: 'file', accept: accept, style: 'display:none', onchange: function (e) { if (e.target.files.length) cb(Array.prototype.slice.call(e.target.files)); } });
    if (multiple) inp.setAttribute('multiple', '');
    document.body.appendChild(inp); inp.click(); setTimeout(function () { inp.remove(); }, 1000);
  }

  // expose a couple of preview helpers used by shortcuts/filters
  IDCS.Preview.step = IDCS.Preview.step || function () {};
  IDCS.Preview.filteredStudents = function () {
    var s = Store.get(); var f = s.filters; var q = U.norm(f.text);
    return s.students.filter(function (d) {
      var dd = d.data;
      if (f.std && U.norm(dd.std) !== U.norm(f.std)) return false;
      if (f.div && U.norm(dd.div) !== U.norm(f.div)) return false;
      if (!q) return true;
      return [dd.name, dd.cid, dd.std].some(function (v) { return U.norm(v).indexOf(q) !== -1; });
    });
  };
})(window.IDCS = window.IDCS || {});
