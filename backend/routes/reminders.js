const express = require("express");
const { sendMail } = require("../utils/mailer"); // expects module that exports sendMail(...)
const router = express.Router();

const API_BASE = (process.env.API_BASE || process.env.BACKEND_URL || "http://localhost:5000").replace(/\/$/, "");
const FRONTEND_BASE = (process.env.FRONTEND_BASE || process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

/* existing /send route left unchanged ... */

/**
 * POST /api/reminders/create
 * body: { entity: "visitors", entityId: "..." , subject?, text?, html? }
 * This is an alias that fetches the single entity record and sends reminder immediately.
 */
router.post("/create", async (req, res) => {
  try {
    const { entity, entityId, subject, text, html } = req.body || {};
    if (!entity || !entityId) return res.status(400).json({ success: false, error: "entity and entityId required" });

    // Try to fetch the single record
    const singleUrl = `${API_BASE}/api/${entity}/${encodeURIComponent(String(entityId))}`;
    const r = await fetch(singleUrl, { headers: { Accept: "application/json", "ngrok-skip-browser-warning": "69420" } });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return res.status(502).json({ success: false, error: `Failed to fetch ${entity}/${entityId}: ${r.status}`, body });
    }
    const record = await r.json().catch(() => null);
    if (!record) return res.status(404).json({ success: false, error: "record not found" });

    const to = record.email || record.emailAddress || record.contactEmail;
    if (!to) return res.status(400).json({ success: false, error: "recipient has no email" });

    const subj = subject || `${(record.name || record.company || "Participant")} — Reminder`;
    let bodyText = text || `Hello ${record.name || ""},\n\nThis is a reminder about the upcoming event.\n\nRegards,\nTeam`;
    let bodyHtml = html || `<p>Hello ${record.name || ""},</p><p>This is a reminder about the upcoming event.</p><p>Regards,<br/>Team</p>`;

    // Add upgrade link if ticketed
    const isTicketed = ["speakers", "awardees", "exhibitors", "visitors"].includes(entity);
    if (isTicketed && (record.ticket_code || record.ticketCode)) {
      const id = record.id || record._id || record.insertedId || "";
      const ticketCode = record.ticket_code || record.ticketCode;
      const upgradeUrl = `${FRONTEND_BASE}/ticket-upgrade?entity=${encodeURIComponent(entity)}&id=${encodeURIComponent(String(id))}&ticket_code=${encodeURIComponent(String(ticketCode))}`;
      bodyHtml += `<p style="margin-top:12px">Want to upgrade your ticket? <a href="${upgradeUrl}">Click here to upgrade</a>.</p>`;
      bodyText += `\n\nWant to upgrade your ticket? Visit: ${upgradeUrl}`;
    }

    const sendResult = await sendMail({ to, subject: subj, text: bodyText, html: bodyHtml });
    if (sendResult && sendResult.success) {
      return res.json({ success: true, sent: 1, info: sendResult.info || null });
    } else {
      return res.status(500).json({ success: false, error: sendResult && (sendResult.error || sendResult.body) });
    }
  } catch (err) {
    console.error("reminders.create error:", err && (err.stack || err));
    res.status(500).json({ success: false, error: String(err && err.message ? err.message : err) });
  }
});