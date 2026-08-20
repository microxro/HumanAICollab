/* ==========================================================================
   views/groups.js — study groups: shared decks + crowdsourced assignments

   Requires an account (this is the one genuinely server-backed feature set,
   alongside sync and the parent portal).
   ========================================================================== */

App.views.groups = (function () {
  const U = App.utils, S = App.store, UI = App.ui;

  let groups = null;      // list cache
  let openGroup = null;   // full detail of the selected group
  let loading = false;
  let error = null;

  /* --------------------------------------------------------------- data */

  function refresh() {
    if (!App.sync.isSignedIn()) { groups = []; return Promise.resolve(); }
    loading = true;
    return App.sync.listGroups()
      .then((g) => { groups = g; error = null; })
      .catch((e) => { error = e.message; groups = []; })
      .then(() => { loading = false; App.router.refresh(); });
  }

  function openDetail(id) {
    loading = true;
    App.router.refresh();
    App.sync.getGroup(id)
      .then((g) => { openGroup = g; error = null; })
      .catch((e) => { error = e.message; })
      .then(() => { loading = false; App.router.refresh(); });
  }

  /* -------------------------------------------------------------- forms */

  function createForm() {
    UI.modal({
      title: "New study group",
      okLabel: "Create",
      body: `<div class="field">
          <label>Group name</label>
          <input class="input" name="name" required placeholder="AP Chem — Period 2" />
        </div>
        <p class="hint mt-8">You'll get a join code to share with classmates.</p>`,
      onSubmit(d) {
        if (!d.name.trim()) return false;
        App.sync.createGroup(d.name.trim())
          .then((g) => {
            UI.toast("Group created", `Share code ${g.code}`, "ok");
            refresh();
          })
          .catch((e) => UI.toast("Couldn't create group", e.message, "danger"));
      }
    });
  }

  function joinForm() {
    UI.modal({
      title: "Join a group",
      okLabel: "Join",
      body: `<div class="field">
          <label>Join code</label>
          <input class="input mono" name="code" required maxlength="8" placeholder="ABC123"
                 style="text-transform:uppercase;letter-spacing:.15em;font-size:1.1rem;text-align:center" />
        </div>`,
      onSubmit(d) {
        App.sync.joinGroup(d.code.trim().toUpperCase())
          .then((g) => { UI.toast("Joined", g.name, "ok"); refresh(); })
          .catch((e) => UI.toast("Couldn't join", e.message, "danger"));
      }
    });
  }

  function shareDeckForm(groupId) {
    const decks = S.db.decks;
    if (!decks.length) { UI.toast("No decks yet", "Create a flashcard deck first."); return; }
    UI.modal({
      title: "Share a deck",
      okLabel: "Share",
      body: `<div class="field">
          <label>Which deck?</label>
          <select class="select" name="deckId">
            ${decks.map((d) => `<option value="${d.id}">${U.esc(d.name)} (${d.cards.length} cards)</option>`).join("")}
          </select>
        </div>
        <p class="hint mt-8">Everyone in the group gets a copy they can import. Your review progress stays private.</p>`,
      onSubmit(d) {
        const deck = S.byId("decks", d.deckId);
        App.sync.shareDeck(groupId, { name: deck.name, cards: deck.cards.map((c) => ({ front: c.front, back: c.back })) })
          .then(() => { UI.toast("Deck shared", deck.name, "ok"); openDetail(groupId); })
          .catch((e) => UI.toast("Couldn't share", e.message, "danger"));
      }
    });
  }

  function postForm(groupId) {
    UI.modal({
      title: "Post an assignment",
      sub: "Help everyone who missed it",
      okLabel: "Post",
      body: `<div class="form-grid">
        <div class="field full"><label>What's the assignment?</label>
          <input class="input" name="title" required placeholder="Read Ch. 12 + answer questions 1–8" /></div>
        <div class="field"><label>Class</label>
          <select class="select" name="className">
            ${S.termClasses().map((c) => `<option>${U.esc(c.name)}</option>`).join("")}
          </select></div>
        <div class="field"><label>Due</label>
          <input class="input" type="date" name="due" value="${U.dateKey(U.addDays(new Date(), 1))}" /></div>
        <div class="field full"><label>Notes</label>
          <textarea class="textarea" name="notes" rows="2" placeholder="Anything else people should know"></textarea></div>
      </div>`,
      onSubmit(d) {
        if (!d.title.trim()) return false;
        App.sync.postFeed(groupId, {
          title: d.title.trim(), className: d.className, due: d.due, notes: d.notes.trim()
        })
          .then(() => { UI.toast("Posted", "Thanks for sharing 🙌", "ok"); openDetail(groupId); })
          .catch((e) => UI.toast("Couldn't post", e.message, "danger"));
      }
    });
  }

  function importDeck(groupId, deckId, name) {
    App.sync.getSharedDeck(groupId, deckId).then((deck) => {
      S.insert("decks", {
        name: deck.name + " (shared)",
        classId: null,
        cards: deck.cards.map((c) => ({
          id: U.uid("c"), front: c.front, back: c.back, box: 1, next: U.today(), lastReviewed: null
        }))
      });
      UI.toast("Deck imported", `${deck.cards.length} cards added to your flashcards`, "ok");
    }).catch((e) => UI.toast("Import failed", e.message, "danger"));
  }

  function addFeedItem(item) {
    const cls = S.termClasses().find((c) => c.name === item.className) || S.termClasses()[0];
    S.insert("assignments", {
      title: item.title, classId: cls ? cls.id : null,
      categoryId: cls && cls.categories[0] ? cls.categories[0].id : null,
      due: item.due || U.today(), assigned: U.today(), type: "Homework", priority: "med",
      status: "todo", points: 100, earned: null, graded: false,
      estMinutes: 45, actualMinutes: 0, subtasks: [], notes: item.notes || "",
      termId: (S.currentTerm() || {}).id, scheduledFor: null, scheduledMin: null, missing: false
    });
    UI.toast("Added to your homework", item.title, "ok");
  }

  /* ------------------------------------------------------------- render */

  function signedOut() {
    return `<div class="page-inner">
      <div class="page-head"><div><h1>Study groups</h1>
        <div class="sub">Share decks and crowdsource what the homework actually was</div></div></div>
      ${UI.emptyState("👥", "Sign in to use study groups",
        "Groups are the one feature that needs an account, because they sync between people. Everything else in Scholar works offline.",
        `<button class="btn btn-primary" data-go="settings">Go to settings to sign in</button>`)}
    </div>`;
  }

  function detailView() {
    const g = openGroup;
    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>${U.esc(g.name)}</h1>
          <div class="sub">${U.plural(g.memberCount, "member")} · join code
            <span class="kbd mono">${U.esc(g.code)}</span></div>
        </div>
        <div class="page-actions">
          <button class="btn" data-back>← All groups</button>
          <button class="btn" data-share-deck="${g.id}">Share a deck</button>
          <button class="btn btn-primary" data-post="${g.id}">+ Post assignment</button>
        </div>
      </div>

      <div class="grid g-main">
        <div class="card">
          <div class="card-head">
            <div><h3>Assignment feed</h3><div class="sub">What the class says is due</div></div>
          </div>
          ${g.feed.length ? `<div class="list">${U.sortBy(g.feed, (f) => f.at, true).map((f) => `
            <div class="list-item">
              <span class="grow" style="min-width:0">
                <div class="title">${U.esc(f.title)}</div>
                <div class="meta">${U.esc(f.className || "")}${f.due ? " · due " + U.esc(U.fmtDate(f.due)) : ""}
                  · posted by ${U.esc(f.byName)}</div>
                ${f.notes ? `<div class="tiny muted mt-4">${U.esc(f.notes)}</div>` : ""}
              </span>
              <span class="badge ${f.confirms.length > 1 ? "ok" : ""}">✓ ${f.confirms.length}</span>
              <button class="btn btn-sm" data-confirm="${f.id}">Confirm</button>
              <button class="btn btn-sm btn-primary" data-take='${U.esc(JSON.stringify({ title: f.title, className: f.className, due: f.due, notes: f.notes }))}'>Add</button>
            </div>`).join("")}</div>`
          : UI.emptyState("📝", "Nothing posted yet", "Be the first to share what's due.")}
        </div>

        <div class="col gap-16">
          <div class="card">
            <div class="card-head"><h3>Shared decks</h3><span class="badge">${g.decks.length}</span></div>
            ${g.decks.length ? `<div class="list">${g.decks.map((d) => `
              <div class="list-item">
                <span class="grow"><div class="title truncate">${U.esc(d.name)}</div>
                  <div class="meta">${d.cardCount} cards · ${U.esc(d.byName)}</div></span>
                <button class="btn btn-sm" data-import="${d.id}">Import</button>
              </div>`).join("")}</div>`
            : `<div class="card-body"><p class="dim small">No decks shared yet.</p></div>`}
          </div>

          <div class="card">
            <div class="card-head"><h3>Members</h3></div>
            <div class="list">
              ${g.members.map((m) => `<div class="list-item">
                ${UI.avatar(m.name, S.PALETTE[(m.name.charCodeAt(0) || 0) % S.PALETTE.length], "sm")}
                <span class="grow"><div class="title">${U.esc(m.name)}</div></span>
                ${m.id === g.ownerId ? `<span class="badge brand">Owner</span>` : ""}
              </div>`).join("")}
            </div>
            <div class="card-foot">
              <button class="btn btn-sm btn-danger" data-leave="${g.id}">Leave group</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }

  function render() {
    if (!App.sync.isSignedIn()) return signedOut();
    if (openGroup) return detailView();

    if (groups === null) { refresh(); }

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>Study groups</h1>
          <div class="sub">Shared flashcards and a crowdsourced "what's the homework?" feed</div>
        </div>
        <div class="page-actions">
          <button class="btn" data-join>Join with a code</button>
          <button class="btn btn-primary" data-create>+ New group</button>
        </div>
      </div>

      ${error ? `<div class="card mb-16" style="border-left:3px solid var(--danger)">
        <div class="card-body small">${U.esc(error)}</div></div>` : ""}

      ${loading && !groups ? `<p class="dim center" style="padding:40px">Loading…</p>`
        : (groups && groups.length) ? `<div class="grid g-3">${groups.map((g) => `
          <div class="card card-link" data-open="${g.id}">
            <div class="card-body">
              <h3 class="truncate mb-4">${U.esc(g.name)}</h3>
              <div class="tiny dim mb-12">Code <span class="mono">${U.esc(g.code)}</span></div>
              <div class="row gap-6 wrap">
                <span class="badge">${U.plural(g.memberCount, "member")}</span>
                <span class="badge">${U.plural(g.deckCount, "deck")}</span>
                <span class="badge">${U.plural(g.feedCount, "post")}</span>
              </div>
            </div>
          </div>`).join("")}</div>`
        : UI.emptyState("👥", "No groups yet",
            "Create one for a class and share the code, or join a friend's with theirs.",
            `<button class="btn btn-primary" data-create>+ Create a group</button>`)}
    </div>`;
  }

  function mount(root) {
    U.on(root, "click", "[data-create]", createForm);
    U.on(root, "click", "[data-join]", joinForm);
    U.on(root, "click", "[data-open]", (_e, el) => openDetail(el.dataset.open));
    U.on(root, "click", "[data-back]", () => { openGroup = null; App.router.refresh(); });
    U.on(root, "click", "[data-share-deck]", (_e, el) => shareDeckForm(el.dataset.shareDeck));
    U.on(root, "click", "[data-post]", (_e, el) => postForm(el.dataset.post));
    U.on(root, "click", "[data-import]", (_e, el) => importDeck(openGroup.id, el.dataset.import));
    U.on(root, "click", "[data-confirm]", (_e, el) => {
      App.sync.confirmFeed(openGroup.id, el.dataset.confirm)
        .then(() => openDetail(openGroup.id))
        .catch((e) => UI.toast("Failed", e.message, "danger"));
    });
    U.on(root, "click", "[data-take]", (_e, el) => {
      try { addFeedItem(JSON.parse(el.dataset.take)); }
      catch (e) { UI.toast("Couldn't add that", "", "danger"); }
    });
    U.on(root, "click", "[data-leave]", (_e, el) => {
      UI.confirm({
        title: "Leave this group?",
        message: openGroup.ownerId === (App.sync.info().user || {}).id
          ? "You own this group — leaving deletes it for everyone."
          : "You can rejoin later with the code.",
        okLabel: "Leave", danger: true,
        onConfirm() {
          App.sync.leaveGroup(el.dataset.leave)
            .then(() => { openGroup = null; UI.toast("Left the group"); refresh(); })
            .catch((e) => UI.toast("Failed", e.message, "danger"));
        }
      });
    });
  }

  function unmount() { openGroup = null; groups = null; }

  return { render, mount, unmount, title: "Groups" };
})();
