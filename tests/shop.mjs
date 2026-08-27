/* ==========================================================================
   tests/shop.mjs — study tokens: what they cost, what they buy, what cannot
   be used to farm them — and the three things that landed alongside them.

   Half of this is an economy, and an economy nobody can cheat is the only
   kind worth showing a number for. The interesting cases are all refusals:
   the same photo twice, a photo of nothing, a second photo thirty seconds
   later, a claim of nine hours, a skin equipped that was never bought, an
   assignment closed and reopened for a second payout.

   The other half is a promise made in css/theme.css: a bought skin re-tints
   the surfaces at matched luminance, so every contrast ratio in the app is
   what it was before. That is asserted here against the stylesheet itself,
   because a future hand-picked hex is exactly how a promise like that dies.

   Part 4 covers what arrived with the tiers: a student working with no linked
   parent or teacher, a class that meets outside the bell schedule, and the
   focus timer's Custom segment and its alarm.
   ========================================================================== */

import { readFileSync } from "node:fs";
import zlib from "node:zlib";
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const BASE = process.env.BASE || "http://localhost:8899";
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

/* ============================================ part 1: the contrast promise */

const css = readFileSync("css/theme.css", "utf8");

const hexToRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const relLum = (h) => hexToRgb(h)
  .map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); })
  .reduce((a, c, i) => a + [0.2126, 0.7152, 0.0722][i] * c, 0);
const ratio = (a, b) => {
  const l1 = relLum(a), l2 = relLum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

/** Pull the declarations out of one CSS rule, by exact selector text. */
function block(selector) {
  const i = css.indexOf(selector + " {");
  if (i < 0) return null;
  const body = css.slice(i + selector.length + 2, css.indexOf("}", i));
  const out = {};
  body.split(";").forEach((decl) => {
    const m = decl.match(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})/);
    if (m) out[m[1]] = m[2].toLowerCase();
  });
  return out;
}

const LIGHT_SURFACES = ["#ffffff", "#f6f7fb", "#f1f3f9", "#e8ebf4"];
const DARK_SURFACES = ["#0c0f17", "#141926", "#1b2130", "#242c3d"];
const SHOP_ACCENTS = ["violet", "forest", "ocean", "graphite"];
const SHOP_SKINS = ["parchment", "glacier", "orchid"];

console.log("\nshop: every bought accent is readable in both themes");
for (const a of SHOP_ACCENTS) {
  const light = block(`[data-accent="${a}"]`);
  const dark = block(`[data-theme="dark"][data-accent="${a}"]`);
  if (!light || !dark) { ok(`${a}: both blocks defined`, false); continue; }

  const worstLight = Math.min(...LIGHT_SURFACES.map((s) => ratio(light["--brand-600"], s)));
  ok(`${a}: brand-600 as text on every light surface`, worstLight >= 4.5, worstLight.toFixed(2));
  ok(`${a}: brand-600 on its own brand-50`, ratio(light["--brand-600"], light["--brand-50"]) >= 4.5,
     ratio(light["--brand-600"], light["--brand-50"]).toFixed(2));
  ok(`${a}: white text on the primary button`, ratio("#ffffff", light["--brand-600"]) >= 4.5,
     ratio("#ffffff", light["--brand-600"]).toFixed(2));

  const worstDark = Math.min(...DARK_SURFACES.map((s) => ratio(light["--brand-300"], s)));
  ok(`${a}: brand-300 as text on every dark surface`, worstDark >= 4.5, worstDark.toFixed(2));
  ok(`${a}: brand-300 on the dark brand-50`, ratio(light["--brand-300"], dark["--brand-50"]) >= 4.5,
     ratio(light["--brand-300"], dark["--brand-50"]).toFixed(2));
}

