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

  /** Soft-delete with a one-tap Undo — the safety net for every destructive action. */
  function deleteWithUndo(coll, id, label) {
    const token = App.store.remove(coll, id);
    if (!token) return;
    toast("Deleted", label || "", "warn", {
      label: "Undo",
      onClick() {
        App.store.restore(token);
        toast("Restored", label || "", "ok");
      }
    });
  }

  /* ------------------------------------------------------------ modals -- */

  let openModal = null;

  function closeModal() {
    if (!openModal) return;
    openModal.remove();
    openModal = null;
    document.removeEventListener("keydown", escClose);
  }

  function escClose(e) {
    if (e.key === "Escape") closeModal();
  }

  /**
   * modal({ title, body, size, footer, onMount, onSubmit })
   * `body` is an HTML string. If `onSubmit` is given the body is wrapped in a
   * <form> and submitting calls onSubmit(formDataObject, modalEl).
   * Return false from onSubmit to keep the modal open.
   */
  function modal(opts) {
    closeModal();

    const root = document.createElement("div");
    root.className = "modal-root";
    const size = opts.size ? " " + opts.size : "";

    const footer = opts.footer != null ? opts.footer : `
      <button type="button" class="btn" data-close>Cancel</button>
      <button type="${opts.onSubmit ? "submit" : "button"}" class="btn btn-primary" ${opts.onSubmit ? "" : "data-close"}>
        ${U.esc(opts.okLabel || "Save")}
      </button>`;

    const inner = `
      <div class="modal-head">
        <div>
          <h3>${U.esc(opts.title || "")}</h3>
          ${opts.sub ? `<div class="sub small dim">${U.esc(opts.sub)}</div>` : ""}
        </div>
        <button type="button" class="icon-btn" data-close aria-label="Close">✕</button>
      </div>
      <div class="modal-body">${opts.body || ""}</div>
      <div class="modal-foot">${footer}</div>`;

    root.innerHTML = opts.onSubmit
      ? `<form class="modal${size}" novalidate>${inner}</form>`
      : `<div class="modal${size}">${inner}</div>`;

    document.body.appendChild(root);
    openModal = root;

    root.addEventListener("click", (e) => {
      if (e.target === root || e.target.closest("[data-close]")) closeModal();
    });
    document.addEventListener("keydown", escClose);

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

  return {
    toast, deleteWithUndo, modal, closeModal, confirm, prompt,
    avatar, emptyState, classOptions, teacherOptions,
    colorPicker, bindSwatches, dayPicker, bindDays,
    gradePill, priorityBadge, dueBadge
  };
})();
