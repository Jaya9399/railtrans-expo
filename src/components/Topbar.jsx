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
  const normalized = cleaned.length === 3 ? cleaned.split("").map((c) => c + c).join("") : cleaned;
  const bigint = parseInt(normalized, 16);
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

/**
 * Topbar component
 * - onToggleSidebar: called on mobile hamburger click to open the sidebar drawer.
 * - Does not fix position; AdminLayout should position it (so layout remains consistent).
 * - Responsible for loading logo and primary color from /api/admin-config (with localStorage fallback).
 * - Shows a Scanner button which opens a modal with TicketScanner (lazy loaded).
 */
export default function Topbar({ onToggleSidebar = () => {} }) {
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

  // load admin topbar config (logo + primary color)
  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    async function loadConfig() {
      // 1) try server
      try {
        const res = await fetch("/api/admin-config", { signal: controller.signal });
        if (res.ok) {
          const json = await res.json().catch(() => null);
          if (mounted && json && typeof json === "object") {
            if (json.logoUrl) setLogo(json.logoUrl);
            if (json.primaryColor) setPrimaryColor(safeHex(json.primaryColor) || "#196e87");
            try {
              window.localStorage.setItem(
                "admin:topbar",
                JSON.stringify({ logoUrl: json.logoUrl || "", primaryColor: json.primaryColor || "" })
              );
            } catch {}
            return;
          }
        }
      } catch (err) {
        // ignore and fall back to localStorage
      }

      // 2) fallback to localStorage
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
        className="h-16 w-full flex items-center px-4 md:px-6 shadow"
        style={{ backgroundColor: primaryColor }}
      >
        <div className="flex items-center w-full">
          {/* Mobile hamburger: shown only on small screens */}
          <button
            onClick={onToggleSidebar}
            className="md:hidden mr-3 p-2 rounded bg-black/10 text-white hover:bg-black/20"
            aria-label="Toggle sidebar"
            title="Open menu"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {/* Logo */}
          <img
            src={logo}
            alt="RailTrans Expo"
            className="h-10 w-auto mr-4"
            style={{ objectFit: "contain" }}
            onError={(e) => {
              // fallback to local asset if remote logo fails
              try {
                e.currentTarget.src = "/images/logo.png";
              } catch {}
            }}
          />

          {/* spacer */}
          <div className="flex-1" />

          {/* Right controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={openScanner}
              className="ml-2 px-3 py-2 rounded text-white font-semibold flex items-center gap-2"
              style={{ backgroundColor: buttonBg }}
              title="Open Gate Scanner"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18M3 12h18M3 17h18" />
              </svg>
              <span className="hidden sm:inline">Scanner</span>
            </button>
          </div>
        </div>
      </header>

      {/* Scanner modal (lazy-loaded component) */}
      {scannerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          aria-modal="true"
          role="dialog"
        >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={closeScanner}
            aria-hidden="true"
          />

          <div className="relative w-[96%] sm:w-[80%] md:w-[720px] max-w-full bg-white rounded-lg shadow-2xl overflow-hidden z-10">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="text-lg font-semibold" style={{ color: primaryColor }}>
                Ticket Scanner
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={closeScanner}
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