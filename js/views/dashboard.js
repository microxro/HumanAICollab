/* ==========================================================================
   views/dashboard.js — the "everything at a glance" home screen
   ========================================================================== */

App.views = App.views || {};

App.views.dashboard = (function () {
  const U = App.utils, S = App.store, UI = App.ui, C = App.charts;
  let ticker = null;

  function heroHTML() {
    const live = S.liveStatus();
    const p = S.profile;
    const hour = new Date().getHours();
    const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

    let main, sub, progress = 0;
    if (live.current) {
      main = live.current.title;
      sub = `${live.current.location || ""}${live.current.sub ? " · " + live.current.sub : ""} · ${U.fmtDur(live.remaining)} left`;
      progress = live.progress * 100;
    } else if (live.next) {
      main = "Free right now";
      sub = `${live.next.title} starts in ${U.fmtDur(live.untilNext)} (${U.fmtTime(live.next.start)})`;
    } else {
      main = "Nothing scheduled";
      sub = "No more classes or activities today";
    }

    return `<div class="hero">
      <div class="between wrap gap-16">
        <div style="min-width:0">
          <div class="hero-eyebrow row gap-6">
            ${live.current ? `<i class="live-dot"></i>` : ""}
            ${greet}, ${U.esc(p.name.split(" ")[0])}
          </div>
          <div class="hero-title">${U.esc(main)}</div>
          <div class="hero-sub" id="heroSub">${U.esc(sub)}</div>
        </div>
        <div class="row gap-16" style="flex-shrink:0">
          <div class="center">
            <div style="font-size:1.5rem;font-weight:720" class="nums">${U.round(S.gpa(), 2)}</div>
            <div class="tiny" style="opacity:.85">GPA</div>
          </div>
          <div class="center">
            <div style="font-size:1.5rem;font-weight:720" class="nums">${S.db.streak.count}🔥</div>
            <div class="tiny" style="opacity:.85">Day streak</div>
          </div>
        </div>
      </div>
      ${live.current ? `<div class="hero-progress"><i id="heroBar" style="width:${U.round(progress, 1)}%"></i></div>` : ""}
    </div>`;
  }

  /**
   * Surfaces genuine crunch — clustered tests, over-booked evenings, a game
   * the night before an exam — before it arrives, not after.
   */
  function warningsHTML() {
    const list = App.planner.warnings(14).slice(0, 3);
    if (!list.length) return "";
    const worst = list[0].level;
    return `<div class="card" style="border-left:3px solid var(--${worst === "high" ? "danger" : "warn"})">
      <div class="card-head" style="padding:12px 16px">
        <h3>${worst === "high" ? "⚠️" : "🟡"} Heads up</h3>
        <button class="btn btn-sm" data-go="planner">Open planner</button>
      </div>
      <div class="list">
        ${list.map((w) => `<div class="list-item" style="padding:9px 16px">
          <span class="grow">
            <div class="title">${U.esc(w.title)}</div>
            <div class="meta">${U.esc(w.detail)}</div>
          </span>
          <span class="badge ${w.level === "high" ? "danger" : "warn"}">${U.esc(U.relDate(w.date))}</span>
        </div>`).join("")}
      </div>
    </div>`;
  }

  function statsHTML() {
    const due = S.dueSoon();
    const late = S.overdue();
    const att = S.attendanceRate();
    const study = S.studyThisWeek();
    const lastWeek = U.sum(
      S.db.studySessions.filter((s) => {
        const wk = U.dateKey(U.startOfWeek(new Date(), S.settings.weekStartsMonday));
        return s.date < wk && s.date >= U.dateKey(U.addDays(U.startOfWeek(new Date(), S.settings.weekStartsMonday), -7));
      }), (s) => s.minutes);
    const delta = lastWeek ? Math.round(((study - lastWeek) / lastWeek) * 100) : 0;

    return `<div class="grid g-4">
      <div class="stat accent">
        <div class="stat-ico">📌</div>
        <div class="stat-label">Due soon</div>
        <div class="stat-value">${due.length}</div>
        <div class="stat-foot">${late.length ? `<span style="color:var(--danger);font-weight:650">${U.plural(late.length, "overdue")}</span>` : "Nothing overdue"}</div>
      </div>
      <div class="stat">
        <div class="stat-ico">🎯</div>
        <div class="stat-label">Term GPA</div>
        <div class="stat-value">${U.round(S.gpa(), 2)}</div>
        <div class="stat-foot">${S.settings.gpaWeighted ? "Weighted" : "Unweighted"} · ${U.plural(S.db.classes.length, "class", "classes")}</div>
      </div>
      <div class="stat">
        <div class="stat-ico">⏱️</div>
        <div class="stat-label">Study this week</div>
        <div class="stat-value">${U.fmtDur(study)}</div>
        <div class="stat-foot">${delta === 0 ? "Same as last week" :
          `<span style="color:var(--${delta > 0 ? "ok" : "warn"})">${delta > 0 ? "▲" : "▼"} ${Math.abs(delta)}%</span> vs last week`}</div>
      </div>
      <div class="stat">
        <div class="stat-ico">✅</div>
        <div class="stat-label">Attendance</div>
        <div class="stat-value">${U.round(att.rate, 1)}%</div>
        <div class="stat-foot">${att.missed} absent · ${att.late} late (3 wks)</div>
      </div>
    </div>`;
  }

  function todayHTML() {
    const iso = U.today();
    const items = S.scheduleFor(iso);
    const now = U.nowMin();

    if (!items.length) {
      return UI.emptyState("🌤️", "Nothing scheduled today",
        "Enjoy the break — or add something to your calendar.");
    }

    return `<div class="list">${items.map((it) => {
      const isNow = it.start && it.end && now >= U.toMin(it.start) && now < U.toMin(it.end);
      const isPast = it.end && now >= U.toMin(it.end);
      return `<div class="list-item" style="${isPast ? "opacity:.5" : ""}">
        <span class="hw-stripe" style="background:${U.esc(it.color)}"></span>
        <span class="mono dim" style="width:76px;flex-shrink:0;font-size:.74rem">
          ${it.start ? U.fmtTime(it.start) : "All day"}
        </span>
        <span class="grow" style="min-width:0">
          <div class="title truncate">${U.esc(it.title)}</div>
          <div class="meta truncate">${U.esc([it.location, it.sub].filter(Boolean).join(" · "))}</div>
        </span>
        ${isNow ? `<span class="badge solid">Now</span>`
          : isPast ? `<span class="badge">Done</span>`
          : `<span class="badge">${U.fmtDur(U.toMin(it.start) - now)}</span>`}
      </div>`;
    }).join("")}</div>`;
  }

  function dueHTML() {
    const items = S.dueSoon(7).slice(0, 7);
    if (!items.length) {
      return UI.emptyState("🎉", "All caught up", "Nothing due in the next week.");
    }
    return `<div class="list">${items.map((a) => {
      const c = S.cls(a.classId);
      const prog = S.progressOf(a);
      return `<div class="list-item" data-open-hw="${a.id}" style="cursor:pointer">
        <input type="checkbox" class="check" data-toggle-hw="${a.id}" ${a.status === "done" ? "checked" : ""}
               aria-label="Mark complete" />
        <span class="grow" style="min-width:0">
          <div class="title truncate">${U.esc(a.title)}</div>
          <div class="meta row gap-6">
            <i class="dot-badge" style="background:${U.esc(c ? c.color : "#888")}"></i>
            ${U.esc(c ? c.name : "General")}
            ${a.subtasks && a.subtasks.length ? `· ${a.subtasks.filter((s) => s.done).length}/${a.subtasks.length}` : ""}
          </div>
          ${prog > 0 && prog < 1 ? `<div class="bar thin" style="margin-top:6px"><i style="width:${prog * 100}%"></i></div>` : ""}
        </span>
        ${UI.dueBadge(a.due)}
      </div>`;
    }).join("")}</div>`;
  }

  function gradesHTML() {
    const rows = S.db.classes
      .map((c) => ({ c, pct: S.classGrade(c.id) }))
      .filter((r) => r.pct != null)
      .sort((a, b) => b.pct - a.pct);

    if (!rows.length) return UI.emptyState("📊", "No grades yet", "Grade some assignments to see this.");

    return C.hbars(rows.map(({ c, pct }) => ({
      label: c.name, value: U.round(pct, 1), color: c.color, max: 100
    })), { max: 100, fmt: (v) => `${v}% · ${U.pctToLetter(v)}` });
  }

  function render() {
    const weekStudy = S.studyByDay(28);
    const trend = S.gradeTrend();

    return `<div class="page-inner col gap-20">
      ${heroHTML()}
      ${warningsHTML()}
      ${statsHTML()}

      <div class="grid g-main">
        <div class="col gap-16">
          <div class="card">
            <div class="card-head">
              <div>
                <h3>Today's schedule</h3>
                <div class="sub">${U.esc(U.fmtDate(U.today(), "long"))}</div>
              </div>
              <button class="btn btn-sm" data-go="calendar">Open calendar</button>
            </div>
            ${todayHTML()}
          </div>

          <div class="card">
            <div class="card-head">
              <div><h3>Grade trend</h3><div class="sub">Cumulative average across all classes</div></div>
              <button class="btn btn-sm" data-go="grades">Grade book</button>
            </div>
            <div class="card-body">${C.line(trend, { h: 200 })}</div>
          </div>
        </div>

        <div class="col gap-16">
          <div class="card">
            <div class="card-head">
              <div><h3>Due soon</h3><div class="sub">Next 7 days</div></div>
              <button class="btn btn-sm btn-primary" data-new-hw>+ Add</button>
            </div>
            ${dueHTML()}
          </div>

          <div class="card">
            <div class="card-head"><h3>Class averages</h3></div>
            <div class="card-body">${gradesHTML()}</div>
          </div>

          <div class="card">
            <div class="card-head">
              <div><h3>Study activity</h3><div class="sub">Last 4 weeks</div></div>
              <button class="btn btn-sm" data-go="focus">Focus timer</button>
            </div>
            <div class="card-body">${C.heatmap(weekStudy)}</div>
          </div>
        </div>
      </div>
    </div>`;
  }

  // Keeps the "time left in class" copy and progress bar honest without a
  // full re-render every second.
  function mount(root) {
    clearInterval(ticker);
    ticker = setInterval(() => {
      if (!document.body.contains(root)) { clearInterval(ticker); return; }
      const live = S.liveStatus();
      const sub = root.querySelector("#heroSub");
      const bar = root.querySelector("#heroBar");
      if (live.current && sub) {
        sub.textContent = `${live.current.location || ""}${live.current.sub ? " · " + live.current.sub : ""} · ${U.fmtDur(live.remaining)} left`;
        if (bar) bar.style.width = U.round(live.progress * 100, 1) + "%";
      }
    }, 20000);
  }

  function unmount() { clearInterval(ticker); }

  return { render, mount, unmount, title: "Dashboard" };
})();
