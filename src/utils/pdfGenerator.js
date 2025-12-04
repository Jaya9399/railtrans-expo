import { jsPDF } from "jspdf";
import QRCode from "qrcode";

/**
 * Load a remote image URL into a data URL and return { dataURL, mime }
 * Throws on 404; caller can catch and continue without a template.
 */
async function fetchImageAsDataURL(url) {
  if (!url) throw new Error("No template URL provided");
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Template fetch failed: ${res.status} ${res.statusText}`);
  }
  const blob = await res.blob();
  const dataURL = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return { dataURL, mime: blob.type || "" };
}

/**
 * Infer jsPDF image format string from a data URL/mime.
 */
function resolveFormatFromDataURL(dataURLOrMime) {
  const mime =
    typeof dataURLOrMime === "string"
      ? dataURLOrMime.match(/^data:(.*?);base64,/)?.[1] || dataURLOrMime
      : "";
  if (/png/i.test(mime)) return "PNG";
  if (/jpe?g/i.test(mime)) return "JPEG";
  if (/webp/i.test(mime)) return "WEBP";
  // Fallback
  return "JPEG";
}

/**
 * Add image safely with auto-detected format.
 */
function addImageAuto(doc, dataURL, x, y, w, h) {
  const fmt = resolveFormatFromDataURL(dataURL);
  doc.addImage(dataURL, fmt, x, y, w, h);
}

/**
 * Build a compact QR payload from visitor and optional event details.
 * Uses short keys to keep QR density low:
 * v=version, t=type, n=name, e=email, ph=phone, org=organization, des=designation,
 * cat=category, c=ticketCode, tx=transactionId, sl=slots, ev=event{n,d,v}, iat=issuedAt
 */
function buildCompactPayload(visitor = {}, event = {}) {
  const p = {
    v: 1,
    t: "visitor",
    n: visitor.name || "",
    e: visitor.email || "",
    ph: visitor.mobile || visitor.phone || visitor.contact || visitor?.form?.mobile || "",
    org: visitor.organization || visitor.company || "",
    des: visitor.designation || "",
    cat: visitor.ticket_category || "",
    c: visitor.ticket_code || "",
    tx: visitor.txId || visitor.tx || "",
    sl: Array.isArray(visitor.slots) ? visitor.slots : [],
    ev: {
      n: event?.name || "",
      d: event?.date || "",
      v: event?.venue || "",
    },
    iat: Date.now(),
  };
  return p;
}

/**
 * Generate a visitor badge PDF.
 * - Accepts PNG/JPEG/WEBP template (optional).
 * - QR encodes full compact payload including ticket_code + user details.
 * - Renders a centered white rounded card with name/company, large centered QR,
 *   ticket_code printed below the QR, and a large bottom role bar (e.g. VISITOR).
 * - Returns a Blob (application/pdf).
 *
 * options:
 * - includeQRCode: boolean
 * - qrPayload: object|string (if not provided, we’ll build from visitor)
 * - event: { name, date, venue } to embed in QR
 * - pageFormat: jsPDF format (default: 'a4' portrait) - changeable for different sizes
 */
export async function generateVisitorBadgePDF(visitor = {}, badgeTemplateUrl = "", options = {}) {
  const { includeQRCode = true, qrPayload, event = {}, pageFormat = "a4" } = options;

  // Use portrait A4 by default which better matches the provided sample image
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: pageFormat });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // Background fill (soft)
  doc.setFillColor(245, 249, 252);
  doc.rect(0, 0, pageW, pageH, "F");

  // Try template (optional). If it fails (404/format), continue with drawn header/imagery.
  let drewTemplate = false;
  try {
    if (badgeTemplateUrl) {
      const { dataURL } = await fetchImageAsDataURL(badgeTemplateUrl);
      addImageAuto(doc, dataURL, 0, 0, pageW, pageH);
      drewTemplate = true;
    }
  } catch {
    // ignore template errors and continue
  }

  // If no template, draw a top banner (simple approximation)
  if (!drewTemplate) {
    // top banner background
    doc.setFillColor(242, 214, 137); // light cream
    doc.rect(0, 0, pageW, 110, "F");

    // event title in the banner
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(12, 60, 66);
    doc.text((event.name || visitor.eventName || "RailTrans Expo 2026").toString(), 28, 60);
    // date chips on right (approx)
    doc.setFontSize(12);
    doc.setTextColor(255, 255, 255);
    doc.setFillColor(200, 91, 20);
    doc.roundedRect(pageW - 140, 30, 52, 28, 6, 6, "F");
    doc.roundedRect(pageW - 80, 30, 52, 28, 6, 6, "F");
    doc.setTextColor(255, 255, 255);
    doc.text((event.date || "").toString().slice(0, 12), pageW - 120, 50);
  }

  // Central white rounded card dimensions (centered)
  const cardW = Math.min(520, pageW - 120);
  const cardH = Math.min(520, pageH - 260);
  const cardX = (pageW - cardW) / 2;
  const cardY = 140; // leave space below top banner

  // Card background (white rounded rectangle)
  doc.setFillColor(255, 255, 255);
  // use roundedRect (x, y, w, h, rx, ry, style)
  if (typeof doc.roundedRect === "function") {
    doc.roundedRect(cardX, cardY, cardW, cardH, 12, 12, "F");
  } else {
    // fallback: plain rect
    doc.rect(cardX, cardY, cardW, cardH, "F");
  }

  // Card inner padding and text positions
  const innerPad = 28;
  const contentX = cardX + innerPad;
  const contentW = cardW - innerPad * 2;

  // Name (big, bold) centered
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(11, 24, 32);
  const nameText = (visitor.name || "").toString();
  if (nameText) {
    // center name
    const nameY = cardY + 44;
    doc.text(nameText, cardX + cardW / 2, nameY, { align: "center" });
  }

  // Company / designation below name (lighter)
  const companyText = (visitor.company || visitor.organization || "").toString();
  const designationText = (visitor.designation || "").toString();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(14);
  doc.setTextColor(60);
  const subY = cardY + 72;
  let subLine = "";
  if (companyText && designationText) subLine = `${designationText} • ${companyText}`;
  else subLine = companyText || designationText || "";
  if (subLine) {
    doc.text(subLine, cardX + cardW / 2, subY, { align: "center" });
  }

  // Build QR payload and render QR centered within the card.
  let qrDataString = "";
  try {
    const payloadObj =
      typeof qrPayload === "object" && qrPayload !== null
        ? qrPayload
        : typeof qrPayload === "string" && qrPayload.trim()
        ? JSON.parse(qrPayload)
        : buildCompactPayload(visitor, event);

    qrDataString = typeof payloadObj === "object" ? JSON.stringify(payloadObj) : String(payloadObj || "");
  } catch (e) {
    // fallback to compact build
    qrDataString = JSON.stringify(buildCompactPayload(visitor, event));
  }

  if (includeQRCode && qrDataString) {
    try {
      // Choose QR size relative to the card
      const qrSize = Math.min(300, contentW, cardH * 0.55);
      const qrDataURL = await QRCode.toDataURL(qrDataString, {
        margin: 1,
        scale: 8,
        errorCorrectionLevel: "M",
      });

      // center QR horizontally and vertically in the card content area
      const qrX = cardX + (cardW - qrSize) / 2;
      // position QR slightly above center to leave space for ticket code underneath
      const qrY = cardY + (cardH - qrSize) / 2 - 12;

      addImageAuto(doc, qrDataURL, qrX, qrY, qrSize, qrSize);

      // Small caption below QR
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text("Scan at entry", cardX + cardW / 2, qrY + qrSize + 18, { align: "center" });
    } catch (e) {
      // ignore QR generation errors
    }
  }

  // Ticket code printed below QR in bold (visible, required per request)
  const ticketCode = (visitor.ticket_code || visitor.ticketCode || visitor.ticketId || "").toString();
  if (ticketCode) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(17, 24, 28);
    const ticketY = cardY + cardH - 48; // a bit above card bottom
    doc.text(ticketCode, cardX + cardW / 2, ticketY, { align: "center" });
  }

  // Sponsors / logos strip (optional) - just leave space or draw if provided
  if (Array.isArray(visitor.sponsorLogos) && visitor.sponsorLogos.length) {
    const logos = visitor.sponsorLogos.slice(0, 3);
    const logoW = Math.min(120, (cardW - 40) / logos.length);
    const logoH = 36;
    const logosY = cardY + cardH + 12;
    logos.forEach((src, i) => {
      try {
        // fetch and draw inline images synchronously isn't ideal; skip if template used.
      } catch {}
    });
  }

  // Bottom colored role bar (large)
  const roleBarH = 88;
  const roleBarY = pageH - roleBarH - 24;
  const accent = (visitor.accentColor || options.accentColor || "#355a2b").toString();
  // convert hex to RGB for setFillColor
  let r = 53, g = 90, b = 43;
  try {
    if (/^#?[0-9a-f]{6}$/i.test(accent.replace("#", ""))) {
      const c = accent.replace("#", "");
      r = parseInt(c.slice(0, 2), 16);
      g = parseInt(c.slice(2, 4), 16);
      b = parseInt(c.slice(4, 6), 16);
    }
  } catch {}
  doc.setFillColor(r, g, b);
  doc.rect(0, roleBarY, pageW, roleBarH, "F");

  // Role label large and centered
  doc.setFont("helvetica", "bold");
  doc.setFontSize(56);
  doc.setTextColor(255, 255, 255);
  const roleLabelText = (visitor.ticket_category || visitor.category || options.roleLabel || "VISITOR").toString().toUpperCase();
  doc.text(roleLabelText, pageW / 2, roleBarY + roleBarH / 2 + 18, { align: "center" });

  // Footer hint small
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text("Keep this badge safe. All required details are encoded in the QR.", 20, pageH - 12);

  return doc.output("blob");
}