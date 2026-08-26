/* ==========================================================================
   _lib/plans.js — F156 account tiers: basic, premium, ultra

   The whole feature hangs off this file. Two rules shaped it.

   **The server is the only authority.** A plan lives on the profile blob and
   is checked in one place in the router (see the `[plans]` block in api.js),
   after authentication. Nothing in the browser decides what an account may
   do; the client's locks are signposting, and the same request made with curl
   gets the same 402.

   **Only what the server does can be sold.** Everything Scholar does on the
   device — classes, homework, grades, the timetable, the planner, flashcards,
   notes, guidance, the study shop, offline PWA use — is in the free tier and
   stays there. Not out of generosity: a static app cannot enforce a lock on
   somebody's own machine, and a paywall that a devtools console removes in
   ten seconds is a lie told to the honest half of your users. What is sold is
   the part that costs this deploy money to run: storage, bandwidth, the
   parent portal's live status, the AI provider's quota.

   Enforcement is off unless the deploy turns it on:

     SCHOLAR_PLANS=on   enables it. Anything else (including unset) and every
                        account behaves exactly as it did before this file
                        existed — the kill switch, and the default.
     ADMIN_EMAIL        must also be set. Plans are granted by the operator,
                        so enforcing with no operator named would lock every
                        account out of sync with nobody able to grant it back.
                        That combination refuses to enforce and says so.

   Cancelling is self-serve, immediate, and never destructive: POST
   /billing/cancel drops the caller to basic on the spot. GET /sync is
   deliberately NOT gated, at any tier, so a cancelled account can always pull
   its own data back down. Holding someone's data hostage to a subscription is
   not a business model this file will implement.
   ========================================================================== */

export const TIERS = ["basic", "premium", "ultra"];

const RANK = { basic: 0, premium: 1, ultra: 2 };

export const TIER_LABEL = { basic: "Basic", premium: "Premium", ultra: "Ultra Premium" };

/**
 * Feature id → the tier that unlocks it.
 *
 * Every id here is server-side work. There is no entry for anything the
 * browser does alone, and adding one would be a category error: this table is
 * consulted by the API, which never sees a local action.
 */
export const FEATURES = {
  "sync.push":       "premium",   // uploading this device's state
  "portal.link":     "premium",   // minting a code that links a guardian
  "portal.location": "premium",   // pushing live status + the shared summary
  "groups.create":   "premium",
  "groups.join":     "premium",
  "digest":          "premium",   // the weekly email to a linked guardian
  "ai":              "ultra",     // every route in netlify/functions/assistant.js
  "api.tokens":      "ultra",     // personal API tokens (F100)
  "api.webhooks":    "ultra"
};

/** Human wording for what a feature is, used in the 402 body. */
const FEATURE_LABEL = {
  "sync.push": "Syncing this device to your account",
  "portal.link": "Linking a parent or guardian",
  "portal.location": "The parent portal's live view",
  "groups.create": "Creating a study group",
  "groups.join": "Joining a study group",
  "digest": "The weekly guardian digest",
  "ai": "The AI features",
  "api.tokens": "Personal API tokens",
  "api.webhooks": "Webhooks"
};

/* ------------------------------------------------------------- the switch */

/**
 * Whether this deploy enforces tiers at all.
 *
 * Deliberately not cached: Netlify functions are long-lived between requests,
 * and an operator who flips the variable and redeploys expects the next
 * request to obey it.
 */
export function plansEnabled() {
  const flag = String(process.env.SCHOLAR_PLANS || "").trim().toLowerCase();
  if (flag !== "on" && flag !== "1" && flag !== "true") return false;
  if (!String(process.env.ADMIN_EMAIL || "").trim()) {
    // Not a silent no-op: this is a misconfiguration whose symptom (sync
    // stops working for everybody, permanently) looks nothing like its cause.
    console.warn("[plans] SCHOLAR_PLANS is on but ADMIN_EMAIL is unset — refusing to enforce, "
      + "since nobody would be able to grant a plan back.");
    return false;
  }
  return true;
}

