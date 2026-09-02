/* ==========================================================================
   shop.js — F155 study tokens: earning them from the work the app can see
   AND from a photo of the work it can't, and the four-tier catalogue they buy.

   The honest framing, which the UI repeats rather than hides: nothing here
   can prove a student studied. A photo of a page of notes is evidence a
   person chose to show, on their own device, to their own copy of the app.
   What this module *can* do is stop the economy being farmed by the laziest
   routes — the same photo submitted twice, a screenshot of nothing, twelve
   submissions in one minute, an unbounded claim of hours — so that the
   number on the screen still means something to the person looking at it.

   The guards on a photo, all local:
     • a photo is required, and it is fingerprinted (64-bit average hash)
       before anything is credited. A near-identical photo is refused, and
       the fingerprint outlives the photo — deleting a proof never re-arms it.
     • an almost featureless image (a wall, a blank screen, a solid colour)
       carries no detail to hash and is refused for that reason.
     • minutes are bounded per submission, tokens are bounded per submission,
       and the day's earnings are capped.
     • submissions have a cooldown, so a stack of photos can't be dumped in
       one sitting for a day's worth of tokens.

   The second earning route needs none of those guards, because it isn't a
   claim: a focus block the timer measured, an assignment marked done, a
   streak day, a deck reviewed, pages read, a habit ticked, a goal reached.
   The app already recorded all of it. Those pay through award() below, are
   written to the wallet ledger with a reason, and are NOT capped — a cap
   belongs on what can be claimed, not on what has been observed. Their own
   anti-farm rules are narrower and live at the point of payment: an
   assignment pays once ever however often it is reopened, and a focus block
   pays for the minutes actually spent.

   Four tiers, cheapest first:

     Common   150–200    an evening
     Rare     300–450    a good week
     Ultra    500–750    weeks of consistency
     Elite    800–1000   the long haul

   Nothing here talks to a server, and nothing here costs money. Tokens, the
   catalogue, and what has been bought all live in the same local store as
   the rest of the app.
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
   * What a graded photo pays (F158).
   *
   * A photo used to be worth the number of minutes the student typed next to
   * it, which is to say: whatever they wanted. Now the model writes a short
   * quiz about the page and the score decides the payout, so `grades` is the
   * whole earning table and claimed time is not part of it at all.
   *
   * An A is deliberately pinned to `maxPerProof` — full marks on real work is
   * exactly what "the most one photo can pay" should mean. B is half, C a
   * quarter, and anything below half pays nothing while still logging the
   * study time.
   *
   * netlify/functions/assistant.js carries this same table and IS the payer;
   * these numbers are for the "what pays what" hint in the form. The client
   * is the side with a motive, so the server's answer wins on disagreement.
   */
  const RULES = {
    grades: { A: 100, B: 50, C: 25 },
    minMinutes: 5,            // the unverified path still needs a floor to log
    maxMinutes: 240,          // and a ceiling, however long a claim says
    maxPerProof: 100,         // an A, and the most any one photo can pay
    firstOfDayBonus: 25,      // showing up at all is the habit worth rewarding
    // Roughly three pieces of verified work. Was 200 when a photo paid for
    // claimed minutes; verified work is worth more than unverified work was.
    dailyCap: 250,            // ceiling on everything a PHOTO earns in one day
    cooldownMin: 10,          // minutes between submissions
    hashDistance: 5,          // ≤ this many differing bits = "the same photo"
    minDetail: 4,             // std-dev of the 8×8 grayscale; below this is blank
    maxPhotoDim: 1280,        // stored photos are downscaled to this on the long edge
    jpegQuality: 0.82,
    // Fingerprints kept for replay protection. Each is ~40 bytes, so this is
    // tens of kilobytes in a store that holds megabytes — and it is the one
    // number here with a real expiry attached: once a fingerprint rolls off
    // the end, that photo could be submitted again. A thousand covers well
    // over a year of daily use before the oldest one is at risk.
    seenLimit: 1000
  };

  /**
   * What the work the app can measure pays. These are not claims, so they are
   * not capped and need no photo — the app watched the timer run, saw the
   * assignment close, counted the cards.
   */
  const RATES = {
    focusPerMin: 3,          // per minute actually spent in a focus block
    focusBlockBonus: 20,     // for letting a block run to the end
    assignmentDone: 45,      // first time an assignment is completed, ever
    assignmentEarly: 25,     // extra, when it's done on or before the due date
    streakDay: 50,           // once a day, on the streak touch
    streakWeekBonus: 150,    // every 7th day
    flashcardCard: 3,        // per card reviewed, paid once per session
    readingSession: 30,      // per logged reading session
    goalComplete: 200,       // hitting a goal target, once per goal
    habitCheck: 15           // ticking today's habit box
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
      blurb: "Photograph the next thing straight away instead of waiting ten minutes.",
      apply: () => { hold("skip", 3); } },
    { id: "boost:retake",    kind: "boost", tier: "common", value: "retake", name: "Quiz retake", price: 175,
      consumable: true, max: 3,
      blurb: "One more attempt at a quiz you failed, so a blurry photo of real work isn't a wasted session.",
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
      db.wallet = { balance: 0, earned: 0, spent: 0, owned: [], daily: {}, seen: [], lastProofAt: 0 };
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

  function proofs() {
    const list = S.db.studyProofs;
    return Array.isArray(list) ? list : [];
  }

  /**
   * Every photo-verified study session, past or present. A photo itself is
   * discarded right after it pays out (there's no gallery any more), but the
   * study session it wrote is not — this is what "photos logged"-style
   * stats count instead, so the history survives even though the picture
   * doesn't.
   */
  function proofSessions() {
    const list = S.db.studySessions;
    return Array.isArray(list) ? list.filter((s) => s.kind === "proof") : [];
  }

  function earnedToday() {
    const d = wallet().daily[U.today()];
    return typeof d === "number" && isFinite(d) ? d : 0;
  }

  function remainingToday() { return Math.max(0, RULES.dailyCap - earnedToday()); }

  /**
   * Whole minutes left before another proof can be submitted; 0 when ready.
   *
   * The wait is capped at the cooldown itself rather than trusted from the
   * stored timestamp: that value syncs between a student's own devices, and a
   * phone whose clock is a day ahead would otherwise lock the laptop out for
   * a day. Skew shortens the wait at worst — it can't lengthen it.
   */
  function cooldownLeft() {
    const last = Number(wallet().lastProofAt) || 0;
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
    if (cooldownLeft() <= 0) return { ok: false, error: "There's nothing to skip — you can photograph now." };
    if (held("skip") < 1) return { ok: false, error: "You don't have a cooldown skip. The shop sells them." };
    S.commit(() => {
      const t = wallet();
      holdings().skip = held("skip") - 1;
      t.lastProofAt = 0;
      note(t, 0, "Used a cooldown skip");
    });
    return { ok: true };
  }

  // Reads studySessions rather than studyProofs: a proof's photo is
  // discarded the instant it pays out, so studyProofs never has more than
  // one entry alive at a time and can't answer "has today already had one."
  // The study session it wrote behind it is what persists.
  function firstToday() {
    return !proofSessions().some((p) => p.date === U.today());
  }

  /**
   * What a submission of `minutes` would pay right now, and why.
   *
   * Rendered live in the form as the student types, so the number they get
   * is never a surprise and the cap is never a silent subtraction.
   */
  // `serverTokens` is the authoritative per-grade amount the grading route
  // already computed — the client's own RULES.grades table is a preview
  // only, shown before a quiz exists to grade. Once a real grade comes back,
  // it decides the base; the client still applies the daily cap and the
  // first-of-day bonus, since the server doesn't hold wallet state to know
  // either of those. A tampered client can still lie about the grade
  // (nothing stops that without re-running the whole quiz server-side), but
  // it can no longer pay itself a different amount for the grade it reports.
  function quote(grade, serverTokens) {
    const base = serverTokens != null ? Math.max(0, Math.round(serverTokens)) : (RULES.grades[grade] || 0);
    const bonus = base > 0 && firstToday() ? RULES.firstOfDayBonus : 0;
    const wanted = base + bonus;
    const total = Math.min(wanted, remainingToday());
    return { grade: grade || null, base, bonus, wanted, total, capped: total < wanted };
  }

  /* ====================================================== photo fingerprint

     A 64-bit average hash: downscale to 8×8, grayscale, one bit per cell for
     "brighter than this image's mean". It is deliberately not cryptographic —
     the point is that a re-crop, a re-compress or a slightly different angle
     on the SAME page still collides, which is exactly the farming route worth
     closing. The std-dev of those 64 cells doubles as a detail measure: a
     photo of a blank wall has almost none.                                    */

  function fingerprint(img) {
    const N = 8;
    const canvas = document.createElement("canvas");
    canvas.width = N; canvas.height = N;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, N, N);
    const d = ctx.getImageData(0, 0, N, N).data;

    const gray = [];
    for (let i = 0; i < d.length; i += 4) {
      gray.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    }
    const mean = gray.reduce((a, b) => a + b, 0) / gray.length;
    const detail = Math.sqrt(gray.reduce((a, b) => a + (b - mean) * (b - mean), 0) / gray.length);

    let hash = "";
    for (let i = 0; i < gray.length; i += 4) {
      let nib = 0;
      for (let j = 0; j < 4; j++) if (gray[i + j] > mean) nib |= 1 << (3 - j);
      hash += nib.toString(16);
    }
    return { hash, detail };
  }

  const BITS = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

  /** Differing bits between two 16-nibble fingerprints; 64 when not comparable. */
  function distance(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return 64;
    let n = 0;
    for (let i = 0; i < a.length; i++) {
      const x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
      if (isNaN(x)) return 64;
      n += BITS[x];
    }
    return n;
  }

  /**
   * Has this photo (or one visually indistinguishable from it) been paid for
   * before? Checks the fingerprint ledger, not the proof list — a deleted
   * proof takes its photo with it but leaves its fingerprint behind, so
   * delete-and-resubmit is not a way to earn twice.
   */
  function seenBefore(hash) {
    return wallet().seen.some((s) => distance(s.h || s, hash) <= RULES.hashDistance);
  }

  /* ------------------------------------------------------- quiz attempts

     `seen` means "this photo has been paid for". That is not the same as
     "this photo has had its chance", and the difference is a hole: fail the
     quiz, close the dialog without saving, photograph the same page again,
     and the model writes a fresh set of questions. Nothing was spent, so
     nothing stopped it — and four options a question means guessing gets
     there eventually.

     So a second, separate ledger: a photo that has been *given* a quiz.
     Kept apart from `seen` rather than folded into it, because the two
     answer different questions and submit() depends on the old one meaning
     exactly what it always meant.                                          */

  function tried() {
    const t = wallet();
    if (!Array.isArray(t.tried)) t.tried = [];
    return t.tried;
  }

  /** Has this photo already been given a quiz? */
  function triedBefore(hash) {
    return tried().some((x) => distance(x.h || x, hash) <= RULES.hashDistance);
  }

  /** Record that it has. Called when the questions go on screen, not when they're answered. */
  function markTried(hash) {
    if (!hash || triedBefore(hash)) return;
    S.commit(() => {
      const list = tried();
      list.unshift({ h: hash, at: Date.now() });
      if (list.length > RULES.seenLimit) list.length = RULES.seenLimit;
    });
  }

  /* ------------------------------------------------------- image decoding */

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error("Choose a photo of the work you did."));
      if (file.type && !/^image\//.test(file.type)) {
        return reject(new Error("That file isn't an image — a photo or a screenshot works."));
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("That image couldn't be read. Try a JPEG or PNG."));
      };
      img.src = url;
    });
  }

  /** Downscale to a sane long edge and re-encode, so a 12 MP photo isn't stored raw. */
  function shrink(img) {
    let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (!w || !h) return Promise.reject(new Error("That image has no dimensions the browser can read."));
    const max = RULES.maxPhotoDim;
    if (w > max || h > max) {
      const scale = max / Math.max(w, h);
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
    }
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    return new Promise((resolve, reject) => {
      const done = (blob) => blob
        ? resolve({ blob, width: w, height: h })
        : reject(new Error("The photo couldn't be re-encoded on this device."));
      if (canvas.toBlob) canvas.toBlob(done, "image/jpeg", RULES.jpegQuality);
      else done(null);
    });
  }

  /* ========================================================= earning proof */

  /**
   * Inspect a photo without saving anything — the preview step in the form.
   * Resolves { hash, detail, duplicate, blank, width, height, blob }.
   */
  function inspect(file) {
    return loadImage(file).then((img) => {
      const fp = fingerprint(img);
      return shrink(img).then((small) => Object.assign({}, fp, small, {
        blank: fp.detail < RULES.minDetail,
        duplicate: seenBefore(fp.hash)
      }));
    });
  }

  /**
   * Record one study proof and pay for it.
   *
   * Rejects (with a message meant to be shown as-is) rather than silently
   * paying nothing, except at the daily cap: there the proof is still worth
   * recording as study time, so it saves and pays 0, and the caller says so.
   */
  function submit(opts) {
    const o = opts || {};
    // The server's graded result, or null when the quiz couldn't be run at
    // all. Null is the only route to a zero payout that still saves — see
    // the unverified path below.
    const v = o.verdict || null;
    const minutes = U.clamp(
      Math.round(Number(v ? v.estimatedMinutes : o.minutes) || 0), 0, RULES.maxMinutes);

    if (minutes < RULES.minMinutes) {
      return Promise.reject(new Error(`Log at least ${RULES.minMinutes} minutes — anything shorter isn't worth recording.`));
    }
    const wait = cooldownLeft();
    if (wait > 0) {
      return Promise.reject(new Error(`Next photo in ${wait} minute${wait === 1 ? "" : "s"}. Study happens between submissions, not during them.`));
    }

    return inspect(o.file).then((info) => {
      if (info.blank) {
        throw new Error("That photo is almost entirely one flat colour — photograph the actual work, not a wall or a blank screen.");
      }
      if (info.duplicate) {
        throw new Error("You've already earned tokens for this photo. Take a new one of what you did this time.");
      }

      // A ticket is issued for one photo. Without this check a student could
      // pass the quiz on a page of real work and then attach the receipt to
      // a screenshot of something else.
      if (v && v.hash && v.hash !== info.hash) {
        throw new Error("That quiz was for a different photo. Take a new one and try again.");
      }

      const q = v ? quote(v.grade, v.tokens) : { grade: null, base: 0, bonus: 0, wanted: 0, total: 0, capped: false };
      const photoId = U.uid("pf");

      return App.idb.put(photoId, info.blob).then(() => {
        // Decoding and storing a photo takes long enough that a second
        // submission started in the meantime would have passed the same
        // checks against the same wallet. Re-check what the first one would
        // have changed, now that it has, and drop the orphaned blob rather
        // than paying twice for one sitting.
        if (cooldownLeft() > 0 || seenBefore(info.hash)) {
          App.idb.del(photoId).catch(() => {});
          throw new Error("That photo has just been logged.");
        }

        const sessionId = U.uid("ss");
        const proof = {
          id: U.uid("pr"), at: Date.now(), date: U.today(),
          classId: o.classId || null, minutes, note: String(o.note || "").slice(0, 240),
          photoId, hash: info.hash, width: info.width, height: info.height,
          tokens: q.total, sessionId,
          // What the quiz said. The record itself is discarded right below —
          // there's no gallery to show it in any more — but these ride along
          // on the return value so the confirmation toast can say why a
          // session paid what it did, including when it paid nothing.
          grade: v ? v.grade : null,
          correct: v ? v.correct : null,
          total: v ? v.total : null,
          subject: v ? String(v.subject || "").slice(0, 60) : "",
          verified: !!v
        };

        S.commit((db) => {
          const t = wallet();
          if (!Array.isArray(db.studyProofs)) db.studyProofs = [];
          db.studyProofs.push(proof);
          // The proof is study that happened, so it belongs in the same log
          // the focus timer writes to — the heatmap, the weekly total and
          // the study goal all read that collection and would otherwise
          // ignore every hour spent away from the timer.
          db.studySessions.push({
            id: sessionId, classId: proof.classId, date: proof.date,
            minutes, kind: "proof", proofId: proof.id
          });
          t.balance += q.total;
          t.earned += q.total;
          t.daily[proof.date] = (t.daily[proof.date] || 0) + q.total;
          // The ledger is the receipt for a balance that moves. A graded
          // photo is the one earning path where the reason (which grade, on
          // what) is the only way to tell two identical amounts apart.
          if (q.total > 0) {
            note(t, q.total, `Study photo${v && v.grade ? " — grade " + v.grade : ""}` +
              (proof.subject ? ` · ${proof.subject}` : ""));
          }
          t.lastProofAt = proof.at;
          t.seen.unshift({ h: info.hash, at: proof.at });
          if (t.seen.length > RULES.seenLimit) t.seen.length = RULES.seenLimit;
          // Keep the daily ledger from growing without bound; only the
          // current day is ever read.
          const days = Object.keys(t.daily).sort();
          while (days.length > 60) delete t.daily[days.shift()];
        });

        // No gallery keeps photos around any more: a photo is taken, used
        // for the quiz, and discarded the moment it's been paid for. The
        // study session it wrote above is what survives — that's the record
        // that the work happened, and it's what any "photos logged"-style
        // stat now counts instead of the photo itself. The fingerprint
        // ledger (t.seen, just above) is untouched by this — it has nothing
        // to do with the gallery and still has to outlive the photo.
        discardProofPhoto(proof.id);

        return { proof, awarded: q.total, capped: q.capped, quote: q, verified: !!v };
      });
    });
  }

  /**
   * Discard a proof's photo the moment it's done its job — called
   * automatically by submit() right after a photo is graded. Only the photo
   * blob and the proof record go; the study session it wrote stays (that's
   * the record that the work happened), and so does the fingerprint (that's
   * what stops the same photo being resubmitted for a second payout).
   */
  function discardProofPhoto(id) {
    const p = proofs().find((x) => x.id === id);
    if (!p) return false;
    if (p.photoId) App.idb.del(p.photoId).catch(() => {});
    S.commit((db) => { db.studyProofs = db.studyProofs.filter((x) => x.id !== id); });
    return true;
  }

  /**
   * Delete a proof: the photo and the study session go, the tokens already
   * earned stay, and the fingerprint stays. Keeping the tokens is the honest
   * trade — they were earned when the work was done, and removing them would
   * punish someone for tidying up their own gallery. Keeping the fingerprint
   * is what stops that tidying being a way to get paid twice.
   */
  function deleteProof(id) {
    const p = proofs().find((x) => x.id === id);
    if (!p) return false;
    if (p.photoId) App.idb.del(p.photoId).catch(() => {});
    S.commit((db) => {
      db.studyProofs = db.studyProofs.filter((x) => x.id !== id);
      db.studySessions = db.studySessions.filter((s) => s.id !== p.sessionId && s.proofId !== p.id);
    });
    return true;
  }

  /* ============================================ ledger, boosts and earning */

  /**
   * Append one line to the wallet's receipt.
   *
   * The balance moves on its own now — a focus block ends, an assignment
   * closes, a streak ticks over — and a number that changes while you are
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
   * Credit tokens for work the app itself observed.
   *
   * No photo, no cap and no cooldown, because there is no claim to check: the
   * timer ran, the assignment closed, the cards were turned over. The guards
   * that matter for these live at each call site instead — see the two
   * overrides at the bottom of this file.
   *
   * @param {number} n      base amount, before any boost
   * @param {string} reason shown in the ledger — say what earned it
   * @param {object} [opts] `{ silent: true }` to skip the toast
   * @returns {number} what was actually credited
   */
  function award(n, reason, opts) {
    const base = Math.max(0, Math.round(Number(n) || 0));
    if (!base) return 0;
    const mult = multiplier();
    const total = Math.round(base * mult);

    S.commit(() => {
      const t = wallet();
      t.balance = Math.max(0, Math.round(t.balance + total));
      t.earned = Math.round((t.earned || 0) + total);
      note(t, total, reason, mult);
      t.boosts = (t.boosts || []).filter((b) => b && b.until > Date.now());
    });

    if (!(opts && opts.silent) && App.ui) {
      App.ui.toast(`+${total} tokens`, reason + (mult > 1 ? ` · ${mult}× boost` : ""), "ok");
    }
    return total;
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

  /* ================================================== paying for real work

     Everything below wires award() to work the app already records. Each hook
     carries its own anti-farm rule, because these are the routes a student
     can repeat at will:

       • an assignment pays ONCE, ever — `tokensPaid` on the record — so
         done → reopen → done is not a two-click faucet;
       • a focus block pays for the minutes actually spent (views/focus.js),
         so Start-then-Skip earns what it deserves and no more;
       • a habit pays for today's box only, once (views/goals.js);
       • a goal pays once, on the sweep below.                                */

  S.tokenBalance = balance;
  S.awardTokens = award;
  S.ownsShopItem = owns;
  S.tokenLedger = ledger;
  S.tokenMultiplier = multiplier;
  S.shopRates = RATES;

  const baseUpdate = S.update;
  S.update = function (coll, id, patch) {
    const before = coll === "assignments" ? (S.byId(coll, id) || {}).status : null;
    const rec = baseUpdate(coll, id, patch);
    if (coll === "assignments" && rec && before !== "done" && rec.status === "done" && !rec.tokensPaid) {
      rec.tokensPaid = true;
      const early = rec.due && U.today() <= rec.due;
      award(RATES.assignmentDone + (early ? RATES.assignmentEarly : 0),
        early ? `Finished “${rec.title}” before it was due` : `Finished “${rec.title}”`);
    }
    return rec;
  };

  // The daily streak pays on the same touch that advances it. touchStreak is
  // itself an override installed by store2.js, so this wraps that one.
  const baseTouch = S.touchStreak;
  S.touchStreak = function () {
    const before = S.db.streak.last;
    baseTouch();
    // Only a streak that CONTINUES pays. The touch that creates one fires on
    // first open, before the student has done anything at all, and an economy
    // that pays for launching the app is exactly the kind of number this
    // module exists to avoid — a fresh install starts at zero.
    if (before && S.db.streak.last !== before) {
      const week = S.db.streak.count > 0 && S.db.streak.count % 7 === 0;
      award(RATES.streakDay + (week ? RATES.streakWeekBonus : 0),
        week ? `${S.db.streak.count}-day streak — week bonus` : "Daily streak", { silent: !week });
    }
  };

  /**
   * A goal's progress is derived (GPA, study minutes, service hours…), so
   * there is no single mutation to hang a payout on. This sweeps after any
   * store change instead and pays once per goal, flagged on the record.
   *
   * `sweeping` guards the obvious loop: award() commits, a commit emits, and
   * an emit lands back here.
   */
  let sweeping = false;
  function sweepGoalPayouts() {
    if (sweeping || !S.db || !Array.isArray(S.db.goals)) return;
    sweeping = true;
    try {
      const done = S.db.goals.filter((g) => {
        if (!g || g.tokensPaid || !g.target) return false;
        const p = S.goalProgress(g);
        return p && p.current >= g.target;
      });
      if (done.length) {
        S.commit((db) => {
          done.forEach((g) => {
            const rec = db.goals.find((x) => x.id === g.id);
            if (rec) rec.tokensPaid = true;
          });
        });
        done.forEach((g) => award(RATES.goalComplete, `Goal reached — ${g.title}`));
      }
    } finally { sweeping = false; }
  }
  S.subscribe(sweepGoalPayouts);

  // Wallets written before the tiers existed are worth the same after them.
  redenominate();

  return {
    RULES, RATES, TIERS, SCALE, CATALOG, FREE_ACCENTS, FREE_ALARMS, SLOT,
    wallet, balance, item, items, kinds, kindLabel, owns, ownedCount, equipped, isEquipped,
    tiers, tierOf, byTier, slotValue,
    affordableCount, nextUp, proofs, earnedToday, remainingToday, cooldownLeft, firstToday,
    quote, fingerprint, distance, seenBefore, inspect, submit, deleteProof, discardProofPhoto,
    proofSessions,
    buy, equip, unequip, sanitize,
    award, ledger, multiplier, activeBoost, redenominate, sweepGoalPayouts,
    held, spendHeld, skipCooldown, triedBefore, markTried
  };
})();
