const express = require("express");
const { sendMail } = require("../utils/mailer"); // expects module that exports sendMail(...)
const router = express.Router();

const API_BASE = (process.env.API_BASE || process.env.BACKEND_URL || "http://localhost:5000").replace(/\/$/, "");
const FRONTEND_BASE = (process.env.FRONTEND_BASE || process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

router.use(express.json({ limit: "3mb" }));

/**
 * Utility - try to find an event date on a record using common field names
 */
function parseEventDate(record) {
  if (!record) return null;
  const candidates = [
    record.eventDate,
    record.event_date,
    record.event?.date,
    record.eventDetails?.date,
    record.eventDetailsDate,
    record.date,
    record.eventDateString,
  ];
  for (const c of candidates) {
    if (!c) continue;
    const d = new Date(c);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

/**
 * Compute whole-day difference (eventDate - today) in days using UTC day boundaries.
 * Example: If event is exactly 7 days from today (irrespective of hour), returns 7.
 */
function daysUntilEvent(eventDate) {
  if (!eventDate) return null;
  const now = new Date();
  const utcNowDayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const d = new Date(eventDate);
  const utcEventDayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const diffMs = utcEventDayStart - utcNowDayStart;
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

/**
 * POST /api/reminders/scheduled
 *
 * Body:
 * {
 *   entity: "visitors",
 *   scheduleDays: [7,3,1,0],   // days before event to send reminders (default)
 *   query?: { ... }            // optional: pass-through query parameters to filter records (not all backends support)
 *   subject?, text?, html?     // optional overrides for message body
 * }
 *
 * This endpoint fetches candidate records from the API, filters by event date,
 * and sends reminders only when daysUntilEvent is one of scheduleDays and the
 * record does not already indicate that a reminder for that day was sent
 * (record.reminders_sent should be an array of numeric days already notified).
 *
 * After successful send, this route updates the record (PUT) to add the sent day
 * into reminders_sent and set last_reminder_at timestamp. This prevents duplicate daily sends.
 */
router.post("/scheduled", async (req, res) => {
  try {
    const { entity = "visitors", scheduleDays = [7, 3, 1, 0], query = "" } = req.body || {};
    if (!entity) return res.status(400).json({ success: false, error: "entity required" });

    // Normalize scheduleDays
    const daysSet = new Set((Array.isArray(scheduleDays) ? scheduleDays : [scheduleDays]).map((n) => Number(n)).filter((n) => !Number.isNaN(n)));

    // Build list URL - attempt to respect a pass-through 'query' string if provided
    // Example query could be "?where=eventId=123&limit=100"
    const listUrl = query && typeof query === "string" ? `${API_BASE}/api/${entity}${query}` : `${API_BASE}/api/${entity}?limit=1000`;

    let fetched = [];
    try {
      const r = await fetch(listUrl, { headers: { Accept: "application/json", "ngrok-skip-browser-warning": "69420" } });
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        console.warn(`[reminders] failed to fetch list ${listUrl}: ${r.status}`, txt);
        return res.status(502).json({ success: false, error: `Failed to fetch ${entity} list: ${r.status}`, body: txt });
      }
      const json = await r.json().catch(() => null);
      if (!json) {
        return res.status(502).json({ success: false, error: "List endpoint returned invalid JSON" });
      }
      // If API returns object with data or rows, try to extract
      if (Array.isArray(json)) fetched = json;
      else if (Array.isArray(json.data)) fetched = json.data;
      else if (Array.isArray(json.rows)) fetched = json.rows;
      else if (Array.isArray(json.results)) fetched = json.results;
      else {
        // attempt to coerce into array if object keyed by ids
        fetched = Array.isArray(json) ? json : (typeof json === "object" ? Object.values(json) : []);
      }
    } catch (err) {
      console.error("[reminders] list fetch failed", err);
      return res.status(502).json({ success: false, error: "Failed to fetch records", details: String(err && err.message ? err.message : err) });
    }

    if (!Array.isArray(fetched) || fetched.length === 0) {
      return res.json({ success: true, processed: 0, sent: 0, skipped: 0, note: "No records" });
    }

    let processed = 0;
    let sentCount = 0;
    let skipped = 0;
    const errors = [];

    for (const rec of fetched) {
      try {
        processed += 1;
        const eventDate = parseEventDate(rec);
        if (!eventDate) {
          skipped += 1;
          continue;
        }

        const daysUntil = daysUntilEvent(eventDate);
        if (daysUntil === null || daysUntil === undefined) {
          skipped += 1;
          continue;
        }

        // Only send when daysUntil is in scheduleDays
        if (!daysSet.has(daysUntil)) {
          skipped += 1;
          continue;
        }

        // Check reminders_sent tracking on the record to avoid duplicate sends for same daysUntil
        const remindersSent = Array.isArray(rec.reminders_sent) ? rec.reminders_sent.map((v) => Number(v)).filter((v) => !Number.isNaN(v)) : [];
        if (remindersSent.includes(daysUntil)) {
          // already sent this scheduled reminder
          skipped += 1;
          continue;
        }

        // Recipient
        const to = rec.email || rec.emailAddress || rec.contactEmail || rec.contact_email;
        if (!to) {
          skipped += 1;
          continue;
        }

        // Compose message (simple default; customize if you pass subject/text/html in body)
        const baseName = (rec.name || rec.full_name || rec.company || "Participant");
        const subj = req.body.subject || `${baseName} — Reminder: ${(eventDate && eventDate.toDateString()) || "Upcoming event"}`;
        // Friendly day label
        const dayLabel = daysUntil === 0 ? "today" : `${daysUntil} day${Math.abs(daysUntil) === 1 ? "" : "s"} to go`;
        let bodyText = req.body.text || `Hello ${rec.name || ""},\n\nThis is a reminder that the event "${(rec.eventDetails && rec.eventDetails.name) || (rec.event && rec.event.name) || ""}" is ${dayLabel}.\n\nRegards,\nTeam`;
        let bodyHtml = req.body.html || `<p>Hello ${rec.name || ""},</p><p>This is a reminder that the event "<strong>${(rec.eventDetails && rec.eventDetails.name) || (rec.event && rec.event.name) || ""}</strong>" is <strong>${dayLabel}</strong>.</p><p>Regards,<br/>Team</p>`;

        // Add upgrade link for ticketed entities
        const isTicketed = ["speakers", "awardees", "exhibitors", "visitors"].includes(String(entity).toLowerCase());
        if (isTicketed && (rec.ticket_code || rec.ticketCode)) {
          const id = rec.id || rec._id || rec.insertedId || "";
          const ticketCode = rec.ticket_code || rec.ticketCode;
          const upgradeUrl = `${FRONTEND_BASE}/ticket-upgrade?entity=${encodeURIComponent(entity)}&id=${encodeURIComponent(String(id || ""))}&ticket_code=${encodeURIComponent(String(ticketCode || ""))}`;
          bodyHtml += `<p style="margin-top:12px">Want to upgrade your ticket? <a href="${upgradeUrl}">Click here to upgrade</a>.</p>`;
          bodyText += `\n\nWant to upgrade your ticket? Visit: ${upgradeUrl}`;
        }

        // Send mail (sendMail should return { success: true } on success)
        let sendResult;
        try {
          sendResult = await sendMail({ to, subject: subj, text: bodyText, html: bodyHtml });
        } catch (err) {
          console.error("[reminders] sendMail threw", err);
          errors.push({ id: rec.id || rec.ticket_code || null, error: String(err && err.message ? err.message : err) });
          continue;
        }

        if (!sendResult || !sendResult.success) {
          errors.push({ id: rec.id || rec.ticket_code || null, error: sendResult && (sendResult.error || sendResult.body) ? (sendResult.error || sendResult.body) : "Unknown send failure" });
          continue;
        }

        // On success, patch the record to mark this daysUntil as sent to avoid duplicates
        try {
          const nowIso = new Date().toISOString();
          const updatedReminders = Array.isArray(rec.reminders_sent) ? Array.from(new Set([...rec.reminders_sent.map((v) => Number(v)), daysUntil])) : [daysUntil];
          // Use your existing update endpoint — PUT /api/visitors/:id
          const updateId = rec.id || rec._id || rec.insertedId || null;
          const updatePayload = { reminders_sent: updatedReminders, last_reminder_at: nowIso };
          if (updateId) {
            await fetch(`${API_BASE}/api/${entity}/${encodeURIComponent(String(updateId))}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
              body: JSON.stringify(updatePayload),
            }).catch((e) => {
              // best-effort only - log and continue
              console.warn("[reminders] failed to update record reminders_sent", updateId, e && (e.message || e));
            });
          } else {
            // If no numeric id, attempt upgrade-by-code or patch-by-ticket-code if available
            if (rec.ticket_code || rec.ticketCode) {
              await fetch(`${API_BASE}/api/${entity}/upgrade-by-code`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
                body: JSON.stringify({ ticket_code: rec.ticket_code || rec.ticketCode, reminders_sent: updatedReminders, last_reminder_at: nowIso }),
              }).catch(() => {});
            }
          }
        } catch (e) {
          console.warn("[reminders] post-send update failed", e && (e.message || e));
        }

        sentCount += 1;
      } catch (errInner) {
        console.error("[reminders] per-record error", errInner);
        errors.push({ error: String(errInner && errInner.message ? errInner.message : errInner) });
      }
    }

    return res.json({ success: true, processed, sent: sentCount, skipped, errors });
  } catch (err) {
    console.error("[reminders] scheduled error:", err && (err.stack || err));
    return res.status(500).json({ success: false, error: "Server error", details: String(err && err.message ? err.message : err) });
  }
});

module.exports = router;