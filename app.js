/* ClassPulse — client-side school tracker prototype
   All data lives in localStorage. No server, no accounts — role switching
   simulates what a student / parent / teacher would each see. */

const STORAGE_KEY = "classpulse.v1";
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

/* ---------------------------------------------------------------------- */
/* Seed data                                                              */
/* ---------------------------------------------------------------------- */

function seedData() {
  return {
    teachers: [
      { id: "t1", name: "Ms. Rivera", subject: "Math", room: "204", email: "rivera@classpulse.edu", office: "Mon/Wed 3:00-4:00pm" },
      { id: "t2", name: "Mr. Chen", subject: "Science", room: "118", email: "chen@classpulse.edu", office: "Tue/Thu 3:15-4:00pm" },
      { id: "t3", name: "Mrs. Patel", subject: "English", room: "210", email: "patel@classpulse.edu", office: "Mon-Fri 8:00-8:20am" },
      { id: "t4", name: "Mr. Osei", subject: "History", room: "112", email: "osei@classpulse.edu", office: "Wed 3:00-3:45pm" },
      { id: "t5", name: "Coach Diaz", subject: "PE / Soccer", room: "Gym", email: "diaz@classpulse.edu", office: "By appointment" },
      { id: "t6", name: "Sra. Nunez", subject: "Spanish", room: "215", email: "nunez@classpulse.edu", office: "Tue 3:00-3:40pm" }
    ],

    // Fixed daily time slots shared by every student's schedule
    periods: [
      { id: "p1", start: "08:00", end: "08:50" },
      { id: "p2", start: "09:00", end: "09:50" },
      { id: "p3", start: "10:00", end: "10:50" },
      { id: "p4", start: "11:00", end: "11:50" },
      { id: "p5", start: "12:00", end: "12:50" },
      { id: "p6", start: "13:00", end: "13:50" }
    ],

    // Each class is offered on specific weekdays in a specific period
    classes: [
      { id: "c1", subject: "Math", teacherId: "t1", room: "204", periodId: "p1", days: WEEKDAYS, color: "#4f46e5" },
      { id: "c2", subject: "Science", teacherId: "t2", room: "118", periodId: "p2", days: WEEKDAYS, color: "#0ea5a5" },
      { id: "c3", subject: "English", teacherId: "t3", room: "210", periodId: "p3", days: WEEKDAYS, color: "#d946ef" },
      { id: "c4", subject: "History", teacherId: "t4", room: "112", periodId: "p4", days: WEEKDAYS, color: "#ea580c" },
      { id: "c5", subject: "PE", teacherId: "t5", room: "Gym", periodId: "p6", days: ["Mon", "Wed", "Fri"], color: "#16a34a" },
      { id: "c6", subject: "Art", teacherId: "t2", room: "118", periodId: "p6", days: ["Tue", "Thu"], color: "#eab308" },
      { id: "c7", subject: "Spanish", teacherId: "t6", room: "215", periodId: "p2", days: WEEKDAYS, color: "#db2777" },
      { id: "c8", subject: "Study Hall", teacherId: null, room: "Library", periodId: "p4", days: WEEKDAYS, color: "#94a3b8" }
    ],

    extracurriculars: [
      { id: "e1", name: "Soccer Practice", type: "Sport", teacherId: "t5", location: "Athletic Field", days: ["Tue", "Thu"], start: "15:30", end: "17:00", color: "#16a34a" },
      { id: "e2", name: "Robotics Club", type: "Club", teacherId: "t2", location: "Room 118", days: ["Wed"], start: "15:30", end: "16:30", color: "#0ea5a5" },
      { id: "e3", name: "Drama Rehearsal", type: "Club", teacherId: "t3", location: "Auditorium", days: ["Mon", "Thu"], start: "15:30", end: "16:45", color: "#d946ef" }
    ],

    // One-off, non-recurring events (tests, games) — used for conflict detection
    oneOffEvents: [
      { id: "o1", studentId: "s1", title: "Chemistry Test Review", day: "Tue", start: "15:45", end: "16:30", type: "Academic" },
      { id: "o2", studentId: "s1", title: "Soccer vs. Lincoln HS", day: "Fri", start: "16:00", end: "18:00", type: "Sport" }
    ],

    students: [
      {
        id: "s1", name: "Alex Kim", initials: "AK", color: "#4f46e5",
        classIds: ["c1", "c2", "c3", "c4", "c5"],
        ecIds: ["e1"],
        friendIds: ["s2"],
        parentId: "pa1"
      },
      {
        id: "s2", name: "Jordan Lee", initials: "JL", color: "#0ea5a5",
        classIds: ["c1", "c7", "c3", "c8", "c6"],
        ecIds: ["e2"],
        friendIds: ["s1"],
        parentId: "pa2"
      },
      {
        id: "s3", name: "Sam Rivera", initials: "SR", color: "#ea580c",
        classIds: ["c7", "c2", "c8", "c4", "c5"],
        ecIds: ["e3"],
        friendIds: [],
        parentId: "pa1"
      }
    ],

    parents: [
      { id: "pa1", name: "Dana Kim", childIds: ["s1", "s3"] },
      { id: "pa2", name: "Casey Lee", childIds: ["s2"] }
    ],

    settings: {
      s1: { locationSharing: true, peerSharing: true },
      s2: { locationSharing: true, peerSharing: true },
      s3: { locationSharing: false, peerSharing: false }
    },

    // streak / XP tracking, keyed by studentId
    streaks: {
      s1: { count: 6, lastActiveDate: null, xp: 340 },
      s2: { count: 3, lastActiveDate: null, xp: 180 },
      s3: { count: 0, lastActiveDate: null, xp: 40 }
    },

    // usage minutes per day, keyed by studentId -> { "YYYY-MM-DD": minutes }
    usageLog: {
      s1: seedPastUsage(),
      s2: seedPastUsage(),
      s3: seedPastUsage()
    },

    // teacher-posted notes: { id, teacherId, classId, text, ts }
    notes: [
      { id: "n1", teacherId: "t1", classId: "c1", text: "Quiz Friday on chapter 4 — bring a calculator.", ts: Date.now() - 1000 * 60 * 60 * 20 },
      { id: "n2", teacherId: "t5", classId: null, ecId: "e1", text: "Practice moved to the east field this week.", ts: Date.now() - 1000 * 60 * 60 * 5 }
    ],

    ui: {
      role: "student",
      userId: "s1",
      sessionStart: Date.now()
    }
  };
}

