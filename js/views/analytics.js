/* ==========================================================================
   views/analytics.js — trends across grades, workload, study time
   ========================================================================== */

App.views.analytics = (function () {
  const U = App.utils, S = App.store, UI = App.ui, C = App.charts;

  let range = 28;   // days

  // Estimated workload (minutes of assigned work) landing on each of the
  // next 14 days — surfaces crunch days before they arrive.
  function workloadAhead() {
    const out = [];
    for (let i = 0; i < 14; i++) {
      const iso = U.dateKey(U.addDays(new Date(), i));
      const items = S.db.assignments.filter((a) => a.due === iso && a.status !== "done");
      out.push({
        label: U.DOW_SHORT[U.parseDate(iso).getDay()][0],
        full: U.fmtDate(iso, "day"),
        value: U.sum(items, (a) => a.estMinutes || 0),
        highlight: i === 0,
        count: items.length
      });
    }
    return out;
  }

  function studySeries() {
    return S.studyByDay(range).map((d, i, arr) => ({
      label: U.DOW_SHORT[U.parseDate(d.date).getDay()][0],
      full: U.fmtDate(d.date, "day"),
      value: d.minutes,
      highlight: i === arr.length - 1
    }));
  }

  function completionRate() {
    const all = S.db.assignments;
    if (!all.length) return { rate: 100, onTime: 0, late: 0, open: 0 };
    const done = all.filter((a) => a.status === "done");
    const open = all.filter((a) => a.status !== "done");
    const late = open.filter((a) => U.diffDays(a.due, U.today()) < 0).length;
    return {
      rate: (done.length / all.length) * 100,
      onTime: done.length, late, open: open.length
    };
  }

  function render() {
    const trend = S.gradeTrend();
    const study = studySeries();
    const work = workloadAhead();
    const comp = completionRate();
    const att = S.attendanceRate();
    const totalStudy = U.sum(S.studyByDay(range), (d) => d.minutes);
    const busiest = U.sortBy(work, (w) => -w.value)[0];

    // Per-class comparisons — always direct-labeled.
    const byClass = S.db.classes.map((c) => {
      const items = S.assignmentsFor(c.id);
      const graded = items.filter((a) => a.graded);
      return {
        c,
        grade: S.classGrade(c.id),
        openCount: items.filter((a) => a.status !== "done").length,
        studyMin: U.sum(S.db.studySessions.filter((s) => s.classId === c.id), (s) => s.minutes),
        workload: U.sum(items.filter((a) => a.status !== "done"), (a) => a.estMinutes || 0),
        gradedCount: graded.length
      };
    });

    const typeMix = (() => {
      const g = U.groupBy(S.db.assignments, (a) => a.type || "Other");
      return [...g.entries()]
        .map(([type, items], i) => ({ label: type, value: items.length, color: S.PALETTE[i % S.PALETTE.length] }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 6);
    })();

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>Analytics</h1>
          <div class="sub">Patterns across your grades, workload, and study time</div>
        </div>
        <div class="page-actions">
          <div class="segmented">
            <button class="${range === 14 ? "active" : ""}" data-range="14">2 weeks</button>
            <button class="${range === 28 ? "active" : ""}" data-range="28">4 weeks</button>
            <button class="${range === 56 ? "active" : ""}" data-range="56">8 weeks</button>
          </div>
        </div>
      </div>

      <div class="grid g-4 mb-16">
        <div class="stat accent">
          <div class="stat-ico">✅</div>
          <div class="stat-label">Completion rate</div>
          <div class="stat-value">${U.round(comp.rate)}%</div>
          <div class="stat-foot">${comp.onTime} done · ${comp.open} open${comp.late ? ` · ${comp.late} late` : ""}</div>
        </div>
        <div class="stat">
          <div class="stat-ico">⏱️</div>
          <div class="stat-label">Study time</div>
          <div class="stat-value">${U.fmtDur(totalStudy)}</div>
          <div class="stat-foot">Last ${range} days · ${U.fmtDur(totalStudy / range)}/day avg</div>
        </div>
        <div class="stat">
          <div class="stat-ico">📈</div>
          <div class="stat-label">Current average</div>
          <div class="stat-value">${trend.length ? U.round(trend[trend.length - 1].pct, 1) + "%" : "—"}</div>
          <div class="stat-foot">${trend.length > 1
            ? (() => {
                const delta = trend[trend.length - 1].pct - trend[0].pct;
                return `<span style="color:var(--${delta >= 0 ? "ok" : "danger"})">
                  ${delta >= 0 ? "▲" : "▼"} ${U.round(Math.abs(delta), 1)} pts</span> since first grade`;
              })()
            : "Not enough data"}</div>
        </div>
        <div class="stat">
          <div class="stat-ico">🚦</div>
          <div class="stat-label">Busiest day ahead</div>
          <div class="stat-value" style="font-size:1.2rem;margin-top:8px">${busiest && busiest.value ? U.esc(busiest.full) : "Clear"}</div>
          <div class="stat-foot">${busiest && busiest.value ? `${U.fmtDur(busiest.value)} of work due` : "No crunch days coming"}</div>
        </div>
      </div>

      <div class="grid g-2 mb-16">
        <div class="card">
          <div class="card-head">
            <div><h3>Grade trend</h3><div class="sub">Cumulative average, all classes</div></div>
          </div>
          <div class="card-body">${C.line(trend, { h: 210 })}</div>
        </div>

        <div class="card">
          <div class="card-head">
            <div><h3>Study minutes per day</h3><div class="sub">Last ${range} days</div></div>
          </div>
          <div class="card-body">
            ${C.bars(study, { h: 210, unit: "m", labelEvery: range > 30 ? 7 : range > 14 ? 3 : 1,
                              fmt: (v) => U.fmtDur(v) })}
          </div>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-head">
          <div><h3>Workload forecast</h3>
            <div class="sub">Estimated work due each day for the next two weeks</div></div>
        </div>
        <div class="card-body">
          ${C.bars(work, { h: 190, fmt: (v) => U.fmtDur(v) })}
          <p class="tiny dim mt-8">Based on the time estimate on each open assignment.
            Tall bars are worth starting early.</p>
        </div>
      </div>

      <div class="grid g-2 mb-16">
        <div class="card">
          <div class="card-head">
            <div><h3>Effort vs. outcome</h3><span class="sub">By class</span></div>
            <button class="btn btn-sm" data-export-effort>⇩ CSV</button>
          </div>
          <div class="card-body">
            <div class="table-wrap"><table class="table">
              <thead><tr>
                <th>Class</th><th class="right">Studied</th>
                <th class="right">Open</th><th class="right">Grade</th>
              </tr></thead>
              <tbody>${U.sortBy(byClass, (r) => -(r.grade == null ? -1 : r.grade)).map((r) => `
                <tr>
                  <td><span class="row gap-8">
                    <i class="dot-badge" style="background:${U.esc(r.c.color)}"></i>
                    <span class="truncate">${U.esc(r.c.name)}</span></span></td>
                  <td class="right nums small">${U.fmtDur(r.studyMin)}</td>
                  <td class="right nums small">${r.openCount}</td>
                  <td class="right">${UI.gradePill(r.grade)}</td>
                </tr>`).join("")}</tbody>
            </table></div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>Assignment mix</h3><span class="sub">All time, by type</span></div>
          <div class="card-body">
            ${typeMix.length ? C.stackbar(typeMix, { height: 14 })
              : `<p class="dim small">No assignments yet.</p>`}
            <div class="divider"></div>
            <h4 class="mb-8">Remaining workload by class</h4>
            ${(() => {
              const rows = byClass.filter((r) => r.workload > 0)
                .map((r) => ({ label: r.c.name, color: r.c.color, value: r.workload }))
                .sort((a, b) => b.value - a.value);
              return rows.length ? C.hbars(rows, { fmt: (v) => U.fmtDur(v) })
                : `<p class="dim small">Nothing outstanding. 🎉</p>`;
            })()}
          </div>
        </div>
      </div>

      <div class="grid g-2 mb-16">
        <div class="card">
          <div class="card-head"><h3>Best study time</h3><span class="sub">From your own rated sessions</span></div>
          <div class="card-body">
            ${(() => {
              const hour = S.bestStudyHour();
              const avgQ = S.avgSessionQuality();
              if (hour == null) return `<p class="dim small">Rate a few study sessions (flashcards, focus timer) to see this.</p>`;
              return `<div class="row gap-24 wrap">
                <div><div class="tiny dim">Sharpest around</div><div class="bold" style="font-size:1.3rem">${U.esc(U.fmtTime(U.fromMin(hour * 60)))}</div></div>
                ${avgQ != null ? `<div><div class="tiny dim">Avg. session quality</div><div class="bold" style="font-size:1.3rem">${U.round(avgQ, 1)} / 5</div></div>` : ""}
              </div>`;
            })()}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>Term over term</h3><span class="sub">Your own past terms, not other students</span></div>
          <div class="card-body">
            ${(() => {
              const rows = S.termComparison();
              return rows.length ? C.hbars(rows.map((r) => ({ label: r.term + (r.current ? " (current)" : ""), value: U.round(r.gpa, 2) })), { max: 5, fmt: (v) => v })
                : `<p class="dim small">Add a past term with a final GPA in Settings to compare.</p>`;
            })()}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Consistency</h3><span class="sub">Study activity, last 4 weeks</span></div>
        <div class="card-body">
          ${C.heatmap(S.studyByDay(28))}
          <div class="divider"></div>
          <div class="row gap-24 wrap">
            <div><div class="tiny dim">Attendance</div>
              <div class="bold">${U.round(att.rate, 1)}%</div></div>
            <div><div class="tiny dim">Current streak</div>
              <div class="bold">${S.db.streak.count} days 🔥</div></div>
            <div><div class="tiny dim">Total XP</div>
              <div class="bold">${S.db.streak.xp}</div></div>
            <div><div class="tiny dim">Days studied</div>
              <div class="bold">${S.studyByDay(28).filter((d) => d.minutes > 0).length} of 28</div></div>
          </div>
        </div>
      </div>
    </div>`;
  }

  function mount(root) {
    U.on(root, "click", "[data-range]", (_e, el) => { range = Number(el.dataset.range); App.router.refresh(); });
    U.on(root, "click", "[data-export-effort]", () => {
      const byClass = S.db.classes.map((c) => ({
        name: c.name,
        studyMin: U.sum(S.db.studySessions.filter((s) => s.classId === c.id), (s) => s.minutes),
        openCount: S.assignmentsFor(c.id).filter((a) => a.status !== "done").length,
        grade: S.classGrade(c.id)
      }));
      S.exportTableCSV(byClass, [
        { label: "Class", key: "name" }, { label: "Studied (min)", key: "studyMin" },
        { label: "Open", key: "openCount" }, { label: "Grade %", key: "grade" }
      ], "effort-vs-outcome.csv");
    });
  }

  return { render, mount, title: "Analytics" };
})();
