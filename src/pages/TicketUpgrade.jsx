import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import TicketCategorySelector from "../components/TicketCategoryGenerator";
import ManualPaymentStep from "../components/ManualPayemntStep";
import VisitorTicket from "../components/VisitorTicket";
import { buildTicketEmail } from "../utils/emailTemplate";
import { readRegistrationCache, writeRegistrationCache } from "../utils/registrationCache";

const LOCAL_PRICE_KEY = "ticket_categories_local_v1";
const RAW_API_BASE = (typeof window !== "undefined" && (window.__API_BASE__ || "")) || process.env.REACT_APP_API_BASE || process.env.API_BASE || process.env.BACKEND_URL || "";
const API_BASE = RAW_API_BASE.replace(/\/+$/, "");
const RAW_FRONTEND_BASE = (typeof window !== "undefined" && (window.__FRONTEND_BASE__ || "")) || process.env.REACT_APP_FRONTEND_BASE || process.env.FRONTEND_BASE || process.env.APP_URL || "";
const FRONTEND_BASE = String(RAW_FRONTEND_BASE || window.location?.origin || "http://localhost:3000").replace(/\/$/, "");

function readLocalPricing() {
  try { const raw = localStorage.getItem(LOCAL_PRICE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function normalizeEmail(e){ try { return String(e||"").trim().toLowerCase(); } catch { return String(e||""); } }
function buildApiUrl(path){ if (!API_BASE) return path; if (/^https?:\/\//i.test(path)) return path; return path.startsWith("/") ? `${API_BASE}${path}` : `${API_BASE}/${path}`; }
async function tryFetch(url, opts = {}) { try { const r = await fetch(url, opts); if (!r.ok) return null; const ct = r.headers.get("content-type")||""; if (!ct.toLowerCase().includes("application/json")) return null; return await r.json().catch(()=>null); } catch { return null; } }

export default function TicketUpgrade(){
  const [search] = useSearchParams();
  const navigate = useNavigate();

  const entity = (search.get("entity") || search.get("type") || "visitors").toString().toLowerCase();
  const id = search.get("id") || search.get("visitorId") || "";
  const providedTicketCode = search.get("ticket_code") || search.get("ticket") || "";
  const expectedEmailParam = search.get("email") || "";
  const expectedEmail = expectedEmailParam ? normalizeEmail(expectedEmailParam) : null;

  const [loading, setLoading] = useState(true);
  const [record, setRecord] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedMeta, setSelectedMeta] = useState({ price:0, gstRate:0, gstAmount:0, total:0, label:"" });

  const [processing, setProcessing] = useState(false);
  const [manualProofFile, setManualProofFile] = useState(null);
  const [txId, setTxId] = useState("");
  const latestTxRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError("");

      // Only support visitors upgrade in this component
      if (entity !== "visitors") {
        setError("Ticket upgrade page is for visitors only.");
        setLoading(false);
        return;
      }
      if (!id && !providedTicketCode) {
        setError("Missing visitor id or ticket_code in query parameters.");
        setLoading(false);
        return;
      }

      // Attempt strict id fetch first
      if (id) {
        try {
          // Accept cached only when email matches expectedEmail (if provided)
          try {
            const cached = readRegistrationCache(entity, id);
            if (cached && (!expectedEmail || normalizeEmail(cached.email) === expectedEmail)) {
              if (!mounted) return;
              setRecord(cached);
              const cur = cached.ticket_category || cached.category || cached.ticketCategory || "";
              setSelectedCategory(cur || "");
              const localPricing = readLocalPricing();
              if (cur && localPricing?.visitors) {
                const found = localPricing.visitors.find(c => String(c.value).toLowerCase() === String(cur).toLowerCase());
                if (found) setSelectedMeta({ price:Number(found.price||0), gstRate:Number(found.gst||0), gstAmount:Math.round(found.price*found.gst||0), total:Math.round(Number(found.price||0) + Number(found.price||0)*Number(found.gst||0)), label: found.label || found.value });
              }
              setLoading(false);
              return;
            }
          } catch(e){ /* ignore cache errors */ }

          const url = buildApiUrl(`/api/visitors/${encodeURIComponent(id)}`);
          const js = await tryFetch(url, { credentials: "same-origin" });
          if (!js) { setError("Visitor not found by id."); setLoading(false); return; }
          const data = js.data || js;
          // Validate expected email
          if (expectedEmail) {
            const fetchedEmail = normalizeEmail(data.email || "");
            if (fetchedEmail !== expectedEmail) { setError("Email mismatch: this record does not match the verified email."); setLoading(false); return; }
          }
          if (!mounted) return;
          setRecord(data);
          const cur = data.ticket_category || data.category || data.ticketCategory || "";
          setSelectedCategory(cur || "");
          const localPricing = readLocalPricing();
          if (cur && localPricing?.visitors) {
            const found = localPricing.visitors.find(c => String(c.value).toLowerCase() === String(cur).toLowerCase());
            if (found) setSelectedMeta({ price:Number(found.price||0), gstRate:Number(found.gst||0), gstAmount:Math.round(found.price*found.gst||0), total:Math.round(Number(found.price||0) + Number(found.price||0)*Number(found.gst||0)), label: found.label || found.value });
          }
          setLoading(false);
          return;
        } catch (e) {
          console.error("load by id", e);
          setError("Failed to load visitor (by id).");
          setLoading(false);
          return;
        }
      }

      // If only ticket code provided: use deterministic by-ticket endpoint only (no fuzzy q fallback)
      if (providedTicketCode) {
        try {
          const url = buildApiUrl(`/api/visitors/by-ticket/${encodeURIComponent(providedTicketCode)}`);
          const js = await tryFetch(url, { credentials: "same-origin" });
          if (!js) { setError("Visitor not found by ticket code."); setLoading(false); return; }
          const data = js.data || js;
          // Validate ticket_code exactly
          const fetchedTicket = (data.ticket_code || data.ticketCode || "").toString().trim();
          if (!fetchedTicket || fetchedTicket !== String(providedTicketCode).trim()) {
            setError("Ticket code mismatch from lookup result. Aborting.");
            setLoading(false);
            return;
          }
          // Validate expected email if provided
          if (expectedEmail) {
            const fetchedEmail = normalizeEmail(data.email || "");
            if (fetchedEmail !== expectedEmail) { setError("Email mismatch: this record does not match the verified email."); setLoading(false); return; }
          }
          if (!mounted) return;
          setRecord(data);
          const cur = data.ticket_category || data.category || data.ticketCategory || "";
          setSelectedCategory(cur || "");
          const localPricing = readLocalPricing();
          if (cur && localPricing?.visitors) {
            const found = localPricing.visitors.find(c => String(c.value).toLowerCase() === String(cur).toLowerCase());
            if (found) setSelectedMeta({ price:Number(found.price||0), gstRate:Number(found.gst||0), gstAmount:Math.round(found.price*found.gst||0), total:Math.round(Number(found.price||0) + Number(found.price||0)*Number(found.gst||0)), label: found.label || found.value });
          }
          setLoading(false);
          return;
        } catch (e) {
          console.error("load by ticket code", e);
          setError("Failed to load visitor (by ticket code).");
          setLoading(false);
          return;
        }
      }
    }
    load();
    return () => { mounted = false; };
  }, [entity, id, providedTicketCode, expectedEmail]);

  const onCategoryChange = useCallback((val, meta) => { setSelectedCategory(val); setSelectedMeta(meta || { price:0,gstRate:0,gstAmount:0,total:0,label:val }); }, []);
  const isSelectedFree = useMemo(() => { const t = Number(selectedMeta.total || selectedMeta.price || 0); return !t || t === 0; }, [selectedMeta]);
  const currentCategory = (record && (record.ticket_category || record.category || record.ticketCategory)) || "";
  const isSameCategory = useMemo(() => { if (!selectedCategory) return true; return String(selectedCategory).toLowerCase() === String(currentCategory).toLowerCase(); }, [selectedCategory, currentCategory]);

  const finalizeUpgrade = useCallback(async ({ method="online", txId:tx=null, reference=null, proofUrl=null }={})=>{
    setProcessing(true); setError(""); setMessage("");
    try {
      const targetId = id || (record && (record.id || record._id || record.insertedId)) || "";
      if (!targetId) { setError("Missing target id for upgrade"); setProcessing(false); return null; }

      // build payload but backend will re-validate stored email
      const payload = { entity_type: "visitors", entity_id: targetId, new_category: selectedCategory, amount: selectedMeta.total || selectedMeta.price || 0, email: record?.email || null, txId: tx, reference, proofUrl, method };

      const res = await fetch("/api/tickets/upgrade", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) }).catch(()=>null);
      if (!res || !res.ok) { const bodyText = res ? await res.text().catch(()=>"") : ""; setError(`Upgrade failed: ${String(bodyText) || "server error"}`); setProcessing(false); return null; }
      const js = await res.json().catch(()=>({}));

      // Re-fetch deterministically by ID (do not fuzzy search)
      const url = buildApiUrl(`/api/visitors/${encodeURIComponent(targetId)}`);
      const updatedResp = await tryFetch(url, { credentials: "same-origin" });
      const updated = (updatedResp && (updatedResp.data || updatedResp)) || null;

      const finalRecord = updated || { ...(record||{}), ticket_category:selectedCategory, ticket_code: js.ticket_code || record?.ticket_code || providedTicketCode };

      try { const cacheId = targetId || finalRecord.id || finalRecord._id || finalRecord.insertedId || providedTicketCode || ""; if (cacheId) writeRegistrationCache("visitors", cacheId, finalRecord); } catch {}

      // send simple mail via backend mailer endpoint (best-effort)
      try {
        const bannerUrl = (readLocalPricing() && readLocalPricing().bannerUrl) || "";
        const emailModel = { frontendBase: FRONTEND_BASE, entity: "visitors", id: targetId || providedTicketCode || "", name: finalRecord?.name || "", company: finalRecord?.company || "", ticket_code: finalRecord?.ticket_code || finalRecord?.ticketCode || js.ticket_code || providedTicketCode || "", ticket_category: selectedCategory, bannerUrl, badgePreviewUrl: "", downloadUrl: `${FRONTEND_BASE}/ticket-download?entity=visitors&id=${encodeURIComponent(String(targetId||""))}`, event: finalRecord?.event || null };
        const tpl = await buildTicketEmail(emailModel);
        await fetch("/api/mailer", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ to: finalRecord?.email, subject: tpl.subject, text: tpl.text, html: tpl.html, attachments: [] }) }).catch(()=>null);
      } catch (e) { console.warn("mail send failed", e); }

      setManualProofFile(null);
      setRecord(finalRecord);
      setMessage("Upgrade successful — row updated. Check your inbox for details.");
      setProcessing(false);
      return finalRecord;
    } catch (e) {
      console.error("finalizeUpgrade", e);
      setError("Finalize upgrade failed.");
      setProcessing(false);
      return null;
    }
  }, [selectedCategory, selectedMeta, id, record, providedTicketCode]);

  const handleTxIdChange = useCallback((v)=>{ setTxId(v||""); latestTxRef.current = v||""; }, []);
  const handlePaymentConfirmed = useCallback(()=>{ const tx = latestTxRef.current || txId || null; finalizeUpgrade({ method:"online", txId: tx || null }).catch(e=>console.error(e)); }, [finalizeUpgrade, txId]);
  const onManualProofUpload = useCallback(f => setManualProofFile(f||null), []);
  const submitManualProof = useCallback(async ()=>{ if (!manualProofFile) { setError("Select a proof file first."); return; } setProcessing(true); setError(""); try { const proofUrl = await (async f=>{ const fd=new FormData(); fd.append("file", f); const r = await fetch("/api/upload-asset",{method:"POST",body:fd}); if(!r.ok) return ""; const js=await r.json().catch(()=>null); return js?.imageUrl||js?.fileUrl||js?.url||js?.path||""; })(manualProofFile); if(!proofUrl){ setError("Upload failed"); setProcessing(false); return; } await finalizeUpgrade({ method:"manual", proofUrl, txId:null, reference:`manual-${Date.now()}` }); } catch(e){ console.error(e); setError("Manual proof submission failed"); setProcessing(false); } }, [manualProofFile, finalizeUpgrade]);

  const availableCategories = useMemo(()=>{ const local = readLocalPricing(); return local?.visitors || null; }, [record]);
  const canApplyFree = useMemo(()=>{ if (processing) return false; if (!selectedCategory) return false; if (!isSelectedFree) return false; if (isSameCategory) return false; return true; }, [processing, selectedCategory, isSelectedFree, isSameCategory]);

  return (
    <div className="min-h-screen flex items-start justify-center p-6 bg-gray-50">
      <div className="w-full max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Upgrade Your Visitor Ticket</h1>
            <div className="text-sm text-gray-600">Choose a new ticket category and complete payment to upgrade.</div>
          </div>
          <div className="flex items-center gap-2"><button className="px-3 py-1 border rounded" onClick={()=>navigate(-1)}>Back</button></div>
        </div>

        {loading ? <div className="p-6 bg-white rounded shadow">Loading visitor…</div>
          : error ? <div className="p-6 bg-red-50 text-red-700 rounded shadow">{error}</div>
          : !record ? <div className="p-6 bg-yellow-50 rounded shadow">Visitor not found.</div>
          : <div className="bg-white rounded shadow p-6">
              <div className="mb-4">
                <div className="text-sm text-gray-500">Visitor</div>
                <div className="text-xl font-semibold">{record.name || record.company || `#${record.id || providedTicketCode}`}</div>
                <div className="text-sm text-gray-600">{record.email || ""} • {record.mobile || ""}</div>
                <div className="mt-2 text-sm">Current category: <strong>{currentCategory || "—"}</strong></div>
              </div>

              <div className="mb-6">
                <div className="text-lg font-semibold mb-3">Choose a new ticket category</div>
                <TicketCategorySelector role="visitors" value={selectedCategory} onChange={onCategoryChange} categories={availableCategories} disabled={processing} />
              </div>

              <div className="mb-4">
                <div className="text-sm text-gray-600">Selected: <strong>{selectedMeta.label || selectedCategory || "—"}</strong></div>
                <div className="text-2xl font-extrabold">{selectedMeta.total ? `₹${Number(selectedMeta.total).toLocaleString("en-IN")}` : "Free (no payment needed)"}</div>
                {selectedMeta.gstAmount ? <div className="text-sm text-gray-500">Includes GST: ₹{Number(selectedMeta.gstAmount).toLocaleString("en-IN")}</div> : null}
              </div>

              <div className="mb-6">
                {selectedMeta.total && Number(selectedMeta.total) > 0 ? (
                  <>
                    <div className="mb-3"><span className="text-sm text-gray-500">Use the manual payment section below (you may also open provider checkout from there).</span></div>
                    <ManualPaymentStep ticketType={selectedCategory} ticketPrice={selectedMeta.total} onProofUpload={handlePaymentConfirmed} onTxIdChange={handleTxIdChange} txId={txId} proofFile={manualProofFile} setProofFile={setManualProofFile} />
                    <div className="mt-3 flex gap-2">
                      <button className="px-4 py-2 bg-gray-700 text-white rounded" onClick={submitManualProof} disabled={processing || !manualProofFile}>{processing ? "Submitting…" : "Submit Proof & Upgrade"}</button>
                    </div>
                  </>
                ) : (
                  <div>
                    <button className={`px-4 py-2 ${canApplyFree ? "bg-green-600 text-white" : "bg-gray-200 text-gray-500 cursor-not-allowed"} rounded font-semibold`} onClick={async ()=>{ if(!canApplyFree) return; if(!window.confirm(`Apply free upgrade to "${selectedMeta.label || selectedCategory}" for this visitor?`)) return; await finalizeUpgrade({ method:"free" }); }} disabled={!canApplyFree}>{processing ? "Applying…" : "Apply Upgrade (Free)"}</button>
                    {!selectedCategory && <div className="mt-2 text-sm text-gray-500">Select a category to enable the free upgrade button.</div>}
                    {selectedCategory && isSameCategory && <div className="mt-2 text-sm text-gray-500">Selected category is same as current — choose a different category to upgrade.</div>}
                  </div>
                )}
              </div>

              <div className="mb-6">
                <div className="text-lg font-semibold mb-3">Preview E‑Badge</div>
                <VisitorTicket visitor={record} qrSize={200} showQRCode={true} accentColor="#2b6b4a" apiBase={API_BASE} />
              </div>

              <div className="flex gap-3 items-center">
                <a href={`${FRONTEND_BASE}/ticket-download?entity=visitors&id=${encodeURIComponent(String(record.id || id || providedTicketCode || ""))}`} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 underline">Open frontend download page</a>
              </div>

              {message && <div className="mt-3 text-green-700">{message}</div>}
            </div>
        }
      </div>
    </div>
  );
}