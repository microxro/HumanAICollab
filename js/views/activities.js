/* ==========================================================================
   views/activities.js — extracurriculars, practices, and service hours
   ========================================================================== */

App.views.activities = (function () {
  const U = App.utils, S = App.store, UI = App.ui, C = App.charts;

  const TYPES = ["Sport", "Club", "Service", "Music", "Arts", "Academic", "Job", "Other"];

  function form(ac) {
    const a = ac || {};
    UI.modal({
      title: ac ? "Edit activity" : "Add an activity",
      size: "wide",
      okLabel: ac ? "Save" : "Add activity",
      body: `<div class="form-grid">
        <div class="field full">
          <label>Name</label>
          <input class="input" name="name" required value="${U.esc(a.name || "")}" placeholder="e.g. Varsity Soccer" />
        </div>
        <div class="field">
          <label>Type</label>
          <select class="select" name="type">
            ${TYPES.map((t) => `<option ${t === (a.type || "Club") ? "selected" : ""}>${t}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Your role</label>
          <input class="input" name="role" value="${U.esc(a.role || "")}" placeholder="Member, Captain, Treasurer…" />
        </div>
        <div class="field">
          <label>Advisor / coach</label>
          <select class="select" name="advisorId">${UI.teacherOptions(a.advisorId, true)}</select>
        </div>
        <div class="field">
          <label>Location</label>
          <input class="input" name="location" value="${U.esc(a.location || "")}" placeholder="Gym, Room 118…" />
        </div>
        <div class="field">
          <label>Starts</label>
          <input class="input" type="time" name="start" value="${a.start || "15:30"}" />
        </div>
        <div class="field">
          <label>Ends</label>
          <input class="input" type="time" name="end" value="${a.end || "17:00"}" />
        </div>
        <div class="field">
          <label>Season</label>
          <input class="input" name="season" value="${U.esc(a.season || "Year-round")}" placeholder="Fall, Spring, Year-round" />
        </div>
        <div class="field">
          <label>Meets on</label>
          ${UI.dayPicker("days", a.days || ["Tue", "Thu"])}
        </div>
        <div class="field">
          <label>Starts on <span class="tiny dim">(optional)</span></label>
          <input class="input" type="date" name="startDate" value="${a.startDate || ""}" />
        </div>
        <div class="field">
          <label>Ends on <span class="tiny dim">(optional)</span></label>
          <input class="input" type="date" name="endDate" value="${a.endDate || ""}" />
        </div>
        <div class="field full">
          <label>Color</label>
          ${UI.colorPicker("color", a.color || S.PALETTE[2])}
        </div>
      </div>`,
      onMount(root) { UI.bindSwatches(root); UI.bindDays(root); },
      onSubmit(d) {
        if (!d.name.trim()) return false;
        const patch = {
          name: d.name.trim(), type: d.type, role: d.role.trim(),
          advisorId: d.advisorId || null, location: d.location.trim(),
          start: d.start, end: d.end, season: d.season.trim(), color: d.color,
          days: d.days ? d.days.split(",").filter(Boolean) : [],
          startDate: d.startDate || "", endDate: d.endDate || ""
        };
        if (ac) { S.update("activities", ac.id, patch); UI.toast("Activity updated", patch.name); }
        else { S.insert("activities", Object.assign({ hours: [] }, patch)); UI.toast("Activity added", patch.name, "ok"); }
      }
    });
  }

  function logHours(id) {
    const a = S.byId("activities", id);
    if (!a) return;
    UI.modal({
      title: "Log hours",
      sub: a.name,
      okLabel: "Log it",
      body: `<div class="form-grid">
        <div class="field"><label>Date</label>
          <input class="input" type="date" name="date" value="${U.today()}" /></div>
        <div class="field"><label>Hours</label>
          <input class="input" type="number" name="hours" step="0.25" min="0" value="1.5" /></div>
        <div class="field full"><label>What did you do?</label>
          <input class="input" name="note" placeholder="Practice, game, volunteering…" /></div>
      </div>`,
      onSubmit(d) {
        a.hours = a.hours || [];
        a.hours.push({ date: d.date, hours: Number(d.hours) || 0, note: d.note.trim() });
        S.commit();
        UI.toast("Hours logged", `${d.hours}h · ${a.name}`, "ok");
      }
    });
  }

  function detail(id) {
    const a = S.byId("activities", id);
    if (!a) return;
    const adv = S.teacher(a.advisorId);
    const hours = U.sortBy(a.hours || [], (h) => h.date, true);
    const total = U.sum(hours, (h) => h.hours);
    const weekly = (U.toMin(a.end) - U.toMin(a.start)) * a.days.length / 60;

    UI.modal({
      title: a.name,
      sub: `${a.type}${a.role ? " · " + a.role : ""} · ${a.season}`,
      size: "wide",
      footer: `<button type="button" class="btn btn-danger left" data-del>Delete</button>
               <button type="button" class="btn" data-log>+ Log hours</button>
               <button type="button" class="btn" data-edit>Edit</button>
               <button type="button" class="btn btn-primary" data-close>Done</button>`,
      body: `
        <div class="grid g-3 mb-16">
          <div class="stat"><div class="stat-label">Total logged</div>
            <div class="stat-value" style="font-size:1.4rem">${U.round(total, 1)}h</div></div>
          <div class="stat"><div class="stat-label">Scheduled / week</div>
            <div class="stat-value" style="font-size:1.4rem">${U.round(weekly, 1)}h</div></div>
          <div class="stat"><div class="stat-label">Sessions</div>
            <div class="stat-value" style="font-size:1.4rem">${hours.length}</div></div>
        </div>

        <div class="row gap-24 wrap small muted mb-16">
          <div><div class="tiny dim">Meets</div>${U.esc(a.days.join(", ") || "—")}</div>
          <div><div class="tiny dim">Time</div>${U.fmtTime(a.start)} – ${U.fmtTime(a.end)}</div>
          <div><div class="tiny dim">Where</div>${U.esc(a.location || "—")}</div>
          <div><div class="tiny dim">Advisor</div>
            ${adv ? `${U.esc(adv.name)}<br><a class="tiny" href="mailto:${U.esc(adv.email)}">${U.esc(adv.email)}</a>` : "—"}</div>
        </div>

        <h4 class="mb-8">Hour log</h4>
        ${hours.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Date</th><th>What</th><th class="right">Hours</th><th></th></tr></thead>
          <tbody>${hours.map((h, i) => `<tr>
            <td class="nowrap">${U.esc(U.fmtDate(h.date, "day"))}</td>
            <td class="muted">${U.esc(h.note || "—")}</td>
            <td class="right nums">${h.hours}</td>
            <td class="right"><button class="icon-btn btn-sm" data-rm-hour="${i}" aria-label="Remove">✕</button></td>
          </tr>`).join("")}</tbody>
        </table></div>` : `<p class="dim small">No hours logged yet.</p>`}`,
      onMount(root) {
        root.querySelector("[data-edit]").addEventListener("click", () => { UI.closeModal(); form(a); });
        root.querySelector("[data-log]").addEventListener("click", () => { UI.closeModal(); logHours(a.id); });
        root.querySelector("[data-del]").addEventListener("click", () => {
          UI.closeModal();
          UI.confirm({
            title: "Delete activity?", message: `"${a.name}" and its logged hours will be removed.`,
            okLabel: "Delete", danger: true,
            onConfirm() { S.remove("activities", a.id); UI.toast("Activity deleted", a.name, "warn"); }
          });
        });
        U.on(root, "click", "[data-rm-hour]", (_e, el) => {
          const idx = Number(el.dataset.rmHour);
          const target = hours[idx];
          a.hours = (a.hours || []).filter((h) => h !== target);
          S.commit();
          UI.closeModal();
          detail(a.id);
        });
      }
    });
  }

  function render() {
    const acts = S.db.activities;
    const totalHours = S.serviceHours();
    const serviceOnly = U.sum(acts.filter((a) => a.type === "Service"), (a) => U.sum(a.hours || [], (h) => h.hours));
    const weeklyLoad = U.sum(acts, (a) => (U.toMin(a.end) - U.toMin(a.start)) * a.days.length) / 60;
    const goal = S.db.goals.find((g) => g.metric === "service");

    const byActivity = acts.map((a) => ({
      label: a.name, color: a.color, value: U.round(U.sum(a.hours || [], (h) => h.hours), 1)
    })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value);

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>Activities</h1>
          <div class="sub">${U.plural(acts.length, "activity", "activities")} ·
            ${U.round(weeklyLoad, 1)}h scheduled per week</div>
        </div>
        <div class="page-actions">
          <button class="btn" data-ai-add title="Describe it, or upload a photo of your schedule">✦ Add with AI</button>
          <button class="btn btn-primary" data-add>+ Add activity</button>
        </div>
      </div>

      <div class="grid g-3 mb-16">
        <div class="stat accent">
          <div class="stat-ico">⏱️</div>
          <div class="stat-label">Total hours logged</div>
          <div class="stat-value">${U.round(totalHours, 1)}</div>
          <div class="stat-foot">Across all activities</div>
        </div>
        <div class="stat">
          <div class="stat-ico">🤝</div>
          <div class="stat-label">Service hours</div>
          <div class="stat-value">${U.round(serviceOnly, 1)}</div>
          <div class="stat-foot">
            ${goal ? `Goal ${goal.target}h · ${U.round((totalHours / goal.target) * 100)}% there` : "No goal set"}
          </div>
        </div>
        <div class="stat">
          <div class="stat-ico">📅</div>
          <div class="stat-label">Weekly commitment</div>
          <div class="stat-value">${U.round(weeklyLoad, 1)}h</div>
          <div class="stat-foot">Practices + meetings</div>
        </div>
      </div>

      ${acts.length ? `
      <div class="grid g-main">
        <div class="grid g-2">${acts.map((a) => {
          const adv = S.teacher(a.advisorId);
          const total = U.sum(a.hours || [], (h) => h.hours);
          return `<div class="card card-link" data-act="${a.id}">
            <div style="height:4px;background:${U.esc(a.color)};border-radius:var(--radius) var(--radius) 0 0"></div>
            <div class="card-body">
              <div class="between mb-8">
                <div style="min-width:0">
                  <h3 class="truncate">${U.esc(a.name)}</h3>
                  <div class="tiny dim">${U.esc(a.type)}${a.role ? " · " + U.esc(a.role) : ""}</div>
                </div>
                <span class="badge brand">${U.round(total, 1)}h</span>
              </div>
              <div class="small muted mb-8">
                ${U.esc(a.days.join(", ") || "Not scheduled")} · ${U.fmtTime(a.start)}–${U.fmtTime(a.end)}
              </div>
              <div class="row gap-6 wrap">
                <span class="badge">${U.esc(a.location || "—")}</span>
                ${adv ? `<span class="badge">${U.esc(adv.name)}</span>` : ""}
                <span class="badge">${U.esc(a.season)}</span>
              </div>
            </div>
          </div>`;
        }).join("")}</div>

        <div class="col gap-16">
          <div class="card">
            <div class="card-head"><h3>Hours by activity</h3></div>
            <div class="card-body">
              ${byActivity.length ? C.hbars(byActivity, { fmt: (v) => v + "h" })
                : `<p class="dim small">Log some hours to see this.</p>`}
            </div>
          </div>
          <div class="card">
            <div class="card-head"><h3>This week's practices</h3></div>
            <div class="list">
              ${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].flatMap((d) =>
                S.activitiesOn(d).map((a) => `<div class="list-item">
                  <i class="dot-badge" style="background:${U.esc(a.color)}"></i>
                  <span class="grow"><div class="title">${U.esc(a.name)}</div>
                    <div class="meta">${d} · ${U.fmtTime(a.start)} · ${U.esc(a.location)}</div></span>
                  <button class="btn btn-sm" data-log="${a.id}">Log</button>
                </div>`)).join("") || `<p class="dim small" style="padding:14px">Nothing scheduled.</p>`}
            </div>
          </div>
        </div>
      </div>`
      : UI.emptyState("activities", "No activities yet",
          "Track sports, clubs, and volunteering — including practice times and hours for college applications.",
          `<button class="btn btn-primary" data-add>+ Add your first activity</button>`)}
    </div>`;
  }

  function mount(root) {
    U.on(root, "click", "[data-add]", () => form(null));
    U.on(root, "click", "[data-ai-add]", () => App.aiAdd.open());
    U.on(root, "click", "[data-act]", (_e, el) => detail(el.dataset.act));
    U.on(root, "click", "[data-log]", (e, el) => { e.stopPropagation(); logHours(el.dataset.log); });
  }

  return { render, mount, detail, title: "Activities" };
})();
