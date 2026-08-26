/* ==========================================================================
   views/settings.js — account, preferences, terms, data, and diagnostics
   ========================================================================== */

App.views.settings = (function () {
  // Enough to cover the places this app is actually used from, formatted by
  // Intl rather than by a stored symbol — see S.money().
  const CURRENCIES = [
    ["USD", "US dollar ($)"], ["EUR", "Euro (€)"], ["GBP", "Pound (£)"],
    ["CAD", "Canadian dollar"], ["AUD", "Australian dollar"], ["NZD", "NZ dollar"],
    ["INR", "Indian rupee (₹)"], ["JPY", "Japanese yen (¥)"], ["CNY", "Chinese yuan"],
    ["MXN", "Mexican peso"], ["BRL", "Brazilian real"], ["ZAR", "South African rand"],
    ["NGN", "Nigerian naira"], ["PHP", "Philippine peso"], ["SEK", "Swedish krona"],
    ["NOK", "Norwegian krone"], ["DKK", "Danish krone"], ["PLN", "Polish złoty"],
    ["CHF", "Swiss franc"], ["SGD", "Singapore dollar"], ["AED", "UAE dirham"]
  ];
  const U = App.utils, S = App.store, UI = App.ui;

  let tab = "account";
  let idbBytes = null;
  let installEvent = null;   // captured beforeinstallprompt

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent = e;
  });

  /* ------------------------------------------------------------- helpers */

  function dataSize() {
    try {
      const raw = localStorage.getItem("scholar.db.v2") || "";
      const kb = new Blob([raw]).size / 1024;
      return kb > 1024 ? `${U.round(kb / 1024, 2)} MB` : `${U.round(kb, 1)} KB`;
    } catch (e) { return "unknown"; }
  }

  function counts() {
    const d = S.db;
    return [
      ["Classes", d.classes.length], ["Assignments", d.assignments.length],
      ["Events", d.events.length], ["Notes", d.notes.length],
      ["Flashcards", U.sum(d.decks, (x) => x.cards.length)],
      ["Study sessions", d.studySessions.length],
      ["Study photos", (d.studyProofs || []).length],
      ["Books", d.reading.length], ["Applications", d.collegeApps.length]
    ];
  }

  function toggleRow(title, desc, checked, attr) {
    return `<div class="between" style="padding:12px 0;border-bottom:1px solid var(--border)">
      <div style="min-width:0;padding-right:12px">
        <div class="bold small">${title}</div>
        <div class="tiny dim">${desc}</div>
      </div>
      <label class="switch">
        <input type="checkbox" ${attr} ${checked ? "checked" : ""} />
        <span class="track"></span>
      </label>
    </div>`;
  }

  /**
   * What the study shop has to say for itself in Settings.
   *
   * Skins, avatar rings and nameplates are equipped in the shop rather than
   * here, because equipping them and buying them are the same gesture and
   * splitting that across two screens would leave a student wondering where
   * the thing they just bought went. Accents are the exception: the picker
   * above already existed, so an owned accent simply appears in it.
   */
  function shopSummary() {
    const worn = App.shop.kinds()
      .map((k) => App.shop.equipped(k))
      .filter(Boolean)
      .map((i) => U.esc(i.name));
    const bal = App.shop.balance();
    const wearing = worn.length ? `Wearing ${worn.join(", ")}.` : "Nothing equipped yet.";
    return `${wearing} ${bal} token${bal === 1 ? "" : "s"} to spend.`;
  }

  /* ------------------------------------------------------------- account */

  function authForm(mode) {
    const isSignup = mode === "signup";
    UI.modal({
      title: isSignup ? "Create an account" : "Sign in",
      sub: isSignup ? "Sync across devices, link a parent, and join study groups" : "",
      okLabel: isSignup ? "Create account" : "Sign in",
      body: `<div class="form-grid">
        ${isSignup ? `<div class="field full"><label>Your name</label>
          <input class="input" name="name" required value="${U.esc(S.profile.name || "")}" /></div>` : ""}
        <div class="field full"><label>Email</label>
          <input class="input" type="email" name="email" required autocomplete="email" /></div>
        <div class="field full"><label>Password</label>
          <input class="input" type="password" name="password" required minlength="8"
                 autocomplete="${isSignup ? "new-password" : "current-password"}" />
          ${isSignup ? `<span class="hint">At least 8 characters, with a letter and a number.</span>` : ""}</div>
        ${isSignup ? `<div class="field full"><label>I am a…</label>
          <select class="select" name="role">
            <option value="student">Student</option>
            <option value="parent">Parent / guardian</option>   // F067
            <option value="teacher">Teacher</option>
          </select>
          <span class="hint">A parent account sees a linked student's status. A teacher account posts assignments
          to class groups as official — students see them marked, with no need to confirm each other's guesses.
          Neither tracks homework of its own.</span>
        </div>` : ""}
      </div>
      ${!isSignup ? `<p class="mt-8" data-forgot-slot><button type="button" class="btn-link small" data-forgot hidden>Forgot your password?</button></p>` : ""}
      <p class="hint mt-12">Your data is stored under your account so it follows you between devices.
        Sign out any time — the local copy stays on this device.</p>`,
      onMount(root) {
        const forgot = root.querySelector("[data-forgot]");
        if (forgot) {
          forgot.addEventListener("click", () => {
            const email = root.querySelector('[name="email"]').value.trim();
            UI.closeModal();
            setTimeout(() => forgotPasswordForm(email), 60);
          });

          // Password reset needs outbound mail this deploy can actually
          // deliver. Sending from a provider's shared sandbox address only
          // reaches the account owner, so offering the link to everyone else
          // is a promise the server can't keep — and a dead link is worse
          // than an honest absence. Hidden until the server confirms.
          App.sync.serverHealth().then((h) => {
            const deliverable = !!(h && h.email && h.email.deliverable);
            const slot = root.querySelector("[data-forgot-slot]");
            if (!slot || !document.contains(slot)) return;
            if (deliverable) {
              forgot.hidden = false;
            } else {
              slot.innerHTML = `<span class="hint">Password reset by email isn't available on this
                deployment. Your data lives on this device, so you can keep using Scholar signed out —
                or sign up again with a different address.</span>`;
            }
          });
        }
      },
      onSubmit(d, root) {
        // Returning undefined closes the modal immediately, so on a slow
        // connection the dialog vanished and nothing at all indicated that a
        // request was running — for several seconds, with the button still
        // live and re-clickable. Keep the modal open, show the work, and
        // close only on success.
        const btn = root.querySelector('[type="submit"]');
        const label = btn ? btn.textContent : "";
        if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.textContent = isSignup ? "Creating account…" : "Signing in…"; }

        const p = isSignup
          ? App.sync.signUp(d.email, d.password, d.name, d.role)
          : App.sync.signIn(d.email, d.password);

        p.then((user) => {
          UI.closeModal();
          UI.toast(isSignup ? "Account created" : "Signed in", user.email, "ok");
          App.router.refresh();
        }).catch((e) => {
          if (btn) { btn.disabled = false; btn.removeAttribute("aria-busy"); btn.textContent = label; }
          UI.toast(isSignup ? "Couldn't sign up" : "Couldn't sign in", e.message, "danger");
        });

        return false;   // keep the dialog open until we know the outcome
      }
    });
  }

  /* ------------------------------------------------------- F098 reset -- */

  function forgotPasswordForm(prefillEmail) {
    UI.modal({
      title: "Reset your password",
      sub: "We'll email a link that works once and expires in 30 minutes.",
      okLabel: "Send reset link",
      body: `<div class="field">
          <label>Email</label>
          <input class="input" type="email" name="email" required autocomplete="email" value="${U.esc(prefillEmail || "")}" />
        </div>`,
      onSubmit(d) {
        App.sync.forgotPassword(d.email.trim())
          .then(() => UI.toast("Check your email", "If that address has an account, a reset link is on its way.", "ok"))
          .catch((e) => UI.toast("Couldn't send that", e.message, "danger"));
      }
    });
  }

  function resetPasswordForm(token) {
    UI.modal({
      title: "Set a new password",
      okLabel: "Set password",
      body: `<div class="field">
          <label>New password</label>
          <input class="input" type="password" name="password" required minlength="8" autocomplete="new-password" />
          <span class="hint">At least 8 characters, with a letter and a number.</span>
        </div>`,
      onSubmit(d) {
        App.sync.resetPassword(token, d.password)
          .then(() => UI.toast("Password updated", "Sign in with your new password.", "ok"))
          .catch((e) => UI.toast("Couldn't reset it", e.message, "danger"));
      }
    });
  }
  App.resetPasswordForm = resetPasswordForm;   // reached from a ?resetToken= link at boot (js/app.js)

  function accountTab() {
    const s = App.sync.info();
    const p = S.profile;

    if (!s.signedIn) {
      return `
        <div class="card mb-16">
          <div class="card-head"><h3>Cloud sync</h3><span class="badge">Signed out</span></div>
          <div class="card-body">
            <p class="small muted mb-16">
              Scholar works completely offline — everything you've entered is saved in this browser.
              An account adds cross-device sync, the parent portal, and study groups.
            </p>
            <div class="row gap-8">
              <button class="btn btn-primary" data-signup>Create an account</button>
              <button class="btn" data-signin>Sign in</button>
            </div>
          </div>
        </div>
        ${profileCard(p)}`;
    }

    const statusLabel = {
      idle: ["ok", "Synced"], syncing: ["info", "Syncing…"],
      error: ["warn", "Offline"], conflict: ["warn", "Conflict"], offline: ["", "Local only"]
    }[s.status] || ["", s.status];

    return `
      <div class="card mb-16">
        <div class="card-head">
          <div><h3>Account</h3><div class="sub">${U.esc(s.user.email)}</div></div>
          <span class="badge ${statusLabel[0]}">${statusLabel[1]}</span>
        </div>
        <div class="card-body">
          <div class="row gap-12 mb-16">
            ${UI.avatar(s.user.name, p.color, "lg")}
            <div class="grow">
              <div class="bold">${U.esc(s.user.name)}</div>
              <div class="tiny dim">${U.titleCase(s.user.role)} account ·
                ${s.lastSync ? "last synced " + new Date(s.lastSync).toLocaleString() : "not synced yet"}</div>
            </div>
          </div>
          ${s.error ? `<p class="tiny" style="color:var(--warn)">${U.esc(s.error)}</p>` : ""}
          ${s.pending ? `<div class="badge warn mb-12">⏳ Unsynced changes pending${s.status === "syncing" ? " — syncing now" : " — will push shortly"}</div>`
            : `<div class="badge ok mb-12">✓ Everything synced</div>`}
          ${toggleRow("Automatic sync", "Push changes to the cloud a few seconds after you make them",
            S.db.account.autoSync, `data-autosync`)}
          <div class="row gap-8 mt-16">
            <button class="btn" data-sync-now>↻ Sync now</button>
            <button class="btn" data-signout>Sign out</button>
          </div>
        </div>
      </div>

      ${s.user.role === "student" ? linkCard() : parentLinkCard()}
      ${profileCard(p)}`;
  }

  function linkCard() {
    return `<div class="card mb-16">
      <div class="card-head">
        <div><h3>Parent access</h3><div class="sub">Generate a code for a parent to link to you</div></div>
      </div>
      <div class="card-body">
        <p class="small muted mb-12">
          Your parent creates their own Scholar account, then enters this code once.
          They'll see whatever your Sharing toggles allow — nothing more.
        </p>
        <div id="linkCodeBox"></div>
        <button class="btn btn-primary" data-mint-code>Generate a link code</button>
        <div class="divider"></div>
        <h4 class="mb-8">Who can see me</h4>
        <div id="parentList">${U.skeletonRows(1)}</div>
      </div>
    </div>`;
  }

  function parentLinkCard() {
    return `<div class="card mb-16">
      <div class="card-head"><h3>Linked students</h3></div>
      <div class="card-body">
        <p class="small muted mb-12">Open the Parent portal to see live status for each student you're linked to.</p>
        <button class="btn btn-primary" data-go="parent">Open parent portal →</button>
      </div>
    </div>`;
  }

  function profileCard(p) {
    return `<div class="card">
      <div class="card-head"><h3>Profile</h3></div>
      <div class="card-body">
        <div class="form-grid">
          <div class="field"><label>Your name</label>
            <input class="input" data-p="name" value="${U.esc(p.name)}" /></div>
          <div class="field"><label>Email</label>
            <input class="input" type="email" data-p="email" value="${U.esc(p.email || "")}" /></div>
          <div class="field"><label>School</label>
            <input class="input" data-p="school" value="${U.esc(p.school || "")}" /></div>
          <div class="field"><label>Grade level</label>
            <input class="input" data-p="grade" value="${U.esc(p.grade || "")}" /></div>
          <div class="field"><label>Guardian name</label>
            <input class="input" data-p="parentName" value="${U.esc(p.parentName || "")}" /></div>
          <div class="field"><label>Guardian email</label>
            <input class="input" type="email" data-p="parentEmail" value="${U.esc(p.parentEmail || "")}" /></div>
        </div>
        <button class="btn btn-primary mt-16" data-save-profile>Save profile</button>
      </div>
    </div>`;
  }

  /* --------------------------------------------------------- preferences */

  function prefsTab() {
    const st = S.settings;
    const n = st.notifications;
    const perm = App.notify.permission();

    return `
      <div class="card mb-16">
        <div class="card-head"><h3>Appearance &amp; general</h3></div>
        <div class="card-body" style="padding-top:4px">
          ${toggleRow("Dark mode", "Switch between the light and dark palette", st.theme === "dark", `data-pref="theme"`)}
          ${toggleRow("Week starts on Monday", "Affects the calendar and weekly totals", st.weekStartsMonday, `data-pref="weekStartsMonday"`)}
          ${toggleRow("Weighted GPA", "Harder classes earn extra grade points — set the amounts below", st.gpaWeighted, `data-pref="gpaWeighted"`)}
          ${st.gpaWeighted ? `
          <div style="padding:8px 0 12px;border-bottom:1px solid var(--border)">
            <div class="tiny dim mb-8">Default boost by class type. Any class can override this in its own settings.</div>
            <div class="row gap-8 wrap">
              <label class="tiny dim" style="display:flex;flex-direction:column;gap:4px">AP / IB
                <input class="input input-sm" type="number" step="0.5" min="0" max="2" style="width:92px"
                       data-gpa-scale="ap" value="${(st.gpaScale || {}).ap != null ? st.gpaScale.ap : 1}" /></label>
              <label class="tiny dim" style="display:flex;flex-direction:column;gap:4px">Honors
                <input class="input input-sm" type="number" step="0.5" min="0" max="2" style="width:92px"
                       data-gpa-scale="honors" value="${(st.gpaScale || {}).honors != null ? st.gpaScale.honors : 1}" /></label>
              <label class="tiny dim" style="display:flex;flex-direction:column;gap:4px">Scale maximum
                <input class="input input-sm" type="number" step="0.1" min="4" max="6" style="width:92px"
                       data-gpa-scale="max" value="${(st.gpaScale || {}).max != null ? st.gpaScale.max : 5}" /></label>
            </div>
          </div>` : ""}
          <div class="between" style="padding:12px 0">
            <div><div class="bold small">"Due soon" window</div>
              <div class="tiny dim">How many days ahead counts as due soon</div></div>
            <select class="select input-sm" data-pref-num="dueSoonDays" style="width:110px">
              ${[1, 2, 3, 5, 7, 14].map((v) => `<option value="${v}" ${v === st.dueSoonDays ? "selected" : ""}>${v} days</option>`).join("")}
            </select>
          </div>
          <div class="between" style="padding:12px 0;border-bottom:1px solid var(--border)">
            <div><div class="bold small">Language</div>
              <div class="tiny dim">Nav labels, common actions, and dates</div></div>
            <select class="select input-sm" id="localeSel" style="width:140px">
              ${App.i18n.available().map((l) => `<option value="${l.code}" ${l.code === st.locale ? "selected" : ""}>${l.name}</option>`).join("")}
            </select>
          </div>
          <div class="between" style="padding:12px 0">
            <div><div class="bold small">Currency</div>
              <div class="tiny dim">What outside-school fees are shown in</div></div>
            <select class="select input-sm" data-pref-str="currency" style="width:140px">
              ${CURRENCIES.map(([code, label]) => `<option value="${code}" ${code === (st.currency || "USD") ? "selected" : ""}>${U.esc(label)}</option>`).join("")}
            </select>
          </div>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-head"><h3>Layout &amp; accessibility</h3></div>
        <div class="card-body" style="padding-top:4px">
          <div class="between" style="padding:12px 0;border-bottom:1px solid var(--border)">
            <div><div class="bold small">Sidebar</div><div class="tiny dim">Icon-only mode fits more page on narrow screens</div></div>
            <button class="btn btn-sm" id="prefCollapseBtn">${st.sidebarCollapsed ? "Expand" : "Collapse"}</button>
          </div>
          <div class="between" style="padding:12px 0;border-bottom:1px solid var(--border)">
            <div><div class="bold small">Density</div><div class="tiny dim">Compact fits more rows on screen</div></div>
            <div class="segmented">
              <button data-density-opt="comfortable" class="${st.density !== "compact" ? "active" : ""}">Comfortable</button>
              <button data-density-opt="compact" class="${st.density === "compact" ? "active" : ""}">Compact</button>
            </div>
          </div>
          <div class="between" style="padding:12px 0;border-bottom:1px solid var(--border)">
            <div><div class="bold small">Accent colour</div><div class="tiny dim">Buttons, links, and highlights — independent of class colours</div></div>
            <div class="row gap-6 wrap" style="justify-content:flex-end">
              ${[["indigo", "#4f46e5"], ["teal", "#0f766e"], ["rose", "#be123c"], ["amber", "#b45309"]].map(([id, hex]) => `
                <button class="swatch ${((st.accent || "indigo") === id) ? "active" : ""}" data-accent-opt="${id}"
                        style="background:${hex};width:24px;height:24px" aria-label="${id}"></button>`).join("")}
              ${App.shop.items("accent").filter((i) => App.shop.owns(i.id)).map((i) => `
                <button class="swatch ${(st.accent === i.value) ? "active" : ""}" data-accent-opt="${U.esc(i.value)}"
                        style="background:${U.esc(i.preview.a)};width:24px;height:24px" aria-label="${U.esc(i.name)}"></button>`).join("")}
            </div>
          </div>
          <div class="between" style="padding:12px 0;border-bottom:1px solid var(--border)">
            <div>
              <div class="bold small">Study-shop looks</div>
              <div class="tiny dim">${shopSummary()}</div>
            </div>
            <button class="btn btn-sm" data-open-shop>Open the shop</button>
          </div>
          <div class="between" style="padding:12px 0;border-bottom:1px solid var(--border)">
            <div><div class="bold small">Colour-blind preview</div><div class="tiny dim">Simulates how class colours and charts look</div></div>
            <select class="select input-sm" id="cvdSel" style="width:150px">
              <option value="none" ${st.cvdPreview === "none" ? "selected" : ""}>Off</option>
              <option value="protanopia" ${st.cvdPreview === "protanopia" ? "selected" : ""}>Protanopia</option>
              <option value="deuteranopia" ${st.cvdPreview === "deuteranopia" ? "selected" : ""}>Deuteranopia</option>
              <option value="tritanopia" ${st.cvdPreview === "tritanopia" ? "selected" : ""}>Tritanopia</option>
            </select>
          </div>
          <div class="between" style="padding:12px 0;border-bottom:1px solid var(--border)">
            <div><div class="bold small">Type size</div><div class="tiny dim">A real accessibility need, not just a preference</div></div>
            <select class="select input-sm" id="fontSizeSel" style="width:150px">
              <option value="normal" ${st.fontSize !== "large" && st.fontSize !== "larger" ? "selected" : ""}>Normal</option>
              <option value="large" ${st.fontSize === "large" ? "selected" : ""}>Large</option>
              <option value="larger" ${st.fontSize === "larger" ? "selected" : ""}>Larger</option>
            </select>
          </div>
          <div class="between" style="padding:12px 0;border-bottom:1px solid var(--border)">
            <div><div class="bold small">Empty state icons</div><div class="tiny dim">How illustrations look on empty lists and screens</div></div>
            <select class="select input-sm" id="emptyStyleSel" style="width:150px">
              <option value="drawn" ${st.emptyStateStyle !== "emoji" ? "selected" : ""}>Drawn icons</option>
              <option value="emoji" ${st.emptyStateStyle === "emoji" ? "selected" : ""}>Classic emoji</option>
            </select>
          </div>
          ${toggleRow("Dyslexia-friendly type", "Wider letter spacing and a clearer face", st.dyslexicFont, `data-pref="dyslexicFont"`)}
          ${toggleRow("True-black dark mode", "Pure black surfaces — saves battery on OLED screens (dark mode only)", st.trueBlack, `data-pref="trueBlack"`)}
          ${toggleRow("High contrast", "Stronger text, borders, and focus rings — for low vision or a bright outdoor screen", st.highContrast, `data-pref="highContrast"`)}
          ${toggleRow("Single-key shortcuts",
            "Press n for a new assignment, t for the theme, g then a letter to jump. Turn off if you use speech recognition — dictation can trigger these by accident.",
            st.singleKeyShortcuts !== false, `data-pref="singleKeyShortcuts"`)}
          ${toggleRow("Hide GPA", "Show progress bars without the number, if grades cause anxiety", st.wellbeing.hideGPA, `data-pref-nested="wellbeing.hideGPA"`)}
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-head">
          <div><h3>Reminders</h3><div class="sub">Browser notifications — no server needed</div></div>
          <span class="badge ${perm === "granted" ? "ok" : perm === "denied" ? "danger" : ""}">
            ${perm === "granted" ? "Allowed" : perm === "denied" ? "Blocked" : perm === "unsupported" ? "Unsupported" : "Not asked"}
          </span>
        </div>
        <div class="card-body" style="padding-top:4px">
          ${perm === "denied" ? `<p class="small" style="color:var(--danger);padding:8px 0">
            Notifications are blocked for this site. Re-allow them in your browser's site settings
            (the padlock icon in the address bar), then come back.</p>` : ""}

          ${toggleRow("Enable reminders", "Nudges before class, before deadlines, and a morning digest",
            n.enabled, `data-notif="enabled" ${perm === "denied" || perm === "unsupported" ? "disabled" : ""}`)}

          <div class="between" style="padding:12px 0;border-bottom:1px solid var(--border)">
            <div><div class="bold small">Before a class starts</div>
              <div class="tiny dim">Lead time for class and practice reminders</div></div>
            <select class="select input-sm" data-notif-num="classStartMin" style="width:120px">
              ${[0, 5, 10, 15, 30].map((v) => `<option value="${v}" ${v === n.classStartMin ? "selected" : ""}>${v ? v + " min" : "Off"}</option>`).join("")}
            </select>
          </div>
          <div class="between" style="padding:12px 0;border-bottom:1px solid var(--border)">
            <div><div class="bold small">Before work is due</div></div>
            <select class="select input-sm" data-notif-num="dueSoonMin" style="width:120px">
              ${[0, 60, 120, 240, 480].map((v) => `<option value="${v}" ${v === n.dueSoonMin ? "selected" : ""}>${v ? U.fmtDur(v) : "Off"}</option>`).join("")}
            </select>
          </div>
          ${toggleRow("Morning digest", "A 7–9 AM summary of the day ahead", n.dailyDigest, `data-notif="dailyDigest"`)}
          <div class="row gap-8" style="padding-top:12px">
            <div class="field"><label class="tiny">Quiet from</label>
              <input class="input input-sm" type="time" data-notif-time="quietStart" value="${n.quietStart}" /></div>
            <div class="field"><label class="tiny">Quiet until</label>
              <input class="input input-sm" type="time" data-notif-time="quietEnd" value="${n.quietEnd}" /></div>
            <div class="grow"></div>
            <button class="btn btn-sm" data-test-notif style="align-self:flex-end">Send a test</button>
          </div>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-head">
          <div><h3>Install as an app</h3><div class="sub">Works offline, opens from your home screen</div></div>
        </div>
        <div class="card-body">
          <p class="small muted mb-12">
            Scholar is a progressive web app. Installing gives it its own window and full offline access —
            all your data is already stored locally, so nothing breaks without a connection.
          </p>
          <div class="row gap-8 wrap">
            <button class="btn btn-primary" data-install>⬇ Install Scholar</button>
            <button class="btn" data-update-sw>↻ Check for updates</button>
          </div>
          <p class="hint mt-12" id="installHint">
            On iPhone/iPad: tap Share → “Add to Home Screen”.
            On Chrome desktop: use the install icon in the address bar if the button is greyed out.
          </p>
        </div>
      </div>`;
  }

  /* ------------------------------------------------------------- schedule */

  function scheduleTab() {
    const sc = S.settings.schedule;
    const terms = S.db.terms;

    return `
      <div class="card mb-16">
        <div class="card-head">
          <div><h3>Schedule type</h3><div class="sub">Weekly, or a rotating A/B block cycle</div></div>
        </div>
        <div class="card-body">
          <div class="segmented mb-16">
            <button class="${sc.mode === "weekly" ? "active" : ""}" data-sched-mode="weekly">Same every week</button>
            <button class="${sc.mode === "rotating" ? "active" : ""}" data-sched-mode="rotating">Rotating days</button>
          </div>

          ${sc.mode === "rotating" ? `
            <div class="form-grid">
              <div class="field"><label>Cycle days</label>
                <input class="input" id="cycleDays" value="${U.esc(sc.cycle.join(", "))}" placeholder="A, B" />
                <span class="hint">Comma separated — e.g. "A, B" or "1, 2, 3, 4"</span></div>
              <div class="field"><label>Cycle starts on</label>
                <input class="input" type="date" id="cycleAnchor" value="${sc.anchor}" />
                <span class="hint">The first day of the cycle (a Day ${sc.cycle[0]})</span></div>
            </div>
            ${toggleRow("Skip weekends", "Weekends don't advance the cycle", sc.skipWeekends, `data-sched-weekend`)}
            <button class="btn btn-primary mt-12" data-save-cycle>Save cycle</button>

            <div class="divider"></div>
            <h4 class="mb-8">Next two weeks</h4>
            <div class="row wrap gap-6">
              ${Array.from({ length: 14 }, (_, i) => {
                const iso = U.dateKey(U.addDays(new Date(), i));
                const cd = S.cycleDayFor(iso);
                const n = S.classesOnDate(iso).length;
                return `<button class="chip ${cd ? "active" : ""}" data-day-ex="${iso}"
                          title="${n} classes — click to override">
                  ${U.esc(U.fmtDate(iso, "day"))}: ${cd ? "Day " + cd : "No school"}
                </button>`;
              }).join("")}
            </div>
            <p class="hint mt-8">Click a day to mark it as a holiday or force a specific cycle day.</p>

            <div class="divider"></div>
            <h4 class="mb-8">Which cycle days does each class meet?</h4>
            ${S.termClasses().map((c) => `
              <div class="between" style="padding:8px 0;border-bottom:1px solid var(--border)">
                <span class="row gap-8">
                  <i class="dot-badge" style="background:${U.esc(c.color)}"></i>
                  <span class="small bold">${U.esc(c.name)}</span>
                </span>
                <span class="row gap-4">
                  ${sc.cycle.map((cd) => `<button class="chip ${(c.patternDays || []).includes(cd) ? "active" : ""}"
                    data-class-pattern="${c.id}" data-cd="${U.esc(cd)}">${U.esc(cd)}</button>`).join("")}
                </span>
              </div>`).join("")}
          ` : `<p class="small muted">Classes meet on the same weekdays every week.
               Set each class's days from the Classes tab.</p>`}
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-head">
          <div><h3>Commute</h3><div class="sub">Know the last bus that still gets you there on time</div></div>
        </div>
        <div class="card-body">
          <div class="form-grid mb-12">
            <div class="field"><label>Ride to school</label>
              <input class="input" type="number" min="0" id="commuteTo" value="${S.settings.commute.toMin}" /> <span class="hint">minutes</span></div>
            <div class="field"><label>Ride home</label>
              <input class="input" type="number" min="0" id="commuteFrom" value="${S.settings.commute.fromMin}" /> <span class="hint">minutes</span></div>
            <div class="field"><label>Last bus departs</label>
              <input class="input" type="time" id="lastBus" value="${S.settings.commute.lastBus || ""}" /></div>
          </div>
          <button class="btn btn-primary" data-save-commute>Save</button>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div><h3>Terms</h3><div class="sub">Archive a finished term to keep it in your cumulative GPA</div></div>
          <button class="btn btn-sm btn-primary" data-add-term>+ Add term</button>
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Term</th><th>Dates</th><th class="right">GPA</th><th class="right">Credits</th><th></th></tr></thead>
          <tbody>${terms.map((t) => {
            const live = t.current;
            const g = live ? S.gpa(null, t.id) : t.gpa;
            const cr = live ? U.sum(S.termClasses(t.id), (c) => c.credits || 1) : t.credits;
            const parent = t.parentId ? S.byId("terms", t.parentId) : null;
            return `<tr>
              <td>${parent ? `<div class="tiny dim">↳ rolls into ${U.esc(parent.name)}</div>` : ""}
                <div class="bold">${U.esc(t.name)}</div>
                ${live ? `<span class="badge solid">Current</span>` : ""}</td>
              <td class="small muted nowrap">${U.esc(U.fmtDate(t.start))} – ${U.esc(U.fmtDate(t.end))}</td>
              <td class="right nums bold">${g != null ? U.round(g, 2) : "—"}</td>
              <td class="right nums">${cr || "—"}</td>
              <td class="right">
                ${live ? `<button class="btn btn-sm" data-archive="${t.id}">Archive</button>`
                       : `<button class="btn btn-sm" data-make-current="${t.id}">Make current</button>`}
                <button class="icon-btn btn-sm" data-del-term="${t.id}" aria-label="Delete term">✕</button>
              </td>
            </tr>`;
          }).join("")}</tbody>
        </table></div>
        <div class="card-foot">
          <div class="between">
            <span class="small muted">Cumulative GPA across all terms</span>
            <span class="bold">${U.round(S.cumulativeGpa().gpa, 2)} · ${S.cumulativeGpa().credits} credits</span>
          </div>
        </div>
      </div>`;
  }

  /* ----------------------------------------------------------------- data */

  function dataTab() {
    const trash = S.db.trash;
    return `
      <div class="card mb-16">
        <div class="card-head">
          <div><h3>Your data</h3><div class="sub">In this browser · ${dataSize()}${idbBytes != null ? ` + ${App.idb.fmtSize(idbBytes)} of files` : ""}</div></div>
        </div>
        <div class="card-body">
          <div class="grid g-4 mb-16">
            ${counts().map(([label, n]) => `
              <div class="center" style="padding:10px;background:var(--surface-2);border-radius:var(--radius-sm)">
                <div class="bold" style="font-size:1.3rem">${n}</div>
                <div class="tiny dim">${label}</div>
              </div>`).join("")}
          </div>
          <div class="row gap-8 wrap">
            <button class="btn" data-export>⬇ Export backup</button>
            <button class="btn" data-import>⬆ Import backup</button>
            <button class="btn" data-import-school>📥 Import from Canvas / Classroom</button>
            <button class="btn" data-export-ics>📅 Export calendar</button>
            <button class="btn" data-print>🖨 Print</button>
            <button class="btn" data-load-demo title="Fill the app with an example student's schedule, for trying things out">✨ Load sample data</button>
          </div>
          <p class="hint mt-12">
            Everything lives in this browser unless you're signed in. Clearing your browser data erases it —
            export a backup before switching devices.
          </p>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-head">
          <div><h3>Trash</h3><div class="sub">Deleted items are recoverable until you empty this</div></div>
          ${trash.length ? `<button class="btn btn-sm" data-empty-trash>Empty trash</button>` : ""}
        </div>
        ${trash.length ? `<div class="list">
          ${trash.slice(0, 20).map((t) => `<div class="list-item">
            <span class="grow">
              <div class="title truncate">${U.esc(t.label)}</div>
              <div class="meta">${U.esc(t.coll)} · deleted ${new Date(t.deletedAt).toLocaleString()}</div>
            </span>
            <button class="btn btn-sm" data-restore="${t.id}">Restore</button>
          </div>`).join("")}
        </div>` : `<div class="card-body"><p class="dim small">Trash is empty.</p></div>`}
      </div>

      <div class="card mb-16">
        <div class="card-head"><h3>Recurring assignments</h3>
          <button class="btn btn-sm btn-primary" data-add-template>+ Add</button></div>
        ${S.db.templates.length ? `<div class="list">
          ${S.db.templates.map((t) => `<div class="list-item">
            <i class="dot-badge" style="background:${U.esc(S.classColor(t.classId))}"></i>
            <span class="grow">
              <div class="title">${U.esc(t.title)}</div>
              <div class="meta">${U.esc(S.className(t.classId))} · every ${t.interval > 1 ? t.interval + " weeks on " : ""}${(t.days || []).join(", ")}</div>
            </span>
            <span class="badge ${t.active !== false ? "ok" : ""}">${t.active !== false ? "Active" : "Paused"}</span>
            <button class="btn btn-sm" data-toggle-template="${t.id}">${t.active !== false ? "Pause" : "Resume"}</button>
            <button class="icon-btn btn-sm" data-del-template="${t.id}" aria-label="Delete">✕</button>
          </div>`).join("")}
        </div>` : `<div class="card-body"><p class="dim small">
          No recurring assignments. Add one for a weekly problem set or reading quiz and Scholar will create
          each occurrence automatically.</p></div>`}
      </div>

      <div class="card mb-16">
        <div class="card-head">
          <div><h3>Dashboard layout</h3><div class="sub">Reorder the widgets on your home screen</div></div>
        </div>
        <div class="card-body">
          <div id="layoutRows" class="col gap-6">
            ${(S.settings.dashboardLayout || []).map((id, i, arr) => `
              <div class="between" data-layout-item="${id}" style="padding:8px 10px;background:var(--surface-2);border-radius:var(--radius-sm)">
                <span class="small bold">${U.esc(DASHBOARD_WIDGET_LABELS[id] || id)}</span>
                <span class="row gap-4">
                  <button type="button" class="icon-btn btn-sm" data-move-up="${id}" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
                  <button type="button" class="icon-btn btn-sm" data-move-down="${id}" ${i === arr.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
                </span>
              </div>`).join("")}
          </div>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-head">
          <div><h3>Data retention</h3><div class="sub">Choose how long logs are kept, then purge the rest</div></div>
        </div>
        <div class="card-body">
          <div class="form-grid mb-12">
            <div class="field"><label>Study sessions kept</label>
              <input class="input" type="number" min="30" id="retStudy" value="${S.settings.retention.studyDays}" /> <span class="hint">days</span></div>
            <div class="field"><label>Usage log kept</label>
              <input class="input" type="number" min="7" id="retUsage" value="${S.settings.retention.usageDays}" /> <span class="hint">days</span></div>
            <div class="field"><label>Auto-archive completed work after</label>
              <input class="input" type="number" min="1" id="retArchive" value="${S.settings.retention.autoArchiveDays}" /> <span class="hint">days</span></div>
          </div>
          <button class="btn btn-primary" data-apply-retention>Save &amp; purge now</button>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-head">
          <div><h3>AI service</h3><div class="sub">Powers Add with AI and the Assistant</div></div>
        </div>
        <div class="card-body">
          <div id="aiStatus" class="small dim">Checking…</div>
          <div class="row gap-8 wrap mt-12">
            <button class="btn" data-ai-check>↻ Re-check</button>
            <button class="btn btn-primary" data-ai-probe>⚡ Test connection</button>
          </div>
          <p class="hint mt-12">
            Set <code>GEMINI_API_KEY</code> in your Netlify site's environment variables, then redeploy.
            A key added without a redeploy won't be picked up.
          </p>
        </div>
      </div>

      <div class="card" style="border-left:3px solid var(--danger)">
        <div class="card-head"><h3>Danger zone</h3></div>
        <div class="card-body">
          <div class="row gap-8 wrap">
            <button class="btn" data-reseed>↺ Start over</button>
            <button class="btn btn-danger" data-wipe>🗑 Clear everything</button>
          </div>
        </div>
      </div>`;
  }

  /** Renders the AI service diagnostic into #aiStatus. */
  // Last health result, so a repaint doesn't re-request. Probes are never
  // cached — the whole point of a probe is to try it again for real.
  let aiStatusCache = { at: 0, html: null };
  const AI_STATUS_TTL = 60000;

  function renderAiStatus(root, probe, allowCache) {
    const box = root.querySelector("#aiStatus");
    if (!box) return;

    if (allowCache && !probe && aiStatusCache.html && Date.now() - aiStatusCache.at < AI_STATUS_TTL) {
      box.innerHTML = aiStatusCache.html;
      return;
    }

    box.innerHTML = `<span class="dim">${probe ? "Testing a real request…" : "Checking…"}</span>`;

    App.assistant.checkHealth(probe).then((h) => {
      const rows = [];
      const badge = (okd, text) =>
        `<span class="badge ${okd ? "ok" : "danger"}">${U.esc(text)}</span>`;

      // The server only returns the key's length, the model name and the
      // rest of the deployment configuration to the operator account
      // (ADMIN_EMAIL). Everyone else gets the one fact this panel needs —
      // is the assistant switched on — so the panel has to render both
      // shapes rather than reading absent fields as "not set".
      if (h.operator) {
        rows.push(`<div class="between" style="padding:6px 0">
          <span class="small">API key</span>
          ${h.keyPresent
            ? badge(true, `Present (${h.keyLength} chars)`)
            : badge(false, "Not set on this deploy")}
        </div>`);

        if (h.keyPresent && !h.keyLooksTrimmed) {
          rows.push(`<div class="tiny" style="color:var(--warn);padding:2px 0">
            ⚠ The key has leading or trailing whitespace — re-paste it in Netlify without spaces or newlines.
          </div>`);
        }

        rows.push(`<div class="between" style="padding:6px 0">
          <span class="small">Model</span>
          <span class="small"><code>${U.esc(h.model)}</code> <span class="dim tiny">· ${U.esc(h.modelSource)}</span></span>
        </div>`);
      } else {
        rows.push(`<div class="between" style="padding:6px 0">
          <span class="small">AI assistant</span>
          ${h.configured ? badge(true, "Set up on this deploy") : badge(false, "Not set up on this deploy")}
        </div>`);
        rows.push(`<div class="tiny dim" style="padding:2px 0">
          Set <code>ADMIN_EMAIL</code> to this account's address in Netlify to see the full configuration here.
        </div>`);
      }

      if (h.probe) {
        rows.push(h.probe.ok
          ? `<div class="between" style="padding:6px 0">
               <span class="small">Live test</span>
               ${badge(true, `Working (${h.probe.ms} ms)`)}
             </div>`
          : `<div style="padding:6px 0">
               <div class="between"><span class="small">Live test</span>${badge(false, "Failed")}</div>
               <div class="tiny mt-4" style="color:var(--danger);word-break:break-word">
                 ${U.esc(h.probe.error || "Unknown error")}
                 ${h.probe.status ? ` <span class="dim">(HTTP ${h.probe.status})</span>` : ""}
               </div>
               ${/not found|404|model/i.test(h.probe.error || "")
                  ? `<div class="tiny dim mt-4">That usually means the model name is wrong for this key. Set <code>GEMINI_MODEL</code> to a model your key can reach.</div>`
                  : ""}
               ${/api key|permission|401|403/i.test(h.probe.error || "")
                  ? `<div class="tiny dim mt-4">That usually means the key is invalid, restricted, or the Generative Language API isn't enabled for it.</div>`
                  : ""}
             </div>`);
      }

      box.innerHTML = rows.join("");
      if (!probe) aiStatusCache = { at: Date.now(), html: box.innerHTML };
    }).catch((e) => {
      box.innerHTML = `<div class="small" style="color:var(--danger)">${U.esc(e.message)}</div>`;
    });
  }

  const DASHBOARD_WIDGET_LABELS = {
    hero: "Live status banner", warnings: "Heads-up warnings", stats: "Stat cards",
    countdowns: "Key date countdowns", schedule: "Today's schedule", due: "Due soon",
    trend: "Grade trend", grades: "Class averages", study: "Study activity"
  };

  /* ------------------------------------------------------------ shortcuts */

  function aboutTab() {
    return `
      <div class="card mb-16">
        <div class="card-head"><h3>Getting started</h3></div>
        <div class="card-body">
          <p class="small muted mb-12">The setup wizard walks through adding a class, your bell
            schedule, and one assignment — the fastest way to make the rest of the app feel like yours.</p>
          <button class="btn" data-run-onboarding>🎓 Run setup wizard</button>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-head"><h3>Keyboard shortcuts</h3></div>
        <div class="card-body">
          <div class="grid g-2">
            ${[["⌘K / Ctrl+K", "Command palette"], ["G then D", "Dashboard"],
               ["G then H", "Homework"], ["G then C", "Calendar"], ["G then P", "Planner"],
               ["G then G", "Grades"], ["G then F", "Focus timer"], ["G then N", "Notes"],
               ["N", "New assignment"], ["T", "Toggle dark mode"],
               ["Space", "Flip a flashcard"], ["1–4", "Answer a quiz question"],
               ["Esc", "Close a dialog"]].map(([k, d]) => `
              <div class="between" style="padding:7px 0">
                <span class="small muted">${d}</span><span class="kbd">${k}</span>
              </div>`).join("")}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>About</h3></div>
        <div class="card-body small muted">
          <p><strong style="color:var(--text)">Scholar ${S.SCHEMA === 2 ? "2.0" : ""}</strong> —
          a school tracker built with plain HTML, CSS, and JavaScript. No framework, no build step.</p>
          <p class="mt-8">Accounts, cross-device sync, the parent portal, and study groups run on
          Netlify Functions with Netlify Blobs. Everything else works entirely offline in your browser.</p>
          <p class="mt-8">Location uses the browser Geolocation API with a campus geofence you set yourself.
          Which class you're in comes from your timetable — GPS can't tell Room 204 from Room 206.</p>
        </div>
      </div>`;
  }

  /* --------------------------------------------------------------- render */

  const TABS = [
    { id: "account", label: "Account" },
    { id: "prefs", label: "Preferences" },
    { id: "schedule", label: "Schedule & terms" },
    { id: "data", label: "Data" },
    { id: "developer", label: "Developer" },
    { id: "about", label: "About" }
  ];

  function render() {
    if (idbBytes == null) App.idb.usage().then((n) => { idbBytes = n; }).catch(() => { idbBytes = 0; });

    return `<div class="page-inner" style="max-width:900px">
      <div class="page-head">
        <div><h1>${App.i18n.t("settings", "Settings")}</h1><div class="sub">Account, preferences, and your data</div></div>
      </div>
      <div class="tabs mb-16">
        ${TABS.map((t) => `<button class="tab ${tab === t.id ? "active" : ""}" data-tab="${t.id}">${t.label}</button>`).join("")}
      </div>
      ${tab === "account" ? accountTab()
        : tab === "prefs" ? prefsTab()
        : tab === "schedule" ? scheduleTab()
        : tab === "data" ? dataTab()
        : tab === "developer" ? developerTab()
        : aboutTab()}
    </div>`;
  }


  /* ============================================== F100 — Developer tab === */

  // Filled by mountDeveloper() from the server; null means "not fetched yet".
  let devState = { tokens: null, hooks: null, freshToken: null, error: null };

  function developerTab() {
    if (!App.sync.isSignedIn()) {
      return `<div class="card"><div class="card-body">
        ${UI.emptyState("groupsSignIn", "Sign in to use the API",
          "Personal API tokens and webhooks are issued by the server, so they're tied to an account.")}
      </div></div>`;
    }
    // [plans] F156 — tokens and webhooks are Ultra Premium. The server
    // refuses to mint either way; this is the version of that answer you get
    // before typing a label and clicking Create.
    if (!App.plans.has("api.tokens")) {
      return App.plans.lockCard("api.tokens", { what: "Personal API tokens and webhooks" });
    }

    const base = App.sync.apiBaseUrl();

    return `
      <div class="card mb-16">
        <div class="card-head"><h3>API tokens</h3></div>
        <div class="card-body">
          <p class="small dim" style="margin-top:0">A token lets a script you write read your own Scholar
          data. Treat it like a password — anyone holding it can read everything below.</p>

          ${devState.freshToken ? `
            <div class="card" style="background:var(--ok-bg);border:none;margin-bottom:12px">
              <div class="card-body">
                <div class="bold small">Copy this now — it isn't shown again</div>
                <p class="tiny dim" style="margin:4px 0 8px">The server stores it in a form it can't read back,
                so this is the only time it can be displayed.</p>
                <div class="row gap-8">
                  <input class="input mono grow" readonly data-select-all value="${U.esc(devState.freshToken)}" aria-label="Your new API token" />
                  <button type="button" class="btn" data-copy-token>Copy</button>
                </div>
              </div>
            </div>` : ""}

          <div id="devTokens">${devState.tokens ? tokenRows(devState.tokens) : `<div class="dim small">Loading…</div>`}</div>

          <div class="row gap-8 mt-12" style="align-items:flex-end">
            <div class="field grow" style="margin:0">
              <label>Label</label>
              <input class="input" id="devTokenLabel" placeholder="e.g. My homework script" maxlength="60" />
            </div>
            <button type="button" class="btn btn-primary" data-mint-token>Create token</button>
          </div>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-head"><h3>Webhooks</h3></div>
        <div class="card-body">
          <p class="small dim" style="margin-top:0">Scholar POSTs to a URL you choose when something changes.
          Each delivery is signed, so your endpoint can verify it really came from here.</p>

          <div id="devHooks">${devState.hooks ? hookRows(devState.hooks) : `<div class="dim small">Loading…</div>`}</div>

          <div class="form-grid mt-12">
            <div class="field full">
              <label>Endpoint URL</label>
              <input class="input" id="devHookUrl" type="url" placeholder="https://example.com/scholar-hook" />
            </div>
            <div class="field full">
              <label>Events</label>
              <div class="row wrap gap-6">
                <label class="row gap-6" style="align-items:center">
                  <input type="checkbox" class="check" id="evState" checked /> <span class="small">state.updated</span>
                </label>
              </div>
            </div>
          </div>
          <button type="button" class="btn btn-primary" data-add-hook>Add webhook</button>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Endpoints</h3></div>
        <div class="card-body">
          <p class="small dim" style="margin-top:0">Send your token as a bearer header. The API is
          <strong>read-only</strong> — writes would have to reconcile with the versioning that keeps your
          devices in sync, so they aren't offered rather than offered unreliably.</p>
          <pre class="small" style="white-space:pre-wrap;overflow-x:auto;background:var(--surface-2);padding:10px;border-radius:8px">curl -H "Authorization: Bearer sk_..." \\
  ${U.esc(base)}/api/v1/assignments</pre>
          <div class="table-wrap mt-12">
            <table class="table">
              <thead><tr><th>Endpoint</th><th>Returns</th></tr></thead>
              <tbody>
                <tr><td class="mono tiny">GET /api/v1/me</td><td class="small">Your account and last sync time</td></tr>
                <tr><td class="mono tiny">GET /api/v1/classes</td><td class="small">Your classes</td></tr>
                <tr><td class="mono tiny">GET /api/v1/assignments</td><td class="small">Assignments — add <span class="mono">?status=todo</span></td></tr>
                <tr><td class="mono tiny">GET /api/v1/schedule</td><td class="small">Periods and terms</td></tr>
                <tr><td class="mono tiny">GET /api/v1/grades</td><td class="small">Per-class percentage</td></tr>
              </tbody>
            </table>
          </div>
          <p class="tiny dim mt-12">Verify a webhook by computing
          <span class="mono">HMAC-SHA256</span> of the raw request body with your hook's secret and comparing it
          to the <span class="mono">X-Scholar-Signature</span> header.</p>
        </div>
      </div>`;
  }

  function tokenRows(list) {
    if (!list.length) return `<div class="dim small">No tokens yet.</div>`;
    return `<div class="list">${list.map((t) => `
      <div class="list-item">
        <span class="grow" style="min-width:0">
          <div class="title truncate">${U.esc(t.label)}</div>
          <div class="meta"><span class="mono">${U.esc(t.hint)}</span> · created ${U.esc(U.fmtDate(U.dateKey(new Date(t.createdAt))))}
            ${t.lastUsedAt ? ` · last used ${U.esc(U.relDate(U.dateKey(new Date(t.lastUsedAt))))}` : " · never used"}</div>
        </span>
        <button type="button" class="btn btn-sm" data-revoke-token="${U.esc(t.id)}">Revoke</button>
      </div>`).join("")}</div>`;
  }

  function hookRows(list) {
    if (!list.length) return `<div class="dim small">No webhooks yet.</div>`;
    return `<div class="list">${list.map((h) => `
      <div class="list-item">
        <span class="grow" style="min-width:0">
          <div class="title truncate mono tiny">${U.esc(h.url)}</div>
          <div class="meta">${U.esc((h.events || []).join(", "))}
            ${h.lastDeliveryAt
              ? ` · last delivery ${U.esc(U.relDate(U.dateKey(new Date(h.lastDeliveryAt))))}
                  ${h.lastError ? `<span class="badge danger">${U.esc(h.lastError)}</span>`
                                 : `<span class="badge ok">${U.esc(String(h.lastStatus || "OK"))}</span>`}`
              : " · not delivered yet"}</div>
        </span>
        <button type="button" class="btn btn-sm" data-remove-hook="${U.esc(h.id)}">Remove</button>
      </div>`).join("")}</div>`;
  }

  function loadDeveloper(root) {
    if (!App.sync.isSignedIn()) return;
    App.sync.listApiTokens()
      .then((r) => {
        devState.tokens = r.tokens || [];
        const box = root.querySelector("#devTokens");
        if (box) { box.innerHTML = tokenRows(devState.tokens); UI.associateLabels(box); }
      })
      .catch((e) => {
        const box = root.querySelector("#devTokens");
        if (box) box.innerHTML = `<div class="small" role="alert" style="color:var(--danger)">${U.esc(e.message)}</div>`;
      });

    App.sync.listWebhooks()
      .then((r) => {
        devState.hooks = r.webhooks || [];
        const box = root.querySelector("#devHooks");
        if (box) box.innerHTML = hookRows(devState.hooks);
      })
      .catch((e) => {
        const box = root.querySelector("#devHooks");
        if (box) box.innerHTML = `<div class="small" role="alert" style="color:var(--danger)">${U.esc(e.message)}</div>`;
      });
  }

  function mountDeveloper(root) {
    loadDeveloper(root);

    U.on(root, "click", "[data-mint-token]", (_e, el) => {
      const input = root.querySelector("#devTokenLabel");
      const label = input ? input.value.trim() : "";
      UI.busy(el, App.sync.mintApiToken(label))
        .then((r) => {
          devState.freshToken = r.token;
          UI.toast("Token created", "Copy it now — it isn't shown again.", "ok");
          App.router.refresh();
        })
        .catch((e) => UI.toast("Couldn't create the token", e.message, "danger"));
    });

    U.on(root, "click", "[data-copy-token]", () => {
      const f = root.querySelector("[data-select-all]");
      if (!f || !navigator.clipboard) return;
      navigator.clipboard.writeText(f.value)
        .then(() => UI.toast("Copied", "The token is on your clipboard.", "ok"))
        .catch(() => UI.toast("Couldn't copy", "Select the text and copy it manually.", "warn"));
    });

    U.on(root, "click", "[data-revoke-token]", (_e, el) => {
      const id = el.dataset.revokeToken;
      UI.confirm({
        title: "Revoke this token?",
        message: "Anything using it stops working immediately. This can't be undone.",
        okLabel: "Revoke",
        danger: true,
        onConfirm() {
          App.sync.revokeApiToken(id)
            .then(() => { devState.freshToken = null; UI.toast("Revoked", "", "warn"); App.router.refresh(); })
            .catch((e) => UI.toast("Couldn't revoke", e.message, "danger"));
        }
      });
    });

    U.on(root, "click", "[data-add-hook]", (_e, el) => {
      const url = (root.querySelector("#devHookUrl") || {}).value || "";
      const events = [];
      if (root.querySelector("#evState") && root.querySelector("#evState").checked) events.push("state.updated");
      if (!events.length) { UI.toast("Pick an event", "Choose at least one.", "warn"); return; }

      UI.busy(el, App.sync.addWebhook(url.trim(), events))
        .then((r) => {
          UI.toast("Webhook added",
            "Signing secret: " + (r.webhook && r.webhook.secret ? r.webhook.secret : ""), "ok");
          App.router.refresh();
        })
        .catch((e) => UI.toast("Couldn't add the webhook", e.message, "danger"));
    });

    U.on(root, "click", "[data-remove-hook]", (_e, el) => {
      App.sync.removeWebhook(el.dataset.removeHook)
        .then(() => { UI.toast("Removed", "", "warn"); App.router.refresh(); })
        .catch((e) => UI.toast("Couldn't remove it", e.message, "danger"));
    });
  }

  /* ---------------------------------------------------------------- forms */

  function importDialog() {
    UI.modal({
      title: "Import a Scholar backup",
      okLabel: "Import",
      body: `<div class="field">
          <label>Choose a backup file</label>
          <input class="input" type="file" id="impFile" accept="application/json,.json" />
        </div>
        <div class="field mt-12"><label>…or paste the JSON</label>
          <textarea class="textarea" id="impText" rows="5" placeholder='{ "schema": 2, … }'></textarea></div>
        <p class="hint mt-8" style="color:var(--danger)">⚠ This replaces everything currently in the app.</p>`,
      onSubmit(_d, root) {
        const file = root.querySelector("#impFile").files[0];
        const text = root.querySelector("#impText").value.trim();
        const apply = (raw) => {
          try {
            S.importJSON(raw);
            UI.toast("Backup imported", "All data replaced.", "ok");
            App.router.go("dashboard");
          } catch (err) { UI.toast("Import failed", err.message, "danger"); }
        };
        if (file) {
          const fr = new FileReader();
          fr.onload = () => apply(String(fr.result));
          fr.onerror = () => UI.toast("Import failed", "Couldn't read that file.", "danger");
          fr.readAsText(file);
          return true;
        }
        if (text) { apply(text); return true; }
        UI.toast("Nothing to import", "Pick a file or paste some JSON.", "warn");
        return false;
      }
    });
  }

  /** ICS / CSV import from Canvas, Google Classroom, Infinite Campus, etc. */
  function schoolImportDialog() {
    UI.modal({
      title: "Import from your school",
      sub: "Canvas, Google Classroom, Infinite Campus, PowerSchool — anything that exports .ics or .csv",
      size: "wide",
      okLabel: "Choose file",
      footer: `<button type="button" class="btn" data-close>Cancel</button>`,
      body: `<div class="field">
          <label>Calendar (.ics) or gradebook (.csv) file</label>
          <input class="input" type="file" id="schoolFile" accept=".ics,.csv,text/calendar,text/csv" />
        </div>
        <div class="divider"></div>
        <div class="small muted">
          <div class="bold" style="color:var(--text)">Where to find your export</div>
          <ul class="md-list mt-8" style="padding-left:18px">
            <li><strong>Canvas</strong> — Calendar → “Calendar Feed” link at the bottom right</li>
            <li><strong>Google Classroom</strong> — the class calendar in Google Calendar → Settings → Export</li>
            <li><strong>Infinite Campus / PowerSchool</strong> — Grades → export or print to CSV</li>
          </ul>
        </div>
        <div id="importPreview" class="mt-16"></div>`,
      onMount(root) {
        root.querySelector("#schoolFile").addEventListener("change", (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const fr = new FileReader();
          fr.onload = () => {
            const text = String(fr.result);
            const isCsv = /\.csv$/i.test(file.name) || (!/BEGIN:VCALENDAR/i.test(text) && text.includes(","));
            let rows;
            try {
              rows = isCsv ? App.ics.previewCSV(text) : App.ics.preview(text);
            } catch (err) {
              UI.toast("Couldn't read that file", err.message, "danger");
              return;
            }
            if (!rows.length) {
              root.querySelector("#importPreview").innerHTML =
                `<p class="small" style="color:var(--warn)">Nothing recognizable found in that file.</p>`;
              return;
            }
            renderImportPreview(root, rows, isCsv);
          };
          fr.readAsText(file);
        });
      }
    });
  }

  function renderImportPreview(root, rows, isCsv) {
    const box = root.querySelector("#importPreview");
    box.innerHTML = `
      <div class="between mb-8">
        <h4>${U.plural(rows.length, "item")} found</h4>
        <button type="button" class="btn btn-sm" id="toggleAll">Toggle all</button>
      </div>
      <div class="table-wrap" style="max-height:300px;overflow-y:auto">
        <table class="table"><thead><tr>
          <th style="width:30px"></th><th>Item</th><th>Class</th><th>Date</th><th>Type</th>
        </tr></thead><tbody>
          ${rows.map((r, i) => `<tr>
            <td><input type="checkbox" class="check" data-row="${i}" checked /></td>
            <td class="small">${U.esc(r.title)}</td>
            <td class="small muted">
              <select class="select input-sm" data-row-class="${i}" style="min-width:130px">
                <option value="">—</option>${UI.classOptions(r.classId)}
              </select>
            </td>
            <td class="small nowrap">${U.esc(U.fmtDate(r.date))}</td>
            <td><span class="badge">${U.esc(r.kind)}</span></td>
          </tr>`).join("")}
        </tbody></table>
      </div>
      <button type="button" class="btn btn-primary mt-12" id="doImport">Import selected</button>`;

    box.querySelector("#toggleAll").addEventListener("click", () => {
      const boxes = U.$$("[data-row]", box);
      const anyOff = boxes.some((b) => !b.checked);
      boxes.forEach((b) => { b.checked = anyOff; });
    });

    box.querySelector("#doImport").addEventListener("click", () => {
      U.$$("[data-row]", box).forEach((cb) => {
        const i = Number(cb.dataset.row);
        rows[i].include = cb.checked;
        const sel = box.querySelector(`[data-row-class="${i}"]`);
        if (sel) rows[i].classId = sel.value || null;
      });
      const res = isCsv ? App.ics.applyCSV(rows) : App.ics.apply(rows);
      UI.closeModal();
      UI.toast("Import complete",
        `${res.added} added${res.skipped ? ` · ${res.skipped} skipped as duplicates` : ""}`, "ok");
    });
  }

  function termForm() {
    UI.modal({
      title: "Add a term",
      okLabel: "Add",
      body: `<div class="form-grid">
        <div class="field full"><label>Name</label>
          <input class="input" name="name" required placeholder="Spring Semester" /></div>
        <div class="field"><label>Starts</label>
          <input class="input" type="date" name="start" value="${U.today()}" /></div>
        <div class="field"><label>Ends</label>
          <input class="input" type="date" name="end" value="${U.dateKey(U.addDays(new Date(), 120))}" /></div>
        <div class="field"><label>Final GPA <span class="hint">past terms only</span></label>
          <input class="input" type="number" name="gpa" step="0.01" min="0" max="5" placeholder="—" /></div>
        <div class="field"><label>Credits</label>
          <input class="input" type="number" name="credits" step="0.5" min="0" placeholder="6" /></div>
        <div class="field full"><label>Rolls into <span class="hint">e.g. Q1 rolls into S1 — nested grading periods</span></label>
          <select class="select" name="parentId">
            <option value="">— Standalone —</option>
            ${S.db.terms.filter((t) => !t.parentId).map((t) => `<option value="${t.id}">${U.esc(t.name)}</option>`).join("")}
          </select></div>
      </div>`,
      onSubmit(d) {
        if (!d.name.trim()) return false;
        S.insert("terms", {
          name: d.name.trim(), start: d.start, end: d.end, current: false,
          gpa: d.gpa === "" || d.gpa == null ? null : Number(d.gpa),
          credits: d.credits === "" || d.credits == null ? null : Number(d.credits),
          parentId: d.parentId || null
        });
        UI.toast("Term added", d.name);
      }
    });
  }

  function templateForm() {
    const classes = S.termClasses();
    if (!classes.length) { UI.toast("Add a class first"); return; }
    UI.modal({
      title: "Recurring assignment",
      sub: "Scholar creates each occurrence automatically",
      size: "wide",
      okLabel: "Create",
      body: `<div class="form-grid">
        <div class="field full"><label>Title</label>
          <input class="input" name="title" required placeholder="Weekly problem set" /></div>
        <div class="field"><label>Class</label>
          <select class="select" name="classId">${UI.classOptions(classes[0].id)}</select></div>
        <div class="field"><label>Type</label>
          <select class="select" name="type">
            ${["Homework", "Reading", "Quiz", "Lab", "Essay"].map((t) => `<option>${t}</option>`).join("")}
          </select></div>
        <div class="field"><label>Points</label>
          <input class="input" type="number" name="points" min="0" value="25" /></div>
        <div class="field"><label>Est. minutes</label>
          <input class="input" type="number" name="estMinutes" min="5" step="5" value="45" /></div>
        <div class="field"><label>Repeat every</label>
          <select class="select" name="interval">
            <option value="1">Week</option><option value="2">2 weeks</option><option value="4">4 weeks</option>
          </select></div>
        <div class="field"><label>Until</label>
          <input class="input" type="date" name="until" value="${(S.currentTerm() || {}).end || U.dateKey(U.addDays(new Date(), 90))}" /></div>
        <div class="field full"><label>On which days</label>
          ${UI.dayPicker("days", ["Fri"])}</div>
      </div>`,
      onMount(root) { UI.bindDays(root); },
      onSubmit(d) {
        if (!d.title.trim()) return false;
        const cls = S.cls(d.classId);
        S.insert("templates", {
          title: d.title.trim(), classId: d.classId, type: d.type,
          categoryId: cls && cls.categories[0] ? cls.categories[0].id : null,
          points: Number(d.points) || 0, estMinutes: Number(d.estMinutes) || 30,
          priority: "med", freq: "weekly",
          days: d.days ? d.days.split(",").filter(Boolean) : ["Fri"],
          interval: Number(d.interval) || 1, until: d.until,
          createdOn: U.today(), active: true, lastGenerated: null
        });
        const n = S.runTemplates(28);
        UI.toast("Recurring assignment created", `${n} upcoming occurrence${n === 1 ? "" : "s"} added`, "ok");
      }
    });
  }

  function dayExceptionForm(iso) {
    const sc = S.settings.schedule;
    UI.modal({
      title: U.fmtDate(iso, "long"),
      sub: "Override the cycle for this one day",
      okLabel: "Save",
      body: `<div class="field">
        <label>This day is…</label>
        <select class="select" name="val">
          <option value="">Follow the normal cycle</option>
          <option value="none" ${sc.exceptions[iso] === "none" ? "selected" : ""}>No school (holiday)</option>
          ${sc.cycle.map((cd) => `<option value="${U.esc(cd)}" ${sc.exceptions[iso] === cd ? "selected" : ""}>Day ${U.esc(cd)}</option>`).join("")}
        </select>
      </div>`,
      onSubmit(d) {
        S.commit((db) => {
          if (!d.val) delete db.settings.schedule.exceptions[iso];
          else db.settings.schedule.exceptions[iso] = d.val;
        });
        UI.toast("Day updated", U.fmtDate(iso, "day"));
      }
    });
  }

  /* ---------------------------------------------------------------- mount */

  function mount(root) {
    U.on(root, "click", "[data-tab]", (_e, el) => { tab = el.dataset.tab; App.router.refresh(); });
    U.on(root, "click", "[data-run-onboarding]", () => App.runOnboarding());

    /* --- account */
    U.on(root, "click", "[data-signup]", () => authForm("signup"));
    U.on(root, "click", "[data-signin]", () => authForm("signin"));
    U.on(root, "click", "[data-signout]", () => {
      UI.confirm({
        title: "Sign out?",
        message: "Your data stays on this device. Sign back in any time to resume syncing.",
        okLabel: "Sign out",
        onConfirm() { App.sync.signOut(); UI.toast("Signed out"); App.router.refresh(); }
      });
    });
    U.on(root, "click", "[data-sync-now]", () => {
      App.sync.push(false).then((r) => {
        if (r && r.ok) UI.toast("Synced", "Your data is up to date.", "ok");
        else if (r && r.reason !== "conflict") UI.toast("Not synced", (r && r.message) || "", "danger");
        App.router.refresh();
      });
    });
    U.on(root, "change", "[data-autosync]", (_e, el) => {
      S.commit((db) => { db.account.autoSync = el.checked; });
    });
    U.on(root, "click", "[data-mint-code]", () => {
      App.sync.createLinkCode().then((code) => {
        const box = root.querySelector("#linkCodeBox");
        if (box) box.innerHTML = `<div class="card mb-12" style="background:var(--brand-50);border:none">
          <div class="card-body center">
            <div class="tiny dim">Give this to your parent — valid for 24 hours, single use</div>
            <div class="mono" style="font-size:2rem;font-weight:800;letter-spacing:.2em;color:var(--brand-600);margin-top:6px">${U.esc(code)}</div>
          </div></div>`;
      }).catch((e) => UI.toast("Couldn't create a code", e.message, "danger"));
    });

    if (tab === "account" && App.sync.isSignedIn() && App.sync.info().user.role === "student") {
      App.sync.parents().then((list) => {
        const box = root.querySelector("#parentList");
        if (!box) return;
        box.innerHTML = list.length
          ? list.map((p) => `<div class="list-item" style="padding:8px 0">
              ${UI.avatar(p.name, "#64748b", "sm")}
              <span class="grow"><div class="small bold">${U.esc(p.name)}</div>
                <div class="tiny dim">Linked ${U.fmtDate(U.dateKey(new Date(p.since)))}</div></span>
              <button class="btn btn-sm" data-unlink-parent="${p.id}">Remove</button>
            </div>`).join("")
          : `<p class="dim small">Nobody is linked to your account.</p>`;
      }).catch(() => {});
    }
    U.on(root, "click", "[data-unlink-parent]", (_e, el) => {
      App.sync.unlink(el.dataset.unlinkParent).then(() => { UI.toast("Removed"); App.router.refresh(); });
    });

    U.on(root, "click", "[data-save-profile]", () => {
      const patch = {};
      U.$$("[data-p]", root).forEach((el) => { patch[el.dataset.p] = el.value.trim(); });
      S.commit((db) => { Object.assign(db.profile, patch); });
      UI.toast("Profile saved", patch.name, "ok");
    });

    /* --- preferences */
    U.on(root, "change", "[data-pref]", (_e, el) => {
      const key = el.dataset.pref;
      if (key === "theme") {
        S.commit((db) => { db.settings.theme = el.checked ? "dark" : "light"; });
        App.applyTheme();
      } else {
        S.commit((db) => { db.settings[key] = el.checked; });
        if (key === "dyslexicFont" || key === "trueBlack" || key === "highContrast") App.applyShellPrefs();
        // Turning weighted GPA on reveals the per-type boost fields below it.
        if (key === "gpaWeighted") App.router.refresh();
      }
    });
    U.on(root, "change", "[data-pref-num]", (_e, el) => {
      S.commit((db) => { db.settings[el.dataset.prefNum] = Number(el.value); });
    });
    U.on(root, "change", "[data-pref-str]", (_e, el) => {
      S.commit((db) => { db.settings[el.dataset.prefStr] = el.value; });
      App.router.refresh();
    });
    U.on(root, "change", "[data-pref-nested]", (_e, el) => {
      const [group, key] = el.dataset.prefNested.split(".");
      S.commit((db) => { db.settings[group][key] = el.checked; });
    });

    const localeSel = root.querySelector("#localeSel");
    if (localeSel) localeSel.addEventListener("change", (e) => { App.i18n.setLocale(e.target.value); App.router.refresh(); });

    const fontSizeSel = root.querySelector("#fontSizeSel");
    if (fontSizeSel) fontSizeSel.addEventListener("change", (e) => {
      S.commit((db) => { db.settings.fontSize = e.target.value; });
      App.applyShellPrefs();
    });

    const collapseBtn = root.querySelector("#prefCollapseBtn");
    if (collapseBtn) collapseBtn.addEventListener("click", () => {
      S.commit((db) => { db.settings.sidebarCollapsed = !db.settings.sidebarCollapsed; });
      App.applyShellPrefs();
      App.router.refresh();
    });

    U.on(root, "click", "[data-density-opt]", (_e, el) => {
      S.commit((db) => { db.settings.density = el.dataset.densityOpt; });
      App.applyShellPrefs();
      App.router.refresh();
    });
    U.on(root, "click", "[data-open-shop]", () => App.router.go("shop"));
    App.plans.bindLocks(root);   // [plans]
    U.on(root, "click", "[data-accent-opt]", (_e, el) => {
      S.commit((db) => { db.settings.accent = el.dataset.accentOpt; });
      App.applyShellPrefs();
      App.router.refresh();
      UI.toast("Accent updated", U.titleCase(el.dataset.accentOpt));
    });
    const cvdSel = root.querySelector("#cvdSel");
    if (cvdSel) cvdSel.addEventListener("change", (e) => {
      S.commit((db) => { db.settings.cvdPreview = e.target.value; });
      App.applyShellPrefs();
    });
    U.on(root, "change", "[data-gpa-scale]", (_e, el) => {
      const key = el.dataset.gpaScale;
      const val = Number(el.value);
      if (!isFinite(val)) return;
      S.commit((db) => {
        if (!db.settings.gpaScale) db.settings.gpaScale = { ap: 1, honors: 1, max: 5 };
        db.settings.gpaScale[key] = val;
      });
      UI.toast("GPA scale updated", "", "ok");
    });

    const emptyStyleSel = root.querySelector("#emptyStyleSel");
    if (emptyStyleSel) emptyStyleSel.addEventListener("change", (e) => {
      S.commit((db) => { db.settings.emptyStateStyle = e.target.value; });
      App.router.refresh();
    });

    U.on(root, "change", "[data-notif]", (_e, el) => {
      const key = el.dataset.notif;
      if (key === "enabled") {
        if (el.checked) {
          App.notify.enable().then((okd) => {
            if (!okd) UI.toast("Permission needed", "Your browser blocked notifications.", "warn");
            App.router.refresh();
          });
        } else { App.notify.disable(); App.router.refresh(); }
        return;
      }
      S.commit((db) => { db.settings.notifications[key] = el.checked; });
    });
    U.on(root, "change", "[data-notif-num]", (_e, el) => {
      S.commit((db) => { db.settings.notifications[el.dataset.notifNum] = Number(el.value); });
    });
    U.on(root, "change", "[data-notif-time]", (_e, el) => {
      S.commit((db) => { db.settings.notifications[el.dataset.notifTime] = el.value; });
    });
    U.on(root, "click", "[data-test-notif]", () => {
      if (!App.notify.test()) UI.toast("Enable reminders first", "Turn the toggle on to allow notifications.", "warn");
    });

    U.on(root, "click", "[data-install]", () => {
      if (installEvent) {
        installEvent.prompt();
        installEvent.userChoice.then((res) => {
          UI.toast(res.outcome === "accepted" ? "Installing…" : "Install dismissed", "", res.outcome === "accepted" ? "ok" : "");
          installEvent = null;
        });
      } else if (window.matchMedia("(display-mode: standalone)").matches) {
        UI.toast("Already installed", "You're running the installed app.", "ok");
      } else {
        UI.toast("Use your browser's install option",
          "Chrome: the install icon in the address bar. iOS Safari: Share → Add to Home Screen.");
      }
    });
    U.on(root, "click", "[data-update-sw]", () => {
      if (!navigator.serviceWorker) { UI.toast("Not supported here"); return; }
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (!reg) { UI.toast("Not installed yet"); return; }
        reg.update().then(() => UI.toast("Checked for updates", "Reload to apply anything new.", "ok"));
      });
    });

    /* --- schedule & terms */
    U.on(root, "click", "[data-sched-mode]", (_e, el) => {
      S.commit((db) => { db.settings.schedule.mode = el.dataset.schedMode; });
      UI.toast("Schedule type changed", el.dataset.schedMode === "rotating" ? "Rotating cycle" : "Same every week");
    });
    U.on(root, "change", "[data-sched-weekend]", (_e, el) => {
      S.commit((db) => { db.settings.schedule.skipWeekends = el.checked; });
    });
    U.on(root, "click", "[data-save-cycle]", () => {
      const days = root.querySelector("#cycleDays").value.split(",").map((s) => s.trim()).filter(Boolean);
      const anchor = root.querySelector("#cycleAnchor").value;
      if (!days.length) { UI.toast("Add at least one cycle day", "", "warn"); return; }
      S.commit((db) => {
        db.settings.schedule.cycle = days;
        db.settings.schedule.anchor = anchor;
      });
      UI.toast("Cycle saved", days.join(" → "));
    });
    U.on(root, "click", "[data-day-ex]", (_e, el) => dayExceptionForm(el.dataset.dayEx));
    U.on(root, "click", "[data-class-pattern]", (_e, el) => {
      const c = S.cls(el.dataset.classPattern);
      const cd = el.dataset.cd;
      if (!c) return;
      const set = new Set(c.patternDays || []);
      if (set.has(cd)) set.delete(cd); else set.add(cd);
      S.update("classes", c.id, { patternDays: [...set] });
    });

    U.on(root, "click", "[data-add-term]", termForm);
    U.on(root, "click", "[data-archive]", (_e, el) => {
      const t = S.byId("terms", el.dataset.archive);
      const gpa = S.gpa(null, t.id);
      const credits = U.sum(S.termClasses(t.id), (c) => c.credits || 1);
      UI.confirm({
        title: "Archive this term?",
        message: `"${t.name}" will be frozen at GPA ${U.round(gpa, 2)} (${credits} credits) and counted in your cumulative GPA. Create a new term for your next classes.`,
        okLabel: "Archive",
        onConfirm() {
          S.commit((db) => {
            const term = db.terms.find((x) => x.id === t.id);
            term.current = false; term.gpa = U.round(gpa, 2); term.credits = credits;
          });
          UI.toast("Term archived", t.name, "ok");
        }
      });
    });
    U.on(root, "click", "[data-make-current]", (_e, el) => {
      S.commit((db) => { db.terms.forEach((t) => { t.current = t.id === el.dataset.makeCurrent; }); });
      UI.toast("Current term changed");
    });
    U.on(root, "click", "[data-del-term]", (_e, el) => {
      const t = S.byId("terms", el.dataset.delTerm);
      UI.deleteWithUndo("terms", t.id, t.name);
    });

    /* --- data */
    U.on(root, "click", "[data-export]", () => {
      U.download(`scholar-backup-${U.today()}.json`, S.exportJSON());
      UI.toast("Backup downloaded", "Keep it somewhere safe.", "ok");
    });
    // Every commit repaints the page, and mount() re-runs — so toggling any
    // setting on this tab fired a fresh network request. Cache the last
    // non-probe result briefly; the explicit "Check again" button below
    // bypasses it.
    if (root.querySelector("#aiStatus")) renderAiStatus(root, false, true);
    if (root.querySelector("#devTokens")) mountDeveloper(root);
    U.on(root, "click", "[data-ai-check]", () => renderAiStatus(root, false));
    U.on(root, "click", "[data-ai-probe]", () => renderAiStatus(root, true));

    U.on(root, "click", "[data-import]", importDialog);
    U.on(root, "click", "[data-load-demo]", () => {
      UI.confirm({
        title: "Load sample data?",
        message: "This replaces everything currently in the app with an example student's classes, grades, and assignments — handy for trying features out. Export a backup first if you've already entered real data.",
        okLabel: "Load sample data",
        danger: true,
        onConfirm() {
          S.loadDemo();
          UI.toast("Sample data loaded", "Clear everything in Danger zone to start fresh.", "ok");
          App.router.go("dashboard");
        }
      });
    });
    U.on(root, "click", "[data-import-school]", schoolImportDialog);
    U.on(root, "click", "[data-export-ics]", () => {
      App.ics.download();
      UI.toast("Calendar exported", "Open the .ics to import it.", "ok");
    });
    U.on(root, "click", "[data-print]", () => window.print());

    U.on(root, "click", "[data-restore]", (_e, el) => {
      S.restore(el.dataset.restore);
      UI.toast("Restored", "", "ok");
    });
    U.on(root, "click", "[data-empty-trash]", () => {
      UI.confirm({
        title: "Empty the trash?",
        message: `${U.plural(S.db.trash.length, "item")} will be permanently deleted.`,
        okLabel: "Empty trash", danger: true,
        onConfirm() { S.purgeTrash(); UI.toast("Trash emptied"); }
      });
    });

    U.on(root, "click", "[data-add-template]", templateForm);
    U.on(root, "click", "[data-toggle-template]", (_e, el) => {
      const t = S.byId("templates", el.dataset.toggleTemplate);
      S.update("templates", t.id, { active: t.active === false });
      if (t.active !== false) S.runTemplates(28);
    });
    U.on(root, "click", "[data-del-template]", (_e, el) => {
      const t = S.byId("templates", el.dataset.delTemplate);
      UI.deleteWithUndo("templates", t.id, t.title);
    });

    U.on(root, "click", "[data-reseed]", () => {
      UI.confirm({
        title: "Start over?",
        message: "This clears everything and returns the app to a brand-new state, including the first-run setup. Export a backup first if you want to keep anything.",
        okLabel: "Start over", danger: true,
        onConfirm() { S.reset(); UI.toast("Reset", "The app is back to a fresh start.", "ok"); App.router.go("dashboard"); }
      });
    });
    U.on(root, "click", "[data-wipe]", () => {
      UI.confirmTyped({
        title: "Clear everything?",
        message: "All assignments, notes, grades, and logs will be deleted. Your classes and bell schedule are kept. This can't be undone.",
        okLabel: "Clear it all", phrase: "DELETE",
        onConfirm() { S.wipe(); UI.toast("Data cleared", "Starting fresh.", "warn"); App.router.go("dashboard"); }
      });
    });

    // F083 — reorder dashboard widgets
    U.on(root, "click", "[data-move-up]", (_e, el) => {
      const order = (S.settings.dashboardLayout || []).slice();
      const i = order.indexOf(el.dataset.moveUp);
      if (i > 0) { [order[i - 1], order[i]] = [order[i], order[i - 1]]; S.setDashboardLayout(order); App.router.refresh(); }
    });
    U.on(root, "click", "[data-move-down]", (_e, el) => {
      const order = (S.settings.dashboardLayout || []).slice();
      const i = order.indexOf(el.dataset.moveDown);
      if (i >= 0 && i < order.length - 1) { [order[i + 1], order[i]] = [order[i], order[i + 1]]; S.setDashboardLayout(order); App.router.refresh(); }
    });

    // F051 — commute and bus times
    U.on(root, "click", "[data-save-commute]", () => {
      const toMin = Number(root.querySelector("#commuteTo").value) || 0;
      const fromMin = Number(root.querySelector("#commuteFrom").value) || 0;
      const lastBus = root.querySelector("#lastBus").value || "";
      S.commit((db) => { db.settings.commute = { toMin, fromMin, lastBus }; });
      UI.toast("Commute saved", "", "ok");
    });

    // F090 — retention controls
    U.on(root, "click", "[data-apply-retention]", () => {
      // A negative value put the cutoff in the *future*, so "keep 1 day" typed
      // as -1 permanently deleted every study session — and applyRetention
      // bypasses the trash, so there was no undo. Clamp to a sane range.
      const days = (sel, dflt) => {
        const n = Number(root.querySelector(sel).value);
        if (!Number.isFinite(n) || n <= 0) return dflt;
        return Math.min(3650, Math.round(n));
      };
      const studyDays = days("#retStudy", 365);
      const usageDays = days("#retUsage", 180);
      const autoArchiveDays = days("#retArchive", 30);

      UI.confirm({
        title: "Purge old records?",
        message: `Study sessions older than ${studyDays} days and usage data older than ${usageDays} days ` +
                 "will be deleted permanently. This does not go to the trash and can't be undone.",
        okLabel: "Save and purge",
        danger: true,
        onConfirm() {
          S.commit((db) => { db.settings.retention = { studyDays, usageDays, autoArchiveDays }; });
          const purged = S.applyRetention();
          UI.toast("Retention saved", purged ? `${purged} old record(s) purged` : "Nothing to purge yet", "ok");
          App.router.refresh();
        }
      });
    });
  }

  return { render, mount, title: "Settings" };
})();
