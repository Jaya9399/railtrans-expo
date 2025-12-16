import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { generateVisitorBadgePDF } from "../utils/pdfGenerator";

function getApiBase() {
  try {
    if (typeof window !== "undefined" && window.__API_BASE__) return String(window.__API_BASE__).replace(/\/$/, "");
    if (typeof process !== "undefined" && process.env && process.env.REACT_APP_API_BASE) return String(process.env.REACT_APP_API_BASE).replace(/\/$/, "");
  } catch (e) {}
  return ""; // relative paths
}
function buildApiUrl(path) {
  const base = getApiBase();
  if (!path) return base || path;
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("/")) return `${base}${path}`;
  return `${base}/${path}`;
}
function looksLikeBase64(s = "") {
  if (typeof s !== "string") return false;
  const s2 = s.replace(/\s+/g, "");
  return /^[A-Za-z0-9+/=]+$/.test(s2) && (s2.length % 4 === 0);
}
function tryParseJsonSafe(s) {
  try { return JSON.parse(s); } catch { return null; }
}
function extractTicketFromDecoded(obj) {
  if (!obj) return null;
  const prefer = ["ticket_code","ticketCode","ticket_id","ticketId","ticket","code","c","id","tk","t"];
  if (typeof obj === "object") {
    for (const p of prefer) if (Object.prototype.hasOwnProperty.call(obj, p) && obj[p]) return String(obj[p]);
    // deep search
    for (const v of Object.values(obj)) {
      if (typeof v === "object") {
        const found = extractTicketFromDecoded(v);
        if (found) return found;
      }
    }
  }
  return null;
}

export default function TicketDownload() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const entity = (search.get("entity") || "visitors").toString().toLowerCase();
  const id = search.get("id") || "";
  const ticket_code = search.get("ticket_code") || search.get("ticket") || "";
  const [status, setStatus] = useState("starting"); // starting | fetching | generating | done | error
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function safeFetchJson(url, opts = {}) {
      // returns parsed JSON or throws with helpful error containing response text
      const r = await fetch(url, opts);
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      const text = await r.text().catch(() => "");
      if (!r.ok) {
        throw new Error(`Request failed ${r.status} ${r.statusText} - response: ${text.slice(0, 300)}`);
      }
      if (!ct.includes("application/json")) {
        throw new Error(`Expected JSON but got content-type: ${ct} - response: ${text.slice(0, 800)}`);
      }
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error(`Invalid JSON: ${e.message} - response: ${text.slice(0, 800)}`);
      }
    }

    async function run() {
      setStatus("fetching");
      setError("");
      try {
        let visitor = null;
        const attempted = [];

        // 1) Try by id (explicit)
        if (id) {
          const url = buildApiUrl(`/api/${entity}/${encodeURIComponent(String(id))}`);
          attempted.push(url);
          try {
            visitor = await safeFetchJson(url, { headers: { Accept: "application/json" } });
          } catch (err) {
            console.warn("Fetch by id failed, will try ticket_code fallback if available:", err.message || err);
            visitor = null;
          }
        }

        // 2) Try by ticket_code using q=
        if (!visitor && ticket_code) {
          const tryCodes = [ticket_code];
          if (!String(ticket_code).startsWith("TICK-")) tryCodes.push(`TICK-${ticket_code}`);

          // If ticket_code looks like base64, try decoding and extracting
          if (looksLikeBase64(ticket_code)) {
            try {
              const decoded = Buffer ? Buffer.from(ticket_code, "base64").toString("utf8") : atob(ticket_code);
              const parsed = tryParseJsonSafe(decoded);
              const ext = extractTicketFromDecoded(parsed || {});
              if (ext) tryCodes.unshift(ext);
            } catch (e) {}
          }

          for (const tc of tryCodes) {
            const url = buildApiUrl(`/api/${entity}?q=${encodeURIComponent(tc)}&limit=1`);
            attempted.push(url);
            try {
              const arr = await safeFetchJson(url, { headers: { Accept: "application/json" } });
              visitor = Array.isArray(arr) ? (arr[0] || null) : arr;
              if (visitor) break;
            } catch (err) {
              // continue trying other variants
              console.warn("ticket_code lookup failed for", tc, err.message || err);
            }
          }
        }

        if (!visitor) {
          // Show attempted URLs in error to help debugging
          const msg = `Visitor record not found. Attempts: ${attempted.join(" | ") || "(none)"} — ensure the ticket_code/id exists and API is reachable.`;
          throw new Error(msg);
        }

        if (!mounted) return;
        setStatus("generating");

        // Generate PDF Blob (pdfGenerator returns a Blob)
        const pdfBlob = await generateVisitorBadgePDF(visitor, visitor.badgeTemplateUrl || "", {
          includeQRCode: true,
          qrPayload: { ticket_code: visitor.ticket_code || visitor.ticketCode || ticket_code || "" },
          event: visitor.event || {},
        });

        if (!pdfBlob) throw new Error("PDF generation failed");

        // download
        const objectUrl = URL.createObjectURL(pdfBlob);
        const filename = `RailTransExpo-${(visitor.ticket_code || visitor.id || ticket_code || "e-badge").toString().replace(/\s+/g, "_")}.pdf`;
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => { try { URL.revokeObjectURL(objectUrl); } catch {} }, 1500);

        if (!mounted) return;
        setStatus("done");

        setTimeout(() => {
          try { navigate(`/ticket?entity=${encodeURIComponent(entity)}&id=${encodeURIComponent(String(visitor.id || visitor._id || ""))}`); } catch {}
        }, 1600);
      } catch (err) {
        console.error("ticket-download error:", err);
        if (!mounted) return;
        setError(String(err && err.message ? err.message : err));
        setStatus("error");
      }
    }

    run();
    return () => { mounted = false; };
  }, [entity, id, ticket_code, navigate]);

  return (
    <div style={{ minHeight: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ maxWidth: 720, textAlign: "center" }}>
        {status === "starting" && <div>Preparing…</div>}
        {status === "fetching" && <div>Fetching ticket details…</div>}
        {status === "generating" && <div>Generating your E‑Badge PDF…</div>}
        {status === "done" && <div>Download started. If nothing happened, <a href="#" onClick={(e) => { e.preventDefault(); window.location.reload(); }}>try again</a>.</div>}
        {status === "error" && <div style={{ color: "crimson", whiteSpace: "pre-wrap", textAlign: "left" }}>Error: {error}</div>}
      </div>
    </div>
  );
}