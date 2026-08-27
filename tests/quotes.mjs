/* ==========================================================================
   tests/quotes.mjs — the daily quote

   The feature makes three promises that are easy to break silently, so each
   one is asserted rather than eyeballed:

     • it never repeats until the pool is exhausted — the whole point, and
       the one thing a shuffle-on-each-open implementation gets wrong
     • every quote names a real person and links somewhere real — a quote
       with a dead attribution is worse than no quote
     • the text reads gender-neutrally, since the brief was explicitly a
       quote about being a good child/person that doesn't assume which

   The last one is a heuristic: it catches the generic-"man"/"his" phrasings
   that are the actual risk in a list of historical quotations. It cannot
   judge tone, so it's a floor, not a guarantee.

   Run: node tests/quotes.mjs   (needs a static server, see tests/run.mjs)
   ========================================================================== */

import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const BASE = process.env.BASE || "http://localhost:8899";
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => window.App && App.store && App.store.db && App.quotes, null, { timeout: 15000 });

const all = await page.evaluate(() => App.quotes.QUOTES);

/* ============================================================== the data == */
console.log("\nquotes: every entry is complete and attributed");
ok("the pool is not trivially small", all.length >= 40, String(all.length));

const missing = all.filter((q) => !q.id || !q.text || !q.author || !q.url);
ok("every quote has id, text, author and url", !missing.length,
   JSON.stringify(missing.map((q) => q.id || q.text)));

const ids = all.map((q) => q.id);
ok("ids are unique", new Set(ids).size === ids.length,
   JSON.stringify(ids.filter((id, i) => ids.indexOf(id) !== i)));

const texts = all.map((q) => q.text.toLowerCase().trim());
ok("no duplicated quote text", new Set(texts).size === texts.length,
   JSON.stringify(texts.filter((t, i) => texts.indexOf(t) !== i)));

const badUrl = all.filter((q) => !/^https:\/\/[a-z]/.test(q.url));
ok("every link is https", !badUrl.length, JSON.stringify(badUrl.map((q) => q.url)));

// A quote is only as good as its attribution: an author field holding a
// placeholder ("Anonymous", "Unknown") would quietly break the brief.
const anon = all.filter((q) => /anon|unknown|proverb|author/i.test(q.author));
ok("no anonymous or placeholder authors", !anon.length, JSON.stringify(anon.map((q) => q.author)));

ok("every quote names a source work or occasion",
   all.every((q) => q.source && q.source.length > 3),
   JSON.stringify(all.filter((q) => !q.source).map((q) => q.id)));

/* ==================================================== gender-neutral text = */
console.log("\nquotes: the text does not assume a gender");
// Generic-masculine usages that would read wrong in a quote about being a
// good child. Word-bounded so "human", "woman" and "history" don't trip it.
const GENDERED = /\b(he|him|his|she|her|hers|himself|herself|man|men|woman|women|mankind|son|sons|daughter|daughters|brother|sister|fatherhood|motherhood)\b/i;
const gendered = all.filter((q) => GENDERED.test(q.text));
ok("no gendered pronouns or nouns in any quote text", !gendered.length,
   JSON.stringify(gendered.map((q) => q.id + ": " + q.text.slice(0, 60))));

/* ========================================================== the no-repeat = */
console.log("\nquotes: pick() never repeats until the pool is exhausted");
{
  const drawn = await page.evaluate((n) => {
    App.store.db.ui.quotesSeen = [];
    const out = [];
    for (let i = 0; i < n; i++) out.push(App.quotes.pick().id);
    return out;
  }, all.length);

  ok("a full cycle draws every quote once",
     new Set(drawn).size === all.length,
     `${new Set(drawn).size} unique of ${all.length} draws`);

  const dupes = drawn.filter((id, i) => drawn.indexOf(id) !== i);
  ok("with no repeat anywhere in the cycle", !dupes.length, JSON.stringify(dupes));

  // The cycle boundary is where a naive implementation either throws or
  // starts returning undefined.
  const after = await page.evaluate(() => {
    const q = App.quotes.pick();
    return { id: q && q.id, seen: App.store.db.ui.quotesSeen.length };
  });
  ok("the next draw after exhaustion still returns a quote", !!after.id, JSON.stringify(after));
  ok("and the seen-list resets rather than growing forever", after.seen === 1, String(after.seen));
}

console.log("\nquotes: the choice survives a reload");
{
  const persisted = await page.evaluate(() => {
    App.store.db.ui.quotesSeen = [];
    const first = App.quotes.pick().id;
    return { first, stored: App.store.db.ui.quotesSeen.slice() };
  });
  ok("a drawn quote is recorded on the store", persisted.stored.includes(persisted.first),
     JSON.stringify(persisted));

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => window.App && App.quotes, null, { timeout: 15000 });
  const survived = await page.evaluate(() => App.store.db.ui.quotesSeen);
  ok("and is still there after a reload, so the next open can't repeat it",
     survived.includes(persisted.first), JSON.stringify(survived));
}

/* ================================================================ the UI == */
console.log("\nquotes: it renders on the dashboard and links out");
{
  await page.evaluate(() => App.router.go("dashboard"));
  await page.waitForSelector(".quote-card", { timeout: 5000 });

  const card = await page.evaluate(() => {
    const el = document.querySelector(".quote-card");
    const a = el && el.querySelector("figcaption a");
    return {
      text: el ? el.querySelector("blockquote").textContent.trim() : "",
      author: a ? a.textContent.trim() : "",
      href: a ? a.getAttribute("href") : "",
      target: a ? a.getAttribute("target") : "",
      rel: a ? a.getAttribute("rel") || "" : ""
    };
  });

  ok("the quote text is shown", card.text.length > 10, JSON.stringify(card.text));
  ok("the author is shown", card.author.length > 2, JSON.stringify(card.author));
  ok("the author is a real link", /^https:\/\//.test(card.href), card.href);
  ok("the link matches a quote in the pool",
     all.some((q) => q.url === card.href && q.author === card.author),
     `${card.author} → ${card.href}`);
  // A target=_blank link without noopener hands the new tab a window.opener
  // reference back into the app.
  ok("it opens in a new tab safely", card.target === "_blank" && /noopener/.test(card.rel),
     `${card.target} / ${card.rel}`);
}

console.log("\nquotes: hostile text in a quote can't reach the DOM as markup");
{
  const escaped = await page.evaluate(() => {
    App.quotes.QUOTES.push({
      id: "q-xss-probe", text: "<img src=x onerror=\"window.__pwned=1\">bad",
      author: "<script>window.__pwned=1<\/script>", source: "t",
      url: "https://example.com/"
    });
    App.store.db.ui.quotesSeen = App.quotes.QUOTES.filter((q) => q.id !== "q-xss-probe").map((q) => q.id);
    // Force a fresh pick so only the probe is left in the pool.
    const q = App.quotes.pick();
    return q.id;
  });
  ok("the probe was the one drawn", escaped === "q-xss-probe", escaped);

  const clean = await page.evaluate(() => {
    const el = document.createElement("div");
    el.innerHTML = App.views.dashboard.render();
    document.body.appendChild(el);
    const pwned = !!window.__pwned;
    const imgs = el.querySelectorAll(".quote-card img, .quote-card script").length;
    el.remove();
    return { pwned, imgs };
  });
  ok("no script executed", !clean.pwned);
  ok("and no element was injected from the quote text", clean.imgs === 0, String(clean.imgs));
}

ok("no uncaught page errors throughout", !errors.length, errors.join(" | "));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
