/* ==========================================================================
   tests/urlguard.mjs — screening and fetching a URL somebody else chose

   "Paste a link and I'll read it" hands an attacker a request originating
   inside the deploy. The screening is the whole defence, so it is tested as
   a unit rather than only through the route above it — and specifically at
   the points where this kind of check usually fails:

     • the redirect. A permitted host that 302s to 169.254.169.254 defeats
       any check that only ran on the URL the user typed.
     • the IPv4-mapped IPv6 form, which `new URL()` silently rewrites into
       hex, so a dotted-quad match never sees it.
     • over-blocking. A guard that rejects fda.gov is a bug report too.

   Run: node tests/urlguard.mjs
   ========================================================================== */

const G = await import("../netlify/functions/_lib/urlguard.js");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};

/* ================================================================ screen == */
console.log("\nurlguard: private and unroutable hosts are refused");
for (const u of [
  "https://127.0.0.1/x", "https://10.1.2.3/x", "https://192.168.1.1/x",
  "https://172.16.0.1/x", "https://169.254.169.254/latest/meta-data/",
  "https://100.64.0.1/x", "https://0.0.0.0/x",
  "https://localhost/x", "https://api.localhost/x", "https://printer.local/x",
  "https://vault.internal/x", "https://metadata.google.internal/x",
  "https://[::1]/x", "https://[fd00::1]/x", "https://[fc00::1]/x", "https://[fe80::1]/x",
  "https://[::ffff:10.0.0.1]/x", "https://[::ffff:169.254.169.254]/x"
]) {
  ok(`${u} refused`, G.urlProblem(u, { allowHttp: true }) !== null);
}

console.log("\nurlguard: ordinary public URLs are allowed");
for (const u of [
  "https://fda.gov/x", "https://fdic.gov/x", "https://fcbarcelona.com/x",
  "https://fe80school.org/bell", "https://lincoln.k12.ca.us/schedule",
  "https://www.school.edu/calendar?y=2026", "https://8.8.8.8/x", "https://172.32.0.1/x"
]) {
  ok(`${u} allowed`, G.urlProblem(u, { allowHttp: true }) === null, String(G.urlProblem(u, { allowHttp: true })));
}

console.log("\nurlguard: scheme and credential rules differ by caller");
ok("http is allowed for a pasted link", G.urlProblem("http://school.edu/x", { allowHttp: true }) === null);
ok("http is refused for a webhook", G.urlProblem("http://school.edu/x", { allowHttp: false }) !== null);
ok("ftp is always refused", G.urlProblem("ftp://school.edu/x", { allowHttp: true }) !== null);
ok("file is always refused", G.urlProblem("file:///etc/passwd", { allowHttp: true }) !== null);
ok("credentials are refused", G.urlProblem("https://u:p@school.edu/x", { allowHttp: true }) !== null);
ok("nonsense is refused", G.urlProblem("not a url", { allowHttp: true }) !== null);
ok("empty is refused", G.urlProblem("", { allowHttp: true }) !== null);

/* ================================================================= html === */
console.log("\nurlguard: HTML becomes text a model can read");
{
  const html = `<html><head><title>Bell Schedule</title>
    <style>.x{color:red}</style><script>alert(1)</script></head>
    <body><nav>Home About</nav>
    <table><tr><th>Period</th><th>Time</th></tr>
    <tr><td>Period 1</td><td>8:00&ndash;8:50</td></tr>
    <tr><td>Period 2</td><td>8:55 &amp; 9:45</td></tr></table>
    <p>Lunch is at 11:00</p></body></html>`;
  const text = G.htmlToText(html);
  ok("the title is extracted", G.pageTitle(html) === "Bell Schedule", G.pageTitle(html));
  ok("script contents are dropped", !/alert/.test(text), text);
  ok("style contents are dropped", !/color:red/.test(text), text);
  ok("entities are decoded", text.includes("8:55 & 9:45"), text);
  // Rows on their own lines is what stops a bell table collapsing into soup.
  ok("table rows stay on separate lines", /Period 1[\s\S]*\n[\s\S]*Period 2/.test(text), JSON.stringify(text));
  ok("cells within a row stay separated", /Period 1\t/.test(text), JSON.stringify(text));
  ok("body text survives", text.includes("Lunch is at 11:00"));
  ok("no tags remain", !/[<>]/.test(text.replace(/&[a-z]+;/g, "")), text);
}

