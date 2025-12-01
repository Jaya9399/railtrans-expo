const nodemailer = require("nodemailer");

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_SERVICE,
  MAIL_FROM = "support@railtransexpo.com",
  MAIL_FROM_NAME = "RailTrans Expo",
  MAIL_REPLYTO = ""
} = process.env;

/**
 * Normalize MAIL_FROM and MAIL_FROM_NAME:
 * - MAIL_FROM should be plain email (support@...)
 * - MAIL_FROM_NAME is friendly name (RailTrans Expo)
 * If MAIL_FROM already contains a name (<name@example.com>), we parse it.
 */
function parseMailFrom(envFrom, envName) {
  let email = String(envFrom || "").trim();
  let name = String(envName || "").trim();

  // If MAIL_FROM includes angle brackets or contains a name, try to extract email
  const angleMatch = email.match(/^(.*)<\s*([^>]+)\s*>$/);
  if (angleMatch) {
    // e.g. "RailTrans Expo <support@domain.com>"
    const maybeName = angleMatch[1].replace(/(^["'\s]+|["'\s]+$)/g, "").trim();
    email = angleMatch[2].trim();
    if (!name && maybeName) name = maybeName;
  } else {
    // If envFrom contains a space and an @, it might be 'Name support@domain.com'
    const parts = email.split(/\s+/);
    if (parts.length === 2 && parts[1].includes("@")) {
      name = name || parts[0];
      email = parts[1];
    }
  }

  // final sanity: email must be an address
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    // fallback to SMTP_USER if looks like an email
    if (SMTP_USER && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(SMTP_USER)) {
      email = SMTP_USER;
    }
  }

  return { email, name };
}

function buildTransporter() {
  if (SMTP_HOST) {
    const port = Number(SMTP_PORT || 587);
    const secure = port === 465;
    return nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      pool: true,
      tls: { rejectUnauthorized: false }, // keep for some hosts; remove if strict TLS required
    });
  }
  if (SMTP_SERVICE) {
    return nodemailer.createTransport({
      service: SMTP_SERVICE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      pool: true,
    });
  }
  // No config -> stub that throws
  return {
    async sendMail() {
      throw new Error(
        "SMTP not configured. Set SMTP_HOST/SMTP_USER/SMTP_PASS or SMTP_SERVICE."
      );
    },
    verify(cb) {
      cb && cb(new Error("SMTP not configured"));
    },
  };
}

const transporter = buildTransporter();
const FROM_INFO = parseMailFrom(MAIL_FROM, MAIL_FROM_NAME);

/**
 * verifyTransport: call at startup to validate SMTP connectivity
 */
async function verifyTransport() {
  try {
    const ok = await transporter.verify();
    console.log("[mailer] SMTP verify success:", ok);
    return { ok: true, info: ok };
  } catch (err) {
    console.error("[mailer] SMTP verify failed:", err && (err.stack || err));
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

/**
 * sendMail({ to, subject, text, html, attachments })
 * - attachments: array of { filename, content (base64 or Buffer), encoding, contentType }
 * - returns full info or full error object
 */
async function sendMail(opts = {}) {
  const to = opts.to;
  if (!to) {
    return { success: false, error: "Missing `to` address" };
  }

  // Build from header and envelope.from separately to ensure proper SMTP envelope
  const fromHeader = FROM_INFO.name
    ? `${FROM_INFO.name} <${FROM_INFO.email}>`
    : FROM_INFO.email;
  const envelopeFrom = FROM_INFO.email; // used for SMTP envelope

  const message = {
    from: fromHeader,
    to: Array.isArray(to) ? to.join(", ") : to,
    subject: opts.subject || "(no subject)",
    text: opts.text || undefined,
    html: opts.html || undefined,
    replyTo: MAIL_REPLYTO || FROM_INFO.email,
    // attachments: pass through as provided
    attachments:
      (opts.attachments || []).map((a) => {
        const out = {};
        if (a.filename) out.filename = a.filename;
        if (a.content) out.content = a.content;
        if (a.path) out.path = a.path;
        if (a.encoding) out.encoding = a.encoding;
        if (a.contentType) out.contentType = a.contentType;
        return out;
      }) || undefined,
    envelope: { from: envelopeFrom, to: Array.isArray(to) ? to : [to] },
  };

  try {
    const info = await transporter.sendMail(message);
    // Log full info for debugging (accepted/rejected/messageId/response)
    console.debug("[mailer] sendMail info:", JSON.stringify(info, null, 2));
    return { success: true, info };
  } catch (err) {
    // Include response body if present
    const errBody =
      (err && err.response) || (err && err.response && err.response.body) || null;
    console.error(
      "[mailer] sendMail error:",
      err && (err.stack || err),
      "response:",
      errBody
    );
    return { success: false, error: String(err && err.message ? err.message : err), body: errBody };
  }
}

module.exports = { sendMail, verifyTransport, FROM_INFO };