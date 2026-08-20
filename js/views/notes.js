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
               <button type="button" class="icon-btn" data-copy-link title="Copy link to this note" aria-label="Copy link">🔗</button>
               <button type="button" class="btn" data-blurt title="Write what you remember, then compare">🧠 Blurt</button>
               <button type="button" class="btn" data-explain title="Explain it in plain language">💬 Explain simply</button>
               <button type="button" class="btn" data-cards>🃏 Make flashcards</button>
               <button type="button" class="btn" data-edit>Edit</button>
               <button type="button" class="btn btn-primary" data-close>Close</button>`,
      body: `${(n.tags || []).length ? `<div class="row gap-6 wrap mb-12">
          ${n.tags.map((t) => `<span class="tag">#${U.esc(t)}</span>`).join("")}</div>` : ""}
        <div class="md">${App.md.render(n.body)}</div>`,
      onMount(root) {
        root.querySelector("[data-edit]").addEventListener("click", () => { UI.closeModal(); form(n); });
        root.querySelector("[data-copy-link]").addEventListener("click", () => App.router.copyDeepLink("notes", n.id));
        root.querySelector("[data-cards]").addEventListener("click", () => { UI.closeModal(); toCards(n); });
        root.querySelector("[data-blurt]").addEventListener("click", () => { UI.closeModal(); blurtMode(n); });
        root.querySelector("[data-explain]").addEventListener("click", () => { UI.closeModal(); explainForm(n); });
        root.querySelector("[data-pin]").addEventListener("click", () => {
          S.update("notes", n.id, { pinned: !n.pinned });
          UI.closeModal();
          UI.toast(n.pinned ? "Unpinned" : "Pinned 📌", n.title);
        });
      }
    });
  }

  /* --------------------------------------------------------- F034 blurt -- */

  const STOPWORDS = new Set(["the", "and", "that", "with", "this", "from", "your", "have", "will",
    "which", "their", "into", "were", "when", "than", "then", "also", "such", "each", "about", "these"]);

  function keyTerms(text) {
    const words = (text || "").toLowerCase().match(/[a-z][a-z'-]{4,}/g) || [];
    const counts = {};
    words.forEach((w) => { if (!STOPWORDS.has(w)) counts[w] = (counts[w] || 0) + 1; });
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 20);
  }

  function blurtMode(n) {
    UI.modal({
      title: "Blurt it out",
      sub: n.title,
      size: "wide",
      okLabel: "Compare",
      body: `<p class="hint mb-8">Write everything you remember about "${U.esc(n.title)}" — no peeking — then compare against the note.</p>
        <textarea class="textarea" name="blurt" rows="10" placeholder="Start typing what you remember…"></textarea>`,
      onSubmit(d, root) {
        const terms = keyTerms(n.body);
        const blurtLower = (d.blurt || "").toLowerCase();
        const missed = terms.filter((t) => !blurtLower.includes(t));
        const got = terms.filter((t) => blurtLower.includes(t));
        setTimeout(() => UI.modal({
          title: "How you did",
          sub: n.title,
          size: "wide",
          footer: `<button type="button" class="btn btn-primary" data-close>Done</button>`,
          body: `<div class="row gap-16 wrap mb-16">
              <div><div class="tiny dim">Covered</div><div class="bold" style="color:var(--ok)">${got.length} of ${terms.length}</div></div>
            </div>
            ${missed.length ? `<h4 class="mb-8">You might have missed</h4>
              <div class="row gap-6 wrap mb-16">${missed.map((t) => `<span class="tag">${U.esc(t)}</span>`).join("")}</div>` : `<p class="small" style="color:var(--ok)">Nice — you hit every key term. 🎉</p>`}
            <div class="divider"></div>
            <h4 class="mb-8">Your blurt</h4>
            <p class="small muted" style="white-space:pre-wrap">${U.esc(d.blurt || "")}</p>`
        }), 0);
      }
    });
  }

  /* ------------------------------------------------------- F035 explain -- */

  function explainForm(n) {
    UI.modal({
      title: "Explain it simply",
      sub: n.title,
      okLabel: "Save reflection",
      body: `<p class="hint mb-8">Explain "${U.esc(n.title)}" like you're teaching a friend who's never heard of it.
        Where the explanation gets shaky is exactly what to restudy.</p>
        <textarea class="textarea" name="explanation" rows="8" placeholder="In simple terms…"></textarea>`,
      onSubmit(d) {
        if (!d.explanation.trim()) return false;
        S.addJournalEntry(`Explain simply — ${n.title}: ${d.explanation.trim()}`);
        UI.toast("Saved", "Your explanation was added to your journal.", "ok");
      }
    });
  }

  /* ------------------------------------------------------ F036 spaced rv -- */

  function reviewNotes() {
    const due = S.spacedNotes();
    if (!due.length) { UI.toast("All caught up! 🎉", "No notes due for review.", "ok"); return; }
    let i = 0, revealed = false;

    function step() {
      const n = due[i];
      if (!n) {
        UI.toast("Review complete", `${U.plural(due.length, "note")} reviewed`, "ok");
        return;
      }
      UI.modal({
        title: `Review ${i + 1} of ${due.length}`,
        sub: n.title,
        size: "wide",
        footer: revealed
          ? `<button type="button" class="btn" data-forgot>😕 Forgot</button>
             <button type="button" class="btn btn-primary" data-remembered>✅ Remembered</button>`
          : `<button type="button" class="btn btn-primary" data-reveal>Show note</button>`,
        body: revealed
          ? `<div class="md">${App.md.render(n.body)}</div>`
          : `<p class="dim center" style="padding:30px 0">Try to recall "${U.esc(n.title)}" before revealing it.</p>`,
        onMount(root) {
          const rv = root.querySelector("[data-reveal]");
          if (rv) rv.addEventListener("click", () => { revealed = true; UI.closeModal(); step(); });
          const grade = (remembered) => {
            S.reviewNote(n.id, remembered);
            revealed = false;
            i++;
            UI.closeModal();
            step();
          };
          const fg = root.querySelector("[data-forgot]");
          if (fg) fg.addEventListener("click", () => grade(false));
          const rm = root.querySelector("[data-remembered]");
          if (rm) rm.addEventListener("click", () => grade(true));
        }
      });
    }
    step();
  }

  /* ---------------------------------------------------- F037 formula sht -- */

  function formulaSheets() {
    UI.modal({
      title: "Formula sheets",
      sub: "Tag a note “formula” and it shows up here, grouped by class",
      size: "wide",
      footer: `<button type="button" class="btn btn-primary" data-close>Close</button>`,
      body: (() => {
        const sheet = S.formulaSheet();
        if (!sheet.length) return `<p class="dim small">No notes tagged "formula" yet. Add the tag "formula" to a note to include it here.</p>`;
        const byClass = U.groupBy(sheet, (n) => n.classId || "_none");
        return [...byClass.entries()].map(([clsId, notes]) => {
          const c = clsId !== "_none" ? S.cls(clsId) : null;
          return `<div class="mb-16">
            <div class="between mb-8">
              <h4>${c ? U.esc(c.name) : "General"}</h4>
              <button type="button" class="btn btn-sm" data-print-sheet="${clsId}">🖨 Print</button>
            </div>
            <div class="col gap-8" id="sheet-${U.esc(clsId)}">
              ${notes.map((n) => `<div class="card"><div class="card-body tight"><div class="bold small mb-4">${U.esc(n.title)}</div><div class="md">${App.md.render(n.body)}</div></div></div>`).join("")}
            </div>
          </div>`;
        }).join("");
      })(),
      onMount(root) {
        U.on(root, "click", "[data-print-sheet]", () => window.print());
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

  /* -------------------------------------------------------- F038 vocab -- */

  function vocabLists() {
    UI.modal({
      title: "Vocabulary lists",
      sub: "A lighter structure than flashcard decks — good for language classes",
      size: "wide",
      footer: `<button type="button" class="btn btn-primary" data-add-list>+ New list</button>`,
      body: S.db.vocabLists.length ? `<div class="list">${S.db.vocabLists.map((l) => {
        const c = S.cls(l.classId);
        return `<div class="list-item">
          <span class="grow"><div class="title">${U.esc(l.name)}</div>
            <div class="meta">${c ? U.esc(c.name) + " · " : ""}${U.plural((l.terms || []).length, "term")}</div></span>
          <button class="btn btn-sm" data-quiz-vocab="${l.id}">Quiz</button>
          <button class="btn btn-sm" data-edit-vocab="${l.id}">Edit</button>
          <button class="icon-btn btn-sm" data-del-vocab="${l.id}" aria-label="Delete">✕</button>
        </div>`;
      }).join("")}</div>` : `<p class="dim small">No vocabulary lists yet.</p>`,
      onMount(root) {
        root.querySelector("[data-add-list]").addEventListener("click", () => { UI.closeModal(); vocabListForm(null); });
        U.on(root, "click", "[data-edit-vocab]", (_e, el) => { UI.closeModal(); vocabListForm(S.byId("vocabLists", el.dataset.editVocab)); });
        U.on(root, "click", "[data-del-vocab]", (_e, el) => {
          const l = S.byId("vocabLists", el.dataset.delVocab);
          S.commit((db) => { db.vocabLists = db.vocabLists.filter((x) => x.id !== l.id); });
          UI.closeModal(); vocabLists();
          UI.toast("List deleted", l.name, "warn");
        });
        U.on(root, "click", "[data-quiz-vocab]", (_e, el) => { UI.closeModal(); vocabQuiz(el.dataset.quizVocab); });
      }
    });
  }

  function vocabListForm(list) {
    const l = list || { terms: [{ term: "", def: "" }] };
    const row = (t) => `<div class="row gap-8 mb-6" data-term>
      <input class="input grow" data-vt value="${U.esc(t.term || "")}" placeholder="Term" />
      <input class="input grow" data-vd value="${U.esc(t.def || "")}" placeholder="Definition" />
      <button type="button" class="icon-btn btn-sm" data-del-term>✕</button>
    </div>`;
    UI.modal({
      title: list ? "Edit vocabulary list" : "New vocabulary list",
      size: "wide",
      okLabel: "Save",
      body: `<div class="form-grid mb-12">
          <div class="field full"><label>Name</label>
            <input class="input" name="name" required value="${U.esc(l.name || "")}" placeholder="Unit 5 — Spanish verbs" /></div>
          <div class="field"><label>Class</label>
            <select class="select" name="classId">${UI.classOptions(l.classId, true)}</select></div>
        </div>
        <div id="termRows">${l.terms.map(row).join("")}</div>
        <button type="button" class="btn btn-sm" id="addTerm">+ Add term</button>`,
      onMount(root) {
        const box = root.querySelector("#termRows");
        root.querySelector("#addTerm").addEventListener("click", () => box.insertAdjacentHTML("beforeend", row({})));
        box.addEventListener("click", (e) => { const b = e.target.closest("[data-del-term]"); if (b) b.closest("[data-term]").remove(); });
      },
      onSubmit(d, root) {
        if (!d.name.trim()) return false;
        const terms = U.$$("[data-term]", root).map((row) => ({
          term: row.querySelector("[data-vt]").value.trim(),
          def: row.querySelector("[data-vd]").value.trim()
        })).filter((t) => t.term && t.def);
        if (!terms.length) return false;
        const patch = { name: d.name.trim(), classId: d.classId || null, terms };
        if (list) S.update("vocabLists", list.id, patch);
        else S.insert("vocabLists", patch);
        UI.toast("List saved", patch.name, "ok");
      }
    });
  }

  function vocabQuiz(listId) {
    const queue = S.vocabQuizQueue(listId);
    if (!queue.length) return;
    let i = 0, correct = 0, wrong = 0;

    function step() {
      if (i >= queue.length) {
        UI.toast(`Quiz complete`, `${correct} right · ${wrong} wrong`, correct >= wrong ? "ok" : "warn");
        return;
      }
      const t = queue[i];
      UI.modal({
        title: `Term ${i + 1} of ${queue.length}`,
        okLabel: "Check",
        body: `<div class="card mb-12"><div class="card-body center"><div style="font-size:1.2rem;font-weight:650">${U.esc(t.term)}</div></div></div>
          <div class="field"><label>Definition</label><input class="input" name="answer" autocomplete="off" autofocus /></div>`,
        onSubmit(d) {
          const right = (d.answer || "").trim().toLowerCase() === t.def.trim().toLowerCase();
          if (right) correct++; else wrong++;
          UI.toast(right ? "Correct ✓" : "Not quite", right ? "" : `Answer: ${t.def}`, right ? "ok" : "warn");
          i++;
          setTimeout(step, 0);
        }
      });
    }
    step();
  }

  /* --------------------------------------------------- F039 concept maps */

  function conceptMaps() {
    UI.modal({
      title: "Concept maps",
      sub: "Sketch how ideas relate — not every subject is list-shaped",
      size: "wide",
      footer: `<button type="button" class="btn btn-primary" data-add-map>+ New map</button>`,
      body: S.db.conceptMaps.length ? `<div class="list">${S.db.conceptMaps.map((m) => `
        <div class="list-item">
          <span class="grow"><div class="title">${U.esc(m.name)}</div>
            <div class="meta">${U.plural((m.nodes || []).length, "node")} · ${U.plural((m.edges || []).length, "connection")}</div></span>
          <button class="btn btn-sm" data-view-map="${m.id}">View</button>
          <button class="btn btn-sm" data-edit-map="${m.id}">Edit</button>
          <button class="icon-btn btn-sm" data-del-map="${m.id}" aria-label="Delete">✕</button>
        </div>`).join("")}</div>` : `<p class="dim small">No concept maps yet.</p>`,
      onMount(root) {
        root.querySelector("[data-add-map]").addEventListener("click", () => { UI.closeModal(); conceptMapForm(null); });
        U.on(root, "click", "[data-edit-map]", (_e, el) => { UI.closeModal(); conceptMapForm(S.byId("conceptMaps", el.dataset.editMap)); });
        U.on(root, "click", "[data-view-map]", (_e, el) => { UI.closeModal(); conceptMapView(S.byId("conceptMaps", el.dataset.viewMap)); });
        U.on(root, "click", "[data-del-map]", (_e, el) => {
          const m = S.byId("conceptMaps", el.dataset.delMap);
          S.commit((db) => { db.conceptMaps = db.conceptMaps.filter((x) => x.id !== m.id); });
          UI.closeModal(); conceptMaps();
          UI.toast("Map deleted", m.name, "warn");
        });
      }
    });
  }

  function conceptMapForm(map) {
    const m = map || { nodes: ["", ""], edges: [] };
    const nodeRow = (label, i) => `<div class="row gap-8 mb-6" data-node="${i}">
      <input class="input grow" data-node-label value="${U.esc(label)}" placeholder="Idea ${i + 1}" />
      <button type="button" class="icon-btn btn-sm" data-del-node>✕</button>
    </div>`;
    const edgeRow = (e) => `<div class="row gap-8 mb-6" data-edge>
      <input class="input" style="width:120px" data-edge-from value="${U.esc(e.from || "")}" placeholder="From" />
      <input class="input grow" data-edge-label value="${U.esc(e.label || "")}" placeholder="relates to…" />
      <input class="input" style="width:120px" data-edge-to value="${U.esc(e.to || "")}" placeholder="To" />
      <button type="button" class="icon-btn btn-sm" data-del-edge>✕</button>
    </div>`;
    UI.modal({
      title: map ? "Edit concept map" : "New concept map",
      size: "wide",
      okLabel: "Save",
      body: `<div class="field mb-12"><label>Name</label>
          <input class="input" name="name" required value="${U.esc(m.name || "")}" placeholder="The Cell Cycle" /></div>
        <h4 class="mb-8">Ideas</h4>
        <div id="nodeRows">${m.nodes.map(nodeRow).join("")}</div>
        <button type="button" class="btn btn-sm mb-12" id="addNode">+ Add idea</button>
        <div class="divider"></div>
        <h4 class="mb-8">Connections <span class="hint">use the exact idea text for "From"/"To"</span></h4>
        <div id="edgeRows">${(m.edges.length ? m.edges : [{}]).map(edgeRow).join("")}</div>
        <button type="button" class="btn btn-sm" id="addEdge">+ Add connection</button>`,
      onMount(root) {
        const nodeBox = root.querySelector("#nodeRows");
        root.querySelector("#addNode").addEventListener("click", () => nodeBox.insertAdjacentHTML("beforeend", nodeRow("", nodeBox.children.length)));
        nodeBox.addEventListener("click", (e) => { const b = e.target.closest("[data-del-node]"); if (b) b.closest("[data-node]").remove(); });
        const edgeBox = root.querySelector("#edgeRows");
        root.querySelector("#addEdge").addEventListener("click", () => edgeBox.insertAdjacentHTML("beforeend", edgeRow({})));
        edgeBox.addEventListener("click", (e) => { const b = e.target.closest("[data-del-edge]"); if (b) b.closest("[data-edge]").remove(); });
      },
      onSubmit(d, root) {
        if (!d.name.trim()) return false;
        const nodes = U.$$("[data-node]", root).map((r) => r.querySelector("[data-node-label]").value.trim()).filter(Boolean);
        const edges = U.$$("[data-edge]", root).map((r) => ({
          from: r.querySelector("[data-edge-from]").value.trim(),
          to: r.querySelector("[data-edge-to]").value.trim(),
          label: r.querySelector("[data-edge-label]").value.trim()
        })).filter((e) => e.from && e.to && nodes.includes(e.from) && nodes.includes(e.to));
        if (nodes.length < 2) return false;
        const patch = { name: d.name.trim(), nodes, edges };
        if (map) S.update("conceptMaps", map.id, patch);
        else S.insert("conceptMaps", patch);
        UI.toast("Map saved", patch.name, "ok");
      }
    });
  }

  // Deterministic circle layout — no physics needed for a handful of nodes.
  function conceptMapView(m) {
    if (!m) return;
    const n = m.nodes.length;
    const R = 150, cx = 200, cy = 200;
    const pos = m.nodes.map((_, i) => ({
      x: cx + R * Math.cos((i / n) * 2 * Math.PI - Math.PI / 2),
      y: cy + R * Math.sin((i / n) * 2 * Math.PI - Math.PI / 2)
    }));
    const idx = (label) => m.nodes.indexOf(label);

    UI.modal({
      title: m.name,
      size: "wide",
      footer: `<button type="button" class="btn btn-primary" data-close>Close</button>`,
      body: `<svg viewBox="0 0 400 400" style="width:100%;max-width:500px;display:block;margin:0 auto">
        ${m.edges.map((e) => {
          const a = pos[idx(e.from)], b = pos[idx(e.to)];
          if (!a || !b) return "";
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="var(--border)" stroke-width="2" />
            <text x="${mx}" y="${my}" font-size="10" fill="var(--muted)" text-anchor="middle">${U.esc(e.label)}</text>`;
        }).join("")}
        ${pos.map((p, i) => `
          <circle cx="${p.x}" cy="${p.y}" r="34" fill="var(--brand-500)" opacity=".14" stroke="var(--brand-500)" stroke-width="1.5" />
          <text x="${p.x}" y="${p.y}" font-size="11" font-weight="700" fill="var(--text)" text-anchor="middle" dominant-baseline="middle">
            ${U.esc(m.nodes[i]).slice(0, 14)}</text>`).join("")}
      </svg>`
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
          ${S.spacedNotes().length ? `<button class="btn" data-review-notes>📅 Review due (${S.spacedNotes().length})</button>` : ""}
          <button class="btn" data-formula-sheets>📐 Formula sheets</button>
          <button class="btn" data-vocab-lists>🔤 Vocabulary</button>
          <button class="btn" data-concept-maps>🕸 Concept maps</button>
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
      : UI.emptyState("notes", q || clsFilter || tagFilter ? "No notes match" : "No notes yet",
          q || clsFilter || tagFilter ? "Try clearing your filters." : "Keep formulas, vocab, and study guides here — searchable and organized by class.",
          `<button class="btn btn-primary" data-new>+ Write your first note</button>`)}
    </div>`;
  }

  function mount(root) {
    U.on(root, "click", "[data-new]", () => form(null));
    U.on(root, "click", "[data-note]", (_e, el) => reader(el.dataset.note));
    U.on(root, "click", "[data-tag]", (_e, el) => { tagFilter = el.dataset.tag; App.router.refresh(); });
    U.on(root, "click", "[data-review-notes]", () => reviewNotes());
    U.on(root, "click", "[data-formula-sheets]", () => formulaSheets());
    U.on(root, "click", "[data-vocab-lists]", () => vocabLists());
    U.on(root, "click", "[data-concept-maps]", () => conceptMaps());

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

  return { render, mount, reader, title: "Notes" };
})();
