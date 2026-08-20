/* ==========================================================================
   store.js — data model, persistence, seed data, derived selectors
   ========================================================================== */

App.store = (function () {
  const U = App.utils;
  const KEY = "scholar.db.v1";
  const SCHEMA = 1;

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

  function seed() {
    const t = U.today();
    const d = (n) => U.dateKey(U.addDays(new Date(), n));

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

    const cats = (arr) => arr.map((c, i) => ({ id: "cat" + i + "_" + Math.random().toString(36).slice(2, 6), name: c[0], weight: c[1] }));

    const classes = [
      { id: "cl1", name: "AP Calculus AB", code: "MATH-401", teacherId: "tc1", room: "204", color: PALETTE[0], periodId: "p1", days: W, credits: 1, categories: cats([["Tests", 45], ["Quizzes", 25], ["Homework", 20], ["Participation", 10]]) },
      { id: "cl2", name: "AP Chemistry",   code: "SCI-320",  teacherId: "tc2", room: "118", color: PALETTE[1], periodId: "p2", days: W, credits: 1, categories: cats([["Exams", 40], ["Labs", 30], ["Quizzes", 20], ["Homework", 10]]) },
      { id: "cl3", name: "English Lit",    code: "ENG-302",  teacherId: "tc3", room: "210", color: PALETTE[3], periodId: "p3", days: W, credits: 1, categories: cats([["Essays", 50], ["Reading Quizzes", 25], ["Discussion", 15], ["Homework", 10]]) },
      { id: "cl4", name: "US History",     code: "HIS-210",  teacherId: "tc4", room: "112", color: PALETTE[4], periodId: "p5", days: W, credits: 1, categories: cats([["Tests", 40], ["Projects", 30], ["Homework", 20], ["Participation", 10]]) },
      { id: "cl5", name: "Spanish III",    code: "SPA-303",  teacherId: "tc5", room: "215", color: PALETTE[7], periodId: "p6", days: W, credits: 1, categories: cats([["Exams", 35], ["Speaking", 30], ["Quizzes", 20], ["Homework", 15]]) },
      { id: "cl6", name: "CS Principles",  code: "CSC-150",  teacherId: "tc7", room: "301", color: PALETTE[5], periodId: "p7", days: ["Mon", "Wed", "Fri"], credits: 1, categories: cats([["Projects", 50], ["Labs", 30], ["Quizzes", 20]]) },
      { id: "cl7", name: "PE / Fitness",   code: "PE-100",   teacherId: "tc6", room: "Gym", color: PALETTE[6], periodId: "p7", days: ["Tue", "Thu"], credits: 0.5, categories: cats([["Participation", 70], ["Fitness Tests", 30]]) }
    ];

    // Build assignments across the current + past weeks so charts have shape.
    const A = [];
    const mk = (o) => A.push(Object.assign({
      id: U.uid("as"), subtasks: [], notes: "", estMinutes: 45, actualMinutes: 0,
      priority: "med", status: "todo", points: 100, earned: null, graded: false,
      assigned: d(-3), type: "Homework"
    }, o));

    const catOf = (clId, name) => {
      const c = classes.find((x) => x.id === clId);
      const hit = c.categories.find((k) => k.name.toLowerCase().includes(name.toLowerCase()));
      return (hit || c.categories[0]).id;
    };

    // --- Graded / past work (drives the grade book + trend charts) ---
    const past = [
      ["cl1", "Unit 3 Test — Derivatives", "Tests", -21, 100, 88],
      ["cl1", "Quiz: Chain Rule", "Quizzes", -17, 40, 37],
      ["cl1", "Problem Set 8", "Homework", -14, 25, 25],
      ["cl1", "Quiz: Implicit Diff.", "Quizzes", -9, 40, 34],
      ["cl1", "Unit 4 Test — Applications", "Tests", -5, 100, 92],
      ["cl2", "Stoichiometry Exam", "Exams", -20, 100, 79],
      ["cl2", "Lab 4: Titration", "Labs", -16, 50, 47],
      ["cl2", "Quiz: Gas Laws", "Quizzes", -11, 30, 24],
      ["cl2", "Lab 5: Calorimetry", "Labs", -6, 50, 46],
      ["cl3", "Essay: Gatsby & the American Dream", "Essays", -19, 100, 91],
      ["cl3", "Reading Quiz — Ch. 1-5", "Reading", -13, 20, 18],
      ["cl3", "Socratic Seminar", "Discussion", -8, 30, 29],
      ["cl4", "Reconstruction Test", "Tests", -18, 100, 84],
      ["cl4", "Primary Source Analysis", "Homework", -12, 25, 23],
      ["cl4", "Gilded Age Project", "Projects", -4, 100, 95],
      ["cl5", "Examen: Subjuntivo", "Exams", -15, 100, 86],
      ["cl5", "Presentación Oral", "Speaking", -7, 50, 45],
      ["cl6", "Project 2: Data Viz", "Projects", -10, 100, 97],
      ["cl6", "Lab: Recursion", "Labs", -3, 40, 38],
      ["cl7", "Fitness Assessment", "Fitness", -9, 100, 90]
    ];
    past.forEach(([cl, title, cat, day, pts, earned]) =>
      mk({ classId: cl, title, categoryId: catOf(cl, cat), due: d(day), assigned: d(day - 6),
           status: "done", points: pts, earned, graded: true, type: cat,
           actualMinutes: 30 + Math.round(Math.random() * 70) }));

    // --- Live / upcoming work ---
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
    mk({ classId: "cl3", title: "Essay: Symbolism in Gatsby", categoryId: catOf("cl3", "Essay"), due: d(8), priority: "high", points: 100, estMinutes: 240, type: "Essay",
         subtasks: [{ id: "s12", text: "Thesis", done: false }, { id: "s13", text: "Gather quotes", done: false }, { id: "s14", text: "Draft", done: false }] });
    mk({ classId: "cl5", title: "Oral Presentation Prep", categoryId: catOf("cl5", "Speak"), due: d(9), priority: "med", points: 50, estMinutes: 120, type: "Project" });
    mk({ classId: "cl4", title: "Read Ch. 18 + notes", categoryId: catOf("cl4", "Home"), due: d(-1), priority: "med", points: 20, estMinutes: 40, type: "Reading" });

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
        body: "1. Draw + label the diagram\n2. Write what's given (rates) and what's asked\n3. Find an equation relating the variables\n4. Differentiate BOTH sides with respect to t\n5. Substitute values LAST — never before differentiating\n\nCommon setups: ladder sliding, cone draining, shadow length." },
      { id: "nt2", classId: "cl2", title: "Titration lab — key formulas", tags: ["lab"], pinned: false, updated: d(-6),
        body: "M₁V₁ = M₂V₂ (for 1:1 ratios only)\nmoles = M × L\nEquivalence point ≠ endpoint — endpoint is where the indicator changes.\n\nPhenolphthalein: clear → pink around pH 8.2" },
      { id: "nt3", classId: "cl3", title: "Gatsby symbols", tags: ["essay", "gatsby"], pinned: true, updated: d(-2),
        body: "Green light — Gatsby's unreachable dream / Daisy / the future he can't grasp\nValley of Ashes — moral decay beneath wealth\nEyes of Dr. T.J. Eckleburg — absent God / hollow judgment\nEast vs West Egg — inherited vs new money\n\nThesis angle: the dream is corrupted the moment it becomes material." },
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
      for (let i = 1; i <= 20; i++) {
        if (Math.random() > 0.32) h.log[d(-i)] = true;
      }
    });

    // Study sessions over the last 4 weeks
    const studySessions = [];
    for (let i = 27; i >= 0; i--) {
      const day = d(-i);
      const dow = U.parseDate(day).getDay();
      const n = dow === 0 || dow === 6 ? (Math.random() > 0.5 ? 1 : 0) : (Math.random() > 0.25 ? 1 + Math.round(Math.random()) : 0);
      for (let k = 0; k < n; k++) {
        studySessions.push({
          id: U.uid("ss"),
          classId: classes[Math.floor(Math.random() * 6)].id,
          date: day,
          minutes: 25 * (1 + Math.floor(Math.random() * 3)),
          kind: "focus"
        });
      }
    }

    // Attendance for the last 3 weeks
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
      settings: {
        theme: "light", weekStartsMonday: true, gpaWeighted: false,
        locationSharing: true, peerSharing: true, shareGrades: false,
        dueSoonDays: 3,
        pomodoro: { focus: 25, short: 5, long: 15, rounds: 4 }
      },
      teachers, periods, classes,
      assignments: A,
      events, activities, decks, notes, goals, habits,
      studySessions, attendance,
      usage,
      streak: { count: 7, last: null, xp: 1240 },
      peers: [
        { id: "pr1", name: "Jordan Lee",   color: PALETTE[1], sharing: true,  classIds: ["cl1", "cl3", "cl6"] },
        { id: "pr2", name: "Maya Santos",  color: PALETTE[5], sharing: true,  classIds: ["cl2", "cl3", "cl5"] },
        { id: "pr3", name: "Ben Okafor",   color: PALETTE[4], sharing: false, classIds: ["cl1", "cl4"] }
      ],
      ui: { view: "dashboard", lastSeen: Date.now() }
    };
  }

  /* ========================================================= persistence */

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.schema === SCHEMA) return parsed;
      }
    } catch (e) {
      console.warn("[scholar] could not read saved data — reseeding.", e);
    }
    return seed();
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch (e) {
      console.warn("[scholar] save failed (storage full?)", e);
    }
  }

  function emit() {
    listeners.forEach((fn) => {
      try { fn(); } catch (e) { console.error(e); }
    });
  }

  // Mutate then persist + notify.
  function commit(fn) {
    if (fn) fn(db);
    save();
    emit();
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /* ========================================================== collections */

  // Generic CRUD over a top-level array collection.
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

  function remove(coll, id) {
    const i = (db[coll] || []).findIndex((x) => x.id === id);
    if (i >= 0) { db[coll].splice(i, 1); commit(); return true; }
    return false;
  }

  /* ============================================================ selectors */

  function cls(id) { return byId("classes", id); }
  function teacher(id) { return byId("teachers", id); }
  function period(id) { return byId("periods", id); }

  function classColor(id) {
    const c = cls(id);
    return c ? c.color : "#94a3b8";
  }

  function className(id) {
    const c = cls(id);
    return c ? c.name : "General";
  }

  // Classes meeting on a given weekday short name ("Mon"), sorted by start time.
  function classesOn(dowShort) {
    return db.classes
      .filter((c) => c.days.includes(dowShort))
      .map((c) => ({ cls: c, period: period(c.periodId) }))
      .filter((x) => x.period)
      .sort((a, b) => U.toMin(a.period.start) - U.toMin(b.period.start));
  }

  function activitiesOn(dowShort) {
    return db.activities
      .filter((a) => a.days.includes(dowShort))
      .sort((a, b) => U.toMin(a.start) - U.toMin(b.start));
  }

  // Everything scheduled on a specific date, unified + sorted.
  function scheduleFor(iso) {
    const dow = U.dowName(iso);
    const out = [];

    classesOn(dow).forEach(({ cls: c, period: p }) => {
      out.push({
        kind: "class", id: c.id, title: c.name, color: c.color,
        start: p.start, end: p.end, location: "Rm " + c.room,
        sub: teacher(c.teacherId) ? teacher(c.teacherId).name : ""
      });
    });

    activitiesOn(dow).forEach((a) => {
      out.push({
        kind: "activity", id: a.id, title: a.name, color: a.color,
        start: a.start, end: a.end, location: a.location, sub: a.type
      });
    });

    db.events.filter((e) => e.date === iso).forEach((e) => {
      out.push({
        kind: "event", id: e.id, title: e.title,
        color: e.classId ? classColor(e.classId) : "#64748b",
        start: e.start, end: e.end, location: e.location, sub: e.type
      });
    });

    return out.sort((a, b) => U.toMin(a.start) - U.toMin(b.start));
  }

  // What's happening right now, and what's next, for the live dashboard.
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

  function openAssignments() {
    return db.assignments.filter((a) => a.status !== "done");
  }

  function dueSoon(days) {
    const n = days == null ? db.settings.dueSoonDays : days;
    const t = U.today();
    return openAssignments()
      .filter((a) => U.diffDays(a.due, t) <= n)
      .sort((a, b) => a.due.localeCompare(b.due));
  }

  function overdue() {
    const t = U.today();
    return openAssignments()
      .filter((a) => U.diffDays(a.due, t) < 0)
      .sort((a, b) => a.due.localeCompare(b.due));
  }

  function assignmentsFor(classId) {
    return db.assignments.filter((a) => a.classId === classId);
  }

  function progressOf(a) {
    if (a.status === "done") return 1;
    if (!a.subtasks || !a.subtasks.length) return a.status === "doing" ? 0.5 : 0;
    return a.subtasks.filter((s) => s.done).length / a.subtasks.length;
  }

  /* ------------------------------------------------------------ grades -- */

  // Weighted percentage for one class, using only graded work.
  function classGrade(classId) {
    const c = cls(classId);
    if (!c) return null;
    const graded = assignmentsFor(classId).filter((a) => a.graded && a.earned != null && a.points > 0);
    if (!graded.length) return null;

    const buckets = new Map();
    graded.forEach((a) => {
      const key = a.categoryId || "_";
      if (!buckets.has(key)) buckets.set(key, { earned: 0, points: 0 });
      const b = buckets.get(key);
      b.earned += a.earned;
      b.points += a.points;
    });

    let weighted = 0, usedWeight = 0;
    c.categories.forEach((cat) => {
      const b = buckets.get(cat.id);
      if (!b || !b.points) return;
      weighted += (b.earned / b.points) * cat.weight;
      usedWeight += cat.weight;
    });

    // Work in categories that no longer exist still counts, as a flat pool.
    const orphan = [...buckets.entries()].filter(([k]) => !c.categories.some((x) => x.id === k));
    if (!usedWeight) {
      const tot = graded.reduce((acc, a) => ({ e: acc.e + a.earned, p: acc.p + a.points }), { e: 0, p: 0 });
      return tot.p ? (tot.e / tot.p) * 100 : null;
    }
    if (orphan.length) {
      const e = U.sum(orphan, ([, b]) => b.earned);
      const p = U.sum(orphan, ([, b]) => b.points);
      if (p) { weighted += (e / p) * 5; usedWeight += 5; }
    }
    return (weighted / usedWeight) * 100;
  }

  function categoryBreakdown(classId) {
    const c = cls(classId);
    if (!c) return [];
    const graded = assignmentsFor(classId).filter((a) => a.graded && a.earned != null);
    return c.categories.map((cat) => {
      const items = graded.filter((a) => a.categoryId === cat.id);
      const e = U.sum(items, (a) => a.earned);
      const p = U.sum(items, (a) => a.points);
      return { ...cat, earned: e, points: p, pct: p ? (e / p) * 100 : null, count: items.length };
    });
  }

  function gpa(weighted) {
    const w = weighted == null ? db.settings.gpaWeighted : weighted;
    const rows = db.classes
      .map((c) => ({ c, pct: classGrade(c.id) }))
      .filter((r) => r.pct != null);
    if (!rows.length) return 0;
    let pts = 0, credits = 0;
    rows.forEach(({ c, pct }) => {
      let g = U.pctToGpa(pct);
      // Weighted scale: AP/Honors classes get a +1.0 bump, capped at 5.0.
      if (w && /\bAP\b|Honors/i.test(c.name)) g = Math.min(5, g + 1);
      pts += g * (c.credits || 1);
      credits += c.credits || 1;
    });
    return credits ? pts / credits : 0;
  }

  // Cumulative class average after each graded assignment, for the trend line.
  function gradeTrend(classId) {
    const graded = U.sortBy(
      db.assignments.filter((a) => a.graded && a.earned != null && (!classId || a.classId === classId)),
      (a) => a.due
    );
    let e = 0, p = 0;
    return graded.map((a) => {
      e += a.earned; p += a.points;
      return { date: a.due, pct: p ? (e / p) * 100 : 0, title: a.title };
    });
  }

  /* ------------------------------------------------------------- study -- */

  function studyByDay(days) {
    const n = days || 28;
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const key = U.dateKey(U.addDays(new Date(), -i));
      const mins = U.sum(db.studySessions.filter((s) => s.date === key), (s) => s.minutes);
      out.push({ date: key, minutes: mins });
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
    const t = U.today();
    let scheduled = 0;
    for (let i = 21; i >= 1; i--) {
      const day = U.dateKey(U.addDays(new Date(), -i));
      const dow = U.dowName(day);
      if (dow === "Sat" || dow === "Sun") continue;
      scheduled += db.classes.filter((c) => c.days.includes(dow)).length;
    }
    const missed = db.attendance.filter((a) => a.status === "absent").length;
    const late = db.attendance.filter((a) => a.status === "late").length;
    if (!scheduled) return { rate: 100, missed, late, scheduled };
    return { rate: ((scheduled - missed) / scheduled) * 100, missed, late, scheduled };
  }

  /* ------------------------------------------------------------ habits -- */

  function habitStreak(habit) {
    let n = 0;
    for (let i = 0; i < 400; i++) {
      const key = U.dateKey(U.addDays(new Date(), -i));
      if (habit.log[key]) n++;
      else if (i > 0) break;          // today not yet logged shouldn't break it
    }
    return n;
  }

  /* -------------------------------------------------------------- goals -- */

  // Goals with a `metric` auto-fill their `current` from live data.
  function goalProgress(g) {
    let cur = g.current;
    if (g.metric === "gpa") cur = gpa();
    else if (g.metric === "service") cur = serviceHours();
    else if (g.metric === "study") cur = studyThisWeek();
    return { current: cur, pct: g.target ? U.clamp((cur / g.target) * 100, 0, 100) : 0 };
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
    parsed.schema = SCHEMA;
    db = parsed;
    commit();
  }

  function reset() {
    db = seed();
    commit();
  }

  function wipe() {
    db = seed();
    ["assignments", "events", "notes", "decks", "studySessions", "attendance", "goals"].forEach((k) => { db[k] = []; });
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
    commit, subscribe, save,
    all, byId, insert, update, remove,
    cls, teacher, period, classColor, className,
    classesOn, activitiesOn, scheduleFor, liveStatus,
    openAssignments, dueSoon, overdue, assignmentsFor, progressOf,
    classGrade, categoryBreakdown, gpa, gradeTrend,
    studyByDay, studyThisWeek, serviceHours, attendanceRate,
    habitStreak, goalProgress,
    touchStreak, addUsage,
    exportJSON, importJSON, reset, wipe
  };
})();
