/* ==========================================================================
   shop.js — study tokens, the four-tier catalogue, and what buying does

   Tokens are earned by doing the work the app already tracks: finishing a
   focus block, turning in an assignment, keeping a streak, drilling a deck,
   reading, hitting a goal. Nothing here can be bought with money and nothing
   is bought with a promise — every item changes something the app actually
   renders (an accent, an avatar frame, a dashboard banner, a title, an alarm
   voice) or hands over something real (a streak freeze, an earning boost).

   Four tiers, cheapest first:

     Common   40–120     the everyday unlocks
     Rare     150–350    a couple of good weeks
     Ultra    400–700    a term's worth of consistency
     Elite    800–1000   the long haul

   Earn rates are deliberately generous — an Elite item should be a stretch
   across a few weeks of real work, not a year of it. See RATES below.
   ========================================================================== */

App.shop = (function () {
  const S = App.store, U = App.utils;

  /* --------------------------------------------------------------- tiers */

  const TIERS = {
    common: { key: "common", label: "Common Tier",  order: 1, glyph: "◆",
              blurb: "Everyday unlocks — a block or two of focus each." },
    rare:   { key: "rare",   label: "Rare Tier",    order: 2, glyph: "◆◆",
              blurb: "A good week of work." },
    ultra:  { key: "ultra",  label: "Ultra Tier",   order: 3, glyph: "◆◆◆",
              blurb: "Weeks of consistency, not one good day." },
    elite:  { key: "elite",  label: "Elite Tier",   order: 4, glyph: "★",
              blurb: "The long haul. Four figures, and it shows." }
  };

  /* ------------------------------------------------------------ earning */

  /**
   * What each tracked action pays. `focusPerMin` is the backbone: a standard
   * 25-minute block is 75 tokens, so a Common item is one or two blocks, and
   * an Elite one is roughly a fortnight of daily focus plus the rest.
   */
  const RATES = {
    focusPerMin: 3,          // per minute actually spent in a focus block
    focusBlockBonus: 20,     // for letting a block run to the end
    assignmentDone: 45,      // first time an assignment is completed
    assignmentEarly: 25,     // extra, when it's done before the due date
    streakDay: 50,           // once a day, on the streak touch
    streakWeekBonus: 150,    // every 7th day
    flashcardCard: 3,        // per card reviewed
    quizRight: 5,            // per correct quiz answer
    readingSession: 30,      // per logged reading session
    goalComplete: 200,       // hitting a goal target
    habitCheck: 15           // ticking a habit for the day
  };

  /* ---------------------------------------------------------- the items */

  /**
   * slot        — what equipping it replaces (one worn item per slot)
   * consumable  — bought repeatedly, applied immediately, never worn
   * apply       — the real effect, run at purchase time for consumables
   */
  const ITEMS = [
    /* ---------------------------------------------------------- Common */
    { id: "sticker:star", tier: "common", price: 40, slot: "sticker", name: "Gold Star",
      icon: "⭐", desc: "A gold star beside your name, everywhere your name appears." },
    { id: "title:early-bird", tier: "common", price: 50, slot: "title", name: "Early Bird",
      icon: "🌅", desc: "Wear the title “Early Bird” on your profile.", title: "Early Bird" },
    { id: "title:note-taker", tier: "common", price: 50, slot: "title", name: "Note Taker",
      icon: "✍️", desc: "Wear the title “Note Taker” on your profile.", title: "Note Taker" },
    { id: "alarm:marimba", tier: "common", price: 60, slot: null, name: "Marimba Alarm",
      icon: "🎵", desc: "A soft three-note marimba when a focus block ends.", alarm: "marimba" },
    { id: "sticker:rocket", tier: "common", price: 60, slot: "sticker", name: "Rocket",
      icon: "🚀", desc: "A rocket beside your name." },
    { id: "alarm:arcade", tier: "common", price: 75, slot: null, name: "Arcade Alarm",
      icon: "🕹️", desc: "A short 8-bit victory blip when time's up.", alarm: "arcade" },
    { id: "frame:bronze", tier: "common", price: 80, slot: "frame", name: "Bronze Frame",
      icon: "🥉", desc: "A bronze ring around your avatar.", frame: "bronze" },
    { id: "theme:violet", tier: "common", price: 100, slot: "theme", name: "Violet Accent",
      icon: "🟣", desc: "Recolours buttons, links, and highlights violet.", accent: "violet" },
    { id: "theme:emerald", tier: "common", price: 110, slot: "theme", name: "Emerald Accent",
      icon: "🟢", desc: "Recolours buttons, links, and highlights emerald.", accent: "emerald" },
    { id: "boost:freeze", tier: "common", price: 120, slot: null, consumable: true, name: "Streak Freeze",
      icon: "🧊", desc: "Banks one streak freeze, so a missed day bridges instead of resetting.",
      apply: (db) => { db.streak.freezes = Math.min(9, (db.streak.freezes || 0) + 1); } },

    /* ------------------------------------------------------------ Rare */
    { id: "sticker:flame", tier: "rare", price: 150, slot: "sticker", name: "Blue Flame",
      icon: "🔥", desc: "The streak flame, in blue, beside your name." },
    { id: "alarm:zen", tier: "rare", price: 180, slot: null, name: "Zen Bowl Alarm",
      icon: "🎐", desc: "A long singing-bowl tone — the least startling way to end a block.", alarm: "zen" },
    { id: "title:deans-list", tier: "rare", price: 200, slot: "title", name: "Dean's List",
      icon: "📜", desc: "Wear the title “Dean's List”.", title: "Dean's List" },
    { id: "alarm:lofi", tier: "rare", price: 220, slot: null, name: "Lo-fi Tape Alarm",
      icon: "📼", desc: "A descending lo-fi chord when time's up.", alarm: "lofi" },
    { id: "frame:silver", tier: "rare", price: 250, slot: "frame", name: "Silver Frame",
      icon: "🥈", desc: "A silver ring around your avatar.", frame: "silver" },
    { id: "theme:sunset", tier: "rare", price: 260, slot: "theme", name: "Sunset Accent",
      icon: "🌇", desc: "A warm orange-to-pink accent across the app.", accent: "sunset" },
    { id: "banner:aurora", tier: "rare", price: 300, slot: "banner", name: "Aurora Banner",
      icon: "🌌", desc: "An aurora gradient behind your dashboard hero.", banner: "aurora" },
    { id: "boost:double", tier: "rare", price: 350, slot: null, consumable: true, name: "Double Tokens · 24h",
      icon: "✖️2", desc: "Everything you earn pays double for the next 24 hours.",
      apply: (db) => { addBoost(db, 2, 24); } },

    /* ----------------------------------------------------------- Ultra */
    { id: "title:scholar", tier: "ultra", price: 420, slot: "title", name: "Scholar",
      icon: "🎓", desc: "Wear the title “Scholar”.", title: "Scholar" },
    { id: "alarm:sunrise", tier: "ultra", price: 450, slot: null, name: "Sunrise Alarm",
      icon: "🌄", desc: "A rising four-note figure — hard to sleep through.", alarm: "sunrise" },
    { id: "sticker:crown", tier: "ultra", price: 480, slot: "sticker", name: "Crown",
      icon: "👑", desc: "A crown beside your name." },
    { id: "theme:midnight", tier: "ultra", price: 500, slot: "theme", name: "Midnight Accent",
      icon: "🌙", desc: "A deep indigo-blue accent, tuned for dark mode.", accent: "midnight" },
    { id: "frame:gold", tier: "ultra", price: 600, slot: "frame", name: "Gold Frame",
      icon: "🥇", desc: "A gold ring around your avatar.", frame: "gold" },
    { id: "banner:nebula", tier: "ultra", price: 650, slot: "banner", name: "Nebula Banner",
      icon: "🪐", desc: "A deep-space gradient behind your dashboard hero.", banner: "nebula" },
    { id: "boost:triple", tier: "ultra", price: 700, slot: null, consumable: true, name: "Triple Tokens · 48h",
      icon: "✖️3", desc: "Everything you earn pays triple for the next 48 hours.",
      apply: (db) => { addBoost(db, 3, 48); } },

    /* ----------------------------------------------------------- Elite */
    { id: "sticker:diamond", tier: "elite", price: 800, slot: "sticker", name: "Diamond",
      icon: "💎", desc: "A diamond beside your name. There is no higher sticker." },
    { id: "boost:vault", tier: "elite", price: 800, slot: null, consumable: true, name: "Streak Vault",
      icon: "🏦", desc: "Three streak freezes at once — a whole bad week survivable.",
      apply: (db) => { db.streak.freezes = Math.min(9, (db.streak.freezes || 0) + 3); } },
    { id: "alarm:fanfare", tier: "elite", price: 850, slot: null, name: "Champion Fanfare",
      icon: "🎺", desc: "A full fanfare when a block ends. Wear headphones.", alarm: "fanfare" },
    { id: "theme:obsidian", tier: "elite", price: 900, slot: "theme", name: "Obsidian Accent",
      icon: "⬛", desc: "A near-black accent with a bright edge. The rarest palette here.", accent: "obsidian" },
    { id: "banner:eclipse", tier: "elite", price: 950, slot: "banner", name: "Eclipse Banner",
      icon: "🌑", desc: "A total-eclipse gradient behind your dashboard hero.", banner: "eclipse" },
    { id: "frame:prismatic", tier: "elite", price: 1000, slot: "frame", name: "Prismatic Frame",
      icon: "🔮", desc: "An animated rainbow ring around your avatar.", frame: "prismatic" },
    { id: "title:valedictorian", tier: "elite", price: 1000, slot: "title", name: "Valedictorian",
      icon: "🏆", desc: "The top title in the shop.", title: "Valedictorian" }
  ];

  const BY_ID = {};
  ITEMS.forEach((it) => { BY_ID[it.id] = it; });

  function item(id) { return BY_ID[id] || null; }
  function items() { return ITEMS.slice(); }
  function tiers() { return Object.values(TIERS).sort((a, b) => a.order - b.order); }
  function byTier(tier) { return ITEMS.filter((i) => i.tier === tier).sort((a, b) => a.price - b.price); }
  function tierOf(id) { const it = item(id); return it ? TIERS[it.tier] : null; }

  /* ---------------------------------------------------------- the wallet */

  function wallet() { return S.db.wallet; }
  function balance() { return Math.max(0, Math.round(S.db.wallet.balance || 0)); }

  function addBoost(db, mult, hours) {
    db.boosts = (db.boosts || []).filter((b) => b.until > Date.now());
    db.boosts.push({ id: U.uid("bo"), mult, until: Date.now() + hours * 3600 * 1000 });
  }

  /** The strongest live multiplier, or 1. Expired boosts are swept lazily. */
  function multiplier() {
    const live = (S.db.boosts || []).filter((b) => b && b.until > Date.now());
    return live.reduce((m, b) => Math.max(m, Number(b.mult) || 1), 1);
  }

  function activeBoost() {
    const live = (S.db.boosts || []).filter((b) => b && b.until > Date.now())
      .sort((a, b) => b.mult - a.mult);
    return live[0] || null;
  }

  function ledger(n) { return (S.db.wallet.ledger || []).slice(0, n || 25); }

  /**
   * Credit tokens for something the student actually did.
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

    S.commit((db) => {
      db.wallet.balance = Math.max(0, Math.round((db.wallet.balance || 0) + total));
      db.wallet.earnedTotal = Math.round((db.wallet.earnedTotal || 0) + total);
      db.wallet.ledger.unshift({
        id: U.uid("lg"), n: total, reason: String(reason || "Earned"),
        mult: mult > 1 ? mult : undefined, at: Date.now()
      });
      // The ledger is a receipt, not an archive — 200 entries is more than
      // anyone scrolls, and it rides along in every sync payload.
      if (db.wallet.ledger.length > 200) db.wallet.ledger.length = 200;
      db.boosts = (db.boosts || []).filter((b) => b && b.until > Date.now());
    });

    if (!(opts && opts.silent) && App.ui) {
      App.ui.toast(`+${total} tokens`, reason + (mult > 1 ? ` · ${mult}× boost` : ""), "ok");
    }
    return total;
  }

  function owns(id) { return (S.db.inventory || []).some((r) => r && r.id === id); }

  function ownedCount(id) { return (S.db.inventory || []).filter((r) => r && r.id === id).length; }

  /**
   * Buy one item.
   * @returns {{ok: boolean, message?: string, item?: object}}
   */
  function buy(id) {
    const it = item(id);
    if (!it) return { ok: false, message: "That item isn't in the shop." };
    if (!it.consumable && owns(id)) return { ok: false, message: "You already own that." };
    if (balance() < it.price) {
      return { ok: false, message: `You need ${it.price - balance()} more tokens.` };
    }

    S.commit((db) => {
      db.wallet.balance = Math.round(db.wallet.balance - it.price);
      db.wallet.spentTotal = Math.round((db.wallet.spentTotal || 0) + it.price);
      db.wallet.ledger.unshift({ id: U.uid("lg"), n: -it.price, reason: "Bought " + it.name, at: Date.now() });
      if (db.wallet.ledger.length > 200) db.wallet.ledger.length = 200;

      db.inventory.push({ id: it.id, tier: it.tier, at: Date.now() });
      if (it.consumable && typeof it.apply === "function") it.apply(db);

      // An alarm voice is only useful once it's the one that plays, and a
      // worn slot with nothing in it is a purchase that visibly did nothing.
      // Both auto-equip on purchase; either can be changed afterwards.
      if (it.alarm) db.settings.pomodoro.alarm = it.alarm;
      if (it.slot) db.equipped[it.slot] = it.id;
    });
    applyCosmetics();
    return { ok: true, item: it };
  }

  /** Wear an owned item (or, with a null id, take the slot's item off). */
  function equip(id) {
    const it = item(id);
    if (!it || !owns(id)) return false;
    S.commit((db) => {
      if (it.slot) db.equipped[it.slot] = it.id;
      if (it.alarm) db.settings.pomodoro.alarm = it.alarm;
    });
    applyCosmetics();
    return true;
  }

  function unequip(slot) {
    S.commit((db) => { if (db.equipped[slot] !== undefined) db.equipped[slot] = null; });
    applyCosmetics();
    return true;
  }

  function equipped(slot) {
    const id = (S.db.equipped || {})[slot];
    return id ? item(id) : null;
  }

  /* ------------------------------------------------------- what it looks like */

  /**
   * Push the worn cosmetics onto the document. The accent shares [data-accent]
   * with the free palettes in Settings, so a shop accent and a built-in one are
   * the same mechanism — the shop just adds values that weren't selectable.
   */
  function applyCosmetics() {
    const html = document.documentElement;
    const theme = equipped("theme");
    const frame = equipped("frame");
    const banner = equipped("banner");

    // A shop accent overrides the Settings one only while it's worn; taking
    // it off must fall back to whatever the student picked there.
    if (theme && theme.accent) html.setAttribute("data-accent", theme.accent);
    else html.setAttribute("data-accent", S.settings.accent || "indigo");

    if (frame && frame.frame) html.setAttribute("data-frame", frame.frame);
    else html.removeAttribute("data-frame");

    if (banner && banner.banner) html.setAttribute("data-banner", banner.banner);
    else html.removeAttribute("data-banner");
  }

  /** The sticker + title worn beside a name, as ready-to-inject HTML. */
  function nameDecoration() {
    const sticker = equipped("sticker");
    const title = equipped("title");
    return {
      sticker: sticker ? sticker.icon : "",
      title: title && title.title ? title.title : "",
      html: (sticker ? `<span class="shop-sticker" aria-hidden="true">${sticker.icon}</span>` : "")
    };
  }

  /* ------------------------------------------------ progress to the next tier */

  /** What's affordable now, and what the next thing out of reach costs. */
  function affordability() {
    const bal = balance();
    const affordable = ITEMS.filter((i) => i.price <= bal && (i.consumable || !owns(i.id)));
    const next = ITEMS.filter((i) => i.price > bal && (i.consumable || !owns(i.id)))
      .sort((a, b) => a.price - b.price)[0] || null;
    return { affordable: affordable.length, next, shortBy: next ? next.price - bal : 0 };
  }

  /* -------------------------------------------------- store-side wiring */

  // Exposed on App.store so views and other modules reach them the same way
  // they reach every other piece of student data.
  S.tokenBalance = balance;
  S.awardTokens = award;
  S.ownsShopItem = owns;
  S.buyShopItem = buy;
  S.equipShopItem = equip;
  S.unequipShopSlot = unequip;
  S.equippedShopItem = equipped;
  S.tokenLedger = ledger;
  S.tokenMultiplier = multiplier;

  /**
   * Completing an assignment pays once, ever.
   *
   * Without the flag, marking done → reopening → marking done again is an
   * unbounded token faucet worked with two clicks — the same shape of bug as
   * the Start/Skip focus-block farm this codebase already had to fix.
   */
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

  // Daily streak pays on the same touch that advances it. touchStreak is
  // itself an override installed by store2.js, so this wraps that one.
  const baseTouch = S.touchStreak;
  S.touchStreak = function () {
    const before = S.db.streak.last;
    baseTouch();
    if (S.db.streak.last !== before) {
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

  // Cosmetics have to survive a theme flip, since toggling light/dark rewrites
  // the same attributes this sets.
  document.addEventListener("DOMContentLoaded", applyCosmetics);
  setTimeout(applyCosmetics, 0);

  return {
    TIERS, RATES, ITEMS,
    item, items, tiers, byTier, tierOf,
    wallet, balance, award, buy, owns, ownedCount, equip, unequip, equipped,
    ledger, multiplier, activeBoost, applyCosmetics, nameDecoration, affordability,
    sweepGoalPayouts
  };
})();
