/* ==========================================================================
   views/calendar.js — month grid + agenda, with event CRUD
   ========================================================================== */

App.views.calendar = (function () {
  const U = App.utils, S = App.store, UI = App.ui;

  let cursor = new Date();          // any date inside the displayed month
  let mode = "month";               // month | agenda

  const TYPES = ["Exam", "Deadline", "Class", "Game", "Competition", "Meeting", "School", "Holiday", "Personal"];

  /* --------------------------------------------------------- item feed -- */

  // Everything that should appear on a given date: events, due assignments,
  // and (in agenda mode) the day's classes/activities.
  function itemsOn(iso, includeSchedule) {
    const out = [];

    S.db.events.filter((e) => e.date === iso).forEach((e) => out.push({
      kind: "event", id: e.id, title: e.title, start: e.start,
      color: e.classId ? S.classColor(e.classId) : "#64748b",
      sub: e.type, location: e.location
    }));

    S.db.assignments.filter((a) => a.due === iso).forEach((a) => out.push({
      kind: "due", id: a.id, title: a.title, start: "",
      color: S.classColor(a.classId),
      sub: (a.status === "done" ? "✓ " : "Due · ") + S.className(a.classId),
      done: a.status === "done"
    }));

    if (includeSchedule) {
      S.scheduleFor(iso).filter((x) => x.kind !== "event").forEach((x) => out.push({
        kind: x.kind, id: x.id, title: x.title, start: x.start,
        color: x.color, sub: x.sub, location: x.location
      }));
    }

    return out.sort((a, b) => (U.toMin(a.start) || 9999) - (U.toMin(b.start) || 9999));
  }

  /* ------------------------------------------------------------- forms -- */

  function eventForm(ev, presetDate) {
    const e = ev || {};
    UI.modal({
      title: ev ? "Edit event" : "New event",
      size: "wide",
      okLabel: ev ? "Save" : "Add event",
      footer: ev ? `<button type="button" class="btn btn-danger left" data-del>Delete</button>
                    <button type="button" class="btn" data-close>Cancel</button>
                    <button type="submit" class="btn btn-primary">Save</button>` : undefined,
      body: `<div class="form-grid">
        <div class="field full">
          <label>Title</label>
          <input class="input" name="title" required value="${U.esc(e.title || "")}" placeholder="e.g. Biology midterm" />
        </div>
        <div class="field">
          <label>Type</label>
          <select class="select" name="type">
            ${TYPES.map((t) => `<option ${t === (e.type || "Personal") ? "selected" : ""}>${t}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Date</label>
          <input class="input" type="date" name="date" required value="${e.date || presetDate || U.today()}" />
        </div>
        <div class="field">
          <label>Start time</label>
          <input class="input" type="time" name="start" value="${e.start || ""}" />
        </div>
        <div class="field">
          <label>End time</label>
          <input class="input" type="time" name="end" value="${e.end || ""}" />
        </div>
        <div class="field">
          <label>Class</label>
          <select class="select" name="classId">${UI.classOptions(e.classId, true)}</select>
        </div>
        <div class="field">
          <label>Location</label>
          <input class="input" name="location" value="${U.esc(e.location || "")}" placeholder="Rm 204" />
        </div>
        <div class="field full">
          <label>Notes</label>
          <textarea class="textarea" name="notes" rows="2" placeholder="Anything to remember">${U.esc(e.notes || "")}</textarea>
        </div>
      </div>`,
      onMount(root) {
        const del = root.querySelector("[data-del]");
        if (del) del.addEventListener("click", () => {
          UI.closeModal();
          S.remove("events", ev.id);
          UI.toast("Event deleted", ev.title, "warn");
        });
      },
      onSubmit(d) {
        if (!d.title.trim()) return false;
        const patch = {
          title: d.title.trim(), type: d.type, date: d.date,
          start: d.start, end: d.end, classId: d.classId || null,
          location: d.location.trim(), notes: d.notes.trim()
        };
        if (ev) { S.update("events", ev.id, patch); UI.toast("Event updated", patch.title); }
        else { S.insert("events", patch); UI.toast("Event added", `${patch.title} · ${U.fmtDate(patch.date)}`, "ok"); }
      }
    });
  }

  function dayDetail(iso) {
    const items = itemsOn(iso, true);
    UI.modal({
      title: U.fmtDate(iso, "long"),
      sub: `${U.plural(items.length, "item")} scheduled`,
      footer: `<button type="button" class="btn left btn-primary" data-new>+ Add event</button>
               <button type="button" class="btn" data-close>Close</button>`,
      body: items.length ? `<div class="list">${items.map((it) => `
          <div class="list-item" ${it.kind === "event" ? `data-ev="${it.id}" style="cursor:pointer"` : ""}>
            <span class="hw-stripe" style="background:${U.esc(it.color)}"></span>
            <span class="mono dim" style="width:74px;flex-shrink:0;font-size:.74rem">${it.start ? U.fmtTime(it.start) : "—"}</span>
            <span class="grow" style="min-width:0">
              <div class="title truncate" style="${it.done ? "text-decoration:line-through;opacity:.6" : ""}">${U.esc(it.title)}</div>
              <div class="meta truncate">${U.esc([it.sub, it.location].filter(Boolean).join(" · "))}</div>
            </span>
            <span class="badge">${U.esc(it.kind)}</span>
          </div>`).join("")}</div>`
        : UI.emptyState("📭", "Nothing on this day", "Add an event to fill it in."),
      onMount(root) {
        root.querySelector("[data-new]").addEventListener("click", () => { UI.closeModal(); eventForm(null, iso); });
        U.on(root, "click", "[data-ev]", (_e, el) => {
          const ev = S.byId("events", el.dataset.ev);
          if (ev) { UI.closeModal(); eventForm(ev); }
        });
      }
    });
  }

  /* ------------------------------------------------------------ months -- */

  function monthGrid() {
    const y = cursor.getFullYear(), m = cursor.getMonth();
    const first = new Date(y, m, 1);
    const startsMon = S.settings.weekStartsMonday;
    const gridStart = U.startOfWeek(first, startsMon);
    const dow = startsMon ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
                          : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const today = U.today();

    let cells = "";
    for (let i = 0; i < 42; i++) {
      const d = U.addDays(gridStart, i);
      const iso = U.dateKey(d);
      const other = d.getMonth() !== m;
      const items = itemsOn(iso, false);
      const shown = items.slice(0, 3);

      cells += `<div class="cal-day ${other ? "dim" : ""} ${iso === today ? "today" : ""}" data-day="${iso}">
        <span class="cal-num">${d.getDate()}</span>
        ${shown.map((it) => `<span class="cal-pill" style="background:${U.esc(it.color)};color:${U.contrastText(it.color)}"
              title="${U.esc(it.title)}">${U.esc(it.title)}</span>`).join("")}
        ${items.length > 3 ? `<span class="cal-pill more">+${items.length - 3} more</span>` : ""}
      </div>`;
    }

    return `<div class="cal-grid">
      ${dow.map((d) => `<div class="cal-dow">${d}</div>`).join("")}
      ${cells}
    </div>`;
  }

  function agenda() {
    const out = [];
    for (let i = 0; i < 21; i++) {
      const iso = U.dateKey(U.addDays(new Date(), i));
      const items = itemsOn(iso, true);
      if (!items.length) continue;
      out.push(`<div class="agenda-day">
        <div class="agenda-date ${iso === U.today() ? "is-today" : ""}">
          <span class="dnum">${U.parseDate(iso).getDate()}</span>
          <span>${U.dowName(iso, true)}, ${U.fmtDate(iso)}</span>
          ${iso === U.today() ? `<span class="badge solid">Today</span>` : ""}
        </div>
        ${items.map((it) => `<div class="agenda-row" ${it.kind === "event" ? `data-ev="${it.id}" style="cursor:pointer"` : ""}>
          <span class="agenda-stripe" style="background:${U.esc(it.color)}"></span>
          <span class="agenda-time">${it.start ? U.fmtTime(it.start) : "All day"}</span>
          <span class="grow" style="min-width:0">
            <div class="bold small truncate" style="${it.done ? "text-decoration:line-through;opacity:.6" : ""}">${U.esc(it.title)}</div>
            <div class="tiny dim truncate">${U.esc([it.sub, it.location].filter(Boolean).join(" · "))}</div>
          </span>
          <span class="badge">${U.esc(it.kind)}</span>
        </div>`).join("")}
      </div>`);
    }
    return out.length ? out.join("") :
      UI.emptyState("🗓️", "Nothing in the next three weeks", "Add an event to get started.");
  }

  /* ------------------------------------------------------------ render -- */

  function render() {
    const label = `${U.MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;
    const monthEvents = S.db.events.filter((e) => {
      const d = U.parseDate(e.date);
      return d.getMonth() === cursor.getMonth() && d.getFullYear() === cursor.getFullYear();
    }).length;

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>Calendar</h1>
          <div class="sub">${U.plural(monthEvents, "event")} in ${label} ·
            classes, deadlines, and activities in one place</div>
        </div>
        <div class="page-actions">
          <div class="segmented">
            <button class="${mode === "month" ? "active" : ""}" data-mode="month">Month</button>
            <button class="${mode === "agenda" ? "active" : ""}" data-mode="agenda">Agenda</button>
          </div>
          <button class="btn btn-primary" data-new>+ New event</button>
        </div>
      </div>

      ${mode === "month" ? `
        <div class="between mb-12">
          <div class="row gap-6">
            <button class="icon-btn" data-nav="-1" aria-label="Previous month">‹</button>
            <button class="btn btn-sm" data-nav="0">Today</button>
            <button class="icon-btn" data-nav="1" aria-label="Next month">›</button>
          </div>
          <h2>${U.esc(label)}</h2>
          <span style="width:120px"></span>
        </div>
        ${monthGrid()}
        <p class="tiny dim mt-12">Assignment due dates appear automatically — add or edit them from the Homework tab.</p>
      ` : `<div class="card"><div class="card-body">${agenda()}</div></div>`}
    </div>`;
  }

  function mount(root) {
    U.on(root, "click", "[data-mode]", (_e, el) => { mode = el.dataset.mode; App.router.refresh(); });
    U.on(root, "click", "[data-nav]", (_e, el) => {
      const n = Number(el.dataset.nav);
      if (n === 0) cursor = new Date();
      else cursor = new Date(cursor.getFullYear(), cursor.getMonth() + n, 1);
      App.router.refresh();
    });
    U.on(root, "click", "[data-new]", () => eventForm(null));
    U.on(root, "click", "[data-day]", (_e, el) => dayDetail(el.dataset.day));
    U.on(root, "click", "[data-ev]", (_e, el) => {
      const ev = S.byId("events", el.dataset.ev);
      if (ev) eventForm(ev);
    });
  }

  return { render, mount, eventForm, title: "Calendar" };
})();
