/* ==========================================================================
   views/shop.js — earn study tokens from the work StudyHold measured and from
   a photo of the work it couldn't, then spend them across four tiers.

   Two tabs on one screen, because they are two halves of the same loop: what
   you did, and what it bought. The economy itself (what a photo is worth, why
   a photo was refused, what is for sale) lives in js/shop.js — this file is
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
    if (wait > 0) return { kind: "warn", text: `Next photo in ${wait} minute${wait === 1 ? "" : "s"}.` };
    if (left === 0) return { kind: "warn", text: `You've hit today's ${SH.RULES.dailyCap}-token cap. Photos still log as study time.` };
    return { kind: "ok", text: `${left} token${left === 1 ? "" : "s"} still available today.` };
  }

  /* -------------------------------------------------------- earning form --

     Two stages in one dialog, because they are two halves of one decision:
     show the work, then answer for it.

       1. pick a photo → the local checks (blank, already-spent) run first,
          because they are free and a duplicate should never cost an API call
       2. the model says whether it is schoolwork and writes a quiz about it
       3. answering the quiz is what earns the tokens

     Stage 2 replaces the body of the same modal rather than opening a second
     one, so the photo stays on screen next to the questions and Escape means
     the same thing throughout.                                              */

  /** Is the graded path available at all right now? */
  function canVerify() {
    return !!(App.assistant && App.assistant.available && App.assistant.available());
  }

  function proofForm() {
    const rules = SH.RULES;
    const verified = canVerify();

    // Without the AI there is no quiz, so there is no payout — the photo is
    // still worth recording as study time, and that needs a duration from
    // somewhere. Self-reported minutes are fine for a log; they were only
    // dangerous as a price, which is why this input exists on this path and
    // nowhere else.
    const unverifiedFields = `
        <div class="field">
          <label for="proofMinutes">Minutes studied</label>
          <input class="input" type="number" id="proofMinutes" name="minutes"
                 min="${rules.minMinutes}" max="${rules.maxMinutes}" step="1" value="30" required />
          <span class="hint">Logged as study time. No tokens — those need the quiz.</span>
        </div>`;

    UI.modal({
      title: "Log a study photo",
      sub: verified ? "Photograph the work, then answer a few questions about it"
                    : "Photograph the work — tokens need a connection",
      size: "wide",
      okLabel: verified ? "Check this photo" : "Log it",
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
          ${verified ? "" : unverifiedFields}
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

        <p class="small dim mt-12" data-quote>${verified
          ? `A full-marks quiz pays ${rules.grades.A} tokens, ${rules.grades.B} for most of it,
             ${rules.grades.C} for half. Below half pays nothing, and still logs the time.`
          : `You're offline or signed out, so there's no quiz to answer — this saves as study
             time and earns nothing.`}</p>

        <p class="proof-error small mt-12" data-proof-error hidden role="alert"></p>`,

      onMount(root) {
        const file = root.querySelector("[data-proof-file]");
        const drop = root.querySelector("[data-drop]");
        const wrap = root.querySelector("[data-preview-wrap]");
        const img = root.querySelector("[data-preview]");
        const note = root.querySelector("[data-preview-note]");
        const err = root.querySelector("[data-proof-error]");

        const showError = (msg) => {
          err.textContent = msg;
          err.hidden = false;
        };
        const clearError = () => { err.hidden = true; err.textContent = ""; };

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
        const meta = { classId: d.classId, note: d.note };

        if (!canVerify()) {
          UI.busy(btn, SH.submit({ file: f, minutes: d.minutes, ...meta }))
            .then((res) => {
              UI.closeModal();
              UI.toast("Logged, no tokens",
                "Tokens need the quiz, and that needs a connection. The study time still counts.");
              App.router.refresh();
            })
            .catch((e) => {
              err.textContent = e.message || "That photo couldn't be saved.";
              err.hidden = false;
            });
          return false;
        }

        // The free checks run before the paid one. A duplicate, a blank frame
        // or an unexpired cooldown are all refusals this device can make on
        // its own, and none of them should cost an API call or make a student
        // answer four questions before being told no.
        UI.busy(btn, SH.inspect(f).then((info) => {
          const wait = SH.cooldownLeft();
          if (wait > 0) {
            throw new Error(`Next photo in ${wait} minute${wait === 1 ? "" : "s"}. Study happens between submissions, not during them.`);
          }
          if (info.blank) {
            throw new Error("That photo is almost entirely one flat colour — photograph the actual work, not a wall or a blank screen.");
          }
          if (info.duplicate) {
            throw new Error("You've already earned tokens for this photo. Take a new one of what you did this time.");
          }
          // One quiz per photo. Without this, failing and closing the dialog
          // costs nothing and the next submission of the same page gets a
          // fresh set of questions — which is guessing with unlimited tries.
          if (SH.triedBefore(info.hash)) {
            throw new Error("This photo has already had its questions. Take a new photo of what you did, or spend a retake.");
          }
          return App.assistant.verifyStudyPhoto(f, info.hash).then((verdict) => {
            // Marked when the questions are about to go on screen, not when
            // they're answered: closing the dialog is not a way to un-ask them.
            if (verdict && verdict.schoolwork === true) SH.markTried(info.hash);
            return verdict;
          });
        }))
          .then((verdict) => {
            if (!verdict || verdict.schoolwork !== true) {
              // Not an error state: the student did something the app can't
              // pay for, and the useful thing is the reason plus the picker
              // still being open.
              err.textContent = (verdict && verdict.reason)
                || "That doesn't look like schoolwork. Photograph the work you actually did.";
              err.hidden = false;
              return;
            }
            quizStage(f, meta, verdict);
          })
          .catch((e) => {
            err.textContent = e.message || "That photo couldn't be checked.";
            err.hidden = false;
          });

        return false;   // the async path opens the quiz or closes the modal
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
   * `verdict` is the classify response — questions with no answers in them,
   * plus the ticket that carries the key server-side.
   */
  function quizStage(file, meta, verdict) {
    const qs = verdict.questions || [];
    const fifties = SH.held("fifty");

    UI.modal({
      title: `${verdict.subject || "Study"} — ${qs.length} questions`,
      sub: "Answer these to earn the tokens. The answers are checked on the server.",
      size: "wide",
      okLabel: "Submit answers",
      body: `
        <p class="small dim">${U.esc(verdict.reason || "")}</p>
        <div class="quiz-list mt-12">${qs.map(questionHtml).join("")}</div>
        <div class="row gap-8 mt-12" data-fifty-row ${fifties ? "" : "hidden"}>
          <button type="button" class="btn btn-sm" data-fifty>
            Use a 50/50 <span class="dim">(${fifties} left)</span>
          </button>
          <span class="tiny dim">Removes two wrong options from the first question you haven't answered.</span>
        </div>
        <p class="proof-error small mt-12" data-quiz-error hidden role="alert"></p>`,

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
        UI.busy(btn, App.assistant.gradeStudyQuiz(verdict.ticket, answers))
          .then((graded) => {
            const scored = { ...graded, subject: verdict.subject };
            if (graded.tokens > 0) return finish(file, meta, scored);
            // A zero is the one place a retake is worth offering, and it has
            // to be offered before the proof saves: saving spends the photo's
            // fingerprint, and a spent photo can't be re-checked.
            failedStage(file, meta, scored);
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
  function failedStage(file, meta, graded) {
    const retakes = SH.held("retake");

    UI.modal({
      title: `${graded.correct} of ${graded.total} — no tokens`,
      sub: "The study time still counts. The tokens don't.",
      size: "wide",
      body: `
        <p class="small">Half the questions right is the line, and this was under it.
          Nothing is lost: the photo and the session save either way.</p>
        ${retakes
          ? `<p class="small mt-12">You have ${retakes} retake${retakes === 1 ? "" : "s"}.
             Spending one asks for a fresh set of questions about the same photo —
             different questions, not the same ones again.</p>`
          : `<p class="small dim mt-12">A retake from the shop would buy a fresh set of
             questions about this photo. You don't have one.</p>`}
        <p class="proof-error small mt-12" data-retake-error hidden role="alert"></p>`,
      footer: `
        ${retakes ? `<button type="button" class="btn btn-primary left" data-retake>Use a retake</button>` : ""}
        <button type="button" class="btn" data-save-anyway>Save without tokens</button>`,

      onMount(root) {
        const err = root.querySelector("[data-retake-error]");
        root.querySelector("[data-save-anyway]").addEventListener("click", () => {
          finish(file, meta, graded);
        });

        const btn = root.querySelector("[data-retake]");
        if (!btn) return;
        btn.addEventListener("click", () => {
          if (!SH.spendHeld("retake")) {
            err.textContent = "That retake is already spent.";
            err.hidden = false;
            return;
          }
          UI.busy(btn, SH.inspect(file).then((info) => App.assistant.verifyStudyPhoto(file, info.hash)))
            .then((verdict) => {
              if (!verdict || verdict.schoolwork !== true) {
                err.textContent = (verdict && verdict.reason) || "That photo couldn't be checked again.";
                err.hidden = false;
                return;
              }
              quizStage(file, meta, verdict);
            })
            .catch((e) => {
              err.textContent = e.message || "That photo couldn't be checked again.";
              err.hidden = false;
            });
        });
      }
    });
  }

  /** Write the proof, whatever it turned out to be worth. */
  function finish(file, meta, graded) {
    return SH.submit({ file, verdict: graded, ...meta })
      .then((res) => {
        UI.closeModal();
        if (res.awarded > 0) {
          UI.toast(`+${res.awarded} token${res.awarded === 1 ? "" : "s"} 🎉`,
            `Grade ${graded.grade} · ${U.fmtDur(res.proof.minutes)} logged` +
            (res.capped ? " — trimmed by today's cap." : "."), "ok");
        } else {
          UI.toast("Logged, no tokens",
            SH.remainingToday() === 0
              ? `Today's ${SH.RULES.dailyCap}-token cap is reached, but the study time still counts.`
              : `${graded.correct} of ${graded.total} isn't enough for tokens, but the study time counts.`);
        }
        App.router.refresh();
      })
      .catch((e) => {
        UI.closeModal();
        UI.toast("That photo couldn't be saved", e.message || "", "warn");
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
    const st = statusLine();
    const rules = SH.RULES;
    const rates = SH.RATES;
    const boost = SH.activeBoost();
    // Photos themselves are discarded right after they pay out — there's no
    // gallery any more — so "how much photo-verified study have I done"
    // reads off the study sessions they wrote, not the photos.
    const proofSessions = SH.proofSessions();
    const week = U.sum(proofSessions.filter((p) => p.date >= U.dateKey(U.addDays(new Date(), -6))), (p) => p.minutes);

    return `<div class="grid g-main">
      <div class="card">
        <div class="card-head">
          <div><h3>Show your work</h3><div class="sub">A photo of it, and a few questions about it</div></div>
          <span class="badge ${st.kind}">${U.esc(st.text)}</span>
        </div>
        <div class="card-body col gap-16">
          <button class="btn btn-primary btn-lg btn-block" data-add-proof>📷 Add a study photo</button>
          ${SH.cooldownLeft() > 0 && SH.held("skip") > 0
            ? `<button class="btn btn-block" data-skip-cooldown>⏩ Skip the wait
                 <span class="dim">(${SH.held("skip")} banked)</span></button>`
            : ""}

          <div>
            <h4 class="mb-8">How a photo pays</h4>
            <ul class="earn-rules">
              <li>The photo has to be schoolwork. A screenshot of something else is read,
                  refused, and told why.</li>
              <li>Then a few questions about that page — <strong>full marks pays
                  ${rules.grades.A}</strong>, most of them ${rules.grades.B}, half ${rules.grades.C}.
                  Under half pays nothing and still logs the time.</li>
              <li>+${rules.firstOfDayBonus} for the first photo of the day. ${rules.dailyCap} tokens is the daily ceiling <em>for photos</em>.</li>
              <li>${rules.cooldownMin} minutes between photos.</li>
              <li>The same photo never pays twice — every one is fingerprinted before it counts,
                  and deleting it doesn't reset that.</li>
              <li>Every photo also lands in your study log, so it counts toward the heatmap and your weekly goal.</li>
            </ul>
          </div>

          <div>
            <h4 class="mb-8">…and what pays without one</h4>
            <p class="tiny dim mt-0 mb-8">No photo, no cap, no cooldown: the app watched these happen,
              so there is no claim to check.</p>
            <ul class="earn-rules">
              <li><strong>${rates.focusPerMin} per minute</strong> of a focus block, +${rates.focusBlockBonus} for letting it
                  run to the end — ${rates.focusPerMin * 25 + rates.focusBlockBonus} for a finished 25-minute block.</li>
              <li><strong>${rates.assignmentDone}</strong> for finishing an assignment, +${rates.assignmentEarly} if it wasn't late.
                  Paid once per assignment, however often it's reopened.</li>
              <li><strong>${rates.streakDay} a day</strong> for keeping your streak, +${rates.streakWeekBonus} every seventh day.</li>
              <li><strong>${rates.flashcardCard} per card</strong> reviewed, <strong>${rates.readingSession}</strong> per reading session,
                  <strong>${rates.habitCheck}</strong> per habit ticked, <strong>${rates.goalComplete}</strong> for reaching a goal.</li>
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
            <span class="bold nums">${proofSessions.length}</span>
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
        : `<div class="card-body"><p class="dim small">Nothing yet — finish a focus block, or add a photo above.</p></div>`}
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
          <div class="sub">Photograph the work you did, earn tokens, spend them on how StudyHold looks.</div>
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
          <div class="stat-foot">${U.plural(SH.proofSessions().length, "photo")}</div>
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
    U.on(root, "click", "[data-add-proof]", proofForm);
    U.on(root, "click", "[data-skip-cooldown]", () => {
      const r = SH.skipCooldown();
      if (!r.ok) { UI.toast("Can't skip that", r.error, "warn"); return; }
      UI.toast("Wait skipped", "Photograph the next thing now.", "ok");
      App.router.refresh();
    });
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

  return { render, mount, proofForm, title: "Study shop" };
})();
