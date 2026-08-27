/* ==========================================================================
   tests/shop.mjs — study tokens: what they cost, what they buy, what cannot
   be used to farm them — and the three things that landed alongside them.

   Half of this is an economy, and an economy nobody can cheat is the only
   kind worth showing a number for. The interesting cases are all refusals:
   a topic that isn't school material, a second quiz thirty seconds later, the
   same topic ground three times in an evening, a claim of nine hours, a skin
   equipped that was never bought, an assignment closed and reopened for a
   second payout.

   The other half is a promise made in css/theme.css: a bought skin re-tints
   the surfaces at matched luminance, so every contrast ratio in the app is
   what it was before. That is asserted here against the stylesheet itself,
   because a future hand-picked hex is exactly how a promise like that dies.

   Part 4 covers what arrived with the tiers: a student working with no linked
   parent or teacher, a class that meets outside the bell schedule, and the
   focus timer's Custom segment and its alarm.
   ========================================================================== */

import { readFileSync } from "node:fs";
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

/* =============================================== part 2: the app behaviour */

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
  quizzes: App.shop.quizzes().length,
  sessions: App.store.db.studySessions.length,
  topics: { ...(App.store.db.wallet.topics || {}) }
}));

/**
 * Script App.assistant for the earning flow.
 *
 * The boundary this suite tests is the view's contract with the assistant
 * module — did the right dialog open, did the right thing get written. What
 * the *server* does with a topic and a ticket is pinned in tests/quiz.mjs,
 * against the real route, so faking it here duplicates nothing.
 *
 * `mode` is "work" (a quiz comes back), "random" (the topic is refused), or
 * "off" (no AI at all, which is what being offline or signed out looks like).
 */
async function scriptAI(mode, grade) {
  await page.evaluate(([mode, grade]) => {
    const pay = { A: 100, B: 50, C: 25 };
    window.__ai = { topicCalls: 0, gradeCalls: 0, lastTopic: null, lastAnswers: null };

    App.assistant.available = () => mode !== "off";
    App.assistant.makeTopicQuiz = (topic, opts) => {
      window.__ai.topicCalls++;
      window.__ai.lastTopic = { topic, opts };
      if (mode === "random") {
        return Promise.resolve({ ok: false, reason: "That's a video game, not something school teaches." });
      }
      return Promise.resolve({
        ok: true, topic, subject: "Chemistry", difficulty: (opts && opts.difficulty) || "medium",
        reason: "Five questions on stoichiometry.",
        ticket: "ticket-for-" + topic,
        questions: [0, 1, 2, 3].map((_, i) => ({
          prompt: "Question " + (i + 1) + "?",
          choices: ["First", "Second", "Third", "Fourth"]
        }))
      });
    };
    App.assistant.gradeStudyQuiz = (ticket, answers) => {
      window.__ai.gradeCalls++;
      window.__ai.lastAnswers = answers;
      // The score the test asked for, not the one the answers imply — the
      // real grading is the server's, and it has its own suite.
      const correct = grade === "A" ? 4 : grade === "B" ? 3 : grade === "C" ? 2 : 0;
      return Promise.resolve({
        correct, total: 4, grade: grade || "—", tokens: pay[grade] || 0, wrong: [],
        topic: String(ticket).replace("ticket-for-", ""),
        difficulty: window.__ai.lastTopic.opts.difficulty || "medium"
      });
    };
  }, [mode, grade || "A"]);
}

/** Answer every question in the open quiz, then submit. */
async function answerQuiz() {
  await page.evaluate(() => {
    document.querySelectorAll(".quiz-q").forEach((fs) => {
      const first = fs.querySelector('input[type="radio"]:not([disabled])');
      if (first) { first.checked = true; first.dispatchEvent(new Event("change", { bubbles: true })); }
    });
  });
  await page.locator('.modal-root button[type="submit"]').click();
  await page.waitForTimeout(500);
}

