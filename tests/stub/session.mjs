/* ==========================================================================
   tests/stub/session.mjs — a signed-in device, for the browser suites

   The app no longer opens onto a dashboard. js/authgate.js puts a login
   screen up first, and js/store.js refuses to write to localStorage until a
   session token exists, so a suite that clears storage and reloads now finds
   a sign-in form where it expected the app.

   Every one of those suites is testing something else — keyboard handling,
   XSS escaping, contrast, the shop — and none of them should have to know
   how sign-in works. So they establish the one condition the gate actually
   tests for: a token in localStorage, which is what a device that signed in
   yesterday looks like.

   No fake server goes with it. The suites run against a static file server,
   so js/sync.js's restore() call gets a 404 rather than a 401, lands in the
   "offline — working locally" branch, and leaves the session in place. That
   is a real state (a signed-in device with no connectivity), which is why it
   works without pretending to be one.

   The gate itself is tested in tests/gate.mjs, where the login screen is the
   subject rather than an obstacle.
   ========================================================================== */

export const TOKEN_KEY = "scholar.token.v1";
export const TEST_TOKEN = "test-session-token";

/**
 * Wipe local data and hand the page back a signed-in device.
 *
 * Drop-in for the `localStorage.clear()` the browser suites all ran before
 * reloading: same clean slate, minus the login screen.
 */
export async function resetSignedIn(page) {
  await page.evaluate(([k, t]) => {
    localStorage.clear();
    localStorage.setItem(k, t);
  }, [TOKEN_KEY, TEST_TOKEN]);
}

/**
 * Establish the session before the page has loaded at all.
 *
 * addInitScript re-runs on every navigation, so this survives a reload —
 * useful where a suite seeds localStorage the same way. It only sets the
 * token; it never clears, so a suite can seed a dataset alongside it.
 */
export async function signedInDevice(page) {
  await page.addInitScript(([k, t]) => { localStorage.setItem(k, t); }, [TOKEN_KEY, TEST_TOKEN]);
}
