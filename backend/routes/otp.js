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
  throw new Error("No SMTP configuration provided.");
}

const transporter = buildTransporter();
transporter.verify((err) => {
  if (err) console.error("SMTP verify failed:", err.message);
  else console.log("SMTP server is ready to take our messages");
});

function isValidEmail(addr = "") {
  return typeof addr === "string" && /\S+@\S+\.\S+/.test(addr);
}

// In-memory OTP store
const otpStore = new Map();

// Settings
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 60s cooldown
const MAX_SENDS_PER_WINDOW = 5;
const SENDS_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_VERIFY_ATTEMPTS = 5;

setInterval(() => {
  const now = Date.now();
  for (const [k, rec] of otpStore.entries()) {
    if (!rec || rec.expires < now) otpStore.delete(k);
  }
}, 10 * 60 * 1000).unref();

/**
 * Map registration type to DB table name.
 * Extend this map if you have other registration tables.
 */
function mapTypeToTable(type = "visitor") {
  const t = String(type || "").trim().toLowerCase();
  const map = {
    visitor: "visitors",
    visitors: "visitors",
    exhibitor: "exhibitors",
    exhibitors: "exhibitors",
    speaker: "speakers",
    speakers: "speakers",
    partner: "partners",
    partners: "partners",
    awardee: "awardees",
    awardees: "awardees",
  };
  return map[t] || `${t}s`;
}

/**
 * Helper: safely run a SELECT id,ticket_code WHERE LOWER(email)=?
 * Handles different pool.query shapes and normalizes output.
 */
async function findExistingByEmail(table, emailLower) {
  try {
    const raw = await pool.query(`SELECT id, ticket_code FROM \`${table}\` WHERE LOWER(email) = ? LIMIT 1`, [emailLower]);
    const rows = Array.isArray(raw) ? raw[0] : raw;
    if (Array.isArray(rows) && rows.length) return rows[0];
    if (rows && typeof rows === "object" && "id" in rows) return rows;
    return null;
  } catch (err) {
    console.error(`DB lookup error for table=${table} email=${emailLower}:`, err && err.stack ? err.stack : err);
    throw err;
  }
}

/**
 * POST /api/otp/send
 * body: { type: "email", value, requestId?, registrationType }
 *
 * IMPORTANT: check the DB for an existing record IN THE SAME TABLE (registrationType)
 * BEFORE sending the OTP. If the record exists, return 409 and DO NOT send OTP.
 */
router.post("/send", async (req, res) => {
  try {
    const { type = "email", value, requestId = "", registrationType } = req.body || {};

    if (type !== "email" || !isValidEmail(value)) {
      return res.status(400).json({ success: false, error: "Provide type='email' and a valid email address", code: "invalid_email" });
    }

    if (!registrationType || typeof registrationType !== "string") {
      // require the frontend to pass the registrationType so we only check the intended table
      return res.status(400).json({ success: false, error: "registrationType is required (e.g. 'visitor','exhibitor')", code: "missing_registration_type" });
    }

    const key = String(value).trim().toLowerCase();

    // === PRE-CHECK: only check the same table (registrationType) ===
    const regType = String(registrationType).trim().toLowerCase();
    const table = mapTypeToTable(regType);

    try {
      const existing = await findExistingByEmail(table, key);
      if (existing) {
        // Don't send OTP — inform client that email already exists for this registration type
        return res.status(409).json({
          success: false,
          error: "Email already exists",
          existing: { id: existing.id, ticket_code: existing.ticket_code || null },
          registrationType: regType,
        });
      }
    } catch (dbErr) {
      // If DB check fails unexpectedly, log and return an error (safer than proceeding)
      console.error("DB pre-check error before sending OTP:", dbErr && dbErr.stack ? dbErr.stack : dbErr);
      return res.status(500).json({ success: false, error: "Server error checking email" });
    }
    // === END PRE-CHECK ===

    const now = Date.now();
    const existingRec = otpStore.get(key) || {};

    // Idempotency: if same requestId seen within 2 minutes, return success without sending another email
    if (
      requestId &&
      existingRec.lastRequestId === requestId &&
      existingRec.lastSentAt &&
      now - existingRec.lastSentAt < 2 * 60 * 1000
    ) {
      return res.json({
        success: true,
        email: key,
        expiresInSec: Math.max(0, Math.floor((existingRec.expires - now) / 1000) || 0),
        resendCooldownSec: Math.max(0, Math.ceil((existingRec.cooldownUntil - now) / 1000) || 0),
        idempotent: true,
      });
    }

    // Cooldown
    if (existingRec.cooldownUntil && now < existingRec.cooldownUntil) {
      return res.status(429).json({
        success: false,
        error: "Please wait before requesting another OTP.",
        retryAfterSec: Math.ceil((existingRec.cooldownUntil - now) / 1000),
      });
    }

    // Windowed rate limit
    let windowStart = existingRec.windowStart || now;
    let sendCount = existingRec.sendCount || 0;
    if (now - windowStart > SENDS_WINDOW_MS) {
      windowStart = now;
      sendCount = 0;
    }
    if (sendCount >= MAX_SENDS_PER_WINDOW) {
      return res.status(429).json({ success: false, error: "Too many OTP requests. Please try again later." });
    }

    // Generate OTP and store
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

    const from = process.env.MAIL_FROM || process.env.SMTP_USER;
    await transporter.sendMail({
      from,
      to: value,
      subject: "Your RailTrans Expo OTP",
      text: `Your OTP is ${otp}. It expires in 5 minutes.`,
      html: `<p>Your OTP is <b>${otp}</b>. It expires in 5 minutes.</p>`,
    });

    return res.json({
      success: true,
      email: key,
      expiresInSec: Math.floor(OTP_TTL_MS / 1000),
      resendCooldownSec: Math.ceil(RESEND_COOLDOWN_MS / 1000),
    });
  } catch (err) {
    console.error("OTP send error:", err && err.stack ? err.stack : err);
    return res.status(500).json({ success: false, error: err && err.message ? err.message : String(err) });
  }
});

/**
 * POST /api/otp/verify
 * body: { value, otp, registrationType }
 *
 * This endpoint verifies the OTP and returns existing record info ONLY for the same
 * registrationType table (required).
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

    const key = String(value).trim().toLowerCase();
    const rec = otpStore.get(key);
    if (!rec) {
      return res.json({ success: false, error: "OTP not found or expired" });
    }
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

    // success: consume OTP
    otpStore.delete(key);

    // Only check the provided registrationType table
    const typeToCheck = String(registrationType).trim().toLowerCase();
    const table = mapTypeToTable(typeToCheck);
    try {
      const existing = await findExistingByEmail(table, key);
      if (existing) {
        return res.json({
          success: true,
          email: key,
          registrationType: typeToCheck,
          existing: { id: existing.id, ticket_code: existing.ticket_code },
        });
      }
      return res.json({ success: true, email: key, registrationType: typeToCheck });
    } catch (err) {
      console.error("OTP verify DB check error:", err && err.stack ? err.stack : err);
      return res.status(500).json({ success: false, error: "Server error during verification" });
    }
  } catch (err) {
    console.error("OTP verify error:", err && err.stack ? err.stack : err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

module.exports = router;