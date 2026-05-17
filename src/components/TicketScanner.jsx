import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
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
  const priorityKeys = [
    "ticket_code", "ticketCode", "code", "ticketId", "ticket_id", "id",
  ];
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
  if (!ticket || typeof ticket !== "object")
    return { name: "", organization: "" };
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
  const style = `
    <style>
      @page { size: ${page.w} ${page.h}; margin: 0; }
      @media print {
        body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .sticker { box-shadow: none !important; border: 1px solid #ccc; }
      }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { height: 100%; background: white; }
      body { display: flex; align-items: center; justify-content: center; font-family: 'Arial', 'Helvetica', sans-serif; }
      .sticker-wrap { width: ${page.w}; height: ${page.h}; display: flex; align-items: stretch; justify-content: stretch; }
      .sticker { width: 100%; height: 100%; padding: 8mm 6mm; display: flex; flex-direction: column; justify-content: center; background: white; border: 2px solid #1B3A8A; border-radius: 4px; }
      .name { font-size: 20pt; font-weight: 800; line-height: 1.2; color: #1B3A8A; margin-bottom: 4px; word-break: break-word; }
      .org { font-size: 12pt; font-weight: 600; line-height: 1.3; color: #333; word-break: break-word; }
      .separator { height: 1px; background: #ddd; margin: 6px 0; }
      .event-name { font-size: 8pt; color: #666; margin-top: 6px; text-align: center; }
    </style>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Event Sticker</title>${style}</head>
    <body><div class="sticker-wrap"><div class="sticker">
      <div class="name">${safeName}</div><div class="org">${safeOrg}</div>
      <div class="separator"></div><div class="event-name">RailTrans Expo 2026</div>
    </div></div></body></html>`;
  printWin.document.open();
  printWin.document.write(html);
  printWin.document.close();
  return true;
}

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

  const ticketDataRef = useRef({ ticketId: null, validation: null, pdfUrl: null });

  const [message, setMessage] = useState("Initializing camera...");
  const [rawPayload, setRawPayload] = useState("");
  const [ticketId, setTicketId] = useState(null);
  const [validation, setValidation] = useState(null);
  const [showVideo, setShowVideo] = useState(true);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [isLoadingPDF, setIsLoadingPDF] = useState(false);
  const [printError, setPrintError] = useState(null);

  const validateUrl = useMemo(() => apiUrl("/api/tickets/validate"), []);
  const printUrl = useMemo(() => apiUrl("/api/tickets/scan"), []);
  const isStickerMode = String(mode).toLowerCase() === "sticker";

  const stickerData = useMemo(() => {
    if (!validation?.ok || !validation.ticket) return { name: "", organization: "" };
    return extractNameAndOrganization(validation.ticket);
  }, [validation]);

  useEffect(() => { ticketDataRef.current.ticketId = ticketId; }, [ticketId]);
  useEffect(() => { ticketDataRef.current.validation = validation; }, [validation]);
  useEffect(() => { ticketDataRef.current.pdfUrl = pdfUrl; }, [pdfUrl]);

  const cleanup = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (videoRef.current) { videoRef.current.srcObject = null; }
  }, []);

  const handlePrintBadge = useCallback(async (id) => {
    const resolvedId = id || ticketDataRef.current.ticketId;
    if (!resolvedId) return;

    setIsLoadingPDF(true);
    setPrintError(null);
    setPdfUrl(null);
    ticketDataRef.current.pdfUrl = null;
    setShowPrintPreview(true);
    setShowVideo(false);
    isLockedRef.current = true;
    setMessage("Loading badge preview...");

    try {
      const res = await fetch(printUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: String(resolvedId) }),
        credentials: "include",
      });

      if (!res.ok) {
        const js = await res.json().catch(() => null);
        const errorMsg = js?.error || `Failed to load badge (${res.status})`;
        setPrintError(errorMsg);
        setMessage(`Error: ${errorMsg}`);
        return;
      }

      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/pdf")) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        ticketDataRef.current.pdfUrl = url;
        setPdfUrl(url);
        setMessage("✅ Badge ready — click Print");
      } else {
        setPrintError("Server did not return a PDF");
        setMessage("Error: Invalid response from server");
      }
    } catch (e) {
      setPrintError(e.message || "Unknown error");
      setMessage(`Error: ${e.message || "Failed to load badge"}`);
    } finally {
      setIsLoadingPDF(false);
    }
  }, [printUrl]);

  const handlePrint = useCallback(() => {
    const url = ticketDataRef.current.pdfUrl || pdfUrl;
    if (!url) return;
    const iframe = document.querySelector("#badge-preview-frame");
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.focus();
      setTimeout(() => { iframe.contentWindow.print(); }, 300);
      setMessage("✅ Print dialog opened");
    }
  }, [pdfUrl]);

  const handleClosePreview = useCallback(() => {
    const url = ticketDataRef.current.pdfUrl;
    if (url) { URL.revokeObjectURL(url); ticketDataRef.current.pdfUrl = null; }
    setPdfUrl(null);
    setPrintError(null);
    setShowPrintPreview(false);
    setMessage("✅ Ticket matched — scan another or print again");
  }, []);

  const handleScanAgain = useCallback(() => {
    const url = ticketDataRef.current.pdfUrl;
    if (url) { URL.revokeObjectURL(url); }
    ticketDataRef.current = { ticketId: null, validation: null, pdfUrl: null };
    isLockedRef.current = false;
    setPdfUrl(null);
    setPrintError(null);
    setShowPrintPreview(false);
    setValidation(null);
    setTicketId(null);
    setRawPayload("");
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
        setValidation({ ok: true, ticket: ticketPayload });
        ticketDataRef.current.validation = { ok: true, ticket: ticketPayload };
        setMessage("✅ Ticket matched — loading badge preview...");
        if (onSuccess) onSuccess(ticketPayload);

        if (isStickerMode) {
          if (autoPrintOnValidate) {
            const nameOrg = extractNameAndOrganization(ticketPayload);
            printSticker({ ...nameOrg, page: stickerPageSize });
          }
        } else {
          await handlePrintBadge(extracted);
        }
      }
    } catch (e) {
      setValidation({ ok: false, error: e.message || String(e) });
      setMessage("Validation request error");
      if (onError) onError(e);
      setTimeout(() => { if (isMountedRef.current) isLockedRef.current = false; }, 2000);
    }
  }, [cleanup, validateUrl, onError, onSuccess, autoPrintOnValidate, isStickerMode, handlePrintBadge, stickerPageSize]);

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
            >
              🖨️ Print Sticker
            </button>
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
            onClick={() => handlePrintBadge(ticketDataRef.current.ticketId)}
            disabled={isLoadingPDF}
          >
            {isLoadingPDF ? "⏳ Loading..." : "🖨️ Print Badge"}
          </button>
          <button className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded" onClick={handleScanAgain}>
            Scan again
          </button>
        </div>
      </div>
    );
  }

  function renderPrintPreview() {
    if (!showPrintPreview) return null;

    const currentPdfUrl = pdfUrl || ticketDataRef.current.pdfUrl;
    const currentTicketId = ticketId || ticketDataRef.current.ticketId;
    const currentValidation = validation || ticketDataRef.current.validation;

    return (
      /*
       * FIX: backdrop is pointer-events-none so it NEVER intercepts clicks.
       * The inner white card is pointer-events-auto so all its buttons work.
       * stopPropagation on the card is a belt-and-suspenders safety measure.
       */
      <div
        style={{
          position: "fixed", inset: 0, zIndex: 9999,
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "16px",
          backgroundColor: "rgba(0,0,0,0.5)",
          pointerEvents: "none",          /* backdrop swallows NO clicks */
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            pointerEvents: "auto",        /* card + all its children ARE clickable */
            background: "#fff",
            borderRadius: "12px",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            width: "100%",
            maxWidth: "900px",
            maxHeight: "90vh",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* ── Header ── */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #e5e7eb" }}>
            <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 600 }}>
              Badge Preview — {currentTicketId}
            </h3>
            <button
              onClick={handleClosePreview}
              style={{ background: "none", border: "none", fontSize: "26px", cursor: "pointer", color: "#6b7280", lineHeight: 1, padding: "0 4px" }}
              title="Close"
            >
              ×
            </button>
          </div>

          {/* ── Body ── */}
          <div style={{ flex: 1, overflow: "auto", padding: "16px", minHeight: "55vh" }}>
            {isLoadingPDF ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "55vh" }}>
                <div style={{ textAlign: "center", color: "#6b7280" }}>
                  <div style={{ fontSize: "48px", marginBottom: "12px" }}>⏳</div>
                  <div style={{ fontSize: "18px", fontWeight: 600 }}>Loading badge...</div>
                  <div style={{ fontSize: "13px", marginTop: "6px", color: "#9ca3af" }}>Fetching PDF from server</div>
                </div>
              </div>
            ) : printError ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "55vh" }}>
                <div style={{ textAlign: "center", color: "#dc2626" }}>
                  <div style={{ fontSize: "48px", marginBottom: "10px" }}>⚠️</div>
                  <div style={{ fontSize: "18px", fontWeight: 600 }}>Error Loading Badge</div>
                  <div style={{ fontSize: "13px", marginTop: "8px" }}>{printError}</div>
                  <button
                    onClick={() => handlePrintBadge(ticketDataRef.current.ticketId)}
                    style={{ marginTop: "16px", padding: "8px 18px", background: "#fee2e2", border: "none", borderRadius: "6px", cursor: "pointer", color: "#dc2626", fontWeight: 600 }}
                  >
                    🔄 Retry
                  </button>
                </div>
              </div>
            ) : currentPdfUrl ? (
              <iframe
                id="badge-preview-frame"
                src={currentPdfUrl}
                style={{ width: "100%", minHeight: "55vh", border: "none", display: "block" }}
                title="Badge Preview"
              />
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "55vh" }}>
                <div style={{ textAlign: "center", color: "#9ca3af" }}>
                  <div style={{ fontSize: "48px", marginBottom: "8px" }}>📄</div>
                  <div>Waiting for PDF...</div>
                </div>
              </div>
            )}
          </div>

          {/* ── Footer ── */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderTop: "1px solid #e5e7eb", background: "#f9fafb" }}>
            <div style={{ fontSize: "13px", color: "#6b7280" }}>
              {currentValidation?.ticket?.name && (
                <span>Attendee: <strong>{currentValidation.ticket.name}</strong></span>
              )}
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={handleScanAgain}
                style={{ padding: "9px 18px", background: "#e5e7eb", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: 500, fontSize: "14px" }}
              >
                🔄 Scan Again
              </button>
              <button
                onClick={handleClosePreview}
                style={{ padding: "9px 18px", background: "#e5e7eb", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: 500, fontSize: "14px" }}
              >
                Close
              </button>
              <button
                onClick={handlePrint}
                disabled={!currentPdfUrl}
                style={{
                  padding: "9px 18px",
                  background: !currentPdfUrl ? "#9ca3af" : "#196e87",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: !currentPdfUrl ? "not-allowed" : "pointer",
                  fontWeight: 600,
                  fontSize: "14px",
                }}
              >
                🖨️ Print
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
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
                  >
                    🔄 Start Camera
                  </button>
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

      {renderPrintPreview()}
    </div>
  );
});

export default TicketScanner;