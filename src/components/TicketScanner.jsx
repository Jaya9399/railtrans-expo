import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import jsQR from "jsqr";

console.log("🎯 [TicketScanner] FILE LOADED v3");

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

// ====== STICKER SIZE CONTROLS COMPONENT ======
function StickerControls({ stickerSize, onStickerChange }) {
  const controls = {
    moveUp: () => onStickerChange(prev => ({ ...prev, y: (prev.y || 0) - 5 })),
    moveDown: () => onStickerChange(prev => ({ ...prev, y: (prev.y || 0) + 5 })),
    moveLeft: () => onStickerChange(prev => ({ ...prev, x: (prev.x || 0) - 5 })),
    moveRight: () => onStickerChange(prev => ({ ...prev, x: (prev.x || 0) + 5 })),
    zoomIn: () => onStickerChange(prev => ({ ...prev, scale: Math.min((prev.scale || 100) + 5, 200) })),
    zoomOut: () => onStickerChange(prev => ({ ...prev, scale: Math.max((prev.scale || 100) - 5, 50) })),
    reset: () => onStickerChange({ x: 0, y: 0, scale: 100 }),
  };

  return (
    <div className="bg-white rounded-lg shadow p-3 mb-3 border border-gray-200">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-gray-700 mr-1">📐 Sticker:</span>
        
        {/* Move Controls */}
        <button onClick={controls.moveUp} className="px-2.5 py-1 bg-gray-200 hover:bg-gray-300 rounded text-sm font-medium transition-colors" title="Move Up">⬆</button>
        <button onClick={controls.moveDown} className="px-2.5 py-1 bg-gray-200 hover:bg-gray-300 rounded text-sm font-medium transition-colors" title="Move Down">⬇</button>
        <button onClick={controls.moveLeft} className="px-2.5 py-1 bg-gray-200 hover:bg-gray-300 rounded text-sm font-medium transition-colors" title="Move Left">⬅</button>
        <button onClick={controls.moveRight} className="px-2.5 py-1 bg-gray-200 hover:bg-gray-300 rounded text-sm font-medium transition-colors" title="Move Right">➡</button>
        
        <span className="text-xs text-gray-400">|</span>
        
        {/* Zoom Controls */}
        <button onClick={controls.zoomOut} className="px-2.5 py-1 bg-blue-100 hover:bg-blue-200 rounded text-sm font-medium transition-colors" title="Zoom Out">🔍−</button>
        <span className="text-xs text-gray-600 font-mono min-w-[35px] text-center">{stickerSize?.scale || 100}%</span>
        <button onClick={controls.zoomIn} className="px-2.5 py-1 bg-blue-100 hover:bg-blue-200 rounded text-sm font-medium transition-colors" title="Zoom In">🔍+</button>
        
        <span className="text-xs text-gray-400">|</span>
        
        {/* Reset */}
        <button onClick={controls.reset} className="px-2.5 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded text-sm font-medium transition-colors" title="Reset">↺ Reset</button>
        
        {/* Position Display */}
        <span className="text-xs text-gray-400 ml-auto">
          X: {stickerSize?.x || 0}px | Y: {stickerSize?.y || 0}px
        </span>
      </div>
    </div>
  );
}

