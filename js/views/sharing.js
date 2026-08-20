/* ==========================================================================
   views/sharing.js — what parents see, and opt-in peer schedule matching

   Honest scope: this is a client-side app with no server, so nothing is
   actually transmitted anywhere. This screen is a preview of what WOULD be
   shared under your current privacy settings, plus the real browser
   Geolocation API for the location check.
   ========================================================================== */

App.views.sharing = (function () {
  const U = App.utils, S = App.store, UI = App.ui, C = App.charts;

  let geo = { state: "idle", text: "" };   // idle | asking | ok | denied | unsupported

  function askLocation() {
    if (!navigator.geolocation) {
      geo = { state: "unsupported", text: "This browser doesn't support geolocation." };
      App.router.refresh();
      return;
    }
    geo = { state: "asking", text: "Waiting for permission…" };
    App.router.refresh();

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        geo = {
          state: "ok",
          text: `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)} (±${Math.round(pos.coords.accuracy)}m)`
        };
        App.router.refresh();
      },
      (err) => {
        geo = {
          state: "denied",
          text: err.code === 1 ? "Permission denied — status falls back to your schedule."
                               : "Couldn't get a fix — status falls back to your schedule."
        };
        App.router.refresh();
      },
      { timeout: 8000, maximumAge: 60000 }
    );
  }

  /* ------------------------------------------------------- parent view -- */

  function parentPreview() {
    const live = S.liveStatus();
    const share = S.settings.locationSharing;
    const usage = last7Usage();
    const totalWeek = U.sum(usage, (u) => u.value);
    const due = S.dueSoon(7).slice(0, 5);
    const att = S.attendanceRate();

    return `<div class="card">
      <div class="card-head">
        <div><h3>What ${U.esc(S.profile.parentName || "your parent")} sees</h3>
          <div class="sub">Live preview of your shared profile</div></div>
        <span class="badge ${share ? "ok" : ""}">${share ? "Sharing on" : "Sharing off"}</span>
      </div>
      <div class="card-body col gap-16">

        ${share ? `
          <div class="hero" style="padding:18px 20px">
            <div class="between wrap gap-12">
              <div>
                <div class="hero-eyebrow row gap-6">
                  ${live.current ? `<i class="live-dot"></i>` : ""} Right now
                </div>
                <div style="font-size:1.25rem;font-weight:700;margin-top:4px">
                  ${U.esc(live.current ? live.current.title : live.next ? "Free period" : "Not in class")}
                </div>
                <div class="hero-sub">
                  ${live.current
                    ? U.esc(`${live.current.location || ""} · ${U.fmtDur(live.remaining)} left`)
                    : live.next ? U.esc(`${live.next.title} at ${U.fmtTime(live.next.start)}`)
                    : "Outside school hours"}
                </div>
              </div>
              <div class="center">
                <div style="font-size:1.4rem;font-weight:720">${U.fmtDur(totalWeek)}</div>
                <div class="tiny" style="opacity:.85">App use this week</div>
              </div>
            </div>
          </div>
        ` : `<div class="card" style="background:var(--surface-2)"><div class="card-body">
            <p class="small muted">Location sharing is off, so no live status is shared.
            ${U.esc(S.profile.parentName || "Your parent")} would only see what you choose below.</p>
          </div></div>`}

        <div>
          <h4 class="mb-8">App usage — last 7 days</h4>
          ${C.bars(usage, { h: 150, fmt: (v) => U.fmtDur(v) })}
          <p class="tiny dim mt-8">Measured while this tab is in the foreground.</p>
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
              <div class="list-item"><span class="grow small">Attendance (3 wks)</span>
                <span class="bold">${U.round(att.rate, 1)}%</span></div>
              <div class="list-item"><span class="grow small">Study this week</span>
                <span class="bold">${U.fmtDur(S.studyThisWeek())}</span></div>
              <div class="list-item"><span class="grow small">Open assignments</span>
                <span class="bold">${S.openAssignments().length}</span></div>
              <div class="list-item"><span class="grow small">Overall GPA</span>
                <span class="bold">${S.settings.shareGrades ? U.round(S.gpa(), 2) : "Hidden"}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }

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

  /* --------------------------------------------------------- peer view -- */

  function peerSection() {
    const on = S.settings.peerSharing;
    const peers = S.db.peers;

    if (!on) {
      return `<div class="card"><div class="card-head"><h3>Classmates</h3></div>
        <div class="card-body">
          <p class="small muted">Peer sharing is off. Turn it on to see which classes you share with
          friends who are also sharing, and when you're both free.</p>
        </div></div>`;
    }

    const sharing = peers.filter((p) => p.sharing);
    const mine = new Set(S.db.classes.map((c) => c.id));

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
          const dow = U.dowName(U.today());
          const now = U.nowMin();
          for (const id of p.classIds) {
            const c = S.cls(id);
            if (!c || !c.days.includes(dow)) continue;
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
        </div>`;
      }).join("")}</div>`
      : UI.emptyState("👋", "No classmates yet", "Add friends to compare schedules.")}
      <div class="card-foot">
        <button class="btn btn-sm" data-add-peer>+ Add a classmate</button>
      </div>
    </div>`;
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
            ${S.db.classes.map((c) => `<button type="button" class="chip" data-cid="${c.id}">${U.esc(c.name)}</button>`).join("")}
          </div>
        </div>
        <p class="hint mt-8">In a real deployment this would send a request the other student has to accept.
        Here it's stored locally so you can see how matching works.</p>`,
      onMount(root) {
        root.querySelector("#peerCls").addEventListener("click", (e) => {
          const b = e.target.closest("[data-cid]");
          if (b) b.classList.toggle("active");
        });
      },
      onSubmit(d, root) {
        if (!d.name.trim()) return false;
        const classIds = U.$$("#peerCls .chip.active", root).map((b) => b.dataset.cid);
        const i = S.db.peers.length % S.PALETTE.length;
        S.insert("peers", { name: d.name.trim(), color: S.PALETTE[i], sharing: true, classIds });
        UI.toast("Classmate added", d.name, "ok");
      }
    });
  }

  /* ------------------------------------------------------------ render -- */

  function toggleRow(key, title, desc) {
    const on = S.settings[key];
    return `<div class="between" style="padding:12px 0;border-bottom:1px solid var(--border)">
      <div style="min-width:0;padding-right:12px">
        <div class="bold small">${U.esc(title)}</div>
        <div class="tiny dim">${U.esc(desc)}</div>
      </div>
      <label class="switch">
        <input type="checkbox" data-toggle="${key}" ${on ? "checked" : ""} />
        <span class="track"></span>
      </label>
    </div>`;
  }

  function render() {
    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>Sharing &amp; privacy</h1>
          <div class="sub">You control exactly what parents and classmates can see</div>
        </div>
      </div>

      <div class="card mb-16" style="border-left:3px solid var(--info)">
        <div class="card-body">
          <div class="row-top gap-10">
            <span style="font-size:1.1rem">ℹ️</span>
            <div>
              <div class="bold small">Nothing leaves this device</div>
              <p class="small muted mt-4">
                This app runs entirely in your browser with no server or account, so no data is
                transmitted anywhere. The panels below preview what a parent or classmate
                <em>would</em> see with these settings — real cross-device sharing would need a
                backend, which this build deliberately doesn't have.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div class="grid g-side">
        <div class="col gap-16">
          <div class="card">
            <div class="card-head"><h3>Privacy controls</h3></div>
            <div class="card-body" style="padding-top:4px">
              ${toggleRow("locationSharing", "Live class status",
                "Let your parent see which class you're in and when it ends")}
              ${toggleRow("peerSharing", "Peer schedule matching",
                "Let opted-in classmates see your class list and free periods")}
              ${toggleRow("shareGrades", "Share grades",
                "Include your GPA and class averages in the parent view")}
              <div style="padding-top:12px">
                <div class="bold small mb-4">Location check</div>
                <p class="tiny dim mb-8">
                  Status is normally derived from your timetable. Optionally confirm with GPS.
                </p>
                <button class="btn btn-sm" data-geo>📍 Check my location</button>
                ${geo.state !== "idle" ? `<div class="tiny mt-8 ${geo.state === "ok" ? "" : "dim"}"
                  style="${geo.state === "ok" ? "color:var(--ok)" : ""}">
                  ${geo.state === "ok" ? "✓ " : ""}${U.esc(geo.text)}</div>` : ""}
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h3>Guardian</h3></div>
            <div class="card-body">
              <div class="row gap-12">
                ${UI.avatar(S.profile.parentName || "Parent", "#64748b", "lg")}
                <div style="min-width:0">
                  <div class="bold small">${U.esc(S.profile.parentName || "Not set")}</div>
                  <div class="tiny dim truncate">${U.esc(S.profile.parentEmail || "No email set")}</div>
                </div>
              </div>
              <button class="btn btn-sm btn-block mt-12" data-go="settings">Edit in settings</button>
            </div>
          </div>
        </div>

        <div class="col gap-16">
          ${parentPreview()}
          ${peerSection()}
        </div>
      </div>
    </div>`;
  }

  function mount(root) {
    U.on(root, "change", "[data-toggle]", (_e, el) => {
      const key = el.dataset.toggle;
      S.commit((db) => { db.settings[key] = el.checked; });
      UI.toast(el.checked ? "Sharing enabled" : "Sharing disabled", U.titleCase(key.replace(/([A-Z])/g, " $1")));
    });
    U.on(root, "click", "[data-geo]", askLocation);
    U.on(root, "click", "[data-add-peer]", peerForm);
  }

  return { render, mount, title: "Sharing" };
})();
