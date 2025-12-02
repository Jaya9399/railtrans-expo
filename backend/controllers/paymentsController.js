/**
 * backend/controllers/paymentsController.js
 *
 * Instamojo integration (uses public webhook URL from INSTAMOJO_WEBHOOK_URL or BACKEND_ORIGIN).
 *
 * Improvements made:
 * - Defensive DB helper that works with pool.getConnection() or pool.query()
 * - Accepts zero-amount orders (will not call Instamojo in that case; returns local checkoutUrl=null)
 * - Better logging and clearer responses / hints when webhook URL omitted because backend is local
 * - Safer JSON handling for metadata and webhook payload persistence
 * - Attempts to map payment -> visitor row for confirm/update
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
const util = require("util");
const pool = require("../db"); // adapt to your DB helper
const fs = require("fs");
const path = require("path");

const INSTAMOJO_API_KEY = (process.env.INSTAMOJO_API_KEY || "").trim();
const INSTAMOJO_AUTH_TOKEN = (process.env.INSTAMOJO_AUTH_TOKEN || "").trim();
const INSTAMOJO_API_BASE = (process.env.INSTAMOJO_API_BASE || "https://www.instamojo.com").replace(/\/$/, "");
const INSTAMOJO_WEBHOOK_URL = (process.env.INSTAMOJO_WEBHOOK_URL || "").trim();
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
 * DB helper: try pool.query, otherwise try pool.getConnection -> conn.query
 * Returns [rows, fields] or rows depending on driver. Normalizes to rows array or first result.
 */
async function dbQuery(sql, params = []) {
  // If pool has query method that returns promise
  if (!pool) throw new Error("DB pool not available");
  if (typeof pool.query === "function") {
    // some pool implementations (mysql2/promise) return [rows, fields]
    const out = await pool.query(sql, params);
    return Array.isArray(out) && Array.isArray(out[0]) ? out[0] : out;
  }
  // fallback to getConnection
  if (typeof pool.getConnection === "function") {
    const conn = await pool.getConnection();
    try {
      if (typeof conn.query === "function") {
        const out = await conn.query(sql, params);
        return Array.isArray(out) && Array.isArray(out[0]) ? out[0] : out;
      }
      throw new Error("DB connection has no query()");
    } finally {
      try { conn.release(); } catch (e) {}
    }
  }
  throw new Error("Unsupported DB pool interface");
}

