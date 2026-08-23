/* ==========================================================================
   notify.js — browser reminders

   No server or push subscription needed: while a tab is open (including a
   backgrounded one, and an installed PWA), a ticking scheduler fires
   Notifications for upcoming classes, due work, and practices.

   Every reminder is fired at most once per day per target, tracked in
   localStorage so a refresh doesn't re-notify.
   ========================================================================== */

App.notify = (function () {
  const U = App.utils, S = App.store;
  const SENT_KEY = "scholar.notified.v1";

  let timer = null;
  let sent = load();

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(SENT_KEY) || "{}");
      // Drop anything not from today so the map can't grow forever.
      if (raw.day !== U.today()) return { day: U.today(), keys: {} };
      return raw;
    } catch (e) { return { day: U.today(), keys: {} }; }
  }

  function persist() {
    try { localStorage.setItem(SENT_KEY, JSON.stringify(sent)); } catch (e) { /* non-fatal */ }
  }

  function already(key) {
    if (sent.day !== U.today()) sent = { day: U.today(), keys: {} };
    return !!sent.keys[key];
  }

  function mark(key) {
    if (sent.day !== U.today()) sent = { day: U.today(), keys: {} };
    sent.keys[key] = Date.now();
    persist();
  }

  /* ------------------------------------------------------- permissions -- */

  function supported() { return "Notification" in window; }

  function permission() {
    return supported() ? Notification.permission : "unsupported";
  }

  function request() {
    if (!supported()) return Promise.resolve("unsupported");
    if (Notification.permission === "granted") return Promise.resolve("granted");
    return Notification.requestPermission().catch(() => "denied");
  }

  /* ------------------------------------------------------------- quiet -- */

  function inQuietHours() {
    const cfg = S.settings.notifications;
    if (!cfg.quietStart || !cfg.quietEnd) return false;
    const now = U.nowMin();
    const a = U.toMin(cfg.quietStart), b = U.toMin(cfg.quietEnd);
    return a > b ? (now >= a || now < b) : (now >= a && now < b);
  }

  /* -------------------------------------------------------------- fire -- */

  function show(title, body, tag, onClickView) {
    if (!supported() || Notification.permission !== "granted") return null;
    try {
      const n = new Notification(title, {
        body,
        tag,
        icon: iconDataUrl(),
        badge: iconDataUrl(),
        requireInteraction: false,
        silent: false
      });
      n.onclick = () => {
        window.focus();
        if (onClickView && App.router) App.router.go(onClickView);
        n.close();
      };
      return n;
    } catch (e) {
      console.warn("[studyhold] notification failed", e);
      return null;
    }
  }

  let _icon = null;
  function iconDataUrl() {
    if (_icon) return _icon;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>
      <rect width='100' height='100' rx='22' fill='%234f46e5'/>
      <text y='72' x='50' font-size='62' text-anchor='middle' fill='white'
            font-family='sans-serif' font-weight='bold'>S</text></svg>`;
    _icon = "data:image/svg+xml," + svg.replace(/\n\s*/g, " ");
    return _icon;
  }

  /* ------------------------------------------------------------- check -- */

  function check() {
    const cfg = S.settings.notifications;
    if (!cfg.enabled || permission() !== "granted") return;
    if (inQuietHours()) return;

    const now = U.nowMin();
    const today = U.today();

    // --- Class / activity starting soon
    if (cfg.classStartMin > 0) {
      S.scheduleFor(today).forEach((it) => {
        if (!it.start) return;
        const lead = U.toMin(it.start) - now;
        if (lead > 0 && lead <= cfg.classStartMin) {
          const key = `start:${it.kind}:${it.id}`;
          if (already(key)) return;
          mark(key);
          show(`${it.title} in ${U.fmtDur(lead)}`,
               [it.location, it.sub].filter(Boolean).join(" · ") || `Starts at ${U.fmtTime(it.start)}`,
               key, it.kind === "class" ? "schedule" : "activities");
        }
      });
    }

    // --- Work due soon
    if (cfg.dueSoonMin > 0) {
      S.openAssignments().forEach((a) => {
        const days = U.diffDays(a.due, today);
        if (days < 0) return;
        // Treat "due today" as due at end of the school day.
        const dueAtMin = days === 0 ? 15 * 60 : 24 * 60 * days + 15 * 60;
        const lead = dueAtMin - now;
        if (lead > 0 && lead <= cfg.dueSoonMin) {
          const key = `due:${a.id}`;
          if (already(key)) return;
          mark(key);
          show(`Due soon: ${a.title}`,
               `${S.className(a.classId)} · ${U.fmtDur(lead)} left · est. ${U.fmtDur(a.estMinutes)}`,
               key, "homework");
        }
      });
    }

    // --- Overdue nudge, once per day
    const late = S.overdue();
    if (late.length) {
      const key = "overdue:" + today;
      if (!already(key) && now >= 16 * 60) {
        mark(key);
        show(`${U.plural(late.length, "assignment is", "assignments are")} overdue`,
             late.slice(0, 3).map((a) => a.title).join(", "), key, "homework");
      }
    }

    // --- Morning digest
    if (cfg.dailyDigest && now >= 7 * 60 && now < 9 * 60) {
      const key = "digest:" + today;
      if (!already(key)) {
        mark(key);
        const items = S.scheduleFor(today).filter((x) => x.kind === "class").length;
        const due = S.dueSoon(0).length;
        show("Today at a glance",
             `${U.plural(items, "class", "classes")} · ${U.plural(due, "assignment")} due today` +
             (late.length ? ` · ${late.length} overdue` : ""),
             key, "dashboard");
      }
    }

    // --- Flashcards due
    const cardsDue = U.sum(S.db.decks, (d) => d.cards.filter((c) => !c.next || c.next <= today).length);
    if (cardsDue >= 5 && now >= 17 * 60) {
      const key = "cards:" + today;
      if (!already(key)) {
        mark(key);
        show(`${cardsDue} flashcards due for review`, "A few minutes now beats cramming later.", key, "flashcards");
      }
    }
  }

  /* --------------------------------------------------------------- api -- */

  function start() {
    stop();
    if (!S.settings.notifications.enabled) return;
    check();
    timer = setInterval(check, 60000);
  }

  function stop() { clearInterval(timer); timer = null; }

  function enable() {
    return request().then((p) => {
      if (p === "granted") {
        S.commit((db) => { db.settings.notifications.enabled = true; });
        start();
        show("Reminders are on", "You'll get a nudge before classes and deadlines.", "welcome");
        return true;
      }
      if (p === "denied") {
        S.commit((db) => { db.settings.notifications.enabled = false; });
      }
      return false;
    });
  }

  function disable() {
    S.commit((db) => { db.settings.notifications.enabled = false; });
    stop();
  }

  function test() {
    if (permission() !== "granted") return false;
    show("Test reminder", "This is what a StudyHold reminder looks like.", "test:" + Date.now());
    return true;
  }

  return { supported, permission, request, enable, disable, start, stop, check, test, show, inQuietHours };
})();
