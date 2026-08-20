/* ==========================================================================
   views/goals.js — goals, habit streaks, and attendance
   ========================================================================== */

App.views.goals = (function () {
  const U = App.utils, S = App.store, UI = App.ui, C = App.charts;

  const METRICS = [
    { id: "manual",  label: "Track manually" },
    { id: "gpa",     label: "Auto: current GPA" },
    { id: "service", label: "Auto: total activity hours" },
    { id: "study",   label: "Auto: study minutes this week" }
  ];

  /* ------------------------------------------------------------- goals -- */

  function goalForm(gl) {
    const g = gl || {};
    UI.modal({
      title: gl ? "Edit goal" : "New goal",
      okLabel: gl ? "Save" : "Add goal",
      footer: gl ? `<button type="button" class="btn btn-danger left" data-del>Delete</button>
                    <button type="button" class="btn" data-close>Cancel</button>
                    <button type="submit" class="btn btn-primary">Save</button>` : undefined,
      body: `<div class="form-grid">
        <div class="field full"><label>Goal</label>
          <input class="input" name="title" required value="${U.esc(g.title || "")}" placeholder="e.g. Finish the term with a 3.8 GPA" /></div>
        <div class="field full"><label>How is progress measured?</label>
          <select class="select" name="metric">
            ${METRICS.map((m) => `<option value="${m.id}" ${m.id === (g.metric || "manual") ? "selected" : ""}>${m.label}</option>`).join("")}
          </select></div>
        <div class="field"><label>Target</label>
          <input class="input" type="number" name="target" step="0.1" min="0" value="${g.target != null ? g.target : 10}" /></div>
        <div class="field"><label>Unit</label>
          <input class="input" name="unit" value="${U.esc(g.unit || "")}" placeholder="hrs, books, GPA" /></div>
        <div class="field"><label>Current <span class="hint">(manual goals only)</span></label>
          <input class="input" type="number" name="current" step="0.1" min="0" value="${g.current != null ? g.current : 0}" /></div>
        <div class="field"><label>Deadline</label>
          <input class="input" type="date" name="deadline" value="${g.deadline || U.dateKey(U.addDays(new Date(), 30))}" /></div>
      </div>`,
      onMount(root) {
        const del = root.querySelector("[data-del]");
        if (del) del.addEventListener("click", () => {
          UI.closeModal();
          S.remove("goals", gl.id);
          UI.toast("Goal deleted", gl.title, "warn");
        });
      },
      onSubmit(d) {
        if (!d.title.trim()) return false;
        const patch = {
          title: d.title.trim(), metric: d.metric,
          target: Number(d.target) || 0, unit: d.unit.trim(),
          current: Number(d.current) || 0, deadline: d.deadline
        };
        if (gl) { S.update("goals", gl.id, patch); UI.toast("Goal updated", patch.title); }
        else { S.insert("goals", Object.assign({ done: false }, patch)); UI.toast("Goal added", patch.title, "ok"); }
      }
    });
  }

  /* ------------------------------------------------------------ habits -- */

  function habitForm(hb) {
    const h = hb || {};
    UI.modal({
      title: hb ? "Edit habit" : "New habit",
      okLabel: hb ? "Save" : "Add habit",
      footer: hb ? `<button type="button" class="btn btn-danger left" data-del>Delete</button>
                    <button type="button" class="btn" data-close>Cancel</button>
                    <button type="submit" class="btn btn-primary">Save</button>` : undefined,
      body: `<div class="form-grid">
        <div class="field"><label>Emoji</label>
          <input class="input" name="icon" maxlength="4" value="${U.esc(h.icon || "✅")}" style="text-align:center;font-size:1.2rem" /></div>
        <div class="field"><label>Habit</label>
          <input class="input" name="name" required value="${U.esc(h.name || "")}" placeholder="e.g. Review notes daily" /></div>
      </div>`,
      onMount(root) {
        const del = root.querySelector("[data-del]");
        if (del) del.addEventListener("click", () => {
          UI.closeModal();
          S.remove("habits", hb.id);
          UI.toast("Habit deleted", hb.name, "warn");
        });
      },
      onSubmit(d) {
        if (!d.name.trim()) return false;
        if (hb) { S.update("habits", hb.id, { name: d.name.trim(), icon: d.icon || "✅" }); UI.toast("Habit updated"); }
        else { S.insert("habits", { name: d.name.trim(), icon: d.icon || "✅", log: {} }); UI.toast("Habit added", d.name, "ok"); }
      }
    });
  }

  function habitWeek(h) {
    const start = U.startOfWeek(new Date(), S.settings.weekStartsMonday);
    const today = U.today();
    return Array.from({ length: 7 }, (_, i) => {
      const d = U.addDays(start, i);
      const iso = U.dateKey(d);
      const future = iso > today;
      return `<button class="habit-day ${h.log[iso] ? "on" : ""} ${future ? "future" : ""}"
                      data-habit="${h.id}" data-date="${iso}"
                      title="${U.esc(U.fmtDate(iso, "day"))}">${U.DOW_SHORT[d.getDay()][0]}</button>`;
    }).join("");
  }

  /* -------------------------------------------------------- attendance -- */

  function attendanceForm() {
    UI.modal({
      title: "Record attendance",
      okLabel: "Save",
      body: `<div class="form-grid">
        <div class="field full"><label>Class</label>
          <select class="select" name="classId">${UI.classOptions(null)}</select></div>
        <div class="field"><label>Date</label>
          <input class="input" type="date" name="date" value="${U.today()}" /></div>
        <div class="field"><label>Status</label>
          <select class="select" name="status">
            <option value="absent">Absent</option>
            <option value="late">Late</option>
            <option value="excused">Excused</option>
          </select></div>
      </div>
      <p class="hint mt-8">Only absences and late arrivals are recorded — everything else counts as present.</p>`,
      onSubmit(d) {
        S.insert("attendance", { classId: d.classId, date: d.date, status: d.status });
        UI.toast("Attendance recorded", `${U.titleCase(d.status)} · ${U.fmtDate(d.date)}`);
      }
    });
  }

  /* ------------------------------------------------------------ render -- */

  function render() {
    const goals = S.db.goals;
    const habits = S.db.habits;
    const att = S.attendanceRate();
    const recentAtt = U.sortBy(S.db.attendance, (a) => a.date, true).slice(0, 8);

    // Absences by class — labeled bars keep identity off color alone.
    const missByClass = S.db.classes.map((c) => ({
      label: c.name, color: c.color,
      value: S.db.attendance.filter((a) => a.classId === c.id).length
    })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value);

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>Goals &amp; habits</h1>
          <div class="sub">${U.plural(goals.filter((g) => !g.done).length, "active goal")} ·
            ${U.plural(habits.length, "habit")} tracked</div>
        </div>
        <div class="page-actions">
          <button class="btn" data-new-habit>+ Habit</button>
          <button class="btn btn-primary" data-new-goal>+ Goal</button>
        </div>
      </div>

      <div class="grid g-main mb-16">
        <div class="card">
          <div class="card-head"><h3>Goals</h3><span class="sub">Auto-tracked goals update themselves</span></div>
          ${goals.length ? `<div class="card-body col gap-16">${goals.map((g) => {
            const p = S.goalProgress(g);
            const daysLeft = U.diffDays(g.deadline, U.today());
            const hit = p.pct >= 100;
            return `<div data-goal="${g.id}" style="cursor:pointer">
              <div class="between mb-4">
                <span class="row gap-8" style="min-width:0">
                  <span class="bold small truncate">${U.esc(g.title)}</span>
                  ${hit ? `<span class="badge ok">Reached 🎉</span>` : ""}
                </span>
                <span class="small nums nowrap">
                  ${U.round(p.current, g.metric === "gpa" ? 2 : 1)} / ${g.target} ${U.esc(g.unit || "")}
                </span>
              </div>
              <div class="bar"><i style="width:${U.round(p.pct, 1)}%;
                  ${hit ? "background:var(--ok)" : ""}"></i></div>
              <div class="tiny dim mt-4">
                ${U.round(p.pct)}% ·
                ${daysLeft < 0 ? `<span style="color:var(--danger)">deadline passed</span>`
                  : daysLeft === 0 ? "due today" : `${daysLeft} days left`}
                ${g.metric !== "manual" ? " · auto-tracked" : ""}
              </div>
            </div>`;
          }).join("")}</div>`
          : UI.emptyState("🎯", "No goals yet", "Set a target for GPA, service hours, or study time.",
              `<button class="btn btn-primary" data-new-goal>+ Add a goal</button>`)}
        </div>

        <div class="card">
          <div class="card-head"><h3>Habits</h3><span class="sub">This week</span></div>
          ${habits.length ? `<div class="card-body col gap-16">${habits.map((h) => {
            const streak = S.habitStreak(h);
            return `<div>
              <div class="between mb-6">
                <span class="row gap-8" style="min-width:0">
                  <span>${U.esc(h.icon)}</span>
                  <span class="small bold truncate">${U.esc(h.name)}</span>
                </span>
                <span class="row gap-6 nowrap">
                  ${streak ? `<span class="badge warn">${streak}🔥</span>` : ""}
                  <button class="icon-btn btn-sm" data-edit-habit="${h.id}" aria-label="Edit habit">✎</button>
                </span>
              </div>
              <div class="habit-week">${habitWeek(h)}</div>
            </div>`;
          }).join("")}</div>`
          : UI.emptyState("🌱", "No habits yet", "Small daily habits compound.",
              `<button class="btn btn-primary" data-new-habit>+ Add a habit</button>`)}
        </div>
      </div>

      <div class="grid g-main">
        <div class="card">
          <div class="card-head">
            <div><h3>Attendance</h3><div class="sub">Last 3 weeks</div></div>
            <button class="btn btn-sm" data-new-att>+ Record</button>
          </div>
          <div class="card-body">
            <div class="row gap-24 wrap mb-16">
              <div class="row gap-12">
                ${C.ring(att.rate, { size: 76, stroke: 8, label: U.round(att.rate) + "%",
                    color: att.rate >= 95 ? "var(--ok)" : att.rate >= 90 ? "var(--warn)" : "var(--danger)" })}
                <div>
                  <div class="bold">${U.round(att.rate, 1)}% present</div>
                  <div class="tiny dim">${att.scheduled} class meetings scheduled</div>
                </div>
              </div>
              <div class="vdiv"></div>
              <div class="row gap-16">
                <div><div class="stat-value" style="font-size:1.3rem;color:var(--danger)">${att.missed}</div>
                  <div class="tiny dim">Absences</div></div>
                <div><div class="stat-value" style="font-size:1.3rem;color:var(--warn)">${att.late}</div>
                  <div class="tiny dim">Late arrivals</div></div>
              </div>
            </div>
            ${missByClass.length ? `<h4 class="mb-8">Missed by class</h4>
              ${C.hbars(missByClass, { fmt: (v) => U.plural(v, "miss", "misses") })}` : ""}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>Recent records</h3></div>
          ${recentAtt.length ? `<div class="list">${recentAtt.map((a) => {
            const c = S.cls(a.classId);
            return `<div class="list-item">
              <i class="dot-badge" style="background:${U.esc(c ? c.color : "#888")}"></i>
              <span class="grow"><div class="title">${U.esc(c ? c.name : "—")}</div>
                <div class="meta">${U.esc(U.fmtDate(a.date, "day"))}</div></span>
              <span class="badge ${a.status === "absent" ? "danger" : a.status === "late" ? "warn" : ""}">
                ${U.titleCase(a.status)}</span>
              <button class="icon-btn btn-sm" data-del-att="${a.id}" aria-label="Remove">✕</button>
            </div>`;
          }).join("")}</div>`
          : `<div class="card-body"><p class="dim small">Perfect attendance — nothing recorded. 🎉</p></div>`}
        </div>
      </div>
    </div>`;
  }

  function mount(root) {
    U.on(root, "click", "[data-new-goal]", () => goalForm(null));
    U.on(root, "click", "[data-goal]", (_e, el) => goalForm(S.byId("goals", el.dataset.goal)));
    U.on(root, "click", "[data-new-habit]", () => habitForm(null));
    U.on(root, "click", "[data-edit-habit]", (e, el) => { e.stopPropagation(); habitForm(S.byId("habits", el.dataset.editHabit)); });
    U.on(root, "click", "[data-new-att]", attendanceForm);
    U.on(root, "click", "[data-del-att]", (_e, el) => S.remove("attendance", el.dataset.delAtt));

    U.on(root, "click", "[data-habit]", (_e, el) => {
      const h = S.byId("habits", el.dataset.habit);
      if (!h) return;
      const iso = el.dataset.date;
      if (h.log[iso]) delete h.log[iso];
      else h.log[iso] = true;
      S.commit();
    });
  }

  return { render, mount, title: "Goals" };
})();
