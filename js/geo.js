/* ==========================================================================
   geo.js — real location tracking

   What this actually does:
     • watchPosition() keeps a live fix while sharing is on
     • a campus geofence (centre + radius, set by standing at school and
       tapping "use my location") decides on-campus vs off-campus
     • optional per-room fences refine that to a building/room
     • the timetable decides WHICH class, because GPS cannot tell Room 204
       from Room 206 — a 5m-accurate fix is meaningless at classroom scale
     • when signed in, the resolved status is pushed to the server on a
       throttled interval so a linked parent can see it

   Accuracy, permission state, and staleness are all surfaced to the user
   rather than hidden — a location feature that silently lies is worse than
   none at all.
   ========================================================================== */

App.geo = (function () {
  const U = App.utils, S = App.store;

  const EARTH_M = 6371000;

  const state = {
    permission: "unknown",   // unknown | prompt | granted | denied | denied-live | unsupported
    apiPermission: "unknown", // the browser's own per-site read, tracked separately —
                               // see checkPermission()/locate() for why this needs to
                               // stay distinct from `permission`
    watchId: null,
    last: null,              // { lat, lng, accuracy, ts, heading, speed }
    error: null,
    lastPush: 0,
    listeners: new Set()
  };

  /* ------------------------------------------------------------- math -- */

  /** Great-circle distance in metres. */
  function distance(lat1, lng1, lat2, lng2) {
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLng = (lng2 - lng1) * toRad;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_M * Math.asin(Math.sqrt(a));
  }

  function fmtDistance(m) {
    if (m == null) return "—";
    if (m < 1000) return Math.round(m) + " m";
    return (m / 1000).toFixed(m < 10000 ? 2 : 1) + " km";
  }

  /* ------------------------------------------------------ subscriptions -- */

  function on(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); }

  // Iterate a snapshot: listeners commonly re-render, which unsubscribes and
  // re-subscribes. Set.forEach visits entries added mid-iteration, so a live
  // Set would recurse forever here.
  function emit() {
    const snapshot = [...state.listeners];
    const st = status();
    snapshot.forEach((f) => { try { f(st); } catch (e) { console.error(e); } });
  }

  /* -------------------------------------------------------- permissions -- */

  function supported() { return "geolocation" in navigator; }

  function checkPermission() {
    if (!supported()) { state.permission = "unsupported"; return Promise.resolve("unsupported"); }
    if (!navigator.permissions || !navigator.permissions.query) {
      return Promise.resolve(state.permission === "unknown" ? "prompt" : state.permission);
    }
    return navigator.permissions.query({ name: "geolocation" })
      .then((res) => {
        state.apiPermission = res.state;
        // iOS Safari has two independent permission layers: this per-site read,
        // and an OS-level "Location Services > Safari Websites" toggle that this
        // API can't see at all. When a live fix attempt fails despite this
        // reading "granted", locate()/startWatch() mark that as "denied-live"
        // rather than plain "denied" — don't let a passive re-read of the
        // unchanged per-site "granted" state silently erase that signal; only a
        // fresh live attempt (or a genuine per-site change, via onchange below)
        // should move off it.
        if (!(state.permission === "denied-live" && res.state === "granted")) {
          state.permission = res.state;
        }
        res.onchange = () => { state.permission = res.state; state.apiPermission = res.state; emit(); };
        return res.state;
      })
      .catch(() => "prompt");
  }

  /* ------------------------------------------------------------ fixing -- */

  function options() {
    return {
      enableHighAccuracy: !!S.settings.geo.highAccuracy,
      maximumAge: 15000,
      timeout: 20000
    };
  }

  /** One-shot fix. Resolves with the position record. */
  function locate() {
    if (!supported()) return Promise.reject(new Error("This browser doesn't support geolocation."));
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => { resolve(record(pos)); },
        (err) => { state.error = describe(err); state.permission = classifyDenied(err) || state.permission; emit(); reject(new Error(state.error)); },
        options()
      );
    });
  }

  function record(pos) {
    state.last = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      heading: pos.coords.heading,
      speed: pos.coords.speed,
      ts: pos.timestamp || Date.now()
    };
    state.error = null;
    state.permission = "granted";
    state.apiPermission = "granted";
    emit();
    return state.last;
  }

  function describe(err) {
    if (!err) return "Unknown location error.";
    if (err.code === 1) return "Location permission denied.";
    if (err.code === 2) return "Position unavailable — no GPS or network fix.";
    if (err.code === 3) return "Timed out waiting for a location fix.";
    return err.message || "Location error.";
  }

  /**
   * A PERMISSION_DENIED error while the browser's own per-site permission
   * reads "granted" isn't the same problem as a genuine per-site denial —
   * it's the signature of iOS Safari's separate OS-level "Location Services >
   * Safari Websites" toggle being off, which this app has no visibility into
   * otherwise. Returns null for non-permission errors, so callers can fall
   * back to leaving `state.permission` unchanged.
   */
  function classifyDenied(err) {
    if (!err || err.code !== 1) return null;
    return state.apiPermission === "granted" ? "denied-live" : "denied";
  }

  /* ------------------------------------------------------------ watching */

  function startWatch() {
    if (!supported()) return false;
    if (state.watchId != null) return true;

    state.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        record(pos);
        maybePush();
      },
      (err) => {
        state.error = describe(err);
        const denied = classifyDenied(err);
        if (denied) { state.permission = denied; stopWatch(); }
        emit();
      },
      options()
    );
    S.commit((db) => { db.settings.geo.watching = true; });
    return true;
  }

  function stopWatch() {
    if (state.watchId != null) {
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
    }
    if (S.settings.geo.watching) S.commit((db) => { db.settings.geo.watching = false; });
    emit();
  }

  function isWatching() { return state.watchId != null; }

  /* ------------------------------------------------------------- fences -- */

  function setCampusHere() {
    return locate().then((fix) => {
      S.commit((db) => {
        db.settings.geo.campusLat = fix.lat;
        db.settings.geo.campusLng = fix.lng;
        if (!db.settings.geo.radiusM) db.settings.geo.radiusM = 180;
        db.settings.geo.enabled = true;
      });
      return fix;
    });
  }

  function addRoomHere(label) {
    return locate().then((fix) => {
      S.commit((db) => {
        db.settings.geo.rooms.push({
          id: U.uid("rm"), label: label || "Room",
          lat: fix.lat, lng: fix.lng, radiusM: 35
        });
      });
      return fix;
    });
  }

  function distanceToCampus() {
    const g = S.settings.geo;
    if (!state.last || g.campusLat == null) return null;
    return distance(state.last.lat, state.last.lng, g.campusLat, g.campusLng);
  }

  function onCampus() {
    const g = S.settings.geo;
    const d = distanceToCampus();
    if (d == null) return null;
    // Give the fence the benefit of GPS error, but cap how much slack a very
    // poor fix can buy — otherwise a 2 km-accurate fix "arrives" everywhere.
    const slack = Math.min(state.last.accuracy || 0, 120);
    return d <= (g.radiusM || 180) + slack;
  }

  function nearestRoom() {
    const g = S.settings.geo;
    if (!state.last || !g.rooms.length) return null;
    let best = null;
    g.rooms.forEach((r) => {
      const d = distance(state.last.lat, state.last.lng, r.lat, r.lng);
      if (!best || d < best.distance) best = { room: r, distance: d };
    });
    if (!best) return null;
    const slack = Math.min(state.last.accuracy || 0, 60);
    best.inside = best.distance <= (best.room.radiusM || 35) + slack;
    return best;
  }

  /* ------------------------------------------------------------- status -- */

  /**
   * The single source of truth for "where is this student and what are they
   * doing" — GPS for presence, the timetable for identity.
   */
  function status() {
    const g = S.settings.geo;
    const live = S.liveStatus();
    const fix = state.last;
    const ageS = fix ? Math.round((Date.now() - fix.ts) / 1000) : null;
    const stale = ageS != null && ageS > 300;

    const campus = onCampus();
    const room = nearestRoom();
    const dist = distanceToCampus();

    let presence, label, detail, confidence;

    if (!g.enabled) {
      presence = "off";
      label = live.current ? live.current.title : "Not sharing";
      detail = "Location sharing is off";
      confidence = "none";
    } else if (state.permission === "denied" || state.permission === "denied-live") {
      presence = "denied";
      label = live.current ? live.current.title : "Schedule only";
      detail = state.permission === "denied-live"
        ? "Location blocked at the system level — status comes from the timetable"
        : "Location permission denied — status comes from the timetable";
      confidence = "schedule";
    } else if (!fix) {
      presence = "unknown";
      label = live.current ? live.current.title : "Waiting for GPS";
      detail = "No location fix yet";
      confidence = "schedule";
    } else if (g.campusLat == null) {
      presence = "unset";
      label = live.current ? live.current.title : "Campus not set";
      detail = "Set the school location to enable on-campus detection";
      confidence = "schedule";
    } else if (campus) {
      presence = "on-campus";
      if (live.current) {
        label = live.current.title;
        detail = `${room && room.inside ? room.room.label : live.current.location || "On campus"} · ${U.fmtDur(live.remaining)} left`;
        confidence = room && room.inside ? "gps-room" : "gps-campus";
      } else if (live.next) {
        label = "On campus — free period";
        detail = `${live.next.title} at ${U.fmtTime(live.next.start)}`;
        confidence = "gps-campus";
      } else {
        label = "On campus";
        detail = "No class scheduled right now";
        confidence = "gps-campus";
      }
    } else {
      presence = "off-campus";
      label = "Away from school";
      detail = `${fmtDistance(dist)} from campus`;
      confidence = "gps-campus";
    }

    return {
      presence, label, detail, confidence,
      onCampus: campus,
      distance: dist,
      room: room && room.inside ? room.room.label : null,
      accuracy: fix ? Math.round(fix.accuracy) : null,
      coords: fix ? { lat: fix.lat, lng: fix.lng } : null,
      ageSeconds: ageS,
      stale,
      permission: state.permission,
      watching: isWatching(),
      error: state.error,
      current: live.current,
      next: live.next,
      remaining: live.remaining
    };
  }

  /* --------------------------------------------------------------- push -- */

  /**
   * Send the resolved status to the server for linked parents. Coordinates
   * are only included when the student has location sharing on; otherwise
   * just the schedule-derived status goes up.
   */
  function maybePush(force) {
    if (!App.sync || !App.sync.isSignedIn()) return;
    if (!S.settings.locationSharing) return;

    const intervalMs = (S.settings.geo.shareIntervalS || 60) * 1000;
    if (!force && Date.now() - state.lastPush < intervalMs) return;
    state.lastPush = Date.now();

    const st = status();
    App.sync.pushLocation({
      presence: st.presence,
      label: st.label,
      detail: st.detail,
      confidence: st.confidence,
      onCampus: st.onCampus,
      room: st.room,
      accuracy: st.accuracy,
      coords: S.settings.geo.enabled ? st.coords : null,
      distanceM: st.distance == null ? null : Math.round(st.distance),
      className: st.current ? st.current.title : null,
      endsAt: st.current ? st.current.end : null,
      nextClass: st.next ? st.next.title : null,
      nextAt: st.next ? st.next.start : null,
      at: Date.now()
    }).catch(() => { /* transient network failures are fine — next tick retries */ });
  }

  /* --------------------------------------------------------------- init -- */

  function init() {
    checkPermission().then((p) => {
      if (p === "granted" && S.settings.geo.enabled && S.settings.geo.watching) startWatch();
      emit();
    });

    // Re-push periodically even without movement, so "last seen" stays fresh.
    setInterval(() => {
      if (isWatching()) maybePush();
    }, 30000);

    // Pause the watch in a hidden tab to save battery; resume on return.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (isWatching()) { navigator.geolocation.clearWatch(state.watchId); state.watchId = null; }
        return;
      }
      // The browser's own permission decision can change while this tab is
      // backgrounded — the user fixes it from the browser's own settings, not
      // from here — and nothing else re-polls it, so pick that up the moment
      // focus returns instead of leaving a stale "blocked" badge on screen.
      checkPermission().then(() => {
        if (S.settings.geo.enabled && S.settings.geo.watching && !isWatching()) startWatch();
        emit();
      });
    });
  }

  function enable() {
    return locate().then((fix) => {
      S.commit((db) => { db.settings.geo.enabled = true; });
      startWatch();
      maybePush(true);
      return fix;
    });
  }

  function disable() {
    stopWatch();
    S.commit((db) => { db.settings.geo.enabled = false; });
  }

  return {
    init, enable, disable, locate, startWatch, stopWatch, isWatching,
    setCampusHere, addRoomHere, status, distance, fmtDistance,
    distanceToCampus, onCampus, nearestRoom, checkPermission, supported,
    on, maybePush,
    get last() { return state.last; }
  };
})();
