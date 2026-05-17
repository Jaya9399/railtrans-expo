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
  try {
    return String(v ?? "").replace(/\s+/g, " ").trim() || "";
  } catch { return ""; }
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
      <div class="name">${safeName}</div>
      <div class="org">${safeOrg}</div>
      <div class="separator"></div>
      <div class="event-name">RailTrans Expo 2026</div>
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

  // All ticket data lives in ONE ref — no stale closures ever
  const ticketDataRef = useRef({
    ticketId: null,
    validation: null,
    pdfUrl: null,
  });

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

  // Keep ref in sync with state so modal can always read latest values
  useEffect(() => {
    ticketDataRef.current.ticketId = ticketId;
  }, [ticketId]);
  useEffect(() => {
    ticketDataRef.current.validation = validation;
  }, [validation]);
  useEffect(() => {
    ticketDataRef.current.pdfUrl = pdfUrl;
  }, [pdfUrl]);

  const cleanup = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (videoRef.current) { videoRef.current.srcObject = null; }
  }, []);

  // ── handlePrintBadge ──────────────────────────────────────────────────────
  // Opens modal immediately with spinner, then loads PDF.
  // Never closes the modal on its own — only user buttons do that.
  const handlePrintBadge = useCallback(async (id) => {
    const resolvedId = id || ticketDataRef.current.ticketId;
    if (!resolvedId) return;

    // Open modal right away so user sees spinner
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
        // Set ref FIRST, then state — so modal body reads it instantly
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

  // ── handlePrint ───────────────────────────────────────────────────────────
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

  // ── handleClosePreview ────────────────────────────────────────────────────
  // Only called by × button or Close button. Never called automatically.
  const handleClosePreview = useCallback(() => {
    const url = ticketDataRef.current.pdfUrl;
    if (url) { URL.revokeObjectURL(url); ticketDataRef.current.pdfUrl = null; }
    setPdfUrl(null);
    setPrintError(null);
    setShowPrintPreview(false);
    setMessage("✅ Ticket matched — scan another or print again");
  }, []);

  // ── handleScanAgain ───────────────────────────────────────────────────────
  // Resets everything and restarts camera. Does NOT call handleClosePreview.
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

    // Call via ref — avoids circular dependency with startCamera
    if (startCameraRef.current) startCameraRef.current();
  }, []);

  // ── handleRawScan ─────────────────────────────────────────────────────────
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
          // Auto-open badge preview immediately — extracted is local, never stale
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

  // Keep handleRawScan ref current so startCamera's tick() always uses latest
  useEffect(() => { handleRawScanRef.current = handleRawScan; }, [handleRawScan]);

  // ── startCamera ───────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    try {
      cleanup();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (!isMountedRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setShowVideo(true);
      setMessage("Scanning for QR…");

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      const tick = () => {
        if (!isMountedRef.current || isLockedRef.current) return;
        if (!videoRef.current || !canvasRef.current) return;
        if (videoRef.current.readyState !== videoRef.current.HAVE_ENOUGH_DATA) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        try {
          canvas.width = videoRef.current.videoWidth;
          canvas.height = videoRef.current.videoHeight;
          ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" });
          if (code && !isLockedRef.current) {
            // Always call via ref — never stale
            handleRawScanRef.current(code.data);
            return;
          }
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

  // Keep startCamera ref current so handleScanAgain can call it
  useEffect(() => { startCameraRef.current = startCamera; }, [startCamera]);

  useEffect(() => {
    isMountedRef.current = true;
    isLockedRef.current = false;
    startCamera();
    return () => {
      isMountedRef.current = false;
      cleanup();
    };
  }, [startCamera, cleanup]);

  // ── renderValidation ──────────────────────────────────────────────────────
  function renderValidation() {
    if (!validation) return null;

    if (!validation.ok) {
      return (
        <div className="p-3 bg-red-50 text-red-700 rounded">
          <div><strong>Not matched</strong></div>
          <div className="text-sm">{validation.error || "Ticket not found"}</div>
          <button
            className="mt-2 px-3 py-1 bg-red-100 hover:bg-red-200 rounded"
            onClick={handleScanAgain}
          >
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

    // Badge mode
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

  // ── renderPrintPreview ────────────────────────────────────────────────────
  // Modal never closes on its own. Only × , Close, or Scan Again close it.
  // Backdrop click does nothing.
  function renderPrintPreview() {
    if (!showPrintPreview) return null;

    const currentPdfUrl = pdfUrl || ticketDataRef.current.pdfUrl;
    const currentTicketId = ticketId || ticketDataRef.current.ticketId;
    const currentValidation = validation || ticketDataRef.current.validation;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">

          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b">
            <h3 className="text-lg font-semibold">Badge Preview — {currentTicketId}</h3>
            <button
              onClick={handleClosePreview}
              className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
              title="Close preview"
            >
              ×
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 p-4 overflow-auto" style={{ minHeight: "60vh" }}>
            {isLoadingPDF ? (
              <div className="flex items-center justify-center" style={{ minHeight: "60vh" }}>
                <div className="text-center text-gray-500">
                  <div className="text-4xl mb-3">⏳</div>
                  <div className="text-lg font-semibold">Loading badge...</div>
                  <div className="text-sm mt-1 text-gray-400">Fetching PDF from server</div>
                </div>
              </div>
            ) : printError ? (
              <div className="flex items-center justify-center" style={{ minHeight: "60vh" }}>
                <div className="text-center text-red-600">
                  <div className="text-4xl mb-2">⚠️</div>
                  <div className="text-lg font-semibold">Error Loading Badge</div>
                  <div className="text-sm mt-2">{printError}</div>
                  <button
                    className="mt-4 px-4 py-2 bg-red-100 hover:bg-red-200 rounded text-red-700"
                    onClick={() => handlePrintBadge(ticketDataRef.current.ticketId)}
                  >
                    🔄 Retry
                  </button>
                </div>
              </div>
            ) : currentPdfUrl ? (
              <iframe
                id="badge-preview-frame"
                src={currentPdfUrl}
                className="w-full h-full border-0"
                style={{ minHeight: "60vh" }}
                title="Badge Preview"
              />
            ) : (
              <div className="flex items-center justify-center" style={{ minHeight: "60vh" }}>
                <div className="text-center text-gray-400">
                  <div className="text-4xl mb-2">📄</div>
                  <div>Waiting for PDF...</div>
                </div>
              </div>
            )}
          </div>

          {/* Footer — NO download button */}
          <div className="flex items-center justify-between p-4 border-t bg-gray-50">
            <div className="text-sm text-gray-600">
              {currentValidation?.ticket?.name && (
                <span>Attendee: <strong>{currentValidation.ticket.name}</strong></span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleScanAgain}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded"
              >
                🔄 Scan Again
              </button>
              <button
                onClick={handleClosePreview}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded"
              >
                Close
              </button>
              <button
                onClick={handlePrint}
                className="px-4 py-2 bg-[#196e87] text-white rounded hover:bg-[#0f5568]"
                disabled={!currentPdfUrl}
              >
                🖨️ Print
              </button>
            </div>
          </div>

        </div>
      </div>
    );
  }

  // ── render ────────────────────────────────────────────────────────────────
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