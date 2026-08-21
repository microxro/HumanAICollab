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
  let expandedFeedId = null;   // F058 — which post's comment thread is open
  let groupTab = "feed";       // F054-F063 — which collaboration panel is open

  /* --------------------------------------------------------------- data */

  function refresh() {
    if (!App.sync.isSignedIn()) { groups = []; return Promise.resolve(); }
    loading = true;
    return App.sync.listGroups()
      .then((g) => { groups = g; error = null; })
      .catch((e) => { error = e.message; groups = []; })
      .then(() => { loading = false; App.router.refresh(); });
  }

  // Returns the promise so callers that mutate a group can await the reload
  // and know the panel is showing server truth, not an optimistic guess.
  function openDetail(id) {
    loading = true;
    App.router.refresh();
    return App.sync.getGroup(id)
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

  function joinForm(prefillCode) {
    UI.modal({
      title: "Join a group",
      okLabel: "Join",
      body: `<div class="field">
          <label>Join code</label>
          <input class="input mono" name="code" required maxlength="8" placeholder="ABC123" value="${U.esc(prefillCode || "")}"
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
      <div class="page-head"><div><h1>${App.i18n.t("groups", "Study groups")}</h1>
        <div class="sub">Share decks and crowdsource what the homework actually was</div></div></div>
      ${UI.emptyState("groupsSignIn", "Sign in to use study groups",
        "Groups are the one feature that needs an account, because they sync between people. Everything else in Scholar works offline.",
        `<button class="btn btn-primary" data-go="settings">Go to settings to sign in</button>`)}
    </div>`;
  }

  /* ============================================ F054-F063 collaboration UI ==
     Seven features would bury the feed if they all rendered at once, so the
     group detail is tabbed. Everything reads from the same group payload
     getGroup() already returns — no extra round-trips to switch tabs.
     ========================================================================= */

  /* ------------------------------------- F054-F063 collaboration forms -- */

  function taskForm(groupId) {
    const g = openGroup;
    UI.modal({
      title: "Add a task",
      sub: g.name,
      okLabel: "Add task",
      body: `<div class="form-grid">
        <div class="field full"><label>What needs doing?</label>
          <input class="input" name="title" required placeholder="e.g. Build the slide deck" /></div>
        <div class="field full"><label>Details <span class="hint">optional</span></label>
          <textarea class="textarea" name="detail" rows="2"></textarea></div>
        <div class="field"><label>Assign to</label>
          <select class="select" name="assigneeId">
            <option value="">— Nobody yet —</option>
            ${g.members.map((m) => `<option value="${U.esc(m.id)}">${U.esc(m.name)}</option>`).join("")}
          </select></div>
        <div class="field"><label>Due <span class="hint">optional</span></label>
          <input class="input" type="date" name="due" /></div>
      </div>`,
      onSubmit(d) {
        if (!d.title.trim()) return false;
        App.sync.addGroupTask(groupId, {
          title: d.title.trim(), detail: d.detail.trim(),
          assigneeId: d.assigneeId || null, due: d.due || ""
        }).then(() => { UI.toast("Task added", d.title.trim(), "ok"); openDetail(groupId); })
          .catch((e) => UI.toast("Didn't work", e.message, "danger"));
      }
    });
  }

  function partnerForm(groupId) {
    const g = openGroup;
    const mine = myId();
    const taken = (g.partners || []).filter((p) => p.aId === mine || p.bId === mine)
      .map((p) => (p.aId === mine ? p.bId : p.aId));
    const options = g.members.filter((m) => m.id !== mine && !taken.includes(m.id));

    if (!options.length) {
      UI.toast("Nobody to ask", "You've already asked everyone in this group.", "warn");
      return;
    }

    UI.modal({
      title: "Ask someone to be your partner",
      sub: "They see when you're falling behind, and you see the same for them — both sides have to agree.",
      okLabel: "Send request",
      body: `<div class="field">
        <label>Who?</label>
        <select class="select" name="withId">
          ${options.map((m) => `<option value="${U.esc(m.id)}">${U.esc(m.name)}</option>`).join("")}
        </select>
      </div>`,
      onSubmit(d) {
        App.sync.requestPartner(groupId, d.withId)
          .then(() => { UI.toast("Request sent", "They'll see it in this group.", "ok"); openDetail(groupId); })
          .catch((e) => UI.toast("Didn't work", e.message, "danger"));
      }
    });
  }

  function tutoringForm(groupId) {
    UI.modal({
      title: "Post to the tutoring board",
      okLabel: "Post",
      body: `<div class="form-grid">
        <div class="field full"><label>Are you offering or asking?</label>
          <select class="select" name="kind">
            <option value="request">I need help with something</option>
            <option value="offer">I can help with something</option>
          </select></div>
        <div class="field full"><label>Subject or topic</label>
          <input class="input" name="subject" required placeholder="e.g. Quadratic equations" /></div>
        <div class="field full"><label>Details <span class="hint">optional</span></label>
          <textarea class="textarea" name="detail" rows="2" placeholder="What specifically?"></textarea></div>
        <div class="field full"><label>When you're around <span class="hint">optional</span></label>
          <input class="input" name="availability" placeholder="e.g. Tue/Thu after school" /></div>
      </div>`,
      onSubmit(d) {
        if (!d.subject.trim()) return false;
        App.sync.postTutoring(groupId, {
          kind: d.kind, subject: d.subject.trim(),
          detail: d.detail.trim(), availability: d.availability.trim()
        }).then(() => { UI.toast("Posted", d.subject.trim(), "ok"); openDetail(groupId); })
          .catch((e) => UI.toast("Didn't work", e.message, "danger"));
      }
    });
  }

  function shareNoteForm(groupId) {
    const mine = S.db.notes || [];
    UI.modal({
      title: "Share a note with the group",
      sub: "Your name stays attached to it",
      size: "wide",
      okLabel: "Share it",
      body: `<div class="form-grid">
        ${mine.length ? `<div class="field full">
          <label>Start from one of your notes <span class="hint">optional</span></label>
          <select class="select" id="pickNote">
            <option value="">— Write something new —</option>
            ${mine.map((n) => `<option value="${U.esc(n.id)}">${U.esc(n.title)}</option>`).join("")}
          </select>
        </div>` : ""}
        <div class="field full"><label>Title</label>
          <input class="input" name="title" required placeholder="e.g. Unit 4 study guide" /></div>
        <div class="field full"><label>Subject <span class="hint">optional</span></label>
          <input class="input" name="subject" placeholder="e.g. Biology" /></div>
        <div class="field full"><label>Content <span class="hint">Markdown supported</span></label>
          <textarea class="textarea" name="body" id="shareBody" rows="10" required></textarea></div>
      </div>`,
      onMount(root) {
        const pick = root.querySelector("#pickNote");
        if (pick) pick.addEventListener("change", () => {
          const n = S.byId("notes", pick.value);
          if (!n) return;
          root.querySelector('[name="title"]').value = n.title;
          root.querySelector("#shareBody").value = n.body;
          const c = S.cls(n.classId);
          if (c) root.querySelector('[name="subject"]').value = c.name;
        });
      },
      onSubmit(d) {
        if (!d.title.trim() || !d.body.trim()) return false;
        App.sync.shareNote(groupId, {
          title: d.title.trim(), body: d.body, subject: d.subject.trim()
        }).then(() => { UI.toast("Note shared", d.title.trim(), "ok"); openDetail(groupId); })
          .catch((e) => UI.toast("Didn't work", e.message, "danger"));
      }
    });
  }

  function readSharedNote(noteId) {
    App.sync.getSharedNote(openGroup.id, noteId).then(({ note }) => {
      UI.modal({
        title: note.title,
        sub: `Shared by ${note.byName}${note.subject ? " · " + note.subject : ""}`,
        size: "wide",
        footer: `<button type="button" class="btn left" data-thank>🙏 Thanks</button>
                 <button type="button" class="btn" data-save-copy>Save to my notes</button>
                 <button type="button" class="btn btn-primary" data-close>Close</button>`,
        body: `<div class="md">${App.md.render(note.body)}</div>`,
        onMount(root) {
          root.querySelector("[data-thank]").addEventListener("click", () => {
            App.sync.thankNote(openGroup.id, noteId)
              .then(() => { UI.toast("Thanks sent", note.byName + " will see it.", "ok"); UI.closeModal(); openDetail(openGroup.id); })
              .catch((e) => UI.toast("Didn't work", e.message, "danger"));
          });
          root.querySelector("[data-save-copy]").addEventListener("click", () => {
            // Attribution follows the copy, so credit survives the import.
            S.insert("notes", {
              title: note.title,
              body: `${note.body}\n\n---\n_Shared by ${note.byName} in ${openGroup.name}_`,
              classId: null, tags: ["shared"], pinned: false,
              created: U.today(), updated: U.today()
            });
            UI.closeModal();
            UI.toast("Saved to your notes", note.title, "ok");
          });
        }
      });
    }).catch((e) => UI.toast("Couldn't open that note", e.message, "danger"));
  }

  function challengeForm(groupId) {
    UI.modal({
      title: "Start a group challenge",
      sub: "Everyone's effort adds to one shared total — nobody is ranked against anyone",
      okLabel: "Create",
      body: `<div class="form-grid">
        <div class="field full"><label>What's the goal?</label>
          <input class="input" name="title" required placeholder="e.g. 20 study hours together this week" /></div>
        <div class="field"><label>Measured by</label>
          <select class="select" name="metric">
            <option value="studyMinutes">Study minutes</option>
            <option value="assignmentsDone">Assignments completed</option>
          </select></div>
        <div class="field"><label>Target</label>
          <input class="input" type="number" name="target" min="1" value="1200" required /></div>
        <div class="field"><label>Unit</label>
          <input class="input" name="unit" value="minutes" /></div>
        <div class="field"><label>Ends <span class="hint">optional</span></label>
          <input class="input" type="date" name="endsOn" /></div>
      </div>`,
      onSubmit(d) {
        if (!d.title.trim() || !(Number(d.target) > 0)) return false;
        App.sync.createChallenge(groupId, {
          title: d.title.trim(), metric: d.metric,
          target: Number(d.target), unit: d.unit.trim() || "minutes",
          endsOn: d.endsOn || ""
        }).then(() => { UI.toast("Challenge created", d.title.trim(), "ok"); openDetail(groupId); })
          .catch((e) => UI.toast("Didn't work", e.message, "danger"));
      }
    });
  }

  function detailHead(g) {
    return `<div class="page-head">
      <div>
        <h1>${U.esc(g.name)}</h1>
        <div class="sub">${U.plural(g.memberCount, "member")} · join code
          <span class="kbd mono">${U.esc(g.code)}</span></div>
      </div>
      <div class="page-actions">
        <button class="btn" data-back>← All groups</button>
        <button class="btn" data-invite-link="${g.code}" title="Share a joinable link, not just the code">🔗 Invite link</button>
        <button class="btn" data-share-deck="${g.id}">Share a deck</button>
        <button class="btn btn-primary" data-post="${g.id}">+ Post assignment</button>
      </div>
    </div>`;
  }

  function groupTabsHTML(counts) {
    return `<div class="tabs mb-16 scroll-x">
      ${GROUP_TABS.map((t) => {
        const n = counts[t.id] || 0;
        return `<button class="tab ${groupTab === t.id ? "active" : ""}" data-gtab="${t.id}">
          ${U.esc(t.label)}${n ? ` <span class="badge">${n}</span>` : ""}
        </button>`;
      }).join("")}
    </div>`;
  }

  const GROUP_TABS = [
    { id: "feed", label: "Feed" },
    { id: "tasks", label: "Tasks" },
    { id: "meet", label: "Meet up" },
    { id: "partners", label: "Partners" },
    { id: "tutoring", label: "Tutoring" },
    { id: "notes", label: "Notes" },
    { id: "challenges", label: "Challenges" }
  ];

  function myId() { return (App.sync.info().user || {}).id; }

  /** F057 — intersect every shared busy list to find when everyone is free. */
  function commonFree(g, dayFilter) {
    const DAY_START = 7 * 60, DAY_END = 22 * 60, MIN_BLOCK = 30;
    const shared = g.availability || [];
    if (!shared.length) return [];

    const days = dayFilter ? [dayFilter] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const out = [];

    days.forEach((day) => {
      // Merge every member's busy blocks for this day into one busy timeline.
      const busy = [];
      shared.forEach((m) => (m.busy || []).forEach((b) => {
        if (b.day === day) busy.push([U.toMin(b.start), U.toMin(b.end)]);
      }));
      busy.sort((a, b) => a[0] - b[0]);

      const merged = [];
      busy.forEach(([s, e]) => {
        const last = merged[merged.length - 1];
        if (last && s <= last[1]) last[1] = Math.max(last[1], e);
        else merged.push([s, e]);
      });

      let cursor = DAY_START;
      merged.forEach(([s, e]) => {
        if (s - cursor >= MIN_BLOCK) out.push({ day, start: U.fromMin(cursor), end: U.fromMin(s), minutes: s - cursor });
        cursor = Math.max(cursor, e);
      });
      if (DAY_END - cursor >= MIN_BLOCK) out.push({ day, start: U.fromMin(cursor), end: U.fromMin(DAY_END), minutes: DAY_END - cursor });
    });

    return out;
  }

  function tasksPanel(g) {
    const tasks = g.tasks || [];
    const byStatus = { todo: [], doing: [], done: [] };
    tasks.forEach((t) => (byStatus[t.status] || byStatus.todo).push(t));

    const col = (key, label) => `<div class="col gap-8" style="flex:1;min-width:180px">
      <div class="tiny bold dim" style="text-transform:uppercase;letter-spacing:.05em">${label} · ${byStatus[key].length}</div>
      ${byStatus[key].length ? byStatus[key].map((t) => `
        <div class="card" style="padding:10px">
          <div class="bold small">${U.esc(t.title)}</div>
          ${t.detail ? `<div class="tiny dim mt-4">${U.esc(t.detail)}</div>` : ""}
          <div class="row gap-6 wrap mt-8" style="align-items:center">
            ${t.assigneeName
              ? `<span class="badge">${U.esc(t.assigneeName)}</span>`
              : `<span class="badge dim">Unassigned</span>`}
            ${t.due ? `<span class="tiny dim">due ${U.esc(U.fmtDate(t.due))}</span>` : ""}
          </div>
          <div class="row gap-6 mt-8">
            ${key !== "todo" ? `<button class="btn btn-sm" data-task-status="${t.id}:todo">To do</button>` : ""}
            ${key !== "doing" ? `<button class="btn btn-sm" data-task-status="${t.id}:doing">Doing</button>` : ""}
            ${key !== "done" ? `<button class="btn btn-sm" data-task-status="${t.id}:done">Done</button>` : ""}
            ${t.byId === myId() || g.ownerId === myId()
              ? `<button class="icon-btn" data-task-del="${t.id}" title="Remove">✕</button>` : ""}
          </div>
        </div>`).join("")
        : `<div class="tiny dim">Nothing here.</div>`}
    </div>`;

    return `<div class="card">
      <div class="card-head">
        <div><h3>Project tasks</h3><div class="sub">Who's doing what, without asking in a group chat</div></div>
        <button class="btn btn-sm btn-primary" data-add-task="${g.id}">+ Add task</button>
      </div>
      <div class="card-body">
        ${tasks.length
          ? `<div class="row gap-16 wrap" style="align-items:flex-start">
               ${col("todo", "To do")}${col("doing", "Doing")}${col("done", "Done")}
             </div>`
          : UI.emptyState("homework", "No tasks yet",
              "Break the project into parts and assign them, so nobody doubles up.",
              `<button class="btn btn-primary" data-add-task="${g.id}">+ Add the first task</button>`)}
      </div>
    </div>`;
  }

  function meetPanel(g) {
    const shared = g.availability || [];
    const iShared = shared.some((a) => a.id === myId());
    const free = commonFree(g);
    const byDay = {};
    free.forEach((f) => { (byDay[f.day] = byDay[f.day] || []).push(f); });
    const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    return `<div class="card">
      <div class="card-head">
        <div><h3>When is everyone free?</h3>
          <div class="sub">Only busy times are shared — never your class names or grades</div></div>
        <button class="btn btn-sm ${iShared ? "" : "btn-primary"}" data-share-avail="${g.id}">
          ${iShared ? "↻ Update my times" : "Share my free time"}
        </button>
      </div>
      <div class="card-body">
        <div class="row gap-6 wrap mb-12">
          ${g.members.map((m) => {
            const has = shared.some((a) => a.id === m.id);
            return `<span class="badge ${has ? "ok" : ""}" title="${has ? "Has shared" : "Hasn't shared yet"}">
              ${has ? "✓" : "○"} ${U.esc(m.name)}</span>`;
          }).join("")}
        </div>

        ${!shared.length
          ? UI.emptyState("todaySchedule", "Nobody has shared yet",
              "Share your free time and everyone else's overlap appears here.")
          : shared.length < g.members.length
            ? `<p class="small" style="color:var(--warn)">Showing overlap for the ${U.plural(shared.length, "person", "people")} who've shared. Others may still be busy in these slots.</p>`
            : ""}

        ${free.length ? `<div class="col gap-12 mt-8">
          ${order.filter((d) => byDay[d]).map((d) => `
            <div>
              <div class="tiny bold dim mb-4">${d}</div>
              <div class="row gap-6 wrap">
                ${byDay[d].map((f) => `<span class="chip" style="cursor:default">
                  ${U.fmtTime(f.start)}–${U.fmtTime(f.end)} <span class="dim">(${U.fmtDur(f.minutes)})</span>
                </span>`).join("")}
              </div>
            </div>`).join("")}
        </div>` : shared.length ? `<p class="small dim mt-8">No shared free time of 30 minutes or more.</p>` : ""}
      </div>
    </div>`;
  }

  function partnersPanel(g) {
    const mine = myId();
    const pairs = g.partners || [];
    const active = pairs.filter((p) => p.status === "accepted" && (p.aId === mine || p.bId === mine));
    const incoming = pairs.filter((p) => p.status === "pending" && p.bId === mine);
    const outgoing = pairs.filter((p) => p.status === "pending" && p.aId === mine);
    const other = (p) => (p.aId === mine ? p.bName : p.aName);

    return `<div class="card">
      <div class="card-head">
        <div><h3>Accountability partners</h3>
          <div class="sub">One person who notices when you're slipping — and vice versa</div></div>
        <button class="btn btn-sm btn-primary" data-add-partner="${g.id}">+ Ask someone</button>
      </div>
      <div class="card-body">
        ${incoming.length ? `<div class="mb-16">
          <div class="tiny bold dim mb-8">ASKED YOU</div>
          ${incoming.map((p) => `<div class="list-item">
            <span class="grow"><div class="title">${U.esc(p.aName)}</div>
              <div class="meta">wants to be your accountability partner</div></span>
            <button class="btn btn-sm" data-partner-no="${p.id}">Decline</button>
            <button class="btn btn-sm btn-primary" data-partner-yes="${p.id}">Accept</button>
          </div>`).join("")}
        </div>` : ""}

        ${active.length ? `<div class="mb-16">
          <div class="tiny bold dim mb-8">YOUR PARTNERS</div>
          ${active.map((p) => `<div class="list-item">
            ${UI.avatar(other(p), S.PALETTE[(other(p).charCodeAt(0) || 0) % S.PALETTE.length], "sm")}
            <span class="grow"><div class="title">${U.esc(other(p))}</div>
              <div class="meta">partners since ${U.esc(U.fmtDate(U.dateKey(new Date(p.respondedAt || p.at))))}</div></span>
            <button class="btn btn-sm" data-partner-end="${p.id}">End</button>
          </div>`).join("")}
        </div>` : ""}

        ${outgoing.length ? `<div class="mb-16">
          <div class="tiny bold dim mb-8">WAITING ON</div>
          ${outgoing.map((p) => `<div class="list-item">
            <span class="grow"><div class="title">${U.esc(p.bName)}</div>
              <div class="meta">hasn't answered yet</div></span>
            <button class="btn btn-sm" data-partner-end="${p.id}">Cancel</button>
          </div>`).join("")}
        </div>` : ""}

        ${!active.length && !incoming.length && !outgoing.length
          ? UI.emptyState("people", "No partners yet",
              "Pick someone in this group who'll check in on you — and who you'll check in on.",
              `<button class="btn btn-primary" data-add-partner="${g.id}">+ Ask someone</button>`)
          : ""}
      </div>
    </div>`;
  }

  function tutoringPanel(g) {
    const posts = U.sortBy(g.tutoring || [], (t) => t.at, true);
    const offers = posts.filter((p) => p.kind === "offer");
    const requests = posts.filter((p) => p.kind === "request");

    const card = (p) => `<div class="card" style="padding:12px">
      <div class="row gap-6" style="align-items:center">
        <span class="badge ${p.kind === "offer" ? "ok" : "brand"}">${p.kind === "offer" ? "Can help" : "Needs help"}</span>
        <span class="bold small">${U.esc(p.subject)}</span>
      </div>
      ${p.detail ? `<div class="tiny dim mt-4">${U.esc(p.detail)}</div>` : ""}
      ${p.availability ? `<div class="tiny dim mt-4">🕑 ${U.esc(p.availability)}</div>` : ""}
      <div class="row gap-6 mt-8" style="align-items:center">
        <span class="tiny dim grow">${U.esc(p.byName)}</span>
        ${p.responders.length ? `<span class="badge">${U.plural(p.responders.length, "reply", "replies")}</span>` : ""}
        ${p.byId === myId()
          ? `<button class="icon-btn" data-tutor-del="${p.id}" title="Remove">✕</button>`
          : p.responders.some((r) => r.id === myId())
            ? `<span class="badge ok">You replied</span>`
            : `<button class="btn btn-sm btn-primary" data-tutor-respond="${p.id}">
                 ${p.kind === "offer" ? "Ask them" : "I can help"}</button>`}
      </div>
    </div>`;

    return `<div class="card">
      <div class="card-head">
        <div><h3>Peer tutoring</h3><div class="sub">Offer help, or ask for it</div></div>
        <button class="btn btn-sm btn-primary" data-add-tutoring="${g.id}">+ Post</button>
      </div>
      <div class="card-body">
        ${posts.length ? `<div class="row gap-16 wrap" style="align-items:flex-start">
          <div class="col gap-8" style="flex:1;min-width:220px">
            <div class="tiny bold dim" style="text-transform:uppercase">Offering help · ${offers.length}</div>
            ${offers.length ? offers.map(card).join("") : `<div class="tiny dim">Nobody's offered yet.</div>`}
          </div>
          <div class="col gap-8" style="flex:1;min-width:220px">
            <div class="tiny bold dim" style="text-transform:uppercase">Looking for help · ${requests.length}</div>
            ${requests.length ? requests.map(card).join("") : `<div class="tiny dim">No requests right now.</div>`}
          </div>
        </div>`
        : UI.emptyState("classmates", "Nothing on the board",
            "Post what you can help with, or what you're stuck on.",
            `<button class="btn btn-primary" data-add-tutoring="${g.id}">+ Post something</button>`)}
      </div>
    </div>`;
  }

  function sharedNotesPanel(g) {
    const notes = U.sortBy(g.sharedNotes || [], (n) => n.at, true);
    return `<div class="card">
      <div class="card-head">
        <div><h3>Shared notes</h3><div class="sub">Contribute notes and keep credit for what you wrote</div></div>
        <button class="btn btn-sm btn-primary" data-share-note="${g.id}">+ Share a note</button>
      </div>
      ${notes.length ? `<div class="list">${notes.map((n) => `
        <div class="list-item">
          <span class="grow" style="min-width:0">
            <div class="title truncate">${U.esc(n.title)}</div>
            <div class="meta">by ${U.esc(n.byName)}${n.subject ? " · " + U.esc(n.subject) : ""} · ${U.esc(U.fmtDate(U.dateKey(new Date(n.at))))}</div>
          </span>
          ${n.thanks ? `<span class="badge" title="thanks from classmates">🙏 ${n.thanks}</span>` : ""}
          <button class="btn btn-sm" data-read-note="${n.id}">Read</button>
          ${n.byId === myId() || g.ownerId === myId()
            ? `<button class="icon-btn" data-note-del="${n.id}" title="Remove">✕</button>` : ""}
        </div>`).join("")}</div>`
      : `<div class="card-body">${UI.emptyState("notes", "No shared notes yet",
          "Share a study guide — your name stays on it.",
          `<button class="btn btn-primary" data-share-note="${g.id}">+ Share a note</button>`)}</div>`}
    </div>`;
  }

  function challengesPanel(g) {
    const list = g.challenges || [];
    return `<div class="card">
      <div class="card-head">
        <div><h3>Group challenges</h3>
          <div class="sub">Everyone's effort adds to one total — no leaderboard, no ranking</div></div>
        <button class="btn btn-sm btn-primary" data-add-challenge="${g.id}">+ New challenge</button>
      </div>
      <div class="card-body">
        ${list.length ? `<div class="col gap-16">${list.map((c) => {
          const total = (c.participants || []).reduce((s, p) => s + (p.contributed || 0), 0);
          const pct = c.target ? Math.min(100, Math.round((total / c.target) * 100)) : 0;
          const joined = (c.participants || []).some((p) => p.id === myId());
          return `<div>
            <div class="between mb-4">
              <span class="bold small">${U.esc(c.title)}</span>
              <span class="tiny dim">${U.fmtNum ? U.fmtNum(total) : total} / ${c.target} ${U.esc(c.unit)}</span>
            </div>
            <div class="progress" style="height:10px"><div class="bar" style="width:${pct}%"></div></div>
            <div class="row gap-6 wrap mt-8" style="align-items:center">
              <span class="tiny dim">${U.plural((c.participants || []).length, "person", "people")} in${c.endsOn ? " · ends " + U.esc(U.fmtDate(c.endsOn)) : ""}</span>
              <span class="grow"></span>
              ${joined
                ? `<button class="btn btn-sm" data-challenge-sync="${c.id}:${c.metric}" title="Send your current total">↻ Update my progress</button>
                   <button class="btn btn-sm" data-challenge-leave="${c.id}">Leave</button>`
                : `<button class="btn btn-sm btn-primary" data-challenge-join="${c.id}">Join in</button>`}
            </div>
          </div>`;
        }).join("")}</div>`
        : UI.emptyState("goals", "No challenges yet",
            "Set a shared goal — like 20 study hours this week, together.",
            `<button class="btn btn-primary" data-add-challenge="${g.id}">+ Start one</button>`)}
      </div>
    </div>`;
  }

  function detailView() {
    const g = openGroup;
    const counts = {
      tasks: (g.tasks || []).filter((t) => t.status !== "done").length,
      tutoring: (g.tutoring || []).length,
      notes: (g.sharedNotes || []).length,
      challenges: (g.challenges || []).length,
      partners: (g.partners || []).filter((p) => p.status === "pending" && p.bId === myId()).length
    };

    if (groupTab !== "feed") {
      const panel = groupTab === "tasks" ? tasksPanel(g)
        : groupTab === "meet" ? meetPanel(g)
        : groupTab === "partners" ? partnersPanel(g)
        : groupTab === "tutoring" ? tutoringPanel(g)
        : groupTab === "notes" ? sharedNotesPanel(g)
        : challengesPanel(g);
      return `<div class="page-inner">
        ${detailHead(g)}
        ${groupTabsHTML(counts)}
        ${panel}
      </div>`;
    }

    return `<div class="page-inner">
      ${detailHead(g)}
      ${groupTabsHTML(counts)}

      <div class="grid g-main">
        <div class="card">
          <div class="card-head">
            <div><h3>Assignment feed</h3><div class="sub">What the class says is due</div></div>
          </div>
          ${g.feed.length ? `<div class="list">${U.sortBy(g.feed, (f) => f.at, true).map((f) => {
            const comments = f.comments || [];
            const ratings = f.ratings || [];
            const avg = ratings.length ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length) : null;
            const expanded = expandedFeedId === f.id;
            return `<div class="feed-item">
              <div class="list-item">
                <span class="grow" style="min-width:0">
                  <div class="title">${U.esc(f.title)}</div>
                  <div class="meta">${U.esc(f.className || "")}${f.due ? " · due " + U.esc(U.fmtDate(f.due)) : ""}
                    · posted by ${U.esc(f.byName)}</div>
                  ${f.notes ? `<div class="tiny muted mt-4">${U.esc(f.notes)}</div>` : ""}
                </span>
                <span class="badge ${f.confirms.length > 1 ? "ok" : ""}">✓ ${f.confirms.length}</span>
                ${avg != null
                  ? `<span class="badge" title="${U.plural(ratings.length, "rating")}">⏱ ~${U.fmtDur(avg)}</span>`
                  : `<button class="btn btn-sm" data-rate="${f.id}" title="Anonymously say how long this actually took">⏱ Rate time</button>`}
                <button class="btn btn-sm" data-toggle-comments="${f.id}">💬 ${comments.length || ""}</button>
                <button class="btn btn-sm" data-confirm="${f.id}">Confirm</button>
                <button class="btn btn-sm btn-primary" data-take='${U.esc(JSON.stringify({ title: f.title, className: f.className, due: f.due, notes: f.notes }))}'>Add</button>
              </div>
              ${expanded ? `<div class="feed-comments">
                ${comments.map((c) => `<div class="feed-comment">
                  <span class="tiny bold">${U.esc(c.byName)}</span>
                  <span class="tiny dim">${U.esc(U.relDate(U.dateKey(new Date(c.at))))}</span>
                  <div class="small">${U.esc(c.text)}</div>
                </div>`).join("") || `<p class="tiny dim">No comments yet — say something.</p>`}
                <div class="row gap-6 mt-8">
                  <input class="input input-sm grow" data-comment-input="${f.id}" placeholder="Add a comment…" maxlength="500" />
                  <button class="btn btn-sm" data-send-comment="${f.id}">Send</button>
                </div>
              </div>` : ""}
            </div>`;
          }).join("")}</div>`
          : UI.emptyState("feed", "Nothing posted yet", "Be the first to share what's due.")}
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
          <h1>${App.i18n.t("groups", "Study groups")}</h1>
          <div class="sub">Shared flashcards and a crowdsourced "what's the homework?" feed</div>
        </div>
        <div class="page-actions">
          <button class="btn" data-join>Join with a code</button>
          <button class="btn btn-primary" data-create>+ New group</button>
        </div>
      </div>

      ${error ? `<div class="card mb-16" style="border-left:3px solid var(--danger)">
        <div class="card-body small">${U.esc(error)}</div></div>` : ""}

      ${loading && !groups ? U.skeletonCards(3)
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
        : UI.emptyState("groupsEmpty", "No groups yet",
            "Create one for a class and share the code, or join a friend's with theirs.",
            `<button class="btn btn-primary" data-create>+ Create a group</button>`)}
    </div>`;
  }

  function mount(root) {
    U.on(root, "click", "[data-create]", createForm);
    U.on(root, "click", "[data-join]", () => joinForm());
    U.on(root, "click", "[data-open]", (_e, el) => openDetail(el.dataset.open));
    U.on(root, "click", "[data-back]", () => { openGroup = null; groupTab = "feed"; App.router.refresh(); });
    U.on(root, "click", "[data-gtab]", (_e, el) => { groupTab = el.dataset.gtab; App.router.refresh(); });

    /* ------------------------------------ F054-F063 collaboration wiring */

    // Every mutation re-opens the group so the panel reflects server truth
    // rather than a hopeful local guess.
    const after = (msg, sub, kind) => () => {
      if (msg) UI.toast(msg, sub || "", kind || "ok");
      return openDetail(openGroup.id);
    };
    const oops = (e) => UI.toast("Didn't work", e.message, "danger");

    // F055 tasks
    U.on(root, "click", "[data-add-task]", (_e, el) => taskForm(el.dataset.addTask));
    U.on(root, "click", "[data-task-status]", (_e, el) => {
      const [taskId, status] = el.dataset.taskStatus.split(":");
      App.sync.updateGroupTask(openGroup.id, taskId, { status })
        .then(after()).catch(oops);
    });
    U.on(root, "click", "[data-task-del]", (_e, el) => {
      UI.confirm({
        title: "Remove this task?", okLabel: "Remove", danger: true,
        message: "It disappears for everyone in the group.",
        onConfirm() {
          App.sync.deleteGroupTask(openGroup.id, el.dataset.taskDel)
            .then(after("Task removed", "", "warn")).catch(oops);
        }
      });
    });

    // F054/F057 availability
    U.on(root, "click", "[data-share-avail]", (_e, el) => {
      UI.confirm({
        title: "Share your free time?",
        message: "This sends only the times you're busy — not your class names, rooms, or grades. Everyone's overlap becomes visible to the group.",
        okLabel: "Share it",
        onConfirm() {
          App.sync.pushAvailability(el.dataset.shareAvail)
            .then(after("Free time shared", "", "ok")).catch(oops);
        }
      });
    });

    // F056 partners
    U.on(root, "click", "[data-add-partner]", (_e, el) => partnerForm(el.dataset.addPartner));
    U.on(root, "click", "[data-partner-yes]", (_e, el) => {
      App.sync.respondPartner(openGroup.id, el.dataset.partnerYes, true)
        .then(after("You're partners now", "", "ok")).catch(oops);
    });
    U.on(root, "click", "[data-partner-no]", (_e, el) => {
      App.sync.respondPartner(openGroup.id, el.dataset.partnerNo, false)
        .then(after("Declined", "", "warn")).catch(oops);
    });
    U.on(root, "click", "[data-partner-end]", (_e, el) => {
      App.sync.endPartner(openGroup.id, el.dataset.partnerEnd)
        .then(after("Ended", "", "warn")).catch(oops);
    });

    // F061 tutoring
    U.on(root, "click", "[data-add-tutoring]", (_e, el) => tutoringForm(el.dataset.addTutoring));
    U.on(root, "click", "[data-tutor-respond]", (_e, el) => {
      UI.busy(el, App.sync.respondTutoring(openGroup.id, el.dataset.tutorRespond))
        .then(after("Replied", "They'll see your name on the post.", "ok")).catch(oops);
    });
    U.on(root, "click", "[data-tutor-del]", (_e, el) => {
      UI.busy(el, App.sync.removeTutoring(openGroup.id, el.dataset.tutorDel))
        .then(after("Removed", "", "warn")).catch(oops);
    });

    // F062 shared notes
    U.on(root, "click", "[data-share-note]", (_e, el) => shareNoteForm(el.dataset.shareNote));
    U.on(root, "click", "[data-read-note]", (_e, el) => readSharedNote(el.dataset.readNote));
    U.on(root, "click", "[data-note-del]", (_e, el) => {
      UI.confirm({
        title: "Remove this note?", okLabel: "Remove", danger: true,
        message: "It disappears for everyone in the group.",
        onConfirm() {
          App.sync.removeSharedNote(openGroup.id, el.dataset.noteDel)
            .then(after("Note removed", "", "warn")).catch(oops);
        }
      });
    });

    // F063 challenges
    U.on(root, "click", "[data-add-challenge]", (_e, el) => challengeForm(el.dataset.addChallenge));
    U.on(root, "click", "[data-challenge-join]", (_e, el) => {
      App.sync.joinChallenge(openGroup.id, el.dataset.challengeJoin)
        .then(after("You're in", "Update your progress any time.", "ok")).catch(oops);
    });
    U.on(root, "click", "[data-challenge-leave]", (_e, el) => {
      App.sync.leaveChallenge(openGroup.id, el.dataset.challengeLeave)
        .then(after("Left the challenge", "", "warn")).catch(oops);
    });
    U.on(root, "click", "[data-challenge-sync]", (_e, el) => {
      const [chId, metric] = el.dataset.challengeSync.split(":");
      App.sync.contributeChallenge(openGroup.id, chId, metric)
        .then(after("Progress updated", "", "ok")).catch(oops);
    });
    U.on(root, "click", "[data-share-deck]", (_e, el) => shareDeckForm(el.dataset.shareDeck));
    U.on(root, "click", "[data-invite-link]", (_e, el) => {
      const url = `${location.origin}${location.pathname}?join=${encodeURIComponent(el.dataset.inviteLink)}`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url)
          .then(() => UI.toast("Invite link copied", url, "ok"))
          .catch(() => UI.toast("Invite link", url));
      } else {
        UI.toast("Invite link", url);
      }
    });
    U.on(root, "click", "[data-post]", (_e, el) => postForm(el.dataset.post));
    U.on(root, "click", "[data-import]", (_e, el) => importDeck(openGroup.id, el.dataset.import));
    U.on(root, "click", "[data-confirm]", (_e, el) => {
      App.sync.confirmFeed(openGroup.id, el.dataset.confirm)
        .then(() => openDetail(openGroup.id))
        .catch((e) => UI.toast("Failed", e.message, "danger"));
    });
    // F058 — comment thread on a feed post.
    U.on(root, "click", "[data-toggle-comments]", (_e, el) => {
      expandedFeedId = expandedFeedId === el.dataset.toggleComments ? null : el.dataset.toggleComments;
      App.router.refresh();
    });
    U.on(root, "click", "[data-send-comment]", (_e, el) => {
      const id = el.dataset.sendComment;
      const input = root.querySelector(`[data-comment-input="${id}"]`);
      const text = input ? input.value.trim() : "";
      if (!text) return;
      // Double-clicking Send used to post the comment twice.
      UI.busy(el, App.sync.commentFeed(openGroup.id, id, text))
        .then(() => openDetail(openGroup.id))
        .catch((e) => UI.toast("Couldn't post comment", e.message, "danger"));
    });
    U.on(root, "keydown", "[data-comment-input]", (e, el) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      root.querySelector(`[data-send-comment="${el.dataset.commentInput}"]`).click();
    });
    // F060 — anonymous "how long did this actually take?"
    U.on(root, "click", "[data-rate]", (_e, el) => {
      const id = el.dataset.rate;
      UI.prompt({
        title: "How long did this actually take?",
        label: "Your answer is anonymous — only the class average shows",
        placeholder: "Minutes, e.g. 45",
        okLabel: "Submit",
        onSubmit(v) {
          const mins = Number(v);
          if (!mins || mins <= 0) { UI.toast("Enter a number of minutes", "", "warn"); return; }
          App.sync.rateFeed(openGroup.id, id, mins)
            .then(() => { UI.toast("Thanks", "That helps calibrate estimates for everyone.", "ok"); openDetail(openGroup.id); })
            .catch((e) => UI.toast("Couldn't submit", e.message, "danger"));
        }
      });
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

  return { render, mount, unmount, joinForm, title: "Groups" };
})();