/**
 * createOrder
 * - Creates an Instamojo payment request when amount > 0 and provider credentials exist.
 * - Persists a payments row in the DB (best-effort).
 * - For local dev when backend is not publicly reachable, webhook is omitted and a hint is returned.
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

    if (reference_id == null) {
      return res.status(400).json({ success: false, error: "reference_id is required" });
    }

    const amountNum = Number(amount || 0);
    const amountStr = formatAmount(amountNum);
    const redirectUrl = callback_url || `${APP_ORIGIN}/payment-return`;

    // Determine webhook URL: explicit override wins, else build from BACKEND_ORIGIN
    let webhookUrl = INSTAMOJO_WEBHOOK_URL || `${BACKEND_ORIGIN}/api/payment/webhook`;

    // If webhook resolves to localhost and user did not explicitly set INSTAMOJO_WEBHOOK_URL, do not send it
    const webhookSent = !(isLocalHost(webhookUrl) && !INSTAMOJO_WEBHOOK_URL);

    if (isLocalHost(webhookUrl) && !INSTAMOJO_WEBHOOK_URL) {
      console.warn("[Instamojo] webhook URL resolves to localhost. Will NOT send webhook param to provider.");
      webhookUrl = null;
    }

    // If amount <= 0, we won't call Instamojo; create a local 'created' payment and return a local response
    if (amountNum <= 0 || !INSTAMOJO_API_KEY || !INSTAMOJO_AUTH_TOKEN) {
      // persist payment row locally
      try {
        await dbQuery(
          `INSERT INTO payments (visitor_id, reference_id, provider, provider_order_id, amount, currency, status, metadata, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [visitor_id || null, reference_id || null, "local", null, amountNum, currency, "created", JSON.stringify(metadata || {})]
        );
      } catch (dbErr) {
        console.warn("[DB] Could not save local payment record (zero-amount):", dbErr && dbErr.message);
      }

      return res.json({
        success: true,
        checkoutUrl: null,
        providerOrderId: null,
        hint: amountNum <= 0 ? "zero-amount order - no external checkout needed" : "no provider credentials",
      });
    }

    // Build Instamojo params
    const params = new URLSearchParams();
    params.append("purpose", description || "Ticket");
    params.append("amount", amountStr);
    // Instamojo expects buyer_name, email etc.
    if (metadata && metadata.buyer_name) params.append("buyer_name", metadata.buyer_name);
    params.append("email", metadata?.email || String(reference_id));
    params.append("redirect_url", redirectUrl);
    if (webhookUrl) params.append("webhook", webhookUrl);
    params.append("send_email", "false");
    params.append("allow_repeated_payments", "false");
    try { params.append("metadata", JSON.stringify(metadata || {})); } catch (e) {}

    const url = `${INSTAMOJO_API_BASE}/api/1.1/payment-requests/`;
    const headers = instamojoHeaders();

    // Logging masked sensitive values
    const mask = (s) => (s && s.length > 8 ? `${s.slice(0,4)}...${s.slice(-4)}` : "****");
    console.log("[Instamojo] createOrder POST", url);
    console.log("[Instamojo] webhook will be sent:", !!webhookUrl, webhookUrl || "(none)");
    console.log("[Instamojo] amount:", amountStr, "reference_id:", reference_id);

    let instRes;
    try {
      instRes = await axios.post(url, params.toString(), { headers, timeout: 20000, validateStatus: () => true });
    } catch (err) {
      console.error("[Instamojo] HTTP request failed:", err && (err.message || err));
      return res.status(502).json({ success: false, error: "Failed to contact Instamojo", details: err.message || String(err) });
    }

    const statusCode = instRes.status;
    const data = instRes.data || {};

    if (statusCode < 200 || statusCode >= 300) {
      console.error("[Instamojo] create payment-request failed:", statusCode, util.inspect(data, { depth: 2 }));
      return res.status(502).json({
        success: false,
        error: "Instamojo create failed",
        provider_error: { status: statusCode, data },
        hint: webhookSent ? undefined : "Webhook was omitted because BACKEND_ORIGIN resolves to localhost. For local webhook testing set INSTAMOJO_WEBHOOK_URL to your public HTTPS webhook (e.g. ngrok URL)."
      });
    }

    // Extract checkout URL and provider request id
    const pr = data && (data.payment_request || data) || {};
    const checkoutUrl = pr.longurl || (pr.payment_request && pr.payment_request.longurl) || null;
    const providerRequestId = pr.id || (pr.payment_request && pr.payment_request.id) || null;

    // Persist payment row (best-effort)
    try {
      await dbQuery(
        `INSERT INTO payments (visitor_id, reference_id, provider, provider_order_id, amount, currency, status, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          visitor_id || null,
          reference_id || null,
          "instamojo",
          providerRequestId || null,
          amountNum,
          currency,
          "created",
          JSON.stringify(metadata || {}),
        ]
      );
    } catch (dbErr) {
      console.warn("[DB] Could not save payment record:", dbErr && dbErr.message);
    }

    return res.json({ success: true, checkoutUrl, providerOrderId: providerRequestId, raw: data });
  } catch (err) {
    console.error("createOrder unexpected error:", err && (err.stack || err));
    return res.status(500).json({ success: false, error: "Server error creating order", details: err && err.message });
  }
};

/**
 * GET /api/payment/status?reference_id=...
 */
