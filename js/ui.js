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

  // Fired when the current modal goes away by any route the user controls —
  // the ✕, a scrim click, Escape, or the browser Back button. confirm()
  // depends on this: its cancel branch used to be wired only to a click, so
  // pressing Escape on a sync-conflict dialog answered neither way and left
  // sync stuck in "conflict" with the badge showing an error indefinitely.
  let pendingDismiss = null;

  function runDismiss() {
    const fn = pendingDismiss;
    pendingDismiss = null;
    if (fn) { try { fn(); } catch (e) { console.error("[ui] modal onDismiss failed", e); } }
  }

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
    runDismiss();
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
    runDismiss();
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

  /* ----------------------------------------------------- label wiring -- */

  const LABELABLE = "input:not([type=hidden]), select, textarea";

  /**
   * Associates every `<label>` with its control.
   *
   * The views write `<div class="field"><label>Class name</label><input …>`
   * about 230 times. That markup looks right and is not: with no `for` and no
   * wrapping, the label is decorative text. Clicking it doesn't focus the
   * field, and a screen reader announces "edit, blank". Fixing it in the
   * templates would mean 230 hand-edits and would rot the moment someone adds
   * a field, so it is done here — once, on every rendered subtree.
   *
   * Controls that carry their own aria-label, or that a label already wraps,
   * are left alone.
   */
  function associateLabels(root) {
    if (!root || !root.querySelectorAll) return;
    U.$$("label", root).forEach((label) => {
      if (label.hasAttribute("for")) return;
      if (label.hasAttribute("data-group-label")) return;
      if (label.querySelector(LABELABLE)) return;      // implicit association

      const field = label.closest(".field") || label.parentNode;
      if (!field || !field.querySelectorAll) return;

      // The first control after this label inside the same group.
      const controls = [...field.querySelectorAll(LABELABLE)];
      const target = controls.find((el) =>
        label.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);

      if (target) {
        if (!target.id) target.id = U.uid("f");
        label.setAttribute("for", target.id);
        return;
      }

      // No single control to point at. Some fields are a *set* of controls —
      // the day chips, the colour swatches — backed by a hidden input that
      // holds the value. `for` is the wrong mechanism there: the label names
      // the group, so mark the group and name it.
      const group = field.querySelector(".swatches, .row, .chips, .daypicker");
      if (!group) return;
      if (!label.id) label.id = U.uid("lbl");
      if (!group.hasAttribute("role")) group.setAttribute("role", "group");
      if (!group.hasAttribute("aria-labelledby")) group.setAttribute("aria-labelledby", label.id);
      // Marked so the sweep above doesn't keep reconsidering it.
      label.setAttribute("data-group-label", "");
    });

    // A control with neither a label nor an accessible name still needs one;
    // a placeholder is not a label, but it is better than nothing and it is
    // what the author meant.
    U.$$(LABELABLE, root).forEach((el) => {
      if (el.id && root.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return;
      if (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby")) return;
      if (el.closest("label")) return;
      const ph = el.getAttribute("placeholder");
      if (ph) el.setAttribute("aria-label", ph);
    });
  }

  /* -------------------------------------------------- keyboard activation -- */

  /**
   * Selectors for elements the app treats as buttons but renders as <div> or
   * <span>. Each is a real click target with a delegated handler behind it:
   * a calendar day, a note card, a class card, an assignment title.
   */
  const CLICK_TARGETS = [
    ".cal-day[data-day]", "[data-note]", ".card-link", ".tt-cell[data-class]",
    "[data-open]", "[data-open-hw]", "[data-suggest]", "[data-day-detail]"
  ].join(", ");

  const NATIVELY_FOCUSABLE = "a[href], button, input, select, textarea, summary, [tabindex]";

  /**
   * Makes those elements reachable and operable from a keyboard.
   *
   * Whole views were mouse-only: the calendar's 42-day grid could not be
   * entered at all, and notes, class cards and assignment titles could not be
   * opened without a pointer. Marking them here — rather than editing nine
   * view files and hoping the next one remembers — keeps it true for markup
   * that doesn't exist yet.
   */
  function makeActivatable(root) {
    if (!root || !root.querySelectorAll) return;
    U.$$(CLICK_TARGETS, root).forEach((el) => {
      if (el.matches(NATIVELY_FOCUSABLE)) return;      // already operable
      if (el.hasAttribute("data-activatable")) return;

      // A row that already contains its own controls — a done checkbox, Edit
      // and Delete buttons — must not also become a button itself. That is
      // the nested-interactive violation, and it makes the row a confusing
      // extra tab stop that swallows Space from the checkbox inside it. The
      // inner controls are the correct affordance; leave the row alone.
      if (el.querySelector(NATIVELY_FOCUSABLE)) return;

      el.setAttribute("data-activatable", "");
      el.setAttribute("tabindex", "0");
      if (!el.hasAttribute("role")) el.setAttribute("role", "button");
    });

    // A region that scrolls but can't be focused is unreachable without a
    // pointer: the timetable is 620px wide inside a narrower column, so a
    // keyboard user simply could not see Thursday or Friday. axe calls this
    // scrollable-region-focusable. Only mark regions that actually overflow,
    // so the tab order doesn't fill up with stops that do nothing.
    U.$$(".table-wrap, .scroll-x, .week-wrap, .board, .tl", root).forEach((el) => {
      if (el.hasAttribute("tabindex")) return;
      if (el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight) return;
      el.setAttribute("tabindex", "0");
      if (!el.hasAttribute("role")) el.setAttribute("role", "region");
      if (!el.hasAttribute("aria-label")) el.setAttribute("aria-label", "Scrollable content");
    });
  }

  /**
   * Enter and Space activate a marked element, matching a real button.
   * Bound once at the document, so it covers views and modals alike.
   */
  function bindActivationKeys() {
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
      const el = e.target.closest && e.target.closest("[data-activatable]");
      if (!el) return;
      // Don't hijack typing inside a control that happens to sit within one.
      if (e.target.matches && e.target.matches("input, textarea, select")) return;
      e.preventDefault();
      el.click();
    });
  }

  /* ------------------------------------------------------ in-flight guard -- */

  /**
   * Marks `el` busy for the life of `promise`, and swallows further clicks
   * while it runs.
   *
   * Several actions fire a network write straight from a click with nothing
   * disabling the control, so a double-click posted twice — two identical
   * feed items, two shared notes, two comments. Returns the promise so
   * callers keep chaining.
   */
  function busy(el, promise) {
    if (!el || !promise || typeof promise.then !== "function") return promise;
    if (el.dataset.busy === "1") return promise;
    el.dataset.busy = "1";
    el.setAttribute("aria-busy", "true");
    if ("disabled" in el) el.disabled = true;
    const done = () => {
      delete el.dataset.busy;
      el.removeAttribute("aria-busy");
      if ("disabled" in el) el.disabled = false;
    };
    return promise.then(
      (v) => { done(); return v; },
      (e) => { done(); throw e; }
    );
  }

  /* ------------------------------------------------- field-level errors -- */

  function clearFieldErrors(scope) {
    U.$$(".field-error", scope).forEach((n) => n.remove());
    U.$$("[aria-invalid]", scope).forEach((n) => {
      n.removeAttribute("aria-invalid");
      n.removeAttribute("aria-describedby");
    });
  }

  /** Puts a message next to the control and links it for screen readers. */
  function showFieldError(el, message) {
    const id = U.uid("err");
    const note = document.createElement("div");
    note.className = "field-error small";
    note.id = id;
    note.setAttribute("role", "alert");
    note.textContent = message;
    el.setAttribute("aria-invalid", "true");
    el.setAttribute("aria-describedby", id);
    (el.closest(".field") || el.parentNode).appendChild(note);
    // Clear as soon as they start fixing it, rather than leaving a stale
    // complaint under a field that is now correct.
    const clear = () => {
      note.remove();
      el.removeAttribute("aria-invalid");
      el.removeAttribute("aria-describedby");
      el.removeEventListener("input", clear);
      el.removeEventListener("change", clear);
    };
    el.addEventListener("input", clear);
    el.addEventListener("change", clear);
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
    // Replacing one modal with another (edit -> confirm) is not a dismissal.
    pendingDismiss = null;
    removeModalNode();
    pendingDismiss = typeof opts.onDismiss === "function" ? opts.onDismiss : null;

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
    // `novalidate` used to be set here, which quietly disabled every
    // `required`, `min`, `max`, `step` and `type="email"` attribute in the
    // whole application — hundreds of them, all decorative. Negative credits
    // zeroed the GPA, a 10000% category weight was accepted, and a blank
    // required field just made Save do nothing at all. Constraint validation
    // is on; the submit handler below reports the first offender.
    root.innerHTML = opts.onSubmit
      ? `<form class="modal${size}" ${dialogAttrs}>${inner}</form>`
      : `<div class="modal${size}" ${dialogAttrs}>${inner}</div>`;

    document.body.appendChild(root);
    openModal = root;

    root.addEventListener("click", (e) => {
      // Modals render outside .view-root, so the delegated handlers bound in
      // paint() never reach them. These two replace former inline onclick
      // attributes, which the CSP no longer permits.
      const sel = e.target.closest("[data-select-all]");
      if (sel && sel.select) sel.select();
      if (e.target.closest("[data-stop-propagation]")) e.stopPropagation();

      if (e.target === root || e.target.closest("[data-close]")) closeModal();
    });
    document.addEventListener("keydown", escClose);
    document.addEventListener("keydown", trapFocus);

    const form = root.querySelector("form");
    if (form && opts.onSubmit) {
      // `invalid` fires per control during constraint validation and does not
      // bubble, so this listens in the capture phase. preventDefault()
      // suppresses the browser's own bubble in favour of a message that sits
      // next to the field, is styled like the rest of the app, and is wired
      // to the control with aria-describedby so a screen reader reads it.
      let firstInvalid = null;
      form.addEventListener("invalid", (e) => {
        e.preventDefault();
        const el = e.target;
        // A control inside a collapsed section can't be fixed by the person
        // looking at the form; blocking Save on it with an unreachable
        // message would be worse than the problem.
        if (el.type === "hidden" || !el.getClientRects().length) return;
        if (!firstInvalid) firstInvalid = el;
        showFieldError(el, el.validationMessage || "Check this value.");
      }, true);

      form.addEventListener("submit", (e) => {
        e.preventDefault();
        clearFieldErrors(form);
        firstInvalid = null;

        if (!form.checkValidity()) {
          if (firstInvalid) firstInvalid.focus();
          return;                       // messages were rendered by the handler above
        }

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

    associateLabels(root);
    makeActivatable(root);
    if (opts.onMount) opts.onMount(root);
    // onMount often injects more markup (repeating rows, editors), so run
    // once more over whatever it added.
    associateLabels(root);
    makeActivatable(root);
    return root;
  }

  function confirm(opts) {
    let confirmed = false;
    return modal({
      title: opts.title || "Are you sure?",
      size: "narrow",
      body: `<p class="muted">${U.esc(opts.message || "")}</p>`,
      footer: `<button type="button" class="btn" data-close>Cancel</button>
               <button type="button" class="btn ${opts.danger ? "btn-danger" : "btn-primary"}" data-ok>
                 ${U.esc(opts.okLabel || "Confirm")}
               </button>`,
      // Cancel/dismiss is a real answer for either-or choices (sync
      // conflicts), so it has to fire for *every* way out — ✕, scrim,
      // Escape, Back — not just a click.
      onDismiss() { if (!confirmed && opts.onCancel) opts.onCancel(); },
      onMount(root) {
        root.querySelector("[data-ok]").addEventListener("click", () => {
          confirmed = true;
          closeModal();
          if (opts.onConfirm) opts.onConfirm();
        });
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

  /**
   * Initials on a coloured disc.
   *
   * The background is darkened until white initials clear 4.5:1 against it.
   * The colour comes from a palette or from whatever a user picked, and
   * several perfectly ordinary blues land just under the line — the default
   * profile colour measured 4.41:1, a real WCAG AA failure that axe reports
   * as serious and that shipped on every screen with a sidebar.
   *
   * 4.5, not 3.0: the initials are ~12.5px bold, and the large-text exemption
   * needs 18.66px bold. Adjusting the background rather than the text keeps
   * the design — white initials on colour — instead of flipping some avatars
   * to dark text and making the set look inconsistent.
   */
  function avatar(name, color, size) {
    const bg = U.readableOn(color || "#64748b", "#ffffff", 4.5);
    return `<span class="avatar${size ? " " + size : ""}" style="background:${U.esc(bg)}">${U.esc(U.initials(name))}</span>`;
  }

  /* -------------------------------------------------- U16 empty states -- */
  // Two renderings of the same 20-ish "nothing here" screens: the emoji
  // that's always been there, or a small set of hand-drawn line icons that
  // share the app's chart aesthetic (thin marks, rounded ends). Settings
  // picks which one emptyState() actually renders; the icon set itself is
  // shared so multiple call sites can point at the same drawing without
  // duplicating markup — e.g. both calendar empty states use the same
  // calendar glyph even though their emoji differ.

  const ICON_SVG = {
    homework: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="12" y="8" width="40" height="48" rx="4"/><rect x="24" y="4" width="16" height="8" rx="2"/>
      <rect x="19" y="21" width="6" height="6" rx="1.5"/><line x1="30" y1="24" x2="45" y2="24"/>
      <rect x="19" y="31" width="6" height="6" rx="1.5"/><line x1="30" y1="34" x2="45" y2="34"/>
      <rect x="19" y="41" width="6" height="6" rx="1.5"/><line x1="30" y1="44" x2="41" y2="44"/>
    </svg>`,
    grades: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="10,8 10,54 56,54"/>
      <line x1="20" y1="54" x2="20" y2="45" stroke-dasharray="1 5"/>
      <line x1="32" y1="54" x2="32" y2="37" stroke-dasharray="1 5"/>
      <line x1="44" y1="54" x2="44" y2="41" stroke-dasharray="1 5"/>
    </svg>`,
    notes: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="15" y="6" width="34" height="52" rx="3"/>
      <circle cx="15" cy="16" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="26" r="1.4" fill="currentColor" stroke="none"/>
      <circle cx="15" cy="36" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="46" r="1.4" fill="currentColor" stroke="none"/>
      <line x1="23" y1="20" x2="41" y2="20"/><line x1="23" y1="28" x2="41" y2="28"/><line x1="23" y1="36" x2="34" y2="36"/>
      <line x1="44" y1="46" x2="54" y2="36"/><circle cx="54" cy="36" r="2" fill="currentColor" stroke="none"/>
    </svg>`,
    calendar: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="8" y="12" width="48" height="44" rx="4"/><line x1="8" y1="24" x2="56" y2="24"/>
      <line x1="20" y1="6" x2="20" y2="16"/><line x1="44" y1="6" x2="44" y2="16"/>
      <circle cx="20" cy="33" r="1.4" fill="currentColor" stroke="none"/><circle cx="32" cy="33" r="1.4" fill="currentColor" stroke="none"/>
      <circle cx="44" cy="33" r="1.4" fill="currentColor" stroke="none"/><circle cx="20" cy="43" r="1.4" fill="currentColor" stroke="none"/>
      <circle cx="32" cy="43" r="1.4" fill="currentColor" stroke="none"/><circle cx="44" cy="43" r="1.4" fill="currentColor" stroke="none"/>
    </svg>`,
    flashcards: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="16" width="34" height="24" rx="4" transform="rotate(-8 26 28)"/>
      <rect x="17" y="22" width="34" height="24" rx="4" fill="var(--surface-2)"/>
      <line x1="25" y1="32" x2="43" y2="32"/><line x1="25" y1="38" x2="37" y2="38"/>
    </svg>`,
    people: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="41" cy="19" r="7"/><polyline points="31,48 34,36 50,36 53,48"/>
      <circle cx="23" cy="22" r="8" fill="var(--surface-2)"/><polyline points="11,50 15,36 35,36 39,50" fill="var(--surface-2)"/>
    </svg>`,
    caughtup: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="32" cy="32" r="24"/><polyline points="20,33 28,41 46,21"/>
    </svg>`,
    goals: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="32" cy="32" r="22"/><circle cx="32" cy="32" r="13"/><circle cx="32" cy="32" r="4" fill="currentColor" stroke="none"/>
    </svg>`,
    habits: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <line x1="32" y1="56" x2="32" y2="34"/><line x1="14" y1="56" x2="50" y2="56"/>
      <polygon points="32,38 18,28 32,24"/><polygon points="32,38 46,28 32,24"/>
    </svg>`,
    classes: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="8" y="42" width="48" height="9" rx="2"/><rect x="13" y="31" width="38" height="9" rx="2"/><rect x="18" y="20" width="28" height="9" rx="2"/>
    </svg>`,
    graduation: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="32,10 58,23 32,36 6,23"/><polyline points="18,27 18,41 32,48 46,41 46,27"/>
      <line x1="52" y1="24" x2="52" y2="40"/><circle cx="52" cy="42" r="2" fill="currentColor" stroke="none"/>
    </svg>`,
    activities: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round">
      <polygon points="32,10 37.3,24.7 52.9,25.2 40.6,34.8 44.9,49.8 32,41 19.1,49.8 23.4,34.8 11.1,25.2 26.7,24.7"/>
    </svg>`,
    hourglass: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="16,10 48,10 32,32 48,54 16,54 32,32 16,10"/>
    </svg>`,
    feed: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="8" y="12" width="48" height="30" rx="6"/><polyline points="20,42 20,52 30,42"/>
      <line x1="18" y1="22" x2="46" y2="22"/><line x1="18" y1="30" x2="38" y2="30"/>
    </svg>`,
    link: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="8" y="24" width="26" height="16" rx="8" transform="rotate(-25 21 32)"/>
      <rect x="30" y="24" width="26" height="16" rx="8" transform="rotate(-25 43 32)"/>
    </svg>`,
    reading: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="8,14 8,46 30,52 30,20 8,14"/><polyline points="56,14 56,46 34,52 34,20 56,14"/>
      <line x1="32" y1="18" x2="32" y2="52"/>
    </svg>`,
    assistant: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="32,8 38,26 56,32 38,38 32,56 26,38 8,32 26,26"/>
      <circle cx="52" cy="12" r="2" fill="currentColor" stroke="none"/>
    </svg>`
  };

  // kind -> { emoji, svg }. `svg` is a key into ICON_SVG, not the markup
  // itself, so several kinds can point at the same drawing (e.g. both
  // calendar empty states, or the various "no people yet" screens) without
  // the emoji they preserve in the other mode having to match too.
  const EMPTY_STATE_ICONS = {
    homework: { emoji: "✨", svg: "homework" },
    noGrades: { emoji: "📊", svg: "grades" },
    scores: { emoji: "📝", svg: "grades" },
    notes: { emoji: "📓", svg: "notes" },
    eventsToday: { emoji: "📭", svg: "calendar" },
    eventsUpcoming: { emoji: "🗓️", svg: "calendar" },
    todaySchedule: { emoji: "🌤️", svg: "calendar" },
    flashcards: { emoji: "🃏", svg: "flashcards" },
    contacts: { emoji: "👥", svg: "people" },
    classmates: { emoji: "👋", svg: "people" },
    groupsSignIn: { emoji: "👥", svg: "people" },
    groupsEmpty: { emoji: "👥", svg: "people" },
    parentSignIn: { emoji: "👨‍👩‍👧", svg: "people" },
    caughtUp: { emoji: "🎉", svg: "caughtup" },
    goals: { emoji: "🎯", svg: "goals" },
    habits: { emoji: "🌱", svg: "habits" },
    classes: { emoji: "📚", svg: "classes" },
    graduation: { emoji: "🎓", svg: "graduation" },
    activities: { emoji: "⚽", svg: "activities" },
    studySessions: { emoji: "⏳", svg: "hourglass" },
    feed: { emoji: "📝", svg: "feed" },
    studentsLinked: { emoji: "🔗", svg: "link" },
    reading: { emoji: "📖", svg: "reading" },
    assistant: { emoji: "🤖", svg: "assistant" }
  };

  /**
   * emptyState(kind, title, sub, action) — `kind` is a key into
   * EMPTY_STATE_ICONS. A bare string is still accepted for a one-off icon
   * that isn't worth naming (rendered as emoji only, ignoring the drawn
   * setting), so this stays backward-compatible with any call site that
   * just wants a literal character.
   */
  function emptyState(kind, title, sub, action) {
    const def = EMPTY_STATE_ICONS[kind];
    const drawn = App.store.db.settings.emptyStateStyle === "drawn";
    // An unknown key used to render its own text at icon size — 2.6rem of
    // muted grey that reads as a mistake and fails contrast. Fall back to a
    // neutral glyph instead, and say which key was wrong in the console.
    if (!def) console.warn("[ui] emptyState: unknown icon key", kind);
    const iconHtml = def
      ? (drawn ? ICON_SVG[def.svg] : def.emoji)
      : "📭";
    return `<div class="empty">
      <div class="e-ico${def && drawn ? " e-ico-drawn" : ""}">${iconHtml}</div>
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
    // A non-finite percentage renders as an em dash, not as "NaN". This is
    // the one component every grade display goes through, so guarding it
    // here covers the dashboard, Classes, Grades and Analytics at once.
    if (pct == null || !Number.isFinite(Number(pct))) {
      return `<span class="grade-pill${big ? " lg" : ""}">—</span>`;
    }
    const n = Number(pct);
    return `<span class="grade-pill ${U.gradeClass(n)}${big ? " lg" : ""}">${U.round(n, 1)}</span>`;
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

  /* --------------------------------------------------------- U50 — help -- */
  // A small "?" next to jargon (weighted category, Leitner box, cycle day…)
  // that explains it right where it first gets confusing, instead of a
  // help page nobody goes looking for.

  function helpHint(text) {
    return `<button type="button" class="help-hint" data-help="${U.esc(text)}" aria-label="What's this?">?</button>`;
  }

  /**
   * F157 — "somebody else put this here".
   *
   * A parent can now write into a student's records, and a record that
   * appeared without the student doing anything is confusing at best. The
   * server stamps `addedBy` on creation and `editedBy` on a change to
   * something that already existed; the two are worth telling apart, because
   * "your mum added this" and "your mum changed the one you made" are
   * different things to discover.
   *
   * Empty means the student did it themselves — the overwhelming case, and
   * deliberately rendered as nothing at all rather than "Added by you".
   *
   * `addedBy` is checked first on purpose. When a parent both created a record
   * and later changed it, both stamps are set, and "somebody else put this in
   * my list" is the more useful of the two facts. (S.changesByOthers() orders
   * the other way round, because there the question is what happened most
   * recently, not where the record came from.)
   */
  function byBadge(rec) {
    if (!rec) return "";
    if (rec.addedBy) {
      return `<span class="badge" title="Added by someone with access to your account">Added by ${U.esc(rec.addedBy)}</span>`;
    }
    if (rec.editedBy) {
      return `<span class="badge" title="Changed by someone with access to your account">Edited by ${U.esc(rec.editedBy)}</span>`;
    }
    return "";
  }

  let openHelp = null, openHelpBtn = null;
  function closeHelpNode() {
    if (!openHelp) return;
    openHelp.remove();
    openHelp = null; openHelpBtn = null;
    document.removeEventListener("click", onHelpOutside, true);
    document.removeEventListener("keydown", onHelpKey);
    document.removeEventListener("scroll", closeHelpNode, true);
  }
  function onHelpOutside(e) {
    if (openHelp && !openHelp.contains(e.target) && !e.target.closest("[data-help]")) closeHelpNode();
  }
  function onHelpKey(e) { if (e.key === "Escape") closeHelpNode(); }

  function showHelp(btn) {
    if (openHelpBtn === btn) { closeHelpNode(); return; }
    closeHelpNode();
    const el = document.createElement("div");
    el.className = "help-pop";
    el.setAttribute("role", "note");
    el.textContent = btn.dataset.help;
    document.body.appendChild(el);

    const r = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const w = Math.min(260, vw - 16);
    el.style.width = w + "px";
    el.style.left = Math.max(8, Math.min(r.left, vw - w - 8)) + "px";
    el.style.top = (r.bottom + 6) + "px";

    openHelp = el; openHelpBtn = btn;
    setTimeout(() => {
      document.addEventListener("click", onHelpOutside, true);
      document.addEventListener("keydown", onHelpKey);
      document.addEventListener("scroll", closeHelpNode, true);
    }, 0);
  }

  // One global delegate — ui.js loads once, so this never re-attaches.
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-help]");
    if (b) { e.stopPropagation(); showHelp(b); }
  });

  return {
    toast, deleteWithUndo, pushUndo, popUndo, modal, closeModal, confirm, confirmTyped, prompt,
    associateLabels, makeActivatable, bindActivationKeys, busy,
    avatar, emptyState, classOptions, teacherOptions,
    colorPicker, bindSwatches, dayPicker, bindDays,
    gradePill, priorityBadge, dueBadge, menu, helpHint, byBadge
  };
})();
