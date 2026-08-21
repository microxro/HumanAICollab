/* ==========================================================================
   utils.js — dates, formatting, DOM, misc helpers
   ========================================================================== */

window.App = window.App || {};

App.utils = (function () {
  const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /* -------------------------------------------------------------- ids -- */

  let seq = 0;
  function uid(prefix) {
    seq += 1;
    return (prefix || "id") + "_" + Date.now().toString(36) + seq.toString(36);
  }

  /* ------------------------------------------------------------ dates -- */

  /**
   * Parse "YYYY-MM-DD" as a LOCAL date (avoids the UTC shift of new Date(str)).
   *
   * Returns null for anything unusable. It used to return null for a falsy
   * input but an *Invalid Date* for garbage like "not-a-date" — two different
   * failure shapes from one function, so callers guarded for one and were
   * caught by the other. One shape now: null, always.
   */
  function parseDate(iso) {
    if (!iso) return null;
    if (iso instanceof Date) return Number.isNaN(iso.getTime()) ? null : iso;
    const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
    const dt = new Date(y, m - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  // Local "YYYY-MM-DD" key for a Date.
  function dateKey(d) {
    const dt = d instanceof Date ? d : parseDate(d);
    if (!dt || Number.isNaN(dt.getTime())) return "";
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function today() { return dateKey(new Date()); }

  function addDays(d, n) {
    const dt = d instanceof Date ? new Date(d) : parseDate(d);
    dt.setDate(dt.getDate() + n);
    return dt;
  }

  function startOfWeek(d, weekStartsMonday) {
    const dt = d instanceof Date ? new Date(d) : parseDate(d);
    const day = dt.getDay();
    const diff = weekStartsMonday ? (day === 0 ? -6 : 1 - day) : -day;
    dt.setDate(dt.getDate() + diff);
    dt.setHours(0, 0, 0, 0);
    return dt;
  }

  function diffDays(aIso, bIso) {
    const a = parseDate(aIso), b = parseDate(bIso);
    return Math.round((a - b) / 86400000);
  }

  function dowName(iso, long) {
    const d = parseDate(iso);
    if (!d) return "";
    return (long ? DOW_LONG : DOW_SHORT)[d.getDay()];
  }

  function fmtDate(iso, style) {
    const d = parseDate(iso);
    if (!d) return "—";
    if (style === "long") return `${DOW_LONG[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
    if (style === "full") return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    if (style === "day") return `${DOW_SHORT[d.getDay()]} ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
    return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
  }

  // "Today" / "Tomorrow" / "3 days overdue" / "in 5 days"
  function relDate(iso) {
    const n = diffDays(iso, today());
    if (n === 0) return "Today";
    if (n === 1) return "Tomorrow";
    if (n === -1) return "Yesterday";
    if (n < 0) return `${Math.abs(n)} days overdue`;
    if (n < 7) return `in ${n} days`;
    return fmtDate(iso);
  }

  /* ------------------------------------------------------------ times -- */

  // "HH:MM" -> minutes since midnight
  function toMin(hhmm) {
    if (!hhmm) return 0;
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + (m || 0);
  }

  function fromMin(mins) {
    const h = Math.floor(mins / 60) % 24;
    const m = Math.round(mins % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  function nowMin() {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  function fmtTime(hhmm) {
    if (!hhmm) return "";
    const [h, m] = hhmm.split(":").map(Number);
    const ap = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
  }

  // F052 — convert an "HH:MM" wall-clock time posted in `fromTz` to the
  // equivalent wall-clock time in the browser's own local zone, using only
  // the built-in Intl API (no timezone library). Same-day conversions only.
  function convertWallTime(hhmm, fromTz) {
    if (!hhmm || !fromTz) return hhmm;
    try {
      const [hh, mm] = hhmm.split(":").map(Number);
      const dayIso = today();
      const refUtc = new Date(`${dayIso}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);
      const fmt = new Intl.DateTimeFormat("en-US", { timeZone: fromTz, hour: "2-digit", minute: "2-digit", hour12: false });
      const [shh, smm] = fmt.format(refUtc).split(":").map(Number);
      let offsetMin = (shh * 60 + smm) - (hh * 60 + mm);
      if (offsetMin > 720) offsetMin -= 1440;
      if (offsetMin < -720) offsetMin += 1440;
      const classUtcMin = (hh * 60 + mm) - offsetMin;
      const classUtc = new Date(`${dayIso}T00:00:00Z`);
      classUtc.setUTCMinutes(classUtc.getUTCMinutes() + classUtcMin);
      const localFmt = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
      return localFmt.format(classUtc);
    } catch (e) {
      return hhmm;
    }
  }

  // 135 -> "2h 15m"
  function fmtDur(mins) {
    const m = Math.round(mins);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  }

  // seconds -> "25:00"
  function clock(secs) {
    const s = Math.max(0, Math.round(secs));
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  /* ---------------------------------------------------------- strings -- */

  function initials(name) {
    return (name || "?")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * A URL that is safe to put in an href.
   *
   * `esc()` neutralises quote-breakout but says nothing about the scheme, so
   * an attacker-supplied `javascript:` survived it intact. Anything outside
   * the allow-list collapses to "#".
   */
  function safeUrl(url) {
    const u = String(url == null ? "" : url).trim();
    if (!u) return "#";
    // Strip control characters first: "java\tscript:" is parsed as a scheme
    // by browsers but wouldn't match the pattern below.
    const clean = u.replace(/[\u0000-\u001f\u007f]/g, "");
    return /^(https?:\/\/|mailto:|tel:|#|\/)/i.test(clean) ? clean : "#";
  }

  /** Conservative email shape, used to decide whether a mailto: is buildable. */
  function isEmail(v) {
    return /^[^\s@<>"'`]+@[^\s@<>"'`]+\.[^\s@<>"'`]{2,}$/.test(String(v == null ? "" : v).trim());
  }

  /**
   * A `mailto:` href built from untrusted parts, ready to interpolate.
   *
   * The address used to be dropped in raw — `mailto:${t.email}` — while the
   * subject and body around it were encoded, so a contact saved with an email
   * of `a@b.c"><img src=x onerror=…>` broke out of the attribute and executed
   * on every visit to that screen. Returns "#" when there's nothing sendable.
   */
  function mailtoHref(email, subject, body) {
    if (!isEmail(email)) return "#";
    const q = [];
    if (subject) q.push("subject=" + encodeURIComponent(subject));
    if (body) q.push("body=" + encodeURIComponent(body));
    return esc("mailto:" + encodeURIComponent(String(email).trim()).replace(/%40/g, "@") +
      (q.length ? "?" + q.join("&") : ""));
  }

  function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many || one + "s"}`;
  }

  function titleCase(s) {
    return String(s || "").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /* ----------------------------------------------------------- numbers -- */

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function round(v, places) {
    const p = Math.pow(10, places || 0);
    return Math.round(v * p) / p;
  }

  function sum(arr, fn) {
    return arr.reduce((a, x) => a + (fn ? fn(x) : x), 0);
  }

  function avg(arr, fn) {
    return arr.length ? sum(arr, fn) / arr.length : 0;
  }

  function groupBy(arr, fn) {
    const out = new Map();
    for (const item of arr) {
      const k = fn(item);
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(item);
    }
    return out;
  }

  function sortBy(arr, fn, desc) {
    return [...arr].sort((a, b) => {
      const x = fn(a), y = fn(b);
      if (x < y) return desc ? 1 : -1;
      if (x > y) return desc ? -1 : 1;
      return 0;
    });
  }

  /* -------------------------------------------------------------- DOM -- */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function on(root, evt, sel, handler) {
    root.addEventListener(evt, (e) => {
      const t = e.target.closest(sel);
      if (t && root.contains(t)) handler(e, t);
    });
  }

  // Readable text color for an arbitrary background hex.
  function contrastText(hex) {
    const h = String(hex || "").replace("#", "");
    if (h.length < 6) return "#fff";
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.62 ? "#10141f" : "#ffffff";
  }

  /* ------------------------------------------------------- contrast maths -- */

  function _srgb(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }

  function _rgb(hex) {
    const h = String(hex || "#000000").replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16);
    return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0];
  }

  function luminance(hex) {
    const [r, g, b] = _rgb(hex);
    return 0.2126 * _srgb(r) + 0.7152 * _srgb(g) + 0.0722 * _srgb(b);
  }

  /** WCAG contrast ratio between two opaque colours. */
  function contrastRatio(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  const _hex = (r, g, b) =>
    "#" + [r, g, b].map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, "0")).join("");

  /**
   * A readable version of `hex` for text on `bg`.
   *
   * Class colours are user-chosen, and several views render a class name in
   * its own colour on a 14%-alpha tint of that same colour — which for a
   * mid-tone like the default indigo lands around 3:1 and fails WCAG AA. This
   * walks the colour toward black (on a light background) or white (on a dark
   * one) until it clears the target, so any colour a student picks stays
   * legible without losing its identity.
   */
  function readableOn(hex, bg, target) {
    const want = target || 4.5;
    if (contrastRatio(hex, bg) >= want) return hex;
    const [r, g, b] = _rgb(hex);
    const towardWhite = luminance(bg) < 0.5;
    for (let f = 0.02; f <= 1.001; f += 0.02) {
      const c = towardWhite
        ? _hex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f)
        : _hex(r * (1 - f), g * (1 - f), b * (1 - f));
      if (contrastRatio(c, bg) >= want) return c;
    }
    return towardWhite ? "#ffffff" : "#000000";
  }

  /**
   * `{ bg, fg }` for a coloured tag: a soft tint of the class colour with
   * text guaranteed readable against it. `dark` selects the theme's surface,
   * since the tint composites over that.
   */
  function tagColors(hex, dark) {
    const surface = dark ? "#141926" : "#ffffff";
    const [r, g, b] = _rgb(hex);
    const a = dark ? 0.22 : 0.14;
    const [sr, sg, sb] = _rgb(surface);
    // The tint as it will actually be composited, so contrast is measured
    // against what the eye sees rather than against a transparent colour.
    const flat = _hex(sr + (r - sr) * a, sg + (g - sg) * a, sb + (b - sb) * a);
    return { bg: flat, fg: readableOn(hex, flat, 4.5) };
  }

  function hexAlpha(hex, alpha) {
    const h = String(hex || "#000").replace("#", "");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms || 200);
    };
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ----------------------------------------------------------- grades -- */

  const LETTER_TABLE = [
    { min: 97, letter: "A+", gpa: 4.0 }, { min: 93, letter: "A", gpa: 4.0 },
    { min: 90, letter: "A-", gpa: 3.7 }, { min: 87, letter: "B+", gpa: 3.3 },
    { min: 83, letter: "B", gpa: 3.0 },  { min: 80, letter: "B-", gpa: 2.7 },
    { min: 77, letter: "C+", gpa: 2.3 }, { min: 73, letter: "C", gpa: 2.0 },
    { min: 70, letter: "C-", gpa: 1.7 }, { min: 67, letter: "D+", gpa: 1.3 },
    { min: 63, letter: "D", gpa: 1.0 },  { min: 60, letter: "D-", gpa: 0.7 },
    { min: 0,  letter: "F", gpa: 0.0 }
  ];

  function pctToLetter(pct) {
    if (pct == null || isNaN(pct)) return "—";
    return (LETTER_TABLE.find((r) => pct >= r.min) || LETTER_TABLE[LETTER_TABLE.length - 1]).letter;
  }

  function pctToGpa(pct) {
    if (pct == null || isNaN(pct)) return 0;
    return (LETTER_TABLE.find((r) => pct >= r.min) || LETTER_TABLE[LETTER_TABLE.length - 1]).gpa;
  }

  // "a" | "b" | "c" | "d" | "f" — for CSS class on .grade-pill
  function gradeClass(pct) {
    if (pct == null || isNaN(pct)) return "";
    if (pct >= 90) return "a";
    if (pct >= 80) return "b";
    if (pct >= 70) return "c";
    if (pct >= 60) return "d";
    return "f";
  }

  // U15 — subject icons: a second, non-color channel for identifying a
  // class at a glance, same spirit as the nav's own glyph icons (plain
  // Unicode characters, not an image/SVG library, so nothing new to load
  // and nothing that can render as an emoji on some platform and not
  // others — every glyph below comes from the Geometric Shapes/Greek/Math
  // blocks, which have no emoji presentation form).
  const SUBJECT_ICONS = [
    { key: "math", label: "Math", icon: "π" },
    { key: "science", label: "Science", icon: "Ω" },
    { key: "english", label: "English / Language Arts", icon: "¶" },
    { key: "history", label: "History / Social Studies", icon: "◒" },
    { key: "language", label: "World Language", icon: "§" },
    { key: "art", label: "Art", icon: "◕" },
    { key: "music", label: "Music", icon: "♪" },
    { key: "pe", label: "PE / Health", icon: "◔" },
    { key: "cs", label: "Computer Science", icon: "◖" },
    { key: "business", label: "Business / Economics", icon: "▰" },
    { key: "other", label: "Other / Elective", icon: "▪" }
  ];
  const SUBJECT_ICON_MAP = Object.fromEntries(SUBJECT_ICONS.map((s) => [s.key, s.icon]));

  // Order matters: more specific/compound categories are checked before
  // broader ones that would otherwise false-positive on a shared word —
  // e.g. "computer" must be checked before the bare "science" in
  // "AP Computer Science" ever gets a chance to match.
  const SUBJECT_KEYWORDS = {
    cs: ["computer", "programming", "coding", "cs", "technology", "robotics"],
    business: ["business", "economics", "finance", "accounting", "marketing"],
    math: ["math", "algebra", "geometry", "calculus", "trig", "statistics"],
    science: ["science", "biology", "chemistry", "physics", "anatomy", "environmental", "astronomy"],
    english: ["english", "language arts", "literature", "writing", "reading", "composition"],
    history: ["history", "government", "civics", "geography", "social studies"],
    language: ["spanish", "french", "german", "mandarin", "chinese", "japanese", "latin", "italian", "language"],
    art: ["art", "design", "drawing", "painting", "ceramics", "photography", "theater", "theatre", "drama"],
    music: ["music", "band", "choir", "orchestra", "chorus"],
    pe: ["gym", "physical education", "pe", "health", "athletics", "fitness"]
  };

  function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  /** Guess a subject key from a free-text class name — used as the default
   *  before a manual override in the class form takes over. Whole-word
   *  matching, not substring — otherwise a short keyword like "pe" or "cs"
   *  false-positives on any word that merely ends the same way ("economics"
   *  contains "cs", "shape" contains "pe"). */
  function guessSubjectIcon(name) {
    const n = String(name || "").toLowerCase();
    for (const [key, words] of Object.entries(SUBJECT_KEYWORDS)) {
      if (words.some((w) => new RegExp("\\b" + escapeRegExp(w) + "\\b").test(n))) return key;
    }
    return "other";
  }

  function subjectIconChar(key) { return SUBJECT_ICON_MAP[key] || SUBJECT_ICON_MAP.other; }

  // U17 — skeleton placeholders: the shape of what's loading, not the word.
  function skeletonRows(n) {
    return Array.from({ length: n || 3 }).map(() => `
      <div class="row gap-10" style="padding:11px 14px;border-bottom:1px solid var(--border)">
        <div class="skel skel-avatar"></div>
        <div class="grow">
          <div class="skel skel-line" style="width:${45 + Math.random() * 35}%"></div>
          <div class="skel skel-line skel-line-sm" style="width:${25 + Math.random() * 25}%"></div>
        </div>
      </div>`).join("");
  }

  function skeletonCards(n) {
    return `<div class="grid g-3">${Array.from({ length: n || 3 }).map(() => `
      <div class="card"><div class="card-body">
        <div class="skel skel-line" style="width:60%;height:15px;margin-bottom:10px"></div>
        <div class="skel skel-line skel-line-sm" style="width:40%;margin-bottom:14px"></div>
        <div class="row gap-6"><div class="skel skel-chip"></div><div class="skel skel-chip"></div></div>
      </div></div>`).join("")}</div>`;
  }

  return {
    DOW_SHORT, DOW_LONG, MONTHS, MONTHS_SHORT, LETTER_TABLE,
    uid, parseDate, dateKey, today, addDays, startOfWeek, diffDays, dowName,
    fmtDate, relDate, toMin, fromMin, nowMin, fmtTime, fmtDur, clock, convertWallTime,
    initials, esc, safeUrl, isEmail, mailtoHref, plural, titleCase,
    clamp, round, sum, avg, groupBy, sortBy,
    $, $$, on, contrastText, hexAlpha, luminance, contrastRatio, readableOn, tagColors, debounce, download,
    pctToLetter, pctToGpa, gradeClass, skeletonRows, skeletonCards,
    SUBJECT_ICONS, guessSubjectIcon, subjectIconChar
  };
})();
