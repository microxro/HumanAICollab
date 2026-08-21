/* ==========================================================================
   store.js — data model, persistence, seed data, derived selectors

   Schema v2 adds: terms + transcript, rotating (A/B) day patterns, soft-delete
   trash with undo, per-category grade rules (drop-lowest / curve / extra
   credit), recurring assignment templates, reading tracker, college apps,
   attachment metadata, geolocation + notification settings, and an account
   record for optional cloud sync.
   ========================================================================== */

App.store = (function () {
  const U = App.utils;
  const KEY = "scholar.db.v2";
  const LEGACY_KEY = "scholar.db.v1";
  // Unreadable payloads are moved here rather than thrown away, keyed by the
  // timestamp of the failure.
  const CORRUPT_KEY = "scholar.db.corrupt";
  const SCHEMA = 2;

  /* Categorical palette — validated for colorblind separation and contrast in
     BOTH themes (see css/theme.css for surfaces). Slot order is the CVD-safety
     mechanism, not cosmetic: keep it. PALETTE holds the light-mode steps that
     get stored on records; PALETTE_DARK holds the same eight hues re-stepped
     for the dark surface, applied at render time by chartColor(). */
  const PALETTE = [
    "#2a78d6", "#eb6834", "#1baf7a", "#eda100",
    "#e87ba4", "#008300", "#4a3aa7", "#e34948"
  ];
  const PALETTE_DARK = [
    "#3987e5", "#d95926", "#199e70", "#c98500",
    "#d55181", "#008300", "#9085e9", "#e66767"
  ];

  // Blue sequential ramp (light→dark) for magnitude encodings like the heatmap.
  const SEQ = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#2a78d6", "#256abf", "#184f95"];

  function isDark() {
    return document.documentElement.getAttribute("data-theme") === "dark";
  }

  // Map a stored (light) entity color to the step for the active theme.
  function chartColor(hex) {
    if (!isDark()) return hex;
    const i = PALETTE.indexOf(hex);
    return i >= 0 ? PALETTE_DARK[i] : hex;
  }

  let db = null;
  const listeners = new Set();

  /* ================================================================ seed */

  /**
   * A brand-new install starts genuinely empty — no invented classes, no fake
   * grades, no "Alex Kim". `settings.onboarded` is false so the first-run
   * wizard walks the student through their own classes and bell schedule
   * instead of dropping them into someone else's demo data.
   *
   * One term exists because classes and assignments are always filed under a
   * term; everything else is an empty collection.
   */
  function seed() {
    const base = demoSeed();
    const start = U.dateKey(U.addDays(new Date(), -30));
    const end = U.dateKey(U.addDays(new Date(), 120));

    return Object.assign(base, {
      profile: { name: "", school: "", grade: "", color: PALETTE[0], email: "", parentName: "", parentEmail: "" },
      settings: Object.assign({}, base.settings, { onboarded: false }),
      terms: [{ id: U.uid("tm"), name: "This Term", start, end, current: true }],
      teachers: [], periods: [], classes: [], assignments: [], templates: [],
      events: [], activities: [], decks: [], notes: [], goals: [], habits: [],
      reading: [], collegeApps: [], studySessions: [], attendance: [],
      attachments: [], trash: [], groups: [], peers: [],
      usage: {},
      streak: { count: 0, last: null, xp: 0 },
      ui: { view: "dashboard", lastSeen: Date.now() }
    });
  }

  /** The old demo dataset — opt-in only, via Settings → Data → Load sample data. */
  function demoSeed() {
    const d = (n) => U.dateKey(U.addDays(new Date(), n));
    const t = U.today();

    const teachers = [
      { id: "tc1", name: "Elena Rivera",  subject: "Mathematics", email: "e.rivera@northgate.edu",  phone: "555-0142", room: "204", office: "Mon & Wed, 3:00–4:00 PM", note: "Prefers email. Retakes allowed within 1 week." },
      { id: "tc2", name: "Marcus Chen",   subject: "Chemistry",   email: "m.chen@northgate.edu",    phone: "555-0187", room: "118", office: "Tue & Thu, 3:15–4:00 PM", note: "Lab safety quiz required before each lab." },
      { id: "tc3", name: "Priya Patel",   subject: "English",     email: "p.patel@northgate.edu",   phone: "555-0119", room: "210", office: "Daily, 7:45–8:15 AM", note: "Essay drafts reviewed if submitted 3 days early." },
      { id: "tc4", name: "Daniel Osei",   subject: "History",     email: "d.osei@northgate.edu",    phone: "555-0163", room: "112", office: "Wed, 3:00–3:45 PM", note: "" },
      { id: "tc5", name: "Sofia Nunez",   subject: "Spanish",     email: "s.nunez@northgate.edu",   phone: "555-0175", room: "215", office: "Tue, 3:00–3:40 PM", note: "Conversation club Fridays at lunch." },
      { id: "tc6", name: "Coach Diaz",    subject: "PE / Soccer", email: "r.diaz@northgate.edu",    phone: "555-0198", room: "Gym", office: "By appointment", note: "Text for last-minute practice changes." },
      { id: "tc7", name: "Amara Blake",   subject: "Computer Science", email: "a.blake@northgate.edu", phone: "555-0151", room: "301", office: "Thu, 3:00–4:30 PM", note: "Open lab during office hours." }
    ];

    const periods = [
      { id: "p1", name: "Period 1", start: "08:00", end: "08:52" },
      { id: "p2", name: "Period 2", start: "09:00", end: "09:52" },
      { id: "p3", name: "Period 3", start: "10:00", end: "10:52" },
      { id: "p4", name: "Lunch",    start: "11:00", end: "11:35" },
      { id: "p5", name: "Period 4", start: "11:45", end: "12:37" },
      { id: "p6", name: "Period 5", start: "12:45", end: "13:37" },
      { id: "p7", name: "Period 6", start: "13:45", end: "14:37" }
    ];

    const W = ["Mon", "Tue", "Wed", "Thu", "Fri"];
    const cats = (arr) => arr.map((c) => ({ id: U.uid("cat"), name: c[0], weight: c[1] }));

    const terms = [
      { id: "tm0", name: "Spring (last term)", start: d(-160), end: d(-40), current: false, gpa: 3.61, credits: 6 },
      { id: "tm1", name: "Fall Semester", start: d(-30), end: d(80), current: true }
    ];

    const classes = [
      { id: "cl1", name: "AP Calculus AB", code: "MATH-401", teacherId: "tc1", room: "204", color: PALETTE[0], periodId: "p1", days: W, patternDays: ["A"], credits: 1, termId: "tm1", categories: cats([["Tests", 45], ["Quizzes", 25], ["Homework", 20], ["Participation", 10]]) },
      { id: "cl2", name: "AP Chemistry",   code: "SCI-320",  teacherId: "tc2", room: "118", color: PALETTE[1], periodId: "p2", days: W, patternDays: ["A"], credits: 1, termId: "tm1", categories: cats([["Exams", 40], ["Labs", 30], ["Quizzes", 20], ["Homework", 10]]) },
      { id: "cl3", name: "English Lit",    code: "ENG-302",  teacherId: "tc3", room: "210", color: PALETTE[3], periodId: "p3", days: W, patternDays: ["B"], credits: 1, termId: "tm1", categories: cats([["Essays", 50], ["Reading Quizzes", 25], ["Discussion", 15], ["Homework", 10]]) },
      { id: "cl4", name: "US History",     code: "HIS-210",  teacherId: "tc4", room: "112", color: PALETTE[4], periodId: "p5", days: W, patternDays: ["A"], credits: 1, termId: "tm1", categories: cats([["Tests", 40], ["Projects", 30], ["Homework", 20], ["Participation", 10]]) },
      { id: "cl5", name: "Spanish III",    code: "SPA-303",  teacherId: "tc5", room: "215", color: PALETTE[7], periodId: "p6", days: W, patternDays: ["B"], credits: 1, termId: "tm1", categories: cats([["Exams", 35], ["Speaking", 30], ["Quizzes", 20], ["Homework", 15]]) },
      { id: "cl6", name: "CS Principles",  code: "CSC-150",  teacherId: "tc7", room: "301", color: PALETTE[5], periodId: "p7", days: ["Mon", "Wed", "Fri"], patternDays: ["B"], credits: 1, termId: "tm1", categories: cats([["Projects", 50], ["Labs", 30], ["Quizzes", 20]]) },
      { id: "cl7", name: "PE / Fitness",   code: "PE-100",   teacherId: "tc6", room: "Gym", color: PALETTE[6], periodId: "p7", days: ["Tue", "Thu"], patternDays: ["A"], credits: 0.5, termId: "tm1", categories: cats([["Participation", 70], ["Fitness Tests", 30]]) }
    ];

    // Drop the lowest quiz in Calculus — a real syllabus rule, so the grade
    // engine has something to demonstrate out of the box.
    const quizCat = classes[0].categories.find((c) => c.name === "Quizzes");
    classes[0].rules = { dropLowest: { [quizCat.id]: 1 }, curve: 0 };

    const A = [];
    const mk = (o) => A.push(Object.assign({
      id: U.uid("as"), subtasks: [], notes: "", estMinutes: 45, actualMinutes: 0,
      priority: "med", status: "todo", points: 100, earned: null, graded: false,
      assigned: d(-3), type: "Homework", termId: "tm1", scheduledFor: null, scheduledMin: null,
      missing: false
    }, o));

    const catOf = (clId, name) => {
      const c = classes.find((x) => x.id === clId);
      const hit = c.categories.find((k) => k.name.toLowerCase().includes(name.toLowerCase()));
      return (hit || c.categories[0]).id;
    };

    const past = [
      ["cl1", "Unit 3 Test — Derivatives", "Tests", -21, 100, 88, 95],
      ["cl1", "Quiz: Chain Rule", "Quizzes", -17, 40, 37, 30],
      ["cl1", "Problem Set 8", "Homework", -14, 25, 25, 55],
      ["cl1", "Quiz: Implicit Diff.", "Quizzes", -9, 40, 28, 35],
      ["cl1", "Unit 4 Test — Applications", "Tests", -5, 100, 92, 140],
      ["cl2", "Stoichiometry Exam", "Exams", -20, 100, 79, 120],
      ["cl2", "Lab 4: Titration", "Labs", -16, 50, 47, 95],
      ["cl2", "Quiz: Gas Laws", "Quizzes", -11, 30, 24, 40],
      ["cl2", "Lab 5: Calorimetry", "Labs", -6, 50, 46, 110],
      ["cl3", "Essay: Gatsby & the American Dream", "Essays", -19, 100, 91, 260],
      ["cl3", "Reading Quiz — Ch. 1-5", "Reading", -13, 20, 18, 25],
      ["cl3", "Socratic Seminar", "Discussion", -8, 30, 29, 45],
      ["cl4", "Reconstruction Test", "Tests", -18, 100, 84, 105],
      ["cl4", "Primary Source Analysis", "Homework", -12, 25, 23, 50],
      ["cl4", "Gilded Age Project", "Projects", -4, 100, 95, 210],
      ["cl5", "Examen: Subjuntivo", "Exams", -15, 100, 86, 80],
      ["cl5", "Presentación Oral", "Speaking", -7, 50, 45, 90],
      ["cl6", "Project 2: Data Viz", "Projects", -10, 100, 97, 240],
      ["cl6", "Lab: Recursion", "Labs", -3, 40, 38, 65],
      ["cl7", "Fitness Assessment", "Fitness", -9, 100, 90, 30]
    ];
    past.forEach(([cl, title, cat, day, pts, earned, actual]) =>
      mk({ classId: cl, title, categoryId: catOf(cl, cat), due: d(day), assigned: d(day - 6),
           status: "done", points: pts, earned, graded: true, type: cat,
           estMinutes: Math.round(actual / 1.35), actualMinutes: actual }));

    // A genuinely missing assignment, so the missing-work tracker has a case.
    mk({ classId: "cl4", title: "Map Quiz — Westward Expansion", categoryId: catOf("cl4", "Home"),
         due: d(-13), points: 20, earned: 0, graded: true, status: "done", missing: true, type: "Quiz" });

    mk({ classId: "cl1", title: "Problem Set 11 — Related Rates", categoryId: catOf("cl1", "Home"), due: d(0), priority: "high", points: 25, estMinutes: 50, type: "Homework",
         subtasks: [{ id: "s1", text: "Read section 3.9", done: true }, { id: "s2", text: "Odds 1–21", done: true }, { id: "s3", text: "Challenge problem", done: false }] });
    mk({ classId: "cl2", title: "Lab Report: Calorimetry", categoryId: catOf("cl2", "Lab"), due: d(0), priority: "high", points: 50, estMinutes: 90, status: "doing", type: "Lab",
         subtasks: [{ id: "s4", text: "Data table", done: true }, { id: "s5", text: "Error analysis", done: false }, { id: "s6", text: "Conclusion", done: false }] });
    mk({ classId: "cl3", title: "Read Gatsby Ch. 7–9", categoryId: catOf("cl3", "Home"), due: d(1), priority: "med", points: 10, estMinutes: 60, type: "Reading" });
    mk({ classId: "cl5", title: "Vocab Set 12", categoryId: catOf("cl5", "Home"), due: d(1), priority: "low", points: 15, estMinutes: 25, type: "Homework" });
    mk({ classId: "cl4", title: "Progressive Era Essay Outline", categoryId: catOf("cl4", "Home"), due: d(2), priority: "med", points: 25, estMinutes: 45, type: "Homework" });
    mk({ classId: "cl6", title: "Project 3: Build a Web App", categoryId: catOf("cl6", "Project"), due: d(6), priority: "high", points: 100, estMinutes: 300, status: "doing", type: "Project",
         subtasks: [{ id: "s7", text: "Wireframes", done: true }, { id: "s8", text: "HTML structure", done: true }, { id: "s9", text: "Styling", done: false }, { id: "s10", text: "Interactivity", done: false }, { id: "s11", text: "Write-up", done: false }] });
    mk({ classId: "cl1", title: "Unit 5 Test — Integrals", categoryId: catOf("cl1", "Test"), due: d(4), priority: "high", points: 100, estMinutes: 180, type: "Test" });
    mk({ classId: "cl2", title: "Ch. 9 Practice Problems", categoryId: catOf("cl2", "Home"), due: d(3), priority: "med", points: 20, estMinutes: 40, type: "Homework" });
    mk({ classId: "cl2", title: "Unit 6 Exam — Thermochem", categoryId: catOf("cl2", "Exam"), due: d(4), priority: "high", points: 100, estMinutes: 150, type: "Exam" });
    mk({ classId: "cl3", title: "Essay: Symbolism in Gatsby", categoryId: catOf("cl3", "Essay"), due: d(8), priority: "high", points: 100, estMinutes: 240, type: "Essay",
         subtasks: [{ id: "s12", text: "Thesis", done: false }, { id: "s13", text: "Gather quotes", done: false }, { id: "s14", text: "Draft", done: false }] });
    mk({ classId: "cl5", title: "Oral Presentation Prep", categoryId: catOf("cl5", "Speak"), due: d(9), priority: "med", points: 50, estMinutes: 120, type: "Project" });
    mk({ classId: "cl4", title: "Read Ch. 18 + notes", categoryId: catOf("cl4", "Home"), due: d(-1), priority: "med", points: 20, estMinutes: 40, type: "Reading" });

    const templates = [
      { id: "tp1", classId: "cl1", title: "Weekly Problem Set", type: "Homework",
        categoryId: catOf("cl1", "Home"), points: 25, estMinutes: 50, priority: "med",
        freq: "weekly", days: ["Fri"], interval: 1, until: d(80), lastGenerated: null, active: true },
      { id: "tp2", classId: "cl3", title: "Reading Quiz", type: "Quiz",
        categoryId: catOf("cl3", "Reading"), points: 20, estMinutes: 20, priority: "low",
        freq: "weekly", days: ["Mon"], interval: 1, until: d(80), lastGenerated: null, active: true }
    ];

    const activities = [
      { id: "ac1", name: "Varsity Soccer", type: "Sport", advisorId: "tc6", location: "Athletic Field",
        days: ["Mon", "Tue", "Thu"], start: "15:30", end: "17:15", season: "Fall", color: PALETTE[2],
        role: "Midfielder", hours: [{ date: d(-8), hours: 1.75, note: "Practice" }, { date: d(-5), hours: 2, note: "Scrimmage" }, { date: d(-2), hours: 1.75, note: "Practice" }] },
      { id: "ac2", name: "Robotics Club", type: "Club", advisorId: "tc7", location: "Room 301",
        days: ["Wed"], start: "15:30", end: "17:00", season: "Year-round", color: PALETTE[1],
        role: "Software Lead", hours: [{ date: d(-6), hours: 1.5, note: "Build session" }, { date: d(-13), hours: 1.5, note: "Build session" }] },
      { id: "ac3", name: "Key Club (Volunteer)", type: "Service", advisorId: "tc3", location: "Room 210",
        days: ["Fri"], start: "15:15", end: "16:15", season: "Year-round", color: PALETTE[7],
        role: "Member", hours: [{ date: d(-9), hours: 3, note: "Food bank" }, { date: d(-16), hours: 4, note: "Park cleanup" }, { date: d(-23), hours: 2.5, note: "Tutoring" }] }
    ];

    const events = [
      { id: "ev1", title: "AP Calc Unit 5 Test", type: "Exam", date: d(4), start: "08:00", end: "08:52", classId: "cl1", location: "Rm 204", notes: "Integrals — bring calculator" },
      { id: "ev2", title: "Soccer vs. Lincoln HS", type: "Game", date: d(2), start: "16:00", end: "18:00", classId: null, location: "Home field", notes: "Arrive 3:15 for warmups" },
      { id: "ev3", title: "College Info Night", type: "School", date: d(5), start: "18:30", end: "20:00", classId: null, location: "Auditorium", notes: "Parents invited" },
      { id: "ev4", title: "Chem Lab Makeup", type: "Class", date: d(1), start: "15:00", end: "16:00", classId: "cl2", location: "Rm 118", notes: "" },
      { id: "ev5", title: "Robotics Regional Qualifier", type: "Competition", date: d(11), start: "09:00", end: "16:00", classId: null, location: "Westfield Convention Ctr", notes: "Bus leaves 7:30 AM" },
      { id: "ev6", title: "Essay Due — Gatsby", type: "Deadline", date: d(8), start: "10:00", end: "10:52", classId: "cl3", location: "Rm 210", notes: "" },
      { id: "ev7", title: "No School — Teacher PD", type: "Holiday", date: d(14), start: "", end: "", classId: null, location: "", notes: "" },
      { id: "ev8", title: "Spanish Oral Exam", type: "Exam", date: d(9), start: "12:45", end: "13:37", classId: "cl5", location: "Rm 215", notes: "" }
    ];

    const decks = [
      { id: "dk1", name: "Calc — Derivative Rules", classId: "cl1", cards: [
        { id: "c1", front: "d/dx [sin x]", back: "cos x", box: 3, next: d(2) },
        { id: "c2", front: "d/dx [tan x]", back: "sec² x", box: 2, next: d(0) },
        { id: "c3", front: "Chain rule", back: "d/dx f(g(x)) = f'(g(x)) · g'(x)", box: 1, next: d(0) },
        { id: "c4", front: "d/dx [ln x]", back: "1/x", box: 4, next: d(6) },
        { id: "c5", front: "Product rule", back: "(fg)' = f'g + fg'", box: 2, next: d(0) }
      ]},
      { id: "dk2", name: "Chem — Polyatomic Ions", classId: "cl2", cards: [
        { id: "c6", front: "Sulfate", back: "SO₄²⁻", box: 2, next: d(0) },
        { id: "c7", front: "Nitrate", back: "NO₃⁻", box: 3, next: d(1) },
        { id: "c8", front: "Ammonium", back: "NH₄⁺", box: 1, next: d(0) },
        { id: "c9", front: "Phosphate", back: "PO₄³⁻", box: 1, next: d(0) },
        { id: "c10", front: "Carbonate", back: "CO₃²⁻", box: 2, next: d(0) }
      ]},
      { id: "dk3", name: "Spanish — Subjuntivo Triggers", classId: "cl5", cards: [
        { id: "c11", front: "Ojalá que…", back: "Hopefully… (always subjunctive)", box: 1, next: d(0) },
        { id: "c12", front: "Es importante que…", back: "It's important that… + subjunctive", box: 2, next: d(0) },
        { id: "c13", front: "Dudo que…", back: "I doubt that… + subjunctive", box: 1, next: d(0) }
      ]}
    ];

    const notes = [
      { id: "nt1", classId: "cl1", title: "Related rates strategy", tags: ["exam", "method"], pinned: true, updated: d(-1),
        body: "## Steps\n1. Draw + label the diagram\n2. Write what's **given** (rates) and what's asked\n3. Find an equation relating the variables\n4. Differentiate BOTH sides with respect to `t`\n5. Substitute values *last* — never before differentiating\n\n### Common setups\n- ladder sliding\n- cone draining\n- shadow length" },
      { id: "nt2", classId: "cl2", title: "Titration lab — key formulas", tags: ["lab"], pinned: false, updated: d(-6),
        body: "`M₁V₁ = M₂V₂` (for 1:1 ratios only)\n`moles = M × L`\n\nEquivalence point **≠** endpoint — endpoint is where the indicator changes.\n\nPhenolphthalein: clear → pink around pH 8.2" },
      { id: "nt3", classId: "cl3", title: "Gatsby symbols", tags: ["essay", "gatsby"], pinned: true, updated: d(-2),
        body: "- **Green light** — Gatsby's unreachable dream / Daisy / the future he can't grasp\n- **Valley of Ashes** — moral decay beneath wealth\n- **Eyes of Dr. T.J. Eckleburg** — absent God / hollow judgment\n- **East vs West Egg** — inherited vs new money\n\n> Thesis angle: the dream is corrupted the moment it becomes material." },
      { id: "nt4", classId: "cl6", title: "Project 3 ideas", tags: ["project"], pinned: false, updated: d(-4),
        body: "- Habit tracker with streaks\n- Study timer + analytics\n- Class schedule visualizer\n\nGoing with the schedule visualizer. Needs: localStorage, no frameworks, responsive." }
    ];

    const goals = [
      { id: "gl1", title: "Finish the term with a 3.8+ GPA", metric: "gpa", target: 3.8, current: 0, unit: "GPA", deadline: d(60), done: false },
      { id: "gl2", title: "Log 40 volunteer hours", metric: "service", target: 40, current: 0, unit: "hrs", deadline: d(90), done: false },
      { id: "gl3", title: "Study 8 hours a week", metric: "study", target: 480, current: 0, unit: "min/wk", deadline: d(30), done: false },
      { id: "gl4", title: "Read 6 books this semester", metric: "manual", target: 6, current: 2, unit: "books", deadline: d(75), done: false }
    ];

    const habits = [
      { id: "hb1", name: "Review notes", icon: "📖", log: {} },
      { id: "hb2", name: "No phone while studying", icon: "📵", log: {} },
      { id: "hb3", name: "Sleep by 11 PM", icon: "😴", log: {} },
      { id: "hb4", name: "Exercise", icon: "🏃", log: {} }
    ];
    habits.forEach((h) => {
      for (let i = 1; i <= 20; i++) if (Math.random() > 0.32) h.log[d(-i)] = true;
    });

    const reading = [
      { id: "rd1", classId: "cl3", title: "The Great Gatsby", author: "F. Scott Fitzgerald",
        totalPages: 180, currentPage: 112, deadline: d(8), startedOn: d(-14), done: false,
        log: [{ date: d(-14), page: 22 }, { date: d(-10), page: 55 }, { date: d(-6), page: 80 }, { date: d(-2), page: 112 }] },
      { id: "rd2", classId: "cl4", title: "A People's History — Ch. 11–14", author: "Howard Zinn",
        totalPages: 96, currentPage: 30, deadline: d(12), startedOn: d(-5), done: false,
        log: [{ date: d(-5), page: 12 }, { date: d(-1), page: 30 }] }
    ];

    const collegeApps = [
      { id: "ca1", school: "State University", type: "EA", deadline: d(70), status: "in-progress",
        portal: "", notes: "Honors college requires a second essay.", fee: 60,
        essays: [{ id: "e1", prompt: "Why this school? (300 words)", words: 300, status: "draft" },
                 { id: "e2", prompt: "Community you belong to (500 words)", words: 500, status: "not-started" }],
        recs: [{ id: "r1", teacherId: "tc1", requested: true, received: false }] },
      { id: "ca2", school: "Tech Institute", type: "RD", deadline: d(120), status: "not-started",
        portal: "", notes: "Wants a portfolio — use the Robotics project.", fee: 75,
        essays: [{ id: "e3", prompt: "Describe a project you built (650 words)", words: 650, status: "not-started" }],
        recs: [{ id: "r2", teacherId: "tc7", requested: false, received: false }] },
      { id: "ca3", school: "Regional Merit Scholarship", type: "Scholarship", deadline: d(45), status: "in-progress",
        portal: "", notes: "Needs a 3.5 GPA and 30 service hours.", fee: 0, amount: 5000,
        essays: [{ id: "e4", prompt: "Leadership essay (400 words)", words: 400, status: "draft" }], recs: [] }
    ];

    const studySessions = [];
    for (let i = 27; i >= 0; i--) {
      const day = d(-i);
      const dow = U.parseDate(day).getDay();
      const n = dow === 0 || dow === 6 ? (Math.random() > 0.5 ? 1 : 0) : (Math.random() > 0.25 ? 1 + Math.round(Math.random()) : 0);
      for (let k = 0; k < n; k++) {
        studySessions.push({ id: U.uid("ss"), classId: classes[Math.floor(Math.random() * 6)].id,
          date: day, minutes: 25 * (1 + Math.floor(Math.random() * 3)), kind: "focus" });
      }
    }

    const attendance = [];
    for (let i = 21; i >= 1; i--) {
      const day = d(-i);
      const dow = U.parseDate(day).getDay();
      if (dow === 0 || dow === 6) continue;
      classes.forEach((c) => {
        if (!c.days.includes(U.DOW_SHORT[dow])) return;
        const r = Math.random();
        const status = r > 0.965 ? "absent" : r > 0.93 ? "late" : "present";
        if (status !== "present") attendance.push({ id: U.uid("at"), classId: c.id, date: day, status });
      });
    }

    const usage = {};
    for (let i = 20; i >= 1; i--) usage[d(-i)] = Math.round(12 + Math.random() * 55);
    usage[t] = 0;

    return {
      schema: SCHEMA,
      profile: {
        name: "Alex Kim", school: "Northgate High School", grade: "11th Grade",
        color: PALETTE[0], email: "alex.kim@northgate.edu", parentName: "Dana Kim",
        parentEmail: "dana.kim@example.com"
      },
      account: {
        userId: null, email: null, token: null, role: "student",
        lastSync: null, autoSync: true, children: [], linkCode: null
      },
      settings: {
        theme: "light", weekStartsMonday: true, gpaWeighted: false,
        locationSharing: true, peerSharing: true, shareGrades: false,
        dueSoonDays: 3,
        pomodoro: { focus: 25, short: 5, long: 15, rounds: 4 },
        schedule: {
          mode: "weekly",                 // "weekly" | "rotating"
          cycle: ["A", "B"],
          anchor: U.dateKey(U.startOfWeek(new Date(), true)),
          skipWeekends: true,
          exceptions: {}                  // { "2026-09-01": "none" | "A" | "B" }
        },
        geo: {
          enabled: false, watching: false,
          campusLat: null, campusLng: null, radiusM: 180,
          shareIntervalS: 60, highAccuracy: true,
          rooms: []                       // [{ id, label, lat, lng, radiusM }]
        },
        notifications: {
          enabled: false, dueSoonMin: 120, classStartMin: 10,
          quietStart: "21:30", quietEnd: "06:30", dailyDigest: true
        },
        planner: {
          weekdayStart: "16:00", weekdayEnd: "21:00",
          weekendStart: "10:00", weekendEnd: "18:00",
          blockMin: 30, maxPerDay: 180, bufferDays: 1
        },
        estimateMultiplier: 1
      },
      terms, teachers, periods, classes,
      assignments: A,
      templates, events, activities, decks, notes, goals, habits,
      reading, collegeApps,
      studySessions, attendance,
      attachments: [],
      trash: [],
      groups: [],
      usage,
      streak: { count: 7, last: null, xp: 1240 },
      peers: [
        { id: "pr1", name: "Jordan Lee",   color: PALETTE[1], sharing: true,  classIds: ["cl1", "cl3", "cl6"] },
        { id: "pr2", name: "Maya Santos",  color: PALETTE[4], sharing: true,  classIds: ["cl2", "cl3", "cl5"] },
        { id: "pr3", name: "Ben Okafor",   color: PALETTE[3], sharing: false, classIds: ["cl1", "cl4"] }
      ],
      ui: { view: "dashboard", lastSeen: Date.now() }
    };
  }

  /* ========================================================= persistence */

  // Fill in anything a saved DB predates, so upgrades never crash on undefined.
  function migrate(raw) {
    const base = seed();
    const out = Object.assign({}, raw);

    out.schema = SCHEMA;
    out.settings = Object.assign({}, base.settings, raw.settings || {});
    ["pomodoro", "schedule", "geo", "notifications", "planner"].forEach((k) => {
      out.settings[k] = Object.assign({}, base.settings[k], (raw.settings || {})[k] || {});
    });
    out.account = Object.assign({}, base.account, raw.account || {});
    out.profile = Object.assign({}, base.profile, raw.profile || {});

    // Collections introduced after v1.
    ["terms", "templates", "reading", "collegeApps", "attachments", "trash", "groups"].forEach((k) => {
      if (!Array.isArray(out[k])) out[k] = k === "terms" ? base.terms : [];
    });
    ["teachers", "periods", "classes", "assignments", "events", "activities",
     "decks", "notes", "goals", "habits", "studySessions", "attendance", "peers"].forEach((k) => {
      if (!Array.isArray(out[k])) out[k] = [];
    });
    if (!out.usage) out.usage = {};
    if (!out.streak) out.streak = { count: 0, last: null, xp: 0 };
    if (!out.ui) out.ui = { view: "dashboard", lastSeen: Date.now() };

    // A single malformed element used to throw here, and load()'s catch
    // treats any throw as "unreadable data" and reseeds — so one null in an
    // imported array silently destroyed the whole dataset. Drop the junk
    // rows instead; a lost bad record beats a lost account.
    ["classes", "assignments", "terms", "events", "notes", "activities",
     "teachers", "periods", "goals", "habits", "studySessions",
     "attendance", "decks", "reading", "collegeApps"].forEach((k) => {
      if (Array.isArray(out[k])) out[k] = out[k].filter((r) => r && typeof r === "object");
    });

    const currentTerm = (out.terms.find((t) => t && t.current) || out.terms[0] || {}).id;

    out.classes.forEach((c) => {
      if (!c.termId) c.termId = currentTerm;
      if (!Array.isArray(c.patternDays)) c.patternDays = ["A"];
      if (!c.rules) c.rules = { dropLowest: {}, curve: 0 };
      if (!Array.isArray(c.categories)) c.categories = [];
      // days drives every schedule computation (classesOn, the timetable,
      // the week view). It was never backfilled, so an import without it
      // threw on c.days.join / c.days.includes across half the app.
      if (!Array.isArray(c.days)) c.days = [];
      if (typeof c.name !== "string") c.name = String(c.name == null ? "Untitled class" : c.name);
    });
    out.assignments.forEach((a) => {
      if (!a.termId) a.termId = currentTerm;
      if (a.scheduledFor === undefined) a.scheduledFor = null;
      if (a.scheduledMin === undefined) a.scheduledMin = null;
      if (a.missing === undefined) a.missing = false;
      if (a.actualMinutes == null) a.actualMinutes = 0;
      // Searching and sorting both call a.title.toLowerCase() unguarded.
      if (typeof a.title !== "string") a.title = String(a.title == null ? "Untitled" : a.title);
    });

    return out;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return migrate(parsed);
      }
      // Upgrade in place from the v1 store if it's there.
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        if (parsed && typeof parsed === "object") {
          console.info("[scholar] migrating v1 data → v2");
          return migrate(parsed);
        }
      }
    } catch (e) {
      // Never discard a payload we merely failed to read. This used to fall
      // straight through to seed(), so one unreadable byte — a truncated
      // write, a hand-edited import — silently erased every record with
      // nothing but a console warning. Set it aside instead, so it can be
      // recovered from Settings or handed back for repair.
      console.error("[scholar] saved data is unreadable — quarantining it rather than deleting it.", e);
      try {
        const raw = localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY);
        if (raw) {
          localStorage.setItem(CORRUPT_KEY + "." + Date.now(), raw);
          localStorage.removeItem(KEY);
        }
      } catch (e2) {
        console.error("[scholar] couldn't quarantine the unreadable data", e2);
      }
    }
    return seed();
  }

  /** Quarantined payloads, newest first: [{ key, at, bytes }] */
  function corruptBackups() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf(CORRUPT_KEY + ".") !== 0) continue;
        const at = Number(k.slice(CORRUPT_KEY.length + 1)) || 0;
        out.push({ key: k, at, bytes: (localStorage.getItem(k) || "").length });
      }
    } catch (e) { /* storage unavailable */ }
    return out.sort((a, b) => b.at - a.at);
  }

  function readCorruptBackup(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function discardCorruptBackup(key) {
    try { localStorage.removeItem(key); } catch (e) { /* already gone */ }
  }

  // True while we're already handling a failed save. The quota path used to
  // be: save() throws -> toast() -> logNotification() -> save() -> throws
  // again, forever, flooding the DOM with toasts until the stack blew. The
  // catch existed but the failure wasn't survivable.
  let saveFailing = false;

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
      saveFailing = false;
    } catch (e) {
      if (saveFailing) return;          // re-entered from the notice below
      saveFailing = true;
      console.error("[scholar] save failed (storage full?)", e);
      try {
        if (App.ui) {
          App.ui.toast("Couldn't save",
            "This device's storage is full. Export a backup from Settings → Data, then clear old data.", "danger");
        }
      } finally {
        saveFailing = false;
      }
    }
  }

  // Snapshot first — subscribers re-render, and a render can add or remove
  // subscribers. Iterating the live Set would visit those mid-flight.
  function emit() {
    [...listeners].forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  }

  function commit(fn) {
    if (fn) fn(db);
    db.ui.dirty = Date.now();
    save();
    emit();
    if (App.sync) App.sync.queue();
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /* ========================================================== collections */

  function all(coll) { return db[coll] || []; }
  function byId(coll, id) { return (db[coll] || []).find((x) => x.id === id) || null; }

  function insert(coll, obj) {
    const rec = Object.assign({ id: U.uid(coll.slice(0, 2)) }, obj);
    db[coll].push(rec);
    commit();
    return rec;
  }

  function update(coll, id, patch) {
    const rec = byId(coll, id);
    if (!rec) return null;
    Object.assign(rec, patch);
    commit();
    return rec;
  }

  /**
   * Soft delete — the record moves to the trash so it can be restored.
   * Returns a token you can hand to restore() (used by the undo toast).
   */
  function remove(coll, id) {
    const i = (db[coll] || []).findIndex((x) => x.id === id);
    if (i < 0) return null;
    const [rec] = db[coll].splice(i, 1);
    const entry = {
      id: U.uid("tr"), coll, record: rec, deletedAt: Date.now(),
      label: rec.title || rec.name || rec.school || "item"
    };
    db.trash.unshift(entry);
    if (db.trash.length > 100) db.trash.length = 100;
    commit();
    return entry.id;
  }

  function restore(trashId) {
    const i = db.trash.findIndex((t) => t.id === trashId);
    if (i < 0) return false;
    const [entry] = db.trash.splice(i, 1);
    if (!db[entry.coll]) db[entry.coll] = [];
    db[entry.coll].push(entry.record);
    commit();
    return true;
  }

  function purgeTrash(trashId) {
    db.trash = trashId ? db.trash.filter((t) => t.id !== trashId) : [];
    commit();
  }

  /* ============================================================ selectors */

  function cls(id) { return byId("classes", id); }
  function teacher(id) { return byId("teachers", id); }
  function period(id) { return byId("periods", id); }
  function currentTerm() { return db.terms.find((t) => t.current) || db.terms[0] || null; }

  function termClasses(termId) {
    const tid = termId || (currentTerm() || {}).id;
    return db.classes.filter((c) => !c.termId || c.termId === tid);
  }

  function classColor(id) { const c = cls(id); return c ? c.color : "#94a3b8"; }
  function className(id) { const c = cls(id); return c ? c.name : "General"; }

  /* ------------------------------------------- rotating day patterns ---- */

  /**
   * Which cycle day (e.g. "A" / "B") a date falls on, counting only school
   * days from the anchor. Returns null for weekends, holidays, and explicit
   * "none" exceptions.
   */
  function cycleDayFor(iso) {
    const sc = db.settings.schedule;
    if (sc.mode !== "rotating") return null;

    const ex = sc.exceptions[iso];
    if (ex === "none") return null;
    if (ex) return ex;

    const dow = U.parseDate(iso).getDay();
    if (sc.skipWeekends && (dow === 0 || dow === 6)) return null;
    if (isHoliday(iso)) return null;

    const anchor = U.parseDate(sc.anchor);
    const target = U.parseDate(iso);
    if (target < anchor) return null;

    let count = 0;
    for (let d = new Date(anchor); d <= target; d.setDate(d.getDate() + 1)) {
      const key = U.dateKey(d);
      const e = sc.exceptions[key];
      if (e === "none") continue;
      const wd = d.getDay();
      if (sc.skipWeekends && (wd === 0 || wd === 6)) continue;
      if (isHoliday(key)) continue;
      if (U.dateKey(d) === iso) break;
      count++;
    }
    return sc.cycle[count % sc.cycle.length];
  }

  function isHoliday(iso) {
    return db.events.some((e) => e.date === iso && e.type === "Holiday");
  }

  function isSchoolDay(iso) {
    const sc = db.settings.schedule;
    if (sc.exceptions[iso] === "none") return false;
    if (isHoliday(iso)) return false;
    const dow = U.parseDate(iso).getDay();
    if (dow === 0 || dow === 6) return !sc.skipWeekends;
    return true;
  }

  /** Classes meeting on a specific DATE — handles weekly and rotating modes. */
  function classesOnDate(iso) {
    const sc = db.settings.schedule;
    const term = currentTerm();
    const pool = termClasses(term && term.id);

    let matching;
    if (sc.mode === "rotating") {
      const cd = cycleDayFor(iso);
      if (!cd) return [];
      matching = pool.filter((c) => (c.patternDays || []).includes(cd));
    } else {
      if (!isSchoolDay(iso)) return [];
      const dow = U.dowName(iso);
      matching = pool.filter((c) => c.days.includes(dow));
    }

    return matching
      .map((c) => ({ cls: c, period: period(c.periodId) }))
      .filter((x) => x.period)
      .sort((a, b) => U.toMin(a.period.start) - U.toMin(b.period.start));
  }

  // Kept for weekly-mode callers that think in weekdays.
  function classesOn(dowShort) {
    return termClasses()
      .filter((c) => c.days.includes(dowShort))
      .map((c) => ({ cls: c, period: period(c.periodId) }))
      .filter((x) => x.period)
      .sort((a, b) => U.toMin(a.period.start) - U.toMin(b.period.start));
  }

  // `iso`, when given, also bounds by the activity's optional startDate/
  // endDate — an AI- or manually-added seasonal activity ("swimming, Sep 5
  // to Oct 25") only shows up on dates inside that window. Omitting `iso`
  // (weekly-template callers that don't think in real dates) keeps the old
  // always-show-if-the-day-matches behavior.
  function activitiesOn(dowShort, iso) {
    return db.activities
      .filter((a) => a.days.includes(dowShort))
      .filter((a) => !iso || ((!a.startDate || a.startDate <= iso) && (!a.endDate || a.endDate >= iso)))
      .sort((a, b) => U.toMin(a.start) - U.toMin(b.start));
  }

  function scheduleFor(iso) {
    const out = [];

    classesOnDate(iso).forEach(({ cls: c, period: p }) => {
      out.push({
        kind: "class", id: c.id, title: c.name, color: c.color,
        start: p.start, end: p.end, location: "Rm " + c.room,
        sub: teacher(c.teacherId) ? teacher(c.teacherId).name : "", room: c.room
      });
    });

    if (isSchoolDay(iso) || db.settings.schedule.mode === "weekly") {
      activitiesOn(U.dowName(iso), iso).forEach((a) => {
        out.push({
          kind: "activity", id: a.id, title: a.name, color: a.color,
          start: a.start, end: a.end, location: a.location, sub: a.type
        });
      });
    }

    db.events.filter((e) => e.date === iso).forEach((e) => {
      out.push({
        kind: "event", id: e.id, title: e.title,
        color: e.classId ? classColor(e.classId) : "#64748b",
        start: e.start, end: e.end, location: e.location, sub: e.type
      });
    });

    return out.sort((a, b) => U.toMin(a.start) - U.toMin(b.start));
  }

  function liveStatus() {
    const iso = U.today();
    const items = scheduleFor(iso).filter((x) => x.start && x.end);
    const now = U.nowMin();

    const current = items.find((x) => now >= U.toMin(x.start) && now < U.toMin(x.end)) || null;
    const next = items.find((x) => U.toMin(x.start) > now) || null;

    let progress = 0, remaining = 0;
    if (current) {
      const s = U.toMin(current.start), e = U.toMin(current.end);
      progress = U.clamp((now - s) / (e - s), 0, 1);
      remaining = e - now;
    }
    return { current, next, progress, remaining, untilNext: next ? U.toMin(next.start) - now : null };
  }

  /* ------------------------------------------------------- assignments -- */

  function openAssignments() { return db.assignments.filter((a) => a.status !== "done"); }

  function dueSoon(days) {
    const n = days == null ? db.settings.dueSoonDays : days;
    const t = U.today();
    return openAssignments()
      .filter((a) => U.diffDays(a.due, t) <= n)
      .sort((a, b) => a.due.localeCompare(b.due));
  }

  function overdue() {
    const t = U.today();
    return openAssignments().filter((a) => U.diffDays(a.due, t) < 0)
      .sort((a, b) => a.due.localeCompare(b.due));
  }

  function missingWork() {
    return db.assignments.filter((a) => a.missing || (a.graded && a.earned === 0 && a.points > 0));
  }

  /**
   * Active "what if this assignment were scored differently" overrides, as
   * { assignmentId: { earned, graded, ... } }. Only ever set for the duration
   * of a withGradeOverride() call.
   *
   * This exists so callers can ask what a grade *would* be without writing to
   * the store. The missing-work list used to do exactly that by assigning
   * `a.earned = a.points` on the live record and putting it back two lines
   * later — during a render, with no commit — so any throw in between left an
   * assignment permanently at full marks.
   */
  let gradeOverrides = null;

  function withGradeOverride(overrides, fn) {
    const prev = gradeOverrides;
    gradeOverrides = overrides || null;
    try { return fn(); } finally { gradeOverrides = prev; }
  }

  function assignmentsFor(classId) {
    const rows = db.assignments.filter((a) => a.classId === classId);
    if (!gradeOverrides) return rows;
    // Copies, so nothing here can write back to a stored record.
    return rows.map((a) => (gradeOverrides[a.id] ? { ...a, ...gradeOverrides[a.id] } : a));
  }

  function progressOf(a) {
    if (a.status === "done") return 1;
    if (!a.subtasks || !a.subtasks.length) return a.status === "doing" ? 0.5 : 0;
    return a.subtasks.filter((s) => s.done).length / a.subtasks.length;
  }

  /** Estimate corrected by how far off this student's past estimates ran. */
  function adjustedEstimate(a) {
    return Math.round((a.estMinutes || 0) * (db.settings.estimateMultiplier || 1));
  }

  /* ------------------------------------------------------------ grades -- */

  // Apply a category's drop-lowest rule before averaging.
  function keptItems(items, catId, rules) {
    const drop = rules && rules.dropLowest ? rules.dropLowest[catId] || 0 : 0;
    if (!drop || items.length <= drop) return items;
    const ranked = U.sortBy(items, (a) => (a.points ? a.earned / a.points : 1));
    return ranked.slice(drop);
  }

  function classGrade(classId) {
    const c = cls(classId);
    if (!c) return null;
    const graded = assignmentsFor(classId).filter((a) => a.graded && a.earned != null && a.points > 0);
    if (!graded.length) return null;

    const rules = c.rules || {};
    let weighted = 0, usedWeight = 0;

    (c.categories || []).forEach((cat) => {
      const items = keptItems(graded.filter((a) => a.categoryId === cat.id), cat.id, rules);
      const p = U.sum(items, (a) => a.points);
      if (!p) return;
      weighted += (U.sum(items, (a) => a.earned) / p) * cat.weight;
      usedWeight += cat.weight;
    });

    let pct;
    if (!usedWeight) {
      const e = U.sum(graded, (a) => a.earned), p = U.sum(graded, (a) => a.points);
      pct = p ? (e / p) * 100 : null;
    } else {
      pct = (weighted / usedWeight) * 100;
    }
    if (pct == null) return null;
    return U.clamp(pct + (rules.curve || 0), 0, 150);
  }

  function categoryBreakdown(classId) {
    const c = cls(classId);
    if (!c) return [];
    const rules = c.rules || {};
    const graded = assignmentsFor(classId).filter((a) => a.graded && a.earned != null);
    return (c.categories || []).map((cat) => {
      const raw = graded.filter((a) => a.categoryId === cat.id);
      const items = keptItems(raw, cat.id, rules);
      const e = U.sum(items, (a) => a.earned);
      const p = U.sum(items, (a) => a.points);
      return {
        ...cat, earned: e, points: p, pct: p ? (e / p) * 100 : null,
        count: items.length, dropped: raw.length - items.length
      };
    });
  }

  /**
   * Given a target class percentage, what average is needed on all remaining
   * (ungraded, still-open) work? Returns null when there's nothing left.
   */
  function neededOnRemaining(classId, target) {
    const c = cls(classId);
    if (!c) return null;
    const remaining = assignmentsFor(classId).filter((a) => !a.graded && a.points > 0);
    if (!remaining.length) return null;

    const lo = 0, hi = 1;
    let need = null, a = lo, b = hi;
    for (let i = 0; i < 44; i++) {
      const mid = (a + b) / 2;
      if (simulateAll(classId, mid) >= target) { need = mid; b = mid; } else { a = mid; }
    }
    return need == null ? null : need * 100;
  }

  // Class grade if every remaining item scored `ratio` (0–1).
  function simulateAll(classId, ratio) {
    const c = cls(classId);
    const graded = assignmentsFor(classId).filter((a) => a.graded && a.earned != null && a.points > 0);
    const remaining = assignmentsFor(classId).filter((a) => !a.graded && a.points > 0)
      .map((a) => ({ categoryId: a.categoryId, points: a.points, earned: a.points * ratio }));
    const rows = graded.concat(remaining);
    const rules = c.rules || {};

    let weighted = 0, used = 0;
    (c.categories || []).forEach((cat) => {
      const items = keptItems(rows.filter((x) => x.categoryId === cat.id), cat.id, rules);
      const p = U.sum(items, (x) => x.points);
      if (!p) return;
      weighted += (U.sum(items, (x) => x.earned) / p) * cat.weight;
      used += cat.weight;
    });
    if (!used) {
      const e = U.sum(rows, (x) => x.earned), p = U.sum(rows, (x) => x.points);
      return p ? (e / p) * 100 : 0;
    }
    return (weighted / used) * 100 + (rules.curve || 0);
  }

  /**
   * How much of a GPA bump a class gets on a weighted scale.
   *
   * An explicit per-class `gpaBoost` always wins — schools differ wildly on
   * this (some give Honors +0.5 and AP +1.0, some cap at 4.3, some weight
   * nothing), so guessing from the class name can only ever be a starting
   * point. When no explicit value is set we fall back to the old name-sniffing
   * so existing data keeps behaving exactly as it did.
   */
  function gpaBoostFor(c) {
    if (c.gpaBoost != null && c.gpaBoost !== "") return Number(c.gpaBoost) || 0;
    const d = db.settings.gpaScale || {};
    if (/\bAP\b|\bIB\b/i.test(c.name)) return d.ap != null ? Number(d.ap) : 1;
    if (/honors|honours/i.test(c.name)) return d.honors != null ? Number(d.honors) : 1;
    return 0;
  }

  function gpa(weighted, termId) {
    const w = weighted == null ? db.settings.gpaWeighted : weighted;
    const cap = Number((db.settings.gpaScale || {}).max) || 5;
    const rows = termClasses(termId)
      .map((c) => ({ c, pct: classGrade(c.id) }))
      .filter((r) => r.pct != null);
    if (!rows.length) return 0;
    let pts = 0, credits = 0;
    rows.forEach(({ c, pct }) => {
      let g = U.pctToGpa(pct);
      if (w) g = Math.min(cap, g + gpaBoostFor(c));
      pts += g * (c.credits || 1);
      credits += c.credits || 1;
    });
    return credits ? pts / credits : 0;
  }

  /** Cumulative GPA across archived terms plus the live one. */
  function cumulativeGpa() {
    let pts = 0, credits = 0;
    db.terms.forEach((t) => {
      if (t.current) {
        const g = gpa(null, t.id);
        const c = U.sum(termClasses(t.id), (x) => x.credits || 1);
        if (c) { pts += g * c; credits += c; }
      } else if (t.gpa != null && t.credits) {
        pts += t.gpa * t.credits;
        credits += t.credits;
      }
    });
    return credits ? { gpa: pts / credits, credits } : { gpa: 0, credits: 0 };
  }

  function gradeTrend(classId) {
    const graded = U.sortBy(
      db.assignments.filter((a) => a.graded && a.earned != null && (!classId || a.classId === classId)),
      (a) => a.due);
    let e = 0, p = 0;
    return graded.map((a) => {
      e += a.earned; p += a.points;
      return { date: a.due, pct: p ? (e / p) * 100 : 0, title: a.title };
    });
  }

  /** Least-squares projection of the trend line to the end of the term. */
  function gradeForecast(classId) {
    const pts = gradeTrend(classId);
    if (pts.length < 3) return null;
    const xs = pts.map((p) => U.parseDate(p.date).getTime() / 86400000);
    const ys = pts.map((p) => p.pct);
    const n = xs.length;
    const mx = U.avg(xs), my = U.avg(ys);
    const denom = U.sum(xs, (x) => (x - mx) * (x - mx));
    if (!denom) return null;
    const slope = U.sum(xs.map((x, i) => (x - mx) * (ys[i] - my))) / denom;
    const term = currentTerm();
    const endX = term ? U.parseDate(term.end).getTime() / 86400000 : xs[n - 1] + 30;
    const projected = my + slope * (endX - mx);

    // Residual spread gives a rough confidence band.
    const resid = ys.map((y, i) => y - (my + slope * (xs[i] - mx)));
    const sd = Math.sqrt(U.sum(resid, (r) => r * r) / Math.max(1, n - 2));
    return {
      projected: U.clamp(projected, 0, 110),
      slopePerWeek: slope * 7,
      band: U.clamp(sd * 1.5, 0.5, 12),
      current: ys[n - 1]
    };
  }

  /* ------------------------------------------------------------- study -- */

  function studyByDay(days) {
    const n = days || 28;
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const key = U.dateKey(U.addDays(new Date(), -i));
      out.push({ date: key, minutes: U.sum(db.studySessions.filter((s) => s.date === key), (s) => s.minutes) });
    }
    return out;
  }

  function studyThisWeek() {
    const start = U.dateKey(U.startOfWeek(new Date(), db.settings.weekStartsMonday));
    return U.sum(db.studySessions.filter((s) => s.date >= start), (s) => s.minutes);
  }

  function serviceHours() {
    return U.sum(db.activities, (a) => U.sum(a.hours || [], (h) => h.hours));
  }

  function attendanceRate() {
    let scheduled = 0;
    for (let i = 21; i >= 1; i--) {
      const day = U.dateKey(U.addDays(new Date(), -i));
      scheduled += classesOnDate(day).length;
    }
    const missed = db.attendance.filter((a) => a.status === "absent").length;
    const late = db.attendance.filter((a) => a.status === "late").length;
    if (!scheduled) return { rate: 100, missed, late, scheduled };
    return { rate: U.clamp(((scheduled - missed) / scheduled) * 100, 0, 100), missed, late, scheduled };
  }

  /* ------------------------------------------------------------ habits -- */

  function habitStreak(habit) {
    let n = 0;
    for (let i = 0; i < 400; i++) {
      const key = U.dateKey(U.addDays(new Date(), -i));
      if (habit.log[key]) n++;
      else if (i > 0) break;
    }
    return n;
  }

  /* -------------------------------------------------------------- goals -- */

  function goalProgress(g) {
    let cur = g.current;
    if (g.metric === "gpa") cur = gpa();
    else if (g.metric === "service") cur = serviceHours();
    else if (g.metric === "study") cur = studyThisWeek();
    else if (g.metric === "reading") cur = db.reading.filter((r) => r.done).length;
    return { current: cur, pct: g.target ? U.clamp((cur / g.target) * 100, 0, 100) : 0 };
  }

  /* ------------------------------------------------------------ reading -- */

  function readingPace(r) {
    const left = Math.max(0, (r.totalPages || 0) - (r.currentPage || 0));
    const days = Math.max(1, U.diffDays(r.deadline, U.today()));
    return {
      pagesLeft: left,
      daysLeft: U.diffDays(r.deadline, U.today()),
      perDay: Math.ceil(left / days),
      pct: r.totalPages ? U.clamp((r.currentPage / r.totalPages) * 100, 0, 100) : 0
    };
  }

  /* ---------------------------------------------------------- templates -- */

  /**
   * Materialize recurring templates into real assignments, out to `horizon`
   * days. Idempotent — it never creates the same occurrence twice.
   */
  function runTemplates(horizonDays) {
    const horizon = horizonDays || 28;
    const today = U.today();
    let made = 0;

    db.templates.filter((t) => t.active !== false).forEach((tpl) => {
      for (let i = 0; i <= horizon; i++) {
        const iso = U.dateKey(U.addDays(new Date(), i));
        if (tpl.until && iso > tpl.until) break;
        if (!(tpl.days || []).includes(U.dowName(iso))) continue;

        // Honor the interval (every N weeks) relative to the template anchor.
        if ((tpl.interval || 1) > 1) {
          const anchor = U.parseDate(tpl.createdOn || today);
          const weeks = Math.floor(U.diffDays(iso, U.dateKey(anchor)) / 7);
          if (weeks % tpl.interval !== 0) continue;
        }
        const exists = db.assignments.some((a) => a.templateId === tpl.id && a.due === iso);
        if (exists) continue;

        db.assignments.push({
          id: U.uid("as"), templateId: tpl.id, classId: tpl.classId,
          categoryId: tpl.categoryId || null, title: tpl.title, type: tpl.type || "Homework",
          due: iso, assigned: today, priority: tpl.priority || "med",
          status: "todo", points: tpl.points || 0, earned: null, graded: false,
          estMinutes: tpl.estMinutes || 30, actualMinutes: 0, subtasks: [], notes: "",
          termId: (currentTerm() || {}).id, scheduledFor: null, scheduledMin: null, missing: false
        });
        made++;
      }
      tpl.lastGenerated = today;
    });

    if (made) commit();
    return made;
  }

  /* -------------------------------------------------------------- misc -- */

  function touchStreak() {
    const t = U.today();
    const s = db.streak;
    if (s.last === t) return;
    if (s.last) {
      const gap = U.diffDays(t, s.last);
      s.count = gap === 1 ? s.count + 1 : gap > 1 ? 1 : s.count;
    } else {
      s.count = Math.max(1, s.count);
    }
    s.xp += 15;
    s.last = t;
    save();
  }

  function addUsage(mins) {
    const t = U.today();
    db.usage[t] = Math.round((db.usage[t] || 0) + mins);
  }

  function exportJSON() { return JSON.stringify(db, null, 2); }

  function importJSON(text) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.classes)) {
      throw new Error("That doesn't look like a Scholar backup file.");
    }
    db = migrate(parsed);
    // migrate() only knows about v1/v2 fields. Backfill v3 before anything
    // renders, or the paint() that commit() triggers will throw on a field
    // this backup predates.
    if (App.store && App.store.ensureV3) App.store.ensureV3();
    commit();
  }

  function replaceAll(next) {
    db = migrate(next);
    if (App.store && App.store.ensureV3) App.store.ensureV3();
    save();
    emit();
  }

  function reset() { db = seed(); commit(); }

  /** Opt-in sample data, for demoing the app without entering a real schedule. */
  function loadDemo() {
    db = migrate(demoSeed());
    if (App.store && App.store.ensureV3) App.store.ensureV3();
    db.settings.onboarded = true;
    commit();
  }

  function wipe() {
    db = seed();
    ["assignments", "events", "notes", "decks", "studySessions", "attendance",
     "goals", "reading", "collegeApps", "templates", "trash"].forEach((k) => { db[k] = []; });
    db.habits.forEach((h) => { h.log = {}; });
    db.activities.forEach((a) => { a.hours = []; });
    db.usage = {};
    db.streak = { count: 0, last: null, xp: 0 };
    commit();
  }

  /* --------------------------------------------------------------- init */

  db = load();

  return {
    PALETTE, PALETTE_DARK, SEQ, SCHEMA, chartColor, isDark,
    get db() { return db; },
    get settings() { return db.settings; },
    get profile() { return db.profile; },
    get account() { return db.account; },
    commit, subscribe, save, replaceAll,
    corruptBackups, readCorruptBackup, discardCorruptBackup,
    all, byId, insert, update, remove, restore, purgeTrash,
    cls, teacher, period, classColor, className, currentTerm, termClasses,
    cycleDayFor, isSchoolDay, isHoliday, classesOnDate, classesOn, activitiesOn,
    scheduleFor, liveStatus,
    openAssignments, dueSoon, overdue, missingWork, assignmentsFor, progressOf, adjustedEstimate,
    withGradeOverride,
    classGrade, categoryBreakdown, neededOnRemaining, simulateAll,
    gpa, gpaBoostFor, cumulativeGpa, gradeTrend, gradeForecast,
    studyByDay, studyThisWeek, serviceHours, attendanceRate,
    habitStreak, goalProgress, readingPace, runTemplates,
    touchStreak, addUsage,
    exportJSON, importJSON, reset, wipe, loadDemo
  };
})();
