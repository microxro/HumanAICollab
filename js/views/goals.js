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
          // Was a bare S.remove + plain toast, so there was no Undo action and
          // Ctrl+Z did nothing — recovery meant knowing about Settings → trash.
          UI.deleteWithUndo("goals", gl.id, gl.title);
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
          UI.deleteWithUndo("habits", hb.id, hb.name);
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
    // ensureV3 backfills h.log at boot, but a record can also arrive mid-
    // session from a sync pull, and this render maps over every habit — so
    // one without a log took the whole Goals view down instead of showing
    // itself as a blank week.
    const log = (h && h.log) || {};
    return Array.from({ length: 7 }, (_, i) => {
      const d = U.addDays(start, i);
      const iso = U.dateKey(d);
      const future = iso > today;
      return `<button class="habit-day ${log[iso] ? "on" : ""} ${future ? "future" : ""}"
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

  /* ---------------------------------------------------- F073-080 wellbeing */

  function moodCheckIn() {
    UI.modal({
      title: "How are you doing?",
      sub: "30 seconds — the value is in the trend, not any one day",
      size: "narrow",
      footer: "",
      body: `<div class="field mb-16">
          <label>Mood</label>
          <div class="row gap-8" id="moodRow">
            ${["😞", "😕", "😐", "🙂", "😄"].map((e, i) => `<button type="button" class="btn btn-lg" data-mood="${i + 1}">${e}</button>`).join("")}
          </div>
        </div>
        <div class="field">
          <label>Energy</label>
          <div class="row gap-8" id="energyRow">
            ${["🪫", "🔋", "🔋", "⚡", "⚡"].map((e, i) => `<button type="button" class="btn btn-lg" data-energy="${i + 1}">${e}${i + 1}</button>`).join("")}
          </div>
        </div>`,
      onMount(root) {
        let mood = null, energy = null;
        const tryDone = () => {
          if (mood == null || energy == null) return;
          S.logMood(mood, energy);
          UI.closeModal();
          UI.toast("Logged", "Thanks for checking in.", "ok");
        };
        U.on(root, "click", "[data-mood]", (_e, el) => {
          mood = Number(el.dataset.mood);
          U.$$("[data-mood]", root).forEach((b) => b.classList.toggle("btn-primary", b === el));
          tryDone();
        });
        U.on(root, "click", "[data-energy]", (_e, el) => {
          energy = Number(el.dataset.energy);
          U.$$("[data-energy]", root).forEach((b) => b.classList.toggle("btn-primary", b === el));
          tryDone();
        });
      }
    });
  }

  function sleepLogForm() {
    UI.modal({
      title: "Log last night's sleep",
      okLabel: "Save",
      body: `<div class="form-grid">
        <div class="field"><label>Bedtime</label>
          <input class="input" type="time" name="bed" value="22:30" /></div>
        <div class="field"><label>Wake time</label>
          <input class="input" type="time" name="wake" value="6:45" /></div>
      </div>`,
      onSubmit(d) {
        const hours = S.logSleep(d.bed, d.wake);
        UI.toast("Sleep logged", `${hours}h`, "ok");
      }
    });
  }

  function journalForm() {
    UI.modal({
      title: "Reflection journal",
      sub: "Private — never shared with a parent",
      okLabel: "Save entry",
      body: `<textarea class="textarea" name="text" rows="6" placeholder="How's this week going? What's working, what isn't…"></textarea>`,
      onSubmit(d) {
        if (!d.text.trim()) return false;
        S.addJournalEntry(d.text.trim());
        UI.toast("Saved to journal", "", "ok");
      }
    });
  }

  function journalHistory() {
    const entries = S.journalEntries();
    UI.modal({
      title: "Journal history",
      size: "wide",
      footer: `<button type="button" class="btn btn-primary" data-close>Close</button>`,
      body: entries.length ? entries.map((j) => `
        <div class="mb-12"><div class="tiny dim mb-2">${U.esc(U.fmtDate(j.date, "long"))}</div>
        <p class="small" style="white-space:pre-wrap">${U.esc(j.text)}</p></div><div class="divider"></div>`).join("")
        : `<p class="dim small">No entries yet.</p>`
    });
  }

  /* ---------------------------------------------------------- F084 review */

  function weeklyReview() {
    const weekAgo = U.dateKey(U.addDays(new Date(), -7));
    const doneThisWeek = S.db.assignments.filter((a) => a.status === "done" && a.due >= weekAgo);
    const slipped = S.overdue();
    const changes = S.detectChanges();
    const mood = S.moodTrend(7).filter((m) => m.mood != null);
    const avgMood = mood.length ? U.avg(mood, (m) => m.mood) : null;
    const studyMin = U.sum(S.db.studySessions.filter((s) => s.date >= weekAgo), (s) => s.minutes);

    UI.modal({
      title: "Weekly review",
      sub: "A short Friday retrospective",
      size: "wide",
      okLabel: "Save reflection",
      body: `
        <div class="grid g-4 mb-16">
          <div class="stat"><div class="stat-label">Completed</div><div class="stat-value">${doneThisWeek.length}</div></div>
          <div class="stat"><div class="stat-label">Slipped</div><div class="stat-value" style="color:${slipped.length ? "var(--danger)" : "inherit"}">${slipped.length}</div></div>
          <div class="stat"><div class="stat-label">Studied</div><div class="stat-value">${U.fmtDur(studyMin)}</div></div>
          <div class="stat"><div class="stat-label">Avg mood</div><div class="stat-value">${avgMood != null ? U.round(avgMood, 1) : "—"}</div></div>
        </div>
        ${slipped.length ? `<h4 class="mb-8">What slipped</h4>
          <div class="list mb-12" style="border:1px solid var(--border);border-radius:var(--radius)">
            ${slipped.slice(0, 5).map((a) => `<div class="list-item"><span class="grow">${U.esc(a.title)}</span>${UI.dueBadge(a.due)}</div>`).join("")}
          </div>` : `<p class="small" style="color:var(--ok)">Nothing slipped this week. 🎉</p>`}
        ${changes.length ? `<h4 class="mb-8">Grade changes</h4>
          <div class="row gap-6 wrap mb-12">${changes.map((c) => `<span class="badge ${c.delta < 0 ? "danger" : "ok"}">${U.esc(c.className)} ${c.delta > 0 ? "+" : ""}${c.delta}</span>`).join("")}</div>` : ""}
        <div class="divider"></div>
        <div class="field">
          <label>What's next — one change for next week</label>
          <textarea class="textarea" name="reflection" rows="4" placeholder="e.g. Start chemistry lab reports earlier, block out mornings for calc…"></textarea>
        </div>`,
      onSubmit(d) {
        if (!d.reflection.trim()) return false;
        S.addJournalEntry(`Weekly review: ${doneThisWeek.length} done, ${slipped.length} slipped. Next: ${d.reflection.trim()}`);
        UI.toast("Review saved", "Added to your journal", "ok");
      }
    });
  }

  function wellbeingHTML() {
    const risk = S.burnoutRisk();
    const relief = S.workloadRelief();   // F076
    const usage = S.usageBySection();
    const sleep = S.avgSleep(7);
    const mood7 = S.moodTrend(7).filter((m) => m.mood != null);
    const totalUsage = usage.studying + usage.other;
    const riskColor = risk.level === "high" ? "var(--danger)" : risk.level === "medium" ? "var(--warn)" : "var(--ok)";

    return `<div class="grid g-main mt-16">
      <div class="card">
        <div class="card-head">
          <div><h3>Wellbeing</h3><div class="sub">Thirty seconds a day, tracked privately</div></div>
          <button class="btn btn-sm btn-primary" data-mood-checkin>Check in</button>
        </div>
        <div class="card-body">
          <div class="row gap-16 wrap mb-16">
            <div class="row gap-12">
              <span class="badge" style="border:2px solid ${riskColor};color:${riskColor}">Burnout risk: ${U.titleCase(risk.level)}</span>
            </div>
            <div class="vdiv"></div>
            <div><div class="tiny dim">Avg sleep (7d)</div>
              <div class="bold">${sleep != null ? sleep + "h" : "—"}</div></div>
            <div class="vdiv"></div>
            <div><div class="tiny dim">Mood check-ins (7d)</div>
              <div class="bold">${mood7.length}</div></div>
          </div>

          ${relief.length ? `<h4 class="mb-8">If this week is too much</h4>
            <div class="list mb-12" style="border:1px solid var(--border);border-radius:var(--radius)">
              ${relief.map((a) => `<div class="list-item"><span class="grow"><div class="title">${U.esc(a.title)}</div>
                <div class="meta">${U.esc(S.className(a.classId))} · lowest cost to move or drop</div></span>${UI.dueBadge(a.due)}</div>`).join("")}
            </div>` : ""}

          <div class="row gap-8 wrap">
            <button class="btn btn-sm" data-log-sleep>😴 Log sleep</button>
            <button class="btn btn-sm" data-journal>📓 Write in journal</button>
            <button class="btn btn-sm" data-journal-history>View journal (${S.journalEntries().length})</button>
            <button class="btn btn-sm" data-go="settings">⚙ Hide GPA</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Where your time goes today</h3><span class="sub">App usage by section</span></div>
        <div class="card-body">
          ${totalUsage ? `
            <div class="bar mb-8" style="height:10px">
              <i style="width:${U.round((usage.studying / totalUsage) * 100, 1)}%"></i>
            </div>
            <div class="row gap-16 small muted mb-16">
              <span>📚 Studying: ${U.fmtDur(usage.studying)}</span>
              <span>💬 Other: ${U.fmtDur(usage.other)}</span>
            </div>` : `<p class="dim small mb-16">No app usage logged yet today.</p>`}
          <div class="divider"></div>
          <h4 class="mb-8">Support resources</h4>   <!-- F079 — offline, never behind a login -->
          <p class="tiny dim mb-8">Available offline, never behind a login.</p>
          <div class="col gap-6 small">
            <div>🏫 School counselor: see Contacts for your assigned counselor</div>
            <div>☎️ 988 Suicide &amp; Crisis Lifeline — call or text 988</div>
            <div>💬 Crisis Text Line — text HOME to 741741</div>
          </div>
        </div>
      </div>

      ${emergencyCard()}
    </div>`;
  }

  /* -------------------------------------------------- F072 emergency card */

  function emergencyForm(ec) {
    const e = ec || {};
    UI.modal({
      title: ec ? "Edit emergency contact" : "Add emergency contact",
      okLabel: "Save",
      footer: ec ? `<button type="button" class="btn btn-danger left" data-del>Delete</button>
                    <button type="button" class="btn" data-close>Cancel</button>
                    <button type="submit" class="btn btn-primary">Save</button>` : undefined,
      body: `<div class="form-grid">
        <div class="field"><label>Name</label>
          <input class="input" name="name" required value="${U.esc(e.name || "")}" placeholder="Mom, Dr. Patel, Poison Control…" /></div>
        <div class="field"><label>Relation</label>
          <input class="input" name="relation" value="${U.esc(e.relation || "")}" placeholder="Parent, Doctor, School nurse…" /></div>
        <div class="field full"><label>Phone</label>
          <input class="input" name="phone" required value="${U.esc(e.phone || "")}" placeholder="555-0100" /></div>
      </div>`,
      onMount(root) {
        const del = root.querySelector("[data-del]");
        if (del) del.addEventListener("click", () => {
          UI.closeModal();
          S.commit((db) => { db.emergencyContacts = db.emergencyContacts.filter((x) => x.id !== ec.id); });
          UI.toast("Removed", e.name, "warn");
        });
      },
      onSubmit(d) {
        if (!d.name.trim() || !d.phone.trim()) return false;
        const patch = { name: d.name.trim(), relation: d.relation.trim(), phone: d.phone.trim() };
        if (ec) S.update("emergencyContacts", ec.id, patch);
        else S.insert("emergencyContacts", patch);
        UI.toast("Saved", patch.name, "ok");
      }
    });
  }

  function emergencyCard() {
    const list = S.db.emergencyContacts;
    return `<div class="card" style="border-left:3px solid var(--danger)">
      <div class="card-head">
        <div><h3>🚨 Emergency contacts</h3><div class="sub">Works offline — never behind a login</div></div>
        <button class="btn btn-sm" data-add-emergency>+ Add</button>
      </div>
      ${list.length ? `<div class="list">${list.map((e) => `
        <div class="list-item">
          <span class="grow"><div class="title">${U.esc(e.name)}</div>
            <div class="meta">${U.esc(e.relation || "")}</div></span>
          <a class="btn btn-sm btn-primary" href="tel:${U.esc(e.phone)}">📞 ${U.esc(e.phone)}</a>
          <button class="icon-btn btn-sm" data-edit-emergency="${e.id}" aria-label="Edit">✎</button>
        </div>`).join("")}</div>`
        : `<div class="card-body"><p class="dim small">Add a parent, doctor, or the school nurse so it's here even if you're offline.</p></div>`}
    </div>`;
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
          <h1>${App.i18n.t("goals", "Goals")}</h1>
          <div class="sub">${U.plural(goals.filter((g) => !g.done).length, "active goal")} ·
            ${U.plural(habits.length, "habit")} tracked</div>
        </div>
        <div class="page-actions">
          <button class="btn" data-weekly-review>📋 Weekly review</button>
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
          : UI.emptyState("goals", "No goals yet", "Set a target for GPA, service hours, or study time.",
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
          : UI.emptyState("habits", "No habits yet", "Small daily habits compound.",
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

      ${wellbeingHTML()}
    </div>`;
  }

  function mount(root) {
    U.on(root, "click", "[data-new-goal]", () => goalForm(null));
    U.on(root, "click", "[data-goal]", (_e, el) => goalForm(S.byId("goals", el.dataset.goal)));
    U.on(root, "click", "[data-new-habit]", () => habitForm(null));
    U.on(root, "click", "[data-edit-habit]", (e, el) => { e.stopPropagation(); habitForm(S.byId("habits", el.dataset.editHabit)); });
    U.on(root, "click", "[data-new-att]", attendanceForm);
    // A single click used to delete an attendance record outright — no
    // confirmation, no undo, no toast at all.
    U.on(root, "click", "[data-del-att]", (_e, el) => {
      const rec = S.byId("attendance", el.dataset.delAtt);
      UI.deleteWithUndo("attendance", el.dataset.delAtt,
        rec ? `${U.fmtDate(rec.date)} attendance` : "attendance record");
    });
    U.on(root, "click", "[data-weekly-review]", weeklyReview);
    U.on(root, "click", "[data-mood-checkin]", moodCheckIn);
    U.on(root, "click", "[data-log-sleep]", sleepLogForm);
    U.on(root, "click", "[data-journal]", journalForm);
    U.on(root, "click", "[data-journal-history]", journalHistory);
    U.on(root, "click", "[data-add-emergency]", () => emergencyForm(null));
    U.on(root, "click", "[data-edit-emergency]", (_e, el) => emergencyForm(S.byId("emergencyContacts", el.dataset.editEmergency)));

    U.on(root, "click", "[data-habit]", (_e, el) => {
      const h = S.byId("habits", el.dataset.habit);
      if (!h) return;
      const iso = el.dataset.date;
      // Toggling would create the property on undefined and throw.
      if (!h.log || typeof h.log !== "object") h.log = {};
      const wasOn = !!h.log[iso];
      if (wasOn) delete h.log[iso];
      else h.log[iso] = true;
      S.commit();
      // Ticking a box used to pay study tokens. It doesn't any more — a
      // checkbox is not evidence of anything, and the shop pays for quizzes
      // only now (js/shop.js). The streak and the habit chart are unchanged.
    });
  }

  return { render, mount, title: "Goals" };
})();
