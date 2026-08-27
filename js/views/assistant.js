/* ==========================================================================
   views/assistant.js — the private assistant: a chat over your own data

   Every answer is grounded in a context digest built fresh from local data
   for that one question (see assistant.js's buildContext()) — nothing is
   stored on a server between questions, and nothing about any other
   student is ever in scope. Suggested prompts exist so the empty state
   teaches what it's for instead of staring back with a blank box.
   ========================================================================== */

App.views = App.views || {};

App.views.assistant = (function () {
  const U = App.utils, S = App.store, UI = App.ui;

  let sending = false;

  const SUGGESTIONS = [
    "What classes do I have today?",
    "Do I have time to hang out with friends for a couple hours today?",
    "What's due this week?",
    "Add a chemistry test next Friday"
  ];

  function bubble(msg) {
    if (msg.role === "user") {
      return `<div class="chat-row chat-row-user">
        <div class="chat-bubble chat-bubble-user">${U.esc(msg.text)}</div>
      </div>`;
    }
    return `<div class="chat-row chat-row-assistant">
      <div class="chat-bubble chat-bubble-assistant">${App.md.render(msg.text)}</div>
    </div>`;
  }

  function render() {
    const hist = App.assistant.history();
    // The AI routes spend a shared provider quota, so they need an account.
    // Say so before someone types a question, not after.
    const ready = App.assistant.available();

    if (!ready) {
      return `<div class="page-inner">
        <div class="page-head">
          <div>
            <h1>${App.i18n.t("assistant", "Assistant")}</h1>
            <div class="sub">Ask about your schedule, or tell it to add things — private to you.</div>
          </div>
        </div>
        <div class="card"><div class="card-body">
          ${UI.emptyState("assistant", "Sign in to use the Assistant",
            "The AI features run on a shared quota, so they're tied to an account. Everything else in StudyHold works without one.")}
          <div class="row center gap-8" style="margin-top:12px">
            <button type="button" class="btn btn-primary" data-go="settings">Go to sign in</button>
          </div>
        </div></div>
      </div>`;
    }

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>${App.i18n.t("assistant", "Assistant")}</h1>
          <div class="sub">Ask about your schedule, or tell it to add things — private to you, and it always confirms first.</div>
        </div>
        <div class="page-actions">
          ${hist.length ? `<button class="btn" data-clear-chat>Clear conversation</button>` : ""}
        </div>
      </div>

      <div class="card">
        <div class="card-body">
          <div id="chatThread" class="chat-thread">
            ${hist.length
              ? hist.map(bubble).join("")
              : UI.emptyState("assistant", "Ask me anything about your day",
                  "I can see your own schedule, assignments, and grades — nothing about anyone else. I can add things too, and I'll always ask before saving.")}
            ${sending ? `<div class="chat-row chat-row-assistant"><div class="chat-bubble chat-bubble-assistant dim">Thinking…</div></div>` : ""}
          </div>

          ${!hist.length ? `<div class="row wrap gap-6 mb-12">
            ${SUGGESTIONS.map((s) => `<button type="button" class="chip" data-suggest="${U.esc(s)}">${U.esc(s)}</button>`).join("")}
          </div>` : ""}

          <form id="chatForm" class="row gap-8">
            <input class="input grow" id="chatInput" placeholder="Ask a question…" autocomplete="off" ${sending ? "disabled" : ""} />
            <button class="btn btn-primary" type="submit" ${sending ? "disabled" : ""}>Ask</button>
          </form>
        </div>
      </div>
    </div>`;
  }

  async function send(text) {
    const q = String(text || "").trim();
    if (!q || sending) return;
    sending = true;
    App.assistant.pushHistory("user", q);
    App.router.refresh();
    scrollToBottom();

    try {
      const res = await App.assistant.act(q);
      const actions = Array.isArray(res.actions) ? res.actions : [];
      App.assistant.pushHistory("assistant", res.answer || (actions.length ? "Here's what I can do:" : "…"));
      sending = false;
      App.router.refresh();
      scrollToBottom();
      // Nothing is written until the student confirms.
      if (actions.length) confirmActions(actions);
      return;
    } catch (e) {
      App.assistant.pushHistory("assistant", e.message);
      sending = false;
      App.router.refresh();
      scrollToBottom();
    }
  }

  /** Show proposed changes and only apply the ones still ticked on confirm. */
  function confirmActions(actions) {
    UI.modal({
      title: actions.length === 1 ? "Make this change?" : `Make ${actions.length} changes?`,
      sub: "Nothing is saved until you confirm.",
      okLabel: "Do it",
      body: `<div class="col gap-8">
        ${actions.map((a, i) => `
          <label class="row gap-8" style="align-items:flex-start;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm)">
            <input type="checkbox" checked data-act="${i}" style="margin-top:3px" />
            <span>
              <span class="bold small">${U.esc(a.summary || a.title || a.kind)}</span>
              ${a.due ? `<span class="tiny dim"> · due ${U.esc(a.due)}</span>` : ""}
              ${a.className ? `<span class="tiny dim"> · ${U.esc(a.className)}</span>` : ""}
            </span>
          </label>`).join("")}
      </div>`,
      onSubmit(_d, root) {
        const chosen = U.$$("[data-act]", root).filter((c) => c.checked).map((c) => actions[Number(c.dataset.act)]);
        if (!chosen.length) return;
        const done = [];
        const failed = [];
        chosen.forEach((a) => {
          try { done.push(App.assistant.applyAction(a)); }
          catch (e) { failed.push(e.message); }
        });
        if (done.length) {
          App.assistant.pushHistory("assistant", "✅ " + done.join("\n✅ "));
          UI.toast("Done", done[0], "ok");
        }
        if (failed.length) {
          App.assistant.pushHistory("assistant", "⚠️ " + failed.join("\n⚠️ "));
          UI.toast("Some changes didn't apply", failed[0], "warn");
        }
        App.router.refresh();
        scrollToBottom();
      }
    });
  }

  function scrollToBottom() {
    setTimeout(() => {
      const t = document.getElementById("chatThread");
      if (t) t.scrollTop = t.scrollHeight;
    }, 30);
  }

  function mount(root) {
    scrollToBottom();
    U.on(root, "click", "[data-suggest]", (_e, el) => send(el.dataset.suggest));
    U.on(root, "click", "[data-clear-chat]", () => {
      UI.confirm({
        title: "Clear this conversation?",
        message: "This clears the chat on this device. It doesn't affect your schedule, grades, or assignments.",
        okLabel: "Clear",
        onConfirm() { App.assistant.clearHistory(); App.router.refresh(); }
      });
    });
    const form = root.querySelector("#chatForm");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const input = root.querySelector("#chatInput");
        const v = input.value;
        input.value = "";
        send(v);
      });
    }
  }

  return { render, mount, title: "Assistant" };
})();
