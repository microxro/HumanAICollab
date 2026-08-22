/* ==========================================================================
   aiadd.js — "Add with AI": describe a class/activity in your own words,
   paste a link to the page it's published on, or upload a photo, and review
   the draft before anything is saved.

   The link tab exists because most of this information is already on a
   website — the bell schedule, the athletics calendar, the exam timetable —
   and retyping it is the actual chore. The page is fetched by the server
   rather than the browser: a school website sends no CORS headers to this
   origin, so the browser is not allowed to read it, and a pasted URL needs
   screening against private addresses before anything requests it.

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

  const EVENT_TYPES = ["Exam", "Deadline", "Class", "Game", "Competition", "Meeting", "School", "Holiday", "Personal"];

  // The extractor's vocabulary and the calendar's are not the same list, so
  // map rather than trusting the model to guess the app's internal enum.
  const EVENT_TYPE_MAP = {
    Exam: "Exam", Deadline: "Deadline", Meeting: "Meeting", Holiday: "Holiday",
    Trip: "School", Sport: "Game", Performance: "Competition", Other: "Personal"
  };

  function eventRow(e, i) {
    const pfx = `event_${i}_`;
    const type = EVENT_TYPE_MAP[e.type] || "Personal";
    return `<div class="card mb-12" data-event="${i}" ${e.added ? 'data-added="1"' : ""}>
      <div class="card-body">
        <div class="form-grid">
          <div class="field full"><label for="${pfx}title">Event</label>
            <input class="input" id="${pfx}title" name="${pfx}title" value="${U.esc(e.title || "")}" ${e.added ? "disabled" : ""} /></div>
          <div class="field"><label for="${pfx}date">Date</label>
            <input class="input" type="date" id="${pfx}date" name="${pfx}date" value="${U.esc(e.date || "")}" ${e.added ? "disabled" : ""} /></div>
          <div class="field"><label for="${pfx}type">Type</label>
            <select class="select" id="${pfx}type" name="${pfx}type" ${e.added ? "disabled" : ""}>
              ${EVENT_TYPES.map((t) => `<option ${t === type ? "selected" : ""}>${t}</option>`).join("")}
            </select></div>
          <div class="field"><label for="${pfx}start">Starts</label>
            <input class="input" type="time" id="${pfx}start" name="${pfx}start" value="${U.esc(e.start || "")}" ${e.added ? "disabled" : ""} /></div>
          <div class="field"><label for="${pfx}end">Ends</label>
            <input class="input" type="time" id="${pfx}end" name="${pfx}end" value="${U.esc(e.end || "")}" ${e.added ? "disabled" : ""} /></div>
          <div class="field full"><label for="${pfx}location">Where</label>
            <input class="input" id="${pfx}location" name="${pfx}location" value="${U.esc(e.location || "")}" ${e.added ? "disabled" : ""} /></div>
          ${e.notes ? `<div class="field full"><label for="${pfx}notes">Notes</label>
            <input class="input" id="${pfx}notes" name="${pfx}notes" value="${U.esc(e.notes)}" ${e.added ? "disabled" : ""} /></div>` : ""}
        </div>
        <div class="row between mt-12">
          <span class="tiny dim">${e.date ? U.esc(U.fmtDate(e.date, "full")) : "No date found — add one before saving"}</span>
          ${e.added
            ? `<span class="tag" style="background:var(--ok-bg);color:var(--ok)">Added ✓</span>`
            : `<button type="button" class="btn btn-sm" data-add-event="${i}">Add</button>`}
        </div>
      </div>
    </div>`;
  }

  // Every parse can turn up both personal commitments and bell-schedule rows
  // — a school portal screenshot often shows both. `scope` decides which one
  // this particular modal is allowed to act on, matching where it was
  // opened from: Activities only ever writes activities, the Bell schedule
  // editor only ever writes periods. The other kind still gets mentioned
  // (so nothing silently vanishes), just not rendered as addable here.
  const SCOPE_COPY = {
    activities: {
      sub: "Describe an activity, paste a link, or upload a photo of your schedule — you'll review everything before it's saved.",
      placeholder: "e.g. I have swimming from 6-6:45pm every weekday starting September 5 through October 25",
      photoHint: "A screenshot of your class schedule — not the school's bell-times page.",
      linkHint: "A page listing a practice or club schedule.",
      linkPlaceholder: "yourschool.edu/athletics/schedule",
      entriesHeading: "Activities",
      kind: "schedule"
    },
    periods: {
      sub: "Describe your school's bell times, paste a link to them, or upload a photo — you'll review everything before it's saved.",
      placeholder: "e.g. Period 1: 8:00-8:50am, Period 2: 8:55-9:45am, Lunch: 11:00-11:35am…",
      photoHint: "A photo or screenshot of the bell/period times from your school's website — not your personal schedule.",
      linkHint: "The page on your school's website where the bell schedule is published.",
      linkPlaceholder: "yourschool.edu/bell-schedule",
      kind: "bell"
    },
    events: {
      sub: "Paste a link to a school calendar, athletics schedule or exam timetable — you'll review every event before it's saved.",
      placeholder: "e.g. Winter concert Dec 12 at 7pm in the auditorium, finals week Jan 13-17",
      photoHint: "A photo or screenshot of a calendar or schedule of dates.",
      linkHint: "A page listing dates — a school calendar, an athletics schedule, an exam timetable, or a single event page.",
      linkPlaceholder: "yourschool.edu/calendar",
      entriesHeading: "Events",
      kind: "events"
    }
  };

  const DEFAULT_LINK_HINT = "The page on your school's website where this is published.";

  function bodyHTML(state) {
    const copy = SCOPE_COPY[state.scope];
    const tabs = `<div class="segmented mb-12" role="group" aria-label="How to add">
      <button type="button" data-tab="link" class="${state.tab === "link" ? "active" : ""}"
        aria-pressed="${state.tab === "link"}">Paste a link</button>
      <button type="button" data-tab="text" class="${state.tab === "text" ? "active" : ""}"
        aria-pressed="${state.tab === "text"}">Describe it</button>
      <button type="button" data-tab="photo" class="${state.tab === "photo" ? "active" : ""}"
        aria-pressed="${state.tab === "photo"}">Upload a photo</button>
    </div>`;

    let inputArea;
    if (state.tab === "link") {
      inputArea = `<div class="field full">
          <label for="aiLinkUrl">Link to the page</label>
          <input class="input" type="url" id="aiLinkUrl" name="url" inputmode="url"
            placeholder="${U.esc(copy.linkPlaceholder || "yourschool.edu/page")}"
            value="${U.esc(state.url || "")}" ${state.busy ? "disabled" : ""} />
          <div class="tiny dim mt-4">${U.esc(copy.linkHint || DEFAULT_LINK_HINT)}</div>
        </div>
        <button type="button" class="btn btn-primary" data-parse-link ${state.busy ? "disabled" : ""}>
          ${state.busy ? "Reading the page…" : "Read the page"}
        </button>
        <p class="tiny dim mt-8" style="margin-bottom:0">
          The page has to be public — anything behind a school login can't be read from here.
        </p>`;
    } else if (state.tab === "text") {
      inputArea = `<div class="field full">
          <label for="aiDesc" class="sr-only">Describe it</label>
          <textarea class="input" id="aiDesc" name="desc" rows="3" placeholder="${U.esc(copy.placeholder)}">${U.esc(state.text || "")}</textarea>
        </div>
        <button type="button" class="btn btn-primary" data-parse-text ${state.busy ? "disabled" : ""}>
          ${state.busy ? "Reading it now…" : "Figure it out"}
        </button>`;
    } else {
      inputArea = `<div class="field full">
          <label for="aiPhoto" class="sr-only">Upload a photo</label>
          <input class="input" type="file" accept="image/*" id="aiPhoto" name="photo" data-photo-input />
          <div class="tiny dim mt-4">${U.esc(copy.photoHint)}</div>
        </div>
        <button type="button" class="btn btn-primary" data-parse-photo ${state.busy ? "disabled" : ""}>
          ${state.busy ? "Reading it now…" : "Figure it out"}
        </button>`;
    }

    let resultHTML = "";
    if (state.error) {
      // The same rule as everywhere else here: show what the server actually
      // read. A bare "couldn't read that" leaves the student unable to tell a
      // wrong link from a page that renders itself with JavaScript.
      const src = state.errorSource;
      const cands = (src && src.candidates) || [];
      resultHTML = `<div class="callout warn mt-16">
        <strong>${U.esc(state.error)}</strong>
        ${src && src.chars != null ? `<p class="small" style="margin:8px 0 0">
          Read ${src.chars.toLocaleString()} characters${src.title ? ` from “${U.esc(src.title)}”` : ""}.</p>` : ""}
        ${src && src.sample ? `<details style="margin-top:8px">
          <summary class="small" style="cursor:pointer">Show what it actually read</summary>
          <pre class="read-sample">${U.esc(src.sample)}</pre>
        </details>` : ""}
        ${cands.length ? `<div style="margin-top:10px">
          <div class="small bold">Other links on that page</div>
          <div class="col gap-4" style="margin-top:6px">
            ${cands.map((c) => `<button type="button" class="btn btn-sm link-candidate" data-try-link="${U.esc(c.url)}">
              ${c.pdf ? `<span class="tag">PDF</span> ` : ""}${U.esc(c.text)}
            </button>`).join("")}
          </div>
        </div>` : ""}
        <p class="small" style="margin:10px 0 0">
          Or switch to <strong>Describe it</strong> and paste the text straight in — that always works.
        </p>
      </div>`;
    } else if (state.result) {
      const r = state.result;
      const entries = r.entries || [], periods = r.periods || [], events = r.events || [];
      const showEntries = state.scope === "activities" && entries.length;
      const showPeriods = state.scope === "periods" && periods.length;
      const showEvents  = state.scope === "events" && events.length;

      const otherFound = state.scope === "activities" ? periods.length
        : state.scope === "periods" ? entries.length : 0;
      const otherLabel = state.scope === "activities"
        ? `${U.plural(periods.length, "bell-schedule period")} — open the Bell schedule editor (Classes page) to add ${periods.length === 1 ? "it" : "them"}.`
        : `${U.plural(entries.length, "activity", "activities")} — open Activities to add ${entries.length === 1 ? "it" : "them"}.`;

      // "Add all" is the whole point of reading a page: a bell schedule is
      // eight rows and clicking Add eight times is the chore this replaces.
      // It stays alongside the per-row buttons rather than replacing them,
      // because a page that read nine periods correctly and one wrongly is
      // the common case, and the row-level control is what makes that
      // recoverable without redoing the whole import.
      const addAll = (kind, remaining, noun) => remaining > 1
        ? `<div class="row between wrap gap-8 mb-8">
             <span class="tiny dim">${U.esc(U.plural(remaining, noun))} ready to add</span>
             <button type="button" class="btn btn-sm btn-primary" data-add-all="${kind}">Add all ${remaining}</button>
           </div>`
        : "";

      const src = state.result.source;
      resultHTML = `<div class="mt-16">
        ${src ? `<p class="tiny dim">Read from <span class="truncate">${U.esc(src.title || src.url)}</span></p>` : ""}
        ${r.summary ? `<p class="small">${U.esc(r.summary)}</p>` : ""}
        ${r.clarify ? `<p class="small" style="color:var(--warn)">${U.esc(r.clarify)}</p>` : ""}
        ${otherFound ? `<p class="small dim">This also mentioned ${otherLabel}</p>` : ""}

        ${showEntries ? `<h4 class="mt-12 mb-8">${U.esc(copy.entriesHeading)}</h4>
          ${addAll("entries", entries.filter((e) => !e.added).length, "activity", "activities")}
          ${entries.map(entryCard).join("")}` : ""}

        ${showPeriods ? `<h4 class="mt-12 mb-8">Bell schedule</h4>
          <p class="tiny dim mb-8">These are added to your existing bell schedule, not used to replace it.</p>
          ${addAll("periods", periods.filter((p) => !p.added).length, "period")}
          ${periods.map(periodRow).join("")}` : ""}

        ${showEvents ? `<h4 class="mt-12 mb-8">${U.esc(copy.entriesHeading)}</h4>
          ${addAll("events", events.filter((e) => !e.added && e.date).length, "event")}
          ${events.map(eventRow).join("")}` : ""}

        ${!showEntries && !showPeriods && !showEvents && !otherFound
          ? `<p class="small dim">Nothing recognizable came out of that — try rephrasing, a clearer photo, or a more specific link.</p>` : ""}
      </div>`;
    }

    return `${tabs}${inputArea}${resultHTML}`;
  }

  function open(opts) {
    // The AI routes need an account (shared provider quota). Fail here with a
    // route to the fix rather than letting someone type a description, upload
    // a photo, and only then hit a 401.
    if (!App.assistant.available()) {
      UI.modal({
        title: "Sign in to use AI",
        size: "narrow",
        body: `<p class="muted">Adding things with AI runs on a shared quota, so it's tied to an account.
          You can still add everything by hand — the manual form has all the same fields.</p>`,
        footer: `<button type="button" class="btn" data-close>Close</button>
                 <button type="button" class="btn btn-primary" data-go-settings>Go to sign in</button>`,
        onMount(root) {
          root.querySelector("[data-go-settings]").addEventListener("click", () => {
            UI.closeModal();
            App.router.go("settings");
          });
        }
      });
      return;
    }

    const scope = SCOPE_COPY[opts && opts.scope] ? opts.scope : "activities";
    const state = {
      scope,
      // Link-first for the two kinds that are almost always published on a
      // website — a bell schedule and a school calendar. Activities stay
      // text-first: "swimming 6-6:45 weekdays" is the normal case there, and
      // a practice schedule rarely has a page of its own.
      tab: (opts && opts.tab) || (scope === "activities" ? "text" : "link"),
      text: "", url: "", busy: false, result: null, error: null, photoFile: null
    };

    const root = UI.modal({
      title: scope === "periods" ? "Add bell schedule with AI"
        : scope === "events" ? "Add events with AI" : "Add with AI",
      sub: SCOPE_COPY[scope].sub,
      size: "wide",
      footer: `<button type="button" class="btn btn-primary" data-close>Done</button>`,
      body: bodyHTML(state),
      onMount(modalRoot) { bind(modalRoot); }
    });

    function render() {
      root.querySelector(".modal-body").innerHTML = bodyHTML(state);
    }

    // Three routes return three shapes; the renderer wants one. Normalising
    // here rather than at each call site is what lets the link tab reuse the
    // whole review-and-add flow the photo tab already had.
    function absorb(r) {
      state.result = {
        ...r,
        entries: (r.entries || []).map((e) => ({ ...e, added: false })),
        periods: (r.periods || []).map((p) => ({ ...p, added: false })),
        events: (r.events || []).map((e) => ({ ...e, added: false }))
      };
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
        state.busy = true; state.error = null; state.errorSource = null; render();
        try {
          const r = await App.assistant.parseText(state.text);
          absorb(r);
        } catch (e) {
          state.error = e.message;
        }
        state.busy = false; render();
      });

      U.on(modalRoot, "click", "[data-parse-photo]", async () => {
        const input = modalRoot.querySelector("[data-photo-input]");
        const file = input && input.files && input.files[0];
        if (!file) { state.error = "Choose a photo first."; render(); return; }
        state.busy = true; state.error = null; state.errorSource = null; render();
        try {
          const r = await App.assistant.parseImage(file);
          absorb(r);
        } catch (e) {
          state.error = e.message;
        }
        state.busy = false; render();
      });

      U.on(modalRoot, "click", "[data-parse-link]", async () => {
        const input = modalRoot.querySelector('[name="url"]');
        state.url = input ? input.value.trim() : "";
        if (!state.url) { state.error = "Paste a link first."; render(); return; }
        state.busy = true; state.error = null; state.errorSource = null; render();
        try {
          absorb(await App.assistant.fromUrl(state.url, SCOPE_COPY[state.scope].kind || "schedule"));
        } catch (e) {
          state.error = e.message;
          state.errorSource = e.source || null;
        }
        state.busy = false; render();
      });

      // Enter in the URL field should read the page — it is the only control
      // that matters on that tab, and a URL field people paste into is
      // exactly where they expect Enter to submit.
      U.on(modalRoot, "keydown", '[name="url"]', (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const btn = modalRoot.querySelector("[data-parse-link]");
        if (btn && !btn.disabled) btn.click();
      });

      // A candidate link refills the field and re-reads, so recovering from
      // an index page is one click.
      U.on(modalRoot, "click", "[data-try-link]", (_e, el) => {
        state.url = el.dataset.tryLink;
        state.tab = "link";
        render();
        const btn = modalRoot.querySelector("[data-parse-link]");
        if (btn) btn.click();
      });

      U.on(modalRoot, "click", "[data-add-all]", (_e, el) => {
        const kind = el.dataset.addAll;
        const sel = { entries: "[data-add-entry]", periods: "[data-add-period]", events: "[data-add-event]" }[kind];
        if (!sel) return;
        // Snapshot the indices first. Each add re-renders, so walking a live
        // NodeList would lose its place after the first click.
        const idxAttr = { entries: "addEntry", periods: "addPeriod", events: "addEvent" }[kind];
        const indices = [...modalRoot.querySelectorAll(sel)].map((b) => Number(b.dataset[idxAttr]));
        let added = 0, skipped = 0;
        indices.forEach((i) => { if (addOne(kind, i, true)) added++; else skipped++; });
        render();
        if (added) {
          UI.toast(`Added ${U.plural(added, kind === "periods" ? "period" : kind === "events" ? "event" : "activity", kind === "entries" ? "activities" : undefined)}`,
            skipped ? `${skipped} skipped — fill those in and add them individually.` : "", "ok");
        } else {
          UI.toast("Nothing added", "Each of these is missing something required.", "warn");
        }
      });

      U.on(modalRoot, "click", "[data-add-event]", (_e, el) => {
        const i = Number(el.dataset.addEvent);
        if (addOne("events", i)) render();
      });

      /**
       * Save one extracted row. `quiet` suppresses the per-row toast so
       * "Add all" reports once instead of nine times. Returns false when the
       * row is missing something required, which is what lets Add all report
       * an honest partial result rather than silently dropping rows.
       */
      function addOne(kind, i, quiet) {
        const g = (pfx, n) => modalRoot.querySelector(`[name="${pfx}${n}"]`);

        if (kind === "entries") {
          const draft = readEntry(i);
          if (!draft.days.length) {
            if (!quiet) UI.toast("Pick at least one day", draft.name, "warn");
            return false;
          }
          S.insert("activities", {
            name: draft.name, type: draft.type, role: "", advisorId: null,
            location: draft.location, start: draft.start, end: draft.end,
            season: "AI add", color: S.PALETTE[i % S.PALETTE.length],
            days: draft.days, startDate: draft.startDate, endDate: draft.endDate, hours: []
          });
          state.result.entries[i].added = true;
          if (!quiet) UI.toast("Added", draft.name, "ok");
          return true;
        }

        if (kind === "periods") {
          const pfx = `period_${i}_`;
          const name = (g(pfx, "name").value || "").trim() || "Period";
          const start = g(pfx, "start").value, end = g(pfx, "end").value;
          if (!start || !end) {
            if (!quiet) UI.toast("Needs a start and end time", name, "warn");
            return false;
          }
          S.insert("periods", { name, start, end });
          state.result.periods[i].added = true;
          if (!quiet) UI.toast("Added to bell schedule", name, "ok");
          return true;
        }

        if (kind === "events") {
          const pfx = `event_${i}_`;
          const title = (g(pfx, "title").value || "").trim();
          const date = g(pfx, "date").value;
          if (!title || !date) {
            if (!quiet) UI.toast("Needs a title and a date", title || "Untitled", "warn");
            return false;
          }
          const notesEl = g(pfx, "notes");
          S.insert("events", {
            title, date,
            type: g(pfx, "type").value || "Personal",
            start: g(pfx, "start").value || "",
            end: g(pfx, "end").value || "",
            classId: null,
            location: (g(pfx, "location").value || "").trim(),
            notes: notesEl ? notesEl.value.trim() : ""
          });
          state.result.events[i].added = true;
          if (!quiet) UI.toast("Event added", `${title} · ${U.fmtDate(date)}`, "ok");
          return true;
        }
        return false;
      }

      U.on(modalRoot, "click", "[data-daybtn]", (_e, el) => {
        const [idx, day] = el.dataset.daybtn.split(":");
        const e = state.result.entries[Number(idx)];
        if (e.days.includes(day)) e.days = e.days.filter((d) => d !== day);
        else e.days.push(day);
        el.classList.toggle("active");
      });

      U.on(modalRoot, "click", "[data-add-entry]", (_e, el) => {
        if (addOne("entries", Number(el.dataset.addEntry))) render();
      });

      U.on(modalRoot, "click", "[data-add-period]", (_e, el) => {
        if (addOne("periods", Number(el.dataset.addPeriod))) render();
      });
    }
  }

  return { open };
})();
