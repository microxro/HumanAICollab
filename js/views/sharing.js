/* ==========================================================================
   views/sharing.js — privacy controls, real location sharing, peer matching

   This is where the student decides what a parent and their classmates can
   see. Location here is genuine: a campus geofence you set by standing at
   school, a live watchPosition fix, and a throttled push to the server that a
   linked parent reads in the Parent portal.
   ========================================================================== */

App.views.sharing = (function () {
  const U = App.utils, S = App.store, UI = App.ui, C = App.charts;

  let unsub = null;
  let busy = false;

  /* -------------------------------------------------------- geo controls */

  function geoCard() {
    const g = S.settings.geo;
    const st = App.geo.status();
    const perm = st.permission;

    const permBadge = perm === "granted" ? `<span class="badge ok">Allowed</span>`
      : perm === "denied" ? `<span class="badge danger">Blocked</span>`
      : perm === "unsupported" ? `<span class="badge">Unsupported</span>`
      : `<span class="badge">Not asked</span>`;

    return `<div class="card">
      <div class="card-head">
        <div><h3>Location</h3><div class="sub">Real GPS, with a campus geofence you control</div></div>
        ${permBadge}
      </div>
      <div class="card-body">

        ${perm === "denied" ? `<div class="card mb-16" style="background:var(--danger-bg);border:none">
          <div class="card-body small" style="color:var(--danger);padding:10px 12px">
            Location is blocked for this site. Allow it from the padlock icon in your address bar,
            then reload. Until then, your status falls back to your timetable.
          </div></div>` : ""}

        <div class="between" style="padding:12px 0;border-bottom:1px solid var(--border)">
          <div style="min-width:0;padding-right:12px">
            <div class="bold small">Use GPS</div>
            <div class="tiny dim">Confirms whether you're actually on campus</div>
          </div>
          <label class="switch">
            <input type="checkbox" id="geoToggle" ${g.enabled ? "checked" : ""}
                   ${perm === "unsupported" ? "disabled" : ""} />
            <span class="track"></span>
          </label>
        </div>

        ${g.enabled ? `
          <div class="between" style="padding:12px 0;border-bottom:1px solid var(--border)">
            <div><div class="bold small">Live tracking</div>
              <div class="tiny dim">${App.geo.isWatching()
                ? "Watching your position while this tab is open"
                : "Paused — status comes from your timetable"}</div></div>
            <label class="switch">
              <input type="checkbox" id="watchToggle" ${App.geo.isWatching() ? "checked" : ""} />
              <span class="track"></span>
            </label>
          </div>

          <div style="padding:14px 0;border-bottom:1px solid var(--border)">
            <div class="between mb-8">
              <div class="bold small">Campus location</div>
              ${g.campusLat != null ? `<span class="badge ok">Set</span>` : `<span class="badge warn">Not set</span>`}
            </div>
            ${g.campusLat != null
              ? `<div class="tiny dim mono mb-8">${g.campusLat.toFixed(5)}, ${g.campusLng.toFixed(5)}
                 · radius ${g.radiusM} m</div>`
              : `<p class="tiny dim mb-8">Stand at school and tap the button to set the geofence.</p>`}
            <div class="row gap-8 wrap">
              <button class="btn btn-sm ${g.campusLat == null ? "btn-primary" : ""}" id="setCampus" ${busy ? "disabled" : ""}>
                📍 ${g.campusLat != null ? "Update to my location" : "Set campus to my location"}
              </button>
              ${g.campusLat != null ? `<button class="btn btn-sm" id="clearCampus">Clear</button>` : ""}
            </div>
            <div class="row gap-8 mt-12" style="align-items:flex-end">
              <div class="field" style="max-width:150px">
                <label class="tiny">Geofence radius</label>
                <select class="select input-sm" id="radiusSel">
                  ${[80, 120, 180, 250, 400, 800].map((r) => `<option value="${r}" ${r === g.radiusM ? "selected" : ""}>${r} m</option>`).join("")}
                </select>
              </div>
              <div class="field" style="max-width:170px">
                <label class="tiny">Update every</label>
                <select class="select input-sm" id="intervalSel">
                  ${[30, 60, 120, 300].map((v) => `<option value="${v}" ${v === g.shareIntervalS ? "selected" : ""}>${v < 60 ? v + "s" : v / 60 + " min"}</option>`).join("")}
                </select>
              </div>
            </div>
          </div>

          <div style="padding:14px 0">
            <div class="between mb-8">
              <div class="bold small">Named places <span class="hint">optional</span></div>
              <button class="btn btn-sm" id="addRoom">+ Save this spot</button>
            </div>
            ${g.rooms.length ? `<div class="list" style="border:1px solid var(--border);border-radius:var(--radius)">
              ${g.rooms.map((r) => `<div class="list-item" style="padding:8px 11px">
                <span class="grow"><div class="small bold">${U.esc(r.label)}</div>
                  <div class="tiny dim mono">${r.lat.toFixed(4)}, ${r.lng.toFixed(4)} · ${r.radiusM} m</div></span>
                <button class="icon-btn btn-sm" data-rm-room="${r.id}" aria-label="Remove">✕</button>
              </div>`).join("")}</div>`
              : `<p class="tiny dim">Save the gym, library, or a building entrance to get a more specific
                 "where am I" than just on/off campus.</p>`}
          </div>
        ` : `<p class="small muted" style="padding-top:12px">
            GPS is off. Your live status still works — it just comes from your timetable and the clock.
          </p>`}
      </div>
    </div>`;
  }

  /* ------------------------------------------------------- live status */

  function statusCard() {
    const st = App.geo.status();
    const tone = st.presence === "on-campus" ? "ok"
      : st.presence === "off-campus" ? "info"
      : st.presence === "denied" ? "warn" : "";

    return `<div class="hero" style="padding:20px 22px">
      <div class="between wrap gap-16">
        <div style="min-width:0">
          <div class="hero-eyebrow row gap-6">
            ${st.presence === "on-campus" && !st.stale ? `<i class="live-dot"></i>` : ""}
            Your live status
          </div>
          <div style="font-size:1.35rem;font-weight:720;margin-top:4px">${U.esc(st.label)}</div>
          <div class="hero-sub">${U.esc(st.detail)}</div>
        </div>
        <div class="col gap-4" style="text-align:right;flex-shrink:0">
          <span class="location-tag">${
            st.confidence === "gps-room" ? "📍 GPS + timetable"
            : st.confidence === "gps-campus" ? "📍 GPS geofence"
            : st.confidence === "schedule" ? "🕐 Timetable only"
            : "Sharing off"}</span>
          ${st.accuracy != null ? `<span class="tiny" style="opacity:.85">±${st.accuracy} m accurate</span>` : ""}
          ${st.ageSeconds != null ? `<span class="tiny" style="opacity:.85">
            fix ${st.ageSeconds < 60 ? "just now" : Math.round(st.ageSeconds / 60) + " min ago"}</span>` : ""}
        </div>
      </div>
      ${st.error ? `<div class="tiny mt-8" style="opacity:.9">⚠ ${U.esc(st.error)}</div>` : ""}
    </div>`;
  }

  /* ------------------------------------------------------- parent preview */

  function last7Usage() {
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const key = U.dateKey(U.addDays(new Date(), -i));
      out.push({
        label: U.DOW_SHORT[U.parseDate(key).getDay()][0],
        full: U.fmtDate(key, "day"),
        value: Math.round(S.db.usage[key] || 0),
        highlight: i === 0
      });
    }
    return out;
  }

  function parentPreview() {
    const st = App.geo.status();
    const share = S.settings.locationSharing;
    const usage = last7Usage();
    const totalWeek = U.sum(usage, (u) => u.value);
    const due = S.dueSoon(7).slice(0, 5);
    const att = S.attendanceRate();
    const signedIn = App.sync.isSignedIn();

    return `<div class="card">
      <div class="card-head">
        <div><h3>What ${U.esc(S.profile.parentName || "your parent")} sees</h3>
          <div class="sub">${signedIn ? "This is pushed live to linked parents" : "Preview — sign in to actually share it"}</div></div>
        <span class="badge ${share ? "ok" : ""}">${share ? "Sharing on" : "Sharing off"}</span>
      </div>
      <div class="card-body col gap-16">
        ${share ? `<div class="card" style="background:var(--surface-2);border:none">
            <div class="card-body">
              <div class="tiny dim">Currently</div>
              <div class="bold" style="font-size:1.05rem">${U.esc(st.label)}</div>
              <div class="small muted">${U.esc(st.detail)}</div>
            </div>
          </div>`
          : `<p class="empty-note small">Location sharing is off, so no live status is shared.</p>`}

        <div>
          <h4 class="mb-8">App usage — last 7 days</h4>
          ${C.bars(usage, { h: 140, fmt: (v) => U.fmtDur(v) })}
          <p class="tiny dim mt-8">Total this week: <strong>${U.fmtDur(totalWeek)}</strong> ·
            measured while this tab is in the foreground.</p>
        </div>

        <div class="grid g-2">
          <div>
            <h4 class="mb-8">Upcoming work</h4>
            ${due.length ? `<div class="list" style="border:1px solid var(--border);border-radius:var(--radius)">
              ${due.map((a) => `<div class="list-item">
                <i class="dot-badge" style="background:${U.esc(S.classColor(a.classId))}"></i>
                <span class="grow"><div class="title truncate">${U.esc(a.title)}</div>
                  <div class="meta">${U.esc(S.className(a.classId))}</div></span>
                ${UI.dueBadge(a.due)}
              </div>`).join("")}</div>`
              : `<p class="dim small">Nothing due this week.</p>`}
          </div>
          <div>
            <h4 class="mb-8">Summary</h4>
            <div class="list" style="border:1px solid var(--border);border-radius:var(--radius)">
              <div class="list-item"><span class="grow small">Attendance</span><span class="bold">${U.round(att.rate, 1)}%</span></div>
              <div class="list-item"><span class="grow small">Study this week</span><span class="bold">${U.fmtDur(S.studyThisWeek())}</span></div>
              <div class="list-item"><span class="grow small">Open assignments</span><span class="bold">${S.openAssignments().length}</span></div>
              <div class="list-item"><span class="grow small">GPA</span>
                <span class="bold">${S.settings.shareGrades ? U.round(S.gpa(), 2) : "Hidden"}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }

  /* --------------------------------------------------------- peer section */

  function peerSection() {
    const on = S.settings.peerSharing;
    const peers = S.db.peers;

    if (!on) {
      return `<div class="card"><div class="card-head"><h3>Classmates</h3></div>
        <div class="card-body"><p class="small muted">Peer sharing is off. Turn it on to see which
        classes you share with friends and when you're both free.</p></div></div>`;
    }

    const mine = new Set(S.termClasses().map((c) => c.id));
    const sharing = peers.filter((p) => p.sharing);

    return `<div class="card">
      <div class="card-head">
        <div><h3>Classmates</h3><div class="sub">Only friends who also opted in appear here</div></div>
        <span class="badge ok">${sharing.length} sharing</span>
      </div>
      ${peers.length ? `<div class="list">${peers.map((p) => {
        if (!p.sharing) {
          return `<div class="list-item">
            ${UI.avatar(p.name, "#94a3b8")}
            <span class="grow"><div class="title">${U.esc(p.name)}</div>
              <div class="meta">Not sharing their schedule</div></span>
            <span class="badge">Private</span>
          </div>`;
        }
        const shared = p.classIds.filter((id) => mine.has(id));
        const nowIn = (() => {
          const now = U.nowMin();
          for (const id of p.classIds) {
            const c = S.cls(id);
            if (!c) continue;
            const meets = S.classesOnDate(U.today()).some((x) => x.cls.id === id);
            if (!meets) continue;
            const per = S.period(c.periodId);
            if (per && now >= U.toMin(per.start) && now < U.toMin(per.end)) return c;
          }
          return null;
        })();

        return `<div class="list-item">
          ${UI.avatar(p.name, p.color)}
          <span class="grow" style="min-width:0">
            <div class="title">${U.esc(p.name)}</div>
            <div class="meta">${nowIn ? `In ${U.esc(nowIn.name)} now` : "Not in class right now"}</div>
            ${shared.length ? `<div class="row gap-4 wrap" style="margin-top:5px">
              ${shared.map((id) => {
                const c = S.cls(id);
                return `<span class="tag" style="background:${U.hexAlpha(c.color, .14)};color:${U.esc(c.color)}">${U.esc(c.name)}</span>`;
              }).join("")}
            </div>` : `<div class="tiny dim mt-4">No classes in common</div>`}
          </span>
          <span class="badge brand">${U.plural(shared.length, "shared class", "shared classes")}</span>
          <button class="icon-btn btn-sm" data-rm-peer="${p.id}" aria-label="Remove">✕</button>
        </div>`;
      }).join("")}</div>`
      : UI.emptyState("classmates", "No classmates yet", "Add friends to compare schedules.")}
      <div class="card-foot">
        <div class="row gap-8">
          <button class="btn btn-sm" data-add-peer>+ Add a classmate</button>
          <button class="btn btn-sm" data-go="groups">Study groups →</button>
        </div>
      </div>
    </div>`;
  }

  /* --------------------------------------------------------- F053 real -- */
  // Real, server-backed friend requests — accept/decline, unlike the local
  // classmate list above which the other person never agreed to.

  let realFriends = null;

  function loadRealFriends() {
    if (!App.sync.isSignedIn()) return;
    App.sync.listFriends().then((list) => { realFriends = list; App.router.refresh(); }).catch(() => {});
  }

  function realFriendsCard() {
    if (!App.sync.isSignedIn()) {
      return `<div class="card">
        <div class="card-head"><h3>Real friend requests</h3></div>
        <div class="card-body">
          <p class="small muted mb-12">Sign in to send and accept real friend requests — unlike the classmate
          list below, these need the other person's consent.</p>
          <button class="btn btn-primary" data-go="settings">Sign in</button>
        </div>
      </div>`;
    }
    const list = realFriends || [];
    const incoming = list.filter((p) => p.status === "pending-in");
    const accepted = list.filter((p) => p.status === "accepted");
    const outgoing = list.filter((p) => p.status === "pending-out");

    return `<div class="card">
      <div class="card-head">
        <div><h3>Real friend requests</h3><div class="sub">Accept or decline — server-backed, two-way</div></div>
        <button class="btn btn-sm" data-add-real-friend>+ Add</button>
      </div>
      <div class="card-body">
        ${incoming.length ? `<h4 class="mb-8">Waiting on you</h4>
          <div class="list mb-12">${incoming.map((p) => `<div class="list-item">
            ${UI.avatar(p.name, "#94a3b8")}
            <span class="grow">${U.esc(p.name)}</span>
            <button class="btn btn-sm btn-primary" data-friend-accept="${p.id}">Accept</button>
            <button class="btn btn-sm" data-friend-decline="${p.id}">Decline</button>
          </div>`).join("")}</div>` : ""}
        ${accepted.length ? `<h4 class="mb-8">Friends</h4>
          <div class="list mb-12">${accepted.map((p) => `<div class="list-item">
            ${UI.avatar(p.name, "#4f46e5")}
            <span class="grow">${U.esc(p.name)}</span>
            <button class="icon-btn btn-sm" data-friend-remove="${p.id}" aria-label="Remove">✕</button>
          </div>`).join("")}</div>` : ""}
        ${outgoing.length ? `<h4 class="mb-8">Sent, waiting on them</h4>
          <div class="list">${outgoing.map((p) => `<div class="list-item">
            ${UI.avatar(p.name, "#94a3b8")}
            <span class="grow">${U.esc(p.name)}</span><span class="badge">Pending</span>
          </div>`).join("")}</div>` : ""}
        ${!list.length ? `<p class="dim small">No requests yet — add a friend by their Scholar account email.</p>` : ""}
      </div>
    </div>`;
  }

  /* ------------------------------------------------- F068/F071 guardian -- */

  let checkins = null, guardianNotes = null;

  function loadGuardianInbox() {
    if (!App.sync.isSignedIn()) return;
    Promise.all([App.sync.listCheckins(), App.sync.listGuardianNotes()])
      .then(([c, n]) => { checkins = c; guardianNotes = n; App.router.refresh(); })
      .catch(() => {});
  }

  /* ------------------------------------------------- F070 focus windows -- */

  let focusWindows = null;

  function loadFocusWindows() {
    if (!App.sync.isSignedIn()) return;
    App.sync.listFocusWindows().then((f) => { focusWindows = f; App.router.refresh(); }).catch(() => {});
  }

  function focusWindowCard() {
    if (!App.sync.isSignedIn()) return "";
    const list = focusWindows || [];
    const pending = list.filter((f) => f.status === "pending");
    const active = list.find((f) => f.status === "agreed" && f.endAt > Date.now());
    if (!pending.length && !active) return "";

    const fmt = (ms) => {
      const d = new Date(ms);
      return U.fmtTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
    };

    return `<div class="card">
      <div class="card-head"><h3>Focus windows ${UI.helpHint("A shared quiet period your guardian proposes and you agree to (or not) — you can always see it and end it early. It's an agreement, not a lock on your device.")}</h3></div>
      <div class="card-body col gap-12">
        ${active ? `<div class="row gap-8" style="align-items:center;background:var(--ok-bg);padding:10px 12px;border-radius:var(--radius-sm)">
          <span class="grow small">Focus window active until ${U.esc(fmt(active.endAt))}${active.note ? " — " + U.esc(active.note) : ""}</span>
          <button class="btn btn-sm" data-focus-end="${active.id}">End early</button>
        </div>` : ""}
        ${pending.map((f) => `<div class="row gap-8" style="align-items:center;background:var(--warn-bg);padding:10px 12px;border-radius:var(--radius-sm)">
          <span class="grow small">${U.esc(f.fromName)} proposed a focus window ${U.esc(fmt(f.startAt))}–${U.esc(fmt(f.endAt))}${f.note ? " — " + U.esc(f.note) : ""}</span>
          <button class="btn btn-sm" data-focus-decline="${f.id}">Decline</button>
          <button class="btn btn-sm btn-primary" data-focus-agree="${f.id}">Agree</button>
        </div>`).join("")}
      </div>
    </div>`;
  }

  function guardianInboxCard() {
    if (!App.sync.isSignedIn()) return "";
    const pending = (checkins || []).filter((c) => !c.respondedAt);
    const notes = guardianNotes || [];
    if (!pending.length && !notes.length) return "";

    return `<div class="card">
      <div class="card-head"><h3>From your guardians</h3></div>
      <div class="card-body col gap-12">
        ${pending.map((c) => `<div class="row gap-8" style="align-items:center;background:var(--warn-bg);padding:10px 12px;border-radius:var(--radius-sm)">
          <span class="grow small">${U.esc(c.fromName)} asked you to check in ${U.esc(U.relDate(U.dateKey(new Date(c.at))))}</span>
          <button class="btn btn-sm btn-primary" data-checkin-respond="${c.id}">I'm okay 👍</button>
        </div>`).join("")}
        ${notes.slice(0, 5).map((n) => `<div class="list-item">
          <span style="font-size:1.1rem">📝</span>
          <span class="grow"><div class="small">${U.esc(n.text)}</div>
            <div class="tiny dim">${U.esc(n.fromName)} · ${U.esc(U.relDate(U.dateKey(new Date(n.at))))}</div></span>
        </div>`).join("")}
      </div>
    </div>`;
  }

  function realFriendForm() {
    UI.prompt({
      title: "Send a friend request",
      label: "Their Scholar account email",
      placeholder: "friend@school.edu",
      okLabel: "Send request",
      onSubmit(email) {
        App.sync.requestFriend(email).then(() => {
          UI.toast("Request sent", email, "ok");
          loadRealFriends();
        }).catch((e) => UI.toast("Couldn't send request", e.message, "danger"));
      }
    });
  }

  function peerForm() {
    UI.modal({
      title: "Add a classmate",
      okLabel: "Add",
      body: `<div class="field mb-12">
          <label>Name</label>
          <input class="input" name="name" required placeholder="Jordan Lee" />
        </div>
        <div class="field">
          <label>Classes you know they're in</label>
          <div class="row wrap gap-6" id="peerCls">
            ${S.termClasses().map((c) => `<button type="button" class="chip" data-cid="${c.id}">${U.esc(c.name)}</button>`).join("")}
          </div>
        </div>
        <p class="hint mt-8">Stored locally. For real two-way sharing, use a study group instead.</p>`,
      onMount(root) {
        root.querySelector("#peerCls").addEventListener("click", (e) => {
          const b = e.target.closest("[data-cid]");
          if (b) b.classList.toggle("active");
        });
      },
      onSubmit(d, root) {
        if (!d.name.trim()) return false;
        const classIds = U.$$("#peerCls .chip.active", root).map((b) => b.dataset.cid);
        S.insert("peers", {
          name: d.name.trim(), color: S.PALETTE[S.db.peers.length % S.PALETTE.length],
          sharing: true, classIds
        });
        UI.toast("Classmate added", d.name, "ok");
      }
    });
  }

  /* --------------------------------------------------------------- render */

  function toggleRow(key, title, desc) {
    return `<div class="between" style="padding:12px 0;border-bottom:1px solid var(--border)">
      <div style="min-width:0;padding-right:12px">
        <div class="bold small">${U.esc(title)}</div>
        <div class="tiny dim">${U.esc(desc)}</div>
      </div>
      <label class="switch">
        <input type="checkbox" data-toggle="${key}" ${S.settings[key] ? "checked" : ""} />
        <span class="track"></span>
      </label>
    </div>`;
  }

  function render() {
    const signedIn = App.sync.isSignedIn();

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>${App.i18n.t("sharing", "Sharing")}</h1>
          <div class="sub">You control exactly what parents and classmates can see</div>
        </div>
      </div>

      ${statusCard()}

      ${!signedIn ? `<div class="card mt-16" style="border-left:3px solid var(--info)">
        <div class="card-body row-top gap-10">
          <span style="font-size:1.1rem">ℹ️</span>
          <div class="small muted">
            <div class="bold" style="color:var(--text)">You're not signed in</div>
            <p class="mt-4">Everything below works locally, but nothing is actually sent anywhere until you
            create an account. Sign in to push your status to a linked parent.</p>
            <button class="btn btn-sm mt-8" data-go="settings">Set up an account</button>
          </div>
        </div>
      </div>` : ""}

      <div class="grid g-side mt-16">
        <div class="col gap-16">
          <div class="card">
            <div class="card-head"><h3>Privacy controls</h3></div>
            <div class="card-body" style="padding-top:4px">
              ${toggleRow("locationSharing", "Share my status with parents",
                "Which class I'm in, and whether I'm on campus")}
              ${toggleRow("peerSharing", "Peer schedule matching",
                "Let opted-in classmates see my class list")}
              ${toggleRow("shareGrades", "Share grades",
                "Include GPA and class averages in the parent view")}
            </div>
          </div>
          ${geoCard()}
        </div>

        <div class="col gap-16">
          ${parentPreview()}
          ${guardianInboxCard()}
          ${focusWindowCard()}
          ${realFriendsCard()}
          ${peerSection()}
        </div>
      </div>
    </div>`;
  }

  function mount(root) {
    if (App.sync.isSignedIn() && realFriends == null) loadRealFriends();
    if (App.sync.isSignedIn() && checkins == null) loadGuardianInbox();
    if (App.sync.isSignedIn() && focusWindows == null) loadFocusWindows();

    U.on(root, "click", "[data-checkin-respond]", (_e, el) => {
      App.sync.respondCheckin(el.dataset.checkinRespond).then(() => { UI.toast("Sent", "Your guardian will see you're okay.", "ok"); loadGuardianInbox(); });
    });

    U.on(root, "click", "[data-focus-agree]", (_e, el) => {
      App.sync.respondFocusWindow(el.dataset.focusAgree, "agree")
        .then(() => { UI.toast("Agreed", "The focus window is on.", "ok"); loadFocusWindows(); });
    });
    U.on(root, "click", "[data-focus-decline]", (_e, el) => {
      App.sync.respondFocusWindow(el.dataset.focusDecline, "decline")
        .then(() => { UI.toast("Declined", "", ""); loadFocusWindows(); });
    });
    U.on(root, "click", "[data-focus-end]", (_e, el) => {
      App.sync.endFocusWindow(el.dataset.focusEnd)
        .then(() => { UI.toast("Ended", "Focus window ended early.", "ok"); loadFocusWindows(); });
    });

    U.on(root, "click", "[data-add-real-friend]", realFriendForm);
    U.on(root, "click", "[data-friend-accept]", (_e, el) => {
      App.sync.respondFriend(el.dataset.friendAccept, true).then(() => { UI.toast("Friend added", "", "ok"); loadRealFriends(); });
    });
    U.on(root, "click", "[data-friend-decline]", (_e, el) => {
      App.sync.respondFriend(el.dataset.friendDecline, false).then(() => { UI.toast("Declined"); loadRealFriends(); });
    });
    U.on(root, "click", "[data-friend-remove]", (_e, el) => {
      App.sync.removeFriend(el.dataset.friendRemove).then(() => { UI.toast("Removed", "", "warn"); loadRealFriends(); });
    });

    U.on(root, "change", "[data-toggle]", (_e, el) => {
      const key = el.dataset.toggle;
      S.commit((db) => { db.settings[key] = el.checked; });
      if (key === "locationSharing" && el.checked) App.geo.maybePush(true);
      UI.toast(el.checked ? "Sharing enabled" : "Sharing disabled",
        U.titleCase(key.replace(/([A-Z])/g, " $1")));
    });

    const geoToggle = root.querySelector("#geoToggle");
    if (geoToggle) geoToggle.addEventListener("change", (e) => {
      if (e.target.checked) {
        busy = true;
        App.geo.enable()
          .then(() => UI.toast("Location on", "Got a fix — set your campus next.", "ok"))
          .catch((err) => UI.toast("Couldn't get your location", err.message, "danger"))
          .then(() => { busy = false; App.router.refresh(); });
      } else {
        App.geo.disable();
        UI.toast("Location off", "Status falls back to your timetable.");
      }
    });

    const watchToggle = root.querySelector("#watchToggle");
    if (watchToggle) watchToggle.addEventListener("change", (e) => {
      if (e.target.checked) App.geo.startWatch(); else App.geo.stopWatch();
      App.router.refresh();
    });

    const setCampus = root.querySelector("#setCampus");
    if (setCampus) setCampus.addEventListener("click", () => {
      setCampus.disabled = true;
      setCampus.textContent = "Getting a fix…";
      App.geo.setCampusHere()
        .then((fix) => UI.toast("Campus set", `±${Math.round(fix.accuracy)} m accurate`, "ok"))
        .catch((err) => UI.toast("Couldn't set campus", err.message, "danger"))
        .then(() => App.router.refresh());
    });

    const clearCampus = root.querySelector("#clearCampus");
    if (clearCampus) clearCampus.addEventListener("click", () => {
      S.commit((db) => { db.settings.geo.campusLat = null; db.settings.geo.campusLng = null; });
      UI.toast("Campus cleared");
    });

    const radius = root.querySelector("#radiusSel");
    if (radius) radius.addEventListener("change", (e) => {
      S.commit((db) => { db.settings.geo.radiusM = Number(e.target.value); });
    });

    const interval = root.querySelector("#intervalSel");
    if (interval) interval.addEventListener("change", (e) => {
      S.commit((db) => { db.settings.geo.shareIntervalS = Number(e.target.value); });
    });

    const addRoom = root.querySelector("#addRoom");
    if (addRoom) addRoom.addEventListener("click", () => {
      UI.prompt({
        title: "Name this place", label: "What is here?", placeholder: "Gym, Library, Main entrance",
        onSubmit(label) {
          App.geo.addRoomHere(label)
            .then(() => { UI.toast("Place saved", label, "ok"); App.router.refresh(); })
            .catch((err) => UI.toast("Couldn't save", err.message, "danger"));
        }
      });
    });

    U.on(root, "click", "[data-rm-room]", (_e, el) => {
      S.commit((db) => {
        db.settings.geo.rooms = db.settings.geo.rooms.filter((r) => r.id !== el.dataset.rmRoom);
      });
    });

    U.on(root, "click", "[data-add-peer]", peerForm);
    U.on(root, "click", "[data-rm-peer]", (_e, el) => {
      const p = S.byId("peers", el.dataset.rmPeer);
      UI.deleteWithUndo("peers", p.id, p.name);
    });

    // Repaint when a new GPS fix lands. Debounced — watchPosition can fire
    // every second on a moving device, and each repaint rebuilds this page.
    if (unsub) unsub();
    const repaint = U.debounce(() => {
      if (App.router.current === "sharing" && !document.querySelector(".modal-root")) {
        App.router.refresh();
      }
    }, 1500);
    unsub = App.geo.on(repaint);
  }

  function unmount() { if (unsub) { unsub(); unsub = null; } realFriends = null; checkins = null; guardianNotes = null; focusWindows = null; }

  return { render, mount, unmount, title: "Sharing" };
})();
