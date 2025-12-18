import React, { useCallback, useEffect, useRef, useState } from "react";

/*
  VisitorTicket (QR-only preview)
  - Shows visitor name/company above the QR only.
  - Does NOT display the ticket code as plain text anywhere in the preview.
  - QR encodes only the ticket code (E.g. "TICK-ABC123" or numeric code) so the code is still present inside the QR payload.
  - Provides a "Fetch server ticket code" button (keeps previous debug behaviour).
  - Accepts apiBase prop (optional) so parent can pass backend origin explicitly.
*/

function tryParseJsonSafe(str) { try { return JSON.parse(str); } catch { return null; } }
function looksLikeBase64(s) { return typeof s === "string" && /^[A-Za-z0-9+/=]+$/.test(s.replace(/\s+/g,"")) && s.length % 4 === 0; }

function sanitizeApiBaseCandidate(candidate) {
  if (!candidate) return "";
  let s = String(candidate).trim().replace(/\/+$/, "");
  const low = s.toLowerCase();
  const idx = low.indexOf("/api/");
  const idxExact = low.endsWith("/api") ? low.lastIndexOf("/api") : -1;
  if (idx >= 0) return s.slice(0, idx);
  if (idxExact >= 0) return s.slice(0, idxExact);
  return s;
}
function resolveApiBase(propApiBase) {
  if (propApiBase) return sanitizeApiBaseCandidate(propApiBase);
  if (typeof window !== "undefined" && window.__API_BASE__) return sanitizeApiBaseCandidate(window.__API_BASE__);
  if (typeof process !== "undefined" && process.env) {
    const v = process.env.REACT_APP_API_BASE || process.env.API_BASE || "";
    if (v) return sanitizeApiBaseCandidate(v);
  }
  if (typeof window !== "undefined" && window.location && window.location.origin) return String(window.location.origin).replace(/\/$/, "");
  return "";
}
function joinUrl(base, path) {
  if (!base) return path.startsWith("/") ? path : `/${path}`;
  const b = String(base).replace(/\/+$/, "");
  const p = String(path || "").replace(/^\/+/, "");
  return `${b}/${p}`;
}

async function tryFetchJsonCandidates(candidates = []) {
  const tried = [];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" }, credentials: "same-origin" });
      const status = res.status;
      const ct = (res && res.headers && typeof res.headers.get === "function") ? (res.headers.get("content-type") || "") : "";
      let text = "";
      try { text = await res.text(); } catch {}
      const snippet = text ? (text.length > 1200 ? text.slice(0, 1200) + "…(truncated)" : text) : "";
      tried.push({ url, status, contentType: ct, snippet });
      if (res.ok && ct.toLowerCase().includes("application/json")) {
        const js = tryParseJsonSafe(text);
        if (js !== null) return { ok: true, url, body: js, status, tried };
      }
      if (ct.toLowerCase().includes("application/json")) {
        const js = tryParseJsonSafe(text);
        if (js !== null) return { ok: true, url, body: js, status, tried };
      }
    } catch (e) {
      tried.push({ url, status: "ERR", contentType: "", snippet: String(e && e.message ? e.message : e) });
      continue;
    }
  }
  return { ok: false, tried };
}

function extractTicketCodeFromResponse(js) {
  if (!js) return "";
  const candidates = [];
  if (Array.isArray(js)) js.forEach(it => { if (it && typeof it === "object") candidates.push(it); });
  else if (js && typeof js === "object") {
    if (js.data && typeof js.data === "object") {
      if (Array.isArray(js.data)) js.data.forEach(d => candidates.push(d));
      else candidates.push(js.data);
    } else if (Array.isArray(js.rows)) js.rows.forEach(d => candidates.push(d));
    else candidates.push(js);
  }
  for (const obj of candidates) {
    if (!obj || typeof obj !== "object") continue;
    const t = obj.ticket_code || obj.ticketCode || obj.code || obj.ticketId || obj.codeId || obj.code_id;
    if (t && String(t).trim()) return String(t).trim();
    if (obj.form && typeof obj.form === "object") {
      const f = obj.form.ticket_code || obj.form.ticketCode || obj.form.code || obj.form.ticketId;
      if (f && String(f).trim()) return String(f).trim();
    }
    if (obj.data && typeof obj.data === "object") {
      const d = obj.data.ticket_code || obj.data.ticketCode || obj.data.code || obj.data.ticketId;
      if (d && String(d).trim()) return String(d).trim();
    }
  }
  return "";
}

