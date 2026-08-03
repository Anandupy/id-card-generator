/* =============================================================================
 * renderer.js  —  CardRenderer: the exact-design drawing engine.
 *
 * Draws the fixed background image plus every dynamic field onto a 2D canvas
 * context. The caller pre-scales the context (ctx.scale(s,s)) so the renderer
 * always works in the template's native pixel space — the same code path serves
 * the on-screen preview and the 300-DPI print export, guaranteeing identical
 * output at any resolution.
 * =========================================================================== */
(function (IDCS) {
  'use strict';

  var imageCache = {};   // src -> HTMLImageElement (loaded)
  var qrCache = {};      // key  -> qrcode model

  /* Load an image once and cache it. Returns a Promise<HTMLImageElement>. */
  function loadImage(src) {
    if (!src) return Promise.resolve(null);
    if (imageCache[src] && imageCache[src].complete) return Promise.resolve(imageCache[src]);
    return new Promise(function (resolve) {
      var img = new Image();
      var done = false;
      var finish = function (val) { if (!done) { done = true; resolve(val); } };
      img.onload = function () { imageCache[src] = img; finish(img); };
      img.onerror = function () { finish(null); };
      setTimeout(function () { finish(img.complete && img.naturalWidth ? img : null); }, 10000);
      img.src = src;
    });
  }

  /* Pre-load every image a set of students needs (background + photos). */
  function preload(bgSrc, students) {
    var srcs = [bgSrc];
    students.forEach(function (s) { if (s.photoUrl) srcs.push(s.photoUrl); });
    return Promise.all(srcs.map(loadImage));
  }

  function applyTransform(str, val) {
    if (val == null) return '';
    val = String(val);
    if (str === 'upper') return val.toUpperCase();
    if (str === 'lower') return val.toLowerCase();
    if (str === 'capitalize') return val.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    return val;
  }

  /* Measure text width honouring manual letter spacing. */
  function measure(ctx, text, spacing) {
    if (!spacing) return ctx.measureText(text).width;
    var w = 0;
    for (var i = 0; i < text.length; i++) w += ctx.measureText(text[i]).width + spacing;
    return w - spacing;
  }

  /* Draw a single line of text with optional letter spacing / stroke. */
  function drawLine(ctx, text, x, y, spacing, stroke) {
    if (!spacing) {
      if (stroke) ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
      return;
    }
    var cx = x;
    for (var i = 0; i < text.length; i++) {
      if (stroke) ctx.strokeText(text[i], cx, y);
      ctx.fillText(text[i], cx, y);
      cx += ctx.measureText(text[i]).width + spacing;
    }
  }

  /* Word-wrap a string to a max width, respecting explicit \n. */
  function wrap(ctx, text, maxWidth, spacing) {
    var out = [];
    String(text).split('\n').forEach(function (para) {
      if (!maxWidth) { out.push(para); return; }
      var words = para.split(/\s+/), line = '';
      words.forEach(function (word) {
        var test = line ? line + ' ' + word : word;
        if (measure(ctx, test, spacing) > maxWidth && line) { out.push(line); line = word; }
        else line = test;
      });
      out.push(line);
    });
    return out;
  }

  function fontString(f, size) {
    return (f.italic ? 'italic ' : '') + (f.bold ? '700 ' : '400 ') + size + 'px ' + f.font;
  }

  /* ---- text field ---------------------------------------------------------- */
  function renderText(ctx, f, rawValue) {
    // A bound field with no value renders nothing at all — no stray ":" or ","
    // (covers "both parent numbers empty", empty DOB / Gr No, etc.).
    if (f.bind && (rawValue == null || String(rawValue).trim() === '')) return;
    var value = applyTransform(f.transform, rawValue != null ? rawValue : f.text);
    var full = (f.prefix || '') + (f.prefix ? ' ' : '') + value + (f.suffix || '');
    if (f.prefix && f.prefix.slice(-1) === ':') full = f.prefix + value + (f.suffix || '');
    if (full === '' || full == null) return;

    var size = f.fontSize;
    ctx.font = fontString(f, size);
    if ('letterSpacing' in ctx) ctx.letterSpacing = (f.letterSpacing || 0) + 'px';
    var spacing = ('letterSpacing' in ctx) ? 0 : (f.letterSpacing || 0);

    // Auto-shrink single-line text to fit maxWidth.
    if (f.autoShrink && f.maxWidth) {
      while (size > 10 && measure(ctx, full, spacing) > f.maxWidth) {
        size -= 1; ctx.font = fontString(f, size);
      }
    }

    var lines = wrap(ctx, full, f.autoShrink ? 0 : f.maxWidth, spacing);
    ctx.textAlign = f.align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = f.color;

    if (f.background) {
      var bw = f.maxWidth || measure(ctx, lines[0], spacing);
      ctx.fillStyle = f.background;
      ctx.fillRect(f.x - 4, f.y - size, bw + 8, (lines.length - 1) * f.lineHeight + size + 8);
      ctx.fillStyle = f.color;
    }
    if (f.shadow) {
      ctx.shadowColor = f.shadow.color; ctx.shadowBlur = f.shadow.blur;
      ctx.shadowOffsetX = f.shadow.x; ctx.shadowOffsetY = f.shadow.y;
    }
    if (f.stroke) { ctx.strokeStyle = f.stroke.color; ctx.lineWidth = f.stroke.width; }

    var ax = f.align === 'center' ? f.x + (f.w ? f.w / 2 : 0) : (f.align === 'right' ? f.x + (f.w || 0) : f.x);
    lines.forEach(function (ln, i) {
      var yy = f.y + i * f.lineHeight;
      drawLine(ctx, ln, ax, yy, spacing, f.stroke);
      if (f.underline) {
        var w = measure(ctx, ln, spacing);
        var ux = f.align === 'center' ? ax - w / 2 : (f.align === 'right' ? ax - w : ax);
        ctx.fillRect(ux, yy + size * 0.12, w, Math.max(1, size * 0.06));
      }
    });
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---- image field --------------------------------------------------------- */
  function renderImage(ctx, f, img) {
    ctx.save();
    // Clip to the (optionally rounded / circular) box.
    if (f.circle) { ctx.beginPath(); ctx.arc(f.x + f.w / 2, f.y + f.h / 2, Math.min(f.w, f.h) / 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip(); }
    else if (f.borderRadius) { roundRectPath(ctx, f.x, f.y, f.w, f.h, f.borderRadius); ctx.clip(); }
    else { ctx.beginPath(); ctx.rect(f.x, f.y, f.w, f.h); ctx.clip(); }

    if (!img) {
      // Placeholder when a photo is missing.
      ctx.fillStyle = '#eef1f4'; ctx.fillRect(f.x, f.y, f.w, f.h);
      ctx.fillStyle = '#9aa5b1'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '600 ' + Math.round(f.w * 0.11) + 'px ' + IDCS.FONT;
      ctx.fillText('NO PHOTO', f.x + f.w / 2, f.y + f.h / 2);
      ctx.restore();
      if (f.borderWidth) strokeBox(ctx, f);
      return;
    }

    // Fill the box white first so 'contain' letterbox areas stay clean.
    if (f.fit === 'contain') { ctx.fillStyle = '#ffffff'; ctx.fillRect(f.x, f.y, f.w, f.h); }

    ctx.filter = 'brightness(' + f.brightness + ') contrast(' + f.contrast + ') saturate(' + f.saturation + ')';

    // Compute source/destination for the chosen fit mode.
    var iw = img.naturalWidth, ih = img.naturalHeight;
    var box = { x: f.x, y: f.y, w: f.w, h: f.h };
    var dx, dy, dw, dh;
    if (f.fit === 'fill') { dx = box.x; dy = box.y; dw = box.w; dh = box.h; }
    else {
      var scale = f.fit === 'contain' ? Math.min(box.w / iw, box.h / ih) : Math.max(box.w / iw, box.h / ih);
      scale *= (f.scale || 1);
      dw = iw * scale; dh = ih * scale;
      // anchorX/anchorY (0..1) bias the crop; 0.5 = centred. For ID photos a
      // smaller anchorY keeps the head and trims the bottom (shoulders).
      var ax = f.anchorX != null ? f.anchorX : 0.5;
      var ay = f.anchorY != null ? f.anchorY : 0.5;
      dx = box.x + (box.w - dw) * ax + (f.offsetX || 0);
      dy = box.y + (box.h - dh) * ay + (f.offsetY || 0);
    }

    // Apply per-image rotation / flip around the box centre.
    var cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    ctx.translate(cx, cy);
    ctx.rotate((f.imgRotation || 0) * Math.PI / 180);
    ctx.scale(f.flipH ? -1 : 1, f.flipV ? -1 : 1);
    ctx.translate(-cx, -cy);

    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.filter = 'none';
    ctx.restore();
    if (f.borderWidth) strokeBox(ctx, f);
  }

  function strokeBox(ctx, f) {
    ctx.save();
    ctx.strokeStyle = f.borderColor || '#cccccc';
    ctx.lineWidth = f.borderWidth;
    if (f.circle) { ctx.beginPath(); ctx.arc(f.x + f.w / 2, f.y + f.h / 2, Math.min(f.w, f.h) / 2, 0, Math.PI * 2); ctx.stroke(); }
    else { roundRectPath(ctx, f.x, f.y, f.w, f.h, f.borderRadius); ctx.stroke(); }
    ctx.restore();
  }

  /* ---- QR field ------------------------------------------------------------ */
  function renderQR(ctx, f, data) {
    if (!window.qrcode || !data) return;
    var key = data + '|' + f.ecc;
    var qr = qrCache[key];
    if (!qr) {
      qr = window.qrcode(0, f.ecc || 'M');
      qr.addData(String(data)); qr.make();
      qrCache[key] = qr;
    }
    var count = qr.getModuleCount();
    var margin = f.margin || 0;
    var total = count + margin * 2;
    var cell = Math.min(f.w, f.h) / total;
    ctx.save();
    ctx.fillStyle = f.light || '#fff';
    ctx.fillRect(f.x, f.y, cell * total, cell * total);
    ctx.fillStyle = f.dark || '#000';
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (qr.isDark(r, c)) ctx.fillRect(f.x + (c + margin) * cell, f.y + (r + margin) * cell, cell + 0.5, cell + 0.5);
      }
    }
    ctx.restore();
  }

  /* ---- Barcode field ------------------------------------------------------- */
  function renderBarcode(ctx, f, data) {
    if (!window.JsBarcode || !data) return;
    try {
      var cv = document.createElement('canvas');
      window.JsBarcode(cv, String(data), {
        format: f.barFormat || 'CODE128', displayValue: !!f.displayValue,
        margin: 0, height: f.h * 0.8, width: 2, background: 'transparent'
      });
      ctx.drawImage(cv, f.x, f.y, f.w, f.h);
    } catch (e) { /* invalid data for chosen format */ }
  }

  /* Resolve the value a field should display for a given student. */
  function valueFor(f, student) {
    if (f.type === 'qr') return f.qrData ? interpolate(f.qrData, student) : (student.data[f.bind] || student.data.cid || '');
    if (f.type === 'barcode') return student.data[f.bind] || student.data.cid || '';
    if (f.bind) return student.data[f.bind] != null ? student.data[f.bind] : '';
    return f.text;
  }

  function interpolate(tpl, student) {
    return String(tpl).replace(/\{(\w+)\}/g, function (_, k) { return student.data[k] != null ? student.data[k] : ''; });
  }

  /* Render ONE card. ctx must already be scaled to native space.
   * `fields` is the ordered field list; `student` has {data, photoUrl, overrides}. */
  function renderCard(ctx, bgImg, fields, student) {
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, IDCS.CARD_W, IDCS.CARD_H);
    if (bgImg) ctx.drawImage(bgImg, 0, 0, IDCS.CARD_W, IDCS.CARD_H);

    fields.forEach(function (base) {
      if (base.hidden) return;
      // Per-student overrides (e.g. adjusted photo, edited text) win.
      var f = student.overrides && student.overrides[base.id]
        ? Object.assign({}, base, student.overrides[base.id]) : base;

      ctx.save();
      ctx.globalAlpha = f.opacity != null ? f.opacity : 1;
      if (f.rotation) {
        var cx = f.x + (f.w || 0) / 2, cy = f.y + (f.type === 'image' ? (f.h || 0) / 2 : 0);
        ctx.translate(cx, cy); ctx.rotate(f.rotation * Math.PI / 180); ctx.translate(-cx, -cy);
      }
      if (f.type === 'image') {
        var src = (student.overrides && student.overrides[f.id] && student.overrides[f.id].src) || student.photoUrl;
        renderImage(ctx, f, imageCache[src] && imageCache[src].complete ? imageCache[src] : null);
      } else if (f.type === 'qr') {
        renderQR(ctx, f, valueFor(f, student));
      } else if (f.type === 'barcode') {
        renderBarcode(ctx, f, valueFor(f, student));
      } else {
        renderText(ctx, f, valueFor(f, student));
      }
      ctx.restore();
    });
    ctx.restore();
  }

  IDCS.Renderer = {
    loadImage: loadImage,
    preload: preload,
    renderCard: renderCard,
    valueFor: valueFor,
    clearQRCache: function () { qrCache = {}; }
  };
})(window.IDCS = window.IDCS || {});
