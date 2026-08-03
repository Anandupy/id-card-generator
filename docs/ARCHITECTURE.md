# Architecture & Design — ID Card Studio

## 1. High-level architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                              index.html                               │
│  Topbar (project, undo/redo, save/open, theme, generate)             │
│  Sidebar steps ── Data · Design · Preview · Export ── Status bar      │
└───────────────┬──────────────────────────────────────────────────────┘
                │ mounts views
        ┌───────┴────────┐
        ▼        ▼        ▼
   ┌────────┐ ┌───────┐ ┌────────┐        VIEWS (UI layer)
   │ app.js │ │editor │ │preview │  app.js also owns Data + Export views
   └───┬────┘ └───┬───┘ └───┬────┘
       │          │         │
       ▼          ▼         ▼
   ┌──────────────────────────────┐
   │        store.js  (state)      │  single source of truth
   │  fields · students · mapping  │  + undo/redo + autosave (localStorage)
   │  settings · theme · selection │
   └───────────────┬──────────────┘
                   │ read/commit
   ┌───────────────┼─────────────────────────────────────────────┐
   ▼               ▼               ▼             ▼            ▼
┌────────┐   ┌──────────┐   ┌──────────┐  ┌──────────┐ ┌──────────┐   SERVICES
│excel.js│   │photos.js │   │renderer  │  │ pdf.js   │ │project.js│
│parse + │   │folder    │   │exact-    │  │300 DPI   │ │save/load │
│automap │   │auto-match│   │design    │  │export    │ │+exports  │
└────────┘   └──────────┘   │engine    │  └──────────┘ └──────────┘
                            └────┬─────┘
                                 ▼
                        ┌──────────────────┐
                        │ preset.js +      │  the FIXED template:
                        │ template-data.js │  geometry + baked background
                        └──────────────────┘
Cross-cutting: utils.js (DOM/events/format) · validation.js (data-quality report)
Vendored libs: xlsx · jspdf · jszip · JsBarcode · qrcode-generator
```

**Layering (clean architecture):** UI views depend on the store and services; services
depend on the domain (preset/renderer) and utils; nothing depends on the UI. State flows one
way: view → `Store.commit(mutator)` → `bus.emit('state')` → views re-render.

## 2. Data model

```
Field {                          Student {
  id, label, type,                 id, rowIndex,
  bind, x, y, w, h,                data: { name, std, div, dob, grno, mob,
  rotation, opacity,                       address, cid, <norm cols>, col:<Header> },
  font, fontSize, bold,            photoUrl,   // data URL (portable)
  italic, underline, color,        photoFile,  // File (session only)
  align, letterSpacing,            overrides: { <fieldId>: {…partial Field…},
  lineHeight, maxWidth,                         photo: { brightness, contrast,
  transform, fit, circle,                                saturation, scale,
  borderRadius, borderWidth,                             offsetX, offsetY,
  qrData, ecc, barFormat … }                             imgRotation, flipH, flipV } }
}                                }
```

Per-student **overrides** let one card diverge (edited text, tuned photo) without touching
the template. The renderer merges `field` ← `overrides[field.id]` at draw time.

## 3. Module contracts (the "API")

Because there is no HTTP back end, the internal service surface **is** the API. All are pure
or side-effect-isolated and unit-testable:

| Module | Function | Contract |
|---|---|---|
| `Excel` | `load(file) → {columns, mapping, students}` | Parse XLSX/XLS/CSV; auto-detect headers; alias-map to fields (exact-before-substring, one column per field). |
| `Excel` | `autoMap(columns) → mapping` | Deterministic header→field mapping. |
| `Photos` | `match(files, students) → {matched, unmatched, total}` | Match by normalised C-ID/adm/roll/id/filename; attach `photoUrl`. |
| `Renderer` | `renderCard(ctx, bg, fields, student)` | Draw one card in native px onto a pre-scaled ctx. Resolution-independent. |
| `PDF` | `generate(state, {students, settings, onProgress, control}) → {blob, name}` | Chunked, cancellable export (single / individual-pdf / png-zip). |
| `Validation` | `run(state) → {issues, counts, students, withPhoto}` | Data-quality report. |
| `Project` | `save(state)` / `load(file) → project` | Portable `.idcs` JSON round-trip. |
| `Store` | `commit(mutator,opts)` / `undo` / `redo` / `hydrate` | Central mutation + history + autosave. |

## 4. Rendering & 300-DPI pipeline

1. Card is authored in a **native pixel space** (1323×2055 = the extracted design).
2. Every renderer draws in native units; the caller sets `ctx.scale(s,s)`.
   - Preview: `s ≈ 0.4` for screen.
   - Export: `s` chosen so pixel width ≥ `mm/25.4 × DPI` and ≥ native → **no downscaling / no
     quality loss**. At 300 DPI the source stays at full native resolution.
3. `pdf.js` renders each card to an offscreen canvas, then `jsPDF.addImage` places it at the
   **true physical mm size** on the page grid (fit-to-cell, aspect preserved). Optional crop
   marks are vector lines drawn by jsPDF.
4. Work is batched (`await nextFrame()` every few cards) so thousands of students export
   without freezing; a `control.cancelled` flag aborts cleanly.

## 5. UI wireframes

```
DATA                                   DESIGN (drag-drop editor)
┌───────────┬───────────┐              ┌────────────────┬─────────────┐
│ Template  │ Excel     │              │                │ Fields      │
│ [thumb]   │ [dropzone]│              │   ┌────────┐   │ • Photo     │
│ replace…  │ mapping▼  │              │   │ card   │   │ • Name  sel │
├───────────┼───────────┤              │   │ w/ live│   │ • Std …     │
│ Photos    │ Validation│              │   │ boxes  │   │ + Text +Img │
│ [folder]  │ ✓/⚠/✗ list│              │   └────────┘   │ Inspector:  │
└───────────┴───────────┘              │   (draggable)  │ x y w h …   │
                                       └────────────────┴─────────────┘
PREVIEW                                 EXPORT
┌────────┬──────────┬────────┐         ┌───────────────────────────────┐
│ list   │  card    │ edit   │         │ mode: ◉single ○indiv ○png     │
│ search │  ◀ ▶  ±  │ fields │         │ A4 ▾ portrait ▾ cols rows dpi │
│ filter │ [canvas] │ photo  │         │ [Generate] CSV Excel JSON     │
└────────┴──────────┴────────┘         └───────────────────────────────┘
```

## 6. Testing

`docs/pipeline.test.js` loads the **real** service modules under a tiny browser shim and
asserts against the shipped sample data (run: `node docs/pipeline.test.js`). It verifies
column detection, `cid → C-ID` mapping, 22/22 photo matches, and duplicate/missing detection.
Visual fidelity was validated by rendering a card and comparing against the extracted
original design.

## 7. Extension points

- **Second (back) template:** add a `backFields` set + `backTemplateSrc`; `pdf.js` already
  loops cards — emit a second image per student.
- **Custom fonts (TTF/OTF):** load via `FontFace` in `app.js` and expose in the inspector
  `font` list; the renderer already accepts any `font` string.
- **New template:** replace on the Data tab, then map fields visually — no code changes.
