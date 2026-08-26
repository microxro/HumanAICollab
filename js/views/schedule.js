/* ==========================================================================
   views/schedule.js — weekly timetable (classes + activities)
   ========================================================================== */

App.views.schedule = (function () {
  const U = App.utils, S = App.store, UI = App.ui;

  /**
   * null until the first render decides for itself.
   *
   * A Mon–Fri grid is right for school and wrong for the outside-school half
   * of this app: a student whose only Saturday commitment is a club swim
   * squad opened this screen and saw a week with nothing in it. So the
   * weekend shows by default whenever something is actually scheduled on
   * one, and the toggle below still wins for the rest of the session.
   */
  let showWeekend = null;

  function weekendVisible() {
    if (showWeekend === null) {
      showWeekend = S.db.activities.some((a) =>
        (a.days || []).some((d) => d === "Sat" || d === "Sun"));
    }
    return showWeekend;
  }

  function days() {
    return weekendVisible()
      ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
      : ["Mon", "Tue", "Wed", "Thu", "Fri"];
  }

  /**
   * In weekly mode the grid columns are weekdays. In rotating mode they're
   * cycle days (Day A, Day B…), which is the only way an A/B schedule reads
   * correctly — the same weekday is a different set of classes each week.
   */
  function timetable() {
    const sc = S.settings.schedule;
    const rotating = sc.mode === "rotating";
    const D = rotating ? sc.cycle.slice() : days();
    const periods = S.db.periods;
    const todayDow = U.dowName(U.today());
    const todayCycle = rotating ? S.cycleDayFor(U.today()) : null;
    const now = U.nowMin();

    // With no bell schedule set up, `periods` is empty and the loop below
    // produced a header row over nothing — a grid of day names and no grid.
    // Say what's missing and link to the thing that fixes it.
    if (!periods.length) {
      const off = S.termClasses().filter((c) => c.offSchedule && c.start && c.end);
      return `<div class="center" style="padding:28px 16px">
        ${UI.emptyState("todaySchedule", "No bell schedule yet",
          "Add your school's periods and their times, and your classes will lay themselves out here for the week.")}
        <div class="row center gap-8" style="margin-top:12px">
          <button type="button" class="btn btn-primary" data-periods>Set up bell schedule</button>
          <button type="button" class="btn" data-add>+ Add a class with its own times</button>
        </div>
        ${off.length ? `<p class="small muted" style="margin-top:14px">You do have
          ${U.plural(off.length, "class")} that meets outside the bell schedule —
          ${U.esc(off.map((c) => c.name).join(", "))}. ${off.length === 1 ? "It shows" : "They show"}
          in the day-by-day list below.</p>` : ""}
      </div>`;
    }

    const cols = `70px repeat(${D.length}, minmax(0, 1fr))`;
    let html = `<div class="scroll-x"><div class="timetable" style="grid-template-columns:${cols}">`;

    html += `<div></div>`;
    D.forEach((d) => {
      const isToday = rotating ? d === todayCycle : d === todayDow;
      // --brand-600 is a fill colour; against the dark surface it measures
      // about 3:1 as text. --brand-text is the accessible pairing and is
      // defined per theme.
      html += `<div class="tt-head" style="${isToday ? "color:var(--brand-text)" : ""}">${rotating ? "Day " + U.esc(d) : d}</div>`;
    });

    periods.forEach((p) => {
      html += `<div class="tt-time"><span>${U.fmtTime(p.start)}</span><span class="dim">${U.fmtTime(p.end)}</span></div>`;
      D.forEach((d) => {
        const c = rotating
          ? S.termClasses().find((x) => !x.offSchedule && x.periodId === p.id && (x.patternDays || []).includes(d))
          : S.termClasses().find((x) => !x.offSchedule && x.periodId === p.id && x.days.includes(d));
        if (!c) {
          html += `<div class="tt-cell empty"></div>`;
          return;
        }
        const isToday = rotating ? d === todayCycle : d === todayDow;
        const isNow = isToday && now >= U.toMin(p.start) && now < U.toMin(p.end);
        const fg = U.contrastText(c.color);
        const iconChar = U.subjectIconChar(c.icon || U.guessSubjectIcon(c.name));
        html += `<div class="tt-cell ${isNow ? "now" : ""}" data-class="${c.id}"
                      style="background:${U.esc(c.color)};color:${fg}">
            <span aria-hidden="true">${iconChar}</span> ${U.esc(c.name)}<small>Rm ${U.esc(c.room || "—")}</small>
          </div>`;
      });
    });

    /* Off-schedule classes sit in no period, so they can't go in the grid
       above — but they assign homework and carry a grade, so leaving them off
       the timetable entirely is how a student misses one. They get their own
       row, keyed on the weekday in both modes (a Tuesday club is on Tuesday
       whatever cycle day the school calls it). */
    const offClasses = S.termClasses().filter((c) => c.offSchedule && c.start && c.end);
    // Only in weekly mode does this row line up with the columns. Rotating
    // columns are cycle days, and an own-times class meets on a weekday — one
    // row can't honestly span both axes, so cycle-day students get the list
    // below the grid instead.
    if (offClasses.length && !rotating) {
      html += `<div class="tt-time"><span>Own</span><span class="dim">times</span></div>`;
      D.forEach((d) => {
        const here = offClasses.filter((c) => c.days.includes(d))
          .sort((a, b) => U.toMin(a.start) - U.toMin(b.start));
        if (!here.length) { html += `<div class="tt-cell empty"></div>`; return; }
        const c = here[0];
        const fg = U.contrastText(c.color);
        html += `<div class="tt-cell" data-class="${c.id}" style="background:${U.esc(c.color)};color:${fg}">
            <span aria-hidden="true">◇</span> ${U.esc(here.map((x) => x.name).join(", "))}
            <small>${U.esc(U.fmtTime(c.start))}${here.length === 1 ? "–" + U.esc(U.fmtTime(c.end)) : ""}</small>
          </div>`;
      });
    }

    // Everything that isn't a timetabled class — an after-school club, and
    // (since these can fall on a Saturday) an outside-school lesson too.
    // Weekday-based, so skipped in cycle view.
    const anyActivity = S.db.activities.length > 0 && !rotating;
    if (anyActivity) {
      html += `<div class="tt-time"><span>Outside</span><span class="dim">class</span></div>`;
      D.forEach((d) => {
        const acts = U.sortBy(S.db.activities.filter((a) => (a.days || []).includes(d)), (a) => U.toMin(a.start));
        if (!acts.length) { html += `<div class="tt-cell empty"></div>`; return; }
        const a = acts[0];
        const fg = U.contrastText(a.color);
        // Two activities on one day used to render as "Robotics Club, Piano
        // lessons" under the *first* one's time and room — a cell that names
        // two things and gives one set of details for both. With more than
        // one, each gets its own line and its own click target.
        const inner = acts.length === 1
          ? `${U.esc(a.name)}<small>${U.fmtTime(a.start)} · ${U.esc(a.location || "—")}</small>`
          : acts.map((x) => `<div data-activity="${x.id}" class="truncate">${U.fmtTime(x.start)} ${U.esc(x.name)}</div>`).join("");
        html += `<div class="tt-cell" data-activity="${a.id}" style="background:${U.esc(a.color)};color:${fg}">
            ${inner}
          </div>`;
      });
    }

    html += `</div></div>`;

    if (offClasses.length && rotating) {
      html += `<div class="card mt-16"><div class="card-head">
          <h3>Outside the bell schedule</h3>
          <span class="sub">By weekday — these don't follow the A/B cycle</span>
        </div><div class="list">
        ${offClasses.map((c) => `<div class="list-item" data-class="${c.id}">
          <i class="dot-badge" style="background:${U.esc(c.color)}"></i>
          <span class="grow"><div class="title">${U.esc(c.name)}</div>
            <div class="meta">${U.esc(c.days.join(" ") || "No days set")} · ${U.esc(U.fmtTime(c.start))}–${U.esc(U.fmtTime(c.end))}</div></span>
          <span class="badge brand">◇ Extracurricular</span>
        </div>`).join("")}
      </div></div>`;
    }

    return html;
  }

  function dayColumn(iso) {
    const items = S.scheduleFor(iso);
    const isToday = iso === U.today();
    const now = U.nowMin();
    const cd = S.cycleDayFor(iso);
    const variant = S.bellVariantFor(iso);      // F041/F042
    const passingMin = S.settings.passingTimeMin || 5;   // F043

    return `<div class="agenda-day">
      <div class="agenda-date ${isToday ? "is-today" : ""}">
        <span class="dnum">${U.parseDate(iso).getDate()}</span>
        <span>${U.dowName(iso, true)}</span>
        ${cd ? `<span class="badge brand">Day ${U.esc(cd)}</span>` : ""}
        ${isToday ? `<span class="badge solid">Today</span>` : ""}
        <span class="grow"></span>
        <select class="select input-sm" data-bell-variant="${iso}" style="max-width:150px"
          aria-label="Bell schedule for ${U.esc(U.fmtDate(iso))}">
          <option value="">Normal schedule</option>
          ${Object.entries(S.settings.bellVariants).map(([k, v]) => `<option value="${k}" ${variant === k ? "selected" : ""}>${U.esc(v.label)}</option>`).join("")}
        </select>
      </div>
      ${items.length ? items.map((it, i) => {
        const past = isToday && it.end && now >= U.toMin(it.end);
        const prev = items[i - 1];
        // F043 — flag a tight gap between different rooms, not just adjacent periods.
        const tight = prev && prev.end && it.start && prev.location && it.location && prev.location !== it.location
          && (U.toMin(it.start) - U.toMin(prev.end)) < passingMin && (U.toMin(it.start) - U.toMin(prev.end)) >= 0;
        return `<div class="agenda-row" style="${past ? "opacity:.5" : ""}">
          <span class="agenda-stripe" style="background:${U.esc(it.color)}"></span>
          <span class="agenda-time">${it.start ? U.fmtTime(it.start) : "All day"}</span>
          <span class="grow" style="min-width:0">
            <div class="bold small truncate">${U.esc(it.title)}${tight ? ` <span class="badge warn" title="Less than ${passingMin} min to get from ${U.esc(prev.location)} to ${U.esc(it.location)}">⚡ tight passing time</span>` : ""}</div>
            <div class="tiny dim truncate">${U.esc([it.location, it.sub].filter(Boolean).join(" · "))}</div>
          </span>
          <span class="badge">${U.esc(it.kind)}</span>
        </div>`;
      }).join("") : `<p class="dim small" style="padding:4px 2px">Nothing scheduled.</p>`}
      ${variant ? `<p class="tiny dim mt-4">${U.esc(S.settings.bellVariants[variant].label)} — periods shift ${S.settings.bellVariants[variant].shiftMin > 0 ? "later" : "earlier"} by ${Math.abs(S.settings.bellVariants[variant].shiftMin)} min.</p>` : ""}
      ${(() => {
        // F051 — flag it if the day's last commitment ends too close to the last bus.
        const bus = S.busClock();
        if (!bus.lastBus || !items.length) return "";
        const lastEnd = items.reduce((max, it) => it.end && U.toMin(it.end) > max ? U.toMin(it.end) : max, 0);
        if (!lastEnd) return "";
        const margin = U.toMin(bus.lastBus) - lastEnd - (bus.fromMin || 0);
        return margin < 15
          ? `<p class="tiny mt-4" style="color:var(--warn)">🚌 Last bus at ${U.esc(U.fmtTime(bus.lastBus))} — ${margin < 0 ? "you'll miss it" : `only ${margin} min to spare`}.</p>`
          : "";
      })()}
    </div>`;
  }

  function render() {
    const start = U.startOfWeek(new Date(), true);
    const week = Array.from({ length: weekendVisible() ? 7 : 5 }, (_, i) => U.dateKey(U.addDays(start, i)));
    const totalClassMin = U.sum(S.db.classes, (c) => {
      const p = S.classPeriod(c);
      return p ? (U.toMin(p.end) - U.toMin(p.start)) * c.days.length : 0;
    });
    const totalActMin = U.sum(S.db.activities, (a) => (U.toMin(a.end) - U.toMin(a.start)) * a.days.length);

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>${App.i18n.t("schedule", "Schedule")}</h1>
          <div class="sub">${U.fmtDur(totalClassMin)} of class + ${U.fmtDur(totalActMin)} of activities per week</div>
        </div>
        <div class="page-actions">
          <button class="btn btn-sm" data-weekend>${weekendVisible() ? "Hide" : "Show"} weekend</button>
          <button class="btn" data-periods>🔔 Bell schedule</button>
          <button class="btn" data-print title="A wall-friendly printout of this timetable">🖨 Print</button>
          <button class="btn btn-primary" data-add>+ Add class</button>
        </div>
      </div>

      ${(() => {
        // F041/F042 — a special schedule is a *today* problem, so say so at the
        // top rather than only inside the day-by-day list further down.
        const v = S.bellVariantFor(U.today());
        const cfg = v ? S.settings.bellVariants[v] : null;
        return `<div class="card mb-16"><div class="card-body tight">
          <div class="row wrap gap-8" style="align-items:center">
            <span class="small bold">Today's bell schedule</span>
            ${cfg
              ? `<span class="badge warn">${U.esc(cfg.label)}</span>
                 <span class="tiny dim">periods shift ${cfg.shiftMin > 0 ? "later" : "earlier"} by ${Math.abs(cfg.shiftMin)} min</span>`
              : `<span class="badge">Normal</span>`}
            <span class="grow"></span>
            <select class="select input-sm" data-bell-variant="${U.today()}" style="max-width:190px"
              aria-label="Bell schedule for today">
              <option value="">Normal schedule</option>
              ${Object.entries(S.settings.bellVariants).map(([k, cv]) =>
                `<option value="${k}" ${v === k ? "selected" : ""}>${U.esc(cv.label)}</option>`).join("")}
            </select>
          </div>
        </div></div>`;
      })()}

      <div class="card mb-16 print-sheet">
        <div class="card-head">
          <h3>Weekly timetable</h3>
          <span class="sub">Click a block to open the class
            ${S.settings.schedule.mode === "rotating"
              ? UI.helpHint("This is a rotating (A/B) schedule — the columns are cycle days, not weekdays. The same Monday might be a Day A one week and a Day B the next, so check which cycle day it is rather than the date.")
              : ""}</span>
        </div>
        <div class="card-body">${timetable()}</div>
      </div>

      <div class="card">
        <div class="card-head"><h3>This week, day by day</h3></div>
        <div class="card-body">${week.map(dayColumn).join("")}</div>
      </div>
    </div>`;
  }

  function mount(root) {
    U.on(root, "click", "[data-class]", (_e, el) => App.views.classes.detail(el.dataset.class));
    U.on(root, "click", "[data-activity]", (_e, el) => App.views.activities.detail(el.dataset.activity));
    U.on(root, "click", "[data-add]", () => App.views.classes.classForm(null));
    // Open the editor directly. This used to just navigate to Classes and
    // leave the student to find the button again.
    U.on(root, "click", "[data-periods]", () => App.views.classes.periodsEditor());
    U.on(root, "click", "[data-weekend]", () => { showWeekend = !weekendVisible(); App.router.refresh(); });
    U.on(root, "click", "[data-print]", () => window.print());
    U.on(root, "change", "[data-bell-variant]", (_e, el) => {
      S.setBellVariant(el.dataset.bellVariant, el.value || null);
      UI.toast(el.value ? "Bell variant set" : "Back to normal schedule", S.settings.bellVariants[el.value]?.label || "", "ok");
      App.router.refresh();
    });
  }

  return { render, mount, title: "Schedule" };
})();
