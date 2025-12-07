const express = require("express");
const nodemailer = require("nodemailer");
const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");
const { URL } = require("url");
const axios = require("axios");
const http = require("http");
const https = require("https");
const os = require("os");

const router = express.Router();

/* --- transporter (unchanged) --- */
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
transporter.verify((err) => {
  if (err) console.error("SMTP verify failed:", err && err.message ? err.message : err);
  else console.log("SMTP server is ready to take our messages");
});

/* --- Utilities for fetching images robustly --- */

const logoCache = new Map();
const LOGO_CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour
const MAX_INLINE_BYTES = 300 * 1024; // 300 KB
const DEFAULT_TIMEOUT = 15000; // 15s

// create http/https agents with keepAlive for performance and reliability
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 10,
  rejectUnauthorized: process.env.ALLOW_INSECURE_FETCH === "true" ? false : true,
});

/**
 * Try to fetch a URL to a Buffer with retries, backoff, and detailed logging.
 * Also attempts local file fallback for paths like /uploads/...
 */
async function fetchBuffer(urlString, timeout = DEFAULT_TIMEOUT, maxAttempts = 3) {
  if (!urlString) throw new Error("No url provided");
  let lastErr = null;

  // If URL looks like a relative upload on this server, try local file paths first.
  try {
    const u = new URL(urlString);
    if (u.pathname && (u.pathname.includes("/uploads/") || u.pathname.startsWith("/uploads/"))) {
      const candidates = [
        path.join(process.cwd(), "public", u.pathname),    // projectRoot/public/uploads/...
        path.join(process.cwd(), u.pathname),              // projectRoot/uploads/...
        path.join(process.cwd(), "uploads", path.basename(u.pathname)), // projectRoot/uploads/<file>
      ];
      for (const cand of candidates) {
        try {
          if (fsSync.existsSync(cand)) {
            const buffer = await fs.readFile(cand);
            const ext = path.extname(cand).toLowerCase();
            const contentType = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".gif" ? "image/gif" : "application/octet-stream";
            console.log(`[mailer] fetched local file for ${urlString} -> ${cand} (${buffer.length} bytes)`);
            return { buffer, contentType };
          }
        } catch (e) {
          console.warn(`[mailer] local read failed for ${cand}:`, e && e.message ? e.message : e);
        }
      }
    }
  } catch (e) {
    // not a valid absolute URL; continue to HTTP attempt
  }

  // If host in URL appears to be the same as server public host, avoid calling public URL and try local file attempts above.
  try {
    const u = new URL(urlString);
    const publicHosts = [];
    if (process.env.PUBLIC_HOST) publicHosts.push(process.env.PUBLIC_HOST);
    if (process.env.NGROK_HOST) publicHosts.push(process.env.NGROK_HOST);
    if (process.env.NGROK_URL) publicHosts.push(new URL(process.env.NGROK_URL).host);
    if (process.env.HOSTNAME) publicHosts.push(process.env.HOSTNAME);
    publicHosts.push(os.hostname());
    const normalizedHost = (u.host || "").replace(/^www\./, "");
    for (const h of publicHosts) {
      if (!h) continue;
      const nh = String(h).replace(/^https?:\/\//, "").replace(/^www\./, "");
      if (nh && normalizedHost.includes(nh)) {
        console.warn(`[mailer] logo host ${normalizedHost} matches server host (${nh}). Prefer local file fallback to avoid self-fetch over ngrok.`);
        break; // we already tried local reads above
      }
    }
  } catch (e) {
    // ignore
  }

  // Now attempt HTTP(s) fetch with retries
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.debug(`[mailer] fetching [attempt ${attempt}] ${urlString}`);
      const res = await axios.get(urlString, {
        responseType: "arraybuffer",
        timeout,
        maxRedirects: 6,
        httpAgent,
        httpsAgent,
        headers: {
          "User-Agent": process.env.MAILER_USER_AGENT || "railtrans-mailer/1.0",
          Accept: "*/*",
        },
        validateStatus: (s) => s >= 200 && s < 400,
      });

      const buffer = Buffer.from(res.data);
      const contentType = res.headers && res.headers["content-type"] ? res.headers["content-type"] : null;
      console.log(`[mailer] fetch success ${urlString} (${buffer.length} bytes, content-type=${contentType})`);
      return { buffer, contentType };
    } catch (err) {
      lastErr = err;
      // Log useful debug info
      try {
        const code = err.code || (err.response && err.response.status) || "UNKNOWN";
        console.warn(`[mailer] fetch attempt ${attempt} failed for ${urlString}: code=${code} message=${err.message}`);
        if (err.response && err.response.status) {
          console.warn(`[mailer] response status: ${err.response.status} headers:`, err.response.headers || {});
        }
        if (err.request) {
          // axios exposes .request for debug
          console.warn(`[mailer] request info:`, err.request && err.request.path ? { path: err.request.path } : { /* minimal info */ });
        }
        if (typeof err.toJSON === "function") {
          console.debug("[mailer] axios error JSON:", err.toJSON());
        }
      } catch (logErr) {
        console.warn("[mailer] additional logging error:", logErr && logErr.message ? logErr.message : logErr);
      }

      // If last attempt, throw
      if (attempt === maxAttempts) {
        throw err;
      }

      // backoff before retrying
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }

  // fallback
  throw lastErr || new Error("fetchBuffer failed");
}

