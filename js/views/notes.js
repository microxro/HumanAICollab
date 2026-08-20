/* ==========================================================================
   views/notes.js — per-class notebook with tags, search, and pinning
   ========================================================================== */

App.views.notes = (function () {
  const U = App.utils, S = App.store, UI = App.ui;

  let q = "", clsFilter = "", tagFilter = "";

  function allTags() {
    const set = new Set();
    S.db.notes.forEach((n) => (n.tags || []).forEach((t) => set.add(t)));
    return [...set].sort();
  }

  function visible() {
    let rows = S.db.notes.slice();
    if (clsFilter) rows = rows.filter((n) => n.classId === clsFilter);
    if (tagFilter) rows = rows.filter((n) => (n.tags || []).includes(tagFilter));
    if (q) {
      const s = q.toLowerCase();
      rows = rows.filter((n) =>
        n.title.toLowerCase().includes(s) ||
        n.body.toLowerCase().includes(s) ||
        (n.tags || []).some((t) => t.toLowerCase().includes(s)));
    }
    // Pinned first, then most recently updated.
    return rows.sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return (b.updated || "").localeCompare(a.updated || "");
    });
  }

  function form(nt) {
    const n = nt || {};
    UI.modal({
      title: nt ? "Edit note" : "New note",
      size: "wide",
      okLabel: nt ? "Save" : "Create note",
      footer: nt ? `<button type="button" class="btn btn-danger left" data-del>Delete</button>
                    <button type="button" class="btn" data-pin>${n.pinned ? "Unpin" : "📌 Pin"}</button>
                    <button type="button" class="btn" data-close>Cancel</button>
                    <button type="submit" class="btn btn-primary">Save</button>` : undefined,
      body: `<div class="form-grid">
        <div class="field full">
          <label>Title</label>
          <input class="input" name="title" required value="${U.esc(n.title || "")}" placeholder="e.g. Unit 4 study guide" />
        </div>
        <div class="field">
          <label>Class</label>
          <select class="select" name="classId">${UI.classOptions(n.classId, true)}</select>
        </div>
        <div class="field">
          <label>Tags <span class="hint">comma separated</span></label>
          <input class="input" name="tags" value="${U.esc((n.tags || []).join(", "))}" placeholder="exam, formulas" />
        </div>
        <div class="field full">
          <label>Note</label>
          <textarea class="textarea" name="body" rows="12"
                    placeholder="Write anything — formulas, vocab, essay outlines…">${U.esc(n.body || "")}</textarea>
        </div>
      </div>`,
      onMount(root) {
        const pin = root.querySelector("[data-pin]");
        if (pin) pin.addEventListener("click", () => {
          S.update("notes", nt.id, { pinned: !nt.pinned });
          UI.closeModal();
          UI.toast(nt.pinned ? "Unpinned" : "Pinned 📌", nt.title);
        });
        const del = root.querySelector("[data-del]");
        if (del) del.addEventListener("click", () => {
          UI.closeModal();
          UI.confirm({
            title: "Delete note?", message: `"${nt.title}" will be removed.`,
            okLabel: "Delete", danger: true,
            onConfirm() { S.remove("notes", nt.id); UI.toast("Note deleted", nt.title, "warn"); }
          });
        });
      },
      onSubmit(d) {
        if (!d.title.trim()) return false;
        const patch = {
          title: d.title.trim(), body: d.body,
          classId: d.classId || null,
          tags: d.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
          updated: U.today()
        };
        if (nt) { S.update("notes", nt.id, patch); UI.toast("Note saved", patch.title); }
        else { S.insert("notes", Object.assign({ pinned: false }, patch)); UI.toast("Note created", patch.title, "ok"); }
      }
    });
  }

  function reader(id) {
    const n = S.byId("notes", id);
    if (!n) return;
    const c = S.cls(n.classId);
    UI.modal({
      title: n.title,
      sub: [c ? c.name : "General", "Updated " + U.fmtDate(n.updated)].join(" · "),
      size: "wide",
      footer: `<button type="button" class="btn left" data-pin>${n.pinned ? "Unpin" : "📌 Pin"}</button>
               <button type="button" class="btn" data-edit>Edit</button>
               <button type="button" class="btn btn-primary" data-close>Close</button>`,
      body: `${(n.tags || []).length ? `<div class="row gap-6 wrap mb-12">
          ${n.tags.map((t) => `<span class="tag">#${U.esc(t)}</span>`).join("")}</div>` : ""}
        <div style="white-space:pre-wrap;line-height:1.65;font-size:.9rem">${U.esc(n.body)}</div>`,
      onMount(root) {
        root.querySelector("[data-edit]").addEventListener("click", () => { UI.closeModal(); form(n); });
        root.querySelector("[data-pin]").addEventListener("click", () => {
          S.update("notes", n.id, { pinned: !n.pinned });
          UI.closeModal();
          UI.toast(n.pinned ? "Unpinned" : "Pinned 📌", n.title);
        });
      }
    });
  }

  function render() {
    const rows = visible();
    const tags = allTags();

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>Notes</h1>
          <div class="sub">${U.plural(S.db.notes.length, "note")} ·
            ${S.db.notes.filter((n) => n.pinned).length} pinned</div>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" data-new>+ New note</button>
        </div>
      </div>

      <div class="card mb-16"><div class="card-body tight">
        <div class="row wrap gap-8">
          <input class="input input-sm" id="nSearch" placeholder="Search notes…" value="${U.esc(q)}" style="max-width:250px" />
          <select class="select input-sm" id="nCls" style="max-width:190px">
            <option value="">All classes</option>${UI.classOptions(clsFilter)}
          </select>
          <span class="grow"></span>
          <span class="small dim">${U.plural(rows.length, "note")}</span>
        </div>
        ${tags.length ? `<div class="row wrap gap-6 mt-12">
          <button class="chip ${!tagFilter ? "active" : ""}" data-tag="">All tags</button>
          ${tags.map((t) => `<button class="chip ${tagFilter === t ? "active" : ""}" data-tag="${U.esc(t)}">#${U.esc(t)}</button>`).join("")}
        </div>` : ""}
      </div></div>

      ${rows.length ? `<div class="grid g-3">${rows.map((n) => {
        const c = S.cls(n.classId);
        return `<div class="note-card" data-note="${n.id}"
                     style="${c ? `border-top:3px solid ${U.esc(c.color)}` : ""}">
          <div class="between">
            <div class="n-title truncate">${U.esc(n.title)}</div>
            ${n.pinned ? `<span class="pin" title="Pinned">📌</span>` : ""}
          </div>
          <div class="n-body">${U.esc(n.body)}</div>
          <div class="n-foot">
            ${c ? `<span class="tag" style="background:${U.hexAlpha(c.color, .14)};color:${U.esc(c.color)}">${U.esc(c.name)}</span>` : ""}
            ${(n.tags || []).slice(0, 2).map((t) => `<span class="tag">#${U.esc(t)}</span>`).join("")}
            <span class="grow"></span>
            <span class="tiny dim">${U.esc(U.fmtDate(n.updated))}</span>
          </div>
        </div>`;
      }).join("")}</div>`
      : UI.emptyState("📓", q || clsFilter || tagFilter ? "No notes match" : "No notes yet",
          q || clsFilter || tagFilter ? "Try clearing your filters." : "Keep formulas, vocab, and study guides here — searchable and organized by class.",
          `<button class="btn btn-primary" data-new>+ Write your first note</button>`)}
    </div>`;
  }

  function mount(root) {
    U.on(root, "click", "[data-new]", () => form(null));
    U.on(root, "click", "[data-note]", (_e, el) => reader(el.dataset.note));
    U.on(root, "click", "[data-tag]", (_e, el) => { tagFilter = el.dataset.tag; App.router.refresh(); });

    const s = root.querySelector("#nSearch");
    if (s) s.addEventListener("input", U.debounce((e) => {
      q = e.target.value;
      App.router.refresh();
      const el = document.querySelector("#nSearch");
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }, 250));

    const c = root.querySelector("#nCls");
    if (c) c.addEventListener("change", (e) => { clsFilter = e.target.value; App.router.refresh(); });
  }

  return { render, mount, title: "Notes" };
})();
