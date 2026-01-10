import { jsPDF } from "jspdf";
import QRCode from "qrcode";

/* ---------------- ROLE + COLOR RULES (CLIENT LOCKED) ---------------- */

function resolveBadgeRole(visitor = {}) {
  const cat = String(
    visitor.ticket_category ||
    visitor.category ||
    visitor.role ||
    ""
  ).toLowerCase();

  if (cat.includes("speaker")) return "SPEAKER";
  if (cat.includes("award")) return "AWARDEE";
  if (cat.includes("exhibitor")) return "EXHIBITOR";
  if (cat.includes("partner")) return "EXHIBITOR";
  if (cat.includes("organizer")) return "ORGANIZER";

  const isPaid =
    Number(visitor.amount || visitor.price || visitor.ticket_total || 0) > 0 ||
    /delegate|paid|vip/i.test(cat);

  return isPaid ? "DELEGATE" : "VISITOR";
}

function resolveRibbonColor(role) {
  switch (role) {
    case "VISITOR":
      return [30, 78, 216];      // Blue
    case "AWARDEE":
      return [184, 134, 11];     // Dark Golden
    default:
      return [200, 16, 46];      // Red
  }
}

/* ---------------- QR PAYLOAD ---------------- */

function buildQrPayload(visitor = {}) {
  return {
    v: 1,
    ticket_code: visitor.ticket_code || "",
    name: visitor.name || "",
    email: visitor.email || "",
    phone: visitor.mobile || visitor.phone || "",
    company: visitor.company || "",
    category: visitor.ticket_category || "",
    issuedAt: Date.now(),
  };
}

/* ---------------- MAIN PDF GENERATOR ---------------- */

export async function generateVisitorBadgePDF(visitor = {}) {
  const role = resolveBadgeRole(visitor);
  const [r, g, b] = resolveRibbonColor(role);

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  /* Background */
  doc.setFillColor(245, 249, 252);
  doc.rect(0, 0, pageW, pageH, "F");

  /* Header */
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(15, 23, 42);
  doc.text("RailTrans Expo 2026", pageW / 2, 60, { align: "center" });

  /* Card */
  const cardW = 520;
  const cardH = 520;
  const cardX = (pageW - cardW) / 2;
  const cardY = 110;

  doc.setFillColor(255, 255, 255);
  doc.roundedRect(cardX, cardY, cardW, cardH, 14, 14, "F");

  /* Name */
  doc.setFontSize(24);
  doc.setTextColor(17, 24, 39);
  doc.text(visitor.name || "", pageW / 2, cardY + 50, { align: "center" });

  /* Company */
  doc.setFontSize(14);
  doc.setTextColor(75);
  doc.text(visitor.company || "", pageW / 2, cardY + 78, { align: "center" });

  /* QR */
  const qrData = JSON.stringify(buildQrPayload(visitor));
  const qrSize = 280;
  const qrX = (pageW - qrSize) / 2;
  const qrY = cardY + 120;

  const qrUrl = await QRCode.toDataURL(qrData, {
    errorCorrectionLevel: "M",
    margin: 1,
    scale: 8,
  });

  doc.addImage(qrUrl, "PNG", qrX, qrY, qrSize, qrSize);

  /* Ticket Code */
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(
    visitor.ticket_code || "",
    pageW / 2,
    qrY + qrSize + 30,
    { align: "center" }
  );

  /* Bottom Ribbon */
  const ribbonH = 90;
  const ribbonY = pageH - ribbonH - 30;

  doc.setFillColor(r, g, b);
  doc.rect(0, ribbonY, pageW, ribbonH, "F");

  doc.setFontSize(56);
  doc.setTextColor(255, 255, 255);
  doc.text(role, pageW / 2, ribbonY + 62, { align: "center" });

  return doc.output("blob");
}
