import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { generateVisitorBadgePDF } from "../utils/pdfGenerator";

export default function TicketDownload() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const entity = (search.get("entity") || "visitors").toString().toLowerCase();
  const id = search.get("id") || "";
  const ticket_code = search.get("ticket_code") || "";
  const [status, setStatus] = useState("starting"); // starting | fetching | generating | done | error
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    async function run() {
      setStatus("fetching");
      setError("");
      try {
        // Prefer fetch by id. If no id, try querying by ticket_code.
        let visitor = null;
        if (id) {
          const r = await fetch(`/api/${entity}/${encodeURIComponent(String(id))}`, { headers: { Accept: "application/json" } });
          if (!r.ok) throw new Error(`Failed to fetch record (${r.status})`);
          visitor = await r.json();
        } else if (ticket_code) {
          // try list endpoint with where filter - adapt to your backend query interface
          const listRes = await fetch(`/api/${entity}?where=${encodeURIComponent(`ticket_code=${ticket_code}`)}&limit=1`, { headers: { Accept: "application/json" } });
          if (!listRes.ok) throw new Error(`Failed to fetch record (${listRes.status})`);
          const arr = await listRes.json();
          visitor = Array.isArray(arr) ? (arr[0] || null) : arr;
        } else {
          throw new Error("No id or ticket_code provided");
        }

        if (!visitor) {
          throw new Error("Visitor record not found");
        }

        setStatus("generating");
        // generate PDF blob (your existing generator returns a Blob)
        const pdfBlob = await generateVisitorBadgePDF(visitor, visitor.badgeTemplateUrl || "", { includeQRCode: true, qrPayload: { ticket_code: visitor.ticket_code || visitor.ticketCode || ticket_code || "" }, event: visitor.event || {} });
        if (!pdfBlob) throw new Error("PDF generation failed");

        // trigger download with filename
        const objectUrl = URL.createObjectURL(pdfBlob);
        const filename = `RailTransExpo-${(visitor.ticket_code || visitor.id || ticket_code || "e-badge").toString().replace(/\s+/g, "_")}.pdf`;
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => { try { URL.revokeObjectURL(objectUrl); } catch {} }, 1500);

        setStatus("done");
        // optionally navigate to ticket-manage page after a short delay
        setTimeout(() => {
          try { navigate(`/ticket?entity=${encodeURIComponent(entity)}&id=${encodeURIComponent(String(visitor.id || visitor._id || ""))}`); } catch {}
        }, 1600);
      } catch (err) {
        console.error("ticket-download error", err);
        if (mounted) {
          setError(String(err && err.message ? err.message : err));
          setStatus("error");
        }
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