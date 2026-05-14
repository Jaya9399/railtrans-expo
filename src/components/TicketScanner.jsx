import React, { useEffect, useMemo, useRef, useState } from "react";
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

// Extract ticket ID from QR data
function extractTicketIdFromObject(obj) {
  if (!obj || typeof obj !== "object") return null;

  const priorityKeys = [
    "ticket_code",
    "ticketCode",
    "code",
    "ticketId",
    "ticket_id",
    "id",
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

// Extract name and organization from ticket data
function extractNameAndOrganization(ticket) {
  if (!ticket || typeof ticket !== "object")
    return { name: "", organization: "" };

  const nameFields = [
    "name",
    "full_name",
    "fullName",
    "visitor_name",
    "attendee_name",
    "n",
  ];
  let name = "";
  for (const field of nameFields) {
    if (ticket[field]) {
      name = String(ticket[field]).trim();
      if (name) break;
    }
  }

  const orgFields = [
    "company",
    "organization",
    "org",
    "company_name",
    "companyName",
    "employer",
    "affiliation",
  ];
  let organization = "";
  for (const field of orgFields) {
    if (ticket[field]) {
      organization = String(ticket[field]).trim();
      if (organization) break;
    }
  }

  if (!name && ticket.data && typeof ticket.data === "object") {
    name = ticket.data.name || ticket.data.full_name || "";
    organization = ticket.data.company || ticket.data.organization || "";
  }

  return {
    name: name || "Guest",
    organization: organization || "Visitor",
  };
}

function normalizeStickerText(v) {
  try {
    const s = String(v ?? "")
      .replace(/\s+/g, " ")
      .trim();
    return s || "";
  } catch {
    return "";
  }
}

// Sticker printing function
function printSticker({ name, organization, page = { w: "80mm", h: "50mm" } }) {
  const printWin = window.open("", "_blank", "width=600,height=400");
  if (!printWin) {
    alert("Please allow popups to print stickers");
    return false;
  }

  const safeName = normalizeStickerText(name) || "Guest";
  const safeOrg = normalizeStickerText(organization) || "Visitor";

  const style = `
    <style>
      @page { 
        size: ${page.w} ${page.h}; 
        margin: 0;
      }
      @media print {
        body { 
          margin: 0; 
          -webkit-print-color-adjust: exact; 
          print-color-adjust: exact;
        }
        .sticker { 
          box-shadow: none !important;
          border: 1px solid #ccc;
        }
      }
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      html, body { 
        height: 100%;
        background: white;
      }
      body {
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: 'Arial', 'Helvetica', sans-serif;
      }
      .sticker-wrap {
        width: ${page.w};
        height: ${page.h};
        display: flex;
        align-items: stretch;
        justify-content: stretch;
      }
      .sticker {
        width: 100%;
        height: 100%;
        padding: 8mm 6mm;
        display: flex;
        flex-direction: column;
        justify-content: center;
        background: white;
        border: 2px solid #1B3A8A;
        border-radius: 4px;
      }
      .name {
        font-size: 20pt;
        font-weight: 800;
        line-height: 1.2;
        color: #1B3A8A;
        margin-bottom: 4px;
        word-break: break-word;
      }
      .org {
        font-size: 12pt;
        font-weight: 600;
        line-height: 1.3;
        color: #333;
        word-break: break-word;
      }
      .separator {
        height: 1px;
        background: #ddd;
        margin: 6px 0;
      }
      .event-name {
        font-size: 8pt;
        color: #666;
        margin-top: 6px;
        text-align: center;
      }
    </style>
  `;

  const html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Event Sticker</title>
        ${style}
      </head>
      <body>
        <div class="sticker-wrap">
          <div class="sticker">
            <div class="name">${safeName}</div>
            <div class="org">${safeOrg}</div>
            <div class="separator"></div>
            <div class="event-name">RailTrans Expo 2026</div>
          </div>
        </div>
      </body>
    </html>`;

  printWin.document.open();
  printWin.document.write(html);
  printWin.document.close();

  // Don't auto-print, let user see preview first
  return true;
}

export default function TicketScanner({
  apiPath = null,
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
  const previewWindowRef = useRef(null);

  const [message, setMessage] = useState("Initializing camera...");
  const [rawPayload, setRawPayload] = useState("");
  const [ticketId, setTicketId] = useState(null);
  const [validation, setValidation] = useState(null);
  const [showVideo, setShowVideo] = useState(true);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [isLoadingPDF, setIsLoadingPDF] = useState(false);
  const [printError, setPrintError] = useState(null);

  const validateUrl = apiUrl("/api/tickets/validate");
  const printUrl = apiUrl("/api/tickets/scan");

  const isStickerMode = String(mode).toLowerCase() === "sticker";

  // Extract sticker data from validation result
  const stickerData = useMemo(() => {
    if (!validation?.ok || !validation.ticket) {
      return { name: "", organization: "" };
    }
    return extractNameAndOrganization(validation.ticket);
  }, [validation]);

  // Close preview when component unmounts
  useEffect(() => {
    return () => {
      if (previewWindowRef.current && !previewWindowRef.current.closed) {
        previewWindowRef.current.close();
      }
    };
  }, []);

  // Cleanup function
  const cleanup = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  // Start camera function
  const startCamera = async () => {
    try {
      cleanup();

      console.log("Requesting camera access...");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      if (!isMountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      console.log("Camera access granted, setting up video...");
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        console.log("Video playing");
      }

      setShowVideo(true);
      setMessage("Scanning for QR…");

      const canvas = canvasRef.current;
      if (!canvas) {
        console.error("Canvas not found");
        return;
      }

      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      const tick = () => {
        if (!isMountedRef.current) return;
        if (isLockedRef.current) return;
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
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "attemptBoth",
          });

          if (code && !isLockedRef.current) {
            console.log("QR Code detected!");
            handleRawScan(code.data);
            return;
          }
        } catch (e) {
          console.warn("frame read error", e?.message);
        }

        if (isMountedRef.current && !isLockedRef.current) {
          rafRef.current = requestAnimationFrame(tick);
        }
      };

      console.log("Starting animation loop");
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      console.error("Camera start error:", err);
      setMessage(`Camera error: ${err.message || err}`);
      setShowVideo(false);
      if (onError) onError(err);
    }
  };

  // Start camera on component mount
  useEffect(() => {
    console.log("Component mounted, starting camera...");
    isMountedRef.current = true;
    isLockedRef.current = false;
    
    startCamera();

    return () => {
      console.log("Component unmounting, cleaning up...");
      isMountedRef.current = false;
      cleanup();
      // Close preview window if open
      if (previewWindowRef.current && !previewWindowRef.current.closed) {
        previewWindowRef.current.close();
      }
    };
  }, []);

  async function handleRawScan(data) {
    if (isLockedRef.current) {
      console.log("Scan locked, ignoring QR detection");
      return;
    }

    console.log("Processing QR data...");
    
    // Lock immediately to prevent any further scanning
    isLockedRef.current = true;
    
    // Stop camera and animation frame
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
      
      setTimeout(() => {
        if (isMountedRef.current) {
          isLockedRef.current = false;
        }
      }, 2000);
      return;
    }

    setTicketId(extracted);
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
        setValidation({
          ok: false,
          error: js?.error || `Validate failed (${res.status})`,
        });
        setMessage("❌ Ticket not matched");
        if (onError)
          onError(new Error(js?.error || `Validate failed (${res.status})`));
        
        setTimeout(() => {
          if (isMountedRef.current) {
            isLockedRef.current = false;
          }
        }, 2000);
      } else {
        // SUCCESS - Keep everything locked
        console.log("✅ Validation successful, keeping UI visible");
        setValidation({ ok: true, ticket: js.ticket || js });
        setMessage("✅ Ticket matched - Ready to print");

        if (onSuccess) onSuccess(js.ticket || js);

        // Auto-print if enabled
        if (autoPrintOnValidate && isStickerMode) {
          const nameOrg = extractNameAndOrganization(js.ticket || js);
          printSticker({ ...nameOrg, page: stickerPageSize });
        } else if (autoPrintOnValidate && !isStickerMode) {
          await handlePrintBadge(extracted);
        }
        
        // NEVER unlock - stay locked until user clicks "Scan again"
      }
    } catch (e) {
      console.error("[TicketScanner] validate error", e);
      setValidation({ ok: false, error: e.message || String(e) });
      setMessage("Validation request error");
      if (onError) onError(e);
      
      setTimeout(() => {
        if (isMountedRef.current) {
          isLockedRef.current = false;
        }
      }, 2000);
    }
  }

  // Load PDF and show preview
  async function handlePrintBadge(id) {
    if (!id) return;

    setIsLoadingPDF(true);
    setPrintError(null);
    setMessage("Loading badge preview...");

    try {
      const res = await fetch(printUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: String(id) }),
        credentials: "include",
      });

      if (!res.ok) {
        const js = await res.json().catch(() => null);
        const errorMsg = js?.error || `Failed to load badge (${res.status})`;
        setPrintError(errorMsg);
        setMessage(`Error: ${errorMsg}`);
        setIsLoadingPDF(false);
        return;
      }

      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/pdf")) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setPdfUrl(url);
        setShowPrintPreview(true);
        setMessage("✅ Badge preview loaded - Click print when ready");
      } else {
        setPrintError("Server did not return a PDF");
        setMessage("Error: Invalid response from server");
      }
    } catch (e) {
      console.error("Print error", e);
      setPrintError(e.message || "Unknown error");
      setMessage(`Error: ${e.message || "Failed to load badge"}`);
    } finally {
      setIsLoadingPDF(false);
    }
  }

  // Handle actual printing
  function handlePrint() {
    if (!pdfUrl) return;
    
    // Open PDF in new window and trigger print
    const printWindow = window.open(pdfUrl, "_blank");
    if (printWindow) {
      previewWindowRef.current = printWindow;
      printWindow.onload = () => {
        setTimeout(() => {
          printWindow.print();
        }, 500);
      };
      setMessage("✅ Print dialog opened");
    } else {
      setMessage("⚠️ Popup blocked - Please allow popups and try again");
    }
  }

  // Download PDF instead of printing
  function handleDownload() {
    if (!pdfUrl) return;
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = `badge-${ticketId}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setMessage("✅ Badge downloaded");
  }

  // Close print preview
  function handleClosePreview() {
    setShowPrintPreview(false);
    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl);
      setPdfUrl(null);
    }
    setPrintError(null);
    setMessage("✅ Ticket matched - Ready to print");
  }

  function handleManualPrint() {
    if (stickerData.name || stickerData.organization) {
      printSticker({
        ...stickerData,
        page: stickerPageSize,
      });
    } else {
      setMessage("No ticket data available to print");
    }
  }

  function handleScanAgain() {
    console.log("Resetting scanner...");
    
    // Close preview if open
    if (showPrintPreview) {
      handleClosePreview();
    }
    
    // Unlock scanning
    isLockedRef.current = false;

    // Clear all states
    setValidation(null);
    setTicketId(null);
    setRawPayload("");
    setShowPrintPreview(false);
    setPrintError(null);
    
    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl);
      setPdfUrl(null);
    }

    // Restart the camera
    startCamera();
  }

  function renderValidation() {
    if (!validation) return null;

    if (!validation.ok) {
      return (
        <div className="p-3 bg-red-50 text-red-700 rounded">
          <div>
            <strong>Not matched</strong>
          </div>
          <div className="text-sm">
            {validation.error || "Ticket not found"}
          </div>
          <button
            className="mt-2 px-3 py-1 bg-red-100 hover:bg-red-200 rounded"
            onClick={handleScanAgain}
          >
            Scan again
          </button>
        </div>
      );
    }

    // STICKER MODE - Show name and organization for printing
    if (isStickerMode) {
      return (
        <div className="p-3 rounded border bg-white text-gray-900">
          <div
            className="border rounded bg-gray-50 p-3"
            style={{ maxWidth: 420 }}
          >
            <div className="text-xl font-extrabold leading-tight text-[#1B3A8A]">
              {stickerData.name || "—"}
            </div>
            <div className="text-base font-semibold leading-snug mt-1 text-gray-700">
              {stickerData.organization || "—"}
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              className="px-4 py-2 bg-[#196e87] text-white rounded hover:bg-[#0f5568]"
              onClick={handleManualPrint}
              disabled={!stickerData.name && !stickerData.organization}
            >
              🖨️ Print Sticker
            </button>
            <button
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded"
              onClick={handleScanAgain}
            >
              Scan again
            </button>
          </div>
        </div>
      );
    }

    // BADGE MODE
    const t = validation.ticket || {};
    return (
      <div className="p-3 bg-green-50 text-green-800 rounded">
        <div className="font-semibold">✅ Ticket Matched</div>
        <div className="text-sm mt-1">
          <strong>Name:</strong> {t.name || t.full_name || "-"}
        </div>
        <div className="text-sm">
          <strong>Company:</strong> {t.company || t.organization || "-"}
        </div>
        <div className="text-sm">
          <strong>Category:</strong> {t.category || t.ticket_category || "-"}
        </div>
        <div className="mt-3 flex gap-2">
          <button
            className="px-4 py-2 bg-[#196e87] text-white rounded hover:bg-[#0f5568]"
            onClick={() => handlePrintBadge(ticketId)}
            disabled={isLoadingPDF}
          >
            {isLoadingPDF ? "⏳ Loading..." : "🖨️ Print Badge"}
          </button>
          <button
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded"
            onClick={handleScanAgain}
          >
            Scan again
          </button>
        </div>
      </div>
    );
  }

  // Print Preview Modal
  function renderPrintPreview() {
    if (!showPrintPreview) return null;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b">
            <h3 className="text-lg font-semibold">Badge Preview - {ticketId}</h3>
            <button
              onClick={handleClosePreview}
              className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
            >
              ×
            </button>
          </div>
          
          {/* PDF Preview */}
          <div className="flex-1 p-4 overflow-auto" style={{ minHeight: "60vh" }}>
            {pdfUrl ? (
              <iframe
                src={pdfUrl}
                className="w-full h-full border-0"
                style={{ minHeight: "60vh" }}
                title="Badge Preview"
              />
            ) : printError ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-red-600">
                  <div className="text-4xl mb-2">⚠️</div>
                  <div className="text-lg font-semibold">Error Loading Preview</div>
                  <div className="text-sm mt-2">{printError}</div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-gray-500">
                  <div className="animate-spin text-4xl mb-2">⏳</div>
                  <div className="text-lg">Loading preview...</div>
                </div>
              </div>
            )}
          </div>
          
          {/* Actions */}
          <div className="flex items-center justify-between p-4 border-t bg-gray-50">
            <div className="text-sm text-gray-600">
              {validation?.ticket?.name && (
                <span>Attendee: <strong>{validation.ticket.name}</strong></span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleClosePreview}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded"
              >
                Cancel
              </button>
              <button
                onClick={handleDownload}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                disabled={!pdfUrl}
              >
                💾 Download
              </button>
              <button
                onClick={handlePrint}
                className="px-4 py-2 bg-[#196e87] text-white rounded hover:bg-[#0f5568]"
                disabled={!pdfUrl}
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
          {/* Video element - shown/hidden based on showVideo state */}
          {showVideo ? (
            <video
              ref={videoRef}
              style={{ 
                width: "100%", 
                maxHeight: 480, 
                borderRadius: 8,
              }}
              playsInline
              muted
              autoPlay
            />
          ) : (
            <div 
              className="bg-gray-100 rounded-lg flex items-center justify-center"
              style={{ width: "100%", height: 320, borderRadius: 8 }}
            >
              <div className="text-center text-gray-500">
                <div className="text-4xl mb-2">
                  {validation?.ok ? "✅" : "📷"}
                </div>
                <div className="text-lg font-semibold">
                  {validation?.ok ? "Ticket Validated" : "Camera Paused"}
                </div>
                <div className="text-sm mt-1">
                  {validation?.ok 
                    ? "Click 'Print Badge' to preview and print" 
                    : message.includes("error") || message.includes("Error")
                      ? "Camera access failed"
                      : "Camera stopped"
                  }
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
          <div className="text-xs text-gray-500">
            Mode: {isStickerMode ? "Sticker" : "Badge"}
          </div>
        </div>

        {showDebug && (
          <>
            <div className="mb-3">
              <div className="text-xs text-gray-500">Raw payload:</div>
              <pre className="bg-gray-50 p-2 rounded text-xs max-h-28 overflow-auto">
                {rawPayload || "—"}
              </pre>
            </div>
            <div className="mb-3">
              <div className="text-xs text-gray-500">Extracted ticket id:</div>
              <div className="font-mono text-sm p-2 bg-gray-50 rounded">
                {ticketId || "—"}
              </div>
            </div>
            <div className="mb-3">
              <div className="text-xs text-gray-500">Video visible:</div>
              <div className="font-mono text-sm p-2 bg-gray-50 rounded">
                {showVideo ? "📹 Visible" : "🚫 Hidden"}
              </div>
            </div>
            <div className="mb-3">
              <div className="text-xs text-gray-500">Lock status:</div>
              <div className="font-mono text-sm p-2 bg-gray-50 rounded">
                {isLockedRef.current ? "LOCKED 🔒" : "UNLOCKED 🔓"}
              </div>
            </div>
          </>
        )}

        {/* VALIDATION RESULT - Stays visible until user clicks Scan Again */}
        {validation && renderValidation()}
      </div>
      
      {/* PRINT PREVIEW MODAL - Shows when user clicks Print Badge */}
      {renderPrintPreview()}
    </div>
  );
}