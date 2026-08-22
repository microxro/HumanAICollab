/* ==========================================================================
   views/guidance.js — which electives to take, and where they lead

   The engine (js/guidance.js) does all the reasoning; this file only decides
   how to show it. Two rules drive the layout:

   1. **Never assert more than the data supports.** The confidence banner is
      the first thing on the page, not a footnote, and when the profile is
      thin the recommendations render behind a "here's what's missing" panel
      rather than pretending to a verdict.
   2. **Every recommendation shows its working.** Each card lists the actual
      grades, hours and categories that moved it up the ranking. A student
      should be able to disagree with a suggestion for a specific reason,
      which is only possible if the reasons are on the card.
   ========================================================================== */

App.views.guidance = (function () {
  const U = App.utils, S = App.store, UI = App.ui, C = App.charts, G = App.guidance;

  let tab = "advice";     // advice | strengths | evidence

  /* --------------------------------------------------------------- data -- */

  function cfg() {
    const g = S.db.guidance || {};
    return {
      stage: g.stage || "high",
      interests: Array.isArray(g.interests) ? g.interests : [],
      targets: Array.isArray(g.targets) ? g.targets : [],
      dismissed: Array.isArray(g.dismissed) ? g.dismissed : []
    };
  }

  function patch(fn) {
    if (!S.db.guidance || typeof S.db.guidance !== "object") S.db.guidance = {};
    fn(S.db.guidance);
    S.commit();
  }

  /* -------------------------------------------------------------- intake -- */

  function stageBar() {
    const c = cfg();
    return `<div class="segmented" role="group" aria-label="What are you choosing for?">
      ${G.STAGES.map((s) => `<button type="button" class="${s.id === c.stage ? "active" : ""}"
        data-stage="${s.id}" aria-pressed="${s.id === c.stage}">${U.esc(s.label)}</button>`).join("")}
    </div>`;
  }

  function interestsCard() {
    const c = cfg();
    return `<div class="card mb-16">
      <div class="card-head">
        <h2>What are you into?</h2>
        <button type="button" class="btn btn-sm" data-add-interest>+ Add</button>
      </div>
      <div class="card-body">
        <p class="small dim" style="margin-top:0">
          Weighted more heavily than anything read off your gradebook — you telling it
          is better evidence than it guessing. Subjects, hobbies, jobs you're curious about.
        </p>
        ${c.interests.length
          ? `<div class="row wrap gap-6" id="interestChips">
              ${c.interests.map((i, n) => `<span class="chip">
                ${U.esc(i)}
                <button type="button" class="chip-x" data-rm-interest="${n}"
                  aria-label="Remove ${U.esc(i)}">×</button>
              </span>`).join("")}
            </div>`
          : `<p class="small" style="margin-bottom:0">
              <button type="button" class="btn btn-sm btn-primary" data-add-interest>Add your first interest</button>
            </p>`}
      </div>
    </div>`;
  }

  /* ---------------------------------------------------------- confidence -- */

  function confidenceBanner(conf) {
    const tone = conf.level === "good" ? "ok" : conf.level === "fair" ? "warn" : "danger";
    const headline = conf.level === "good"
      ? "There's enough here to say something useful."
      : conf.level === "fair"
        ? "Enough for a first pass — treat this as a direction, not a decision."
        : "Too thin to be trusted yet.";
    const detail = conf.level === "good"
      ? "Still a starting point for a conversation with a counselor, not a substitute for one."
      : `Built from ${conf.have} of ${conf.of} signals. Missing: ${conf.missing.join(", ")}.`;

    return `<div class="callout ${tone} mb-16">
      <div class="row between gap-8 wrap">
        <div style="min-width:0">
          <strong>${U.esc(headline)}</strong>
          <div class="small" style="margin-top:2px">${U.esc(detail)}</div>
        </div>
        <span class="badge ${tone}">${conf.have}/${conf.of} signals</span>
      </div>
    </div>`;
  }

  /* ------------------------------------------------------------- pieces -- */

  const REASON_ICON = {
    grades: "◈", style: "◫", interest: "★", activity: "◇", pathway: "→", caution: "!"
  };

  function reasonList(reasons) {
    if (!reasons || !reasons.length) return "";
    return `<ul class="reasons">
      ${reasons.map((r) => `<li class="${r.kind === "caution" ? "caution" : ""}">
        <span class="r-ico" aria-hidden="true">${REASON_ICON[r.kind] || "·"}</span>
        <span>${U.esc(r.text)}</span>
      </li>`).join("")}
    </ul>`;
  }

  function pathwayCard(p, rank) {
    return `<div class="card guide-card">
      <div class="card-body">
        <div class="row between gap-8 wrap" style="align-items:flex-start">
          <div style="min-width:0;flex:1 1 240px">
            <div class="row gap-8" style="align-items:baseline">
              <span class="rank">${rank}</span>
              <h3 style="margin:0">${U.esc(p.name)}</h3>
            </div>
            <p class="small dim" style="margin:4px 0 0">${U.esc(p.blurb)}</p>
          </div>
          <button type="button" class="btn btn-sm" data-dismiss="pw:${U.esc(p.id)}"
            aria-label="Not interested in ${U.esc(p.name)}">Not for me</button>
        </div>

        ${reasonList(p.reasons)}

        <div class="reality">
          <strong>What people get wrong about it:</strong> ${U.esc(p.reality)}
        </div>

        ${p.electives.length ? `<div class="opens">
          <span class="opens-k">Take these to keep it open</span>
          <div class="row wrap gap-6" style="margin-top:5px">
            ${p.electives.map((e) => `<span class="chip static">${U.esc(e.name)}</span>`).join("")}
          </div>
        </div>` : ""}
      </div>
    </div>`;
  }

  function electiveCard(e, rank) {
    return `<div class="card guide-card">
      <div class="card-body">
        <div class="row between gap-8 wrap" style="align-items:flex-start">
          <div style="min-width:0;flex:1 1 240px">
            <div class="row gap-8" style="align-items:baseline">
              <span class="rank">${rank}</span>
              <h3 style="margin:0">${U.esc(e.name)}</h3>
            </div>
            <p class="small dim" style="margin:4px 0 0">${U.esc(e.why)}</p>
          </div>
          <button type="button" class="btn btn-sm" data-dismiss="el:${U.esc(e.id)}"
            aria-label="Hide ${U.esc(e.name)}">Hide</button>
        </div>

        ${reasonList(e.reasons)}

        ${e.opens.length ? `<div class="opens">
          <span class="opens-k">Opens up</span>
          <div class="row wrap gap-6" style="margin-top:5px">
            ${e.opens.map((o) => `<span class="chip static">${U.esc(o)}</span>`).join("")}
          </div>
        </div>` : ""}
      </div>
    </div>`;
  }

  function gapList(gaps) {
    if (!gaps.length) {
      return `<div class="card"><div class="card-body">
        <p class="small" style="margin:0">Nothing obviously missing from the record. That isn't the
        same as nothing missing from your application — it's the limit of what this can see.</p>
      </div></div>`;
    }
    return `<div class="col gap-8">
      ${gaps.map((g) => `<div class="callout ${g.level === "warn" ? "warn" : "info"}">
        <strong>${U.esc(g.title)}</strong>
        <div class="small" style="margin-top:2px">${U.esc(g.detail)}</div>
      </div>`).join("")}
    </div>`;
  }

  /* --------------------------------------------------------------- tabs -- */

  function adviceTab() {
    const c = cfg();
    const stage = G.STAGES.find((s) => s.id === c.stage) || G.STAGES[1];
    const paths = G.pathways();
    const els = G.electives();
    const gaps = G.gaps();

    // Only fields that actually scored above neutral are worth showing as a
    // recommendation. Ranking fourteen options when eleven are a poor fit
    // turns a recommendation into a directory.
    const shown = paths.filter((p) => p.score > 0).slice(0, 5);
    const rest = paths.filter((p) => p.score > 0).length;

    return `
      <section class="guide-sec">
        <div class="section-head">
          <h2>${c.stage === "college" ? "Majors that fit your record" : "Where your record is pointing"}</h2>
        </div>
        <p class="small dim" style="margin-top:-4px">
          Ranked by how well your own grades, work style, activities and stated interests line up.
          You're choosing ${U.esc(stage.picking)}.
        </p>
        ${shown.length
          ? `<div class="col gap-12">${shown.map((p, i) => pathwayCard(p, i + 1)).join("")}</div>
             ${rest > shown.length ? `<p class="tiny dim" style="margin-top:8px">
               ${rest - shown.length} more scored above neutral but ranked lower.</p>` : ""}`
          : `<div class="card"><div class="card-body">${UI.emptyState("noGrades",
              "Not enough graded work to rank anything",
              "Add a few classes and their grades, and this ranks fields of study against your actual record.")}
             </div></div>`}
      </section>

      <section class="guide-sec">
        <div class="section-head">
          <h2>Electives to pick${c.stage === "college" ? "" : " next"}</h2>
        </div>
        <p class="small dim" style="margin-top:-4px">
          A general catalogue — Scholar has no way to know your school's course list, so treat each
          of these as a question to ask your counselor rather than a course you can definitely take.
        </p>
        ${els.length
          ? `<div class="col gap-12">${els.slice(0, 6).map((e, i) => electiveCard(e, i + 1)).join("")}</div>`
          : `<div class="card"><div class="card-body">
              <p class="small" style="margin:0">Nothing left to suggest for this stage — you've hidden
              them all, or they're already on your timetable.</p>
            </div></div>`}
      </section>

      <section class="guide-sec">
        <div class="section-head"><h2>Gaps worth closing</h2></div>
        ${gapList(gaps)}
      </section>`;
  }

  function strengthsTab() {
    const subjects = G.subjectProfile();
    const style = G.workStyle();

    const rows = subjects.map((s) => ({
      label: s.label,
      value: s.score,
      note: s.reasons.join(" · ")
    }));

    return `
      <section class="guide-sec">
        <div class="section-head"><h2>Subjects, ranked against each other</h2></div>
        <p class="small dim" style="margin-top:-4px">
          Scored <strong>relative to your own average</strong>, not out of 100. An absolute grade
          measures the grader as much as it measures you — comparing your subjects against each
          other is the comparison that survives a hard marker.
        </p>
        <div class="card"><div class="card-body">
          ${rows.length ? C.hbars(rows, { max: 100, fmt: (v) => v.toFixed(0) })
            : UI.emptyState("noGrades", "No graded subjects yet",
                "Once a few classes have grades, they get ranked here.")}
        </div></div>
      </section>

      <section class="guide-sec">
        <div class="section-head"><h2>How you're best assessed</h2></div>
        <p class="small dim" style="margin-top:-4px">
          Your category scores pooled across every class. One class's Projects average is a fact
          about that class; the same gap in five classes is a fact about you.
        </p>
        <div class="card"><div class="card-body">
          ${style.modes.length
            ? `${C.hbars(style.modes.map((m) => ({ label: m.label, value: m.pct, note: `${m.classes} class${m.classes === 1 ? "" : "es"}` })),
                 { max: 100, fmt: (v) => v.toFixed(1) + "%" })}
               ${style.best ? `<p class="small" style="margin:14px 0 0">
                 <strong>${U.esc(style.best.label)}</strong> — ${U.esc(style.best.blurb)}.
                 That's ${style.spread} points above ${U.esc(style.worst.label.toLowerCase())},
                 which is wide enough to be worth choosing courses around.</p>`
               : `<p class="small dim" style="margin:14px 0 0">
                 You score about the same however you're assessed — a ${style.spread}-point spread.
                 That's a genuinely useful thing to know: it means the format of a course shouldn't
                 be what decides it for you.</p>`}`
            : UI.emptyState("scores", "No graded categories yet",
                "Grade a few assignments in different categories and this shows which format suits you.")}
        </div></div>
      </section>`;
  }

  function evidenceTab() {
    const ev = G.evidence();
    const c = ev.counts;
    const acts = ev.activities;

    const row = (k, v, note) => `<tr>
      <td>${U.esc(k)}</td>
      <td class="nums bold">${U.esc(String(v))}</td>
      <td class="small dim">${U.esc(note || "")}</td>
    </tr>`;

    return `
      <section class="guide-sec">
        <div class="section-head"><h2>Everything this used</h2></div>
        <p class="small dim" style="margin-top:-4px">
          No part of this leaves your device, and none of it is sent to an AI service. The ranking
          is arithmetic over the rows below — if a recommendation looks wrong, one of these is why.
        </p>
        <div class="table-wrap card">
          <table>
            <caption class="sr-only">Data points feeding the guidance engine</caption>
            <thead><tr><th>Signal</th><th>Count</th><th>How it's used</th></tr></thead>
            <tbody>
              ${row("Classes", c.classes, "Mapped to subject areas by name and code")}
              ${row("Graded assignments", c.graded, "Subject strength, and the trend across the term")}
              ${row("Study minutes", c.studyMinutes, "Effort against outcome — a cheap A scores higher than an expensive one")}
              ${row("Notes", c.notes, "Voluntary depth in a subject")}
              ${row("Flashcard decks", c.decks, "Voluntary depth in a subject")}
              ${row("Books", c.books, "Interest signal")}
              ${row("Activities", c.activities, "Interest, hours, and leadership roles")}
              ${row("Goals", c.goals, "Stated ambitions, searched for field keywords")}
              ${row("Applications", c.applications, "Target schools and their notes")}
              ${row("Stated interests", cfg().interests.length, "Weighted above everything inferred")}
            </tbody>
          </table>
        </div>
      </section>

      ${acts.length ? `<section class="guide-sec">
        <div class="section-head"><h2>Activities as it reads them</h2></div>
        <div class="table-wrap card">
          <table>
            <thead><tr><th>Activity</th><th>Type</th><th>Hours</th><th>Role</th></tr></thead>
            <tbody>
              ${acts.map((a) => `<tr>
                <td>${U.esc(a.name)}</td>
                <td class="small dim">${U.esc(a.type)}</td>
                <td class="nums">${U.esc(String(a.hours))}</td>
                <td class="small">${a.role ? U.esc(a.role) : "<span class='dim'>—</span>"}
                  ${a.lead ? ` <span class="badge ok">leadership</span>` : ""}</td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </section>` : ""}

      <section class="guide-sec">
        <div class="section-head"><h2>What this can't see</h2></div>
        <div class="card"><div class="card-body">
          <ul style="margin:0">
            <li>Your school's actual course list, prerequisites, and whether any of this fits your timetable.</li>
            <li>Test scores, class rank, and anything a transcript holds that Scholar doesn't.</li>
            <li>Cost, financial aid, and whether a programme is worth its price — the biggest factor in most of these decisions.</li>
            <li>You. A counselor who has met you knows things no gradebook contains, and this is a
                starting point for that conversation rather than a replacement for it.</li>
          </ul>
        </div></div>
      </section>`;
  }

  /* ------------------------------------------------------------- render -- */

  function render() {
    const c = cfg();
    const conf = G.confidence();
    const dismissed = c.dismissed.length;

    const TABS = [
      { id: "advice",    label: "Advice" },
      { id: "strengths", label: "Your profile" },
      { id: "evidence",  label: "What it used" }
    ];

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>${App.i18n.t("guidance", "Guidance")}</h1>
          <div class="sub">Which electives to take, and what they lead to — from your own record</div>
        </div>
        <div class="page-actions">${stageBar()}</div>
      </div>

      ${confidenceBanner(conf)}
      ${interestsCard()}

      <div class="segmented wide mb-16" role="tablist" aria-label="Guidance sections">
        ${TABS.map((t) => `<button type="button" role="tab" class="${t.id === tab ? "active" : ""}"
          data-tab="${t.id}" aria-selected="${t.id === tab}">${U.esc(t.label)}</button>`).join("")}
      </div>

      ${tab === "advice" ? adviceTab() : tab === "strengths" ? strengthsTab() : evidenceTab()}

      ${dismissed ? `<p class="small dim">
        ${dismissed} suggestion${dismissed === 1 ? "" : "s"} hidden.
        <button type="button" class="btn btn-sm" data-unhide>Show them again</button>
      </p>` : ""}
    </div>`;
  }

  /* -------------------------------------------------------------- mount -- */

  function mount(root) {
    U.on(root, "click", "[data-stage]", (_e, el) => {
      patch((g) => { g.stage = el.dataset.stage; });
    });

    U.on(root, "click", "[data-tab]", (_e, el) => {
      tab = el.dataset.tab;
      App.router.refresh();
    });

    U.on(root, "click", "[data-add-interest]", () => {
      UI.prompt({
        title: "Add an interest",
        label: "A subject, hobby, or field you're curious about",
        placeholder: "e.g. marine biology, game design, law",
        okLabel: "Add",
        onSubmit(value) {
          const v = String(value || "").trim().slice(0, 60);
          if (!v) return;
          patch((g) => {
            const list = Array.isArray(g.interests) ? g.interests : (g.interests = []);
            // Case-insensitive, so "Coding" and "coding" don't both sit there
            // double-weighting the same signal.
            if (!list.some((x) => String(x).toLowerCase() === v.toLowerCase())) list.push(v);
          });
          UI.toast("Added", v, "ok");
        }
      });
    });

    U.on(root, "click", "[data-rm-interest]", (_e, el) => {
      const n = Number(el.dataset.rmInterest);
      patch((g) => {
        if (Array.isArray(g.interests)) g.interests.splice(n, 1);
      });
    });

    U.on(root, "click", "[data-dismiss]", (_e, el) => {
      const key = el.dataset.dismiss;
      patch((g) => {
        const list = Array.isArray(g.dismissed) ? g.dismissed : (g.dismissed = []);
        if (!list.includes(key)) list.push(key);
      });
      UI.toast("Hidden", "It won't be suggested again.", "ok", {
        label: "Undo",
        onClick: () => patch((g) => { g.dismissed = (g.dismissed || []).filter((x) => x !== key); })
      });
    });

    U.on(root, "click", "[data-unhide]", () => {
      patch((g) => { g.dismissed = []; });
      UI.toast("Restored", "Hidden suggestions are back.", "ok");
    });
  }

  return { render, mount, title: "Guidance" };
})();
