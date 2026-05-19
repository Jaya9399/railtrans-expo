import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import jsQR from "jsqr";

console.log("🎯 [TicketScanner] FILE LOADED v2");

// ====== API HELPERS ======
const API_BASE = (typeof window !== "undefined" && (window.__API_BASE__ || window.__BACKEND_ORIGIN__ || window.location?.origin)) || "";

function apiUrl(path) {
  if (!path) return "";
  const s = String(path).trim();
  if (/^https?:\/\//i.test(s)) return s;
  return `${String(API_BASE).replace(/\/$/, "")}${s.startsWith("/") ? s : `/${s}`}`;
}

function extractTicketId(input) {
  if (!input) return null;
  const s = String(input).trim();
  try {
    const p = JSON.parse(s);
    if (p?.ticket_code) return String(p.ticket_code);
    if (p?.ticketCode) return String(p.ticketCode);
    if (p?.code) return String(p.code);
    if (p?.id) return String(p.id);
  } catch (_) {}
  const m = s.match(/\b\d{6,8}\b/);
  return m ? m[0] : (s.match(/[A-Za-z0-9]{6,12}/) || [null])[0];
}

// ====== BADGE MODAL ======
function BadgeModal({ ticketId, validation, printUrl, onClose, onScanAgain }) {
  const [pdfUrl, setPdfUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  const pdfUrlRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (!ticketId) { setLoading(false); setError("No ticket ID"); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(printUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketId: String(ticketId) }),
      credentials: "include",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `Error ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled || !mountedRef.current) return;
        const url = URL.createObjectURL(blob);
        pdfUrlRef.current = url;
        setPdfUrl(url);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled || !mountedRef.current) return;
        setError(err.message);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [ticketId, printUrl]);

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 99999, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "white", borderRadius: 12, width: "100%", maxWidth: 800, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between" }}>
          <strong>Badge — {ticketId}</strong>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ flex: 1, minHeight: 400, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {loading && <div style={{ textAlign: "center", color: "#6b7280" }}><div style={{ fontSize: 40 }}>⏳</div><div>Loading...</div></div>}
          {error && <div style={{ textAlign: "center", color: "#dc2626" }}><div style={{ fontSize: 40 }}>⚠️</div><div>{error}</div></div>}
          {!loading && !error && pdfUrl && <iframe src={pdfUrl} style={{ width: "100%", height: "100%", border: "none" }} />}
        </div>
        <div style={{ padding: "12px 20px", borderTop: "1px solid #e5e7eb", background: "#f9fafb", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onScanAgain} style={{ padding: "8px 16px", background: "#e5e7eb", border: "none", borderRadius: 6, cursor: "pointer" }}>Scan Again</button>
          <button onClick={onClose} style={{ padding: "8px 16px", background: "#e5e7eb", border: "none", borderRadius: 6, cursor: "pointer" }}>Close</button>
          <button onClick={() => { if (pdfUrl) { const w = window.open(pdfUrl, "_blank"); setTimeout(() => { try { w.print(); } catch(e) {} }, 1000); } }} disabled={!pdfUrl} style={{ padding: "8px 20px", background: pdfUrl ? "#196e87" : "#d1d5db", color: "white", border: "none", borderRadius: 6, cursor: pdfUrl ? "pointer" : "not-allowed" }}>Print</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ====== MAIN SCANNER ======
export default function TicketScanner(props) {
  console.log("🎯 [TicketScanner] RENDER - props:", Object.keys(props));

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const mountedRef = useRef(true);
  const lockedRef = useRef(false);
  const ticketIdRef = useRef(null);
  const validationRef = useRef(null);
  const cameraStartedRef = useRef(false);

  const [status, setStatus] = useState("idle"); // idle | requesting | active | success | error
  const [statusMsg, setStatusMsg] = useState("Click Start Camera");
  const [errorMsg, setErrorMsg] = useState(null);
  const [ticketId, setTicketId] = useState(null);
  const [validation, setValidation] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const validateUrl = useMemo(() => apiUrl("/api/tickets/validate"), []);
  const printUrl = useMemo(() => apiUrl("/api/tickets/scan"), []);

  const stopCamera = () => {
    console.log("🎯 stopCamera");
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
    cameraStartedRef.current = false;
    setStatus("idle");
  };

  const startCamera = async () => {
    console.log("🎯 startCamera - stream active:", streamRef.current?.active);
    
    // Don't start if already running
    if (streamRef.current?.active) {
      console.log("🎯 Camera already active");
      return;
    }

    stopCamera();
    setErrorMsg(null);
    setStatus("requesting");
    setStatusMsg("Requesting camera...");

    if (!navigator?.mediaDevices?.getUserMedia) {
      setErrorMsg("Camera requires HTTPS or localhost");
      setStatus("error");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }

      streamRef.current = stream;

      // Wait for video element
      if (!videoRef.current) {
        console.log("🎯 Waiting for video element...");
        await new Promise(resolve => setTimeout(resolve, 500));
        if (!videoRef.current) {
          setErrorMsg("Video element not ready");
          setStatus("error");
          return;
        }
      }

      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      
      cameraStartedRef.current = true;
      setStatus("active");
      setStatusMsg("Scanning for QR code...");

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      const tick = () => {
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
            handleQR(qr.data);
            return;
          }
        } catch (e) {}

        if (mountedRef.current && !lockedRef.current) {
          rafRef.current = requestAnimationFrame(tick);
        }
      };

      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      console.error("🎯 Camera error:", err);
      setErrorMsg(err.message || String(err));
      setStatus("error");
      setStatusMsg("Camera error");
    }
  };

  const handleQR = async (data) => {
    lockedRef.current = true;
    stopCamera();
    setStatus("success");

    const id = extractTicketId(String(data));
    if (!id) {
      setValidation({ ok: false, error: "No ID found" });
      setStatusMsg("Invalid QR");
      setTimeout(() => { if (mountedRef.current) lockedRef.current = false; }, 2000);
      return;
    }

    ticketIdRef.current = id;
    setTicketId(id);
    setStatusMsg("Validating: " + id);

    try {
      const res = await fetch(validateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: id }),
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.success) {
        setValidation({ ok: false, error: json.error || "Not found" });
        setStatusMsg("Not matched");
        setTimeout(() => { if (mountedRef.current) lockedRef.current = false; }, 3000);
        return;
      }

      validationRef.current = { ok: true, ticket: json.ticket };
      setValidation({ ok: true, ticket: json.ticket });
      setStatusMsg("✅ Matched!");
      setModalOpen(true);
    } catch (err) {
      setValidation({ ok: false, error: err.message });
      setTimeout(() => { if (mountedRef.current) lockedRef.current = false; }, 3000);
    }
  };

  const handleScanAgain = () => {
    setModalOpen(false);
    setValidation(null);
    setTicketId(null);
    ticketIdRef.current = null;
    validationRef.current = null;
    lockedRef.current = false;
    startCamera();
  };

  // Mount - DON'T auto-start camera, let user click button
  useEffect(() => {
    console.log("🎯 useEffect MOUNT");
    mountedRef.current = true;
    return () => {
      console.log("🎯 useEffect UNMOUNT");
      mountedRef.current = false;
      stopCamera();
    };
  }, []);

  return (
    <div style={{ maxWidth: 500, margin: "0 auto", fontFamily: "system-ui, sans-serif", padding: 10 }}>
      <div style={{ background: "white", borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.1)", padding: 16 }}>
        
        {/* STATUS */}
        <div style={{ marginBottom: 12, padding: "8px 12px", background: "#f0f9ff", borderRadius: 6, fontSize: 13 }}>
          {statusMsg}
        </div>

        {/* ERROR */}
        {errorMsg && (
          <div style={{ padding: 12, marginBottom: 12, background: "#fef2f2", borderRadius: 8, color: "#dc2626", fontSize: 13 }}>
            {errorMsg}
          </div>
        )}

        {/* VIDEO */}
        <video 
          ref={videoRef} 
          style={{ width: "100%", maxHeight: 350, borderRadius: 8, background: "#000", display: status === "active" ? "block" : "none" }} 
          playsInline muted autoPlay 
        />
        
        {status !== "active" && (
          <div style={{ width: "100%", height: 280, borderRadius: 8, background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>{status === "success" ? "✅" : "📷"}</div>
              <button onClick={startCamera} style={{ padding: "12px 32px", background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 16 }}>
                {status === "requesting" ? "⏳ Starting..." : "📷 Start Camera"}
              </button>
            </div>
          </div>
        )}
        
        <canvas ref={canvasRef} style={{ display: "none" }} />

        {/* VALIDATION */}
        {validation && !validation.ok && (
          <div style={{ padding: 12, background: "#fef2f2", borderRadius: 8, marginTop: 12 }}>
            <strong style={{ color: "#991b1b" }}>Not Found</strong>
            <div style={{ color: "#991b1b", fontSize: 13 }}>{validation.error}</div>
            <button onClick={handleScanAgain} style={{ marginTop: 8, padding: "6px 14px", background: "#fecaca", border: "none", borderRadius: 4, cursor: "pointer" }}>Try Again</button>
          </div>
        )}

        {validation && validation.ok && (
          <div style={{ padding: 12, background: "#f0fdf4", borderRadius: 8, marginTop: 12 }}>
            <strong style={{ color: "#166534" }}>✅ Valid!</strong>
            {validation.ticket && (
              <div style={{ fontSize: 13, color: "#166534", marginTop: 4 }}>
                <div>Name: {validation.ticket.name || "—"}</div>
                <div>Company: {validation.ticket.company || "—"}</div>
              </div>
            )}
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              <button onClick={() => setModalOpen(true)} style={{ padding: "8px 16px", background: "#196e87", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
                Print Badge
              </button>
              <button onClick={handleScanAgain} style={{ padding: "8px 16px", background: "#e5e7eb", border: "none", borderRadius: 6, cursor: "pointer" }}>
                Scan Again
              </button>
            </div>
          </div>
        )}
      </div>

      {modalOpen && (
        <BadgeModal
          ticketId={ticketIdRef.current}
          validation={validationRef.current}
          printUrl={printUrl}
          onClose={() => setModalOpen(false)}
          onScanAgain={handleScanAgain}
        />
      )}
    </div>
  );
}