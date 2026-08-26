/* ==========================================================================
   views/plans.js — F156 the pricing screen

   Three things this screen refuses to do, all of them deliberate:

     • no checkout button. Nothing on this deploy takes a payment, and a
       button that opened a card form going nowhere would be the dishonest
       part of an otherwise honest feature.
     • no dark pattern on the way out. Cancel is one button, it says exactly
       what happens, and what happens is immediate.
     • no pretending the free tier is a trial. Everything that runs on the
       device is Basic and stays there; the screen says which side of that
       line each feature is on rather than leaving it to be discovered.
   ========================================================================== */

App.views.plans = (function () {
  const U = App.utils, S = App.store, UI = App.ui, P = App.plans;

  /* ------------------------------------------------------------ sections */

  function tierCard(t) {
    const current = P.plan() === t.id;
    const rank = P.RANK[t.id] || 0;
    const mine = P.RANK[P.plan()] || 0;
    const included = rank <= mine;

    return `<div class="card plan-card${current ? " current" : ""}">
      <div class="card-body col gap-12">
        <div class="between">
          <div>
            <h3>${U.esc(t.name)}</h3>
            <div class="tiny dim mt-4">${U.esc(t.tagline)}</div>
          </div>
          ${current ? `<span class="badge brand">Your plan</span>`
            : included ? `<span class="badge ok">Included</span>` : ""}
        </div>

        <div class="plan-price">${U.esc(t.price)}</div>

        <ul class="plan-list">
          ${t.includes.map((line) => `<li>${U.esc(line)}</li>`).join("")}
        </ul>

        <div class="mt-auto">
          ${current
            ? (t.id === "basic"
                ? `<p class="tiny dim" style="margin:0">Nothing to pay, nothing to cancel.</p>`
                : `<button class="btn btn-block" data-cancel>Cancel — back to Basic</button>`)
            : rank > mine
              ? `<p class="tiny dim" style="margin:0">Not available to buy from inside the app on this deploy.</p>`
              : `<p class="tiny dim" style="margin:0">Already covered by your plan.</p>`}
        </div>
      </div>
    </div>`;
  }

  /** What the account is on right now, and what that means today. */
  function statusCard() {
    const p = P.plan();
    const t = P.tier(p);
    const ends = P.until();
    const info = P.info();

    return `<div class="card mb-16">
      <div class="card-body">
        <div class="between wrap gap-12">
          <div>
            <div class="small dim">Current plan</div>
            <div class="row gap-8 mt-4">
              <span class="stat-value" style="font-size:1.5rem">${U.esc(t ? t.name : "Basic")}</span>
              ${info.operator ? `<span class="badge">Deploy operator</span>` : ""}
            </div>
            <div class="tiny dim mt-4">
              ${ends ? `Runs until ${U.esc(ends)}.`
                : info.canceledAt ? `Cancelled ${U.esc(U.fmtDate(U.dateKey(new Date(Number(info.canceledAt)))))}.`
                : p === "basic" ? "Free, and everything on this device works."
                : "No end date set."}
            </div>
          </div>
          <div class="row gap-8">
            <button class="btn btn-sm" data-recheck>Check again</button>
            ${p !== "basic" ? `<button class="btn btn-sm" data-cancel>Cancel plan</button>` : ""}
          </div>
        </div>
      </div>
    </div>`;
  }

  /** The honest note about there being no way to pay. */
  function checkoutNote() {
    return `<div class="card mb-16">
      <div class="card-body">
        <h3 class="mb-8">How to actually get one</h3>
        <p class="small muted">
          There is no checkout on this deploy — no card form, no payment processor, nothing in this
          codebase that charges anyone. Plans are set by whoever runs the deploy
          (the account named in <code>ADMIN_EMAIL</code>), and cancelling is self-serve and immediate.
        </p>
        <p class="small muted mt-8">
          If you run this deploy, the panel below sets a plan on any account by email. If you don't,
          ask whoever does.
        </p>
      </div>
    </div>`;
  }

  /** Operator-only: set someone's tier. This is where a processor would hook in. */
  function operatorCard() {
    if (!P.isOperator()) return "";
    return `<div class="card mb-16">
      <div class="card-head">
        <div><h3>Set a plan</h3><div class="sub">You're the account in ADMIN_EMAIL</div></div>
      </div>
      <div class="card-body">
        <div class="form-grid">
          <div class="field">
            <label for="grantEmail">Account email</label>
            <input class="input" id="grantEmail" type="email" placeholder="student@school.edu" />
          </div>
          <div class="field">
            <label for="grantTier">Plan</label>
            <select class="select" id="grantTier">
              ${P.tiers().map((t) => `<option value="${t.id}">${U.esc(t.name)}</option>`).join("")}
            </select>
          </div>
          <div class="field full">
            <label for="grantUntil">Ends on <span class="dim">(optional — leave empty for no end date)</span></label>
            <input class="input" id="grantUntil" type="date" />
          </div>
        </div>
        <div class="row gap-8 mt-12">
          <button class="btn btn-primary" data-grant>Set plan</button>
          <span class="tiny dim" data-grant-result></span>
        </div>
        <p class="tiny dim mt-12">
          A real subscription would call this same route from a payment provider's webhook.
          Until one exists, this is the only way a plan changes upward — which is why the
          server refuses to enforce tiers at all when ADMIN_EMAIL is unset.
        </p>
      </div>
    </div>`;
  }

  /** What every tier gates, in one table, so nothing is discovered by surprise. */
  function matrix() {
    const rows = [
      ["Everything on this device", "basic", "Classes, homework, grades, timetable, planner, focus timer, flashcards, notes, guidance, activities, the study shop"],
      ["Pulling your data down", "basic", "Always available, on any plan, including after cancelling"],
      ["Syncing this device up", "premium", "Pushing your state to the account"],
      ["Parent portal", "premium", "Linking a guardian, live status, the weekly digest"],
      ["Study groups", "premium", "Creating or joining; shared decks, the homework feed, tasks"],
      ["AI features", "ultra", "The assistant, Add with AI, add from a link"],
      ["API and webhooks", "ultra", "Personal tokens, the read-only /v1 surface, outbound hooks"]
    ];
    return `<div class="card">
      <div class="card-head"><h3>What sits where</h3></div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Feature</th><th>Tier</th><th>Detail</th></tr></thead>
          <tbody>
            ${rows.map(([what, tierId, detail]) => {
              const have = (P.RANK[P.plan()] || 0) >= (P.RANK[tierId] || 0);
              return `<tr>
                <td class="bold">${U.esc(what)}</td>
                <td><span class="badge ${have ? "ok" : ""}">${U.esc(P.label(tierId))}</span></td>
                <td class="small muted">${U.esc(detail)}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  /* -------------------------------------------------------------- states */

  /** Signed out, or a deploy with no backend, or plans simply not turned on. */
  function offState() {
    const signedIn = App.sync && App.sync.isSignedIn();
    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>Plans</h1>
          <div class="sub">Everything is unlocked on this deploy.</div>
        </div>
        <div class="page-actions">
          <button class="btn" data-recheck>Check again</button>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-body">
          <h3 class="mb-8">No paid tiers here</h3>
          <p class="small muted">
            ${signedIn
              ? `This deploy doesn't run paid plans, so every account gets everything — sync, the parent
                 portal, study groups, the AI features and the API.`
              : `Plans apply to an account. You're not signed in, so nothing is gated: the whole app
                 runs on this device, offline, for free.`}
          </p>
          <p class="small muted mt-8">
            Whoever runs the deploy turns tiers on by setting <code>SCHOLAR_PLANS=on</code> (and
            <code>ADMIN_EMAIL</code>, since plans are granted by the operator). With it unset — the
            default — the tier system is inert and this screen has nothing to sell.
          </p>
        </div>
      </div>

      ${matrix()}
    </div>`;
  }

  function render() {
    if (!P.enabled()) return offState();

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>Plans</h1>
          <div class="sub">What's free forever, what the server charges for, and how to stop paying.</div>
        </div>
      </div>

      ${statusCard()}

      <div class="grid g-3 mb-16">
        ${P.tiers().map(tierCard).join("")}
      </div>

      ${checkoutNote()}
      ${operatorCard()}
      ${matrix()}
    </div>`;
  }

  /* --------------------------------------------------------------- mount */

  function cancelFlow() {
    const from = P.label(P.plan());
    UI.confirm({
      title: `Cancel ${from}?`,
      message: "You drop to Basic straight away. Nothing is deleted — every screen on this device "
             + "keeps working, and you can still pull your data down from the server whenever you want. "
             + "Uploading new changes stops until you're on a paid plan again.",
      okLabel: "Cancel my plan",
      onConfirm() {
        P.cancel()
          .then(() => {
            UI.toast("Cancelled", "You're on Basic. Nothing was deleted.", "ok");
            App.router.refresh();
          })
          .catch((e) => UI.toast("Couldn't cancel", e.message, "danger"));
      }
    });
  }

  function mount(root) {
    U.on(root, "click", "[data-recheck]", (_e, el) => {
      UI.busy(el, P.refresh().then(() => {
        App.router.refresh();
        UI.toast("Plan re-checked", P.enabled() ? `You're on ${P.label(P.plan())}.` : "This deploy has no paid tiers.");
      }));
    });

    U.on(root, "click", "[data-cancel]", cancelFlow);

    U.on(root, "click", "[data-grant]", (_e, el) => {
      const email = (root.querySelector("#grantEmail") || {}).value || "";
      const tierId = (root.querySelector("#grantTier") || {}).value || "basic";
      const dateStr = (root.querySelector("#grantUntil") || {}).value || "";
      const out = root.querySelector("[data-grant-result]");
      // A date input gives a local midnight; the server wants a moment in
      // time and refuses anything already past.
      const untilMs = dateStr ? U.parseDate(dateStr).getTime() + 24 * 60 * 60 * 1000 - 1 : null;

      if (!email.trim()) {
        if (out) out.textContent = "Enter the account's email address.";
        return;
      }
      if (out) out.textContent = "";
      UI.busy(el, P.grant(email.trim(), tierId, untilMs)
        .then((res) => {
          UI.toast("Plan set", `${res.account.email} is on ${P.label(res.account.plan)}.`, "ok");
          App.router.refresh();
        })
        .catch((e) => {
          if (out) out.textContent = e.message;
          UI.toast("Couldn't set that plan", e.message, "danger");
        }));
    });
  }

  return { render, mount, title: "Plans" };
})();