console.log("\nshop: a bought skin re-tints surfaces without moving any contrast ratio");
{
  const baseLight = block(":root");
  const baseDark = block('[data-theme="dark"]');
  const SURF = ["--bg", "--surface", "--surface-2", "--surface-3", "--border", "--border-strong"];

  for (const skin of SHOP_SKINS) {
    for (const [mode, base] of [["light", baseLight], ["dark", baseDark]]) {
      const b = block(`[data-theme="${mode}"][data-skin="${skin}"]`);
      if (!b) { ok(`${skin}/${mode}: block defined`, false); continue; }
      let worst = 0, culprit = "";
      for (const tok of SURF) {
        if (!b[tok] || !base[tok]) continue;
        const drift = Math.abs(relLum(b[tok]) - relLum(base[tok]));
        if (drift > worst) { worst = drift; culprit = tok; }
      }
      // 0.006 of relative luminance moves any ratio in the app by well under
      // 2% — far from the difference between passing and failing 4.5:1.
      ok(`${skin}/${mode}: luminance preserved on every surface`, worst <= 0.006,
         `${culprit} drifted ${worst.toFixed(4)}`);
    }
  }
}

/* ================================================ part 2: images to submit */

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
}

/** Minimal truecolour PNG — no dependencies, and the app has to decode it. */
function png(size, pixel) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;                       // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y);
      raw[o++] = r; raw[o++] = g; raw[o++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const mulberry = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** A blocky, seeded pattern: different seeds hash far apart, same seed matches. */
function noisePhoto(seed) {
  const size = 64, cells = 8, step = size / cells;
  const rnd = mulberry(seed);
  const grid = Array.from({ length: cells * cells }, () => Math.floor(rnd() * 256));
  return png(size, (x, y) => {
    const v = grid[Math.floor(y / step) * cells + Math.floor(x / step)];
    return [v, v, v];
  });
}
const flatPhoto = () => png(64, () => [128, 128, 128]);

const file = (name, buffer) => ({ name, mimeType: "image/png", buffer });

/* =============================================== part 3: the app behaviour */

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(600);
const skip = page.locator("[data-skip]");
if (await skip.count()) { await skip.click(); await page.waitForTimeout(250); }

await page.evaluate(() => App.router.go("shop"));
await page.waitForTimeout(300);

const wallet = () => page.evaluate(() => ({
  balance: App.shop.balance(),
  earned: App.store.db.wallet.earned,
  owned: App.store.db.wallet.owned.slice(),
  proofs: App.shop.proofs().length,
  sessions: App.store.db.studySessions.length,
  seen: App.store.db.wallet.seen.length
}));

/** Fill in the photo modal and submit; resolves once the modal settles. */
async function submitPhoto(buffer, minutes, name) {
  await page.locator("[data-add-proof]").first().click();
  await page.waitForTimeout(200);
  await page.locator("[data-proof-file]").setInputFiles(file(name || "study.png", buffer));
  await page.waitForTimeout(400);            // inspect() decodes and fingerprints
  await page.locator("#proofMinutes").fill(String(minutes));
  await page.locator('.modal-root button[type="submit"]').click();
  await page.waitForTimeout(600);
}
const modalOpen = () => page.locator(".modal-root").count().then((n) => n > 0);
const modalError = () => page.locator("[data-proof-error]:not([hidden])").first()
  .textContent().catch(() => "");
async function closeModal() {
  if (await modalOpen()) {
    await page.locator(".modal-root [data-close]").first().click();
    await page.waitForTimeout(200);
  }
}
// The cooldown is real time; tests are not allowed to wait ten minutes for it.
const clearCooldown = () => page.evaluate(() => {
  App.store.commit((db) => { db.wallet.lastProofAt = 0; });
});

console.log("\nshop: the view renders and starts empty");
{
  ok("shop view painted", await page.locator(".page-inner h1").first().textContent()
     .then((t) => /Study shop/.test(t)));
  const w = await wallet();
  ok("balance starts at zero", w.balance === 0, String(w.balance));
  ok("no proofs yet", w.proofs === 0);
}

console.log("\nshop: the photo dialog is usable without a mouse");
{
  await page.locator("[data-add-proof]").first().click();
  await page.waitForTimeout(250);
  const dlg = await page.evaluate(() => {
    const modal = document.querySelector(".modal-root [role=dialog]");
    const input = document.querySelector("[data-proof-file]");
    input.focus();
    return {
      dialog: !!modal && modal.getAttribute("aria-modal") === "true",
      labelled: !!(modal && modal.getAttribute("aria-labelledby")),
      // A file input hidden with display:none is unreachable by keyboard;
      // this one is offscreen-but-focusable on purpose.
      focusable: document.activeElement === input,
      labelText: (input.getAttribute("aria-label") || "").length > 0
    };
  });
  ok("the modal is a real dialog", dlg.dialog && dlg.labelled);
  ok("the file input takes keyboard focus", dlg.focusable);
  ok("and is labelled for a screen reader", dlg.labelText);
  await closeModal();
}

console.log("\nshop: a photo of real work earns tokens and logs the study time");
{
  const before = await wallet();
  await submitPhoto(noisePhoto(1), 45);
  const after = await wallet();
  ok("modal closed on success", !(await modalOpen()));
  // 45 minutes = 75 tokens, plus 25 for the first photo of the day.
  ok("awarded 75 + 25 first-of-day", after.balance === 100, `balance ${after.balance}`);
  ok("proof recorded", after.proofs === before.proofs + 1);
  ok("study session logged alongside it", after.sessions === before.sessions + 1);
  const kind = await page.evaluate(() => App.store.db.studySessions.slice(-1)[0].kind);
  ok("session is tagged as proof", kind === "proof", kind);
  ok("thumbnail rendered from IndexedDB",
     await page.locator(".proof-thumb img").count() === 1);
}

console.log("\nshop: the same photo never pays twice");
{
  await clearCooldown();
  const before = await wallet();
  await submitPhoto(noisePhoto(1), 45);
  ok("modal stayed open", await modalOpen());
  ok("refusal explains itself", /already earned/i.test(await modalError()));
  const after = await wallet();
  ok("balance unchanged", after.balance === before.balance, `${before.balance} → ${after.balance}`);
  ok("no second proof recorded", after.proofs === before.proofs);
  await closeModal();
}

console.log("\nshop: a photo of nothing is refused");
{
  await clearCooldown();
  const before = await wallet();
  await submitPhoto(flatPhoto(), 60);
  ok("modal stayed open", await modalOpen());
  ok("refusal names the reason", /one flat colour/i.test(await modalError()));
  ok("balance unchanged", (await wallet()).balance === before.balance);
  await closeModal();
}

console.log("\nshop: photos can't be dumped in one sitting");
{
  const before = await wallet();
  // No clearCooldown() here — the previous successful submission set it.
  await page.evaluate(() => App.store.commit((db) => { db.wallet.lastProofAt = Date.now(); }));
  await submitPhoto(noisePhoto(2), 30);
  ok("modal stayed open", await modalOpen());
  ok("refusal gives the wait", /Next photo in \d+ minute/i.test(await modalError()));
  ok("balance unchanged", (await wallet()).balance === before.balance);
  await closeModal();
}

console.log("\nshop: a claim is bounded, however long it says");
{
  const q = await page.evaluate(() => ({
    huge: App.shop.quote(9999),
    tiny: App.shop.quote(2),
    normal: App.shop.quote(60)
  }));
  ok("nine hours pays the per-photo maximum", q.huge.base === 100, JSON.stringify(q.huge));
  ok("minutes are clamped to the daily maximum", q.huge.minutes === 240, String(q.huge.minutes));
  ok("two minutes pays nothing", q.tiny.base === 0, JSON.stringify(q.tiny));
  ok("an hour also reaches it", q.normal.base === 100, JSON.stringify(q.normal));
}

console.log("\nshop: the daily cap holds, and says so instead of failing");
{
  await clearCooldown();
  await page.evaluate(() => App.store.commit((db) => {
    db.wallet.daily[App.utils.today()] = App.shop.RULES.dailyCap;
  }));
  const before = await wallet();
  ok("quote is zero at the cap", await page.evaluate(() => App.shop.quote(60).total) === 0);
  await submitPhoto(noisePhoto(3), 60);
  const after = await wallet();
  ok("the photo still saved", after.proofs === before.proofs + 1);
  ok("but paid nothing", after.balance === before.balance, `${before.balance} → ${after.balance}`);
  ok("and the study time still counted", after.sessions === before.sessions + 1);
  await page.evaluate(() => App.store.commit((db) => { db.wallet.daily = {}; }));
}

console.log("\nshop: deleting a proof keeps the tokens and keeps the photo spent");
{
  const before = await wallet();
  const removed = await page.evaluate(() => {
    const p = App.shop.proofs()[0];
    App.shop.deleteProof(p.id);
    return p.id;
  });
  await page.waitForTimeout(200);
  const after = await wallet();
  ok("the proof is gone", after.proofs === before.proofs - 1, removed);
  ok("the tokens it earned are still yours", after.balance === before.balance);
  ok("its session went with it", after.sessions === before.sessions - 1);
  ok("its fingerprint stayed behind", after.seen === before.seen);

  // …and the deleted photo still can't be resubmitted for a second payout.
  await clearCooldown();
  await submitPhoto(noisePhoto(1), 45);
  ok("resubmitting the deleted photo is refused", /already earned/i.test(await modalError()));
  ok("balance still unchanged", (await wallet()).balance === after.balance);
  await closeModal();
}

console.log("\nshop: buying, wearing and taking off");
{
  await page.evaluate(() => App.store.commit((db) => { db.wallet.balance = 2000; }));
  await page.evaluate(() => { App.views.shop && App.router.refresh(); });
  await page.locator('[data-tab="shop"]').click();
  await page.waitForTimeout(250);

  const before = await wallet();
  await page.locator('[data-buy="skin:glacier"]').click();
  await page.waitForTimeout(200);
  await page.locator(".modal-root [data-ok]").click();
  await page.waitForTimeout(300);

  const after = await wallet();
  ok("tokens were deducted", after.balance === before.balance - 800, `${before.balance} → ${after.balance}`);
  ok("the item is owned", after.owned.includes("skin:glacier"));
  ok("and it went on immediately",
     await page.evaluate(() => document.documentElement.getAttribute("data-skin")) === "glacier");

  await page.locator('[data-unequip="skin"]').click();
  await page.waitForTimeout(300);
  ok("taking it off clears the attribute",
     await page.evaluate(() => document.documentElement.getAttribute("data-skin")) === null);
  ok("but it stays owned", (await wallet()).owned.includes("skin:glacier"));

  await page.locator('[data-equip="skin:glacier"]').click();
  await page.waitForTimeout(300);
  ok("and can be put back on for free",
     await page.evaluate(() => document.documentElement.getAttribute("data-skin")) === "glacier"
     && (await wallet()).balance === after.balance);
}

console.log("\nshop: an accent bought here reaches Settings and the rest of the app");
{
  await page.evaluate(() => App.shop.buy("accent:violet"));
  await page.waitForTimeout(200);
  ok("html carries the accent",
     await page.evaluate(() => document.documentElement.getAttribute("data-accent")) === "violet");
  await page.evaluate(() => App.router.go("settings"));
  await page.waitForTimeout(300);
  await page.locator('.tabs [data-tab="prefs"]').click();     // where the accent picker lives
  await page.waitForTimeout(300);
  ok("the Settings picker is on screen",
     await page.locator('[data-accent-opt="indigo"]').count() === 1);
  ok("the Settings picker offers the bought accent",
     await page.locator('[data-accent-opt="violet"]').count() === 1);
  ok("an unbought accent is not offered there",
     await page.locator('[data-accent-opt="ocean"]').count() === 0);
  ok("the shop link is there too", await page.locator("[data-open-shop]").count() === 1);
}

console.log("\nshop: you cannot wear what you did not buy");
{
  const state = await page.evaluate(() => {
    App.store.commit((db) => {
      db.settings.skin = "orchid";        // never bought
      db.settings.nameplate = "Bookworm 📚";
      db.settings.accent = "ocean";
    });
    App.applyShellPrefs();
    const html = document.documentElement;
    return {
      skin: html.getAttribute("data-skin"),
      accent: html.getAttribute("data-accent"),
      plate: App.store.settings.nameplate
    };
  });
  ok("an unowned skin is taken off", state.skin === null, String(state.skin));
  ok("an unowned nameplate is taken off", state.plate === "", JSON.stringify(state.plate));
  ok("an unowned accent falls back to the default", state.accent === "indigo", state.accent);
  ok("a bought one survives the same sweep", await page.evaluate(() => {
    App.store.commit((db) => { db.settings.skin = "glacier"; });
    App.applyShellPrefs();
    return document.documentElement.getAttribute("data-skin");
  }) === "glacier");
}

console.log("\nshop: a bought nameplate shows in the sidebar");
{
  await page.evaluate(() => App.shop.buy("title:bookworm"));
  await page.waitForTimeout(300);
  const text = await page.locator("#profileChip .nameplate").first().textContent().catch(() => "");
  ok("the chip wears it", /Bookworm/.test(text || ""), text);
}

console.log("\nshop: two submissions of the same photo at once pay once");
{
  await clearCooldown();
  const b64 = noisePhoto(7).toString("base64");
  const res = await page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const f = new File([bytes], "race.png", { type: "image/png" });
    const before = App.shop.balance();
    const proofsBefore = App.shop.proofs().length;
    const out = await Promise.allSettled([
      App.shop.submit({ file: f, minutes: 60 }),
      App.shop.submit({ file: f, minutes: 60 })
    ]);
    return {
      states: out.map((o) => o.status),
      gained: App.shop.balance() - before,
      proofs: App.shop.proofs().length - proofsBefore
    };
  }, b64);
  ok("exactly one submission succeeded", res.states.filter((x) => x === "fulfilled").length === 1,
     JSON.stringify(res.states));
  ok("only one proof was recorded", res.proofs === 1, String(res.proofs));
  ok("and it paid once", res.gained === 100, String(res.gained));
}

