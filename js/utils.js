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

  // Parse "YYYY-MM-DD" as a LOCAL date (avoids the UTC shift of new Date(str)).
  function parseDate(iso) {
    if (!iso) return null;
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  // Local "YYYY-MM-DD" key for a Date.
  function dateKey(d) {
    const dt = d instanceof Date ? d : parseDate(d);
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
    initials, esc, plural, titleCase,
    clamp, round, sum, avg, groupBy, sortBy,
    $, $$, on, contrastText, hexAlpha, debounce, download,
    pctToLetter, pctToGpa, gradeClass, skeletonRows, skeletonCards
  };
})();
