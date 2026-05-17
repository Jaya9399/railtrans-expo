import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import jsQR from "jsqr";

const API_BASE =
  (typeof process !== "undefined" &&
    process.env &&
    process.env.REACT_APP_API_BASE) ||
  (typeof window !== "undefined" &&
    (window.__API_BASE__ || window.__BACKEND_ORIGIN__ || null)) ||
  (typeof window !== "undefined" &&
    window.location &&
    window.location.origin) ||
  "";

function apiUrl(path) {
  if (!path) path = "";
  const s = String(path).trim();
  if (!s) return s;
  if (/^https?:\/\//i.test(s)) return s;
  const base = String(API_BASE).replace(/\/$/, "");
  return `${base}${s.startsWith("/") ? s : `/${s}`}`;
}

function extractTicketIdFromObject(obj) {
  if (!obj || typeof obj !== "object") return null;
  const priorityKeys = ["ticket_code", "ticketCode", "code", "ticketId", "ticket_id", "id"];
  for (const k of priorityKeys) {
    if (obj[k] !== undefined && obj[k] !== null) {
      const val = String(obj[k]).trim();
      if (val) return val;
    }
  }
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === "object") {
      const found = extractTicketIdFromObject(v);
      if (found) return found;
    }
  }
  return null;
}

function extractTicketId(input) {
  if (!input) return null;
  const s = String(input).trim();
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === "object") {
      const fromObj = extractTicketIdFromObject(parsed);
      if (fromObj) return fromObj;
    }
  } catch (_) {}
  const numericMatch = s.match(/\b\d{6,8}\b/);
  if (numericMatch) return numericMatch[0];
  const alnumMatch = s.match(/[A-Za-z0-9]{6,12}/);
  return alnumMatch ? alnumMatch[0] : null;
}

function extractNameAndOrganization(ticket) {
  if (!ticket || typeof ticket !== "object") return { name: "", organization: "" };
  const nameFields = ["name", "full_name", "fullName", "visitor_name", "attendee_name", "n"];
  let name = "";
  for (const field of nameFields) {
    if (ticket[field]) { name = String(ticket[field]).trim(); if (name) break; }
  }
  const orgFields = ["company", "organization", "org", "company_name", "companyName", "employer", "affiliation"];
  let organization = "";
  for (const field of orgFields) {
    if (ticket[field]) { organization = String(ticket[field]).trim(); if (organization) break; }
  }
  if (!name && ticket.data && typeof ticket.data === "object") {
    name = ticket.data.name || ticket.data.full_name || "";
    organization = ticket.data.company || ticket.data.organization || "";
  }
  return { name: name || "Guest", organization: organization || "Visitor" };
}

function normalizeStickerText(v) {
  try { return String(v ?? "").replace(/\s+/g, " ").trim() || ""; }
  catch { return ""; }
}

