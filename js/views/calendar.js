/* ==========================================================================
   views/calendar.js — month grid + agenda, with event CRUD
   ========================================================================== */

App.views.calendar = (function () {
  const U = App.utils, S = App.store, UI = App.ui;

  let cursor = new Date();          // any date inside the displayed month/week
  let mode = "month";               // month | week | agenda

  const TYPES = ["Exam", "Deadline", "Class", "Game", "Competition", "Meeting", "School", "Holiday", "Personal"];

  /* --------------------------------------------------------- item feed -- */

  // Everything that should appear on a given date: events, due assignments,
  // and (in agenda mode) the day's classes/activities.
  function itemsOn(iso, includeSchedule) {
    const out = [];

    S.db.events.filter((e) => e.date === iso).forEach((e) => out.push({
      kind: "event", id: e.id, title: e.title, start: e.start, end: e.end,
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

    // `U.toMin("00:00")` is 0, which is falsy — so a midnight item took the
    // 9999 fallback and sorted *after* everything later in the day. Only a
    // genuinely missing start time should sort last, and store.js sorts the
    // same records the other way, so the two views disagreed.
    const at = (t) => {
      const m = U.toMin(t);
      return (t && Number.isFinite(m)) ? m : 9999;
    };
    return out.sort((a, b) => at(a.start) - at(b.start));
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
        ${!ev ? `<div class="field"><label>Repeats <span class="hint">weekly club meetings, standing appointments</span></label>
          <select class="select" name="repeat">
            <option value="">Doesn't repeat</option>
            <option value="1">Every week</option>
            <option value="2">Every 2 weeks</option>
          </select></div>
        <div class="field"><label>Until</label>
          <input class="input" type="date" name="repeatUntil" value="${U.dateKey(U.addDays(new Date(), 84))}" /></div>` : ""}   // F048
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
        else {
          const weeks = Number(d.repeat) || 0;
          if (weeks) {
            // Two failures lived here. With "Until" cleared, `iso <= ""` is
            // false so the loop never ran and the toast cheerfully reported
            // "0 occurrences" while creating nothing. With a far-future
            // "Until", it ran thousands of times, each iteration a full
            // JSON.stringify of the database plus a repaint — the tab hung
            // for minutes and then hit the storage-quota path.
            const until = String(d.repeatUntil || "").trim();
            if (!until) {
              UI.toast("Pick an end date", "A repeating event needs an \u201cUntil\u201d date.", "danger");
              return false;
            }
            if (until < patch.date) {
              UI.toast("Check the dates", "The end date is before the first occurrence.", "danger");
              return false;
            }

            const MAX_OCCURRENCES = 200;
            const dates = [];
            let iso = patch.date;
            while (iso <= until && dates.length < MAX_OCCURRENCES) {
              dates.push(iso);
              iso = U.dateKey(U.addDays(U.parseDate(iso), weeks * 7));
            }
            const capped = iso <= until;

            // One commit for the whole series rather than one per occurrence.
            S.commit((db) => {
              dates.forEach((date) => {
                db.events.push({ ...patch, id: U.uid("ev"), date });
              });
            });
            UI.toast("Recurring event added",
              capped
                ? `${dates.length} occurrences added (stopped at the ${MAX_OCCURRENCES} limit)`
                : `${dates.length} occurrences through ${U.fmtDate(until)}`,
              capped ? "warn" : "ok");
          } else {
            S.insert("events", patch);
            UI.toast("Event added", `${patch.title} · ${U.fmtDate(patch.date)}`, "ok");
          }
        }
      }
    });
  }

  // F044 — pairs of movable events (not fixed classes/activities) whose
  // time ranges overlap, each with a one-click fix.
  function findConflicts(items) {
    const events = items.filter((it) => it.kind === "event" && it.start && it.end);
    const out = [];
    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        const a = events[i], b = events[j];
        if (U.toMin(a.start) < U.toMin(b.end) && U.toMin(b.start) < U.toMin(a.end)) out.push([a, b]);
      }
    }
    return out;
  }

  function dayDetail(iso) {
    const items = itemsOn(iso, true);
    const conflicts = findConflicts(items);
    UI.modal({
      title: U.fmtDate(iso, "long"),
      sub: `${U.plural(items.length, "item")} scheduled`,
      footer: `<button type="button" class="btn left btn-primary" data-new>+ Add event</button>
               <button type="button" class="btn" data-close>Close</button>`,
      body: `${conflicts.length ? `<div class="conflict-banner mb-12">
          <div class="bold small mb-4">⚠ ${U.plural(conflicts.length, "scheduling conflict")}</div>
          ${conflicts.map(([a, b]) => `<div class="row gap-8 wrap mb-4" style="align-items:center">
            <span class="small">${U.esc(a.title)} overlaps ${U.esc(b.title)}</span>
            <button class="btn btn-sm" data-resolve="${b.id}" data-after="${a.end}">Move "${U.esc(b.title)}" to ${U.esc(U.fmtTime(a.end))}</button>
          </div>`).join("")}
        </div>` : ""}
        ${items.length ? `<div class="list">${items.map((it) => `
          <div class="list-item" ${it.kind === "event" ? `data-ev="${it.id}" style="cursor:pointer"` : ""}>
            <span class="hw-stripe" style="background:${U.esc(it.color)}"></span>
            <span class="mono dim" style="width:74px;flex-shrink:0;font-size:.74rem">${it.start ? U.fmtTime(it.start) : "—"}</span>
            <span class="grow" style="min-width:0">
              <div class="title truncate" style="${it.done ? "text-decoration:line-through;opacity:.6" : ""}">${U.esc(it.title)}</div>
              <div class="meta truncate">${U.esc([it.sub, it.location].filter(Boolean).join(" · "))}</div>
            </span>
            <span class="badge">${U.esc(it.kind)}</span>
          </div>`).join("")}</div>`
        : UI.emptyState("eventsToday", "Nothing on this day", "Add an event to fill it in.")}`,
      onMount(root) {
        root.querySelector("[data-new]").addEventListener("click", () => { UI.closeModal(); eventForm(null, iso); });
        U.on(root, "click", "[data-ev]", (_e, el) => {
          const ev = S.byId("events", el.dataset.ev);
          if (ev) { UI.closeModal(); eventForm(ev); }
        });
        U.on(root, "click", "[data-resolve]", (_e, el) => {
          const ev = S.byId("events", el.dataset.resolve);
          if (!ev) return;
          const dur = ev.end && ev.start ? U.toMin(ev.end) - U.toMin(ev.start) : 30;
          const newStart = el.dataset.after;
          S.update("events", ev.id, { start: newStart, end: U.fromMin(U.toMin(newStart) + dur) });
          UI.toast("Moved", `${ev.title} now starts at ${U.fmtTime(newStart)}`, "ok");
          UI.closeModal();
          dayDetail(iso);
        });
      }
    });
  }

  /* ------------------------------------------------------------ months -- */

  // U40 — how much is due that day, shaded so a crunch week is visible
  // before you open a single one of them.
  function dayLoadMinutes(iso) {
    return U.sum(S.db.assignments.filter((a) => a.due === iso && a.status !== "done"), (a) => a.estMinutes || 0);
  }
  function loadLevel(mins) {
    if (mins <= 0) return 0;
    if (mins <= 30) return 1;
    if (mins <= 90) return 2;
    if (mins <= 180) return 3;
    return 4;
  }

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
      // Classes and activities used to be left out of the month grid entirely
      // (only events and due dates showed) — a fully-booked day looked empty
      // while the exact same day in Week view showed everything. Due items
      // are pulled to the front of what's shown: on a busy day, a due date
      // matters more than which slot fills the "+N more" cutoff.
      const items = itemsOn(iso, true);
      const due = items.filter((it) => it.kind === "due");
      const rest = items.filter((it) => it.kind !== "due");
      const shown = due.concat(rest).slice(0, 3);
      const load = dayLoadMinutes(iso);
      const lv = loadLevel(load);

      cells += `<div class="cal-day ${other ? "dim" : ""} ${iso === today ? "today" : ""}" data-day="${iso}"
                     data-load="${lv}" ${lv ? `title="${U.esc(U.fmtDur(load))} of work due"` : ""}>
        <span class="cal-num">${d.getDate()}</span>
        ${lv >= 3 ? `<span class="cal-load-chip">${U.esc(U.fmtDur(load))}</span>` : ""}
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

  /* -------------------------------------------------------------- week -- */

  /**
   * Assign each timed item a column so overlapping events sit side by side
   * instead of hiding one another. Items are grouped into clusters of mutually
   * overlapping events; every item in a cluster shares the same column count,
   * which keeps their widths aligned.
   */
  function layoutOverlaps(items) {
    const sorted = U.sortBy(items, (i) => U.toMin(i.start));
    const out = [];
    let cluster = [];
    let clusterEnd = -1;

    const flush = () => {
      if (!cluster.length) return;
      // Greedy column packing within the cluster.
      const columns = [];
      cluster.forEach((it) => {
        const s = U.toMin(it.start), e = U.toMin(it.end);
        let placed = false;
        for (let c = 0; c < columns.length; c++) {
          if (columns[c] <= s) { columns[c] = e; it._col = c; placed = true; break; }
        }
        if (!placed) { it._col = columns.length; columns.push(e); }
      });
      const cols = Math.max(1, columns.length);
      cluster.forEach((it) => out.push({ it, col: it._col, cols }));
      cluster = [];
      clusterEnd = -1;
    };

    sorted.forEach((it) => {
      const s = U.toMin(it.start), e = U.toMin(it.end);
      if (cluster.length && s >= clusterEnd) flush();
      cluster.push(it);
      clusterEnd = Math.max(clusterEnd, e);
    });
    flush();
    return out;
  }

  /**
   * Time-grid week view. Classes, activities, and events are positioned by
   * clock time; scheduled study sessions from the planner appear as hatched
   * blocks you can drag onto a different day.
   */
  function weekGrid() {
    const startsMon = S.settings.weekStartsMonday;
    const weekStart = U.startOfWeek(cursor, startsMon);
    const days = Array.from({ length: 7 }, (_, i) => U.dateKey(U.addDays(weekStart, i)));
    const today = U.today();

    // Bound the grid to whatever actually happens that week.
    let minMin = 8 * 60, maxMin = 18 * 60;
    days.forEach((iso) => {
      S.scheduleFor(iso).forEach((it) => {
        if (!it.start) return;
        minMin = Math.min(minMin, U.toMin(it.start));
        maxMin = Math.max(maxMin, U.toMin(it.end || it.start) + 30);
      });
      S.db.assignments.filter((a) => a.scheduledFor === iso && a.scheduledMin != null).forEach((a) => {
        minMin = Math.min(minMin, a.scheduledMin);
        maxMin = Math.max(maxMin, a.scheduledMin + (a.estMinutes || 30));
      });
    });
    minMin = Math.floor(minMin / 60) * 60;
    maxMin = Math.ceil(maxMin / 60) * 60;
    const span = Math.max(60, maxMin - minMin);
    const PX_PER_MIN = 0.85;
    const height = span * PX_PER_MIN;

    const hours = [];
    for (let m = minMin; m <= maxMin; m += 60) hours.push(m);

    const nowMin = U.nowMin();
    const showNow = days.includes(today) && nowMin >= minMin && nowMin <= maxMin;

    return `<div class="week-wrap">
      <div class="week-grid" style="--wk-h:${height}px">
        <div class="week-corner"></div>
        ${days.map((iso) => {
          const d = U.parseDate(iso);
          const cd = S.cycleDayFor(iso);
          return `<div class="week-head ${iso === today ? "is-today" : ""}" data-day="${iso}">
            <div class="tiny dim">${U.DOW_SHORT[d.getDay()]}</div>
            <div class="week-num">${d.getDate()}</div>
            ${cd ? `<span class="badge brand" style="font-size:.6rem">Day ${cd}</span>` : ""}
          </div>`;
        }).join("")}

        <div class="week-gutter">
          ${hours.map((m) => `<div class="week-hour" style="top:${(m - minMin) * PX_PER_MIN}px">
            ${U.fmtTime(U.fromMin(m))}</div>`).join("")}
        </div>

        ${days.map((iso) => {
          const items = S.scheduleFor(iso).filter((it) => it.start && it.end);
          const planned = S.db.assignments.filter((a) => a.scheduledFor === iso && a.scheduledMin != null);
          const allDay = S.db.events.filter((e) => e.date === iso && !e.start);
          const dueItems = S.db.assignments.filter((a) => a.due === iso);

          return `<div class="week-col ${iso === today ? "is-today" : ""}" data-drop-day="${iso}">
            ${hours.map((m) => `<div class="week-line" style="top:${(m - minMin) * PX_PER_MIN}px"></div>`).join("")}

            ${showNow && iso === today
              ? `<div class="week-now" style="top:${(nowMin - minMin) * PX_PER_MIN}px"></div>` : ""}

            ${layoutOverlaps(items).map(({ it, col, cols }) => {
              const top = (U.toMin(it.start) - minMin) * PX_PER_MIN;
              const h = Math.max(18, (U.toMin(it.end) - U.toMin(it.start)) * PX_PER_MIN);
              const fg = U.contrastText(it.color);
              // Side-by-side when two things genuinely clash, so neither hides.
              const width = `calc((100% - 6px) / ${cols})`;
              const left = `calc(3px + (100% - 6px) * ${col} / ${cols})`;
              return `<div class="week-ev" style="top:${top}px;height:${h}px;left:${left};width:${width};right:auto;
                           background:${U.esc(it.color)};color:${fg}"
                           title="${U.esc(it.title)} · ${U.fmtTime(it.start)}–${U.fmtTime(it.end)}"
                           ${it.kind === "event" ? `data-ev="${it.id}"`
                             : (it.kind === "class" || it.kind === "extra") ? `data-class="${it.id}"` : ""}>
                <div class="truncate bold">${U.esc(it.title)}</div>
                ${h > 34 && cols === 1 ? `<div class="truncate" style="opacity:.85;font-size:.62rem">${U.fmtTime(it.start)} · ${U.esc(it.location || "")}</div>` : ""}
              </div>`;
            }).join("")}

            ${planned.map((a) => {
              const top = (a.scheduledMin - minMin) * PX_PER_MIN;
              const h = Math.max(16, (a.estMinutes || 30) * PX_PER_MIN);
              const color = S.classColor(a.classId);
              return `<div class="week-plan" draggable="true" data-plan="${a.id}"
                           style="top:${top}px;height:${h}px;border-color:${U.esc(color)};color:${U.esc(color)}"
                           title="Study: ${U.esc(a.title)}">
                <div class="truncate">📚 ${U.esc(a.title)}</div>
              </div>`;
            }).join("")}
          </div>`;
        }).join("")}
      </div>

      <div class="week-allday">
        <div class="tiny dim" style="padding:6px 8px">Due / all-day</div>
        ${days.map((iso) => {
          const due = S.db.assignments.filter((a) => a.due === iso);
          const allDay = S.db.events.filter((e) => e.date === iso && !e.start);
          return `<div class="week-allday-col" data-day="${iso}">
            ${allDay.map((e) => `<span class="cal-pill" style="background:#64748b">${U.esc(e.title)}</span>`).join("")}
            ${due.map((a) => `<span class="cal-pill" data-open-hw="${a.id}"
                draggable="true" data-plan="${a.id}"
                style="background:${U.esc(S.classColor(a.classId))};${a.status === "done" ? "opacity:.45;text-decoration:line-through" : ""}"
                title="${U.esc(a.title)} — drag onto another day to plan study time">📌 ${U.esc(a.title)}</span>`).join("")}
          </div>`;
        }).join("")}
      </div>

      <p class="tiny dim mt-8">
        Dashed blocks are planned study sessions — drag one to a different day to move it.
        Set them up in the <a href="#planner" data-go="planner">Planner</a>.
      </p>
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
      UI.emptyState("eventsUpcoming", "Nothing in the next three weeks", "Add an event to get started.");
  }

  /* ------------------------------------------------------------ render -- */

  function render() {
    const monthLabel = `${U.MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;
    const weekStart = U.startOfWeek(cursor, S.settings.weekStartsMonday);
    const weekEnd = U.addDays(weekStart, 6);
    const weekLabel = `${U.fmtDate(U.dateKey(weekStart))} – ${U.fmtDate(U.dateKey(weekEnd))}`;
    const label = mode === "week" ? weekLabel : monthLabel;

    const monthEvents = S.db.events.filter((e) => {
      // An event whose date can't be parsed simply isn't in this month.
      const d = U.parseDate(e.date);
      return !!d && d.getMonth() === cursor.getMonth() && d.getFullYear() === cursor.getFullYear();
    }).length;

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>${App.i18n.t("calendar", "Calendar")}</h1>
          <div class="sub">${U.plural(monthEvents, "event")} in ${monthLabel} ·
            classes, deadlines, activities, and study blocks in one place</div>
        </div>
        <div class="page-actions cal-actions">
          <div class="segmented">
            <button class="${mode === "month" ? "active" : ""}" data-mode="month">Month</button>
            <button class="${mode === "week" ? "active" : ""}" data-mode="week">Week</button>
            <button class="${mode === "agenda" ? "active" : ""}" data-mode="agenda">Agenda</button>
          </div>
          <button class="btn act-secondary" data-export-ics>⬇ Export .ics</button>
          <button class="btn act-secondary" data-ai-events>✦ Add from a link</button>
          <button class="btn btn-primary" data-new>+ New event</button>
          <button class="icon-btn act-overflow" data-cal-more aria-label="More calendar actions" title="More">⋯</button>
        </div>
      </div>

      ${mode === "agenda" ? `<div class="card"><div class="card-body">${agenda()}</div></div>` : `
        <div class="between mb-12">
          <div class="row gap-6">
            <button class="icon-btn" data-nav="-1" aria-label="Previous">‹</button>
            <button class="btn btn-sm" data-nav="0">Today</button>
            <button class="icon-btn" data-nav="1" aria-label="Next">›</button>
          </div>
          <h2>${U.esc(label)}</h2>
          <span style="width:120px"></span>
        </div>
        ${mode === "week" ? weekGrid() : monthGrid()}
        ${mode === "month" ? `<p class="tiny dim mt-12">Assignment due dates appear automatically — add or edit them from the Homework tab.</p>` : ""}
      `}
    </div>`;
  }

  function mount(root) {
    U.on(root, "click", "[data-mode]", (_e, el) => { mode = el.dataset.mode; App.router.refresh(); });
    U.on(root, "click", "[data-nav]", (_e, el) => {
      const n = Number(el.dataset.nav);
      if (n === 0) cursor = new Date();
      else if (mode === "week") cursor = U.addDays(cursor, n * 7);
      else cursor = new Date(cursor.getFullYear(), cursor.getMonth() + n, 1);
      App.router.refresh();
    });
    // Most of these dates are already published somewhere — a school
    // calendar, an athletics page, an exam timetable. Reading the page is
    // faster than typing twenty events, and the review list means a
    // misread date is caught before it reaches the calendar.
    U.on(root, "click", "[data-ai-events]", () => App.aiAdd.open({ scope: "events" }));

    U.on(root, "click", "[data-new]", () => eventForm(null));
    U.on(root, "click", "[data-export-ics]", exportDialog);
    // Narrow screens hide Export .ics / Add from a link as standalone
    // buttons (see .cal-actions-secondary in layout.css) so the toolbar
    // fits in one row instead of wrapping into three; this menu is the
    // only way to reach them there, so it reuses the exact same handlers.
    U.on(root, "click", "[data-cal-more]", (e, el) => {
      const r = el.getBoundingClientRect();
      UI.menu([
        { icon: "⬇", label: "Export .ics", run: exportDialog },
        { icon: "✦", label: "Add from a link", run: () => App.aiAdd.open({ scope: "events" }) }
      ], r.right, r.bottom + 4);
    });
    U.on(root, "click", "[data-day]", (_e, el) => dayDetail(el.dataset.day));
    U.on(root, "click", "[data-ev]", (e, el) => {
      e.stopPropagation();
      const ev = S.byId("events", el.dataset.ev);
      if (ev) eventForm(ev);
    });
    U.on(root, "click", "[data-class]", (e, el) => {
      e.stopPropagation();
      App.views.classes.detail(el.dataset.class);
    });

    // U30 — the payload rides on dataTransfer rather than a module-local
    // variable, so a drag can start in one component (week grid, month cell,
    // agenda row, due-soon list) and finish in another. A local variable only
    // worked inside the week grid and was wiped by any repaint mid-drag.
    const DRAG_TYPE = "text/scholar-assignment";
    let dragging = null;   // kept only for the drag-image opacity reset

    U.on(root, "dragstart", "[data-plan]", (e, el) => {
      dragging = el.dataset.plan;
      el.style.opacity = ".4";
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(DRAG_TYPE, el.dataset.plan);
      e.dataTransfer.setData("text/plain", el.dataset.plan);
    });
    U.on(root, "dragend", "[data-plan]", (_e, el) => { el.style.opacity = ""; dragging = null; });

    const dropTargets = "[data-drop-day], .cal-day[data-day]";
    U.on(root, "dragover", dropTargets, (e, el) => { e.preventDefault(); el.classList.add("drop"); });
    U.on(root, "dragleave", dropTargets, (_e, el) => el.classList.remove("drop"));
    U.on(root, "drop", dropTargets, (e, el) => {
      e.preventDefault();
      el.classList.remove("drop");
      const id = e.dataTransfer.getData(DRAG_TYPE) || e.dataTransfer.getData("text/plain") || dragging;
      if (!id) return;
      const a = S.byId("assignments", id);
      const target = el.dataset.dropDay || el.dataset.day;
      dragging = null;
      if (!a || !target) return;
      if (U.diffDays(target, a.due) > 0) {
        UI.toast("That's after the deadline", `"${a.title}" is due ${U.relDate(a.due)}.`, "warn");
        return;
      }
      S.update("assignments", a.id, { scheduledFor: target, scheduledAuto: false });
      UI.toast("Moved", `${a.title} → ${U.fmtDate(target, "day")}`, "ok");
    });
  }

  function exportDialog() {
    const signedIn = App.sync.isSignedIn();
    UI.modal({
      title: "Export to your calendar",
      sub: "Downloads a .ics file you can import into Apple, Google, or Outlook Calendar",
      footer: `<button type="button" class="btn" data-close>Cancel</button>
        <button type="button" class="btn" data-subscribe ${signedIn ? "" : "disabled"}
                ${signedIn ? "" : `data-tip="Sign in for a live subscribe link"`}>🔗 Get subscribe link</button>
        <button type="submit" class="btn btn-primary">Download .ics</button>`,
      body: `<div class="col gap-8">
        ${[["classes", "Classes", "Weekly recurring, through the end of term"],
           ["activities", "Practices &amp; clubs", "Weekly recurring"],
           ["events", "Events", "Tests, games, one-offs"],
           ["assignments", "Assignment due dates", "As all-day items"]].map(([k, label, desc]) => `
          <label class="between" style="padding:8px 0;border-bottom:1px solid var(--border)">
            <span><span class="small bold">${label}</span>
              <div class="tiny dim">${desc}</div></span>
            <input type="checkbox" class="check" name="${k}" checked />
          </label>`).join("")}
      </div>
      <p class="hint mt-12">Times are exported in your local timezone
        (${U.esc(Intl.DateTimeFormat().resolvedOptions().timeZone || "local")}).
        ${signedIn ? "A subscribe link stays in sync — it refreshes with whatever's on your device the next time you're online." : ""}</p>`,
      onMount(root) {
        const sub = root.querySelector("[data-subscribe]");
        if (sub) sub.addEventListener("click", () => {
          const opts = {
            classes: root.querySelector('[name="classes"]').checked,
            activities: root.querySelector('[name="activities"]').checked,
            events: root.querySelector('[name="events"]').checked,
            assignments: root.querySelector('[name="assignments"]').checked
          };
          App.sync.pushIcsFeed(App.ics.build(opts)).then((token) => {
            UI.closeModal();
            setTimeout(() => subscribeLinkModal(App.sync.icsFeedUrl(token)), 60);
          }).catch((e) => UI.toast("Couldn't create link", e.message, "danger"));
        });
      },
      onSubmit(d) {
        App.ics.download({
          classes: d.classes, activities: d.activities,
          events: d.events, assignments: d.assignments
        });
        UI.toast("Calendar exported", "Open the .ics file to import it.", "ok");
      }
    });
  }

  // F046 — a live-syncing subscribe URL, the follow-up once the server has
  // a copy of the .ics to serve.
  function subscribeLinkModal(url) {
    UI.modal({
      title: "Subscribe link ready",
      sub: "Add this as a calendar subscription — it stays in sync, not a one-time import.",
      footer: `<button type="button" class="btn" data-close>Done</button>
               <button type="button" class="btn btn-primary" data-copy>Copy link</button>`,
      body: `<div class="field">
          <input class="input mono" readonly value="${U.esc(url)}" data-select-all />
        </div>
        <p class="hint mt-8">Google Calendar: "Other calendars" → "From URL". Apple Calendar: File →
          New Calendar Subscription. Outlook: Add calendar → Subscribe from web.</p>`,
      onMount(root) {
        root.querySelector("[data-copy]").addEventListener("click", () => {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(() => UI.toast("Copied", "", "ok")).catch(() => UI.toast("Link", url));
          } else UI.toast("Link", url);
        });
      }
    });
  }

  /** U51 — `#calendar/agenda` opens straight in that mode. */
  function openSub(id) {
    if (!["month", "week", "agenda"].includes(id)) return false;
    mode = id;
    App.router.refresh();
    return true;
  }

  return { render, mount, eventForm, openSub, title: "Calendar" };
})();
