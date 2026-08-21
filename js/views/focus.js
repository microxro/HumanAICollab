/* ==========================================================================
   views/focus.js — Pomodoro focus timer + study session log
   ========================================================================== */

App.views.focus = (function () {
  const U = App.utils, S = App.store, UI = App.ui, C = App.charts;

  // Timer state lives outside render() so it survives view re-renders and
  // keeps running while you browse other tabs.
  const timer = {
    phase: "focus",        // focus | short | long
    remaining: null,       // seconds
    running: false,
    round: 1,
    classId: null,
    handle: null,
    endsAt: null
  };

  function cfg() { return S.settings.pomodoro; }

  function phaseSeconds(phase) {
    const c = cfg();
    return (phase === "focus" ? c.focus : phase === "short" ? c.short : c.long) * 60;
  }

  function ensure() {
    if (timer.remaining == null) timer.remaining = phaseSeconds(timer.phase);
  }

  function tick() {
    if (!timer.running) return;
    timer.remaining = Math.max(0, Math.round((timer.endsAt - Date.now()) / 1000));
    paint();
    if (timer.remaining <= 0) complete();
  }

  function start() {
    ensure();
    timer.running = true;
    timer.endsAt = Date.now() + timer.remaining * 1000;
    clearInterval(timer.handle);
    timer.handle = setInterval(tick, 250);
    paint();
  }

  function pause() {
    timer.running = false;
    clearInterval(timer.handle);
    paint();
  }

  function reset() {
    pause();
    timer.remaining = phaseSeconds(timer.phase);
    paint();
  }

  function setPhase(phase) {
    pause();
    timer.phase = phase;
    timer.remaining = phaseSeconds(phase);
    paint();
  }

  /**
   * @param {boolean} skipped true when the person pressed ⏭ rather than
   *   letting the block run out.
   *
   * Skipping used to call complete() unchanged, which logged a full block at
   * cfg().focus minutes and awarded the XP regardless of elapsed time — so
   * Start then immediately Skip banked a 25-minute study session, repeatable
   * as fast as you can click. Only the time actually spent is credited now,
   * and a block under a minute isn't recorded at all.
   */
  function complete(skipped) {
    pause();
    const finished = timer.phase;

    const planned = cfg().focus;
    const elapsedMin = skipped
      ? Math.floor((phaseSeconds("focus") - timer.remaining) / 60)
      : planned;

    if (finished === "focus" && elapsedMin < 1) {
      // Skipped almost immediately: nothing worth recording, and saying
      // "Break over" here would be plainly wrong.
      timer.phase = "focus";
      timer.remaining = phaseSeconds("focus");
      UI.toast("Skipped", "Nothing logged — that block was under a minute.");
      App.router.refresh();
      return;
    }

    if (finished === "focus") {
      // Log the focus block as a real study session, for the time spent.
      S.commit((db) => {
        db.studySessions.push({
          id: U.uid("ss"), classId: timer.classId || null,
          date: U.today(), minutes: elapsedMin, kind: "focus"
        });
        // XP in proportion, so a skipped block can't out-earn a finished one.
        db.streak.xp += Math.max(1, Math.round(25 * (elapsedMin / Math.max(1, planned))));
      });
      const next = timer.round % cfg().rounds === 0 ? "long" : "short";
      timer.round += 1;
      timer.phase = next;
      timer.remaining = phaseSeconds(next);
      // F075 — a break nudge is still shown (you need to know time's up),
      // but the audible ping is skipped during quiet hours.
      UI.toast(skipped ? "Block ended early" : "Focus block complete! 🎉",
        `${elapsedMin} minute${elapsedMin === 1 ? "" : "s"} logged${timer.classId ? " to " + S.className(timer.classId) : ""}. ` +
        `Time for a ${next === "long" ? "long" : "short"} break.`, "ok");
      if (!App.notify.inQuietHours()) ping();
    } else {
      timer.phase = "focus";
      timer.remaining = phaseSeconds("focus");
      UI.toast("Break over", "Ready for another focus block?");
      if (!App.notify.inQuietHours()) ping();
    }
    App.router.refresh();
  }

  // Short tone via WebAudio — no asset files needed.
  function ping() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 660;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
      osc.start();
      osc.stop(ctx.currentTime + 0.62);
      setTimeout(() => ctx.close(), 900);
    } catch (e) { /* audio is a nicety, never a failure */ }
  }

  // Update just the clock + ring in place, so the timer stays smooth.
  function paint() {
    const face = document.querySelector("#timerFace");
    if (!face) return;
    ensure();
    face.textContent = U.clock(timer.remaining);

    const total = phaseSeconds(timer.phase);
    const pct = total ? ((total - timer.remaining) / total) * 100 : 0;
    const prog = document.querySelector("#timerRing .prog");
    if (prog) {
      const r = Number(prog.getAttribute("r"));
      const circ = 2 * Math.PI * r;
      prog.setAttribute("stroke-dasharray", U.round(circ, 2));
      prog.setAttribute("stroke-dashoffset", U.round(circ * (1 - pct / 100), 2));
    }
    const ring = document.querySelector("#timerRing");
    if (ring) ring.classList.toggle("break", timer.phase !== "focus");

    const btn = document.querySelector("#timerToggle");
    if (btn) btn.textContent = timer.running ? "⏸ Pause" : "▶ Start";

    document.title = timer.running
      ? `${U.clock(timer.remaining)} · ${timer.phase === "focus" ? "Focus" : "Break"} — Scholar`
      : "Scholar — School Tracker";
  }

  /* ------------------------------------------------------------ render -- */

  function render() {
    ensure();
    const total = phaseSeconds(timer.phase);
    const pct = total ? ((total - timer.remaining) / total) * 100 : 0;
    const size = 260, stroke = 14;
    const r = (size - stroke) / 2;
    const circ = 2 * Math.PI * r;

    const byDay = S.studyByDay(28);
    const week = S.studyThisWeek();
    const sessions = U.sortBy(S.db.studySessions, (s) => s.date, true).slice(0, 12);
    const goalMin = (S.db.goals.find((g) => g.metric === "study") || {}).target || 480;

    // Study minutes per class — labeled bars, so identity never rests on color.
    const perClass = S.db.classes.map((c) => ({
      label: c.name, color: c.color,
      value: U.sum(S.db.studySessions.filter((s) => s.classId === c.id), (x) => x.minutes)
    })).filter((r2) => r2.value > 0).sort((a, b) => b.value - a.value);

    return `<div class="page-inner">
      <div class="page-head">
        <div>
          <h1>${App.i18n.t("focus", "Focus timer")}</h1>
          <div class="sub">${U.fmtDur(week)} studied this week ·
            ${U.round(U.clamp((week / goalMin) * 100, 0, 999))}% of your ${U.fmtDur(goalMin)} goal</div>
        </div>
        <div class="page-actions">
          <button class="btn" data-settings>⚙ Timer settings</button>
        </div>
      </div>

      <div class="grid g-main">
        <div class="card">
          <div class="card-body center col gap-16" style="align-items:center;padding:32px 20px">
            <div class="segmented">
              <button class="${timer.phase === "focus" ? "active" : ""}" data-phase="focus">Focus ${cfg().focus}m</button>
              <button class="${timer.phase === "short" ? "active" : ""}" data-phase="short">Short ${cfg().short}m</button>
              <button class="${timer.phase === "long"  ? "active" : ""}" data-phase="long">Long ${cfg().long}m</button>
            </div>

            <div class="ring-wrap" style="width:${size}px;height:${size}px">
              <svg id="timerRing" width="${size}" height="${size}" class="timer-ring ${timer.phase !== "focus" ? "break" : ""}" aria-hidden="true">
                <circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" />
                <circle class="prog"  cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"
                        stroke-dasharray="${U.round(circ, 2)}" stroke-dashoffset="${U.round(circ * (1 - pct / 100), 2)}" />
              </svg>
              <span class="ring-label col gap-4" style="position:absolute">
                <span class="timer-face" id="timerFace">${U.clock(timer.remaining)}</span>
                <span class="small dim">Round ${timer.round} of ${cfg().rounds}</span>
              </span>
            </div>

            <div class="row gap-8">
              <button class="btn btn-lg btn-primary" id="timerToggle">${timer.running ? "⏸ Pause" : "▶ Start"}</button>
              <button class="btn btn-lg" data-reset>↺ Reset</button>
              <button class="btn btn-lg" data-skip>⏭ Skip</button>
            </div>

            <div class="field" style="max-width:300px;width:100%">
              <label class="center">Studying for</label>
              <select class="select" id="focusClass">
                <option value="">— No specific class —</option>
                ${S.db.classes.map((c) => `<option value="${c.id}" ${c.id === timer.classId ? "selected" : ""}>${U.esc(c.name)}</option>`).join("")}
              </select>
            </div>

            <p class="tiny dim center" style="max-width:340px">
              Completed focus blocks are logged automatically and count toward your weekly study goal and streak.
            </p>
          </div>
        </div>

        <div class="col gap-16">
          <div class="grid g-2">
            <div class="stat">
              <div class="stat-label">This week</div>
              <div class="stat-value" style="font-size:1.4rem">${U.fmtDur(week)}</div>
              <div class="bar thin mt-8"><i style="width:${U.clamp((week / goalMin) * 100, 0, 100)}%"></i></div>
            </div>
            <div class="stat">
              <div class="stat-label">All-time XP</div>
              <div class="stat-value" style="font-size:1.4rem">${S.db.streak.xp}</div>
              <div class="stat-foot">${S.db.streak.count}-day streak 🔥</div>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h3>Study activity</h3><span class="sub">Last 4 weeks</span></div>
            <div class="card-body">${C.heatmap(byDay)}</div>
          </div>

          <div class="card">
            <div class="card-head"><h3>Time by class</h3></div>
            <div class="card-body">
              ${perClass.length ? C.hbars(perClass, { fmt: (v) => U.fmtDur(v) })
                : `<p class="dim small">Run a focus block with a class selected to see this.</p>`}
            </div>
          </div>
        </div>
      </div>

      <div class="card mt-16">
        <div class="card-head">
          <h3>Recent sessions</h3>
          <button class="btn btn-sm" data-log>+ Log a session manually</button>
        </div>
        ${sessions.length ? `<div class="list">${sessions.map((s) => {
          const c = S.cls(s.classId);
          return `<div class="list-item">
            <i class="dot-badge" style="background:${U.esc(c ? c.color : "#94a3b8")}"></i>
            <span class="grow">
              <div class="title">${U.esc(c ? c.name : "General study")}</div>
              <div class="meta">${U.esc(U.fmtDate(s.date, "day"))} · ${U.esc(s.kind)}</div>
            </span>
            <span class="badge">${U.fmtDur(s.minutes)}</span>
            <button class="icon-btn btn-sm" data-del-ss="${s.id}" aria-label="Delete session">✕</button>
          </div>`;
        }).join("")}</div>` : UI.emptyState("studySessions", "No study sessions yet", "Start a focus block to log your first one.")}
      </div>
    </div>`;
  }

  function settingsForm() {
    const c = cfg();
    UI.modal({
      title: "Timer settings",
      okLabel: "Save",
      body: `<div class="form-grid">
        <div class="field"><label>Focus length (min)</label>
          <input class="input" type="number" name="focus" min="1" max="120" value="${c.focus}" /></div>
        <div class="field"><label>Short break (min)</label>
          <input class="input" type="number" name="short" min="1" max="60" value="${c.short}" /></div>
        <div class="field"><label>Long break (min)</label>
          <input class="input" type="number" name="long" min="1" max="60" value="${c.long}" /></div>
        <div class="field"><label>Rounds before long break</label>
          <input class="input" type="number" name="rounds" min="1" max="12" value="${c.rounds}" /></div>
      </div>`,
      onSubmit(d) {
        S.commit((db) => {
          db.settings.pomodoro = {
            focus: U.clamp(Number(d.focus) || 25, 1, 120),
            short: U.clamp(Number(d.short) || 5, 1, 60),
            long: U.clamp(Number(d.long) || 15, 1, 60),
            rounds: U.clamp(Number(d.rounds) || 4, 1, 12)
          };
        });
        timer.remaining = phaseSeconds(timer.phase);
        UI.toast("Timer settings saved");
      }
    });
  }

  function logForm() {
    UI.modal({
      title: "Log a study session",
      okLabel: "Log it",
      body: `<div class="form-grid">
        <div class="field full"><label>Class</label>
          <select class="select" name="classId">
            <option value="">— General —</option>${UI.classOptions(null)}
          </select></div>
        <div class="field"><label>Date</label>
          <input class="input" type="date" name="date" value="${U.today()}" required /></div>
        <div class="field"><label>Minutes</label>
          <input class="input" type="number" name="minutes" min="1" max="1440" step="1" value="30" required /></div>
      </div>`,
      onSubmit(d) {
        // Constraint validation catches the empty and out-of-range cases now
        // that modal forms are no longer `novalidate`; this is the belt to
        // that braces, since a 0-minute session skews every study statistic.
        const minutes = Math.round(Number(d.minutes));
        if (!Number.isFinite(minutes) || minutes < 1) return false;
        S.insert("studySessions", {
          classId: d.classId || null, date: d.date,
          minutes: Math.min(1440, minutes), kind: "manual"
        });
        UI.toast("Session logged", `${minutes} minutes`, "ok");
      }
    });
  }

  function mount(root) {
    paint();
    root.querySelector("#timerToggle").addEventListener("click", () => (timer.running ? pause() : start()));
    U.on(root, "click", "[data-reset]", reset);
    U.on(root, "click", "[data-skip]", () => complete(true));
    U.on(root, "click", "[data-phase]", (_e, el) => setPhase(el.dataset.phase));
    U.on(root, "click", "[data-settings]", settingsForm);
    U.on(root, "click", "[data-log]", logForm);
    U.on(root, "click", "[data-del-ss]", (_e, el) => {
      // Same as the other three: no undo path, so a mis-click lost a logged
      // session permanently unless you knew about the trash in Settings.
      const ss = S.byId("studySessions", el.dataset.delSs);
      UI.deleteWithUndo("studySessions", el.dataset.delSs,
        ss ? `${ss.minutes} min on ${U.fmtDate(ss.date)}` : "study session");
    });
    const sel = root.querySelector("#focusClass");
    if (sel) sel.addEventListener("change", (e) => { timer.classId = e.target.value || null; });
  }

  return { render, mount, title: "Focus", timer };
})();
