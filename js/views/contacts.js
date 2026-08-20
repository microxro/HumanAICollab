/* ==========================================================================
   views/contacts.js — teacher directory with office hours and quick email
   ========================================================================== */

App.views.contacts = (function () {
  const U = App.utils, S = App.store, UI = App.ui;

  let q = "";

  function form(tc) {
    const t = tc || {};
    UI.modal({
      title: tc ? "Edit contact" : "Add a teacher",
      size: "wide",
      okLabel: tc ? "Save" : "Add contact",
      footer: tc ? `<button type="button" class="btn btn-danger left" data-del>Delete</button>
                    <button type="button" class="btn" data-close>Cancel</button>
                    <button type="submit" class="btn btn-primary">Save</button>` : undefined,
      body: `<div class="form-grid">
        <div class="field"><label>Name</label>
          <input class="input" name="name" required value="${U.esc(t.name || "")}" placeholder="Ms. Rivera" /></div>
        <div class="field"><label>Subject</label>
          <input class="input" name="subject" value="${U.esc(t.subject || "")}" placeholder="Mathematics" /></div>
        <div class="field"><label>Email</label>
          <input class="input" type="email" name="email" value="${U.esc(t.email || "")}" placeholder="name@school.edu" /></div>
        <div class="field"><label>Phone</label>
          <input class="input" name="phone" value="${U.esc(t.phone || "")}" placeholder="555-0100" /></div>
        <div class="field"><label>Room</label>
          <input class="input" name="room" value="${U.esc(t.room || "")}" placeholder="204" /></div>
        <div class="field"><label>Office hours</label>
          <input class="input" name="office" value="${U.esc(t.office || "")}" placeholder="Mon & Wed, 3–4 PM" /></div>
        <div class="field full"><label>Notes</label>
          <textarea class="textarea" name="note" rows="2"
            placeholder="Retake policy, how they prefer to be contacted…">${U.esc(t.note || "")}</textarea></div>
      </div>`,
      onMount(root) {
        const del = root.querySelector("[data-del]");
        if (del) del.addEventListener("click", () => {
          UI.closeModal();
          const used = S.db.classes.filter((c) => c.teacherId === tc.id).length;
          UI.confirm({
            title: "Delete contact?",
            message: used ? `${tc.name} is assigned to ${U.plural(used, "class", "classes")}. Those classes will show no teacher.`
                          : `${tc.name} will be removed.`,
            okLabel: "Delete", danger: true,
            onConfirm() {
              S.commit((db) => {
                db.classes.forEach((c) => { if (c.teacherId === tc.id) c.teacherId = null; });
                db.activities.forEach((a) => { if (a.advisorId === tc.id) a.advisorId = null; });
                db.teachers = db.teachers.filter((x) => x.id !== tc.id);
              });
              UI.toast("Contact deleted", tc.name, "warn");
            }
          });
        });
      },
      onSubmit(d) {
        if (!d.name.trim()) return false;
        const patch = {
          name: d.name.trim(), subject: d.subject.trim(), email: d.email.trim(),
          phone: d.phone.trim(), room: d.room.trim(), office: d.office.trim(), note: d.note.trim()
        };
        if (tc) { S.update("teachers", tc.id, patch); UI.toast("Contact updated", patch.name); }
        else { S.insert("teachers", patch); UI.toast("Contact added", patch.name, "ok"); }
      }
    });
  }

  // Pre-fills a subject line so emailing a teacher is one click.
  function mailto(t, cls) {
    const subject = encodeURIComponent(
      cls ? `${cls.name} — question from ${S.profile.name}` : `Question from ${S.profile.name}`);
    const body = encodeURIComponent(`Hi ${t.name.split(" ").slice(-1)[0]},\n\n\n\nThank you,\n${S.profile.name}`);
    return `mailto:${t.email}?subject=${subject}&body=${body}`;
  }

  function detail(id) {
    const t = S.teacher(id);
    if (!t) return;
    const classes = S.db.classes.filter((c) => c.teacherId === t.id);
    const acts = S.db.activities.filter((a) => a.advisorId === t.id);

    UI.modal({
      title: t.name,
      sub: [t.subject, t.room ? "Rm " + t.room : ""].filter(Boolean).join(" · "),
      footer: `<button type="button" class="btn left" data-edit>Edit</button>
               ${t.email ? `<a class="btn btn-primary" href="${mailto(t, classes[0])}">✉ Email</a>` : ""}
               <button type="button" class="btn" data-close>Close</button>`,
      body: `
        <div class="row gap-12 mb-16">
          ${UI.avatar(t.name, classes[0] ? classes[0].color : "#64748b", "xl")}
          <div>
            ${t.email ? `<div class="small"><a href="mailto:${U.esc(t.email)}">${U.esc(t.email)}</a></div>` : ""}
            ${t.phone ? `<div class="small muted">${U.esc(t.phone)}</div>` : ""}
            ${t.office ? `<div class="tiny dim mt-4">🕐 ${U.esc(t.office)}</div>` : ""}
          </div>
        </div>

        ${t.note ? `<div class="card" style="background:var(--surface-2)"><div class="card-body">
          <div class="tiny dim mb-4">Notes</div>
          <div class="small" style="white-space:pre-wrap">${U.esc(t.note)}</div>
        </div></div><div class="divider"></div>` : ""}

        ${classes.length ? `<h4 class="mb-8">Your classes with ${U.esc(t.name.split(" ")[0])}</h4>
          <div class="list" style="border:1px solid var(--border);border-radius:var(--radius)">
          ${classes.map((c) => {
            const p = S.period(c.periodId);
            const pct = S.classGrade(c.id);
            return `<div class="list-item">
              <i class="dot-badge" style="background:${U.esc(c.color)}"></i>
              <span class="grow"><div class="title">${U.esc(c.name)}</div>
                <div class="meta">${U.esc(p ? p.name : "")} · Rm ${U.esc(c.room)}</div></span>
              ${UI.gradePill(pct)}
            </div>`;
          }).join("")}</div>` : ""}

        ${acts.length ? `<h4 class="mt-16 mb-8">Advises</h4>
          <div class="row gap-6 wrap">${acts.map((a) => `<span class="badge">${U.esc(a.name)}</span>`).join("")}</div>` : ""}`,
      onMount(root) {
        root.querySelector("[data-edit]").addEventListener("click", () => { UI.closeModal(); form(t); });
      }
    });
  }

  function render() {
    const needle = q.toLowerCase();
    const rows = S.db.teachers.filter((t) =>
      !needle || t.name.toLowerCase().includes(needle) ||
      (t.subject || "").toLowerCase().includes(needle) ||
      (t.room || "").toLowerCase().includes(needle));

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>Contacts</h1>
          <div class="sub">${U.plural(S.db.teachers.length, "teacher")} ·
            office hours and one-tap email</div>
        </div>
        <div class="page-actions">
          <input class="input input-sm" id="cSearch" placeholder="Search…" value="${U.esc(q)}" style="max-width:200px" />
          <button class="btn btn-primary" data-add>+ Add contact</button>
        </div>
      </div>

      ${rows.length ? `<div class="grid g-3">${rows.map((t) => {
        const classes = S.db.classes.filter((c) => c.teacherId === t.id);
        const color = classes[0] ? classes[0].color : "#64748b";
        return `<div class="card card-link" data-teacher="${t.id}">
          <div class="card-body">
            <div class="row gap-12 mb-12">
              ${UI.avatar(t.name, color, "lg")}
              <div style="min-width:0">
                <h3 class="truncate">${U.esc(t.name)}</h3>
                <div class="tiny dim truncate">${U.esc(t.subject || "—")}${t.room ? " · Rm " + U.esc(t.room) : ""}</div>
              </div>
            </div>
            ${t.office ? `<div class="tiny dim mb-8">🕐 ${U.esc(t.office)}</div>` : ""}
            ${classes.length ? `<div class="row gap-6 wrap mb-12">
              ${classes.map((c) => `<span class="tag" style="background:${U.hexAlpha(c.color, .14)};color:${U.esc(c.color)}">${U.esc(c.name)}</span>`).join("")}
            </div>` : `<div class="tiny dim mb-12">No classes assigned</div>`}
            <div class="row gap-6">
              ${t.email ? `<a class="btn btn-sm btn-primary" href="${mailto(t, classes[0])}"
                             onclick="event.stopPropagation()">✉ Email</a>` : ""}
              ${t.phone ? `<a class="btn btn-sm" href="tel:${U.esc(t.phone)}"
                             onclick="event.stopPropagation()">📞 Call</a>` : ""}
            </div>
          </div>
        </div>`;
      }).join("")}</div>`
      : UI.emptyState("👥", q ? "No matches" : "No contacts yet",
          q ? "Try a different search." : "Add your teachers so their office hours and emails are always one tap away.",
          `<button class="btn btn-primary" data-add>+ Add a contact</button>`)}
    </div>`;
  }

  function mount(root) {
    U.on(root, "click", "[data-add]", () => form(null));
    U.on(root, "click", "[data-teacher]", (_e, el) => detail(el.dataset.teacher));
    const s = root.querySelector("#cSearch");
    if (s) s.addEventListener("input", U.debounce((e) => {
      q = e.target.value;
      App.router.refresh();
      const el = document.querySelector("#cSearch");
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }, 250));
  }

  return { render, mount, title: "Contacts" };
})();