/** The whole earning flow: name a topic, then answer the quiz it writes. */
async function takeQuiz(topic, difficulty) {
  await page.locator("[data-add-quiz]").first().click();
  await page.waitForTimeout(250);
  await page.locator("#quizTopic").fill(topic);
  if (difficulty) await page.locator("#quizDifficulty").selectOption(difficulty);
  await page.locator('.modal-root button[type="submit"]').click();
  await page.waitForTimeout(500);
  // On the graded path the quiz is now open; on a refusal nothing is.
  if (await page.locator(".quiz-q").count()) await answerQuiz();
}
const modalOpen = () => page.locator(".modal-root").count().then((n) => n > 0);
const modalError = () => page.locator("[data-quiz-error]:not([hidden])").first()
  .textContent().catch(() => "");
async function closeModal() {
  if (await modalOpen()) {
    await page.locator(".modal-root [data-close]").first().click();
    await page.waitForTimeout(200);
  }
}
// The cooldown is real time; tests are not allowed to wait ten minutes for it.
const clearCooldown = () => page.evaluate(() => {
  App.store.commit((db) => { db.wallet.lastQuizAt = 0; db.wallet.lastProofAt = 0; });
});
/** Wipe the day's earnings only, leaving the topic tally alone. */
const clearCap = () => page.evaluate(() => {
  App.store.commit((db) => { db.wallet.daily = {}; });
});
/** Wipe today's earnings, topic tally and first-of-day flag. */
const clearDay = () => page.evaluate(() => {
  App.store.commit((db) => {
    db.wallet.daily = {};
    db.wallet.topics = {};
    db.wallet.topicsDay = "";
    db.wallet.lastQuizDay = "";
  });
});

console.log("\nshop: the view renders and starts empty");
{
  ok("shop view painted", await page.locator(".page-inner h1").first().textContent()
     .then((t) => /Study shop/.test(t)));
  const w = await wallet();
  ok("balance starts at zero", w.balance === 0, String(w.balance));
  ok("no quizzes yet", w.quizzes === 0);
}

console.log("\nshop: the quiz dialog is usable without a mouse");
{
  await scriptAI("work", "A");
  // Chips come from the student's own classes and open assignments, and a
  // fresh install has neither.
  await page.evaluate(() => {
    App.store.insert("classes", { name: "Chemistry", color: "#3b82f6", days: ["Mon"], periodId: null });
    App.router.refresh();
  });
  await page.waitForTimeout(300);
  await page.locator("[data-add-quiz]").first().click();
  await page.waitForTimeout(250);
  const dlg = await page.evaluate(() => {
    const modal = document.querySelector(".modal-root [role=dialog]");
    const input = document.querySelector("#quizTopic");
    input.focus();
    return {
      dialog: !!modal && modal.getAttribute("aria-modal") === "true",
      labelled: !!(modal && modal.getAttribute("aria-labelledby")),
      focusable: document.activeElement === input,
      labelText: !!document.querySelector('label[for="quizTopic"]'),
      chips: document.querySelectorAll(".topic-chip").length
    };
  });
  ok("the modal is a real dialog", dlg.dialog && dlg.labelled);
  ok("the topic field takes keyboard focus", dlg.focusable);
  ok("and is labelled for a screen reader", dlg.labelText);
  ok("the classes on file are offered as chips", dlg.chips > 0, String(dlg.chips));
  ok("and one of them is the class just added",
     await page.locator(".topic-chip", { hasText: "Chemistry" }).count() === 1);
  await closeModal();
}

console.log("\nshop: a quiz you pass earns tokens and is logged");
{
  await clearCooldown();
  await clearDay();
  const before = await wallet();
  await takeQuiz("Stoichiometry");
  const after = await wallet();
  ok("modal closed on success", !(await modalOpen()));
  // Full marks pays 100 at medium, plus 25 for the first quiz of the day.
  ok("awarded 100 for an A + 25 first-of-day", after.balance === 125, `balance ${after.balance}`);
  ok("quiz recorded", after.quizzes === before.quizzes + 1);
  const last = await page.evaluate(() => App.store.db.studyQuizzes.slice(-1)[0]);
  ok("the record keeps the topic", last.topic === "Stoichiometry", last.topic);
  ok("and the grade", last.grade === "A", String(last.grade));
  ok("and what it paid", last.tokens === 125, String(last.tokens));
  ok("the topic the model was asked about is the one typed",
     await page.evaluate(() => window.__ai.lastTopic.topic) === "Stoichiometry");
  ok("it shows in the quiz log", await page.locator(".quiz-row").count() >= 1);
}

