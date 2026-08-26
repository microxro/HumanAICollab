/* ==========================================================================
   views/classroom.js — F059: what a teacher account is actually for.

   A teacher account used to do exactly one thing: mark its posts in a study
   group as authoritative. That is a rendering flag on a shared blob — it never
   touched a student's records, so a teacher could tell a class what the
   homework was and still had no way to put it in their homework list.

   This is the other half. A teacher links to a student with the same one-time
   code a parent uses (the role is derived from the account redeeming it, never
   from the code), and from here can open that student's account and work in it
   — assignments, bell schedule, scores, everything the student can do —
   through the same acting-as machinery the parent portal uses.

   What a teacher deliberately does NOT get is the guardian half: live
   location, check-in demands, focus windows, activity suggestions. Those
   authorize on `role === "child"` and a teacher's link is `role === "pupil"`.
   Grading a student is a teacher's job; knowing where they are standing is
   not.
   ========================================================================== */

App.views.classroom = (function () {
  const U = App.utils, S = App.store, UI = App.ui;

  let roster = null;
  let loading = false;
  let error = null;

  function refresh(silent) {
    if (!App.sync.isSignedIn()) { roster = []; return Promise.resolve(); }
    if (!silent) loading = true;
    return App.sync.pupils()
      .then((list) => { roster = list; error = null; })
      .catch((e) => { error = e.message; })
      .then(() => { loading = false; App.router.refresh(); });
  }

  /* ----------------------------------------------------------- linking -- */

  function linkForm() {
    UI.modal({
      title: "Add a student",
      sub: "Ask them to open Sharing → Generate a link code",
      okLabel: "Add",
      body: `<div class="field">
          <label>Link code</label>
          <input class="input mono" name="code" required maxlength="8" placeholder="ABC123"
                 style="text-transform:uppercase;letter-spacing:.15em;font-size:1.15rem;text-align:center" />
        </div>
        <p class="hint mt-8">Codes are single-use and expire after 24 hours.
          The student generates it, so nobody joins your class without them doing that first.</p>`,
      onSubmit(d) {
        App.sync.redeemLinkCode(d.code.trim().toUpperCase())
          .then((res) => {
            UI.toast("Student added", (res.linked && res.linked.name) || "", "ok");
            refresh();
          })
          .catch((e) => UI.toast("Couldn't add them", e.message, "danger"));
      }
    });
  }

  /* -------------------------------------------------------------- cards -- */

  function since(ts) {
    if (!ts) return "never synced";
    const d = Math.round((Date.now() - ts) / 86400000);
    if (d <= 0) return "synced today";
    if (d === 1) return "synced yesterday";
    return `synced ${d} days ago`;
  }

  /**
   * One row per student, sorted so the ones who need attention are first.
   *
   * The sort is the point of the screen. A roster in alphabetical order makes
   * a teacher read all thirty rows to find the two that matter; overdue work
   * first means the answer is at the top.
   */
  function rows() {
    const sorted = (roster || []).slice().sort((a, b) =>
      (b.overdue - a.overdue) || (b.open - a.open) || a.name.localeCompare(b.name));

    return sorted.map((p, i) => `<div class="card mb-12">
      <div class="card-body">
        <div class="between wrap gap-12">
          <div class="row gap-12" style="min-width:0">
            ${UI.avatar(p.name, S.PALETTE[i % S.PALETTE.length], "lg")}
            <div style="min-width:0">
              <h3 class="truncate">${U.esc(p.name)}</h3>
              <div class="tiny dim">${U.esc(since(p.syncedAt))}${p.classes ? ` · ${U.plural(p.classes, "class", "classes")}` : ""}</div>
            </div>
          </div>
          <div class="row gap-6 wrap">
            <button class="btn btn-sm btn-primary" data-open-account="${p.id}"
                    title="Work in their account — assignments, bell schedule, scores">✎ Open their account</button>
            <button class="btn btn-sm" data-unlink="${p.id}">Remove</button>
          </div>
        </div>

        <div class="row gap-16 wrap mt-12">
          <div>
            <div class="tiny dim">Overdue</div>
            <div class="bold ${p.overdue ? "" : "dim"}" style="font-size:1.15rem">${p.overdue}</div>
          </div>
          <div class="vdiv"></div>
          <div>
            <div class="tiny dim">Open</div>
            <div class="bold" style="font-size:1.15rem">${p.open}</div>
          </div>
          <div class="vdiv"></div>
          <div>
            <div class="tiny dim">Scored so far</div>
            <div class="row gap-8" style="align-items:center">
              ${UI.gradePill(p.percent)}
              <span class="tiny dim">${U.plural(p.graded, "item")}</span>
            </div>
          </div>
          ${p.overdue ? `<div class="grow"></div>
            <span class="badge warn" style="align-self:center">${U.plural(p.overdue, "thing")} past due</span>` : ""}
        </div>
      </div>
    </div>`).join("");
  }

  /* ------------------------------------------------- work for the class -- */

  /**
   * One assignment, into every selected student's own homework list.
   *
   * Not a broadcast to a group feed — that already exists and is a notice
   * board. This puts a real record in each student's records, where their
   * dashboard, due-soon list and grade calculation will all pick it up.
   *
   * Everyone is ticked by default because the common case is the whole class;
   * the checkboxes are there for the one absent student, not as a chore.
   */
  function assignForm() {
    if (!(roster || []).length) {
      UI.toast("No students yet", "Add a student before setting work.", "");
      return;
    }

    UI.modal({
      title: "Set work for the class",
      sub: "It lands in each student's own homework list",
      okLabel: "Send it",
      size: "wide",
      body: `<div class="form-grid">
          <div class="field full"><label>Title</label>
            <input class="input" name="title" required maxlength="120" placeholder="Chapter 7 problems" /></div>
          <div class="field"><label>Due</label>
            <input class="input" type="date" name="due" /></div>
          <div class="field"><label>Points</label>
            <input class="input" type="number" name="points" min="0" max="1000" value="10" /></div>
          <div class="field full"><label>Notes</label>
            <textarea class="input" name="notes" rows="2" maxlength="500"
                      placeholder="Show your working for questions 4 and 9."></textarea></div>
        </div>
        <div class="divider"></div>
        <div class="between mb-8">
          <h4>Who gets it</h4>
          <button type="button" class="btn btn-sm" data-toggle-all>Select none</button>
        </div>
        <div class="list" style="border:1px solid var(--border);border-radius:var(--radius);max-height:260px;overflow:auto">
          ${(roster || []).map((p) => `<label class="list-item" style="cursor:pointer">
            <input type="checkbox" class="check" data-who="${U.esc(p.id)}" checked />
            <span class="grow"><div class="title">${U.esc(p.name)}</div>
              <div class="meta">${U.esc(since(p.syncedAt))}</div></span>
          </label>`).join("")}
        </div>
        <p class="hint mt-8">Each student gets their own copy, labelled with your name. A student who has
          never synced can't receive it — you'll be told which, rather than the whole thing failing.</p>`,
      onMount(root) {
        const btn = root.querySelector("[data-toggle-all]");
        btn.addEventListener("click", () => {
          const boxes = U.$$("[data-who]", root);
          const anyOn = boxes.some((b) => b.checked);
          boxes.forEach((b) => { b.checked = !anyOn; });
          btn.textContent = anyOn ? "Select all" : "Select none";
        });
      },
      onSubmit(d, root) {
        const title = String(d.title || "").trim();
        if (!title) { UI.toast("Give it a title", "", "danger"); return false; }

        const ids = U.$$("[data-who]", root).filter((b) => b.checked).map((b) => b.dataset.who);
        if (!ids.length) { UI.toast("Nobody selected", "Tick at least one student.", "danger"); return false; }

        const record = {
          title,
          due: d.due || "",
          points: Number(d.points) || 0,
          notes: String(d.notes || "").trim(),
          type: "Homework",
          status: "todo"
        };

        UI.toast("Sending…", `${U.plural(ids.length, "student")}`, "");
        App.sync.assignToMany(ids, "assignments", record).then((res) => {
          if (!res.ok) {
            UI.toast("Nothing sent", res.message || "None of them could receive it.", "danger");
            return;
          }
          if (res.failed.length) {
            // Named, not counted: "two failed" leaves a teacher to work out
            // which two, which is the actual question.
            const names = res.failed
              .map((f) => ((roster || []).find((p) => p.id === f.id) || {}).name || "someone")
              .join(", ");
            UI.toast(`Sent to ${res.done.length}`, `Couldn't reach ${names} — they may not have synced yet.`, "warn");
          } else {
            UI.toast("Sent", `${title} → ${U.plural(res.done.length, "student")}`, "ok");
          }
          refresh(true);
        });
      }
    });
  }

  /* --------------------------------------------------------------- view -- */

  function render() {
    const signedIn = App.sync.isSignedIn();
    const me = App.sync.info().user;
    const isTeacher = !!(me && me.role === "teacher");

    const head = `<div class="page-head">
      <div>
        <h1>Classroom</h1>
        <div class="sub">Your students, and their work</div>
      </div>
      ${isTeacher ? `<div class="page-actions">
        <button class="btn" data-refresh>↻ Refresh</button>
        <button class="btn" data-assign-many>✎ Set work for the class</button>
        <button class="btn btn-primary" data-link>+ Add a student</button>
      </div>` : ""}
    </div>`;

    if (!signedIn) {
      return `<div class="page-inner">${head}
        ${UI.emptyState("classes", "Sign in to use a teacher account",
          "A classroom lives on the server, not on this device — your students' work is on theirs.",
          `<button class="btn btn-primary" data-go="settings">Set up an account</button>`)}
      </div>`;
    }

    // A plain, specific explanation rather than a locked screen: the account
    // type is changeable from Settings, and saying which one this is beats
    // "you don't have permission".
    if (!isTeacher) {
      return `<div class="page-inner">${head}
        ${UI.emptyState("classes", "This isn't a teacher account",
          `You're signed in as a ${U.esc(me && me.role === "parent" ? "parent" : "student")} account. ` +
          "You can change that in Settings — you'll need to remove your existing links first, " +
          "because a link means something different for each kind of account.",
          `<button class="btn btn-primary" data-go="settings">Open settings</button>`)}
      </div>`;
    }

    if (error) {
      return `<div class="page-inner">${head}
        <div class="card"><div class="card-body">
          <div class="bold mb-4">Couldn't load your roster</div>
          <p class="small muted">${U.esc(error)}</p>
          <button class="btn btn-sm mt-8" data-refresh>Try again</button>
        </div></div></div>`;
    }

    if (roster == null || loading) {
      return `<div class="page-inner">${head}
        <div class="card"><div class="card-body"><p class="small muted">Loading your roster…</p></div></div></div>`;
    }

    if (!roster.length) {
      return `<div class="page-inner">${head}
        ${UI.emptyState("classes", "No students yet",
          "Ask a student to open Sharing and generate a link code, then add them with it. " +
          "They start the link, so nobody joins without agreeing to it.",
          `<button class="btn btn-primary" data-link>+ Add a student</button>`)}
      </div>`;
    }

    const behind = roster.filter((p) => p.overdue).length;

    return `<div class="page-inner">${head}
      <div class="row gap-16 wrap mb-16">
        <div><div class="tiny dim">Students</div><div class="bold" style="font-size:1.25rem">${roster.length}</div></div>
        <div class="vdiv"></div>
        <div><div class="tiny dim">With overdue work</div>
          <div class="bold ${behind ? "" : "dim"}" style="font-size:1.25rem">${behind}</div></div>
      </div>
      ${rows()}
      <p class="hint mt-16">Opening a student's account puts you in it — every change is saved to their
        own records and labelled with your name, so they can see what you changed and when.</p>
    </div>`;
  }

  function mount(root) {
    if (App.sync.isSignedIn() && roster == null && !loading) {
      const me = App.sync.info().user;
      if (me && me.role === "teacher") refresh();
    }

    U.on(root, "click", "[data-refresh]", () => refresh());
    U.on(root, "click", "[data-link]", linkForm);
    U.on(root, "click", "[data-assign-many]", assignForm);

    U.on(root, "click", "[data-open-account]", (_e, el) => {
      const p = (roster || []).find((x) => x.id === el.dataset.openAccount);
      if (!p) return;
      UI.confirm({
        title: `Open ${p.name}'s account?`,
        message: `Everything you change — assignments, bell schedule, scores — is saved to ${p.name}'s own records, and they'll see that you made the change. You can leave at any time.`,
        okLabel: "Open it",
        onConfirm() {
          App.sync.actAsStudent({ id: p.id, name: p.name }).then((r) => {
            if (r.ok) UI.toast(`You're in ${p.name}'s account`, "Changes save to their records.", "ok");
            else UI.toast("Couldn't open it", r.message || "", "danger");
          });
        }
      });
    });

    U.on(root, "click", "[data-unlink]", (_e, el) => {
      const p = (roster || []).find((x) => x.id === el.dataset.unlink);
      if (!p) return;
      UI.confirm({
        title: `Remove ${p.name}?`,
        message: "You'll lose access to their records. Their own data is untouched, and they can send you a new code later.",
        okLabel: "Remove",
        danger: true,
        onConfirm() {
          App.sync.unlink(p.id)
            .then(() => { UI.toast("Removed", p.name, "warn"); refresh(); })
            .catch((e) => UI.toast("Couldn't remove", e.message, "danger"));
        }
      });
    });
  }

  function unmount() { /* no polling: a roster changes on the scale of a term */ }

  return { render, mount, unmount, title: "Classroom" };
})();
