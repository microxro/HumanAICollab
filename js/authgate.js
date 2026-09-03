/* ==========================================================================
   authgate.js — the sign-in screen, and the first thing anybody sees

   Two rules, and this file exists to enforce the first while making the
   second survivable:

     1. The login screen is up before the app is. Not a banner in a corner
        and not a modal over a working dashboard — a full screen that owns
        the tab until there is a session or an explicit decision not to have
        one.

     2. Signed out, nothing is written to this device. That half lives in
        js/store.js ("the local gate"); the part that belongs here is being
        honest about it, on the screen where the choice is made, rather than
        letting somebody type an evening's homework into a tab that is going
        to forget all of it.

   "Continue without saving" is deliberately kept. Refusing to open at all
   would mean a student who cannot sign in right now — no account yet, a
   forgotten password, a school laptop they will not put an account on —
   simply cannot use the app. They can, and a persistent banner says exactly
   what they are getting: a session that ends with the tab.
   ========================================================================== */

App.authgate = (function () {
  const U = App.utils;

  let root = null;          // the gate element while it is up
  let banner = null;        // the "not saving" strip, in memory-only mode
  let mode = "signin";      // signin | signup
  let ephemeral = false;    // "continue without saving" was chosen this session
  let lastFocused = null;

  function isOpen() { return !!root; }
  function isEphemeral() { return ephemeral; }

  /* ------------------------------------------------------------ markup -- */

  function formFields() {
    const signup = mode === "signup";
    return `
      ${signup ? `
      <div class="field">
        <label for="gateName">Your name</label>
        <input class="input" id="gateName" name="name" required autocomplete="name" />
      </div>` : ""}
      <div class="field">
        <label for="gateEmail">Email</label>
        <input class="input" id="gateEmail" name="email" type="email" required autocomplete="email" />
      </div>
      <div class="field">
        <label for="gatePassword">Password</label>
        <input class="input" id="gatePassword" name="password" type="password" required minlength="8"
               autocomplete="${signup ? "new-password" : "current-password"}" />
        ${signup ? `<span class="hint">At least 8 characters, with a letter and a number.</span>` : ""}
      </div>
      ${signup ? `
      <div class="field">
        <label for="gateRole">I am a…</label>
        <select class="select" id="gateRole" name="role">
          <option value="student">Student</option>
          <option value="parent">Parent / guardian</option>
          <option value="teacher">Teacher</option>
        </select>
      </div>` : ""}`;
  }

  function render() {
    const signup = mode === "signup";
    root.innerHTML = `
      <div class="gate-card" role="dialog" aria-modal="true" aria-labelledby="gateTitle">
        <div class="gate-brand">
          <span class="logo" aria-hidden="true">S</span>
          <span class="logo-text">Study<span>Hold</span></span>
        </div>

        <h1 class="gate-title" id="gateTitle">${signup ? "Create your account" : "Sign in to StudyHold"}</h1>
        <p class="gate-sub">${signup
          ? "Your classes, homework and grades are stored under your account, so they follow you between devices."
          : "Your work is stored under your account. Sign in to load it onto this device."}</p>

        <div class="gate-tabs" role="tablist" aria-label="Sign in or create an account">
          <button type="button" class="gate-tab${signup ? "" : " sel"}" role="tab"
                  aria-selected="${signup ? "false" : "true"}" data-mode="signin">Sign in</button>
          <button type="button" class="gate-tab${signup ? " sel" : ""}" role="tab"
                  aria-selected="${signup ? "true" : "false"}" data-mode="signup">Create account</button>
        </div>

        <form class="gate-form" novalidate>
          ${formFields()}
          <p class="gate-error" data-error hidden role="alert"></p>
          <button type="submit" class="btn btn-primary btn-block">
            ${signup ? "Create account" : "Sign in"}
          </button>
        </form>

        ${signup ? "" : `<p class="gate-alt"><button type="button" class="btn-link small" data-forgot hidden>Forgot your password?</button></p>`}

        <div class="gate-foot">
          <p class="gate-note">
            <strong>Nothing is saved on this device until you sign in.</strong>
            Signed out, StudyHold runs in this tab only — closing it clears everything.
          </p>
          <button type="button" class="btn-link small" data-skip-auth>Continue without saving →</button>
        </div>
      </div>`;

    bind();
    const first = root.querySelector("input");
    if (first) first.focus();
  }

  /* ----------------------------------------------------------- wiring -- */

  function setError(msg) {
    const box = root && root.querySelector("[data-error]");
    if (!box) return;
    box.textContent = msg || "";
    box.hidden = !msg;
  }

  function bind() {
    U.$$("[data-mode]", root).forEach((btn) => {
      btn.addEventListener("click", () => {
        if (mode === btn.dataset.mode) return;
        mode = btn.dataset.mode;
        render();
      });
    });

    const form = root.querySelector("form");
    form.addEventListener("submit", (e) => { e.preventDefault(); submit(form); });

    const skip = root.querySelector("[data-skip-auth]");
    if (skip) skip.addEventListener("click", continueWithoutSaving);

    const forgot = root.querySelector("[data-forgot]");
    if (forgot) {
      forgot.addEventListener("click", () => {
        const email = (root.querySelector('[name="email"]') || {}).value || "";
        if (App.forgotPasswordForm) App.forgotPasswordForm(email.trim());
      });
      // Same honesty as the Settings copy of this link: a reset link this
      // deployment cannot actually deliver is worse than no link at all, so
      // it stays hidden until the server says mail goes out.
      App.sync.serverHealth().then((h) => {
        if (!root || !document.contains(forgot)) return;
        if (h && h.email && h.email.deliverable) forgot.hidden = false;
      }).catch(() => { /* offline: leave it hidden */ });
    }
  }

  function submit(form) {
    const btn = form.querySelector('[type="submit"]');
    const label = btn.textContent;
    const data = {};
    U.$$("[name]", form).forEach((el) => { data[el.name] = el.value; });

    if (!data.email || !data.password) {
      setError("Enter your email and password.");
      return;
    }
    if (mode === "signup" && !String(data.name || "").trim()) {
      setError("Enter your name.");
      return;
    }

    setError("");
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    btn.textContent = mode === "signup" ? "Creating account…" : "Signing in…";

    const p = mode === "signup"
      ? App.sync.signUp(data.email.trim(), data.password, String(data.name).trim(), data.role || "student")
      : App.sync.signIn(data.email.trim(), data.password);

    p.then((user) => {
      hide();
      if (App.ui) App.ui.toast(mode === "signup" ? "Account created" : "Signed in", user.email, "ok");
      if (App.afterAuth) App.afterAuth();
    }).catch((e) => {
      // The gate is the whole screen, so the failure belongs on it — a toast
      // in the corner of a full-screen form is easy to miss and gone in four
      // seconds, which is how a wrong password turns into "the button does
      // nothing".
      setError(e.message || "That didn't work. Try again.");
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
      btn.textContent = label;
      const pw = form.querySelector('[name="password"]');
      if (pw) { pw.value = ""; pw.focus(); }
    });
  }

  function continueWithoutSaving() {
    ephemeral = true;
    hide();
    showBanner();
    if (App.afterAuth) App.afterAuth();
  }

  /* -------------------------------------------------- the honest strip -- */

  /**
   * The banner is not decoration. In memory-only mode every save the app
   * reports — "Saved", the sync tick, the streak — is true of this tab and
   * of nothing else, so something on screen has to keep saying so.
   */
  function showBanner() {
    if (banner || !ephemeral) return;
    const main = document.querySelector(".main");
    const topbar = document.querySelector(".topbar");
    if (!main || !topbar) return;

    banner = document.createElement("div");
    banner.className = "gate-banner";
    banner.setAttribute("role", "status");
    banner.innerHTML = `
      <span class="gate-banner-dot" aria-hidden="true">●</span>
      <span class="grow">Not signed in — nothing is being saved on this device. Closing this tab clears everything.</span>
      <button type="button" class="btn btn-sm" data-gate-signin>Sign in</button>`;
    banner.querySelector("[data-gate-signin]").addEventListener("click", () => show({ reason: "from-banner" }));
    main.insertBefore(banner, topbar);
  }

  function hideBanner() {
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
  }

  /* ------------------------------------------------------ open / close -- */

  // Tab must not walk out of the gate into an app the visitor cannot see.
  function onKeydown(e) {
    if (e.key !== "Tab" || !root) return;
    const items = U.$$('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]', root)
      .filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /**
   * Put the gate up. Safe to call at any point — boot calls it before the
   * first paint, an expired token calls it mid-session, and the banner
   * calls it when somebody changes their mind.
   *
   * There is deliberately no Escape handler and no backdrop click: this is a
   * gate, and a gate that opens when you lean on it is a door.
   */
  function show(opts) {
    const o = opts || {};
    if (root) return;
    lastFocused = document.activeElement;
    hideBanner();

    root = document.createElement("div");
    root.className = "gate-root";
    mode = o.mode === "signup" ? "signup" : "signin";
    document.body.appendChild(root);
    document.body.classList.add("gated");
    document.body.classList.remove("gate-pending");
    document.addEventListener("keydown", onKeydown, true);
    render();

    if (o.reason === "expired") setError("Your session expired — sign in again.");
  }

  function hide() {
    document.removeEventListener("keydown", onKeydown, true);
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
    document.body.classList.remove("gated", "gate-pending");
    // Coming back from the gate into a memory-only session: the strip goes
    // back up, because the reason for it hasn't changed.
    if (ephemeral && !App.sync.isSignedIn()) showBanner();
    if (App.sync.isSignedIn()) { ephemeral = false; hideBanner(); }
    if (lastFocused && document.contains(lastFocused)) { try { lastFocused.focus(); } catch (e) { /* gone */ } }
  }

  return { show, hide, isOpen, isEphemeral, showBanner, hideBanner };
})();
