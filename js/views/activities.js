/* ==========================================================================
   views/activities.js — extracurriculars, practices, and service hours

   Two kinds live here, and the difference is not cosmetic:

     · School activities — a club or team run by the school. Its adult is on
       the staff list, its location is a room, and it only happens on a day
       the school is open.

     · Outside-school activities — a music lesson, a club swim squad, a
       language school, a dojo, a Saturday coding class. Nobody at school
       knows about it, its adult is not a teacher, it has an address and a
       phone number rather than a room, it usually costs money, and it very
       often falls on a weekend or through a school holiday.

   The second kind (F156) is what a family actually has to plan around, and
   the parent portal can propose one (see views/parent.js and views/sharing.js).
   ========================================================================== */

App.views.activities = (function () {
  const U = App.utils, S = App.store, UI = App.ui, C = App.charts;

  const TYPES = ["Sport", "Club", "Service", "Music", "Arts", "Academic", "Job", "Other"];
  // Outside school, "Club" and "Service" are rarer than lessons and coaching,
  // so the list leads with what those activities usually are.
  const EXTERNAL_TYPES = ["Class", "Lesson", "Sport", "Music", "Arts", "Tutoring",
    "Language", "Service", "Club", "Job", "Faith", "Other"];

  const COST_PERIODS = [
    ["session", "per session"], ["week", "per week"], ["month", "per month"],
    ["term", "per term"], ["year", "per year"], ["total", "one-off"]
  ];

  // "all" | "school" | "external" — kept across re-renders like every other
  // view-level filter in the app.
  let filter = "all";

  function costLabel(a) {
    // Same rule as S.activityCostMonthly: a fee belongs to the outside-school
    // side, so a stale one on a school record is not shown either.
    if (!a.external || a.cost == null || !(Number(a.cost) > 0)) return "";
    const per = COST_PERIODS.find((p) => p[0] === a.costPer);
    return `${S.money(Number(a.cost))} ${per ? per[1] : "per month"}`;
  }

  /** tel: is a real scheme, so the number has to be reduced to one before use. */
  function telHref(phone) {
    const clean = String(phone || "").replace(/[^0-9+]/g, "");
    return clean ? `tel:${encodeURIComponent(clean)}` : "";
  }

  function visible() {
    if (filter === "school") return S.schoolActivities();
    if (filter === "external") return S.externalActivities();
    return S.db.activities;
  }

  /* ---------------------------------------------------------------- form */

  /**
   * `opts.external` preselects the outside-school side for a fresh record —
   * used by the "+ Outside school" button and the global add menu, so that
   * path doesn't open on the school form and make the person switch.
   */
  function form(ac, opts) {
    const a = ac || {};
    const isExternal = ac ? !!ac.external : !!(opts && opts.external);
    const types = isExternal ? EXTERNAL_TYPES : TYPES;
    // An existing type that isn't in the list for this side (a school "Club"
    // switched to outside school) has to stay selectable, or saving silently
    // rewrites it to the first option.
    const typeList = a.type && !types.includes(a.type) ? [a.type].concat(types) : types;

    UI.modal({
      title: ac ? "Edit activity" : isExternal ? "Add an outside-school activity" : "Add an activity",
      sub: ac ? "" : "Anything they do outside class — including classes that aren't at school",
      size: "wide",
      okLabel: ac ? "Save" : "Add activity",
      body: `<div class="form-grid">
        <div class="field full">
          <label id="whereLabel">Who runs this?</label>
          <input type="hidden" name="external" value="${isExternal ? "1" : ""}" />
          <div class="segmented wide" role="group" aria-labelledby="whereLabel" data-where>
            <button type="button" class="${isExternal ? "" : "active"}" data-ext="">🏫 The school</button>
            <button type="button" class="${isExternal ? "active" : ""}" data-ext="1">🌍 Outside school</button>
          </div>
          <div class="hint mt-4" data-where-hint>${isExternal
            ? "A class, lesson, club, or team that has nothing to do with school — it can meet at the weekend or during a break."
            : "A club or team run by the school, with a staff advisor."}</div>
        </div>

        <div class="field full">
          <label>Name</label>
          <input class="input" name="name" required maxlength="80" value="${U.esc(a.name || "")}"
                 placeholder="${isExternal ? "e.g. Piano lessons" : "e.g. Varsity Soccer"}" />
        </div>
        <div class="field">
          <label>Type</label>
          <select class="select" name="type">
            ${typeList.map((t) => `<option ${t === (a.type || (isExternal ? "Class" : "Club")) ? "selected" : ""}>${U.esc(t)}</option>`).join("")}
          </select>
        </div>
        <!-- school-only -->
        <div class="field" data-only="school" ${isExternal ? "hidden" : ""}>
          <label>Advisor / coach</label>
          <select class="select" name="advisorId">${UI.teacherOptions(a.advisorId, true)}</select>
        </div>
        <div class="field" data-only="school" ${isExternal ? "hidden" : ""}>
          <label>Room</label>
          <input class="input" name="location" maxlength="80" value="${U.esc(a.location || "")}" placeholder="Gym, Room 118…" />
        </div>

        <!-- outside-school only -->
        <div class="field" data-only="external" ${isExternal ? "" : "hidden"}>
          <label>Who runs it</label>
          <input class="input" name="provider" maxlength="80" value="${U.esc(a.provider || "")}"
                 placeholder="Northside Music Academy" />
        </div>
        <div class="field" data-only="external" ${isExternal ? "" : "hidden"}>
          <label>Instructor / coach <span class="tiny dim">(optional)</span></label>
          <input class="input" name="contactName" maxlength="80" value="${U.esc(a.contactName || "")}" placeholder="Ms. Halvorsen" />
        </div>
        <div class="field" data-only="external" ${isExternal ? "" : "hidden"}>
          <label>Their email <span class="tiny dim">(optional)</span></label>
          <input class="input" type="email" name="contactEmail" maxlength="120" value="${U.esc(a.contactEmail || "")}" placeholder="lessons@academy.example" />
        </div>
        <div class="field" data-only="external" ${isExternal ? "" : "hidden"}>
          <label>Their phone <span class="tiny dim">(optional)</span></label>
          <input class="input" type="tel" name="contactPhone" maxlength="40" value="${U.esc(a.contactPhone || "")}" placeholder="555-0128" />
        </div>
        <div class="field full" data-only="external" ${isExternal ? "" : "hidden"}>
          <label>Address <span class="tiny dim">(optional)</span></label>
          <input class="input" name="address" maxlength="160" value="${U.esc(a.address || "")}" placeholder="412 Beaumont Ave" />
        </div>
        <div class="field" data-only="external" ${isExternal ? "" : "hidden"}>
          <label>Website <span class="tiny dim">(optional)</span></label>
          <input class="input" type="url" name="website" maxlength="200" value="${U.esc(a.website || "")}" placeholder="https://…" />
        </div>
        <div class="field" data-only="external" ${isExternal ? "" : "hidden"}>
          <label>Cost <span class="tiny dim">(optional)</span></label>
          <div class="row gap-6">
            <input class="input" type="number" name="cost" min="0" max="1000000" step="0.01" style="width:110px"
                   value="${a.cost != null ? U.esc(String(a.cost)) : ""}" placeholder="0" />
            <select class="select" name="costPer" style="flex:1">
              ${COST_PERIODS.map(([v, label]) => `<option value="${v}" ${v === (a.costPer || "month") ? "selected" : ""}>${label}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="field">
          <label>Starts</label>
          <input class="input" type="time" name="start" value="${U.esc(a.start || "15:30")}" />
        </div>
        <div class="field">
          <label>Ends</label>
          <input class="input" type="time" name="end" value="${U.esc(a.end || "17:00")}" />
        </div>
        <div class="field">
          <label>Season</label>
          <input class="input" name="season" maxlength="40" value="${U.esc(a.season || "Year-round")}" placeholder="Fall, Spring, Year-round" />
        </div>
        <div class="field">
          <label>Meets on</label>
          ${UI.dayPicker("days", a.days || (isExternal ? ["Sat"] : ["Tue", "Thu"]))}
        </div>
        <div class="field">
          <label>Starts on <span class="tiny dim">(optional)</span></label>
          <input class="input" type="date" name="startDate" value="${U.esc(a.startDate || "")}" />
        </div>
        <div class="field">
          <label>Ends on <span class="tiny dim">(optional)</span></label>
          <input class="input" type="date" name="endDate" value="${U.esc(a.endDate || "")}" />
        </div>
        <div class="field full" data-only="external" ${isExternal ? "" : "hidden"}>
          <label>Notes <span class="tiny dim">(optional)</span></label>
          <input class="input" name="notes" maxlength="300" value="${U.esc(a.notes || "")}"
                 placeholder="Bring the theory book on the first Wednesday of the month." />
        </div>
        <div class="field full">
          <label>Color</label>
          ${UI.colorPicker("color", a.color || S.PALETTE[2])}
        </div>
      </div>`,
      onMount(root) {
        UI.bindSwatches(root);
        UI.bindDays(root);

        const flag = root.querySelector('[name="external"]');
        const hint = root.querySelector("[data-where-hint]");
        const seg = root.querySelector("[data-where]");
        const nameInput = root.querySelector('[name="name"]');
        const typeSel = root.querySelector('[name="type"]');

        seg.addEventListener("click", (e) => {
          const b = e.target.closest("[data-ext]");
          if (!b) return;
          const ext = b.dataset.ext === "1";
          flag.value = ext ? "1" : "";
          U.$$("button", seg).forEach((x) => x.classList.toggle("active", x === b));
          U.$$("[data-only]", root).forEach((el) => { el.hidden = el.dataset.only !== (ext ? "external" : "school"); });
          hint.textContent = ext
            ? "A class, lesson, club, or team that has nothing to do with school — it can meet at the weekend or during a break."
            : "A club or team run by the school, with a staff advisor.";
          nameInput.placeholder = ext ? "e.g. Piano lessons" : "e.g. Varsity Soccer";

          // Rebuild the type list for the side now chosen, keeping the
          // current choice if it exists on the other side too.
          const keep = typeSel.value;
          const list = ext ? EXTERNAL_TYPES : TYPES;
          typeSel.innerHTML = (list.includes(keep) ? list : [keep].concat(list))
            .map((t) => `<option ${t === keep ? "selected" : ""}>${U.esc(t)}</option>`).join("");
        });
      },
      onSubmit(d) {
        if (!d.name.trim()) return false;
        const external = !!d.external;
        const patch = {
          name: d.name.trim(), type: d.type,
          start: d.start, end: d.end, season: d.season.trim(), color: d.color,
          days: d.days ? d.days.split(",").filter(Boolean) : [],
          startDate: d.startDate || "", endDate: d.endDate || "",
          external
        };

        // Every [name] in the form is submitted, hidden or not, so the fields
        // belonging to the side that wasn't chosen are cleared rather than
        // saved — a school club carrying a stale monthly fee would show that
        // fee on the card and in the family's monthly total.
        if (external) {
          Object.assign(patch, {
            advisorId: null,
            provider: d.provider.trim(),
            contactName: d.contactName.trim(),
            contactEmail: d.contactEmail.trim(),
            contactPhone: d.contactPhone.trim(),
            address: d.address.trim(),
            website: U.safeUrl(d.website.trim()) === "#" ? "" : d.website.trim(),
            // A cost of 0 is "free", which is worth recording; a blank box is
            // "I don't know", which is not the same thing.
            cost: d.cost == null || d.cost === "" ? null : Math.max(0, Number(d.cost)),
            costPer: d.costPer,
            notes: d.notes.trim(),
            // The address doubles as the location so the timetable, the
            // calendar and the schedule have one field to read either way.
            location: d.address.trim() || d.provider.trim()
          });
        } else {
          Object.assign(patch, {
            advisorId: d.advisorId || null, location: d.location.trim(),
            provider: "", contactName: "", contactEmail: "", contactPhone: "",
            address: "", website: "", cost: null, costPer: "month", notes: ""
          });
        }

        if (ac) { S.update("activities", ac.id, patch); UI.toast("Activity updated", patch.name); }
        else { S.insert("activities", Object.assign({ hours: [], addedBy: "" }, patch)); UI.toast("Activity added", patch.name, "ok"); }
      }
    });
  }

  function logHours(id, entry) {
    const a = S.byId("activities", id);
    if (!a) return;
    UI.modal({
      title: entry ? "Edit logged hours" : "Log hours",
      sub: a.name,
      okLabel: entry ? "Save" : "Log it",
      body: `<div class="form-grid">
        <div class="field"><label>Date</label>
          <input class="input" type="date" name="date" value="${U.esc(entry ? entry.date : U.today())}" /></div>
        <div class="field"><label>Hours</label>
          <input class="input" type="number" name="hours" step="0.25" min="0" value="${entry ? entry.hours : 1.5}" /></div>
        <div class="field full"><label>What did you do?</label>
          <input class="input" name="note" value="${U.esc(entry ? entry.note || "" : "")}" placeholder="Practice, lesson, volunteering…" /></div>
      </div>`,
      onSubmit(d) {
        a.hours = a.hours || [];
        if (entry) {
          entry.date = d.date; entry.hours = Number(d.hours) || 0; entry.note = d.note.trim();
        } else {
          a.hours.push({ date: d.date, hours: Number(d.hours) || 0, note: d.note.trim() });
        }
        S.commit();
        UI.toast(entry ? "Hours updated" : "Hours logged", `${d.hours}h · ${a.name}`, "ok");
      }
    });
  }

  /* -------------------------------------------------------------- detail */

  function contactBlock(a) {
    if (!a.external) return "";
    const site = a.website ? U.safeUrl(a.website) : "";
    const tel = telHref(a.contactPhone);
    const rows = [
      ["Run by", U.esc(a.provider || "—")],
      ["Instructor", a.contactName ? U.esc(a.contactName) : "—"],
      ["Email", U.isEmail(a.contactEmail)
        ? `<a href="${U.mailtoHref(a.contactEmail)}">${U.esc(a.contactEmail)}</a>` : "—"],
      ["Phone", tel ? `<a href="${U.esc(tel)}">${U.esc(a.contactPhone)}</a>` : "—"],
      ["Address", U.esc(a.address || "—")],
      ["Website", site && site !== "#"
        ? `<a href="${U.esc(site)}" target="_blank" rel="noopener noreferrer">${U.esc(a.website)}</a>` : "—"],
      ["Cost", costLabel(a) ? U.esc(costLabel(a)) : "—"]
    ];
    return `<div class="card mb-16" style="border-left:3px solid var(--info)">
      <div class="card-head"><h3>Outside school</h3>
        ${a.addedBy ? `<span class="badge">Added by ${U.esc(a.addedBy)}</span>` : ""}</div>
      <div class="card-body">
        <div class="row gap-24 wrap small">
          ${rows.map(([k, v]) => `<div><div class="tiny dim">${k}</div>${v}</div>`).join("")}
        </div>
        ${a.notes ? `<p class="small muted mt-12">${U.esc(a.notes)}</p>` : ""}
      </div>
    </div>`;
  }

  function detail(id) {
    const a = S.byId("activities", id);
    if (!a) return;
    const adv = S.teacher(a.advisorId);
    const hours = U.sortBy(a.hours || [], (h) => h.date, true);
    const total = U.sum(hours, (h) => h.hours);
    const days = a.days || [];
    const weekly = (U.toMin(a.end) - U.toMin(a.start)) * days.length / 60;
    const monthly = S.activityCostMonthly(a);

    UI.modal({
      title: a.name,
      sub: `${a.external ? "Outside school · " : ""}${a.type} · ${a.season}`,
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
          <div class="stat"><div class="stat-label">${a.external && monthly ? "Costs / month" : "Sessions"}</div>
            <div class="stat-value" style="font-size:1.4rem">${a.external && monthly
              ? U.esc(S.money(U.round(monthly, 2))) : hours.length}</div></div>
        </div>

        ${contactBlock(a)}

        <div class="row gap-24 wrap small muted mb-16">
          <div><div class="tiny dim">Meets</div>${U.esc(days.join(", ") || "—")}</div>
          <div><div class="tiny dim">Time</div>${U.fmtTime(a.start)} – ${U.fmtTime(a.end)}</div>
          ${a.external ? "" : `<div><div class="tiny dim">Where</div>${U.esc(a.location || "—")}</div>
          <div><div class="tiny dim">Advisor</div>
            ${adv ? `${U.esc(adv.name)}<br><a class="tiny" href="${U.mailtoHref(adv.email)}">${U.esc(adv.email)}</a>` : "—"}</div>`}
          ${a.startDate || a.endDate
            ? `<div><div class="tiny dim">Runs</div>${U.esc(a.startDate ? U.fmtDate(a.startDate, "day") : "—")} → ${U.esc(a.endDate ? U.fmtDate(a.endDate, "day") : "—")}</div>`
            : ""}
        </div>

        <h4 class="mb-8">Hour log</h4>
        ${hours.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Date</th><th>What</th><th class="right">Hours</th><th></th></tr></thead>
          <tbody>${hours.map((h, i) => `<tr class="row-link" data-edit-hour="${i}">
            <td class="nowrap">${U.esc(U.fmtDate(h.date, "day"))}</td>
            <td class="muted">${U.esc(h.note || "—")}</td>
            <td class="right nums">${h.hours}</td>
            <td class="right"><button class="icon-btn btn-sm" data-rm-hour="${i}" data-stop-propagation aria-label="Remove">✕</button></td>
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
        U.on(root, "click", "[data-edit-hour]", (e, el) => {
          if (e.target.closest("[data-rm-hour]")) return;
          const idx = Number(el.dataset.editHour);
          const target = hours[idx];
          UI.closeModal();
          logHours(a.id, target);
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

  /* -------------------------------------------------------------- render */

  function card(a) {
    const adv = S.teacher(a.advisorId);
    const total = U.sum(a.hours || [], (h) => h.hours);
    const cost = costLabel(a);
    const days = a.days || [];
    return `<div class="card card-link" data-act="${a.id}">
      <div style="height:4px;background:${U.esc(a.color)};border-radius:var(--radius) var(--radius) 0 0"></div>
      <div class="card-body">
        <div class="between mb-8">
          <div style="min-width:0">
            <h3 class="truncate">${U.esc(a.name)}</h3>
            <div class="tiny dim">${U.esc(a.type)}</div>
          </div>
          <span class="badge brand">${U.round(total, 1)}h</span>
        </div>
        <div class="small muted mb-8">
          ${U.esc(days.join(", ") || "Not scheduled")} · ${U.fmtTime(a.start)}–${U.fmtTime(a.end)}
        </div>
        <div class="row gap-6 wrap">
          ${a.external ? `<span class="badge info">🌍 Outside school</span>` : ""}
          ${a.external && a.provider ? `<span class="badge">${U.esc(a.provider)}</span>`
            : `<span class="badge">${U.esc(a.location || "—")}</span>`}
          ${!a.external && adv ? `<span class="badge">${U.esc(adv.name)}</span>` : ""}
          ${cost ? `<span class="badge">${U.esc(cost)}</span>` : ""}
          <span class="badge">${U.esc(a.season)}</span>
        </div>
      </div>
    </div>`;
  }

  function costCard(ext) {
    const rows = ext.filter((a) => S.activityCostMonthly(a) > 0);
    const oneOff = S.oneOffActivityCost();
    if (!rows.length && !oneOff) return "";
    const monthly = S.monthlyActivityCost();
    return `<div class="card">
      <div class="card-head"><h3>What it costs ${UI.helpHint("Only outside-school activities have a fee. Anything billed per session is counted at the number of days a week it meets; a one-off fee is listed separately rather than folded into a monthly figure it isn't part of.")}</h3></div>
      <div class="card-body">
        <div class="between mb-12">
          <span class="small muted">Every month</span>
          <span class="bold">${U.esc(S.money(U.round(monthly, 2)))}</span>
        </div>
        ${rows.length ? `<div class="list">
          ${U.sortBy(rows, (a) => S.activityCostMonthly(a), true).map((a) => `<div class="list-item">
            <i class="dot-badge" style="background:${U.esc(a.color)}"></i>
            <span class="grow"><div class="title truncate">${U.esc(a.name)}</div>
              <div class="meta">${U.esc(costLabel(a))}</div></span>
            <span class="nums small">${U.esc(S.money(U.round(S.activityCostMonthly(a), 2)))}</span>
          </div>`).join("")}
        </div>` : ""}
        ${oneOff ? `<p class="tiny dim mt-8">Plus ${U.esc(S.money(U.round(oneOff, 2)))} in one-off fees.</p>` : ""}
      </div>
    </div>`;
  }

  function render() {
    const acts = S.db.activities;
    const ext = S.externalActivities();
    const shown = visible();
    const totalHours = S.serviceHours();
    const serviceOnly = U.sum(acts.filter((a) => a.type === "Service"), (a) => U.sum(a.hours || [], (h) => h.hours));
    const weeklyLoad = U.sum(acts, (a) => (U.toMin(a.end) - U.toMin(a.start)) * (a.days || []).length) / 60;
    const goal = S.db.goals.find((g) => g.metric === "service");
    const monthly = S.monthlyActivityCost();

    const byActivity = shown.map((a) => ({
      label: a.name, color: a.color, value: U.round(U.sum(a.hours || [], (h) => h.hours), 1)
    })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value);

    const FILTERS = [["all", "All"], ["school", "At school"], ["external", "Outside school"]];

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>${App.i18n.t("activities", "Activities")}</h1>
          <div class="sub">${U.plural(acts.length, "activity", "activities")} ·
            ${U.round(weeklyLoad, 1)}h scheduled per week${ext.length ? ` · ${ext.length} outside school` : ""}</div>
        </div>
        <div class="page-actions">
          ${acts.length ? `<div class="segmented" role="group" aria-label="Which activities to show">
            ${FILTERS.map(([id, label]) => `<button type="button" class="${filter === id ? "active" : ""}"
              data-filter="${id}" aria-pressed="${filter === id}">${label}</button>`).join("")}
          </div>` : ""}
          <button class="btn" data-ai-add title="Describe it, or upload a photo of your schedule">✦ Add with AI</button>
          <button class="btn" data-add-external title="A class, lesson, or team that isn't run by the school">🌍 Add outside school</button>
          <button class="btn btn-primary" data-add>+ Add activity</button>
        </div>
      </div>

      <div class="grid g-4 mb-16">
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
        <div class="stat">
          <div class="stat-ico">🌍</div>
          <div class="stat-label">Outside school</div>
          <div class="stat-value">${ext.length}</div>
          <div class="stat-foot">${monthly ? `${U.esc(S.money(U.round(monthly, 2)))} a month` : "Classes, lessons, clubs"}</div>
        </div>
      </div>

      ${!acts.length ? UI.emptyState("activities", "No activities yet",
          "Track sports, clubs, and volunteering — plus everything outside school: lessons, external classes, a club team, tutoring. Practice times and hours count for college applications either way.",
          `<div class="row gap-8 center wrap">
            <button class="btn" data-add-external>🌍 Add one outside school</button>
            <button class="btn btn-primary" data-add>+ Add your first activity</button>
          </div>`)
      : !shown.length ? `<div class="card"><div class="card-body center">
        <p class="dim small mb-8">${filter === "external"
          ? "Nothing outside school yet — music lessons, a club team, a language class, tutoring."
          : "No school clubs or teams yet."}</p>
        <button class="btn btn-primary" ${filter === "external" ? "data-add-external" : "data-add"}>
          ${filter === "external" ? "+ Add one outside school" : "+ Add a school activity"}</button>
      </div></div>`
      : `
      <div class="grid g-main">
        <div class="grid g-2">${shown.map(card).join("")}</div>

        <div class="col gap-16">
          ${costCard(ext)}
          <div class="card">
            <div class="card-head"><h3>Hours by activity</h3></div>
            <div class="card-body">
              ${byActivity.length ? C.hbars(byActivity, { fmt: (v) => v + "h" })
                : `<p class="dim small">Log some hours to see this.</p>`}
            </div>
          </div>
          <div class="card">
            <div class="card-head"><h3>This week</h3></div>
            <div class="list">
              ${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].flatMap((d) =>
                S.activitiesOn(d).filter((a) => shown.includes(a)).map((a) => `<div class="list-item">
                  <i class="dot-badge" style="background:${U.esc(a.color)}"></i>
                  <span class="grow"><div class="title">${U.esc(a.name)}</div>
                    <div class="meta">${d} · ${U.fmtTime(a.start)} · ${U.esc(a.external ? (a.provider || a.address || "Outside school") : a.location)}</div></span>
                  <button class="btn btn-sm" data-log="${a.id}">Log</button>
                </div>`)).join("") || `<p class="dim small" style="padding:14px">Nothing scheduled.</p>`}
            </div>
          </div>
        </div>
      </div>`}
    </div>`;
  }

  function mount(root) {
    U.on(root, "click", "[data-add]", () => form(null));
    U.on(root, "click", "[data-add-external]", () => form(null, { external: true }));
    U.on(root, "click", "[data-ai-add]", () => App.aiAdd.open({ scope: "activities" }));
    U.on(root, "click", "[data-filter]", (_e, el) => { filter = el.dataset.filter; App.router.refresh(); });
    U.on(root, "click", "[data-act]", (_e, el) => detail(el.dataset.act));
    U.on(root, "click", "[data-log]", (e, el) => { e.stopPropagation(); logHours(el.dataset.log); });
  }

  return { render, mount, detail, form, title: "Activities" };
})();
