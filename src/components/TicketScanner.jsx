import React, { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

/**
 * TicketScanner (frontend)
 * - Uses API_BASE (env/window) to call the backend validate/scan endpoints absolutely.
 * - Extracts ticket id locally when possible and sends it in { ticketId }.
 * - Avoids custom headers to keep CORS simple.
 *
 * Set REACT_APP_API_BASE at build time (e.g. https://api.your-backend.com) or set window.__API_BASE__ at runtime.
 */

const API_BASE =
  (typeof process !== "undefined" && process.env && process.env.REACT_APP_API_BASE) ||
  (typeof window !== "undefined" && (window.__API_BASE__ || window.__BACKEND_ORIGIN__ || null)) ||
  (typeof window !== "undefined" && window.location && window.location.origin) ||
  "";

function apiUrl(path) {
  if (!path) path = "";
  const s = String(path).trim();
  if (!s) return s;
  if (/^https?:\/\//i.test(s)) return s;
  const base = String(API_BASE).replace(/\/$/, "");
  return `${base}${s.startsWith("/") ? s : `/${s}`}`;
}

/* safe parsing helpers reused on frontend */
function extractTicketIdFromObject(obj) {
  if (!obj || typeof obj !== "object") return null;
  const keys = ["ticket_code","ticketCode","ticket_id","ticketId","ticket","code","c","id","t","tk"];
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      const v = obj[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
    }
  }
  // nested
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
  const m = String(input).match(/\b\d{4,12}\b/);
  return m ? m[0] : null;
}


export default function TicketScanner({ apiPath = null, autoPrintOnValidate = false }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);
  const scanningRef = useRef(false);

  const [message, setMessage] = useState("Scanning for QR…");
  const [rawPayload, setRawPayload] = useState("");
  const [ticketId, setTicketId] = useState(null);
  const [validation, setValidation] = useState(null);

  // derive absolute endpoints
  const validateUrl = apiUrl("/api/tickets/validate");
  const printUrl = apiUrl("/api/tickets/scan");


  useEffect(() => {
    let mounted = true;
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (!mounted) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");

        const tick = () => {
          if (!mounted) return;
          try {
            if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
              canvas.width = videoRef.current.videoWidth;
              canvas.height = videoRef.current.videoHeight;
              ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" });
              if (code && !scanningRef.current) {
                handleRawScan(code.data);
              }
            }
          } catch (e) {
            console.warn("frame read error", e && e.message);
          }
          rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        console.error("Camera start error", err);
        setMessage(`Camera error: ${err.message || err}`);
      }
    }

    startCamera();

    return () => {
      mounted = false;
      try { if (rafRef.current) cancelAnimationFrame(rafRef.current); } catch {}
      try { if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop()); } catch {}
    };
   
  }, []);

  async function handleRawScan(data) {
    scanningRef.current = true;
    setRawPayload(String(data));
    setMessage("QR detected — extracting id...");
    setValidation(null);

    // extract best guess locally (helps reduce server work and supports encoded JSON)
    const extracted = extractTicketId(String(data));
    if (!extracted) {
      setMessage("QR scanned but no ticket id found.");
      setValidation({ ok: false, error: "No ticket id extracted" });
      setTimeout(() => { scanningRef.current = false; }, 700);
      return;
    }

    setTicketId(extracted);
    setMessage(`Validating ticket: ${extracted}...`);

    try {
      const res = await fetch(validateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: extracted }),
        credentials: "include"
      });
      const js = await res.json().catch(() => ({}));
      if (!res.ok || !js || !js.success) {
        setValidation({ ok: false, error: js?.error || `Validate failed (${res.status})` });
        setMessage("❌ Ticket not matched");
      } else {
        setValidation({ ok: true, ticket: js.ticket || js });
        setMessage("✅ Ticket matched");
        if (autoPrintOnValidate) {
          await doPrint(extracted);
        }
      }
    } catch (e) {
      console.error("[TicketScanner] validate error", e);
      setValidation({ ok: false, error: e.message || String(e) });
      setMessage("Validation request error");
    } finally {
      setTimeout(() => { scanningRef.current = false; }, 800);
    }
  }

  async function doPrint(id) {
    if (!id) return;
    setMessage("Requesting print...");
    try {
      const res = await fetch(printUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: id }),
        credentials: "include"
      });
      if (!res.ok) {
        const js = await res.json().catch(() => null);
        setValidation({ ok: false, error: js?.error || `Print failed (${res.status})` });
        setMessage("Print request failed");
        return;
      }
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/pdf")) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        setMessage("PDF opened in new tab");
      } else {
        const js = await res.json().catch(() => null);
        console.log("[TicketScanner] print response:", js);
        setMessage("Print returned non-PDF response");
      }
    } catch (e) {
      console.error("Print error", e);
      setMessage("Print error");
    }
  }

  function renderValidation() {
    if (!validation) return null;
    if (!validation.ok) return (
      <div className="p-3 bg-red-50 text-red-700 rounded">
        <div><strong>Not matched</strong></div>
        <div className="text-sm">{validation.error || "Ticket not found"}</div>
      </div>
    );
    const t = validation.ticket || {};
    return (
      <div className="p-3 bg-green-50 text-green-800 rounded">
        <div className="font-semibold">Matched</div>
        <div className="text-sm">{t.name || t.n || t.full_name || ""}</div>
        <div className="text-xs text-gray-700">{t.company || t.org || ""} — {t.category || t.cat || t.ticket_category || ""}</div>
        <div className="mt-2 flex gap-2">
          <button className="px-3 py-1 bg-[#196e87] text-white rounded" onClick={() => doPrint(ticketId)}>Print</button>
          <button className="px-3 py-1 bg-gray-100 rounded" onClick={() => { setValidation(null); setTicketId(null); setRawPayload(""); setMessage("Scanning for QR…"); }}>Reset</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="bg-white rounded-lg shadow p-3">
        <div className="mb-3">
          <video ref={videoRef} style={{ width: "100%", maxHeight: 480, borderRadius: 8 }} playsInline muted />
          <canvas ref={canvasRef} style={{ display: "none" }} />
        </div>

        <div className="flex items-center justify-between mb-2">
          <div className="text-sm text-gray-700">{message}</div>
          <div className="text-xs text-gray-500">Status: {scanningRef.current ? "scanning" : "idle"}</div>
        </div>

        <div className="mb-3">
          <div className="text-xs text-gray-500">Raw payload (for debugging):</div>
          <pre className="bg-gray-50 p-2 rounded text-xs max-h-28 overflow-auto">{rawPayload || "—"}</pre>
        </div>

        <div className="mb-3">
          <div className="text-xs text-gray-500">Extracted ticket id:</div>
          <div className="font-mono text-sm p-2 bg-gray-50 rounded">{ticketId || "—"}</div>
        </div>

        <div>{renderValidation()}</div>
      </div>
    </div>
  );
}