function seedPastUsage() {
  const log = {};
  const base = [38, 52, 21, 60, 45, 12, 30];
  for (let i = 6; i >= 1; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    log[dateKey(d)] = base[6 - i];
  }
  return log;
}

/* ---------------------------------------------------------------------- */
/* Persistence                                                            */
/* ---------------------------------------------------------------------- */

let DB = loadDB();

function loadDB() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      parsed.ui.sessionStart = Date.now();
      return parsed;
    }
  } catch (e) {
    console.warn("Could not read saved data, reseeding.", e);
  }
  return seedData();
}

function saveDB() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
}

/* ---------------------------------------------------------------------- */
/* Time helpers                                                           */
/* ---------------------------------------------------------------------- */

function dateKey(d) {
  return d.toISOString().slice(0, 10);
}

function todayName() {
  return DAY_NAMES[new Date().getDay()];
}

function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function nowMinutes() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

function formatTime(t) {
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function periodById(id) {
  return DB.periods.find((p) => p.id === id);
}

/* ---------------------------------------------------------------------- */
/* Derived lookups                                                        */
/* ---------------------------------------------------------------------- */

function getStudent(id) { return DB.students.find((s) => s.id === id); }
function getTeacher(id) { return DB.teachers.find((t) => t.id === id); }
function getClass(id) { return DB.classes.find((c) => c.id === id); }
function getEc(id) { return DB.extracurriculars.find((e) => e.id === id); }

function studentSchedule(studentId) {
  const student = getStudent(studentId);
  return student.classIds
    .map(getClass)
    .filter(Boolean)
    .map((c) => ({ ...c, period: periodById(c.periodId) }));
}

function studentEcs(studentId) {
  const student = getStudent(studentId);
  return student.ecIds.map(getEc).filter(Boolean);
}

// Returns { type: 'class'|'ec'|'free'|'none', ...details } for right now
function currentActivity(studentId) {
  const day = todayName();
  const nowMin = nowMinutes();

  if (!WEEKDAYS.includes(day)) {
    return { type: "none", label: "No school today", detail: "Enjoy the weekend" };
  }

  const ecs = studentEcs(studentId);
  for (const ec of ecs) {
    if (ec.days.includes(day) && nowMin >= timeToMinutes(ec.start) && nowMin < timeToMinutes(ec.end)) {
      return { type: "ec", label: ec.name, detail: `${ec.location} · until ${formatTime(ec.end)}`, until: ec.end };
    }
  }

  const schedule = studentSchedule(studentId);
  for (const cls of schedule) {
    if (cls.days.includes(day) && nowMin >= timeToMinutes(cls.period.start) && nowMin < timeToMinutes(cls.period.end)) {
      const teacher = getTeacher(cls.teacherId);
      return {
        type: "class",
        label: cls.subject,
        detail: `Room ${cls.room}${teacher ? " · " + teacher.name : ""} · until ${formatTime(cls.period.end)}`,
        until: cls.period.end
      };
    }
  }

  const dayStart = timeToMinutes(DB.periods[0].start);
  const dayEnd = timeToMinutes(DB.periods[DB.periods.length - 1].end);
  if (nowMin >= dayStart && nowMin < dayEnd) {
    return { type: "free", label: "Free period", detail: "No class scheduled right now" };
  }
  return { type: "none", label: "Not in school hours", detail: "Outside the school day" };
}

// Find periods where a student has no class ("Study Hall" or missing entry)
function freePeriods(studentId) {
  const schedule = studentSchedule(studentId);
  const day = todayName();
  const covered = new Set(schedule.filter((c) => c.days.includes(day)).map((c) => c.periodId));
  return DB.periods.filter((p) => !covered.has(p.id) || isStudyHall(studentId, p.id));
}

function isStudyHall(studentId, periodId) {
  const schedule = studentSchedule(studentId);
  const day = todayName();
  const cls = schedule.find((c) => c.periodId === periodId && c.days.includes(day));
  return cls && cls.subject === "Study Hall";
}

function freePeriodOverlap(idA, idB) {
  const a = new Set(freePeriods(idA).map((p) => p.id));
  const b = freePeriods(idB).map((p) => p.id);
  return b.filter((id) => a.has(id)).map(periodById);
}

// Detect same-day time overlaps between recurring activities and one-off events
function getConflicts(studentId) {
  const conflicts = [];
  const oneOffs = DB.oneOffEvents.filter((o) => o.studentId === studentId);
  const ecs = studentEcs(studentId);

  for (const oneOff of oneOffs) {
    for (const ec of ecs) {
      if (!ec.days.includes(oneOff.day)) continue;
      const overlap = timeToMinutes(oneOff.start) < timeToMinutes(ec.end) &&
        timeToMinutes(ec.start) < timeToMinutes(oneOff.end);
      if (overlap) {
        conflicts.push({
          message: `"${oneOff.title}" (${oneOff.day} ${formatTime(oneOff.start)}-${formatTime(oneOff.end)}) overlaps ${ec.name} (${formatTime(ec.start)}-${formatTime(ec.end)}).`
        });
      }
    }
  }
  return conflicts;
}

/* ---------------------------------------------------------------------- */
/* Streaks & usage                                                        */
/* ---------------------------------------------------------------------- */

function touchStreak(studentId) {
  const streak = DB.streaks[studentId];
  const today = dateKey(new Date());
  if (streak.lastActiveDate === today) return;

  if (streak.lastActiveDate) {
    const last = new Date(streak.lastActiveDate);
    const diffDays = Math.round((new Date(today) - last) / 86400000);
    streak.count = diffDays === 1 ? streak.count + 1 : 1;
  } else {
    streak.count = Math.max(1, streak.count);
  }
  streak.xp += 20;
  streak.lastActiveDate = today;
  saveDB();
}

function logUsageMinutes(studentId, minutes) {
  if (minutes <= 0) return;
  const log = DB.usageLog[studentId];
  const key = dateKey(new Date());
  log[key] = Math.round((log[key] || 0) + minutes);
  saveDB();
}

function last7DaysUsage(studentId) {
  const log = DB.usageLog[studentId];
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({ label: DAY_NAMES[d.getDay()], key: dateKey(d), minutes: log[dateKey(d)] || 0, isToday: i === 0 });
  }
  return days;
}

