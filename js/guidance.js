/* ==========================================================================
   guidance.js — what to take next, and where it leads

   Answers two questions a student actually has to decide: **which electives
   do I pick**, and **what field is this pointing at**. It answers them from
   the data Scholar already holds rather than from a personality quiz, and
   every recommendation carries the numbers that produced it.

   Deliberately deterministic and entirely local. No API key, no network, no
   provider — the same inputs always give the same answer, and the reasoning
   is inspectable line by line. That matters twice over: a recommendation
   about someone's education should be auditable, and a feature that quietly
   depends on a credential is a feature that is broken for most people.

   What it reads (all of it, not a token subset):

     grades          per-class percent, and the trajectory of the graded work
     relative        each subject against *this student's own* mean, which is
                     the only way to compare a 91 from a hard grader with a 96
                     from an easy one
     effort          study minutes logged per class — an A that costs three
                     hours a week and an A that costs twenty are not the same
                     signal, and only Scholar knows the difference
     work style      category performance pooled across every class: builders
                     score on Projects and Labs, writers on Essays, test-takers
                     on Exams. This is the strongest single predictor of which
                     *kind* of course someone thrives in
     voluntary       notes written, decks built, books read, focus sessions
                     run — effort nobody assigned, which is what interest
                     actually looks like in data
     activities      type, hours, and whether they hold a leadership role
     stated          interests the student types in, target schools, and the
                     stage they are choosing for

   What it will not do: pretend to certainty it hasn't earned. Every result
   carries a confidence derived from how much real data fed it, and with a
   thin profile the language says "too early to tell" rather than inventing a
   destiny from two grades.
   ========================================================================== */

