const express = require("express");
const nodemailer = require("nodemailer");
const pool = require("../db");

const router = express.Router();

function buildTransporter() {
  if (process.env.SMTP_HOST) {
    const port = Number(process.env.SMTP_PORT || 587);
    const secure =
      typeof process.env.SMTP_SECURE === "string"
        ? process.env.SMTP_SECURE.toLowerCase() === "true"
        : port === 465;

    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      pool: true,
    });
  }
  if (process.env.SMTP_SERVICE) {
    return nodemailer.createTransport({
      service: process.env.SMTP_SERVICE,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      pool: true,
    });
  }
  // Dev fallback so OTP flow can be tested without SMTP configured
  return nodemailer.createTransport({ jsonTransport: true });
}

const transporter = buildTransporter();
transporter.verify((err) => {
  if (err) console.error("SMTP verify failed:", err.message);
  else console.log("SMTP server is ready to take messages");
});

function isValidEmail(addr = "") {
  return typeof addr === "string" && /\S+@\S+\.\S+/.test(addr);
}

const otpStore = new Map();

const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_SENDS_PER_WINDOW = 5;
const SENDS_WINDOW_MS = 60 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

setInterval(() => {
  const now = Date.now();
  for (const [k, rec] of otpStore.entries()) {
    if (!rec || rec.expires < now) otpStore.delete(k);
  }
}, 10 * 60 * 1000).unref();

function mapTypeToTable(type = "") {
  const t = String(type || "").trim().toLowerCase();
  const map = {
    visitor: "visitors",
    exhibitor: "exhibitors",
    speaker: "speakers",
    partner: "partners",
    awardee: "awardees",
  };
  return map[t] || null;
}

/**
 * Defensive DB lookup:
 * - Returns a record {id, ticket_code} when found
 * - Returns null when not found
 * - On DB errors, logs the error and returns null (we intentionally "fail open")
 */
async function findExistingByEmail(table, emailLower) {
  if (!table) return null;
  try {
    const raw = await pool.query(`SELECT id, ticket_code FROM \`${table}\` WHERE LOWER(email) = ? LIMIT 1`, [emailLower]);
    const rows = Array.isArray(raw) ? raw[0] : raw;
    if (Array.isArray(rows) && rows.length) return rows[0];
    if (rows && typeof rows === "object" && "id" in rows) return rows;
    return null;
  } catch (err) {
    console.error(`[otp] DB lookup failed for table="${table}", email="${emailLower}":`, err && (err.stack || err.message || err));
    // Return null so OTP sending continues when DB is temporarily unavailable
    return null;
  }
}

/**
 * POST /api/otp/send
 * Body: { type: "email", value: "<email>", requestId?: "...", registrationType: "visitor" }
 *
 * Behavior:
 * - registrationType is required and determines which DB table to check.
 * - If a matching record exists in that table, respond 409 with existing info and DO NOT send OTP.
 * - If no matching record is found (or DB check fails), proceed to send OTP (no other errors shown).
 */
