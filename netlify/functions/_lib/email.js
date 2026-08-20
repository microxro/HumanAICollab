/* ==========================================================================
   _lib/email.js — outbound email via Resend

   One place that knows how to send an email; every feature that needs to
   (password reset, the weekly parent digest) calls sendEmail() rather than
   talking to Resend directly. Missing RESEND_API_KEY doesn't crash the
   caller — it logs and returns { sent: false }, so an unconfigured deploy
   degrades to "no email sent" instead of a 500 on every password reset.
   ========================================================================== */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function configured() {
  return !!process.env.RESEND_API_KEY;
}

/**
 * sendEmail({ to, subject, html })
 * `from` defaults to EMAIL_FROM, falling back to Resend's shared test
 * domain — fine for development, but real recipients' inboxes will flag
 * mail from @resend.dev, so set EMAIL_FROM to an address on a domain
 * you've verified in Resend before relying on this for real users.
 */
async function sendEmail({ to, subject, html, from }) {
  if (!configured()) {
    console.warn("[email] RESEND_API_KEY not set — skipping send to", to, "(" + subject + ")");
    return { sent: false, reason: "not-configured" };
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.RESEND_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: from || process.env.EMAIL_FROM || "onboarding@resend.dev",
      to,
      subject,
      html
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[email] Resend send failed", res.status, text);
    return { sent: false, reason: "provider-error", status: res.status };
  }
  return { sent: true };
}

/** Shared wrapper so every email looks like it came from the same app. */
function layout(title, bodyHtml) {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#10141f">
    <div style="font-size:1.3rem;font-weight:800;margin-bottom:4px">
      <span style="display:inline-block;width:22px;height:22px;border-radius:6px;background:#4f46e5;color:#fff;text-align:center;line-height:22px;font-size:.85rem;margin-right:6px">S</span>
      Scholar
    </div>
    <h1 style="font-size:1.1rem;margin:20px 0 12px">${title}</h1>
    ${bodyHtml}
    <p style="margin-top:32px;font-size:.75rem;color:#8791a5">
      You're receiving this because of activity on a Scholar account linked to this address.
    </p>
  </div>`;
}

export { sendEmail, layout, configured };
