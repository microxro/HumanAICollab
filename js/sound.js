/* ==========================================================================
   sound.js — the alarm the focus timer rings with

   Why this is its own module and not four lines inside views/focus.js:

   The old ping() built a brand-new AudioContext at the moment the timer hit
   zero. Every current browser starts a context in the "suspended" state
   unless it is created (or resumed) inside a user gesture — and "the timer
   ran out" is not a gesture. So the oscillator started, played into a
   suspended graph, and nothing came out: a timer that rang silently, which
   is the same as a timer that does not ring. It also fired exactly one
   0.6-second sine at 660 Hz, which is easy to miss from across a room even
   when it does play.

   What this does instead:

     • ONE context for the whole app, created and resumed on the first real
       user gesture (App.sound.unlock, wired to pointer/key handlers in
       app.js and to the timer's own Start button).
     • A resume() attempt before every play, because a backgrounded tab can
       suspend the context again.
     • A multi-note pattern repeated a few times, so it reads as an alarm.
     • An <audio> fallback with a generated WAV data URI, for the rare engine
       where WebAudio is missing or wedged.
     • navigator.vibrate() alongside, since a phone in a bag is the case
       where sound alone loses.

   Alarm voices are also shop items (see js/shop.js), so the catalogue and
   the preview button both come through here.
   ========================================================================== */