router.post("/send", async (req, res) => {
  try {
    const { type = "email", value, requestId = "", registrationType } = req.body || {};

    if (type !== "email" || !isValidEmail(value)) {
      return res.status(400).json({ success: false, error: "Provide type='email' and a valid email address", code: "invalid_email" });
    }

    if (!registrationType || typeof registrationType !== "string") {
      return res.status(400).json({ success: false, error: "registrationType is required (e.g. 'visitor','exhibitor')", code: "missing_registration_type" });
    }

    const emailNorm = String(value).trim().toLowerCase();
    const regType = String(registrationType).trim().toLowerCase();
    const table = mapTypeToTable(regType);

    if (!table) {
      return res.status(400).json({ success: false, error: "Unknown registrationType", registrationType: regType, code: "unknown_registration_type" });
    }

    console.debug(`[otp/send] pre-check table=${table} email=${emailNorm}`);

    // DB pre-check: only this table.
    // If findExistingByEmail returns an object -> existing -> return 409 and do not send OTP.
    // If it returns null (no row OR DB error), proceed and send OTP.
    let existing = null;
    try {
      existing = await findExistingByEmail(table, emailNorm);
    } catch (err) {
      // findExistingByEmail already logs; ensure we don't block OTP sending on error.
      existing = null;
    }

    if (existing) {
      console.debug(`[otp/send] email exists in ${table}: id=${existing.id} ticket_code=${existing.ticket_code}`);
      return res.status(409).json({
        success: false,
        error: "Email already exists",
        existing: { id: existing.id, ticket_code: existing.ticket_code || null },
        registrationType: regType,
      });
    }

    // No existing record found -> send OTP normally (no other errors shown)
    const key = emailNorm;
    const now = Date.now();
    const existingRec = otpStore.get(key) || {};

    if (requestId && existingRec.lastRequestId === requestId && existingRec.lastSentAt && now - existingRec.lastSentAt < 2 * 60 * 1000) {
      return res.json({
        success: true,
        email: key,
        expiresInSec: Math.max(0, Math.floor((existingRec.expires - now) / 1000) || 0),
        resendCooldownSec: Math.max(0, Math.ceil((existingRec.cooldownUntil - now) / 1000) || 0),
        idempotent: true,
      });
    }

    if (existingRec.cooldownUntil && now < existingRec.cooldownUntil) {
      return res.status(429).json({
        success: false,
        error: "Please wait before requesting another OTP.",
        retryAfterSec: Math.ceil((existingRec.cooldownUntil - now) / 1000),
      });
    }

    let windowStart = existingRec.windowStart || now;
    let sendCount = existingRec.sendCount || 0;
    if (now - windowStart > SENDS_WINDOW_MS) {
      windowStart = now;
      sendCount = 0;
    }
    if (sendCount >= MAX_SENDS_PER_WINDOW) {
      return res.status(429).json({ success: false, error: "Too many OTP requests. Please try again later." });
    }

    // Generate & store OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const rec = {
      otp,
      expires: now + OTP_TTL_MS,
      attempts: 0,
      lastSentAt: now,
      cooldownUntil: now + RESEND_COOLDOWN_MS,
      windowStart,
      sendCount: sendCount + 1,
      lastRequestId: requestId || `${now}`,
    };
    otpStore.set(key, rec);

    const from = process.env.MAIL_FROM || process.env.SMTP_USER || "no-reply@example.com";
    try {
      await transporter.sendMail({
        from,
        to: value,
        subject: "Your RailTrans Expo OTP",
        text: `Your OTP is ${otp}. It expires in 5 minutes.`,
        html: `<p>Your OTP is <b>${otp}</b>. It expires in 5 minutes.</p>`,
      });
    } catch (mailErr) {
      console.error("[otp/send] mail send failed:", mailErr && (mailErr.stack || mailErr.message || mailErr));
      otpStore.delete(key);
      return res.status(500).json({ success: false, error: "Failed to send OTP email" });
    }

    console.debug(`[otp/send] OTP sent to ${emailNorm} for registrationType=${regType}`);
    return res.json({
      success: true,
      email: key,
      registrationType: regType,
      expiresInSec: Math.floor(OTP_TTL_MS / 1000),
      resendCooldownSec: Math.ceil(RESEND_COOLDOWN_MS / 1000),
    });
  } catch (err) {
    console.error("[otp/send] unexpected error:", err && (err.stack || err.message || err));
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

/**
 * POST /api/otp/verify
 * Body: { value, otp, registrationType }
 */
router.post("/verify", async (req, res) => {
  try {
    const { value, otp, registrationType } = req.body || {};

    if (!isValidEmail(value)) {
      return res.status(400).json({ success: false, error: "Provide a valid email" });
    }
    if (!registrationType || typeof registrationType !== "string") {
      return res.status(400).json({ success: false, error: "registrationType is required for verification" });
    }

    const emailNorm = String(value).trim().toLowerCase();
    const key = emailNorm;
    const rec = otpStore.get(key);
    if (!rec) return res.json({ success: false, error: "OTP not found or expired" });

    const now = Date.now();
    if (rec.expires < now) {
      otpStore.delete(key);
      return res.json({ success: false, error: "OTP expired" });
    }
    if ((rec.attempts || 0) >= MAX_VERIFY_ATTEMPTS) {
      otpStore.delete(key);
      return res.status(429).json({ success: false, error: "Too many incorrect attempts. Please request a new OTP." });
    }

    const input = String(otp || "").trim();
    if (input.length !== 6 || rec.otp !== input) {
      rec.attempts = (rec.attempts || 0) + 1;
      otpStore.set(key, rec);
      return res.json({ success: false, error: "Incorrect OTP" });
    }

    // consume
    otpStore.delete(key);

    const regType = String(registrationType).trim().toLowerCase();
    const table = mapTypeToTable(regType);
    if (!table) return res.status(400).json({ success: false, error: "Unknown registrationType" });

    try {
      const existing = await findExistingByEmail(table, emailNorm);
      if (existing) {
        return res.json({
          success: true,
          email: emailNorm,
          registrationType: regType,
          existing: { id: existing.id, ticket_code: existing.ticket_code || null },
        });
      }
      return res.json({ success: true, email: emailNorm, registrationType: regType });
    } catch (dbErr) {
      console.error("[otp/verify] DB error:", dbErr && (dbErr.stack || dbErr.message || dbErr));
      return res.status(500).json({ success: false, error: "Server error during verification" });
    }
  } catch (err) {
    console.error("[otp/verify] unexpected error:", err && (err.stack || err.message || err));
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

module.exports = router;