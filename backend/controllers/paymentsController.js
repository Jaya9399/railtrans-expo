/**
 * backend/controllers/paymentsController.js
 *
 * Instamojo integration (uses public webhook URL from INSTAMOJO_WEBHOOK_URL or BACKEND_ORIGIN).
 *
 * Required env variables (set these securely):
 * - INSTAMOJO_API_KEY
 * - INSTAMOJO_AUTH_TOKEN
 * - INSTAMOJO_API_BASE    (https://www.instamojo.com for production)
 * - APP_ORIGIN           (frontend origin used for redirect_url fallback)
 * Optional:
 * - BACKEND_ORIGIN       (public backend origin, used to form webhook if INSTAMOJO_WEBHOOK_URL not set)
 * - INSTAMOJO_WEBHOOK_URL (explicit public webhook URL, e.g. https://abcd-1234.ngrok-free.dev/api/payment/webhook)
 */
const axios = require("axios");
const pool = require("../db"); // adapt to your DB helper
const util = require("util");

const INSTAMOJO_API_KEY = (process.env.INSTAMOJO_API_KEY || "").trim();
const INSTAMOJO_AUTH_TOKEN = (process.env.INSTAMOJO_AUTH_TOKEN || "").trim();
const INSTAMOJO_API_BASE = (process.env.INSTAMOJO_API_BASE || "https://www.instamojo.com").replace(/\/$/, "");
const INSTAMOJO_WEBHOOK_URL = (process.env.INSTAMOJO_WEBHOOK_URL || "").trim(); // explicit override (ngrok)
const APP_ORIGIN = (process.env.APP_ORIGIN || "http://localhost:3000").replace(/\/$/, "");
const BACKEND_ORIGIN = (process.env.BACKEND_ORIGIN || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, "");

if (!INSTAMOJO_API_KEY || !INSTAMOJO_AUTH_TOKEN) {
  console.warn("Instamojo credentials not set. Set INSTAMOJO_API_KEY and INSTAMOJO_AUTH_TOKEN in env.");
}

function isLocalHost(url) {
  if (!url) return true;
  try {
    const u = new URL(url);
    const host = u.hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "";
  } catch (e) {
    return true;
  }
}

function formatAmount(amount) {
  const n = Number(amount) || 0;
  return n.toFixed(2);
}

function instamojoHeaders() {
  return {
    "X-Api-Key": INSTAMOJO_API_KEY,
    "X-Auth-Token": INSTAMOJO_AUTH_TOKEN,
    "Content-Type": "application/x-www-form-urlencoded",
  };
}

/**
 * POST /api/payment/create-order
 * Body: { amount, currency, description, reference_id, metadata, visitor_id }
 */