function printSticker({ name, organization, page = { w: "80mm", h: "50mm" } }) {
  const printWin = window.open("", "_blank", "width=600,height=400");
  if (!printWin) { alert("Please allow popups to print stickers"); return false; }
  const safeName = normalizeStickerText(name) || "Guest";
  const safeOrg = normalizeStickerText(organization) || "Visitor";
  const style = `<style>
    @page{size:${page.w} ${page.h};margin:0}
    @media print{body{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}.sticker{box-shadow:none!important;border:1px solid #ccc}}
    *{margin:0;padding:0;box-sizing:border-box}html,body{height:100%;background:#fff}
    body{display:flex;align-items:center;justify-content:center;font-family:Arial,Helvetica,sans-serif}
    .sticker-wrap{width:${page.w};height:${page.h};display:flex;align-items:stretch;justify-content:stretch}
    .sticker{width:100%;height:100%;padding:8mm 6mm;display:flex;flex-direction:column;justify-content:center;background:#fff;border:2px solid #1B3A8A;border-radius:4px}
    .name{font-size:20pt;font-weight:800;line-height:1.2;color:#1B3A8A;margin-bottom:4px;word-break:break-word}
    .org{font-size:12pt;font-weight:600;line-height:1.3;color:#333;word-break:break-word}
    .sep{height:1px;background:#ddd;margin:6px 0}
    .evt{font-size:8pt;color:#666;margin-top:6px;text-align:center}
  </style>`;
  printWin.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>Sticker</title>${style}</head>
    <body><div class="sticker-wrap"><div class="sticker">
      <div class="name">${safeName}</div><div class="org">${safeOrg}</div>
      <div class="sep"></div><div class="evt">RailTrans Expo 2026</div>
    </div></div></body></html>`);
  printWin.document.close();
  return true;
}

// ── Standalone Portal Modal (completely outside component tree) ───────────────
// This component mounts directly into document.body via a portal.
// It is NEVER unmounted by parent re-renders — only by explicit close actions.
function BadgeModal({ ticketId, validation, onClose, onScanAgain, printUrl }) {
  const [isLoading, setIsLoading] = useState(true);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [error, setError] = useState(null);
  const pdfUrlRef = useRef(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      // Revoke blob URL on unmount
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    };
  }, []);

  // Fetch PDF once on mount
  useEffect(() => {
    if (!ticketId) { setError("No ticket ID"); setIsLoading(false); return; }

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setPdfUrl(null);

    fetch(printUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketId: String(ticketId) }),
      credentials: "include",
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const js = await res.json().catch(() => null);
          throw new Error(js?.error || `Server error ${res.status}`);
        }
        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("application/pdf")) throw new Error("Server did not return a PDF");
        return res.blob();
      })
      .then((blob) => {
        if (cancelled || !isMounted.current) return;
        const url = URL.createObjectURL(blob);
        pdfUrlRef.current = url;
        setPdfUrl(url);
      })
      .catch((e) => {
        if (cancelled || !isMounted.current) return;
        setError(e.message || "Unknown error");
      })
      .finally(() => {
        if (!cancelled && isMounted.current) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [ticketId, printUrl]);

  function handlePrint() {
    const iframe = document.querySelector("#badge-preview-frame");
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.focus();
      setTimeout(() => iframe.contentWindow.print(), 300);
    }
  }

  function handleRetry() {
    if (pdfUrlRef.current) { URL.revokeObjectURL(pdfUrlRef.current); pdfUrlRef.current = null; }
    setPdfUrl(null);
    setError(null);
    setIsLoading(true);

    fetch(printUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketId: String(ticketId) }),
      credentials: "include",
    })
      .then(async (res) => {
        if (!res.ok) {
          const js = await res.json().catch(() => null);
          throw new Error(js?.error || `Server error ${res.status}`);
        }
        return res.blob();
      })
      .then((blob) => {
        if (!isMounted.current) return;
        const url = URL.createObjectURL(blob);
        pdfUrlRef.current = url;
        setPdfUrl(url);
      })
      .catch((e) => { if (isMounted.current) setError(e.message || "Unknown error"); })
      .finally(() => { if (isMounted.current) setIsLoading(false); });
  }

  const attendeeName = validation?.ticket?.name || "";

  const modal = (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 99999,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "16px",
      background: "rgba(0,0,0,0.55)",
    }}>
      {/* White card — stopPropagation so backdrop never sees the click */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: "12px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
          width: "100%",
          maxWidth: "880px",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          position: "relative",
          zIndex: 100000,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 20px", borderBottom: "1px solid #e5e7eb", flexShrink: 0 }}>
          <span style={{ fontWeight: 700, fontSize: "16px" }}>Badge Preview — {ticketId}</span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: "28px", cursor: "pointer", color: "#6b7280", lineHeight: 1, padding: "2px 6px", borderRadius: "4px" }}
          >×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "auto", minHeight: "56vh", display: "flex", flexDirection: "column" }}>
          {isLoading && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "56vh", color: "#6b7280" }}>
              <div style={{ fontSize: "52px", marginBottom: "14px" }}>⏳</div>
              <div style={{ fontSize: "18px", fontWeight: 600 }}>Loading badge...</div>
              <div style={{ fontSize: "13px", marginTop: "6px", color: "#9ca3af" }}>Fetching PDF from server</div>
            </div>
          )}

          {!isLoading && error && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "56vh", color: "#dc2626" }}>
              <div style={{ fontSize: "52px", marginBottom: "12px" }}>⚠️</div>
              <div style={{ fontSize: "18px", fontWeight: 600 }}>Error Loading Badge</div>
              <div style={{ fontSize: "13px", marginTop: "8px", maxWidth: "360px", textAlign: "center" }}>{error}</div>
              <button
                onClick={handleRetry}
                style={{ marginTop: "18px", padding: "9px 22px", background: "#fee2e2", border: "none", borderRadius: "6px", cursor: "pointer", color: "#dc2626", fontWeight: 600, fontSize: "14px" }}
              >🔄 Retry</button>
            </div>
          )}

          {!isLoading && !error && pdfUrl && (
            <iframe
              id="badge-preview-frame"
              src={pdfUrl}
              style={{ flex: 1, width: "100%", minHeight: "56vh", border: "none", display: "block" }}
              title="Badge Preview"
            />
          )}

          {!isLoading && !error && !pdfUrl && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "56vh", color: "#9ca3af" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "52px", marginBottom: "10px" }}>📄</div>
                <div>Waiting for PDF...</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 20px", borderTop: "1px solid #e5e7eb", background: "#f9fafb", flexShrink: 0 }}>
          <div style={{ fontSize: "13px", color: "#6b7280" }}>
            {attendeeName && <span>Attendee: <strong>{attendeeName}</strong></span>}
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <button
              onClick={onScanAgain}
              style={{ padding: "9px 18px", background: "#e5e7eb", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: 500, fontSize: "14px" }}
            >🔄 Scan Again</button>
            <button
              onClick={onClose}
              style={{ padding: "9px 18px", background: "#e5e7eb", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: 500, fontSize: "14px" }}
            >Close</button>
            <button
              onClick={handlePrint}
              disabled={!pdfUrl}
              style={{
                padding: "9px 20px", border: "none", borderRadius: "6px", fontWeight: 600, fontSize: "14px",
                background: pdfUrl ? "#196e87" : "#9ca3af",
                color: "#fff",
                cursor: pdfUrl ? "pointer" : "not-allowed",
              }}
            >🖨️ Print</button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

// ── Main Scanner Component ────────────────────────────────────────────────────
const TicketScanner = React.memo(function TicketScanner({
  autoPrintOnValidate = false,
  mode = "badge",
  showDebug = false,
  stickerPageSize = { w: "80mm", h: "50mm" },
  onError,
  onSuccess,
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);
  const isLockedRef = useRef(false);
  const isMountedRef = useRef(true);
  const startCameraRef = useRef(null);
  const handleRawScanRef = useRef(null);

  const ticketDataRef = useRef({ ticketId: null, validation: null });

  const [message, setMessage] = useState("Initializing camera...");
  const [rawPayload, setRawPayload] = useState("");
  const [ticketId, setTicketId] = useState(null);
  const [validation, setValidation] = useState(null);
  const [showVideo, setShowVideo] = useState(true);

  // Modal state — kept minimal, only "is it open"
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTicketId, setModalTicketId] = useState(null);
  const [modalValidation, setModalValidation] = useState(null);

  const validateUrl = useMemo(() => apiUrl("/api/tickets/validate"), []);
  const printUrl = useMemo(() => apiUrl("/api/tickets/scan"), []);
  const isStickerMode = String(mode).toLowerCase() === "sticker";

  const stickerData = useMemo(() => {
    if (!validation?.ok || !validation.ticket) return { name: "", organization: "" };
    return extractNameAndOrganization(validation.ticket);
  }, [validation]);

  const cleanup = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (videoRef.current) { videoRef.current.srcObject = null; }
  }, []);

  // Open the portal modal
  const openModal = useCallback((tid, val) => {
    setModalTicketId(tid);
    setModalValidation(val);
    setModalOpen(true);
  }, []);

  // Close modal (keep validation visible behind)
  const handleCloseModal = useCallback(() => {
    setModalOpen(false);
    setMessage("✅ Ticket matched — scan another or print again");
  }, []);

  // Scan again — reset everything
  const handleScanAgain = useCallback(() => {
    setModalOpen(false);
    setValidation(null);
    setTicketId(null);
    setRawPayload("");
    setModalTicketId(null);
    setModalValidation(null);
    ticketDataRef.current = { ticketId: null, validation: null };
    isLockedRef.current = false;
    setMessage("Starting camera...");
    if (startCameraRef.current) startCameraRef.current();
  }, []);

  const handleRawScan = useCallback(async (data) => {
    if (isLockedRef.current) return;
    isLockedRef.current = true;
    cleanup();
    setShowVideo(false);
    setRawPayload(String(data));
    setMessage("QR detected — processing...");
    setValidation(null);

    const extracted = extractTicketId(String(data));
    if (!extracted) {
      setMessage("QR scanned but no ticket id found.");
      setValidation({ ok: false, error: "No ticket id extracted" });
      if (onError) onError(new Error("No ticket id extracted"));
      setTimeout(() => { if (isMountedRef.current) isLockedRef.current = false; }, 2000);
      return;
    }

    setTicketId(extracted);
    ticketDataRef.current.ticketId = extracted;
    setMessage(`Validating ticket: ${extracted}...`);

    try {
      const res = await fetch(validateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: extracted }),
        credentials: "include",
      });
      const js = await res.json().catch(() => ({}));

      if (!res.ok || !js || !js.success) {
        setValidation({ ok: false, error: js?.error || `Validate failed (${res.status})` });
        setMessage("❌ Ticket not matched");
        if (onError) onError(new Error(js?.error || `Validate failed (${res.status})`));
        setTimeout(() => { if (isMountedRef.current) isLockedRef.current = false; }, 2000);
      } else {
        const ticketPayload = js.ticket || js;
        const val = { ok: true, ticket: ticketPayload };
        setValidation(val);
        ticketDataRef.current.validation = val;
        setMessage("✅ Ticket matched");
        if (onSuccess) onSuccess(ticketPayload);

        if (isStickerMode) {
          if (autoPrintOnValidate) {
            const nameOrg = extractNameAndOrganization(ticketPayload);
            printSticker({ ...nameOrg, page: stickerPageSize });
          }
        } else {
          // Open portal modal — completely independent of component re-renders
          openModal(extracted, val);
        }
      }
    } catch (e) {
      setValidation({ ok: false, error: e.message || String(e) });
      setMessage("Validation request error");
      if (onError) onError(e);
      setTimeout(() => { if (isMountedRef.current) isLockedRef.current = false; }, 2000);
    }
  }, [cleanup, validateUrl, onError, onSuccess, autoPrintOnValidate, isStickerMode, openModal, stickerPageSize]);

  useEffect(() => { handleRawScanRef.current = handleRawScan; }, [handleRawScan]);

  const startCamera = useCallback(async () => {
    try {
      cleanup();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (!isMountedRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setShowVideo(true);
      setMessage("Scanning for QR…");

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      const tick = () => {
        if (!isMountedRef.current || isLockedRef.current) return;
        if (!videoRef.current || !canvasRef.current) return;
        if (videoRef.current.readyState !== videoRef.current.HAVE_ENOUGH_DATA) {
          rafRef.current = requestAnimationFrame(tick); return;
        }
        try {
          canvas.width = videoRef.current.videoWidth;
          canvas.height = videoRef.current.videoHeight;
          ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" });
          if (code && !isLockedRef.current) { handleRawScanRef.current(code.data); return; }
        } catch (e) { console.warn("frame read error", e?.message); }
        if (isMountedRef.current && !isLockedRef.current) rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      setMessage(`Camera error: ${err.message || err}`);
      setShowVideo(false);
      if (onError) onError(err);
    }
  }, [cleanup, onError]);

  useEffect(() => { startCameraRef.current = startCamera; }, [startCamera]);

  useEffect(() => {
    isMountedRef.current = true;
    isLockedRef.current = false;
    startCamera();
    return () => { isMountedRef.current = false; cleanup(); };
  }, [startCamera, cleanup]);

  function renderValidation() {
    if (!validation) return null;

    if (!validation.ok) {
      return (
        <div className="p-3 bg-red-50 text-red-700 rounded">
          <div><strong>Not matched</strong></div>
          <div className="text-sm">{validation.error || "Ticket not found"}</div>
          <button className="mt-2 px-3 py-1 bg-red-100 hover:bg-red-200 rounded" onClick={handleScanAgain}>
            Scan again
          </button>
        </div>
      );
    }

    if (isStickerMode) {
      return (
        <div className="p-3 rounded border bg-white text-gray-900">
          <div className="border rounded bg-gray-50 p-3" style={{ maxWidth: 420 }}>
            <div className="text-xl font-extrabold leading-tight text-[#1B3A8A]">{stickerData.name || "—"}</div>
            <div className="text-base font-semibold leading-snug mt-1 text-gray-700">{stickerData.organization || "—"}</div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              className="px-4 py-2 bg-[#196e87] text-white rounded hover:bg-[#0f5568]"
              onClick={() => printSticker({ ...stickerData, page: stickerPageSize })}
              disabled={!stickerData.name && !stickerData.organization}
            >🖨️ Print Sticker</button>
            <button className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded" onClick={handleScanAgain}>
              Scan again
            </button>
          </div>
        </div>
      );
    }

    const t = validation.ticket || {};
    return (
      <div className="p-3 bg-green-50 text-green-800 rounded">
        <div className="font-semibold">✅ Ticket Matched</div>
        <div className="text-sm mt-1"><strong>Name:</strong> {t.name || t.full_name || "-"}</div>
        <div className="text-sm"><strong>Company:</strong> {t.company || t.organization || "-"}</div>
        <div className="text-sm"><strong>Category:</strong> {t.category || t.ticket_category || "-"}</div>
        <div className="mt-3 flex gap-2">
          <button
            className="px-4 py-2 bg-[#196e87] text-white rounded hover:bg-[#0f5568]"
            onClick={() => openModal(ticketDataRef.current.ticketId, validation)}
          >🖨️ Print Badge</button>
          <button className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded" onClick={handleScanAgain}>
            Scan again
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div>
        <div className="bg-white rounded-lg shadow p-3">
          <div className="mb-3">
            {showVideo ? (
              <video
                ref={videoRef}
                style={{ width: "100%", maxHeight: 480, borderRadius: 8 }}
                playsInline muted autoPlay
              />
            ) : (
              <div
                className="bg-gray-100 rounded-lg flex items-center justify-center"
                style={{ width: "100%", height: 320, borderRadius: 8 }}
              >
                <div className="text-center text-gray-500">
                  <div className="text-4xl mb-2">{validation?.ok ? "✅" : "📷"}</div>
                  <div className="text-lg font-semibold">
                    {validation?.ok ? "Ticket Validated" : "Camera Paused"}
                  </div>
                  <div className="text-sm mt-1">
                    {validation?.ok
                      ? "Badge preview is open"
                      : message.toLowerCase().includes("error")
                      ? "Camera access failed"
                      : "Camera stopped"}
                  </div>
                  {!validation?.ok && !message.includes("Scanning") && (
                    <button
                      className="mt-3 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                      onClick={startCamera}
                    >🔄 Start Camera</button>
                  )}
                </div>
              </div>
            )}
            <canvas ref={canvasRef} style={{ display: "none" }} />
          </div>

          <div className="flex items-center justify-between mb-2">
            <div className="text-sm text-gray-700">{message}</div>
            <div className="text-xs text-gray-500">Mode: {isStickerMode ? "Sticker" : "Badge"}</div>
          </div>

          {showDebug && (
            <>
              <div className="mb-3">
                <div className="text-xs text-gray-500">Raw payload:</div>
                <pre className="bg-gray-50 p-2 rounded text-xs max-h-28 overflow-auto">{rawPayload || "—"}</pre>
              </div>
              <div className="mb-3">
                <div className="text-xs text-gray-500">Extracted ticket id:</div>
                <div className="font-mono text-sm p-2 bg-gray-50 rounded">{ticketId || "—"}</div>
              </div>
              <div className="mb-3">
                <div className="text-xs text-gray-500">Video visible:</div>
                <div className="font-mono text-sm p-2 bg-gray-50 rounded">{showVideo ? "📹 Visible" : "🚫 Hidden"}</div>
              </div>
              <div className="mb-3">
                <div className="text-xs text-gray-500">Lock status:</div>
                <div className="font-mono text-sm p-2 bg-gray-50 rounded">{isLockedRef.current ? "LOCKED 🔒" : "UNLOCKED 🔓"}</div>
              </div>
            </>
          )}

          {validation && renderValidation()}
        </div>
      </div>

      {/* Portal modal — lives in document.body, immune to parent re-renders */}
      {modalOpen && (
        <BadgeModal
          ticketId={modalTicketId}
          validation={modalValidation}
          printUrl={printUrl}
          onClose={handleCloseModal}
          onScanAgain={handleScanAgain}
        />
      )}
    </>
  );
});

export default TicketScanner;