App.sound = (function () {
  const S = App.store;

  let ctx = null;
  let unlocked = false;

  /* ------------------------------------------------------- the catalogue */

  /**
   * Each voice is a list of notes: [frequency Hz, start offset s, length s].
   * `repeat` plays the whole pattern again after `gap` seconds — an alarm
   * that sounds once is a notification, not an alarm.
   */
  const VOICES = {
    chime:   { label: "Chime",        wave: "sine",     repeat: 3, gap: 0.75,
               notes: [[880, 0, 0.28], [1174.7, 0.16, 0.34]] },
    bell:    { label: "Bell",         wave: "triangle", repeat: 3, gap: 0.9,
               notes: [[1318.5, 0, 0.5], [659.3, 0.02, 0.6]] },
    marimba: { label: "Marimba",      wave: "sine",     repeat: 2, gap: 0.6,
               notes: [[523.3, 0, 0.18], [659.3, 0.12, 0.18], [784, 0.24, 0.3]] },
    arcade:  { label: "Arcade",       wave: "square",   repeat: 2, gap: 0.5,
               notes: [[523.3, 0, 0.09], [784, 0.1, 0.09], [1046.5, 0.2, 0.16]] },
    zen:     { label: "Zen bowl",     wave: "sine",     repeat: 2, gap: 1.6,
               notes: [[210, 0, 1.6], [316, 0.05, 1.4], [420, 0.1, 1.2]] },
    sunrise: { label: "Sunrise",      wave: "triangle", repeat: 2, gap: 1.0,
               notes: [[392, 0, 0.4], [523.3, 0.3, 0.4], [659.3, 0.6, 0.5], [784, 0.9, 0.7]] },
    lofi:    { label: "Lo-fi tape",   wave: "sine",     repeat: 2, gap: 0.9,
               notes: [[329.6, 0, 0.5], [246.9, 0.28, 0.5], [196, 0.56, 0.8]] },
    fanfare: { label: "Champion fanfare", wave: "sawtooth", repeat: 2, gap: 0.7,
               notes: [[523.3, 0, 0.14], [659.3, 0.14, 0.14], [784, 0.28, 0.14], [1046.5, 0.42, 0.5]] }
  };

  // Only the first two are free; the rest are unlocked in the token shop.
  const FREE = ["chime", "bell"];

  function voices() { return VOICES; }
  function isFree(key) { return FREE.indexOf(key) >= 0; }

  /* ------------------------------------------------------------ settings */

  function cfg() {
    const p = (S && S.settings && S.settings.pomodoro) || {};
    return {
      on: p.sound !== false,
      voice: VOICES[p.alarm] ? p.alarm : "chime",
      volume: typeof p.volume === "number" ? Math.max(0, Math.min(1, p.volume)) : 0.7,
      quietVolume: p.quietSound === false ? 0 : 0.25,
      vibrate: p.vibrate !== false
    };
  }

  /* -------------------------------------------------------------- engine */

  function Ctx() { return window.AudioContext || window.webkitAudioContext; }

  /**
   * Called from a real user gesture. Creating the context here — rather than
   * at ring time — is the whole reason the alarm is audible at all.
   * Idempotent and never throws: audio is a nicety, never a failure.
   */
  function unlock() {
    try {
      const C = Ctx();
      if (!C) return false;
      if (!ctx) ctx = new C();
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      if (!unlocked) {
        // A zero-gain blip inside the gesture is what actually flips iOS
        // Safari's audio session on; resume() alone is not always enough.
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.0001;
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.01);
        unlocked = true;
      }
      return true;
    } catch (e) { return false; }
  }

  function ready() { return !!ctx && ctx.state === "running"; }

  function playPattern(key, volume) {
    const v = VOICES[key] || VOICES.chime;
    if (!ctx) return false;
    let t0 = ctx.currentTime + 0.02;
    const span = v.notes.reduce((m, n) => Math.max(m, n[1] + n[2]), 0);

    for (let r = 0; r < (v.repeat || 1); r++) {
      const base = t0 + r * (span + (v.gap || 0.5));
      v.notes.forEach(([freq, at, len]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = v.wave || "sine";
        osc.frequency.value = freq;
        osc.connect(gain); gain.connect(ctx.destination);
        const start = base + at;
        // exponentialRamp never reaches 0, so the floor is a small epsilon —
        // ramping to a true zero throws and kills the whole alarm.
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + len);
        osc.start(start);
        osc.stop(start + len + 0.05);
      });
    }
    return true;
  }

  /* ------------------------------------------------- <audio> WAV fallback */

  let fallbackEl = null;

  /** A short two-tone beep as a base64 WAV — no asset file, no network. */
  function wavDataUri() {
    const rate = 8000, secs = 1.1;
    const n = Math.floor(rate * secs);
    const bytes = 44 + n * 2;
    const buf = new ArrayBuffer(bytes);
    const view = new DataView(buf);
    const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    str(0, "RIFF"); view.setUint32(4, bytes - 8, true); str(8, "WAVEfmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    str(36, "data"); view.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const beat = Math.floor(t / 0.28) % 2;
      const env = Math.max(0, 1 - ((t % 0.28) / 0.28)) * (t < secs - 0.05 ? 1 : 0);
      const s = Math.sin(2 * Math.PI * (beat ? 1174.7 : 880) * t) * env * 0.4;
      view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true);
    }
    let bin = "";
    const u8 = new Uint8Array(buf);
    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    return "data:audio/wav;base64," + btoa(bin);
  }

  function fallbackPlay(volume) {
    try {
      if (!fallbackEl) {
        fallbackEl = new Audio(wavDataUri());
        fallbackEl.preload = "auto";
      }
      fallbackEl.volume = Math.max(0, Math.min(1, volume));
      fallbackEl.currentTime = 0;
      const p = fallbackEl.play();
      if (p && p.catch) p.catch(() => {});
      return true;
    } catch (e) { return false; }
  }

  /* ---------------------------------------------------------------- fire */

  /**
   * Ring the alarm.
   * @param {object} [opts]
   * @param {string} [opts.voice]  override the saved voice (shop previews)
   * @param {number} [opts.volume] override the saved volume (0–1)
   * @param {boolean} [opts.force] ignore the sound-off setting (previews)
   * @returns {boolean} whether anything was actually asked to play
   */
  function alarm(opts) {
    const o = opts || {};
    const c = cfg();
    if (!c.on && !o.force) return false;

    // Quiet hours dial the alarm down rather than removing it. Silence was
    // the old behaviour and it is indistinguishable from a broken timer at
    // 22:00, which is exactly when people are still studying.
    let volume = o.volume != null ? o.volume : c.volume;
    if (!o.force && App.notify && App.notify.inQuietHours()) {
      if (c.quietVolume === 0) return false;
      volume = Math.min(volume, c.quietVolume);
    }

    const voice = o.voice || c.voice;

    if (c.vibrate && navigator.vibrate) {
      try { navigator.vibrate([180, 90, 180, 90, 320]); } catch (e) { /* unsupported */ }
    }

    // Try WebAudio first, resuming a context a background tab suspended.
    if (!ctx) unlock();
    if (ctx) {
      if (ctx.state === "suspended") {
        ctx.resume()
          .then(() => playPattern(voice, volume))
          .catch(() => fallbackPlay(volume));
        return true;
      }
      try { return playPattern(voice, volume); }
      catch (e) { return fallbackPlay(volume); }
    }
    return fallbackPlay(volume);
  }

  /** Shop and settings previews: always audible, even with sound switched off. */
  function preview(voice, volume) {
    unlock();
    const v = volume == null ? cfg().volume : volume;
    return alarm({ voice, force: true, volume: Math.max(0.2, v) });
  }

  return { unlock, alarm, preview, voices, isFree, ready, VOICES };
})();
