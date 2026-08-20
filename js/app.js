/* ==========================================================================
   app.js — router, navigation, command palette, keyboard shortcuts, boot
   ========================================================================== */

(function () {
  const U = App.utils, S = App.store, UI = App.ui;

  const NAV = [
    { group: "Overview", items: [
      { id: "dashboard", label: "Dashboard", icon: "◫" },
      { id: "calendar",  label: "Calendar",  icon: "▤" },
      { id: "schedule",  label: "Schedule",  icon: "◱" },
      { id: "planner",   label: "Planner",   icon: "◳",
        badge: () => App.planner.warnings(14).filter((w) => w.level === "high").length,
        alert: () => true }
    ]},
    { group: "Academics", items: [
      { id: "homework",  label: "Homework",  icon: "✎", badge: () => S.openAssignments().length,
        alert: () => S.overdue().length > 0 },
      { id: "classes",   label: "Classes",   icon: "▣" },
      { id: "grades",    label: "Grades",    icon: "◈",
        badge: () => S.missingWork().length, alert: () => true }
    ]},
    { group: "Study", items: [
      { id: "focus",      label: "Focus timer", icon: "◷" },
      { id: "flashcards", label: "Flashcards",  icon: "▢",
        badge: () => U.sum(S.db.decks, (d) => d.cards.filter((c) => !c.next || c.next <= U.today()).length) },
      { id: "notes",      label: "Notes",       icon: "✐" },
      { id: "reading",    label: "Reading",     icon: "▥",
        badge: () => S.db.reading.filter((r) => !r.done).length }
    ]},
    { group: "Life", items: [
      { id: "activities", label: "Activities", icon: "◇" },
      { id: "goals",      label: "Goals",      icon: "◎" },
      { id: "college",    label: "Applications", icon: "◉" },
      { id: "contacts",   label: "Contacts",   icon: "☎" }
    ]},
    { group: "Connect", items: [
      { id: "sharing",   label: "Sharing",   icon: "⇄" },
      { id: "groups",    label: "Study groups", icon: "◐" },
      { id: "parent",    label: "Parent portal", icon: "◧" }
    ]},
    { group: "More", items: [
      { id: "analytics", label: "Analytics", icon: "◨" },
      { id: "settings",  label: "Settings",  icon: "⚙" }
    ]}
  ];

  const FLAT = NAV.flatMap((g) => g.items);

  /* ------------------------------------------------------------ router -- */

  let current = null;

  const router = {
    go(id) {
      if (!App.views[id]) id = "dashboard";
      if (current && App.views[current] && App.views[current].unmount) {
        App.views[current].unmount();
      }
      current = id;
      S.db.ui.view = id;
      S.trackNavVisit(id);   // U02 — feeds the "float to top" ranking
      S.save();
      if (location.hash.slice(1) !== id) history.replaceState(null, "", "#" + id);
      paint();
      document.getElementById("page").scrollTop = 0;   // a real navigation does reset scroll
      closeSidebar();
    },
    refresh() { paint(); },
    get current() { return current; }
  };
  App.router = router;

  /**
   * Renders the active view into a FRESH container element.
   *
   * The container must be new each time: views attach delegated listeners to
   * whatever root they're handed, and a persistent node would accumulate one
   * set per render. Stale handlers from other views then fire first, re-render
   * the page, and detach the clicked node — so the correct handler's
   * `root.contains(target)` check fails and the click silently does nothing.
   * Throwing the node away drops its listeners with it.
   */
  function paint() {
    const view = App.views[current] || App.views.dashboard;
    const page = document.getElementById("page");
    const scrollTop = page.scrollTop;

    const root = document.createElement("div");
    root.className = "view-root";
    root.innerHTML = view.render();

    page.replaceChildren(root);

    // Cross-view shortcuts any page can emit — bound before the view's own
    // handlers so a view can still stopPropagation if it needs to override.
    U.on(root, "click", "[data-go]", (e, el) => {
      e.preventDefault();
      router.go(el.dataset.go);
    });
    U.on(root, "click", "[data-new-hw]", () => App.views.homework.form(null));
    U.on(root, "click", "[data-open-hw]", (_e, el) => App.views.homework.detail(el.dataset.openHw));
    U.on(root, "change", "[data-toggle-hw]", (e, el) => {
      e.stopPropagation();
      const a = S.byId("assignments", el.dataset.toggleHw);
      if (!a) return;
      S.update("assignments", a.id, { status: el.checked ? "done" : "todo" });
      if (el.checked) UI.toast("Done ✅", a.title, "ok");
    });

    if (view.mount) view.mount(root);

    renderNav();
    paintSyncBadge();
    document.title = `${view.title} · Scholar`;

    // A re-render triggered by a data change shouldn't jump the user to the top.
    page.scrollTop = scrollTop;
  }

  function navRow(it) {
    const n = it.badge ? it.badge() : 0;
    const pinned = S.isPinnedNav(it.id);
    return `<div class="nav-row">
      <button class="nav-item ${it.id === current ? "active" : ""}" data-view="${it.id}">
        <span class="ico">${it.icon}</span>
        <span class="grow truncate">${it.label}</span>
        ${n ? `<span class="count ${it.alert && it.alert() ? "alert" : ""}">${n}</span>` : ""}
      </button>
      <button class="pin-toggle ${pinned ? "on" : ""}" data-pin-nav="${it.id}"
              aria-label="${pinned ? "Unpin" : "Pin"} ${it.label}" data-tip="${pinned ? "Unpin" : "Pin to top"}">★</button>
    </div>`;
  }

  // U02 — the screens you actually use float to the top of the sidebar:
  // explicitly pinned ones first, auto-filled with your most-visited the
  // rest of the way to three, so it works even before you've pinned anything.
  function renderNav() {
    const host = document.getElementById("navScroll");
    const pin = S.effectivePinnedNav(null, 3);
    const pinnedSet = new Set(pin.ids);

    let html = "";
    if (pin.ids.length) {
      html += `<div class="nav-group pinned-group">
        <div class="nav-label">Pinned</div>
        ${pin.ids.map((id) => FLAT.find((x) => x.id === id)).filter(Boolean).map(navRow).join("")}
      </div>`;
    }

    html += NAV.map((g) => {
      const items = g.items.filter((it) => !pinnedSet.has(it.id));
      if (!items.length) return "";
      return `<div class="nav-group">
        <div class="nav-label">${g.group}</div>
        ${items.map(navRow).join("")}
      </div>`;
    }).join("");

    host.innerHTML = html;
  }

  /* ------------------------------------------------------------- theme -- */

  App.applyTheme = function () {
    const dark = S.settings.theme === "dark";
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    const btn = document.getElementById("themeBtn");
    if (btn) btn.textContent = dark ? "☀" : "☾";
    // Charts read entity colors per theme, so repaint the current view.
    if (current) paint();
  };

  function toggleTheme() {
    S.commit((db) => { db.settings.theme = db.settings.theme === "dark" ? "light" : "dark"; });
    App.applyTheme();
  }

  /* -------------------------------------------- U01/U09/U10 shell prefs -- */

  App.applyShellPrefs = function () {
    const html = document.documentElement;
    html.setAttribute("data-sidebar", S.settings.sidebarCollapsed ? "collapsed" : "expanded");
    html.setAttribute("data-density", S.settings.density === "compact" ? "compact" : "comfortable");
    if (S.settings.accent && S.settings.accent !== "indigo") html.setAttribute("data-accent", S.settings.accent);
    else html.removeAttribute("data-accent");
    html.setAttribute("data-cvd", S.settings.cvdPreview || "none");
    const ico = document.getElementById("collapseIco");
    if (ico) ico.textContent = S.settings.sidebarCollapsed ? "⇥" : "⇤";
  };

  function toggleSidebar() {
    S.commit((db) => { db.settings.sidebarCollapsed = !db.settings.sidebarCollapsed; });
    App.applyShellPrefs();
  }

  /* ------------------------------------------------- U26 notifications -- */

  function openNotifPanel() {
    const rows = S.recentNotifications(25);
    UI.modal({
      title: "Recent notifications",
      size: "narrow",
      footer: `<button type="button" class="btn btn-primary" data-close>Close</button>`,
      body: rows.length
        ? `<div class="list">${rows.map((n) => `<div class="list-item" style="padding:9px 2px">
            <span class="grow"><div class="title">${U.esc(n.title)}</div>
              ${n.msg ? `<div class="meta">${U.esc(n.msg)}</div>` : ""}</span>
            <span class="tiny dim nowrap">${U.esc(new Date(n.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}</span>
          </div>`).join("")}</div>`
        : `<p class="dim small center" style="padding:20px">Nothing yet — toasts you see land here.</p>`
    });
  }

  /* --------------------------------------------------- U45 shortcuts help */

  function openShortcutHelp() {
    const rows = [
      ["⌘K / Ctrl+K", "Command palette"], ["G then D", "Dashboard"], ["G then H", "Homework"],
      ["G then C", "Calendar"], ["G then P", "Planner"], ["G then G", "Grades"],
      ["G then F", "Focus timer"], ["G then N", "Notes"], ["N", "New assignment"],
      ["T", "Toggle dark mode"], ["Space", "Flip a flashcard"], ["1–4", "Answer a quiz question"],
      ["?", "This shortcut list"], ["Esc", "Close a dialog"]
    ];
    UI.modal({
      title: "Keyboard shortcuts",
      size: "narrow",
      footer: `<button type="button" class="btn btn-primary" data-close>Close</button>`,
      body: `<div class="col gap-4">${rows.map(([k, d]) => `
        <div class="between" style="padding:5px 0"><span class="small muted">${U.esc(d)}</span><span class="kbd">${U.esc(k)}</span></div>`).join("")}</div>`
    });
  }

  /* -------------------------------------------------- command palette -- */

  let palette = null;

  function commands() {
    const out = [];

    FLAT.forEach((it) => out.push({
      group: "Go to", label: it.label, icon: it.icon,
      run: () => router.go(it.id)
    }));

    out.push(
      { group: "Create", label: "New assignment", icon: "✎", sub: "N", run: () => App.views.homework.form(null) },
      { group: "Create", label: "New event", icon: "▤", run: () => App.views.calendar.eventForm(null) },
      { group: "Create", label: "New class", icon: "▣", run: () => App.views.classes.classForm(null) },
      { group: "Create", label: "New note", icon: "✐", run: () => { router.go("notes"); setTimeout(() => document.querySelector("[data-new]").click(), 60); } },
      { group: "Create", label: "New book / reading", icon: "▥", run: () => { router.go("reading"); setTimeout(() => { const b = document.querySelector("[data-add]"); if (b) b.click(); }, 60); } },
      { group: "Create", label: "New college application", icon: "◉", run: () => { router.go("college"); setTimeout(() => { const b = document.querySelector("[data-add]"); if (b) b.click(); }, 60); } },
      { group: "Actions", label: "Toggle dark mode", icon: "☾", sub: "T", run: toggleTheme },
      { group: "Actions", label: "Export backup", icon: "⬇", run: () => {
          U.download(`scholar-backup-${U.today()}.json`, S.exportJSON());
          UI.toast("Backup downloaded", "", "ok");
        }},
      { group: "Actions", label: "Export calendar (.ics)", icon: "📅", run: () => {
          App.ics.download();
          UI.toast("Calendar exported", "", "ok");
        }},
      { group: "Actions", label: "Import from Canvas / Classroom", icon: "⬆", run: () => router.go("settings") },
      { group: "Actions", label: "Rebuild study plan", icon: "◳", run: () => router.go("planner") },
      { group: "Actions", label: "Start a focus block", icon: "◷", run: () => router.go("focus") }
    );

    // Jump straight to any assignment, class, or note.
    S.openAssignments().slice(0, 40).forEach((a) => out.push({
      group: "Assignments", label: a.title, icon: "○",
      sub: `${S.className(a.classId)} · ${U.relDate(a.due)}`,
      run: () => App.views.homework.detail(a.id)
    }));
    S.db.classes.forEach((c) => out.push({
      group: "Classes", label: c.name, icon: "▣", sub: c.code || "",
      run: () => App.views.classes.detail(c.id)
    }));
    S.db.notes.forEach((n) => out.push({
      group: "Notes", label: n.title, icon: "✐", sub: S.className(n.classId),
      body: n.body,   // F081 — search full note text, not just the title
      run: () => { router.go("notes"); setTimeout(() => App.views.notes.reader && App.views.notes.reader(n.id), 60); }
    }));
    S.db.teachers.forEach((t) => out.push({
      group: "Contacts", label: t.name, icon: "☎", sub: t.subject || "",
      body: t.email || "",
      run: () => { router.go("contacts"); }
    }));
    // F081 — events and flashcard decks, previously invisible to the palette.
    S.db.events.slice(0, 60).forEach((e) => out.push({
      group: "Events", label: e.title, icon: "▤", sub: `${U.esc(e.location || "")} · ${U.relDate(e.date)}`,
      run: () => router.go("calendar")
    }));
    S.db.decks.forEach((d) => out.push({
      group: "Flashcards", label: d.name, icon: "🃏", sub: `${U.plural(d.cards.length, "card")}`,
      run: () => router.go("flashcards")
    }));

    return out;
  }

  function openPalette() {
    if (palette) return;
    const all = commands();

    const root = document.createElement("div");
    root.className = "palette-root";
    root.innerHTML = `<div class="palette">
      <input type="text" placeholder="Search or jump to…" aria-label="Command palette" />
      <div class="palette-list"></div>
    </div>`;
    document.body.appendChild(root);
    palette = root;

    const input = root.querySelector("input");
    const list = root.querySelector(".palette-list");
    let matches = [], sel = 0;

    function score(cmd, q) {
      const l = cmd.label.toLowerCase();
      if (!q) return 1;
      if (l.startsWith(q)) return 3;
      if (l.includes(q)) return 2;
      if ((cmd.sub || "").toLowerCase().includes(q)) return 1;
      if ((cmd.body || "").toLowerCase().includes(q)) return 1;   // F081 — full-text, not just titles
      return 0;
    }

    function draw() {
      const q = input.value.trim().toLowerCase();
      matches = all
        .map((c) => ({ c, s: score(c, q) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 40)
        .map((x) => x.c);

      sel = 0;
      if (!matches.length) {
        list.innerHTML = `<p class="dim small center" style="padding:22px">No matches</p>`;
        return;
      }
      let html = "", lastGroup = null;
      matches.forEach((m, i) => {
        if (m.group !== lastGroup) {
          html += `<div class="palette-group">${U.esc(m.group)}</div>`;
          lastGroup = m.group;
        }
        html += `<button class="palette-item ${i === 0 ? "sel" : ""}" data-i="${i}">
          <span class="ico">${m.icon || "•"}</span>
          <span class="truncate">${U.esc(m.label)}</span>
          ${m.sub ? `<span class="sub truncate">${U.esc(m.sub)}</span>` : ""}
        </button>`;
      });
      list.innerHTML = html;
    }

    function move(delta) {
      if (!matches.length) return;
      sel = U.clamp(sel + delta, 0, matches.length - 1);
      U.$$(".palette-item", list).forEach((el, i) => el.classList.toggle("sel", i === sel));
      const el = list.querySelector(".palette-item.sel");
      if (el) el.scrollIntoView({ block: "nearest" });
    }

    function run(i) {
      const cmd = matches[i];
      closePalette();
      if (cmd) setTimeout(() => cmd.run(), 10);
    }

    input.addEventListener("input", draw);
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") { e.preventDefault(); run(sel); }
      else if (e.key === "Escape") { e.preventDefault(); closePalette(); }
    });
    root.addEventListener("click", (e) => {
      if (e.target === root) return closePalette();
      const item = e.target.closest("[data-i]");
      if (item) run(Number(item.dataset.i));
    });

    draw();
    input.focus();
  }

  function closePalette() {
    if (palette) { palette.remove(); palette = null; }
  }

  /* --------------------------------------------------------- shortcuts -- */

  let chord = null;   // "g" prefix for go-to shortcuts

  function onKeydown(e) {
    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      palette ? closePalette() : openPalette();
      return;
    }

    // Let views claim keys first (flashcard study mode uses Space / 1 / 2).
    const view = App.views[current];
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (!typing && view && view.onKey && view.onKey(e)) { e.preventDefault(); return; }

    if (typing || palette || document.querySelector(".modal-root")) return;

    const k = e.key.toLowerCase();

    if (chord === "g") {
      chord = null;
      const map = { d: "dashboard", h: "homework", c: "calendar", g: "grades",
                    s: "schedule", f: "focus", n: "notes", a: "analytics", t: "settings",
                    p: "planner", r: "reading", u: "college", l: "flashcards" };
      if (map[k]) { e.preventDefault(); router.go(map[k]); }
      return;
    }

    if (k === "g") { chord = "g"; setTimeout(() => { chord = null; }, 1200); return; }
    if (k === "n") { e.preventDefault(); App.views.homework.form(null); return; }
    if (k === "t") { e.preventDefault(); toggleTheme(); return; }
    if (k === "?") { e.preventDefault(); openShortcutHelp(); return; }
  }

  /* ------------------------------------------------------ usage timer -- */

  // Tracks foreground time so the parent view has a real number to show.
  let lastTick = Date.now();

  function flushUsage() {
    const now = Date.now();
    const mins = (now - lastTick) / 60000;
    lastTick = now;
    if (mins > 0 && mins < 120) {          // ignore absurd gaps (sleep/suspend)
      S.addUsage(mins);
      S.save();
    }
  }

  /* ---------------------------------------------------------- sidebar -- */

  function openSidebar() {
    document.querySelector(".sidebar").classList.add("open");
    document.getElementById("scrim").classList.add("show");
  }
  function closeSidebar() {
    document.querySelector(".sidebar").classList.remove("open");
    document.getElementById("scrim").classList.remove("show");
  }

  /* --------------------------------------------------------------- boot */

  /* ---------------------------------------------------- service worker -- */

  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    // file:// has no origin a service worker can claim.
    if (location.protocol === "file:") return;

    navigator.serviceWorker.register("./sw.js").then((reg) => {
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) {
            UI.toast("Update available", "Reload to get the newest version.", "", {
              label: "Reload",
              onClick() { sw.postMessage("skipWaiting"); location.reload(); }
            });
          }
        });
      });
    }).catch((e) => console.info("[scholar] service worker not registered:", e.message));
  }

  /* --------------------------------------------------------- sync badge -- */

  function paintSyncBadge() {
    const btn = document.getElementById("syncBtn");
    if (!btn) return;
    const s = App.sync.info();
    const map = {
      idle: ["✓", "Synced"], syncing: ["⟳", "Syncing…"],
      error: ["!", "Offline — changes saved locally"],
      conflict: ["!", "Sync conflict"], offline: ["○", "Local only — not signed in"]
    };
    const [icon, tip] = map[s.status] || ["○", "Local only"];
    btn.textContent = icon;
    btn.dataset.tip = tip;
    btn.classList.toggle("spin", s.status === "syncing");
    btn.style.color = s.status === "error" || s.status === "conflict" ? "var(--warn)"
      : s.status === "idle" ? "var(--ok)" : "";
  }

  function boot() {
    App.applyTheme();
    App.applyShellPrefs();
    S.touchStreak();
    S.runTemplates(28);
    S.autoArchive();

    // Nav
    U.on(document.getElementById("navScroll"), "click", "[data-view]", (_e, el) => router.go(el.dataset.view));
    U.on(document.getElementById("navScroll"), "click", "[data-pin-nav]", (e, el) => {
      e.stopPropagation();
      S.togglePinnedNav(el.dataset.pinNav);
      renderNav();
    });
    document.getElementById("themeBtn").addEventListener("click", toggleTheme);
    document.getElementById("sidebarCollapseBtn").addEventListener("click", toggleSidebar);
    document.getElementById("notifBtn").addEventListener("click", openNotifPanel);
    document.getElementById("searchBtn").addEventListener("click", openPalette);
    document.getElementById("addBtn").addEventListener("click", () => App.views.homework.form(null));
    document.getElementById("hamburger").addEventListener("click", openSidebar);
    document.getElementById("scrim").addEventListener("click", closeSidebar);
    document.getElementById("profileChip").addEventListener("click", () => router.go("settings"));
    document.getElementById("syncBtn").addEventListener("click", () => {
      if (App.sync.isSignedIn()) App.sync.push(false).then(() => UI.toast("Synced", "", "ok"));
      else router.go("settings");
    });

    // Subsystems that need the DOM and the store ready.
    registerSW();
    App.sync.init();
    App.geo.init();
    App.notify.start();
    App.sync.on(paintSyncBadge);
    paintSyncBadge();

    document.addEventListener("keydown", onKeydown);
    window.addEventListener("hashchange", () => {
      const id = location.hash.slice(1);
      if (id && id !== current) router.go(id);
    });

    // Any store change repaints the current view + nav badges.
    S.subscribe(() => paint());

    // Usage accounting
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) flushUsage();
      else lastTick = Date.now();
    });
    window.addEventListener("beforeunload", flushUsage);
    setInterval(() => { if (!document.hidden) flushUsage(); }, 60000);

    // Refresh time-sensitive views (live status, countdowns) every minute.
    setInterval(() => {
      if (!document.hidden && ["dashboard", "schedule", "sharing"].includes(current)
          && !document.querySelector(".modal-root") && !palette) {
        paint();
      }
    }, 60000);

    // Materialize recurring assignments once a day.
    setInterval(() => S.runTemplates(28), 6 * 60 * 60 * 1000);

    const start = location.hash.slice(1) || S.db.ui.view || "dashboard";
    router.go(App.views[start] ? start : "dashboard");

    // F064 — a group invite link (?join=CODE) drops you straight into the
    // join flow instead of making you type the code by hand.
    const joinCode = new URL(location.href).searchParams.get("join");
    if (joinCode) {
      history.replaceState(null, "", location.pathname + location.hash);
      setTimeout(() => {
        router.go("groups");
        setTimeout(() => App.views.groups.joinForm && App.views.groups.joinForm(joinCode), 80);
      }, 60);
    }

    // Profile chip
    const p = S.profile;
    document.getElementById("profileChip").innerHTML = `
      ${UI.avatar(p.name, p.color)}
      <span class="grow truncate" style="min-width:0">
        <div class="small bold truncate">${U.esc(p.name)}</div>
        <div class="tiny dim truncate">${U.esc(p.grade || "")}</div>
      </span>
      <span class="dim">⚙</span>`;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
