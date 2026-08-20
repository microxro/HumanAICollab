/* ==========================================================================
   views/classes.js — class list + detail, and the bell-schedule editor
   ========================================================================== */

App.views.classes = (function () {
  const U = App.utils, S = App.store, UI = App.ui, C = App.charts;

  const TIMEZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
    "America/Anchorage", "Pacific/Honolulu"];

  /* ------------------------------------------------------------- forms -- */

  function classForm(cl) {
    const c = cl || {};
    return UI.modal({
      title: cl ? "Edit class" : "Add a class",
      size: "wide",
      okLabel: cl ? "Save changes" : "Add class",
      body: `<div class="form-grid">
        <div class="field full">
          <label>Class name</label>
          <input class="input" name="name" value="${U.esc(c.name || "")}" required placeholder="e.g. AP Biology" />
        </div>
        <div class="field">
          <label>Course code</label>
          <input class="input" name="code" value="${U.esc(c.code || "")}" placeholder="BIO-301" />
        </div>
        <div class="field">
          <label>Room</label>
          <input class="input" name="room" value="${U.esc(c.room || "")}" placeholder="204" />
        </div>
        <div class="field">
          <label>Teacher</label>
          <select class="select" name="teacherId">${UI.teacherOptions(c.teacherId, true)}</select>
        </div>
        <div class="field">
          <label>Period</label>
          <select class="select" name="periodId">
            ${S.db.periods.map((p) => `<option value="${p.id}" ${p.id === c.periodId ? "selected" : ""}>
              ${U.esc(p.name)} (${U.fmtTime(p.start)})</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Credits</label>
          <input class="input" type="number" name="credits" step="0.5" min="0" value="${c.credits != null ? c.credits : 1}" />
        </div>
        <div class="field">
          <label>Meets on</label>
          ${UI.dayPicker("days", c.days || ["Mon", "Tue", "Wed", "Thu", "Fri"])}
        </div>
        <div class="field">
          <label>Time zone <span class="hint">remote/dual-enrollment only</span></label>
          <select class="select" name="timezone">
            <option value="">— This is my own class —</option>
            ${TIMEZONES.map((tz) => `<option value="${tz}" ${c.timezone === tz ? "selected" : ""}>${tz.replace("_", " ")}</option>`).join("")}
          </select>
        </div>
        <div class="field full">
          <label>Color</label>
          ${UI.colorPicker("color", c.color || S.PALETTE[0])}
        </div>
      </div>`,
      onMount(root) { UI.bindSwatches(root); UI.bindDays(root); },
      onSubmit(d) {
        if (!d.name.trim()) return false;
        const patch = {
          name: d.name.trim(), code: d.code.trim(), room: d.room.trim(),
          teacherId: d.teacherId || null, periodId: d.periodId,
          credits: Number(d.credits) || 0, color: d.color,
          days: d.days ? d.days.split(",").filter(Boolean) : [],
          timezone: d.timezone || null
        };
        if (cl) {
          S.update("classes", cl.id, patch);
          UI.toast("Class updated", patch.name);
        } else {
          patch.categories = [
            { id: U.uid("cat"), name: "Tests", weight: 40 },
            { id: U.uid("cat"), name: "Homework", weight: 30 },
            { id: U.uid("cat"), name: "Quizzes", weight: 20 },
            { id: U.uid("cat"), name: "Participation", weight: 10 }
          ];
          S.insert("classes", patch);
          UI.toast("Class added", patch.name, "ok");
        }
      }
    });
  }

  function categoryEditor(cl) {
    const rows = () => cl.categories.map((cat) => `
      <div class="row gap-8" data-cat="${cat.id}" style="margin-bottom:8px">
        <input class="input grow" value="${U.esc(cat.name)}" data-cat-name aria-label="Category name" />
        <input class="input" type="number" min="0" max="100" style="width:88px"
               value="${cat.weight}" data-cat-weight aria-label="Weight percent" />
        <span class="dim small">%</span>
        <button type="button" class="icon-btn" data-del-cat title="Remove">✕</button>
      </div>`).join("");

    UI.modal({
      title: "Grading categories",
      sub: cl.name,
      okLabel: "Save weights",
      body: `<p class="small muted mb-8">Each assignment counts toward one weighted category
        ${UI.helpHint("A weighted category means its average counts for a fixed share of the class grade, no matter how many assignments are in it. A 40%-weight category moves the grade four times as much as a 10%-weight one.")}</p>
        <div id="catRows">${rows()}</div>
        <button type="button" class="btn btn-sm" id="addCat">+ Add category</button>
        <div class="divider"></div>
        <div class="between">
          <span class="small muted">Total weight</span>
          <span class="bold nums" id="catTotal">—</span>
        </div>
        <p class="hint mt-8">Weights are normalized when a grade is calculated, so they don't have to add up to exactly 100.</p>`,
      onMount(root) {
        const box = root.querySelector("#catRows");
        const total = () => {
          const n = U.sum(U.$$("[data-cat-weight]", box), (i) => Number(i.value) || 0);
          root.querySelector("#catTotal").textContent = n + "%";
        };
        total();
        box.addEventListener("input", total);
        box.addEventListener("click", (e) => {
          const btn = e.target.closest("[data-del-cat]");
          if (!btn) return;
          btn.closest("[data-cat]").remove();
          total();
        });
        root.querySelector("#addCat").addEventListener("click", () => {
          const div = document.createElement("div");
          div.className = "row gap-8";
          div.style.marginBottom = "8px";
          div.dataset.cat = U.uid("cat");
          div.innerHTML = `<input class="input grow" value="" data-cat-name placeholder="Category" />
            <input class="input" type="number" min="0" max="100" style="width:88px" value="10" data-cat-weight />
            <span class="dim small">%</span>
            <button type="button" class="icon-btn" data-del-cat>✕</button>`;
          box.appendChild(div);
          total();
        });
      },
      onSubmit(_d, root) {
        const next = U.$$("[data-cat]", root).map((row) => ({
          id: row.dataset.cat,
          name: row.querySelector("[data-cat-name]").value.trim() || "Untitled",
          weight: Number(row.querySelector("[data-cat-weight]").value) || 0
        }));
        S.update("classes", cl.id, { categories: next });
        UI.toast("Categories saved", cl.name);
      }
    });
  }

  function periodsEditor() {
    const rows = () => S.db.periods.map((p) => `
      <div class="row gap-8" data-period="${p.id}" style="margin-bottom:8px">
        <input class="input grow" value="${U.esc(p.name)}" data-p-name aria-label="Period name" />
        <input class="input" type="time" value="${p.start}" data-p-start style="width:120px" aria-label="Start" />
        <span class="dim">→</span>
        <input class="input" type="time" value="${p.end}" data-p-end style="width:120px" aria-label="End" />
        <button type="button" class="icon-btn" data-del-p title="Remove">✕</button>
      </div>`).join("");

    UI.modal({
      title: "Bell schedule",
      sub: "These time slots are shared by every class",
      size: "wide",
      okLabel: "Save schedule",
      body: `<div id="pRows">${rows()}</div>
        <button type="button" class="btn btn-sm" id="addP">+ Add period</button>`,
      onMount(root) {
        root.querySelector("#pRows").addEventListener("click", (e) => {
          const b = e.target.closest("[data-del-p]");
          if (b) b.closest("[data-period]").remove();
        });
        root.querySelector("#addP").addEventListener("click", () => {
          const box = root.querySelector("#pRows");
          const div = document.createElement("div");
          div.className = "row gap-8";
          div.style.marginBottom = "8px";
          div.dataset.period = U.uid("p");
          div.innerHTML = `<input class="input grow" value="New period" data-p-name />
            <input class="input" type="time" value="15:00" data-p-start style="width:120px" />
            <span class="dim">→</span>
            <input class="input" type="time" value="15:50" data-p-end style="width:120px" />
            <button type="button" class="icon-btn" data-del-p>✕</button>`;
          box.appendChild(div);
        });
      },
      onSubmit(_d, root) {
        const next = U.$$("[data-period]", root).map((row) => ({
          id: row.dataset.period,
          name: row.querySelector("[data-p-name]").value.trim() || "Period",
          start: row.querySelector("[data-p-start]").value || "08:00",
          end: row.querySelector("[data-p-end]").value || "08:50"
        })).sort((a, b) => U.toMin(a.start) - U.toMin(b.start));
        S.commit((db) => { db.periods = next; });
        UI.toast("Bell schedule saved");
      }
    });
  }

  /* --------------------------------------------------------- F002 rubric */

  function rubricList(cl) {
    const rows = () => S.rubricsFor(cl.id);
    UI.modal({
      title: "Rubrics",
      sub: cl.name,
      size: "wide",
      footer: `<button type="button" class="btn btn-primary" data-close>Done</button>`,
      body: `<div class="row gap-8 mb-12">
          <button type="button" class="btn btn-sm" id="addRubric">+ New rubric</button>
        </div>
        <div id="rubricRows">${rows().length ? `<div class="list" style="border:1px solid var(--border);border-radius:var(--radius)">
          ${rows().map((r) => `<div class="list-item">
            <span class="grow"><div class="title">${U.esc(r.name)}</div>
              <div class="meta">${U.plural(r.criteria.length, "criterion", "criteria")}</div></span>
            <button class="btn btn-sm" data-edit-rubric="${r.id}">Edit</button>
            <button class="icon-btn btn-sm" data-del-rubric="${r.id}" aria-label="Delete">✕</button>
          </div>`).join("")}
        </div>` : `<p class="dim small">No rubrics yet — build one to score assignments by criteria.</p>`}</div>`,
      onMount(root) {
        root.querySelector("#addRubric").addEventListener("click", () => { UI.closeModal(); rubricForm(cl, null); });
        U.on(root, "click", "[data-edit-rubric]", (_e, el) => { UI.closeModal(); rubricForm(cl, S.byId("rubrics", el.dataset.editRubric)); });
        U.on(root, "click", "[data-del-rubric]", (_e, el) => {
          const r = S.byId("rubrics", el.dataset.delRubric);
          S.commit((db) => { db.rubrics = db.rubrics.filter((x) => x.id !== r.id); });
          UI.closeModal();
          rubricList(cl);
          UI.toast("Rubric deleted", r.name, "warn");
        });
      }
    });
  }

  function critRow(crit) {
    const c = crit || { id: U.uid("crit"), name: "", levels: [{ id: U.uid("lvl"), name: "Excellent", points: 10 }, { id: U.uid("lvl"), name: "Needs work", points: 5 }] };
    return `<div class="card mb-8" data-crit="${c.id}"><div class="card-body tight">
      <div class="row gap-8 mb-8">
        <input class="input grow" data-crit-name value="${U.esc(c.name)}" placeholder="Criterion — e.g. Thesis clarity" />
        <button type="button" class="icon-btn btn-sm" data-del-crit aria-label="Remove criterion">✕</button>
      </div>
      <div data-levels>${c.levels.map((l) => levelRow(l)).join("")}</div>
      <button type="button" class="btn btn-sm" data-add-level>+ Level</button>
    </div></div>`;
  }
  function levelRow(l) {
    return `<div class="row gap-8 mb-6" data-level="${l.id}">
      <input class="input input-sm grow" data-lvl-name value="${U.esc(l.name)}" placeholder="Level name" />
      <input class="input input-sm" type="number" min="0" style="width:80px" data-lvl-points value="${l.points}" />
      <button type="button" class="icon-btn btn-sm" data-del-level aria-label="Remove level">✕</button>
    </div>`;
  }

  function rubricForm(cl, rubric) {
    UI.modal({
      title: rubric ? "Edit rubric" : "New rubric",
      sub: cl.name,
      size: "wide",
      okLabel: "Save rubric",
      body: `<div class="field mb-12">
          <label>Rubric name</label>
          <input class="input" name="name" required value="${U.esc(rubric ? rubric.name : "")}" placeholder="Essay rubric" />
        </div>
        <div id="critRows">${(rubric ? rubric.criteria : [null]).map((c) => critRow(c)).join("")}</div>
        <button type="button" class="btn btn-sm mt-4" id="addCrit">+ Add criterion</button>`,
      onMount(root) {
        const box = root.querySelector("#critRows");
        box.addEventListener("click", (e) => {
          if (e.target.closest("[data-del-crit]")) { e.target.closest("[data-crit]").remove(); return; }
          if (e.target.closest("[data-del-level]")) { e.target.closest("[data-level]").remove(); return; }
          const addLvl = e.target.closest("[data-add-level]");
          if (addLvl) {
            addLvl.previousElementSibling.insertAdjacentHTML("beforeend", levelRow({ id: U.uid("lvl"), name: "", points: 0 }));
          }
        });
        root.querySelector("#addCrit").addEventListener("click", () => {
          box.insertAdjacentHTML("beforeend", critRow(null));
        });
      },
      onSubmit(d, root) {
        if (!d.name.trim()) return false;
        const criteria = U.$$("[data-crit]", root).map((row) => ({
          id: row.dataset.crit,
          name: row.querySelector("[data-crit-name]").value.trim() || "Criterion",
          levels: U.$$("[data-level]", row).map((lvl) => ({
            id: lvl.dataset.level,
            name: lvl.querySelector("[data-lvl-name]").value.trim() || "Level",
            points: Number(lvl.querySelector("[data-lvl-points]").value) || 0
          }))
        })).filter((c) => c.levels.length);
        if (!criteria.length) return false;
        const patch = { classId: cl.id, name: d.name.trim(), criteria };
        if (rubric) S.update("rubrics", rubric.id, patch);
        else S.insert("rubrics", patch);
        UI.toast("Rubric saved", patch.name, "ok");
      }
    });
  }

  /* ----------------------------------------------------------- files --- */

  /**
   * Syllabus, rubrics, and handouts. Metadata lives in the store (so it
   * exports and syncs); the bytes live in IndexedDB on this device.
   */
  function fileManager(cl) {
    const files = () => S.db.attachments.filter((a) => a.ownerType === "class" && a.ownerId === cl.id);

    const listHTML = () => {
      const rows = files();
      if (!rows.length) return `<p class="dim small">No files yet. Add a syllabus, rubric, or a photo of the board.</p>`;
      return `<div class="list" style="border:1px solid var(--border);border-radius:var(--radius)">
        ${rows.map((f) => `<div class="list-item">
          <span style="font-size:1.1rem">${/^image\//.test(f.type) ? "🖼️" : /pdf/.test(f.type) ? "📄" : "📎"}</span>
          <span class="grow" style="min-width:0">
            <div class="title truncate">${U.esc(f.name)}</div>
            <div class="meta">${App.idb.fmtSize(f.size)} · added ${U.esc(U.fmtDate(f.addedOn))}</div>
          </span>
          <button class="btn btn-sm" data-open-file="${f.id}">Open</button>
          <button class="icon-btn btn-sm" data-del-file="${f.id}" aria-label="Delete">✕</button>
        </div>`).join("")}
      </div>`;
    };

    UI.modal({
      title: "Files",
      sub: cl.name,
      size: "wide",
      footer: `<button type="button" class="btn btn-primary" data-close>Done</button>`,
      body: `<div class="field mb-16">
          <label>Add a file <span class="hint">up to 25 MB, stored on this device</span></label>
          <input class="input" type="file" id="fileInput" multiple />
        </div>
        <div id="fileList">${listHTML()}</div>
        <p class="hint mt-12">Files stay in this browser — they aren't included in JSON backups or cloud sync.</p>`,
      onMount(root) {
        const redraw = () => { root.querySelector("#fileList").innerHTML = listHTML(); };

        root.querySelector("#fileInput").addEventListener("change", (e) => {
          const chosen = Array.from(e.target.files || []);
          if (!chosen.length) return;
          Promise.all(chosen.map((file) => {
            const id = U.uid("file");
            return App.idb.put(id, file).then(() => {
              S.db.attachments.push({
                id, ownerType: "class", ownerId: cl.id, name: file.name,
                size: file.size, type: file.type || "application/octet-stream",
                addedOn: U.today(), storage: "idb"
              });
            }).catch((err) => {
              UI.toast("Couldn't save " + file.name, err.message, "danger");
            });
          })).then(() => {
            S.commit();
            e.target.value = "";
            redraw();
            UI.toast("Files added", U.plural(chosen.length, "file"), "ok");
          });
        });

        U.on(root, "click", "[data-open-file]", (_e, el) => {
          const f = S.byId("attachments", el.dataset.openFile);
          App.idb.openFile(f.id, f.name).catch((err) => UI.toast("Couldn't open", err.message, "danger"));
        });

        U.on(root, "click", "[data-del-file]", (_e, el) => {
          const f = S.byId("attachments", el.dataset.delFile);
          App.idb.del(f.id).catch(() => {});
          S.commit((db) => { db.attachments = db.attachments.filter((x) => x.id !== f.id); });
          redraw();
          UI.toast("File deleted", f.name, "warn");
        });
      }
    });
  }

  /* ------------------------------------------------------------ detail -- */

  function detail(id) {
    const c = S.cls(id);
    if (!c) return;
    const t = S.teacher(c.teacherId);
    const p = S.period(c.periodId);
    const pct = S.classGrade(id);
    const gd = S.gradeDisplay(id);
    const cats = S.categoryBreakdown(id);
    const work = U.sortBy(S.assignmentsFor(id), (a) => a.due, true);
    const graded = work.filter((a) => a.graded);
    const open = work.filter((a) => a.status !== "done");

    UI.modal({
      title: c.name,
      sub: [c.code, p ? p.name : "", "Rm " + c.room].filter(Boolean).join(" · "),
      size: "wide",
      footer: `<button class="btn left btn-danger" data-del>Delete class</button>
               <button class="icon-btn" data-copy-link title="Copy link to this class" aria-label="Copy link">🔗</button>
               <button class="btn" data-files>Files</button>
               <button class="btn" data-rubrics>Rubrics</button>
               <button class="btn" data-cats>Categories</button>
               <button class="btn" data-edit>Edit</button>
               <button class="btn btn-primary" data-close>Done</button>`,
      body: `
        <div class="row gap-16 wrap mb-16">
          <div class="row gap-12">
            ${UI.gradePill(pct, true)}
            <div>
              <div class="bold">${gd.mode === "percentage" ? (pct != null ? U.pctToLetter(pct) : "No grade yet") : gd.label}</div>
              <div class="tiny dim">${U.plural(graded.length, "graded item")} · ${c.credits} credit${c.credits === 1 ? "" : "s"}
                ${c.percentileInput != null ? ` · class avg ${c.percentileInput}%` : ""}</div>
            </div>
          </div>
          <div class="vdiv"></div>
          <div>
            <div class="tiny dim">Teacher</div>
            <div class="bold small">${t ? U.esc(t.name) : "—"}</div>
            ${t ? `<a class="tiny" href="mailto:${U.esc(t.email)}">${U.esc(t.email)}</a>` : ""}
          </div>
          <div class="vdiv"></div>
          <div>
            <div class="tiny dim">Meets</div>
            <div class="bold small">${c.days.join(", ") || "—"}</div>
            <div class="tiny dim">${p ? U.fmtTime(p.start) + " – " + U.fmtTime(p.end) : ""}${c.timezone ? ` (${c.timezone.split("/")[1].replace("_", " ")})` : ""}</div>
            ${c.timezone && p ? `<div class="tiny dim">= ${U.esc(U.fmtTime(U.convertWallTime(p.start, c.timezone)))} your time</div>` : ""}
          </div>
        </div>

        <h4 class="mb-8">Category breakdown</h4>
        ${cats.some((k) => k.pct != null)
          ? C.hbars(cats.filter((k) => k.pct != null).map((k) => {
              // F085 — per-category forecast, since tests and homework rarely trend together.
              const fc = S.categoryForecast(id, k.id);
              const trend = fc ? ` · ${fc.slopePerWeek >= 0 ? "▲" : "▼"} ${U.round(Math.abs(fc.slopePerWeek), 1)} pts/wk` : "";
              return {
                label: `${k.name} (${k.weight}%)`, value: U.round(k.pct, 1), color: c.color,
                note: `${k.earned}/${k.points} points · ${U.plural(k.count, "item")}${trend}`
              };
            }), { max: 100, fmt: (v) => v + "%" })
          : `<p class="dim small">Nothing graded in these categories yet.</p>`}

        <div class="divider"></div>

        <h4 class="mb-8">Open work <span class="badge">${open.length}</span></h4>
        ${open.length ? `<div class="list" style="border:1px solid var(--border);border-radius:var(--radius)">
          ${open.map((a) => `<div class="list-item">
            <span class="grow"><div class="title">${U.esc(a.title)}</div>
              <div class="meta">${U.esc(a.type)} · ${a.points} pts</div></span>
            ${UI.dueBadge(a.due)}
          </div>`).join("")}</div>` : `<p class="dim small">Nothing outstanding. 🎉</p>`}

        <div class="divider"></div>

        <h4 class="mb-8">Graded work</h4>
        ${graded.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Assignment</th><th>Category</th><th class="right">Score</th><th class="right">%</th></tr></thead>
          <tbody>${graded.map((a) => {
            const cat = c.categories.find((k) => k.id === a.categoryId);
            const s = a.points ? (a.earned / a.points) * 100 : null;
            return `<tr>
              <td>${U.esc(a.title)}<div class="tiny dim">${U.esc(U.fmtDate(a.due))}</div></td>
              <td class="small muted">${U.esc(cat ? cat.name : "—")}</td>
              <td class="right nums">${a.earned}/${a.points}</td>
              <td class="right">${UI.gradePill(s)}</td>
            </tr>`;
          }).join("")}</tbody></table></div>` : `<p class="dim small">No graded work yet.</p>`}`,
      onMount(root) {
        root.querySelector("[data-edit]").addEventListener("click", () => { UI.closeModal(); classForm(c); });
        root.querySelector("[data-cats]").addEventListener("click", () => { UI.closeModal(); categoryEditor(c); });
        root.querySelector("[data-copy-link]").addEventListener("click", () => App.router.copyDeepLink("classes", c.id));
        root.querySelector("[data-files]").addEventListener("click", () => { UI.closeModal(); fileManager(c); });
        root.querySelector("[data-rubrics]").addEventListener("click", () => { UI.closeModal(); rubricList(c); });
        root.querySelector("[data-del]").addEventListener("click", () => {
          UI.closeModal();
          UI.confirm({
            title: "Delete this class?",
            message: `"${c.name}" and its ${S.assignmentsFor(c.id).length} assignment(s) will be removed. This can't be undone.`,
            okLabel: "Delete", danger: true,
            onConfirm() {
              S.commit((db) => {
                db.assignments = db.assignments.filter((a) => a.classId !== c.id);
                db.classes = db.classes.filter((x) => x.id !== c.id);
              });
              UI.toast("Class deleted", c.name, "warn");
            }
          });
        });
      }
    });
  }

  /* ------------------------------------------------------------ render -- */

  function render() {
    const classes = S.db.classes;

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>Classes</h1>
          <div class="sub">${U.plural(classes.length, "class", "classes")} ·
            ${U.sum(classes, (c) => c.credits || 0)} credits this term</div>
        </div>
        <div class="page-actions">
          <button class="btn" data-periods>🔔 Bell schedule</button>
          <button class="btn btn-primary" data-add>+ Add class</button>
        </div>
      </div>

      ${classes.length ? `<div class="grid g-3">${classes.map((c) => {
        const t = S.teacher(c.teacherId);
        const p = S.period(c.periodId);
        const pct = S.classGrade(c.id);
        const gd = S.gradeDisplay(c.id);
        const work = S.assignmentsFor(c.id);
        const open = work.filter((a) => a.status !== "done").length;
        // U38 — how much of a class's work is done, visible without opening it.
        const doneRatio = work.length ? (work.filter((a) => a.status === "done").length / work.length) * 100 : 0;
        return `<div class="card card-link" data-class="${c.id}">
          <div style="height:4px;background:${U.esc(c.color)};border-radius:var(--radius) var(--radius) 0 0"></div>
          <div class="card-body">
            <div class="between mb-8">
              <div style="min-width:0">
                <h3 class="truncate">${U.esc(c.name)}</h3>
                <div class="tiny dim">${U.esc(c.code || "")}${c.code && p ? " · " : ""}${U.esc(p ? p.name : "")}</div>
              </div>
              <div class="row gap-6" style="align-items:center;flex-shrink:0">
                ${work.length ? C.ring(doneRatio, { size: 34, stroke: 4, color: c.color, label: "" }) : ""}
                ${gd.mode === "percentage" ? UI.gradePill(pct) : `<span class="badge">${U.esc(gd.label)}</span>`}
              </div>
            </div>
            <div class="row gap-8 small muted mb-8">
              ${t ? UI.avatar(t.name, c.color, "sm") : ""}
              <span class="truncate">${U.esc(t ? t.name : "No teacher set")}</span>
            </div>
            <div class="row gap-6 wrap">
              <span class="badge">Rm ${U.esc(c.room || "—")}</span>
              <span class="badge">${U.esc(c.days.join(" ") || "Not scheduled")}</span>
              ${open ? `<span class="badge warn">${open} open</span>` : `<span class="badge ok">Clear</span>`}
            </div>
          </div>
        </div>`;
      }).join("")}</div>`
      : UI.emptyState("📚", "No classes yet",
          "Add your first class to start tracking homework, grades, and your schedule.",
          `<button class="btn btn-primary" data-add>+ Add your first class</button>`)}
    </div>`;
  }

  function mount(root) {
    U.on(root, "click", "[data-add]", () => classForm(null));
    U.on(root, "click", "[data-periods]", () => periodsEditor());
    U.on(root, "click", "[data-class]", (_e, el) => detail(el.dataset.class));
  }

  return { render, mount, detail, classForm, title: "Classes" };
})();
