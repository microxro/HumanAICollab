/* ==========================================================================
   shop.js — F155 study tokens: earning them from a photo of real work, and
   the catalogue of cosmetics they buy.

   The honest framing, which the UI repeats rather than hides: nothing here
   can prove a student studied. A photo of a page of notes is evidence a
   person chose to show, on their own device, to their own copy of the app.
   What this module *can* do is stop the economy being farmed by the laziest
   routes — the same photo submitted twice, a screenshot of nothing, twelve
   submissions in one minute, an unbounded claim of hours — so that the
   number on the screen still means something to the person looking at it.

   The guards, all local:
     • a photo is required, and it is fingerprinted (64-bit average hash)
       before anything is credited. A near-identical photo is refused, and
       the fingerprint outlives the photo — deleting a proof never re-arms it.
     • an almost featureless image (a wall, a blank screen, a solid colour)
       carries no detail to hash and is refused for that reason.
     • minutes are bounded per submission, tokens are bounded per submission,
       and the day's earnings are capped.
     • submissions have a cooldown, so a stack of photos can't be dumped in
       one sitting for a day's worth of tokens.

   Nothing here talks to a server. Tokens, the catalogue, and what has been
   bought all live in the same local store as the rest of the app.
   ========================================================================== */

App.shop = (function () {
  const U = App.utils, S = App.store;

  /* ================================================================ rules */

  const RULES = {
    minutesPerToken: 15,   // 15 minutes of claimed study = 1 token
    minMinutes: 5,         // below this there is nothing worth photographing
    maxMinutes: 240,       // one submission cannot claim more than four hours
    maxPerProof: 4,        // …and cannot pay more than four tokens
    firstOfDayBonus: 1,    // showing up at all is the habit worth rewarding
    dailyCap: 8,           // ceiling on everything earned in one calendar day
    cooldownMin: 10,       // minutes between submissions
    hashDistance: 5,       // ≤ this many differing bits = "the same photo"
    minDetail: 4,          // std-dev of the 8×8 grayscale; below this is blank
    maxPhotoDim: 1280,     // stored photos are downscaled to this on the long edge
    jpegQuality: 0.82,
    // Fingerprints kept for replay protection. Each is ~40 bytes, so this is
    // tens of kilobytes in a store that holds megabytes — and it is the one
    // number here with a real expiry attached: once a fingerprint rolls off
    // the end, that photo could be submitted again. A thousand covers well
    // over a year of daily use before the oldest one is at risk.
    seenLimit: 1000
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
    /* ------------------------------------------------------------ titles */
    { id: "title:nightowl",  kind: "title", value: "Night Owl 🦉",  name: "Night Owl", price: 6,
      blurb: "A nameplate under your name in the sidebar." },
    { id: "title:earlybird", kind: "title", value: "Early Bird 🌅", name: "Early Bird", price: 6,
      blurb: "For the people who study before first period." },
    { id: "title:bookworm",  kind: "title", value: "Bookworm 📚",   name: "Bookworm", price: 8,
      blurb: "Worn by whoever finishes the reading list." },
    { id: "title:mathlete",  kind: "title", value: "Mathlete 📐",   name: "Mathlete", price: 8,
      blurb: "Earned one problem set at a time." },

    /* ------------------------------------------------------------- rings */
    { id: "ring:gold",   kind: "ring", value: "gold",   name: "Gold ring", price: 12,
      blurb: "A gold ring around your avatar.", preview: { a: "#d4a017", b: "#f2c94c" } },
    { id: "ring:neon",   kind: "ring", value: "neon",   name: "Neon glow", price: 14,
      blurb: "A glow in whatever accent colour you're wearing.", preview: { a: "#6366f1", b: "#a78bfa" } },
    { id: "ring:aurora", kind: "ring", value: "aurora", name: "Aurora ring", price: 16,
      blurb: "A rotating gradient — the loudest thing in the shop.", preview: { a: "#22d3ee", b: "#f472b6" } },

    /* ----------------------------------------------------------- accents */
    { id: "accent:violet",   kind: "accent", value: "violet",   name: "Violet", price: 18,
      blurb: "Buttons, links and charts in deep violet.", preview: { a: "#6d28d9", b: "#c4b5fd" } },
    { id: "accent:forest",   kind: "accent", value: "forest",   name: "Forest", price: 18,
      blurb: "A deep green accent, distinct from the teal one.", preview: { a: "#136b33", b: "#86efac" } },
    { id: "accent:ocean",    kind: "accent", value: "ocean",    name: "Ocean", price: 22,
      blurb: "Cool cyan-blue, all the way through the charts.", preview: { a: "#0c6780", b: "#67e8f9" } },
    { id: "accent:graphite", kind: "accent", value: "graphite", name: "Graphite", price: 22,
      blurb: "No colour at all. For people who want the data to be the only colour.",
      preview: { a: "#414a5c", b: "#b6bdca" } },

    /* ------------------------------------------------------------- skins */
    { id: "skin:parchment", kind: "skin", value: "parchment", name: "Parchment", price: 28,
      blurb: "Warm paper surfaces, in both light and dark mode.", preview: { a: "#fff1e7", b: "#231706" } },
    { id: "skin:glacier",   kind: "skin", value: "glacier",   name: "Glacier", price: 32,
      blurb: "Cold blue surfaces — light frost, or deep water at night.", preview: { a: "#eef3fe", b: "#051b2d" } },
    { id: "skin:orchid",    kind: "skin", value: "orchid",    name: "Orchid", price: 34,
      blurb: "Lilac by day, deep plum by night.", preview: { a: "#f2f2fe", b: "#230f39" } }
  ];

  // Which setting each kind lives in, and what "nothing equipped" looks like.
  // Equipping writes to settings rather than to a second copy inside the
  // wallet: settings is what applyShellPrefs() already reads, exports, and
  // syncs, and two sources of truth for "what am I wearing" is one too many.
  const SLOT = {
    accent: { key: "accent", none: "indigo" },
    skin:   { key: "skin", none: "none" },
    ring:   { key: "avatarRing", none: "none" },
    title:  { key: "nameplate", none: "" }
  };

  const KIND_LABEL = {
    title: "Nameplates", ring: "Avatar rings", accent: "Accent colours", skin: "Skins"
  };

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
  function kinds() { return ["title", "ring", "accent", "skin"]; }
  function kindLabel(kind) { return KIND_LABEL[kind] || kind; }
  function owns(id) { return wallet().owned.includes(id); }

  /** The item currently worn in a slot, or null. */
  function equipped(kind) {
    const slot = SLOT[kind];
    if (!slot) return null;
    const value = S.settings[slot.key];
    return CATALOG.find((i) => i.kind === kind && i.value === value) || null;
  }

  function isEquipped(id) {
    const it = item(id);
    return !!it && equipped(it.kind) === it;
  }

  /** Items you could buy right now — the number on the shop's nav badge. */
  function affordableCount() {
    return CATALOG.filter((i) => !owns(i.id) && i.price <= balance()).length;
  }

  function proofs() {
    const list = S.db.studyProofs;
    return Array.isArray(list) ? list : [];
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

  function firstToday() {
    return !proofs().some((p) => p.date === U.today());
  }

  /**
   * What a submission of `minutes` would pay right now, and why.
   *
   * Rendered live in the form as the student types, so the number they get
   * is never a surprise and the cap is never a silent subtraction.
   */
  function quote(minutes) {
    const m = U.clamp(Math.round(Number(minutes) || 0), 0, RULES.maxMinutes);
    const base = m < RULES.minMinutes ? 0
      : U.clamp(Math.floor(m / RULES.minutesPerToken), 1, RULES.maxPerProof);
    const bonus = base > 0 && firstToday() ? RULES.firstOfDayBonus : 0;
    const wanted = base + bonus;
    const total = Math.min(wanted, remainingToday());
    return { minutes: m, base, bonus, wanted, total, capped: total < wanted };
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
    const minutes = U.clamp(Math.round(Number(o.minutes) || 0), 0, RULES.maxMinutes);

    if (minutes < RULES.minMinutes) {
      return Promise.reject(new Error(`Claim at least ${RULES.minMinutes} minutes — anything shorter isn't worth a token.`));
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

      const q = quote(minutes);
      const photoId = U.uid("pf");

      return App.idb.put(photoId, info.blob).then(() => {
        // Decoding and storing a photo takes long enough that a second
        // submission started in the meantime would have passed the same
        // checks against the same wallet. Re-check what the first one would
        // have changed, now that it has, and drop the orphaned blob rather
        // than paying twice for one sitting.
        if (cooldownLeft() > 0 || seenBefore(info.hash)) {
          App.idb.del(photoId).catch(() => {});
          throw new Error("That photo has just been logged — check the gallery below.");
        }

        const sessionId = U.uid("ss");
        const proof = {
          id: U.uid("pr"), at: Date.now(), date: U.today(),
          classId: o.classId || null, minutes, note: String(o.note || "").slice(0, 240),
          photoId, hash: info.hash, width: info.width, height: info.height,
          tokens: q.total, sessionId
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
          t.lastProofAt = proof.at;
          t.seen.unshift({ h: info.hash, at: proof.at });
          if (t.seen.length > RULES.seenLimit) t.seen.length = RULES.seenLimit;
          // Keep the daily ledger from growing without bound; only the
          // current day is ever read.
          const days = Object.keys(t.daily).sort();
          while (days.length > 60) delete t.daily[days.shift()];
        });

        return { proof, awarded: q.total, capped: q.capped, quote: q };
      });
    });
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

  /* ======================================================== buying/wearing */

  function buy(id) {
    const it = item(id);
    if (!it) return { ok: false, error: "That item isn't in the shop." };
    if (owns(id)) return { ok: false, error: "You already own that." };
    if (balance() < it.price) {
      return { ok: false, error: `That costs ${it.price} tokens — you have ${balance()}.` };
    }
    S.commit((db) => {
      const t = wallet();
      t.balance -= it.price;
      t.spent += it.price;
      t.owned.push(id);
      db.settings[SLOT[it.kind].key] = it.value;   // bought is worn, immediately
    });
    App.applyShellPrefs && App.applyShellPrefs();
    return { ok: true, item: it };
  }

  function equip(id) {
    const it = item(id);
    if (!it || !owns(id)) return false;
    S.commit((db) => { db.settings[SLOT[it.kind].key] = it.value; });
    App.applyShellPrefs && App.applyShellPrefs();
    return true;
  }

  function unequip(kind) {
    const slot = SLOT[kind];
    if (!slot) return false;
    S.commit((db) => { db.settings[slot.key] = slot.none; });
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
    const s = S.settings;
    let changed = false;
    kinds().forEach((kind) => {
      const slot = SLOT[kind];
      const value = s[slot.key];
      if (value == null || value === slot.none) return;
      if (kind === "accent" && FREE_ACCENTS.includes(value)) return;
      const it = CATALOG.find((i) => i.kind === kind && i.value === value);
      if (!it || !owns(it.id)) { s[slot.key] = slot.none; changed = true; }
    });
    if (changed) S.saveQuiet();
    return changed;
  }

  return {
    RULES, CATALOG, FREE_ACCENTS, SLOT,
    wallet, balance, item, items, kinds, kindLabel, owns, equipped, isEquipped,
    affordableCount, proofs, earnedToday, remainingToday, cooldownLeft, firstToday,
    quote, fingerprint, distance, seenBefore, inspect, submit, deleteProof,
    buy, equip, unequip, sanitize
  };
})();
