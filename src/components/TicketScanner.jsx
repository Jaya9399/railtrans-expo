import React, { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

/* =========================
   API BASE RESOLVER (FIX #1)
   ========================= */
function resolveApiBase(passed) {
  if (passed && typeof passed === "string" && passed.trim()) {
    return passed.replace(/\/+$/, "");
  }
  if (typeof window !== "undefined" && window.__API_BASE__) {
    return String(window.__API_BASE__).replace(/\/+$/, "");
  }
  if (typeof process !== "undefined" && process.env?.REACT_APP_API_BASE) {
    return String(process.env.REACT_APP_API_BASE).replace(/\/+$/, "");
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "";
}

/* =========================
   QR / TICKET PARSING UTILS
   ========================= */
function tryParseJsonSafe(str) {
  try { return JSON.parse(str); } catch { return null; }
}

function looksLikeBase64(s) {
  return typeof s === "string"
    && /^[A-Za-z0-9+/=]+$/.test(s.replace(/\s+/g, ""))
    && s.length % 4 === 0;
}

function extractTicketIdFromObject(obj) {
  if (!obj || typeof obj !== "object") return null;
  const keys = [
    "ticket_code","ticketCode",
    "ticket_id","ticketId",
    "ticket","code","c","id","t","tk"
  ];
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      const v = obj[k];
      if (v != null && String(v).trim()) return String(v).trim();
    }
  }
  return null;
}

function tryParseTicketId(input) {
  if (input == null) return null;

  if (typeof input === "number") return String(input);

  if (typeof input === "string") {
    const s = input.trim();
    if (!s) return null;

    const parsed = tryParseJsonSafe(s);
    if (parsed) {
      const f = extractTicketIdFromObject(parsed);
      if (f) return f;
    }

    if (looksLikeBase64(s)) {
      try {
        const dec = atob(s);
        const p2 = tryParseJsonSafe(dec);
        if (p2) {
          const f2 = extractTicketIdFromObject(p2);
          if (f2) return f2;
        }
        const tok = dec.match(/[A-Za-z0-9\-_.]{3,64}/);
        if (tok) return tok[0];
      } catch {}
    }

    const token = s.match(/[A-Za-z0-9\-_.]{3,64}/);
    if (token) return token[0];

    return null;
  }

  if (typeof input === "object") {
    return extractTicketIdFromObject(input);
  }

  return null;
}

/* =========================
   MAIN COMPONENT
   ========================= */
export default function TicketScanner({ apiBase }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState(null);
  const [message, setMessage] = useState("Scanning for QR…");

  const API_BASE = resolveApiBase(apiBase);

  /* =========================
     CAMERA + QR LOOP
     ========================= */
  useEffect(() => {
    let mounted = true;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false
        });

        if (!mounted) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");

        const tick = () => {
          if (!mounted || validation?.ok) return;

          if (
            videoRef.current &&
            videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA
          ) {
            canvas.width = videoRef.current.videoWidth;
            canvas.height = videoRef.current.videoHeight;

            ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);

            const code = jsQR(img.data, img.width, img.height, {
              inversionAttempts: "attemptBoth"
            });

            if (code && !busy) handleScan(code.data);
          }
          rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
      } catch (e) {
        console.error(e);
        setMessage("Camera access failed");
      }
    }

    startCamera();

    return () => {
      mounted = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(t => t.stop());
      }
    };
  }, [busy, validation]);

  /* =========================
     SCAN HANDLER (FIX #2 + #3)
     ========================= */
  async function handleScan(data) {
    if (busy || validation?.ok) return;

    setBusy(true);

    const extracted = tryParseTicketId(data);
    if (!extracted) {
      setMessage("Invalid QR");
      setBusy(false);
      return;
    }

    setMessage(`Validating ${extracted}…`);

    try {
      const url = `${API_BASE}/api/tickets/validate`;
      console.log("[Scanner] POST", url);

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: extracted })
      });

      const text = await res.text();   // IMPORTANT
      let js = null;

      try {
        js = text ? JSON.parse(text) : null;
      } catch {
        throw new Error("Server returned non-JSON response");
      }

      if (!res.ok || !js?.success) {
        setValidation({ ok: false, error: js?.error || `HTTP ${res.status}` });
        setMessage("Ticket not matched");
      } else {
        setValidation({ ok: true, ticket: js.ticket });
        setMessage("Ticket matched ✔");
      }
    } catch (e) {
      console.error(e);
      setValidation({ ok: false, error: e.message });
      setMessage("Validation error");
    } finally {
      setBusy(false);
    }
  }

  /* =========================
     UI
     ========================= */
  return (
    <div>
      <video
        ref={videoRef}
        style={{ width: "100%", maxHeight: 480, borderRadius: 8 }}
        playsInline
        muted
      />
      <canvas ref={canvasRef} style={{ display: "none" }} />

      <div style={{ marginTop: 12, fontWeight: 600 }}>{message}</div>

      {validation && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 6,
            border: validation.ok ? "2px solid green" : "2px solid red"
          }}
        >
          {validation.ok ? (
            <>
              <strong>Matched</strong><br />
              {validation.ticket.name}<br />
              {validation.ticket.company}<br />
              {validation.ticket.category}
            </>
          ) : (
            <>
              <strong>Not matched</strong><br />
              {validation.error}
            </>
          )}
        </div>
      )}
    </div>
  );
}
