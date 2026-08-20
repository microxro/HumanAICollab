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
    "How am I doing in my classes right now?"
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

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>Assistant</h1>
          <div class="sub">Ask about your own schedule, grades, and assignments — private to you.</div>
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
                  "I can only see your own schedule, assignments, and grades — nothing about anyone else.")}
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
    App.router.refresh();
    scrollToBottom();
    // ask() records both the question and the answer (or a friendly error
    // in the assistant's own voice) into history itself — nothing further
    // to catch here.
    await App.assistant.ask(q).catch(() => {});
    sending = false;
    App.router.refresh();
    scrollToBottom();
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
