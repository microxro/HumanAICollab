/* ==========================================================================
   views/schedule.js — weekly timetable (classes + activities)
   ========================================================================== */

App.views.schedule = (function () {
  const U = App.utils, S = App.store, UI = App.ui;

  let showWeekend = false;

  function days() {
    return showWeekend
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

    const cols = `70px repeat(${D.length}, minmax(0, 1fr))`;
    let html = `<div class="scroll-x"><div class="timetable" style="grid-template-columns:${cols}">`;

    html += `<div></div>`;
    D.forEach((d) => {
      const isToday = rotating ? d === todayCycle : d === todayDow;
      html += `<div class="tt-head" style="${isToday ? "color:var(--brand-600)" : ""}">${rotating ? "Day " + U.esc(d) : d}</div>`;
    });

    periods.forEach((p) => {
      html += `<div class="tt-time"><span>${U.fmtTime(p.start)}</span><span class="dim">${U.fmtTime(p.end)}</span></div>`;
      D.forEach((d) => {
        const c = rotating
          ? S.termClasses().find((x) => x.periodId === p.id && (x.patternDays || []).includes(d))
          : S.termClasses().find((x) => x.periodId === p.id && x.days.includes(d));
        if (!c) {
          html += `<div class="tt-cell empty"></div>`;
          return;
        }
        const isToday = rotating ? d === todayCycle : d === todayDow;
        const isNow = isToday && now >= U.toMin(p.start) && now < U.toMin(p.end);
        const fg = U.contrastText(c.color);
        html += `<div class="tt-cell ${isNow ? "now" : ""}" data-class="${c.id}"
                      style="background:${U.esc(c.color)};color:${fg}">
            ${U.esc(c.name)}<small>Rm ${U.esc(c.room || "—")}</small>
          </div>`;
      });
    });

    // After-school row for activities (weekday-based, so skipped in cycle view)
    const anyActivity = S.db.activities.length > 0 && !rotating;
    if (anyActivity) {
      html += `<div class="tt-time"><span>After</span><span class="dim">school</span></div>`;
      D.forEach((d) => {
        const acts = S.db.activities.filter((a) => a.days.includes(d));
        if (!acts.length) { html += `<div class="tt-cell empty"></div>`; return; }
        const a = acts[0];
        const fg = U.contrastText(a.color);
        html += `<div class="tt-cell" data-activity="${a.id}" style="background:${U.esc(a.color)};color:${fg}">
            ${U.esc(acts.map((x) => x.name).join(", "))}
            <small>${U.fmtTime(a.start)} · ${U.esc(a.location)}</small>
          </div>`;
      });
    }

    html += `</div></div>`;
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
        <select class="select input-sm" data-bell-variant="${iso}" style="max-width:150px">
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
    </div>`;
  }

  function render() {
    const start = U.startOfWeek(new Date(), true);
    const week = Array.from({ length: showWeekend ? 7 : 5 }, (_, i) => U.dateKey(U.addDays(start, i)));
    const totalClassMin = U.sum(S.db.classes, (c) => {
      const p = S.period(c.periodId);
      return p ? (U.toMin(p.end) - U.toMin(p.start)) * c.days.length : 0;
    });
    const totalActMin = U.sum(S.db.activities, (a) => (U.toMin(a.end) - U.toMin(a.start)) * a.days.length);

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>Schedule</h1>
          <div class="sub">${U.fmtDur(totalClassMin)} of class + ${U.fmtDur(totalActMin)} of activities per week</div>
        </div>
        <div class="page-actions">
          <button class="btn btn-sm" data-weekend>${showWeekend ? "Hide" : "Show"} weekend</button>
          <button class="btn" data-periods>🔔 Bell schedule</button>
          <button class="btn btn-primary" data-add>+ Add class</button>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-head"><h3>Weekly timetable</h3><span class="sub">Click a block to open the class</span></div>
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
    U.on(root, "click", "[data-periods]", () => App.router.go("classes"));
    U.on(root, "click", "[data-weekend]", () => { showWeekend = !showWeekend; App.router.refresh(); });
    U.on(root, "change", "[data-bell-variant]", (_e, el) => {
      S.setBellVariant(el.dataset.bellVariant, el.value || null);
      UI.toast(el.value ? "Bell variant set" : "Back to normal schedule", S.settings.bellVariants[el.value]?.label || "", "ok");
      App.router.refresh();
    });
  }

  return { render, mount, title: "Schedule" };
})();
