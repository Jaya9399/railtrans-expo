// Email template for ticket / e-badge delivery
// Robust fetching of event details and admin logo that works in browser and server (Node).
// - Resolves logo and other relative URLs using (in order):
//   1) explicit frontendBase arg passed to buildTicketEmail
//   2) process.env.FRONTEND_BASE or process.env.REACT_APP_API_BASE / REACT_APP_API_BASE_URL
//   3) window.__FRONTEND_BASE__ (client runtime override)
//   4) window.location.origin (client fallback)
// - Never attaches images; only PDF (pdfBase64) is attached.

function normalizeBase64(b) {
  if (!b) return "";
  if (typeof b === "string" && b.startsWith("data:")) {
    const parts = b.split(",");
    return parts[1] || "";
  }
  return b;
}

function getEnvFrontendBase() {
  try {
    if (typeof process !== "undefined" && process.env) {
      const env =
        process.env.FRONTEND_BASE ||
        process.env.REACT_APP_API_BASE ||
        process.env.REACT_APP_API_BASE_URL ||
        process.env.PUBLIC_BASE_URL ||
        "";
      if (env && String(env).trim()) return String(env).replace(/\/$/, "");
    }
  } catch (e) {}
  try {
    if (typeof window !== "undefined" && window.__FRONTEND_BASE__) {
      return String(window.__FRONTEND_BASE__).replace(/\/$/, "");
    }
  } catch (e) {}
  return "";
}

function buildApiUrl(frontendBase, path) {
  const base = String(
    frontendBase ||
      getEnvFrontendBase() ||
      (typeof window !== "undefined" && window.location ? window.location.origin : "")
  ).replace(/\/$/, "");
  if (!path) return base || path;
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("/")) return base ? base + path : path;
  return base ? base + "/" + path.replace(/^\//, "") : path;
}

/**
 * safeFetchJson(url, opts)
 * - Uses global fetch if present, otherwise attempts to require('node-fetch').
 * - Reads response text and:
 *    - If content-type indicates JSON, parses and returns it (throws on parse error).
 *    - If not JSON, tries JSON.parse on text; if parse fails returns null (caller will fallback).
 * - On non-2xx responses throws an Error including a snippet of response body to aid debugging.
 */
async function safeFetchJson(url, opts = {}) {
  let _fetch = typeof fetch !== "undefined" ? fetch : null;
  if (!_fetch) {
    // Attempt to load node-fetch dynamically for Node environments (CJS)
    try {
      // eslint-disable-next-line global-require
      const nf = require("node-fetch");
      // node-fetch v3 is ESM default export; handle both shapes
      _fetch = nf && nf.default ? nf.default : nf;
    } catch (e) {
      throw new Error("fetch is not available in this environment. Install node-fetch or use Node 18+.");
    }
  }

  const res = await _fetch(url, opts);
  const headers = res.headers || {};
  // Normalize getting content-type for both node-fetch and browser
  const ct = (typeof headers.get === "function" ? headers.get("content-type") : headers["content-type"]) || "";
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    const snippet = text ? text.slice(0, 1000) : "";
    const err = new Error(`Request failed ${res.status} ${res.statusText || ""} - ${snippet}`);
    err.status = res.status;
    throw err;
  }
  const lower = (ct || "").toLowerCase();
  if (lower.includes("application/json") || lower.includes("application/ld+json") || lower.includes("text/json")) {
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error("Invalid JSON response: " + (e && e.message));
    }
  }
  // Try to parse text as JSON even if content-type wrong (some servers mis-set headers)
  try {
    return JSON.parse(text);
  } catch {
    // Non-JSON (HTML or plain) — return null to let caller fallback
    return null;
  }
}

/**
 * Try to fetch canonical event-details from admin endpoint(s).
 * Tries these in order (resolved via buildApiUrl):
 *   /api/configs/event-details
 *   /api/event-details
 * Also tries absolute forms if frontendBase provided.
 */
async function fetchCanonicalEventDetails(frontendBase) {
  const paths = ["/api/configs/event-details", "/api/event-details"];
  for (const p of paths) {
    const u = buildApiUrl(frontendBase, p) + (p.includes("?") ? "&" : "?") + "cb=" + Date.now();
    try {
      const js = await safeFetchJson(u, { headers: { Accept: "application/json" } });
      if (!js) continue;
      const val = js && js.value !== undefined ? js.value : js;
      if (val && typeof val === "object" && Object.keys(val).length) return val;
    } catch (e) {
      // try next path
      continue;
    }
  }
  return null;
}

/**
 * Try to fetch admin-config logo from preferred endpoints.
 * Returns first found logo URL string, or empty string.
 */
