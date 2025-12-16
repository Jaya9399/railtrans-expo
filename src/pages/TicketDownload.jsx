import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { generateVisitorBadgePDF } from "../utils/pdfGenerator";

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
    async function run() {
      setStatus("fetching");
      setError("");
      try {
        // Prefer fetch by id. If id is provided but response is not JSON, fall back to ticket_code search.
        let visitor = null;

        async function safeFetchJson(url, opts = {}) {
          const r = await fetch(url, opts);
          const ct = (r.headers.get("content-type") || "").toLowerCase();
          const text = await r.text().catch(() => "");
          if (!r.ok) {
            // include response body to help debugging
            throw new Error(`Request failed ${r.status} ${r.statusText} - response: ${text.slice(0, 200)}`);
          }
          if (!ct.includes("application/json")) {
            // return parsed text with a flag so caller can decide; here we treat as error
            throw new Error(`Expected JSON but got content-type: ${ct} - response: ${text.slice(0, 400)}`);
          }
          // parse JSON from the string we already read
          try {
            return JSON.parse(text);
          } catch (e) {
            throw new Error(`Invalid JSON response: ${e.message} - response: ${text.slice(0,400)}`);
          }
        }

        if (id) {
          try {
            visitor = await safeFetchJson(`/api/${entity}/${encodeURIComponent(String(id))}`, { headers: { Accept: "application/json" } });
          } catch (err) {
            // If the id fetch returned HTML (or failed), and we have a ticket_code, fall back to q search below.
            console.warn("Fetch by id returned non-JSON or failed, will try ticket_code fallback if available:", err);
            visitor = null;
          }
        }

        if (!visitor && ticket_code) {
          // Backend expects `q=` for searching; don't use 'where='
          const listUrl = `/api/${entity}?q=${encodeURIComponent(ticket_code)}&limit=1`;
          try {
            const arr = await safeFetchJson(listUrl, { headers: { Accept: "application/json" } });
            visitor = Array.isArray(arr) ? (arr[0] || null) : arr;
          } catch (err) {
            // if list returned HTML or error, propagate helpful message
            throw err;
          }
        }

        if (!visitor) {
          throw new Error("Visitor record not found");
        }

        if (!mounted) return;

        setStatus("generating");

        // generate PDF blob (your existing generator should return a Blob or Buffer -> convert to Blob)
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

        // optional: navigate to ticket manage page
        setTimeout(() => {
          try { navigate(`/ticket?entity=${encodeURIComponent(entity)}&id=${encodeURIComponent(String(visitor.id || visitor._id || ""))}`); } catch {}
        }, 1600);
      } catch (err) {
        console.error("ticket-download error", err);
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
        {status === "error" && <div style={{ color: "crimson" }}>Error: {error}</div>}
      </div>
    </div>
  );
}