/* ---------------------------------------------------------------------- */
/* Rendering                                                              */
/* ---------------------------------------------------------------------- */

const app = document.getElementById("app");
const userSelect = document.getElementById("userSelect");

function render() {
  renderNav();
  if (DB.ui.role === "student") renderStudentView();
  else if (DB.ui.role === "parent") renderParentView();
  else renderTeacherView();
}

function renderNav() {
  document.querySelectorAll(".role-pill").forEach((btn) => {
    const active = btn.dataset.role === DB.ui.role;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });

  let options = [];
  if (DB.ui.role === "student") options = DB.students.map((s) => ({ id: s.id, label: s.name }));
  else if (DB.ui.role === "parent") options = DB.parents.map((p) => ({ id: p.id, label: p.name }));
  else options = DB.teachers.map((t) => ({ id: t.id, label: t.name }));

  if (!options.find((o) => o.id === DB.ui.userId)) {
    DB.ui.userId = options[0].id;
  }

  userSelect.innerHTML = options.map((o) => `<option value="${o.id}">${o.label}</option>`).join("");
  userSelect.value = DB.ui.userId;
}

/* ---- Student view ---- */

function renderStudentView() {
  const studentId = DB.ui.userId;
  const student = getStudent(studentId);
  touchStreak(studentId);

  const activity = currentActivity(studentId);
  const settings = DB.settings[studentId];
  const conflicts = getConflicts(studentId);
  const streak = DB.streaks[studentId];

  app.innerHTML = `
    <h1 class="section-title">Hi, ${student.name.split(" ")[0]} 👋</h1>
    <p class="section-sub">${todayName()} · here's what's happening today</p>

    <div class="status-hero ${activity.type === "none" ? "offline" : ""}">
      <div class="pulse-dot"></div>
      <div>
        <div class="status-title">Right now</div>
        <div class="status-main">${activity.label}</div>
        <div class="status-detail">${activity.detail}</div>
      </div>
      ${settings.locationSharing ? `<div class="location-tag" id="locTag">📍 Sharing location with parent</div>` : `<div class="location-tag">📍 Location sharing off</div>`}
    </div>

    <div class="view-grid">
      <div class="stack">
        <div class="card">
          <h2>Today's schedule</h2>
          <p class="card-sub">Classes and activities for ${todayName()}</p>
          ${renderPeriodList(studentId)}
        </div>

        <div class="card">
          <h2>Weekly calendar</h2>
          <p class="card-sub">Classes, extracurriculars, and events — color-coded by subject</p>
          ${conflicts.length ? conflicts.map((c) => `<div class="conflict-banner">⚠️ <span>${c.message}</span></div>`).join("") : ""}
          ${renderWeekGrid(studentId)}
        </div>

        <div class="card">
          <h3>Study buddies</h3>
          <p class="card-sub">Friends who've opted in to share their schedule, and any free periods you share today</p>
          ${renderPeerMatches(studentId)}
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <h3>Streak &amp; XP</h3>
          <div class="streak-box">
            <div class="streak-flame">🔥</div>
            <div>
              <div class="streak-num">${streak.count}-day streak</div>
              <div class="streak-label">${streak.xp} XP earned</div>
            </div>
          </div>
          <div class="xp-bar-track"><div class="xp-bar-fill" style="width:${Math.min(100, streak.xp % 500 / 5)}%"></div></div>
        </div>

        <div class="card">
          <h3>Privacy &amp; sharing</h3>
          <div class="toggle-row">
            <div class="toggle-copy"><strong>Location sharing</strong><span>Let your parent see what class you're in</span></div>
            <label class="switch">
              <input type="checkbox" id="toggleLocation" ${settings.locationSharing ? "checked" : ""} />
              <span class="slider"></span>
            </label>
          </div>
          <div class="toggle-row">
            <div class="toggle-copy"><strong>Peer schedule sharing</strong><span>Let opted-in friends see your schedule &amp; free periods</span></div>
            <label class="switch">
              <input type="checkbox" id="togglePeer" ${settings.peerSharing ? "checked" : ""} />
              <span class="slider"></span>
            </label>
          </div>
        </div>

        <div class="card">
          <h3>Teacher contacts</h3>
          ${renderTeacherContacts(studentId)}
        </div>
      </div>
    </div>
  `;

  document.getElementById("toggleLocation").addEventListener("change", (e) => {
    DB.settings[studentId].locationSharing = e.target.checked;
    saveDB();
    render();
  });
  document.getElementById("togglePeer").addEventListener("change", (e) => {
    DB.settings[studentId].peerSharing = e.target.checked;
    saveDB();
    render();
  });

  if (settings.locationSharing) requestLocationTag(studentId);
}

