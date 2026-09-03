/* ==========================================================================
   shop.js — F155/F160 study tokens: earning them from the work the app can
   see AND from a quiz on a topic you choose, and the four-tier catalogue
   they buy.

   The honest framing, which the UI repeats rather than hides: nothing here
   can prove a student studied. What this module *can* do is ask about the
   thing they say they studied, and pay for the answers. A quiz written after
   the topic is named, marked on the server, is not proof of an evening's
   work — but it is not nothing either, and it cannot be farmed by a person
   who did not read the material.

   Earning used to run through a photo of the work. The photo was always the
   weakest part of it: it needed a camera and paper, it sent a picture of a
   student's homework to an image model, and it proved nothing on its own —
   the quiz written about it did all the work. So the photo is gone, and the
   quiz is the whole route. The student names a topic, picks a difficulty,
   and answers five questions about it.

   The guards on a quiz:
     • the questions and the answer key are written server-side, and the key
       never reaches the browser (netlify/functions/assistant.js);
     • one grade per quiz — a ticket cannot be marked twice, so answering,
       reading which ones were wrong and re-submitting is not a route;
     • a topic pays full once a day, half the second time, and nothing after
       that, so grinding one easy topic all evening does not pay;
     • harder questions pay more, so the easy setting is not the rational
       choice;
     • quizzes have a cooldown, and the day's earnings are capped.

   The quiz is the ONLY way to earn. Finishing an assignment, keeping a
   streak, reviewing a deck, reading, ticking a habit and reaching a goal all
   used to pay too, and none of them do any more: every one of them was a
   button the student controls, so the number they added up to said "this
   student uses the app a lot", not "this student studied". One route, one
   rate card, one thing to be good at — and a balance that means the same
   thing however you got there.

   Four tiers, cheapest first:

     Common   150–200    an evening
     Rare     300–450    a good week
     Ultra    500–750    weeks of consistency
     Elite    800–1000   the long haul

   Nothing here talks to a server except the quiz, nothing here costs money.
   Tokens, the catalogue, and what has been bought all live in the same local
   store as the rest of the app.
   ========================================================================== */

