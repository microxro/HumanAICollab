/* ==========================================================================
   views/flashcards.js — decks + Leitner-box spaced repetition study mode
   ========================================================================== */

App.views.flashcards = (function () {
  const U = App.utils, S = App.store, UI = App.ui;

  // Leitner intervals in days, indexed by box (1 = hardest, 5 = mastered).
  const INTERVALS = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 16 };

  let study = null;   // { deckId, queue: [cardId], i, flipped }
  let quiz = null;    // { deckId, mode:'choice'|'typed', queue, i, choices, answered, correct }

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
    const queue = pool.map((c) => c.id).sort(() => Math.random() - 0.5);
    study = { deckId, queue, i: 0, flipped: false, right: 0, wrong: 0 };
    App.router.refresh();
  }

  function grade(known) {
    const deck = S.byId("decks", study.deckId);
    const card = deck.cards.find((c) => c.id === study.queue[study.i]);
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
      const { right, wrong } = study;
      UI.toast("Deck complete! 🎉", `${right} known · ${wrong} to review again`, "ok");
      study = null;
    }
    App.router.refresh();
  }

  function studyHTML() {
    const deck = S.byId("decks", study.deckId);
    const card = deck.cards.find((c) => c.id === study.queue[study.i]);
    if (!card) { study = null; return render(); }

    const pct = (study.i / study.queue.length) * 100;

    return `<div class="page-inner" style="max-width:720px">
      <div class="page-head">
        <div>
          <h1>${U.esc(deck.name)}</h1>
          <div class="sub">Card ${study.i + 1} of ${study.queue.length} ·
            ${study.right} known · ${study.wrong} relearning</div>
        </div>
        <button class="btn" data-quit>✕ End session</button>
      </div>

      <div class="bar mb-16"><i style="width:${U.round(pct, 1)}%"></i></div>

      <div class="flashcard ${study.flipped ? "flipped" : ""}" id="fcard" tabindex="0"
           role="button" aria-label="Flip card">
        <div class="flashcard-inner">
          <div class="flashcard-face">
            <span class="face-tag">Question</span>
            <span>${U.esc(card.front)}</span>
          </div>
          <div class="flashcard-face back">
            <span class="face-tag">Answer</span>
            <span>${U.esc(card.back)}</span>
          </div>
        </div>
      </div>

      <p class="center small dim mt-12">
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
      body: `<div id="cardRows">${deck.cards.map(row).join("")}</div>
        <button type="button" class="btn btn-sm" id="addCard">+ Add card</button>
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
        const next = U.$$("[data-card]", root).map((r) => {
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
        S.update("decks", deck.id, { cards: next });
        UI.toast("Cards saved", `${next.length} in ${deck.name}`, "ok");
      }
    });
  }

  /* ------------------------------------------------------------ render -- */

  function render() {
    if (quiz) return quizHTML();
    if (study) return studyHTML();

    const decks = S.db.decks;
    const totalCards = U.sum(decks, (d) => d.cards.length);
    const totalDue = U.sum(decks, (d) => dueCards(d).length);
    const mastered = U.sum(decks, (d) => d.cards.filter((c) => (c.box || 1) >= 5).length);

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>Flashcards</h1>
          <div class="sub">${U.plural(totalCards, "card")} across ${U.plural(decks.length, "deck")} ·
            <strong>${totalDue} due today</strong></div>
        </div>
        <div class="page-actions">
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
      return;
    }

    U.on(root, "click", "[data-new-deck]", () => deckForm(null));
    U.on(root, "click", "[data-quiz]", (_e, el) => startQuiz(el.dataset.quiz, "choice"));
    U.on(root, "click", "[data-typed]", (_e, el) => startQuiz(el.dataset.typed, "typed"));
    U.on(root, "click", "[data-study]", (_e, el) => startStudy(el.dataset.study, false));
    U.on(root, "click", "[data-study-all]", (_e, el) => startStudy(el.dataset.studyAll, true));
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