function requestLocationTag(studentId) {
  const tag = document.getElementById("locTag");
  if (!tag || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (!document.getElementById("locTag")) return;
      tag.textContent = `📍 GPS confirmed (${pos.coords.latitude.toFixed(2)}, ${pos.coords.longitude.toFixed(2)})`;
    },
    () => {
      if (!document.getElementById("locTag")) return;
      tag.textContent = "📍 Sharing on (based on schedule — GPS permission not granted)";
    },
    { timeout: 4000 }
  );
}

function renderPeriodList(studentId) {
  const day = todayName();
  const schedule = studentSchedule(studentId).filter((c) => c.days.includes(day));
  const byPeriod = new Map(schedule.map((c) => [c.periodId, c]));
  const nowMin = nowMinutes();

  const rows = DB.periods.map((p) => {
    const cls = byPeriod.get(p.id);
    const isNow = nowMin >= timeToMinutes(p.start) && nowMin < timeToMinutes(p.end) && WEEKDAYS.includes(day);
    if (!cls) {
      return `<li class="period-row free ${isNow ? "now" : ""}">
        <span class="period-swatch" style="background:#cbd5e1"></span>
        <span class="period-time">${formatTime(p.start)}</span>
        <span class="period-name">Free period</span>
        ${isNow ? `<span class="badge now">Now</span>` : ""}
      </li>`;
    }
    const teacher = getTeacher(cls.teacherId);
    return `<li class="period-row ${isNow ? "now" : ""}">
      <span class="period-swatch" style="background:${cls.color}"></span>
      <span class="period-time">${formatTime(p.start)}</span>
      <span>
        <div class="period-name">${cls.subject}</div>
        <div class="period-meta">Room ${cls.room}${teacher ? " · " + teacher.name : ""}</div>
      </span>
      ${isNow ? `<span class="badge now">Now</span>` : ""}
    </li>`;
  });

  const ecs = studentEcs(studentId).filter((e) => e.days.includes(day));
  const ecRows = ecs.map((ec) => {
    const isNow = nowMin >= timeToMinutes(ec.start) && nowMin < timeToMinutes(ec.end);
    return `<li class="period-row ${isNow ? "now" : ""}">
      <span class="period-swatch" style="background:${ec.color}"></span>
      <span class="period-time">${formatTime(ec.start)}</span>
      <span>
        <div class="period-name">${ec.name}</div>
        <div class="period-meta">${ec.location} · ${ec.type}</div>
      </span>
      ${isNow ? `<span class="badge now">Now</span>` : ""}
    </li>`;
  });

  return `<ul class="period-list">${rows.join("")}${ecRows.join("")}</ul>`;
}

