import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import jsQR from "jsqr";

console.log("🔵 [TicketScanner] Module loaded");

const API_BASE =
  (typeof process !== "undefined" && process.env?.REACT_APP_API_BASE) ||
  (typeof window !== "undefined" && (window.__API_BASE__ || window.__BACKEND_ORIGIN__)) ||
  (typeof window !== "undefined" && window.location?.origin) ||
  "";

function apiUrl(path) {
  if (!path) return "";
  const s = String(path).trim();
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

// ADDED: Missing printSticker function
function normalizeStickerText(v) {
  try { return String(v ?? "").replace(/\s+/g, " ").trim() || ""; } catch { return ""; }
}

function printSticker({ name, organization, page = { w: "80mm", h: "50mm" } }) {
  const printWin = window.open("", "_blank", "width=600,height=400");
  if (!printWin) { alert("Please allow popups"); return; }
  const safeName = normalizeStickerText(name) || "Guest";
  const safeOrg = normalizeStickerText(organization) || "Visitor";
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:${page.w} ${page.h};margin:0}*{margin:0;padding:0;box-sizing:border-box}
    html,body{height:100%;background:#fff;font-family:Arial,sans-serif}
    body{display:flex;align-items:center;justify-content:center}
    .s{width:${page.w};height:${page.h};padding:8mm 6mm;border:2px solid #1B3A8A;border-radius:4px;display:flex;flex-direction:column;justify-content:center}
    .n{font-size:20pt;font-weight:800;color:#1B3A8A}.o{font-size:12pt;font-weight:600;color:#333;margin-top:4px}
    .l{height:1px;background:#ddd;margin:6px 0}.e{font-size:8pt;color:#666;margin-top:6px;text-align:center}
    @media print{body{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}.s{box-shadow:none!important}}
  </style></head><body><div class="s"><div class="n">${safeName}</div><div class="o">${safeOrg}</div><div class="l"></div><div class="e">RailTrans Expo 2026</div></div></body></html>`;
  printWin.document.write(html);
  printWin.document.close();
}

// ── Portal Badge Modal ────────────────────────────────────────────────────────
function BadgeModal({ ticketId, validation, printUrl, onClose, onScanAgain }) {
  const [status, setStatus] = useState("loading");
  const [pdfUrl, setPdfUrl] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const pdfUrlRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (!ticketId) {
      setStatus("error");
      setErrorMsg("No ticket ID");
      return;
    }

    let cancelled = false;
    setStatus("loading");
    setErrorMsg(null);

    fetch(printUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketId: String(ticketId) }),
      credentials: "include",
    })
      .then(async (res) => {
        if (!res.ok) {
          const js = await res.json().catch(() => null);
          throw new Error(js?.error || `Error ${res.status}`);
        }
        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("application/pdf")) throw new Error("Not a PDF");
        return res.blob();
      })
      .then((blob) => {
        if (cancelled || !mountedRef.current) return;
        const url = URL.createObjectURL(blob);
        pdfUrlRef.current = url;
        setPdfUrl(url);
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled || !mountedRef.current) return;
        setStatus("error");
        setErrorMsg(err.message);
      });

    return () => { cancelled = true; };
  }, [ticketId, printUrl]);

  function handlePrint() {
    if (!pdfUrl) return;
    const win = window.open(pdfUrl, "_blank");
    if (win) {
      const check = setInterval(() => {
        try {
          if (win.document?.readyState === "complete") {
            clearInterval(check);
            win.print();
          }
        } catch (e) { clearInterval(check); }
      }, 200);
    } else {
      // Fallback
      const a = document.createElement("a");
      a.href = pdfUrl;
      a.target = "_blank";
      a.click();
    }
  }

  function handleRetry() {
    if (pdfUrlRef.current) { URL.revokeObjectURL(pdfUrlRef.current); pdfUrlRef.current = null; }
    setPdfUrl(null);
    setErrorMsg(null);
    setStatus("loading");

    fetch(printUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketId: String(ticketId) }),
      credentials: "include",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed");
        return res.blob();
      })
      .then((blob) => {
        if (!mountedRef.current) return;
        const url = URL.createObjectURL(blob);
        pdfUrlRef.current = url;
        setPdfUrl(url);
        setStatus("ready");
      })
      .catch((err) => {
        if (mountedRef.current) { setStatus("error"); setErrorMsg(err.message); }
      });
  }

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "rgba(0,0,0,0.6)" }}>
      <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 25px 80px rgba(0,0,0,0.4)", width: "100%", maxWidth: 880, maxHeight: "92vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid #e5e7eb" }}>
          <strong>Badge Preview — {ticketId}</strong>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 26, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ flex: 1, minHeight: 450, display: "flex", flexDirection: "column" }}>
          {status === "loading" && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 48 }}>⏳</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>Loading badge...</div>
              </div>
            </div>
          )}
          {status === "error" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#dc2626", padding: 20 }}>
              <div style={{ fontSize: 48 }}>⚠️</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>Error</div>
              <div style={{ marginTop: 8 }}>{errorMsg}</div>
              <button onClick={handleRetry} style={{ marginTop: 16, padding: "10px 24px", background: "#fee2e2", color: "#dc2626", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>
                🔄 Retry
              </button>
            </div>
          )}
          {status === "ready" && pdfUrl && (
            <iframe src={pdfUrl} style={{ flex: 1, width: "100%", border: "none" }} title="Badge Preview" />
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 20px", borderTop: "1px solid #e5e7eb", background: "#f9fafb" }}>
          <span style={{ fontSize: 13, color: "#6b7280" }}>
            {validation?.ticket?.name && <span>Attendee: <strong>{validation.ticket.name}</strong></span>}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onScanAgain} style={{ padding: "8px 16px", background: "#e5e7eb", border: "none", borderRadius: 6, cursor: "pointer" }}>🔄 Scan Again</button>
            <button onClick={onClose} style={{ padding: "8px 16px", background: "#e5e7eb", border: "none", borderRadius: 6, cursor: "pointer" }}>Close</button>
            <button onClick={handlePrint} disabled={!pdfUrl} style={{ padding: "8px 20px", border: "none", borderRadius: 6, cursor: pdfUrl ? "pointer" : "not-allowed", background: pdfUrl ? "#196e87" : "#9ca3af", color: "#fff", fontWeight: 600 }}>
              🖨️ Print
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Main Scanner ──────────────────────────────────────────────────────────────
export default function TicketScanner({
  autoPrintOnValidate = false,
  mode = "badge",
  showDebug = false,
  stickerPageSize = { w: "80mm", h: "50mm" },
  onError,
  onSuccess,
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const mountedRef = useRef(true);
  const lockedRef = useRef(false);
  const ticketIdRef = useRef(null);
  const validationRef = useRef(null);

  const [message, setMessage] = useState("Starting camera...");
  const [error, setError] = useState(null);
  const [showVideo, setShowVideo] = useState(false);
  const [ticketId, setTicketId] = useState(null);
  const [validation, setValidation] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const validateUrl = useMemo(() => apiUrl("/api/tickets/validate"), []);
  const printUrl = useMemo(() => apiUrl("/api/tickets/scan"), []);
  const isStickerMode = String(mode).toLowerCase() === "sticker";

  const stickerData = useMemo(() => {
    if (!validation?.ok || !validation.ticket) return { name: "", organization: "" };
    return extractNameAndOrganization(validation.ticket);
  }, [validation]);

  function stopCamera() {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
    setShowVideo(false);
  }

  async function startCamera() {
    setError(null);
    stopCamera();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setShowVideo(true);
      setMessage("Scanning for QR code...");

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      function tick() {
        if (!mountedRef.current || lockedRef.current) return;
        if (!videoRef.current || !canvasRef.current) return;
        if (videoRef.current.readyState < 2) { rafRef.current = requestAnimationFrame(tick); return; }

        try {
          canvas.width = videoRef.current.videoWidth;
          canvas.height = videoRef.current.videoHeight;
          ctx.drawImage(videoRef.current, 0, 0);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const qr = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });

          if (qr && !lockedRef.current) {
            onQrDetected(qr.data);
            return;
          }
        } catch (e) {}

        if (mountedRef.current && !lockedRef.current) {
          rafRef.current = requestAnimationFrame(tick);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      console.error("Camera error:", err);
      setError("Camera error: " + (err.message || err));
      setMessage("Camera error");
      setShowVideo(false);
    }
  }

  async function onQrDetected(data) {
    lockedRef.current = true;
    stopCamera();

    const extracted = extractTicketId(String(data));
    if (!extracted) {
      setMessage("No ticket ID found");
      setValidation({ ok: false, error: "No ticket ID found" });
      setTimeout(() => { if (mountedRef.current) lockedRef.current = false; }, 2000);
      return;
    }

    ticketIdRef.current = extracted;
    setTicketId(extracted);
    setMessage("Validating: " + extracted);

    try {
      const res = await fetch(validateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: extracted }),
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.success) {
        setValidation({ ok: false, error: json.error || "Not found" });
        setMessage("Not matched");
        setTimeout(() => { if (mountedRef.current) lockedRef.current = false; }, 2000);
        return;
      }

      const val = { ok: true, ticket: json.ticket };
      validationRef.current = val;
      setValidation(val);
      setMessage("✅ Matched!");
      if (onSuccess) onSuccess(json.ticket);

      if (!isStickerMode) {
        setModalOpen(true);
      }
    } catch (err) {
      setValidation({ ok: false, error: err.message });
      setMessage("Error");
      setTimeout(() => { if (mountedRef.current) lockedRef.current = false; }, 2000);
    }
  }

  function handleScanAgain() {
    setModalOpen(false);
    setValidation(null);
    setTicketId(null);
    ticketIdRef.current = null;
    validationRef.current = null;
    lockedRef.current = false;
    startCamera();
  }

  function handleCloseModal() {
    setModalOpen(false);
    setMessage("✅ Matched — ready to print");
  }

  // Start camera on mount - ONLY ONCE
  useEffect(() => {
    mountedRef.current = true;
    startCamera();
    return () => { mountedRef.current = false; stopCamera(); };
  }, []);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 600, margin: "0 auto" }}>
      <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.1)", padding: 16 }}>
        
        {/* Camera / Placeholder */}
        <div style={{ marginBottom: 12, position: "relative" }}>
          {error && (
            <div style={{ padding: 12, marginBottom: 8, background: "#fef2f2", color: "#dc2626", borderRadius: 8, fontSize: 14 }}>
              {error}
            </div>
          )}
          
          {showVideo ? (
            <video ref={videoRef} style={{ width: "100%", maxHeight: 400, borderRadius: 8, background: "#000" }} playsInline muted autoPlay />
          ) : (
            <div style={{ width: "100%", height: 300, borderRadius: 8, background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 48 }}>{validation?.ok ? "✅" : error ? "⚠️" : "📷"}</div>
                <div style={{ fontSize: 18, fontWeight: 600, marginTop: 8 }}>
                  {validation?.ok ? "Ticket Validated" : error ? "Camera Error" : "Camera Off"}
                </div>
                <div style={{ fontSize: 14, color: "#6b7280", marginTop: 4 }}>
                  {error ? "Check console for details" : message}
                </div>
                {!showVideo && !validation?.ok && (
                  <button onClick={startCamera} style={{ marginTop: 12, padding: "10px 24px", background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
                    🔄 Start Camera
                  </button>
                )}
              </div>
            </div>
          )}
          <canvas ref={canvasRef} style={{ display: "none" }} />
        </div>

        {/* Message */}
        <div style={{ padding: "8px 0", fontSize: 14, color: validation?.ok ? "#166534" : "#374151", fontWeight: validation?.ok ? 600 : 400 }}>
          {message}
        </div>

        {/* Validation Result */}
        {validation && !validation.ok && (
          <div style={{ padding: 12, background: "#fef2f2", borderRadius: 8, marginTop: 8 }}>
            <strong style={{ color: "#991b1b" }}>❌ Not Matched</strong>
            <div style={{ fontSize: 13, color: "#991b1b", marginTop: 4 }}>{validation.error}</div>
            <button onClick={handleScanAgain} style={{ marginTop: 8, padding: "6px 14px", background: "#fecaca", border: "none", borderRadius: 4, cursor: "pointer", color: "#991b1b" }}>
              Scan Again
            </button>
          </div>
        )}

        {validation && validation.ok && (
          <div style={{ padding: 12, background: "#f0fdf4", borderRadius: 8, marginTop: 8 }}>
            <strong style={{ color: "#166534" }}>✅ Ticket Matched</strong>
            {validation.ticket && (
              <div style={{ fontSize: 13, marginTop: 4, color: "#166534" }}>
                <div>Name: {validation.ticket.name || "—"}</div>
                <div>Company: {validation.ticket.company || "—"}</div>
              </div>
            )}
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              {!isStickerMode && (
                <button onClick={() => setModalOpen(true)} style={{ padding: "8px 16px", background: "#196e87", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>
                  🖨️ Print Badge
                </button>
              )}
              {isStickerMode && (
                <button onClick={() => printSticker({ ...stickerData, page: stickerPageSize })} style={{ padding: "8px 16px", background: "#196e87", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>
                  🖨️ Print Sticker
                </button>
              )}
              <button onClick={handleScanAgain} style={{ padding: "8px 16px", background: "#e5e7eb", border: "none", borderRadius: 6, cursor: "pointer" }}>
                Scan Again
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {modalOpen && (
        <BadgeModal
          ticketId={ticketIdRef.current}
          validation={validationRef.current}
          printUrl={printUrl}
          onClose={handleCloseModal}
          onScanAgain={handleScanAgain}
        />
      )}
    </div>
  );
}