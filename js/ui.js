/* ==========================================================================
   ui.js — modals, toasts, confirm dialogs, shared render fragments
   ========================================================================== */

App.ui = (function () {
  const U = App.utils;

  /* ------------------------------------------------------------ toasts -- */

  /**
   * toast(title, msg, kind, action)
   * `action` = { label, onClick } renders a button (used for Undo). Toasts
   * with an action stay up longer so there's time to hit it.
   */
  function toast(title, msg, kind, action) {
    let host = document.getElementById("toastHost");
    if (!host) {
      host = document.createElement("div");
      host.id = "toastHost";
      host.className = "toast-host";
      host.setAttribute("role", "status");
      host.setAttribute("aria-live", "polite");
      document.body.appendChild(host);
    }
    const el = document.createElement("div");
    el.className = "toast " + (kind || "");
    el.innerHTML = `<div class="grow">
        <div class="t-title">${U.esc(title)}</div>
        ${msg ? `<div class="t-msg">${U.esc(msg)}</div>` : ""}
      </div>
      ${action ? `<button class="btn btn-sm t-action">${U.esc(action.label)}</button>` : ""}`;
    host.appendChild(el);
    if (App.store && App.store.logNotification) App.store.logNotification(title, msg, kind);

    let dead = false;
    const kill = () => {
      if (dead) return;
      dead = true;
      el.classList.add("out");
      setTimeout(() => el.remove(), 200);
    };

    if (action) {
      el.querySelector(".t-action").addEventListener("click", () => {
        kill();
        action.onClick();
      });
    }
    setTimeout(kill, action ? 7000 : 3200);
    return kill;
  }

  /* --------------------------------------------------------- U25 undo -- */
  // A small LIFO of recent reversible actions. Any call site can push
  // { label, undo() } here to get Ctrl+Z support for free — deleteWithUndo
  // does it automatically, so every soft-delete in the app already qualifies.
  const undoStack = [];
  const UNDO_MAX = 20;
  function pushUndo(label, undo) {
    undoStack.push({ label, undo });
    if (undoStack.length > UNDO_MAX) undoStack.shift();
  }
  function popUndo() {
    const entry = undoStack.pop();
    if (!entry) return null;
    entry.undo();
    return entry.label;
  }

  /** Soft-delete with a one-tap Undo — the safety net for every destructive action. */
  function deleteWithUndo(coll, id, label) {
    const token = App.store.remove(coll, id);
    if (!token) return;
    const restore = () => App.store.restore(token);
    pushUndo(`Delete "${label || "item"}"`, restore);
    toast("Deleted", label || "", "warn", {
      label: "Undo",
      onClick() {
        restore();
        toast("Restored", label || "", "ok");
      }
    });
  }

  /* ------------------------------------------------------------ modals -- */

  let openModal = null;
  let lastFocused = null;   // U42 — where to return focus once every modal in the chain is closed
  // U04 — true while the *current* history entry carries our marker. A
  // programmatic close uses replaceState (synchronous, fires no popstate) to
  // relabel that entry rather than history.back() (async): back() would fire
  // our own popstate handler *after* JS has already moved on — e.g. a
  // `closeModal(); openNextThing()` pattern used throughout this codebase —
  // by which point openModal refers to the *new* modal, so the stale
  // popstate would close the wrong one. replaceState sidesteps the race
  // entirely, and keeps the back-button history from growing over a session.
  let modalMarked = false;

  // Tears down the current modal's DOM/listeners only — no focus restore.
  // Used internally when one modal replaces another mid-chain (edit -> confirm),
  // where restoring focus would be premature (a new modal is about to steal it).
  function removeModalNode() {
    if (!openModal) return;
    openModal.remove();
    openModal = null;
    document.removeEventListener("keydown", escClose);
    document.removeEventListener("keydown", trapFocus);
  }

  function closeModal() {
    if (!openModal) return;
    removeModalNode();
    if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
    lastFocused = null;
    if (modalMarked) { modalMarked = false; history.replaceState(null, "", location.href); }
  }

  // A real Back-button press (not our own closeModal) should close whatever
  // modal is open instead of leaving the app. `openModal`/`modalMarked` are
  // plain JS state carried over from before the navigation, so this reads
  // correctly regardless of what the new history entry itself contains.
  window.addEventListener("popstate", () => {
    if (!openModal || !modalMarked) return;
    modalMarked = false;
    removeModalNode();
    if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
    lastFocused = null;
  });

  function escClose(e) {
    if (e.key === "Escape") closeModal();
  }

  // U42 — Tab must not escape the dialog while it's open.
  function focusables(root) {
    return U.$$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', root)
      .filter((el) => el.offsetParent !== null);
  }
  function trapFocus(e) {
    if (e.key !== "Tab" || !openModal) return;
    const items = focusables(openModal);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /**
   * modal({ title, body, size, footer, onMount, onSubmit })
   * `body` is an HTML string. If `onSubmit` is given the body is wrapped in a
   * <form> and submitting calls onSubmit(formDataObject, modalEl).
   * Return false from onSubmit to keep the modal open.
   */
  function modal(opts) {
    // Only capture the trigger / push history on a fresh open — a modal
    // replacing another modal (edit -> confirm, etc.) is still one "session"
    // for U42 focus-return and U04 back-button purposes.
    if (!openModal) {
      lastFocused = document.activeElement;
      history.pushState({ scholarModal: true }, "", location.href);
      modalMarked = true;
    }
    removeModalNode();

    const root = document.createElement("div");
    root.className = "modal-root";
    const size = opts.size ? " " + opts.size : "";

    const footer = opts.footer != null ? opts.footer : `
      <button type="button" class="btn" data-close>Cancel</button>
      <button type="${opts.onSubmit ? "submit" : "button"}" class="btn btn-primary" ${opts.onSubmit ? "" : "data-close"}>
        ${U.esc(opts.okLabel || "Save")}
      </button>`;

    // U41 — every modal is a real dialog to assistive tech, not just visually.
    const titleId = U.uid("modalTitle");
    const inner = `
      <div class="modal-head">
        <div>
          <h3 id="${titleId}">${U.esc(opts.title || "")}</h3>
          ${opts.sub ? `<div class="sub small dim">${U.esc(opts.sub)}</div>` : ""}
        </div>
        <button type="button" class="icon-btn" data-close aria-label="Close">✕</button>
      </div>
      <div class="modal-body">${opts.body || ""}</div>
      <div class="modal-foot">${footer}</div>`;

    const dialogAttrs = `role="dialog" aria-modal="true" aria-labelledby="${titleId}"`;
    root.innerHTML = opts.onSubmit
      ? `<form class="modal${size}" novalidate ${dialogAttrs}>${inner}</form>`
      : `<div class="modal${size}" ${dialogAttrs}>${inner}</div>`;

    document.body.appendChild(root);
    openModal = root;

    root.addEventListener("click", (e) => {
      if (e.target === root || e.target.closest("[data-close]")) closeModal();
    });
    document.addEventListener("keydown", escClose);
    document.addEventListener("keydown", trapFocus);

    const form = root.querySelector("form");
    if (form && opts.onSubmit) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const data = {};
        U.$$("[name]", form).forEach((el) => {
          if (el.type === "checkbox") data[el.name] = el.checked;
          else if (el.type === "number") data[el.name] = el.value === "" ? null : Number(el.value);
          else data[el.name] = el.value;
        });
        if (opts.onSubmit(data, root) !== false) closeModal();
      });
    }

    const first = root.querySelector("input:not([type=hidden]), textarea, select");
    if (first) setTimeout(() => first.focus(), 40);

    if (opts.onMount) opts.onMount(root);
    return root;
  }

  function confirm(opts) {
    return modal({
      title: opts.title || "Are you sure?",
      size: "narrow",
      body: `<p class="muted">${U.esc(opts.message || "")}</p>`,
      footer: `<button type="button" class="btn" data-close>Cancel</button>
               <button type="button" class="btn ${opts.danger ? "btn-danger" : "btn-primary"}" data-ok>
                 ${U.esc(opts.okLabel || "Confirm")}
               </button>`,
      onMount(root) {
        let confirmed = false;
        root.querySelector("[data-ok]").addEventListener("click", () => {
          confirmed = true;
          closeModal();
          if (opts.onConfirm) opts.onConfirm();
        });
        // Cancel/dismiss is a real answer for either-or choices (sync conflicts).
        if (opts.onCancel) {
          root.addEventListener("click", (e) => {
            if (e.target === root || e.target.closest("[data-close]")) {
              setTimeout(() => { if (!confirmed) opts.onCancel(); }, 0);
            }
          });
        }
      }
    });
  }

  /**
   * U29 — for genuinely destructive actions (clearing all data, deleting an
   * account), a plain Cancel/Confirm is too easy to click through on
   * autopilot. Requires typing an exact phrase before the button enables.
   */
  function confirmTyped(opts) {
    const phrase = opts.phrase || "DELETE";
    return modal({
      title: opts.title || "Are you sure?",
      size: "narrow",
      body: `<p class="muted mb-12">${U.esc(opts.message || "")}</p>
        <div class="field">
          <label>Type <strong>${U.esc(phrase)}</strong> to confirm</label>
          <input class="input" id="typedConfirm" autocomplete="off" autofocus />
        </div>`,
      footer: `<button type="button" class="btn" data-close>Cancel</button>
               <button type="button" class="btn btn-danger" data-ok disabled>
                 ${U.esc(opts.okLabel || "Confirm")}
               </button>`,
      onMount(root) {
        const input = root.querySelector("#typedConfirm");
        const btn = root.querySelector("[data-ok]");
        input.addEventListener("input", () => { btn.disabled = input.value !== phrase; });
        btn.addEventListener("click", () => {
          if (input.value !== phrase) return;
          closeModal();
          if (opts.onConfirm) opts.onConfirm();
        });
      }
    });
  }

  function prompt(opts) {
    return modal({
      title: opts.title || "Enter a value",
      size: "narrow",
      okLabel: opts.okLabel || "Save",
      body: `<div class="field">
          ${opts.label ? `<label>${U.esc(opts.label)}</label>` : ""}
          <input class="input" name="value" value="${U.esc(opts.value || "")}"
                 placeholder="${U.esc(opts.placeholder || "")}" required />
        </div>`,
      onSubmit(d) {
        const v = (d.value || "").trim();
        if (!v) return false;
        if (opts.onSubmit) opts.onSubmit(v);
      }
    });
  }

  /* --------------------------------------------------- shared fragments -- */

  function avatar(name, color, size) {
    return `<span class="avatar${size ? " " + size : ""}" style="background:${U.esc(color || "#64748b")}">${U.esc(U.initials(name))}</span>`;
  }

  function emptyState(icon, title, sub, action) {
    return `<div class="empty">
      <div class="e-ico">${icon}</div>
      <div class="e-title">${U.esc(title)}</div>
      ${sub ? `<div class="e-sub">${U.esc(sub)}</div>` : ""}
      ${action || ""}
    </div>`;
  }

  function classOptions(selected, includeNone) {
    const opts = App.store.db.classes
      .map((c) => `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${U.esc(c.name)}</option>`)
      .join("");
    return (includeNone ? `<option value="" ${!selected ? "selected" : ""}>— None —</option>` : "") + opts;
  }

  function teacherOptions(selected, includeNone) {
    const opts = App.store.db.teachers
      .map((t) => `<option value="${t.id}" ${t.id === selected ? "selected" : ""}>${U.esc(t.name)}</option>`)
      .join("");
    return (includeNone ? `<option value="">— None —</option>` : "") + opts;
  }

  function colorPicker(name, selected) {
    return `<input type="hidden" name="${name}" value="${U.esc(selected || App.store.PALETTE[0])}" />
      <div class="swatches" data-swatches="${name}">
        ${App.store.PALETTE.map((c) => `
          <button type="button" class="swatch ${c === selected ? "active" : ""}"
                  style="background:${c}" data-color="${c}" aria-label="${c}"></button>`).join("")}
      </div>`;
  }

  // Wire up any colorPicker() blocks inside a container.
  function bindSwatches(root) {
    U.$$("[data-swatches]", root).forEach((box) => {
      const input = root.querySelector(`[name="${box.dataset.swatches}"]`);
      box.addEventListener("click", (e) => {
        const b = e.target.closest("[data-color]");
        if (!b) return;
        input.value = b.dataset.color;
        U.$$(".swatch", box).forEach((s) => s.classList.toggle("active", s === b));
      });
    });
  }

  function dayPicker(name, selected) {
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const sel = selected || [];
    return `<input type="hidden" name="${name}" value="${sel.join(",")}" />
      <div class="row wrap gap-6" data-days="${name}">
        ${days.map((d) => `
          <button type="button" class="chip ${sel.includes(d) ? "active" : ""}" data-day="${d}">${d}</button>`).join("")}
      </div>`;
  }

  function bindDays(root) {
    U.$$("[data-days]", root).forEach((box) => {
      const input = root.querySelector(`[name="${box.dataset.days}"]`);
      box.addEventListener("click", (e) => {
        const b = e.target.closest("[data-day]");
        if (!b) return;
        b.classList.toggle("active");
        const on = U.$$(".chip.active", box).map((c) => c.dataset.day);
        input.value = on.join(",");
      });
    });
  }

  function gradePill(pct, big) {
    if (pct == null) return `<span class="grade-pill${big ? " lg" : ""}">—</span>`;
    return `<span class="grade-pill ${U.gradeClass(pct)}${big ? " lg" : ""}">${U.round(pct, 1)}</span>`;
  }

  function priorityBadge(p) {
    const map = { high: ["danger", "High"], med: ["warn", "Medium"], low: ["", "Low"] };
    const [k, label] = map[p] || map.med;
    return `<span class="badge ${k}"><i class="prio ${p === "high" ? "high" : p === "low" ? "low" : "med"}"></i>${label}</span>`;
  }

  function dueBadge(iso) {
    const n = U.diffDays(iso, U.today());
    const kind = n < 0 ? "danger" : n === 0 ? "warn" : n <= 2 ? "info" : "";
    return `<span class="badge ${kind}">${U.esc(U.relDate(iso))}</span>`;
  }

  /* ------------------------------------------------ U21/U28 — flyout menu -- */
  // A small floating action menu anchored near a point — right-click for a
  // context menu, or a touch point for a mobile long-press quick-action menu.
  // Items: [{ label, icon, danger, run() }] or { divider: true }.

  let openMenu = null;
  function closeMenuNode() {
    if (!openMenu) return;
    openMenu.remove();
    openMenu = null;
    document.removeEventListener("click", onMenuOutside, true);
    document.removeEventListener("keydown", onMenuKey);
    document.removeEventListener("scroll", closeMenuNode, true);
  }
  function onMenuOutside(e) { if (openMenu && !openMenu.contains(e.target)) closeMenuNode(); }
  function onMenuKey(e) { if (e.key === "Escape") closeMenuNode(); }

  function menu(items, x, y) {
    closeMenuNode();
    const el = document.createElement("div");
    el.className = "ctx-menu";
    el.setAttribute("role", "menu");
    el.innerHTML = items.map((it, i) => it.divider
      ? `<div class="ctx-menu-sep"></div>`
      : `<button type="button" class="ctx-menu-item ${it.danger ? "danger" : ""}" data-i="${i}" role="menuitem">
           ${it.icon ? `<span class="ico">${it.icon}</span>` : ""}<span>${U.esc(it.label)}</span>
         </button>`).join("");
    document.body.appendChild(el);

    const vw = window.innerWidth, vh = window.innerHeight;
    const r = el.getBoundingClientRect();
    el.style.left = Math.max(8, Math.min(x, vw - r.width - 8)) + "px";
    el.style.top = Math.max(8, Math.min(y, vh - r.height - 8)) + "px";

    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-i]");
      if (!b) return;
      const it = items[Number(b.dataset.i)];
      closeMenuNode();
      if (it && it.run) it.run();
    });

    openMenu = el;
    setTimeout(() => {
      document.addEventListener("click", onMenuOutside, true);
      document.addEventListener("keydown", onMenuKey);
      document.addEventListener("scroll", closeMenuNode, true);
    }, 0);
    return el;
  }

  return {
    toast, deleteWithUndo, pushUndo, popUndo, modal, closeModal, confirm, confirmTyped, prompt,
    avatar, emptyState, classOptions, teacherOptions,
    colorPicker, bindSwatches, dayPicker, bindDays,
    gradePill, priorityBadge, dueBadge, menu
  };
})();