exports.createOrder = async (req, res) => {
  try {
    const {
      amount,
      currency = "INR",
      description = "Ticket",
      reference_id,
      callback_url,
      metadata = {},
      visitor_id = null,
    } = req.body || {};

    if (!amount || !reference_id) {
      return res.status(400).json({ success: false, error: "amount and reference_id are required" });
    }

    const amountStr = formatAmount(amount);
    const redirectUrl = callback_url || `${APP_ORIGIN}/payment-return`;

    // Select webhook: explicit override wins, else build from BACKEND_ORIGIN
    let webhookUrl = INSTAMOJO_WEBHOOK_URL || `${BACKEND_ORIGIN}/api/payment/webhook`;

    // If webhook resolves to localhost and user did not explicitly set INSTAMOJO_WEBHOOK_URL, do not send it
    if (isLocalHost(webhookUrl) && !INSTAMOJO_WEBHOOK_URL) {
      console.warn("[Instamojo] webhook URL resolves to localhost. Will NOT send webhook param to provider.");
      webhookUrl = null;
    }

    const params = new URLSearchParams();
    params.append("purpose", description);
    params.append("amount", amountStr);
    if (metadata?.buyer_name) params.append("buyer_name", metadata.buyer_name);
    params.append("email", metadata?.email || reference_id);
    params.append("redirect_url", redirectUrl);
    if (webhookUrl) params.append("webhook", webhookUrl);
    params.append("send_email", "false");
    params.append("allow_repeated_payments", "false");
    try { params.append("metadata", JSON.stringify(metadata || {})); } catch (e) {}

    const url = `${INSTAMOJO_API_BASE}/api/1.1/payment-requests/`;
    const headers = instamojoHeaders();

    // Mask helper
    const mask = (s) => (s && s.length > 8 ? `${s.slice(0,4)}...${s.slice(-4)}` : "****");
    console.log("[Instamojo] POST", url);
    console.log("[Instamojo] header keys:", Object.keys(headers));
    console.log("[Instamojo] apiKey:", mask(INSTAMOJO_API_KEY), "authToken:", mask(INSTAMOJO_AUTH_TOKEN));
    console.log("[Instamojo] webhook being sent:", !!webhookUrl, webhookUrl || "(none)");

    let instRes;
    try {
      instRes = await axios.post(url, params.toString(), { headers, timeout: 20000, validateStatus: () => true });
    } catch (err) {
      console.error("[Instamojo] HTTP error:", err.message || err);
      return res.status(502).json({ success: false, error: "Failed to contact Instamojo", details: err.message });
    }

    const statusCode = instRes.status;
    const data = instRes.data || {};

    if (statusCode < 200 || statusCode >= 300) {
      console.error("[Instamojo] create payment-request failed:", statusCode, util.inspect(data, { depth: 2 }));
      return res.status(502).json({
        success: false,
        error: "Instamojo create failed",
        provider_error: { status: statusCode, data },
        hint: webhookUrl ? undefined : "Webhook was omitted because BACKEND_ORIGIN resolves to localhost. For local webhook testing set INSTAMOJO_WEBHOOK_URL to your ngrok HTTPS webhook (e.g. https://abcd.ngrok-free.dev/api/payment/webhook)."
      });
    }

    const pr = data.payment_request || data;
    const checkoutUrl = pr.longurl || (pr.payment_request && pr.payment_request.longurl) || null;
    const providerRequestId = pr.id || (pr.payment_request && pr.payment_request.id) || null;

    // Persist payment row (best-effort; adapt to your DB wrapper)
    try {
      const conn = await pool.getConnection();
      try {
        await conn.query(
          `INSERT INTO payments (visitor_id, reference_id, provider, provider_order_id, amount, currency, status, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            visitor_id || null,
            reference_id || null,
            "instamojo",
            providerRequestId || null,
            Number(amount),
            currency,
            "created",
            JSON.stringify(metadata || {}),
          ]
        );
      } finally {
        conn.release();
      }
    } catch (dbErr) {
      console.warn("[DB] Could not save payment record:", dbErr?.message || dbErr);
    }

    return res.json({ success: true, checkoutUrl, providerOrderId: providerRequestId, raw: data });
  } catch (err) {
    console.error("createOrder unexpected error:", err);
    return res.status(500).json({ success: false, error: "Server error creating order", details: err.message });
  }
};

/**
 * GET /api/payment/status?reference_id=...
 */
exports.status = async (req, res) => {
  const { reference_id } = req.query;
  if (!reference_id) return res.status(400).json({ success: false, error: "reference_id required" });
  try {
    const conn = await pool.getConnection();
    try {
      const rows = await conn.query(`SELECT * FROM payments WHERE reference_id = ? ORDER BY id DESC LIMIT 1`, [reference_id]);
      const rec = Array.isArray(rows) ? rows[0] : rows;
      if (!rec) return res.json({ success: true, status: "created" });
      return res.json({ success: true, status: rec.status || "unknown", record: rec });
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error("payment status error", err);
    return res.status(500).json({ success: false, error: "DB error" });
  }
};

/**
 * POST /api/payment/webhook
 * Expects express.raw middleware when mounting route so req.body is Buffer.
 * This handler verifies payment by calling Instamojo API and updates DB.
 */
exports.webhookHandler = async (req, res) => {
  try {
    const rawBuf = req.body;
    const rawString = rawBuf && rawBuf.toString ? rawBuf.toString("utf8") : "";

    let payload = {};
    try {
      payload = JSON.parse(rawString);
    } catch (e) {
      try {
        const p = new URLSearchParams(rawString);
        for (const [k, v] of p.entries()) payload[k] = v;
      } catch (e2) {
        payload = {};
      }
    }

    const payment_id = payload.payment_id || (payload.payment && payload.payment.id) || null;
    const payment_request_id = payload.payment_request_id || (payload.payment_request && payload.payment_request.id) || null;

    // Verify via Instamojo API
    let verified = null;
    try {
      if (payment_id) {
        const url = `${INSTAMOJO_API_BASE}/api/1.1/payments/${encodeURIComponent(payment_id)}/`;
        const check = await axios.get(url, { headers: instamojoHeaders(), timeout: 15000, validateStatus: () => true });
        verified = check.data || null;
      } else if (payment_request_id) {
        const url = `${INSTAMOJO_API_BASE}/api/1.1/payment-requests/${encodeURIComponent(payment_request_id)}/`;
        const check = await axios.get(url, { headers: instamojoHeaders(), timeout: 15000, validateStatus: () => true });
        verified = check.data || null;
      }
    } catch (err) {
      console.warn("Instamojo verification API call failed:", err?.response?.data || err.message || err);
    }

    let paid = false;
    let providerPaymentId = payment_id || null;
    let providerOrderId = payment_request_id || null;
    let amount = null;
    let currency = null;
    if (verified) {
      if (verified.payment && verified.payment.status) {
        const status = String(verified.payment.status || "").toLowerCase();
        paid = ["credit", "successful", "completed", "paid"].includes(status);
        providerPaymentId = verified.payment.id || providerPaymentId;
        providerOrderId = verified.payment.payment_request || providerOrderId;
        amount = verified.payment.amount || amount;
        currency = verified.payment.currency || currency;
      }
      if (!paid && verified.payment_request && verified.payment_request.status) {
        const st = String(verified.payment_request.status || "").toLowerCase();
        paid = st === "completed" || st === "paid";
        providerOrderId = verified.payment_request.id || providerOrderId;
        amount = verified.payment_request.amount || amount;
        currency = verified.payment_request.currency || currency;
      }
    }

    const newStatus = paid ? "paid" : "failed";

    try {
      const conn = await pool.getConnection();
      try {
        await conn.query(
          `UPDATE payments SET provider_payment_id = COALESCE(?, provider_payment_id), status = ?, webhook_payload = ?, amount = COALESCE(?, amount), currency = COALESCE(?, currency), received_at = NOW(), updated_at = NOW()
           WHERE provider_order_id = ? OR provider_payment_id = ? OR reference_id = ?`,
          [
            providerPaymentId || providerOrderId || null,
            newStatus,
            JSON.stringify(payload || {}),
            amount || null,
            currency || null,
            providerOrderId || null,
            providerPaymentId || null,
            payload && payload.reference_id ? payload.reference_id : null,
          ]
        );

        // optionally update visitors table (best effort)
        let visitorIdToUpdate = null;
        if (payload && payload.reference_id && /^\d+$/.test(String(payload.reference_id))) {
          visitorIdToUpdate = Number(payload.reference_id);
        } else if (providerOrderId) {
          const pRows = await conn.query(`SELECT visitor_id FROM payments WHERE provider_order_id = ? LIMIT 1`, [providerOrderId]);
          const pRec = Array.isArray(pRows) ? pRows[0] : pRows;
          if (pRec && pRec.visitor_id) visitorIdToUpdate = pRec.visitor_id;
        } else if (providerPaymentId) {
          const pRows = await conn.query(`SELECT visitor_id FROM payments WHERE provider_payment_id = ? LIMIT 1`, [providerPaymentId]);
          const pRec = Array.isArray(pRows) ? pRows[0] : pRows;
          if (pRec && pRec.visitor_id) visitorIdToUpdate = pRec.visitor_id;
        }

        if (!visitorIdToUpdate && payload && payload.email) {
          const vRows = await conn.query(`SELECT id FROM visitors WHERE email = ? ORDER BY id DESC LIMIT 1`, [payload.email]);
          const vRec = Array.isArray(vRows) ? vRows[0] : vRows;
          if (vRec && vRec.id) visitorIdToUpdate = vRec.id;
        }

        if (visitorIdToUpdate) {
          await conn.query(
            `UPDATE visitors SET txId = ?, payment_provider = ?, payment_status = ?, amount_paid = COALESCE(?, amount_paid), paid_at = CASE WHEN ? = 'paid' THEN NOW() ELSE paid_at END, payment_meta = ? WHERE id = ?`,
            [
              providerPaymentId || providerOrderId || null,
              "instamojo",
              newStatus,
              amount || null,
              newStatus,
              JSON.stringify(payload || {}),
              visitorIdToUpdate,
            ]
          );
        }
      } finally {
        conn.release();
      }
    } catch (dbErr) {
      console.error("[DB] webhook processing error:", dbErr);
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("webhook handler unexpected error:", err);
    return res.status(500).json({ success: false, error: "Webhook handling failed" });
  }
};