exports.status = async (req, res) => {
  try {
    const { reference_id } = req.query;
    if (!reference_id) return res.status(400).json({ success: false, error: "reference_id required" });

    try {
      const rows = await dbQuery(`SELECT * FROM payments WHERE reference_id = ? ORDER BY id DESC LIMIT 1`, [reference_id]);
      const rec = Array.isArray(rows) ? rows[0] : rows;
      if (!rec) return res.json({ success: true, status: "created" });
      return res.json({ success: true, status: rec.status || "unknown", record: rec });
    } catch (dbErr) {
      console.error("payment status DB error:", dbErr && dbErr.message);
      return res.status(500).json({ success: false, error: "DB error" });
    }
  } catch (err) {
    console.error("payment status unexpected error:", err && err.stack ? err.stack : err);
    return res.status(500).json({ success: false, error: "Server error" });
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

    // Attempt to parse JSON first, fallback to x-www-form-urlencoded
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

    // Verify via Instamojo API (best-effort)
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
      console.warn("Instamojo verification API call failed:", err && (err.response && err.response.data) ? err.response.data : err && err.message);
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

    // Update payments table: match by provider_order_id OR provider_payment_id OR reference_id
    try {
      await dbQuery(
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
    } catch (dbErr) {
      console.error("[DB] webhook update error:", dbErr && dbErr.message);
    }

    // Try to find visitor_id from payments row if available, then update visitors table
    try {
      let visitorIdToUpdate = null;
      if (payload && payload.reference_id && /^\d+$/.test(String(payload.reference_id))) {
        visitorIdToUpdate = Number(payload.reference_id);
      } else if (providerOrderId) {
        const pRows = await dbQuery(`SELECT visitor_id FROM payments WHERE provider_order_id = ? ORDER BY id DESC LIMIT 1`, [providerOrderId]);
        const pRec = Array.isArray(pRows) ? pRows[0] : pRows;
        if (pRec && pRec.visitor_id) visitorIdToUpdate = pRec.visitor_id;
      } else if (providerPaymentId) {
        const pRows = await dbQuery(`SELECT visitor_id FROM payments WHERE provider_payment_id = ? ORDER BY id DESC LIMIT 1`, [providerPaymentId]);
        const pRec = Array.isArray(pRows) ? pRows[0] : pRows;
        if (pRec && pRec.visitor_id) visitorIdToUpdate = pRec.visitor_id;
      }

      if (!visitorIdToUpdate && payload && payload.email) {
        const vRows = await dbQuery(`SELECT id FROM visitors WHERE email = ? ORDER BY id DESC LIMIT 1`, [payload.email]);
        const vRec = Array.isArray(vRows) ? vRows[0] : vRows;
        if (vRec && vRec.id) visitorIdToUpdate = vRec.id;
      }

      if (visitorIdToUpdate) {
        await dbQuery(
          `UPDATE visitors SET txId = COALESCE(?, txId), payment_provider = ?, payment_status = ?, amount_paid = COALESCE(?, amount_paid), paid_at = CASE WHEN ? = 'paid' THEN NOW() ELSE paid_at END, payment_meta = ? WHERE id = ?`,
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
    } catch (vErr) {
      console.warn("[DB] visitor update after webhook failed:", vErr && vErr.message);
    }

    // Attempt to finalize entity confirm or upgrade workflows (best-effort)
    // Inspect metadata if available in payload or via provider verification
    try {
      const metaStr = (verified && (verified.payment && verified.payment.metadata)) || (verified && verified.payment_request && verified.payment_request.metadata) || payload.metadata || {};
      let metadata = {};
      if (typeof metaStr === "string") {
        try { metadata = JSON.parse(metaStr); } catch (e) { metadata = {}; }
      } else metadata = metaStr || {};

      if (paid) {
        // If metadata indicates upgrade -> call tickets-upgrade endpoint on backend
        const metaNewCategory = metadata.new_category || metadata.upgrade_to || metadata.newCategory;
        const metaEntityType = metadata.entity_type || metadata.entity || metadata.entityType;
        const metaEntityId = metadata.reference_id || metadata.referenceId || payload.reference_id || null;

        if (metaNewCategory && metaEntityType && metaEntityId) {
          // call internal endpoint to finalize upgrade (non-blocking)
          (async () => {
            try {
              const upgradeUrl = `${BACKEND_ORIGIN}/api/tickets/upgrade`;
              await axios.post(upgradeUrl, {
                entity_type: metaEntityType,
                entity_id: metaEntityId,
                new_category: metaNewCategory,
                amount: 0,
                provider_tx: providerPaymentId || providerOrderId || null,
              }, { timeout: 10000 }).catch(()=>{});
            } catch (e) {
              console.warn("webhook -> tickets-upgrade call failed", e && e.message);
            }
          })();
        } else {
          // Generic confirm: try to mark entity confirmed (awardees/speakers etc) using reference_id
          const ref = payload.reference_id || (verified && verified.payment && verified.payment.metadata && verified.payment.metadata.reference_id) || null;
          if (ref) {
            (async () => {
              try {
                // attempt confirm for some known entity routes; this is best-effort / idempotent
                const possibleEntities = ["awardees","speakers","visitors","exhibitors","partners"];
                for (const ent of possibleEntities) {
                  try {
                    await axios.post(`${BACKEND_ORIGIN}/api/${ent}/${encodeURIComponent(String(ref))}/confirm`, { txId: providerPaymentId || providerOrderId || null }, { timeout: 8000 }).catch(()=>{});
                  } catch (e) { /* ignore */ }
                }
              } catch (e) {
                /* ignore */
              }
            })();
          }
        }
      }
    } catch (e) {
      console.warn("post-webhook finalize error:", e && e.message);
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("webhook handler unexpected error:", err && (err.stack || err));
    try { return res.status(500).json({ success: false, error: "Webhook handling failed" }); } catch (e) { return; }
  }
};