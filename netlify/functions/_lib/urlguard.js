/* ==========================================================================
   _lib/urlguard.js — screening and fetching a URL somebody else chose

   Two features now hand a user-supplied URL to the server and ask it to make
   a request: webhook delivery (F100) and "add this from a link". Both are
   server-side request forgery primitives if unscreened — a URL pointed at
   169.254.169.254 or http://localhost:8888 makes the function fetch an
   internal endpoint and report back what it found.

   The screening lived inline in api.js. It is here instead because there are
   now two callers, and a duplicated security check is a check that drifts:
   the copy that gets fixed is the one someone happened to be looking at.

   `fetchPage` adds what a *fetch* needs beyond screening — a timeout, a size
   cap, and re-screening after every redirect, since a permitted host can
   redirect to a forbidden one and only the final URL matters.
   ========================================================================== */

const MAX_BYTES = 2 * 1024 * 1024;      // 2 MB of HTML is a very large page
const TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 3;

/** Loopback, private, link-local and CGNAT IPv4 ranges. */
function privateV4(a, b) {
  return a === 10 || a === 127 || a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127);
}

/**
 * The IPv4 octets inside an IPv4-mapped IPv6 literal, or null.
 * Handles both `::ffff:10.0.0.1` and the normalised `::ffff:a00:1` — `new
 * URL()` rewrites the first into the second, so matching only on dots misses
 * every one of these.
 */
function mappedV4(h) {
  const m = h.match(/^::ffff:(.+)$/i);
  if (!m) return null;
  const dotted = m[1].match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dotted) return dotted.slice(1, 5).map(Number);
  const hex = m[1].match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hex) return null;
  const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16);
  return [hi >> 8, hi & 255, lo >> 8, lo & 255];
}

/**
 * Why this URL can't be fetched, or null when it's fine.
 * `allowHttp` is for pasted links only — a person typing a school website
 * address rarely types the scheme, and plenty of school sites still redirect
 * from http. Webhooks stay https-only, because there the URL is stored and
 * replayed rather than followed once by the person who typed it.
 */
function urlProblem(raw, { allowHttp = false } = {}) {
  let u;
  try { u = new URL(String(raw || "")); } catch (e) { return "That isn't a valid URL."; }

  if (u.protocol !== "https:" && !(allowHttp && u.protocol === "http:")) {
    return allowHttp ? "Links must start with http:// or https://." : "Webhook URLs must use https.";
  }
  if (u.username || u.password) return "That URL can't carry credentials.";

  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      host.endsWith(".internal") || host === "metadata.google.internal") {
    return "That host isn't reachable from the internet.";
  }

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4 && privateV4(Number(v4[1]), Number(v4[2]))) {
    return "That address is on a private network.";
  }

  // Gated on the host actually *being* an IPv6 literal. These are hex-digit
  // prefix tests; applied to a name they reject any domain beginning "fc",
  // "fd" or "fe80" — fcbarcelona.com, fda.gov, fdic.gov. A bare hostname can
  // never contain a colon, so `:` is a reliable discriminator.
  const isV6Literal = u.hostname.startsWith("[") || host.includes(":");
  if (isV6Literal) {
    const h = host.replace(/%.*$/, "");   // drop any zone id
    if (h === "::1" || h === "::" || /^f[cd]/.test(h) || /^fe[89ab]/.test(h)) {
      return "That address is on a private network.";
    }
    const mapped = mappedV4(h);
    if (mapped && privateV4(mapped[0], mapped[1])) {
      return "That address is on a private network.";
    }
  }
  return null;
}

/**
 * Strip HTML to the text a model can actually read.
 *
 * Not a parser — there is no DOM in this runtime and pulling one in for this
 * would be a large dependency for a lossy job either way. Script, style and
 * navigation chrome are dropped outright because they are pure noise that
 * would otherwise eat the token budget; block-level tags become newlines so
 * a bell-times table doesn't collapse into one unreadable line, which is the
 * difference between the model reading a schedule and reading soup.
 */
function htmlToText(html) {
  let s = String(html || "");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style|noscript|svg|head)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  // Keep table structure: cells separated, rows on their own lines.
  s = s.replace(/<\/(td|th)>/gi, "\t");
  s = s.replace(/<\/(tr|p|div|li|h[1-6]|section|article|header|footer)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");

  // Named entities matter more here than they look. A bell-times table is
  // "8:00&ndash;8:50" on most school sites, and an undecoded &ndash; between
  // every pair of times is noise the model has to see past on every row.
  const NAMED = {
    nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
    ndash: "\u2013", mdash: "\u2014", minus: "\u2212", hellip: "\u2026",
    lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201c", rdquo: "\u201d",
    times: "\u00d7", middot: "\u00b7", bull: "\u2022", deg: "\u00b0"
  };
  s = s.replace(/&([a-z]+);/gi, (m, n) => {
    const hit = NAMED[String(n).toLowerCase()];
    return hit === undefined ? m : hit;
  });
  s = s.replace(/&#x([0-9a-f]+);/gi, (_m, h) => safeCodePoint(parseInt(h, 16)));
  s = s.replace(/&#(\d+);/g, (_m, d) => safeCodePoint(Number(d)));

  // Collapse runs of spaces but keep the tabs inserted for cell boundaries —
  // they are the only thing left telling a period apart from its time.
  s = s.replace(/ {2,}/g, " ").replace(/\t{2,}/g, "\t").replace(/ ?\t ?/g, "\t");
  s = s.replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function safeCodePoint(n) {
  if (!Number.isFinite(n) || n < 9 || n > 0x10ffff) return "";
  try { return String.fromCodePoint(n); } catch (e) { return ""; }
}

/**
 * Links out of the page, with their text.
 *
 * Half of school "electives" pages are an index: a paragraph, then a link to
 * the real course guide as a PDF or a per-department subpage. Returning the
 * candidates turns "nothing found" into "try one of these" instead of a dead
 * end, which is the difference between a feature that works on the second
 * click and one the student gives up on.
 */
function pageLinks(html, baseUrl, max) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < (max || 40)) {
    let href = m[1].trim();
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) continue;
    let abs;
    try { abs = new URL(href, baseUrl).href; } catch (e) { continue; }
    if (!/^https?:/i.test(abs)) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    const text = htmlToText(m[2]).replace(/\s+/g, " ").trim().slice(0, 120);
    if (!text) continue;
    out.push({ url: abs, text, pdf: /\.pdf(\?|$)/i.test(abs) });
  }
  return out;
}