console.log("\nshop: four tiers, and prices that mean something");
{
  const cat = await page.evaluate(() => ({
    tiers: App.shop.tiers().map((t) => t.label),
    counts: App.shop.tiers().map((t) => App.shop.byTier(t.key).length),
    total: App.shop.CATALOG.length,
    max: Math.max(...App.shop.CATALOG.map((i) => i.price)),
    min: Math.min(...App.shop.CATALOG.map((i) => i.price)),
    // Every item's tier has to match the band its price falls in, or the
    // label on the section header is decoration rather than information.
    mismatched: App.shop.CATALOG.filter((i) => {
      const t = App.shop.TIERS[i.tier];
      const below = App.shop.tiers().filter((x) => x.order < t.order).pop();
      return !t || i.price > t.max || (below && i.price <= below.max);
    }).map((i) => `${i.id} @ ${i.price} in ${i.tier}`),
    tierless: App.shop.CATALOG.filter((i) => !i.tier).map((i) => i.id)
  }));
  ok("the four tiers are Common, Rare, Ultra and Elite",
     cat.tiers.join("|") === "Common Tier|Rare Tier|Ultra Tier|Elite Tier", cat.tiers.join(", "));
  ok("every item is in one", cat.tierless.length === 0, cat.tierless.join(", "));
  ok("and its price sits in that tier's band", cat.mismatched.length === 0, cat.mismatched.join(" | "));
  ok("every tier has something in it", cat.counts.every((n) => n >= 5), cat.counts.join("/"));
  ok("the catalogue is worth browsing", cat.total >= 25, String(cat.total));
  ok("Elite reaches 1000 tokens", cat.max === 1000, String(cat.max));
  ok("and the cheapest is one good evening", cat.min <= 200, String(cat.min));

  ok("the shop screen renders a section per tier",
     await page.evaluate(async () => {
       App.router.go("shop");
       await new Promise((r) => setTimeout(r, 200));
       document.querySelector('[data-tab="shop"]').click();
       await new Promise((r) => setTimeout(r, 200));
       return document.querySelectorAll(".tier-head").length;
     }) === 4);
}

