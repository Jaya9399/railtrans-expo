const express = require("express");
const nodemailer = require("nodemailer");
const mongoClient = require("../utils/mongoClient"); // uses getDb() or .db

const router = express.Router();

/* ---------- simple mongo helper ---------- */
async function obtainDb() {
  if (!mongoClient) throw new Error("mongoClient not available");
  if (typeof mongoClient.getDb === "function") return await mongoClient.getDb();
  if (mongoClient.db) return mongoClient.db;
  throw new Error("mongoClient has no getDb/db");
}

/* ---------- mailer setup (dev-friendly) ---------- */
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
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      pool: true,
    });
  }
  if (process.env.SMTP_SERVICE) {
    return nodemailer.createTransport({
      service: process.env.SMTP_SERVICE,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      pool: true,
    });
  }
  // Dev fallback: jsonTransport (no real email delivered)
  return nodemailer.createTransport({ jsonTransport: true });
}
const transporter = buildTransporter();
if (transporter && transporter.verify) {
  transporter.verify((err) => {
    if (err) console.warn("[mailer] verify failed:", err && err.message ? err.message : err);
    else console.log("[mailer] transporter ready");
  });
}

/* ---------- utils ---------- */
function isValidEmail(addr = "") {
  return typeof addr === "string" && /\S+@\S+\.\S+/.test(addr);
}
function normalizeEmail(e = "") {
  return String(e || "").trim().toLowerCase();
}
function escapeRegex(s = "") {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ---------- OTP store & config ---------- */
const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
const otpStore = new Map(); // key = `${role}::${email}`

setInterval(() => {
  const now = Date.now();
  for (const [k, r] of otpStore.entries()) if (!r || r.expires < now) otpStore.delete(k);
}, 10 * 60 * 1000).unref();

function genOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/* ---------- role normalization ----------
   Registrations are stored in single 'registrants' collection with role: 'visitor' (singular).
   Normalize incoming registrationType to canonical singular role.
*/
function normalizeToRole(t = "") {
  if (!t) return null;
  const s = String(t).trim().toLowerCase();
  const singular = s.endsWith("s") ? s.slice(0, -1) : s;
  const map = {
    visitor: "visitor",
    exhibitor: "exhibitor",
    speaker: "speaker",
    partner: "partner",
    awardee: "awardee",
  };
  return map[singular] || null;
}

/* ---------- Mongo lookup (works with structure you provided) ----------
   Checks:
    - role matches canonical role (visitor/exhibitor/...)
    - email in candidate paths: top-level email OR data.email OR form.email (anchored, case-insensitive)
   Returns detailed info or null.
*/
async function findExistingByEmailMongo(emailRaw, registrationType) {
  try {
    const db = await obtainDb();
    if (!db) return null;
    const coll = db.collection("registrants");
    const emailNorm = normalizeEmail(emailRaw);
    if (!emailNorm) return null;
    const role = normalizeToRole(registrationType);
    if (!role) return null;

    const regex = new RegExp(`^\\s*${escapeRegex(emailNorm)}\\s*$`, "i");
    const query = {
      role,
      $or: [
        { email: { $regex: regex } },
        { "data.email": { $regex: regex } },
        { "form.email": { $regex: regex } },
        { "data.emailAddress": { $regex: regex } },
        { "data.contactEmail": { $regex: regex } },
      ],
    };

    const projection = { _id: 1, ticket_code: 1, name: 1, company: 1, mobile: 1, email: 1, data: 1, form: 1, role: 1 };
    const doc = await coll.findOne(query, { projection });
    if (!doc) return null;

    // prefer the path that contains the normalized email
    const candidatePaths = ["data.email", "email", "form.email", "data.emailAddress", "data.contactEmail"];
    let matchedPath = null;
    let emailValue = null;
    for (const p of candidatePaths) {
      const parts = p.split(".");
      let v = doc;
      for (const part of parts) {
        if (v && typeof v === "object" && Object.prototype.hasOwnProperty.call(v, part)) v = v[part];
        else { v = undefined; break; }
      }
      if (typeof v === "string" && v.trim() && normalizeEmail(v) === emailNorm) {
        matchedPath = p;
        emailValue = v.trim();
        break;
      }
    }
    if (!matchedPath) {
      // fallback to top-level email or first found
      if (doc.email) { matchedPath = "email"; emailValue = String(doc.email).trim(); }
      else if (doc.data && doc.data.email) { matchedPath = "data.email"; emailValue = String(doc.data.email).trim(); }
      else emailValue = emailNorm;
    }

    return {
      id: doc._id ? String(doc._id) : null,
      ticket_code: doc.ticket_code || null,
      emailColumn: matchedPath || null,
      emailValue: emailValue || null,
      name: doc.name || doc.data?.name || null,
      mobile: doc.mobile || doc.data?.mobile || null,
    };
  } catch (err) {
    console.error("[otp] findExistingByEmailMongo error:", err && (err.stack || err.message || err));
    return null;
  }
}

/* ---------- check-email debug endpoint ----------
   GET /api/otp/check-email?email=...&type=visitor
   returns { success:true, found: true/false, info? }
*/
router.get("/check-email", async (req, res) => {
  try {
    const email = normalizeEmail(req.query.email || "");
    const registrationType = String(req.query.type || "").trim();
    if (!isValidEmail(email)) return res.status(400).json({ success: false, error: "invalid email" });
    if (!registrationType) return res.status(400).json({ success: false, error: "missing registrationType" });

    const info = await findExistingByEmailMongo(email, registrationType);
    if (info) return res.json({ success: true, found: true, info });
    return res.json({ success: true, found: false });
  } catch (err) {
    console.error("[otp/check-email] error:", err && (err.stack || err.message || err));
    return res.status(500).json({ success: false, error: "server error" });
  }
});

/* ---------- POST /api/otp/send ----------
   Body: { type: "email", value: "<email>", requestId?, registrationType: "visitor" }
   - if existing found -> responds 409 with existing info
   - otherwise generates OTP, sends (or jsonTransport) and returns success
*/
router.post("/send", express.json({ limit: "2mb" }), async (req, res) => {
  try {
    const { value, registrationType } = req.body || {};
    if (!isValidEmail(value)) return res.status(400).json({ success: false, error: "Provide a valid email" });
    if (!registrationType || typeof registrationType !== "string") return res.status(400).json({ success: false, error: "registrationType required" });

    const emailNorm = normalizeEmail(value);
    const regType = String(registrationType).trim();

    // check existing in registrants
    const existing = await findExistingByEmailMongo(emailNorm, regType);
    if (existing) {
      return res.status(409).json({
        success: false,
        error: "Email already exists",
        existing,
        registrationType: regType,
      });
    }

    // generate OTP and store
    const otp = genOtp();
    const key = `${regType}::${emailNorm}`;
    const now = Date.now();
    otpStore.set(key, { otp, expires: now + OTP_TTL_MS, attempts: 0, lastSentAt: now, cooldownUntil: now + RESEND_COOLDOWN_MS });

    // send email (may be jsonTransport in dev)
    const from = process.env.MAIL_FROM || process.env.SMTP_USER || "no-reply@example.com";
    try {
      await transporter.sendMail({ from, to: value, subject: "Your RailTrans Expo OTP", text: `Your OTP is ${otp}. It expires in 5 minutes.`, html: `<p>Your OTP is <b>${otp}</b>. It expires in 5 minutes.</p>` });
    } catch (mailErr) {
      console.error("[otp/send] mail send failed:", mailErr && (mailErr.stack || mailErr.message || mailErr));
      otpStore.delete(key);
      return res.status(500).json({ success: false, error: "Failed to send OTP" });
    }

    return res.json({ success: true, email: emailNorm, registrationType: regType, otpSent: true, expiresInSec: Math.floor(OTP_TTL_MS / 1000) });
  } catch (err) {
    console.error("[otp/send] unexpected:", err && (err.stack || err.message || err));
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

/* ---------- POST /api/otp/verify ---------- */
router.post("/verify", express.json({ limit: "2mb" }), async (req, res) => {
  try {
    const { value, otp, registrationType } = req.body || {};
    if (!isValidEmail(value)) return res.status(400).json({ success: false, error: "Provide a valid email" });
    if (!registrationType || typeof registrationType !== "string") return res.status(400).json({ success: false, error: "registrationType required" });

    const emailKey = normalizeEmail(value);
    const regType = String(registrationType).trim();
    const key = `${regType}::${emailKey}`;
    const rec = otpStore.get(key);
    if (!rec) return res.json({ success: false, error: "OTP not found or expired" });

    if (rec.expires < Date.now()) { otpStore.delete(key); return res.json({ success: false, error: "OTP expired" }); }
    if ((rec.attempts || 0) >= MAX_VERIFY_ATTEMPTS) { otpStore.delete(key); return res.status(429).json({ success: false, error: "Too many attempts" }); }

    const input = String(otp || "").trim();
    if (input.length !== 6 || rec.otp !== input) { rec.attempts = (rec.attempts || 0) + 1; otpStore.set(key, rec); return res.json({ success: false, error: "Incorrect OTP" }); }

    // consume
    otpStore.delete(key);

    // after verification, check if existing registrant (helps UI show upgrade)
    try {
      const existing = await findExistingByEmailMongo(emailKey, regType);
      if (existing) return res.json({ success: true, email: emailKey, registrationType: regType, existing });
      return res.json({ success: true, email: emailKey, registrationType: regType });
    } catch (dbErr) {
      console.error("[otp/verify] DB error:", dbErr && (dbErr.stack || dbErr.message || dbErr));
      return res.status(500).json({ success: false, error: "Server error during verification" });
    }
  } catch (err) {
    console.error("[otp/verify] unexpected:", err && (err.stack || err.message || err));
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

module.exports = router;