console.log("\nshop: the minutes are measured, never claimed");
{
  const logged = await page.evaluate(() => {
    const before = App.store.db.studySessions.length;
    // Answering in seconds logs no session — a quiz is not an evening.
    App.store.commit((db) => { db.wallet.lastQuizAt = 0; });
    const quick = App.shop.record({
      result: { grade: "—", correct: 0, total: 4, topic: "Fast one", difficulty: "medium" },
      topic: "Fast one", minutes: 0
    });
    const mid = App.store.db.studySessions.length;
    App.store.commit((db) => { db.wallet.lastQuizAt = 0; });
    App.shop.record({
      result: { grade: "—", correct: 0, total: 4, topic: "Slow one", difficulty: "medium" },
      topic: "Slow one", minutes: 34
    });
    const session = App.store.db.studySessions.slice(-1)[0];
    return { quickSession: mid - before, added: App.store.db.studySessions.length - mid, session, quick };
  });
  ok("a quiz answered in seconds logs no study session", logged.quickSession === 0, String(logged.quickSession));
  ok("one that took real minutes does", logged.added === 1, String(logged.added));
  ok("for exactly the minutes it took", logged.session.minutes === 34, String(logged.session.minutes));
  ok("and is tagged as a quiz", logged.session.kind === "quiz", logged.session.kind);
  ok("a failed quiz pays nothing", logged.quick.awarded === 0, String(logged.quick.awarded));
}

console.log("\nshop: the grade and the difficulty are the whole rate card");
{
  await clearDay();
  const q = await page.evaluate(() => ({
    a: App.shop.quote("A", { topic: "fresh topic" }),
    b: App.shop.quote("B", { topic: "fresh topic" }),
    c: App.shop.quote("C", { topic: "fresh topic" }),
    fail: App.shop.quote("—", { topic: "fresh topic" }),
    nothing: App.shop.quote(null, { topic: "fresh topic" }),
    easy: App.shop.quote("A", { topic: "fresh topic", difficulty: "easy" }),
    hard: App.shop.quote("A", { topic: "fresh topic", difficulty: "hard" }),
    // The lever that used to exist: a number of claimed minutes, however large.
    number: App.shop.quote(9999, { topic: "fresh topic" })
  }));
  ok("an A pays the per-quiz maximum", q.a.base === 100, JSON.stringify(q.a));
  ok("a B pays half of it", q.b.base === 50, JSON.stringify(q.b));
  ok("a C pays a quarter", q.c.base === 25, JSON.stringify(q.c));
  ok("under half pays nothing", q.fail.base === 0, JSON.stringify(q.fail));
  ok("and no grade at all pays nothing", q.nothing.base === 0, JSON.stringify(q.nothing));
  ok("easy pays less than medium", q.easy.scored < q.a.scored, `${q.easy.scored} vs ${q.a.scored}`);
  ok("hard pays more", q.hard.scored > q.a.scored, `${q.hard.scored} vs ${q.a.scored}`);
  // This is the regression that matters: claimed time is not a rate any more.
  ok("a big number is not a grade and buys nothing", q.number.base === 0, JSON.stringify(q.number));
}

