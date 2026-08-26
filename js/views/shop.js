/* ==========================================================================
   views/shop.js — the token shop

   Four tiers, cheapest first, each a section of cards: Common, Rare, Ultra,
   Elite. The wallet, what you're wearing, and how tokens are earned are all
   on this screen too, because "how do I get more?" is the first question the
   shop raises and sending someone to a docs page to answer it is a bad joke.
   ========================================================================== */

App.views.shop = (function () {
  const U = App.utils, S = App.store, UI = App.ui;
  const SHOP = App.shop;

  let tab = "shop";   // shop | owned | earn

  /* -------------------------------------------------------------- wallet */

  function walletCard() {
    const bal = SHOP.balance();
    const w = SHOP.wallet();
    const boost = SHOP.activeBoost();
    const aff = SHOP.affordability();

    return `<div class="hero mb-16">
      <div class="between wrap gap-16">
        <div style="min-width:0">
          <div class="hero-eyebrow">Your wallet</div>
          <div style="font-size:2.1rem;font-weight:760;line-height:1.1">
            <span aria-hidden="true">🪙</span> ${U.esc(String(bal))}
            <span style="font-size:1rem;font-weight:600;opacity:.85">tokens</span>
          </div>
          <div class="hero-sub">
            ${U.esc(String(w.earnedTotal || 0))} earned all-time · ${U.esc(String(w.spentTotal || 0))} spent
          </div>
        </div>
        <div class="col gap-6" style="align-items:flex-end;flex-shrink:0">
          ${boost ? `<span class="badge solid">✖️ ${boost.mult}× until ${U.esc(new Date(boost.until).toLocaleString())}</span>` : ""}
          <span class="tiny" style="opacity:.9">
            ${aff.affordable} item${aff.affordable === 1 ? "" : "s"} you can buy right now
          </span>
          ${aff.next ? `<span class="tiny" style="opacity:.9">
            Next up: ${U.esc(aff.next.name)} — ${aff.shortBy} to go</span>` : ""}
        </div>
      </div>
    </div>`;
  }

  /* ------------------------------------------------------------- an item */

  function itemCard(it) {
    const owned = SHOP.owns(it.id);
    const count = SHOP.ownedCount(it.id);
    const worn = it.slot && (S.db.equipped || {})[it.slot] === it.id;
    const usingAlarm = it.alarm && S.settings.pomodoro.alarm === it.alarm;
    const afford = SHOP.balance() >= it.price;

    // What the buy button says has to be honest about which of the four
    // states this is: worn, owned, affordable, or short by N.
    let action;
    if (it.consumable) {
      action = `<button class="btn btn-sm ${afford ? "btn-primary" : ""}" data-buy="${U.esc(it.id)}"
                  ${afford ? "" : "disabled"}>${afford ? "Buy" : `Need ${it.price - SHOP.balance()}`}</button>`;
    } else if (worn || usingAlarm) {
      action = `<span class="badge ok">✓ Equipped</span>`;
    } else if (owned) {
      action = `<button class="btn btn-sm" data-equip="${U.esc(it.id)}">Equip</button>`;
    } else {
      action = `<button class="btn btn-sm ${afford ? "btn-primary" : ""}" data-buy="${U.esc(it.id)}"
                  ${afford ? "" : "disabled"}>${afford ? "Buy" : `Need ${it.price - SHOP.balance()}`}</button>`;
    }

    return `<div class="card shop-card tier-${U.esc(it.tier)}">
      <div class="card-body col gap-8">
        <div class="row gap-10" style="align-items:flex-start">
          <span class="shop-icon" aria-hidden="true">${it.icon}</span>
          <span class="grow" style="min-width:0">
            <div class="bold truncate">${U.esc(it.name)}</div>
            <div class="tiny dim">${U.esc(SHOP.TIERS[it.tier].label)}${count > 1 ? ` · owned ×${count}` : ""}</div>
          </span>
          <span class="shop-price badge">🪙 ${it.price}</span>
        </div>
        <p class="small muted" style="margin:0">${U.esc(it.desc)}</p>
        <div class="row gap-6" style="align-items:center">
          ${action}
          ${it.alarm ? `<button class="btn btn-sm" data-hear="${U.esc(it.alarm)}" title="Hear it">▶ Hear it</button>` : ""}
        </div>
      </div>
    </div>`;
  }

  function tierSection(tier) {
    const list = SHOP.byTier(tier.key);
    const ownedN = list.filter((i) => SHOP.owns(i.id)).length;
    return `<section class="mb-16">
      <div class="between wrap gap-8 mb-8">
        <div>
          <h3 class="tier-head tier-${U.esc(tier.key)}">
            <span aria-hidden="true">${tier.glyph}</span> ${U.esc(tier.label)}
          </h3>
          <div class="tiny dim">${U.esc(tier.blurb)}</div>
        </div>
        <span class="badge">${ownedN} / ${list.length} owned</span>
      </div>
      <div class="grid g-3">${list.map(itemCard).join("")}</div>
    </section>`;
  }

  /* -------------------------------------------------------------- owned */

  function ownedTab() {
    const slots = [
      ["theme", "Accent"], ["frame", "Avatar frame"],
      ["title", "Title"], ["sticker", "Sticker"], ["banner", "Dashboard banner"]
    ];
    const inv = (S.db.inventory || []).map((r) => SHOP.item(r.id)).filter(Boolean);
    const uniq = [];
    inv.forEach((it) => { if (!uniq.some((x) => x.id === it.id)) uniq.push(it); });

    return `<div class="card mb-16">
        <div class="card-head"><h3>Equipped</h3><span class="sub">One per slot — click to take it off</span></div>
        <div class="card-body col gap-10">
          ${slots.map(([slot, label]) => {
            const it = SHOP.equipped(slot);
            return `<div class="between" style="padding:8px 0;border-bottom:1px solid var(--border)">
              <div><div class="bold small">${U.esc(label)}</div>
                <div class="tiny dim">${it ? U.esc(it.name) : "Nothing equipped"}</div></div>
              ${it ? `<button class="btn btn-sm" data-unequip="${U.esc(slot)}">Take off</button>`
                   : `<span class="tiny dim">—</span>`}
            </div>`;
          }).join("")}
          <div class="between" style="padding:8px 0">
            <div><div class="bold small">Alarm voice</div>
              <div class="tiny dim">${U.esc(App.sound.voices()[S.settings.pomodoro.alarm] ? App.sound.voices()[S.settings.pomodoro.alarm].label : "Chime")}</div></div>
            <button class="btn btn-sm" data-go="focus">Change in the timer</button>
          </div>
        </div>
      </div>

      ${uniq.length ? `<div class="grid g-3">${uniq.map(itemCard).join("")}</div>`
        : UI.emptyState("shopOwned", "You haven't bought anything yet",
            "Everything in the shop is earned by studying — start a focus block and come back.",
            `<button class="btn btn-primary" data-shop-tab="shop">Browse the shop</button>`)}`;
  }

  /* --------------------------------------------------------------- earn */

  function earnTab() {
    const R = SHOP.RATES;
    const rows = [
      ["A minute of focus", `${R.focusPerMin} each`, "Runs while the timer runs — a 25-minute block is " + (R.focusPerMin * 25 + R.focusBlockBonus) + " with the completion bonus."],
      ["Finishing a focus block", `+${R.focusBlockBonus}`, "Only for a block you let run to the end, not one you skip."],
      ["Completing an assignment", `${R.assignmentDone}`, "Paid once per assignment, the first time it's marked done."],
      ["…and it wasn't late", `+${R.assignmentEarly}`, "On or before the due date."],
      ["Keeping your streak", `${R.streakDay}/day`, `Plus ${R.streakWeekBonus} every seventh day.`],
      ["Reviewing flashcards", `${R.flashcardCard}/card`, "Paid once at the end of a session."],
      ["A reading session", `${R.readingSession}`, "When you log pages read."],
      ["Ticking a habit", `${R.habitCheck}`, "Today's box only, once per day."],
      ["Reaching a goal", `${R.goalComplete}`, "Once per goal, when it hits its target."]
    ];

    return `<div class="card mb-16">
      <div class="card-head"><h3>How tokens are earned</h3>
        <span class="sub">Only from work the app already tracks</span></div>
      <div class="list">
        ${rows.map(([what, rate, note]) => `<div class="list-item">
          <span class="grow"><div class="title">${U.esc(what)}</div>
            <div class="meta">${U.esc(note)}</div></span>
          <span class="badge ok">🪙 ${U.esc(rate)}</span>
        </div>`).join("")}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Recent activity</h3>
        <button class="btn btn-sm" data-shop-tab="shop">Spend them</button></div>
      ${SHOP.ledger(20).length ? `<div class="list">
        ${SHOP.ledger(20).map((e) => `<div class="list-item">
          <span class="grow"><div class="title">${U.esc(e.reason)}</div>
            <div class="meta">${U.esc(new Date(e.at).toLocaleString())}${e.mult ? ` · ${e.mult}× boost` : ""}</div></span>
          <span class="badge ${e.n >= 0 ? "ok" : ""}">${e.n >= 0 ? "+" : ""}${e.n}</span>
        </div>`).join("")}</div>`
        : `<div class="card-body"><p class="dim small">Nothing yet — finish a focus block and this fills in.</p></div>`}
    </div>`;
  }

  /* ------------------------------------------------------------- render */

  function render() {
    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>${App.i18n.t("shop", "Token shop")}</h1>
          <div class="sub">Earn tokens by studying, spend them on how the app looks and sounds</div>
        </div>
        <div class="page-actions">
          <div class="segmented">
            <button class="${tab === "shop" ? "active" : ""}" data-shop-tab="shop">Shop</button>
            <button class="${tab === "owned" ? "active" : ""}" data-shop-tab="owned">Yours</button>
            <button class="${tab === "earn" ? "active" : ""}" data-shop-tab="earn">Earn</button>
          </div>
        </div>
      </div>

      ${walletCard()}

      ${tab === "shop" ? SHOP.tiers().map(tierSection).join("")
        : tab === "owned" ? ownedTab()
        : earnTab()}
    </div>`;
  }

  /* -------------------------------------------------------------- mount */

  function buy(id) {
    const it = SHOP.item(id);
    if (!it) return;
    UI.confirm({
      title: `Buy ${it.name}?`,
      message: `${it.desc}\n\nThis costs ${it.price} tokens. You'll have ${SHOP.balance() - it.price} left.`,
      okLabel: `Buy for ${it.price}`,
      onConfirm() {
        const res = SHOP.buy(id);
        if (!res.ok) { UI.toast("Couldn't buy that", res.message, "warn"); return; }
        UI.toast(`${it.icon} ${it.name}`,
          it.consumable ? "Applied." : "Bought and equipped.", "ok");
        App.router.refresh();
      }
    });
  }

  function mount(root) {
    U.on(root, "click", "[data-shop-tab]", (_e, el) => { tab = el.dataset.shopTab; App.router.refresh(); });
    U.on(root, "click", "[data-buy]", (_e, el) => buy(el.dataset.buy));
    U.on(root, "click", "[data-equip]", (_e, el) => {
      const it = SHOP.item(el.dataset.equip);
      if (SHOP.equip(el.dataset.equip)) {
        UI.toast("Equipped", it ? it.name : "", "ok");
        App.router.refresh();
      }
    });
    U.on(root, "click", "[data-unequip]", (_e, el) => {
      SHOP.unequip(el.dataset.unequip);
      UI.toast("Taken off");
      App.router.refresh();
    });
    U.on(root, "click", "[data-hear]", (_e, el) => {
      // The click itself is the gesture that opens the audio session, so a
      // preview always sounds — even on a page that hasn't played anything yet.
      App.sound.preview(el.dataset.hear);
    });
  }

  /** U51 — #shop/owned and #shop/earn address the tabs directly. */
  function openSub(id) {
    if (["shop", "owned", "earn"].indexOf(id) < 0) return false;
    tab = id;
    App.router.refresh();
    return true;
  }

  return { render, mount, openSub, title: "Token shop" };
})();
