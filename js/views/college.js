/* ==========================================================================
   views/college.js — college applications, essays, recommendations, scholarships
   ========================================================================== */

App.views.college = (function () {
  const U = App.utils, S = App.store, UI = App.ui, C = App.charts;

  const TYPES = ["ED", "ED II", "EA", "REA", "RD", "Rolling", "Scholarship"];
  const STATUSES = [
    { id: "not-started", label: "Not started", cls: "" },
    { id: "in-progress", label: "In progress", cls: "info" },
    { id: "submitted", label: "Submitted", cls: "brand" },
    { id: "accepted", label: "Accepted", cls: "ok" },
    { id: "waitlisted", label: "Waitlisted", cls: "warn" },
    { id: "rejected", label: "Rejected", cls: "danger" }
  ];
  const ESSAY_STATUS = ["not-started", "draft", "revising", "done"];

  function statusBadge(id) {
    const s = STATUSES.find((x) => x.id === id) || STATUSES[0];
    return `<span class="badge ${s.cls}">${s.label}</span>`;
  }

  /* -------------------------------------------------------------- forms */

  function form(app) {
    const a = app || {};
    UI.modal({
      title: app ? "Edit application" : "Add a school or scholarship",
      size: "wide",
      okLabel: app ? "Save" : "Add",
      footer: app ? `<button type="button" class="btn btn-danger left" data-del>Delete</button>
                     <button type="button" class="btn" data-close>Cancel</button>
                     <button type="submit" class="btn btn-primary">Save</button>` : undefined,
      body: `<div class="form-grid">
        <div class="field full"><label>School / scholarship</label>
          <input class="input" name="school" required value="${U.esc(a.school || "")}" placeholder="State University" /></div>
        <div class="field"><label>Type</label>
          <select class="select" name="type">
            ${TYPES.map((t) => `<option ${t === (a.type || "RD") ? "selected" : ""}>${t}</option>`).join("")}
          </select></div>
        <div class="field"><label>Deadline</label>
          <input class="input" type="date" name="deadline" value="${a.deadline || U.dateKey(U.addDays(new Date(), 60))}" /></div>
        <div class="field"><label>Status</label>
          <select class="select" name="status">
            ${STATUSES.map((s) => `<option value="${s.id}" ${s.id === (a.status || "not-started") ? "selected" : ""}>${s.label}</option>`).join("")}
          </select></div>
        <div class="field"><label>Application fee ($)</label>
          <input class="input" type="number" name="fee" min="0" value="${a.fee != null ? a.fee : 0}" /></div>
        <div class="field"><label>Award amount ($) <span class="hint">scholarships</span></label>
          <input class="input" type="number" name="amount" min="0" value="${a.amount != null ? a.amount : ""}" /></div>
        <div class="field"><label>Portal URL</label>
          <input class="input" name="portal" value="${U.esc(a.portal || "")}" placeholder="https://apply..." /></div>
        <div class="field full"><label>Notes</label>
          <textarea class="textarea" name="notes" rows="2" placeholder="Requirements, supplements, interview…">${U.esc(a.notes || "")}</textarea></div>
      </div>`,
      onMount(root) {
        const del = root.querySelector("[data-del]");
        if (del) del.addEventListener("click", () => {
          UI.closeModal();
          UI.deleteWithUndo("collegeApps", app.id, app.school);
        });
      },
      onSubmit(d) {
        if (!d.school.trim()) return false;
        const patch = {
          school: d.school.trim(), type: d.type, deadline: d.deadline, status: d.status,
          fee: Number(d.fee) || 0,
          amount: d.amount === "" || d.amount == null ? null : Number(d.amount),
          portal: d.portal.trim(), notes: d.notes.trim()
        };
        if (app) { S.update("collegeApps", app.id, patch); UI.toast("Application updated", patch.school); }
        else { S.insert("collegeApps", Object.assign({ essays: [], recs: [] }, patch)); UI.toast("Added", patch.school, "ok"); }
      }
    });
  }

  function detail(id) {
    const a = S.byId("collegeApps", id);
    if (!a) return;
    const days = U.diffDays(a.deadline, U.today());
    const essaysDone = (a.essays || []).filter((e) => e.status === "done").length;
    const recsIn = (a.recs || []).filter((r) => r.received).length;

    UI.modal({
      title: a.school,
      sub: `${a.type} · due ${U.fmtDate(a.deadline, "full")}`,
      size: "wide",
      footer: `<button type="button" class="btn left" data-edit>Edit</button>
               <button type="button" class="btn" data-add-essay>+ Essay</button>
               <button type="button" class="btn" data-add-rec>+ Recommendation</button>
               <button type="button" class="btn btn-primary" data-close>Done</button>`,
      body: `
        <div class="row gap-16 wrap mb-16">
          ${statusBadge(a.status)}
          <span class="badge ${days < 0 ? "danger" : days < 14 ? "warn" : ""}">
            ${days < 0 ? "Deadline passed" : days === 0 ? "Due today" : `${days} days left`}
          </span>
          ${a.amount ? `<span class="badge ok">$${a.amount.toLocaleString()} award</span>` : ""}
          ${a.fee ? `<span class="badge">$${a.fee} fee</span>` : ""}
          ${a.portal ? `<a class="badge brand" href="${U.esc(U.safeUrl(a.portal))}" target="_blank" rel="noopener">Open portal ↗</a>` : ""}
        </div>

        ${a.notes ? `<div class="card" style="background:var(--surface-2)"><div class="card-body">
          <div class="tiny dim mb-4">Notes</div>
          <div class="small" style="white-space:pre-wrap">${U.esc(a.notes)}</div>
        </div></div><div class="divider"></div>` : ""}

        <div class="between mb-8">
          <h4>Essays</h4><span class="small dim">${essaysDone}/${(a.essays || []).length} done</span>
        </div>
        ${(a.essays || []).length ? `<div class="list" style="border:1px solid var(--border);border-radius:var(--radius)">
          ${a.essays.map((e) => `<div class="list-item">
            <span class="grow" style="min-width:0">
              <div class="title">${U.esc(e.prompt)}</div>
              <div class="meta">${e.words ? e.words + " words" : ""}</div>
            </span>
            <select class="select input-sm" data-essay="${e.id}" style="width:130px">
              ${ESSAY_STATUS.map((s) => `<option value="${s}" ${s === e.status ? "selected" : ""}>${U.titleCase(s.replace("-", " "))}</option>`).join("")}
            </select>
            <button class="icon-btn btn-sm" data-rm-essay="${e.id}" aria-label="Remove">✕</button>
          </div>`).join("")}</div>` : `<p class="dim small">No essays added yet.</p>`}

        <div class="divider"></div>
        <div class="between mb-8">
          <h4>Recommendations</h4><span class="small dim">${recsIn}/${(a.recs || []).length} received</span>
        </div>
        ${(a.recs || []).length ? `<div class="list" style="border:1px solid var(--border);border-radius:var(--radius)">
          ${a.recs.map((r) => {
            const t = S.teacher(r.teacherId);
            return `<div class="list-item">
              ${UI.avatar(t ? t.name : "?", "#64748b", "sm")}
              <span class="grow"><div class="title">${U.esc(t ? t.name : "Unknown")}</div>
                <div class="meta">${U.esc(t ? t.subject : "")}</div></span>
              <label class="row gap-6 small"><input type="checkbox" class="check" data-rec-req="${r.id}" ${r.requested ? "checked" : ""} /> Asked</label>
              <label class="row gap-6 small"><input type="checkbox" class="check" data-rec-got="${r.id}" ${r.received ? "checked" : ""} /> Received</label>
              ${t && t.email && !r.requested ? `<a class="btn btn-sm" href="${recMail(t, a)}">✉ Ask</a>` : ""}
              <button class="icon-btn btn-sm" data-rm-rec="${r.id}" aria-label="Remove">✕</button>
            </div>`;
          }).join("")}</div>` : `<p class="dim small">No recommenders added yet.</p>`}`,
      onMount(root) {
        root.querySelector("[data-edit]").addEventListener("click", () => { UI.closeModal(); form(a); });
        root.querySelector("[data-add-essay]").addEventListener("click", () => { UI.closeModal(); essayForm(a.id); });
        root.querySelector("[data-add-rec]").addEventListener("click", () => { UI.closeModal(); recForm(a.id); });

        U.on(root, "change", "[data-essay]", (_e, el) => {
          const e = a.essays.find((x) => x.id === el.dataset.essay);
          if (e) { e.status = el.value; S.commit(); }
        });
        U.on(root, "click", "[data-rm-essay]", (_e, el) => {
          a.essays = a.essays.filter((x) => x.id !== el.dataset.rmEssay);
          S.commit(); UI.closeModal(); detail(a.id);
        });
        U.on(root, "change", "[data-rec-req]", (_e, el) => {
          const r = a.recs.find((x) => x.id === el.dataset.recReq);
          if (r) { r.requested = el.checked; S.commit(); }
        });
        U.on(root, "change", "[data-rec-got]", (_e, el) => {
          const r = a.recs.find((x) => x.id === el.dataset.recGot);
          if (r) { r.received = el.checked; S.commit(); }
        });
        U.on(root, "click", "[data-rm-rec]", (_e, el) => {
          a.recs = a.recs.filter((x) => x.id !== el.dataset.rmRec);
          S.commit(); UI.closeModal(); detail(a.id);
        });
      }
    });
  }

  // Pre-written recommendation request — the hardest email to start.
  function recMail(t, app) {
    const last = t.name.split(" ").slice(-1)[0];
    // Untrusted address — see U.mailtoHref. Subject and body are encoded there.
    const subject = `Letter of recommendation request — ${S.profile.name}`;
    const body =
`Dear ${t.name},

I'm applying to ${app.school} (deadline ${U.fmtDate(app.deadline, "full")}), and I was hoping you might be willing to write me a letter of recommendation.

I really valued ${t.subject || "your class"} — I'd be glad to send over my resume, a draft of my personal statement, and a reminder of the work I did in your class if that would help.

Please let me know if you have the time, and thank you either way.

Best,
${S.profile.name}
${S.profile.grade || ""}${S.profile.school ? " · " + S.profile.school : ""}`;
    return U.mailtoHref(t.email, subject, body);
  }

  function essayForm(appId) {
    UI.modal({
      title: "Add an essay",
      okLabel: "Add",
      body: `<div class="field mb-12"><label>Prompt</label>
          <textarea class="textarea" name="prompt" rows="3" required placeholder="Why do you want to attend…"></textarea></div>
        <div class="field"><label>Word limit</label>
          <input class="input" type="number" name="words" min="0" value="500" /></div>`,
      onSubmit(d) {
        if (!d.prompt.trim()) return false;
        const a = S.byId("collegeApps", appId);
        a.essays = (a.essays || []).concat([{ id: U.uid("e"), prompt: d.prompt.trim(), words: Number(d.words) || 0, status: "not-started" }]);
        S.commit();
        UI.toast("Essay added");
        detail(appId);
      }
    });
  }

  function recForm(appId) {
    UI.modal({
      title: "Request a recommendation",
      okLabel: "Add",
      body: `<div class="field"><label>Teacher</label>
        <select class="select" name="teacherId">${UI.teacherOptions(null)}</select></div>`,
      onSubmit(d) {
        const a = S.byId("collegeApps", appId);
        a.recs = (a.recs || []).concat([{ id: U.uid("r"), teacherId: d.teacherId, requested: false, received: false }]);
        S.commit();
        UI.toast("Recommender added");
        detail(appId);
      }
    });
  }

  /* ------------------------------------------------------------- render */

  function progressOf(a) {
    const parts = [];
    parts.push(a.status === "submitted" || a.status === "accepted" ? 1 : a.status === "in-progress" ? 0.35 : 0);
    if ((a.essays || []).length) parts.push(a.essays.filter((e) => e.status === "done").length / a.essays.length);
    if ((a.recs || []).length) parts.push(a.recs.filter((r) => r.received).length / a.recs.length);
    return U.avg(parts);
  }

  function render() {
    const apps = U.sortBy(S.db.collegeApps, (a) => a.deadline);
    const schools = apps.filter((a) => a.type !== "Scholarship");
    const scholarships = apps.filter((a) => a.type === "Scholarship");
    const nextUp = apps.find((a) => U.diffDays(a.deadline, U.today()) >= 0 && a.status !== "submitted");
    const totalEssays = U.sum(apps, (a) => (a.essays || []).length);
    const doneEssays = U.sum(apps, (a) => (a.essays || []).filter((e) => e.status === "done").length);
    const awards = U.sum(scholarships, (a) => a.amount || 0);
    const cum = S.cumulativeGpa();

    const card = (a) => {
      const days = U.diffDays(a.deadline, U.today());
      const pct = progressOf(a) * 100;
      return `<div class="card card-link" data-app="${a.id}">
        <div class="card-body">
          <div class="between mb-8">
            <div style="min-width:0">
              <h3 class="truncate">${U.esc(a.school)}</h3>
              <div class="tiny dim">${U.esc(a.type)} · ${U.esc(U.fmtDate(a.deadline, "full"))}</div>
            </div>
            ${statusBadge(a.status)}
          </div>
          <div class="bar mb-8"><i style="width:${U.round(pct, 1)}%;${pct >= 100 ? "background:var(--ok)" : ""}"></i></div>
          <div class="row gap-6 wrap">
            <span class="badge ${days < 0 ? "danger" : days < 14 ? "warn" : ""}">
              ${days < 0 ? "Passed" : days === 0 ? "Today" : days + " days"}
            </span>
            ${(a.essays || []).length ? `<span class="badge">${a.essays.filter((e) => e.status === "done").length}/${a.essays.length} essays</span>` : ""}
            ${(a.recs || []).length ? `<span class="badge">${a.recs.filter((r) => r.received).length}/${a.recs.length} recs</span>` : ""}
            ${a.amount ? `<span class="badge ok">$${a.amount.toLocaleString()}</span>` : ""}
          </div>
        </div>
      </div>`;
    };

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>${App.i18n.t("college", "Applications")}</h1>
          <div class="sub">${U.plural(schools.length, "school")} ·
            ${U.plural(scholarships.length, "scholarship")} ·
            ${doneEssays}/${totalEssays} essays finished</div>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" data-add>+ Add school</button>
        </div>
      </div>

      <div class="grid g-4 mb-16">
        <div class="stat accent">
          <div class="stat-ico">⏰</div>
          <div class="stat-label">Next deadline</div>
          <div class="stat-value" style="font-size:1.1rem;margin-top:9px">${nextUp ? U.esc(nextUp.school) : "None"}</div>
          <div class="stat-foot">${nextUp ? `${U.relDate(nextUp.deadline)} · ${nextUp.type}` : "Nothing pending"}</div>
        </div>
        <div class="stat">
          <div class="stat-ico">✍️</div>
          <div class="stat-label">Essays</div>
          <div class="stat-value">${doneEssays}/${totalEssays}</div>
          <div class="stat-foot">${totalEssays - doneEssays} still to write</div>
        </div>
        <div class="stat">
          <div class="stat-ico">🎓</div>
          <div class="stat-label">Cumulative GPA</div>
          <div class="stat-value">${U.round(cum.gpa, 2)}</div>
          <div class="stat-foot">${cum.credits} credits · all terms</div>
        </div>
        <div class="stat">
          <div class="stat-ico">💰</div>
          <div class="stat-label">Scholarships tracked</div>
          <div class="stat-value">$${awards.toLocaleString()}</div>
          <div class="stat-foot">${U.plural(scholarships.length, "application")}</div>
        </div>
      </div>

      ${apps.length ? `
        <div class="grid g-main">
          <div>
            ${schools.length ? `<h3 class="mb-12">Schools</h3>
              <div class="grid g-2 mb-24">${schools.map(card).join("")}</div>` : ""}
            ${scholarships.length ? `<h3 class="mb-12">Scholarships</h3>
              <div class="grid g-2">${scholarships.map(card).join("")}</div>` : ""}
          </div>

          <div class="col gap-16">
            <div class="card">
              <div class="card-head"><h3>Deadline timeline</h3></div>
              <div class="list">
                ${apps.slice(0, 8).map((a) => {
                  const days = U.diffDays(a.deadline, U.today());
                  return `<div class="list-item" data-app="${a.id}" style="cursor:pointer">
                    <span class="hw-stripe" style="background:${days < 0 ? "var(--danger)" : days < 14 ? "var(--warn)" : "var(--brand-500)"}"></span>
                    <span class="grow"><div class="title truncate">${U.esc(a.school)}</div>
                      <div class="meta">${U.esc(U.fmtDate(a.deadline, "full"))}</div></span>
                    <span class="badge ${days < 0 ? "danger" : days < 14 ? "warn" : ""}">${days < 0 ? "Passed" : days + "d"}</span>
                  </div>`;
                }).join("")}
              </div>
            </div>

            <div class="card">
              <div class="card-head"><h3>Recommendations</h3></div>
              <div class="card-body">
                ${(() => {
                  const all = [];
                  apps.forEach((a) => (a.recs || []).forEach((r) => all.push({ r, a })));
                  if (!all.length) return `<p class="dim small">No recommenders requested yet.</p>`;
                  const byTeacher = U.groupBy(all, (x) => x.r.teacherId);
                  return [...byTeacher.entries()].map(([tid, items]) => {
                    const t = S.teacher(tid);
                    const got = items.filter((x) => x.r.received).length;
                    return `<div class="row gap-10 mb-12">
                      ${UI.avatar(t ? t.name : "?", "#64748b", "sm")}
                      <span class="grow" style="min-width:0">
                        <div class="small bold truncate">${U.esc(t ? t.name : "Unknown")}</div>
                        <div class="tiny dim">${got}/${items.length} letters received</div>
                      </span>
                      <span class="badge ${got === items.length ? "ok" : "warn"}">${got}/${items.length}</span>
                    </div>`;
                  }).join("");
                })()}
              </div>
            </div>
          </div>
        </div>`
      : UI.emptyState("graduation", "No applications yet",
          "Track schools, scholarships, essay drafts, and recommendation letters — with deadlines that show up on your calendar.",
          `<button class="btn btn-primary" data-add>+ Add your first school</button>`)}
    </div>`;
  }

  function mount(root) {
    U.on(root, "click", "[data-add]", () => form(null));
    U.on(root, "click", "[data-app]", (_e, el) => detail(el.dataset.app));
  }

  return { render, mount, title: "Applications" };
})();
