const express = require("express");
const { sendMail } = require("../utils/mailer"); // expects module that exports sendMail(...)
const router = express.Router();

const API_BASE = (process.env.API_BASE || process.env.BACKEND_URL || "http://localhost:5000").replace(/\/$/, "");
const FRONTEND_BASE = (process.env.FRONTEND_BASE || process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

/**
 * POST /api/reminders/send
 * body: { entity: "speakers" | "awardees" | "partners" | "exhibitors" , filter?: { ... } , subject?: string, text?: string, html?: string }
 *
 * The endpoint fetches registrants for the given entity from the backend list endpoint
 * (GET `${API_BASE}/api/${entity}?limit=1000`), iterates and sends reminder emails using sendMail().
 * If a record contains ticket_code and the entity is a ticketed entity, the email will include an "Upgrade ticket" link.
 *
 * This is intentionally permissive — caller must ensure they provide appropriate subject/body or rely on defaults.
 */
router.post("/send", async (req, res) => {
  try {
    const { entity, filter = {}, subject, text, html } = req.body || {};
    if (!entity) return res.status(400).json({ success: false, error: "entity required" });

    // Build list endpoint URL (basic support for filter as query params)
    const params = new URLSearchParams();
    params.set("limit", String(filter.limit || 1000));
    if (filter.where && typeof filter.where === "string") params.set("where", filter.where);
    const listUrl = `${API_BASE}/api/${entity}?${params.toString()}`;

    // fetch list
    const listRes = await fetch(listUrl, { headers: { Accept: "application/json" , "ngrok-skip-browser-warning": "69420" } });
    if (!listRes.ok) {
      const txt = await listRes.text().catch(() => "");
      return res.status(502).json({ success: false, error: `Failed to fetch ${entity}: ${listRes.status}`, body: txt });
    }
    const recipients = await listRes.json().catch(() => []);
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.json({ success: true, sent: 0, message: "No recipients found" });
    }

    const isTicketed = ["speakers", "awardees", "exhibitors", "visitors"].includes(entity);

    let sent = 0;
    const results = [];
    for (const r of recipients) {
      try {
        const to = r.email || r.emailAddress || r.contactEmail || r.to;
        if (!to) {
          results.push({ ok: false, reason: "no-email", record: r });
          continue;
        }

        // Compose email (use provided subject/text/html or reasonable defaults)
        const subj = subject || `${(r.name || r.company || "Participant")} — Reminder: ${ (r.eventName || "") || "Event" }`;
        let bodyText = text || `Hello ${r.name || ""},\n\nThis is a reminder about the upcoming event.\n\nRegards,\nTeam`;
        let bodyHtml = html || `<p>Hello ${r.name || ""},</p><p>This is a reminder about the upcoming event.</p><p>Regards,<br/>Team</p>`;

        // If ticketed and ticket_code present, add upgrade link
        if (isTicketed && (r.ticket_code || r.ticketCode)) {
          const id = r.id || r._id || r.insertedId || "";
          const ticketCode = r.ticket_code || r.ticketCode;
          const upgradeUrl = `${FRONTEND_BASE}/ticket-upgrade?entity=${encodeURIComponent(entity)}&id=${encodeURIComponent(String(id))}&ticket_code=${encodeURIComponent(String(ticketCode))}`;
          bodyHtml += `<p style="margin-top:12px">Want to upgrade your ticket? <a href="${upgradeUrl}">Click here to upgrade</a>.</p>`;
          bodyText += `\n\nWant to upgrade your ticket? Visit: ${upgradeUrl}`;
        }

        const sendResult = await sendMail({ to, subject: subj, text: bodyText, html: bodyHtml });
        if (sendResult && sendResult.success) {
          sent++;
          results.push({ ok: true, to, info: sendResult.info || null });
        } else {
          results.push({ ok: false, to, error: sendResult.error || sendResult.body || null });
        }
      } catch (e) {
        results.push({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    }

    res.json({ success: true, sent, total: recipients.length, results });
  } catch (err) {
    console.error("reminders.send error:", err && (err.stack || err));
    res.status(500).json({ success: false, error: String(err && err.message ? err.message : err) });
  }
});

module.exports = router;