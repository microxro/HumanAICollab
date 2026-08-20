/* ==========================================================================
   sw.js — service worker: offline shell + cache management

   Strategy
     • app shell (HTML/CSS/JS/manifest): stale-while-revalidate, so the app
       opens instantly and quietly updates in the background
     • /api/*: network only — never cache someone's synced data or a parent's
       live view of where their kid is
     • everything else: cache-first with a network fallback
   ========================================================================== */

const VERSION = "scholar-v2.0.0";
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
  "./js/views/activities.js",
  "./js/views/goals.js",
  "./js/views/college.js",
  "./js/views/contacts.js",
  "./js/views/analytics.js",
  "./js/views/sharing.js",
  "./js/views/groups.js",
  "./js/views/parent.js",
  "./js/views/settings.js",
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

  // App shell: stale-while-revalidate.
  if (isShell(url)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200) {
              const copy = res.clone();
              caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
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