function renderWeekGrid(studentId) {
  const schedule = studentSchedule(studentId);
  const ecs = studentEcs(studentId);

  let grid = `<div class="calendar-grid">`;
  grid += `<div></div>`;
  WEEKDAYS.forEach((d) => (grid += `<div class="col-head">${d}</div>`));

  DB.periods.forEach((p) => {
    grid += `<div class="time-label">${formatTime(p.start)}</div>`;
    WEEKDAYS.forEach((day) => {
      const cls = schedule.find((c) => c.periodId === p.id && c.days.includes(day));
      if (cls) {
        grid += `<div class="calendar-cell" style="background:${cls.color}">${cls.subject}<small>Rm ${cls.room}</small></div>`;
      } else {
        grid += `<div class="calendar-cell empty"></div>`;
      }
    });
  });
  grid += `</div>`;

  if (ecs.length) {
    grid += `<div class="calendar-grid" style="margin-top:8px">`;
    grid += `<div class="time-label">After school</div>`;
    WEEKDAYS.forEach((day) => {
      const dayEcs = ecs.filter((e) => e.days.includes(day));
      if (dayEcs.length) {
        grid += `<div class="calendar-cell" style="background:${dayEcs[0].color}">${dayEcs.map((e) => e.name).join(", ")}</div>`;
      } else {
        grid += `<div class="calendar-cell empty"></div>`;
      }
    });
    grid += `</div>`;
  }

  return grid;
}

