/* ==========================================================================
   views/shop.js — earn study tokens by answering a quiz on a topic you pick,
   and from the work StudyHold measured for itself, then spend them across
   four tiers.

   Two tabs on one screen, because they are two halves of the same loop: what
   you did, and what it bought. The economy itself (what a quiz is worth, why
   a topic was refused, what is for sale) lives in js/shop.js — this file is
   the screen.

   The Shop tab is grouped by TIER rather than by kind: the tier is what a
   price means to a student ("is this an evening or a fortnight?"), and the
   kind is already legible from the card itself.
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
    if (wait > 0) return { kind: "warn", text: `Next quiz in ${wait} minute${wait === 1 ? "" : "s"}.` };
    if (left === 0) return { kind: "warn", text: `You've hit today's ${SH.dailyCap()}-token cap. Quizzes still log the time.` };
    return { kind: "ok", text: `${left} token${left === 1 ? "" : "s"} still available today.` };
  }

  /* --------------------------------------------------------- earning quiz --

     Three stages in one flow, because they are three halves of one decision:
     say what you studied, answer for it, and see what it was worth.

       1. pick a topic → the free local checks (cooldown, is there an AI at
          all) run first, because a student should never wait on a network
          call to be told they have eight minutes left
       2. the model decides whether the topic is quizzable and writes the
          questions
       3. answering them is what earns the tokens

     Each stage replaces the body of the same modal rather than opening a
     second one, so Escape means the same thing throughout.                  */

  /** Is the quiz available at all right now? */
  function canQuiz() {
    return !!(App.assistant && App.assistant.available && App.assistant.available());
  }

  /**
   * Topics worth offering as one-tap chips: the classes the student takes and
   * the assignments they have open. Names they wrote themselves, so they read
   * like the thing they actually studied rather than a subject list.
   */
  function topicSuggestions() {
    const out = [];
    const push = (text, classId) => {
      const t = String(text || "").trim();
      if (!t || t.length > SH.RULES.maxTopicLen) return;
      if (out.some((x) => SH.topicKey(x.topic) === SH.topicKey(t))) return;
      out.push({ topic: t, classId: classId || null });
    };
    U.sortBy(S.db.assignments.filter((a) => a.status !== "done"), (a) => a.due || "9999")
      .slice(0, 6).forEach((a) => push(a.title, a.classId));
    S.db.classes.slice(0, 6).forEach((c) => push(c.name, c.id));
    (S.db.decks || []).slice(0, 4).forEach((d) => push(d.name, d.classId));
    return out.slice(0, 8);
  }

  function difficultyOptions(selected) {
    const label = { easy: "Easy · first-lesson recall", medium: "Medium · end-of-unit test", hard: "Hard · applying it" };
    return SH.RULES.difficultyOrder.map((d) => {
      const pay = SH.RULES.grades.A * SH.RULES.difficulty[d];
      return `<option value="${d}"${d === selected ? " selected" : ""}>${U.esc(label[d])} · full marks ${Math.round(pay)}</option>`;
    }).join("");
  }

  function quizForm(prefill) {
    const rules = SH.RULES;
    const able = canQuiz();
    const chips = topicSuggestions();
    const start = SH.canStart();

    UI.modal({
      title: "Earn tokens with a quiz",
      sub: able ? "Name what you studied and answer five questions about it"
                : "Quizzes need a connection — tokens are earned by answering them",
      size: "wide",
      okLabel: "Write my quiz",
      body: `
        ${able ? "" : `<p class="quiz-error small" role="alert">
          You're offline or signed out, so there's nobody to write the questions.
          Everything you've already earned is still here.</p>`}
        ${start.ok ? "" : `<p class="quiz-error small" role="alert">${U.esc(start.error)}</p>`}

        <div class="form-grid">
          <div class="field full">
            <label for="quizTopic">What did you study?</label>
            <input class="input" id="quizTopic" name="topic" maxlength="${rules.maxTopicLen}" required
                   autocomplete="off" placeholder="The causes of the French Revolution"
                   value="${U.esc((prefill && prefill.topic) || "")}" />
            <span class="hint">A unit, a chapter, a method — specific enough to ask five questions about.</span>
          </div>
          ${chips.length ? `<div class="field full">
            <span class="hint">Or pick one:</span>
            <div class="topic-chips">${chips.map((c, i) => `
              <button type="button" class="topic-chip" data-topic="${i}">${U.esc(c.topic)}</button>`).join("")}</div>
          </div>` : ""}
          <div class="field">
            <label for="quizDifficulty">Difficulty</label>
            <select class="select" id="quizDifficulty" name="difficulty">
              ${difficultyOptions((prefill && prefill.difficulty) || "medium")}
            </select>
          </div>
          <div class="field">
            <label for="quizClass">Class</label>
            <select class="select" id="quizClass" name="classId">${UI.classOptions((prefill && prefill.classId) || null, true)}</select>
          </div>
        </div>

        <p class="small dim mt-12" data-quote></p>
        <p class="quiz-error small mt-12" data-quiz-error hidden role="alert"></p>`,

      onMount(root) {
        const topic = root.querySelector("#quizTopic");
        const diff = root.querySelector("#quizDifficulty");
        const cls = root.querySelector("#quizClass");
        const quoteEl = root.querySelector("[data-quote]");
        const err = root.querySelector("[data-quiz-error]");

        // What this exact quiz would pay, updated as the topic and the
        // difficulty change — so the repeat rule and the daily cap are read
        // before the questions are answered, never discovered afterwards.
        const showQuote = () => {
          const q = SH.quote("A", { topic: topic.value, difficulty: diff.value });
          const parts = [`Full marks pays ${q.total}`];
          if (q.repeats > 0) {
            parts.push(q.repeatFactor > 0
              ? `this topic already paid today, so it's worth ${Math.round(q.repeatFactor * 100)}% now`
              : "this topic has paid all it can today — a different one pays full");
          }
          if (q.bonus) parts.push(`including the +${SH.RULES.firstOfDayBonus} first-quiz-of-the-day bonus`);
          if (q.mult > 1) parts.push(`${q.mult}× boost included`);
          if (q.capped) parts.push(`trimmed by today's ${SH.dailyCap()}-token cap`);
          quoteEl.textContent = parts.join(" · ") + `. Half marks pays ${SH.quote("C", { topic: topic.value, difficulty: diff.value }).total}, under half pays nothing.`;
        };
        showQuote();
        topic.addEventListener("input", showQuote);
        diff.addEventListener("change", showQuote);

        U.on(root, "click", "[data-topic]", (_e, el) => {
          const pick = topicSuggestions()[Number(el.dataset.topic)];
          if (!pick) return;
          topic.value = pick.topic;
          if (pick.classId) cls.value = pick.classId;
          err.hidden = true;
          showQuote();
        });
      },

      onSubmit(d, root) {
        const err = root.querySelector("[data-quiz-error]");
        const show = (msg) => { err.textContent = msg; err.hidden = false; };
        const topic = String(d.topic || "").trim();

        if (!canQuiz()) { show("There's no connection to write the questions. Try again when you're back online."); return false; }
        if (topic.length < 3) { show("Say what you studied — a few words is enough."); return false; }
        // The free check runs before the paid one: an unexpired cooldown is a
        // refusal this device can make on its own, and it should never cost
        // an API call.
        const start = SH.canStart();
        if (!start.ok) { show(start.error); return false; }

        err.hidden = true;
        const setup = { topic, classId: d.classId || null, difficulty: d.difficulty || "medium" };
        const btn = root.querySelector('button[type="submit"]');

        UI.busy(btn, App.assistant.makeTopicQuiz(topic, { className: S.className(setup.classId), difficulty: setup.difficulty }))
          .then((res) => {
            if (!res || res.ok !== true) {
              // Not an error state: the student named something the app can't
              // quiz, and the useful thing is the reason plus the form still
              // being open with what they typed in it.
              show((res && res.reason) || "That isn't a topic this can quiz you on — name something you actually studied.");
              return;
            }
            quizStage(setup, res);
          })
          .catch((e) => show(e.message || "That quiz couldn't be written."));

        return false;   // the async path opens the quiz or leaves the form up
      }
    });
  }

  /* -------------------------------------------------------------- quiz -- */

  function questionHtml(q, i) {
    const name = `q${i}`;
    return `<fieldset class="quiz-q" data-q="${i}">
      <legend class="bold small">${i + 1}. ${U.esc(q.prompt)}</legend>
      ${q.choices.map((c, j) => `
        <label class="quiz-choice" data-choice="${j}">
          <input type="radio" name="${name}" value="${j}" required />
          <span>${U.esc(c)}</span>
        </label>`).join("")}
    </fieldset>`;
  }

  /**
   * Stage two: the questions, and what the answers were worth.
   *
   * `res` is the study-topic response — questions with no answers in them,
   * plus the ticket that carries the key server-side.
   */
  function quizStage(setup, res) {
    const qs = res.questions || [];
    const fifties = SH.held("fifty");
    // Study time is MEASURED from here, not typed into a box. It is the one
    // number on the record that isn't a claim, which is why it is the only
    // one allowed into the study log.
    const startedAt = Date.now();

    UI.modal({
      title: `${res.subject || "Study"} — ${qs.length} question${qs.length === 1 ? "" : "s"}`,
      sub: `${setup.topic} · ${setup.difficulty} · answers are checked on the server`,
      size: "wide",
      okLabel: "Submit answers",
      body: `
        <p class="small dim">${U.esc(res.reason || "")}</p>
        <div class="quiz-list mt-12">${qs.map(questionHtml).join("")}</div>
        <div class="row gap-8 mt-12" data-fifty-row ${fifties ? "" : "hidden"}>
          <button type="button" class="btn btn-sm" data-fifty>
            Use a 50/50 <span class="dim">(${fifties} left)</span>
          </button>
          <span class="tiny dim">Removes two wrong options from the first question you haven't answered.</span>
        </div>
        <p class="quiz-error small mt-12" data-quiz-error hidden role="alert"></p>`,

      onMount(root) {
        const fiftyBtn = root.querySelector("[data-fifty]");
        if (!fiftyBtn) return;
        fiftyBtn.addEventListener("click", () => {
          // The 50/50 has to pick a target, and the least surprising one is
          // the question the student is stuck on: the first unanswered.
          const target = [...root.querySelectorAll(".quiz-q")]
            .find((fs) => !fs.querySelector("input:checked"));
          if (!target) {
            UI.toast("Nothing to narrow", "Every question already has an answer.");
            return;
          }
          if (!SH.spendHeld("fifty")) return;

          // Which two to hide is a client-side guess — the key is on the
          // server. Hiding two the student has NOT picked keeps it honest:
          // it never removes the option they were leaning towards, and on a
          // question they'd have got right it can only remove wrong ones.
          const choices = [...target.querySelectorAll(".quiz-choice")];
          const shuffled = choices.slice().sort(() => Math.random() - 0.5).slice(0, 2);
          shuffled.forEach((c) => {
            c.hidden = true;
            const input = c.querySelector("input");
            input.checked = false;
            input.disabled = true;
            input.required = false;
          });
          const left = SH.held("fifty");
          fiftyBtn.innerHTML = `Use a 50/50 <span class="dim">(${left} left)</span>`;
          if (!left) root.querySelector("[data-fifty-row]").hidden = true;
        });
      },

      onSubmit(d, root) {
        const err = root.querySelector("[data-quiz-error]");
        const answers = qs.map((_, i) => {
          const picked = root.querySelector(`input[name="q${i}"]:checked`);
          return picked ? Number(picked.value) : -1;
        });
        if (answers.some((a) => a < 0)) {
          err.textContent = "Answer every question before submitting.";
          err.hidden = false;
          return false;
        }
        err.hidden = true;

        const btn = root.querySelector('button[type="submit"]');
        const minutes = Math.round((Date.now() - startedAt) / 60000);
        UI.busy(btn, App.assistant.gradeStudyQuiz(res.ticket, answers))
          .then((graded) => {
            const scored = { ...graded, subject: res.subject, topic: graded.topic || setup.topic };
            if (graded.tokens > 0) return finish(setup, scored, minutes);
            // A zero is the one place a retake is worth offering, and it is
            // offered before the quiz saves so the two attempts read as one
            // sitting rather than two entries in the log.
            failedStage(setup, scored, minutes);
          })
          .catch((e) => {
            err.textContent = e.message || "Those answers couldn't be marked.";
            err.hidden = false;
          });

        return false;
      }
    });
  }

  /** Stage three, only when the quiz was failed: save it, or spend a retake. */
  function failedStage(setup, graded, minutes) {
    const retakes = SH.held("retake");

    UI.modal({
      title: `${graded.correct} of ${graded.total} — no tokens`,
      sub: "The time you spent still counts. The tokens don't.",
      size: "wide",
      body: `
        <p class="small">Half the questions right is the line, and this was under it.
          Nothing is lost: the attempt saves either way, and the topic isn't spent —
          read it again and the next quiz on it still pays full price.</p>
        ${retakes
          ? `<p class="small mt-12">You have ${retakes} retake${retakes === 1 ? "" : "s"}.
             Spending one asks for a fresh set of questions on ${U.esc(setup.topic)} —
             different questions, not the same ones again.</p>`
          : `<p class="small dim mt-12">A retake from the shop would buy a fresh set of
             questions on this topic right now, with no cooldown. You don't have one.</p>`}
        <p class="quiz-error small mt-12" data-retake-error hidden role="alert"></p>`,
      footer: `
        ${retakes ? `<button type="button" class="btn btn-primary left" data-retake>Use a retake</button>` : ""}
        <button type="button" class="btn" data-save-anyway>Save without tokens</button>`,

      onMount(root) {
        const err = root.querySelector("[data-retake-error]");
        root.querySelector("[data-save-anyway]").addEventListener("click", () => {
          finish(setup, graded, minutes);
        });

        const btn = root.querySelector("[data-retake]");
        if (!btn) return;
        btn.addEventListener("click", () => {
          if (!SH.spendHeld("retake")) {
            err.textContent = "That retake is already spent.";
            err.hidden = false;
            return;
          }
          UI.busy(btn, App.assistant.makeTopicQuiz(setup.topic, {
            className: S.className(setup.classId), difficulty: setup.difficulty
          }))
            .then((res) => {
              if (!res || res.ok !== true) {
                err.textContent = (res && res.reason) || "That topic couldn't be quizzed again.";
                err.hidden = false;
                return;
              }
              quizStage(setup, res);
            })
            .catch((e) => {
              err.textContent = e.message || "That topic couldn't be quizzed again.";
              err.hidden = false;
            });
        });
      }
    });
  }

  /** Write the attempt, whatever it turned out to be worth. */
  function finish(setup, graded, minutes) {
    let res;
    try {
      res = SH.record({ result: graded, topic: setup.topic, classId: setup.classId,
                        difficulty: setup.difficulty, minutes });
    } catch (e) {
      UI.closeModal();
      UI.toast("That quiz couldn't be saved", e.message || "", "warn");
      return;
    }
    UI.closeModal();
    if (res.awarded > 0) {
      UI.toast(`+${res.awarded} token${res.awarded === 1 ? "" : "s"} 🎉`,
        `Grade ${res.quiz.grade} · ${res.quiz.correct} of ${res.quiz.total} on ${res.quiz.topic}` +
        (res.capped ? " — trimmed by today's cap." : "."), "ok");
    } else {
      UI.toast("Saved, no tokens",
        SH.remainingToday() === 0
          ? `Today's ${SH.dailyCap()}-token cap is reached, but the attempt is still in your log.`
          : `${res.quiz.correct} of ${res.quiz.total} isn't enough for tokens. Read it again and try another.`);
    }
    App.router.refresh();
  }

  /** One quiz from the log, with the option to remove it. */
  function viewQuiz(id) {
    const q = SH.quizzes().find((x) => x.id === id);
    if (!q) return;
    const c = S.cls(q.classId);

    UI.modal({
      title: q.topic,
      sub: `${U.fmtDate(q.date, "day")}${c ? " · " + c.name : ""} · earned ${q.tokens} token${q.tokens === 1 ? "" : "s"}`,
      size: "wide",
      body: `
        <div class="row gap-8">
          <span class="badge ${q.tokens > 0 ? "ok" : ""}">Grade ${U.esc(q.grade)}</span>
          <span class="badge">${q.correct} of ${q.total} right</span>
          <span class="badge">${U.esc(q.difficulty)}</span>
          ${q.subject ? `<span class="badge">${U.esc(q.subject)}</span>` : ""}
          ${q.minutes ? `<span class="badge">${U.fmtDur(q.minutes)} answering</span>` : ""}
        </div>
        ${q.repeats ? `<p class="small dim mt-12">This was quiz ${q.repeats + 1} on that topic that day,
          so it paid ${Math.round((SH.RULES.repeatFactors[Math.min(q.repeats, SH.RULES.repeatFactors.length - 1)]) * 100)}% of full.</p>` : ""}
        <p class="tiny dim mt-12">Deleting this removes the attempt and its study session from this device.
          Tokens you already earned stay yours, and the topic still counts as paid for that day.</p>`,
      footer: `<button type="button" class="btn btn-danger left" data-del-quiz>Delete</button>
               <button type="button" class="btn" data-close>Close</button>`,
      onMount(root) {
        root.querySelector("[data-del-quiz]").addEventListener("click", () => {
          UI.closeModal();
          UI.confirm({
            title: "Delete this quiz?",
            message: "The attempt and its study session go. The tokens it earned stay.",
            okLabel: "Delete",
            danger: true,
            onConfirm() {
              SH.deleteQuiz(q.id);
              UI.toast("Quiz deleted", "The tokens it earned are still yours.");
              App.router.refresh();
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

  function quizRow(q) {
    const c = S.cls(q.classId);
    return `<button class="list-item quiz-row" data-quiz="${U.esc(q.id)}"
              aria-label="Open the quiz on ${U.esc(q.topic)}">
      <span class="grow">
        <span class="title">${U.esc(q.topic)}</span>
        <span class="meta">${U.esc(U.fmtDate(q.date, "day"))} · ${q.correct}/${q.total} · ${U.esc(q.difficulty)}${c ? " · " + U.esc(c.name) : ""}</span>
      </span>
      <span class="badge ${q.tokens > 0 ? "ok" : ""}">${q.tokens > 0 ? "+" + q.tokens : "grade " + U.esc(q.grade)}</span>
    </button>`;
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
    if (it.kind === "alarm") {
      return `<div class="shop-swatch shop-glyph" aria-hidden="true">🔔</div>`;
    }
    if (it.kind === "boost") {
      const glyph = { freeze: "🧊", vault: "🧊", fifty: "½", skip: "⏩", retake: "↻" }[it.value] || "✖️";
      return `<div class="shop-swatch shop-glyph" aria-hidden="true">${glyph}</div>`;
    }
    // Everything left is a colour pair; an item without one would throw here,
    // which is why the two kinds above return before reaching it.
    return `<div class="shop-swatch">
      <span style="background:${U.esc(it.preview.a)}"></span>
      <span style="background:${U.esc(it.preview.b)}"></span>
    </div>`;
  }

  function itemCard(it) {
    const owned = SH.owns(it.id);
    const worn = SH.isEquipped(it.id);
    const afford = SH.balance() >= it.price;
    const count = SH.ownedCount(it.id);

    // A consumable is used the moment it's bought, so it never reads as owned
    // or worn — buying a second streak freeze is the whole point of it.
    const full = !!it.max && SH.held(it.value) >= it.max;
    const action = it.consumable
      ? full
        ? `<button class="btn btn-sm" disabled>Full · ${it.max}</button>`
        : `<button class="btn btn-sm btn-primary" data-buy="${it.id}" ${afford ? "" : "disabled"}>
             ${afford ? `Buy · ${it.price}` : `${it.price} tokens`}
           </button>`
      : !owned
        ? `<button class="btn btn-sm btn-primary" data-buy="${it.id}" ${afford ? "" : "disabled"}>
             ${afford ? `Buy · ${it.price}` : `${it.price} tokens`}
           </button>`
        : worn
          ? `<button class="btn btn-sm" data-unequip="${it.kind}">Take off</button>`
          : `<button class="btn btn-sm btn-primary" data-equip="${it.id}">Wear</button>`;

    // A timed boost is spent when bought; a banked one waits for its moment,
    // so what matters on its card is how many are in hand, not how many were
    // ever bought.
    const banked = it.max ? SH.held(it.value) : 0;
    const badge = it.consumable
      ? (banked ? `<span class="badge brand">${banked} banked</span>`
         : count ? `<span class="badge ok">Used ×${count}</span>` : tokenPill(it.price))
      : worn ? `<span class="badge brand">Wearing</span>`
      : owned ? `<span class="badge ok">Owned</span>` : tokenPill(it.price);

    return `<div class="shop-item tier-${U.esc(it.tier)}${worn ? " worn" : owned && !it.consumable ? " owned" : ""}">
      ${preview(it)}
      <div>
        <div class="row between gap-6">
          <span class="small bold">${U.esc(it.name)}</span>
          ${badge}
        </div>
        <div class="tiny dim mt-4">${U.esc(it.blurb)}</div>
      </div>
      <div class="shop-foot">
        ${action}
        ${it.kind === "alarm" ? `<button class="btn btn-sm" data-hear="${U.esc(it.value)}">▶ Hear it</button>` : ""}
      </div>
    </div>`;
  }

  function earnTab() {
    const list = U.sortBy(SH.quizzes(), (q) => q.at, true);
    const st = statusLine();
    const rules = SH.RULES;
    const boost = SH.activeBoost();
    const week = SH.quizzes().filter((q) => q.date >= U.dateKey(U.addDays(new Date(), -6)));
    const passed = SH.quizzes().filter((q) => q.tokens > 0).length;

    return `<div class="grid g-main">
      <div class="card">
        <div class="card-head">
          <div><h3>Answer for what you studied</h3><div class="sub">You pick the topic, the quiz is written for it — and this is the only way to earn</div></div>
          <span class="badge ${st.kind}">${U.esc(st.text)}</span>
        </div>
        <div class="card-body col gap-16">
          <button class="btn btn-primary btn-lg btn-block" data-add-quiz>✎ Start a quiz</button>
          ${SH.cooldownLeft() > 0 && SH.held("skip") > 0
            ? `<button class="btn btn-block" data-skip-cooldown>⏩ Skip the wait
                 <span class="dim">(${SH.held("skip")} banked)</span></button>`
            : ""}

          <div>
            <h4 class="mb-8">How a quiz pays</h4>
            <ul class="earn-rules">
              <li>You name the topic — a unit, a chapter, a method. Something that isn't school
                  material is read, refused, and told why.</li>
              <li>Five questions about it, written after you name it. <strong>Full marks pays
                  ${rules.grades.A}</strong>, most of them ${rules.grades.B}, half ${rules.grades.C}.
                  Under half pays nothing and still logs the time.</li>
              <li>Difficulty is yours to pick, and it moves the payout:
                  ${rules.difficultyOrder.map((d) => `${d} ×${rules.difficulty[d]}`).join(", ")}.</li>
              <li>The same topic pays full once a day, then
                  ${Math.round(rules.repeatFactors[1] * 100)}%, then nothing — a different topic
                  always pays full.</li>
              <li>+${rules.firstOfDayBonus} for the first quiz of the day. ${SH.dailyCap()} tokens is today's ceiling.</li>
              <li>${rules.cooldownMin} minutes between quizzes, and no quiz can be marked twice.</li>
              <li>The minutes you spend answering land in your study log, so they count toward the
                  heatmap and your weekly goal.</li>
            </ul>
          </div>

          <div>
            <h4 class="mb-8">…and what doesn't pay</h4>
            <p class="tiny dim mt-0 mb-8">Everything else. This is the only way to earn a token.</p>
            <ul class="earn-rules">
              <li>Finishing an assignment, keeping a streak, reviewing a deck, logging pages, ticking a
                  habit, reaching a goal — all still tracked, none of them currency. Every one was a
                  button you press in an app rather than something you had to know.</li>
              <li>The focus timer pays nothing either. A timer left running is not studying, and paying
                  by the minute for it rewarded exactly that.</li>
              <li>A <strong>boost</strong> from the shop is the one thing that changes the numbers above:
                  it multiplies what a quiz pays <em>and</em> raises the day's ceiling with it.</li>
            </ul>
          </div>

          <p class="tiny dim" style="margin:0">
            The topic you type is the only thing that leaves this device, and only to have questions written
            about it. The answers are marked on the server so the key never reaches this browser — which is
            the one thing that makes the number mean anything.
          </p>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Your record</h3></div>
        <div class="card-body col gap-12">
          <div class="row between">
            <span class="small dim">Quizzes answered</span>
            <span class="bold nums">${SH.quizzes().length}</span>
          </div>
          <div class="row between">
            <span class="small dim">Passed for tokens</span>
            <span class="bold nums">${passed}</span>
          </div>
          <div class="row between">
            <span class="small dim">Quizzes this week</span>
            <span class="bold nums">${week.length}</span>
          </div>
          <div class="row between">
            <span class="small dim">Earned today</span>
            <span class="bold nums">${SH.earnedToday()} / ${SH.dailyCap()}</span>
          </div>
          <div class="row between">
            <span class="small dim">Tokens spent</span>
            <span class="bold nums">${Math.max(0, Math.floor(SH.wallet().spent))}</span>
          </div>
          ${boost ? `<div class="row between">
            <span class="small dim">Boost</span>
            <span class="badge solid">${boost.mult}× until ${U.esc(new Date(boost.until).toLocaleString())}</span>
          </div>` : ""}
        </div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head"><h3>Where your tokens came from</h3>
        <span class="sub">Most recent first</span></div>
      ${SH.ledger(15).length
        ? `<div class="list">${SH.ledger(15).map((e) => `<div class="list-item">
            <span class="grow"><div class="title">${U.esc(e.reason)}</div>
              <div class="meta">${U.esc(new Date(e.at).toLocaleString())}${e.mult ? ` · ${e.mult}× boost` : ""}</div></span>
            <span class="badge ${e.n > 0 ? "ok" : ""}">${e.n > 0 ? "+" : ""}${e.n}</span>
          </div>`).join("")}</div>`
        : `<div class="card-body"><p class="dim small">Nothing yet — answer a quiz above, or finish an assignment.</p></div>`}
    </div>

    <div class="card mt-16">
      <div class="card-head"><h3>Quiz log</h3><span class="sub">${list.length} quiz${list.length === 1 ? "" : "zes"}</span></div>
      ${list.length
        ? `<div class="list">${list.map(quizRow).join("")}</div>`
        : UI.emptyState("studySessions", "No quizzes yet",
            "Name what you revised and answer five questions about it — that's the tokens, and a record of the term you can scroll back through.",
            `<button class="btn btn-primary" data-add-quiz>✎ Start your first quiz</button>`)}
    </div>`;
  }

  function shopTab() {
    return SH.tiers().map((tier) => {
      const list = SH.byTier(tier.key);
      const got = list.filter((i) => SH.owns(i.id)).length;
      const prices = list.map((i) => i.price);
      return `<div class="card mb-16 tier-card tier-${U.esc(tier.key)}">
        <div class="card-head">
          <div>
            <h3 class="tier-head tier-${U.esc(tier.key)}">
              <span aria-hidden="true">${tier.glyph}</span> ${U.esc(tier.label)}
            </h3>
            <div class="tiny dim">${U.esc(tier.blurb)} · ${Math.min.apply(null, prices)}–${Math.max.apply(null, prices)} tokens</div>
          </div>
          <span class="sub">${got} of ${list.length} unlocked</span>
        </div>
        <div class="card-body"><div class="shop-grid">${list.map(itemCard).join("")}</div></div>
      </div>`;
    }).join("");
  }

  function render() {
    const bal = SH.balance();
    const w = SH.wallet();
    const next = SH.nextUp();

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>${App.i18n.t("shop", "Study shop")}</h1>
          <div class="sub">Answering a quiz on what you studied is the only way to earn tokens. Spend them on how StudyHold looks.</div>
        </div>
        <div class="page-actions row gap-8">
          ${tokenPill(bal, true)}
          <button class="btn btn-primary" data-add-quiz>✎ Start a quiz</button>
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
          <div class="stat-ico" aria-hidden="true">✎</div>
          <div class="stat-label">Earned all time</div>
          <div class="stat-value nums">${Math.max(0, Math.floor(w.earned))}</div>
          <div class="stat-foot">${U.plural(SH.quizzes().length, "quiz", "quizzes")}</div>
        </div>
        <div class="stat">
          <div class="stat-ico" aria-hidden="true">📅</div>
          <div class="stat-label">Earned today</div>
          <div class="stat-value nums">${SH.earnedToday()}</div>
          <div class="stat-foot">of ${SH.dailyCap()} available</div>
        </div>
        <div class="stat">
          <div class="stat-ico" aria-hidden="true">✨</div>
          <div class="stat-label">Unlocked</div>
          <div class="stat-value nums">${new Set(w.owned).size}</div>
          <div class="stat-foot">${next
            ? `of ${SH.CATALOG.length} · next: ${U.esc(next.item.name)}, ${next.shortBy} to go`
            : `of ${SH.CATALOG.length} items`}</div>
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
    U.on(root, "click", "[data-add-quiz]", () => quizForm());
    U.on(root, "click", "[data-skip-cooldown]", () => {
      const r = SH.skipCooldown();
      if (!r.ok) { UI.toast("Can't skip that", r.error, "warn"); return; }
      UI.toast("Wait skipped", "Start the next quiz now.", "ok");
      App.router.refresh();
    });
    U.on(root, "click", "[data-quiz]", (_e, el) => viewQuiz(el.dataset.quiz));
    U.on(root, "click", "[data-buy]", (_e, el) => buyItem(el.dataset.buy));
    U.on(root, "click", "[data-equip]", (_e, el) => {
      const it = SH.item(el.dataset.equip);
      if (SH.equip(el.dataset.equip)) UI.toast(`${it.name} on`, "", "ok");
    });
    U.on(root, "click", "[data-hear]", (_e, el) => {
      // The click is itself the gesture that opens the audio session, so a
      // preview is audible even on a page that hasn't played anything yet.
      App.sound.preview(el.dataset.hear);
    });
    U.on(root, "click", "[data-unequip]", (_e, el) => {
      const kind = el.dataset.unequip;
      const it = SH.equipped(kind);
      SH.unequip(kind);
      UI.toast(`${it ? it.name : SH.kindLabel(kind)} off`, "It stays in your collection.");
    });

  }

  return { render, mount, quizForm, viewQuiz, title: "Study shop" };
})();
