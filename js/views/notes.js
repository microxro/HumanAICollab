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
          <div class="between">
            <label>Note <span class="hint">Markdown supported</span></label>
            <div class="segmented" style="padding:2px">
              <button type="button" class="active" data-tab="write">Write</button>
              <button type="button" data-tab="preview">Preview</button>
            </div>
          </div>
          <textarea class="textarea" name="body" id="noteBody" rows="14"
                    placeholder="# Heading&#10;**bold**  *italic*  \`code\`&#10;- bullet&#10;- [ ] task&#10;&gt; quote">${U.esc(n.body || "")}</textarea>
          <div class="md card" id="notePreview" hidden style="padding:14px;min-height:200px"></div>
          <span class="hint">Tip: lines like “term — definition” can be turned into flashcards later.</span>
        </div>
      </div>`,
      onMount(root) {
        // Write / preview toggle for the markdown editor.
        const ta = root.querySelector("#noteBody");
        const pv = root.querySelector("#notePreview");
        U.on(root, "click", "[data-tab]", (_e, el) => {
          const preview = el.dataset.tab === "preview";
          U.$$("[data-tab]", root).forEach((b) => b.classList.toggle("active", b === el));
          ta.hidden = preview;
          pv.hidden = !preview;
          if (preview) pv.innerHTML = App.md.render(ta.value) || `<p class="dim small">Nothing to preview yet.</p>`;
        });

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
      footer: `<button type="button" class="btn left" data-pin>${n.pinned ? "Unpin" : "📌 Pin"}</button>
               <button type="button" class="btn" data-cards>🃏 Make flashcards</button>
               <button type="button" class="btn" data-edit>Edit</button>
               <button type="button" class="btn btn-primary" data-close>Close</button>`,
      body: `${(n.tags || []).length ? `<div class="row gap-6 wrap mb-12">
          ${n.tags.map((t) => `<span class="tag">#${U.esc(t)}</span>`).join("")}</div>` : ""}
        <div class="md">${App.md.render(n.body)}</div>`,
      onMount(root) {
        root.querySelector("[data-edit]").addEventListener("click", () => { UI.closeModal(); form(n); });
        root.querySelector("[data-cards]").addEventListener("click", () => { UI.closeModal(); toCards(n); });
        root.querySelector("[data-pin]").addEventListener("click", () => {
          S.update("notes", n.id, { pinned: !n.pinned });
          UI.closeModal();
          UI.toast(n.pinned ? "Unpinned" : "Pinned 📌", n.title);
        });
      }
    });
  }

  /**
   * Turn "term — definition" lines in a note into a flashcard deck. The user
   * reviews and trims the extracted pairs before anything is created.
   */
  function toCards(n) {
    const found = App.md.toCards(n.body);
    if (!found.length) {
      UI.modal({
        title: "No card pairs found",
        size: "narrow",
        okLabel: "Got it",
        footer: `<button type="button" class="btn btn-primary" data-close>Got it</button>`,
        body: `<p class="small muted">Scholar looks for lines shaped like a term and a definition —
          separated by a colon, a dash, or an em dash. For example:</p>
          <pre class="md-pre"><code>Mitochondria — powerhouse of the cell
Ribosome: makes proteins
- Chain rule - f'(g(x)) · g'(x)</code></pre>`
      });
      return;
    }

    UI.modal({
      title: "Make flashcards",
      sub: `${U.plural(found.length, "pair")} found in "${n.title}"`,
      size: "wide",
      okLabel: `Create deck`,
      body: `<div class="field mb-12">
          <label>Deck name</label>
          <input class="input" name="deckName" value="${U.esc(n.title)}" required />
        </div>
        <div class="table-wrap" style="max-height:320px;overflow-y:auto">
          <table class="table"><thead><tr>
            <th style="width:32px"></th><th>Front</th><th>Back</th>
          </tr></thead><tbody>
            ${found.map((c, i) => `<tr>
              <td><input type="checkbox" class="check" data-card="${i}" checked /></td>
              <td><input class="input input-sm" data-front="${i}" value="${U.esc(c.front)}" /></td>
              <td><input class="input input-sm" data-back="${i}" value="${U.esc(c.back)}" /></td>
            </tr>`).join("")}
          </tbody></table>
        </div>
        <p class="hint mt-8">Untick anything that isn't a real card.</p>`,
      onSubmit(d, root) {
        const cards = [];
        U.$$("[data-card]", root).forEach((cb) => {
          if (!cb.checked) return;
          const i = cb.dataset.card;
          const front = root.querySelector(`[data-front="${i}"]`).value.trim();
          const back = root.querySelector(`[data-back="${i}"]`).value.trim();
          if (front && back) cards.push({ id: U.uid("c"), front, back, box: 1, next: U.today(), lastReviewed: null });
        });
        if (!cards.length) { UI.toast("Nothing selected", "Tick at least one card.", "warn"); return false; }
        S.insert("decks", { name: d.deckName.trim() || n.title, classId: n.classId, cards });
        UI.toast("Deck created", `${U.plural(cards.length, "card")} from "${n.title}"`, "ok");
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
          <div class="n-body">${U.esc(App.md.plain(n.body))}</div>
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