function renderPeerMatches(studentId) {
  const student = getStudent(studentId);
  const mySettings = DB.settings[studentId];
  if (!mySettings.peerSharing) {
    return `<p class="empty-note">Turn on peer schedule sharing to see friends' current class and shared free periods.</p>`;
  }
  const friends = student.friendIds.map(getStudent).filter((f) => f && DB.settings[f.id].peerSharing);
  if (!friends.length) {
    return `<p class="empty-note">No friends are sharing their schedule with you yet.</p>`;
  }

  return friends
    .map((f) => {
      const activity = currentActivity(f.id);
      const overlap = freePeriodOverlap(studentId, f.id);
      return `<div class="peer-card">
        <div class="peer-head">
          <span class="avatar" style="background:${f.color}">${f.initials}</span>
          <div>
            <div class="contact-name">${f.name}</div>
            <div class="peer-status">Now: ${activity.label}</div>
          </div>
        </div>
        ${overlap.length ? `<div>${overlap.map((p) => `<span class="overlap-tag">Free together ${formatTime(p.start)}</span>`).join("")}</div>` : `<div class="peer-status">No shared free period today</div>`}
      </div>`;
    })
    .join("");
}

function renderTeacherContacts(studentId) {
  const schedule = studentSchedule(studentId);
  const ecs = studentEcs(studentId);
  const teacherIds = new Set([
    ...schedule.map((c) => c.teacherId).filter(Boolean),
    ...ecs.map((e) => e.teacherId).filter(Boolean)
  ]);
  const teachers = [...teacherIds].map(getTeacher);

  return `<ul class="contact-list">
    ${teachers
      .map(
        (t) => `<li class="contact-item">
      <span class="avatar" style="background:#64748b">${t.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}</span>
      <span>
        <div class="contact-name">${t.name}</div>
        <div class="contact-meta">${t.subject} · Rm ${t.room} · Office hours: ${t.office}</div>
      </span>
      <a class="email-link" href="mailto:${t.email}">Email</a>
    </li>`
      )
      .join("")}
  </ul>`;
}

