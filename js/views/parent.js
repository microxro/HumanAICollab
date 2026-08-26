/* ==========================================================================
   views/parent.js — the real parent portal

   A parent account links to a student with a one-time code, then sees the
   live status and summary that student's privacy toggles allow. The data is
   pushed by the student's device and read back here — genuinely cross-device.
   ========================================================================== */

App.views.parent = (function () {
  const U = App.utils, S = App.store, UI = App.ui, C = App.charts;

  let kids = null;
  let loading = false;
  let error = null;
  let poll = null;

  function refresh(silent) {
    if (!App.sync.isSignedIn()) { kids = []; return Promise.resolve(); }
    if (!silent) loading = true;
    return App.sync.children()
      .then((list) => { kids = list; error = null; })
      .catch((e) => { error = e.message; })
      .then(() => { loading = false; App.router.refresh(); });
  }

  /* --------------------------------------------------------------- link */

  function linkForm() {
    UI.modal({
      title: "Link to your student",
      sub: "Ask them to open Sharing → Generate a link code",
      okLabel: "Link",
      body: `<div class="field">
          <label>Link code</label>
          <input class="input mono" name="code" required maxlength="8" placeholder="ABC123"
                 style="text-transform:uppercase;letter-spacing:.15em;font-size:1.15rem;text-align:center" />
        </div>
        <p class="hint mt-8">Codes are single-use and expire after 24 hours.</p>`,
      onSubmit(d) {
        App.sync.redeemLinkCode(d.code.trim().toUpperCase())
          .then((res) => { UI.toast("Linked", res.linked.name, "ok"); refresh(); })
          .catch((e) => UI.toast("Couldn't link", e.message, "danger"));
      }
    });
  }

  /* ------------------------------------------------- F070 focus windows -- */

  function proposeFocusForm(studentId) {
    const now = new Date();
    const start = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const endD = new Date(now.getTime() + 60 * 60000);
    const end = `${String(endD.getHours()).padStart(2, "0")}:${String(endD.getMinutes()).padStart(2, "0")}`;

    UI.modal({
      title: "Propose a focus window",
      sub: "A shared quiet period they can see, agree to, or end early — not a lock on their device.",
      okLabel: "Propose",
      body: `<div class="form-grid">
        <div class="field"><label>From</label><input class="input" type="time" name="start" value="${start}" required /></div>
        <div class="field"><label>Until</label><input class="input" type="time" name="end" value="${end}" required /></div>
        <div class="field full"><label>Note <span class="hint">(optional)</span></label>
          <input class="input" name="note" placeholder="Chem test tomorrow — good time to lock in?" /></div>
      </div>`,
      onSubmit(d) {
        const today = new Date();
        const [sh, sm] = d.start.split(":").map(Number);
        const [eh, em] = d.end.split(":").map(Number);
        const startAt = new Date(today.getFullYear(), today.getMonth(), today.getDate(), sh, sm).getTime();
        let endAt = new Date(today.getFullYear(), today.getMonth(), today.getDate(), eh, em).getTime();
        if (endAt <= startAt) endAt += 24 * 60 * 60000;   // crosses midnight
        App.sync.proposeFocusWindow(studentId, startAt, endAt, (d.note || "").trim())
          .then(() => UI.toast("Proposed", "They'll see it next time they open the app.", "ok"))
          .catch((e) => UI.toast("Couldn't propose", e.message, "danger"));
      }
    });
  }

  /* ------------------------------------- suggest an outside-school activity */

  const COST_PERIODS = [
    ["session", "per session"], ["week", "per week"], ["month", "per month"],
    ["term", "per term"], ["year", "per year"], ["total", "one-off"]
  ];
  const TYPES = ["Class", "Lesson", "Sport", "Music", "Arts", "Tutoring",
    "Language", "Service", "Club", "Job", "Faith", "Other"];

  /**
   * The parent portal has read access to a summary and no write access to the
   * student's data, which is exactly why it is safe to hand a parent. So this
   * sends a suggestion the student adds (or doesn't) from their own Sharing
   * screen — the copy says so rather than implying it has already landed.
   */
  function suggestActivityForm(studentId, name) {
    UI.modal({
      title: "Add an activity",
      sub: `Outside school — a lesson, a club team, a weekend class. ${name || "They"} confirms it in their app.`,
      size: "wide",
      okLabel: "Send it over",
      body: `<div class="form-grid">
        <div class="field full">
          <label>What is it?</label>
          <input class="input" name="name" required maxlength="80" placeholder="e.g. Piano lessons" />
        </div>
        <div class="field">
          <label>Type</label>
          <select class="select" name="type">
            ${TYPES.map((t) => `<option ${t === "Class" ? "selected" : ""}>${U.esc(t)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Who runs it <span class="tiny dim">(optional)</span></label>
          <input class="input" name="provider" maxlength="80" placeholder="Northside Music Academy" />
        </div>
        <div class="field">
          <label>Instructor <span class="tiny dim">(optional)</span></label>
          <input class="input" name="contactName" maxlength="80" placeholder="Ms. Halvorsen" />
        </div>
        <div class="field">
          <label>Their phone <span class="tiny dim">(optional)</span></label>
          <input class="input" type="tel" name="contactPhone" maxlength="40" placeholder="555-0128" />
        </div>
        <div class="field full">
          <label>Address <span class="tiny dim">(optional)</span></label>
          <input class="input" name="address" maxlength="160" placeholder="412 Beaumont Ave" />
        </div>
        <div class="field">
          <label>Starts</label>
          <input class="input" type="time" name="start" value="16:00" />
        </div>
        <div class="field">
          <label>Ends</label>
          <input class="input" type="time" name="end" value="17:00" />
        </div>
        <div class="field full">
          <label>Meets on</label>
          ${UI.dayPicker("days", ["Sat"])}
        </div>
        <div class="field">
          <label>Cost <span class="tiny dim">(optional)</span></label>
          <div class="row gap-6">
            <input class="input" type="number" name="cost" min="0" max="1000000" step="0.01" style="width:110px" placeholder="0" />
            <select class="select" name="costPer" style="flex:1">
              ${COST_PERIODS.map(([v, label]) => `<option value="${v}" ${v === "month" ? "selected" : ""}>${label}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="field">
          <label>Season</label>
          <input class="input" name="season" maxlength="40" value="Year-round" />
        </div>
        <div class="field full">
          <label>Anything they should know <span class="tiny dim">(optional)</span></label>
          <input class="input" name="notes" maxlength="300" placeholder="Bring the theory book on the first Wednesday of the month." />
        </div>
      </div>`,
      onMount(root) { UI.bindDays(root); },
      onSubmit(d) {
        if (!d.name.trim()) return false;
        App.sync.suggestActivity(studentId, {
          name: d.name.trim(), type: d.type, provider: d.provider.trim(),
          contactName: d.contactName.trim(), contactPhone: d.contactPhone.trim(),
          address: d.address.trim(), notes: d.notes.trim(),
          start: d.start, end: d.end, season: d.season.trim(),
          days: d.days ? d.days.split(",").filter(Boolean) : [],
          cost: d.cost == null || d.cost === "" ? null : Number(d.cost),
          costPer: d.costPer
        })
          .then(() => { UI.toast("Sent", "They'll see it next time they open the app.", "ok"); refresh(); })
          .catch((e) => UI.toast("Couldn't send", e.message, "danger"));
      }
    });
  }

  /**
   * What the student already does outside school, if they share it.
   *
   * `null` and `undefined` mean different things here and are worth telling
   * apart: null is the student's toggle turned off, undefined is a student
   * whose app simply hasn't pushed a summary yet. Saying "not shared" to the
   * second is an accusation the data doesn't support.
   */
  function outsideActivities(sum, sent) {
    const acts = sum.activities;
    const pending = (sent || []).filter((x) => x.status === "pending");
    const answered = (sent || []).filter((x) => x.status !== "pending").slice(0, 3);
    const nothingSent = !pending.length && !answered.length;
    if (acts === undefined && nothingSent) return "";
    if (acts === null && nothingSent) {
      return `<p class="empty-note small muted">Outside-school activities aren't shared.</p>`;
    }

    // Their currency, not this device's — see S.money().
    const cur = sum.currency;
    const monthly = (acts || []).reduce((n, a) => n + (Number(a.monthly) || 0), 0);
    return `<div>
      <div class="between mb-8">
        <h4>Outside school</h4>
        ${monthly ? `<span class="badge">${U.esc(S.money(U.round(monthly, 2), cur))} a month</span>` : ""}
      </div>
      ${acts && acts.length ? `<div class="list" style="border:1px solid var(--border);border-radius:var(--radius)">
        ${acts.map((a) => `<div class="list-item">
          <span class="grow"><div class="title truncate">${U.esc(a.name)}</div>
            <div class="meta">${U.esc([a.provider, (a.days || []).join(", "), a.start ? `${U.fmtTime(a.start)}–${U.fmtTime(a.end)}` : ""].filter(Boolean).join(" · "))}</div></span>
          ${a.monthly ? `<span class="badge">${U.esc(S.money(U.round(a.monthly, 2), cur))}/mo</span>` : ""}
        </div>`).join("")}
      </div>` : acts ? `<p class="empty-note small muted">Nothing outside school yet.</p>` : ""}
      ${pending.length ? `<p class="tiny dim mt-8">Waiting on them: ${U.esc(pending.map((x) => x.name).join(", "))}</p>` : ""}
      ${answered.length ? `<p class="tiny dim mt-4">${answered.map((x) =>
        `${U.esc(x.name)} — ${x.status === "added" ? "added" : "not added"}`).join(" · ")}</p>` : ""}
    </div>`;
  }

  /* --------------------------------------------------------------- view */

  function freshness(ts) {
    if (!ts) return { text: "never", stale: true };
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 90) return { text: "just now", stale: false };
    if (s < 3600) return { text: `${Math.round(s / 60)} min ago`, stale: s > 900 };
    if (s < 86400) return { text: `${Math.round(s / 3600)} hr ago`, stale: true };
    return { text: `${Math.round(s / 86400)} days ago`, stale: true };
  }

  function childCard(k) {
    const st = k.status;
    const sum = k.summary || {};
    const fresh = freshness(k.updatedAt);

    const presenceLabel = !st ? "Not sharing location"
      : st.presence === "on-campus" ? "At school"
      : st.presence === "off-campus" ? "Away from school"
      : st.presence === "denied" ? "Location off (schedule only)"
      : "Status unknown";

    const usage = sum.usageWeek || 0;

    return `<div class="card mb-16">
      <div class="card-head">
        <div class="row gap-12">
          ${UI.avatar(k.name, S.PALETTE[0], "lg")}
          <div>
            <h3>${U.esc(k.name)}</h3>
            <div class="sub row gap-6">
              <span class="${fresh.stale ? "" : "row gap-4"}">
                ${fresh.stale ? "" : `<i class="live-dot" style="width:7px;height:7px"></i>`}
                Updated ${fresh.text}
              </span>
            </div>
          </div>
        </div>
        <div class="row gap-6">
          <button class="btn btn-sm btn-primary" data-open-account="${k.id}"
                  title="Work in their account — add classes, a bell schedule, assignments">✎ Open their account</button>
          <button class="btn btn-sm" data-checkin="${k.id}" title="Ask them to confirm they're okay">🔔 Check in</button>
          <button class="btn btn-sm" data-note="${k.id}" title="Leave a note they'll see in-app">✎ Note</button>
          <button class="btn btn-sm" data-propose-focus="${k.id}" title="Propose a shared quiet period">🤫 Focus window</button>
          <button class="btn btn-sm" data-add-activity="${k.id}" title="Suggest a lesson, club or class outside school">🌍 Add activity</button>
          <button class="btn btn-sm" data-unlink="${k.id}">Unlink</button>
        </div>
      </div>

      <div class="card-body col gap-16">
        ${sum.gradeAlerts && sum.gradeAlerts.length ? `<div class="conflict-banner">
          ${sum.gradeAlerts.map((g) => `📉 <span>${U.esc(g.className)} ${g.delta > 0 ? "improved" : "dropped"} ${g.delta > 0 ? "+" : ""}${g.delta} points recently.</span>`).join("<br>")}
        </div>` : ""}
        ${st ? `
          <div class="hero" style="padding:18px 20px">
            <div class="between wrap gap-12">
              <div style="min-width:0">
                <div class="hero-eyebrow row gap-6">
                  ${!fresh.stale && st.presence === "on-campus" ? `<i class="live-dot"></i>` : ""}
                  ${U.esc(presenceLabel)}
                </div>
                <div style="font-size:1.3rem;font-weight:720;margin-top:4px">${U.esc(st.label || "—")}</div>
                <div class="hero-sub">${U.esc(st.detail || "")}</div>
              </div>
              <div class="center" style="flex-shrink:0">
                <div style="font-size:1.3rem;font-weight:720">${U.fmtDur(usage)}</div>
                <div class="tiny" style="opacity:.85">App use this week</div>
              </div>
            </div>
          </div>

          <div class="row gap-16 wrap small">
            ${st.accuracy != null ? `<div><div class="tiny dim">GPS accuracy</div><div class="bold">±${st.accuracy} m</div></div>` : ""}
            ${st.distanceM != null ? `<div><div class="tiny dim">From campus</div><div class="bold">${App.geo.fmtDistance(st.distanceM)}</div></div>` : ""}
            ${st.room ? `<div><div class="tiny dim">Detected area</div><div class="bold">${U.esc(st.room)}</div></div>` : ""}
            ${st.nextClass ? `<div><div class="tiny dim">Next</div><div class="bold">${U.esc(st.nextClass)} ${st.nextAt ? "at " + U.fmtTime(st.nextAt) : ""}</div></div>` : ""}
            <div><div class="tiny dim">Source</div><div class="bold">${
              st.confidence === "gps-room" ? "GPS + timetable"
              : st.confidence === "gps-campus" ? "GPS geofence"
              : "Timetable only"}</div></div>
          </div>

          ${k.events && k.events.length ? `
            <div>
              <div class="tiny dim mb-4">Arrivals &amp; departures ${UI.helpHint("Fires on an actual on-campus/off-campus crossing, not a running feed of GPS positions — this only ever shows the moment they entered or left, nothing in between.")}</div>
              <div class="row gap-8 wrap">
                ${k.events.slice(0, 5).map((ev) => `<span class="badge ${ev.type === "arrival" ? "ok" : ""}">
                  ${ev.type === "arrival" ? "→ Arrived" : "← Left"} ${U.esc(U.fmtTime(`${String(new Date(ev.at).getHours()).padStart(2, "0")}:${String(new Date(ev.at).getMinutes()).padStart(2, "0")}`))}
                </span>`).join("")}
              </div>
            </div>` : ""}
        ` : `<p class="empty-note small muted">${U.esc(k.name)} has location sharing turned off.
             You'll still see the summary below if they've enabled it.</p>`}

        ${fresh.stale && st ? `<div class="card" style="background:var(--warn-bg);border:none">
          <div class="card-body small" style="color:var(--warn);padding:10px 12px">
            ⚠ This status is ${fresh.text} — their app may be closed. Location only updates while StudyHold is open.
          </div></div>` : ""}

        <div class="grid g-4">
          <div class="stat"><div class="stat-label">Open work</div>
            <div class="stat-value" style="font-size:1.5rem">${sum.openAssignments != null ? sum.openAssignments : "—"}</div>
            <div class="stat-foot">${sum.overdue ? `<span style="color:var(--danger)">${sum.overdue} overdue</span>` : "Nothing overdue"}</div></div>
          <div class="stat"><div class="stat-label">Study this week</div>
            <div class="stat-value" style="font-size:1.5rem">${sum.studyWeek != null ? U.fmtDur(sum.studyWeek) : "—"}</div>
            <div class="stat-foot">Focus sessions logged</div></div>
          <div class="stat"><div class="stat-label">Attendance</div>
            <div class="stat-value" style="font-size:1.5rem">${sum.attendance != null ? sum.attendance + "%" : "—"}</div>
            <div class="stat-foot">Last 3 weeks</div></div>
          <div class="stat"><div class="stat-label">GPA</div>
            <div class="stat-value" style="font-size:1.5rem">${sum.gpa != null ? sum.gpa : "Hidden"}</div>
            <div class="stat-foot">${sum.gpa != null ? "Shared by student" : "Not shared"}</div></div>
        </div>

        ${sum.classes && sum.classes.length ? `<div>
          <h4 class="mb-8">Class averages</h4>
          ${C.hbars(sum.classes.map((c) => ({ label: c.name, value: c.grade })), {
            max: 100, fmt: (v) => v + "% · " + U.pctToLetter(v) })}
        </div>` : ""}

        ${outsideActivities(sum, k.sentActivities)}

        ${sum.upcoming && sum.upcoming.length ? `<div>
          <h4 class="mb-8">Coming up</h4>
          <div class="list" style="border:1px solid var(--border);border-radius:var(--radius)">
            ${sum.upcoming.map((a) => `<div class="list-item">
              <span class="grow"><div class="title truncate">${U.esc(a.title)}</div>
                <div class="meta">${U.esc(a.className)}</div></span>
              ${UI.dueBadge(a.due)}
            </div>`).join("")}
          </div>
        </div>` : ""}
      </div>
    </div>`;
  }

  function render() {
    if (!App.sync.isSignedIn()) {
      return `<div class="page-inner">
        <div class="page-head"><div><h1>${App.i18n.t("parent", "Parent portal")}</h1>
          <div class="sub">See where your student is and how school is going</div></div></div>
        ${UI.emptyState("parentSignIn", "Sign in to your parent account",
          "Create an account with the Parent role, then link to your student with the code they generate.",
          `<button class="btn btn-primary" data-go="settings">Go to settings</button>`)}
      </div>`;
    }

    if (kids === null) refresh();

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>${App.i18n.t("parent", "Parent portal")}</h1>
          <div class="sub">${kids ? U.plural(kids.length, "linked student") : "Loading…"} ·
            updates while their app is open</div>
        </div>
        <div class="page-actions">
          <button class="btn" data-refresh>↻ Refresh</button>
          <button class="btn btn-primary" data-link>+ Link a student</button>
        </div>
      </div>

      ${error ? `<div class="card mb-16" style="border-left:3px solid var(--danger)">
        <div class="card-body small">${U.esc(error)}</div></div>` : ""}

      ${loading && !kids ? `<div class="card">${U.skeletonRows(2)}</div>`
        : (kids && kids.length) ? kids.map(childCard).join("")
        : UI.emptyState("studentsLinked", "No students linked yet",
            "Ask your student to open Sharing in their app and generate a link code, then enter it here.",
            `<button class="btn btn-primary" data-link>+ Enter a link code</button>`)}

      <div class="card mt-16" style="border-left:3px solid var(--info)">
        <div class="card-body row-top gap-10">
          <span style="font-size:1.1rem">ℹ️</span>
          <div class="small muted">
            <div class="bold" style="color:var(--text)">What you can and can't see</div>
            <p class="mt-4">Your student controls every toggle. Location only updates while StudyHold is open on
            their device — this is a web app, not a background tracker, so a closed app means a stale status.
            Grades appear only if they've turned on grade sharing.</p>
          </div>
        </div>
      </div>
    </div>`;
  }

  function mount(root) {
    U.on(root, "click", "[data-link]", linkForm);
    U.on(root, "click", "[data-refresh]", () => refresh());
    // F157 — step into the student's account. Every screen in the app then
    // shows their records and edits them for real, so this is deliberately a
    // decision rather than a link: it says whose data you are about to change,
    // and the banner stays up for as long as you are in there.
    U.on(root, "click", "[data-open-account]", (_e, el) => {
      const kid = (kids || []).find((k) => k.id === el.dataset.openAccount);
      if (!kid) return;
      UI.confirm({
        title: `Open ${kid.name}'s account?`,
        message: `Everything you change — classes, bell schedule, assignments, grades — is saved to ${kid.name}'s own records, and they'll see who made each change. You can leave at any time.`,
        okLabel: "Open it",
        onConfirm() {
          App.sync.actAsStudent({ id: kid.id, name: kid.name }).then((r) => {
            if (r.ok) UI.toast(`You're in ${kid.name}'s account`, "Changes save to their records.", "ok");
            else UI.toast("Couldn't open it", r.message || "", "danger");
          });
        }
      });
    });
    U.on(root, "click", "[data-checkin]", (_e, el) => {
      App.sync.requestCheckin(el.dataset.checkin)
        .then(() => UI.toast("Check-in requested", "They'll see it next time they open the app.", "ok"))
        .catch((e) => UI.toast("Couldn't request", e.message, "danger"));
    });
    U.on(root, "click", "[data-propose-focus]", (_e, el) => proposeFocusForm(el.dataset.proposeFocus));
    U.on(root, "click", "[data-add-activity]", (_e, el) => {
      const kid = (kids || []).find((k) => k.id === el.dataset.addActivity);
      suggestActivityForm(el.dataset.addActivity, kid ? kid.name : "");
    });
    U.on(root, "click", "[data-note]", (_e, el) => {
      const id = el.dataset.note;
      UI.prompt({
        title: "Leave a note", label: "They'll see this in-app",
        placeholder: "Don't forget your dentist appointment at 4!",
        okLabel: "Send",
        onSubmit(text) {
          App.sync.sendGuardianNote(id, text)
            .then(() => UI.toast("Note sent", "", "ok"))
            .catch((e) => UI.toast("Couldn't send", e.message, "danger"));
        }
      });
    });
    U.on(root, "click", "[data-unlink]", (_e, el) => {
      UI.confirm({
        title: "Unlink this student?",
        message: "You'll stop seeing their status. They can send a new code any time.",
        okLabel: "Unlink", danger: true,
        onConfirm() {
          App.sync.unlink(el.dataset.unlink)
            .then(() => { UI.toast("Unlinked"); refresh(); })
            .catch((e) => UI.toast("Failed", e.message, "danger"));
        }
      });
    });

    clearInterval(poll);
    poll = setInterval(() => {
      if (!document.hidden && App.sync.isSignedIn() && App.router.current === "parent") refresh(true);
    }, 45000);
  }

  function unmount() { clearInterval(poll); kids = null; }

  return { render, mount, unmount, title: "Parent portal" };
})();
