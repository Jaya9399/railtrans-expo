// Builds subject, plain-text and HTML email for ticket / e-badge delivery
// This template inlines no remote images itself — server should attach logo as CID.
// It renders the full registration message and guidelines requested by the user.

function normalizeBase64(b) {
  if (!b) return "";
  if (b.startsWith("data:")) {
    const parts = b.split(",");
    return parts[1] || "";
  }
  return b;
}

function normalizeForEmailUrl(url, frontendBase) {
  if (!url) return "";
  const s = String(url).trim();
  if (!s) return "";
  if (s.startsWith("data:")) return s;
  if (/^https?:\/\//i.test(s)) return s;
  const base = String(frontendBase || "").replace(/\/$/, "");
  if (!base) return s;
  if (s.startsWith("/")) return base + s;
  return base + "/" + s.replace(/^\//, "");
}

function resolveEventDetails(form, eventParam) {
  if (form && typeof form === "object") {
    if (form.event && typeof form.event === "object") return { ...eventParam, ...form.event };
    if (form.eventDetails && typeof form.eventDetails === "object") return { ...eventParam, ...form.eventDetails };
    const possible = {
      name: form.eventName || form.event_name || form.eventTitle || eventParam.name,
      dates: form.eventDates || form.event_dates || form.dates || eventParam.dates,
      time: form.eventTime || form.event_time || eventParam.time,
      venue: form.eventVenue || form.event_venue || form.venue || eventParam.venue,
      tagline: form.eventTagline || form.tagline || eventParam.tagline,
    };
    if (possible.name || possible.dates || possible.venue || possible.time) return { ...eventParam, ...possible };
  }
  return eventParam || {};
}

export async function buildTicketEmail({
  frontendBase = (typeof window !== "undefined" && window.location ? window.location.origin : "https://railtransexpo.com"),
  entity = "attendee",
  id = "",
  name = "",
  company = "",
  ticket_code = "",
  ticket_category = "",
  badgePreviewUrl = "",
  downloadUrl = "",
  upgradeUrl = "",
  logoUrl = "", // absolute public URL; server can inline as CID
  event = {
    name: "6th RailTrans Expo 2026",
    dates: "03–04 July 2026",
    time: "10:00 AM – 5:00 PM",
    venue: "Bharat Mandapam, New Delhi",
  },
  form = null,
  pdfBase64 = null,
} = {}) {
  const frontend = String(frontendBase || "").replace(/\/$/, "");
  const resolvedEvent = resolveEventDetails(form, event || {});

  // Normalize logo URL (kept as-is for server to inline)
  let resolvedLogo = logoUrl || "";
  resolvedLogo = normalizeForEmailUrl(resolvedLogo, frontend) || "";

  // Subject required by user
  const subject = `6th RailTrans Expo 2026 – Download Your Registration E-Badge`;

  // Choose download link text target
  const downloadTarget = downloadUrl || `${frontend}/ticket?entity=${encodeURIComponent(entity)}&id=${encodeURIComponent(String(id || ""))}`;

  // Plain-text body (detailed)
  const textLines = [
    `Dear ${name || "Participant"},`,
    "",
    `Thank you for registering for the 6th RailTrans Expo 2026 – Asia’s Second Largest Event for Railways, Transportation & Semiconductor Industry scheduled to be held from ${(resolvedEvent && (resolvedEvent.dates || "03–04 July 2026"))} at ${(resolvedEvent && (resolvedEvent.venue || "Bharat Mandapam, Pragati Maidan, New Delhi, India"))}.`,
    "",
    ticket_code ? `Your Registration Number: ${ticket_code}` : "",
    downloadTarget ? `Download your E-Badge: ${downloadTarget}` : "",
    "",
    "Event Details",
    `Dates: ${(resolvedEvent && (resolvedEvent.dates || "03–04 July 2026"))}`,
    `Time: ${(resolvedEvent && (resolvedEvent.time || "10:00 AM – 5:00 PM"))}`,
    `Venue: ${(resolvedEvent && (resolvedEvent.venue || "Bharat Mandapam, New Delhi"))}`,
    "",
    "Important Information & Guidelines:",
    "- Entry permitted only through Gate No. 4 and Gate No. 10.",
    "- Please carry and present your E-badge (received via email/WhatsApp) for scanning at the entry point. The badge is valid exclusively for RailTrans Expo 2026 and concurrent events on event days.",
    "- A physical badge can be collected from the on-site registration counter.",
    "- The badge is strictly non-transferable and must be worn visibly at all times within the venue.",
    "- Entry is permitted to individuals aged 18 years and above; infants are not permitted.",
    "- All participants must carry a valid Government-issued photo ID (Passport is mandatory for foreign nationals).",
    "- The organizers reserve the right of admission. Security frisking will be carried out at all entry points.",
    "- Smoking, tobacco use, and any banned substances are strictly prohibited within the venue.",
    "- Paid parking facilities are available at the Bharat Mandapam basement.",
    "",
    "For any registration-related assistance, please approach the on-site registration counter.",
    "",
    "We look forward to welcoming you at RailTrans Expo 2026.",
    "",
    "Warm regards,",
    "Team RailTrans Expo 2026",
  ].filter(Boolean);
  const text = textLines.join("\n");

  // HTML body:
  // - Left aligned logo image only (no event/date text beside logo per request)
  // - Full descriptive paragraph and registration number
  // - "Download your E-Badge: Click Here" link
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; background: #f3f4f6; margin: 0; padding: 0; }
      .wrap { max-width: 680px; margin: 24px auto; background: #ffffff; border-radius: 8px; overflow: hidden; padding: 20px; }
      .header { display:flex; align-items:center; gap:12px; margin-bottom: 12px; }
      .logo { height: 44px; width: auto; display:block; object-fit: contain; }
      h1 { font-size: 20px; color:#0b4f60; margin: 6px 0 12px; }
      p { margin: 8px 0; line-height: 1.45; color: #374151; }
      .card { background: #f8fafc; border-radius:8px; padding:14px; border:1px solid #e6eef4; margin: 12px 0; text-align:center; }
      .cta { display:inline-block; padding:12px 18px; background:#c8102e; color:#fff; text-decoration:none; border-radius:6px; font-weight:700; margin-top:10px; }
      .muted { color:#475569; font-size:14px; }
      .guidelines { margin-top:10px; font-size:13px; color:#475569; line-height:1.5; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="header">
        ${resolvedLogo ? `<img src="${resolvedLogo}" alt="logo" class="logo" />` : ""}
      </div>

      <h1>Your Registration E‑Badge</h1>

      <p>Dear ${name || "Participant"},</p>

      <p>Thank you for registering for the 6th RailTrans Expo 2026 – Asia’s Second Largest Event for Railways, Transportation & Semiconductor Industry scheduled to be held from ${(resolvedEvent && (resolvedEvent.dates || "03–04 July 2026"))} at ${(resolvedEvent && (resolvedEvent.venue || "Bharat Mandapam, Pragati Maidan, New Delhi, India"))}.</p>

      ${ticket_code ? `<p style="font-weight:700">Your Registration Number: ${ticket_code}</p>` : ""}

      <div class="card">
        <div style="font-weight:700; font-size:16px;">${name || ""}</div>
        ${company ? `<div style="margin-top:6px;color:#475569">${company}</div>` : ""}
        ${badgePreviewUrl ? `<img src="${badgePreviewUrl}" alt="E-badge preview" style="max-width:260px;width:100%;margin:10px auto;border-radius:6px;display:block" />` : ""}
        <div>
          <a href="${downloadTarget}" class="cta" target="_blank" rel="noopener noreferrer">Download your E‑Badge: Click Here</a>
        </div>
      </div>

      <h2 style="font-size:16px;color:#0b4f60;margin-top:8px">Event Details</h2>
      <div class="muted">
        <div><strong>Dates:</strong> ${(resolvedEvent && (resolvedEvent.dates || "03–04 July 2026"))}</div>
        <div><strong>Time:</strong> ${(resolvedEvent && (resolvedEvent.time || "10:00 AM – 5:00 PM"))}</div>
        <div><strong>Venue:</strong> ${(resolvedEvent && (resolvedEvent.venue || "Halls 12 & 12A, Bharat Mandapam, New Delhi"))}</div>
      </div>

      <h3 style="font-size:15px;color:#0b4f60;margin-top:12px">Important Information & Guidelines</h3>
      <div class="guidelines">
        <p>Entry permitted only through Gate No. 4 and Gate No. 10.</p>
        <p>Please carry and present your E-badge (received via email/WhatsApp) for scanning at the entry point. The badge is valid exclusively for RailTrans Expo 2026 and concurrent events on event days.</p>
        <p>A physical badge can be collected from the on-site registration counter.</p>
        <p>The badge is strictly non-transferable and must be worn visibly at all times within the venue.</p>
        <p>Entry is permitted to individuals aged 18 years and above; infants are not permitted.</p>
        <p>All participants must carry a valid Government-issued photo ID (Passport is mandatory for foreign nationals).</p>
        <p>The organizers reserve the right of admission. Security frisking will be carried out at all entry points.</p>
        <p>Smoking, tobacco use, and any banned substances are strictly prohibited within the venue.</p>
        <p>Paid parking facilities are available at the Bharat Mandapam basement.</p>
        <p>For any registration-related assistance, please approach the on-site registration counter.</p>
      </div>

      <p style="font-size:13px;color:#475569;margin-top:14px">We look forward to welcoming you at RailTrans Expo 2026.</p>

      <p style="font-size:13px;color:#475569;margin-top:14px">Warm regards,<br/>Team RailTrans Expo 2026</p>
    </div>
  </body>
</html>`;

  // Attach PDF (if provided)
  const attachments = [];
  if (pdfBase64) {
    const b64 = normalizeBase64(pdfBase64);
    if (b64) {
      attachments.push({
        filename: `${ticket_code ? String(ticket_code).replace(/\s+/g, "_") : "e-badge"}.pdf`,
        content: b64,
        encoding: "base64",
        contentType: "application/pdf",
      });
    }
  }

  return { subject, text, html, attachments };
}