/* ==========================================================================
   views/grades.js — grade book, GPA, and the what-if simulator
   ========================================================================== */

App.views.grades = (function () {
  /**
   * An optional number field: null when the user left it blank.
   *
   * The call sites here tested only `d.x === ""`, but ui.js already turns an
   * empty <input type="number"> into null before the handler sees it — so the
   * test never matched and Number(null) wrote 0. Leaving "Actual score" blank
   * therefore recorded a real zero: the row rendered "Actual 0", and because
   * the Edit affordance is gated on `actualScore != null`, it disappeared for
   * good with no way to correct the entry.
   */
  function optNum(v) {
    if (v === "" || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  const U = App.utils, S = App.store, UI = App.ui, C = App.charts;

  let selected = null;      // classId for the trend chart, null = all
  let trendZoom = null;     // U35 — {start, end} ISO dates from a drag-select
  let colPickerOpen = false;   // U31 — configurable columns on "Recently scored"

  // U31 — which columns show and what the table's sorted by, persisted so
  // it sticks across visits.
  function recentTableConfig() {
    const cfg = S.settings.gradesTable || {};
    return {
      cols: Object.assign({ cls: true, due: true, score: true, pct: true }, cfg.cols),
      sortKey: cfg.sortKey || "due",
      sortDir: cfg.sortDir || "desc"
    };
  }
  function saveRecentTableConfig(cfg) {
    S.commit((db) => { db.settings.gradesTable = cfg; });
  }

  const RECENT_COL_DEFS = [
    { key: "title", label: "Assignment", always: true },
    { key: "cls",   label: "Class" },
    { key: "due",   label: "Date" },
    { key: "score", label: "Score" },
    { key: "pct",   label: "%" }
  ];
  const RECENT_SORTERS = {
    title: (a) => a.title,
    cls: (a) => S.className(a.classId),
    due: (a) => a.due,
    score: (a) => (a.points ? a.earned / a.points : 0),
    pct: (a) => (a.points ? a.earned / a.points : 0)
  };

  function recentTableHead(cfg) {
    return RECENT_COL_DEFS.filter((d) => d.always || cfg.cols[d.key]).map((d) => {
      const active = cfg.sortKey === d.key;
      return `<th class="${d.key !== "title" ? "right" : ""} sortable" data-sort-col="${d.key}">
        ${U.esc(d.label)}${active ? (cfg.sortDir === "desc" ? " ▾" : " ▴") : ""}
      </th>`;
    }).join("") + `<th></th>`;
  }

  function recentTableRow(a, cfg) {
    const c = S.cls(a.classId);
    // Defence in depth. migrate() coerces scores at the store boundary, so a
    // real import or sync can no longer carry NaN, Infinity or "abc" — but a
    // score cell is not the place to find out something upstream slipped, and
    // "Infinity/Infinity · NaN%" is precisely what a tester screenshots.
    const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
    const pts = num(a.points), earned = num(a.earned);
    const p = pts && earned != null ? (earned / pts) * 100 : null;
    const scoreCell = pts == null && earned == null
      ? "—"
      : `${earned == null ? "—" : U.esc(U.round(earned, 2))}/${pts == null ? "—" : U.esc(U.round(pts, 2))}`;
    return `<tr>
      <td><div class="bold">${U.esc(a.title)}</div><div class="tiny dim">${U.esc(a.type)}</div></td>
      ${cfg.cols.cls ? `<td class="small muted"><span class="row gap-6">
        <i class="dot-badge" style="background:${U.esc(c ? c.color : "#888")}"></i>${U.esc(c ? c.name : "—")}</span></td>` : ""}
      ${cfg.cols.due ? `<td class="small muted nowrap">${U.esc(U.fmtDate(a.due))}</td>` : ""}
      ${cfg.cols.score ? `<td class="right nums">${scoreCell}</td>` : ""}
      ${cfg.cols.pct ? `<td class="right">${UI.gradePill(Number.isFinite(p) ? p : null)}</td>` : ""}
      <td class="right"><button class="btn btn-sm" data-score="${a.id}">Edit</button></td>
    </tr>`;
  }

  /* ------------------------------------------------------ target planner */

  /**
   * "What do I need on everything that's left?" — the forward-looking
   * counterpart to the per-assignment what-if.
   */
  function targetPlanner(classId) {
    const c = S.cls(classId);
    if (!c) return;
    const current = S.classGrade(classId);
    const remaining = S.assignmentsFor(classId).filter((a) => !a.graded && a.points > 0);
    const remainingPts = U.sum(remaining, (a) => a.points);
    const forecast = S.gradeForecast(classId);

    const targets = [
      { label: "A (93)", value: 93 }, { label: "A− (90)", value: 90 },
      { label: "B+ (87)", value: 87 }, { label: "B (83)", value: 83 }
    ];

    UI.modal({
      title: "What do I need?",
      sub: c.name,
      size: "wide",
      footer: `<button type="button" class="btn btn-primary" data-close>Close</button>`,
      body: `
        <div class="row gap-16 wrap mb-16">
          <div><div class="tiny dim">Current</div>${UI.gradePill(current, true)}</div>
          <div class="vdiv"></div>
          <div><div class="tiny dim">Work left</div>
            <div class="bold">${U.plural(remaining.length, "assignment")}</div>
            <div class="tiny dim">${remainingPts} points</div></div>
          ${forecast ? `<div class="vdiv"></div>
            <div><div class="tiny dim">Projected at term end</div>
              <div class="bold">${U.round(forecast.projected, 1)}% ± ${U.round(forecast.band, 1)}</div>
              <div class="tiny dim">${forecast.slopePerWeek >= 0 ? "▲" : "▼"}
                ${U.round(Math.abs(forecast.slopePerWeek), 2)} pts/week</div></div>` : ""}
        </div>

        ${!remaining.length ? `<p class="small muted">No ungraded work left in this class — the grade is what it is.</p>` : `
          <h4 class="mb-8">To finish with…</h4>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Target grade</th><th class="right">Average needed on remaining work</th><th class="right">Verdict</th></tr></thead>
            <tbody>${targets.map((t) => {
              const need = S.neededOnRemaining(classId, t.value);
              const impossible = need == null;
              const easy = !impossible && need <= 0;
              return `<tr>
                <td class="bold">${t.label}</td>
                <td class="right">${impossible ? `<span class="dim">Not reachable</span>`
                  : easy ? `<span style="color:var(--ok)">Already secured</span>`
                  : `<span class="nums bold">${U.round(need, 1)}%</span>
                     <span class="dim small">(${U.pctToLetter(need)})</span>`}</td>
                <td class="right">${impossible ? `<span class="badge danger">Out of reach</span>`
                  : easy ? `<span class="badge ok">Locked in</span>`
                  : need > 100 ? `<span class="badge danger">Needs extra credit</span>`
                  : need > 95 ? `<span class="badge warn">Very tight</span>`
                  : need > 85 ? `<span class="badge info">Doable</span>`
                  : `<span class="badge ok">Comfortable</span>`}</td>
              </tr>`;
            }).join("")}</tbody>
          </table></div>

          <div class="divider"></div>
          <h4 class="mb-8">Remaining work</h4>
          <div class="list" style="border:1px solid var(--border);border-radius:var(--radius)">
            ${U.sortBy(remaining, (a) => a.due).map((a) => `<div class="list-item">
              <span class="grow"><div class="title">${U.esc(a.title)}</div>
                <div class="meta">${U.esc(a.type)} · ${a.points} pts</div></span>
              ${UI.dueBadge(a.due)}
            </div>`).join("")}
          </div>`}`
    });
  }

  /* ------------------------------------------------------- grade rules -- */

  function rulesForm(classId) {
    const c = S.cls(classId);
    if (!c) return;
    const rules = c.rules || { dropLowest: {}, curve: 0, catFloor: {}, catCap: {} };

    UI.modal({
      title: "Grading rules",
      sub: c.name,
      size: "wide",
      okLabel: "Save rules",
      body: `
        <h4 class="mb-8">Grading mode</h4>
        <div class="form-grid mb-12">
          <div class="field">
            <label>Mode</label>
            <select class="select" name="gradingMode">
              <option value="percentage" ${c.gradingMode !== "standards" ? "selected" : ""}>Percentage</option>
              <option value="standards" ${c.gradingMode === "standards" ? "selected" : ""}>Standards-based (1–4)</option>
            </select>
          </div>
          <div class="field">
            <label>Standards scale top</label>
            <input class="input" type="number" name="standardsScale" min="2" max="10" value="${c.standardsScale || 4}" />
          </div>
          <div class="field">
            <label>Class average % <span class="hint">from a teacher-announced average</span></label>
            <input class="input" type="number" name="percentileInput" min="0" max="100" step="0.1"
                   value="${c.percentileInput != null ? c.percentileInput : ""}" placeholder="e.g. 84.2" />
          </div>
          <div class="field">
            <label>Semester exam weight <span class="hint">% of final from "Final"/"Semester exam" items</span></label>
            <input class="input" type="number" name="examWeight" min="0" max="100" value="${c.examWeight || 0}" />
          </div>
        </div>
        <div class="row gap-16 wrap mb-16">
          <label class="row gap-6 small"><input type="checkbox" class="check" name="passFail" ${c.passFail ? "checked" : ""} /> Pass/fail — excluded from GPA</label>
          <label class="row gap-6 small"><input type="checkbox" class="check" name="auditOnly" ${c.auditOnly ? "checked" : ""} /> Audit only — no grade, no GPA</label>
        </div>

        <div class="divider"></div>
        <h4 class="mb-8">Late penalty</h4>
        <div class="form-grid mb-12">
          <div class="field"><label>% off per day late</label>
            <input class="input" type="number" name="latePerDay" min="0" max="100" value="${c.latePenalty ? c.latePenalty.perDay : ""}" placeholder="e.g. 10" /></div>
          <div class="field"><label>Max % off</label>
            <input class="input" type="number" name="lateMax" min="0" max="100" value="${c.latePenalty ? c.latePenalty.max : ""}" placeholder="e.g. 50" /></div>
        </div>

        <div class="divider"></div>
        <h4 class="mb-8">Drop lowest scores</h4>
        <p class="hint mb-12">Many syllabi drop the lowest quiz or homework. StudyHold applies this before averaging.</p>
        ${(c.categories || []).map((cat) => {
          const n = S.assignmentsFor(classId).filter((a) => a.graded && a.categoryId === cat.id).length;
          return `<div class="between wrap" style="padding:8px 0;border-bottom:1px solid var(--border);gap:8px">
            <div>
              <div class="small bold">${U.esc(cat.name)}</div>
              <div class="tiny dim">${cat.weight}% of grade · ${U.plural(n, "graded item")}</div>
            </div>
            <div class="row gap-8 wrap">
              <select class="select input-sm" data-drop="${cat.id}" style="width:110px" aria-label="Drop lowest scores in ${U.esc(cat.name)}">
                ${[0, 1, 2, 3].map((v) => `<option value="${v}" ${(rules.dropLowest || {})[cat.id] === v || (!((rules.dropLowest || {})[cat.id]) && v === 0) ? "selected" : ""}>
                  ${v === 0 ? "Keep all" : "Drop " + v}</option>`).join("")}
              </select>
              <input class="input input-sm" type="number" min="0" max="100" style="width:80px" data-cat-floor="${cat.id}"
                     value="${rules.catFloor && rules.catFloor[cat.id] != null ? rules.catFloor[cat.id] : ""}" placeholder="Floor %" />
              <input class="input input-sm" type="number" min="0" max="100" style="width:80px" data-cat-cap="${cat.id}"
                     value="${rules.catCap && rules.catCap[cat.id] != null ? rules.catCap[cat.id] : ""}" placeholder="Cap %" />
            </div>
          </div>`;
        }).join("")}

        <div class="divider"></div>
        <div class="field">
          <label>Curve <span class="hint">points added to the final class average</span></label>
          <input class="input" type="number" name="curve" step="0.5" min="-20" max="20" value="${rules.curve || 0}" />
        </div>
        <p class="hint mt-8">Extra credit is handled naturally — give an assignment more earned points than
        it's worth and the category average goes above 100%. Floor/cap clamp what a single category can
        do to the final grade, matching rules like "homework can't drop you below 50% in that bucket."</p>`,
      onSubmit(d, root) {
        const dropLowest = {}, catFloor = {}, catCap = {};
        U.$$("[data-drop]", root).forEach((sel) => {
          const n = Number(sel.value) || 0;
          if (n > 0) dropLowest[sel.dataset.drop] = n;
        });
        U.$$("[data-cat-floor]", root).forEach((inp) => {
          if (inp.value !== "") catFloor[inp.dataset.catFloor] = Number(inp.value);
        });
        U.$$("[data-cat-cap]", root).forEach((inp) => {
          if (inp.value !== "") catCap[inp.dataset.catCap] = Number(inp.value);
        });
        S.update("classes", classId, {
          rules: { dropLowest, curve: Number(d.curve) || 0, catFloor, catCap },
          gradingMode: d.gradingMode, standardsScale: Number(d.standardsScale) || 4,
          percentileInput: optNum(d.percentileInput),   // F006 — class percentile estimate
          examWeight: Number(d.examWeight) || 0,
          passFail: !!d.passFail, auditOnly: !!d.auditOnly,
          latePenalty: optNum(d.latePerDay) == null ? null : { perDay: optNum(d.latePerDay) || 0, max: optNum(d.lateMax) == null ? 100 : optNum(d.lateMax) }
        });
        UI.toast("Rules saved", c.name);
      }
    });
  }

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
            // pts is user input and can legitimately be 0 ("ungraded
            // practice"), which made this render "0 / 0  (NaN%)".
            const pctOfPts = pts > 0 ? (need / pts) * 100 : null;
            needEl.textContent = pctOfPts == null
              ? `${U.round(need, 1)} points`
              : `${U.round(need, 1)} / ${pts}  (${U.round(pctOfPts, 1)}%)`;
            note.textContent = need <= 0
              ? `You're already at or above ${target}% — this assignment can't drop you below it.`
              : pctOfPts == null
                ? "Give the assignment a points value to see this as a percentage."
                : `That's a ${U.pctToLetter(pctOfPts)} on this assignment.`;
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
    const c = S.cls(a.classId);
    const standards = c && c.gradingMode === "standards";
    const history = S.gradeHistoryFor(a.id);
    const regrades = S.regradesFor(a.id);

    UI.modal({
      title: "Enter score",
      sub: a.title,
      size: history.length || regrades.length ? "wide" : undefined,
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
        ${standards ? `<div class="field">
          <label>Standards score (1–${c.standardsScale})</label>
          <input class="input" type="number" name="standardsScore" min="1" max="${c.standardsScale}" step="1"
                 value="${a.standardsScore != null ? a.standardsScore : ""}" />
        </div>` : ""}
      </div>
      <p class="hint mt-8">Leave "points earned" blank to mark this as ungraded again.</p>

      ${a.graded ? `<div class="row gap-8 mt-12">
        <button type="button" class="btn btn-sm" data-req-regrade>Request regrade</button>
      </div>` : ""}

      ${history.length ? `<div class="divider"></div>
        <h4 class="mb-8">Change history</h4>
        <div class="list" style="border:1px solid var(--border);border-radius:var(--radius)">
          ${history.map((h) => `<div class="list-item">
            <span class="grow small">${U.esc(h.field)}: ${h.from == null ? "—" : U.esc(String(h.from))} → ${h.to == null ? "—" : U.esc(String(h.to))}</span>
            <span class="tiny dim">${U.esc(U.fmtDate(U.dateKey(new Date(h.at))))}</span>
          </div>`).join("")}
        </div>` : ""}

      ${regrades.length ? `<div class="divider"></div>
        <h4 class="mb-8">Regrade requests</h4>
        <div class="list" style="border:1px solid var(--border);border-radius:var(--radius)">
          ${regrades.map((r) => `<div class="list-item">
            <span class="grow small">${U.esc(r.reason)}</span>
            <span class="badge ${r.outcome ? "ok" : "warn"}">${r.outcome ? U.esc(r.outcome) : "Pending"}</span>
          </div>`).join("")}
        </div>` : ""}`,
      onMount(root) {
        const btn = root.querySelector("[data-req-regrade]");
        if (btn) btn.addEventListener("click", () => {
          UI.prompt({
            title: "Request a regrade",
            label: "What are you asking the teacher to look at?",
            placeholder: "e.g. Question 4 was marked wrong but matches the rubric",
            onSubmit(reason) {
              S.requestRegrade(a.id, reason);
              UI.toast("Regrade requested", a.title, "ok");
              UI.closeModal();
              setTimeout(() => scoreEntry(S.byId("assignments", a.id)), 0);
            }
          });
        });
      },
      onSubmit(d) {
        const earned = d.earned === null || d.earned === "" ? null : Number(d.earned);
        const points = Number(d.points) || 0;
        if (a.graded && a.earned !== earned) S.logGradeChange(a.id, "earned", a.earned, earned);
        const patch = {
          earned, points, graded: earned != null,
          status: earned != null ? "done" : a.status
        };
        if (standards) patch.standardsScore = d.standardsScore === "" || d.standardsScore == null ? null : Number(d.standardsScore);
        S.update("assignments", a.id, patch);
        UI.toast("Score saved", `${a.title} · ${earned != null ? earned + "/" + points : "ungraded"}`, "ok");
      }
    });
  }

  /* -------------------------------------------------------- F011/F012 --- */

  function examForm(exam) {
    const e = exam || {};
    UI.modal({
      title: exam ? "Edit exam" : "Add AP/IB exam",
      okLabel: "Save",
      body: `<div class="form-grid">
        <div class="field full"><label>Exam name</label>
          <input class="input" name="name" required value="${U.esc(e.name || "")}" placeholder="AP Chemistry" /></div>
        <div class="field"><label>Exam date</label>
          <input class="input" type="date" name="examDate" value="${e.examDate || U.today()}" /></div>
        <div class="field"><label>Predicted score</label>
          <input class="input" type="number" name="predictedScore" min="1" max="5" value="${e.predictedScore != null ? e.predictedScore : ""}" /></div>
        <div class="field"><label>Actual score <span class="hint">once released</span></label>
          <input class="input" type="number" name="actualScore" min="1" max="5" value="${e.actualScore != null ? e.actualScore : ""}" /></div>
      </div>`,
      onSubmit(d) {
        if (!d.name.trim()) return false;
        const patch = {
          name: d.name.trim(), examDate: d.examDate,
          predictedScore: optNum(d.predictedScore),
          actualScore: optNum(d.actualScore)
        };
        if (exam) S.update("apExams", exam.id, patch);
        else S.insert("apExams", patch);
        UI.toast("Exam saved", patch.name, "ok");
      }
    });
  }

  function reqForm() {
    UI.modal({
      title: "Add graduation requirement",
      okLabel: "Add",
      body: `<div class="form-grid">
        <div class="field full"><label>Subject area</label>
          <input class="input" name="subject" required placeholder="Math, Science, English…" /></div>
        <div class="field"><label>Credits required</label>
          <input class="input" type="number" name="creditsNeeded" min="0" step="0.5" value="4" /></div>
      </div>`,
      onSubmit(d) {
        if (!d.subject.trim()) return false;
        S.insert("graduationReqs", { subject: d.subject.trim(), creditsNeeded: Number(d.creditsNeeded) || 0 });
        UI.toast("Requirement added", d.subject);
      }
    });
  }

  function transcriptModal() {
    const rows = S.transcriptRows();
    UI.modal({
      title: "Transcript",
      sub: `${S.profile.name} · Cumulative GPA ${U.round(S.cumulativeGpa().gpa, 2)}`,
      size: "wide",
      footer: `<button type="button" class="btn" data-export-csv>Export CSV</button>
               <button type="button" class="btn" data-print>Print</button>
               <button type="button" class="btn btn-primary" data-close>Close</button>`,
      body: rows.length ? rows.map((r) => `
        <h4 class="mb-8">${U.esc(r.term.name)} <span class="tiny dim">GPA ${r.gpa != null ? U.round(r.gpa, 2) : "—"} · ${r.credits || 0} credits</span></h4>
        <div class="table-wrap mb-16"><table class="table">
          <thead><tr><th>Class</th><th class="right">Credits</th><th class="right">Grade</th></tr></thead>
          <tbody>${r.classes.map((row) => `<tr>
            <td>${U.esc(row.cls.name)}</td>
            <td class="right nums">${row.cls.credits || 1}</td>
            <td class="right">${row.grade ? U.esc(row.grade.label) : "—"}</td>
          </tr>`).join("")}</tbody>
        </table></div>`).join("") : `<p class="dim small">No terms recorded yet.</p>`,
      onMount(root) {
        root.querySelector("[data-export-csv]").addEventListener("click", () => {
          const flat = [];
          rows.forEach((r) => r.classes.forEach((row) => flat.push({ term: r.term.name, cls: row.cls.name, credits: row.cls.credits || 1, grade: row.grade ? row.grade.label : "" })));
          S.exportTableCSV(flat, [
            { label: "Term", key: "term" }, { label: "Class", key: "cls" },
            { label: "Credits", key: "credits" }, { label: "Grade", key: "grade" }
          ], "transcript.csv");
        });
        root.querySelector("[data-print]").addEventListener("click", () => window.print());
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
    let trend = S.gradeTrend(selected);
    if (trendZoom) trend = trend.filter((p) => p.date >= trendZoom.start && p.date <= trendZoom.end);
    const rtCfg = recentTableConfig();
    const recent = U.sortBy(S.db.assignments.filter((a) => a.graded && a.earned != null),
      RECENT_SORTERS[rtCfg.sortKey] || RECENT_SORTERS.due, rtCfg.sortDir === "desc").slice(0, 10);

    const best = gradedRows.length ? U.sortBy(gradedRows, (r) => -r.pct)[0] : null;
    const worst = gradedRows.length ? U.sortBy(gradedRows, (r) => r.pct)[0] : null;

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>${App.i18n.t("grades", "Grades")}</h1>
          <div class="sub">${U.plural(gradedRows.length, "class", "classes")} with grades ·
            ${U.plural(S.db.assignments.filter((a) => a.graded).length, "scored item")}</div>
        </div>
        <div class="page-actions">
          <button class="btn" data-transcript>🎓 Transcript</button>
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
          <div class="stat-ico">📜</div>
          <div class="stat-label">Cumulative GPA</div>
          <div class="stat-value">${U.round(S.cumulativeGpa().gpa, 2)}</div>
          <div class="stat-foot">${S.cumulativeGpa().credits} credits ·
            ${U.plural(S.db.terms.length, "term")}</div>
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
              <div class="sub">Cumulative average after each graded item ·
                ${trendZoom ? "zoomed — drag again, or reset" : "drag to zoom into a range"}</div>
            </div>
            <div class="row gap-8">
              ${trendZoom ? `<button class="btn btn-sm" data-reset-zoom>↺ Reset zoom</button>` : ""}
              <select class="select input-sm" id="trendCls" style="max-width:180px" aria-label="Class shown in the trend chart">
                <option value="">All classes</option>${UI.classOptions(selected)}
              </select>
            </div>
          </div>
          <div class="card-body">${C.line(trend, { h: 220, caption: "Grade trend" + (selected ? " — " + S.className(selected) : "") })}</div>
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
            const gd = S.gradeDisplay(c.id);
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
              <td class="right">${gd.mode === "percentage" ? UI.gradePill(pct) : `<span class="badge">${U.esc(gd.label)}</span>`}</td>
              <td class="right bold">${gd.mode === "percentage" ? (pct != null ? U.pctToLetter(pct) : "—") : gd.label}</td>
              <td class="right nums">${gd.mode === "percentage" && pct != null ? U.round(U.pctToGpa(pct), 1) : "—"}</td>
              <td class="right nowrap">
                <button class="btn btn-sm" data-target="${c.id}">Need</button>
                <button class="btn btn-sm" data-whatif="${c.id}">What-if</button>
                <button class="btn btn-sm" data-rules="${c.id}">Rules</button>
              </td>
            </tr>`;
          }).join("")}</tbody>
        </table></div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>Recently scored</h3>
          <div class="row gap-8">
            <div class="col-picker-wrap">
              <button class="btn btn-sm" data-cols-toggle>⚙ Columns</button>
              <div class="col-picker" ${colPickerOpen ? "" : "hidden"}>
                ${RECENT_COL_DEFS.filter((d) => !d.always).map((d) => `
                  <label class="row gap-6 small"><input type="checkbox" data-col="${d.key}" ${rtCfg.cols[d.key] ? "checked" : ""}/> ${U.esc(d.label)}</label>
                `).join("")}
              </div>
            </div>
            <button class="btn btn-sm" data-go="homework">All assignments</button>
          </div>
        </div>
        ${recent.length ? `<div class="table-wrap"><table class="table">
          <thead><tr>${recentTableHead(rtCfg)}</tr></thead>
          <tbody>${recent.map((a) => recentTableRow(a, rtCfg)).join("")}</tbody></table></div>`
          : UI.emptyState("scores", "No scores yet", "Add a score to an assignment to start tracking your grade.")}
      </div>

      ${(() => {
        const missing = S.missingWork();
        if (!missing.length) return "";
        return `<div class="card mt-16" style="border-left:3px solid var(--danger)">
          <div class="card-head">
            <div><h3>Missing work</h3>
              <div class="sub">Scored zero or marked missing — these hurt the most and are often fixable</div></div>
            <span class="badge danger">${missing.length}</span>
          </div>
          <div class="list">
            ${missing.map((a) => {
              const c = S.cls(a.classId);
              const t = c ? S.teacher(c.teacherId) : null;
              // How much the class average recovers if this gets made up.
              const before = S.classGrade(a.classId);
              // Computed against a copy. This used to write `a.earned = a.points`
              // on the live store record and restore it two lines later, during
              // a render — so any throw in between (a null class, a NaN grade)
              // left the assignment permanently scored full marks, with no
              // commit() to make the corruption visible until some unrelated
              // write flushed it to the server.
              const saved = (() => {
                if (before == null) return 0;
                const after = S.withGradeOverride(
                  { [a.id]: { earned: a.points, graded: true } },
                  () => S.classGrade(a.classId));
                return after != null ? after - before : 0;
              })();
              return `<div class="list-item">
                <i class="dot-badge" style="background:${U.esc(c ? c.color : "#888")}"></i>
                <span class="grow" style="min-width:0">
                  <div class="title truncate">${U.esc(a.title)}</div>
                  <div class="meta">${U.esc(c ? c.name : "—")} · ${a.points} pts ·
                    ${U.esc(U.relDate(a.due))}</div>
                </span>
                ${saved > 0.05 ? `<span class="badge warn">+${U.round(saved, 1)} pts if made up</span>` : ""}
                ${t && t.email ? `<a class="btn btn-sm" href="${makeupMail(t, a, c)}">✉ Ask</a>` : ""}
                <button class="btn btn-sm" data-score="${a.id}">Fix score</button>
              </div>`;
            }).join("")}
          </div>
        </div>`;
      })()}

      <div class="grid g-2 mt-16 mb-16">
        <div class="card">
          <div class="card-head">
            <div><h3>AP / IB exams</h3><div class="sub">Predicted vs. actual scores</div></div>
            <button class="btn btn-sm" data-add-exam>+ Add exam</button>
          </div>
          ${S.db.apExams.length ? `<div class="list">${U.sortBy(S.db.apExams, (e) => e.examDate).map((e) => {
            const days = U.diffDays(e.examDate, U.today());
            return `<div class="list-item">
              <span class="grow"><div class="title">${U.esc(e.name)}</div>
                <div class="meta">${U.esc(U.fmtDate(e.examDate))}${days > 0 ? ` · ${days}d away` : days === 0 ? " · today" : ""}</div></span>
              <span class="badge">Pred. ${e.predictedScore != null ? e.predictedScore : "—"}</span>
              ${e.actualScore != null ? `<span class="badge ok">Actual ${e.actualScore}</span>` : `<button class="btn btn-sm" data-edit-exam="${e.id}">Edit</button>`}
              <button class="icon-btn btn-sm" data-del-exam="${e.id}" aria-label="Remove">✕</button>
            </div>`;
          }).join("")}</div>` : `<div class="card-body"><p class="dim small">No AP/IB exams tracked yet.</p></div>`}
        </div>

        <div class="card">
          <div class="card-head">
            <div><h3>Graduation progress</h3><div class="sub">Credits earned vs. required, by subject</div></div>
            <button class="btn btn-sm" data-add-req>+ Add requirement</button>
          </div>
          ${S.graduationProgress().length ? `<div class="card-body">${S.graduationProgress().map((r) => `
            <div class="mb-12">
              <div class="between small mb-4">
                <span class="bold">${U.esc(r.subject)}</span>
                <span class="dim">${U.round(r.have, 1)} / ${r.creditsNeeded} credits</span>
              </div>
              <div class="bar"><i style="width:${r.pct}%;background:${r.pct >= 100 ? "var(--ok)" : "var(--brand-500)"}"></i></div>
            </div>`).join("")}</div>`
            : `<div class="card-body"><p class="dim small">Add your school's graduation requirements to track progress.</p></div>`}
        </div>
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

  // A ready-to-send note about a zero — the message students most avoid writing.
  function makeupMail(t, a, c) {
    const last = t.name.split(" ").slice(-1)[0];
    // Untrusted address — see U.mailtoHref.
    const subject = `Missing assignment — ${a.title}`;
    const body =
`Hi ${t.name},

I noticed I have a zero for "${a.title}" in ${c ? c.name : "your class"} (due ${U.fmtDate(a.due, "full")}).

I wanted to check whether it's still possible to turn it in or make it up, and what you'd like me to do.

Thank you,
${S.profile.name}`;
    return U.mailtoHref(t.email, subject, body);
  }

  function mount(root) {
    U.on(root, "click", "[data-whatif]", (_e, el) => whatIf(el.dataset.whatif));
    U.on(root, "click", "[data-target]", (_e, el) => targetPlanner(el.dataset.target));
    U.on(root, "click", "[data-rules]", (_e, el) => rulesForm(el.dataset.rules));
    U.on(root, "click", "[data-score]", (_e, el) => scoreEntry(S.byId("assignments", el.dataset.score)));
    U.on(root, "click", "[data-toggle-weight]", () => {
      S.commit((db) => { db.settings.gpaWeighted = !db.settings.gpaWeighted; });
      UI.toast("GPA scale changed", S.settings.gpaWeighted ? "Weighted (AP/Honors +1.0)" : "Unweighted 4.0");
    });
    U.on(root, "click", "[data-transcript]", () => transcriptModal());
    U.on(root, "click", "[data-add-exam]", () => examForm(null));
    U.on(root, "click", "[data-edit-exam]", (_e, el) => examForm(S.byId("apExams", el.dataset.editExam)));
    U.on(root, "click", "[data-del-exam]", (_e, el) => {
      const e = S.byId("apExams", el.dataset.delExam);
      S.commit((db) => { db.apExams = db.apExams.filter((x) => x.id !== e.id); });
      UI.toast("Exam removed", e.name, "warn");
    });
    U.on(root, "click", "[data-add-req]", () => reqForm());
    const sel = root.querySelector("#trendCls");
    if (sel) sel.addEventListener("change", (e) => { selected = e.target.value || null; trendZoom = null; App.router.refresh(); });

    // U34/U35 — hover crosshair + drag-to-zoom on the grade trend chart.
    U.on(root, "click", "[data-reset-zoom]", () => { trendZoom = null; App.router.refresh(); });
    C.bindLineInteraction(root, (start, end) => {
      trendZoom = { start, end };
      App.router.refresh();
    });

    // U31 — configurable columns on the "Recently scored" table.
    U.on(root, "click", "[data-cols-toggle]", (e) => {
      e.stopPropagation();
      colPickerOpen = !colPickerOpen;
      App.router.refresh();
    });
    U.on(root, "change", "[data-col]", (_e, el) => {
      const cfg = recentTableConfig();
      cfg.cols[el.dataset.col] = el.checked;
      saveRecentTableConfig(cfg);
    });
    U.on(root, "click", "[data-sort-col]", (_e, el) => {
      const cfg = recentTableConfig();
      const key = el.dataset.sortCol;
      if (cfg.sortKey === key) cfg.sortDir = cfg.sortDir === "desc" ? "asc" : "desc";
      else { cfg.sortKey = key; cfg.sortDir = "desc"; }
      saveRecentTableConfig(cfg);
    });
    root.addEventListener("click", (e) => {
      if (colPickerOpen && !e.target.closest(".col-picker-wrap")) { colPickerOpen = false; App.router.refresh(); }
    });
  }

  return { render, mount, whatIf, targetPlanner, title: "Grades" };
})();
