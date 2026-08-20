/* ==========================================================================
   views/settings.js — profile, preferences, data export/import
   ========================================================================== */

App.views.settings = (function () {
  const U = App.utils, S = App.store, UI = App.ui;

  function dataSize() {
    try {
      const raw = localStorage.getItem("scholar.db.v1") || "";
      const kb = new Blob([raw]).size / 1024;
      return kb > 1024 ? `${U.round(kb / 1024, 2)} MB` : `${U.round(kb, 1)} KB`;
    } catch (e) { return "unknown"; }
  }

  function counts() {
    const d = S.db;
    return [
      ["Classes", d.classes.length], ["Assignments", d.assignments.length],
      ["Events", d.events.length], ["Notes", d.notes.length],
      ["Flashcards", U.sum(d.decks, (x) => x.cards.length)],
      ["Study sessions", d.studySessions.length],
      ["Activities", d.activities.length], ["Contacts", d.teachers.length]
    ];
  }

  function importDialog() {
    UI.modal({
      title: "Import a backup",
      okLabel: "Import",
      body: `<div class="field">
          <label>Choose a Scholar JSON backup</label>
          <input class="input" type="file" name="file" id="impFile" accept="application/json,.json" />
        </div>
        <div class="field mt-12">
          <label>…or paste the JSON directly</label>
          <textarea class="textarea" id="impText" rows="6" placeholder='{ "schema": 1, … }'></textarea>
        </div>
        <p class="hint mt-8" style="color:var(--danger)">
          ⚠ Importing replaces everything currently in the app.
        </p>`,
      onSubmit(_d, root) {
        const file = root.querySelector("#impFile").files[0];
        const text = root.querySelector("#impText").value.trim();

        const apply = (raw) => {
          try {
            S.importJSON(raw);
            UI.toast("Backup imported", "All data replaced.", "ok");
            App.router.go("dashboard");
          } catch (err) {
            UI.toast("Import failed", err.message, "danger");
          }
        };

        if (file) {
          const fr = new FileReader();
          fr.onload = () => apply(String(fr.result));
          fr.onerror = () => UI.toast("Import failed", "Couldn't read that file.", "danger");
          fr.readAsText(file);
          return true;
        }
        if (text) { apply(text); return true; }
        UI.toast("Nothing to import", "Pick a file or paste some JSON.", "warn");
        return false;
      }
    });
  }

  function render() {
    const p = S.profile;
    const st = S.settings;

    return `<div class="page-inner" style="max-width:860px">
      <div class="page-head">
        <div>
          <h1>Settings</h1>
          <div class="sub">Profile, preferences, and your data</div>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-head"><h3>Profile</h3></div>
        <div class="card-body">
          <div class="row gap-16 mb-16">
            ${UI.avatar(p.name, p.color, "xl")}
            <div>
              <div class="bold">${U.esc(p.name)}</div>
              <div class="small muted">${U.esc(p.grade)} · ${U.esc(p.school)}</div>
            </div>
          </div>
          <div class="form-grid">
            <div class="field"><label>Your name</label>
              <input class="input" data-p="name" value="${U.esc(p.name)}" /></div>
            <div class="field"><label>Email</label>
              <input class="input" type="email" data-p="email" value="${U.esc(p.email || "")}" /></div>
            <div class="field"><label>School</label>
              <input class="input" data-p="school" value="${U.esc(p.school || "")}" /></div>
            <div class="field"><label>Grade level</label>
              <input class="input" data-p="grade" value="${U.esc(p.grade || "")}" /></div>
            <div class="field"><label>Guardian name</label>
              <input class="input" data-p="parentName" value="${U.esc(p.parentName || "")}" /></div>
            <div class="field"><label>Guardian email</label>
              <input class="input" type="email" data-p="parentEmail" value="${U.esc(p.parentEmail || "")}" /></div>
          </div>
          <button class="btn btn-primary mt-16" data-save-profile>Save profile</button>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-head"><h3>Preferences</h3></div>
        <div class="card-body" style="padding-top:4px">
          ${[
            ["theme", "Dark mode", "Switch between the light and dark palette", st.theme === "dark"],
            ["weekStartsMonday", "Week starts on Monday", "Affects the calendar and weekly totals", st.weekStartsMonday],
            ["gpaWeighted", "Weighted GPA", "AP and Honors classes get a +1.0 bump, capped at 5.0", st.gpaWeighted]
          ].map(([key, title, desc, on]) => `
            <div class="between" style="padding:12px 0;border-bottom:1px solid var(--border)">
              <div style="min-width:0;padding-right:12px">
                <div class="bold small">${title}</div>
                <div class="tiny dim">${desc}</div>
              </div>
              <label class="switch">
                <input type="checkbox" data-pref="${key}" ${on ? "checked" : ""} />
                <span class="track"></span>
              </label>
            </div>`).join("")}

          <div class="between" style="padding:12px 0">
            <div>
              <div class="bold small">"Due soon" window</div>
              <div class="tiny dim">How many days ahead counts as due soon</div>
            </div>
            <select class="select input-sm" data-pref-num="dueSoonDays" style="width:110px">
              ${[1, 2, 3, 5, 7, 14].map((n) => `<option value="${n}" ${n === st.dueSoonDays ? "selected" : ""}>${n} days</option>`).join("")}
            </select>
          </div>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-head">
          <div><h3>Your data</h3><div class="sub">Stored in this browser only · ${dataSize()}</div></div>
        </div>
        <div class="card-body">
          <div class="grid g-4 mb-16">
            ${counts().map(([label, n]) => `
              <div class="center" style="padding:10px;background:var(--surface-2);border-radius:var(--radius-sm)">
                <div class="bold" style="font-size:1.3rem">${n}</div>
                <div class="tiny dim">${label}</div>
              </div>`).join("")}
          </div>
          <div class="row gap-8 wrap">
            <button class="btn" data-export>⬇ Export backup</button>
            <button class="btn" data-import>⬆ Import backup</button>
            <button class="btn" data-print>🖨 Print view</button>
            <span class="grow"></span>
            <button class="btn" data-reseed>↺ Restore demo data</button>
            <button class="btn btn-danger" data-wipe>🗑 Clear everything</button>
          </div>
          <p class="hint mt-12">
            Everything lives in this browser's local storage — clearing your browser data will erase it.
            Export a backup before switching devices.
          </p>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Keyboard shortcuts</h3></div>
        <div class="card-body">
          <div class="grid g-2">
            ${[
              ["⌘K / Ctrl+K", "Open the command palette"],
              ["G then D", "Go to dashboard"],
              ["G then H", "Go to homework"],
              ["G then C", "Go to calendar"],
              ["N", "New assignment"],
              ["T", "Toggle dark mode"],
              ["Space", "Flip a flashcard (in study mode)"],
              ["Esc", "Close a dialog"]
            ].map(([k, d]) => `
              <div class="between" style="padding:7px 0">
                <span class="small muted">${d}</span>
                <span class="kbd">${k}</span>
              </div>`).join("")}
          </div>
        </div>
      </div>

      <p class="center tiny dim mt-24">
        Scholar · a school tracker built with plain HTML, CSS, and JavaScript — no frameworks, no backend.
      </p>
    </div>`;
  }

  function mount(root) {
    U.on(root, "click", "[data-save-profile]", () => {
      const patch = {};
      U.$$("[data-p]", root).forEach((el) => { patch[el.dataset.p] = el.value.trim(); });
      S.commit((db) => { Object.assign(db.profile, patch); });
      UI.toast("Profile saved", patch.name, "ok");
    });

    U.on(root, "change", "[data-pref]", (_e, el) => {
      const key = el.dataset.pref;
      if (key === "theme") {
        S.commit((db) => { db.settings.theme = el.checked ? "dark" : "light"; });
        App.applyTheme();
      } else {
        S.commit((db) => { db.settings[key] = el.checked; });
      }
    });

    U.on(root, "change", "[data-pref-num]", (_e, el) => {
      S.commit((db) => { db.settings[el.dataset.prefNum] = Number(el.value); });
    });

    U.on(root, "click", "[data-export]", () => {
      U.download(`scholar-backup-${U.today()}.json`, S.exportJSON());
      UI.toast("Backup downloaded", "Keep it somewhere safe.", "ok");
    });

    U.on(root, "click", "[data-import]", importDialog);
    U.on(root, "click", "[data-print]", () => window.print());

    U.on(root, "click", "[data-reseed]", () => {
      UI.confirm({
        title: "Restore demo data?",
        message: "This replaces everything with the sample school year that ships with the app.",
        okLabel: "Restore demo", danger: true,
        onConfirm() { S.reset(); UI.toast("Demo data restored"); App.router.go("dashboard"); }
      });
    });

    U.on(root, "click", "[data-wipe]", () => {
      UI.confirm({
        title: "Clear everything?",
        message: "All assignments, notes, grades, and logs will be deleted. Your classes and bell schedule are kept so you can start fresh. This can't be undone.",
        okLabel: "Clear it all", danger: true,
        onConfirm() { S.wipe(); UI.toast("Data cleared", "Starting fresh.", "warn"); App.router.go("dashboard"); }
      });
    });
  }

  return { render, mount, title: "Settings" };
})();
