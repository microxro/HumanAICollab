/* ==========================================================================
   views/grades.js — grade book, GPA, and the what-if simulator
   ========================================================================== */

App.views.grades = (function () {
  const U = App.utils, S = App.store, UI = App.ui, C = App.charts;

  let selected = null;      // classId for the trend chart, null = all

  /* --------------------------------------------------- what-if planner -- */

  /**
   * "What do I need on the final?" — solves for the score required on a
   * hypothetical upcoming assignment to land on a target class average.
   */
  function whatIf(classId) {
    const c = S.cls(classId);
    if (!c) return;
    const current = S.classGrade(classId);

    UI.modal({
      title: "What-if calculator",
      sub: c.name,
      okLabel: "Close",
      footer: `<button type="button" class="btn btn-primary" data-close>Close</button>`,
      body: `
        <div class="row gap-16 mb-16">
          <div>
            <div class="tiny dim">Current grade</div>
            ${UI.gradePill(current, true)}
          </div>
          <div class="grow">
            <p class="small muted">Add a hypothetical assignment to see where your grade lands —
            or set a target and find out what you need to score.</p>
          </div>
        </div>

        <div class="form-grid">
          <div class="field">
            <label>Category</label>
            <select class="select" id="wiCat">
              ${c.categories.map((k) => `<option value="${k.id}">${U.esc(k.name)} (${k.weight}%)</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Points possible</label>
            <input class="input" type="number" id="wiPoints" value="100" min="1" />
          </div>
          <div class="field">
            <label>Score you'd earn</label>
            <input class="input" type="number" id="wiEarned" value="90" min="0" />
          </div>
          <div class="field">
            <label>Target class grade</label>
            <input class="input" type="number" id="wiTarget" value="${current != null ? Math.ceil(current) : 90}" min="0" max="100" />
          </div>
        </div>

        <div class="divider"></div>
        <div class="card" style="background:var(--surface-2)"><div class="card-body">
          <div class="between mb-8">
            <span class="small bold">If you score that</span>
            <span id="wiResult" class="grade-pill">—</span>
          </div>
          <div class="between">
            <span class="small bold">To hit your target you need</span>
            <span id="wiNeeded" class="bold nums">—</span>
          </div>
          <p class="tiny dim mt-8" id="wiNote"></p>
        </div></div>`,
      onMount(root) {
        const recalc = () => {
          const catId = root.querySelector("#wiCat").value;
          const pts = Number(root.querySelector("#wiPoints").value) || 0;
          const earned = Number(root.querySelector("#wiEarned").value) || 0;
          const target = Number(root.querySelector("#wiTarget").value) || 0;

          const projected = simulate(classId, catId, pts, earned);
          const pill = root.querySelector("#wiResult");
          pill.className = "grade-pill " + U.gradeClass(projected);
          pill.textContent = projected != null ? U.round(projected, 1) : "—";

          // Binary-search the score needed to reach the target.
          let lo = 0, hi = pts, need = null;
          for (let i = 0; i < 40; i++) {
            const mid = (lo + hi) / 2;
            if (simulate(classId, catId, pts, mid) >= target) { need = mid; hi = mid; }
            else lo = mid;
          }
          const needEl = root.querySelector("#wiNeeded");
          const note = root.querySelector("#wiNote");
          if (need == null) {
            needEl.textContent = "Not reachable";
            note.textContent = `Even a perfect ${pts}/${pts} wouldn't get you to ${target}% on this assignment alone.`;
          } else {
            needEl.textContent = `${U.round(need, 1)} / ${pts}  (${U.round((need / pts) * 100, 1)}%)`;
            note.textContent = need <= 0
              ? `You're already at or above ${target}% — this assignment can't drop you below it.`
              : `That's a ${U.pctToLetter((need / pts) * 100)} on this assignment.`;
          }
        };
        ["#wiCat", "#wiPoints", "#wiEarned", "#wiTarget"].forEach((sel) => {
          root.querySelector(sel).addEventListener("input", recalc);
          root.querySelector(sel).addEventListener("change", recalc);
        });
        recalc();
      }
    });
  }

  // Recompute a class average as if one extra graded item existed.
  function simulate(classId, catId, points, earned) {
    const c = S.cls(classId);
    const graded = S.assignmentsFor(classId).filter((a) => a.graded && a.earned != null && a.points > 0);
    const rows = graded.concat([{ categoryId: catId, points, earned, graded: true }]);

    const buckets = new Map();
    rows.forEach((a) => {
      const k = a.categoryId || "_";
      if (!buckets.has(k)) buckets.set(k, { e: 0, p: 0 });
      const b = buckets.get(k);
      b.e += a.earned; b.p += a.points;
    });

    let weighted = 0, used = 0;
    c.categories.forEach((cat) => {
      const b = buckets.get(cat.id);
      if (!b || !b.p) return;
      weighted += (b.e / b.p) * cat.weight;
      used += cat.weight;
    });
    if (!used) {
      const e = U.sum(rows, (a) => a.earned), p = U.sum(rows, (a) => a.points);
      return p ? (e / p) * 100 : null;
    }
    return (weighted / used) * 100;
  }

  /* ------------------------------------------------------- score entry -- */

  function scoreEntry(a) {
    UI.modal({
      title: "Enter score",
      sub: a.title,
      okLabel: "Save score",
      body: `<div class="form-grid">
        <div class="field">
          <label>Points earned</label>
          <input class="input" type="number" name="earned" step="0.5" min="0"
                 value="${a.earned != null ? a.earned : ""}" placeholder="—" autofocus />
        </div>
        <div class="field">
          <label>Out of</label>
          <input class="input" type="number" name="points" min="0" value="${a.points}" />
        </div>
      </div>
      <p class="hint mt-8">Leave "points earned" blank to mark this as ungraded again.</p>`,
      onSubmit(d) {
        const earned = d.earned === null || d.earned === "" ? null : Number(d.earned);
        S.update("assignments", a.id, {
          earned, points: Number(d.points) || 0, graded: earned != null,
          status: earned != null ? "done" : a.status
        });
        UI.toast("Score saved", `${a.title} · ${earned != null ? earned + "/" + d.points : "ungraded"}`, "ok");
      }
    });
  }

  /* ------------------------------------------------------------ render -- */

  function render() {
    const classes = S.db.classes;
    const rows = classes.map((c) => ({ c, pct: S.classGrade(c.id) }));
    const gradedRows = rows.filter((r) => r.pct != null);
    const g = S.gpa();
    const gWeighted = S.gpa(true);
    const trend = S.gradeTrend(selected);
    const recent = U.sortBy(S.db.assignments.filter((a) => a.graded && a.earned != null), (a) => a.due, true).slice(0, 10);

    const best = gradedRows.length ? U.sortBy(gradedRows, (r) => -r.pct)[0] : null;
    const worst = gradedRows.length ? U.sortBy(gradedRows, (r) => r.pct)[0] : null;

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>Grade book</h1>
          <div class="sub">${U.plural(gradedRows.length, "class", "classes")} with grades ·
            ${U.plural(S.db.assignments.filter((a) => a.graded).length, "scored item")}</div>
        </div>
        <div class="page-actions">
          <button class="btn" data-toggle-weight>
            ${S.settings.gpaWeighted ? "Weighted" : "Unweighted"} scale
          </button>
        </div>
      </div>

      <div class="grid g-4 mb-16">
        <div class="stat accent">
          <div class="stat-ico">🎓</div>
          <div class="stat-label">${S.settings.gpaWeighted ? "Weighted" : "Unweighted"} GPA</div>
          <div class="stat-value">${U.round(S.settings.gpaWeighted ? gWeighted : g, 2)}</div>
          <div class="stat-foot">${S.settings.gpaWeighted ? `Unweighted: ${U.round(g, 2)}` : `Weighted: ${U.round(gWeighted, 2)}`}</div>
        </div>
        <div class="stat">
          <div class="stat-ico">📈</div>
          <div class="stat-label">Overall average</div>
          <div class="stat-value">${gradedRows.length ? U.round(U.avg(gradedRows, (r) => r.pct), 1) + "%" : "—"}</div>
          <div class="stat-foot">Across all graded classes</div>
        </div>
        <div class="stat">
          <div class="stat-ico">🏆</div>
          <div class="stat-label">Strongest</div>
          <div class="stat-value" style="font-size:1.05rem;margin-top:9px">${best ? U.esc(best.c.name) : "—"}</div>
          <div class="stat-foot">${best ? U.round(best.pct, 1) + "% · " + U.pctToLetter(best.pct) : "No grades yet"}</div>
        </div>
        <div class="stat">
          <div class="stat-ico">🎯</div>
          <div class="stat-label">Needs attention</div>
          <div class="stat-value" style="font-size:1.05rem;margin-top:9px">${worst ? U.esc(worst.c.name) : "—"}</div>
          <div class="stat-foot">${worst ? U.round(worst.pct, 1) + "% · " + U.pctToLetter(worst.pct) : "No grades yet"}</div>
        </div>
      </div>

      <div class="grid g-main mb-16">
        <div class="card">
          <div class="card-head">
            <div>
              <h3>Grade trend</h3>
              <div class="sub">Cumulative average after each graded item</div>
            </div>
            <select class="select input-sm" id="trendCls" style="max-width:180px">
              <option value="">All classes</option>${UI.classOptions(selected)}
            </select>
          </div>
          <div class="card-body">${C.line(trend, { h: 220 })}</div>
        </div>

        <div class="card">
          <div class="card-head"><h3>Class averages</h3></div>
          <div class="card-body">
            ${gradedRows.length
              ? C.hbars(U.sortBy(gradedRows, (r) => -r.pct).map(({ c, pct }) => ({
                  label: c.name, value: U.round(pct, 1), color: c.color
                })), { max: 100, fmt: (v) => `${v}% · ${U.pctToLetter(v)}` })
              : `<p class="dim small">No grades recorded yet.</p>`}
          </div>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-head"><h3>By class</h3><span class="sub">Weighted by grading category</span></div>
        <div class="table-wrap"><table class="table">
          <thead><tr>
            <th>Class</th><th>Teacher</th><th class="right">Graded</th>
            <th class="right">Average</th><th class="right">Letter</th><th class="right">GPA pts</th><th></th>
          </tr></thead>
          <tbody>${classes.map((c) => {
            const pct = S.classGrade(c.id);
            const t = S.teacher(c.teacherId);
            const n = S.assignmentsFor(c.id).filter((a) => a.graded).length;
            return `<tr>
              <td><span class="row gap-8">
                <i class="dot-badge" style="background:${U.esc(c.color)}"></i>
                <span><div class="bold">${U.esc(c.name)}</div>
                <div class="tiny dim">${U.esc(c.code || "")}</div></span>
              </span></td>
              <td class="small muted">${U.esc(t ? t.name : "—")}</td>
              <td class="right nums">${n}</td>
              <td class="right">${UI.gradePill(pct)}</td>
              <td class="right bold">${pct != null ? U.pctToLetter(pct) : "—"}</td>
              <td class="right nums">${pct != null ? U.round(U.pctToGpa(pct), 1) : "—"}</td>
              <td class="right"><button class="btn btn-sm" data-whatif="${c.id}">What-if</button></td>
            </tr>`;
          }).join("")}</tbody>
        </table></div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>Recently scored</h3>
          <button class="btn btn-sm" data-go="homework">All assignments</button>
        </div>
        ${recent.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Assignment</th><th>Class</th><th>Date</th><th class="right">Score</th><th class="right">%</th><th></th></tr></thead>
          <tbody>${recent.map((a) => {
            const c = S.cls(a.classId);
            const p = a.points ? (a.earned / a.points) * 100 : null;
            return `<tr>
              <td><div class="bold">${U.esc(a.title)}</div><div class="tiny dim">${U.esc(a.type)}</div></td>
              <td class="small muted"><span class="row gap-6">
                <i class="dot-badge" style="background:${U.esc(c ? c.color : "#888")}"></i>${U.esc(c ? c.name : "—")}</span></td>
              <td class="small muted nowrap">${U.esc(U.fmtDate(a.due))}</td>
              <td class="right nums">${a.earned}/${a.points}</td>
              <td class="right">${UI.gradePill(p)}</td>
              <td class="right"><button class="btn btn-sm" data-score="${a.id}">Edit</button></td>
            </tr>`;
          }).join("")}</tbody></table></div>`
          : UI.emptyState("📝", "No scores yet", "Add a score to an assignment to start tracking your grade.")}
      </div>

      <div class="card mt-16">
        <div class="card-head"><h3>Waiting on a score</h3><span class="sub">Completed but not yet graded</span></div>
        ${(() => {
          const ungraded = S.db.assignments.filter((a) => a.status === "done" && !a.graded);
          if (!ungraded.length) return `<div class="card-body"><p class="dim small">Nothing pending. 🎉</p></div>`;
          return `<div class="list">${ungraded.map((a) => {
            const c = S.cls(a.classId);
            return `<div class="list-item">
              <i class="dot-badge" style="background:${U.esc(c ? c.color : "#888")}"></i>
              <span class="grow"><div class="title">${U.esc(a.title)}</div>
                <div class="meta">${U.esc(c ? c.name : "—")} · ${a.points} pts · turned in ${U.esc(U.relDate(a.due))}</div></span>
              <button class="btn btn-sm btn-primary" data-score="${a.id}">Enter score</button>
            </div>`;
          }).join("")}</div>`;
        })()}
      </div>
    </div>`;
  }

  function mount(root) {
    U.on(root, "click", "[data-whatif]", (_e, el) => whatIf(el.dataset.whatif));
    U.on(root, "click", "[data-score]", (_e, el) => scoreEntry(S.byId("assignments", el.dataset.score)));
    U.on(root, "click", "[data-toggle-weight]", () => {
      S.commit((db) => { db.settings.gpaWeighted = !db.settings.gpaWeighted; });
      UI.toast("GPA scale changed", S.settings.gpaWeighted ? "Weighted (AP/Honors +1.0)" : "Unweighted 4.0");
    });
    const sel = root.querySelector("#trendCls");
    if (sel) sel.addEventListener("change", (e) => { selected = e.target.value || null; App.router.refresh(); });
  }

  return { render, mount, whatIf, title: "Grades" };
})();