App.shop = (function () {
  const U = App.utils, S = App.store;

  /* ================================================================ rules */

  /**
   * The denomination everything below is priced in.
   *
   * Tokens used to run 1 per 15 minutes, with items at 6–34 and a cap of 8 a
   * day. That is a fine economy right up until you want a top tier that reads
   * as an achievement — "34" does not, and neither does asking someone to
   * save four days for a nameplate. Everything (prices, rates, caps) is 25×
   * what it was, which changes no ratio and no attainability, and puts the
   * Elite tier at a number worth showing: 1000.
   *
   * A wallet written before the change is redenominated once, in sync with
   * the prices, so nobody's balance loses value overnight — see redenominate().
   */
  const SCALE = 25;

  /**
   * What a graded quiz pays (F160).
   *
   * A quiz used to be written about a photo, and before that a photo was
   * worth whatever number of minutes the student typed next to it. Now the
   * student names the topic, the model writes the questions, and the score
   * decides the payout — so `grades` is the whole earning table and claimed
   * time is not part of it at all.
   *
   * An A at medium difficulty is deliberately pinned to `maxPerQuiz` — full
   * marks on a real topic is exactly what "the most one quiz can pay" should
   * mean. B is half, C a quarter, and anything below half pays nothing while
   * still logging the minutes actually spent answering.
   *
   * netlify/functions/assistant.js carries the same grade bands and the same
   * difficulty multipliers, and IS the grader; these numbers are for the
   * "what pays what" hint in the form. The client is the side with a motive,
   * so the server's answer wins on disagreement.
   */
  const RULES = {
    grades: { A: 100, B: 50, C: 25 },
    // Harder questions pay more, because the alternative is an economy whose
    // rational move is five easy questions about the same thing forever.
    difficulty: { easy: 0.75, medium: 1, hard: 1.25 },
    difficultyOrder: ["easy", "medium", "hard"],
    maxPerQuiz: 100,          // an A at medium, and the most a normal quiz pays
    firstOfDayBonus: 25,      // showing up at all is the habit worth rewarding
    // Roughly three quizzes. The cap is on what a student can CLAIM to have
    // studied, and a quiz is still a claim — a well-answered one, but a claim.
    dailyCap: 250,            // ceiling on everything QUIZZES earn in one day
    cooldownMin: 10,          // minutes between quizzes
    // What the same topic pays, by how many quizzes on it have already been
    // paid for today: full, then half, then nothing. Studying one unit twice
    // in an evening is real; studying it six times for tokens is not.
    repeatFactors: [1, 0.5, 0],
    maxTopicLen: 80,          // the server clamps to this too
    minMinutes: 1,            // under a minute of answering isn't a study session
    maxMinutes: 240,          // and a tab left open overnight isn't four hours
    historyLimit: 200         // quizzes kept in the log, newest first
  };

  /** Tier bands, in tokens. An item's tier is checked against these. */
  const TIERS = {
    common: { key: "common", label: "Common Tier", order: 1, glyph: "◆", max: 200,
              blurb: "An evening's work each." },
    rare:   { key: "rare",   label: "Rare Tier",   order: 2, glyph: "◆◆", max: 450,
              blurb: "A good week." },
    ultra:  { key: "ultra",  label: "Ultra Tier",  order: 3, glyph: "◆◆◆", max: 750,
              blurb: "Weeks of consistency, not one good day." },
    elite:  { key: "elite",  label: "Elite Tier",  order: 4, glyph: "★", max: 1000,
              blurb: "The long haul. Four figures, and it shows." }
  };

  /* ============================================================ catalogue

     `kind` decides which setting an item writes to when equipped:
       accent → settings.accent   (the existing U09 brand ramp)
       skin   → settings.skin     (surface re-tint, layered over either theme)
       ring   → settings.avatarRing
       title  → settings.nameplate

     Accents and skins are CSS in theme.css; the ids below are exactly the
     [data-accent] / [data-skin] values there. `preview` carries the two
     colours the shop card paints, so a student sees the thing before paying
     for it. Prices are set against ~5 tokens on a normal school day: a title
     is an evening, an accent is most of a week, a skin is a fortnight.        */

  const CATALOG = [
    /* --------------------------------------------------------- Common tier */
    { id: "title:nightowl",  kind: "title", tier: "common", value: "Night Owl 🦉",  name: "Night Owl", price: 150,
      blurb: "A nameplate under your name in the sidebar." },
    { id: "title:earlybird", kind: "title", tier: "common", value: "Early Bird 🌅", name: "Early Bird", price: 150,
      blurb: "For the people who study before first period." },
    { id: "alarm:marimba",   kind: "alarm", tier: "common", value: "marimba", name: "Marimba alarm", price: 150,
      blurb: "A soft three-note marimba when a focus block ends." },
    { id: "alarm:arcade",    kind: "alarm", tier: "common", value: "arcade", name: "Arcade alarm", price: 175,
      blurb: "A short 8-bit victory blip when time's up." },
    { id: "title:bookworm",  kind: "title", tier: "common", value: "Bookworm 📚",   name: "Bookworm", price: 200,
      blurb: "Worn by whoever finishes the reading list." },
    { id: "title:mathlete",  kind: "title", tier: "common", value: "Mathlete 📐",   name: "Mathlete", price: 200,
      blurb: "Earned one problem set at a time." },
    { id: "boost:fifty",     kind: "boost", tier: "common", value: "fifty", name: "50/50", price: 100,
      consumable: true, max: 5,
      blurb: "Takes two wrong options off one quiz question. Banked until you need it.",
      apply: () => { hold("fifty", 5); } },
    { id: "boost:skip",      kind: "boost", tier: "common", value: "skip", name: "Cooldown skip", price: 150,
      consumable: true, max: 3,
      blurb: "Start the next quiz straight away instead of waiting ten minutes.",
      apply: () => { hold("skip", 3); } },
    { id: "boost:retake",    kind: "boost", tier: "common", value: "retake", name: "Quiz retake", price: 175,
      consumable: true, max: 3,
      blurb: "A fresh set of questions on a topic you just failed, so one bad quiz isn't a wasted evening.",
      apply: () => { hold("retake", 3); } },
    { id: "boost:freeze",    kind: "boost", tier: "common", value: "freeze", name: "Streak freeze", price: 200,
      consumable: true,
      blurb: "Banks one streak freeze, so a missed day bridges instead of resetting.",
      apply: (db) => { db.streak.freezes = Math.min(9, (db.streak.freezes || 0) + 1); } },

    /* ----------------------------------------------------------- Rare tier */
    { id: "ring:gold",   kind: "ring", tier: "rare", value: "gold",   name: "Gold ring", price: 300,
      blurb: "A gold ring around your avatar.", preview: { a: "#d4a017", b: "#f2c94c" } },
    { id: "alarm:zen",   kind: "alarm", tier: "rare", value: "zen", name: "Zen bowl alarm", price: 300,
      blurb: "A long singing-bowl tone — the least startling way to end a block." },
    { id: "ring:neon",   kind: "ring", tier: "rare", value: "neon",   name: "Neon glow", price: 350,
      blurb: "A glow in whatever accent colour you're wearing.", preview: { a: "#6366f1", b: "#a78bfa" } },
    { id: "alarm:lofi",  kind: "alarm", tier: "rare", value: "lofi", name: "Lo-fi tape alarm", price: 350,
      blurb: "A descending lo-fi chord when time's up." },
    { id: "ring:aurora", kind: "ring", tier: "rare", value: "aurora", name: "Aurora ring", price: 400,
      blurb: "A rotating gradient — the loudest thing in the shop.", preview: { a: "#22d3ee", b: "#f472b6" } },
    { id: "boost:double", kind: "boost", tier: "rare", value: "double", name: "Double tokens · 24h", price: 400,
      consumable: true,
      blurb: "Everything the app pays you doubles for the next 24 hours.",
      apply: (db) => { addBoost(db, 2, 24); } },
    { id: "accent:violet",   kind: "accent", tier: "rare", value: "violet",   name: "Violet", price: 450,
      blurb: "Buttons, links and charts in deep violet.", preview: { a: "#6d28d9", b: "#c4b5fd" } },
    { id: "accent:forest",   kind: "accent", tier: "rare", value: "forest",   name: "Forest", price: 450,
      blurb: "A deep green accent, distinct from the teal one.", preview: { a: "#136b33", b: "#86efac" } },

    /* ---------------------------------------------------------- Ultra tier */
    { id: "alarm:sunrise",   kind: "alarm", tier: "ultra", value: "sunrise", name: "Sunrise alarm", price: 500,
      blurb: "A rising four-note figure — hard to sleep through." },
    { id: "accent:ocean",    kind: "accent", tier: "ultra", value: "ocean",    name: "Ocean", price: 550,
      blurb: "Cool cyan-blue, all the way through the charts.", preview: { a: "#0c6780", b: "#67e8f9" } },
    { id: "accent:graphite", kind: "accent", tier: "ultra", value: "graphite", name: "Graphite", price: 550,
      blurb: "No colour at all. For people who want the data to be the only colour.",
      preview: { a: "#414a5c", b: "#b6bdca" } },
    { id: "skin:parchment",  kind: "skin", tier: "ultra", value: "parchment", name: "Parchment", price: 700,
      blurb: "Warm paper surfaces, in both light and dark mode.", preview: { a: "#fff1e7", b: "#231706" } },
    { id: "boost:triple",    kind: "boost", tier: "ultra", value: "triple", name: "Triple tokens · 48h", price: 750,
      consumable: true,
      blurb: "Everything the app pays you triples for the next 48 hours.",
      apply: (db) => { addBoost(db, 3, 48); } },

    /* ---------------------------------------------------------- Elite tier */
    { id: "skin:glacier",   kind: "skin", tier: "elite", value: "glacier",   name: "Glacier", price: 800,
      blurb: "Cold blue surfaces — light frost, or deep water at night.", preview: { a: "#eef3fe", b: "#051b2d" } },
    { id: "boost:vault",    kind: "boost", tier: "elite", value: "vault", name: "Streak vault", price: 800,
      consumable: true,
      blurb: "Three streak freezes at once — a whole bad week survivable.",
      apply: (db) => { db.streak.freezes = Math.min(9, (db.streak.freezes || 0) + 3); } },
    { id: "skin:orchid",    kind: "skin", tier: "elite", value: "orchid",    name: "Orchid", price: 850,
      blurb: "Lilac by day, deep plum by night.", preview: { a: "#f2f2fe", b: "#230f39" } },
    { id: "alarm:fanfare",  kind: "alarm", tier: "elite", value: "fanfare", name: "Champion fanfare", price: 900,
      blurb: "A full fanfare when a block ends. Wear headphones." },
    { id: "ring:prismatic", kind: "ring", tier: "elite", value: "prismatic", name: "Prismatic ring", price: 1000,
      blurb: "A rainbow that cycles through every accent in the app. The rarest ring there is.",
      preview: { a: "#e11d48", b: "#2563eb" } },
    { id: "title:valedictorian", kind: "title", tier: "elite", value: "Valedictorian 🏆", name: "Valedictorian", price: 1000,
      blurb: "The top nameplate in the shop. There is nothing above it." }
  ];

  // Which setting each kind lives in, and what "nothing equipped" looks like.
  // Equipping writes to settings rather than to a second copy inside the
  // wallet: settings is what applyShellPrefs() already reads, exports, and
  // syncs, and two sources of truth for "what am I wearing" is one too many.
  //
  // `under` is for a setting that isn't at the top level — the alarm voice
  // belongs to the timer's own settings block, and moving it out to sit
  // beside the cosmetics would split the timer's configuration in two.
  const SLOT = {
    accent: { key: "accent", none: "indigo" },
    skin:   { key: "skin", none: "none" },
    ring:   { key: "avatarRing", none: "none" },
    title:  { key: "nameplate", none: "" },
    alarm:  { key: "alarm", under: "pomodoro", none: "chime" }
  };

  const KIND_LABEL = {
    title: "Nameplates", ring: "Avatar rings", accent: "Accent colours",
    skin: "Skins", alarm: "Alarm sounds", boost: "Boosts"
  };

  // Alarm voices that ship with the app, the same way four accents do. The
  // list itself belongs to js/sound.js, which owns the voices; this mirrors
  // it only for the case where that module failed to load.
  const FREE_ALARMS = ["chime", "bell"];
  function alarmIsFree(value) {
    return App.sound && App.sound.isFree ? App.sound.isFree(value) : FREE_ALARMS.indexOf(value) >= 0;
  }

  // Accents that shipped with the app and were never bought. Settings still
  // offers these to everyone; the shop only sells what isn't in this list.
  const FREE_ACCENTS = ["indigo", "teal", "rose", "amber"];

  /* =============================================================== wallet */

  function wallet() {
    const db = S.db;
    // ensureV3 creates this, but a view can render during an import that
    // replaced the database wholesale, so this never assumes.
    if (!db.wallet || typeof db.wallet !== "object") {
      db.wallet = { balance: 0, earned: 0, spent: 0, owned: [], daily: {}, topics: {}, lastQuizAt: 0 };
    }
    const t = db.wallet;
    if (typeof t.balance !== "number" || !isFinite(t.balance)) t.balance = 0;
    if (!Array.isArray(t.owned)) t.owned = [];
    if (!Array.isArray(t.seen)) t.seen = [];
    if (!t.daily || typeof t.daily !== "object" || Array.isArray(t.daily)) t.daily = {};
    return t;
  }

  function balance() { return Math.max(0, Math.floor(wallet().balance)); }
  function item(id) { return CATALOG.find((i) => i.id === id) || null; }
  function items(kind) { return kind ? CATALOG.filter((i) => i.kind === kind) : CATALOG.slice(); }
  function kinds() { return ["title", "ring", "accent", "skin", "alarm", "boost"]; }
  function kindLabel(kind) { return KIND_LABEL[kind] || kind; }
  function owns(id) { return wallet().owned.includes(id); }
  /**
   * How many times `id` has been bought.
   *
   * `owned` records the fact of ownership once — it syncs, and a repeatable
   * item was appending a row per purchase forever. The count lives in its own
   * map instead. Wallets written before that change have the tally only in
   * `owned`, so both are consulted and the larger wins.
   */
  function ownedCount(id) {
    const t = wallet();
    const tallied = Number(t.bought && t.bought[id]) || 0;
    return Math.max(tallied, t.owned.filter((x) => x === id).length);
  }

  /* ------------------------------------------------------------- tiers -- */

  function tiers() { return Object.keys(TIERS).map((k) => TIERS[k]).sort((a, b) => a.order - b.order); }
  function tierOf(id) { const it = item(id); return it ? TIERS[it.tier] : null; }
  function byTier(tier) {
    return CATALOG.filter((i) => i.tier === tier).sort((a, b) => a.price - b.price);
  }

  /* ------------------------------------------------- reading a worn slot -- */

  // A slot's value is either a top-level setting or one inside a nested block
  // (the alarm voice lives in settings.pomodoro). Everything that reads or
  // writes a worn item goes through these two, so the nesting is stated once.
  function slotValue(kind) {
    const slot = SLOT[kind];
    if (!slot) return null;
    const bag = slot.under ? (S.settings[slot.under] || {}) : S.settings;
    return bag[slot.key];
  }

  function setSlot(db, kind, value) {
    const slot = SLOT[kind];
    if (!slot) return;
    if (slot.under) {
      if (!db.settings[slot.under] || typeof db.settings[slot.under] !== "object") db.settings[slot.under] = {};
      db.settings[slot.under][slot.key] = value;
    } else {
      db.settings[slot.key] = value;
    }
  }

  /** The item currently worn in a slot, or null. Boosts are used, not worn. */
  function equipped(kind) {
    if (!SLOT[kind]) return null;
    const value = slotValue(kind);
    return CATALOG.find((i) => i.kind === kind && i.value === value) || null;
  }

  function isEquipped(id) {
    const it = item(id);
    return !!it && equipped(it.kind) === it;
  }

  /**
   * Items you could buy right now — the number on the shop's nav badge.
   * A consumable always counts: owning one is not a reason not to buy another.
   */
  function affordableCount() {
    return CATALOG.filter((i) => (i.consumable || !owns(i.id)) && i.price <= balance()).length;
  }

  /** The next thing out of reach, and by how much. */
  function nextUp() {
    const bal = balance();
    const next = CATALOG.filter((i) => i.price > bal && (i.consumable || !owns(i.id)))
      .sort((a, b) => a.price - b.price)[0] || null;
    return next ? { item: next, shortBy: next.price - bal } : null;
  }

  /** Every quiz answered, newest last. The earning log and the gallery. */
  function quizzes() {
    const list = S.db.studyQuizzes;
    return Array.isArray(list) ? list : [];
  }

  function earnedToday() {
    const d = wallet().daily[U.today()];
    return typeof d === "number" && isFinite(d) ? d : 0;
  }

  /**
   * Today's ceiling.
   *
   * A live boost raises it in step with what it pays, because the two
   * together are the only honest reading of "everything doubles for 24
   * hours": a multiplier under a fixed cap doesn't double a day's earnings,
   * it just reaches the same ceiling in fewer quizzes, which is not what the
   * item says on the card and not worth its price.
   */
  function dailyCap() { return Math.round(RULES.dailyCap * multiplier()); }

  function remainingToday() { return Math.max(0, dailyCap() - earnedToday()); }

  /**
   * Whole minutes left before another quiz can be started; 0 when ready.
   *
   * The wait is capped at the cooldown itself rather than trusted from the
   * stored timestamp: that value syncs between a student's own devices, and a
   * phone whose clock is a day ahead would otherwise lock the laptop out for
   * a day. Skew shortens the wait at worst — it can't lengthen it.
   */
  function cooldownLeft() {
    const t = wallet();
    // lastProofAt is what wallets written before F160 called this. Reading
    // both means a student who just earned on the old photo route doesn't
    // get a free quiz the moment they reload into the new one.
    const last = Number(t.lastQuizAt || t.lastProofAt) || 0;
    if (!last) return 0;
    const window = RULES.cooldownMin * 60000;
    const left = Math.min(last + window - Date.now(), window);
    return left > 0 ? Math.ceil(left / 60000) : 0;
  }

  /**
   * Spend a banked skip to clear the wait.
   *
   * Deliberately explicit rather than folded into cooldownLeft(): a
   * consumable that spends itself the moment it would be useful is one a
   * student loses without deciding to. The count and the wait are read and
   * written in one commit so a double-click can't spend two.
   */
  function skipCooldown() {
    if (cooldownLeft() <= 0) return { ok: false, error: "There's nothing to skip — you can start a quiz now." };
    if (held("skip") < 1) return { ok: false, error: "You don't have a cooldown skip. The shop sells them." };
    S.commit(() => {
      const t = wallet();
      holdings().skip = held("skip") - 1;
      t.lastQuizAt = 0;
      t.lastProofAt = 0;
      note(t, 0, "Used a cooldown skip");
    });
    return { ok: true };
  }

  /**
   * Is this the first quiz of the day — the one that carries the bonus?
   *
   * Read off the wallet rather than off the quiz log, because the log can be
   * tidied: a student deleting this morning's quiz should not get the
   * first-of-the-day bonus a second time this afternoon.
   */
  function firstToday() {
    return wallet().lastQuizDay !== U.today();
  }

  /* --------------------------------------------------------- topic repeats

     A topic is free to choose, which is the whole point of it and also the
     obvious way to farm: name the one unit you know best, answer five easy
     questions about it, wait out the cooldown, do it again. So the same
     topic pays full once a day, half the second time and nothing after that.

     Matching is deliberately loose — case, spacing and punctuation are not
     what makes two topics the same, and "The French Revolution" typed twice
     with a stray comma is one topic by any honest reading.                  */

  function topicKey(topic) {
    return String(topic || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Today's tally of paid quizzes per topic, kept on the wallet.
   *
   * On the wallet and not derived from the quiz log for one reason: the log
   * is a list a student can delete from, and a tally that a delete resets is
   * not a tally. It is emptied on the first read of a new day, so it never
   * grows past one day's topics.
   */
  function paidTopics() {
    const t = wallet();
    if (!t.topics || typeof t.topics !== "object" || Array.isArray(t.topics)) t.topics = {};
    if (t.topicsDay !== U.today()) { t.topics = {}; t.topicsDay = U.today(); }
    return t.topics;
  }

  /**
   * How many quizzes on this topic have already been PAID for today.
   *
   * Failed attempts deliberately don't count: a student who got a C on the
   * mitochondria and went back to read it again should be paid properly for
   * the second attempt, and the cooldown already bounds how often they can.
   */
  function topicRepeats(topic) {
    const key = topicKey(topic);
    if (!key) return 0;
    const n = Number(paidTopics()[key]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  /**
   * What a quiz would pay right now, and why.
   *
   * Rendered live in the form before the questions are answered and again on
   * the result, so the number is never a surprise and neither the cap nor the
   * repeat rule is ever a silent subtraction.
   */
  function quote(grade, opts) {
    const o = opts || {};
    const difficulty = RULES.difficulty[o.difficulty] ? o.difficulty : "medium";
    const diffMult = RULES.difficulty[difficulty];
    const repeats = topicRepeats(o.topic);
    const factors = RULES.repeatFactors;
    const repeatFactor = factors[Math.min(repeats, factors.length - 1)];

    const base = RULES.grades[grade] || 0;
    const scored = Math.round(base * diffMult * repeatFactor);
    const bonus = scored > 0 && firstToday() ? RULES.firstOfDayBonus : 0;
    // A bought boost multiplies the payout. It is applied last, and to the
    // bonus as well, so "everything you earn doubles" is literally true.
    const mult = multiplier();
    const wanted = Math.round((scored + bonus) * mult);
    const total = Math.min(wanted, remainingToday());
    return {
      grade: grade || null, base, difficulty, diffMult,
      repeats, repeatFactor, scored, bonus, mult, wanted, total,
      capped: total < wanted
    };
  }

  /* ========================================================= earning a quiz */

  /**
   * Can a quiz be started right now?
   *
   * The cooldown is the only thing that stops one: the daily cap does not,
   * because a quiz over the cap is still worth answering and still worth
   * logging as study time — it just pays nothing, and the form says so.
   */
  function canStart() {
    const wait = cooldownLeft();
    if (wait > 0) {
      return { ok: false, error: `Next quiz in ${wait} minute${wait === 1 ? "" : "s"}. Study happens between quizzes, not during them.` };
    }
    return { ok: true };
  }

  /**
   * Record one answered quiz and pay for it.
   *
   * Synchronous, because nothing here leaves the device: the grading already
   * happened on the server and what arrives is the result. `opts.result` is
   * that response — grade, score, and the topic and difficulty read back off
   * the signed ticket rather than from anything the client typed.
   */
  function record(opts) {
    const o = opts || {};
    const g = o.result || {};
    const topic = String(g.topic || o.topic || "").replace(/\s+/g, " ").trim().slice(0, RULES.maxTopicLen);
    if (!topic) throw new Error("That quiz has no topic on it — start a new one.");

    const difficulty = RULES.difficulty[g.difficulty] ? g.difficulty
      : RULES.difficulty[o.difficulty] ? o.difficulty : "medium";
    // Minutes are MEASURED — the time between the questions going on screen
    // and the answers coming back — not claimed. That is the only reason
    // they are allowed anywhere near the study log.
    const minutes = U.clamp(Math.round(Number(o.minutes) || 0), 0, RULES.maxMinutes);
    const q = quote(g.grade, { topic, difficulty });

    const quiz = {
      id: U.uid("qz"), at: Date.now(), date: U.today(),
      classId: o.classId || null,
      topic,
      subject: String(g.subject || "").slice(0, 60),
      difficulty,
      correct: Number(g.correct) || 0,
      total: Number(g.total) || 0,
      grade: g.grade || "—",
      tokens: q.total,
      repeats: q.repeats,
      minutes,
      note: String(o.note || "").slice(0, 240),
      sessionId: minutes >= RULES.minMinutes ? U.uid("ss") : null
    };

    S.commit((db) => {
      const t = wallet();
      if (!Array.isArray(db.studyQuizzes)) db.studyQuizzes = [];
      db.studyQuizzes.push(quiz);
      // Keep the log a log rather than an archive; the wallet ledger and the
      // study sessions are the long-lived records.
      while (db.studyQuizzes.length > RULES.historyLimit) db.studyQuizzes.shift();

      // Answering a quiz is study, so it belongs in the same collection the
      // rest of the app reads for the heatmap, the weekly total and the study
      // goal — but only the minutes actually spent on it, and only when that
      // is a real number of minutes.
      if (quiz.sessionId) {
        db.studySessions.push({
          id: quiz.sessionId, classId: quiz.classId, date: quiz.date,
          minutes, kind: "quiz", quizId: quiz.id
        });
      }

      t.balance += q.total;
      t.earned += q.total;
      t.daily[quiz.date] = (t.daily[quiz.date] || 0) + q.total;
      // The ledger is the receipt for a balance that moves. A quiz is the one
      // earning path where the reason (which grade, on what) is the only way
      // to tell two identical amounts apart.
      if (q.total > 0) {
        note(t, q.total, `Quiz — grade ${quiz.grade} · ${topic}`, q.mult);
        // Only a PAID quiz burns the topic — see topicRepeats().
        const key = topicKey(topic);
        const tally = paidTopics();
        if (key) tally[key] = (Number(tally[key]) || 0) + 1;
      }
      t.lastQuizAt = quiz.at;
      t.lastQuizDay = quiz.date;    // what firstToday() reads
      t.lastProofAt = quiz.at;      // kept in step for a wallet synced to an older build
      // Keep the daily ledger from growing without bound; only the current
      // day is ever read.
      const days = Object.keys(t.daily).sort();
      while (days.length > 60) delete t.daily[days.shift()];
    });

    return { quiz, awarded: q.total, capped: q.capped, quote: q };
  }

  /**
   * Delete a quiz from the log: the record and its study session go, the
   * tokens already earned stay. Keeping the tokens is the honest trade — they
   * were earned when the questions were answered, and removing them would
   * punish someone for tidying up their own history.
   *
   * What deleting does NOT do is re-arm the topic or the first-of-the-day
   * bonus: both are counted on the wallet, not derived from this list, so
   * tidying up is never a way to be paid full price twice for one topic.
   */
  function deleteQuiz(id) {
    const q = quizzes().find((x) => x.id === id);
    if (!q) return false;
    S.commit((db) => {
      db.studyQuizzes = db.studyQuizzes.filter((x) => x.id !== id);
      db.studySessions = db.studySessions.filter((s2) => s2.id !== q.sessionId && s2.quizId !== q.id);
    });
    return true;
  }

  /* ============================================ ledger, boosts and earning */

  /**
   * Append one line to the wallet's receipt.
   *
   * The balance moves on its own now — an assignment closes, a streak ticks
   * over, a deck is reviewed — and a number that changes while you are
   * looking somewhere else has to be able to say why.
   */
  function note(t, n, reason, mult) {
    if (!Array.isArray(t.ledger)) t.ledger = [];
    t.ledger.unshift({ id: U.uid("lg"), n, reason: String(reason || ""), mult: mult > 1 ? mult : undefined, at: Date.now() });
    if (t.ledger.length > 200) t.ledger.length = 200;   // a receipt, not an archive
  }

  function ledger(n) { return (wallet().ledger || []).slice(0, n || 25); }

  /* ------------------------------------------------------ held consumables

     A timed boost (double tokens for 24h) starts working the moment it is
     bought, so buying it is the whole transaction. These three are different:
     they sit in the wallet until a specific moment arrives — the quiz you
     just failed, the cooldown you are staring at — so they need a count, and
     a way to spend one.                                                      */

  function holdings() {
    const t = wallet();
    if (!t.consumables || typeof t.consumables !== "object" || Array.isArray(t.consumables)) {
      t.consumables = {};
    }
    return t.consumables;
  }

  /** How many of `key` are banked. */
  function held(key) {
    const n = Number(holdings()[key]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  /** Bank one, up to `max`. Called from a catalogue item's apply(). */
  function hold(key, max) {
    const c = holdings();
    c[key] = Math.min(max, held(key) + 1);
  }

  /**
   * Spend one, if there is one. Returns whether it was spent, so a caller can
   * tell "used a retake" from "had none" without reading the count twice and
   * racing itself between the two reads.
   */
  function spendHeld(key) {
    if (held(key) < 1) return false;
    S.commit(() => {
      const c = holdings();
      c[key] = held(key) - 1;
      note(wallet(), 0, "Used " + HELD_LABEL[key]);
    });
    return true;
  }

  const HELD_LABEL = { retake: "a quiz retake", skip: "a cooldown skip", fifty: "a 50/50" };

  function addBoost(db, mult, hours) {
    const t = wallet();
    t.boosts = (t.boosts || []).filter((b) => b && b.until > Date.now());
    t.boosts.push({ id: U.uid("bo"), mult, until: Date.now() + hours * 3600 * 1000 });
  }

  /** The strongest live multiplier, or 1. Expired boosts are swept lazily. */
  function multiplier() {
    return (wallet().boosts || [])
      .filter((b) => b && b.until > Date.now())
      .reduce((m, b) => Math.max(m, Number(b.mult) || 1), 1);
  }

  function activeBoost() {
    return (wallet().boosts || [])
      .filter((b) => b && b.until > Date.now())
      .sort((a, b) => b.mult - a.mult)[0] || null;
  }

  /**
   * Bring a wallet written in the old denomination up to this one.
   *
   * Prices went up 25× in the same change that added the tiers. A balance
   * saved before that would have lost 96% of its purchasing power overnight,
   * which is not a thing to do to someone who earned it — so the balance,
   * the totals and the day's cap usage are all multiplied by the same factor,
   * once, flagged on the wallet so it can never run twice.
   */
  function redenominate() {
    const t = wallet();
    if (t.scale === SCALE) return false;
    const from = t.scale || 1;                 // 0/undefined means the original 1× wallet
    const factor = SCALE / from;
    if (factor !== 1) {
      S.commit(() => {
        t.balance = Math.round(t.balance * factor);
        t.earned = Math.round((t.earned || 0) * factor);
        t.spent = Math.round((t.spent || 0) * factor);
        Object.keys(t.daily || {}).forEach((d) => { t.daily[d] = Math.round(t.daily[d] * factor); });
        t.scale = SCALE;
        if (t.balance > 0) note(t, 0, `Tokens redenominated ×${factor} — prices moved with them`);
      });
    } else {
      S.commit(() => { t.scale = SCALE; });
    }
    return factor !== 1;
  }

  /* ======================================================== F161 gem chests

     Every seventh day of a streak drops a gem chest, and the chest has a
     rarity: Common, Rare, Ultra or Elite — the same four bands the catalogue
     is priced in, so "an Ultra chest" already means something to anyone who
     has looked at the shop.

     A chest holds an ITEM of its rarity, never tokens. That is the whole
     reason it can exist at all: tokens are minted in one place, for a quiz
     the server marked (see record()), and a chest that paid currency would
     be a second mint dressed up as a present. An item is a different thing —
     it is the reward, not a way to buy one.

     The rarity is rolled, and the odds improve the longer the streak runs.
     A first week is mostly Common and cannot be Elite at all; past two
     months the odds are weighted the other way. Every eighth chest is at
     least Ultra, so a long streak has a floor and not just better luck.

     A streak is the one thing in this app that cannot be rushed: 49 days is
     49 days, whatever a student does with their evenings. That is what makes
     it safe to reward with items when nothing else here gives anything away.
     ======================================================================== */

  /**
   * Rarity weights by streak week. The bands are deliberately coarse — a
   * student should be able to read "week 9, so Ultra is likely" off the card
   * without arithmetic.
   */
  const CHEST_ODDS = [
    { upTo: 3,        weights: { common: 70, rare: 25, ultra: 5,  elite: 0 } },
    { upTo: 7,        weights: { common: 45, rare: 35, ultra: 17, elite: 3 } },
    { upTo: Infinity, weights: { common: 25, rare: 35, ultra: 28, elite: 12 } }
  ];

  /** Every Nth chest is at least Ultra, so two months of streak has a floor. */
  const CHEST_FLOOR_EVERY = 8;
  const CHEST_FLOOR_TIER = "ultra";

  function chests() {
    const t = wallet();
    if (!Array.isArray(t.chests)) t.chests = [];
    return t.chests;
  }

  function unopenedChests() { return chests().filter((c) => c && !c.opened); }

  /**
   * The odds a chest for `week` is rolled against, after the milestone floor
   * has been applied. Returned rather than kept private because the card that
   * offers the chest shows them — an unstated drop rate is the part of a loot
   * box worth being suspicious of, and there is no reason for it here.
   */
  function chestOdds(week) {
    const w = Math.max(1, Math.floor(Number(week) || 1));
    const band = CHEST_ODDS.find((b) => w <= b.upTo).weights;
    const floored = w % CHEST_FLOOR_EVERY === 0;
    const floorOrder = floored ? TIERS[CHEST_FLOOR_TIER].order : 0;

    const weights = {};
    let total = 0;
    Object.keys(TIERS).forEach((k) => {
      const n = TIERS[k].order >= floorOrder ? band[k] : 0;
      weights[k] = n;
      total += n;
    });
    // A band whose whole range is below the floor would leave nothing to roll
    // against. None does today; this is here so a future edit to the table
    // cannot silently produce a chest with no rarity.
    if (total <= 0) { weights[CHEST_FLOOR_TIER] = 1; total = 1; }
    return { week: w, weights, total, floored };
  }

  /** Roll one rarity. `rnd` is injectable so a test can pin the outcome. */
  function rollChestRarity(week, rnd) {
    const odds = chestOdds(week);
    const roll = (typeof rnd === "function" ? rnd() : Math.random()) * odds.total;
    let seen = 0;
    const keys = Object.keys(TIERS).sort((a, b) => TIERS[a].order - TIERS[b].order);
    for (const k of keys) {
      seen += odds.weights[k];
      if (roll < seen) return k;
    }
    return keys[keys.length - 1];
  }

  /**
   * Put a chest in the wallet for `week`.
   *
   * Called from the streak touch below, and directly by nothing else. The
   * week is recorded on the wallet as well as on the chest so a second touch
   * — a reload, another device syncing the same day — cannot grant twice.
   */
  function grantChest(week, opts) {
    const o = opts || {};
    const w = Math.max(1, Math.floor(Number(week) || 1));
    const rarity = TIERS[o.rarity] ? o.rarity : rollChestRarity(w, o.rnd);
    const chest = { id: U.uid("ch"), at: Date.now(), week: w, rarity, opened: false, itemId: null };

    S.commit(() => {
      const t = wallet();
      chests().unshift(chest);
      if (chests().length > 60) chests().length = 60;
      t.lastChestWeek = Math.max(Number(t.lastChestWeek) || 0, w);
      note(t, 0, `${TIERS[rarity].label.replace(" Tier", "")} chest — ${w * 7}-day streak`);
    });
    return chest;
  }

  /**
   * What a chest of this rarity would give: something not owned first, and a
   * consumable when the tier is exhausted.
   *
   * Escalating through the other tiers matters more than it looks. A student
   * who has bought the whole Rare tier should still get something from a Rare
   * chest, and "nothing, you own it all" is the one outcome a reward for 49
   * days of work must never have.
   */
  function chestReward(rarity, rnd) {
    const pick = (list) => list[Math.floor((typeof rnd === "function" ? rnd() : Math.random()) * list.length)] || null;
    const order = Object.keys(TIERS).sort((a, b) => TIERS[a].order - TIERS[b].order);
    const start = TIERS[rarity] ? order.indexOf(rarity) : 0;
    // The chest's own tier first, then up (a better prize is a fine
    // consolation), then down.
    const search = [order[start], ...order.slice(start + 1), ...order.slice(0, start).reverse()];

    for (const tier of search) {
      const pool = byTier(tier);
      const fresh = pool.filter((i) => !i.consumable && !owns(i.id));
      if (fresh.length) return pick(fresh);
    }
    for (const tier of search) {
      const usable = byTier(tier).filter((i) => i.consumable && !(i.max && held(i.value) >= i.max));
      if (usable.length) return pick(usable);
    }
    return null;
  }

  /**
   * Open one. The item goes on straight away, exactly as a bought one does,
   * and the chest keeps what it held so the history reads as a record rather
   * than a list of anonymous boxes.
   */
  function openChest(id, opts) {
    const chest = chests().find((c) => c.id === id);
    if (!chest) return { ok: false, error: "That chest isn't in your wallet." };
    if (chest.opened) return { ok: false, error: "That chest is already open." };

    const it = chestReward(chest.rarity, opts && opts.rnd);
    if (!it) return { ok: false, error: "There is nothing left in the shop to put in it." };

    S.commit((db) => {
      const t = wallet();
      const rec = chests().find((c) => c.id === id);
      if (rec) { rec.opened = true; rec.openedAt = Date.now(); rec.itemId = it.id; }
      if (!t.owned.includes(it.id)) t.owned.push(it.id);
      if (!t.bought || typeof t.bought !== "object" || Array.isArray(t.bought)) t.bought = {};
      t.bought[it.id] = (Number(t.bought[it.id]) || 0) + 1;
      // Zero tokens, deliberately: the ledger records what a chest gave, not
      // a payment, because a chest never pays.
      note(t, 0, `${TIERS[chest.rarity].label.replace(" Tier", "")} chest — ${it.name}`);
      if (it.consumable) { if (typeof it.apply === "function") it.apply(db); }
      else setSlot(db, it.kind, it.value);
    });
    App.applyShellPrefs && App.applyShellPrefs();
    return { ok: true, chest: chests().find((c) => c.id === id) || chest, item: it };
  }

  /** Days until the next chest, and which week it will be. */
  function nextChest() {
    const count = (S.db.streak && S.db.streak.count) || 0;
    const week = Math.floor(count / 7) + 1;
    return { week, inDays: week * 7 - count };
  }

  /* ======================================================== buying/wearing */

  function buy(id) {
    const it = item(id);
    if (!it) return { ok: false, error: "That item isn't in the shop." };
    if (!it.consumable && owns(id)) return { ok: false, error: "You already own that." };
    // A disabled button is a hint, not a rule — the shop grid can be stale by
    // the time a click lands, and this is the only place that actually spends.
    if (it.max && held(it.value) >= it.max) {
      return { ok: false, error: `You're holding the most ${it.name.toLowerCase()}s you can (${it.max}). Use one first.` };
    }
    if (balance() < it.price) {
      return { ok: false, error: `That costs ${it.price} tokens — you have ${balance()}.` };
    }
    S.commit((db) => {
      const t = wallet();
      t.balance -= it.price;
      t.spent += it.price;
      // A consumable can be bought again and again, and `owned` syncs — so
      // record the fact of ownership once and keep the tally separately,
      // rather than appending a row per purchase forever.
      if (!t.owned.includes(id)) t.owned.push(id);
      if (!t.bought || typeof t.bought !== "object" || Array.isArray(t.bought)) t.bought = {};
      t.bought[id] = (Number(t.bought[id]) || 0) + 1;
      note(t, -it.price, "Bought " + it.name);
      // A consumable is spent the moment it's bought; everything else is worn.
      if (it.consumable) { if (typeof it.apply === "function") it.apply(db); }
      else setSlot(db, it.kind, it.value);
    });
    App.applyShellPrefs && App.applyShellPrefs();
    return { ok: true, item: it };
  }

  function equip(id) {
    const it = item(id);
    if (!it || it.consumable || !owns(id)) return false;
    S.commit((db) => { setSlot(db, it.kind, it.value); });
    App.applyShellPrefs && App.applyShellPrefs();
    return true;
  }

  function unequip(kind) {
    const slot = SLOT[kind];
    if (!slot) return false;
    S.commit((db) => { setSlot(db, kind, slot.none); });
    App.applyShellPrefs && App.applyShellPrefs();
    return true;
  }

  /**
   * Take off anything that isn't owned.
   *
   * A backup restored from another device, or a hand-edited export, can name
   * a skin or a nameplate whose purchase isn't in this wallet. Without this
   * the CSS would happily paint it, and the shop would show "Buy" for
   * something already on screen. Called from applyShellPrefs(), which runs
   * on boot and after every preference change.
   */
  function sanitize() {
    let changed = false;
    kinds().forEach((kind) => {
      const slot = SLOT[kind];
      if (!slot) return;                       // boosts are used, never worn
      const value = slotValue(kind);
      if (value == null || value === slot.none) return;
      if (kind === "accent" && FREE_ACCENTS.includes(value)) return;
      if (kind === "alarm" && alarmIsFree(value)) return;
      const it = CATALOG.find((i) => i.kind === kind && i.value === value);
      if (!it || !owns(it.id)) { setSlot(S.db, kind, slot.none); changed = true; }
    });
    if (changed) S.saveQuiet();
    return changed;
  }

  /* ============================================ what the rest of the app sees

     Read-only, all of it. There is deliberately no `awardTokens` here any
     more: the shop used to hand every other module a way to pay, and the
     modules used it — a finished assignment, a streak day, a reviewed deck, a
     reading session, a ticked habit, a reached goal. Each was defensible on
     its own and together they were most of the economy, earned by pressing
     buttons in an app rather than by knowing anything.

     Tokens are minted in exactly one place now: record(), above, for a quiz
     the server marked.                                                       */

  // One line, because one thing outside this module needs it: the focus
  // timer asks whether an alarm voice was bought before it offers it.
  S.ownsShopItem = owns;

  /* ------------------------------------------------- the streak's chest --

     The one hook this module still installs on the rest of the app, and the
     only thing it does is hand over a box. It cannot mint a token, which is
     what makes it a different animal from the payouts that used to live
     here — see the note above.

     touchStreak is itself an override installed by store2.js, so this wraps
     that one rather than store.js's.                                       */

  const baseTouch = S.touchStreak;
  S.touchStreak = function () {
    const before = S.db.streak.last;
    baseTouch();
    // Only a streak that CONTINUES earns a chest. The touch that creates one
    // fires on first open, before the student has done anything at all.
    if (!before || S.db.streak.last === before) return;

    const count = S.db.streak.count || 0;
    if (count <= 0 || count % 7 !== 0) return;
    const week = count / 7;
    // The same week can be reached twice — a reload, a second device syncing
    // the same day — and a chest per reload is not a reward.
    if ((Number(wallet().lastChestWeek) || 0) >= week) return;

    const chest = grantChest(week);
    if (App.ui) {
      App.ui.toast(`${TIERS[chest.rarity].glyph} ${TIERS[chest.rarity].label.replace(" Tier", "")} chest`,
        `${count} days straight. It's waiting in the study shop.`, "ok");
    }
  };

  // Wallets written before the tiers existed are worth the same after them.
  redenominate();

  return {
    RULES, TIERS, SCALE, CATALOG, FREE_ACCENTS, FREE_ALARMS, SLOT, CHEST_ODDS,
    wallet, balance, item, items, kinds, kindLabel, owns, ownedCount, equipped, isEquipped,
    tiers, tierOf, byTier, slotValue,
    affordableCount, nextUp, quizzes, earnedToday, dailyCap, remainingToday, cooldownLeft, firstToday,
    topicKey, topicRepeats, quote, canStart, record, deleteQuiz,
    buy, equip, unequip, sanitize,
    ledger, multiplier, activeBoost, redenominate,
    chests, unopenedChests, chestOdds, rollChestRarity, grantChest, chestReward, openChest, nextChest,
    held, spendHeld, skipCooldown
  };
})();