console.log("\nshop: grinding one topic pays less each time");
{
  await clearDay();
  await clearCooldown();
  const runs = [];
  for (const topic of ["Photosynthesis", "Photosynthesis", "Photosynthesis", "The Cold War"]) {
    await clearCooldown();
    // The cap is a different rule with its own block below; clearing it here
    // keeps this one measuring the repeat ladder alone.
    await clearCap();
    const before = (await wallet()).balance;
    await takeQuiz(topic);
    await closeModal();
    runs.push((await wallet()).balance - before);
  }
  // The first run also carries the +25 first-of-day bonus.
  ok("the first quiz on a topic pays full", runs[0] === 125, String(runs[0]));
  ok("the second on the same topic pays half", runs[1] === 50, String(runs[1]));
  ok("the third pays nothing at all", runs[2] === 0, String(runs[2]));
  ok("a different topic pays full again", runs[3] === 100, String(runs[3]));

  const loose = await page.evaluate(() => ({
    same: App.shop.topicKey("The French Revolution!") === App.shop.topicKey("the french  revolution"),
    different: App.shop.topicKey("Mitosis") !== App.shop.topicKey("Meiosis")
  }));
  ok("punctuation and case are not a way around it", loose.same);
  ok("but two real topics stay different", loose.different);
}

console.log("\nshop: quizzes can't be dumped in one sitting");
{
  const before = await wallet();
  await page.evaluate(() => App.store.commit((db) => { db.wallet.lastQuizAt = Date.now(); }));
  await page.locator("[data-add-quiz]").first().click();
  await page.waitForTimeout(250);
  await page.locator("#quizTopic").fill("Trench warfare");
  const callsBefore = await page.evaluate(() => window.__ai.topicCalls);
  await page.locator('.modal-root button[type="submit"]').click();
  await page.waitForTimeout(400);

  ok("modal stayed open", await modalOpen());
  ok("refusal gives the wait", /Next quiz in \d+ minute/i.test(await modalError()));
  ok("and the model was never asked",
     await page.evaluate(() => window.__ai.topicCalls) === callsBefore);
  ok("balance unchanged", (await wallet()).balance === before.balance);
  await closeModal();
}

console.log("\nshop: the daily cap holds, and says so instead of failing");
{
  await clearCooldown();
  await clearDay();
  await page.evaluate(() => App.store.commit((db) => {
    db.wallet.daily[App.utils.today()] = App.shop.RULES.dailyCap;
  }));
  const before = await wallet();
  ok("quote is zero at the cap",
     await page.evaluate(() => App.shop.quote("A", { topic: "capped" }).total) === 0);
  await takeQuiz("Electromagnetism");
  const after = await wallet();
  ok("the quiz still saved", after.quizzes === before.quizzes + 1);
  ok("but paid nothing", after.balance === before.balance, `${before.balance} → ${after.balance}`);
  await clearDay();
}

