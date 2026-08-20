/* ==========================================================================
   planner.js — study auto-scheduler, estimate calibration, overload warnings

   The scheduler is earliest-deadline-first over real free time: it reads the
   timetable and activities to find gaps, splits each assignment into blocks,
   and fills days without exceeding a daily cap. Anything that cannot fit
   before its deadline is reported rather than silently dropped.
   ========================================================================== */

App.planner = (function () {
  const U = App.utils, S = App.store;

  /* ------------------------------------------------- estimate calibration */

  /**
   * Compare logged actual time against the original estimate on finished work
   * and derive a correction factor. Uses the median ratio so one disastrous
   * essay doesn't skew everything, and needs at least 4 samples to speak up.
   */
  function calibration() {
    const samples = S.db.assignments
      .filter((a) => a.status === "done" && a.actualMinutes > 0 && a.estMinutes > 0)
      .map((a) => ({ ratio: a.actualMinutes / a.estMinutes, type: a.type, a }));

    if (samples.length < 4) {
      return { ready: false, n: samples.length, multiplier: 1, byType: [] };
    }

    const ratios = samples.map((s) => s.ratio).sort((x, y) => x - y);
    const mid = Math.floor(ratios.length / 2);
    const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;

    const byType = [...U.groupBy(samples, (s) => s.type).entries()]
      .filter(([, arr]) => arr.length >= 2)
      .map(([type, arr]) => {
        const r = arr.map((s) => s.ratio).sort((x, y) => x - y);
        const m = Math.floor(r.length / 2);
        return {
          type, n: arr.length,
          ratio: r.length % 2 ? r[m] : (r[m - 1] + r[m]) / 2
        };
      })
      .sort((a, b) => b.ratio - a.ratio);

    return {
      ready: true,
      n: samples.length,
      multiplier: U.clamp(median, 0.4, 3),
      byType,
      worst: byType[0] || null
    };
  }

  /** Persist the learned multiplier so estimates everywhere get corrected. */
  function applyCalibration() {
    const c = calibration();
    if (!c.ready) return null;
    S.commit((db) => { db.settings.estimateMultiplier = U.round(c.multiplier, 2); });
    return c;
  }

  // Per-type correction when we have enough data for that type, else global.
  function correctedEstimate(a) {
    const c = calibration();
    if (!c.ready) return a.estMinutes || 0;
    const t = c.byType.find((x) => x.type === a.type);
    const factor = t ? t.ratio : c.multiplier;
    return Math.round((a.estMinutes || 0) * U.clamp(factor, 0.4, 3));
  }

  /* ------------------------------------------------------- free capacity */

  /**
   * Minutes available for studying on a date, after school and activities.
   * Returns { start, end, minutes, busy: [{start,end,label}] }.
   */
  function windowFor(iso) {
    const cfg = S.settings.planner;
    const dow = U.parseDate(iso).getDay();
    const weekend = dow === 0 || dow === 6;
    const start = U.toMin(weekend ? cfg.weekendStart : cfg.weekdayStart);
    const end = U.toMin(weekend ? cfg.weekendEnd : cfg.weekdayEnd);

    const busy = S.scheduleFor(iso)
      .filter((it) => it.start && it.end)
      .map((it) => ({ start: U.toMin(it.start), end: U.toMin(it.end), label: it.title }))
      .filter((b) => b.end > start && b.start < end)
      .sort((a, b) => a.start - b.start);

    // Merge overlaps so double-booked activities don't subtract twice.
    const merged = [];
    busy.forEach((b) => {
      const last = merged[merged.length - 1];
      if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
      else merged.push({ ...b });
    });

    const blocked = U.sum(merged, (b) => Math.min(end, b.end) - Math.max(start, b.start));
    const raw = Math.max(0, end - start - blocked);

    return {
      start, end, busy: merged,
      minutes: Math.min(raw, S.settings.planner.maxPerDay || raw)
    };
  }

  /** The open gaps themselves, for drag-to-time-block. */
  function gapsFor(iso) {
    const w = windowFor(iso);
    const gaps = [];
    let cursor = w.start;
    w.busy.forEach((b) => {
      if (b.start > cursor) gaps.push({ start: cursor, end: Math.min(b.start, w.end) });
      cursor = Math.max(cursor, b.end);
    });
    if (cursor < w.end) gaps.push({ start: cursor, end: w.end });
    return gaps.filter((g) => g.end - g.start >= 15);
  }

  /* ---------------------------------------------------------- scheduling */

  const PRIORITY_RANK = { high: 0, med: 1, low: 2 };

  /**
   * Build a study plan across the next `horizon` days.
   * Returns { days: [{date, capacity, used, blocks:[]}], unplaced: [], stats }
   */
  function build(horizonDays) {
    const cfg = S.settings.planner;
    const horizon = horizonDays || 14;
    const today = U.today();
    const blockMin = cfg.blockMin || 30;
    const buffer = cfg.bufferDays || 0;

    // Work items: remaining minutes per open assignment.
    const items = S.openAssignments()
      .filter((a) => U.diffDays(a.due, today) >= -3)
      .map((a) => {
        const est = correctedEstimate(a);
        const doneFrac = S.progressOf(a);
        const remaining = Math.max(0, Math.round(est * (1 - doneFrac)) - (a.actualMinutes || 0));
        return { a, remaining: Math.max(remaining, remaining > 0 ? blockMin : 0) };
      })
      .filter((x) => x.remaining > 0);

    // Earliest deadline first, high priority breaking ties.
    items.sort((x, y) => {
      if (x.a.due !== y.a.due) return x.a.due.localeCompare(y.a.due);
      return (PRIORITY_RANK[x.a.priority] ?? 1) - (PRIORITY_RANK[y.a.priority] ?? 1);
    });

    const days = [];
    for (let i = 0; i < horizon; i++) {
      const iso = U.dateKey(U.addDays(new Date(), i));
      const w = windowFor(iso);
      days.push({ date: iso, capacity: w.minutes, used: 0, blocks: [], gaps: gapsFor(iso) });
    }

    const MIN_CHUNK = 10;

    // Latest day a piece of work can be scheduled. Overdue work is workable
    // today — the deadline has passed, but the task hasn't gone away.
    const lastDay = (it) => {
      const due = it.a.due < today ? today : it.a.due;
      const buffered = U.dateKey(U.addDays(U.parseDate(due), -buffer));
      return buffered < today ? due : buffered;
    };

    // Greedy fill: for each day, take the most urgent work still workable.
    days.forEach((day) => {
      let left = day.capacity;
      while (left >= MIN_CHUNK) {
        // Skip (don't abort on) items too small to be worth a session — a
        // 7-minute remainder shouldn't strand the rest of the evening.
        const candidate = items.find((it) =>
          it.remaining >= MIN_CHUNK && day.date <= lastDay(it));
        if (!candidate) break;

        const chunk = Math.min(candidate.remaining, blockMin, left);

        day.blocks.push({
          assignmentId: candidate.a.id,
          title: candidate.a.title,
          classId: candidate.a.classId,
          color: S.classColor(candidate.a.classId),
          minutes: chunk,
          due: candidate.a.due,
          priority: candidate.a.priority
        });
        candidate.remaining -= chunk;
        day.used += chunk;
        left -= chunk;

        // Absorb a sub-session remainder into the block just placed rather
        // than reporting the task as "short by 4 minutes".
        if (candidate.remaining > 0 && candidate.remaining < MIN_CHUNK && left >= candidate.remaining) {
          day.blocks[day.blocks.length - 1].minutes += candidate.remaining;
          day.used += candidate.remaining;
          left -= candidate.remaining;
          candidate.remaining = 0;
        }
      }

      // Merge consecutive blocks for the same assignment into one session.
      const merged = [];
      day.blocks.forEach((b) => {
        const last = merged[merged.length - 1];
        if (last && last.assignmentId === b.assignmentId) last.minutes += b.minutes;
        else merged.push({ ...b });
      });
      day.blocks = merged;

      // Lay the sessions into the day's real gaps so they get clock times.
      // F045 energy-aware scheduling — when session ratings reveal a
      // sharpest hour, the day's first (most urgent) block starts there
      // instead of always at the day's earliest free gap.
      let gi = 0, bestMin = null;
      if (day.gaps.length) {
        const bestHour = S.bestStudyHour();
        if (bestHour != null) {
          bestMin = bestHour * 60;
          const idx = day.gaps.findIndex((g) => g.end > bestMin);
          if (idx >= 0) gi = idx;
        }
      }
      let cursor = day.gaps.length
        ? (gi === 0 ? day.gaps[0].start : Math.max(day.gaps[gi].start, Math.min(bestMin, day.gaps[gi].end)))
        : null;
      day.blocks.forEach((b) => {
        if (cursor == null) return;
        while (gi < day.gaps.length && cursor + b.minutes > day.gaps[gi].end) {
          gi++;
          cursor = gi < day.gaps.length ? day.gaps[gi].start : null;
        }
        if (cursor == null) return;
        b.start = U.fromMin(cursor);
        b.end = U.fromMin(cursor + b.minutes);
        cursor += b.minutes + 5;   // small breather between sessions
      });
    });

    // Anything still outstanding genuinely doesn't fit — either the deadline
    // is too close for the hours available, or it's already overdue.
    const unplaced = items
      .filter((it) => it.remaining >= MIN_CHUNK)
      .map((it) => ({
        assignment: it.a,
        minutesShort: it.remaining,
        overdue: it.a.due < today
      }));

    const totalNeeded = U.sum(items, (i) => i.remaining) + U.sum(days, (d) => d.used);
    const totalCapacity = U.sum(days, (d) => d.capacity);

    return {
      days,
      unplaced,
      stats: {
        scheduled: U.sum(days, (d) => d.used),
        capacity: totalCapacity,
        needed: totalNeeded,
        utilization: totalCapacity ? U.sum(days, (d) => d.used) / totalCapacity : 0
      }
    };
  }

  /** Write a built plan onto the assignments so it shows on the calendar. */
  function apply(plan) {
    let n = 0;
    S.commit((db) => {
      // Clear previous auto-scheduling first so re-planning is idempotent.
      db.assignments.forEach((a) => {
        if (a.scheduledAuto) { a.scheduledFor = null; a.scheduledMin = null; a.scheduledAuto = false; }
      });
      plan.days.forEach((day) => {
        day.blocks.forEach((b) => {
          const a = db.assignments.find((x) => x.id === b.assignmentId);
          if (!a || a.scheduledFor) return;
          a.scheduledFor = day.date;
          a.scheduledMin = b.start ? U.toMin(b.start) : null;
          a.scheduledAuto = true;
          n++;
        });
      });
    });
    return n;
  }

  function clearPlan() {
    S.commit((db) => {
      db.assignments.forEach((a) => {
        if (a.scheduledAuto) { a.scheduledFor = null; a.scheduledMin = null; a.scheduledAuto = false; }
      });
    });
  }

  /* ----------------------------------------------------------- overload */

  const HEAVY = /test|exam|midterm|final|quiz|essay|project|presentation/i;

  /**
   * Look ahead for genuine crunch: clustered assessments, days where required
   * work exceeds available time, and evening commitments before a big test.
   * Returns a list of { level, title, detail, date } sorted worst-first.
   */
  function warnings(horizonDays) {
    const horizon = horizonDays || 14;
    const today = U.today();
    const out = [];

    // Assessments (from both assignments and calendar events).
    const assessments = [];
    S.openAssignments().forEach((a) => {
      if (HEAVY.test(a.type) || HEAVY.test(a.title)) {
        const d = U.diffDays(a.due, today);
        if (d >= 0 && d <= horizon) {
          assessments.push({ date: a.due, title: a.title, classId: a.classId, weight: /test|exam|final|midterm/i.test(a.type + a.title) ? 2 : 1 });
        }
      }
    });
    S.db.events.forEach((e) => {
      if (/exam|test/i.test(e.type)) {
        const d = U.diffDays(e.date, today);
        if (d >= 0 && d <= horizon) assessments.push({ date: e.date, title: e.title, classId: e.classId, weight: 2 });
      }
    });

    // Cluster: 2+ heavy assessments inside a 48-hour window.
    const byDate = U.sortBy(assessments, (a) => a.date);
    for (let i = 0; i < byDate.length; i++) {
      const group = byDate.filter((x) => U.diffDays(x.date, byDate[i].date) >= 0 && U.diffDays(x.date, byDate[i].date) <= 1);
      const weight = U.sum(group, (g) => g.weight);
      if (group.length >= 2 && weight >= 3) {
        const key = group.map((g) => g.title).join("|");
        if (out.some((w) => w.key === key)) continue;
        out.push({
          key, level: weight >= 4 ? "high" : "med",
          date: byDate[i].date,
          title: `${group.length} assessments in ${U.diffDays(group[group.length - 1].date, group[0].date) === 0 ? "one day" : "two days"}`,
          detail: group.map((g) => g.title).join(" · ") + ` — starting ${U.relDate(byDate[i].date)}`
        });
      }
    }

    // Capacity: a day where the work due tomorrow can't fit in tonight.
    for (let i = 0; i < Math.min(horizon, 10); i++) {
      const iso = U.dateKey(U.addDays(new Date(), i));
      const w = windowFor(iso);
      const dueNext = S.openAssignments().filter((a) => a.due === U.dateKey(U.addDays(U.parseDate(iso), 1)) || a.due === iso);
      const needed = U.sum(dueNext, (a) => Math.round(correctedEstimate(a) * (1 - S.progressOf(a))));
      if (needed > w.minutes && needed > 45) {
        out.push({
          key: "cap:" + iso, level: needed > w.minutes * 1.8 ? "high" : "med",
          date: iso,
          title: `${U.fmtDate(iso, "day")} is over-booked`,
          detail: `About ${U.fmtDur(needed)} of work due, but only ${U.fmtDur(w.minutes)} free` +
                  (w.busy.length ? ` after ${w.busy.map((b) => b.label).slice(0, 2).join(" and ")}` : "") + "."
        });
      }
    }

    // A practice/game the evening before a big assessment.
    assessments.filter((a) => a.weight >= 2).forEach((a) => {
      const eveBefore = U.dateKey(U.addDays(U.parseDate(a.date), -1));
      const acts = S.scheduleFor(eveBefore).filter((x) => x.kind === "activity" || (x.kind === "event" && /game|competition/i.test(x.sub || "")));
      if (acts.length) {
        out.push({
          key: "conflict:" + a.title, level: "med", date: eveBefore,
          title: `${acts[0].title} the night before ${a.title}`,
          detail: `${U.fmtDate(eveBefore, "day")} runs until ${U.fmtTime(acts[0].end)} — plan study time earlier in the week.`
        });
      }
    });

    // Overdue pile-up.
    const late = S.overdue();
    if (late.length >= 3) {
      out.push({
        key: "overdue", level: "high", date: today,
        title: `${late.length} assignments are overdue`,
        detail: late.slice(0, 3).map((a) => a.title).join(" · ") + (late.length > 3 ? ` and ${late.length - 3} more` : "")
      });
    }

    const rank = { high: 0, med: 1, low: 2 };
    return U.sortBy(out, (w) => rank[w.level] * 1000 + U.diffDays(w.date, today));
  }

  return {
    calibration, applyCalibration, correctedEstimate,
    windowFor, gapsFor, build, apply, clearPlan, warnings
  };
})();