async function createInlineAttachmentFromUrl(logoUrl, cidName = "topbar-logo") {
  if (!logoUrl || typeof logoUrl !== "string") return null;

  const cached = logoCache.get(logoUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return { attachment: cached.attachment, cid: cached.attachment.cid, fromCache: true };
  }

  try {
    const { buffer, contentType } = await fetchBuffer(logoUrl.trim());
    if (!buffer) {
      console.warn("[mailer] fetchBuffer returned no buffer");
      return null;
    }

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

    logoCache.set(logoUrl, { attachment, expiresAt: Date.now() + LOGO_CACHE_TTL_MS });
    return { attachment, cid };
  } catch (err) {
    console.warn("[mailer] createInlineAttachmentFromUrl failed:", err && (err.stack || err.message) ? (err.stack || err.message) : err);
    return null;
  }
}

/* --- HTML replacement helper (unchanged) --- */
function replaceLogoSrcWithCid(html, logoUrl, cid) {
  if (!html || !logoUrl || !cid) return html;
  try {
    const esc = logoUrl.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const reExact = new RegExp(`(<img[^>]+src=(['"]))${esc}(['"][^>]*>)`, "i");
    if (reExact.test(html)) return html.replace(reExact, `$1cid:${cid}$3`);
    const u = new URL(logoUrl);
    const alt = u.origin + u.pathname;
    const escAlt = alt.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const reAlt = new RegExp(`(<img[^>]+src=(['"]))${escAlt}(['"][^>]*>)`, "i");
    if (reAlt.test(html)) return html.replace(reAlt, `$1cid:${cid}$3`);
    const name = u.pathname.split("/").pop();
    if (name) {
      const escName = name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      const reName = new RegExp(`(<img[^>]+src=(['"])[^'"]*${escName}[^'"]*(['"][^>]*>)`, "i");
      if (reName.test(html)) {
        return html.replace(reName, (m) => m.replace(/src=(['"])[^'"]+\1/i, `src="cid:${cid}"`));
      }
    }
  } catch (err) {}
  return html;
}

/* --- Route handler (mostly unchanged, uses createInlineAttachmentFromUrl) --- */
router.post("/", express.json({ limit: "8mb" }), async (req, res) => {
  try {
    const { to, subject, text, html: incomingHtml, attachments = [], logoUrl } = req.body || {};
    if (!to || !subject || (!text && !incomingHtml)) {
      return res.status(400).json({ success: false, error: "Missing required fields: to, subject, text|html" });
    }

    let html = incomingHtml || "";
    const mailAttachments = [];

    if (Array.isArray(attachments) && attachments.length) {
      for (const a of attachments) {
        const att = {};
        if (a.filename) att.filename = a.filename;
        if (a.content) { att.content = a.content; if (a.encoding) att.encoding = a.encoding; }
        if (a.path) att.path = a.path;
        if (a.contentType) att.contentType = a.contentType;
        mailAttachments.push(att);
      }
    }

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

          html = replaceLogoSrcWithCid(html, logoUrl.trim(), inline.attachment.cid);
          if (html && !html.includes(`cid:${inline.attachment.cid}`)) {
            html = html.replace(/<body([^>]*)>/i, `<body$1><div style="padding:12px 20px"><img src="cid:${inline.attachment.cid}" style="height:44px; width:auto;" alt="logo" /></div>`);
          }
        }
      } catch (err) {
        console.warn("[mailer] inline logo attach failed:", err && (err.stack || err.message) ? (err.stack || err.message) : err);
      }
    }

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

    const info = await transporter.sendMail(mailOptions);
    return res.json({
      success: true,
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
    });
  } catch (err) {
    console.error("[/api/mailer] send error:", err && (err.stack || err.message) ? (err.stack || err.message) : err);
    return res.status(500).json({ success: false, error: err && err.message ? err.message : "server error" });
  }
});

module.exports = router;