/* ==========================================================================
   sync.js — account, cloud sync, parent link, and study-group client

   Offline-first by design: the app is fully usable signed out, every write
   still lands in localStorage first, and sync is a debounced background push
   that retries. A version conflict surfaces to the user rather than silently
   picking a winner.
   ========================================================================== */

App.sync = (function () {
  const U = App.utils, S = App.store;

  const TOKEN_KEY = "scholar.token.v1";
  const VERSION_KEY = "scholar.syncver.v1";
  const PUSH_DEBOUNCE_MS = 4000;
  const FOREGROUND_PULL_MS = 60000;   // throttle for pull-on-foreground (below)
  let lastPullAt = 0;

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || null,
    user: null,
    version: Number(localStorage.getItem(VERSION_KEY) || 0),
    status: "offline",     // offline | idle | syncing | error | conflict
    lastSync: null,
    error: null,
    listeners: new Set(),
    timer: null,
    inflight: false
  };

  /* --------------------------------------------------------- plumbing -- */

  function on(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); }
  function emit() {
    const snapshot = [...state.listeners];
    const i = info();
    snapshot.forEach((f) => { try { f(i); } catch (e) { console.error(e); } });
  }

  function setStatus(s, err) {
    state.status = s;
    state.error = err || null;
    emit();
  }

  function info() {
    return {
      signedIn: !!state.token && !!state.user,
      user: state.user,
      status: state.status,
      version: state.version,
      lastSync: state.lastSync,
      error: state.error,
      pending: !!state.timer || !!state.inflight   // F091 — a write is queued or in flight
    };
  }

  function isSignedIn() { return !!state.token && !!state.user; }

  /**
   * The bearer token, for other modules that call the backend directly.
   * js/assistant.js needs it now that the AI routes require an account —
   * they used to be anonymous, which meant anyone on the internet could
   * spend this deploy's provider quota.
   */
  function authToken() { return state.token || null; }

  // Same-origin in production; configurable so a local file:// build can point
  // at a deployed site.
  function base() {
    return (S.db.settings.apiBase || "").replace(/\/$/, "") || "/api";
  }

  async function call(path, opts) {
    const o = opts || {};
    const headers = { "Content-Type": "application/json" };
    if (state.token) headers.Authorization = "Bearer " + state.token;

    let res;
    try {
      res = await fetch(base() + path, {
        method: o.method || "GET",
        headers,
        body: o.body ? JSON.stringify(o.body) : undefined
      });
    } catch (e) {
      throw Object.assign(new Error("Can't reach the server. Check your connection."), { offline: true });
    }

    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }

    if (res.status === 401) {
      signOutLocal();
      throw Object.assign(new Error("Your session expired — sign in again."), { status: 401 });
    }
    if (!res.ok) {
      throw Object.assign(new Error((data && data.error) || `Request failed (${res.status})`),
        { status: res.status, data });
    }
    return data;
  }

  /* ------------------------------------------------------------- auth -- */

  async function signUp(email, password, name, role) {
    setStatus("syncing");
    const res = await call("/auth/signup", { method: "POST", body: { email, password, name, role } });
    adoptSession(res);
    // A brand-new account starts from whatever is already on this device.
    await push(true);
    return res.user;
  }

  async function signIn(email, password) {
    setStatus("syncing");
    const res = await call("/auth/login", { method: "POST", body: { email, password } });
    adoptSession(res);
    await pullAndMerge();
    return res.user;
  }

  // F098 — password reset. Both endpoints are unauthenticated (call() only
  // adds a bearer header when signed in, so these work fine while logged out).
  async function forgotPassword(email) { return call("/auth/forgot", { method: "POST", body: { email } }); }
  async function resetPassword(token, password) { return call("/auth/reset", { method: "POST", body: { token, password } }); }

  function adoptSession(res) {
    state.token = res.token;
    state.user = res.user;
    localStorage.setItem(TOKEN_KEY, res.token);
    S.commit((db) => {
      db.account.userId = res.user.id;
      db.account.email = res.user.email;
      db.account.role = res.user.role;
    });
    setStatus("idle");
  }

  function signOutLocal() {
    state.token = null;
    state.user = null;
    state.version = 0;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(VERSION_KEY);
    setStatus("offline");
  }

  function signOut() {
    signOutLocal();
    S.commit((db) => {
      db.account.userId = null;
      db.account.email = null;
      db.account.token = null;
      db.account.lastSync = null;
    });
  }

  async function restore() {
    if (!state.token) { setStatus("offline"); return null; }
    try {
      const res = await call("/me");
      state.user = res.user;
      setStatus("idle");
      await pullAndMerge();
      return res.user;
    } catch (e) {
      if (e.offline) setStatus("error", "Offline — working locally.");
      return null;
    }
  }

  /* ------------------------------------------------------------- sync -- */

  /** Snapshot of local data worth syncing (transient UI state excluded). */
  function snapshot() {
    const db = S.db;
    const copy = JSON.parse(JSON.stringify(db));
    delete copy.ui;
    delete copy.account;      // tokens never leave this device
    return copy;
  }

  async function pull() {
    const res = await call("/sync");
    return res;
  }

  /**
   * Pull on sign-in. If the server has data and it's newer than our last
   * known sync, take it; if we have local edits since, ask the user.
   */
  async function pullAndMerge() {
    setStatus("syncing");
    try {
      const res = await pull();
      if (!res.state) {
        await push(true);
        return;
      }
      const localDirty = S.db.ui && S.db.ui.dirty ? S.db.ui.dirty : 0;
      const serverNewer = (res.updatedAt || 0) > (state.lastSync || 0);

      if (state.version === 0 && localDirty && serverNewer) {
        // Two real datasets — let the person choose rather than guess.
        setStatus("conflict");
        if (App.ui) {
          App.ui.confirm({
            title: "This device has unsynced data",
            message: "Your account already has saved data. Keep the cloud copy, or overwrite it with what's on this device?",
            okLabel: "Use cloud copy",
            onConfirm() { adoptRemote(res); },
            onCancel() { push(true); }
          });
        }
        return;
      }
      adoptRemote(res);
    } catch (e) {
      setStatus("error", e.message);
    }
  }

  function adoptRemote(res) {
    S.replaceAll(res.state);
    state.version = res.version || 0;
    state.lastSync = res.updatedAt || Date.now();
    localStorage.setItem(VERSION_KEY, String(state.version));
    setStatus("idle");
    if (App.router) App.router.refresh();
    if (App.ui) App.ui.toast("Synced", "Loaded your data from the cloud.", "ok");
  }

  /**
   * `overwrite` means the person explicitly chose to keep this device's copy
   * after a conflict. It no longer sends a `force` flag — the server used to
   * accept one that skipped concurrency control entirely, which meant any
   * caller could overwrite another device's data on demand. Overwriting is
   * now expressed the honest way: adopt the server's current version (done by
   * the caller) and push against it, so the write still has to win a real
   * conditional update and a *third* device's change can still raise a
   * conflict instead of being silently lost.
   */
  async function push(overwrite) {
    if (!isSignedIn()) return { ok: false, reason: "signed-out", message: "You're not signed in." };
    if (state.inflight) return { ok: false, reason: "busy", message: "A sync is already running." };
    state.inflight = true;
    setStatus("syncing");
    try {
      const res = await call("/sync", {
        method: "PUT",
        body: { state: snapshot(), baseVersion: state.version }
      });
      state.version = res.version;
      state.lastSync = res.updatedAt;
      localStorage.setItem(VERSION_KEY, String(state.version));
      S.db.account.lastSync = res.updatedAt;
      S.save();
      setStatus("idle");
      return { ok: true, version: res.version };
    } catch (e) {
      // push() used to swallow every failure and resolve anyway, so callers
      // doing `.then(() => toast("Synced ✓"))` reported success while the
      // badge beside them turned amber. Offline, you got a green tick for a
      // sync that never happened. It resolves with an outcome now — no
      // rejection, because a failed background push must not surface as an
      // unhandled rejection, but callers can tell the difference.
      let outcome;
      if (e.status === 409) {
        setStatus("conflict", "Another device saved changes.");
        handleConflict(e.data);
        outcome = { ok: false, reason: "conflict", message: "Another device saved changes." };
      } else if (e.offline) {
        setStatus("error", "Offline — will retry.");
        outcome = { ok: false, reason: "offline", message: "You're offline — changes are saved on this device and will sync later." };
      } else {
        setStatus("error", e.message);
        outcome = { ok: false, reason: "error", message: e.message };
      }
      return outcome;
    } finally {
      state.inflight = false;
    }
  }

  function handleConflict(data) {
    if (!data || !App.ui) return;
    App.ui.confirm({
      title: "Changes from another device",
      message: `Another device saved changes ${U.fmtDate(U.dateKey(new Date(data.updatedAt)))}. ` +
               "Keep those and discard this device's unsaved edits, or overwrite them with this device?",
      okLabel: "Keep other device",
      danger: false,
      onConfirm() {
        adoptRemote({ state: data.state, version: data.version, updatedAt: data.updatedAt });
      },
      onCancel() {
        // Adopt the server's version so the next push is a legitimate
        // conditional update rather than a bypass.
        state.version = data.version;
        localStorage.setItem(VERSION_KEY, String(state.version));
        push(true);
      }
    });
  }

  /** Debounced push, called from store.commit() on every write. */
  function queue() {
    if (!isSignedIn() || !S.db.account.autoSync) return;
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      // Clearing the handle is not bookkeeping — refresh() and info() both
      // read `state.timer` as "a write is pending". It was never nulled after
      // firing, so after the very first edit the 60s background pull and the
      // pull-on-visibility were both disabled for the rest of the session:
      // another device's changes never arrived, and the sync badge showed a
      // permanently pending write that had already completed.
      state.timer = null;
      push(false);
    }, PUSH_DEBOUNCE_MS);
  }

  /* ------------------------------------------------------------- links -- */

  async function createLinkCode() { return (await call("/link/code", { method: "POST" })).code; }
  async function redeemLinkCode(code) { return call("/link/redeem", { method: "POST", body: { code } }); }
  async function children() { return (await call("/link/children")).children || []; }
  async function parents() { return (await call("/link/parents")).parents || []; }
  async function unlink(id) { return call("/link/" + encodeURIComponent(id), { method: "DELETE" }); }

  /* ---------------------------------------------------------- location -- */

  /**
   * Push the student's live status plus a summary that honors the privacy
   * toggles — the server only ever receives what the toggles permit.
   */
  async function pushLocation(status) {
    if (!isSignedIn()) return null;
    const st = S.settings;
    const att = S.attendanceRate();

    const summary = {
      name: S.profile.name,
      usageToday: Math.round(S.db.usage[U.today()] || 0),
      usageWeek: U.sum(Object.entries(S.db.usage)
        .filter(([k]) => k >= U.dateKey(U.startOfWeek(new Date(), true))), ([, v]) => v),
      studyWeek: S.studyThisWeek(),
      openAssignments: S.openAssignments().length,
      overdue: S.overdue().length,
      attendance: U.round(att.rate, 1),
      streak: S.db.streak.count,
      gpa: st.shareGrades ? U.round(S.gpa(), 2) : null,
      classes: st.shareGrades
        ? S.termClasses().map((c) => ({ name: c.name, grade: U.round(S.classGrade(c.id) || 0, 1) }))
        : null,
      upcoming: S.dueSoon(7).slice(0, 6).map((a) => ({
        title: a.title, className: S.className(a.classId), due: a.due
      })),
      // F065 — notify only when something meaningful changed, not on every push.
      gradeAlerts: st.shareGrades ? S.detectChanges() : []
    };

    return call("/location", {
      method: "POST",
      body: { status: st.locationSharing ? status : null, summary }
    });
  }

  async function readLocation(studentId) {
    return (await call("/location/" + encodeURIComponent(studentId))).location;
  }

  /* -------------------------------------------------------------- peers -- */
  // F053 real friend requests.

  async function requestFriend(email) { return call("/peers/request", { method: "POST", body: { email } }); }
  async function respondFriend(id, accept) { return call("/peers/respond", { method: "POST", body: { id, accept } }); }
  async function listFriends() { return (await call("/peers")).peers || []; }
  async function removeFriend(id) { return call("/peers/" + encodeURIComponent(id), { method: "DELETE" }); }

  /* --------------------------------------------------- guardian check-ins */
  // F068 check-in requests, F071 notes from a guardian.

  async function requestCheckin(studentId) { return call("/checkin/request", { method: "POST", body: { studentId } }); }
  async function listCheckins() { return (await call("/checkin")).checkins || []; }
  async function respondCheckin(id) { return call("/checkin/respond", { method: "POST", body: { id } }); }
  async function sendGuardianNote(studentId, text) { return call("/guardian-notes", { method: "POST", body: { studentId, text } }); }
  async function listGuardianNotes() { return (await call("/guardian-notes")).notes || []; }

  /* --------------------------------------------------------- F046 ics feed */
  // The device builds the .ics text (same code as the one-time export) and
  // pushes it here; the server just stores and serves the last copy.

  async function pushIcsFeed(ics) { return (await call("/ics-feed", { method: "POST", body: { ics } })).token; }
  /* ------------------------------------------------------------ F100 --- */

  /** The origin an external client would point at. */
  function apiBaseUrl() {
    const b = (S.db.settings.apiBase || '').replace(/\/$/, '');
    return b || location.origin;
  }

  function listApiTokens() { return call("/tokens"); }

  /**
   * Mints a personal API token. The full value comes back exactly once —
   * the server stores it as a blob key, so there is nowhere to read it back
   * from afterwards, only the prefix hint kept on the profile.
   */
  function mintApiToken(label) {
    return call("/tokens", { method: "POST", body: { label } });
  }

  function revokeApiToken(id) {
    return call("/tokens/" + encodeURIComponent(id), { method: "DELETE" });
  }

  function listWebhooks() { return call("/webhooks"); }

  function addWebhook(url, events) {
    return call("/webhooks", { method: "POST", body: { url, events } });
  }

  function removeWebhook(id) {
    return call("/webhooks/" + encodeURIComponent(id), { method: "DELETE" });
  }

  /** F059 — post one assignment to every class group a teacher is in. */
  function broadcastFeed(payload, groupIds) {
    return call("/groups/broadcast", { method: "POST", body: { ...payload, groupIds } });
  }

  function icsFeedUrl(token) { return `${location.origin}${base()}/ics-feed/${encodeURIComponent(token)}`; }

  /* ------------------------------------------------------ F070 focus windows */
  // A shared quiet period both sides agree to — a parent proposes it, the
  // student sees, agrees to, or declines it, and can end it early.

  async function proposeFocusWindow(studentId, startAt, endAt, note) {
    return call("/focus-windows/propose", { method: "POST", body: { studentId, startAt, endAt, note } });
  }
  async function listFocusWindows() { return (await call("/focus-windows")).focusWindows || []; }
  async function respondFocusWindow(id, action) { return call("/focus-windows/respond", { method: "POST", body: { id, action } }); }
  async function endFocusWindow(id) { return call("/focus-windows/end", { method: "POST", body: { id } }); }

  /* ------------------------------------------------------------ groups -- */

  async function listGroups() { return (await call("/groups")).groups || []; }
  async function createGroup(name) { return (await call("/groups", { method: "POST", body: { name } })).group; }
  async function joinGroup(code) { return (await call("/groups/join", { method: "POST", body: { code } })).group; }
  async function getGroup(id) { return (await call("/groups/" + encodeURIComponent(id))).group; }
  async function shareDeck(id, deck) { return call(`/groups/${encodeURIComponent(id)}/deck`, { method: "POST", body: { deck } }); }
  async function getSharedDeck(id, deckId) { return (await call(`/groups/${encodeURIComponent(id)}/deck/${encodeURIComponent(deckId)}`)).deck; }
  async function postFeed(id, item) { return call(`/groups/${encodeURIComponent(id)}/feed`, { method: "POST", body: item }); }
  async function confirmFeed(id, itemId) { return call(`/groups/${encodeURIComponent(id)}/feed/${encodeURIComponent(itemId)}`, { method: "POST" }); }
  // F058 — discuss a crowdsourced post inline.
  async function commentFeed(id, itemId, text) {
    return (await call(`/groups/${encodeURIComponent(id)}/feed/${encodeURIComponent(itemId)}/comment`, { method: "POST", body: { text } })).comment;
  }
  // F060 — anonymous "how long did this actually take?"
  async function rateFeed(id, itemId, actualMinutes) {
    return call(`/groups/${encodeURIComponent(id)}/feed/${encodeURIComponent(itemId)}/rate`, { method: "POST", body: { actualMinutes } });
  }
  async function leaveGroup(id) { return call(`/groups/${encodeURIComponent(id)}/leave`, { method: "POST" }); }

  /* ------------------------------------- F054-F063 group collaboration -- */

  const G = (id) => `/groups/${encodeURIComponent(id)}`;
  const E = encodeURIComponent;

  // F055 — task assignment
  async function addGroupTask(id, task) { return call(`${G(id)}/tasks`, { method: "POST", body: task }); }
  async function updateGroupTask(id, taskId, patch) { return call(`${G(id)}/tasks/${E(taskId)}`, { method: "POST", body: patch }); }
  async function deleteGroupTask(id, taskId) { return call(`${G(id)}/tasks/${E(taskId)}`, { method: "DELETE" }); }

  /**
   * F054/F057 — share only *busy* blocks, never the schedule itself, so a
   * group can find a common free period without anyone's class names, rooms
   * or grades landing in a blob their classmates can read.
   */
  async function pushAvailability(id) {
    const busy = [];
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach((day) => {
      S.classesOn(day).forEach(({ period }) => {
        if (period) busy.push({ day, start: period.start, end: period.end });
      });
      S.activitiesOn(day).forEach((a) => {
        if (a.start && a.end) busy.push({ day, start: a.start, end: a.end });
      });
    });
    return call(`${G(id)}/availability`, { method: "POST", body: { busy } });
  }

  // F056 — accountability partners
  async function requestPartner(id, withId) { return call(`${G(id)}/partners`, { method: "POST", body: { withId } }); }
  async function respondPartner(id, pairId, accept) { return call(`${G(id)}/partners/${E(pairId)}`, { method: "POST", body: { accept } }); }
  async function endPartner(id, pairId) { return call(`${G(id)}/partners/${E(pairId)}`, { method: "DELETE" }); }

  // F061 — peer tutoring board
  async function postTutoring(id, post) { return call(`${G(id)}/tutoring`, { method: "POST", body: post }); }
  async function respondTutoring(id, postId) { return call(`${G(id)}/tutoring/${E(postId)}`, { method: "POST" }); }
  async function removeTutoring(id, postId) { return call(`${G(id)}/tutoring/${E(postId)}`, { method: "DELETE" }); }

  // F062 — shared notes, attribution attached
  async function shareNote(id, note) { return call(`${G(id)}/notes`, { method: "POST", body: note }); }
  async function getSharedNote(id, noteId) { return call(`${G(id)}/notes/${E(noteId)}`); }
  async function thankNote(id, noteId) { return call(`${G(id)}/notes/${E(noteId)}/thanks`, { method: "POST" }); }
  async function removeSharedNote(id, noteId) { return call(`${G(id)}/notes/${E(noteId)}`, { method: "DELETE" }); }

  // F063 — cooperative challenges
  async function createChallenge(id, ch) { return call(`${G(id)}/challenges`, { method: "POST", body: ch }); }
  async function joinChallenge(id, chId) { return call(`${G(id)}/challenges/${E(chId)}/join`, { method: "POST" }); }
  async function leaveChallenge(id, chId) { return call(`${G(id)}/challenges/${E(chId)}`, { method: "DELETE" }); }

  /**
   * Report my running total for a challenge. Computed locally from real data
   * (study minutes this week, assignments completed) and sent as an absolute
   * value, so a retry can never double-count.
   */
  async function contributeChallenge(id, chId, metric) {
    let amount = 0;
    if (metric === "studyMinutes") amount = S.studyThisWeek();
    else if (metric === "assignmentsDone") amount = S.db.assignments.filter((a) => a.status === "done").length;
    return call(`${G(id)}/challenges/${E(chId)}/contribute`, { method: "POST", body: { amount } });
  }

  /* -------------------------------------------------------------- init -- */

  function init() {
    if (state.token) restore();
    else setStatus("offline");

    // Flush pending changes when the tab goes away or connectivity returns.
    window.addEventListener("online", () => { if (isSignedIn()) push(false); });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { if (isSignedIn()) push(false); return; }
      // Coming back to the foreground: pull anything another device changed
      // while we were away. Without this, push is automatic but a pull only
      // ever happened at sign-in or on a manual pull-to-refresh — so edits
      // made elsewhere silently never showed up.
      refresh();
    });
    setInterval(() => { if (isSignedIn() && state.status === "error") push(false); }, 60000);
    // A long-lived tab that never backgrounds still needs to see other devices.
    setInterval(refresh, FOREGROUND_PULL_MS);
  }

  /**
   * Pull the server copy if we're signed in, idle, and haven't just done so.
   * Throttled so tab-switching in a burst doesn't fire a request each time,
   * and skipped while a write is in flight so it can't race a push.
   */
  function refresh() {
    if (!isSignedIn()) return;
    if (state.inflight || state.timer) return;         // a push is queued/running
    if (state.status === "syncing" || state.status === "conflict") return;
    if (Date.now() - lastPullAt < FOREGROUND_PULL_MS) return;
    lastPullAt = Date.now();
    pullAndMerge().catch(() => { /* offline is not an error worth shouting about */ });
  }

  return {
    init, info, isSignedIn, authToken, on,
    signUp, signIn, signOut, restore, forgotPassword, resetPassword,
    push, pull, pullAndMerge, queue, refresh,
    createLinkCode, redeemLinkCode, children, parents, unlink,
    pushLocation, readLocation,
    requestFriend, respondFriend, listFriends, removeFriend,
    requestCheckin, listCheckins, respondCheckin, sendGuardianNote, listGuardianNotes,
    proposeFocusWindow, listFocusWindows, respondFocusWindow, endFocusWindow,
    pushIcsFeed, icsFeedUrl,
    listApiTokens, mintApiToken, revokeApiToken,
    listWebhooks, addWebhook, removeWebhook, apiBaseUrl,
    listGroups, createGroup, joinGroup, getGroup, broadcastFeed,
    shareDeck, getSharedDeck, postFeed, confirmFeed, commentFeed, rateFeed, leaveGroup,
    addGroupTask, updateGroupTask, deleteGroupTask,
    pushAvailability,
    requestPartner, respondPartner, endPartner,
    postTutoring, respondTutoring, removeTutoring,
    shareNote, getSharedNote, thankNote, removeSharedNote,
    createChallenge, joinChallenge, contributeChallenge, leaveChallenge
  };
})();