export default function VisitorTicket({
  visitor,
  pdfBlob,
  roleLabel,
  accentColor = "#c8102e",
  showQRCode = true,
  qrSize = 220,
  className = "",
  apiBase: propApiBase = "",
}) {
  const [localTicketCode, setLocalTicketCode] = useState(visitor ? (visitor.ticket_code || visitor.ticketCode || visitor.ticketId || "") : "");
  const [fetchingServerCode, setFetchingServerCode] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [debugInfo, setDebugInfo] = useState(null);

  useEffect(() => {
    if (!visitor) { setLocalTicketCode(""); return; }
    const canonical = visitor.ticket_code || visitor.ticketCode || visitor.ticketId || "";
    setLocalTicketCode(canonical ? String(canonical).trim() : "");
  }, [visitor]);

  const v = visitor || {};
  const name = v.name || v.full_name || v.title || "";
  const company = v.company || v.organization || "";
  const providedTicketCode = v.ticket_code || v.ticketCode || v.ticketId || "";

  const effectiveApiBase = resolveApiBase(propApiBase);

  const fetchCanonicalTicketCode = React.useCallback(async () => {
    setFetchError("");
    setFetchingServerCode(true);
    setDebugInfo(null);
    try {
      const entityId = v && (v.id || v._id || (v._id && v._id.$oid)) ? String(v.id || v._id || (v._id && v._id.$oid)) : "";
      const candidates = [];

      const pushCandidate = (relPath) => {
        if (effectiveApiBase) candidates.push(joinUrl(effectiveApiBase, relPath));
        candidates.push(relPath);
      };

      if (entityId) {
        pushCandidate(`/api/visitors/${encodeURIComponent(entityId)}`);
        pushCandidate(`/api/visitors?q=${encodeURIComponent(entityId)}&limit=1`);
      }
      if (providedTicketCode) {
        pushCandidate(`/api/visitors?q=${encodeURIComponent(providedTicketCode)}&limit=1`);
      }
      if (entityId) {
        pushCandidate(`/api/tickets/${encodeURIComponent(entityId)}`);
        pushCandidate(`/api/tickets/debug-check`);
      }

      const uniq = [...new Set(candidates)];
      const abs = uniq.filter(u => /^https?:\/\//i.test(u));
      const rel = uniq.filter(u => !/^https?:\/\//i.test(u));
      const groups = [];
      if (abs.length) groups.push(abs);
      if (rel.length) groups.push(rel);

      let finalResult = null;
      const triedAll = [];
      for (const group of groups) {
        const out = await tryFetchJsonCandidates(group);
        (out.tried || []).forEach(t => triedAll.push(t));
        if (out.ok) { finalResult = out; break; }
      }

      setDebugInfo({ tried: triedAll });

      if (!finalResult) {
        setFetchError("No ticket record found on server (checked candidate endpoints). Check network tab for details.");
        setFetchingServerCode(false);
        return;
      }

      const ticket = extractTicketCodeFromResponse(finalResult.body);
      if (ticket) {
        setLocalTicketCode(ticket);
        setDebugInfo(prev => ({ ...(prev || {}), successUrl: finalResult.url }));
        setFetchingServerCode(false);
        return;
      }

      setFetchError("Server returned JSON but no ticket_code found in response.");
      setDebugInfo(prev => ({ ...(prev || {}), body: finalResult.body }));
    } catch (e) {
      console.error("[VisitorTicket] fetchCanonicalTicketCode error:", e && e.message ? e.message : e);
      setFetchError(String(e && e.message ? e.message : e));
    } finally {
      setFetchingServerCode(false);
    }
  }, [v, effectiveApiBase, providedTicketCode]);

  return (
    <div className={`mx-auto max-w-[860px] bg-transparent ${className}`}>
      <div style={{ background: "#eedfbf", borderTopLeftRadius: 8, borderTopRightRadius: 8 }}>
        {v.bannerUrl ? <img src={v.bannerUrl} alt="Event banner" style={{ width: "100%", display: "block", borderTopLeftRadius: 8, borderTopRightRadius: 8 }} /> : <div style={{ padding: 18, textAlign: "center", fontWeight: 700 }}>{v.eventName || "Event"}</div>}
      </div>

      <div style={{ background: "linear-gradient(#e8f8fb, #ffffff)", padding: "28px" }}>
        <div style={{ maxWidth: 520, margin: "0 auto", background: "#fff", borderRadius: 12, padding: "34px 28px", textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{name || " "}</div>
          {company ? <div style={{ fontSize: 18, color: "#111827", marginBottom: 18 }}>{company}</div> : null}

          {/* QR-only preview: show QR (if available). Do NOT render ticket code text anywhere. */}
          {localTicketCode && showQRCode ? (
            <div style={{ marginTop: 12 }}>
              <img src={`https://chart.googleapis.com/chart?cht=qr&chs=${qrSize}x${qrSize}&chl=${encodeURIComponent(localTicketCode)}&choe=UTF-8`} alt="QR" width={qrSize} height={qrSize} />
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <div style={{ color: "#ef4444", fontWeight: 700 }}>Ticket code not available</div>
              <div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "center" }}>
                <button onClick={fetchCanonicalTicketCode} disabled={fetchingServerCode} style={{ padding: "10px 14px", background: "#0b556b", color: "#fff", borderRadius: 8 }}>
                  {fetchingServerCode ? "Fetching…" : "Fetch server ticket code"}
                </button>
                <button onClick={() => { navigator.clipboard && navigator.clipboard.writeText(JSON.stringify(v).slice(0,2000)); }} style={{ padding: "10px 14px", background: "#f3f4f6", color: "#0b556b", borderRadius: 8 }}>
                  Copy payload
                </button>
              </div>

              {fetchError && <div style={{ marginTop: 8, color: "#b91c1c" }}>{fetchError}</div>}

              {debugInfo && debugInfo.tried && (
                <div style={{ marginTop: 8, color: "#374151", fontSize: 12, textAlign: "left" }}>
                  <div style={{ fontWeight: 700 }}>Tried endpoints (debug):</div>
                  <ul style={{ paddingLeft: 16 }}>
                    {debugInfo.tried.map((t, i) => (
                      <li key={i} style={{ marginBottom: 6 }}>
                        <div><code style={{ fontSize: 11 }}>{t.url}</code> — status: {t.status} — content-type: {t.contentType || "(none)"}</div>
                        {t.snippet ? <pre style={{ fontSize: 11, maxHeight: 120, overflow: "auto", background: "#f8fafc", padding: 6 }}>{t.snippet}</pre> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {debugInfo && debugInfo.body && (
                <pre style={{ marginTop: 8, fontSize: 11, maxHeight: 200, overflow: "auto", background: "#f8fafc", padding: 8 }}>{JSON.stringify(debugInfo.body, null, 2)}</pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}