// ====== BADGE MODAL ======
function BadgeModal({ ticketId, validation, printUrl, onClose, onScanAgain, stickerSize }) {
  const [pdfUrl, setPdfUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  const pdfUrlRef = useRef(null);

  // Build print URL with sticker size params
  const printUrlWithSize = useMemo(() => {
    const base = printUrl;
    const params = new URLSearchParams();
    if (stickerSize) {
      if (stickerSize.x) params.append('x', stickerSize.x);
      if (stickerSize.y) params.append('y', stickerSize.y);
      if (stickerSize.scale) params.append('scale', stickerSize.scale);
    }
    const query = params.toString();
    return query ? `${base}?${query}` : base;
  }, [printUrl, stickerSize]);

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

    fetch(printUrlWithSize, {
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
  }, [ticketId, printUrlWithSize]);

  const handlePrint = () => {
    if (!pdfUrl) return;
    const printWindow = window.open(pdfUrl, "_blank", "width=800,height=600");
    if (printWindow) {
      printWindow.onload = () => {
        setTimeout(() => {
          try {
            printWindow.focus();
            printWindow.print();
          } catch (e) {
            console.log("Auto-print failed, user can print manually (Ctrl+P)");
          }
        }, 800);
      };
    } else {
      alert("Pop-up blocked! The PDF will open in a new tab. Please use Ctrl+P to print.");
      window.open(pdfUrl, "_blank");
    }
  };

  return createPortal(
    <div style={{ 
      position: "fixed", 
      top: 0, left: 0, right: 0, bottom: 0, 
      zIndex: 99999, 
      background: "rgba(0,0,0,0.7)", 
      display: "flex", 
      alignItems: "center", 
      justifyContent: "center", 
      padding: "20px" 
    }}>
      <div style={{ 
        background: "white", 
        borderRadius: "12px", 
        width: "100%", 
        maxWidth: "850px", 
        height: "90vh",
        display: "flex", 
        flexDirection: "column",
        boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        overflow: "hidden"
      }}>
        
        <div style={{ 
          padding: "14px 20px", 
          borderBottom: "1px solid #e5e7eb", 
          display: "flex", 
          justifyContent: "space-between", 
          alignItems: "center",
          flexShrink: 0
        }}>
          <strong style={{ fontSize: "16px" }}>Badge Preview</strong>
          <button 
            onClick={onClose} 
            style={{ 
              background: "none", 
              border: "none", 
              fontSize: "24px", 
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: "4px",
              color: "#6b7280"
            }}
          >✕</button>
        </div>

        <div style={{ 
          flex: 1, 
          overflow: "auto",
          background: "#f9fafb",
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}>
          {loading && (
            <div style={{ textAlign: "center", color: "#6b7280", padding: "40px" }}>
              <div style={{ fontSize: "48px", marginBottom: "12px" }}>⏳</div>
              <div style={{ fontSize: "16px", fontWeight: 500 }}>Loading badge preview...</div>
              <div style={{ fontSize: "13px", marginTop: "6px", color: "#9ca3af" }}>Please wait</div>
            </div>
          )}
          
          {error && (
            <div style={{ textAlign: "center", color: "#dc2626", padding: "40px" }}>
              <div style={{ fontSize: "48px", marginBottom: "12px" }}>⚠️</div>
              <div style={{ fontSize: "16px", fontWeight: 600 }}>Error Loading Badge</div>
              <div style={{ fontSize: "13px", marginTop: "6px", maxWidth: "400px" }}>{error}</div>
              <button 
                onClick={() => {
                  setError(null);
                  setLoading(true);
                  fetch(printUrlWithSize, {
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
                      setLoading(false);
                    })
                    .catch((err) => {
                      if (mountedRef.current) { setError(err.message); setLoading(false); }
                    });
                }}
                style={{ 
                  marginTop: "12px",
                  padding: "8px 20px", 
                  background: "#fee2e2", 
                  color: "#dc2626", 
                  border: "none", 
                  borderRadius: "6px", 
                  cursor: "pointer",
                  fontWeight: 600
                }}
              >
                🔄 Retry
              </button>
            </div>
          )}
          
          {!loading && !error && pdfUrl && (
            <iframe 
              src={pdfUrl} 
              style={{ 
                width: "100%", 
                height: "100%", 
                border: "none",
                background: "white"
              }} 
              title="Badge Preview"
            />
          )}
        </div>

        <div style={{ 
          padding: "14px 20px", 
          borderTop: "1px solid #e5e7eb", 
          background: "#ffffff", 
          display: "flex", 
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0
        }}>
          <div style={{ fontSize: "13px", color: "#6b7280" }}>
            {validation?.ticket?.name && (
              <span>Attendee: <strong>{validation.ticket.name}</strong></span>
            )}
          </div>
          
          <div style={{ display: "flex", gap: "8px" }}>
            <button 
              onClick={onScanAgain} 
              style={{ 
                padding: "10px 18px", 
                background: "#e5e7eb", 
                border: "none", 
                borderRadius: "6px", 
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: 500
              }}
            >
              🔄 Scan Again
            </button>
            
            <button 
              onClick={onClose} 
              style={{ 
                padding: "10px 18px", 
                background: "#e5e7eb", 
                border: "none", 
                borderRadius: "6px", 
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: 500
              }}
            >
              Close
            </button>
            
            <button 
              onClick={handlePrint} 
              disabled={!pdfUrl} 
              style={{ 
                padding: "10px 24px", 
                background: pdfUrl ? "#196e87" : "#d1d5db", 
                color: "white", 
                border: "none", 
                borderRadius: "6px", 
                cursor: pdfUrl ? "pointer" : "not-allowed",
                fontSize: "14px",
                fontWeight: 600
              }}
            >
              🖨️ Print Badge
            </button>
          </div>
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

  const [status, setStatus] = useState("idle");
  const [statusMsg, setStatusMsg] = useState("Click Start Camera");
  const [errorMsg, setErrorMsg] = useState(null);
  const [ticketId, setTicketId] = useState(null);
  const [validation, setValidation] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  
  // ✅ Sticker size state
  const [stickerSize, setStickerSize] = useState({ x: 0, y: 0, scale: 100 });

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
        
        {/* ✅ STICKER CONTROLS */}
        <StickerControls stickerSize={stickerSize} onStickerChange={setStickerSize} />

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
          stickerSize={stickerSize}
          onClose={() => setModalOpen(false)}
          onScanAgain={handleScanAgain}
        />
      )}
    </div>
  );
}