/* ---- Parent view ---- */

function renderParentView() {
  const parent = DB.parents.find((p) => p.id === DB.ui.userId);
  const children = parent.childIds.map(getStudent);

  app.innerHTML = `
    <h1 class="section-title">Welcome back, ${parent.name.split(" ")[0]}</h1>
    <p class="section-sub">Live status, screen time, and contacts for ${children.map((c) => c.name).join(" & ")}</p>
    <div class="stack">
      ${children.map(renderChildBlock).join("")}
    </div>
  `;
}

function renderChildBlock(child) {
  const settings = DB.settings[child.id];
  const activity = settings.locationSharing ? currentActivity(child.id) : null;
  const usage = last7DaysUsage(child.id);
  const maxMin = Math.max(...usage.map((d) => d.minutes), 30);
  const weekTotal = usage.reduce((sum, d) => sum + d.minutes, 0);

  return `
    <div class="card">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <span class="avatar" style="background:${child.color}">${child.initials}</span>
        <h2 style="margin:0">${child.name}</h2>
      </div>

      ${
        activity
          ? `<div class="status-hero ${activity.type === "none" ? "offline" : ""}" style="margin:12px 0">
              <div class="pulse-dot"></div>
              <div>
                <div class="status-title">Currently</div>
                <div class="status-main">${activity.label}</div>
                <div class="status-detail">${activity.detail}</div>
              </div>
              <div class="location-tag">📍 Live</div>
            </div>`
          : `<p class="empty-note">${child.name} has location sharing turned off, so live status isn't available. Only screen time and schedule are shown.</p>`
      }

      <div class="view-grid">
        <div class="stack">
          <div>
            <h3>Weekly screen time</h3>
            <div class="usage-chart">
              ${usage
                .map(
                  (d) => `<div class="usage-bar-wrap">
                    <span class="usage-min-label">${d.minutes}m</span>
                    <div class="usage-bar ${d.isToday ? "today" : ""}" style="height:${Math.max(4, (d.minutes / maxMin) * 100)}%"></div>
                    <span class="usage-day-label">${d.label}</span>
                  </div>`
                )
                .join("")}
            </div>
            <p class="usage-total">Total this week: <strong>${weekTotal} min</strong> in ClassPulse</p>
          </div>

          <div>
            <h3>Upcoming this week</h3>
            ${renderWeekGrid(child.id)}
          </div>
        </div>

        <div class="stack">
          <div>
            <h3>Streak</h3>
            <div class="streak-box">
              <div class="streak-flame">🔥</div>
              <div>
                <div class="streak-num">${DB.streaks[child.id].count}-day streak</div>
                <div class="streak-label">${DB.streaks[child.id].xp} XP</div>
              </div>
            </div>
          </div>
          <div>
            <h3>Teacher contacts</h3>
            ${renderTeacherContacts(child.id)}
          </div>
        </div>
      </div>
    </div>
  `;
}

/* ---- Teacher view ---- */

function renderTeacherView() {
  const teacher = getTeacher(DB.ui.userId);
  const classes = DB.classes.filter((c) => c.teacherId === teacher.id);
  const ecs = DB.extracurriculars.filter((e) => e.teacherId === teacher.id);

  const rosterFor = (groupId, isEc) => {
    return DB.students.filter((s) =>
      isEc ? s.ecIds.includes(groupId) : s.classIds.includes(groupId)
    );
  };

  const groupOptions = [
    ...classes.map((c) => ({ id: c.id, label: `${c.subject} (Period ${c.periodId.slice(1)})`, isEc: false })),
    ...ecs.map((e) => ({ id: e.id, label: `${e.name} (after school)`, isEc: true }))
  ];

  app.innerHTML = `
    <h1 class="section-title">${teacher.name}'s classes</h1>
    <p class="section-sub">${teacher.subject} · Room ${teacher.room}</p>

    <div class="view-grid">
      <div class="stack">
        ${groupOptions
          .map((g) => {
            const roster = rosterFor(g.id, g.isEc);
            return `<div class="card">
              <h2>${g.label}</h2>
              <p class="card-sub">${roster.length} student${roster.length === 1 ? "" : "s"} enrolled</p>
              <table class="roster-table">
                <thead><tr><th>Student</th><th>Parent contact</th></tr></thead>
                <tbody>
                  ${roster
                    .map((s) => {
                      const parent = DB.parents.find((p) => p.childIds.includes(s.id));
                      return `<tr><td>${s.name}</td><td>${parent ? parent.name : "—"}</td></tr>`;
                    })
                    .join("")}
                </tbody>
              </table>
            </div>`;
          })
          .join("")}
      </div>

      <div class="stack">
        <div class="card">
          <h3>Post a note</h3>
          <p class="card-sub">Visible to students &amp; parents in the selected class or activity</p>
          <form class="note-form" id="noteForm" style="flex-direction:column;align-items:stretch">
            <select id="noteGroup">
              ${groupOptions.map((g) => `<option value="${g.isEc ? "ec:" : "class:"}${g.id}">${g.label}</option>`).join("")}
            </select>
            <textarea id="noteText" rows="2" placeholder="e.g. Bring your permission slip Friday" style="margin-top:8px"></textarea>
            <button type="submit" style="margin-top:8px">Post note</button>
          </form>
        </div>

        <div class="card">
          <h3>Recent notes</h3>
          ${renderTeacherNotes(teacher.id)}
        </div>
      </div>
    </div>
  `;

  document.getElementById("noteForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const val = document.getElementById("noteGroup").value;
    const text = document.getElementById("noteText").value.trim();
    if (!text) return;
    const [kind, id] = val.split(":");
    DB.notes.unshift({
      id: "n" + Date.now(),
      teacherId: teacher.id,
      classId: kind === "class" ? id : null,
      ecId: kind === "ec" ? id : null,
      text,
      ts: Date.now()
    });
    saveDB();
    render();
  });
}

function renderTeacherNotes(teacherId) {
  const notes = DB.notes.filter((n) => n.teacherId === teacherId).slice(0, 10);
  if (!notes.length) return `<p class="empty-note">No notes posted yet.</p>`;
  return notes
    .map((n) => {
      const group = n.classId ? getClass(n.classId) : getEc(n.ecId);
      const label = group ? (group.subject || group.name) : "General";
      return `<div class="note-item">${n.text}<div class="note-meta">${label} · ${new Date(n.ts).toLocaleString()}</div></div>`;
    })
    .join("");
}

/* ---------------------------------------------------------------------- */
/* Event wiring                                                           */
/* ---------------------------------------------------------------------- */

document.querySelectorAll(".role-pill").forEach((btn) => {
  btn.addEventListener("click", () => {
    DB.ui.role = btn.dataset.role;
    saveDB();
    render();
  });
});

userSelect.addEventListener("change", (e) => {
  DB.ui.userId = e.target.value;
  saveDB();
  render();
});

/* ---------------------------------------------------------------------- */
/* Usage tracking                                                         */
/* ---------------------------------------------------------------------- */

let lastTick = Date.now();

function flushUsage() {
  const now = Date.now();
  const minutes = (now - lastTick) / 60000;
  lastTick = now;
  // Attribute foreground time to whichever student is currently selected
  // in Student view (the "device owner" for this demo session).
  const trackedId = DB.ui.role === "student" ? DB.ui.userId : "s1";
  logUsageMinutes(trackedId, minutes);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) flushUsage();
  else lastTick = Date.now();
});

window.addEventListener("beforeunload", flushUsage);

setInterval(() => {
  if (!document.hidden) flushUsage();
  render();
}, 30000);

/* ---------------------------------------------------------------------- */
/* Init                                                                    */
/* ---------------------------------------------------------------------- */

render();
