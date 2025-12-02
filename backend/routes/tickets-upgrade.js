const express = require("express");
const router = express.Router();
const { sendMail } = require("../utils/mailer");

const API_BASE = (process.env.API_BASE || process.env.BACKEND_URL || "http://localhost:5000").replace(/\/$/, "");
const FRONTEND_BASE = (process.env.FRONTEND_BASE || process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

/**
 * POST /api/tickets/upgrade
 * Body: {
 *   entity_type: "speakers" | "awardees" | "exhibitors" | "partners",
 *   entity_id: "<id>",
 *   new_category: "vip" | "delegate" | "combo" | ...,
 *   amount?: number (optional; if present and >0 we will create a payment order and return checkoutUrl)
 * }
 *
 * Behavior:
 * - If amount > 0: create payment order by calling internal /api/payment/create-order and return checkoutUrl
 *   Caller (frontend) should redirect user to checkout; backend payment webhook should finalize upgrade by calling this same endpoint with provider tx id.
 * - If amount == 0 or not provided: perform the upgrade immediately by updating ticket record and entity confirm endpoints.
 */
router.post("/", async (req, res) => {
  try {
    const { entity_type, entity_id, new_category, amount = 0, email } = req.body || {};
    if (!entity_type || !entity_id || !new_category) return res.status(400).json({ success: false, error: "entity_type, entity_id and new_category are required" });

    // If payment required, create order and return checkoutUrl
    if (Number(amount) > 0) {
      const payload = {
        amount: Number(amount),
        currency: "INR",
        description: `Ticket Upgrade - ${new_category}`,
        reference_id: String(entity_id),
        metadata: { entity_type, new_category },
      };
      const r = await fetch(`${API_BASE}/api/payment/create-order`, { method: "POST", headers: { "Content-Type": "application/json" , "ngrok-skip-browser-warning": "69420" }, body: JSON.stringify(payload) });
      const js = await r.json().catch(() => ({}));
      if (!r.ok || !js.success) {
        return res.status(502).json({ success: false, error: js.error || "Failed to create payment order" });
      }
      return res.json({ success: true, checkoutUrl: js.checkoutUrl || js.checkout_url || js.raw?.checkout_url, order: js });
    }

    // No payment: apply upgrade immediately
    // 1) update ticket record (idempotent create)
    // Fetch existing entity to get name/email/company/ticket_code
    let entityRow = null;
    try {
      const rowRes = await fetch(`${API_BASE}/api/${encodeURIComponent(entity_type)}/${encodeURIComponent(String(entity_id))}`);
      if (rowRes.ok) entityRow = await rowRes.json().catch(()=>null);
    } catch (e) { /* ignore */ }

    const ticket_code = (entityRow && (entityRow.ticket_code || entityRow.code)) || null;
    const name = (entityRow && (entityRow.name || entityRow.fullName || entityRow.company)) || "";
    const emailToUse = email || (entityRow && (entityRow.email || entityRow.contactEmail)) || "";

    try {
      await fetch(`${API_BASE}/api/tickets/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" , "ngrok-skip-browser-warning": "69420" },
        body: JSON.stringify({
          ticket_code,
          entity_type: entity_type.replace(/s$/, ""), // e.g. speakers -> speaker
          entity_id: entity_id || null,
          name,
          email: emailToUse || null,
          company: entityRow && entityRow.company,
          category: new_category,
          meta: { upgradedFrom: "self-service", upgradedAt: new Date().toISOString() },
        }),
      }).catch(()=>{});
    } catch (e) {
      // log but continue
      console.warn("tickets.create during upgrade failed", e);
    }

    // 2) update entity confirm endpoint
    try {
      await fetch(`${API_BASE}/api/${encodeURIComponent(entity_type)}/${encodeURIComponent(String(entity_id))}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" , "ngrok-skip-browser-warning": "69420" },
        body: JSON.stringify({ ticket_category: new_category, upgradedAt: new Date().toISOString() }),
      }).catch(()=>{});
    } catch (e) {
      console.warn("entity confirm during upgrade failed", e);
    }

    // 3) send confirmation mail about upgrade
    if (emailToUse) {
      try {
        const upgradeManageUrl = `${FRONTEND_BASE}/ticket?entity=${encodeURIComponent(entity_type)}&id=${encodeURIComponent(String(entity_id))}`;
        const subj = `Your ticket has been upgraded to ${new_category}`;
        const bodyText = `Hello ${name || ""},\n\nYour ticket has been upgraded to ${new_category}.\n\nYou can view/manage your ticket here: ${upgradeManageUrl}\n\nRegards,\nTeam`;
        const bodyHtml = `<p>Hello ${name || ""},</p><p>Your ticket has been upgraded to <strong>${new_category}</strong>.</p><p>You can view/manage your ticket <a href="${upgradeManageUrl}">here</a>.</p>`;
        await sendMail({ to: emailToUse, subject: subj, text: bodyText, html: bodyHtml });
      } catch (e) {
        console.warn("upgrade confirmation email failed", e);
      }
    }

    return res.json({ success: true, upgraded: true, entity_type, entity_id, new_category });
  } catch (err) {
    console.error("tickets-upgrade error:", err && (err.stack || err));
    res.status(500).json({ success: false, error: String(err && err.message ? err.message : err) });
  }
});

module.exports = router;