/* -------------------------------------------------------------- the plan */

/**
 * The tier an account is actually on right now.
 *
 * Expiry is applied here rather than by a sweep job: a grant that ran out
 * yesterday must read as basic on the next request, whether or not anything
 * has since rewritten the profile.
 */
export function planOf(profile) {
  const b = (profile && profile.billing) || {};
  const tier = TIERS.includes(b.plan) ? b.plan : "basic";
  if (tier === "basic") return "basic";
  if (b.until && Number(b.until) > 0 && Number(b.until) <= Date.now()) return "basic";
  return tier;
}

export function atLeast(plan, required) {
  return (RANK[plan] || 0) >= (RANK[required] || 0);
}

/**
 * @param {object} profile the account
 * @param {string} feature a key of FEATURES
 * @param {boolean} isOperator whoever runs the deploy, from ADMIN_EMAIL
 *
 * The operator always passes. Without that, a fresh deploy is a deadlock:
 * enforcement is on, every account is basic, and the one person who can grant
 * a plan cannot sync their own device to find the button.
 */
export function hasFeature(profile, feature, isOperator) {
  if (!plansEnabled()) return true;
  if (isOperator) return true;
  const required = FEATURES[feature];
  if (!required) return true;          // an unknown id is not a paywall
  return atLeast(planOf(profile), required);
}

/** The body of the 402, written for the person who hit it. */
export function denial(feature, plan) {
  const required = FEATURES[feature] || "premium";
  const what = FEATURE_LABEL[feature] || "That feature";
  return `${what} is part of ${TIER_LABEL[required]}. This account is on ${TIER_LABEL[plan] || "Basic"}. `
    + `Everything on your own device keeps working, and you can always pull your data back down.`;
}

/* ------------------------------------------------------------ the routing

   One table, consulted once in the router, so the gate is not scattered
   through sixty handlers — and so removing the feature is deleting a file and
   six lines rather than auditing every route for a check that might be left
   behind.

   Reads are absent on purpose. GET /sync, GET /groups/:id, GET /link/parents
   and the rest stay open at every tier: downgrading someone must never make
   their own data unreachable.                                               */

export function routeFeature(parts, method) {
  const [a, b] = parts;
  const write = method !== "GET" && method !== "HEAD";

  if (a === "sync" && (method === "PUT" || method === "POST")) return "sync.push";
  if (a === "link" && b === "code" && write) return "portal.link";
  if (a === "location" && !b && method === "POST") return "portal.location";
  if (a === "groups" && !b && method === "POST") return "groups.create";
  if (a === "groups" && b === "join" && method === "POST") return "groups.join";
  if (a === "tokens" && write) return "api.tokens";
  if (a === "webhooks" && write) return "api.webhooks";
  return null;
}

/**
 * Whether an address is this deploy's operator.
 *
 * api.js has its own isOperator() over a profile; this is the same rule for
 * the callers that only hold an email — the scheduled digest, which has no
 * request and no session to read a profile from.
 */
export function isOperatorEmail(email) {
  const admin = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (!admin) return false;
  return String(email || "").trim().toLowerCase() === admin;
}

/* ----------------------------------------------------------- the record */

/** What the client is told about its own plan. */
export function billingState(profile, isOperator) {
  const b = (profile && profile.billing) || {};
  return {
    enabled: plansEnabled(),
    plan: plansEnabled() ? planOf(profile) : "ultra",
    stored: TIERS.includes(b.plan) ? b.plan : "basic",
    until: b.until || null,
    since: b.since || null,
    canceledAt: b.canceledAt || null,
    operator: !!isOperator,
    // There is no payment processor wired to this deploy. Saying so in the
    // payload keeps the client from rendering a checkout button that would
    // have nothing to call.
    checkout: "not-configured",
    features: FEATURES,
    labels: TIER_LABEL
  };
}
