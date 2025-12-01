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
 * - DOES NOT print any PII or ticket code on the badge.
 * - Puts all details inside the QR only.
 * - Returns a Blob.
 *
 * options:
 * - includeQRCode: boolean
 * - qrPayload: object|string (if not provided, we’ll build from visitor)
 * - event: { name, date, venue } to embed in QR
 */
export async function generateVisitorBadgePDF(visitor = {}, badgeTemplateUrl = "", options = {}) {
  const { includeQRCode = true, qrPayload, event } = options;

  // A6 landscape
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a6" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // Background
  doc.setFillColor(245, 249, 252);
  doc.rect(0, 0, pageW, pageH, "F");

  // Try template (optional). If it fails (404/format), draw a simple header bar.
  let drewTemplate = false;
  try {
    if (badgeTemplateUrl) {
      const { dataURL } = await fetchImageAsDataURL(badgeTemplateUrl);
      addImageAuto(doc, dataURL, 0, 0, pageW, pageH);
      drewTemplate = true;
    }
  } catch {
    // ignore
  }
  if (!drewTemplate) {
    // Subtle header bar
    doc.setFillColor(25, 166, 231);
    doc.rect(0, 0, pageW, 24, "F");
  }

  // Heading
  doc.setTextColor(25, 128, 155);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("RailTrans Expo - Visitor E‑Badge", 20, 46);

  // Do NOT render PII, category, or ticket code here.
  // Only instruction text:
  doc.setTextColor(60);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text("Scan the QR at entry. Do not share this badge publicly.", 20, 70);

  // QR code area
  if (includeQRCode) {
    try {
      const payloadObj =
        typeof qrPayload === "object" && qrPayload !== null
          ? qrPayload
          : typeof qrPayload === "string" && qrPayload.trim()
            ? JSON.parse(qrPayload)
            : buildCompactPayload(visitor, event);

      // If qrPayload was string but not JSON, fall back to raw string
      const payloadString =
        typeof payloadObj === "object" ? JSON.stringify(payloadObj) : (qrPayload || "");

      const qrDataURL = await QRCode.toDataURL(payloadString || "{}", {
        margin: 1,
        scale: 6,
        errorCorrectionLevel: "M",
      });

      const qrSize = 140;
      const qrX = pageW - qrSize - 24;
      const qrY = pageH - qrSize - 30;
      addImageAuto(doc, qrDataURL, qrX, qrY, qrSize, qrSize);

      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.text("Scan at entry", qrX + 24, qrY + qrSize + 12);
    } catch {
      // Continue without QR if the generator fails
    }
  }

  // Footer hint
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text("Keep this badge safe. All details are encoded in the QR.", 20, pageH - 16);

  return doc.output("blob");
}