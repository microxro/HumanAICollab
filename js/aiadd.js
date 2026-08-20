/* ==========================================================================
   aiadd.js — "Add with AI": describe a class/activity in your own words, or
   upload a photo of a schedule or bell-times page, and review the draft
   before anything is saved.

   Deliberately never writes straight to the store. Gemini's extraction
   always lands in an editable, per-item review list first — a wrong photo
   read shouldn't silently plant a bad time block on someone's calendar.
   Manual entry (the existing "+ Add activity" / "+ Add class" forms) stays
   exactly as it was; this is an alternative on-ramp into the same data.
   ========================================================================== */

App.aiAdd = (function () {
  const U = App.utils, S = App.store, UI = App.ui;

  const CATEGORY_TO_TYPE = {
    Sport: "Sport", Club: "Club", Service: "Service", Music: "Music",
    Arts: "Arts", Academic: "Academic", Job: "Job", Other: "Other"
  };
  const TYPES = ["Sport", "Club", "Service", "Music", "Arts", "Academic", "Job", "Other"];
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  function entryCard(e, i) {
    const p = `entry_${i}_`;
    return `<div class="card mb-12" data-entry="${i}" ${e.added ? 'data-added="1"' : ""}>
      <div class="row wrap gap-6" style="margin-bottom:8px">
        <input class="input" style="flex:2;min-width:160px" name="${p}name" value="${U.esc(e.name)}" ${e.added ? "disabled" : ""} />
        <select class="select" style="flex:1;min-width:120px" name="${p}category" ${e.added ? "disabled" : ""}>
          ${TYPES.map((t) => `<option ${t === e.category ? "selected" : ""}>${t}</option>`).join("")}
        </select>
      </div>
      <div class="row wrap gap-6" style="margin-bottom:8px">
        ${DAYS.map((d) => `<button type="button" class="chip ${e.days.includes(d) ? "active" : ""}" data-daybtn="${i}:${d}" ${e.added ? "disabled" : ""}>${d}</button>`).join("")}
      </div>
      <div class="row wrap gap-6" style="margin-bottom:8px">
        <input class="input" type="time" style="flex:1;min-width:100px" name="${p}start" value="${e.start || "15:30"}" ${e.added ? "disabled" : ""} />
        <input class="input" type="time" style="flex:1;min-width:100px" name="${p}end" value="${e.end || "17:00"}" ${e.added ? "disabled" : ""} />
        <input class="input" style="flex:2;min-width:140px" name="${p}location" placeholder="Location" value="${U.esc(e.location || "")}" ${e.added ? "disabled" : ""} />
      </div>
      <div class="row wrap gap-6" style="margin-bottom:8px">
        <div class="field" style="flex:1;min-width:130px;margin:0">
          <label class="tiny dim">Starts on (optional)</label>
          <input class="input" type="date" name="${p}startDate" value="${e.startDate || ""}" ${e.added ? "disabled" : ""} />
        </div>
        <div class="field" style="flex:1;min-width:130px;margin:0">
          <label class="tiny dim">Ends on (optional)</label>
          <input class="input" type="date" name="${p}endDate" value="${e.endDate || ""}" ${e.added ? "disabled" : ""} />
        </div>
      </div>
      <div class="row" style="justify-content:flex-end">
        ${e.added
          ? `<span class="tag" style="background:var(--ok-bg);color:var(--ok)">Added ✓</span>`
          : `<button type="button" class="btn btn-sm btn-primary" data-add-entry="${i}">Add this</button>`}
      </div>
    </div>`;
  }

  function periodRow(p, i) {
    const pfx = `period_${i}_`;
    return `<div class="row wrap gap-6 mb-12" data-period="${i}" ${p.added ? 'data-added="1"' : ""}>
      <input class="input" style="flex:2;min-width:120px" name="${pfx}name" value="${U.esc(p.name)}" ${p.added ? "disabled" : ""} />
      <input class="input" type="time" style="flex:1;min-width:90px" name="${pfx}start" value="${p.start}" ${p.added ? "disabled" : ""} />
      <input class="input" type="time" style="flex:1;min-width:90px" name="${pfx}end" value="${p.end}" ${p.added ? "disabled" : ""} />
      ${p.added
        ? `<span class="tag" style="background:var(--ok-bg);color:var(--ok)">Added ✓</span>`
        : `<button type="button" class="btn btn-sm" data-add-period="${i}">Add</button>`}
    </div>`;
  }

  function bodyHTML(state) {
    const tabs = `<div class="segmented mb-12">
      <button type="button" data-tab="text" class="${state.tab === "text" ? "active" : ""}">Describe it</button>
      <button type="button" data-tab="photo" class="${state.tab === "photo" ? "active" : ""}">Upload a photo</button>
    </div>`;

    const inputArea = state.tab === "text"
      ? `<div class="field full">
          <textarea class="input" name="desc" rows="3" placeholder="e.g. I have swimming from 6-6:45pm every weekday starting September 5 through October 25">${U.esc(state.text || "")}</textarea>
        </div>
        <button type="button" class="btn btn-primary" data-parse-text ${state.busy ? "disabled" : ""}>
          ${state.busy ? "Reading it now…" : "Figure it out"}
        </button>`
      : `<div class="field full">
          <input class="input" type="file" accept="image/*" name="photo" data-photo-input />
          <div class="tiny dim mt-4">A screenshot of your class schedule, or a photo of the bell times from your school's website.</div>
        </div>
        <button type="button" class="btn btn-primary" data-parse-photo ${state.busy ? "disabled" : ""}>
          ${state.busy ? "Reading it now…" : "Figure it out"}
        </button>`;

    let resultHTML = "";
    if (state.error) {
      resultHTML = `<div class="mt-16" style="color:var(--danger)">${U.esc(state.error)}</div>`;
    } else if (state.result) {
      const r = state.result;
      resultHTML = `<div class="mt-16">
        ${r.summary ? `<p class="small">${U.esc(r.summary)}</p>` : ""}
        ${r.clarify ? `<p class="small" style="color:var(--warn)">${U.esc(r.clarify)}</p>` : ""}
        ${r.entries.length ? `<h4 class="mt-12 mb-8">Classes &amp; activities</h4>${r.entries.map(entryCard).join("")}` : ""}
        ${r.periods.length ? `<h4 class="mt-12 mb-8">Bell schedule</h4>
          <p class="tiny dim mb-8">These are added to your existing bell schedule, not used to replace it.</p>
          ${r.periods.map(periodRow).join("")}` : ""}
        ${!r.entries.length && !r.periods.length ? `<p class="small dim">Nothing recognizable came out of that — try rephrasing or a clearer photo.</p>` : ""}
      </div>`;
    }

    return `${tabs}${inputArea}${resultHTML}`;
  }

  function open(opts) {
    const state = { tab: (opts && opts.tab) || "text", text: "", busy: false, result: null, error: null, photoFile: null };

    const root = UI.modal({
      title: "Add with AI",
      sub: "Describe it or upload a photo — you'll review everything before it's saved.",
      size: "wide",
      footer: `<button type="button" class="btn btn-primary" data-close>Done</button>`,
      body: bodyHTML(state),
      onMount(modalRoot) { bind(modalRoot); }
    });

    function render() {
      root.querySelector(".modal-body").innerHTML = bodyHTML(state);
    }

    function readEntry(i) {
      const p = `entry_${i}_`;
      const g = (n) => root.querySelector(`[name="${p}${n}"]`);
      return {
        name: (g("name").value || "").trim() || "Untitled",
        type: CATEGORY_TO_TYPE[g("category").value] || "Other",
        start: g("start").value, end: g("end").value,
        location: (g("location").value || "").trim(),
        startDate: g("startDate").value || "", endDate: g("endDate").value || "",
        days: state.result.entries[i].days
      };
    }

    function bind(modalRoot) {
      U.on(modalRoot, "click", "[data-tab]", (_e, el) => { state.tab = el.dataset.tab; render(); });

      U.on(modalRoot, "click", "[data-parse-text]", async () => {
        const ta = modalRoot.querySelector('[name="desc"]');
        state.text = ta ? ta.value : "";
        if (!state.text.trim()) return;
        state.busy = true; state.error = null; render();
        try {
          const r = await App.assistant.parseText(state.text);
          state.result = { ...r, entries: r.entries.map((e) => ({ ...e, added: false })), periods: r.periods.map((p) => ({ ...p, added: false })) };
        } catch (e) {
          state.error = e.message;
        }
        state.busy = false; render();
      });

      U.on(modalRoot, "click", "[data-parse-photo]", async () => {
        const input = modalRoot.querySelector("[data-photo-input]");
        const file = input && input.files && input.files[0];
        if (!file) { state.error = "Choose a photo first."; render(); return; }
        state.busy = true; state.error = null; render();
        try {
          const r = await App.assistant.parseImage(file);
          state.result = { ...r, entries: r.entries.map((e) => ({ ...e, added: false })), periods: r.periods.map((p) => ({ ...p, added: false })) };
        } catch (e) {
          state.error = e.message;
        }
        state.busy = false; render();
      });

      U.on(modalRoot, "click", "[data-daybtn]", (_e, el) => {
        const [idx, day] = el.dataset.daybtn.split(":");
        const e = state.result.entries[Number(idx)];
        if (e.days.includes(day)) e.days = e.days.filter((d) => d !== day);
        else e.days.push(day);
        el.classList.toggle("active");
      });

      U.on(modalRoot, "click", "[data-add-entry]", (_e, el) => {
        const i = Number(el.dataset.addEntry);
        const draft = readEntry(i);
        if (!draft.days.length) { UI.toast("Pick at least one day", draft.name, "warn"); return; }
        S.insert("activities", {
          name: draft.name, type: draft.type, role: "", advisorId: null,
          location: draft.location, start: draft.start, end: draft.end,
          season: "AI add", color: S.PALETTE[i % S.PALETTE.length],
          days: draft.days, startDate: draft.startDate, endDate: draft.endDate, hours: []
        });
        state.result.entries[i].added = true;
        UI.toast("Added", draft.name, "ok");
        render();
      });

      U.on(modalRoot, "click", "[data-add-period]", (_e, el) => {
        const i = Number(el.dataset.addPeriod);
        const pfx = `period_${i}_`;
        const g = (n) => modalRoot.querySelector(`[name="${pfx}${n}"]`);
        const name = (g("name").value || "").trim() || "Period";
        const start = g("start").value, end = g("end").value;
        S.insert("periods", { name, start, end });
        state.result.periods[i].added = true;
        UI.toast("Added to bell schedule", name, "ok");
        render();
      });
    }
  }

  return { open };
})();
