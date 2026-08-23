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
  // Every interpolated value below is escaped, including the numeric-looking
  // ones. `summary` arrives from the student's device and was stored with no
  // validation at all, so openAssignments / overdue / gpa / attendance were
  // attacker-controlled strings dropped unescaped into mail sent from a
  // verified domain to that student's own parent. pushLocation now validates
  // and coerces them; this is the second layer, because the blob may still
  // hold values written before that landed.
  const upcoming = Array.isArray(s.upcoming) ? s.upcoming : [];
  const staleDays = Math.floor((Date.now() - (loc.at || 0)) / 86400000);
  const row = (label, value, danger) => `<tr>
    <td style="padding:4px 0;color:#4b5568">${label}</td>
    <td style="text-align:right;font-weight:600;${danger ? "color:#dc2626" : ""}">${value}</td>
  </tr>`;

  return `<div style="border:1px solid #e3e7f0;border-radius:10px;padding:16px;margin-bottom:16px">
    <div style="font-weight:700;margin-bottom:8px">${escapeHtml(name)}</div>
    <table style="width:100%;font-size:.88rem;border-collapse:collapse">
      ${row("Open assignments", escapeHtml(s.openAssignments))}
      ${row("Overdue", escapeHtml(s.overdue), Number(s.overdue) > 0)}
      ${s.gpa != null ? row("GPA", escapeHtml(s.gpa)) : ""}
      ${row("Study time this week", `${Math.round((Number(s.studyWeek) || 0) / 6) / 10}h`)}
      ${s.attendance != null ? row("Attendance", `${escapeHtml(s.attendance)}%`) : ""}
    </table>
    ${upcoming.length ? `
      <div style="margin-top:10px;font-size:.82rem;color:#4b5568">
        <div style="font-weight:600;margin-bottom:4px">Due soon</div>
        ${upcoming.slice(0, 5)
          .filter((a) => a && typeof a === "object")
          .map((a) => `<div>${escapeHtml(a.title)}${a.className ? " — " + escapeHtml(a.className) : ""} · ${escapeHtml(a.due)}</div>`)
          .join("")}
      </div>` : ""}
    ${staleDays > 3 ? `<p style="margin-top:10px;font-size:.75rem;color:#d97706">Last updated ${staleDays} days ago — their app may not have been open this week.</p>` : ""}
  </div>`;
}

/**
 * Netlify invokes a scheduled function with a JSON body carrying `next_run`,
 * and states that these are not reachable by ordinary HTTP request. This
 * checks anyway.
 *
 * The cost of being wrong is not small: an unguarded trigger sends real mail
 * to every linked parent, so anyone who could reach it would have a spam
 * relay pointed at children's guardians and a way to burn the Resend quota.
 * That is not a guarantee worth taking on trust from outside the platform,
 * and the check costs one comparison.
 */
function invokedBySchedule(req, payload) {
  if (!req) return true;                       // direct call from a test
  if (payload && payload.next_run) return true;
  const h = req.headers;
  if (h && (h.get("x-nf-event") === "schedule" || h.get("X-NF-Event") === "schedule")) return true;
  return false;
}

export default async (req) => {
  let payload = null;
  try { payload = req && req.json ? await req.json() : null; } catch (e) { payload = null; }
  if (!invokedBySchedule(req, payload)) {
    console.warn("[weekly-digest] refused a non-scheduled invocation");
    return new Response(JSON.stringify({ error: "This function runs on a schedule." }), {
      status: 403, headers: { "Content-Type": "application/json" }
    });
  }
  return await runDigest();
};

async function runDigest() {
  const profileKeys = await listKeys("profiles");
  let sent = 0, skipped = 0, failed = 0;

  for (const id of profileKeys) {
    let profile = null;
    try {
      profile = await readJSON("profiles", id, null);
    } catch (e) {
      console.error("[weekly-digest] could not read profile", id, e);
      failed++;
      continue;
    }
    if (!profile || profile.role !== "parent") continue;

    const kids = (profile.links || []).filter((l) => l.role === "child");
    if (!kids.length) { skipped++; continue; }

    // One malformed summary used to throw out of childSection and, because
    // nothing here caught it, abort the entire scheduled run — every parent
    // after this one in key order silently got nothing. A bad record now
    // costs that one child's section, not everybody's email.
    const sections = [];
    for (const k of kids) {
      try {
        const loc = await readJSON("locations", k.id, null);
        sections.push(childSection(k.name, loc));
      } catch (e) {
        console.error("[weekly-digest] section failed for child", k.id, e);
        sections.push(`<div style="border:1px solid #e3e7f0;border-radius:10px;padding:16px;margin-bottom:16px">
          <div style="font-weight:700;margin-bottom:6px">${escapeHtml(k.name)}</div>
          <p style="color:#8791a5;font-size:.85rem;margin:0">This week's summary couldn't be built.</p>
        </div>`);
      }
    }

    let result;
    try {
      result = await sendEmail({
        to: profile.email,
        subject: "Your weekly Scholar summary",
        html: layout("This week", sections.join(""))
      });
    } catch (e) {
      console.error("[weekly-digest] send failed for", profile.id, e);
      result = { sent: false };
    }

    if (result && result.sent) sent++; else skipped++;
  }

  console.log(`[weekly-digest] done — sent ${sent}, skipped ${skipped}, failed ${failed}`);
  return new Response(JSON.stringify({ sent, skipped, failed }), { headers: { "Content-Type": "application/json" } });
}

// Every Monday at 13:00 UTC. Netlify's cron scheduling docs:
// https://docs.netlify.com/functions/scheduled-functions/
export const config = { schedule: "0 13 * * 1" };