/* ================================================================ fetch === */
console.log("\nurlguard: fetching re-screens every redirect");
{
  const realFetch = globalThis.fetch;
  const calls = [];
  const page = (body, headers) => ({
    status: 200, ok: true,
    headers: new Headers({ "content-type": "text/html", ...(headers || {}) }),
    text: async () => body, body: null
  });
  const redirect = (to) => ({
    status: 302, ok: false,
    headers: new Headers({ location: to }), text: async () => "", body: null
  });

  // A permitted host that redirects to the cloud metadata endpoint.
  globalThis.fetch = async (u) => {
    calls.push(String(u));
    if (String(u).includes("school.edu")) return redirect("http://169.254.169.254/latest/meta-data/");
    return page("<p>secrets</p>");
  };
  let threw = null;
  try { await G.fetchPage("https://school.edu/bell"); } catch (e) { threw = e; }
  ok("a redirect to a private address is refused", threw && threw.status === 400, JSON.stringify(threw));
  ok("and the private address is never requested",
     !calls.some((c) => c.includes("169.254")), calls.join(" | "));

  // A normal page.
  calls.length = 0;
  globalThis.fetch = async (u) => { calls.push(String(u)); return page("<title>T</title><p>Period 1 8:00</p>"); };
  const r = await G.fetchPage("school.edu/bell");
  ok("a bare hostname gets https:// assumed", calls[0].startsWith("https://"), calls[0]);
  ok("the text comes back", r.text.includes("Period 1 8:00"), r.text);
  ok("and the resolved url is reported", r.url.includes("school.edu"), r.url);

  // A redirect chain that stays public is followed.
  calls.length = 0;
  let hop = 0;
  globalThis.fetch = async (u) => {
    calls.push(String(u));
    if (hop++ < 2) return redirect("https://school.edu/step" + hop);
    return page("<p>arrived</p>");
  };
  const chained = await G.fetchPage("https://school.edu/start");
  ok("a public redirect chain is followed", chained.text.includes("arrived"), chained.text);

  // Too many hops.
  calls.length = 0;
  globalThis.fetch = async (u) => { calls.push(String(u)); return redirect("https://school.edu/again" + calls.length); };
  threw = null;
  try { await G.fetchPage("https://school.edu/loop"); } catch (e) { threw = e; }
  ok("an endless redirect gives up", threw && threw.status === 502, JSON.stringify(threw));

  // Content types that can't be read say what to do instead.
  globalThis.fetch = async () => page("%PDF-1.4", { "content-type": "application/pdf" });
  threw = null;
  try { await G.fetchPage("https://school.edu/bell.pdf"); } catch (e) { threw = e; }
  ok("a PDF is named specifically", threw && threw.status === 415 && /PDF/.test(threw.message), JSON.stringify(threw));

  globalThis.fetch = async () => page("...", { "content-type": "image/png" });
  threw = null;
  try { await G.fetchPage("https://school.edu/x.png"); } catch (e) { threw = e; }
  ok("a non-page is refused", threw && threw.status === 415, JSON.stringify(threw));

  // A login wall is the single most likely failure on a school site.
  globalThis.fetch = async () => ({ status: 403, ok: false, headers: new Headers(), text: async () => "", body: null });
  threw = null;
  try { await G.fetchPage("https://school.edu/private"); } catch (e) { threw = e; }
  ok("a login wall says to paste the text instead",
     threw && threw.status === 422 && /paste/i.test(threw.message), JSON.stringify(threw));

  // An oversized declared body is refused before it is read.
  globalThis.fetch = async () => page("x", { "content-length": String(G.MAX_BYTES + 1) });
  threw = null;
  try { await G.fetchPage("https://school.edu/huge"); } catch (e) { threw = e; }
  ok("an oversized page is refused", threw && threw.status === 413, JSON.stringify(threw));

  // A network failure is a readable message, not a stack trace.
  globalThis.fetch = async () => { throw new Error("getaddrinfo ENOTFOUND"); };
  threw = null;
  try { await G.fetchPage("https://nope.example/x"); } catch (e) { threw = e; }
  ok("an unreachable host is readable", threw && threw.status === 502 && !/ENOTFOUND/.test(threw.message),
     JSON.stringify(threw));

  globalThis.fetch = realFetch;
}

/* ============================================= links and unrendered pages = */
console.log("\nurlguard: an index page's links are offered as candidates");
{
  const html = `<html><body>
    <a href="/files/course-guide.pdf">2026-27 Course Guide</a>
    <a href="/o/mead/page/registration">Course Registration</a>
    <a href="/o/mead/page/athletics">Athletics</a>
    <a href="#top">Back to top</a>
    <a href="mailto:x@y.z">Email us</a>
    <a href="/o/mead/page/electives">Electives</a>
  </body></html>`;
  const links = G.pageLinks(html, "https://mead.example/o/mead/page/electives");
  ok("anchors are absolute", links.every((l) => l.url.startsWith("https://mead.example/")), JSON.stringify(links));
  ok("in-page anchors are dropped", !links.some((l) => l.url.includes("#top")), JSON.stringify(links));
  ok("mailto is dropped", !links.some((l) => /mailto/.test(l.url)), JSON.stringify(links));
  ok("a PDF is flagged", links.some((l) => l.pdf && /Course Guide/.test(l.text)), JSON.stringify(links));
  ok("link text is kept", links.some((l) => l.text === "Course Registration"), JSON.stringify(links));
}

console.log("\nurlguard: a page whose content never arrived is recognised");
{
  // The signature of a single-page-app shell: a large HTML payload whose
  // words are all navigation, because the content is fetched by JavaScript
  // a server-side fetch never runs.
  const shell = "<html><body>" +
    "<nav><a href=\"/a\">About</a><a href=\"/b\">Academics</a><a href=\"/c\">Athletics</a></nav>" +
    "<div id=\"root\"></div>" +
    "<script>" + "x".repeat(6000) + "</script>" +
    "</body></html>";
  const shellText = G.htmlToText(shell);
  ok("the shell is flagged", G.looksUnrendered(shellText, shell), JSON.stringify(shellText));

  const real = "<html><body><h1>Electives</h1>" +
    Array.from({ length: 60 }, (_, i) => `<p>Course ${i} is a semester elective open to grades 9 through 12.</p>`).join("") +
    "</body></html>";
  ok("a real page is not flagged", !G.looksUnrendered(G.htmlToText(real), real));

  // A short page that is genuinely short must not be called unrendered just
  // for being brief — the ratio is what distinguishes them.
  const terse = "<html><body><p>Period 1 8:00-8:50</p><p>Period 2 8:55-9:45</p></body></html>";
  ok("a terse but complete page is not flagged", !G.looksUnrendered(G.htmlToText(terse), terse),
     JSON.stringify(G.htmlToText(terse)));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
