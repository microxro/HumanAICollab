/* ==========================================================================
   views/focus.js — Pomodoro focus timer + study session log
   ========================================================================== */

App.views.focus = (function () {
  const U = App.utils, S = App.store, UI = App.ui, C = App.charts;

  // Timer state lives outside render() so it survives view re-renders and
  // keeps running while you browse other tabs.
  const timer = {
    phase: "focus",        // focus | short | long | custom
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
    return (phase === "focus" ? c.focus : phase === "short" ? c.short
      : phase === "custom" ? (c.custom || 25) : c.long) * 60;
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
      // No tokens here. A running timer is the easiest thing in the app to
      // leave running, and paying by the minute for it made the shop's best
      // earning strategy "start a block and walk away". Tokens are earned by
      // answering a quiz on what you studied — see js/shop.js.
      const next = timer.round % cfg().rounds === 0 ? "long" : "short";
      timer.round += 1;
      timer.phase = next;
      timer.remaining = phaseSeconds(next);
      // F075 — a break nudge is always shown (you need to know time's up).
      // The alarm itself is quieter during quiet hours rather than absent;
      // see js/sound.js.
      UI.toast(skipped ? "Block ended early" : "Focus block complete! 🎉",
        `${elapsedMin} minute${elapsedMin === 1 ? "" : "s"} logged${timer.classId ? " to " + S.className(timer.classId) : ""}. ` +
        `Time for a ${next === "long" ? "long" : "short"} break.`, "ok");
      if (!skipped) ring();
    } else {
      timer.phase = "focus";
      timer.remaining = phaseSeconds("focus");
      UI.toast("Break over", "Ready for another focus block?");
      if (!skipped) ring();
    }
    App.router.refresh();
  }

  /**
   * Ring the alarm when a block ends.
   *
   * The tone itself lives in App.sound, which holds one gesture-unlocked
   * AudioContext for the whole app. Building a context here — as this used
   * to — produced a suspended graph and therefore silence: a timer that
   * finished without a sound. The system notification is a second channel
   * for a backgrounded tab, where audio alone may be throttled.
   */
  function ring() {
    App.sound.alarm();
    if (document.hidden && App.notify.permission() === "granted" && !App.notify.inQuietHours()) {
      App.notify.show("Time's up", timer.phase === "focus" ? "Break's over — back to it." : "Focus block complete.", "focus-timer", "focus");
    }
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
      ? `${U.clock(timer.remaining)} · ${timer.phase === "focus" ? "Focus" : "Break"} — StudyHold`
      : "StudyHold — School Tracker";
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
              <button class="${timer.phase === "custom" ? "active" : ""}" data-phase="custom"
                title="Set a one-off length — currently ${cfg().custom || 25} minutes">Custom</button>
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
    const voices = App.sound.voices();
    // A voice is selectable once it's free or bought in the shop; a locked
    // one is still listed, so what's on offer is visible from here.
    const owned = (key) => App.sound.isFree(key) || S.ownsShopItem("alarm:" + key);

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

        <div class="field full">
          <label>Alarm sound</label>
          <div class="row gap-8">
            <select class="select grow" name="alarm" id="alarmSel">
              ${Object.entries(voices).map(([key, v]) => `
                <option value="${key}" ${c.alarm === key ? "selected" : ""} ${owned(key) ? "" : "disabled"}>
                  ${U.esc(v.label)}${owned(key) ? "" : " — locked in the shop"}
                </option>`).join("")}
            </select>
            <button type="button" class="btn" id="alarmTest">▶ Test</button>
          </div>
          <span class="hint">Tap Test to hear it. Browsers only allow sound after you've interacted with
            the page, which is why the timer unlocks audio the moment you press Start.</span>
        </div>
        <div class="field full">
          <label>Volume — <span id="volLabel">${Math.round((c.volume == null ? 0.7 : c.volume) * 100)}%</span></label>
          <input class="input" type="range" name="volume" id="volRange" min="0" max="100" step="5"
                 value="${Math.round((c.volume == null ? 0.7 : c.volume) * 100)}" />
        </div>
        <div class="field full">
          <label class="row gap-8" style="align-items:center">
            <input type="checkbox" name="sound" ${c.sound === false ? "" : "checked"} />
            <span>Play a sound when a block ends</span>
          </label>
          <label class="row gap-8 mt-8" style="align-items:center">
            <input type="checkbox" name="vibrate" ${c.vibrate === false ? "" : "checked"} />
            <span>Vibrate too, on a phone that supports it</span>
          </label>
          <label class="row gap-8 mt-8" style="align-items:center">
            <input type="checkbox" name="quietSound" ${c.quietSound === false ? "" : "checked"} />
            <span>Still ring during quiet hours, quietly</span>
          </label>
          <span class="hint">With this off, a block ending inside your quiet hours
            (${U.esc(S.settings.notifications.quietStart)}–${U.esc(S.settings.notifications.quietEnd)}) is silent.</span>
        </div>
      </div>`,
      onMount(root) {
        const range = root.querySelector("#volRange");
        const label = root.querySelector("#volLabel");
        range.addEventListener("input", () => { label.textContent = range.value + "%"; });
        root.querySelector("#alarmTest").addEventListener("click", () => {
          const key = root.querySelector("#alarmSel").value;
          App.sound.preview(key, Number(range.value) / 100);
          UI.toast("Testing the alarm", App.sound.voices()[key].label);
        });
      },
      onSubmit(d) {
        S.commit((db) => {
          // Merge rather than replace — a wholesale overwrite here would
          // silently wipe out a saved custom length every time someone just
          // changes the regular focus/break minutes.
          Object.assign(db.settings.pomodoro, {
            focus: U.clamp(Number(d.focus) || 25, 1, 120),
            short: U.clamp(Number(d.short) || 5, 1, 60),
            long: U.clamp(Number(d.long) || 15, 1, 60),
            rounds: U.clamp(Number(d.rounds) || 4, 1, 12),
            alarm: owned(d.alarm) ? d.alarm : (db.settings.pomodoro.alarm || "chime"),
            volume: U.clamp(Number(d.volume) / 100, 0, 1),
            sound: d.sound === "on" || d.sound === true,
            vibrate: d.vibrate === "on" || d.vibrate === true,
            quietSound: d.quietSound === "on" || d.quietSound === true
          });
        });
        timer.remaining = phaseSeconds(timer.phase);
        UI.toast("Timer settings saved");
      }
    });
  }

  function customForm() {
    const c = cfg();
    UI.modal({
      title: "Custom length",
      okLabel: "Use it",
      body: `<div class="field">
        <label>Minutes</label>
        <input class="input" type="number" name="minutes" min="1" max="180" value="${c.custom || 25}" autofocus />
      </div>`,
      onSubmit(d) {
        const minutes = U.clamp(Math.round(Number(d.minutes)) || 25, 1, 180);
        S.commit((db) => { db.settings.pomodoro.custom = minutes; });
        setPhase("custom");
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
    root.querySelector("#timerToggle").addEventListener("click", () => {
      // Pressing Start is the gesture that opens the audio session, so the
      // alarm can actually sound when this block ends. Doing it here as well
      // as globally means a browser that only counts a gesture on the
      // element that received it still ends up unlocked.
      App.sound.unlock();
      timer.running ? pause() : start();
    });
    U.on(root, "click", "[data-reset]", reset);
    U.on(root, "click", "[data-skip]", () => complete(true));
    U.on(root, "click", "[data-phase]", (_e, el) => {
      // Custom always opens the modal — both to set it the first time and to
      // change it later, since tapping the segment again is the only way
      // back into a length you'd want to adjust.
      if (el.dataset.phase === "custom") customForm();
      else setPhase(el.dataset.phase);
    });
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
