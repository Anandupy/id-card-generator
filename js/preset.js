/* =============================================================================
 * preset.js  —  The FIXED "Shree Siddhi Vinayagar" ID-card template definition.
 *
 * The visual design (green art, emblem, header, A.Y. text, signature) lives in
 * the baked background image (template-data.js). This file only declares WHERE
 * the dynamic, per-student fields sit on top of that background and how they are
 * styled, so the generated cards reproduce the original design pixel-for-pixel.
 *
 * All coordinates are in the template's native pixel space (CARD_W x CARD_H).
 * The renderer scales this space to screen (preview) or 300-DPI (export).
 * =========================================================================== */
(function (IDCS) {
  'use strict';

  // Native resolution of the extracted card background.
  var CARD_W = 1323;
  var CARD_H = 2055;

  // Physical print size of one card (mm) = standard CR80 ID card, portrait
  // orientation: 2.125" x 3.370" (53.98 x 85.60 mm). Every exported card is
  // placed at exactly this size so it prints true-to-life on card stock.
  var CARD_W_MM = 53.98;   // 2.125 in
  var CARD_H_MM = 85.60;   // 3.370 in

  var FONT = 'Arial, "Helvetica Neue", Helvetica, sans-serif';

  /* Field factory — sensible defaults for every stylable property the spec asks
   * for (position, size, rotation, opacity, font, weight, italic, colour,
   * alignment, letter-spacing, line-height, transforms, shadow, stroke, …). */
  function F(o) {
    return Object.assign({
      id: o.id,
      label: o.label || o.id,        // human name shown in the editor
      type: o.type || 'text',        // text | image | qr | barcode
      bind: o.bind || null,          // data column key this field pulls from
      // geometry
      x: 0, y: 0, w: 0, h: 0,
      rotation: 0, opacity: 1,
      // text style
      text: '', prefix: '', suffix: '',
      font: FONT, fontSize: 54, bold: false, italic: false, underline: false,
      color: '#111111', align: 'left', valign: 'alphabetic',
      letterSpacing: 0, lineHeight: 66, maxWidth: 0, autoShrink: false,
      transform: 'none',             // none | upper | lower | capitalize
      padding: 0,
      // effects
      shadow: null,                  // {x,y,blur,color}
      stroke: null,                  // {width,color}
      background: null,              // fill behind text/box
      borderRadius: 0,
      // image-specific
      fit: 'cover',                  // cover | contain | fill
      circle: false, borderColor: null, borderWidth: 0,
      brightness: 1, contrast: 1, saturation: 1,
      imgRotation: 0, flipH: false, flipV: false,
      offsetX: 0, offsetY: 0, scale: 1,
      // qr / barcode
      qrData: '', ecc: 'M', margin: 2, dark: '#000000', light: '#ffffff',
      barFormat: 'CODE128', displayValue: false
    }, o);
  }

  /* -------- The preset field list (matches the extracted layout exactly) ----- */
  var PRESET_FIELDS = [
    // Student photo — rounded box centred over the white area.
    // Fills the photo interior; the black rounded border is part of the baked
    // template (exact original pixels), so the field draws no border of its own.
    F({ id: 'photo', label: 'Photo', type: 'image', bind: 'photo',
        x: 419, y: 647, w: 488, h: 520, borderRadius: 24,
        fit: 'cover', anchorY: 0.32, borderWidth: 0 }),

    // Student name — bold italic, centred, auto-shrinks so long names never clip.
    F({ id: 'name', label: 'Student Name', bind: 'name',
        x: 130, y: 1232, w: 1063, align: 'center', maxWidth: 1120, autoShrink: true,
        fontSize: 68, bold: true, italic: true }),

    // Row 1 : Std / Div   (value/colon column clears the widest label "Address")
    F({ id: 'std_label', label: 'Label: Std.', text: 'Std.', x: 108, y: 1306, fontSize: 52, bold: true }),
    F({ id: 'std', label: 'Std (value)', bind: 'std', prefix: ':', x: 348, y: 1306, fontSize: 52, bold: true }),
    F({ id: 'div_label', label: 'Label: Div', text: 'Div', x: 812, y: 1306, fontSize: 52, bold: true }),
    F({ id: 'div', label: 'Div (value)', bind: 'div', prefix: ':', x: 980, y: 1306, fontSize: 52, bold: true }),

    // Row 2 : D.O.B / Gr No
    F({ id: 'dob_label', label: 'Label: D.O.B', text: 'D.O.B', x: 108, y: 1394, fontSize: 52, bold: true }),
    F({ id: 'dob', label: 'DOB (value)', bind: 'dob', prefix: ':', x: 348, y: 1394, fontSize: 52, bold: true }),
    F({ id: 'grno_label', label: 'Label: Gr No', text: 'Gr No', x: 812, y: 1394, fontSize: 52, bold: true }),
    F({ id: 'grno', label: 'Gr No (value)', bind: 'grno', prefix: ':', x: 980, y: 1394, fontSize: 52, bold: true }),

    // Row 3 : Mob No (full width)
    F({ id: 'mob_label', label: 'Label: Mob No', text: 'Mob No', x: 108, y: 1483, fontSize: 52, bold: true }),
    F({ id: 'mob', label: 'Mob No (value)', bind: 'mob', prefix: ':', x: 348, y: 1483, fontSize: 52, bold: true, maxWidth: 900 }),

    // Row 4 : Address (multi-line, wraps)
    F({ id: 'addr_label', label: 'Label: Address', text: 'Address', x: 108, y: 1573, fontSize: 52, bold: true }),
    F({ id: 'address', label: 'Address (value)', bind: 'address', prefix: ':', x: 348, y: 1573,
        fontSize: 52, bold: true, maxWidth: 900, lineHeight: 64 }),

    // Footer : C-ID
    F({ id: 'cid', label: 'C-ID', bind: 'cid', prefix: 'C-ID:', x: 88, y: 1992, fontSize: 54, bold: true })
  ];

  /* Column aliases used by the auto-mapper to bind Excel headers -> fields.
   * Every entry is matched case/space/punctuation-insensitively. */
  var FIELD_ALIASES = {
    name:    ['student name', 'name', 'studentname', 'childname', 'child name', 'firstname', 'first name', 'full name', 'fullname', 'student'],
    std:     ['std', 'standard', 'classname', 'class name', 'class', 'grade'],
    div:     ['div', 'division', 'divname', 'div name', 'section', 'sec'],
    dob:     ['dob', 'd.o.b', 'date of birth', 'birthdate', 'birth date'],
    grno:    ['gr no', 'grno', 'grnumber', 'gr number', 'gr.no', 'general register', 'g r no'],
    // Primary parent / mobile number (Parent 1, or a pre-combined field).
    mob:     ['anyparentnumber', 'any parent number', 'parent number', 'parentnumber', 'parent no',
              'parent 1 number', 'parent1 number', 'parent 1', 'parent1', 'mob no', 'mobile',
              'mob', 'phone', 'phone no', 'contact', 'mobile no', 'contact no', 'father mobile', 'primary contact'],
    // Secondary parent number (Parent 2) — combined with mob at build time.
    mob2:    ['parent 2 number', 'parent2 number', 'parent 2', 'parent2', 'emergency contact',
              'alternate number', 'alternate contact', 'secondary contact', 'mother mobile'],
    address: ['address', 'addr', 'residential address', 'full address'],
    cid:     ['c-id', 'cid', 'vmsid', 'child id', 'childid', 'card id', 'card no', 'student id', 'admission no', 'adm no', 'roll no', 'id'],
    photo:   ['studentpicture', 'student picture', 'image', 'photo', 'picture', 'photo id', 'photo name', 'image url', 'photo url', 'file']
  };

  /* Keys used (in order) to match a photo file to a student row. */
  var PHOTO_MATCH_KEYS = ['cid', 'admissionno', 'admission', 'rollno', 'roll', 'studentid', 'grno', 'id'];

  // Bump when the preset geometry/styling changes so existing autosaves refresh
  // their fields (e.g. black photo border, CR80 size) instead of keeping stale ones.
  IDCS.PRESET_VERSION = 8;

  IDCS.CARD_W = CARD_W;
  IDCS.CARD_H = CARD_H;
  IDCS.CARD_W_MM = CARD_W_MM;
  IDCS.CARD_H_MM = CARD_H_MM;
  IDCS.FONT = FONT;
  IDCS.makeField = F;
  IDCS.PRESET_FIELDS = PRESET_FIELDS;
  IDCS.FIELD_ALIASES = FIELD_ALIASES;
  IDCS.PHOTO_MATCH_KEYS = PHOTO_MATCH_KEYS;

  // A fresh deep copy of the preset field list (so edits don't mutate the source).
  IDCS.clonePresetFields = function () {
    return PRESET_FIELDS.map(function (f) { return JSON.parse(JSON.stringify(f)); });
  };
})(window.IDCS = window.IDCS || {});
