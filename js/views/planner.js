/* ==========================================================================
   views/planner.js — study plan, time blocking, estimate calibration
   ========================================================================== */

App.views.planner = (function () {
  const U = App.utils, S = App.store, UI = App.ui, C = App.charts, P = App.planner;

  let plan = null;
  let horizon = 14;

  function rebuild() { plan = P.build(horizon); }

  /* ------------------------------------------------------------ settings */

  function settingsForm() {
    const p = S.settings.planner;
    UI.modal({
      title: "When can you study?",
      sub: "The planner only schedules inside these windows, minus classes and practices",
      size: "wide",
      okLabel: "Save",
      body: `<div class="form-grid">
        <div class="field"><label>Weekdays — from</label>
          <input class="input" type="time" name="weekdayStart" value="${p.weekdayStart}" /></div>
        <div class="field"><label>Weekdays — until</label>
          <input class="input" type="time" name="weekdayEnd" value="${p.weekdayEnd}" /></div>
        <div class="field"><label>Weekends — from</label>
          <input class="input" type="time" name="weekendStart" value="${p.weekendStart}" /></div>
        <div class="field"><label>Weekends — until</label>
          <input class="input" type="time" name="weekendEnd" value="${p.weekendEnd}" /></div>
        <div class="field"><label>Session length (min)</label>
          <input class="input" type="number" name="blockMin" min="10" max="120" step="5" value="${p.blockMin}" /></div>
        <div class="field"><label>Daily maximum (min)</label>
          <input class="input" type="number" name="maxPerDay" min="30" max="600" step="15" value="${p.maxPerDay}" /></div>
        <div class="field full"><label>Finish this many days early</label>
          <input class="input" type="number" name="bufferDays" min="0" max="5" value="${p.bufferDays}" />
          <span class="hint">A buffer keeps you from finishing everything the night before.</span></div>
      </div>`,
      onSubmit(d) {
        S.commit((db) => {
          Object.assign(db.settings.planner, {
            weekdayStart: d.weekdayStart, weekdayEnd: d.weekdayEnd,
            weekendStart: d.weekendStart, weekendEnd: d.weekendEnd,
            blockMin: U.clamp(Number(d.blockMin) || 30, 10, 120),
            maxPerDay: U.clamp(Number(d.maxPerDay) || 180, 30, 600),
            bufferDays: U.clamp(Number(d.bufferDays) || 0, 0, 5)
          });
        });
        rebuild();
        UI.toast("Study windows saved");
      }
    });
  }

  /* -------------------------------------------------------- calibration */

  function calibrationCard() {
    const c = P.calibration();
    if (!c.ready) {
      return `<div class="card"><div class="card-head"><h3>Estimate accuracy</h3></div>
        <div class="card-body">
          <p class="small muted">Finish ${4 - c.n} more assignment${4 - c.n === 1 ? "" : "s"} with time
          logged and Scholar will learn how far off your time estimates run, then correct future plans automatically.</p>
        </div></div>`;
    }

    const off = Math.round((c.multiplier - 1) * 100);
    const applied = U.round(S.settings.estimateMultiplier || 1, 2);
    const inSync = Math.abs(applied - c.multiplier) < 0.05;

    return `<div class="card">
      <div class="card-head">
        <div><h3>Estimate accuracy</h3><div class="sub">Learned from ${U.plural(c.n, "finished assignment")}</div></div>
      </div>
      <div class="card-body">
        <div class="row gap-16 mb-16">
          ${C.ring(U.clamp(100 / c.multiplier, 0, 100), {
            size: 84, stroke: 9, label: (c.multiplier).toFixed(2) + "×",
            color: off > 25 ? "var(--warn)" : off < -25 ? "var(--info)" : "var(--ok)"
          })}
          <div>
            <div class="bold">${off > 5 ? `You underestimate by ${off}%`
              : off < -5 ? `You overestimate by ${Math.abs(off)}%`
              : "Your estimates are accurate"}</div>
            <div class="tiny dim mt-4">
              ${off > 5 ? `A "1 hour" task really takes about ${U.fmtDur(60 * c.multiplier)}.`
                : off < -5 ? `You finish faster than you expect — nice.`
                : "Keep doing what you're doing."}
            </div>
          </div>
        </div>

        ${c.byType.length ? `<h4 class="mb-8">By assignment type</h4>
          ${C.hbars(c.byType.map((t) => ({
            label: t.type, value: U.round(t.ratio, 2),
            note: `${U.plural(t.n, "sample")} · ${t.ratio > 1 ? "runs long" : "runs short"}`
          })), { max: Math.max(2, ...c.byType.map((t) => t.ratio)), fmt: (v) => v + "×" })}` : ""}

        ${inSync
          ? `<p class="tiny dim mt-12">✓ Applied to every plan and forecast.</p>`
          : `<button class="btn btn-sm btn-primary mt-12" data-apply-cal>
               Apply ${c.multiplier.toFixed(2)}× to future estimates</button>`}
      </div>
    </div>`;
  }

  /* ------------------------------------------------------------ warnings */

  function warningsCard() {
    const list = P.warnings(horizon);
    if (!list.length) {
      return `<div class="card" style="border-left:3px solid var(--ok)">
        <div class="card-body row gap-10">
          <span style="font-size:1.1rem">✅</span>
          <div><div class="bold small">No crunch ahead</div>
            <div class="tiny dim">Your workload fits in the time you have for the next ${horizon} days.</div></div>
        </div></div>`;
    }
    return `<div class="card">
      <div class="card-head"><h3>Heads up</h3><span class="badge ${list[0].level === "high" ? "danger" : "warn"}">${list.length}</span></div>
      <div class="list">
        ${list.slice(0, 6).map((w) => `<div class="list-item">
          <span style="font-size:1rem">${w.level === "high" ? "🔴" : "🟡"}</span>
          <span class="grow">
            <div class="title">${U.esc(w.title)}</div>
            <div class="meta">${U.esc(w.detail)}</div>
          </span>
          <span class="badge">${U.esc(U.relDate(w.date))}</span>
        </div>`).join("")}
      </div>
    </div>`;
  }

  /* -------------------------------------------------------------- render */

  function dayCard(day) {
    const isToday = day.date === U.today();
    const pct = day.capacity ? U.clamp((day.used / day.capacity) * 100, 0, 100) : 0;
    const w = P.windowFor(day.date);

    return `<div class="card ${isToday ? "" : ""}" style="${isToday ? "border-color:var(--brand-400)" : ""}">
      <div class="card-head" style="padding:11px 14px">
        <div>
          <h4>${U.esc(U.fmtDate(day.date, "day"))} ${isToday ? `<span class="badge solid">Today</span>` : ""}</h4>
          <div class="sub">${day.used ? `${U.fmtDur(day.used)} planned` : "Nothing planned"} ·
            ${U.fmtDur(day.capacity)} free</div>
        </div>
        <button class="btn btn-sm" data-add-block="${day.date}">+</button>
      </div>
      <div class="card-body tight">
        <div class="bar thin mb-12"><i style="width:${U.round(pct, 1)}%;
          ${pct > 92 ? "background:var(--danger)" : pct > 75 ? "background:var(--warn)" : ""}"></i></div>

        ${w.busy.length ? `<div class="tiny dim mb-8">
          Busy: ${w.busy.slice(0, 3).map((b) => `${U.esc(b.label)} ${U.fmtTime(U.fromMin(b.start))}`).join(" · ")}
        </div>` : ""}

        ${day.blocks.length ? day.blocks.map((b) => `
          <div class="agenda-row" style="margin-bottom:6px;padding:7px 9px" data-open-hw="${b.assignmentId}">
            <span class="agenda-stripe" style="background:${U.esc(b.color)}"></span>
            <span class="agenda-time" style="width:64px">${b.start ? U.fmtTime(b.start) : "—"}</span>
            <span class="grow" style="min-width:0">
              <div class="small bold truncate">${U.esc(b.title)}</div>
              <div class="tiny dim truncate">${U.esc(S.className(b.classId))} · due ${U.esc(U.relDate(b.due))}</div>
            </span>
            <span class="badge">${U.fmtDur(b.minutes)}</span>
          </div>`).join("")
        : `<p class="tiny dim center" style="padding:10px 0">Free evening 🎉</p>`}
      </div>
    </div>`;
  }

  function render() {
    if (!plan) rebuild();
    const st = plan.stats;
    const cal = P.calibration();

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>${App.i18n.t("planner", "Planner")}</h1>
          <div class="sub">
            ${U.fmtDur(st.scheduled)} scheduled across ${horizon} days ·
            ${U.round(st.utilization * 100)}% of your free time
            ${cal.ready ? ` · estimates corrected ${cal.multiplier.toFixed(2)}×` : ""}
          </div>
        </div>
        <div class="page-actions">
          <div class="segmented">
            <button class="${horizon === 7 ? "active" : ""}" data-h="7">1 week</button>
            <button class="${horizon === 14 ? "active" : ""}" data-h="14">2 weeks</button>
            <button class="${horizon === 21 ? "active" : ""}" data-h="21">3 weeks</button>
          </div>
          <button class="btn" data-settings>⚙ Study hours</button>
          <button class="btn btn-primary" data-apply>✓ Apply plan</button>
        </div>
      </div>

      <div class="grid g-4 mb-16">
        <div class="stat accent">
          <div class="stat-ico">🗓️</div>
          <div class="stat-label">Work to schedule</div>
          <div class="stat-value">${U.fmtDur(st.needed)}</div>
          <div class="stat-foot">${U.plural(S.openAssignments().length, "open item")}</div>
        </div>
        <div class="stat">
          <div class="stat-ico">⏳</div>
          <div class="stat-label">Free time available</div>
          <div class="stat-value">${U.fmtDur(st.capacity)}</div>
          <div class="stat-foot">Next ${horizon} days, after school &amp; practice</div>
        </div>
        <div class="stat">
          <div class="stat-ico">📊</div>
          <div class="stat-label">Load</div>
          <div class="stat-value">${U.round(st.utilization * 100)}%</div>
          <div class="stat-foot">${st.utilization > 0.85 ? "Very tight" : st.utilization > 0.6 ? "Busy but doable" : "Comfortable"}</div>
        </div>
        <div class="stat">
          <div class="stat-ico">${plan.unplaced.length ? "⚠️" : "✅"}</div>
          <div class="stat-label">Won't fit</div>
          <div class="stat-value">${plan.unplaced.length}</div>
          <div class="stat-foot">${plan.unplaced.length ? "Needs more time or a later deadline" : "Everything fits"}</div>
        </div>
      </div>

      ${plan.unplaced.length ? `<div class="card mb-16" style="border-left:3px solid var(--danger)">
        <div class="card-head"><h3>Can't fit before the deadline</h3></div>
        <div class="list">
          ${plan.unplaced.map((u) => `<div class="list-item">
            <i class="dot-badge" style="background:${U.esc(S.classColor(u.assignment.classId))}"></i>
            <span class="grow"><div class="title">${U.esc(u.assignment.title)}</div>
              <div class="meta">${U.esc(S.className(u.assignment.classId))} ·
                ${u.overdue ? "already overdue — " : ""}short by ${U.fmtDur(u.minutesShort)}</div></span>
            ${UI.dueBadge(u.assignment.due)}
          </div>`).join("")}
        </div>
        <div class="card-foot tiny dim">
          Options: start earlier by widening your study hours, raise the daily maximum, or trim scope on the lowest-priority item.
        </div>
      </div>` : ""}

      <div class="grid g-main">
        <div>
          <h3 class="mb-12">Your plan</h3>
          <div class="grid g-2">${plan.days.filter((d) => d.blocks.length || d.date === U.today()).slice(0, 12).map(dayCard).join("")}</div>
        </div>
        <div class="col gap-16">
          ${warningsCard()}
          ${calibrationCard()}
          <div class="card">
            <div class="card-head"><h3>Daily load</h3></div>
            <div class="card-body">
              ${C.bars(plan.days.map((d, i) => ({
                label: U.DOW_SHORT[U.parseDate(d.date).getDay()][0],
                full: U.fmtDate(d.date, "day"),
                value: d.used, highlight: i === 0
              })), { h: 160, fmt: (v) => U.fmtDur(v) })}
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }

  function addBlockForm(date) {
    const open = S.openAssignments();
    if (!open.length) { UI.toast("Nothing to schedule", "Add an assignment first."); return; }
    UI.modal({
      title: "Schedule study time",
      sub: U.fmtDate(date, "long"),
      okLabel: "Schedule it",
      body: `<div class="form-grid">
        <div class="field full"><label>Assignment</label>
          <select class="select" name="assignmentId">
            ${open.map((a) => `<option value="${a.id}">${U.esc(a.title)} — ${U.esc(S.className(a.classId))} (due ${U.esc(U.relDate(a.due))})</option>`).join("")}
          </select></div>
        <div class="field"><label>Start at</label>
          <input class="input" type="time" name="start" value="${U.fromMin((P.gapsFor(date)[0] || { start: 16 * 60 }).start)}" /></div>
        <div class="field"><label>For (min)</label>
          <input class="input" type="number" name="minutes" min="10" step="5" value="45" /></div>
      </div>`,
      onSubmit(d) {
        S.update("assignments", d.assignmentId, {
          scheduledFor: date, scheduledMin: U.toMin(d.start), scheduledAuto: false
        });
        rebuild();
        UI.toast("Scheduled", `${U.fmtTime(d.start)} on ${U.fmtDate(date, "day")}`, "ok");
      }
    });
  }

  function mount(root) {
    U.on(root, "click", "[data-h]", (_e, el) => { horizon = Number(el.dataset.h); rebuild(); App.router.refresh(); });
    U.on(root, "click", "[data-settings]", settingsForm);
    U.on(root, "click", "[data-add-block]", (_e, el) => addBlockForm(el.dataset.addBlock));
    U.on(root, "click", "[data-apply-cal]", () => {
      const c = P.applyCalibration();
      rebuild();
      UI.toast("Estimates recalibrated", `Future plans now use a ${c.multiplier.toFixed(2)}× correction.`, "ok");
    });
    U.on(root, "click", "[data-apply]", () => {
      const n = P.apply(plan);
      UI.toast("Plan applied", `${U.plural(n, "session")} added to your calendar.`, "ok");
    });
  }

  // Rebuild whenever data changes underneath us.
  function unmount() { plan = null; }

  return { render, mount, unmount, title: "Planner" };
})();
