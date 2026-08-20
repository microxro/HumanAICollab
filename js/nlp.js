/* ==========================================================================
   nlp.js — natural-language quick add

   Turns a line like
       "calc pset due friday high 45m #homework"
   into a structured assignment draft. Deliberately rule-based and tiny: it
   runs offline, is fully predictable, and shows the user what it understood
   before anything is saved.
   ========================================================================== */

App.nlp = (function () {
  const U = App.utils, S = App.store;

  const DOW = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2,
                wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
                fri: 5, friday: 5, sat: 6, saturday: 6 };

  const MONTHS = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
                   may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
                   sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
                   dec: 11, december: 11 };

  const TYPES = ["homework", "reading", "essay", "project", "lab", "test", "quiz",
                 "presentation", "exam", "paper", "worksheet", "pset"];

  const TYPE_ALIAS = { pset: "Homework", paper: "Essay", worksheet: "Homework", exam: "Test", hw: "Homework" };

  /* ------------------------------------------------------------- dates -- */

  function nextDow(target, allowToday) {
    const now = new Date();
    const cur = now.getDay();
    let delta = (target - cur + 7) % 7;
    if (delta === 0 && !allowToday) delta = 7;
    return U.dateKey(U.addDays(now, delta));
  }

  // Returns { date, matched } or null. `matched` is the literal text consumed.
  function findDate(text) {
    const t = text.toLowerCase();

    let m = t.match(/\b(today|tonight)\b/);
    if (m) return { date: U.today(), matched: m[0] };

    m = t.match(/\btomorrow|tmrw|tmr\b/);
    if (m) return { date: U.dateKey(U.addDays(new Date(), 1)), matched: m[0] };

    m = t.match(/\bday after tomorrow\b/);
    if (m) return { date: U.dateKey(U.addDays(new Date(), 2)), matched: m[0] };

    // "in 3 days" / "in 2 weeks"
    m = t.match(/\bin (\d+) (day|days|week|weeks)\b/);
    if (m) {
      const n = Number(m[1]) * (m[2].startsWith("week") ? 7 : 1);
      return { date: U.dateKey(U.addDays(new Date(), n)), matched: m[0] };
    }

    // "next friday" / "this monday" / bare "friday"
    m = t.match(/\b(next|this)\s+(sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat)[a-z]*\b/);
    if (m) {
      const base = nextDow(DOW[m[2]], m[1] === "this");
      const date = m[1] === "next" ? U.dateKey(U.addDays(U.parseDate(base), 7)) : base;
      return { date, matched: m[0] };
    }
    m = t.match(/\b(sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat)(day|s|nes|rs|urday|nesday|rsday)?\b/);
    if (m && DOW[m[0]] !== undefined) return { date: nextDow(DOW[m[0]], false), matched: m[0] };

    // "oct 14" / "14 oct" / "10/14"
    m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/);
    if (m) {
      const mo = MONTHS[m[1]], day = Number(m[2]);
      const now = new Date();
      let y = now.getFullYear();
      if (mo < now.getMonth() || (mo === now.getMonth() && day < now.getDate())) y++;
      return { date: U.dateKey(new Date(y, mo, day)), matched: m[0] };
    }
    m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (m) {
      const mo = Number(m[1]) - 1, day = Number(m[2]);
      let y = m[3] ? Number(m[3]) : new Date().getFullYear();
      if (y < 100) y += 2000;
      if (!m[3]) {
        const now = new Date();
        if (mo < now.getMonth() || (mo === now.getMonth() && day < now.getDate())) y++;
      }
      if (mo >= 0 && mo < 12 && day >= 1 && day <= 31) {
        return { date: U.dateKey(new Date(y, mo, day)), matched: m[0] };
      }
    }
    return null;
  }

  /* -------------------------------------------------------- other bits -- */

  function findDuration(text) {
    let m = text.match(/\b(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)\b/i);
    if (m) return { minutes: Math.round(Number(m[1]) * 60), matched: m[0] };
    m = text.match(/\b(\d+)\s*(m|min|mins|minute|minutes)\b/i);
    if (m) return { minutes: Number(m[1]), matched: m[0] };
    return null;
  }

  function findPriority(text) {
    let m = text.match(/\b(high|urgent|important|!{1,3})\b|!!+/i);
    if (m) return { priority: "high", matched: m[0] };
    m = text.match(/\b(low|minor|whenever)\b/i);
    if (m) return { priority: "low", matched: m[0] };
    m = text.match(/\b(med|medium|normal)\b/i);
    if (m) return { priority: "med", matched: m[0] };
    return null;
  }

  function findPoints(text) {
    const m = text.match(/\b(\d+)\s*(pts?|points)\b/i);
    return m ? { points: Number(m[1]), matched: m[0] } : null;
  }

  function findType(text) {
    const t = text.toLowerCase();
    for (const ty of TYPES) {
      const re = new RegExp(`\\b${ty}\\b`, "i");
      const m = t.match(re);
      if (m) return { type: TYPE_ALIAS[ty] || U.titleCase(ty), matched: m[0], keep: true };
    }
    return null;
  }

  /**
   * Match a class by name, code, or a short prefix ("calc" → AP Calculus AB).
   * Scores candidates so "chem" doesn't accidentally beat an exact code match.
   */
  function findClass(text) {
    const t = text.toLowerCase();
    let best = null;

    S.termClasses().forEach((c) => {
      const name = c.name.toLowerCase();
      const code = (c.code || "").toLowerCase();
      const words = name.split(/[^a-z0-9]+/).filter((w) => w.length > 2);

      if (code && t.includes(code)) {
        if (!best || best.score < 100) best = { cls: c, score: 100, matched: code };
        return;
      }
      if (t.includes(name)) {
        if (!best || best.score < 90) best = { cls: c, score: 90, matched: name };
        return;
      }
      words.forEach((w) => {
        // Whole word, or a >=4-char prefix of one ("calc" for "calculus").
        const re = new RegExp(`\\b${w}\\b`, "i");
        if (re.test(t)) {
          if (!best || best.score < 70) best = { cls: c, score: 70, matched: w };
          return;
        }
        for (let len = w.length; len >= 4; len--) {
          const stub = w.slice(0, len);
          if (new RegExp(`\\b${stub}\\b`, "i").test(t)) {
            if (!best || best.score < 40 + len) best = { cls: c, score: 40 + len, matched: stub };
            break;
          }
        }
      });
    });

    return best;
  }

  /* ------------------------------------------------------------- parse -- */

  /**
   * parse("calc pset due friday high 45m")
   *   → { title, classId, due, type, priority, estMinutes, points, tokens }
   * `tokens` lists what was recognized so the UI can show its work.
   */
  function parse(input) {
    const raw = String(input || "").trim();
    if (!raw) return null;

    let rest = raw;
    const tokens = [];
    const out = {
      title: "", classId: null, due: U.today(), type: "Homework",
      priority: "med", estMinutes: 45, points: 100, categoryId: null
    };

    const consume = (matched) => {
      if (!matched) return;
      const i = rest.toLowerCase().indexOf(String(matched).toLowerCase());
      if (i >= 0) rest = rest.slice(0, i) + " " + rest.slice(i + String(matched).length);
    };

    const date = findDate(rest);
    if (date) {
      out.due = date.date;
      tokens.push({ kind: "due", label: U.fmtDate(date.date, "day"), text: date.matched });
      consume(date.matched);
    }

    const dur = findDuration(rest);
    if (dur) {
      out.estMinutes = dur.minutes;
      tokens.push({ kind: "time", label: U.fmtDur(dur.minutes), text: dur.matched });
      consume(dur.matched);
    }

    const pri = findPriority(rest);
    if (pri) {
      out.priority = pri.priority;
      tokens.push({ kind: "priority", label: U.titleCase(pri.priority) + " priority", text: pri.matched });
      consume(pri.matched);
    }

    const pts = findPoints(rest);
    if (pts) {
      out.points = pts.points;
      tokens.push({ kind: "points", label: pts.points + " pts", text: pts.matched });
      consume(pts.matched);
    }

    const ty = findType(rest);
    if (ty) {
      out.type = ty.type;
      tokens.push({ kind: "type", label: ty.type, text: ty.matched });
      // Keep the word in the title — "essay" is useful text, unlike "friday".
    }

    const cl = findClass(rest);
    if (cl) {
      out.classId = cl.cls.id;
      tokens.push({ kind: "class", label: cl.cls.name, text: cl.matched, color: cl.cls.color });
      consume(cl.matched);
      const cat = (cl.cls.categories || []).find((k) =>
        k.name.toLowerCase().includes((out.type || "").toLowerCase().slice(0, 4)));
      out.categoryId = cat ? cat.id : (cl.cls.categories || [])[0] ? cl.cls.categories[0].id : null;
    } else {
      const first = S.termClasses()[0];
      if (first) {
        out.classId = first.id;
        out.categoryId = (first.categories || [])[0] ? first.categories[0].id : null;
      }
    }

    // Strip filler words left behind and tidy up whitespace.
    out.title = rest
      .replace(/\b(due|by|on|at|for|the|a|an)\b/gi, " ")
      .replace(/[#@]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!out.title) out.title = out.type;
    out.title = out.title.charAt(0).toUpperCase() + out.title.slice(1);

    return { ...out, tokens, raw };
  }

  return { parse, findDate, findClass };
})();
