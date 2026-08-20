/* ==========================================================================
   views/reading.js — book / chapter tracker with pacing
   ========================================================================== */

App.views.reading = (function () {
  const U = App.utils, S = App.store, UI = App.ui, C = App.charts;

  function form(rd) {
    const r = rd || {};
    UI.modal({
      title: rd ? "Edit book" : "Add reading",
      size: "wide",
      okLabel: rd ? "Save" : "Add",
      footer: rd ? `<button type="button" class="btn btn-danger left" data-del>Delete</button>
                    <button type="button" class="btn" data-close>Cancel</button>
                    <button type="submit" class="btn btn-primary">Save</button>` : undefined,
      body: `<div class="form-grid">
        <div class="field full"><label>Title</label>
          <input class="input" name="title" required value="${U.esc(r.title || "")}" placeholder="The Great Gatsby" /></div>
        <div class="field"><label>Author</label>
          <input class="input" name="author" value="${U.esc(r.author || "")}" placeholder="F. Scott Fitzgerald" /></div>
        <div class="field"><label>Class</label>
          <select class="select" name="classId">${UI.classOptions(r.classId, true)}</select></div>
        <div class="field"><label>Total pages</label>
          <input class="input" type="number" name="totalPages" min="1" value="${r.totalPages || 200}" /></div>
        <div class="field"><label>Current page</label>
          <input class="input" type="number" name="currentPage" min="0" value="${r.currentPage || 0}" /></div>
        <div class="field full"><label>Finish by</label>
          <input class="input" type="date" name="deadline" value="${r.deadline || U.dateKey(U.addDays(new Date(), 14))}" /></div>
      </div>`,
      onMount(root) {
        const del = root.querySelector("[data-del]");
        if (del) del.addEventListener("click", () => {
          UI.closeModal();
          UI.deleteWithUndo("reading", rd.id, rd.title);
        });
      },
      onSubmit(d) {
        if (!d.title.trim()) return false;
        const total = Number(d.totalPages) || 1;
        const cur = U.clamp(Number(d.currentPage) || 0, 0, total);
        const patch = {
          title: d.title.trim(), author: d.author.trim(), classId: d.classId || null,
          totalPages: total, currentPage: cur, deadline: d.deadline, done: cur >= total
        };
        if (rd) { S.update("reading", rd.id, patch); UI.toast("Book updated", patch.title); }
        else { S.insert("reading", Object.assign({ startedOn: U.today(), log: [] }, patch)); UI.toast("Reading added", patch.title, "ok"); }
      }
    });
  }

  function logProgress(id) {
    const r = S.byId("reading", id);
    if (!r) return;
    UI.modal({
      title: "Update progress",
      sub: r.title,
      okLabel: "Save",
      body: `<div class="field mb-12">
          <label>I'm now on page</label>
          <input class="input" type="number" name="page" min="0" max="${r.totalPages}" value="${r.currentPage}" autofocus />
          <span class="hint">of ${r.totalPages}</span>
        </div>
        <div class="bar"><i style="width:${S.readingPace(r).pct}%"></i></div>`,
      onSubmit(d) {
        const page = U.clamp(Number(d.page) || 0, 0, r.totalPages);
        const gained = page - r.currentPage;
        r.currentPage = page;
        r.done = page >= r.totalPages;
        r.log = (r.log || []).concat([{ date: U.today(), page }]);
        S.commit((db) => { db.streak.xp += Math.max(1, Math.round(gained / 10)); });
        UI.toast(r.done ? "Finished! 🎉" : "Progress saved",
                 r.done ? r.title : `${gained > 0 ? "+" + gained : gained} pages`, "ok");
      }
    });
  }

  function card(r) {
    const pace = S.readingPace(r);
    const c = S.cls(r.classId);
    // Pages/day needed vs the pace actually achieved so far.
    const daysIn = Math.max(1, U.diffDays(U.today(), r.startedOn || U.today()));
    const actual = r.currentPage / daysIn;
    const behind = !r.done && pace.perDay > actual * 1.35 && pace.daysLeft >= 0;

    return `<div class="card">
      ${c ? `<div style="height:4px;background:${U.esc(c.color)};border-radius:var(--radius) var(--radius) 0 0"></div>` : ""}
      <div class="card-body">
        <div class="between mb-8">
          <div style="min-width:0">
            <h3 class="truncate">${U.esc(r.title)}</h3>
            <div class="tiny dim truncate">${U.esc(r.author || "")}${c ? " · " + U.esc(c.name) : ""}</div>
          </div>
          ${r.done ? `<span class="badge ok">Finished</span>`
            : behind ? `<span class="badge warn">Behind pace</span>`
            : `<span class="badge">${U.round(pace.pct)}%</span>`}
        </div>

        <div class="between tiny dim mb-4">
          <span>Page ${r.currentPage} of ${r.totalPages}</span>
          <span>${pace.pagesLeft} left</span>
        </div>
        <div class="bar thick mb-12"><i style="width:${U.round(pace.pct, 1)}%;
          ${r.done ? "background:var(--ok)" : behind ? "background:var(--warn)" : ""}"></i></div>

        ${!r.done ? `<div class="row gap-16 mb-12">
          <div><div class="tiny dim">Need per day</div><div class="bold">${pace.perDay} pages</div></div>
          <div><div class="tiny dim">Doing per day</div><div class="bold">${Math.round(actual)} pages</div></div>
          <div><div class="tiny dim">Due</div><div class="bold">${U.esc(U.relDate(r.deadline))}</div></div>
        </div>` : ""}

        <div class="row gap-6">
          <button class="btn btn-sm btn-primary" data-log="${r.id}">📖 Update page</button>
          <button class="btn btn-sm" data-edit="${r.id}">Edit</button>
        </div>
      </div>
    </div>`;
  }

  function render() {
    const rows = S.db.reading;
    const active = rows.filter((r) => !r.done);
    const done = rows.filter((r) => r.done);
    const pagesLeft = U.sum(active, (r) => Math.max(0, r.totalPages - r.currentPage));
    const perDay = U.sum(active, (r) => S.readingPace(r).perDay);

    // Pages read per day over the last two weeks, from the logs.
    const series = [];
    for (let i = 13; i >= 0; i--) {
      const iso = U.dateKey(U.addDays(new Date(), -i));
      let pages = 0;
      rows.forEach((r) => {
        const log = U.sortBy(r.log || [], (l) => l.date);
        log.forEach((entry, idx) => {
          if (entry.date !== iso) return;
          const prev = idx > 0 ? log[idx - 1].page : 0;
          pages += Math.max(0, entry.page - prev);
        });
      });
      series.push({ label: U.DOW_SHORT[U.parseDate(iso).getDay()][0], full: U.fmtDate(iso, "day"),
                    value: pages, highlight: i === 0 });
    }

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>Reading</h1>
          <div class="sub">${U.plural(active.length, "book")} in progress ·
            ${done.length} finished this term</div>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" data-add>+ Add reading</button>
        </div>
      </div>

      <div class="grid g-3 mb-16">
        <div class="stat accent">
          <div class="stat-ico">📚</div>
          <div class="stat-label">Pages remaining</div>
          <div class="stat-value">${pagesLeft}</div>
          <div class="stat-foot">Across ${U.plural(active.length, "active book")}</div>
        </div>
        <div class="stat">
          <div class="stat-ico">🎯</div>
          <div class="stat-label">Pages per day needed</div>
          <div class="stat-value">${perDay}</div>
          <div class="stat-foot">To hit every deadline</div>
        </div>
        <div class="stat">
          <div class="stat-ico">✅</div>
          <div class="stat-label">Finished</div>
          <div class="stat-value">${done.length}</div>
          <div class="stat-foot">${(() => {
            const g = S.db.goals.find((x) => x.metric === "reading" || /book/i.test(x.title));
            return g ? `Goal: ${g.target}` : "No reading goal set";
          })()}</div>
        </div>
      </div>

      ${rows.length ? `
        <div class="grid g-main">
          <div>
            <div class="grid g-2">${active.map(card).join("")}</div>
            ${done.length ? `<h3 class="mt-24 mb-12">Finished</h3>
              <div class="grid g-2">${done.map(card).join("")}</div>` : ""}
          </div>
          <div class="card">
            <div class="card-head"><h3>Pages read</h3><span class="sub">Last 2 weeks</span></div>
            <div class="card-body">${C.bars(series, { h: 170, fmt: (v) => v + " pages" })}</div>
          </div>
        </div>`
      : UI.emptyState("📖", "Nothing on the shelf",
          "Track books and chapter assignments — Scholar works out how many pages a day you need to finish on time.",
          `<button class="btn btn-primary" data-add>+ Add your first book</button>`)}
    </div>`;
  }

  function mount(root) {
    U.on(root, "click", "[data-add]", () => form(null));
    U.on(root, "click", "[data-edit]", (_e, el) => form(S.byId("reading", el.dataset.edit)));
    U.on(root, "click", "[data-log]", (_e, el) => logProgress(el.dataset.log));
  }

  return { render, mount, title: "Reading" };
})();