/**
 * Does this look like a page whose content never arrived?
 *
 * A single-page-app shell serves navigation and an empty root div; the words
 * are fetched by JavaScript that a server-side fetch never runs. The failure
 * is indistinguishable from "this page has nothing on it" unless you say so,
 * and school sites on the common CMS platforms are frequently built this way.
 */
function looksUnrendered(text, html) {
  const words = String(text || "").split(/\s+/).filter(Boolean).length;
  if (words > 220) return false;                       // plenty of real text
  // A big HTML payload that boils down to very few words is the signature:
  // all markup and script, no prose.
  const ratio = String(html || "").length / Math.max(1, String(text || "").length);
  return words < 120 && ratio > 18;
}

/** The <title>, which is often the only place an event's name appears. */
function pageTitle(html) {
  const m = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? htmlToText(m[1]).slice(0, 200) : "";
}

/**
 * Fetch a page the user pasted, following redirects by hand.
 *
 * `redirect: "manual"` rather than "follow" so every hop is re-screened:
 * a public host that 302s to 169.254.169.254 defeats a check that only ran
 * on the URL the user typed, and that redirect is entirely under the remote
 * server's control.
 *
 * Throws `{ status, message }`, which both function routers already turn
 * into the right response.
 */
async function fetchPage(rawUrl, { allowHttp = true } = {}) {
  let current = String(rawUrl || "").trim();
  // People paste "school.edu/bell-schedule" far more often than they type a
  // scheme. Assume https rather than rejecting something obviously intended.
  if (current && !/^[a-z][a-z0-9+.-]*:/i.test(current)) current = "https://" + current;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const problem = urlProblem(current, { allowHttp });
    if (problem) throw { status: 400, message: problem };

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: ctl.signal,
        headers: {
          // Identify honestly. Some school sites serve a stripped page to
          // unknown agents, but pretending to be a browser to get around
          // that is exactly the behaviour a site owner is entitled to block.
          "User-Agent": "StudyHold/1 (+student schedule importer)",
          "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5"
        }
      });
    } catch (e) {
      clearTimeout(timer);
      if (e && e.name === "AbortError") {
        throw { status: 504, message: "That page took too long to load. Try again, or paste the text instead." };
      }
      throw { status: 502, message: "Couldn't reach that page. Check the link is right and publicly visible." };
    }
    clearTimeout(timer);

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw { status: 502, message: "That page redirected somewhere with no destination." };
      current = new URL(loc, current).href;
      continue;
    }

    if (res.status === 401 || res.status === 403) {
      throw { status: 422, message: "That page needs a login, so the server can't read it. Open it yourself and paste the text instead." };
    }
    if (!res.ok) {
      throw { status: 502, message: `That page returned ${res.status}. Check the link is right.` };
    }

    const type = (res.headers.get("content-type") || "").toLowerCase();
    if (type && !/text\/html|text\/plain|application\/xhtml/.test(type)) {
      // A PDF bell schedule is extremely common, and worth naming precisely
      // rather than failing with a generic "unsupported".
      if (type.includes("pdf")) {
        throw { status: 415, message: "That's a PDF, which this can't read yet. Open it and use the photo option, or paste the text." };
      }
      throw { status: 415, message: "That link isn't a web page." };
    }

    // Read with a hard cap. Content-Length is a claim, not a guarantee, so
    // the stream is also cut off — a server can send far more than it says.
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared && declared > MAX_BYTES) {
      throw { status: 413, message: "That page is too large to read." };
    }
    const raw = await readCapped(res, MAX_BYTES);
    const text = htmlToText(raw);

    return {
      url: current,
      title: pageTitle(raw),
      text,
      links: pageLinks(raw, current, 40),
      // Reported rather than thrown on: a thin page may still be exactly what
      // the caller wanted, and only the caller knows whether it found
      // anything. It decides what to say; this just supplies the evidence.
      unrendered: looksUnrendered(text, raw),
      bytes: raw.length
    };
  }

  throw { status: 502, message: "That link redirected too many times." };
}

async function readCapped(res, max) {
  if (!res.body || typeof res.body.getReader !== "function") {
    const t = await res.text();
    return t.length > max ? t.slice(0, max) : t;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { chunks.push(value.slice(0, value.length - (total - max))); break; }
    chunks.push(value);
  }
  try { await reader.cancel(); } catch (e) { /* already done */ }
  const merged = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { merged.set(c, at); at += c.length; }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

export { urlProblem, privateV4, mappedV4, htmlToText, pageTitle, pageLinks, looksUnrendered, fetchPage, MAX_BYTES };