console.log("\nshop: deleting a quiz keeps the tokens and keeps the topic spent");
{
  await clearCooldown();
  await clearDay();
  await takeQuiz("Vectors");
  const before = await wallet();
  const removed = await page.evaluate(() => {
    const q = App.shop.quizzes().slice(-1)[0];
    App.shop.deleteQuiz(q.id);
    return q.id;
  });
  await page.waitForTimeout(200);
  const after = await wallet();
  ok("the quiz is gone from the log", after.quizzes === before.quizzes - 1, removed);
  ok("the tokens it earned are still yours", after.balance === before.balance);
  ok("the topic is still counted as paid today",
     await page.evaluate(() => App.shop.topicRepeats("Vectors")) === 1);
  ok("and the first-of-day bonus is not re-armed",
     await page.evaluate(() => App.shop.firstToday()) === false);
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

console.log("\nshop: finishing one quiz starts the wait for the next");
{
  await clearCooldown();
  await clearDay();
  const res = await page.evaluate(() => {
    const before = App.shop.balance();
    const result = { grade: "A", correct: 4, total: 4, topic: "Titration", difficulty: "medium" };
    App.shop.record({ result, topic: "Titration", minutes: 12 });
    // The next one is refused on this device alone, before anything is asked
    // of the model.
    const gate = App.shop.canStart();
    return { gained: App.shop.balance() - before, gate, wait: App.shop.cooldownLeft() };
  });
  ok("the quiz paid once", res.gained === 125, String(res.gained));
  ok("and the next one is gated", !res.gate.ok, JSON.stringify(res.gate));
  ok("with the wait named in the message", /Next quiz in \d+ minute/.test(res.gate.error), res.gate.error);
  ok("and a cooldown to run down", res.wait > 0 && res.wait <= 10, String(res.wait));
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

console.log("\nshop: nothing but a quiz pays");
{
  const measured = await page.evaluate(() => {
    const U = App.utils, S = App.store;
    S.commit((db) => { db.wallet.balance = 0; db.wallet.boosts = []; });
    const start = App.shop.balance();

    // Both of these used to pay through a hook the shop installed on the
    // store itself, so they are checked here rather than through the views.
    const a = S.insert("assignments", { title: "Once only", classId: null, due: U.today(), status: "todo", points: 10 });
    S.update("assignments", a.id, { status: "done" });
    const afterAssignment = App.shop.balance();

    const was = S.db.streak.last;
    S.commit((db) => { db.streak.last = U.dateKey(U.addDays(new Date(), -1)); });
    S.touchStreak();
    const afterStreak = App.shop.balance();
    S.commit((db) => { db.streak.last = was; });

    return {
      start, afterAssignment, afterStreak,
      // The shop no longer hands the rest of the app a way to pay at all.
      hasAward: typeof S.awardTokens === "function" || typeof App.shop.award === "function",
      hasRates: !!App.shop.RATES
    };
  });
  ok("finishing an assignment pays nothing", measured.afterAssignment === measured.start,
     `${measured.start} → ${measured.afterAssignment}`);
  ok("a streak day pays nothing", measured.afterStreak === measured.start, String(measured.afterStreak));
  // The regression that matters: a way to mint tokens handed to any other
  // module is a way around the quiz, whoever calls it and however carefully.
  ok("no module is handed a way to mint tokens", !measured.hasAward);
  ok("and there is no rate card left to pay from", !measured.hasRates);

  // The habit, reading and flashcard payouts lived in their own views, so
  // the only honest check is that the calls are gone from the source.
  const callers = ["js/views/goals.js", "js/views/reading.js", "js/views/flashcards.js",
                   "js/views/focus.js", "js/shop.js"]
    .filter((f) => /awardTokens\s*\(/.test(readFileSync(f, "utf8")));
  ok("and no view still calls one", callers.length === 0, callers.join(", "));
}

console.log("\nshop: a boost multiplies the quiz and lifts the day's ceiling with it");
{
  await goEarn();
  await clearCooldown();
  await clearDay();
  await scriptAI("work", "A");
  const state = await page.evaluate(() => {
    App.store.commit((db) => { db.wallet.balance = 5000; db.wallet.boosts = []; });
    const plain = App.shop.dailyCap();
    App.shop.buy("boost:double");
    return { plain, mult: App.shop.multiplier(), boostedCap: App.shop.dailyCap(),
             quote: App.shop.quote("A", { topic: "Boosted topic" }) };
  });
  ok("the boost is live once bought", state.mult === 2, String(state.mult));
  ok("it doubles what a quiz pays", state.quote.wanted === 250, JSON.stringify(state.quote));
  ok("and doubles the day's ceiling too, or it would only pay faster",
     state.boostedCap === state.plain * 2, `${state.plain} → ${state.boostedCap}`);

  const before = await page.evaluate(() => App.shop.balance());
  await takeQuiz("Boosted topic");
  const after = await page.evaluate(() => App.shop.balance());
  ok("and the quiz actually pays it", after - before === 250, String(after - before));
  ok("the ledger says a boost was involved",
     await page.evaluate(() => (App.shop.ledger(3).find((e) => e.n > 0) || {}).mult) === 2);
  await page.evaluate(() => App.store.commit((db) => { db.wallet.boosts = []; }));
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

/* ==================================================== part 5: the quiz gate */

// Earlier blocks left the app on other views. Everything below drives the
// shop's Earn tab, so go back to it once here rather than in each block.
async function goEarn() {
  await page.evaluate(() => {
    App.router.go("shop");
    if (App.views.shop && App.views.shop.setTab) App.views.shop.setTab("earn");
  });
  await page.waitForTimeout(350);
  const earnTab = page.locator('[data-tab="earn"]');
  if (await earnTab.count()) { await earnTab.click(); await page.waitForTimeout(300); }
}
await goEarn();

console.log("\nshop: a topic that isn't schoolwork is refused, and says why");
{
  await clearCooldown();
  await clearDay();
  await scriptAI("random");
  const before = await wallet();
  await takeQuiz("Fortnite");

  ok("the dialog stays open on a refusal", await modalOpen());
  ok("no quiz was offered", await page.locator(".quiz-q").count() === 0);
  ok("the model's reason is shown", /video game/i.test(await modalError()));
  const after = await wallet();
  ok("nothing was paid", after.balance === before.balance, `${before.balance} → ${after.balance}`);
  ok("and nothing was recorded", after.quizzes === before.quizzes, `${before.quizzes} → ${after.quizzes}`);
  await closeModal();
}

console.log("\nshop: a topic too short to quiz never reaches the model");
{
  await clearCooldown();
  await scriptAI("work", "A");
  await page.locator("[data-add-quiz]").first().click();
  await page.waitForTimeout(250);
  await page.locator("#quizTopic").fill("hi");
  const callsBefore = await page.evaluate(() => window.__ai.topicCalls);
  await page.locator('.modal-root button[type="submit"]').click();
  await page.waitForTimeout(300);
  ok("the form says what it needs", /Say what you studied/i.test(await modalError()));
  ok("and the model was never asked",
     await page.evaluate(() => window.__ai.topicCalls) === callsBefore);
  await closeModal();
}

console.log("\nshop: the grade decides the payout, end to end");
{
  await goEarn();
  for (const [grade, worth] of [["B", 50], ["C", 25]]) {
    await clearCooldown();
    await clearDay();
    await scriptAI("work", grade);
    const before = await wallet();
    await takeQuiz(`Grade ${grade} topic`);
    const after = await wallet();
    // +25 on top: clearDay() re-arms the first-quiz-of-the-day bonus.
    ok(`a ${grade} pays ${worth}`, after.balance - before.balance === worth + 25,
       `${after.balance - before.balance}`);
  }
}

console.log("\nshop: the difficulty you pick is the difficulty you're paid at");
{
  await goEarn();
  await clearCooldown();
  await clearDay();
  await scriptAI("work", "A");
  const before = await wallet();
  await takeQuiz("Kinematics", "hard");
  const after = await wallet();
  ok("the model was asked for the hard set",
     await page.evaluate(() => window.__ai.lastTopic.opts.difficulty) === "hard");
  // 100 × 1.25, plus the first-of-day 25.
  ok("and full marks on hard pays more", after.balance - before.balance === 150,
     String(after.balance - before.balance));
  const last = await page.evaluate(() => App.store.db.studyQuizzes.slice(-1)[0]);
  ok("the record remembers which it was", last.difficulty === "hard", last.difficulty);
}

console.log("\nshop: failing the quiz logs the attempt and pays nothing");
{
  await goEarn();
  await clearCooldown();
  await clearDay();
  await scriptAI("work", "F");
  const before = await wallet();
  await takeQuiz("Redox reactions");

  // A zero opens the retake offer rather than saving straight away, so the
  // two attempts read as one sitting rather than two rows in the log.
  ok("the failure is explained, not just closed", await modalOpen());
  const saveBtn = page.locator("[data-save-anyway]");
  ok("saving without tokens is offered", await saveBtn.count() === 1);
  ok("no retake is offered when none are held", await page.locator("[data-retake]").count() === 0);

  await saveBtn.click();
  await page.waitForTimeout(600);
  const after = await wallet();
  ok("nothing was paid", after.balance === before.balance, `${before.balance} → ${after.balance}`);
  ok("but the attempt was kept", after.quizzes === before.quizzes + 1);
  const last = await page.evaluate(() => App.store.db.studyQuizzes.slice(-1)[0]);
  ok("the record remembers the grade", last.grade === "F" || last.grade === "—", String(last.grade));
  ok("and the topic it was on", last.topic === "Redox reactions", last.topic);
  ok("a failed topic is not spent",
     await page.evaluate(() => App.shop.topicRepeats("Redox reactions")) === 0);
}

console.log("\nshop: a retake buys a fresh quiz on the same topic");
{
  await goEarn();
  await clearCooldown();
  await clearDay();
  await page.evaluate(() => App.store.commit((db) => { db.wallet.consumables = { retake: 1 }; }));
  await scriptAI("work", "F");
  await takeQuiz("The Treaty of Versailles");

  ok("the retake is offered when one is held", await page.locator("[data-retake]").count() === 1);

  // Second time around the student passes. Re-scripting zeroes the call
  // counter, so the baseline has to be read after it, not before.
  await scriptAI("work", "A");
  const callsBefore = await page.evaluate(() => window.__ai.topicCalls);
  await page.locator("[data-retake]").click();
  await page.waitForTimeout(600);

  ok("a fresh quiz was written", await page.evaluate(() => window.__ai.topicCalls) > callsBefore);
  ok("on the same topic",
     await page.evaluate(() => window.__ai.lastTopic.topic) === "The Treaty of Versailles");
  ok("it is on screen", await page.locator(".quiz-q").count() === 4);
  ok("and the retake was spent", await page.evaluate(() => App.shop.held("retake")) === 0);

  const before = (await wallet()).balance;
  await answerQuiz();
  ok("the second attempt pays", (await wallet()).balance > before);
}

console.log("\nshop: a 50/50 narrows one question and is spent once");
{
  await goEarn();
  await clearCooldown();
  await clearDay();
  await page.evaluate(() => App.store.commit((db) => { db.wallet.consumables = { fifty: 2 }; }));
  await scriptAI("work", "A");
  await page.locator("[data-add-quiz]").first().click();
  await page.waitForTimeout(250);
  await page.locator("#quizTopic").fill("Cell division");
  await page.locator('.modal-root button[type="submit"]').click();
  await page.waitForTimeout(600);

  ok("the quiz opened", await page.locator(".quiz-q").count() === 4);
  const visibleBefore = await page.locator(".quiz-q").first().locator(".quiz-choice:not([hidden])").count();
  ok("all four options start visible", visibleBefore === 4, String(visibleBefore));

  await page.locator("[data-fifty]").click();
  await page.waitForTimeout(200);
  const visibleAfter = await page.locator(".quiz-q").first().locator(".quiz-choice:not([hidden])").count();
  ok("two options are removed", visibleAfter === 2, String(visibleAfter));
  ok("one 50/50 was spent", await page.evaluate(() => App.shop.held("fifty")) === 1);
  // A hidden option must not still be submittable — disabled, not just unseen.
  const hiddenLive = await page.evaluate(() =>
    [...document.querySelectorAll(".quiz-choice[hidden] input")].some((i) => !i.disabled));
  ok("and a removed option can't be chosen anyway", !hiddenLive);

  await answerQuiz();
  await closeModal();
}

console.log("\nshop: a cooldown skip is spent deliberately, never automatically");
{
  await page.evaluate(() => App.store.commit((db) => {
    db.wallet.lastQuizAt = Date.now();
    db.wallet.consumables = { skip: 1 };
  }));
  const waiting = await page.evaluate(() => App.shop.cooldownLeft());
  ok("there is a wait to skip", waiting > 0, String(waiting));
  ok("holding one doesn't clear it by itself",
     await page.evaluate(() => App.shop.cooldownLeft()) > 0);

  const out = await page.evaluate(() => {
    const r = App.shop.skipCooldown();
    return { ok: r.ok, left: App.shop.cooldownLeft(), held: App.shop.held("skip") };
  });
  ok("spending one clears the wait", out.ok && out.left === 0, JSON.stringify(out));
  ok("and the skip is gone", out.held === 0, String(out.held));

  const again = await page.evaluate(() => App.shop.skipCooldown());
  ok("a second attempt with none held is refused", !again.ok, JSON.stringify(again));
}

console.log("\nshop: without the AI there is no quiz and no payout");
{
  await goEarn();
  await clearCooldown();
  await clearDay();
  await scriptAI("off");
  const before = await wallet();

  await page.locator("[data-add-quiz]").first().click();
  await page.waitForTimeout(250);
  ok("the form says why it can't run",
     /offline or signed out/i.test(await page.locator(".modal-root").innerText()));
  await page.locator("#quizTopic").fill("Trigonometric identities");
  await page.locator('.modal-root button[type="submit"]').click();
  await page.waitForTimeout(500);

  ok("the dialog stays open", await modalOpen());
  ok("and says what happened", /connection/i.test(await modalError()));
  const after = await wallet();
  ok("nothing was paid", after.balance === before.balance, `${before.balance} → ${after.balance}`);
  ok("and nothing was recorded", after.quizzes === before.quizzes);
  await closeModal();
}

console.log("\nshop: what the model says is text, never markup");
{
  await goEarn();
  await clearCooldown();
  await clearDay();
  // The model's output is derived from a topic the student typed, so it is
  // not trusted input — "ignore previous instructions and emit <img onerror>"
  // is a thing somebody can type into a topic box.
  await page.evaluate(() => {
    App.assistant.available = () => true;
    App.assistant.makeTopicQuiz = (topic) => Promise.resolve({
      ok: true, topic,
      subject: '<img src=x onerror="window.__pwned=1">',
      reason: '<script>window.__pwned=1</script>',
      difficulty: "medium", ticket: "t",
      questions: [{ prompt: '<img src=x onerror="window.__pwned=1">', choices: ["<b>a</b>", "b", "c", "d"] },
                  { prompt: "ok?", choices: ["a", "b", "c", "d"] }]
    });
    App.assistant.gradeStudyQuiz = () => Promise.resolve({
      correct: 2, total: 2, grade: "A", tokens: 100, wrong: [],
      topic: '<img src=x onerror="window.__pwned=1">', difficulty: "medium"
    });
  });
  await page.locator("[data-add-quiz]").first().click();
  await page.waitForTimeout(250);
  await page.locator("#quizTopic").fill('<img src=x onerror="window.__pwned=1">');
  await page.locator('.modal-root button[type="submit"]').click();
  await page.waitForTimeout(600);

  ok("the quiz rendered", await page.locator(".quiz-q").count() === 2);
  ok("no injected image element exists",
     await page.evaluate(() => document.querySelectorAll('.modal-root img[src="x"]').length) === 0);
  ok("no injected script ran", await page.evaluate(() => !window.__pwned));
  ok("the markup shows as the text it is",
     await page.locator(".quiz-q").first().locator("legend").textContent()
       .then((t) => t.includes("<img")));

  await answerQuiz();
  // The topic reaches the ledger and the quiz log, so check both.
  const pageHtml = await page.evaluate(() => {
    App.router.go("shop");
    return document.body.innerHTML;
  });
  ok("and nothing injected survived into the log or the ledger",
     !/<img src=x/.test(pageHtml) && !await page.evaluate(() => !!window.__pwned));
  await closeModal();
}

console.log("\nshop: a banked consumable stops being buyable when it's full");
{
  await page.evaluate(() => App.store.commit((db) => {
    db.wallet.balance = 5000;
    db.wallet.consumables = { retake: 3 };
  }));
  const r = await page.evaluate(() => App.shop.buy("boost:retake"));
  ok("buying past the ceiling is refused", !r.ok, JSON.stringify(r));
  ok("and it says what to do instead", /use one first/i.test(r.error || ""), r.error);
  ok("the balance is untouched", await page.evaluate(() => App.shop.balance()) === 5000);
}

console.log("\nshop: nothing threw along the way");
ok("no uncaught page errors", errors.length === 0, errors.join(" | "));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
