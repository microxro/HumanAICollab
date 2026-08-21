/* ==========================================================================
   app.js — router, navigation, command palette, keyboard shortcuts, boot
   ========================================================================== */

(function () {
  const U = App.utils, S = App.store, UI = App.ui;

  const NAV = [
    { group: "Overview", items: [
      { id: "dashboard",  label: "Dashboard",  icon: "◫" },
      { id: "assistant",  label: "Assistant",  icon: "✦" },
      { id: "calendar",   label: "Calendar",   icon: "▤" },
      { id: "schedule",   label: "Schedule",   icon: "◱" },
      { id: "planner",    label: "Planner",    icon: "◳",
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

  // U05 — the five screens reachable with a thumb on mobile, no drawer needed.
  const MOBILE_TABS = [
    { id: "dashboard", label: "Home", icon: "◫" },
    { id: "homework",  label: "Homework", icon: "✎",
      badge: () => S.openAssignments().length, alert: () => S.overdue().length > 0 },
    { id: "calendar",  label: "Calendar", icon: "▤" },
    { id: "grades",    label: "Grades", icon: "◈" },
    { id: "more",      label: "More", icon: "☰", more: true }
  ];

  /* ------------------------------------------------------------ router -- */

  let current = null;

  // U08 — deep links to one record. #view opens the screen; #view/recordId
  // opens that screen and then the record's detail, so a shared link opens
  // the right thing instead of dropping someone at the top of a list.
  const RECORD_OPENERS = {
    homework: (id) => App.views.homework.detail(id),
    classes: (id) => App.views.classes.detail(id),
    notes: (id) => App.views.notes.reader(id),
    contacts: (id) => App.views.contacts.detail(id)
  };

  const router = {
    go(idOrPath, subId) {
      let id = idOrPath, sub = subId;
      if (id && id.includes("/")) { const parts = id.split("/"); id = parts[0]; sub = parts.slice(1).join("/"); }
      if (!App.views[id]) id = "dashboard";
      if (current && App.views[current] && App.views[current].unmount) {
        App.views[current].unmount();
      }
      current = id;
      S.db.ui.view = id;
      S.trackNavVisit(id);   // U02 — feeds the "float to top" ranking
      S.save();
      const hashPath = id + (sub ? "/" + sub : "");
      if (location.hash.slice(1) !== hashPath) history.replaceState(null, "", "#" + hashPath);
      paint();
      document.getElementById("page").scrollTop = 0;   // a real navigation does reset scroll
      closeSidebar();
      if (sub && RECORD_OPENERS[id]) setTimeout(() => RECORD_OPENERS[id](sub), 60);
    },
    refresh() { paint(); },
    get current() { return current; },
    // U08 — build (and copy) a shareable link to one record.
    deepLink(view, id) { return `${location.origin}${location.pathname}#${view}/${id}`; },
    copyDeepLink(view, id) {
      const url = router.deepLink(view, id);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => UI.toast("Link copied", url, "ok")).catch(() => UI.toast("Link", url));
      } else UI.toast("Link", url);
    }
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
    paintTodayStrip();
    paintMobileTabbar();
    document.title = `${view.title} · Scholar`;

    // A re-render triggered by a data change shouldn't jump the user to the top.
    page.scrollTop = scrollTop;
  }

  function navRow(it) {
    const n = it.badge ? it.badge() : 0;
    const pinned = S.isPinnedNav(it.id);
    const label = App.i18n.t(it.id, it.label);   // F099 — localized nav labels
    return `<div class="nav-row">
      <button class="nav-item ${it.id === current ? "active" : ""}" data-view="${it.id}">
        <span class="ico">${it.icon}</span>
        <span class="grow truncate">${U.esc(label)}</span>
        ${n ? `<span class="count ${it.alert && it.alert() ? "alert" : ""}">${n}</span>` : ""}
      </button>
      <button class="pin-toggle ${pinned ? "on" : ""}" data-pin-nav="${it.id}"
              aria-label="${pinned ? "Unpin" : "Pin"} ${U.esc(label)}" data-tip="${pinned ? "Unpin" : "Pin to top"}">★</button>
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

    const collapsedGroups = new Set(S.settings.collapsedNavGroups || []);
    html += NAV.map((g) => {
      const items = g.items.filter((it) => !pinnedSet.has(it.id));
      if (!items.length) return "";
      const collapsed = collapsedGroups.has(g.group);
      return `<div class="nav-group ${collapsed ? "collapsed" : ""}">
        <button type="button" class="nav-label nav-label-btn" data-toggle-group="${U.esc(g.group)}">
          <span class="grow">${g.group}</span><span class="chev">${collapsed ? "›" : "⌄"}</span>
        </button>
        ${collapsed ? "" : items.map(navRow).join("")}
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
    // Always stamped, indigo included — leaving it off for the default made
    // [data-accent="indigo"] rules silently dead and the "is an accent even
    // applied?" question un-answerable from the DOM.
    html.setAttribute("data-accent", S.settings.accent || "indigo");
    html.setAttribute("data-cvd", S.settings.cvdPreview || "none");
    // U11 type size + dyslexia-friendly face, U13 true-black OLED theme.
    html.setAttribute("data-fontsize", S.settings.fontSize || "normal");
    if (S.settings.dyslexicFont) html.setAttribute("data-dyslexic", "1"); else html.removeAttribute("data-dyslexic");
    if (S.settings.trueBlack) html.setAttribute("data-trueblack", "1"); else html.removeAttribute("data-trueblack");
    if (S.settings.highContrast) html.setAttribute("data-contrast", "high"); else html.removeAttribute("data-contrast"); // U12
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

    // U03 — recently visited screens, so hopping between two of them doesn't
    // mean scanning the whole "Go to" list every time.
    S.recentViews(current).forEach((id) => {
      const it = FLAT.find((x) => x.id === id);
      if (it) out.push({ group: "Recent", label: App.i18n.t(it.id, it.label), icon: it.icon, run: () => router.go(it.id) });
    });

    FLAT.forEach((it) => out.push({
      group: "Go to", label: App.i18n.t(it.id, it.label), icon: it.icon,
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

  /* ------------------------------------------------- U37 today strip ---- */
  // Next class and time remaining, visible from every screen — not just
  // the dashboard hero, which you might not be looking at right now.

  function paintTodayStrip() {
    const el = document.getElementById("todayStrip");
    if (!el) return;
    const live = S.liveStatus();
    if (live.current) {
      el.innerHTML = `<i class="live-dot" style="width:6px;height:6px"></i>
        <span class="truncate">${U.esc(live.current.title)}</span>
        <span class="dim">· ${U.esc(U.fmtDur(live.remaining))} left</span>`;
      el.hidden = false;
    } else if (live.next) {
      el.innerHTML = `<span class="truncate">${U.esc(live.next.title)}</span>
        <span class="dim">in ${U.esc(U.fmtDur(live.untilNext))}</span>`;
      el.hidden = false;
    } else {
      el.innerHTML = "";
      el.hidden = true;
    }
  }

  /* ------------------------------------------------- U05 mobile tabbar -- */
  // A CSS-hidden no-op on desktop; on narrow screens it's the primary way
  // to move between the five most-used screens without opening the drawer.

  function paintMobileTabbar() {
    const host = document.getElementById("mobileTabbar");
    if (!host) return;
    host.innerHTML = MOBILE_TABS.map((t) => {
      if (t.more) {
        return `<button type="button" class="tab-item" data-tabbar-more aria-label="More">
          <span class="ico">${t.icon}</span><span class="lbl">${t.label}</span>
        </button>`;
      }
      const n = t.badge ? t.badge() : 0;
      return `<button type="button" class="tab-item ${t.id === current ? "active" : ""}" data-view="${t.id}">
        <span class="ico">${t.icon}</span><span class="lbl">${t.label}</span>
        ${n ? `<span class="tab-dot ${t.alert && t.alert() ? "alert" : ""}"></span>` : ""}
      </button>`;
    }).join("");
  }

  /* --------------------------------------------------- U49 first-run setup -- */
  // Walks a new student through the three things that make the rest of the
  // app useful — one class, the bell schedule, one assignment — instead of
  // dropping them on a dashboard full of someone else's demo data. Each
  // step reuses the real form (classForm, periodsEditor, homework.form),
  // just chained by an onDone callback rather than built from scratch.

  function runOnboarding() {
    UI.modal({
      title: "Welcome to Scholar",
      sub: "Let's set up your classes, bell schedule, and first assignment — about a minute.",
      footer: `<button type="button" class="btn" data-skip>Skip for now</button>
               <button type="button" class="btn btn-primary" data-next>Get started →</button>`,
      body: `<div class="center" style="padding:16px 0">
        <div style="font-size:2.6rem;margin-bottom:10px">🎓</div>
        <p class="muted">You can stop at any step — Settings has a link to pick this back up.</p>
      </div>`,
      onMount(root) {
        root.querySelector("[data-skip]").addEventListener("click", () => { UI.closeModal(); finishOnboarding(); });
        root.querySelector("[data-next]").addEventListener("click", () => {
          UI.closeModal();
          setTimeout(() => App.views.classes.classForm(null, onboardStep2), 60);
        });
      }
    });
  }
  function onboardStep2() {
    UI.toast("Nice, one class added", "Next: your bell schedule.", "ok");
    setTimeout(() => App.views.classes.periodsEditor(onboardStep3), 300);
  }
  function onboardStep3() {
    UI.toast("Bell schedule set", "Last step: add your first assignment.", "ok");
    setTimeout(() => App.views.homework.form(null, finishOnboarding), 300);
  }
  function finishOnboarding() {
    S.commit((db) => { db.settings.onboarded = true; });
    UI.toast("You're set up 🎉", "Explore the dashboard whenever you're ready.", "ok");
    router.go("dashboard");
  }
  App.runOnboarding = runOnboarding;

  /* ------------------------------------------------- U27 pull to refresh -- */
  // Touch-only: the expected gesture for re-syncing on a phone. Only arms
  // when the page is already scrolled to the top, so it never fights a
  // normal downward scroll partway down a list.

  function initPullToRefresh() {
    const page = document.getElementById("page");
    const ind = document.getElementById("ptrIndicator");
    if (!page || !ind) return;
    const THRESHOLD = 64;
    let startY = 0, pulling = false, busy = false;

    page.addEventListener("touchstart", (e) => {
      if (busy || page.scrollTop > 0) { pulling = false; return; }
      startY = e.touches[0].clientY;
      pulling = true;
    }, { passive: true });

    page.addEventListener("touchmove", (e) => {
      if (!pulling || busy) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0) { ind.style.transform = ""; ind.classList.remove("armed"); return; }
      const dist = Math.min(dy * 0.5, 90);
      ind.style.transform = `translateY(${dist}px)`;
      ind.classList.toggle("armed", dist >= THRESHOLD);
    }, { passive: true });

    page.addEventListener("touchend", () => {
      if (!pulling || busy) { pulling = false; return; }
      pulling = false;
      const armed = ind.classList.contains("armed");
      ind.classList.remove("armed");
      if (!armed) { ind.style.transform = ""; return; }

      busy = true;
      ind.classList.add("loading");
      ind.style.transform = "translateY(48px)";
      const finish = () => { busy = false; ind.classList.remove("loading"); ind.style.transform = ""; };

      if (App.sync.isSignedIn()) {
        App.sync.pullAndMerge()
          .then(() => { router.refresh(); UI.toast("Refreshed", "", "ok"); })
          .catch(() => UI.toast("Couldn't refresh", "Check your connection.", "danger"))
          .finally(finish);
      } else {
        setTimeout(() => { router.refresh(); finish(); }, 350);
      }
    });
  }

  /* --------------------------------------------------------- sync badge -- */

  let lastSyncTip = null;
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
    // U41 — a sighted user sees the icon/color change; announce the same
    // state change to a screen reader via an off-screen live region.
    if (tip !== lastSyncTip) {
      lastSyncTip = tip;
      const live = document.getElementById("syncStatusText");
      if (live) live.textContent = tip;
    }
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
    U.on(document.getElementById("navScroll"), "click", "[data-toggle-group]", (_e, el) => {
      const name = el.dataset.toggleGroup;
      S.commit((db) => {
        const i = db.settings.collapsedNavGroups.indexOf(name);
        if (i >= 0) db.settings.collapsedNavGroups.splice(i, 1);
        else db.settings.collapsedNavGroups.push(name);
      });
      renderNav();
    });
    document.getElementById("themeBtn").addEventListener("click", toggleTheme);
    document.getElementById("sidebarCollapseBtn").addEventListener("click", toggleSidebar);
    document.getElementById("notifBtn").addEventListener("click", openNotifPanel);
    document.getElementById("searchBtn").addEventListener("click", openPalette);
    document.getElementById("addBtn").addEventListener("click", () => App.views.homework.form(null));
    document.getElementById("fabAdd").addEventListener("click", () => App.views.homework.form(null)); // U06
    document.getElementById("hamburger").addEventListener("click", openSidebar);
    document.getElementById("scrim").addEventListener("click", closeSidebar);
    U.on(document.getElementById("mobileTabbar"), "click", "[data-view]", (_e, el) => router.go(el.dataset.view)); // U05
    U.on(document.getElementById("mobileTabbar"), "click", "[data-tabbar-more]", openSidebar);
    initPullToRefresh(); // U27

    // U25 — Ctrl+Z / Cmd+Z anywhere, not just the toast's own Undo button.
    // Yields to native text-field undo when a text input has focus.
    document.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() !== "z" || e.shiftKey || !(e.ctrlKey || e.metaKey)) return;
      const tag = document.activeElement ? document.activeElement.tagName : "";
      if (tag === "INPUT" || tag === "TEXTAREA" || (document.activeElement && document.activeElement.isContentEditable)) return;
      const label = UI.popUndo();
      if (label) { e.preventDefault(); UI.toast("Undone", label, "ok"); }
    });
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
      const path = location.hash.slice(1);
      const id = path.split("/")[0];
      if (path && (id !== current || path.includes("/"))) router.go(path);
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
    // The today strip lives in the topbar on every screen, not only the
    // three views above, so it gets its own lighter-weight tick.
    setInterval(() => { if (!document.hidden) paintTodayStrip(); }, 60000);

    // Materialize recurring assignments once a day.
    setInterval(() => S.runTemplates(28), 6 * 60 * 60 * 1000);

    const startPath = location.hash.slice(1) || S.db.ui.view || "dashboard";
    const startId = startPath.split("/")[0];
    router.go(App.views[startId] ? startPath : "dashboard");

    // U49 — a genuinely fresh dataset (onboarded explicitly false) gets the
    // setup wizard instead of a dashboard full of someone else's data.
    if (S.settings.onboarded === false) setTimeout(runOnboarding, 400);

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

    // F098 — a password-reset email link (?resetToken=...) opens the
    // "set a new password" form directly, same pattern as ?join= above.
    const resetToken = new URL(location.href).searchParams.get("resetToken");
    if (resetToken) {
      history.replaceState(null, "", location.pathname + location.hash);
      setTimeout(() => App.resetPasswordForm && App.resetPasswordForm(resetToken), 60);
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
