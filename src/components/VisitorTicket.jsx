import React, { useCallback, useEffect, useRef, useState } from "react";

/**
 * VisitorTicket (fixed)
 *
 * Changes made:
 * - Prefer a server-side canonical ticket_code when available (visitor.ticket_code).
 * - Keep a localTicketCode state so the component can be updated if a server-side value is fetched.
 * - If ticket_code is missing or looks different from the UI/pdf, the operator can fetch the canonical value
 *   from the backend using visitor.id (tries /api/visitors/:id then /api/speakers/:id).
 * - QR generation uses the canonical/localTicketCode.
 * - All hooks run unconditionally; URL object cleanup implemented.
 *
 * Props:
 * - visitor: { id, name, designation, company, ticket_category, ticket_code, email, mobile, logoUrl, eventName }
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
  accentColor = "#e54b4b",
  showQRCode = true,
  qrSize = 140,
  className = "",
}) {
  // Hooks must run unconditionally
  const [downloadUrl, setDownloadUrl] = useState(null);
  const downloadUrlRef = useRef(null);
  const cardRef = useRef(null);

  // Local ticket code state (canonical server value preferred)
  const [localTicketCode, setLocalTicketCode] = useState(
    visitor ? (visitor.ticket_code || visitor.ticketCode || visitor.ticketId || "") : ""
  );
  const [fetchingServerCode, setFetchingServerCode] = useState(false);
  const [fetchError, setFetchError] = useState("");

  // Prepare object URL / data URL for pdfBlob (unconditional)
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

  // cleanup on unmount
  useEffect(() => {
    return () => {
      if (downloadUrlRef.current) {
        try { URL.revokeObjectURL(downloadUrlRef.current); } catch {}
        downloadUrlRef.current = null;
      }
    };
  }, []);

  // Keep localTicketCode in sync when visitor prop changes
  useEffect(() => {
    if (!visitor) {
      setLocalTicketCode("");
      return;
    }
    const canonical = visitor.ticket_code || visitor.ticketCode || visitor.ticketId || "";
    setLocalTicketCode(canonical ? String(canonical).trim() : "");
  }, [visitor]);

  // Derive safe values even if visitor is not provided (so hooks/deps are stable)
  const v = visitor || {};
  const name = v.name || v.full_name || v.title || "";
  const designation = v.designation || v.role || "";
  const company = v.company || v.organization || "";
  const ticketCategory = v.ticket_category || v.category || roleLabel || "";
  const providedTicketCode = v.ticket_code || v.ticketCode || v.ticketId || "";
  const safeTicketCode = localTicketCode ? String(localTicketCode).trim() : (providedTicketCode ? String(providedTicketCode).trim() : "");
  const qrUrl = safeTicketCode
    ? `https://chart.googleapis.com/chart?cht=qr&chs=${qrSize}x${qrSize}&chl=${encodeURIComponent(safeTicketCode)}&choe=UTF-8`
    : null;

  // Handlers (defined unconditionally)
  const handleDownload = useCallback(() => {
    if (!downloadUrl) return;
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = `RailTransExpo-${(safeTicketCode || name || "ticket").replace(/\s+/g, "_")}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [downloadUrl, safeTicketCode, name]);

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
        body { margin: 0; font-family: Helvetica, Arial, sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; }
        .ticket-wrapper { padding: 20px; }
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

  // Fetch canonical ticket_code from server for this visitor/speaker (tries visitors then speakers)
  const fetchCanonicalTicketCode = useCallback(async () => {
    setFetchError("");
    setFetchingServerCode(true);
    try {
      if (!v || !v.id) {
        setFetchError("No visitor id available to fetch server ticket.");
        setFetchingServerCode(false);
        return;
      }

      // Try visitors endpoint first
      let res = await fetch(`/api/visitors/${encodeURIComponent(String(v.id))}`);
      if (!res.ok) {
        // Try speakers
        res = await fetch(`/api/speakers/${encodeURIComponent(String(v.id))}`);
      }
      if (!res.ok) {
        setFetchError(`Server responded ${res.status} when fetching id ${v.id}`);
        setFetchingServerCode(false);
        return;
      }
      const js = await res.json().catch(() => null);
      if (!js) {
        setFetchError("Empty JSON from server");
        setFetchingServerCode(false);
        return;
      }

      // The API returns a row object; try common keys
      const ticketFromServer = (js.ticket_code || js.ticketCode || js.ticketId || (js.updated && js.updated.ticket_code) || (js[0] && js[0].ticket_code)) || null;
      // Some endpoints return { success: true, updated: { ... } }
      const maybeUpdated = js.updated || js;
      const candidate = ticketFromServer || (maybeUpdated && (maybeUpdated.ticket_code || maybeUpdated.ticketCode || maybeUpdated.ticketId)) || null;

      if (candidate) {
        const canonical = String(candidate).trim();
        setLocalTicketCode(canonical);
        setFetchError("");
      } else {
        setFetchError("Server did not return ticket_code for this id");
      }
    } catch (e) {
      console.error("fetchCanonicalTicketCode error", e);
      setFetchError(String(e && e.message ? e.message : e));
    } finally {
      setFetchingServerCode(false);
    }
  }, [v]);

  // Early return if no visitor (after hooks are set)
  if (!visitor) return null;

  // Render
  return (
    <div ref={cardRef} className={`bg-white rounded-xl shadow-xl max-w-sm mx-auto mt-6 text-[#196e87] ${className}`} style={{ fontFamily: "Helvetica, Arial, sans-serif" }}>
      <div className="p-6">
        {v.logoUrl ? (
          <div className="flex justify-center mb-4">
            <img src={v.logoUrl} alt="Event logo" className="h-16 object-contain" />
          </div>
        ) : (
          <div className="text-center mb-3">
            <div style={{ color: "#196e87", fontWeight: 700 }}>{v.eventName || ""}</div>
          </div>
        )}

        <div className="text-center px-2">
          <div className="text-2xl font-extrabold text-[#0b556b] leading-tight mb-2" style={{ letterSpacing: "0.02em" }}>
            {name || " "}
          </div>

          {company ? <div className="text-sm text-gray-700 font-semibold mb-1">{company}</div> : null}
          {designation ? <div className="text-sm text-gray-500 mb-3">{designation}</div> : null}

          <div className="flex items-center justify-center gap-4 mt-3">
            {showQRCode && qrUrl ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <img src={qrUrl} width={qrSize} height={qrSize} style={{ borderRadius: 6 }} aria-hidden="true" />
            ) : null}
          </div>
        </div>

        {safeTicketCode ? (
          <div className="mt-4 text-center">
            <div className="text-xs text-gray-400">Ticket Code</div>
            <div className="text-sm font-mono text-gray-700">{safeTicketCode}</div>
            {providedTicketCode && providedTicketCode !== safeTicketCode ? (
              <div className="text-xs text-yellow-700 mt-1">Note: displayed code was refreshed from server; previous value differs.</div>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 text-center">
            <div className="text-sm text-red-600">No ticket code available</div>
            <div className="mt-2 flex items-center justify-center gap-2">
              <button
                onClick={fetchCanonicalTicketCode}
                className="px-3 py-1 bg-[#196e87] text-white rounded"
                disabled={fetchingServerCode}
              >
                {fetchingServerCode ? "Fetching…" : "Fetch server ticket code"}
              </button>
              <button
                onClick={() => { navigator.clipboard && navigator.clipboard.writeText(JSON.stringify(v).slice(0,2000)); }}
                className="px-3 py-1 bg-gray-100 rounded"
              >
                Copy payload
              </button>
            </div>
            {fetchError && <div className="text-xs text-red-600 mt-2">{fetchError}</div>}
          </div>
        )}

        <div className="mt-5 flex flex-col items-center gap-3">
          {downloadUrl ? (
            <button onClick={handleDownload} className="bg-[#196e87] text-white font-bold px-6 py-2 rounded-full" aria-label="Download E Badge PDF">
              Download E‑Badge PDF
            </button>
          ) : (
            <div className="text-sm text-gray-500">E‑Badge will be emailed to you.</div>
          )}

          <button onClick={handlePrintCard} className="px-5 py-2 border rounded-full text-[#196e87] bg-white" type="button" aria-label="Print Ticket">
            Print Card
          </button>
        </div>
      </div>

      <div style={{ background: accentColor }} className="w-full rounded-b-xl py-3 text-center">
        <div className="text-white font-bold" style={{ letterSpacing: "0.06em" }}>
          {(ticketCategory || "DELEGATE").toString().toUpperCase()}
        </div>
      </div>
    </div>
  );
}