async function fetchAdminLogo(frontendBase) {
  const paths = ["/api/admin-config", "/api/admin/logo-url"];
  for (const p of paths) {
    const u = buildApiUrl(frontendBase, p) + (p.includes("?") ? "&" : "?") + "cb=" + Date.now();
    try {
      const js = await safeFetchJson(u, { headers: { Accept: "application/json" } });
      if (!js) continue;
      if (js.logoUrl) return js.logoUrl;
      if (js.logo_url) return js.logo_url;
      if (js.url) return js.url;
      if (typeof js === "string" && js.trim()) return js.trim();
    } catch (e) {
      continue;
    }
  }
  return "";
}

function normalizeForEmailUrl(url, frontendBase) {
  if (!url) return "";
  const s = String(url || "").trim();
  if (!s) return "";
  if (s.startsWith("data:")) return s;
  if (/^https?:\/\//i.test(s)) return s;
  const base = buildApiUrl(frontendBase, "/").replace(/\/$/, "");
  if (!base) return s;
  if (s.startsWith("/")) return base + s;
  return base + "/" + s.replace(/^\//, "");
}

/**
 * Extract event details from the registration form ONLY.
 */
function getEventFromFormStrict(form) {
  const out = { name: "", dates: "", time: "", venue: "", tagline: "" };
  if (!form || typeof form !== "object") return out;

  const pickFromObj = (obj) => {
    if (!obj || typeof obj !== "object") return;
    if (obj.name && !out.name) out.name = String(obj.name);
    if ((obj.title || obj.eventTitle) && !out.name) out.name = String(obj.title || obj.eventTitle);
    if (obj.dates && !out.dates) out.dates = String(obj.dates);
    if (obj.date && !out.dates) out.dates = String(obj.date);
    if (obj.time && !out.time) out.time = String(obj.time);
    if (obj.venue && !out.venue) out.venue = String(obj.venue);
    if (obj.location && !out.venue) out.venue = String(obj.location);
    if (obj.tagline && !out.tagline) out.tagline = String(obj.tagline);
  };

  if (form.event && typeof form.event === "object") pickFromObj(form.event);
  if (form.eventDetails && typeof form.eventDetails === "object") pickFromObj(form.eventDetails);

  const name = form.eventName || form.event_name || form.eventTitle || form.eventtitle;
  const dates = form.eventDates || form.event_dates || form.dates || form.date;
  const time = form.eventTime || form.event_time;
  const venue = form.eventVenue || form.event_venue || form.venue;
  const tagline = form.eventTagline || form.tagline;

  if (name && !out.name) out.name = String(name);
  if (dates && !out.dates) out.dates = String(dates);
  if (time && !out.time) out.time = String(time);
  if (venue && !out.venue) out.venue = String(venue);
  if (tagline && !out.tagline) out.tagline = String(tagline);

  return out;
}

/**
 * buildTicketEmail(...)
 * - frontendBase: pass explicit base when calling from server (e.g. process.env.FRONTEND_BASE)
 * - best-effort fetch of canonical event details and admin logo.
 */
export async function buildTicketEmail({
  frontendBase = "",
  entity = "attendee",
  id = "",
  name = "",
  company = "",
  ticket_category = "",
  badgePreviewUrl = "",
  downloadUrl = "",
  upgradeUrl = "",
  logoUrl = "",
  form = null,
  pdfBase64 = null,
} = {}) {
  const effectiveFrontend = String(frontendBase || getEnvFrontendBase() || (typeof window !== "undefined" && window.location ? window.location.origin : "")).replace(/\/$/, "");

  // canonical event details (best-effort)
  let canonicalEvent = null;
  try {
    canonicalEvent = await fetchCanonicalEventDetails(effectiveFrontend);
  } catch (e) {
    canonicalEvent = null;
  }
  const ev = canonicalEvent && typeof canonicalEvent === "object"
    ? {
        name: canonicalEvent.name || canonicalEvent.eventName || canonicalEvent.title || "",
        dates: canonicalEvent.dates || canonicalEvent.date || canonicalEvent.eventDates || "",
        time: canonicalEvent.time || canonicalEvent.startTime || canonicalEvent.eventTime || "",
        venue: canonicalEvent.venue || canonicalEvent.location || canonicalEvent.eventVenue || "",
        tagline: canonicalEvent.tagline || canonicalEvent.subtitle || "",
      }
    : getEventFromFormStrict(form);

  // resolve logo using admin-config, then passed logoUrl
  let adminLogo = "";
  try {
    adminLogo = await fetchAdminLogo(effectiveFrontend);
  } catch (e) {
    adminLogo = "";
  }
  const chosenLogoSource = adminLogo || logoUrl || "";
  const resolvedLogo = normalizeForEmailUrl(chosenLogoSource, effectiveFrontend) || "";

  const resolvedBadgePreview = normalizeForEmailUrl(badgePreviewUrl || "", effectiveFrontend);
  const resolvedDownload = normalizeForEmailUrl(downloadUrl || "", effectiveFrontend) || `${effectiveFrontend}/ticket-download?entity=${encodeURIComponent(entity)}&${id ? `id=${encodeURIComponent(String(id))}` : `ticket_code=${encodeURIComponent(String(form?.ticket_code || ""))}`}`;

  let resolvedUpgrade = normalizeForEmailUrl(upgradeUrl || "", effectiveFrontend);
  if (entity === "visitors" && !resolvedUpgrade) {
    resolvedUpgrade = `${effectiveFrontend}/ticket-upgrade?entity=visitors&${id ? `id=${encodeURIComponent(String(id))}` : `ticket_code=${encodeURIComponent(String(form?.ticket_code || ""))}`}`;
  }

  const subject = `RailTrans Expo — Your E‑Badge & Registration`;

  const text = [
    `Dear ${name || "Participant"},`,
    "",
    "Thank you for registering for RailTrans Expo 2026.",
    ticket_category ? `Ticket category: ${ticket_category}` : "",
    entity ? `Entity: ${entity}` : "",
    company ? `Company: ${company}` : "",
    "",
    `Download your E‑Badge: ${resolvedDownload}`,
    entity === "visitors" && resolvedUpgrade ? `Upgrade your ticket: ${resolvedUpgrade}` : "",
    "",
    "Event Details (from canonical admin record):",
    ev.name ? `- ${ev.name}` : "- ",
    ev.dates ? `- Dates: ${ev.dates}` : "- Dates: ",
    ev.time ? `- Time: ${ev.time}` : "- Time: ",
    ev.venue ? `- Venue: ${ev.venue}` : "- Venue: ",
    "",
    "Important Information & Guidelines:",
    "- Entry permitted only through Gate No. 4 and Gate No. 10.",
    "- Please carry and present your E‑badge (received via email/WhatsApp) for scanning at the entry point. The badge is valid exclusively for RailTrans Expo 2026 and concurrent events on event days.",
    "- A physical badge can be collected from the on‑site registration counter.",
    "- The badge is strictly non‑transferable and must be worn visibly at all times within the venue.",
    "- Entry is permitted to individuals aged 18 years and above; infants are not permitted.",
    "- All participants must carry a valid Government‑issued photo ID (Passport is mandatory for foreign nationals).",
    "- The organizers reserve the right of admission. Security frisking will be carried out at all entry points.",
    "- Smoking, tobacco use, and any banned substances are strictly prohibited within the venue.",
    "- Paid parking facilities are available at the Bharat Mandapam basement.",
    "- For any registration‑related assistance, please approach the on‑site registration counter.",
    "",
    "Warm regards,",
    "Team RailTrans Expo 2026",
  ].filter(Boolean).join("\n");

  const showUpgradeButton = entity === "visitors" && Boolean(resolvedUpgrade);
  const upgradeButtonHtml = showUpgradeButton ? `<a href="${resolvedUpgrade}" class="cta-outline" target="_blank" rel="noopener noreferrer">Upgrade Ticket</a>` : "";

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width,initial-scale=1"/>
    <style>
      body { font-family: Inter, Arial, Helvetica, sans-serif; color:#111827; background:#f8fafc; margin:0; padding:0; -webkit-font-smoothing:antialiased; }
      .wrap { max-width:760px; margin:28px auto; background:#fff; border-radius:10px; padding:22px; box-sizing:border-box; }
      .header { text-align:center; margin-bottom:12px; }
      .logo { height:140px; width:auto; object-fit:contain; display:inline-block; }
      .intro { color:#374151; font-size:14px; line-height:1.5; margin:10px 0 16px; }
      .card { background:#f1f5f9; border-radius:8px; padding:16px; border:1px solid #e6eef4; margin:12px 0; }
      .name { font-weight:700; color:#0b4f60; font-size:16px; margin-bottom:8px; text-align:center; }
      .meta-row { display:flex; gap:10px; justify-content:center; flex-wrap:wrap; margin-top:8px; }
      .meta-item { background:#fff; padding:8px 10px; border-radius:6px; border:1px solid #e6eef4; color:#475569; font-size:13px; }
      .cta { display:inline-block; padding:12px 18px; background:#c8102e; color:#fff; text-decoration:none; border-radius:8px; font-weight:700; }
      .cta-outline { display:inline-block; padding:12px 18px; background:#fff; color:#0b4f60; border:1px solid #0b4f60; text-decoration:none; border-radius:8px; font-weight:700; }
      .cta-wrap { display:flex; gap:28px; align-items:center; justify-content:center; margin-top:16px; flex-wrap:wrap; }
      .details { margin-top:14px; }
      .details h4 { margin:12px 0 6px; color:#0b4f60; }
      .details ul { padding-left:18px; color:#374151; }
      .event-details { margin-top:18px; border-top:1px solid #eef2f7; padding-top:14px; }
      .event-row { display:flex; gap:12px; margin-bottom:8px; align-items:flex-start; }
      .label { width:110px; color:#475569; font-weight:600; }
      .value { color:#111827; white-space:pre-wrap; word-break:break-word; }
      .guidelines { margin-top:18px; }
      .guidelines h4 { margin:0 0 8px 0; color:#0b4f60; }
      .guidelines ul { padding-left:18px; color:#374151; }
      .footer { margin-top:18px; color:#6b7280; font-size:13px; text-align:left; }
      @media (max-width:600px) {
        .logo { height:100px; }
        .cta-wrap { gap:16px; }
        .label { width:90px; }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="header">
        ${resolvedLogo ? `<img src="${resolvedLogo}" alt="RailTrans Expo logo" class="logo" />` : ""}
      </div>

      <p class="intro">Dear ${name || "Participant"},</p>

      <div class="card">
        <div class="name">${name || ""}${company ? ` — ${company}` : ""}</div>

        <div class="meta-row">
          ${ticket_category ? `<div class="meta-item">${ticket_category}</div>` : ""}
          ${entity ? `<div class="meta-item">${entity}</div>` : ""}
        </div>

        ${resolvedBadgePreview ? `<div style="margin-top:12px; text-align:center;"><img src="${resolvedBadgePreview}" alt="E-badge preview" style="max-width:320px; width:100%; border-radius:8px;"/></div>` : ""}

        <div class="cta-wrap">
          <a href="${resolvedDownload}" class="cta" target="_blank" rel="noopener noreferrer">Download E‑Badge</a>
          ${upgradeButtonHtml}
        </div>

        <div class="details">
          <h4>Other details</h4>
          <ul>
            ${ticket_category ? `<li><strong>Ticket category:</strong> ${ticket_category}</li>` : ""}
            ${entity ? `<li><strong>Entity:</strong> ${entity}</li>` : ""}
            ${company ? `<li><strong>Company:</strong> ${company}</li>` : ""}
          </ul>
        </div>
      </div>

      <div class="event-details">
        <h4 style="margin:0 0 8px 0; color:#0b4f60;">Event Details</h4>
        <div class="event-row"><div class="label">Name:</div><div class="value">${(ev && ev.name) ? ev.name : ""}</div></div>
        <div class="event-row"><div class="label">Dates:</div><div class="value">${(ev && ev.dates) ? ev.dates : ""}</div></div>
        <div class="event-row"><div class="label">Time:</div><div class="value">${(ev && ev.time) ? ev.time : ""}</div></div>
        <div class="event-row"><div class="label">Venue:</div><div class="value">${(ev && ev.venue) ? ev.venue : ""}</div></div>
      </div>

      <div class="guidelines">
        <h4>Important Information & Guidelines</h4>
        <ul>
          <li>Entry permitted only through Gate No. 4 and Gate No. 10.</li>
          <li>Please carry and present your E‑badge (received via email/WhatsApp) for scanning at the entry point. The badge is valid exclusively for RailTrans Expo 2026 and concurrent events on event days.</li>
          <li>A physical badge can be collected from the on‑site registration counter.</li>
          <li>The badge is strictly non‑transferable and must be worn visibly at all times within the venue.</li>
          <li>Entry is permitted to individuals aged 18 years and above; infants are not permitted.</li>
          <li>All participants must carry a valid Government‑issued photo ID (Passport is mandatory for foreign nationals).</li>
          <li>The organizers reserve the right of admission. Security frisking will be carried out at all entry points.</li>
          <li>Smoking, tobacco use, and any banned substances are strictly prohibited within the venue.</li>
          <li>Paid parking facilities are available at the Bharat Mandapam basement.</li>
          <li>For any registration‑related assistance, please approach the on‑site registration counter.</li>
        </ul>
      </div>

      <div class="footer">
        <p>We look forward to welcoming you at RailTrans Expo 2026.</p>
        <p>Warm regards,<br/>Team RailTrans Expo 2026</p>
      </div>
    </div>
  </body>
</html>`;

  const attachments = [];
  if (pdfBase64) {
    const b64 = normalizeBase64(pdfBase64);
    if (b64) {
      attachments.push({
        filename: `e-badge.pdf`,
        content: b64,
        encoding: "base64",
        contentType: "application/pdf",
      });
    }
  }

  return { subject, text, html, attachments };
}