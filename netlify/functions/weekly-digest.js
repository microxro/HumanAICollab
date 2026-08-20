/* ==========================================================================
   weekly-digest.js — F066: a Monday email so a parent doesn't have to open
   the app to stay informed.

   Runs on Netlify's scheduler (see `config` at the bottom — a cron
   expression, not an HTTP route). Reads only the summary each student's own
   device already pushes via POST /location (js/sync.js pushLocation) — the
   same privacy-filtered numbers the parent portal itself shows. That means
   no grade/GPA math is duplicated here, and nothing shows up in an email
   that the student didn't already agree to share (gpa/classes are null in
   that summary unless shareGrades is on, and this function has no other
   way to see a student's grades).
   ========================================================================== */

import { listKeys, readJSON } from "./_lib/blobs.js";
import { sendEmail, layout } from "./_lib/email.js";

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function childSection(name, loc) {
  if (!loc || !loc.summary) {
    return `<div style="border:1px solid #e3e7f0;border-radius:10px;padding:16px;margin-bottom:16px">
      <div style="font-weight:700;margin-bottom:6px">${escapeHtml(name)}</div>
      <p style="color:#8791a5;font-size:.85rem;margin:0">No summary yet — their app hasn't synced a status.</p>
    </div>`;
  }
  const s = loc.summary;
  const staleDays = Math.floor((Date.now() - (loc.at || 0)) / 86400000);
  const row = (label, value, danger) => `<tr>
    <td style="padding:4px 0;color:#4b5568">${label}</td>
    <td style="text-align:right;font-weight:600;${danger ? "color:#dc2626" : ""}">${value}</td>
  </tr>`;

  return `<div style="border:1px solid #e3e7f0;border-radius:10px;padding:16px;margin-bottom:16px">
    <div style="font-weight:700;margin-bottom:8px">${escapeHtml(name)}</div>
    <table style="width:100%;font-size:.88rem;border-collapse:collapse">
      ${row("Open assignments", s.openAssignments)}
      ${row("Overdue", s.overdue, s.overdue > 0)}
      ${s.gpa != null ? row("GPA", s.gpa) : ""}
      ${row("Study time this week", `${Math.round((s.studyWeek || 0) / 6) / 10}h`)}
      ${row("Attendance", `${s.attendance}%`)}
    </table>
    ${s.upcoming && s.upcoming.length ? `
      <div style="margin-top:10px;font-size:.82rem;color:#4b5568">
        <div style="font-weight:600;margin-bottom:4px">Due soon</div>
        ${s.upcoming.slice(0, 5).map((a) => `<div>${escapeHtml(a.title)}${a.className ? " — " + escapeHtml(a.className) : ""} · ${escapeHtml(a.due)}</div>`).join("")}
      </div>` : ""}
    ${staleDays > 3 ? `<p style="margin-top:10px;font-size:.75rem;color:#d97706">Last updated ${staleDays} days ago — their app may not have been open this week.</p>` : ""}
  </div>`;
}

export default async () => {
  const profileKeys = await listKeys("profiles");
  let sent = 0, skipped = 0;

  for (const id of profileKeys) {
    const profile = await readJSON("profiles", id, null);
    if (!profile || profile.role !== "parent") continue;

    const kids = (profile.links || []).filter((l) => l.role === "child");
    if (!kids.length) { skipped++; continue; }

    const sections = [];
    for (const k of kids) {
      const loc = await readJSON("locations", k.id, null);
      sections.push(childSection(k.name, loc));
    }

    const result = await sendEmail({
      to: profile.email,
      subject: "Your weekly Scholar summary",
      html: layout("This week", sections.join(""))
    }).catch((e) => { console.error("[weekly-digest] send failed for", profile.id, e); return { sent: false }; });

    if (result.sent) sent++; else skipped++;
  }

  console.log(`[weekly-digest] done — sent ${sent}, skipped ${skipped}`);
  return new Response(JSON.stringify({ sent, skipped }), { headers: { "Content-Type": "application/json" } });
};

// Every Monday at 13:00 UTC. Netlify's cron scheduling docs:
// https://docs.netlify.com/functions/scheduled-functions/
export const config = { schedule: "0 13 * * 1" };
