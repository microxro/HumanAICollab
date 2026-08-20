/* ==========================================================================
   views/homework.js — assignment tracker (list + kanban board)
   ========================================================================== */

App.views.homework = (function () {
  const U = App.utils, S = App.store, UI = App.ui;

  let mode = "list";                       // list | board
  let filter = { cls: "", status: "open", q: "", sort: "due" };

  const COLUMNS = [
    { id: "todo",  label: "To do",       icon: "○" },
    { id: "doing", label: "In progress", icon: "◐" },
    { id: "review",label: "Review",      icon: "◔" },
    { id: "done",  label: "Done",        icon: "●" }
  ];

  const TYPES = ["Homework", "Reading", "Essay", "Project", "Lab", "Test", "Quiz", "Presentation", "Other"];

  /* --------------------------------------------------------- filtering -- */

  function visible() {
    let rows = S.db.assignments.slice();

    if (filter.cls) rows = rows.filter((a) => a.classId === filter.cls);
    if (filter.status === "open") rows = rows.filter((a) => a.status !== "done");
    else if (filter.status === "done") rows = rows.filter((a) => a.status === "done");
    else if (filter.status === "overdue") {
      const t = U.today();
      rows = rows.filter((a) => a.status !== "done" && U.diffDays(a.due, t) < 0);
    } else if (filter.status === "week") {
      const t = U.today();
      rows = rows.filter((a) => a.status !== "done" && U.diffDays(a.due, t) <= 7);
    }

    if (filter.q) {
      const q = filter.q.toLowerCase();
      rows = rows.filter((a) =>
        a.title.toLowerCase().includes(q) ||
        S.className(a.classId).toLowerCase().includes(q) ||
        (a.notes || "").toLowerCase().includes(q));
    }

    const sorters = {
      due: (a) => a.due,
      priority: (a) => ({ high: 0, med: 1, low: 2 }[a.priority] ?? 1),
      cls: (a) => S.className(a.classId),
      points: (a) => -a.points
    };
    return U.sortBy(rows, sorters[filter.sort] || sorters.due);
  }

  /* -------------------------------------------------------------- form -- */

  function form(as) {
    const a = as || {};
    const cls = S.cls(a.classId) || S.db.classes[0];

    UI.modal({
      title: as ? "Edit assignment" : "New assignment",
      size: "wide",
      okLabel: as ? "Save" : "Add assignment",
      footer: as ? `<button type="button" class="btn btn-danger left" data-del>Delete</button>
                    <button type="button" class="btn" data-close>Cancel</button>
                    <button type="submit" class="btn btn-primary">Save</button>` : undefined,
      body: `<div class="form-grid">
        <div class="field full">
          <label>Title</label>
          <input class="input" name="title" required value="${U.esc(a.title || "")}" placeholder="e.g. Problem set 12" />
        </div>
        <div class="field">
          <label>Class</label>
          <select class="select" name="classId" id="hwClass">${UI.classOptions(a.classId || (cls && cls.id))}</select>
        </div>
        <div class="field">
          <label>Category <span class="hint">(counts toward this grade bucket)</span></label>
          <select class="select" name="categoryId" id="hwCat"></select>
        </div>
        <div class="field">
          <label>Due date</label>
          <input class="input" type="date" name="due" required value="${a.due || U.today()}" />
        </div>
        <div class="field">
          <label>Type</label>
          <select class="select" name="type">
            ${TYPES.map((t) => `<option ${t === (a.type || "Homework") ? "selected" : ""}>${t}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Priority</label>
          <select class="select" name="priority">
            <option value="high" ${a.priority === "high" ? "selected" : ""}>High</option>
            <option value="med"  ${(a.priority || "med") === "med" ? "selected" : ""}>Medium</option>
            <option value="low"  ${a.priority === "low" ? "selected" : ""}>Low</option>
          </select>
        </div>
        <div class="field">
          <label>Status</label>
          <select class="select" name="status">
            ${COLUMNS.map((c) => `<option value="${c.id}" ${(a.status || "todo") === c.id ? "selected" : ""}>${c.label}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Est. minutes</label>
          <input class="input" type="number" name="estMinutes" min="0" step="5" value="${a.estMinutes != null ? a.estMinutes : 45}" />
        </div>
        <div class="field">
          <label>Points possible</label>
          <input class="input" type="number" name="points" min="0" value="${a.points != null ? a.points : 100}" />
        </div>
        <div class="field">
          <label>Score earned <span class="hint">(leave blank if ungraded)</span></label>
          <input class="input" type="number" name="earned" min="0" step="0.5" value="${a.earned != null ? a.earned : ""}" />
        </div>
        <div class="field full">
          <label>Notes</label>
          <textarea class="textarea" name="notes" rows="2" placeholder="Requirements, page numbers, rubric links…">${U.esc(a.notes || "")}</textarea>
        </div>
        <div class="field full">
          <label>Checklist</label>
          <div id="stList">${(a.subtasks || []).map((s) => stRow(s)).join("")}</div>
          <button type="button" class="btn btn-sm mt-4" id="addSt">+ Add step</button>
        </div>
      </div>`,
      onMount(root) {
        const clsSel = root.querySelector("#hwClass");
        const catSel = root.querySelector("#hwCat");

        const fillCats = () => {
          const c = S.cls(clsSel.value);
          const cats = c ? c.categories : [];
          catSel.innerHTML = cats.length
            ? cats.map((k) => `<option value="${k.id}" ${k.id === a.categoryId ? "selected" : ""}>${U.esc(k.name)} (${k.weight}%)</option>`).join("")
            : `<option value="">— None —</option>`;
        };
        fillCats();
        clsSel.addEventListener("change", fillCats);

        const list = root.querySelector("#stList");
        root.querySelector("#addSt").addEventListener("click", () => {
          list.insertAdjacentHTML("beforeend", stRow({ id: U.uid("st"), text: "", done: false }));
          const inputs = U.$$("[data-st-text]", list);
          inputs[inputs.length - 1].focus();
        });
        list.addEventListener("click", (e) => {
          const b = e.target.closest("[data-del-st]");
          if (b) b.closest("[data-st]").remove();
        });

        const del = root.querySelector("[data-del]");
        if (del) del.addEventListener("click", () => {
          UI.closeModal();
          UI.confirm({
            title: "Delete assignment?", message: `"${as.title}" will be removed.`,
            okLabel: "Delete", danger: true,
            onConfirm() { S.remove("assignments", as.id); UI.toast("Assignment deleted", as.title, "warn"); }
          });
        });
      },
      onSubmit(d, root) {
        if (!d.title.trim()) return false;
        const subtasks = U.$$("[data-st]", root).map((row) => ({
          id: row.dataset.st,
          text: row.querySelector("[data-st-text]").value.trim(),
          done: row.querySelector("[data-st-done]").checked
        })).filter((s) => s.text);

        const earned = d.earned === null || d.earned === "" ? null : Number(d.earned);
        const patch = {
          title: d.title.trim(), classId: d.classId, categoryId: d.categoryId || null,
          due: d.due, type: d.type, priority: d.priority, status: d.status,
          estMinutes: Number(d.estMinutes) || 0, points: Number(d.points) || 0,
          earned, graded: earned != null, notes: d.notes.trim(), subtasks
        };
        if (as) { S.update("assignments", as.id, patch); UI.toast("Assignment updated", patch.title); }
        else { S.insert("assignments", Object.assign({ assigned: U.today(), actualMinutes: 0 }, patch));
               UI.toast("Assignment added", `${patch.title} · due ${U.relDate(patch.due)}`, "ok"); }
      }
    });
  }

  function stRow(s) {
    return `<div class="row gap-8" data-st="${s.id}" style="margin-bottom:6px">
      <input type="checkbox" class="check" data-st-done ${s.done ? "checked" : ""} aria-label="Step done" />
      <input class="input input-sm grow" data-st-text value="${U.esc(s.text)}" placeholder="Step…" />
      <button type="button" class="icon-btn btn-sm" data-del-st aria-label="Remove step">✕</button>
    </div>`;
  }

  /* ------------------------------------------------------------ detail -- */

  function detail(id) {
    const a = S.byId("assignments", id);
    if (!a) return;
    const c = S.cls(a.classId);
    const prog = S.progressOf(a);

    UI.modal({
      title: a.title,
      sub: `${c ? c.name : "General"} · ${a.type}`,
      footer: `<button type="button" class="btn left" data-edit>Edit</button>
               <button type="button" class="btn" data-close>Close</button>
               <button type="button" class="btn btn-primary" data-done>
                 ${a.status === "done" ? "Reopen" : "Mark done"}</button>`,
      body: `
        <div class="row gap-8 wrap mb-16">
          ${UI.dueBadge(a.due)}
          ${UI.priorityBadge(a.priority)}
          <span class="badge">${a.points} pts</span>
          <span class="badge">Est. ${U.fmtDur(a.estMinutes)}</span>
          ${a.graded ? `<span class="badge ok">Scored ${a.earned}/${a.points}</span>` : ""}
        </div>

        ${a.subtasks && a.subtasks.length ? `
          <div class="between mb-4">
            <h4>Checklist</h4>
            <span class="small dim">${a.subtasks.filter((s) => s.done).length}/${a.subtasks.length}</span>
          </div>
          <div class="bar thin mb-8"><i style="width:${prog * 100}%"></i></div>
          ${a.subtasks.map((s) => `
            <label class="subtask ${s.done ? "done" : ""}">
              <input type="checkbox" class="check" data-sub="${s.id}" ${s.done ? "checked" : ""} />
              <span>${U.esc(s.text)}</span>
            </label>`).join("")}
          <div class="divider"></div>` : ""}

        ${a.notes ? `<h4 class="mb-4">Notes</h4>
          <p class="small muted" style="white-space:pre-wrap">${U.esc(a.notes)}</p>
          <div class="divider"></div>` : ""}

        <div class="row gap-24 wrap small muted">
          <div><div class="tiny dim">Assigned</div>${U.esc(U.fmtDate(a.assigned || a.due))}</div>
          <div><div class="tiny dim">Due</div>${U.esc(U.fmtDate(a.due, "long"))}</div>
          <div><div class="tiny dim">Time logged</div>${U.fmtDur(a.actualMinutes || 0)}</div>
        </div>`,
      onMount(root) {
        root.querySelector("[data-edit]").addEventListener("click", () => { UI.closeModal(); form(a); });
        root.querySelector("[data-done]").addEventListener("click", () => {
          S.update("assignments", a.id, { status: a.status === "done" ? "todo" : "done" });
          UI.closeModal();
          UI.toast(a.status === "done" ? "Reopened" : "Nice work! ✅", a.title, "ok");
        });
        U.on(root, "change", "[data-sub]", (_e, el) => {
          const st = a.subtasks.find((s) => s.id === el.dataset.sub);
          if (st) { st.done = el.checked; S.commit(); }
        });
      }
    });
  }

  /* ------------------------------------------------------------ render -- */

  function listHTML(rows) {
    if (!rows.length) {
      return UI.emptyState("✨", "Nothing here",
        filter.q || filter.cls ? "Try clearing your filters." : "You're all caught up.",
        `<button class="btn btn-primary" data-add>+ Add assignment</button>`);
    }
    return `<div class="list">${rows.map((a) => {
      const c = S.cls(a.classId);
      const prog = S.progressOf(a);
      return `<div class="hw-row ${a.status === "done" ? "done" : ""}">
        <input type="checkbox" class="check" data-toggle="${a.id}" ${a.status === "done" ? "checked" : ""}
               aria-label="Toggle complete" style="margin-top:2px" />
        <span class="hw-stripe" style="background:${U.esc(c ? c.color : "#94a3b8")}"></span>
        <span class="grow" style="min-width:0;cursor:pointer" data-open="${a.id}">
          <div class="hw-title truncate">${U.esc(a.title)}</div>
          <div class="hw-sub">
            <span class="tiny dim">${U.esc(c ? c.name : "General")}</span>
            <span class="tiny dim">·</span>
            <span class="tiny dim">${U.esc(a.type)}</span>
            ${a.subtasks && a.subtasks.length
              ? `<span class="tiny dim">· ${a.subtasks.filter((s) => s.done).length}/${a.subtasks.length} steps</span>` : ""}
            ${a.graded ? `<span class="badge ok">${a.earned}/${a.points}</span>` : ""}
          </div>
          ${prog > 0 && prog < 1 ? `<div class="bar thin" style="margin-top:6px;max-width:220px"><i style="width:${prog * 100}%"></i></div>` : ""}
        </span>
        ${UI.priorityBadge(a.priority)}
        ${UI.dueBadge(a.due)}
        <button class="icon-btn btn-sm" data-edit="${a.id}" aria-label="Edit">✎</button>
      </div>`;
    }).join("")}</div>`;
  }

  function boardHTML(rows) {
    return `<div class="board">${COLUMNS.map((col) => {
      const items = rows.filter((a) => (a.status || "todo") === col.id);
      return `<div class="board-col" data-col="${col.id}">
        <div class="board-col-head">
          <span>${col.icon}</span><span>${col.label}</span>
          <span class="n">${items.length}</span>
        </div>
        ${items.map((a) => {
          const c = S.cls(a.classId);
          return `<div class="task-card" draggable="true" data-card="${a.id}"
                       style="border-left-color:${U.esc(c ? c.color : "#94a3b8")}">
            <div class="tc-title">${U.esc(a.title)}</div>
            <div class="tc-meta">
              <span class="tiny dim truncate">${U.esc(c ? c.name : "General")}</span>
              ${UI.dueBadge(a.due)}
              ${a.priority === "high" ? `<i class="prio high" title="High priority"></i>` : ""}
            </div>
          </div>`;
        }).join("") || `<p class="tiny dim center" style="padding:12px 0">Drop here</p>`}
      </div>`;
    }).join("")}</div>`;
  }

  function render() {
    const rows = visible();
    const open = S.openAssignments();
    const late = S.overdue();
    const estLeft = U.sum(open.filter((a) => U.diffDays(a.due, U.today()) <= 7), (a) => a.estMinutes || 0);

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>Homework</h1>
          <div class="sub">${U.plural(open.length, "open item")} ·
            ${late.length ? `<span style="color:var(--danger)">${late.length} overdue</span> · ` : ""}
            about ${U.fmtDur(estLeft)} of work due this week</div>
        </div>
        <div class="page-actions">
          <div class="segmented">
            <button class="${mode === "list" ? "active" : ""}" data-mode="list">List</button>
            <button class="${mode === "board" ? "active" : ""}" data-mode="board">Board</button>
          </div>
          <button class="btn btn-primary" data-add>+ Add assignment</button>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-body tight">
          <div class="row gap-8">
            <span class="dim" style="font-size:1.05rem">⚡</span>
            <input class="input grow" id="quickAdd" autocomplete="off"
                   placeholder="Quick add — try: calc pset due friday high 45m" />
            <button class="btn btn-primary" id="quickGo">Add</button>
          </div>
          <div id="quickPreview" class="row wrap gap-6 mt-8" hidden></div>
        </div>
      </div>

      <div class="card mb-16"><div class="card-body tight">
        <div class="row wrap gap-8">
          <input class="input input-sm" id="hwSearch" placeholder="Search assignments…"
                 value="${U.esc(filter.q)}" style="max-width:230px" />
          <select class="select input-sm" id="fCls" style="max-width:190px">
            <option value="">All classes</option>${UI.classOptions(filter.cls)}
          </select>
          <select class="select input-sm" id="fStatus" style="max-width:150px">
            <option value="open"    ${filter.status === "open" ? "selected" : ""}>Open</option>
            <option value="week"    ${filter.status === "week" ? "selected" : ""}>Due this week</option>
            <option value="overdue" ${filter.status === "overdue" ? "selected" : ""}>Overdue</option>
            <option value="done"    ${filter.status === "done" ? "selected" : ""}>Completed</option>
            <option value="all"     ${filter.status === "all" ? "selected" : ""}>All</option>
          </select>
          <select class="select input-sm" id="fSort" style="max-width:160px">
            <option value="due"      ${filter.sort === "due" ? "selected" : ""}>Sort: due date</option>
            <option value="priority" ${filter.sort === "priority" ? "selected" : ""}>Sort: priority</option>
            <option value="cls"      ${filter.sort === "cls" ? "selected" : ""}>Sort: class</option>
            <option value="points"   ${filter.sort === "points" ? "selected" : ""}>Sort: points</option>
          </select>
          <span class="grow"></span>
          <span class="small dim">${U.plural(rows.length, "result")}</span>
        </div>
      </div></div>

      ${mode === "list" ? `<div class="card">${listHTML(rows)}</div>` : boardHTML(rows)}
    </div>`;
  }

  /* --------------------------------------------------------- quick add -- */

  // Shows what the parser understood before anything is saved, so the
  // shorthand never feels like a guess.
  function renderPreview(box, parsed) {
    if (!parsed || !parsed.raw.trim()) { box.hidden = true; return; }
    box.hidden = false;
    const chips = parsed.tokens.map((t) => {
      const style = t.color ? ` style="background:${U.hexAlpha(t.color, .16)};color:${U.esc(t.color)}"` : "";
      return `<span class="tag"${style}>${U.esc(t.label)}</span>`;
    }).join("");
    box.innerHTML = `<span class="tiny dim">Will create:</span>
      <span class="tag" style="background:var(--brand-50);color:var(--brand-600)">${U.esc(parsed.title)}</span>
      ${chips}
      ${parsed.tokens.length ? "" : `<span class="tiny dim">— add a day, duration, or class to fill in more</span>`}`;
  }

  function commitQuickAdd(input, box) {
    const parsed = App.nlp.parse(input.value);
    if (!parsed || !parsed.title.trim()) {
      UI.toast("Nothing to add", "Type something like “chem lab due tuesday 90m”.", "warn");
      return;
    }
    S.insert("assignments", {
      title: parsed.title, classId: parsed.classId, categoryId: parsed.categoryId,
      due: parsed.due, type: parsed.type, priority: parsed.priority,
      status: "todo", points: parsed.points, earned: null, graded: false,
      estMinutes: parsed.estMinutes, actualMinutes: 0, subtasks: [], notes: "",
      assigned: U.today(), termId: (S.currentTerm() || {}).id,
      scheduledFor: null, scheduledMin: null, missing: false
    });
    input.value = "";
    box.hidden = true;
    UI.toast("Added", `${parsed.title} · ${S.className(parsed.classId)} · due ${U.relDate(parsed.due)}`, "ok");
  }

  function mount(root) {
    const qa = root.querySelector("#quickAdd");
    const qp = root.querySelector("#quickPreview");
    if (qa && qp) {
      qa.addEventListener("input", () => renderPreview(qp, App.nlp.parse(qa.value)));
      qa.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); commitQuickAdd(qa, qp); }
        if (e.key === "Escape") { qa.value = ""; qp.hidden = true; qa.blur(); }
      });
      const go = root.querySelector("#quickGo");
      if (go) go.addEventListener("click", () => commitQuickAdd(qa, qp));
    }

    U.on(root, "click", "[data-add]", () => form(null));
    U.on(root, "click", "[data-mode]", (_e, el) => { mode = el.dataset.mode; App.router.refresh(); });
    U.on(root, "click", "[data-open]", (_e, el) => detail(el.dataset.open));
    U.on(root, "click", "[data-card]", (_e, el) => detail(el.dataset.card));
    U.on(root, "click", "[data-edit]", (e, el) => { e.stopPropagation(); form(S.byId("assignments", el.dataset.edit)); });

    U.on(root, "change", "[data-toggle]", (_e, el) => {
      const a = S.byId("assignments", el.dataset.toggle);
      if (!a) return;
      S.update("assignments", a.id, { status: el.checked ? "done" : "todo" });
      if (el.checked) UI.toast("Done ✅", a.title, "ok");
    });

    const search = root.querySelector("#hwSearch");
    if (search) {
      search.addEventListener("input", U.debounce((e) => {
        filter.q = e.target.value;
        App.router.refresh();
        const s = document.querySelector("#hwSearch");
        if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
      }, 260));
    }
    const bind = (id, key) => {
      const el = root.querySelector(id);
      if (el) el.addEventListener("change", (e) => { filter[key] = e.target.value; App.router.refresh(); });
    };
    bind("#fCls", "cls"); bind("#fStatus", "status"); bind("#fSort", "sort");

    // Drag & drop between board columns
    let dragId = null;
    U.on(root, "dragstart", "[data-card]", (e, el) => {
      dragId = el.dataset.card;
      el.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    U.on(root, "dragend", "[data-card]", (_e, el) => {
      el.classList.remove("dragging");
      U.$$(".board-col", root).forEach((c) => c.classList.remove("drop"));
    });
    U.on(root, "dragover", "[data-col]", (e, el) => {
      e.preventDefault();
      el.classList.add("drop");
    });
    U.on(root, "dragleave", "[data-col]", (_e, el) => el.classList.remove("drop"));
    U.on(root, "drop", "[data-col]", (e, el) => {
      e.preventDefault();
      if (!dragId) return;
      S.update("assignments", dragId, { status: el.dataset.col });
      dragId = null;
    });
  }

  return { render, mount, form, detail, title: "Homework" };
})();
