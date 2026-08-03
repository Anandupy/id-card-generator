/* =============================================================================
 * store.js — central application state with undo/redo history and autosave.
 *
 * A single source of truth. Views subscribe via IDCS.U.bus. Mutations go through
 * commit() which snapshots state for undo and schedules an autosave.
 * =========================================================================== */
(function (IDCS) {
  'use strict';
  var U = IDCS.U;

  function freshState() {
    return {
      projectName: 'Shree Siddhi Vinayagar — 2026-2027',
      templateSrc: IDCS.PRESET_TEMPLATE_DATAURL,   // baked exact design
      templateNative: { w: IDCS.CARD_W, h: IDCS.CARD_H },
      fieldsVersion: IDCS.PRESET_VERSION,
      fields: IDCS.clonePresetFields(),
      columns: [],          // detected Excel headers
      mapping: {},          // fieldBind -> columnName
      students: [],         // [{ id, data:{name,std,...}, photoUrl, photoFile, overrides:{} }]
      photos: {},           // matchKey -> {name, url}
      unmatchedPhotos: [],  // photo filenames with no student
      filters: { text: '', std: '', div: '', extra: {} },
      selection: 0,         // index of previewed student
      settings: {
        pageSize: 'A4', orientation: 'portrait', dpi: 300,
        cols: 2, rows: 5, gapX: 4, gapY: 2, marginMM: 6,
        rotateCards: true,                // rotate each card 90° → 10 per A4 page
        cropMarks: false, mode: 'single'  // single | individual-pdf | png-zip
      },
      theme: 'light'
    };
  }

  /* When loading a saved/autosaved project that still uses the baked preset,
   * pull in the latest preset field geometry/styling if the version is stale.
   * User data (students, photos, mapping) is always preserved. */
  function migratePreset(s) {
    var usesPreset = !s.templateSrc || s.templateSrc === IDCS.PRESET_TEMPLATE_DATAURL;
    if (usesPreset && s.fieldsVersion !== IDCS.PRESET_VERSION) {
      s.templateSrc = IDCS.PRESET_TEMPLATE_DATAURL;
      s.fields = IDCS.clonePresetFields();
      s.fieldsVersion = IDCS.PRESET_VERSION;
      s.settings = Object.assign({}, s.settings, { cols: 2, rows: 5, gapX: 4, gapY: 2, marginMM: 6, rotateCards: true });
    }
    return s;
  }

  var state = freshState();
  var history = [];
  var future = [];
  var HISTORY_MAX = 40;
  var AUTOSAVE_KEY = 'idcs_autosave_v1';

  function snapshot() {
    // exclude bulky binary (photo dataURLs) from history to stay light
    return JSON.stringify(state, function (k, v) {
      if (k === 'photoUrl' || k === 'photoFile' || k === 'photos' || k === 'templateSrc') return undefined;
      return v;
    });
  }

  var Store = {
    get: function () { return state; },
    reset: function () { state = freshState(); U.bus.emit('state', state); },

    // Apply a mutation function, record history, notify, autosave.
    commit: function (mutator, opts) {
      opts = opts || {};
      if (!opts.noHistory) { history.push(snapshot()); if (history.length > HISTORY_MAX) history.shift(); future.length = 0; }
      mutator(state);
      U.bus.emit('state', state);
      if (opts.event) U.bus.emit(opts.event, state);
      Store.scheduleAutosave();
    },

    // lightweight notify without history (e.g. live slider drag)
    touch: function (event) { U.bus.emit('state', state); if (event) U.bus.emit(event, state); Store.scheduleAutosave(); },

    undo: function () {
      if (!history.length) return;
      future.push(snapshot());
      var prev = JSON.parse(history.pop());
      // keep binary photo refs from current state (history excludes them)
      prev.templateSrc = state.templateSrc; prev.photos = state.photos;
      prev.students.forEach(function (s, i) {
        if (state.students[i]) { s.photoUrl = state.students[i].photoUrl; s.photoFile = state.students[i].photoFile; }
      });
      state = prev; U.bus.emit('state', state); U.toast('Undo', 'info');
    },
    redo: function () {
      if (!future.length) return;
      history.push(snapshot());
      var next = JSON.parse(future.pop());
      next.templateSrc = state.templateSrc; next.photos = state.photos;
      next.students.forEach(function (s, i) {
        if (state.students[i]) { s.photoUrl = state.students[i].photoUrl; s.photoFile = state.students[i].photoFile; }
      });
      state = next; U.bus.emit('state', state); U.toast('Redo', 'info');
    },

    scheduleAutosave: U.debounce(function () {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(state, function (k, v) {
          if (k === 'photoFile') return undefined;   // File objects aren't serialisable
          return v;
        }));
        U.bus.emit('autosaved');
      } catch (e) { /* quota — ignore for very large sets */ }
    }, 1200),

    loadAutosave: function () {
      try {
        var raw = localStorage.getItem(AUTOSAVE_KEY);
        if (!raw) return false;
        var s = JSON.parse(raw);
        if (!s.fields) return false;
        state = migratePreset(Object.assign(freshState(), s));
        U.bus.emit('state', state);
        return true;
      } catch (e) { return false; }
    },
    clearAutosave: function () { try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) {} },

    // Replace whole state (project load)
    hydrate: function (s) { state = migratePreset(Object.assign(freshState(), s)); history.length = 0; future.length = 0; U.bus.emit('state', state); }
  };

  IDCS.Store = Store;
})(window.IDCS = window.IDCS || {});
