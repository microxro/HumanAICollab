/* ==========================================================================
   plans.js — F156 account tiers, client side

   This file decides nothing. Every answer it gives comes from
   `GET /billing/plan`, and every gate it renders is a signpost for a refusal
   the server would make anyway — you can delete this file, edit the state in
   devtools, or call the API with curl, and the answer to "may this account
   push to the server" is identical. That is the point: the enforcement lives
   in netlify/functions/_lib/plans.js, where the customer cannot reach it.

   What it is for is the other half of the job — telling somebody *before*
   they click that a feature belongs to a tier they aren't on, instead of
   letting them fill in a form and meet a 402.

   Two states matter and are easy to confuse:

     disabled   this deploy doesn't run paid plans (SCHOLAR_PLANS unset, the
                default), or nobody is signed in, or there is no backend at
                all. Nothing is gated, no locks are drawn, and the nav item
                stays hidden. A static download of this repo lives here.
     enabled    the server enforces tiers. `plan()` is what it says this
                account is on, and the locks mean something.

   Tiers only ever gate work the server does. Everything Scholar does on the
   device is in Basic and stays there — see _lib/plans.js for why that is a
   design rule rather than a pricing accident.
   ========================================================================== */

App.plans = (function () {
  const U = App.utils, S = App.store;

  /* ------------------------------------------------------------ catalogue

     Prices are display-only. No payment processor is wired to this deploy,
     the pricing screen says so plainly, and there is nowhere in this codebase
     that takes a card number. Editing these strings changes what the screen
     advertises and nothing else; wiring real billing means adding a checkout
     route on the server, not changing this file.                            */

  const TIERS = [
    {
      id: "basic",
      name: "Basic",
      price: "Free",
      tagline: "The whole app, on this device, forever.",
      includes: [
        "Every screen: classes, homework, grades, timetable, planner",
        "Focus timer, flashcards, notes, reading, guidance",
        "Activities in and out of school, goals, applications",
        "The study shop and everything it sells",
        "Works offline, installs as an app, exports a backup",
        "Pulling your data back down from the server, always"
      ]
    },
    {
      id: "premium",
      name: "Premium",
      price: "$4 / month",
      tagline: "The parts that need a server behind them.",
      includes: [
        "Sync every device to your account",
        "The parent portal — live status, weekly digest",
        "Study groups: shared decks, the homework feed, group tasks",
        "Everything in Basic"
      ]
    },
    {
      id: "ultra",
      name: "Ultra Premium",
      price: "$8 / month",
      tagline: "Everything, plus the parts that cost provider quota.",
      includes: [
        "The AI assistant, grounded in your own record",
        "Add with AI, and add from a link",
        "Personal API tokens and the read-only /v1 API",
        "Webhooks",
        "Everything in Premium"
      ]
    }
  ];

  const RANK = { basic: 0, premium: 1, ultra: 2 };

  /**
   * Feature id → tier, mirroring FEATURES in netlify/functions/_lib/plans.js.
   *
   * A copy, not a source of truth: the server sends its own table in the
   * billing payload and `state.features` overwrites this the moment it
   * answers. This is what the screen draws before that arrives, and what it
   * falls back to when the server can't be reached.
   */
  const DEFAULT_FEATURES = {
    "sync.push": "premium",
    "portal.link": "premium",
    "portal.location": "premium",
    "groups.create": "premium",
    "groups.join": "premium",
    "digest": "premium",
    "ai": "ultra",
    "api.tokens": "ultra",
    "api.webhooks": "ultra"
  };

  const state = {
    enabled: false,
    plan: "ultra",        // "nothing is gated" until the server says otherwise
    stored: "basic",
    until: null,
    canceledAt: null,
    operator: false,
    features: Object.assign({}, DEFAULT_FEATURES),
    checked: false,       // has the server actually answered yet?
    error: null
  };

  const listeners = new Set();
  function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function emit() { [...listeners].forEach((f) => { try { f(); } catch (e) { console.error(e); } }); }

  /* --------------------------------------------------------------- reads */

  function enabled() { return !!state.enabled; }
  function plan() { return state.enabled ? state.plan : "ultra"; }
  function tiers() { return TIERS.slice(); }
  function tier(id) { return TIERS.find((t) => t.id === id) || null; }
  function label(id) { const t = tier(id); return t ? t.name : id; }
  function isOperator() { return !!state.operator; }
  function info() { return Object.assign({}, state); }
  function requiredFor(feature) { return state.features[feature] || DEFAULT_FEATURES[feature] || null; }

  /**
   * Does this account have `feature`?
   *
   * True whenever plans are off, when the server hasn't answered yet, and for
   * any feature id nobody has priced. Defaulting closed would black out the
   * app on a slow network or a deploy that never had tiers at all — and the
   * server refuses anyway, so a wrong answer here costs a signpost, never a
   * permission.
   */
  function has(feature) {
    if (!state.enabled) return true;
    const required = requiredFor(feature);
    if (!required) return true;
    return (RANK[state.plan] || 0) >= (RANK[required] || 0);
  }

  /** The tier's expiry as a date string, or "" when it doesn't end. */
  function until() {
    if (!state.until) return "";
    return U.fmtDate(U.dateKey(new Date(Number(state.until))));
  }

  /* -------------------------------------------------------------- writes */

  /**
   * Ask the server what this account is on.
   *
   * Silent about failure on purpose: this runs at boot and after sign-in, and
   * an offline device that can't reach /billing has no business drawing locks
   * over features it also can't reach.
   */
  function refresh() {
    if (!App.sync || !App.sync.isSignedIn()) {
      const was = state.enabled;
      state.enabled = false;
      state.checked = false;
      if (was) emit();
      return Promise.resolve(state);
    }
    return App.sync.billing().then((res) => {
      adopt(res);
      return state;
    }).catch((e) => {
      state.error = e && e.message;
      return state;
    });
  }

  function adopt(res) {
    if (!res || typeof res !== "object") return;
    const before = state.plan + "|" + state.enabled;
    state.enabled = !!res.enabled;
    state.plan = res.plan || "basic";
    state.stored = res.stored || "basic";
    state.until = res.until || null;
    state.canceledAt = res.canceledAt || null;
    state.operator = !!res.operator;
    if (res.features && typeof res.features === "object") state.features = res.features;
    state.checked = true;
    state.error = null;
    // A push refused for tier reasons stops the retry loop; a plan that now
    // covers it has to restart that, or the upgrade looks like it failed.
    if (has("sync.push") && App.sync && App.sync.clearBlocked) App.sync.clearBlocked();
    if (before !== state.plan + "|" + state.enabled) emit();
  }

  function cancel() {
    return App.sync.cancelPlan().then((res) => { adopt(res); emit(); return res; });
  }

  function grant(email, tierId, untilMs) {
    return App.sync.grantPlan(email, tierId, untilMs).then((res) => {
      // Granting to yourself changes your own entitlement; re-read rather
      // than assume, since the server applies expiry and validation.
      return refresh().then(() => res);
    });
  }

  /* --------------------------------------------------------------- views */

  /**
   * The card a view shows in place of a feature this account can't reach.
   * One helper so every lock in the app reads the same and, when this feature
   * is removed, there is one thing to grep for.
   */
  function lockCard(feature, opts) {
    const o = opts || {};
    const required = requiredFor(feature) || "premium";
    const t = tier(required);
    return `<div class="card">
      <div class="card-body center col gap-12" style="align-items:center;padding:30px 22px">
        <div style="font-size:1.8rem" aria-hidden="true">🔒</div>
        <div>
          <h3>${U.esc(o.title || (t ? t.name : "A paid tier"))}</h3>
          <p class="small muted mt-4" style="max-width:44ch">
            ${U.esc(o.message || `${o.what || "This"} is part of ${t ? t.name : "a paid tier"}. ` +
              `You're on ${U.esc(label(plan()))} — everything on this device keeps working.`)}
          </p>
        </div>
        <button class="btn btn-primary" data-open-plans>See what's in ${U.esc(t ? t.name : "the tiers")}</button>
      </div>
    </div>`;
  }

  /** Wire any lockCard() in `root` to the plans screen. */
  function bindLocks(root) {
    U.on(root, "click", "[data-open-plans]", () => App.router.go("plans"));
  }

  return {
    TIERS, RANK,
    enabled, plan, tiers, tier, label, isOperator, info, has, requiredFor, until,
    refresh, adopt, cancel, grant, on, lockCard, bindLocks
  };
})();
