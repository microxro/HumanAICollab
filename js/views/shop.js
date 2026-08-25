/* ==========================================================================
   views/shop.js — earn study tokens from a photo of your work, spend them on
   how Scholar looks.

   Two tabs on one screen, because they are two halves of the same loop: what
   you did, and what it bought. The economy itself (what a photo is worth, why
   a photo was refused, what is for sale) lives in js/shop.js — this file is
   the screen.
   ========================================================================== */

App.views.shop = (function () {
  const U = App.utils, S = App.store, UI = App.ui, SH = App.shop;

  let tab = "earn";

  /* ------------------------------------------------------------ helpers -- */

  function tokenPill(n, big) {
    return `<span class="token-pill${big ? " lg" : ""}"><span class="tk" aria-hidden="true">◉</span>
      ${U.esc(String(n))} <span class="sr-only">tokens</span></span>`;
  }

  function statusLine() {
    const wait = SH.cooldownLeft();
    const left = SH.remainingToday();
    if (wait > 0) return { kind: "warn", text: `Next photo in ${wait} minute${wait === 1 ? "" : "s"}.` };
    if (left === 0) return { kind: "warn", text: `You've hit today's ${SH.RULES.dailyCap}-token cap. Photos still log as study time.` };
    return { kind: "ok", text: `${left} token${left === 1 ? "" : "s"} still available today.` };
  }

  /* -------------------------------------------------------- earning form -- */

  function proofForm() {
    const rules = SH.RULES;
    const q0 = SH.quote(30);

    UI.modal({
      title: "Log a study photo",
      sub: "A photo of the work, and how long it took",
      size: "wide",
      okLabel: "Earn tokens",
      body: `
        <label class="proof-drop" data-drop>
          <span class="ico" aria-hidden="true">📷</span>
          <span class="bold small">Take a photo, or choose one</span>
          <span class="tiny dim">The page you worked, the notes you wrote, the problems you finished.</span>
          <input type="file" accept="image/*" data-proof-file
                 aria-label="Photo of the work you did" />
        </label>

        <div class="mt-12" data-preview-wrap hidden>
          <img class="proof-preview" alt="The photo you chose" data-preview />
          <div class="tiny dim mt-4" data-preview-note></div>
        </div>

        <div class="form-grid mt-16">
          <div class="field">
            <label for="proofMinutes">Minutes studied</label>
            <!-- step="1", not 5: a student who studied 41 minutes types 41, and a
                 stepMismatch rejects it with a browser message about a value
                 that was perfectly reasonable. -->
            <input class="input" type="number" id="proofMinutes" name="minutes"
                   min="${rules.minMinutes}" max="${rules.maxMinutes}" step="1" value="30" required />
            <span class="hint">${rules.minMinutes}–${rules.maxMinutes}. One token per ${rules.minutesPerToken} minutes,
              up to ${rules.maxPerProof} per photo.</span>
          </div>
          <div class="field">
            <label for="proofClass">Class</label>
            <select class="select" id="proofClass" name="classId">${UI.classOptions(null, true)}</select>
          </div>
          <div class="field full">
            <label for="proofNote">What did you do?</label>
            <input class="input" id="proofNote" name="note" maxlength="240"
                   placeholder="Finished the integration worksheet, questions 1–20" />
          </div>
        </div>

        <div class="row gap-8 mt-12" data-quote>
          <span class="small dim">This photo is worth</span> ${tokenPill(q0.total)}
        </div>

        <p class="proof-error small mt-12" data-proof-error hidden role="alert"></p>`,

      onMount(root) {
        const file = root.querySelector("[data-proof-file]");
        const drop = root.querySelector("[data-drop]");
        const wrap = root.querySelector("[data-preview-wrap]");
        const img = root.querySelector("[data-preview]");
        const note = root.querySelector("[data-preview-note]");
        const err = root.querySelector("[data-proof-error]");
        const minutes = root.querySelector("#proofMinutes");
        const quoteBox = root.querySelector("[data-quote]");

        const showError = (msg) => {
          err.textContent = msg;
          err.hidden = false;
        };
        const clearError = () => { err.hidden = true; err.textContent = ""; };

        const paintQuote = () => {
          const q = SH.quote(minutes.value);
          const why = q.total === 0
            ? `<span class="small dim">— nothing left in today's cap, but it still logs as study time.</span>`
            : q.bonus
              ? `<span class="small dim">(${q.base} for the time + ${q.bonus} for the first photo today)</span>`
              : q.capped
                ? `<span class="small dim">(trimmed to what's left of today's cap)</span>`
                : "";
          quoteBox.innerHTML = `<span class="small dim">This photo is worth</span> ${tokenPill(q.total)} ${why}`;
        };
        minutes.addEventListener("input", paintQuote);

        // Reading the photo here (rather than only on submit) means a
        // duplicate or a blank frame is caught while the file picker is still
        // fresh in mind, not after filling in the rest of the form.
        //
        // `seq` is why: picking a second photo before the first has finished
        // decoding leaves two inspections in flight, and the slower one is not
        // necessarily the older one. Without this, a stale result can label
        // the photo on screen with the verdict of one that was replaced.
        let seq = 0;
        const take = (f) => {
          if (!f) return;
          const mine = ++seq;
          clearError();
          note.textContent = "Checking the photo…";
          wrap.hidden = false;
          SH.inspect(f).then((info) => {
            if (mine !== seq) return;
            img.src = URL.createObjectURL(info.blob);
            img.onload = () => URL.revokeObjectURL(img.src);
            if (info.blank) {
              note.textContent = "";
              showError("That photo is almost entirely one flat colour — photograph the actual work.");
            } else if (info.duplicate) {
              note.textContent = "";
              showError("You've already earned tokens for this photo. Take a new one of what you did this time.");
            } else {
              note.textContent = `${info.width}×${info.height}, stored on this device only.`;
            }
          }).catch((e) => {
            if (mine !== seq) return;
            wrap.hidden = true;
            showError(e.message || "That image couldn't be read.");
          });
        };

        file.addEventListener("change", () => take(file.files && file.files[0]));

        ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => {
          e.preventDefault();
          drop.classList.add("drag");
        }));
        ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => {
          e.preventDefault();
          drop.classList.remove("drag");
        }));
        drop.addEventListener("drop", (e) => {
          const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
          if (!f) return;
          // Put it on the input too, so a submit after a drag sees the file.
          try { file.files = e.dataTransfer.files; } catch (_) { /* older browsers */ }
          take(f);
        });

        paintQuote();
      },

      onSubmit(d, root) {
        const input = root.querySelector("[data-proof-file]");
        const err = root.querySelector("[data-proof-error]");
        const f = input && input.files && input.files[0];
        if (!f) {
          err.textContent = "Add a photo first — that is the part that earns the tokens.";
          err.hidden = false;
          return false;
        }
        err.hidden = true;

        const btn = root.querySelector('button[type="submit"]');
        UI.busy(btn, SH.submit({ file: f, minutes: d.minutes, classId: d.classId, note: d.note }))
          .then((res) => {
            UI.closeModal();
            if (res.awarded > 0) {
              UI.toast(`+${res.awarded} token${res.awarded === 1 ? "" : "s"} 🎉`,
                `${U.fmtDur(res.proof.minutes)} logged${res.proof.classId ? " to " + S.className(res.proof.classId) : ""}` +
                (res.capped ? " — trimmed by today's cap." : "."), "ok");
            } else {
              UI.toast("Logged, no tokens",
                `Today's ${SH.RULES.dailyCap}-token cap is reached, but the study time still counts.`);
            }
            App.router.refresh();
          })
          .catch((e) => {
            err.textContent = e.message || "That photo couldn't be saved.";
            err.hidden = false;
          });

        return false;   // the async path closes the modal itself
      }
    });
  }

  /** Full-size look at one proof, with the option to remove it. */
  function viewProof(id) {
    const p = SH.proofs().find((x) => x.id === id);
    if (!p) return;
    const c = S.cls(p.classId);

    UI.modal({
      title: U.fmtDate(p.date, "day"),
      sub: `${U.fmtDur(p.minutes)}${c ? " · " + c.name : ""} · earned ${p.tokens} token${p.tokens === 1 ? "" : "s"}`,
      size: "wide",
      body: `<img class="proof-preview" alt="Study photo from ${U.esc(U.fmtDate(p.date))}" data-full />
        ${p.note ? `<p class="small mt-12">${U.esc(p.note)}</p>` : ""}
        <p class="tiny dim mt-12">Deleting this removes the photo and its study session from this device.
          Tokens you already earned stay yours, and the photo still can't be submitted again.</p>`,
      footer: `<button type="button" class="btn btn-danger left" data-del-proof>Delete</button>
               <button type="button" class="btn" data-close>Close</button>`,
      onMount(root) {
        const img = root.querySelector("[data-full]");
        App.idb.dataUrl(p.photoId).then((src) => {
          if (src) img.src = src;
          else {
            img.replaceWith(Object.assign(document.createElement("div"), {
              className: "proof-thumb-missing",
              textContent: "That photo isn't stored on this device."
            }));
          }
        }).catch(() => {});

        root.querySelector("[data-del-proof]").addEventListener("click", () => {
          UI.closeModal();
          UI.confirm({
            title: "Delete this proof?",
            message: "The photo and its study session go. The tokens it earned stay.",
            okLabel: "Delete",
            danger: true,
            onConfirm() {
              SH.deleteProof(p.id);
              UI.toast("Proof deleted", "The tokens it earned are still yours.");
            }
          });
        });
      }
    });
  }

  /* ---------------------------------------------------------- purchasing -- */

  function buyItem(id) {
    const it = SH.item(id);
    if (!it) return;
    UI.confirm({
      title: `Buy ${it.name}?`,
      message: `${it.price} tokens of your ${SH.balance()}. It goes on straight away, and you can take it off any time without losing it.`,
      okLabel: `Buy for ${it.price}`,
      onConfirm() {
        const res = SH.buy(id);
        if (!res.ok) UI.toast("Not bought", res.error, "danger");
        else UI.toast(`${it.name} unlocked`, "Wearing it now.", "ok");
      }
    });
  }

  /* -------------------------------------------------------------- render -- */

  function proofCard(p) {
    const c = S.cls(p.classId);
    return `<div class="proof-card">
      <button class="proof-thumb" data-proof="${p.id}" data-thumb="${U.esc(p.photoId)}"
              aria-label="Open study photo from ${U.esc(U.fmtDate(p.date))}"></button>
      <div class="proof-meta">
        <div class="row between gap-6">
          <span class="small bold">${U.fmtDur(p.minutes)}</span>
          <span class="badge brand">+${p.tokens}</span>
        </div>
        <div class="tiny dim truncate">${U.esc(U.fmtDate(p.date, "day"))}${c ? " · " + U.esc(c.name) : ""}</div>
        ${p.note ? `<div class="tiny dim truncate">${U.esc(p.note)}</div>` : ""}
      </div>
    </div>`;
  }

  function preview(it) {
    if (it.kind === "title") {
      return `<div class="plate-preview"><span class="nameplate">${U.esc(it.value)}</span></div>`;
    }
    if (it.kind === "ring") {
      return `<div class="ring-preview" data-ring-preview="${U.esc(it.value)}">
        ${UI.avatar(S.profile.name || "You", S.profile.color)}
      </div>`;
    }
    return `<div class="shop-swatch">
      <span style="background:${U.esc(it.preview.a)}"></span>
      <span style="background:${U.esc(it.preview.b)}"></span>
    </div>`;
  }

  function itemCard(it) {
    const owned = SH.owns(it.id);
    const worn = SH.isEquipped(it.id);
    const afford = SH.balance() >= it.price;

    const action = !owned
      ? `<button class="btn btn-sm btn-primary" data-buy="${it.id}" ${afford ? "" : "disabled"}>
           ${afford ? `Buy · ${it.price}` : `${it.price} tokens`}
         </button>`
      : worn
        ? `<button class="btn btn-sm" data-unequip="${it.kind}">Take off</button>`
        : `<button class="btn btn-sm btn-primary" data-equip="${it.id}">Wear</button>`;

    return `<div class="shop-item${worn ? " worn" : owned ? " owned" : ""}">
      ${preview(it)}
      <div>
        <div class="row between gap-6">
          <span class="small bold">${U.esc(it.name)}</span>
          ${worn ? `<span class="badge brand">Wearing</span>`
            : owned ? `<span class="badge ok">Owned</span>` : tokenPill(it.price)}
        </div>
        <div class="tiny dim mt-4">${U.esc(it.blurb)}</div>
      </div>
      <div class="shop-foot">${action}</div>
    </div>`;
  }

  function earnTab() {
    const list = U.sortBy(SH.proofs(), (p) => p.at, true);
    const st = statusLine();
    const rules = SH.RULES;
    const week = U.sum(SH.proofs().filter((p) => p.date >= U.dateKey(U.addDays(new Date(), -6))), (p) => p.minutes);

    return `<div class="grid g-main">
      <div class="card">
        <div class="card-head">
          <div><h3>Show your work</h3><div class="sub">A photo, the minutes, and what you did</div></div>
          <span class="badge ${st.kind}">${U.esc(st.text)}</span>
        </div>
        <div class="card-body col gap-16">
          <button class="btn btn-primary btn-lg btn-block" data-add-proof>📷 Add a study photo</button>

          <div>
            <h4 class="mb-8">How it pays</h4>
            <ul class="earn-rules">
              <li>One token per ${rules.minutesPerToken} minutes you claim, up to ${rules.maxPerProof} for a single photo.</li>
              <li>+${rules.firstOfDayBonus} for the first photo of the day. ${rules.dailyCap} tokens is the daily ceiling.</li>
              <li>${rules.cooldownMin} minutes between photos.</li>
              <li>The same photo never pays twice — every one is fingerprinted before it counts,
                  and deleting it doesn't reset that.</li>
              <li>Every photo also lands in your study log, so it counts toward the heatmap and your weekly goal.</li>
            </ul>
          </div>

          <p class="tiny dim" style="margin:0">
            Photos stay on this device, in the same local storage as your class attachments — nothing is uploaded
            and nobody reviews them. This is a habit tracker you keep honest, not an exam invigilator.
          </p>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Your record</h3></div>
        <div class="card-body col gap-12">
          <div class="row between">
            <span class="small dim">Photos logged</span>
            <span class="bold nums">${SH.proofs().length}</span>
          </div>
          <div class="row between">
            <span class="small dim">Studied this way, last 7 days</span>
            <span class="bold nums">${U.fmtDur(week)}</span>
          </div>
          <div class="row between">
            <span class="small dim">Earned today</span>
            <span class="bold nums">${SH.earnedToday()} / ${rules.dailyCap}</span>
          </div>
          <div class="row between">
            <span class="small dim">Tokens spent</span>
            <span class="bold nums">${Math.max(0, Math.floor(SH.wallet().spent))}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head"><h3>Proof gallery</h3><span class="sub">${list.length} photo${list.length === 1 ? "" : "s"}</span></div>
      ${list.length
        ? `<div class="card-body"><div class="proof-grid">${list.map(proofCard).join("")}</div></div>`
        : UI.emptyState("studySessions", "No study photos yet",
            "Photograph what you worked on and it becomes tokens — and a record of the term you can scroll back through.",
            `<button class="btn btn-primary" data-add-proof>📷 Add your first photo</button>`)}
    </div>`;
  }

  function shopTab() {
    return SH.kinds().map((kind) => {
      const list = SH.items(kind);
      const ownedCount = list.filter((i) => SH.owns(i.id)).length;
      return `<div class="card mb-16">
        <div class="card-head">
          <h3>${U.esc(SH.kindLabel(kind))}</h3>
          <span class="sub">${ownedCount} of ${list.length} unlocked</span>
        </div>
        <div class="card-body"><div class="shop-grid">${list.map(itemCard).join("")}</div></div>
      </div>`;
    }).join("");
  }

  function render() {
    const bal = SH.balance();
    const w = SH.wallet();

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>${App.i18n.t("shop", "Study shop")}</h1>
          <div class="sub">Photograph the work you did, earn tokens, spend them on how Scholar looks.</div>
        </div>
        <div class="page-actions row gap-8">
          ${tokenPill(bal, true)}
          <button class="btn btn-primary" data-add-proof>📷 Add a study photo</button>
        </div>
      </div>

      <div class="grid g-4 mb-16">
        <div class="stat accent">
          <div class="stat-ico" aria-hidden="true">◉</div>
          <div class="stat-label">Balance</div>
          <div class="stat-value nums">${bal}</div>
          <div class="stat-foot">tokens to spend</div>
        </div>
        <div class="stat">
          <div class="stat-ico" aria-hidden="true">📷</div>
          <div class="stat-label">Earned all time</div>
          <div class="stat-value nums">${Math.max(0, Math.floor(w.earned))}</div>
          <div class="stat-foot">${U.plural(SH.proofs().length, "photo")}</div>
        </div>
        <div class="stat">
          <div class="stat-ico" aria-hidden="true">📅</div>
          <div class="stat-label">Earned today</div>
          <div class="stat-value nums">${SH.earnedToday()}</div>
          <div class="stat-foot">of ${SH.RULES.dailyCap} available</div>
        </div>
        <div class="stat">
          <div class="stat-ico" aria-hidden="true">✨</div>
          <div class="stat-label">Unlocked</div>
          <div class="stat-value nums">${w.owned.length}</div>
          <div class="stat-foot">of ${SH.CATALOG.length} items</div>
        </div>
      </div>

      <div class="tabs mb-16">
        <button class="tab ${tab === "earn" ? "active" : ""}"
                aria-pressed="${tab === "earn"}" data-tab="earn">Earn</button>
        <button class="tab ${tab === "shop" ? "active" : ""}"
                aria-pressed="${tab === "shop"}" data-tab="shop">Shop</button>
      </div>

      ${tab === "earn" ? earnTab() : shopTab()}
    </div>`;
  }

  function mount(root) {
    U.on(root, "click", "[data-tab]", (_e, el) => {
      tab = el.dataset.tab;
      App.router.refresh();
    });
    U.on(root, "click", "[data-add-proof]", proofForm);
    U.on(root, "click", "[data-proof]", (_e, el) => viewProof(el.dataset.proof));
    U.on(root, "click", "[data-buy]", (_e, el) => buyItem(el.dataset.buy));
    U.on(root, "click", "[data-equip]", (_e, el) => {
      const it = SH.item(el.dataset.equip);
      if (SH.equip(el.dataset.equip)) UI.toast(`${it.name} on`, "", "ok");
    });
    U.on(root, "click", "[data-unequip]", (_e, el) => {
      const kind = el.dataset.unequip;
      const it = SH.equipped(kind);
      SH.unequip(kind);
      UI.toast(`${it ? it.name : SH.kindLabel(kind)} off`, "It stays in your collection.");
    });

    // Thumbnails live in IndexedDB, so they're fetched after the markup is in
    // place — same pattern as class cover images. The image goes *inside* the
    // button rather than replacing it, so the delegated [data-proof] handler
    // above keeps working and the photo stays keyboard-reachable.
    const fillThumb = (el) => {
      App.idb.dataUrl(el.dataset.thumb).then((src) => {
        if (src) {
          const img = document.createElement("img");
          img.alt = "";
          img.src = src;
          el.appendChild(img);
        } else {
          // The blob is gone (cleared site data, or a backup opened on a
          // different device). The record is still true, so say that rather
          // than showing an empty frame.
          el.classList.add("proof-thumb-missing");
          el.textContent = "Photo isn't on this device";
        }
      }).catch(() => {});
    };
    U.$$("[data-thumb]", root).forEach(fillThumb);
  }

  return { render, mount, proofForm, viewProof, title: "Study shop" };
})();