console.log("\nshop: work the app measured pays without a photo");
{
  const measured = await page.evaluate(() => {
    const U = App.utils, S = App.store;
    S.commit((db) => { db.wallet.balance = 0; db.wallet.boosts = []; });
    const start = App.shop.balance();
    const photoDayBefore = App.shop.earnedToday();

    // An assignment pays once, ever — done, reopened, done again is not a
    // two-click faucet.
    const a = S.insert("assignments", { title: "Once only", classId: null, due: U.today(), status: "todo", points: 10 });
    S.update("assignments", a.id, { status: "done" });
    const afterFirst = App.shop.balance();
    S.update("assignments", a.id, { status: "todo" });
    S.update("assignments", a.id, { status: "done" });
    const afterSecond = App.shop.balance();

    // A boost multiplies what the app pays, and only while it is live.
    S.commit((db) => { db.wallet.balance = 5000; });
    App.shop.buy("boost:double");
    const mult = App.shop.multiplier();
    const before = App.shop.balance();
    const paid = App.store.awardTokens(100, "test payout", { silent: true });

    return {
      start, afterFirst, afterSecond, paid, mult,
      gained: App.shop.balance() - before,
      ledger: App.shop.ledger(5).map((e) => e.reason),
      // The photo cap counts photo earnings only; none of the above was one,
      // so this must be exactly what it was before they were paid.
      photoDayBefore, photoDayAfter: App.shop.earnedToday()
    };
  });
  ok("finishing an assignment pays", measured.afterFirst > measured.start, String(measured.afterFirst));
  ok("but only once, however often it's reopened",
     measured.afterSecond === measured.afterFirst, String(measured.afterSecond));
  ok("a boost is live once bought", measured.mult === 2, String(measured.mult));
  ok("and doubles what the app pays", measured.gained === 200, String(measured.gained));
  ok("every payment says why in the ledger",
     measured.ledger.some((r) => /Finished/.test(r)) && measured.ledger.some((r) => /test payout/.test(r)),
     measured.ledger.join(" | "));
  ok("measured work doesn't eat the photo cap",
     measured.photoDayAfter === measured.photoDayBefore,
     `${measured.photoDayBefore} → ${measured.photoDayAfter}`);
}

