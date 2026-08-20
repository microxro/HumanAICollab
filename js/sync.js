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
  function emit() { state.listeners.forEach((f) => { try { f(info()); } catch (e) { console.error(e); } }); }

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
      error: state.error
    };
  }

  function isSignedIn() { return !!state.token && !!state.user; }

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

  async function push(force) {
    if (!isSignedIn()) return;
    if (state.inflight) return;
    state.inflight = true;
    setStatus("syncing");
    try {
      const res = await call("/sync", {
        method: "PUT",
        body: { state: snapshot(), baseVersion: state.version, force: !!force }
      });
      state.version = res.version;
      state.lastSync = res.updatedAt;
      localStorage.setItem(VERSION_KEY, String(state.version));
      S.db.account.lastSync = res.updatedAt;
      S.save();
      setStatus("idle");
    } catch (e) {
      if (e.status === 409) {
        setStatus("conflict", "Another device saved changes.");
        handleConflict(e.data);
      } else if (e.offline) {
        setStatus("error", "Offline — will retry.");
      } else {
        setStatus("error", e.message);
      }
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
        state.version = data.version;   // adopt the version, then force-write
        push(true);
      }
    });
  }

  /** Debounced push, called from store.commit() on every write. */
  function queue() {
    if (!isSignedIn() || !S.db.account.autoSync) return;
    clearTimeout(state.timer);
    state.timer = setTimeout(() => push(false), PUSH_DEBOUNCE_MS);
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
      }))
    };

    return call("/location", {
      method: "POST",
      body: { status: st.locationSharing ? status : null, summary }
    });
  }

  async function readLocation(studentId) {
    return (await call("/location/" + encodeURIComponent(studentId))).location;
  }

  /* ------------------------------------------------------------ groups -- */

  async function listGroups() { return (await call("/groups")).groups || []; }
  async function createGroup(name) { return (await call("/groups", { method: "POST", body: { name } })).group; }
  async function joinGroup(code) { return (await call("/groups/join", { method: "POST", body: { code } })).group; }
  async function getGroup(id) { return (await call("/groups/" + encodeURIComponent(id))).group; }
  async function shareDeck(id, deck) { return call(`/groups/${encodeURIComponent(id)}/deck`, { method: "POST", body: { deck } }); }
  async function getSharedDeck(id, deckId) { return (await call(`/groups/${encodeURIComponent(id)}/deck/${encodeURIComponent(deckId)}`)).deck; }
  async function postFeed(id, item) { return call(`/groups/${encodeURIComponent(id)}/feed`, { method: "POST", body: item }); }
  async function confirmFeed(id, itemId) { return call(`/groups/${encodeURIComponent(id)}/feed/${encodeURIComponent(itemId)}`, { method: "POST" }); }
  async function leaveGroup(id) { return call(`/groups/${encodeURIComponent(id)}/leave`, { method: "POST" }); }

  /* -------------------------------------------------------------- init -- */

  function init() {
    if (state.token) restore();
    else setStatus("offline");

    // Flush pending changes when the tab goes away or connectivity returns.
    window.addEventListener("online", () => { if (isSignedIn()) push(false); });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && isSignedIn()) push(false);
    });
    setInterval(() => { if (isSignedIn() && state.status === "error") push(false); }, 60000);
  }

  return {
    init, info, isSignedIn, on,
    signUp, signIn, signOut, restore,
    push, pull, pullAndMerge, queue,
    createLinkCode, redeemLinkCode, children, parents, unlink,
    pushLocation, readLocation,
    listGroups, createGroup, joinGroup, getGroup,
    shareDeck, getSharedDeck, postFeed, confirmFeed, leaveGroup
  };
})();