App.guidance = (function () {
  const U = App.utils, S = App.store;

  /* ==================================================== subject taxonomy == */

  /**
   * Canonical subject areas. `match` is tested against a class's name and
   * code, longest-specific first — "AP Computer Science" must land on
   * computing, not on the `science` pattern.
   */
  const SUBJECTS = [
    { id: "cs",        label: "Computer science", match: /\b(comp(uter)?\s*sci|cs\b|csc|programming|coding|software|informatics|web dev|data struct)/i },
    { id: "math",      label: "Mathematics",      match: /\b(math|algebra|geometry|calc(ulus)?|statistic|precalc|trig|discrete|number theory)/i },
    { id: "physics",   label: "Physics",          match: /\b(physic|mechanic|astronom|astrophys)/i },
    { id: "chem",      label: "Chemistry",        match: /\b(chem|organic chem|biochem)/i },
    { id: "bio",       label: "Biology",          match: /\b(bio|anatomy|physiolog|genetic|ecolog|environmental sci|zoolog|botan)/i },
    { id: "eng",       label: "Engineering",      match: /\b(engineer|robotic|drafting|cad|shop|manufactur|electronics|mechatron)/i },
    { id: "english",   label: "English",          match: /\b(english|literature|lit\b|writing|composition|rhetoric|journalis|creative writ|eng-)/i },
    { id: "history",   label: "History & civics", match: /\b(history|hist\b|government|civic|politic|geograph|world stud|social stud|his-)/i },
    { id: "econ",      label: "Economics & business", match: /\b(econ|business|account|finance|marketing|entrepreneur|管理)/i },
    { id: "psych",     label: "Psychology & sociology", match: /\b(psycholog|sociolog|anthropolog|human (dev|behav))/i },
    { id: "language",  label: "World languages",  match: /\b(spanish|french|german|latin|mandarin|chinese|japanese|italian|arabic|portuguese|korean|asl|american sign|language|spa-|fre-|ger-)/i },
    { id: "arts",      label: "Visual & performing arts", match: /\b(art\b|studio|drawing|painting|ceramic|sculpt|photograph|film|theat|drama|dance|design|graphic)/i },
    { id: "music",     label: "Music",            match: /\b(music|band|orchestra|choir|chorus|jazz|guitar|piano|percussion|theory of music)/i },
    { id: "health",    label: "Health & PE",      match: /\b(health|physical ed|\bpe\b|pe-|fitness|nutrition|sports med|athletic train)/i },
    { id: "science",   label: "Science",          match: /\b(science|sci-|lab science|integrated sci|physical sci)/i }
  ];

  const SUBJECT_BY_ID = {};
  SUBJECTS.forEach((s) => { SUBJECT_BY_ID[s.id] = s; });

  /** Which subject a class belongs to, or null when nothing matches. */
  function subjectOf(cls) {
    if (!cls) return null;
    const hay = `${cls.name || ""} ${cls.code || ""}`;
    // First match wins, and SUBJECTS is ordered specific-to-general so that
    // "AP Computer Science" doesn't get swallowed by the science pattern.
    const hit = SUBJECTS.find((s) => s.match.test(hay));
    return hit ? hit.id : null;
  }

  /* ==================================================== work-style modes == */

  /**
   * Assignment categories pooled into the four ways school actually asks you
   * to demonstrate something. Someone who scores 94 on Projects and 79 on
   * Exams is not a worse student than the reverse — they are a different
   * one, and it should change which courses they pick.
   */
  const MODES = [
    { id: "build",    label: "Building things",  match: /\b(project|lab|portfolio|build|studio|performance|practical|design|presentation|demo)/i,
      blurb: "you do your best work when the assessment is something you make" },
    { id: "write",    label: "Writing & argument", match: /\b(essay|paper|writing|discussion|seminar|reading quiz|response|journal|analysis)/i,
      blurb: "you do your best work when the assessment is an argument you write" },
    { id: "exam",     label: "Exams & recall",   match: /\b(test|exam|midterm|final|quiz|assessment)/i,
      blurb: "you do your best work under exam conditions" },
    { id: "practice", label: "Steady practice",  match: /\b(homework|problem set|practice|classwork|participation|attendance|drill)/i,
      blurb: "your marks come from consistent day-to-day work rather than big moments" }
  ];

  function modeOf(categoryName) {
    const hit = MODES.find((m) => m.match.test(String(categoryName || "")));
    return hit ? hit.id : null;
  }

  /* ======================================================= the catalogue == */

  /**
   * Electives worth suggesting, per stage. `subjects` are the areas that feed
   * it, `modes` the work styles it rewards, `opens` what it unlocks later.
   *
   * This is a general catalogue, not any one school's course list — Scholar
   * has no way to know what your school offers. The UI says so plainly, and
   * every card is phrased as "ask your counselor whether you have this".
   */
  const ELECTIVES = [
    /* --- middle school: choosing a high-school track ---------------------- */
    { id: "ms-cs",      stage: "middle", name: "Intro to computer science", subjects: ["cs", "math"], modes: ["build"],
      opens: ["AP Computer Science A", "engineering pathway"], why: "The earliest place the programming track starts; starting in middle school is what makes AP CS A comfortable rather than brutal." },
    { id: "ms-alg",     stage: "middle", name: "Algebra I (a year early)", subjects: ["math"], modes: ["exam", "practice"],
      opens: ["Calculus by senior year", "AP Physics", "any quantitative major"], why: "Taking Algebra I in 8th grade is the single decision that determines whether calculus is reachable before you graduate." },
    { id: "ms-lang",    stage: "middle", name: "Start a world language", subjects: ["language"], modes: ["practice"],
      opens: ["4 years of one language", "AP language exam"], why: "Selective colleges look for four years of the same language. Starting early is the only way to get there without crowding out everything else." },
    { id: "ms-band",    stage: "middle", name: "Band, orchestra or choir", subjects: ["music"], modes: ["build", "practice"],
      opens: ["4-year ensemble record", "music scholarships"], why: "Ensembles are cumulative — joining later is much harder than staying in, so this is a now-or-not decision." },
    { id: "ms-art",     stage: "middle", name: "Studio art", subjects: ["arts"], modes: ["build"],
      opens: ["AP Studio Art portfolio", "design pathway"], why: "A portfolio takes years to build. Studio art now is what makes an AP portfolio possible later." },
    { id: "ms-journal", stage: "middle", name: "Journalism or yearbook", subjects: ["english", "arts"], modes: ["write", "build"],
      opens: ["Editor roles in high school", "communications pathway"], why: "Publication staff promote from within — joining early is how you end up an editor." },

    /* --- high school: choosing courses and a college direction ------------ */
    { id: "hs-apcs",    stage: "high", name: "AP Computer Science A", subjects: ["cs", "math"], modes: ["build", "exam"],
      opens: ["CS, software engineering, data science majors"], why: "The standard proof that you can program before you apply, and college credit at most schools." },
    { id: "hs-datasci", stage: "high", name: "Data science or AP Statistics", subjects: ["math", "cs", "econ"], modes: ["build", "practice"],
      opens: ["Economics, psychology, biology, business, any research major"], why: "Statistics is the one maths course that nearly every major actually uses, including the ones that don't feel quantitative." },
    { id: "hs-calc",    stage: "high", name: "AP Calculus AB or BC", subjects: ["math", "physics"], modes: ["exam", "practice"],
      opens: ["Engineering, physics, CS, economics"], why: "Engineering and physics programmes assume it. Arriving without it usually costs a year." },
    { id: "hs-physc",   stage: "high", name: "AP Physics C or Physics 1", subjects: ["physics", "math", "eng"], modes: ["exam", "build"],
      opens: ["Engineering, physics, architecture"], why: "The course engineering admissions look for, and the one that tells you whether engineering is actually for you." },
    { id: "hs-chem",    stage: "high", name: "AP Chemistry", subjects: ["chem", "bio"], modes: ["exam", "build"],
      opens: ["Pre-med, chemical engineering, materials, pharmacy"], why: "Every health-science pathway runs through chemistry, and it is the usual filter course." },
    { id: "hs-bio",     stage: "high", name: "AP Biology or Anatomy", subjects: ["bio", "health"], modes: ["exam", "practice"],
      opens: ["Nursing, pre-med, public health, biology"], why: "Anatomy in particular is the course that tells you whether clinical work suits you before you commit." },
    { id: "hs-eng",     stage: "high", name: "Engineering or robotics (PLTW)", subjects: ["eng", "cs", "physics"], modes: ["build"],
      opens: ["Mechanical, electrical, civil engineering"], why: "Project-based and hands-on — the closest a school timetable gets to what engineers actually do all day." },
    { id: "hs-aplang",  stage: "high", name: "AP English Language", subjects: ["english", "history"], modes: ["write"],
      opens: ["Law, journalism, policy, essentially every major"], why: "Argumentative writing is the transferable skill; it also makes college application essays substantially easier." },
    { id: "hs-aplit",   stage: "high", name: "AP English Literature", subjects: ["english"], modes: ["write"],
      opens: ["English, comparative literature, education, law"], why: "Close reading under time pressure — the skill humanities degrees are built on." },
    { id: "hs-econ",    stage: "high", name: "AP Economics (Micro or Macro)", subjects: ["econ", "math", "history"], modes: ["exam", "write"],
      opens: ["Business, economics, public policy, finance"], why: "The cheapest way to find out whether you like the analytical side of business before you major in it." },
    { id: "hs-psych",   stage: "high", name: "AP Psychology", subjects: ["psych", "bio"], modes: ["exam", "write"],
      opens: ["Psychology, neuroscience, education, social work, nursing"], why: "Broad, well-taught almost everywhere, and the usual entry point to the whole human-sciences family." },
    { id: "hs-govt",    stage: "high", name: "AP Government or History", subjects: ["history", "english"], modes: ["write", "exam"],
      opens: ["Law, political science, international relations, policy"], why: "Document-based argument is exactly the work of a law or policy degree." },
    { id: "hs-lang4",   stage: "high", name: "Fourth year of your language", subjects: ["language"], modes: ["practice", "write"],
      opens: ["Selective admissions, study abroad, international relations"], why: "Three years is common; four is a differentiator, and it is the level where fluency starts." },
    { id: "hs-art",     stage: "high", name: "AP Studio Art or Design", subjects: ["arts"], modes: ["build"],
      opens: ["Architecture, industrial design, animation, fine art"], why: "Art and architecture programmes admit on portfolio. This is the course that produces one." },
    { id: "hs-music",   stage: "high", name: "Music theory or advanced ensemble", subjects: ["music"], modes: ["build", "practice"],
      opens: ["Music, audio engineering, music education"], why: "Theory is the audition requirement most applicants underestimate." },
    { id: "hs-health",  stage: "high", name: "Sports medicine or health science", subjects: ["health", "bio"], modes: ["build", "practice"],
      opens: ["Physical therapy, athletic training, nursing, kinesiology"], why: "A direct look at clinical work, and it usually carries a certification you can actually use." },
    { id: "hs-dual",    stage: "high", name: "Dual-enrolment at a local college", subjects: [], modes: [],
      opens: ["Transferable credit", "a genuine preview of college workload"], why: "Real college credit at a fraction of the price, and the best available test of whether a subject holds up over a full semester." },

    /* --- college: choosing a major -------------------------------------- */
    { id: "col-intro",  stage: "college", name: "An intro course in your second-choice field", subjects: [], modes: [],
      opens: ["A minor", "an informed switch before it's expensive"], why: "Most people change major at least once. Doing it in year one costs a semester; doing it in year three costs a year." },
    { id: "col-stats",  stage: "college", name: "Statistics or research methods", subjects: ["math", "cs", "psych"], modes: ["build", "practice"],
      opens: ["Research assistantships", "graduate school"], why: "The prerequisite for undergraduate research in nearly every field, and research is what separates strong graduate applications." },
    { id: "col-writing",stage: "college", name: "An advanced writing seminar", subjects: ["english", "history"], modes: ["write"],
      opens: ["Thesis work", "any job that involves persuading anyone"], why: "The one skill every graduate destination — industry, law, medicine, academia — assumes you already have." },
    { id: "col-lang",   stage: "college", name: "Continue your language to fluency", subjects: ["language"], modes: ["practice"],
      opens: ["Study abroad", "international roles"], why: "You are already most of the way there; the last two semesters are where it becomes usable." }
  ];

  /**
   * Fields of study, with the subject weights that predict fit.
   *
   * Weights are relative, not probabilities — what matters is which subjects
   * a field leans on and how heavily, so that a strong maths profile pulls
   * engineering up more than it pulls nursing up.
   */
  const PATHWAYS = [
    { id: "cs", name: "Computer science & software", weights: { cs: 3, math: 2.5, physics: 1, eng: 1 }, modes: ["build"],
      activities: /\b(robotic|coding|program|comput|hack|game|tech|engineer)/i,
      interests: /\b(coding|programming|computers|software|games|ai|technology|apps|web)/i,
      electives: ["hs-apcs", "hs-calc", "hs-datasci"],
      blurb: "Building software, and the maths underneath it.",
      reality: "Far more writing and debugging than the coursework suggests, and the maths matters more in the degree than in most jobs." },
    { id: "eng", name: "Engineering", weights: { physics: 3, math: 3, eng: 2.5, chem: 1, cs: 1 }, modes: ["build"],
      activities: /\b(robotic|engineer|build|maker|rocket|car|shop|design)/i,
      interests: /\b(engineering|building|robots|machines|cars|space|construction|electronics)/i,
      electives: ["hs-physc", "hs-calc", "hs-eng"],
      blurb: "Designing physical systems under real constraints.",
      reality: "The first two years are mostly maths and physics, not building — that surprises people who came in from robotics club." },
    { id: "health", name: "Health & medicine", weights: { bio: 3, chem: 2.5, health: 2, psych: 1 }, modes: ["exam", "practice"],
      activities: /\b(volunteer|hospital|health|medic|first aid|nursing|care|red cross)/i,
      interests: /\b(medicine|doctor|nurse|health care|healthcare|biology|anatomy|surgery|pharmacy|medical)/i,
      electives: ["hs-chem", "hs-bio", "hs-health"],
      blurb: "Clinical work, and the biology and chemistry behind it.",
      reality: "Chemistry is the filter, not biology, and the volunteer hours matter to admissions as much as the grades." },
    { id: "life", name: "Life sciences & research", weights: { bio: 3, chem: 2, math: 1.5, psych: 1 }, modes: ["build", "write"],
      activities: /\b(science|research|lab|environment|conservation|garden|animal)/i,
      interests: /\b(biology|research|genetics|ecology|environment|animals|science|lab)/i,
      electives: ["hs-bio", "hs-chem", "hs-datasci"],
      blurb: "Asking answerable questions and running the experiments.",
      reality: "Statistics does more of the work than most people expect, and the day-to-day is patient and repetitive." },
    { id: "math", name: "Mathematics, statistics & data", weights: { math: 3.5, cs: 2, econ: 1.5, physics: 1.5 }, modes: ["exam", "practice"],
      activities: /\b(math|olympiad|quiz bowl|chess|data|statistic)/i,
      interests: /\b(math|numbers|statistics|data|puzzles|patterns|analytics)/i,
      electives: ["hs-calc", "hs-datasci", "hs-apcs"],
      blurb: "Abstraction, proof, and finding structure in data.",
      reality: "University maths is proof-based and almost nothing like calculus; try a proofs course before committing." },
    { id: "business", name: "Business, finance & economics", weights: { econ: 3, math: 2, english: 1.5, psych: 1 }, modes: ["write", "exam"],
      activities: /\b(deca|fbla|business|entrepreneur|job|work|treasur|market|store|sell)/i,
      interests: /\b(business|finance|economics|startup|entrepreneur|marketing|investing|management|accounting)/i,
      electives: ["hs-econ", "hs-datasci", "hs-aplang"],
      blurb: "How organisations allocate money, people and attention.",
      reality: "Much more quantitative than its reputation — the finance and analytics tracks are essentially applied statistics." },
    { id: "law", name: "Law, policy & political science", weights: { history: 3, english: 3, econ: 1.5, psych: 1 }, modes: ["write"],
      activities: /\b(debate|model un|mun|mock trial|government|student council|politic|advocacy|law)/i,
      interests: /\b(law|politics|government|debate|justice|policy|activism|international)/i,
      electives: ["hs-govt", "hs-aplang", "hs-econ"],
      blurb: "Argument, evidence, and the rules institutions run on.",
      reality: "It is a reading and writing degree first; the volume of both is the part that surprises people." },
    { id: "humanities", name: "English, history & the humanities", weights: { english: 3, history: 2.5, language: 1.5, arts: 1 }, modes: ["write"],
      activities: /\b(newspaper|journal|yearbook|literary|writing|book|debate|history|museum)/i,
      interests: /\b(writing|history|literature|philosophy|poetry|classics|journalism)/i,
      electives: ["hs-aplit", "hs-aplang", "hs-lang4"],
      blurb: "Reading closely and writing precisely about hard texts.",
      reality: "The career path is less mapped than in professional degrees, which is a real cost and worth planning around deliberately." },
    { id: "psych", name: "Psychology & social sciences", weights: { psych: 3, bio: 1.5, math: 1.5, english: 1.5 }, modes: ["write", "exam"],
      activities: /\b(peer|counsel|mentor|tutor|volunteer|psych|social|help|support)/i,
      interests: /\b(psychology|human behavior|human behaviour|mental health|sociology|therapy|counseling|counselling|neuroscience)/i,
      electives: ["hs-psych", "hs-datasci", "hs-bio"],
      blurb: "Why people do what they do, tested empirically.",
      reality: "Statistics-heavy, and most clinical roles need a graduate degree — worth knowing before year one, not after." },
    { id: "education", name: "Education & teaching", weights: { english: 2, psych: 2, history: 1.5, math: 1.5 }, modes: ["write", "practice"],
      activities: /\b(tutor|teach|mentor|coach|camp|babysit|peer lead|scout)/i,
      interests: /\b(teaching|education|tutoring|mentoring|early years|classroom)/i,
      electives: ["hs-psych", "hs-aplang"],
      blurb: "Subject knowledge, plus how people learn it.",
      reality: "Your own subject strength matters — secondary teaching means majoring in the thing you'll teach." },
    { id: "design", name: "Design, architecture & media", weights: { arts: 3, eng: 1.5, cs: 1, english: 1 }, modes: ["build"],
      activities: /\b(art|design|photo|film|video|theat|drama|graphic|animat|yearbook|studio)/i,
      interests: /\b(art|design|drawing|architecture|film|photography|animation|fashion|creative)/i,
      electives: ["hs-art", "hs-eng", "hs-apcs"],
      blurb: "Making things people use and look at.",
      reality: "Admission is by portfolio, not grades — start it years before you apply, because it cannot be produced quickly." },
    { id: "music", name: "Music & performing arts", weights: { music: 3.5, arts: 1.5, english: 1 }, modes: ["build", "practice"],
      activities: /\b(band|orchestra|choir|music|jazz|theat|drama|dance|perform|musical)/i,
      interests: /\b(music|singing|instrument|performing|theater|theatre|dance|acting|producing)/i,
      electives: ["hs-music", "hs-art"],
      blurb: "Performance, composition, and the theory underneath.",
      reality: "Audition-based, and the audition is judged against people who have prepared for it for a decade." },
    { id: "language", name: "Languages & international studies", weights: { language: 3, history: 2, english: 2 }, modes: ["write", "practice"],
      activities: /\b(model un|mun|language|exchange|international|culture|travel|translat)/i,
      interests: /\b(languages|international relations|diplomacy|translation|linguistics|study abroad)/i,
      electives: ["hs-lang4", "hs-govt", "hs-aplang"],
      blurb: "Fluency, and the history and politics that come with it.",
      reality: "Almost always worth pairing with a second field — the language is the multiplier, rarely the whole degree." },
    { id: "kinesiology", name: "Kinesiology & sports science", weights: { health: 3, bio: 2, psych: 1.5 }, modes: ["build", "practice"],
      activities: /\b(sport|soccer|basketball|football|track|swim|tennis|athlet|fitness|team|coach|baseball|volleyball|cross country|wrestl|lacrosse|hockey)/i,
      interests: /\b(sports|fitness|athletics|coaching|physical therapy|training|exercise)/i,
      electives: ["hs-health", "hs-bio", "hs-psych"],
      blurb: "How bodies move, train and recover.",
      reality: "Physical therapy and athletic training are graduate programmes — the undergraduate degree is the first half." }
  ];

  const PATHWAY_BY_ID = {};
  PATHWAYS.forEach((p) => { PATHWAY_BY_ID[p.id] = p; });

  const ELECTIVE_BY_ID = {};
  ELECTIVES.forEach((e) => { ELECTIVE_BY_ID[e.id] = e; });

  /* ========================================================== the inputs == */

  function conf() {
    const g = S.db.guidance || {};
    return {
      stage: g.stage || "high",
      interests: Array.isArray(g.interests) ? g.interests : [],
      targets: Array.isArray(g.targets) ? g.targets : [],
      dismissed: Array.isArray(g.dismissed) ? g.dismissed : [],
      // Falls back to the profile, so a school entered once in Settings
      // doesn't have to be entered again here.
      school: String(g.school || (S.db.profile && S.db.profile.school) || "").trim(),
      catalogUrl: String(g.catalogUrl || "").trim(),
      // Courses read off the school's own catalogue page. When this is
      // populated it *replaces* the built-in list, because a real course the
      // school actually offers beats a generic suggestion every time.
      offered: Array.isArray(g.offered) ? g.offered : [],
      offeredAt: g.offeredAt || null
    };
  }

  /**
   * A school's own course, in the shape the ranker already understands.
   *
   * Mapping to the same record as a catalogue elective is what lets one
   * scoring function serve both — the alternative was a second ranker for
   * real courses, which would inevitably disagree with the first.
   */
  function offeredToElective(c, i) {
    const subject = SUBJECT_BY_ID[c && c.subject] ? c.subject : null;
    const level = String((c && c.level) || "unknown");
    const advanced = level === "ap" || level === "ib" || level === "dual";
    return {
      id: "of-" + ((c && c.code) || i),
      stage: (S.db.guidance && S.db.guidance.stage) || "high",
      name: String((c && c.name) || "Untitled course"),
      subjects: subject ? [subject] : [],
      // An AP/IB/dual course is exam-weighted; anything else we don't know,
      // so claim nothing rather than inventing a work-style match.
      modes: advanced ? ["exam"] : [],
      opens: [c && c.grades, c && c.prereq ? "needs " + c.prereq : ""].filter(Boolean),
      why: String((c && c.description) || "").trim() ||
        (advanced ? `Offered at your school as ${level.toUpperCase()}.` : "Offered at your school."),
      real: true,
      code: String((c && c.code) || ""),
      level
    };
  }

  /** Study minutes logged against each class, all time. */
  function studyByClass() {
    const out = {};
    (S.db.studySessions || []).forEach((s) => {
      if (!s || !s.classId) return;
      const mins = Number(s.minutes);
      if (!Number.isFinite(mins) || mins <= 0) return;
      out[s.classId] = (out[s.classId] || 0) + mins;
    });
    return out;
  }

  /**
   * Work nobody assigned: notes written, decks built, focus sessions run.
   * Counted per class, because choosing to go deeper on one subject than the
   * homework required is the clearest interest signal in the whole dataset.
   */
  function voluntaryByClass() {
    const out = {};
    const bump = (id, n) => { if (id) out[id] = (out[id] || 0) + n; };
    (S.db.notes || []).forEach((n) => bump(n && n.classId, 1));
    (S.db.decks || []).forEach((d) => bump(d && d.classId, 1 + Math.min(4, ((d.cards || []).length / 10))));
    (S.db.reading || []).forEach((r) => bump(r && r.classId, 1));
    return out;
  }

  /**
   * The slope of a class's graded work over time, as a percentage-point
   * change from the first half to the second. Needs four graded items — with
   * fewer, one bad quiz reads as a collapse.
   */
  function trendFor(classId) {
    const graded = (S.db.assignments || [])
      .filter((a) => a && a.classId === classId && a.graded && a.earned != null && Number(a.points) > 0)
      .slice()
      // store.js keeps byDue() private, so the same undated-last ordering is
      // repeated here rather than reaching into it.
      .sort((x, y) => {
        const a = x.due, b = y.due;
        if (!a && !b) return 0;
        if (!a) return 1;
        if (!b) return -1;
        return String(a).localeCompare(String(b));
      });
    if (graded.length < 4) return null;
    const pct = (a) => (Number(a.earned) / Number(a.points)) * 100;
    const mid = Math.floor(graded.length / 2);
    const first = U.avg(graded.slice(0, mid).map(pct));
    const second = U.avg(graded.slice(mid).map(pct));
    if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
    return U.round(second - first, 1);
  }

  /* ====================================================== strength model == */

  /**
   * A score per subject area, with the evidence that produced it.
   *
   * The headline number is deliberately *relative*: a subject is scored
   * against this student's own average, not against 100. Absolute grades
   * measure the grader as much as the student — a 91 in a class where the
   * mean is 78 says far more than a 96 where everything is a 96 — and the
   * question here is comparative anyway ("which of my subjects is my
   * strongest"), so the relative form is the honest one.
   */
  function subjectProfile() {
    const classes = (S.db.classes || []).filter((c) => c && c.id);
    const study = studyByClass();
    const voluntary = voluntaryByClass();

    const graded = [];
    classes.forEach((c) => {
      const pct = S.classGrade(c.id);
      if (Number.isFinite(pct)) graded.push({ cls: c, pct });
    });
    const meanGrade = graded.length ? U.avg(graded.map((g) => g.pct)) : null;

    // Minutes per class, used to say "cheap" or "expensive" rather than to
    // score directly — effort only means something next to the other classes.
    const studied = classes.map((c) => study[c.id] || 0).filter((m) => m > 0);
    const meanStudy = studied.length ? U.avg(studied) : 0;

    const bySubject = {};
    classes.forEach((c) => {
      const sid = subjectOf(c);
      if (!sid) return;
      const rec = bySubject[sid] || (bySubject[sid] = {
        id: sid, label: SUBJECT_BY_ID[sid].label, classes: [],
        grades: [], trends: [], studyMin: 0, voluntary: 0
      });
      const pct = S.classGrade(c.id);
      rec.classes.push({ id: c.id, name: c.name });
      if (Number.isFinite(pct)) rec.grades.push(pct);
      const t = trendFor(c.id);
      if (t != null) rec.trends.push(t);
      rec.studyMin += study[c.id] || 0;
      rec.voluntary += voluntary[c.id] || 0;
    });

    const cfg = conf();
    const interestRe = cfg.interests.length
      ? new RegExp(cfg.interests.map((i) => escapeRe(String(i))).filter(Boolean).join("|"), "i")
      : null;

    return Object.values(bySubject).map((rec) => {
      const grade = rec.grades.length ? U.avg(rec.grades) : null;
      const relative = grade != null && meanGrade != null ? U.round(grade - meanGrade, 1) : null;
      const trend = rec.trends.length ? U.round(U.avg(rec.trends), 1) : null;

      const reasons = [];
      // Relative standing carries most of the weight, capped so that one
      // outlier subject can't run away with the whole profile.
      // Relative standing has to dominate. The engagement bonuses below are
      // real signal, but a subject you score 3 points higher in should not be
      // out-ranked because you happened to make flashcards for another one —
      // that inverts the thing the student actually asked about.
      let score = 50;
      if (relative != null) {
        score += U.clamp(relative * 2.8, -32, 32);
        if (relative >= 2) reasons.push(`${U.round(grade, 1)}% — ${U.round(relative, 1)} points above your own average`);
        else if (relative <= -2) reasons.push(`${U.round(grade, 1)}% — ${U.round(Math.abs(relative), 1)} points below your own average`);
        else reasons.push(`${U.round(grade, 1)}%, right at your average`);
      }
      if (trend != null) {
        score += U.clamp(trend * 0.8, -10, 10);
        if (trend >= 2) reasons.push(`rising ${trend} points across the term`);
        else if (trend <= -2) reasons.push(`falling ${Math.abs(trend)} points across the term`);
      }
      // Effort efficiency: a strong grade bought with below-average study
      // time is the clearest aptitude signal available, and the inverse is
      // worth saying out loud too.
      if (meanStudy > 0 && rec.studyMin > 0 && grade != null && relative != null) {
        const ratio = rec.studyMin / (meanStudy * Math.max(1, rec.classes.length));
        if (relative > 0 && ratio < 0.75) {
          score += 6;
          reasons.push(`and on less study time than your other classes — ${Math.round(rec.studyMin)} min logged`);
        } else if (relative < 0 && ratio > 1.35) {
          score -= 6;
          reasons.push(`despite ${Math.round(rec.studyMin)} minutes logged, more than your other classes`);
        }
      }
      if (rec.voluntary >= 2) {
        score += U.clamp(rec.voluntary * 1.2, 0, 6);
        reasons.push(`${Math.round(rec.voluntary)} notes, decks or books you made without being asked`);
      }
      if (interestRe && interestRe.test(rec.label)) {
        score += 6;
        reasons.push("you listed this as an interest");
      }

      return {
        ...rec, grade: grade == null ? null : U.round(grade, 1), relative, trend,
        score: U.round(U.clamp(score, 0, 100), 1), reasons
      };
    }).sort((a, b) => b.score - a.score);
  }

  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  /**
   * Is one of an elective's named alternatives already on the timetable?
   *
   * Splits "AP Calculus AB or BC" into its alternatives, drops the
   * parenthetical and the "AP " prefix, and asks whether any class name
   * contains what's left. Requires two words so that a stray "art" or "music"
   * in some other course title can't suppress a legitimate suggestion.
   */
  function alreadyTaking(name, takenNames) {
    const alts = String(name)
      .replace(/\s*\([^)]*\)/g, "")
      .split(/\s+or\s+/i)
      .map((x) => x.trim().toLowerCase().replace(/^ap\s+/, ""))
      .filter((x) => x.split(/\s+/).length >= 2);
    return alts.some((a) => {
      // The match has to end on a word boundary. A bare substring test makes
      // "Spanish I" a match inside "Spanish III", so a student taking the
      // third year is told they're already in the first and the course they
      // should actually see disappears from the list. Same for Algebra I/II,
      // Physics 1/2, Art I/II — every sequence a school numbers.
      const re = new RegExp(escapeRe(a) + "(?![a-z0-9])", "i");
      return takenNames.some((t) => t && re.test(t));
    });
  }

  /* ===================================================== work-style model == */

  /**
   * How this student scores by *kind* of assessment, pooled across classes.
   * Pooling is the point — one class's Projects average is a fact about that
   * class, but the same gap in five classes is a fact about the student.
   */
  function workStyle() {
    const totals = {};
    MODES.forEach((m) => { totals[m.id] = { id: m.id, label: m.label, blurb: m.blurb, earned: 0, points: 0, classes: 0 }; });

    (S.db.classes || []).forEach((c) => {
      if (!c || !c.id) return;
      const seen = {};
      S.categoryBreakdown(c.id).forEach((cat) => {
        const mid = modeOf(cat.name);
        if (!mid || cat.pct == null || !(cat.points > 0)) return;
        totals[mid].earned += cat.earned;
        totals[mid].points += cat.points;
        if (!seen[mid]) { totals[mid].classes++; seen[mid] = true; }
      });
    });

    const rows = Object.values(totals)
      .filter((t) => t.points > 0)
      .map((t) => ({ ...t, pct: U.round((t.earned / t.points) * 100, 1) }));
    if (!rows.length) return { modes: [], best: null, worst: null, spread: 0 };

    rows.sort((a, b) => b.pct - a.pct);
    const best = rows[0], worst = rows[rows.length - 1];
    // A gap under 4 points across assessment types is noise, not a style.
    const spread = U.round(best.pct - worst.pct, 1);
    return { modes: rows, best: spread >= 4 ? best : null, worst: spread >= 4 ? worst : null, spread };
  }

  /* ====================================================== interest signal == */

  /** Activities, with hours and whether the role reads as leadership. */
  function activitySignal() {
    return (S.db.activities || []).filter((a) => a && a.name).map((a) => {
      const hours = U.sum(a.hours || [], (h) => Number(h && h.hours) || 0);
      const lead = /\b(captain|president|lead|founder|editor|chair|manager|director|officer|treasurer|secretary)\b/i.test(String(a.role || ""));
      return { id: a.id, name: a.name, type: a.type || "Other", hours: U.round(hours, 1), role: a.role || "", lead };
    }).sort((a, b) => b.hours - a.hours);
  }

  /**
   * What the student said, split by how much it should count.
   *
   * `stated` is what they typed into this page on purpose. `incidental` is
   * text that happens to live in goals, reading and application notes — it is
   * worth reading, but a goal titled "be kinder to people" is not a
   * declaration of interest in psychology, and scoring the two the same is
   * how a recommender starts producing results nobody recognises.
   */
  function statedText() {
    const cfg = conf();
    const incidental = [];
    (S.db.goals || []).forEach((g) => g && g.title && incidental.push(g.title));
    (S.db.reading || []).forEach((r) => r && r.title && incidental.push(r.title + " " + (r.subject || "")));
    (S.db.collegeApps || []).forEach((a) => a && a.notes && incidental.push(a.notes));
    return { stated: cfg.interests.join(" · "), incidental: incidental.join(" · ") };
  }

  /* ========================================================= confidence == */

  /**
   * How much this profile is actually standing on. Recommendations built from
   * two grades and nothing else must not be phrased like recommendations
   * built from a full year, and the only way to guarantee that is to compute
   * the difference and let the UI read it.
   */
  function confidence() {
    const subjects = subjectProfile();
    const graded = (S.db.assignments || []).filter((a) => a && a.graded && a.earned != null).length;
    const cfg = conf();
    const points = [
      { got: subjects.length >= 4, label: "four or more subject areas with grades" },
      { got: graded >= 12, label: "at least a dozen graded assignments" },
      { got: (S.db.studySessions || []).length >= 8, label: "study sessions logged" },
      { got: (S.db.activities || []).length >= 1, label: "at least one activity" },
      { got: cfg.interests.length >= 2, label: "interests you've told it about" },
      { got: workStyle().modes.length >= 2, label: "more than one kind of assessment graded" }
    ];
    const have = points.filter((p) => p.got).length;
    const level = have >= 5 ? "good" : have >= 3 ? "fair" : "thin";
    return { level, have, of: points.length, missing: points.filter((p) => !p.got).map((p) => p.label) };
  }

  /* ==================================================== recommendations == */

  /**
   * Ranked fields of study.
   *
   * The score is a weighted sum over subject strengths, then adjusted by work
   * style, stated interests and activities. Every term that moves the number
   * also pushes a sentence onto `reasons`, so the card can show its working —
   * a recommendation you can't interrogate is a horoscope.
   */
  function pathways() {
    const subjects = subjectProfile();
    const byId = {};
    subjects.forEach((s) => { byId[s.id] = s; });
    const style = workStyle();
    const acts = activitySignal();
    const stated = statedText();
    const cfg = conf();

    const scored = PATHWAYS.map((p) => {
      const reasons = [];
      let score = 0, weightUsed = 0;

      // Subject fit — the backbone of the score.
      const hits = [];
      Object.keys(p.weights).forEach((sid) => {
        const w = p.weights[sid];
        const s = byId[sid];
        if (!s) return;
        score += (s.score - 50) * w;
        weightUsed += w;
        hits.push({ label: s.label, score: s.score, w });
      });
      if (weightUsed > 0) score = score / weightUsed;
      hits.sort((a, b) => (b.score - 50) * b.w - (a.score - 50) * a.w);
      const strong = hits.filter((h) => h.score >= 55);
      const weak = hits.filter((h) => h.score <= 45);
      if (strong.length) {
        reasons.push({ kind: "grades", text: `Your strongest feeder subjects: ${strong.slice(0, 3).map((h) => h.label).join(", ")}.` });
      }
      if (weak.length && !strong.length) {
        reasons.push({ kind: "caution", text: `${weak.slice(0, 2).map((h) => h.label).join(" and ")} currently sit below your own average, and this field leans on them.` });
      }

      // Work style — how you're assessed vs how the field assesses.
      if (style.best && (p.modes || []).includes(style.best.id)) {
        score += 9;
        reasons.push({ kind: "style", text: `Assessed mostly the way you score best — ${style.best.label.toLowerCase()} (${style.best.pct}%, ${style.spread} points above your weakest mode).` });
      } else if (style.worst && (p.modes || []).includes(style.worst.id)) {
        score -= 6;
        reasons.push({ kind: "caution", text: `Leans on ${style.worst.label.toLowerCase()}, which is currently your weakest mode at ${style.worst.pct}%.` });
      }

      // Stated interests — weighted heavily, because someone telling you what
      // they want is better evidence than anything inferred from a gradebook.
      // Incidental text counts for a third of that and says where it came
      // from, so a loose keyword match can be recognised as one.
      if (p.interests && stated.stated && p.interests.test(stated.stated)) {
        score += 15;
        const hit = (stated.stated.match(p.interests) || [])[0];
        reasons.push({ kind: "interest", text: `Matches what you said you're interested in${hit ? ` — "${hit}"` : ""}.` });
      } else if (p.interests && stated.incidental && p.interests.test(stated.incidental)) {
        score += 5;
        const hit = (stated.incidental.match(p.interests) || [])[0];
        reasons.push({ kind: "interest", text: `Turned up in your goals, reading or application notes${hit ? ` — "${hit}"` : ""}. A weaker signal than telling it directly.` });
      }

      // Activities — corroboration that the interest survives contact with
      // a Tuesday afternoon.
      const matched = acts.filter((a) => p.activities && (p.activities.test(a.name) || p.activities.test(a.type)));
      if (matched.length) {
        const hrs = U.round(U.sum(matched, (m) => m.hours), 1);
        const lead = matched.find((m) => m.lead);
        score += U.clamp(6 + hrs / 8, 0, 14) + (lead ? 5 : 0);
        reasons.push({
          kind: "activity",
          text: lead
            ? `You're ${lead.role} of ${lead.name}${hrs ? ` — ${hrs} hours logged` : ""}. Leadership in a related activity is the part admissions actually reads.`
            : `${matched.map((m) => m.name).join(", ")}${hrs ? ` — ${hrs} hours logged` : ""}.`
        });
      }

      return {
        id: p.id, name: p.name, blurb: p.blurb, reality: p.reality,
        score: U.round(score, 1), reasons,
        electives: (p.electives || []).map((id) => ELECTIVE_BY_ID[id]).filter(Boolean)
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.filter((p) => !cfg.dismissed.includes("pw:" + p.id));
  }

  /**
   * Ranked electives for the chosen stage.
   *
   * Scored on the same subject profile, then boosted when the elective feeds
   * a highly-ranked field — the two lists have to agree, or the advice is
   * incoherent. Anything already on the timetable is filtered out; suggesting
   * a course someone is sitting in makes the whole feature look broken.
   */
  function electives() {
    const cfg = conf();
    // Real courses win outright when we have them: "ask whether your school
    // offers AP Statistics" is a much weaker thing to say than "your school
    // offers MATH-340 AP Statistics, and here is why it fits you".
    const catalogue = cfg.offered.length ? cfg.offered.map(offeredToElective) : ELECTIVES;
    const subjects = subjectProfile();
    const byId = {};
    subjects.forEach((s) => { byId[s.id] = s; });
    const style = workStyle();
    const top = pathways().slice(0, 3);
    const topIds = top.map((p) => p.id);
    const taken = (S.db.classes || []).map((c) => `${c.name || ""} ${c.code || ""}`.toLowerCase());

    return catalogue
      .filter((e) => e.stage === cfg.stage)
      .filter((e) => !cfg.dismissed.includes("el:" + e.id))
      // Don't recommend what's already on the timetable — suggesting a course
      // someone is sitting in makes the whole feature look like it isn't
      // reading their data. Titles here name alternatives ("AP Calculus AB or
      // BC", "Data science or AP Statistics"), so each alternative is checked
      // separately; a fixed-length prefix of the whole string matched neither.
      .filter((e) => !alreadyTaking(e.name, taken))
      .map((e) => {
        const reasons = [];
        let score = 40;

        const feeders = (e.subjects || []).map((sid) => byId[sid]).filter(Boolean);
        if (feeders.length) {
          const best = feeders.slice().sort((a, b) => b.score - a.score)[0];
          score += (best.score - 50) * 0.8;
          if (best.score >= 55) reasons.push({ kind: "grades", text: `${best.label} is one of your stronger areas (${best.grade != null ? best.grade + "%" : "no grade yet"}).` });
          else if (best.score <= 45) reasons.push({ kind: "caution", text: `${best.label} is currently below your own average — this would be a stretch, not a win.` });
        }

        if (style.best && (e.modes || []).includes(style.best.id)) {
          score += 10;
          reasons.push({ kind: "style", text: `Graded largely on ${style.best.label.toLowerCase()}, which is how you score best.` });
        }

        // Agreement with the field ranking above.
        const feeds = PATHWAYS.filter((p) => (p.electives || []).includes(e.id) && topIds.includes(p.id));
        if (feeds.length) {
          score += 12 + (topIds.indexOf(feeds[0].id) === 0 ? 5 : 0);
          reasons.push({ kind: "pathway", text: `Keeps ${feeds.map((f) => f.name).join(" and ")} open — currently your top match.` });
        }

        // A course the school actually lists is worth more than a generic
        // suggestion, and worth saying so on the card.
        if (e.real) {
          score += 8;
          reasons.push({ kind: "pathway", text: `Your school offers this${e.code ? ` as ${e.code}` : ""}.` });
        }

        return {
          id: e.id, name: e.name, why: e.why, opens: e.opens || [],
          real: !!e.real, code: e.code || "", level: e.level || "",
          score: U.round(score, 1), reasons
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Concrete things missing from the record, phrased as actions.
   *
   * Kept strictly to what the data can actually support. A gap the app can't
   * verify is a guess dressed as a warning, and it would be the first thing
   * to erode trust in everything above it.
   */
  function gaps() {
    const out = [];
    const cfg = conf();
    const subjects = subjectProfile();
    const byId = {};
    subjects.forEach((s) => { byId[s.id] = s; });

    if (cfg.stage !== "middle") {
      const lang = byId.language;
      const years = lang ? lang.classes.length : 0;
      if (!lang) {
        out.push({ level: "warn", title: "No world language on record",
          detail: "Selective colleges typically expect three to four years of one language. Nothing in your classes matches a language course — if you're taking one, add it so this stops flagging." });
      } else if (years < 2) {
        out.push({ level: "info", title: "Keep the language going",
          detail: `You have ${years} language ${years === 1 ? "class" : "classes"} on record. Four consecutive years of the same language is the level that reads as a differentiator.` });
      }
      const math = byId.math;
      if (math && math.relative != null && math.relative < -5) {
        out.push({ level: "warn", title: "Maths is your weakest relative subject",
          detail: `${math.grade}% — ${Math.abs(math.relative)} points below your own average. It gates engineering, CS, economics and the physical sciences, so it's worth propping up before it closes those doors rather than after.` });
      }
    }

    const style = workStyle();
    if (style.worst && style.spread >= 10) {
      out.push({ level: "info", title: `${style.worst.label} is costing you`,
        detail: `You average ${style.worst.pct}% on ${style.worst.label.toLowerCase()} against ${style.modes[0].pct}% on ${style.modes[0].label.toLowerCase()} — a ${style.spread}-point spread. That gap is worth closing directly, because most degrees assess both.` });
    }

    const acts = activitySignal();
    if (!acts.length) {
      out.push({ level: "warn", title: "No activities logged",
        detail: "Activities are half of what this reads. With none recorded, every recommendation below is coming from grades alone." });
    } else if (!acts.some((a) => a.lead)) {
      out.push({ level: "info", title: "No leadership role recorded",
        detail: "Depth beats breadth in applications, and a role — captain, editor, section lead — is how depth becomes legible. If you hold one, add it to the activity so it counts here." });
    }

    if (!cfg.interests.length) {
      out.push({ level: "info", title: "Tell it what you're interested in",
        detail: "Stated interests are weighted more heavily than anything inferred from a gradebook, because they're better evidence. Right now it has none to work from." });
    }

    if (cfg.stage === "high" && !(S.db.collegeApps || []).length && !cfg.targets.length) {
      out.push({ level: "info", title: "No target schools yet",
        detail: "Add a few in Applications, or list them here. Knowing where you're aiming changes which of these recommendations matters." });
    }

    return out;
  }

  /** Everything the recommendations were built from, for the evidence panel. */
  function evidence() {
    const study = studyByClass();
    return {
      subjects: subjectProfile(),
      style: workStyle(),
      activities: activitySignal(),
      confidence: confidence(),
      counts: {
        classes: (S.db.classes || []).length,
        graded: (S.db.assignments || []).filter((a) => a && a.graded && a.earned != null).length,
        studyMinutes: Math.round(U.sum(Object.keys(study), (k) => study[k])),
        notes: (S.db.notes || []).length,
        decks: (S.db.decks || []).length,
        books: (S.db.reading || []).length,
        activities: (S.db.activities || []).length,
        goals: (S.db.goals || []).length,
        applications: (S.db.collegeApps || []).length
      }
    };
  }

  const STAGES = [
    { id: "middle", label: "Middle school", picking: "which high-school track and electives to choose" },
    { id: "high",   label: "High school",   picking: "which courses to take and what to study after" },
    { id: "college",label: "College",       picking: "which major to declare" }
  ];

  return {
    SUBJECTS, MODES, ELECTIVES, PATHWAYS, STAGES, offeredToElective,
    subjectOf, modeOf,
    subjectProfile, workStyle, activitySignal, confidence,
    pathways, electives, gaps, evidence, trendFor
  };
})();
