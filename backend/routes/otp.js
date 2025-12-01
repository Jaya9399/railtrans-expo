const express = require("express");
const nodemailer = require("nodemailer");

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

// In-memory store
// key: normalized email -> record
const otpStore = new Map();

// Settings
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 60s cooldown
const MAX_SENDS_PER_WINDOW = 5;
const SENDS_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_VERIFY_ATTEMPTS = 5;

// Cleanup expired periodically
setInterval(() => {
  const now = Date.now();
  for (const [k, rec] of otpStore.entries()) {
    if (!rec || rec.expires < now) otpStore.delete(k);
  }
}, 10 * 60 * 1000).unref();

router.post("/send", async (req, res) => {
  console.log("Received OTP send request");
  try {
    const { type = "email", value, requestId = "" } = req.body || {};
    if (type !== "email" || !isValidEmail(value)) {
      return res
        .status(400)
        .json({ success: false, error: "Provide type='email' and a valid email address" });
    }
    const key = String(value).trim().toLowerCase();
    const now = Date.now();
    const existing = otpStore.get(key) || {};

    // Idempotency: if same requestId seen within 2 minutes, return success without sending another email
    if (
      requestId &&
      existing.lastRequestId === requestId &&
      existing.lastSentAt &&
      now - existing.lastSentAt < 2 * 60 * 1000
    ) {
      return res.json({
        success: true,
        email: key,
        expiresInSec: Math.max(0, Math.floor((existing.expires - now) / 1000) || 0),
        resendCooldownSec: Math.max(0, Math.ceil((existing.cooldownUntil - now) / 1000) || 0),
        idempotent: true,
      });
    }

    // Cooldown
    if (existing.cooldownUntil && now < existing.cooldownUntil) {
      return res.status(429).json({
        success: false,
        error: "Please wait before requesting another OTP.",
        retryAfterSec: Math.ceil((existing.cooldownUntil - now) / 1000),
      });
    }

    // Windowed rate limit
    let windowStart = existing.windowStart || now;
    let sendCount = existing.sendCount || 0;
    if (now - windowStart > SENDS_WINDOW_MS) {
      windowStart = now;
      sendCount = 0;
    }
    if (sendCount >= MAX_SENDS_PER_WINDOW) {
      return res
        .status(429)
        .json({ success: false, error: "Too many OTP requests. Please try again later." });
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
      lastRequestId: requestId || `${now}`, // remember last id
    };
    otpStore.set(key, rec);

    const from = process.env.MAIL_FROM || process.env.SMTP_USER;
    await transporter.sendMail({
      from,
      to: value, // send to original value
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
    console.error("OTP send error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/verify", (req, res) => {
  const { value, otp } = req.body || {};
  if (!isValidEmail(value)) {
    return res.status(400).json({ success: false, error: "Provide a valid email" });
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
    return res
      .status(429)
      .json({ success: false, error: "Too many incorrect attempts. Please request a new OTP." });
  }
  const input = String(otp || "").trim();
  if (input.length !== 6 || rec.otp !== input) {
    rec.attempts = (rec.attempts || 0) + 1;
    otpStore.set(key, rec);
    return res.json({ success: false, error: "Incorrect OTP" });
  }
  otpStore.delete(key);
  return res.json({ success: true, email: key });
});

module.exports = router;