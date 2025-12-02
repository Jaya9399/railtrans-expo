// Builds subject, plain-text and HTML email for ticket / e-badge delivery
// Updated to include an "Upgrade Ticket" CTA that links to the ticket upgrade page.
// The "Upgrade Ticket" button is only included in the HTML email when entity === "visitors".
//
// Use:
// buildTicketEmail({ frontendBase, entity, id, name, company, ticket_code, ticket_category, bannerUrl, badgePreviewUrl, downloadUrl, upgradeUrl, event, form, pdfBase64 })
//
// When upgradeUrl is not provided, a sensible default is constructed as:
//   `${frontendBase}/ticket-upgrade?entity=${entity}&id=${id}&ticket_code=${ticket_code}`
//
// The email buttons use white text for contrast.

function normalizeBase64(b) {
  if (!b) return "";
  if (b.startsWith("data:")) {
    const parts = b.split(",");
    return parts[1] || "";
  }
  return b;
}

export function buildTicketEmail({
  frontendBase = (typeof window !== "undefined" && window.location ? window.location.origin : "https://railtransexpo.com"),
  entity = "attendee",
  id = "",
  name = "",
  company = "",
  ticket_code = "",
  ticket_category = "",
  bannerUrl = "",       // top banner (Image 1)
  badgePreviewUrl = "", // preview badge (Image 2)
  downloadUrl = "",     // direct link to badge PDF (recommended signed URL)
  upgradeUrl = "",      // self-service upgrade link (if any)
  event = {
    name: "6th RailTrans Expo 2026",
    dates: "03–04 July 2026",
    time: "10:00 AM – 5:00 PM",
    venue: "Halls 12 & 12A, Bharat Mandapam, New Delhi",
  },
  form = null,          // optional raw form object with extra fields (designation, mobile, etc)
  pdfBase64 = null,     // optional base64 PDF to attach
} = {}) {
  const frontend = frontendBase.replace(/\/$/, "");
  // Construct a reasonable upgrade URL when not provided
  const defaultUpgrade = `${frontend}/ticket-upgrade?entity=${encodeURIComponent(entity)}&id=${encodeURIComponent(String(id || ""))}&ticket_code=${encodeURIComponent(String(ticket_code || ""))}`;
  const upgradeLink = upgradeUrl && String(upgradeUrl).trim() ? upgradeUrl : defaultUpgrade;

  // Provide a sensible downloadUrl if not given and ticket_code exists
  if (!downloadUrl && ticket_code) {
    downloadUrl = `${frontend.replace(/\/$/, "")}/api/tickets/${encodeURIComponent(String(ticket_code))}/download`;
  }

  const manageUrl = `${frontend}/ticket?entity=${encodeURIComponent(entity)}&id=${encodeURIComponent(String(id))}`;
  const subject = `${event.name || "RailTrans Expo"} – Your Registration & E-Badge`;

  // Pull additional friendly fields from form if supplied
  const designation = (form && (form.designation || form.title || form.role)) || "";
  const mobile = (form && (form.mobile || form.phone || form.contact)) || "";

  // Plain-text alternative (include upgrade instruction for visitors)
  const textLines = [
    `Dear ${name || "Participant"},`,
    "",
    `Thank you for registering for ${event.name || "RailTrans Expo"}.`,
    "",
    `Your Registration Number: ${ticket_code || "N/A"}`,
    downloadUrl ? `Download your E-Badge: ${downloadUrl}` : `Manage your ticket: ${manageUrl}`,
    "",
    ...(designation ? [`Designation: ${designation}`, ""] : []),
    ...(mobile ? [`Mobile: ${mobile}`, ""] : []),
    (entity === "visitors") ? `To upgrade your visitor ticket, visit: ${upgradeLink}` : "",
    "Event Details",
    `Dates: ${event.dates || ""}`,
    `Time: ${event.time || ""}`,
    `Venue: ${event.venue || ""}`,
    "",
    "Important Information & Guidelines:",
    "- Entry permitted only through Gate No. 4 and Gate No. 10.",
    "- Please carry and present your E-badge (received via email/WhatsApp) for scanning at the entry point.",
    "- The badge is strictly non-transferable and must be worn visibly at all times within the venue.",
    "- Entry is permitted to individuals aged 18 years and above; infants are not permitted.",
    "- All participants must carry a valid Government-issued photo ID (Passport is mandatory for foreign nationals).",
    "",
    "We look forward to welcoming you at RailTrans Expo 2026.",
    "",
    "Warm regards,",
    "Team RailTrans Expo 2026",
  ].filter(Boolean);
  const text = textLines.join("\n");

  // HTML email (responsive, simple inline CSS)
  // The Upgrade button will only be rendered when entity === 'visitors'
  const html = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial; color: #1f2937; margin: 0; padding: 0; background:#f3f4f6; }
      .wrap { max-width: 680px; margin: 24px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 6px 18px rgba(9,30,66,0.08); }
      .container { padding: 20px; }
      .banner { width: 100%; height: auto; display:block; }
      h1 { font-size: 20px; margin: 6px 0 12px; color: #0b4f60; }
      p { margin: 6px 0; line-height: 1.45; color: #374151; }
      .card { background: #f8fafc; border-radius: 8px; padding: 14px; margin: 12px 0; text-align: center; border: 1px solid #e6eef4;}
      .badge-preview { max-width: 260px; width: 100%; height: auto; display:block; margin: 10px auto; border-radius: 6px; }
      .reg { font-weight:700; letter-spacing: 0.02em; margin-top: 6px; }
      .cta { display:inline-block; margin:10px 6px; padding:12px 18px; background:#c8102e; color:#ffffff; text-decoration:none; border-radius:6px; font-weight:700; }
      .cta.secondary { background:#196e87; color:#ffffff; }
      .muted { color:#475569; font-size:13px; }
      ul.guidelines { padding-left: 20px; margin: 8px 0 16px; color: #374151; }
      .footer { font-size: 13px; color: #475569; padding: 14px 0 28px; }
      .meta { color: #374151; font-size: 14px; margin-top: 6px; }
      .small { font-size: 12px; color: #6b7280; }
      .actions { margin-top: 12px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      ${bannerUrl ? `<img src="${bannerUrl}" alt="${event.name}" class="banner" />` : ""}
      <div class="container">
        <h1>${event.name || "RailTrans Expo"} — Your Registration E‑Badge</h1>

        <p>Dear ${name || "Participant"},</p>

        <p>Thank you for registering for <strong>${event.name}</strong> – ${event.dates || ""} at ${event.venue || ""}.</p>

        <div class="card">
          <div style="font-size:16px; font-weight:700">${name || ""}</div>
          ${company ? `<div style="margin-top:6px; color:#475569">${company}</div>` : ""}
          ${designation ? `<div class="meta">${designation}</div>` : ""}
          ${badgePreviewUrl ? `<img src="${badgePreviewUrl}" alt="E-badge preview" class="badge-preview" />` : ""}
          <div class="reg">Your Registration Number: <span style="color:#0b4f60">${ticket_code || "N/A"}</span></div>

          <div class="actions">
            ${downloadUrl ? `<a href="${downloadUrl}" class="cta">Download E‑Badge</a>` : `<a href="${manageUrl}" class="cta">View / Download E‑Badge</a>`}
            ${upgradeLink && entity === "visitors" ? `<a href="${upgradeLink}" class="cta secondary">Upgrade Ticket</a>` : ""}
          </div>

          ${(mobile || "") ? `<div class="small" style="margin-top:8px">Mobile: ${mobile}</div>` : ""}
        </div>

        <h2 style="font-size:16px; margin-top:8px; color:#0b4f60">Event Details</h2>
        <p class="muted">
          <strong>Dates:</strong> ${event.dates || ""}<br/>
          <strong>Time:</strong> ${event.time || ""}<br/>
          <strong>Venue:</strong> ${event.venue || ""}
        </p>

        <h3 style="font-size:15px; color:#0b4f60; margin-top:8px">Important Information & Guidelines</h3>
        <ul class="guidelines">
          <li>Entry permitted only through Gate No. 4 and Gate No. 10.</li>
          <li>Please carry and present your E-badge (received via email/WhatsApp) for scanning at the entry point. The badge is valid exclusively for RailTrans Expo 2026 and concurrent events on event days.</li>
          <li>The badge is strictly non-transferable and must be worn visibly at all times within the venue.</li>
          <li>Entry is permitted to individuals aged 18 years and above; infants are not permitted.</li>
          <li>All participants must carry a valid Government-issued photo ID (Passport is mandatory for foreign nationals).</li>
        </ul>

        <p>We look forward to welcoming you at RailTrans Expo 2026.</p>

        <p class="footer">
          Warm regards,<br/>
          Team RailTrans Expo 2026
        </p>
      </div>
    </div>
  </body>
</html>
`;

  // attachments array: include badge PDF if provided as base64
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