console.log("\nshop: an alarm voice is bought, worn, and reaches the timer");
{
  const alarm = await page.evaluate(() => {
    App.store.commit((db) => { db.wallet.balance = 5000; db.settings.pomodoro.alarm = "chime"; });
    const before = App.store.settings.pomodoro.alarm;
    const res = App.shop.buy("alarm:fanfare");
    return {
      ok: res.ok, before,
      after: App.store.settings.pomodoro.alarm,
      ownedByTheTimer: App.store.ownsShopItem("alarm:fanfare"),
      rings: App.sound.alarm({ force: true })
    };
  });
  ok("it can be bought", alarm.ok === true);
  ok("and becomes the voice the timer uses", alarm.after === "fanfare", alarm.after);
  ok("the timer's own settings agree it is owned", alarm.ownedByTheTimer === true);
  ok("and the alarm still rings", alarm.rings === true);

  const unowned = await page.evaluate(() => {
    App.store.commit((db) => { db.settings.pomodoro.alarm = "zen"; });   // never bought
    App.applyShellPrefs();
    return App.store.settings.pomodoro.alarm;
  });
  ok("a voice that was never bought is taken off like any other item",
     unowned === "chime", unowned);
}

/* ================================ part 4: what landed alongside the tiers == */

console.log("\nsolo: a student with no parent or teacher linked is not locked out");
{
  ok("signed out counts as solo", await page.evaluate(() => App.store.isSoloStudent()) === true);

  await page.evaluate(() => App.router.go("sharing"));
  await page.waitForTimeout(400);
  ok("the focus-window card is on screen anyway",
     await page.locator("[data-self-focus]").count() >= 3);
  ok("so is somewhere to write a note", await page.locator("[data-self-note]").count() === 1);

  await page.locator('[data-self-focus="30"]').click();
  await page.waitForTimeout(300);
  const w = await page.evaluate(() => {
    const x = App.store.activeFocusWindow();
    return x && { by: x.by, mins: Math.round((x.endAt - x.startAt) / 60000) };
  });
  ok("a self-set focus window starts, with no account", !!w && w.by === "self", JSON.stringify(w));
  ok("and runs for the length asked for", w && w.mins === 30, String(w && w.mins));

  await page.locator("[data-focus-end]").click();
  await page.waitForTimeout(250);
  ok("and ends early locally, without a server round trip",
     await page.evaluate(() => !!App.store.activeFocusWindow()) === false);

  await page.evaluate(() => { App.store.addSelfNote("Ask about the retake"); App.router.refresh(); });
  await page.waitForTimeout(250);
  ok("a note to yourself saves and renders", await page.locator("[data-del-note]").count() === 1);

  // Two record shapes share this collection — recurring windows keyed on
  // weekday, one-off ones keyed on timestamps. Reading days.includes() on the
  // second used to throw.
  const mixed = await page.evaluate(() => {
    App.store.addFocusWindow("20:00", "21:00", ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    try { return { ok: true, active: !!App.store.activeFocusWindow() }; }
    catch (e) { return { ok: false, err: e.message }; }
  });
  ok("both focus-window shapes coexist without throwing", mixed.ok === true, mixed.err);

  await page.evaluate(() => App.router.go("parent"));
  await page.waitForTimeout(300);
  const heading = await page.locator("h3").first().textContent();
  ok("the parent portal tells a student they don't need one",
     /don't need a parent account/i.test(heading || ""), heading);
}

console.log("\nextracurricular: a class can assign homework without a period");
{
  const r = await page.evaluate(() => {
    const U = App.utils, S = App.store;
    S.insert("periods", { name: "Period 1", start: "08:00", end: "08:52" });
    const p = S.db.periods[0];
    S.insert("classes", { name: "Bio", color: "#2a78d6", days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
      periodId: p.id, categories: [], offSchedule: false });
    const dow = U.DOW_SHORT[new Date().getDay()];
    const club = S.insert("classes", { name: "Robotics Team", color: "#eb6834", days: [dow],
      periodId: null, offSchedule: true, start: "15:30", end: "17:30",
      meetingLabel: "Robotics practice", categories: [] });
    S.insert("assignments", { title: "Build log", classId: club.id, due: U.today(), status: "todo", points: 20 });
    return {
      period: S.classPeriod(club),
      onDate: S.classesOnDate(U.today()).map((x) => x.cls.name),
      agenda: S.scheduleFor(U.today()).map((i) => [i.kind, i.title]),
      work: S.assignmentsFor(club.id).length
    };
  });
  ok("it reports its own meeting time", r.period && r.period.start === "15:30", JSON.stringify(r.period));
  ok("it shows up on today's timetable", r.onDate.includes("Robotics Team"), r.onDate.join(", "));
  ok("the agenda marks it as its own kind",
     r.agenda.some(([k, t]) => k === "extra" && t === "Robotics Team"), JSON.stringify(r.agenda));
  ok("and it carries homework like any other class", r.work === 1, String(r.work));

  await page.evaluate(() => App.router.go("schedule"));
  await page.waitForTimeout(350);
  ok("the week grid gives it its own row",
     await page.locator(".tt-time", { hasText: "Own" }).count() === 1);
  ok("with the class in it", await page.locator(".tt-cell", { hasText: "Robotics" }).count() === 1);
}

console.log("\ntimer: the fourth segment is Custom, and the alarm rings");
{
  await page.evaluate(() => App.router.go("focus"));
  await page.waitForTimeout(300);
  const label = (await page.locator('[data-phase="custom"]').textContent() || "").trim();
  ok("the segment reads exactly \"Custom\"", label === "Custom", label);
  ok("the length is still discoverable, in its tooltip",
     /\d+ minutes/.test(await page.locator('[data-phase="custom"]').getAttribute("title") || ""));

  // A real click is a real gesture: this is what opens the audio session that
  // the old ring-time AudioContext never had.
  await page.locator("#timerToggle").click();
  await page.waitForTimeout(250);
  ok("pressing Start unlocks audio", await page.evaluate(() => App.sound.ready()) === true);
  await page.locator("#timerToggle").click();

  const quiet = await page.evaluate(() => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    App.store.commit((db) => {
      db.settings.notifications.quietStart = `${pad((now.getHours() + 23) % 24)}:00`;
      db.settings.notifications.quietEnd = `${pad((now.getHours() + 1) % 24)}:00`;
      db.settings.pomodoro.quietSound = true;
    });
    const rangQuietly = App.sound.alarm();
    App.store.commit((db) => { db.settings.pomodoro.quietSound = false; });
    return { inQuiet: App.notify.inQuietHours(), rangQuietly, rangSilent: App.sound.alarm() };
  });
  ok("quiet hours are actually in force for this check", quiet.inQuiet === true);
  ok("it still rings quietly inside quiet hours", quiet.rangQuietly === true);
  ok("unless you switch that off", quiet.rangSilent === false);
}

console.log("\nshop: nothing threw along the way");
ok("no uncaught page errors", errors.length === 0, errors.join(" | "));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
