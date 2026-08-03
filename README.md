# ID Card Studio — Bulk ID Card Generator

A production-grade, **100% client-side** bulk ID-card generator built around your exact
**Shree Siddhi Vinayagar English High School** card design. Upload an Excel sheet and a
folder of photos, and the app fills your fixed template and exports print-ready PDFs at
300 DPI — the design never changes, only the data.

> **Runs by double-clicking `index.html`.** No server, no install, no internet.
> Student data never leaves the computer — ideal for schools handling minors' data.

---

## 1. Why client-side (architecture decision)

The recommended stack listed a React/Next.js front end **and** a Node/Express back end with
Prisma/SQLite. For this problem every heavy operation — spreadsheet parsing, image
compositing, QR/barcode generation, PDF assembly — can run in the browser. A back end would
only add hosting cost, a data-privacy liability (uploading children's photos to a server),
and deployment friction, while adding **zero** capability. So the app is delivered as a
self-contained client application:

| Concern            | Recommended stack        | This build (and why)                                            |
|--------------------|--------------------------|-----------------------------------------------------------------|
| Spreadsheet        | SheetJS                  | ✅ SheetJS (`xlsx`) — in browser                                 |
| PDF                | pdf-lib / PDFKit / Puppeteer | ✅ jsPDF — composites 300-DPI card images onto pages           |
| Images             | Sharp (server)           | ✅ Canvas 2D — brightness/contrast/saturate/fit/crop, no server |
| QR / Barcode       | qrcode / JsBarcode       | ✅ qrcode-generator + JsBarcode                                  |
| State              | Zustand                  | ✅ Small custom store with undo/redo + autosave (same pattern)  |
| DB                 | SQLite + Prisma          | ⛔ Not needed — projects persist as portable `.idcs` JSON files |
| Editor canvas      | Fabric.js / Konva.js     | ✅ Custom lightweight canvas editor (drag/resize + inspector)   |

The design and layering (services, renderer, store, views) mirror a clean React/Zustand
architecture — it is simply shipped as framework-free ES5 modules so it runs from `file://`
offline with no build step.

---

## 2. Quick start

1. Open the `id-card-studio` folder.
2. Double-click **`index.html`** (Chrome / Edge / Firefox recommended).
3. The **Shree Siddhi Vinayagar** template loads automatically as the active design.
4. **Data** tab → drop `sample/students-sample.xlsx`, then drop the `sample/photos` folder.
5. **Preview** tab → browse, search, edit a student, adjust a photo.
6. **Export** tab → **Generate PDF**.

No internet connection is required — all libraries are vendored in `vendor/`.

---

## 3. Feature coverage

**Workflow**
- Template: baked exact preset + replace with your own PNG/JPG.
- Excel: XLSX / XLS / CSV, **auto column detection**, editable mapping table, unlimited columns.
- Photos: **whole-folder** upload, **auto-matched** by C-ID / Admission / Roll / Student ID / filename.
- Preview: zoom, next/prev, search, filter, edit field text, replace/rotate/flip/fit photo,
  brightness / contrast / saturation / scale / position.
- Export: single PDF · individual PDFs (ZIP) · PNG (ZIP) · A4 / Letter / A3 / custom ·
  portrait / landscape · configurable grid · crop marks · 150/300/600 DPI.
  Every card is placed at **true CR80 ID size (2.125" × 3.370" / 53.98 × 85.6 mm)** — never
  scaled to fill a cell — so it prints life-size on card stock (9 cards per A4 page by default,
  auto-fit + centred).

**Dynamic template mapping** — drag-and-drop field editor with a full inspector:
position, size, rotation, opacity, font size, bold, italic, underline, colour, alignment,
letter-spacing, line-height, transform (UPPER/lower/Capitalize), max-width, fit, border,
radius, circle-crop, QR (data template, ECC, colours, margin), barcode (CODE128/39/EAN/UPC).

**Validation report** — missing photo, duplicate C-ID/admission, empty mandatory fields,
invalid dates, duplicate names, extra/unmatched photos.

**Two parent numbers** — `PARENT 1 NUMBER` and `PARENT 2 NUMBER` are auto-detected and
combined into one `Mob No` line as `p1, p2` (comma + single space). If only one exists it
shows that one; if both are empty the field (and its colon) shows nothing.

**Two image sources (local-first)** — the existing local-folder upload is unchanged. If a
student has no local photo, the app downloads the image from the Excel **Image URL** column
(Azure Blob, S3, GCS, Cloudflare R2, Firebase, any public https jpg/png/webp). Downloads are
concurrent (6 at a time) with retry, timeout, caching, a progress bar + ETA, and cancellation.
Anything that still fails gets a placeholder and appears in the **Image Report** (Student
Name, C-ID, URL, reason: 404 / 403 / Timeout / Network / Invalid) exportable as CSV or Excel.
Downloaded images become data URLs, so they behave identically to local photos in preview,
in the 300-DPI PDF (crop/contain/fill/fit all supported), and inside saved projects.

> **Note on URL images & CORS:** the image host must allow cross-origin reads (most public
> Azure/S3/GCS buckets do). If a host blocks it, the picture may still appear in preview but
> can't be embedded in the PDF — those students are listed in the Image Report so you can
> supply them locally. Running the app from a simple local web server (rather than `file://`)
> maximises compatibility.

**Messy exports handled** — a title/banner row above the real headers (e.g. VMS "VMS School
Mobile App…" exports) is auto-skipped; the header row is detected automatically.

**Data exports** — CSV · Excel · JSON. **Project save/load** — one `.idcs` file remembers
the template, mapping, fields, photos, per-student edits, and settings.

**UX** — light/dark, glassmorphism toolbar, sidebar steps, status bar, autosave,
undo/redo, drag-&-drop, keyboard shortcuts (`Ctrl+Z/Y/S/G`, `←/→` in preview).

**Performance** — cards render in chunked async batches with a progress bar and
**cancellation**, keeping the UI responsive for hundreds to thousands of students.

---

## 4. Folder structure

```
id-card-studio/
├── index.html              # app shell (toolbar, sidebar, views)
├── css/
│   └── styles.css          # theme (light/dark), layout, components
├── js/
│   ├── template-data.js    # baked exact card background (base64 data URI)
│   ├── preset.js           # fixed card geometry + field definitions + aliases
│   ├── utils.js            # DOM, events, formatting, file readers
│   ├── store.js            # state + undo/redo + autosave (single source of truth)
│   ├── renderer.js         # CardRenderer — the exact-design drawing engine
│   ├── excel.js            # SheetJS parse + auto column detect + mapping
│   ├── photos.js           # folder import + auto-matching algorithm
│   ├── validation.js       # data-quality report
│   ├── pdf.js              # 300-DPI print export (single / individual / PNG)
│   ├── project.js          # save/load .idcs + CSV/XLSX/JSON export
│   ├── editor.js           # drag-drop field editor + property inspector
│   ├── preview.js          # preview browser + per-student editing tools
│   └── app.js              # orchestrator: views, toolbar, shortcuts, pipeline
├── vendor/                 # offline libraries (xlsx, jspdf, jszip, JsBarcode, qrcode)
├── assets/
│   └── template-shree-siddhi.png   # the blank exact template (reference)
├── sample/
│   ├── students-sample.xlsx        # 24 sample students
│   └── photos/                     # matching placeholder photos (by C-ID)
├── docs/
│   └── ARCHITECTURE.md     # diagrams, module contracts, wireframes, testing
└── README.md
```

## 5. How the "exact design" is guaranteed

The source PDF renders each card as a flat image. The emblem, green geometric art, school
header, `A.Y.2026~2027` text and the authorised signature are the **original pixels** — they
are kept verbatim in `assets/template-shree-siddhi.png` (embedded as a data URI). Only the
per-student values (which sit on plain white) were removed. The renderer then places the
photo and text back at the **measured original coordinates** (see `preset.js`), so output is
pixel-faithful to your design. Replacing the template with your own image switches the app to
fully generic drag-and-drop mapping.

## 6. Deployment

- **Local (default):** double-click `index.html`. Fully offline.
- **Intranet / web:** copy the folder to any static host (IIS, Apache, Nginx, GitHub Pages,
  S3). No server code, no environment variables, no database.
- **Kiosk:** open in a browser in full-screen; autosave preserves work across restarts.

## 7. Testing strategy

- **Unit (pure logic):** `excel.autoMap`, `excel.buildStudents`, `photos.match`,
  `validation.run` are pure and Node-testable. A harness loads the real modules against
  `sample/students-sample.xlsx` and the `sample/photos` folder and asserts column detection,
  mapping (`cid → C-ID`), 22/22 photo matches, and duplicate/missing detection. Run it with:
  `node docs/pipeline.test.js` (see `docs/ARCHITECTURE.md`).
- **Visual regression:** render a card and diff against the extracted original
  (`assets/template-shree-siddhi.png`) — layout was validated this way during development.
- **Manual smoke:** load sample data → preview → generate each export mode → reopen `.idcs`.

## 8. Known limits / optional extras

- **PDF/PSD template import** — convert to PNG/JPG first (the exact preset is already baked).
- **Front + Back** — the layout engine supports a second template; wire a `back` template in
  a future pass (the field model already supports multiple field sets).
- **Face-centering / background-removal** — hooks exist (`fit`, `offset`, `scale`); on-device
  AI models are out of scope for an offline single-file build.
- **CMYK** — browsers render RGB; send the 300-DPI output to a RIP for CMYK conversion.

---

Built as a fixed-template data-filling tool: **your design is the contract, the app only
fills it.**
