/* ==========================================================================
   tour.js — U52: the guided tour a first-time visitor gets on open

   The U49 wizard fixed the *data* problem for a new student — one class, a
   bell schedule, one assignment — but not the discovery one. Twenty-three
   screens sit behind a sidebar, and nothing ever mentioned the command
   palette, the planner, spaced repetition or the parent portal; a student
   could use StudyHold for a term as a homework list and never learn that the
   rest existed.

   This is the discovery half: a spotlight walks the real app, screen by
   screen, saying what each one is for. Nothing here is a mock-up — every
   step navigates the actual router and points at the actual element, so what
   the tour shows is what the app does.

   Skippable from every step (the Skip button, the ✕, or Escape) and one
   dismissal is permanent: markSeen() records it and neither this nor the
   U49 wizard opens itself again. Both stay one click away in
   Settings → Getting started.
   ========================================================================== */

App.tour = (function () {
  const U = App.utils, S = App.store;

  /* ------------------------------------------------------------- steps -- */

  /**
   * The tutorial as data, so it can be read — and tested — without running
   * it. Each step is:
   *
   *   view      route to move to before the step is shown
   *   target    selector, or a list tried in order; the first one that is
   *             actually laid out wins. Omit for a step that speaks about
   *             the app as a whole, which is centred instead.
   *   optional  a step whose target may legitimately not exist (the today
   *             strip is empty before there are classes, and hidden on a
   *             phone). Stepped over rather than shown pointing at nothing.
   *   when      shown only if this returns true — how the sidebar step and
   *             the tab-bar step stay out of each other's way.
   *   placement preferred side; place() falls back through the others when
   *             the card doesn't fit there.
   */
  const STEPS = [
    {
      id: "welcome",
      title: "Welcome to StudyHold 🎓",
      body: `Classes, homework, grades, a study plan and the timer that runs it — one app,
             stored on this device rather than on someone's server.
             <br><br>Here's the two-minute version of what's in it.`,
      tip: "→ and ← move through the tour · Esc leaves it"
    },
    {
      id: "nav",
      target: "#navScroll",
      placement: "right",
      when: () => window.innerWidth > 860,
      title: "Every screen lives here",
      body: `Six groups — overview, academics, study, life, connect, more. The number on a
             row is what's waiting on it, and it turns red when something is late.
             <br><br>The ★ pins a screen to the top; until you pin anything, the three you
             open most float up on their own.`
    },
    {
      id: "tabbar",
      target: "#mobileTabbar",
      placement: "top",
      when: () => window.innerWidth <= 860,
      title: "Five screens under your thumb",
      body: `Home, homework, calendar and grades are one tap away; <strong>More</strong> opens
             the drawer with everything else. A dot on a tab means something is waiting there.`
    },
    {
      id: "palette",
      target: "#searchBtn",
      placement: "bottom",
      title: "One shortcut to everything",
      body: `The command palette searches screens, sections, assignments, classes, notes,
             events and decks at once — and runs actions like exporting a backup or
             rebuilding the study plan.`,
      tip: "⌘K on a Mac, Ctrl+K everywhere else"
    },
    {
      id: "today",
      target: "#todayStrip",
      placement: "bottom",
      optional: true,
      title: "What's happening right now",
      body: `Once your bell schedule is in, this strip follows the school day: the class
             you're in, how long is left of it, and what's next.`
    },
    {
      id: "quickadd",
      target: ["#addBtn", "#fabAdd"],
      placement: "bottom",
      title: "Capture in one keystroke",
      body: `Add an assignment, event, class or note without leaving the screen you're on.
             The assignment form reads plain English — type
             “Lab report for Chemistry Friday 4pm” and it fills the date, time and class in
             for you.`,
      tip: "N adds an assignment from anywhere"
    },
    {
      id: "theme",
      target: "#themeBtn",
      placement: "bottom",
      title: "Make it readable for you",
      body: `Dark mode lives here. Settings adds the rest: larger type, a dyslexia-friendly
             face, a high-contrast mode, true black for OLED screens, and a colour-blind
             preview for checking your class colours.`,
      tip: "T toggles dark mode"
    },
    {
      id: "dashboard",
      view: "dashboard",
      target: ["#page .page-inner > *", "#page .view-root"],
      placement: "bottom",
      title: "The dashboard is your day",
      body: `What's due, today's schedule, your streak, countdowns to the big deadlines and
             the grade trend behind them. Settings → Data → Dashboard layout puts the cards in
             whatever order you read them in.`
    },
    {
      id: "homework",
      view: "homework",
      target: ["#page .page-head", "#page .view-root"],
      placement: "bottom",
      title: "Homework, filtered how you think",
      body: `Filter by class or status, sort by due date, priority, points or effort, and
             save the combination as a list you can come back to. Break a big task into
             subtasks, and give it an estimate so the planner knows what it's scheduling.
             Anything repeating — weekly problem sets, Friday quizzes — becomes a template
             that fills itself in.`
    },
    {
      id: "classes",
      view: "classes",
      target: ["#page .page-head", "#page .view-root"],
      placement: "bottom",
      title: "Classes carry the rules",
      body: `Each class holds its teacher, room, credits and grading categories with their
             weights — which is what lets the grade book compute a real average instead of
             a flat one. Drop-lowest and curve rules live here too.`
    },
    {
      id: "schedule",
      view: "schedule",
      target: ["#page .page-head", "#page .view-root"],
      placement: "bottom",
      title: "Bell schedule and timetable",
      body: `Periods, a weekly grid, and rotating A/B day cycles if your school runs one.
             One-off days — assembly, early release, exam week — are exceptions rather than
             a second schedule to maintain.`
    },
    {
      id: "calendar",
      view: "calendar",
      target: ["#page .page-head", "#page .view-root"],
      placement: "bottom",
      title: "Month, week, agenda",
      body: `Assignments, events and classes on one calendar, with each day shaded by how
             much is due — a crunch week is visible before you're in it. Export the whole
             thing as .ics for Google or Apple Calendar.`
    },
    {
      id: "planner",
      view: "planner",
      target: ["#page .page-head", "#page .view-root"],
      placement: "bottom",
      title: "A study plan you didn't have to write",
      body: `The planner takes your due dates, estimates and free hours and lays out what to
             work on when — and warns you when a week can't fit. It also learns: if your
             estimates run short, later plans are corrected by how far off you usually are.`
    },
    {
      id: "grades",
      view: "grades",
      target: ["#page .page-head", "#page .view-root"],
      placement: "bottom",
      title: "Grades, and what would change them",
      body: `Weighted categories, GPA (weighted or not), and a trend line per class. The
             what-if calculator answers the question you actually have: what do I need on
             the final to end up at an A-?`
    },
    {
      id: "focus",
      view: "focus",
      target: ["#page .page-head", "#page .view-root"],
      placement: "bottom",
      title: "Focus timer",
      body: `A pomodoro timer with your own intervals — focus, short and long breaks, or a
             one-off Custom length — an alarm at the end of each block, and every finished
             session logged. Skip a block early and only the minutes you actually sat there
             are credited, so the study time on your dashboard is measured rather than
             claimed.`
    },
    {
      id: "flashcards",
      view: "flashcards",
      target: ["#page .page-head", "#page .view-root"],
      placement: "bottom",
      title: "Flashcards that space themselves",
      body: `Decks use Leitner boxes: a card you get right comes back later, a card you miss
             comes back tomorrow. There's a quiz mode and a timed test mode when an exam is
             close.`
    },
    {
      id: "notes",
      view: "notes",
      target: ["#page .page-head", "#page .view-root"],
      placement: "bottom",
      title: "Notes and reading",
      body: `Markdown notes, tagged and pinned, filed under a class — with the same spaced
             review as the flashcards for the ones worth remembering. A note written as
             “term — definition” lines turns into a deck in one click, and the reading list
             tracks books and page progress alongside it all.`
    },
    {
      id: "assistant",
      view: "assistant",
      target: ["#page .page-head", "#page .view-root"],
      placement: "bottom",
      title: "The assistant",
      body: `Ask what's on your plate this week, get a topic explained, or say “add a lab
             report for Friday” and let it draft the record. It reads your own schedule and
             deadlines for context, and every change it proposes is a checklist you confirm —
             nothing is written until you say so.`
    },
    {
      id: "shop",
      view: "shop",
      target: ["#page .page-head", "#page .view-root"],
      placement: "bottom",
      title: "Study tokens",
      body: `Tokens are earned one way only — by passing a quiz on something you actually
             studied — and spent on themes, accents, avatar rings and nameplates. Finishing
             an assignment pays nothing, because then the reward would be for ticking a box.`
    },
    {
      id: "life",
      view: "goals",
      target: ["#page .page-head", "#page .view-root"],
      placement: "bottom",
      title: "The rest of school",
      body: `Goals and habits here; <strong>Activities</strong> for clubs, sport and
             outside-school lessons with what they cost per month;
             <strong>Applications</strong> for college deadlines and essays;
             <strong>Guidance</strong> for what your own record suggests you're good at; and
             <strong>Contacts</strong> for teachers and office hours.`
    },
    {
      id: "connect",
      view: "sharing",
      target: ["#page .page-head", "#page .view-root"],
      placement: "bottom",
      title: "Sharing, groups and parents",
      body: `Share a class schedule with a friend, run <strong>Study groups</strong> with
             shared notes and tasks, or hand a parent the read-only
             <strong>Parent portal</strong> — you pick what it shows, and grades are off by
             default.`
    },
    {
      id: "analytics",
      view: "analytics",
      target: ["#page .page-head", "#page .view-root"],
      placement: "bottom",
      title: "Analytics",
      body: `Grades, study minutes, completion rate and attendance over time, per class —
             the view that answers “is this term going better or worse than the last one?”`
    },
    {
      id: "settings",
      view: "settings",
      target: ["#page .page-head", "#page .view-root"],
      placement: "bottom",
      title: "Yours, and portable",
      body: `Everything lives in this browser until you say otherwise. Make an account to
             sync across devices, export a JSON backup any time, and install StudyHold as an
             app so it opens from your home screen and works offline.`
    },
    {
      id: "finish",
      title: "That's the tour 🎉",
      body: `Press <span class="kbd">?</span> for the shortcut list, and
             <span class="kbd">⌘K</span> when you can't remember where something lives.
             <br><br>Settings → Getting started replays this whenever you want it.`,
      cta: { id: "setup", label: "Set up my classes →", when: () => S.db.classes.length === 0 }
    }
  ];

  /* --------------------------------------------------------- geometry -- */

  /**
   * The dim, with a rectangular hole cut out of it.
   *
   * The usual trick is a huge `box-shadow` spread on the ring, which makes
   * the dim a side effect of a 20,000px shadow box and leaves the ring
   * responsible for two unrelated jobs. This keeps the dim on the one
   * element that is the dim: a polygon that walks in from the left edge,
   * around the hole, and back out. Nothing is clipped for pointer purposes —
   * .tour-root blocks the app on its own — so the hole is purely visual.
   */
  function holeClip(l, t, r, b) {
    return `polygon(0px 0px, 0px 100%, ${l}px 100%, ${l}px ${t}px, ${r}px ${t}px,`
         + ` ${r}px ${b}px, ${l}px ${b}px, ${l}px 100%, 100% 100%, 100% 0px)`;
  }

  const PAD = 8;       // breathing room between the element and the spotlight edge
  const GAP = 14;      // spotlight to card
  const MARGIN = 12;   // card to viewport edge
  const SHEET_W = 700; // below this, the card is a bottom sheet instead of a pointer

  let state = null;
  // True while the tour is driving the router with no card up — the trip
  // back to where the student was when it started. active() covers it so
  // that hop isn't counted as a screen they chose either.
  let navigating = false;

  const reduceMotion = () =>
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** Laid out and non-trivially sized — an empty today strip is not a target. */
  function usable(el) {
    if (!el || !el.getClientRects().length) return false;
    const r = el.getBoundingClientRect();
    return r.width > 8 && r.height > 8;
  }

  /**
   * The steps this student would actually be shown, in order: the sidebar
   * step and the tab-bar step never both apply, and an optional step whose
   * element isn't on the page (an empty today strip) is not one of them.
   */
  function plan() {
    return STEPS.filter((s) => (!s.when || s.when()) && (!s.optional || !!findTarget(s)));
  }

  function findTarget(step) {
    if (!step.target) return null;
    const list = Array.isArray(step.target) ? step.target : [step.target];
    for (const sel of list) {
      const el = document.querySelector(sel);
      if (usable(el)) return el;
    }
    return null;
  }

  /* ----------------------------------------------------------- the DOM -- */

  function build() {
    const root = document.createElement("div");
    root.className = "tour-root";
    root.innerHTML = `
      <div class="tour-veil"></div>
      <div class="tour-spot" hidden></div>
      <div class="tour-card" role="dialog" aria-modal="true"
           aria-labelledby="tourTitle" aria-describedby="tourBody" tabindex="-1">
        <div class="tour-bar"><span class="tour-bar-fill"></span></div>
        <button type="button" class="icon-btn tour-x" data-tour-skip
                aria-label="Skip the tour">✕</button>
        <!-- The whole card body is the live region, not just the counter:
             a step changes the count, the heading and the text together, and
             announcing "Step 4 of 22" on its own tells a screen-reader user
             nothing about what step 4 is. -->
        <div class="tour-card-body" aria-live="polite">
          <div class="tour-count small dim"></div>
          <h3 id="tourTitle" class="tour-title"></h3>
          <div id="tourBody" class="tour-text"></div>
          <div class="tour-tip tiny dim" hidden></div>
        </div>
        <div class="tour-foot">
          <button type="button" class="btn btn-sm btn-ghost" data-tour-skip data-skip>Skip tour</button>
          <span class="grow"></span>
          <button type="button" class="btn btn-sm" data-tour-cta hidden></button>
          <button type="button" class="btn btn-sm" data-tour-back>← Back</button>
          <button type="button" class="btn btn-sm btn-primary" data-tour-next>Next →</button>
        </div>
      </div>`;
    return root;
  }

  /* -------------------------------------------------------- placement -- */

  /**
   * Puts the spotlight on the step's element and the card beside it.
   *
   * Runs on every step, on resize and scroll, and on a slow tick besides:
   * any store write repaints the whole view, which replaces the element the
   * spotlight was measuring. Re-querying each time is what keeps the ring on
   * the right thing instead of on a node that left the document.
   */
  function place() {
    if (!state) return;
    const step = state.steps[state.i];
    const { root, card, spot } = state;
    const el = step ? findTarget(step) : null;
    const vw = window.innerWidth, vh = window.innerHeight;
    const sheet = vw <= SHEET_W;

    root.classList.toggle("has-spot", !!el);
    root.classList.toggle("is-sheet", sheet);

    if (el) {
      const r = el.getBoundingClientRect();
      // Off-screen targets get scrolled to rather than spotlit in the dark.
      if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) {
        el.scrollIntoView({ block: "center", inline: "nearest",
                            behavior: reduceMotion() ? "auto" : "smooth" });
      }
      const top = Math.max(-PAD, r.top - PAD);
      const left = Math.max(-PAD, r.left - PAD);
      const width = Math.min(r.width + PAD * 2, vw + PAD * 2);
      const height = Math.min(r.height + PAD * 2, vh + PAD * 2);
      spot.hidden = false;
      spot.style.left = left + "px";
      spot.style.top = top + "px";
      spot.style.width = width + "px";
      spot.style.height = height + "px";
      state.veil.style.clipPath = holeClip(left, top, left + width, top + height);
      state.rect = r;
    } else {
      spot.hidden = true;
      state.veil.style.clipPath = "";
      state.rect = null;
    }

    const cw = card.offsetWidth, ch = card.offsetHeight;

    // On a phone the card is a full-width sheet: there is no room to sit
    // beside anything. It goes to whichever end has more space left over,
    // because a sheet pinned to the bottom covers the tab bar on the step
    // that is about the tab bar.
    if (sheet) {
      const r = state.rect;
      const bottom = Math.max(MARGIN, vh - ch - MARGIN);
      card.style.left = MARGIN + "px";
      card.style.top = (r && r.top > vh - r.bottom ? MARGIN : bottom) + "px";
      return;
    }

    if (!el) {
      card.style.left = Math.round((vw - cw) / 2) + "px";
      card.style.top = Math.round((vh - ch) / 2) + "px";
      return;
    }

    const r = state.rect;
    const fits = {
      bottom: r.bottom + GAP + ch <= vh - MARGIN,
      top: r.top - GAP - ch >= MARGIN,
      right: r.right + GAP + cw <= vw - MARGIN,
      left: r.left - GAP - cw >= MARGIN
    };
    const order = [step.placement || "bottom", "bottom", "top", "right", "left"];
    const side = order.find((s) => fits[s]);

    let left, top;
    if (!side) {
      // Nothing fits — a full-width view header, say. Centre the card and let
      // the ring keep the context.
      left = (vw - cw) / 2;
      top = (vh - ch) / 2;
    } else if (side === "bottom" || side === "top") {
      left = r.left + r.width / 2 - cw / 2;
      top = side === "bottom" ? r.bottom + GAP : r.top - GAP - ch;
    } else {
      left = side === "right" ? r.right + GAP : r.left - GAP - cw;
      top = r.top + r.height / 2 - ch / 2;
    }

    card.style.left = Math.round(U.clamp(left, MARGIN, Math.max(MARGIN, vw - cw - MARGIN))) + "px";
    card.style.top = Math.round(U.clamp(top, MARGIN, Math.max(MARGIN, vh - ch - MARGIN))) + "px";
  }

  /* --------------------------------------------------------- stepping -- */

  function paintCard(step) {
    const { root } = state;
    const n = state.steps.length, i = state.i;
    const last = i === n - 1;

    root.querySelector(".tour-bar-fill").style.width = Math.round(((i + 1) / n) * 100) + "%";
    root.querySelector(".tour-count").textContent = `Step ${i + 1} of ${n}`;
    root.querySelector(".tour-title").textContent = step.title;
    // innerHTML, and only here: step bodies are prose written in this file —
    // no student data reaches them, so there is nothing to escape and the
    // <strong> markup in the copy is meant to render.
    root.querySelector(".tour-text").innerHTML = step.body;

    const tip = root.querySelector(".tour-tip");
    tip.hidden = !step.tip;
    if (step.tip) tip.textContent = step.tip;

    const back = root.querySelector("[data-tour-back]");
    back.disabled = i === 0;

    const nextBtn = root.querySelector("[data-tour-next]");
    nextBtn.textContent = last ? "Done" : "Next →";

    // The last step offers the U49 wizard to anyone who still has no classes:
    // the tour explains the app, the wizard fills it in.
    const cta = root.querySelector("[data-tour-cta]");
    const wanted = step.cta && (!step.cta.when || step.cta.when());
    cta.hidden = !wanted;
    if (wanted) cta.textContent = step.cta.label;

    // Skipping is what the button says on every step but the last, where
    // there is nothing left to skip.
    root.querySelector(".tour-foot [data-tour-skip]").hidden = last;
  }

  /**
   * Moves to step `i`. `dir` only matters for optional steps: stepping over
   * one has to continue in the direction the student was already going, or
   * Back on a missing step would bounce them forwards again.
   */
  function go(i, dir) {
    if (!state) return;
    if (i >= state.steps.length) { end("finish"); return; }
    if (i < 0) i = 0;

    const step = state.steps[i];
    state.i = i;

    if (step.view && App.router && App.router.current !== step.view) App.router.go(step.view);

    if (step.optional && !findTarget(step)) {
      const nextI = i + (dir < 0 ? -1 : 1);
      if (nextI < 0) { go(i + 1, 1); return; }
      go(nextI, dir);
      return;
    }

    paintCard(step);
    place();
    // Two frames: the card's height changes with its new text, and placement
    // measures that height.
    requestAnimationFrame(place);

    const nextBtn = state.root.querySelector("[data-tour-next]");
    if (nextBtn) nextBtn.focus();
  }

  const next = () => state && go(state.i + 1, 1);
  const back = () => state && go(state.i - 1, -1);

  /* ------------------------------------------------------------ keys -- */

  function focusables() {
    return U.$$("button:not([disabled]):not([hidden])", state.card)
      .filter((el) => el.getClientRects().length);
  }

  function onKey(e) {
    if (!state) return;
    if (e.key === "Escape") { e.preventDefault(); end("skip"); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); next(); return; }
    if (e.key === "ArrowLeft") { e.preventDefault(); back(); return; }
    if (e.key !== "Tab") return;

    // The app behind the veil can't be clicked, so it must not be tabbed to
    // either — otherwise focus walks off into a nav it cannot operate.
    const items = focusables();
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !state.card.contains(document.activeElement))) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  /* ------------------------------------------------------ start / end -- */

  /**
   * Records that the tour has been answered.
   *
   * `onboarded` goes with it deliberately. The tour *is* the first run now,
   * and it offers the U49 wizard on its last step — so a student who has
   * already dismissed one welcome should not meet a second one on their next
   * load. Both are still reachable from Settings → Getting started.
   */
  function markSeen() {
    if (S.settings.tourSeen === true && S.settings.onboarded === true) return;
    S.commit((db) => { db.settings.tourSeen = true; db.settings.onboarded = true; });
  }

  function active() { return !!state || navigating; }

  function start(opts) {
    if (state) return;
    const o = opts || {};
    // Counted up front as well as stepped over at runtime, so "Step 4 of 22"
    // is the number of steps this student will actually be shown rather than
    // the number the file happens to contain.
    const steps = plan();
    if (!steps.length) return;

    // A tour that opens on top of a dialog fights it for the screen.
    if (document.querySelector(".modal-root")) App.ui.closeModal();

    const root = build();
    document.body.appendChild(root);

    state = {
      i: 0,
      steps,
      root,
      card: root.querySelector(".tour-card"),
      spot: root.querySelector(".tour-spot"),
      veil: root.querySelector(".tour-veil"),
      rect: null,
      lastFocused: document.activeElement,
      returnTo: (App.router && App.router.current) || "dashboard",
      from: o.from || "manual"
    };

    U.on(root, "click", "[data-tour-next]", next);
    U.on(root, "click", "[data-tour-back]", back);
    U.on(root, "click", "[data-tour-skip]", () => end("skip"));
    U.on(root, "click", "[data-tour-cta]", () => end("setup"));

    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    // Capture: the page scroller is #page, not the window.
    window.addEventListener("scroll", place, true);
    // A repaint can replace the spotlit element between events. Cheap enough
    // at 5fps, and it is what stops the ring drifting off a re-rendered card.
    state.timer = setInterval(place, 200);

    go(0, 1);
  }

  /**
   * Ends the tour. `reason` is "skip" (Skip, ✕, Escape), "finish" (Done on
   * the last step) or "setup" (the last step's wizard button).
   */
  function end(reason) {
    if (!state) return;
    const st = state;
    state = null;

    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", place);
    window.removeEventListener("scroll", place, true);
    clearInterval(st.timer);
    st.root.remove();

    markSeen();

    // The tour borrowed the router; give the screen back.
    if (App.router && App.router.current !== st.returnTo) {
      navigating = true;
      try { App.router.go(st.returnTo); } finally { navigating = false; }
    }
    if (st.lastFocused && document.contains(st.lastFocused)) st.lastFocused.focus();

    const noClasses = S.db.classes.length === 0;
    if (reason === "setup") {
      setTimeout(() => App.runOnboarding && App.runOnboarding(), 120);
      return;
    }
    // Both exits leave a plain toast rather than one with a "Set up classes"
    // button on it. An action toast lives for seven seconds and sits in the
    // same stack as the Undo toast every delete raises, so the next thing to
    // put a button there would be competing with this one for the same click.
    if (reason === "finish") {
      App.ui.toast("Tour finished 🎉", noClasses
        ? "Settings → Getting started has the setup wizard when you're ready."
        : "Settings → Getting started replays it any time.", "ok");
      return;
    }
    App.ui.toast("Tour skipped", noClasses
      ? "Settings → Getting started replays it, and sets up your classes."
      : "Settings → Getting started replays it any time.", "");
  }

  /**
   * What a first-time visitor gets, shortly after boot: the tour, then the
   * U49 wizard behind it for a dataset that predates the tour but was never
   * set up. Both flags are answered by markSeen(), so this runs at most once
   * per install.
   */
  function autoStart() {
    if (state) return;
    if (S.settings.tourSeen === false) { start({ from: "first-run" }); return; }
    if (S.settings.onboarded === false && App.runOnboarding) App.runOnboarding();
  }

  return {
    start, end, active, autoStart, markSeen,
    // Read-only introspection, for the settings copy and tests/tour.mjs.
    steps: () => plan().map((s) => s.id),
    all: () => STEPS.map((s) => s.id),
    get index() { return state ? state.i : -1; }
  };
})();
