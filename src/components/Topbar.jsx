import React, { useState, useEffect, useCallback, Suspense } from "react";

// Lazy-load scanner to keep bundle small
const TicketScanner = React.lazy(() => import("./TicketScanner"));

function safeHex(h) {
  if (!h) return null;
  const s = String(h).trim();
  return s.startsWith("#") ? s : `#${s}`;
}

function hexToRgb(hex) {
  const h = safeHex(hex);
  if (!h) return null;
  const cleaned = h.replace("#", "");
  const bigint = parseInt(cleaned.length === 3 ? cleaned.split("").map(c => c + c).join("") : cleaned, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

function darkenHex(hex, amount = 0.12) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const r = Math.max(0, Math.floor(rgb.r * (1 - amount)));
  const g = Math.max(0, Math.floor(rgb.g * (1 - amount)));
  const b = Math.max(0, Math.floor(rgb.b * (1 - amount)));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

export default function Topbar() {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [logo, setLogo] = useState("/images/logo.png");
  const [primaryColor, setPrimaryColor] = useState("#196e87");

  const openScanner = useCallback(() => setScannerOpen(true), []);
  const closeScanner = useCallback(() => setScannerOpen(false), []);

  // close on ESC
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") closeScanner();
    }
    if (scannerOpen) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scannerOpen, closeScanner]);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    async function loadConfig() {
      // First try server
      try {
        const res = await fetch("/api/admin-config", { signal: controller.signal });
        if (res.ok) {
          const json = await res.json().catch(() => null);
          if (mounted && json && typeof json === "object") {
            if (json.logoUrl) setLogo(json.logoUrl);
            if (json.primaryColor) setPrimaryColor(safeHex(json.primaryColor) || "#196e87");
            // persist locally for offline fallback
            try {
              window.localStorage.setItem("admin:topbar", JSON.stringify({ logoUrl: json.logoUrl || "", primaryColor: json.primaryColor || "" }));
            } catch {}
            return;
          }
        }
      } catch (err) {
        // fetch failed, fall through to localStorage
      }

      // Fallback to localStorage
      try {
        const raw = window.localStorage.getItem("admin:topbar");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.logoUrl) setLogo(parsed.logoUrl);
          if (parsed?.primaryColor) setPrimaryColor(safeHex(parsed.primaryColor) || "#196e87");
        }
      } catch (e) {
        // ignore
      }
    }

    loadConfig();
    return () => {
      mounted = false;
      controller.abort();
    };
  }, []);

  const buttonBg = darkenHex(primaryColor, 0.14);

  return (
    <>
      <header
        className="w-full shadow flex items-center px-8 py-4"
        style={{ backgroundColor: primaryColor }}
      >
        <div className="flex items-center w-full">
          <img
            src={logo}
            alt="Logo"
            className="h-12 w-auto mr-4"
            style={{ objectFit: "contain" }}
            onError={(e) => { e.currentTarget.src = "/images/logo.png"; }}
          />
          <div className="flex-1" />
          {/* Scanner button on the right */}
          <button
            onClick={openScanner}
            className="ml-4 px-4 py-2 rounded text-white font-semibold flex items-center gap-2"
            style={{ backgroundColor: buttonBg }}
            title="Open Gate Scanner"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18M3 12h18M3 17h18" />
            </svg>
            Scanner
          </button>
        </div>
      </header>

      {/* Modal for scanner */}
      {scannerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          aria-modal="true"
          role="dialog"
        >
          {/* backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={closeScanner}
            aria-hidden="true"
          />

          {/* dialog */}
          <div className="relative w-[96%] sm:w-[80%] md:w-[720px] max-w-full bg-white rounded-lg shadow-2xl overflow-hidden z-10">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="text-lg font-semibold" style={{ color: primaryColor }}>Ticket Scanner</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    closeScanner();
                  }}
                  className="px-3 py-1 rounded bg-gray-100 text-gray-800"
                >
                  Close
                </button>
              </div>
            </div>

            <div style={{ minHeight: 360 }} className="p-4">
              <Suspense fallback={<div className="text-center py-20" style={{ color: primaryColor }}>Loading scanner…</div>}>
                <TicketScanner
                  apiPath="/api/tickets/scan"
                  onError={(err) => {
                    console.error("Scanner error:", err);
                    alert(err?.message || "Scanner error");
                  }}
                  onSuccess={(result) => {
                    console.log("Scan success:", result);
                    setTimeout(() => closeScanner(), 800);
                  }}
                />
              </Suspense>
            </div>
          </div>
        </div>
      )}
    </>
  );
}