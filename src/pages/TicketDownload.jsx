import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { generateVisitorBadgePDF } from "../utils/pdfGenerator";

function api(path) {
  return path.startsWith("/api") ? path : `/api${path}`;
}

export default function TicketDownload() {
  const [params] = useSearchParams();
  const entity = params.get("entity") || "visitors";
  const id = params.get("id");
  const ticket = params.get("ticket") || params.get("ticket_code");

  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    async function run() {
      try {
        let res;

        if (id) {
          res = await fetch(api(`/${entity}/${id}`));
        } else if (ticket) {
          res = await fetch(api(`/${entity}?q=${ticket}&limit=1`));
        }

        if (!res || !res.ok) throw new Error("Ticket not found");

        const data = await res.json();
        const visitor = Array.isArray(data) ? data[0] : data;

        const pdfBlob = await generateVisitorBadgePDF(visitor);

        const url = URL.createObjectURL(pdfBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `RailTrans-${visitor.ticket_code}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setStatus("done");
      } catch (e) {
        console.error(e);
        setError(e.message);
        setStatus("error");
      }
    }

    run();
  }, [entity, id, ticket]);

  if (status === "loading") return <div>Generating badge…</div>;
  if (status === "error") return <div style={{ color: "red" }}>{error}</div>;

  return <div>Download started.</div>;
}
