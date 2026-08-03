/* =============================================================================
 * utils.js — small shared helpers (DOM, normalisation, formatting, events).
 * =========================================================================== */
(function (IDCS) {
  'use strict';

  var U = {
    // tiny DOM helpers
    $: function (sel, root) { return (root || document).querySelector(sel); },
    $$: function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); },
    el: function (tag, attrs, children) {
      var e = document.createElement(tag);
      if (attrs) Object.keys(attrs).forEach(function (k) {
        if (k === 'class') e.className = attrs[k];
        else if (k === 'html') e.innerHTML = attrs[k];
        else if (k === 'text') e.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
      });
      (children || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
      return e;
    },
    // normalise a header/key for fuzzy matching: lowercase, strip non-alphanumerics
    norm: function (s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); },
    // debounce
    debounce: function (fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; },
    // clamp
    clamp: function (v, a, b) { return Math.max(a, Math.min(b, v)); },
    // format bytes
    bytes: function (n) { if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'; return (n / 1048576).toFixed(1) + ' MB'; },
    // simple id
    uid: function () { return 'f' + Math.random().toString(36).slice(2, 8); },
    // read a File as data URL
    fileToDataURL: function (file) {
      return new Promise(function (res, rej) {
        var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(file);
      });
    },
    // read a File as ArrayBuffer
    fileToArrayBuffer: function (file) {
      return new Promise(function (res, rej) {
        var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsArrayBuffer(file);
      });
    },
    // is a valid date-ish string
    isValidDate: function (s) { if (!s) return false; var d = new Date(s); return !isNaN(d.getTime()) || /\d{1,4}[-/ ][A-Za-z0-9]{2,}[-/ ]\d{2,4}/.test(String(s)); },
    // toast
    toast: function (msg, kind) {
      var host = U.$('#toasts') || (function () { var h = U.el('div', { id: 'toasts' }); document.body.appendChild(h); return h; })();
      var t = U.el('div', { class: 'toast ' + (kind || 'info'), text: msg });
      host.appendChild(t);
      setTimeout(function () { t.classList.add('show'); }, 10);
      setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 300); }, 3200);
    }
  };

  // very small pub/sub event bus
  U.bus = (function () {
    var map = {};
    return {
      on: function (name, cb) { (map[name] = map[name] || []).push(cb); },
      emit: function (name, data) { (map[name] || []).forEach(function (cb) { cb(data); }); }
    };
  })();

  IDCS.U = U;
})(window.IDCS = window.IDCS || {});
