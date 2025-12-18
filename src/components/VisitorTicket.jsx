import React, { useCallback, useEffect, useRef, useState } from "react";

/**
 * VisitorTicket (QR-only preview, simplified)
 *
 * - QR encodes the ticket code ONLY (not a URL).
 * - Ticket code is NOT displayed as plain text anywhere on the badge or preview.
 * - Removed "Fetch server ticket code" and "Copy payload" buttons.
 * - Always shows the QR area in the preview; if no ticket code is available a "QR not available" placeholder is shown.
 * - Print button opens a new window that contains only the badge (badge-only print).
 *
 * Props:
 * - visitor: { id, name, designation, company, ticket_category, ticket_code, email, mobile, logoUrl, eventName, bannerUrl, sponsorLogos }
 * - pdfBlob: Blob | string (data url or base64) (optional)
 * - roleLabel, accentColor, showQRCode, qrSize, className
 */

function base64ToBlob(base64, contentType = "application/pdf") {
  try {
    const b64 = base64.indexOf("base64,") >= 0 ? base64.split("base64,")[1] : base64;
    const byteChars = atob(b64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteNumbers[i] = byteChars.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: contentType });
  } catch (e) {
    return null;
  }
}

export default function VisitorTicket({
  visitor,
  pdfBlob,
  roleLabel,
  accentColor = "#c8102e",
  showQRCode = true,
  qrSize = 220,
  className = "",
}) {
  const [downloadUrl, setDownloadUrl] = useState(null);
  const downloadUrlRef = useRef(null);
  const cardRef = useRef(null);

  const [localTicketCode, setLocalTicketCode] = useState(
    visitor ? (visitor.ticket_code || visitor.ticketCode || visitor.ticketId || "") : ""
  );

  // prepare object URL for pdfBlob
  useEffect(() => {
    if (!pdfBlob) {
      if (downloadUrlRef.current) {
        try { URL.revokeObjectURL(downloadUrlRef.current); } catch {}
        downloadUrlRef.current = null;
      }
      setDownloadUrl(null);
      return;
    }

    if (typeof pdfBlob === "string") {
      if (pdfBlob.startsWith("data:")) {
        setDownloadUrl(pdfBlob);
        downloadUrlRef.current = null;
        return;
      }
      const b = base64ToBlob(pdfBlob, "application/pdf");
      if (b) {
        const url = URL.createObjectURL(b);
        setDownloadUrl(url);
        downloadUrlRef.current = url;
        return;
      }
      setDownloadUrl(null);
      return;
    }

    if (pdfBlob instanceof Blob) {
      const url = URL.createObjectURL(pdfBlob);
      setDownloadUrl(url);
      downloadUrlRef.current = url;
      return;
    }

    setDownloadUrl(null);
    return () => {
      if (downloadUrlRef.current) {
        try { URL.revokeObjectURL(downloadUrlRef.current); } catch {}
        downloadUrlRef.current = null;
      }
    };
  }, [pdfBlob]);

  useEffect(() => {
    return () => {
      if (downloadUrlRef.current) {
        try { URL.revokeObjectURL(downloadUrlRef.current); } catch {}
        downloadUrlRef.current = null;
      }
    };
  }, []);

  // keep localTicketCode in sync when visitor prop changes
  useEffect(() => {
    if (!visitor) {
      setLocalTicketCode("");
      return;
    }
    const canonical = visitor.ticket_code || visitor.ticketCode || visitor.ticketId || "";
    setLocalTicketCode(canonical ? String(canonical).trim() : "");
  }, [visitor]);

  // stable derived values
  const v = visitor || {};
  const name = v.name || v.full_name || v.title || "";
  const company = v.company || v.organization || "";
  const ticketCategory = (v.ticket_category || v.category || roleLabel || "VISITOR").toString().toUpperCase();
  const providedTicketCode = v.ticket_code || v.ticketCode || v.ticketId || "";
  const safeTicketCode = localTicketCode ? String(localTicketCode).trim() : (providedTicketCode ? String(providedTicketCode).trim() : "");
  // QR must contain only the ticket code
  const qrData = safeTicketCode || "";
  const qrUrl = qrData
    ? `https://chart.googleapis.com/chart?cht=qr&chs=${qrSize}x${qrSize}&chl=${encodeURIComponent(qrData)}&choe=UTF-8`
    : null;

  const handleDownload = useCallback(() => {
    if (!downloadUrl) return;
    const a = document.createElement("a");
    const filenameSafe = (name || "ticket").replace(/\s+/g, "_");
    a.href = downloadUrl;
    a.download = `RailTransExpo-${filenameSafe}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [downloadUrl, name]);

  // Print badge-only: open a window that contains only the badge card HTML and print it
  const handlePrintCard = useCallback(() => {
    if (!cardRef.current) {
      window.print();
      return;
    }
    const cardHtml = cardRef.current.outerHTML;
    const win = window.open("", "_blank", "noopener,noreferrer");
    if (!win) {
      window.print();
      return;
    }
    const style = `
      <style>
        @media print {
          body { margin: 0; -webkit-print-color-adjust: exact; }
          .ticket-wrapper { width: 100%; display: flex; align-items: center; justify-content: center; }
        }
        body { margin: 0; font-family: Helvetica, Arial, sans-serif; background: #f3f4f6; }
        .ticket-wrapper { padding: 24px; display:flex; align-items:center; justify-content:center; min-height:100vh; box-sizing: border-box; }
        .badge-card { box-shadow: none; background: transparent; }
      </style>
    `;
    win.document.write(`<!doctype html><html><head><meta charset="utf-8">${style}</head><body><div class="ticket-wrapper">${cardHtml}</div></body></html>`);
    win.document.close();
    win.onload = () => {
      try {
        win.focus();
        win.print();
        setTimeout(() => { try { win.close(); } catch {} }, 500);
      } catch (e) {
        console.warn("Print failed", e);
      }
    };
  }, []);

  if (!visitor) return null;

  // Render badge layout designed to resemble provided images.
  return (
    <div ref={cardRef} className={`mx-auto max-w-[860px] bg-transparent ${className}`}>
      {/* Top banner */}
      <div style={{ background: "#eedfbf", borderTopLeftRadius: 8, borderTopRightRadius: 8 }}>
        {v.bannerUrl ? (
          <img src={v.bannerUrl} alt="Event banner" style={{ width: "100%", display: "block", borderTopLeftRadius: 8, borderTopRightRadius: 8 }} />
        ) : (
          <div style={{ padding: 18, textAlign: "center", fontWeight: 700, color: "#8b5e34" }}>{v.eventName || "RailTrans Expo 2026"}</div>
        )}
      </div>

      {/* Background area with light blue gradient */}
      <div style={{ background: "linear-gradient(#e8f8fb, #ffffff)", padding: "28px 28px 0", borderLeft: "1px solid rgba(0,0,0,0.03)", borderRight: "1px solid rgba(0,0,0,0.03)" }}>
        {/* central white card */}
        <div className="badge-card" style={{
          maxWidth: 520,
          margin: "0 auto",
          background: "#fff",
          borderRadius: 12,
          padding: "34px 28px",
          boxShadow: "0 6px 18px rgba(9,30,66,0.08)",
          border: "1px solid rgba(2,6,23,0.06)",
          textAlign: "center"
        }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#0b1820", marginBottom: 6 }}>{name || " "}</div>
          {company ? <div style={{ fontSize: 18, color: "#111827", marginBottom: 18 }}>{company}</div> : null}

          {/* QR only — ticket code is NOT displayed as text */}
          {showQRCode ? (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", margin: "12px 0 8px" }}>
              {qrUrl ? (
                <img src={qrUrl} alt="QR code" width={qrSize} height={qrSize} style={{ borderRadius: 8 }} />
              ) : (
                <div style={{
                  width: qrSize,
                  height: qrSize,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#f1f5f9",
                  color: "#9ca3af",
                  borderRadius: 8,
                  fontSize: 12,
                  textAlign: "center",
                  padding: 8
                }}>
                  QR not available
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* sponsors / logos strip (placeholder) */}
        <div style={{ marginTop: 22, display: "flex", justifyContent: "center", gap: 18, alignItems: "center", paddingBottom: 8 }}>
          {v.sponsorLogos && Array.isArray(v.sponsorLogos) && v.sponsorLogos.length ? (
            v.sponsorLogos.slice(0, 3).map((src, i) => (
              <img key={i} src={src} alt={`sponsor-${i}`} style={{ height: 48, objectFit: "contain", borderRadius: 6, background: "#fff", padding: 6, boxShadow: "0 2px 6px rgba(0,0,0,0.04)" }} />
            ))
          ) : (
            <>
              <div style={{ width: 120, height: 48, background: "rgba(255,255,255,0.6)", borderRadius: 8 }} />
              <div style={{ width: 120, height: 48, background: "rgba(255,255,255,0.6)", borderRadius: 8 }} />
              <div style={{ width: 120, height: 48, background: "rgba(255,255,255,0.6)", borderRadius: 8 }} />
            </>
          )}
        </div>
      </div>

      {/* bottom colored bar with role label */}
      <div style={{ background: accentColor, padding: "26px 0", borderBottomLeftRadius: 8, borderBottomRightRadius: 8 }}>
        <div style={{ textAlign: "center", color: "#ffffff", fontSize: 48, fontWeight: 900, letterSpacing: "0.06em" }}>
          {ticketCategory || "VISITOR"}
        </div>
      </div>

      {/* action buttons */}
      <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 12 }}>
        {downloadUrl ? (
          <button onClick={handleDownload} style={{ padding: "12px 20px", background: "#0b556b", color: "#fff", borderRadius: 8, border: "none", fontWeight: 700 }}>Download E‑Badge PDF</button>
        ) : (
          <div style={{ color: "#6b7280", alignSelf: "center" }}>E‑Badge will be emailed</div>
        )}
        <button onClick={handlePrintCard} style={{ padding: "12px 20px", background: "#fff", color: "#0b556b", borderRadius: 8, border: "1px solid rgba(2,6,23,0.08)", fontWeight: 700 }}>Print Card</button>
      </div>
    </div>
  );
}