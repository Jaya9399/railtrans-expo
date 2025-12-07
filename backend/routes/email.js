const express = require("express");
const nodemailer = require("nodemailer");
const http = require("http");
const https = require("https");
const path = require("path");
const { URL } = require("url");

const router = express.Router();

/**
 * Build transporter using env vars (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS)
 * Falls back to SMTP_SERVICE if provided.
 */
function buildTransporter() {
  if (process.env.SMTP_HOST) {
    const port = Number(process.env.SMTP_PORT || 465);
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

// Optional verify on boot
transporter.verify((err, success) => {
  if (err) {
    console.error("SMTP verify failed:", err && err.message ? err.message : err);
  } else {
    console.log("SMTP server is ready to take our messages");
  }
});

/**
 * Simple HTTP(S) fetch to Buffer with timeout and basic error handling.
 * Returns { buffer, contentType } or throws.
 */
function fetchBuffer(urlString, timeout = 15000) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(urlString);
      const lib = u.protocol === "http:" ? http : https;
      const req = lib.get(u, { timeout }, (res) => {
        const status = res.statusCode || 0;
        if (status >= 400) {
          reject(new Error(`Failed to fetch ${urlString} - status ${status}`));
          res.resume();
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            buffer: Buffer.concat(chunks),
            contentType: res.headers["content-type"] || null,
          });
        });
      });
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error(`Timeout fetching ${urlString}`));
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Small in-memory cache for fetched logos to avoid repeated network fetches.
 * Key: logoUrl, Value: { attachment, expiresAt }
 */
const logoCache = new Map();
const LOGO_CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour

async function createInlineAttachmentFromUrl(logoUrl, cidName = "topbar-logo") {
  if (!logoUrl || typeof logoUrl !== "string") return null;

  // Return cached if fresh
  const cached = logoCache.get(logoUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return { attachment: cached.attachment, cid: cached.attachment.cid, fromCache: true };
  }

  try {
    const { buffer, contentType } = await fetchBuffer(logoUrl);
    const MAX_INLINE_BYTES = 300 * 1024; // protect against very large images
    if (buffer.length > MAX_INLINE_BYTES) {
      console.warn(`[mailer] logo too large to inline (${buffer.length} bytes): ${logoUrl}`);
      return null;
    }

    let filename = "logo";
    try {
      filename = path.basename(new URL(logoUrl).pathname) || filename;
    } catch (e) {}

    const cid = `${cidName}@railtransexpo`;
    const attachment = {
      filename,
      content: buffer,
      contentType: contentType || "application/octet-stream",
      cid,
    };

    // Cache it
    logoCache.set(logoUrl, {
      attachment,
      expiresAt: Date.now() + LOGO_CACHE_TTL_MS,
    });

    return { attachment, cid };
  } catch (err) {
    console.warn("[mailer] createInlineAttachmentFromUrl failed:", err && err.message ? err.message : err);
    return null;
  }
}

/**
 * Replace occurrences of <img src="...logoUrl..."> with cid:... in html string.
 * Tries exact match, origin+pathname (strip query/hash), then filename match.
 */
function replaceLogoSrcWithCid(html, logoUrl, cid) {
  if (!html || !logoUrl || !cid) return html;
  try {
    // exact match (quoted)
    const esc = logoUrl.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const reExact = new RegExp(`(<img[^>]+src=(['"]))${esc}(['"][^>]*>)`, "i");
    if (reExact.test(html)) return html.replace(reExact, `$1cid:${cid}$3`);

    // try origin+pathname (strip query/hash)
    const u = new URL(logoUrl);
    const alt = u.origin + u.pathname;
    const escAlt = alt.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const reAlt = new RegExp(`(<img[^>]+src=(['"]))${escAlt}(['"][^>]*>)`, "i");
    if (reAlt.test(html)) return html.replace(reAlt, `$1cid:${cid}$3`);

    // fallback: match by filename inside src
    const name = u.pathname.split("/").pop();
    if (name) {
      const escName = name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      const reName = new RegExp(`(<img[^>]+src=(['"])[^'"]*${escName}[^'"]*(['"][^>]*>)`, "i");
      if (reName.test(html)) {
        return html.replace(reName, (m) => m.replace(/src=(['"])[^'"]+\1/i, `src="cid:${cid}"`));
      }
    }
  } catch (err) {
    // ignore and return original html
  }
  return html;
}

/**
 * POST /api/mailer
 * Body: { to, subject, text?, html?, attachments?: [{ filename, content, encoding, contentType }], logoUrl? }
 * - If logoUrl is present and reachable, server will fetch and attach it inline (cid) and rewrite HTML.
 */
router.post("/", express.json({ limit: "8mb" }), async (req, res) => {
  try {
    const { to, subject, text, html: incomingHtml, attachments = [], logoUrl } = req.body || {};
    if (!to || !subject || (!text && !incomingHtml)) {
      return res.status(400).json({ success: false, error: "Missing required fields: to, subject, text|html" });
    }

    let html = incomingHtml || "";
    const mailAttachments = [];

    // Map incoming attachments (frontend may send base64 strings)
    if (Array.isArray(attachments) && attachments.length) {
      for (const a of attachments) {
        const att = {};
        if (a.filename) att.filename = a.filename;
        if (a.content) {
          att.content = a.content;
          if (a.encoding) att.encoding = a.encoding;
        }
        if (a.path) att.path = a.path;
        if (a.contentType) att.contentType = a.contentType;
        mailAttachments.push(att);
      }
    }

    // Inline logo if provided
    if (logoUrl && typeof logoUrl === "string" && /^https?:\/\//i.test(logoUrl)) {
      try {
        const inline = await createInlineAttachmentFromUrl(logoUrl.trim(), "topbar-logo");
        if (inline && inline.attachment) {
          mailAttachments.push({
            filename: inline.attachment.filename,
            content: inline.attachment.content,
            contentType: inline.attachment.contentType,
            cid: inline.attachment.cid,
          });

          // Replace any matching <img src="..."> with the cid
          html = replaceLogoSrcWithCid(html, logoUrl.trim(), inline.attachment.cid);

          // If replacement didn't find a match, prepend a small logo block in body
          if (html && !html.includes(`cid:${inline.attachment.cid}`)) {
            html = html.replace(/<body([^>]*)>/i, `<body$1><div style="padding:12px 20px"><img src="cid:${inline.attachment.cid}" style="height:44px; width:auto;" alt="logo" /></div>`);
          }
        }
      } catch (err) {
        console.warn("[mailer] inline logo attach failed:", err && err.message ? err.message : err);
      }
    }

    // Build mail options; ensure From aligned with authenticated SMTP (SPF/DMARC)
    const from = process.env.MAIL_FROM || process.env.SMTP_USER || "no-reply@localhost";
    const mailOptions = {
      from,
      to: Array.isArray(to) ? to.join(", ") : to,
      subject,
      text,
      html,
      attachments: mailAttachments,
      envelope: { from, to: Array.isArray(to) ? to : [to] },
    };

    // Send
    const info = await transporter.sendMail(mailOptions);
    return res.json({
      success: true,
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
    });
  } catch (err) {
    console.error("[/api/mailer] send error:", err && (err.stack || err));
    return res.status(500).json({ success: false, error: err && err.message ? err.message : "server error" });
  }
});

module.exports = router;