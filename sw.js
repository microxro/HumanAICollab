/* ==========================================================================
   sw.js — service worker: offline shell + cache management

   Strategy
     • app shell (HTML/CSS/JS/manifest): stale-while-revalidate, so the app
       opens instantly and quietly updates in the background
     • /api/*: network only — never cache someone's synced data or a parent's
       live view of where their kid is
     • everything else: cache-first with a network fallback
   ========================================================================== */

// Bump on every deploy. `activate` deletes any cache whose key doesn't start
// with the current VERSION, so this string is the only thing that evicts a
// stale shell. It sat at v2.0.0 across every release, which meant returning
// users kept whatever they first cached.
const VERSION = "studyhold-v2.7.0";
const SHELL_CACHE = VERSION + "-shell";
const RUNTIME_CACHE = VERSION + "-runtime";

const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/theme.css",
  "./css/layout.css",
  "./css/components.css",
  "./css/views.css",
  "./js/utils.js",
  "./js/store.js",
  "./js/store2.js",
  "./js/i18n.js",
  "./js/ui.js",
  "./js/charts.js",
  "./js/md.js",
  "./js/nlp.js",
  "./js/ics.js",
  "./js/idb.js",
  "./js/notify.js",
  "./js/geo.js",
  "./js/sync.js",
  "./js/planner.js",
  "./js/guidance.js",
  "./js/shop.js",
  "./js/quotes.js",
  "./js/assistant.js",
  "./js/aiadd.js",
  "./js/views/dashboard.js",
  "./js/views/calendar.js",
  "./js/views/schedule.js",
  "./js/views/homework.js",
  "./js/views/classes.js",
  "./js/views/grades.js",
  "./js/views/planner.js",
  "./js/views/focus.js",
  "./js/views/flashcards.js",
  "./js/views/notes.js",
  "./js/views/reading.js",
  "./js/views/shop.js",
  "./js/views/activities.js",
  "./js/views/goals.js",
  "./js/views/college.js",
  "./js/views/guidance.js",
  "./js/views/contacts.js",
  "./js/views/analytics.js",
  "./js/views/sharing.js",
  "./js/views/groups.js",
  "./js/views/parent.js",
  "./js/views/classroom.js",
  "./js/views/settings.js",
  "./js/views/assistant.js",
  "./js/app.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // addAll rejects the whole install if any single file 404s, so add
      // them individually and tolerate misses.
      .then((cache) => Promise.all(SHELL.map((url) =>
        cache.add(new Request(url, { cache: "reload" })).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
  if (event.data === "clearCache") {
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
  }
});

function isShell(url) {
  return SHELL.some((path) => url.pathname.endsWith(path.replace("./", "/")));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never touch the API — stale synced data would be worse than an error.
  if (url.pathname.startsWith("/api/")) return;

  // Cross-origin requests pass straight through.
  if (url.origin !== self.location.origin) return;

  // Navigations: serve the cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // App shell: network-first, falling back to cache when offline.
  //
  // This used to be stale-while-revalidate, which returns the cached copy
  // immediately. Navigations are already network-first, so a returning user
  // got a *fresh* index.html paired with *stale* JS from an earlier deploy —
  // modules missing, handlers unbound, an app that looks alive and responds
  // to nothing. Correctness beats the few hundred ms: an offline load still
  // works, and a warm HTTP cache makes the repeat cost small.
  if (isShell(url)) {
    event.respondWith(
      // `cache: "reload"` bypasses the browser's own HTTP cache on the way
      // out. Without it "network-first" is a misnomer: the fetch is answered
      // from the HTTP cache and never reaches the network, so a max-age on
      // these files silently defeats the whole strategy. Belt and braces with
      // the must-revalidate headers in netlify.toml, because a user whose
      // browser already cached the *old* headers is only fixed by this half.
      fetch(new Request(req, { cache: "reload" }))
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Everything else: cache-first.
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res && res.status === 200 && res.type === "basic") {
        const copy = res.clone();
        caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => cached))
  );
});
