import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
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

  printWin.onload = () => {
    try {
      setTimeout(() => {
        printWin.focus();
        printWin.print();
      }, 500);
    } catch (_) {}
  };

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
  const scanningLockRef = useRef(false); // Single lock to prevent any scanning
  const mountedRef = useRef(true);
  const scanTimeoutRef = useRef(null);

  const [message, setMessage] = useState("Scanning for QR…");
  const [rawPayload, setRawPayload] = useState("");
  const [ticketId, setTicketId] = useState(null);
  const [validation, setValidation] = useState(null);
  const [cameraActive, setCameraActive] = useState(true);

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

  // Function to stop camera completely
  const stopCamera = useCallback(() => {
    // Clear any pending scan timeout
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }

    // Stop animation frame
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    // Stop media stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    // Clear video source
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraActive(false);
  }, []);

  // Function to start camera scanning
  const startCamera = useCallback(async () => {
    try {
      // Clean up any existing stream first
      stopCamera();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      if (!mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraActive(true);

      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      const tick = () => {
        // Check all conditions that should stop scanning
        if (!mountedRef.current) return;
        if (scanningLockRef.current) return;
        if (!videoRef.current || !canvasRef.current) return;
        if (videoRef.current.readyState !== videoRef.current.HAVE_ENOUGH_DATA) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }

        try {
          canvas.width = videoRef.current.videoWidth;
          canvas.height = videoRef.current.videoHeight;
          ctx.drawImage(
            videoRef.current,
            0,
            0,
            canvas.width,
            canvas.height,
          );
          const imageData = ctx.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          );
          const code = jsQR(
            imageData.data,
            imageData.width,
            imageData.height,
            { inversionAttempts: "attemptBoth" },
          );

          if (code && !scanningLockRef.current) {
            handleRawScan(code.data);
            return; // Stop the animation loop after detecting QR
          }
        } catch (e) {
          console.warn("frame read error", e?.message);
        }

        // Only continue if still mounted and not locked
        if (mountedRef.current && !scanningLockRef.current) {
          rafRef.current = requestAnimationFrame(tick);
        }
      };

      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      console.error("Camera start error", err);
      setMessage(`Camera error: ${err.message || err}`);
      if (onError) onError(err);
    }
  }, [stopCamera, onError]);

  // Initial camera start
  useEffect(() => {
    mountedRef.current = true;
    scanningLockRef.current = false;
    startCamera();

    return () => {
      mountedRef.current = false;
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  async function handleRawScan(data) {
    // Double-check lock
    if (scanningLockRef.current) {
      console.log("Scan locked, ignoring QR detection");
      return;
    }

    // Lock immediately to prevent any further scanning
    scanningLockRef.current = true;
    
    // Stop camera and animation frame
    stopCamera();

    setRawPayload(String(data));
    setMessage("QR detected — processing...");
    setValidation(null);

    const extracted = extractTicketId(String(data));
    if (!extracted) {
      setMessage("QR scanned but no ticket id found.");
      setValidation({ ok: false, error: "No ticket id extracted" });
      if (onError) onError(new Error("No ticket id extracted"));
      
      // Unlock after a delay for error case
      scanTimeoutRef.current = setTimeout(() => {
        scanningLockRef.current = false;
        scanTimeoutRef.current = null;
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
        
        // Unlock after error
        scanTimeoutRef.current = setTimeout(() => {
          scanningLockRef.current = false;
          scanTimeoutRef.current = null;
        }, 2000);
      } else {
        // SUCCESS - Keep everything locked
        setValidation({ ok: true, ticket: js.ticket || js });
        setMessage("✅ Ticket matched");

        if (onSuccess) onSuccess(js.ticket || js);

        // Auto-print if enabled
        if (autoPrintOnValidate && isStickerMode) {
          const nameOrg = extractNameAndOrganization(js.ticket || js);
          printSticker({ ...nameOrg, page: stickerPageSize });
        } else if (autoPrintOnValidate && !isStickerMode) {
          await doPrint(extracted);
        }
        
        // DO NOT unlock - stay locked until user clicks "Scan again"
      }
    } catch (e) {
      console.error("[TicketScanner] validate error", e);
      setValidation({ ok: false, error: e.message || String(e) });
      setMessage("Validation request error");
      if (onError) onError(e);
      
      // Unlock after error
      scanTimeoutRef.current = setTimeout(() => {
        scanningLockRef.current = false;
        scanTimeoutRef.current = null;
      }, 2000);
    }
  }

  async function doPrint(id) {
    if (!id) return;

    const printWin = window.open("", "_blank", "width=800,height=600");
    if (!printWin) {
      setMessage("Popup blocked — allow popups and try again");
      return;
    }

    setMessage("Requesting print...");
    try {
      const res = await fetch(printUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: String(id) }),
        credentials: "include",
      });

      if (!res.ok) {
        printWin.close();
        const js = await res.json().catch(() => null);
        setValidation((prev) =>
          prev?.ok
            ? prev
            : { ok: false, error: js?.error || `Print failed (${res.status})` },
        );
        setMessage("Print request failed");
        return;
      }

      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/pdf")) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        printWin.location.href = url;
        printWin.onload = () => {
          try {
            printWin.focus();
            printWin.print();
          } catch (_) {}
        };
        setMessage("PDF opened — print dialog should appear");
      } else {
        printWin.close();
        const js = await res.json().catch(() => null);
        console.log("[TicketScanner] print response:", js);
        setMessage("Print returned non-PDF response");
      }
    } catch (e) {
      if (printWin && !printWin.closed) printWin.close();
      console.error("Print error", e);
      setMessage("Print error");
    }
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
    // Clear any pending timeouts
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }

    // Unlock scanning
    scanningLockRef.current = false;

    // Clear validation state
    setValidation(null);

    // Clear scanned data
    setTicketId(null);
    setRawPayload("");

    // Restore scanner UI
    setMessage("Scanning for QR…");

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
            onClick={() => doPrint(ticketId)}
          >
            🖨️ Print Badge
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

  return (
    <div>
      <div className="bg-white rounded-lg shadow p-3">
        <div className="mb-3">
          {/* Show video only when camera is active */}
          {cameraActive && (
            <video
              ref={videoRef}
              style={{ width: "100%", maxHeight: 480, borderRadius: 8 }}
              playsInline
              muted
            />
          )}
          {/* Show placeholder when camera is not active */}
          {!cameraActive && (
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
                  {validation?.ok ? "Ready to print or scan again" : "Click 'Scan again' to restart"}
                </div>
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
              <div className="text-xs text-gray-500">Lock status:</div>
              <div className="font-mono text-sm p-2 bg-gray-50 rounded">
                {scanningLockRef.current ? "LOCKED 🔒" : "UNLOCKED 🔓"}
              </div>
            </div>
          </>
        )}

        <div>{renderValidation()}</div>
      </div>
    </div>
  );
}