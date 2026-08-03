/* =============================================================================
 * images.js — Image URL download service (Feature 2).
 *
 * Adds a SECOND image source alongside the existing local-folder upload:
 * when a student has no local photo, the student's Excel "Image" URL is
 * downloaded automatically. Supports Azure Blob, S3, GCS, Cloudflare R2,
 * Firebase and any public HTTPS jpg/png/webp/jpeg.
 *
 * Priority (never changes existing behaviour):
 *   1. local matched photo (photos.js)   →  keep as-is
 *   2. else download the Excel Image URL  →  fill photoUrl (as a data URL)
 *   3. else placeholder + Missing/Failed report
 *
 * Features: concurrent downloads, retry with back-off, per-request timeout,
 * in-memory cache (each URL fetched once), progress + ETA, cancellation,
 * and a classified failure report (404 / 403 / Timeout / Network / Invalid).
 * Downloaded bytes become data URLs so they behave EXACTLY like local photos
 * in preview, in PDF export, and inside saved projects.
 * =========================================================================== */
(function (IDCS) {
  'use strict';
  var U = IDCS.U;

  var cache = {};                 // url -> dataURL (fetched once, reused)
  var CONCURRENCY = 6;
  var TIMEOUT_MS = 15000;
  var RETRIES = 2;
  var IMG_EXT = /\.(jpe?g|png|webp)(\?|#|$)/i;

  function isUrl(s) { return typeof s === 'string' && /^https?:\/\//i.test(s.trim()); }

  /* Find the best image URL for a student from any column that holds one. */
  function urlFor(student) {
    var d = student.data || {};
    var candidates = [d.photo, d.image, d.imageurl, d.photourl, d['col:Image'], d['col:image'], d['col:Photo'], d['col:URL']];
    for (var i = 0; i < candidates.length; i++) if (isUrl(candidates[i])) return candidates[i].trim();
    // last resort: scan every raw column for an image-looking URL
    var keys = Object.keys(d);
    for (var k = 0; k < keys.length; k++) {
      var v = d[keys[k]];
      if (isUrl(v) && (IMG_EXT.test(v) || /image|photo|blob|storage/i.test(v))) return v.trim();
    }
    return null;
  }

  function blobToDataURL(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(blob);
    });
  }
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function classify(err, status) {
    if (status === 404) return '404 Not Found';
    if (status === 403) return '403 Forbidden';
    if (status && status >= 400) return 'HTTP ' + status;
    if (err && err.name === 'AbortError') return 'Timeout';
    if (err && err.message === 'invalid-format') return 'Unsupported Format';
    if (err && err.message === 'too-large') return 'Image Too Large';
    if (err && err.message === 'invalid-url') return 'Invalid URL';
    return 'Network / CORS Error';
  }

  /* Download a single URL → dataURL, with timeout + retry. Rejects with a
   * classified reason string on final failure. */
  function fetchOne(url) {
    if (cache[url]) return Promise.resolve(cache[url]);
    if (!isUrl(url)) return Promise.reject('Invalid URL');

    function attempt(n) {
      var ctrl = new AbortController();
      var to = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
      var status = 0;
      return fetch(url, { signal: ctrl.signal, mode: 'cors', cache: 'force-cache' })
        .then(function (r) {
          status = r.status;
          if (!r.ok) throw new Error('http');
          return r.blob();
        })
        .then(function (blob) {
          clearTimeout(to);
          if (blob.size > 25 * 1024 * 1024) throw new Error('too-large');
          if (blob.type && blob.type.indexOf('image/') !== 0 && blob.size < 100) throw new Error('invalid-format');
          return blobToDataURL(blob).then(function (dataUrl) { cache[url] = dataUrl; return dataUrl; });
        })
        .catch(function (err) {
          clearTimeout(to);
          var retryable = !(status === 404 || status === 403) && !(err && err.name === 'AbortError' && n >= RETRIES);
          if (n < RETRIES && retryable) return delay(500 * (n + 1)).then(function () { return attempt(n + 1); });
          return Promise.reject(classify(err, status));
        });
    }
    // Try fetch first; if it fails (common on file:// or non-CORS hosts) fall
    // back to a crossOrigin <img> load, which succeeds when the host DOES send
    // CORS headers and keeps the canvas clean for PDF export.
    return attempt(0).catch(function (reason) {
      return imageElementLoad(url).then(function (dataUrl) { cache[url] = dataUrl; return dataUrl; })
                                  .catch(function () { return Promise.reject(reason); });
    });
  }

  /* CORS-aware image-element loader → dataURL (clean canvas only). */
  function imageElementLoad(url) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      var to = setTimeout(function () { rej('Timeout'); }, TIMEOUT_MS);
      img.onload = function () {
        clearTimeout(to);
        try {
          var c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          res(c.toDataURL('image/jpeg', 0.92));       // throws if tainted (no CORS)
        } catch (e) { rej('Network / CORS Error'); }
      };
      img.onerror = function () { clearTimeout(to); rej('Network / CORS Error'); };
      img.src = url;
    });
  }

  /* Download images for all students that need one (respecting local priority).
   * opts: { onProgress({done,total,eta}), control:{cancelled}, force }
   * Returns { downloaded, failed:[{student,url,reason}], skipped } */
  function downloadAll(students, opts) {
    opts = opts || {};
    var control = opts.control || {};
    var onProgress = opts.onProgress || function () {};
    var targets = [];
    students.forEach(function (s) {
      if (s.photoUrl && !opts.force) return;         // Priority 1: keep local photo
      var url = urlFor(s);
      if (url) targets.push({ s: s, url: url });      // Priority 2: has a URL to try
    });

    var total = targets.length, done = 0, downloaded = 0, failed = [];
    var start = Date.now();
    if (!total) return Promise.resolve({ downloaded: 0, failed: [], skipped: 0 });

    function tick() {
      done++;
      var elapsed = (Date.now() - start) / 1000;
      var eta = done ? Math.max(0, Math.round(elapsed / done * (total - done))) : 0;
      onProgress({ done: done, total: total, eta: eta });
    }

    // Simple concurrency pool.
    var idx = 0;
    function worker() {
      if (control.cancelled || idx >= targets.length) return Promise.resolve();
      var t = targets[idx++];
      return fetchOne(t.url).then(function (dataUrl) {
        t.s.photoUrl = dataUrl; downloaded++; tick();
      }).catch(function (reason) {
        failed.push({ student: t.s, url: t.url, reason: reason }); tick();
      }).then(worker);
    }
    var pool = [];
    for (var i = 0; i < Math.min(CONCURRENCY, targets.length); i++) pool.push(worker());
    return Promise.all(pool).then(function () { return { downloaded: downloaded, failed: failed, skipped: 0 }; });
  }

  /* Students that will end up with NO image (no local, no usable URL). */
  function missingImageList(students) {
    return students.filter(function (s) { return !s.photoUrl && !urlFor(s); });
  }

  /* Export the failed / missing image report. */
  function reportRows(failed, missing) {
    var rows = [['Student Name', 'CHILD ID', 'Image URL', 'Reason']];
    (failed || []).forEach(function (f) { rows.push([f.student.data.name || '', f.student.data.cid || '', f.url || '', f.reason || '']); });
    (missing || []).forEach(function (s) { rows.push([s.data.name || '', s.data.cid || '', urlFor(s) || '', 'Missing Image (no local file, no URL)']); });
    return rows;
  }
  function exportReportCSV(failed, missing, name) {
    var rows = reportRows(failed, missing);
    var csv = rows.map(function (r) { return r.map(function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\n');
    trigger(new Blob([csv], { type: 'text/csv' }), (name || 'image_report') + '.csv');
  }
  function exportReportXLSX(failed, missing, name) {
    var rows = reportRows(failed, missing);
    var ws = XLSX.utils.aoa_to_sheet(rows); var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Image Report');
    XLSX.writeFile(wb, (name || 'image_report') + '.xlsx');
  }
  function trigger(blob, fname) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000); }

  /* Build a Windows PowerShell script that downloads every student's image URL
   * to  photos\<CHILD ID>.jpg  — runs OUTSIDE the browser, so no CORS / file://
   * limitation. The user then uploads that folder via Method 1. */
  function buildDownloaderPS1(students) {
    var items = [];
    students.forEach(function (s) {
      var url = urlFor(s); if (!url) return;
      var id = String(s.data.cid || s.data.rollno || s.id).replace(/[^\w\-]+/g, '_');
      items.push("  @{id='" + id + "'; url='" + url.replace(/'/g, "''") + "'}");
    });
    return [
      "# ID Card Studio — bulk photo downloader",
      "# 1) Put this file in a folder.  2) Right-click > Run with PowerShell",
      "#    (or: open PowerShell here and run  .\\download-photos.ps1 ).",
      "# 3) It creates a 'photos' subfolder; upload that folder into the app (Method 1).",
      "$ErrorActionPreference='SilentlyContinue'",
      "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12",
      "$dir = Join-Path $PSScriptRoot 'photos'",
      "New-Item -ItemType Directory -Force -Path $dir | Out-Null",
      "$fail = Join-Path $dir '_failed.txt'",
      "$items = @(",
      items.join(",\n"),
      ")",
      "$i=0; $ok=0; $bad=0",
      "foreach($it in $items){",
      "  $i++",
      "  Write-Progress -Activity 'Downloading photos' -Status \"$i / $($items.Count)  (ok $ok, failed $bad)\" -PercentComplete ([math]::Min(100,$i/$items.Count*100))",
      "  $out = Join-Path $dir ($it.id + '.jpg')",
      "  if(Test-Path $out){ $ok++; continue }",
      "  try { Invoke-WebRequest -Uri $it.url -OutFile $out -UseBasicParsing -TimeoutSec 40; $ok++ }",
      "  catch { $bad++; Add-Content $fail ($it.id + '  ' + $it.url + '  ' + $_.Exception.Message) }",
      "}",
      "Write-Host ''",
      "Write-Host \"Done. Downloaded $ok, failed $bad. Folder: $dir\"",
      "Write-Host 'Now open ID Card Studio, go to Photos > Method 1, and upload this photos folder.'",
      "if($bad -gt 0){ Write-Host \"Failed list: $fail\" }",
      "Read-Host 'Press Enter to close'"
    ].join("\n");
  }
  function downloadPS1(students, name) {
    var text = buildDownloaderPS1(students);
    trigger(new Blob([text], { type: 'text/plain' }), (name || 'download-photos') + '.ps1');
  }

  IDCS.Images = {
    isUrl: isUrl, urlFor: urlFor,
    downloadAll: downloadAll,
    missingImageList: missingImageList,
    exportReportCSV: exportReportCSV, exportReportXLSX: exportReportXLSX,
    buildDownloaderPS1: buildDownloaderPS1, downloadPS1: downloadPS1,
    hasAnyUrls: function (students) { return students.some(function (s) { return !!urlFor(s); }); },
    clearCache: function () { cache = {}; }
  };
})(window.IDCS = window.IDCS || {});
