/* ==========================================================================
   views/flashcards.js — decks + Leitner-box spaced repetition study mode
   ========================================================================== */

App.views.flashcards = (function () {
  const U = App.utils, S = App.store, UI = App.ui;

  // Leitner intervals in days, indexed by box (1 = hardest, 5 = mastered).
  const INTERVALS = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 16 };

  let study = null;   // { deckId, queue: [cardId], i, flipped, sessionId }
  let quiz = null;    // { deckId, mode:'choice'|'typed', queue, i, choices, answered, correct }
  let test = null;    // F031 practice test — { queue:[{deckId,cardId}], i, mode, correct, wrong, endsAt, answered, choices, sessionId }
  let testTimerHandle = null;

  // F029 text-to-speech, using the browser's own speech synthesis.
  function speak(text) {
    if (!("speechSynthesis" in window) || !text) return;
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    } catch (e) { /* speech synthesis unavailable — silently skip */ }
  }

  // F027 cloze rendering — {{answer}} becomes a blank until revealed.
  function clozeBlanked(text) { return U.esc(text).replace(/\{\{(.*?)\}\}/g, '<span class="cloze-blank">＿＿＿</span>'); }
  function clozeRevealed(text) { return U.esc(text).replace(/\{\{(.*?)\}\}/g, '<span class="cloze-answer">$1</span>'); }

  function endSession(sessionId, right, wrong, kind) {
    UI.modal({
      title: "Rate this session",
      sub: `${right} right · ${wrong} to review — F033`,
      size: "narrow",
      footer: "",
      body: `<div class="row gap-8" style="justify-content:center;padding:8px 0">
        ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="btn btn-lg" data-rate="${n}">${n}</button>`).join("")}
      </div>
      <p class="hint center">How focused did that session feel? 1 = distracted, 5 = deep focus.</p>`,
      onMount(root) {
        U.on(root, "click", "[data-rate]", (_e, el) => {
          S.rateSession(sessionId, Number(el.dataset.rate));
          UI.closeModal();
          UI.toast("Session complete", `${right} ${kind || "known"} · ${wrong} to review again`, "ok");
        });
      }
    });
  }

  function dueCards(deck) {
    const t = U.today();
    return deck.cards.filter((c) => !c.next || c.next <= t);
  }

  /* ------------------------------------------------------------- study -- */

  function startStudy(deckId, all) {
    const deck = S.byId("decks", deckId);
    if (!deck || !deck.cards.length) {
      UI.toast("Nothing to study", "This deck has no cards yet.", "warn");
      return;
    }
    const pool = all ? deck.cards.slice() : dueCards(deck);
    if (!pool.length) {
      UI.toast("All caught up! 🎉", "No cards are due in this deck today.", "ok");
      return;
    }
    // Shuffle so order doesn't become a memory cue.
    const queue = pool.map((c) => ({ deckId, cardId: c.id }));
    study = { deckId, queue, i: 0, flipped: false, right: 0, wrong: 0, sessionId: U.uid("sess") };
    App.router.refresh();
  }

  // F032 interleaved practice — round-robins due cards across every deck
  // into the same study flow, so consecutive cards rarely share a subject.
  function startInterleaved() {
    const due = S.dueCardsAcrossDecks(true);
    if (!due.length) { UI.toast("All caught up! 🎉", "No cards due across any deck.", "ok"); return; }
    const queue = due.map((c) => ({ deckId: c.deckId, cardId: c.id }));
    study = { deckId: null, queue, i: 0, flipped: false, right: 0, wrong: 0, sessionId: U.uid("sess") };
    App.router.refresh();
  }

  function studyCard() {
    const item = study.queue[study.i];
    const deck = S.byId("decks", item.deckId);
    return deck ? deck.cards.find((c) => c.id === item.cardId) : null;
  }

  function grade(known) {
    const card = studyCard();
    if (card) {
      card.box = known ? U.clamp((card.box || 1) + 1, 1, 5) : 1;
      card.next = U.dateKey(U.addDays(new Date(), INTERVALS[card.box]));
      card.lastReviewed = U.today();
    }
    if (known) study.right++; else study.wrong++;

    S.commit((db) => { db.streak.xp += known ? 3 : 1; });

    study.i += 1;
    study.flipped = false;
    if (study.i >= study.queue.length) {
      const { right, wrong, sessionId } = study;
      study = null;
      endSession(sessionId, right, wrong, "known");
    }
    App.router.refresh();
  }

  function studyHTML() {
    const card = studyCard();
    if (!card) { study = null; return render(); }
    const deck = S.byId("decks", study.queue[study.i].deckId);

    const pct = (study.i / study.queue.length) * 100;
    const frontText = card.cloze ? null : card.front;
    const backText = card.cloze ? null : card.back;

    return `<div class="page-inner" style="max-width:720px">
      <div class="page-head">
        <div>
          <h1>${study.deckId ? U.esc(deck.name) : "Interleaved study"}</h1>
          <div class="sub">Card ${study.i + 1} of ${study.queue.length} ·
            ${study.right} known · ${study.wrong} relearning
            ${!study.deckId ? ` · ${U.esc(deck ? deck.name : "")}` : ""}</div>
        </div>
        <button class="btn" data-quit>✕ End session</button>
      </div>

      <div class="bar mb-16"><i style="width:${U.round(pct, 1)}%"></i></div>

      <div class="flashcard ${study.flipped ? "flipped" : ""}" id="fcard" tabindex="0"
           role="button" aria-label="Flip card">
        <div class="flashcard-inner">
          <div class="flashcard-face">
            <span class="face-tag">${card.cloze ? "Cloze" : card.occlusion ? "Occlusion" : "Question"}</span>
            ${card.occlusion
              ? occlusionHTML(card, false)
              : `<span>${card.cloze ? clozeBlanked(card.text) : U.esc(frontText)}</span>`}
          </div>
          <div class="flashcard-face back">
            <span class="face-tag">Answer</span>
            ${card.occlusion
              ? occlusionHTML(card, true)
              : `<span>${card.cloze ? clozeRevealed(card.text) : U.esc(backText)}</span>`}
          </div>
        </div>
      </div>

      <div class="row gap-8 mt-8" style="justify-content:center">
        <button type="button" class="icon-btn" data-speak title="Read aloud" aria-label="Read card aloud">🔊</button>
      </div>

      <p class="center small dim mt-4">
        ${study.flipped ? "How well did you know it?" : "Click the card or press Space to flip"}
      </p>

      <div class="row gap-8 mt-12" style="justify-content:center">
        ${study.flipped ? `
          <button class="btn btn-lg" data-grade="0">😕 Again</button>
          <button class="btn btn-lg btn-primary" data-grade="1">✅ Got it</button>
        ` : `<button class="btn btn-lg btn-primary" data-flip>Flip card</button>`}
      </div>

      <div class="row gap-8 mt-16" style="justify-content:center">
        <span class="small dim">Box ${card.box || 1} of 5</span>
        <span class="box-pips">
          ${[1, 2, 3, 4, 5].map((b) => `<i class="box-pip ${(card.box || 1) >= b ? "on" : ""}"></i>`).join("")}
        </span>
      </div>
    </div>`;
  }

  // F028 image occlusion — regions are stored as % of the image box so they
  // scale with it. Hidden regions are grey tiles with a number; revealed
  // ones show their label.
  function occlusionHTML(card, revealed) {
    const src = card.imageDataUrl || "";
    return `<div class="occlusion-wrap">
      ${src ? `<img src="${U.esc(src)}" class="occlusion-img" alt="Diagram" />` : `<div class="dim small">No image</div>`}
      ${(card.regions || []).map((r, n) => `
        <div class="occlusion-region ${revealed ? "revealed" : ""}"
             style="left:${r.x}%;top:${r.y}%;width:${r.w}%;height:${r.h}%">
          ${revealed ? U.esc(r.label) : (n + 1)}
        </div>`).join("")}
    </div>`;
  }

  /* -------------------------------------------------------------- quiz -- */

  function startQuiz(deckId, mode) {
    const deck = S.byId("decks", deckId);
    if (!deck || deck.cards.length < (mode === "choice" ? 4 : 1)) {
      UI.toast("Not enough cards", mode === "choice"
        ? "Multiple choice needs at least 4 cards to build options."
        : "Add a card first.", "warn");
      return;
    }
    quiz = {
      deckId, mode,
      queue: deck.cards.map((c) => c.id).sort(() => Math.random() - 0.5),
      i: 0, answered: null, correct: 0, wrong: 0, choices: null
    };
    buildChoices();
    App.router.refresh();
  }

  // Three plausible distractors from the same deck, plus the right answer.
  function buildChoices() {
    if (!quiz || quiz.mode !== "choice") return;
    const deck = S.byId("decks", quiz.deckId);
    const card = deck.cards.find((c) => c.id === quiz.queue[quiz.i]);
    if (!card) return;
    const others = deck.cards
      .filter((c) => c.id !== card.id && c.back !== card.back)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
      .map((c) => c.back);
    quiz.choices = [card.back, ...others].sort(() => Math.random() - 0.5);
  }

  // Forgiving comparison — case, punctuation, and articles shouldn't fail you.
  function normalize(s) {
    return String(s || "").toLowerCase().trim()
      .replace(/[.,;:!?'"()\-–—]/g, "")
      .replace(/\b(the|a|an)\b/g, "")
      .replace(/\s+/g, " ");
  }

  function answerQuiz(value) {
    const deck = S.byId("decks", quiz.deckId);
    const card = deck.cards.find((c) => c.id === quiz.queue[quiz.i]);
    if (!card || quiz.answered) return;

    const right = normalize(value) === normalize(card.back);
    quiz.answered = { value, right, expected: card.back };
    if (right) quiz.correct++; else quiz.wrong++;

    // A quiz answer moves the Leitner box too — it's a real recall test.
    card.box = right ? U.clamp((card.box || 1) + 1, 1, 5) : 1;
    card.next = U.dateKey(U.addDays(new Date(), INTERVALS[card.box]));
    card.lastReviewed = U.today();
    S.commit((db) => { db.streak.xp += right ? 4 : 1; });
    App.router.refresh();
  }

  function nextQuiz() {
    quiz.i++;
    quiz.answered = null;
    if (quiz.i >= quiz.queue.length) {
      const { correct, wrong } = quiz;
      const pct = Math.round((correct / (correct + wrong || 1)) * 100);
      UI.toast(`Quiz complete — ${pct}%`, `${correct} right · ${wrong} wrong`, pct >= 80 ? "ok" : "warn");
      quiz = null;
    } else {
      buildChoices();
    }
    App.router.refresh();
  }

  function quizHTML() {
    const deck = S.byId("decks", quiz.deckId);
    const card = deck.cards.find((c) => c.id === quiz.queue[quiz.i]);
    if (!card) { quiz = null; return render(); }
    const pct = (quiz.i / quiz.queue.length) * 100;
    const a = quiz.answered;

    return `<div class="page-inner" style="max-width:680px">
      <div class="page-head">
        <div>
          <h1>${U.esc(deck.name)}</h1>
          <div class="sub">Question ${quiz.i + 1} of ${quiz.queue.length} ·
            ${quiz.correct} right · ${quiz.wrong} wrong</div>
        </div>
        <button class="btn" data-quit-quiz>✕ End quiz</button>
      </div>

      <div class="bar mb-16"><i style="width:${U.round(pct, 1)}%"></i></div>

      <div class="card mb-16">
        <div class="card-body center" style="padding:32px 24px">
          <div class="tiny dim mb-8" style="letter-spacing:.08em;text-transform:uppercase">Question</div>
          <div style="font-size:1.3rem;font-weight:650;line-height:1.4">${U.esc(card.front)}</div>
        </div>
      </div>

      ${quiz.mode === "choice" ? `
        <div class="col gap-8">
          ${quiz.choices.map((choice, n) => {
            let cls = "btn btn-lg btn-block", style = "justify-content:flex-start;text-align:left;height:auto;padding:14px 16px";
            if (a) {
              if (normalize(choice) === normalize(a.expected)) style += ";border-color:var(--ok);background:var(--ok-bg);color:var(--ok)";
              else if (choice === a.value) style += ";border-color:var(--danger);background:var(--danger-bg);color:var(--danger)";
              else style += ";opacity:.55";
            }
            return `<button class="${cls}" style="${style}" data-choice="${U.esc(choice)}" ${a ? "disabled" : ""}>
              <span class="kbd" style="margin-right:10px">${n + 1}</span>${U.esc(choice)}
            </button>`;
          }).join("")}
        </div>
      ` : `
        <div class="card">
          <div class="card-body">
            <div class="field">
              <label>Your answer</label>
              <input class="input" id="quizInput" ${a ? "disabled" : ""} autocomplete="off"
                     value="${a ? U.esc(a.value) : ""}" placeholder="Type it out…"
                     style="${a ? (a.right ? "border-color:var(--ok)" : "border-color:var(--danger)") : ""}" />
            </div>
            ${!a ? `<button class="btn btn-primary mt-12" data-submit-typed>Check answer</button>` : ""}
          </div>
        </div>
      `}

      ${a ? `<div class="card mt-16" style="border-left:3px solid var(--${a.right ? "ok" : "danger"})">
        <div class="card-body">
          <div class="bold" style="color:var(--${a.right ? "ok" : "danger"})">
            ${a.right ? "✓ Correct" : "✕ Not quite"}
          </div>
          ${!a.right ? `<div class="small mt-4">Answer: <strong>${U.esc(a.expected)}</strong></div>` : ""}
          <button class="btn btn-primary mt-12" data-next-quiz>
            ${quiz.i + 1 >= quiz.queue.length ? "Finish" : "Next question →"}
          </button>
        </div>
      </div>` : ""}
    </div>`;
  }

  /* --------------------------------------------------------- F031 test -- */

  function practiceTestSetup() {
    const decks = S.db.decks.filter((d) => d.cards.length >= 4);
    if (!decks.length) { UI.toast("Not enough cards", "A practice test needs at least one deck with 4+ cards.", "warn"); return; }
    UI.modal({
      title: "Practice test",
      sub: "Timed, mixed-deck, with a score report at the end",
      okLabel: "Start test",
      body: `<div class="form-grid">
        <div class="field">
          <label>Decks</label>
          <select class="select" name="deckId">
            <option value="">All decks</option>
            ${decks.map((d) => `<option value="${d.id}">${U.esc(d.name)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Time limit</label>
          <select class="select" name="minutes">
            <option value="5">5 minutes</option>
            <option value="10" selected>10 minutes</option>
            <option value="15">15 minutes</option>
          </select>
        </div>
      </div>`,
      onSubmit(d) { startTest(d.deckId || null, Number(d.minutes) || 10); }
    });
  }

  function startTest(deckId, minutes) {
    const pool = [];
    (deckId ? [S.byId("decks", deckId)] : S.db.decks).forEach((d) => {
      if (!d) return;
      d.cards.filter((c) => !c.occlusion).forEach((c) => pool.push({ deckId: d.id, cardId: c.id }));
    });
    if (pool.length < 4) { UI.toast("Not enough cards", "Need at least 4 non-occlusion cards.", "warn"); return; }
    const queue = U.sortBy(pool, () => Math.random() - 0.5).slice(0, 30);
    test = { queue, i: 0, correct: 0, wrong: 0, endsAt: Date.now() + minutes * 60000, answered: null, choices: null, sessionId: U.uid("sess") };
    buildTestChoices();
    App.router.refresh();
  }

  function testCard() {
    if (!test) return null;
    const item = test.queue[test.i];
    if (!item) return null;
    const deck = S.byId("decks", item.deckId);
    return deck ? deck.cards.find((c) => c.id === item.cardId) : null;
  }

  function buildTestChoices() {
    const card = testCard();
    if (!card) return;
    const allBacks = [];
    test.queue.forEach((item) => {
      const deck = S.byId("decks", item.deckId);
      const c = deck && deck.cards.find((x) => x.id === item.cardId);
      if (c && c.back && c.back !== card.back) allBacks.push(c.back);
    });
    const distractors = U.sortBy(allBacks, () => Math.random() - 0.5).slice(0, 3);
    test.choices = U.sortBy([card.back].concat(distractors), () => Math.random() - 0.5);
  }

  function answerTest(choice) {
    const card = testCard();
    if (!card || test.answered) return;
    const right = choice === card.back;
    test.answered = { choice, right };
    if (right) test.correct++; else test.wrong++;
    App.router.refresh();
  }

  function nextTest() {
    test.i++;
    test.answered = null;
    if (test.i >= test.queue.length || Date.now() >= test.endsAt) { finishTest(); return; }
    buildTestChoices();
    App.router.refresh();
  }

  function finishTest() {
    const { correct, wrong, sessionId } = test;
    const total = correct + wrong;
    const pct = total ? Math.round((correct / total) * 100) : 0;
    stopTestTimer();
    test = null;
    UI.toast(`Test complete — ${pct}%`, `${correct} right · ${wrong} wrong`, pct >= 70 ? "ok" : "warn");
    endSession(sessionId, correct, wrong, "correct");
    App.router.refresh();
  }
  function stopTestTimer() {
    if (testTimerHandle) { clearInterval(testTimerHandle); testTimerHandle = null; }
  }

  function testHTML() {
    const card = testCard();
    if (!card) { finishTest(); return render(); }
    const secsLeft = Math.max(0, Math.round((test.endsAt - Date.now()) / 1000));
    const mm = String(Math.floor(secsLeft / 60)).padStart(2, "0"), ss = String(secsLeft % 60).padStart(2, "0");
    const a = test.answered;

    return `<div class="page-inner" style="max-width:680px">
      <div class="page-head">
        <div>
          <h1>Practice test</h1>
          <div class="sub">Question ${test.i + 1} of ${test.queue.length} · ${test.correct} right · ${test.wrong} wrong</div>
        </div>
        <div class="row gap-8" style="align-items:center">
          <span class="badge ${secsLeft < 30 ? "danger" : ""}" id="testClock">⏱ ${mm}:${ss}</span>
          <button class="btn" data-quit-test>✕ End test</button>
        </div>
      </div>

      <div class="card mb-16"><div class="card-body center" style="padding:32px 24px">
        <div style="font-size:1.3rem;font-weight:650;line-height:1.4">${U.esc(card.front)}</div>
      </div></div>

      <div class="col gap-8">
        ${(test.choices || []).map((choice, n) => {
          let style = "justify-content:flex-start;text-align:left;height:auto;padding:14px 16px";
          if (a) {
            if (choice === card.back) style += ";border-color:var(--ok);background:var(--ok-bg);color:var(--ok)";
            else if (choice === a.choice) style += ";border-color:var(--danger);background:var(--danger-bg);color:var(--danger)";
            else style += ";opacity:.55";
          }
          return `<button class="btn btn-lg btn-block" style="${style}" data-test-choice="${U.esc(choice)}" ${a ? "disabled" : ""}>
            <span class="kbd" style="margin-right:10px">${n + 1}</span>${U.esc(choice)}
          </button>`;
        }).join("")}
      </div>

      ${a ? `<button class="btn btn-primary mt-16" data-next-test>${test.i + 1 >= test.queue.length ? "See results" : "Next →"}</button>` : ""}
    </div>`;
  }

  function mountTest(root) {
    U.on(root, "click", "[data-test-choice]", (_e, el) => answerTest(el.dataset.testChoice));
    U.on(root, "click", "[data-next-test]", nextTest);
    U.on(root, "click", "[data-quit-test]", () => { stopTestTimer(); test = null; App.router.refresh(); });
    if (!testTimerHandle) {
      testTimerHandle = setInterval(() => {
        if (!test) { stopTestTimer(); return; }
        if (Date.now() >= test.endsAt) { stopTestTimer(); finishTest(); return; }
        const clock = document.getElementById("testClock");
        if (!clock) return;
        const secsLeft = Math.max(0, Math.round((test.endsAt - Date.now()) / 1000));
        const mm = String(Math.floor(secsLeft / 60)).padStart(2, "0"), ss = String(secsLeft % 60).padStart(2, "0");
        clock.textContent = `⏱ ${mm}:${ss}`;
      }, 1000);
    }
  }

  /* ------------------------------------------------------------- forms -- */

  function deckForm(dk) {
    const d = dk || {};
    UI.modal({
      title: dk ? "Edit deck" : "New deck",
      okLabel: dk ? "Save" : "Create deck",
      body: `<div class="field mb-12">
          <label>Deck name</label>
          <input class="input" name="name" required value="${U.esc(d.name || "")}" placeholder="e.g. Bio — Cell Organelles" />
        </div>
        <div class="field">
          <label>Class</label>
          <select class="select" name="classId">${UI.classOptions(d.classId, true)}</select>
        </div>`,
      onSubmit(f) {
        if (!f.name.trim()) return false;
        if (dk) { S.update("decks", dk.id, { name: f.name.trim(), classId: f.classId || null }); UI.toast("Deck updated"); }
        else { S.insert("decks", { name: f.name.trim(), classId: f.classId || null, cards: [] }); UI.toast("Deck created", f.name, "ok"); }
      }
    });
  }

  function cardManager(deckId) {
    const deck = S.byId("decks", deckId);
    if (!deck) return;

    const row = (c) => `<div class="row gap-8" data-card="${c.id}" style="margin-bottom:8px">
        <input class="input grow" data-front value="${U.esc(c.front)}" placeholder="Front / question" />
        <span class="dim">→</span>
        <input class="input grow" data-back value="${U.esc(c.back)}" placeholder="Back / answer" />
        <span class="box-pips" title="Leitner box ${c.box || 1}">
          ${[1, 2, 3, 4, 5].map((b) => `<i class="box-pip ${(c.box || 1) >= b ? "on" : ""}"></i>`).join("")}
        </span>
        <button type="button" class="icon-btn" data-del-card aria-label="Remove card">✕</button>
      </div>`;

    UI.modal({
      title: "Cards",
      sub: `${deck.name} · ${U.plural(deck.cards.length, "card")}`,
      size: "wide",
      okLabel: "Save cards",
      body: `<div id="cardRows">${deck.cards.filter((c) => !c.cloze && !c.occlusion).map(row).join("")}</div>
        <div class="row gap-8">
          <button type="button" class="btn btn-sm" id="addCard">+ Add card</button>
          <button type="button" class="btn btn-sm" data-add-cloze="${deck.id}">+ Cloze card</button>
          <button type="button" class="btn btn-sm" data-add-occlusion="${deck.id}">+ Occlusion card</button>
        </div>
        ${deck.cards.some((c) => c.cloze || c.occlusion) ? `<div class="tiny dim mt-8">
          ${U.plural(deck.cards.filter((c) => c.cloze).length, "cloze card")} ·
          ${U.plural(deck.cards.filter((c) => c.occlusion).length, "occlusion card")} — edited separately</div>` : ""}
        <div class="divider"></div>
        <div class="field">
          <label>Bulk add <span class="hint">one card per line, front and back separated by a comma or tab</span></label>
          <textarea class="textarea" id="bulk" rows="3" placeholder="Mitochondria, powerhouse of the cell&#10;Ribosome, makes proteins"></textarea>
          <button type="button" class="btn btn-sm mt-4" id="doBulk">Add these</button>
        </div>`,
      onMount(root) {
        const box = root.querySelector("#cardRows");
        box.addEventListener("click", (e) => {
          const b = e.target.closest("[data-del-card]");
          if (b) b.closest("[data-card]").remove();
        });
        root.querySelector("#addCard").addEventListener("click", () => {
          box.insertAdjacentHTML("beforeend", row({ id: U.uid("c"), front: "", back: "", box: 1 }));
          const fronts = U.$$("[data-front]", box);
          fronts[fronts.length - 1].focus();
        });
        root.querySelector("[data-add-cloze]").addEventListener("click", () => { UI.closeModal(); clozeCardForm(deck.id); });
        root.querySelector("[data-add-occlusion]").addEventListener("click", () => { UI.closeModal(); occlusionCardForm(deck.id); });
        root.querySelector("#doBulk").addEventListener("click", () => {
          const text = root.querySelector("#bulk").value;
          const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
          let n = 0;
          lines.forEach((l) => {
            const parts = l.includes("\t") ? l.split("\t") : l.split(",");
            const front = (parts.shift() || "").trim();
            const back = parts.join(",").trim();
            if (!front || !back) return;
            box.insertAdjacentHTML("beforeend", row({ id: U.uid("c"), front, back, box: 1 }));
            n++;
          });
          root.querySelector("#bulk").value = "";
          UI.toast(`${n} card${n === 1 ? "" : "s"} staged`, "Press Save cards to keep them.");
        });
      },
      onSubmit(_f, root) {
        const plain = U.$$("[data-card]", root).map((r) => {
          const existing = deck.cards.find((c) => c.id === r.dataset.card);
          return {
            id: r.dataset.card,
            front: r.querySelector("[data-front]").value.trim(),
            back: r.querySelector("[data-back]").value.trim(),
            box: existing ? existing.box || 1 : 1,
            next: existing ? existing.next : U.today(),
            lastReviewed: existing ? existing.lastReviewed : null
          };
        }).filter((c) => c.front && c.back);
        // Cloze/occlusion cards are authored separately (F027/F028) — this
        // editor only rebuilds the plain front/back rows, so keep the rest.
        const special = deck.cards.filter((c) => c.cloze || c.occlusion);
        const next = special.concat(plain);
        S.update("decks", deck.id, { cards: next });
        UI.toast("Cards saved", `${next.length} in ${deck.name}`, "ok");
      }
    });
  }

  // F027 — a sentence with {{answers}} wrapped in double braces.
  function clozeCardForm(deckId) {
    UI.modal({
      title: "New cloze card",
      sub: "Wrap the part to hide in {{double braces}}",
      okLabel: "Add card",
      body: `<div class="field">
        <label>Text</label>
        <textarea class="textarea" name="text" rows="3" required
          placeholder="The powerhouse of the cell is the {{mitochondria}}."></textarea>
      </div>`,
      onSubmit(d) {
        if (!d.text.trim() || !/\{\{.+?\}\}/.test(d.text)) {
          UI.toast("Add a blank", "Wrap at least one answer in {{double braces}}.", "warn");
          return false;
        }
        S.addClozeCard(deckId, d.text.trim());
        UI.toast("Cloze card added", "", "ok");
        setTimeout(() => cardManager(deckId), 0);
      }
    });
  }

  // F028 — click-drag on the image to mark a region, label it, repeat.
  function occlusionCardForm(deckId) {
    let regions = [];
    let imageDataUrl = null;

    UI.modal({
      title: "New occlusion card",
      sub: "Upload a diagram, then drag boxes over the parts to hide",
      size: "wide",
      okLabel: "Add card",
      body: `<div class="field mb-12">
          <label>Image</label>
          <input class="input" type="file" id="occImg" accept="image/*" />
        </div>
        <div id="occStage" class="occlusion-wrap" style="min-height:120px;border:1px dashed var(--border);border-radius:var(--radius-sm)"></div>
        <p class="hint mt-8">Drag a box on the image, then name what it hides.</p>
        <div id="occList" class="mt-12"></div>`,
      onSubmit() {
        if (!imageDataUrl || !regions.length) {
          UI.toast("Add regions", "Upload an image and mark at least one region.", "warn");
          return false;
        }
        S.addOcclusionCard(deckId, null, regions);
        // addOcclusionCard doesn't take the image bytes directly — store them on the card.
        const deck = S.byId("decks", deckId);
        const card = deck.cards[deck.cards.length - 1];
        card.imageDataUrl = imageDataUrl;
        S.commit();
        UI.toast("Occlusion card added", `${regions.length} region(s)`, "ok");
        setTimeout(() => cardManager(deckId), 0);
      },
      onMount(root) {
        const stage = root.querySelector("#occStage");
        const list = root.querySelector("#occList");
        const redrawList = () => {
          list.innerHTML = regions.map((r, n) => `<div class="row gap-8 mb-6">
            <span class="badge">${n + 1}</span>
            <input class="input input-sm grow" value="${U.esc(r.label)}" data-region-label="${r.id}" placeholder="Label" />
            <button type="button" class="icon-btn btn-sm" data-del-region="${r.id}">✕</button>
          </div>`).join("");
        };
        const redrawStage = () => {
          stage.innerHTML = (imageDataUrl ? `<img src="${U.esc(imageDataUrl)}" class="occlusion-img" alt="Diagram" />` : "") +
            regions.map((r, n) => `<div class="occlusion-region" style="left:${r.x}%;top:${r.y}%;width:${r.w}%;height:${r.h}%">${n + 1}</div>`).join("");
        };

        root.querySelector("#occImg").addEventListener("change", (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => { imageDataUrl = reader.result; redrawStage(); };
          reader.readAsDataURL(file);
        });

        let dragStart = null;
        stage.addEventListener("mousedown", (e) => {
          const img = stage.querySelector(".occlusion-img");
          if (!img) return;
          const rect = img.getBoundingClientRect();
          dragStart = { x: e.clientX, y: e.clientY, rect };
        });
        stage.addEventListener("mouseup", (e) => {
          if (!dragStart) return;
          const rect = dragStart.rect;
          const x1 = U.clamp(((dragStart.x - rect.left) / rect.width) * 100, 0, 100);
          const y1 = U.clamp(((dragStart.y - rect.top) / rect.height) * 100, 0, 100);
          const x2 = U.clamp(((e.clientX - rect.left) / rect.width) * 100, 0, 100);
          const y2 = U.clamp(((e.clientY - rect.top) / rect.height) * 100, 0, 100);
          dragStart = null;
          const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
          if (w < 2 || h < 2) return;
          regions.push({ id: U.uid("rg"), x: Math.min(x1, x2), y: Math.min(y1, y2), w, h, label: "" });
          redrawStage(); redrawList();
        });

        list.addEventListener("click", (e) => {
          const b = e.target.closest("[data-del-region]");
          if (!b) return;
          regions = regions.filter((r) => r.id !== b.dataset.delRegion);
          redrawStage(); redrawList();
        });
        list.addEventListener("input", (e) => {
          const inp = e.target.closest("[data-region-label]");
          if (!inp) return;
          const r = regions.find((x) => x.id === inp.dataset.regionLabel);
          if (r) r.label = inp.value;
        });
      }
    });
  }

  /* ------------------------------------------------------------ render -- */

  function render() {
    if (quiz) return quizHTML();
    if (study) return studyHTML();
    if (test) return testHTML();

    const decks = S.db.decks;
    const totalCards = U.sum(decks, (d) => d.cards.length);
    const totalDue = U.sum(decks, (d) => dueCards(d).length);
    const mastered = U.sum(decks, (d) => d.cards.filter((c) => (c.box || 1) >= 5).length);
    const avgQ = S.avgSessionQuality();
    const bestHour = S.bestStudyHour();

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>Flashcards</h1>
          <div class="sub">${U.plural(totalCards, "card")} across ${U.plural(decks.length, "deck")} ·
            <strong>${totalDue} due today</strong>
            ${avgQ != null ? ` · avg focus ${U.round(avgQ, 1)}/5` : ""}
            ${bestHour != null ? ` · best around ${U.fmtTime(U.fromMin(bestHour * 60))}` : ""}</div>
        </div>
        <div class="page-actions">
          <button class="btn" data-interleave title="Round-robin due cards across every deck">🔀 Interleaved</button>
          <button class="btn" data-practice-test>⏱ Practice test</button>
          <button class="btn" data-import-deck>⇩ Import deck</button>
          <button class="btn btn-primary" data-new-deck>+ New deck</button>
        </div>
      </div>

      <div class="grid g-3 mb-16">
        <div class="stat accent">
          <div class="stat-ico">📅</div>
          <div class="stat-label">Due today</div>
          <div class="stat-value">${totalDue}</div>
          <div class="stat-foot">Scheduled by spaced repetition</div>
        </div>
        <div class="stat">
          <div class="stat-ico">🧠</div>
          <div class="stat-label">Mastered</div>
          <div class="stat-value">${mastered}</div>
          <div class="stat-foot">${totalCards ? U.round((mastered / totalCards) * 100) : 0}% of all cards (box 5)</div>
        </div>
        <div class="stat">
          <div class="stat-ico">🗂️</div>
          <div class="stat-label">Decks</div>
          <div class="stat-value">${decks.length}</div>
          <div class="stat-foot">${U.plural(totalCards, "card")} total</div>
        </div>
      </div>

      ${decks.length ? `<div class="grid g-2">${decks.map((d) => {
        const due = dueCards(d).length;
        const c = S.cls(d.classId);
        const avgBox = d.cards.length ? U.avg(d.cards, (x) => x.box || 1) : 0;
        return `<div class="card">
          <div class="card-body">
            <div class="between mb-8">
              <div style="min-width:0">
                <h3 class="truncate">${U.esc(d.name)}</h3>
                <div class="tiny dim row gap-6">
                  ${c ? `<i class="dot-badge" style="background:${U.esc(c.color)}"></i>${U.esc(c.name)}` : "No class"}
                  · ${U.plural(d.cards.length, "card")}
                </div>
              </div>
              ${due ? `<span class="badge danger">${due} due</span>` : `<span class="badge ok">Done</span>`}
            </div>

            <div class="tiny dim mb-4">Average mastery — box ${U.round(avgBox, 1)} of 5</div>
            <div class="bar mb-12"><i style="width:${U.round((avgBox / 5) * 100, 1)}%"></i></div>

            <div class="row gap-6 wrap">
              <button class="btn btn-sm btn-primary" data-study="${d.id}">▶ Study ${due ? `(${due})` : "all"}</button>
              <button class="btn btn-sm" data-quiz="${d.id}">🎯 Quiz</button>
              <button class="btn btn-sm" data-typed="${d.id}">⌨ Type</button>
              <button class="btn btn-sm" data-study-all="${d.id}">Cram</button>
              <button class="btn btn-sm" data-cards="${d.id}">Cards</button>
              <button class="btn btn-sm" data-export-deck="${d.id}" title="Export as a file">⇧ Export</button>
              <button class="btn btn-sm" data-edit-deck="${d.id}">Rename</button>
              <button class="btn btn-sm" data-del-deck="${d.id}">Delete</button>
            </div>
          </div>
        </div>`;
      }).join("")}</div>`
      : UI.emptyState("🃏", "No decks yet",
          "Flashcards use a Leitner box system — cards you get right come back less often, and ones you miss come back tomorrow.",
          `<button class="btn btn-primary" data-new-deck>+ Create your first deck</button>`)}
    </div>`;
  }

  function mount(root) {
    if (quiz) {
      U.on(root, "click", "[data-choice]", (_e, el) => answerQuiz(el.dataset.choice));
      U.on(root, "click", "[data-next-quiz]", nextQuiz);
      U.on(root, "click", "[data-quit-quiz]", () => { quiz = null; App.router.refresh(); });
      const input = root.querySelector("#quizInput");
      const submit = () => { if (input && input.value.trim()) answerQuiz(input.value); };
      if (input) {
        input.focus();
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); quiz.answered ? nextQuiz() : submit(); }
        });
      }
      U.on(root, "click", "[data-submit-typed]", submit);
      return;
    }

    if (study) {
      const card = root.querySelector("#fcard");
      if (card) {
        card.addEventListener("click", () => { study.flipped = !study.flipped; App.router.refresh(); });
        card.focus();
      }
      U.on(root, "click", "[data-flip]", () => { study.flipped = true; App.router.refresh(); });
      U.on(root, "click", "[data-grade]", (_e, el) => grade(el.dataset.grade === "1"));
      U.on(root, "click", "[data-quit]", () => { study = null; App.router.refresh(); });
      U.on(root, "click", "[data-speak]", () => {
        const c = studyCard();
        if (!c) return;
        speak(c.cloze ? c.text.replace(/\{\{|\}\}/g, "") : (study.flipped ? c.back : c.front));
      });
      return;
    }

    if (test) { mountTest(root); return; }

    U.on(root, "click", "[data-new-deck]", () => deckForm(null));
    U.on(root, "click", "[data-quiz]", (_e, el) => startQuiz(el.dataset.quiz, "choice"));
    U.on(root, "click", "[data-typed]", (_e, el) => startQuiz(el.dataset.typed, "typed"));
    U.on(root, "click", "[data-study]", (_e, el) => startStudy(el.dataset.study, false));
    U.on(root, "click", "[data-study-all]", (_e, el) => startStudy(el.dataset.studyAll, true));
    U.on(root, "click", "[data-interleave]", startInterleaved);
    U.on(root, "click", "[data-practice-test]", () => practiceTestSetup());
    U.on(root, "click", "[data-cards]", (_e, el) => cardManager(el.dataset.cards));
    U.on(root, "click", "[data-edit-deck]", (_e, el) => deckForm(S.byId("decks", el.dataset.editDeck)));
    U.on(root, "click", "[data-del-deck]", (_e, el) => {
      const d = S.byId("decks", el.dataset.delDeck);
      UI.confirm({
        title: "Delete deck?", message: `"${d.name}" and its ${d.cards.length} card(s) will be removed.`,
        okLabel: "Delete", danger: true,
        onConfirm() { S.remove("decks", d.id); UI.toast("Deck deleted", d.name, "warn"); }
      });
    });
    U.on(root, "click", "[data-export-deck]", (_e, el) => {
      const d = S.byId("decks", el.dataset.exportDeck);
      const json = S.exportDeck(d.id);
      U.download(`${d.name.replace(/[^\w\- ]/g, "")}.json`, json, "application/json");
    });
    U.on(root, "click", "[data-import-deck]", () => {
      const input = document.createElement("input");
      input.type = "file"; input.accept = "application/json,.json";
      input.addEventListener("change", () => {
        const file = input.files[0];
        if (!file) return;
        file.text().then((text) => {
          const deck = S.importDeck(text);
          UI.toast("Deck imported", `${deck.name} · ${deck.cards.length} cards`, "ok");
          App.router.refresh();
        }).catch((err) => UI.toast("Import failed", err.message, "danger"));
      });
      input.click();
    });
  }

  // Space flips, 1/2 grade — only while a study session is open.
  // In quiz mode, number keys pick an option and Enter advances.
  function onKey(e) {
    if (quiz) {
      if (e.key === "Escape") { quiz = null; App.router.refresh(); return true; }
      if (quiz.answered && (e.key === "Enter" || e.key === " ")) { nextQuiz(); return true; }
      if (!quiz.answered && quiz.mode === "choice" && /^[1-4]$/.test(e.key)) {
        const pick = quiz.choices[Number(e.key) - 1];
        if (pick) { answerQuiz(pick); return true; }
      }
      return false;
    }
    if (!study) return false;
    if (e.key === " " || e.key === "Enter") {
      study.flipped = !study.flipped; App.router.refresh(); return true;
    }
    if (study.flipped && (e.key === "1" || e.key === "2")) {
      grade(e.key === "2"); return true;
    }
    if (e.key === "Escape") { study = null; App.router.refresh(); return true; }
    return false;
  }

  return { render, mount, onKey, title: "Flashcards" };
})();
