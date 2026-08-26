/* ==========================================================================
   ics.js — iCalendar export and import (RFC 5545, the parts that matter)

   Export: classes as weekly recurring events, activities as practices,
   one-off events, and assignment due dates — as a downloadable .ics that
   Apple/Google/Outlook Calendar will import.
   Import: parses .ics from Canvas / Google Classroom / Infinite Campus and
   maps VEVENTs onto assignments or events.
   ========================================================================== */

App.ics = (function () {
  const U = App.utils, S = App.store;

  const DOW_TO_ICS = { Sun: "SU", Mon: "MO", Tue: "TU", Wed: "WE", Thu: "TH", Fri: "FR", Sat: "SA" };

  /* ------------------------------------------------------------ export -- */

  function pad(n) { return String(n).padStart(2, "0"); }

  function stamp(d) {
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
           `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  }

  // Local (floating) date-time — keeps events at the right wall-clock time.
  function local(iso, hhmm) {
    const d = U.parseDate(iso);
    const [h, m] = (hhmm || "00:00").split(":").map(Number);
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(h)}${pad(m)}00`;
  }

  function dateOnly(iso) {
    const d = U.parseDate(iso);
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  }

  // Escape per spec, then fold lines at 75 octets.
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/\\/g, "\\\\").replace(/;/g, "\\;")
      .replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  }

  function fold(line) {
    if (line.length <= 74) return line;
    const parts = [line.slice(0, 74)];
    let rest = line.slice(74);
    while (rest.length > 73) { parts.push(" " + rest.slice(0, 73)); rest = rest.slice(73); }
    if (rest) parts.push(" " + rest);
    return parts.join("\r\n");
  }

  function vevent(fields) {
    const lines = ["BEGIN:VEVENT"];
    Object.entries(fields).forEach(([k, v]) => { if (v) lines.push(fold(`${k}:${v}`)); });
    lines.push("END:VEVENT");
    return lines;
  }

  /**
   * Build a full calendar. Options let the user pick what to include.
   */
  function build(opts) {
    const o = Object.assign({ classes: true, activities: true, events: true, assignments: true, weeks: 18 }, opts);
    const now = stamp(new Date());
    const term = S.currentTerm();
    const until = term ? dateOnly(term.end) + "T235959Z" : null;

    const out = [
      "BEGIN:VCALENDAR", "VERSION:2.0",
      "PRODID:-//StudyHold//School Tracker//EN",
      "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      `X-WR-CALNAME:${esc(S.profile.name + " — School")}`,
      "X-WR-TIMEZONE:" + (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC")
    ];

    if (o.classes) {
      S.termClasses().forEach((c) => {
        const p = S.period(c.periodId);
        if (!p || !c.days.length) return;
        // Anchor on the first matching weekday from the term start.
        const start = term ? U.parseDate(term.start) : new Date();
        let anchor = null;
        for (let i = 0; i < 14; i++) {
          const d = U.addDays(start, i);
          if (c.days.includes(U.DOW_SHORT[d.getDay()])) { anchor = U.dateKey(d); break; }
        }
        if (!anchor) return;
        const teacher = S.teacher(c.teacherId);
        out.push(...vevent({
          UID: `class-${c.id}@scholar`,
          DTSTAMP: now,
          DTSTART: local(anchor, p.start),
          DTEND: local(anchor, p.end),
          RRULE: `FREQ=WEEKLY;BYDAY=${c.days.map((d) => DOW_TO_ICS[d]).join(",")}` + (until ? `;UNTIL=${until}` : ""),
          SUMMARY: esc(c.name),
          LOCATION: esc("Room " + (c.room || "")),
          DESCRIPTION: esc([c.code, teacher ? "Teacher: " + teacher.name : ""].filter(Boolean).join("\n")),
          CATEGORIES: "CLASS"
        }));
      });
    }

    if (o.activities) {
      S.db.activities.forEach((a) => {
        if (!a.days.length) return;
        let anchor = null;
        for (let i = 0; i < 14; i++) {
          const d = U.addDays(new Date(), i);
          if (a.days.includes(U.DOW_SHORT[d.getDay()])) { anchor = U.dateKey(d); break; }
        }
        if (!anchor) return;
        out.push(...vevent({
          UID: `activity-${a.id}@scholar`,
          DTSTAMP: now,
          DTSTART: local(anchor, a.start),
          DTEND: local(anchor, a.end),
          RRULE: `FREQ=WEEKLY;BYDAY=${a.days.map((d) => DOW_TO_ICS[d]).join(",")}` + (until ? `;UNTIL=${until}` : ""),
          SUMMARY: esc(a.name),
          LOCATION: esc(a.location),
          DESCRIPTION: esc(`${a.type}${a.role ? " · " + a.role : ""}`),
          CATEGORIES: "ACTIVITY"
        }));
      });
    }

    if (o.events) {
      S.db.events.forEach((e) => {
        const allDay = !e.start;
        out.push(...vevent(allDay ? {
          UID: `event-${e.id}@scholar`, DTSTAMP: now,
          "DTSTART;VALUE=DATE": dateOnly(e.date),
          "DTEND;VALUE=DATE": dateOnly(U.dateKey(U.addDays(U.parseDate(e.date), 1))),
          SUMMARY: esc(e.title), LOCATION: esc(e.location),
          DESCRIPTION: esc(e.notes), CATEGORIES: esc(e.type.toUpperCase())
        } : {
          UID: `event-${e.id}@scholar`, DTSTAMP: now,
          DTSTART: local(e.date, e.start),
          DTEND: local(e.date, e.end || e.start),
          SUMMARY: esc(e.title), LOCATION: esc(e.location),
          DESCRIPTION: esc(e.notes), CATEGORIES: esc(e.type.toUpperCase())
        }));
      });
    }

    if (o.assignments) {
      S.db.assignments.filter((a) => a.status !== "done").forEach((a) => {
        out.push(...vevent({
          UID: `assignment-${a.id}@scholar`, DTSTAMP: now,
          "DTSTART;VALUE=DATE": dateOnly(a.due),
          "DTEND;VALUE=DATE": dateOnly(U.dateKey(U.addDays(U.parseDate(a.due), 1))),
          SUMMARY: esc(`📌 ${a.title} (${S.className(a.classId)})`),
          DESCRIPTION: esc([a.notes, `${a.points} points`, `Est. ${U.fmtDur(a.estMinutes)}`].filter(Boolean).join("\n")),
          CATEGORIES: "ASSIGNMENT"
        }));
      });
    }

    out.push("END:VCALENDAR");
    return out.join("\r\n");
  }

  function download(opts) {
    U.download(`studyhold-${U.today()}.ics`, build(opts), "text/calendar");
  }

  /* ------------------------------------------------------------ import -- */

  function unfold(text) {
    return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  }

  function unescape(s) {
    return String(s || "")
      .replace(/\\n/gi, "\n").replace(/\\,/g, ",")
      .replace(/\\;/g, ";").replace(/\\\\/g, "\\");
  }

  // "20260914T133000Z" | "20260914" → { iso, time }
  function parseStamp(val) {
    const m = String(val).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
    if (!m) return null;
    const [, y, mo, d, h, mi, , z] = m;
    if (!h) return { iso: `${y}-${mo}-${d}`, time: "" };
    if (z) {
      const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
      return { iso: U.dateKey(dt), time: `${pad(dt.getHours())}:${pad(dt.getMinutes())}` };
    }
    return { iso: `${y}-${mo}-${d}`, time: `${h}:${mi}` };
  }

  /** Parse .ics text into plain VEVENT objects. */
  function parse(text) {
    const lines = unfold(String(text)).split("\n");
    const events = [];
    let cur = null;

    lines.forEach((line) => {
      const t = line.trim();
      if (t === "BEGIN:VEVENT") { cur = {}; return; }
      if (t === "END:VEVENT") { if (cur) events.push(cur); cur = null; return; }
      if (!cur) return;

      const idx = t.indexOf(":");
      if (idx < 0) return;
      const rawKey = t.slice(0, idx);
      const value = t.slice(idx + 1);
      const key = rawKey.split(";")[0].toUpperCase();

      if (key === "DTSTART") cur.start = parseStamp(value);
      else if (key === "DTEND") cur.end = parseStamp(value);
      else if (key === "SUMMARY") cur.summary = unescape(value);
      else if (key === "DESCRIPTION") cur.description = unescape(value);
      else if (key === "LOCATION") cur.location = unescape(value);
      else if (key === "UID") cur.uid = value;
      else if (key === "CATEGORIES") cur.categories = value;
      else if (key === "RRULE") cur.rrule = value;
    });

    return events.filter((e) => e.start && e.summary);
  }

  /**
   * Turn parsed VEVENTs into a preview the import dialog can show, guessing
   * whether each is an assignment (due date) or a calendar event.
   */
  function preview(text) {
    const events = parse(text);
    const classes = S.termClasses();

    return events.map((e) => {
      const summary = e.summary;
      const lower = summary.toLowerCase();

      // Canvas / Classroom name assignments like "Essay 2 [ENG-302]" or
      // "Problem Set 4 (AP Calculus AB)".
      let classId = null;
      const bracket = summary.match(/[\[(]([^\])]+)[\])]\s*$/);
      const hay = (bracket ? bracket[1] : summary).toLowerCase();
      const hit = classes.find((c) =>
        (c.code && hay.includes(c.code.toLowerCase())) || hay.includes(c.name.toLowerCase()));
      if (hit) classId = hit.id;
      else {
        const guess = App.nlp.findClass(summary);
        if (guess) classId = guess.cls.id;
      }

      const isAssignment =
        /\b(due|assignment|homework|hw|essay|quiz|test|exam|lab|project|reading|worksheet)\b/.test(lower) ||
        (e.categories || "").toUpperCase().includes("ASSIGNMENT") ||
        (!e.start.time && !/\b(holiday|no school|break|meeting|game|practice)\b/.test(lower));

      return {
        kind: isAssignment ? "assignment" : "event",
        title: bracket ? summary.replace(bracket[0], "").trim() : summary,
        date: e.start.iso,
        start: e.start.time,
        end: e.end ? e.end.time : "",
        location: e.location || "",
        notes: e.description || "",
        classId,
        uid: e.uid || "",
        include: true
      };
    });
  }

  /** Commit a preview list (after the user has toggled rows) into the store. */
  function apply(rows) {
    let added = 0, skipped = 0;
    S.commit((db) => {
      rows.filter((r) => r.include).forEach((r) => {
        if (r.kind === "assignment") {
          const dupe = db.assignments.some((a) =>
            a.title.toLowerCase() === r.title.toLowerCase() && a.due === r.date);
          if (dupe) { skipped++; return; }
          const cls = r.classId ? db.classes.find((c) => c.id === r.classId) : null;
          db.assignments.push({
            id: U.uid("as"), title: r.title, classId: r.classId || (db.classes[0] || {}).id || null,
            categoryId: cls && cls.categories[0] ? cls.categories[0].id : null,
            due: r.date, assigned: U.today(), type: "Homework", priority: "med",
            status: "todo", points: 100, earned: null, graded: false,
            estMinutes: 45, actualMinutes: 0, subtasks: [], notes: r.notes,
            termId: (S.currentTerm() || {}).id, scheduledFor: null, scheduledMin: null,
            missing: false, importedUid: r.uid
          });
        } else {
          const dupe = db.events.some((e) => e.title === r.title && e.date === r.date);
          if (dupe) { skipped++; return; }
          db.events.push({
            id: U.uid("ev"), title: r.title, type: "School", date: r.date,
            start: r.start, end: r.end, classId: r.classId || null,
            location: r.location, notes: r.notes, importedUid: r.uid
          });
        }
        added++;
      });
    });
    return { added, skipped };
  }

  /* --------------------------------------------------------- CSV import -- */

  // Minimal RFC-4180 CSV reader (handles quoted fields and embedded commas).
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", inQuotes = false;
    const s = String(text).replace(/\r\n/g, "\n");

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inQuotes) {
        if (ch === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += ch;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim()));
  }

  /**
   * Map a CSV export (Canvas gradebook, Infinite Campus assignment list, or a
   * hand-rolled sheet) into the same preview shape as the ICS importer.
   */
  function previewCSV(text) {
    const rows = parseCSV(text);
    if (rows.length < 2) return [];

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (...names) => {
      for (const n of names) {
        const i = header.findIndex((h) => h === n || h.includes(n));
        if (i >= 0) return i;
      }
      return -1;
    };

    const iTitle = col("assignment", "title", "name", "task");
    const iDue = col("due", "due date", "date");
    const iClass = col("class", "course", "subject", "section");
    const iPoints = col("points", "possible", "max");
    const iScore = col("score", "grade", "earned");

    if (iTitle < 0) return [];

    return rows.slice(1).map((r) => {
      const title = (r[iTitle] || "").trim();
      if (!title) return null;

      let date = U.today();
      if (iDue >= 0 && r[iDue]) {
        const parsed = App.nlp.findDate(r[iDue].trim()) ;
        if (parsed) date = parsed.date;
        else {
          // `new Date("2026-09-14")` is parsed as midnight UTC, so dateKey()
          // in any timezone west of UTC returned the previous day — every
          // imported due date silently landed 24 hours early. U.parseDate
          // exists precisely to read a date string in local time.
          const d = U.parseDate(r[iDue].trim());
          if (d) date = U.dateKey(d);
        }
      }

      let classId = null;
      if (iClass >= 0 && r[iClass]) {
        const g = App.nlp.findClass(r[iClass]);
        if (g) classId = g.cls.id;
      }
      if (!classId) {
        const g = App.nlp.findClass(title);
        if (g) classId = g.cls.id;
      }

      const points = iPoints >= 0 && r[iPoints] ? Number(r[iPoints]) || 100 : 100;
      const earnedRaw = iScore >= 0 && r[iScore] !== undefined ? String(r[iScore]).trim() : "";
      const earned = earnedRaw !== "" && !isNaN(Number(earnedRaw)) ? Number(earnedRaw) : null;

      return {
        kind: "assignment", title, date, start: "", end: "", location: "",
        notes: "", classId, points, earned, include: true, uid: ""
      };
    }).filter(Boolean);
  }

  function applyCSV(rows) {
    let added = 0, skipped = 0;
    S.commit((db) => {
      rows.filter((r) => r.include).forEach((r) => {
        const dupe = db.assignments.some((a) =>
          a.title.toLowerCase() === r.title.toLowerCase() && a.due === r.date);
        if (dupe) { skipped++; return; }
        const cls = r.classId ? db.classes.find((c) => c.id === r.classId) : null;
        db.assignments.push({
          id: U.uid("as"), title: r.title, classId: r.classId || (db.classes[0] || {}).id || null,
          categoryId: cls && cls.categories[0] ? cls.categories[0].id : null,
          due: r.date, assigned: U.today(), type: "Homework", priority: "med",
          status: r.earned != null ? "done" : "todo",
          points: r.points || 100, earned: r.earned, graded: r.earned != null,
          estMinutes: 45, actualMinutes: 0, subtasks: [], notes: "",
          termId: (S.currentTerm() || {}).id, scheduledFor: null, scheduledMin: null, missing: false
        });
        added++;
      });
    });
    return { added, skipped };
  }

  return { build, download, parse, preview, apply, parseCSV, previewCSV, applyCSV };
})();
