export async function sendTicketEmailUsingTemplate_debug({ visitor, pdfBlob, badgePreviewUrl, bannerUrl, badgeTemplateUrl }) {
  // build model exactly as your app does
  const frontendBase = window.__FRONTEND_BASE__ || window.location.origin || "https://railtransexpo.com";
  const emailModel = {
    frontendBase,
    entity: "visitors",
    id: visitor?.id || visitor?.visitorId || "",
    name: visitor?.name || "",
    company: visitor?.company || "",
    ticket_code: visitor?.ticket_code || "",
    ticket_category: visitor?.ticket_category || "",
    bannerUrl: bannerUrl || "",
    badgePreviewUrl: badgePreviewUrl || "",
    downloadUrl: "",
    event: (visitor && visitor.eventDetails) || {},
  };

  // assume buildTicketEmail returns { subject, text, html }
  const { subject, text, html } = buildTicketEmail(emailModel);

  const mailPayload = {
    to: visitor.email,
    subject,
    text,
    html,
    attachments: [],
  };

  if (pdfBlob) {
    const b64 = await toBase64(pdfBlob);
    if (b64) mailPayload.attachments.push({
      filename: "E-Badge.pdf",
      content: b64,
      encoding: "base64",
      contentType: "application/pdf",
    });
  }

  // DEBUG: log everything before sending
  console.group("[DEBUG email payload]");
  console.log("emailModel:", emailModel);
  console.log("built email subject:", subject);
  console.log("built email text (first 200 chars):", (text || "").slice(0, 200));
  console.log("built email html (first 200 chars):", (html || "").slice(0, 200));
  console.log("mailPayload.to:", mailPayload.to);
  console.log("attachments:", mailPayload.attachments && mailPayload.attachments.length);
  console.groupEnd();

  const r = await fetch(`${API_BASE}/api/mailer`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
    body: JSON.stringify(mailPayload),
  });

  let js = null;
  try { js = await r.json(); } catch (e) { console.warn("mailer response parse failed", e); }
  if (!r.ok) {
    console.error("Mailer endpoint returned error:", r.status, js);
    throw new Error((js && (js.error || js.message)) || `Mailer failed (${r.status})`);
  }
  console.log("Mailer endpoint success:", js);
  return js;
}