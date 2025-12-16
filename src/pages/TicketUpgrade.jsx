import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import TicketCategorySelector from "../components/TicketCategoryGenerator";
import ManualPaymentStep from "../components/ManualPayemntStep";
import VisitorTicket from "../components/VisitorTicket";
import { buildTicketEmail } from "../utils/emailTemplate";
import { readRegistrationCache, writeRegistrationCache } from "../utils/registrationCache";

/*
 TicketUpgrade.jsx
 - Robust fetch: respects a client-side API base (window.__API_BASE__ or window.__FRONTEND_BASE__)
 - Accepts both "entity" and "type" query params (some links use `type=visitor`)
 - Accepts id or visitorId query params
 - Detects HTML responses (likely the SPA index) and surfaces a clear error suggesting incorrect API base
 - Minor logging to help debug "Visitor not found" issues
*/

const LOCAL_PRICE_KEY = "ticket_categories_local_v1";

function readLocalPricing() {
  try {
    const raw = localStorage.getItem(LOCAL_PRICE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function uploadAsset(file) {
  if (!file) return "";
  try {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/upload-asset", { method: "POST", body: fd });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.warn("uploadAsset failed", txt);
      return "";
    }
    const js = await r.json().catch(() => null);
    return js?.imageUrl || js?.fileUrl || js?.url || js?.path || "";
  } catch (e) {
    console.warn("uploadAsset error", e);
    return "";
  }
}

function safeApiBase() {
  try {
    const a = (window && (window.__API_BASE__ || window.__FRONTEND_BASE__ || "") ) || "";
    return String(a).replace(/\/$/, "");
  } catch (e) {
    return "";
  }
}

function isHtmlResponseText(txt) {
  if (!txt || typeof txt !== "string") return false;
  return txt.trim().startsWith("<!doctype") || txt.trim().startsWith("<html");
}

export default function TicketUpgrade() {
  const [search] = useSearchParams();
  const navigate = useNavigate();

  // Accept both entity and older `type` query param
  const entity = (search.get("entity") || search.get("type") || "visitors").toString().toLowerCase();
  const id = search.get("id") || search.get("visitorId") || "";
  const providedTicketCode = search.get("ticket_code") || "";

  const apiBase = safeApiBase();

  const [loading, setLoading] = useState(true);
  const [record, setRecord] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedMeta, setSelectedMeta] = useState({ price: 0, gstRate: 0, gstAmount: 0, total: 0, label: "" });

  const [processing, setProcessing] = useState(false);
  const [manualProofFile, setManualProofFile] = useState(null);
  const [txId, setTxId] = useState("");

  const latestTxRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!id && !providedTicketCode) {
        if (mounted) { setError("Missing visitor id or ticket_code in query parameters."); setLoading(false); }
        return;
      }

      setLoading(true);
      setError("");

      if (entity !== "visitors") {
        setError("Ticket upgrade page is for visitors only.");
        setLoading(false);
        return;
      }

      // try cache (only if id present)
      if (id) {
        const cached = readRegistrationCache(entity, id);
        if (cached) {
          if (!mounted) return;
          setRecord(cached);
          const cur = cached.ticket_category || cached.category || cached.ticketCategory || "";
          setSelectedCategory(cur || "");
          const localPricing = readLocalPricing();
          if (cur && localPricing && localPricing.visitors) {
            const found = localPricing.visitors.find(c => String(c.value).toLowerCase() === String(cur).toLowerCase());
            if (found) {
              const price = Number(found.price || 0);
              const gst = Number(found.gst || 0);
              setSelectedMeta({ price, gstRate: gst, gstAmount: Math.round(price * gst), total: Math.round(price + price * gst), label: found.label || found.value });
            }
          }
          setLoading(false);
          return;
        }
      }

      // fallback: fetch from API (use apiBase if available)
      try {
        let js = null;
        const basePrefix = apiBase || "";
        if (id) {
          const url = `${basePrefix}/api/visitors/${encodeURIComponent(String(id))}`.replace(/([^:]\/)\/+/g, "$1");
          const res = await fetch(url);
          const txt = await res.text().catch(() => "");
          if (!res.ok) {
            // If server returned HTML (SPA index) it's likely the API base is wrong / backend not mounted
            if (isHtmlResponseText(txt)) {
              const hint = basePrefix ? `Fetch to ${url} returned HTML. Check that your backend is reachable at ${basePrefix} and that /api/visitors/:id exists.` : `Fetch to /api/visitors/${id} returned HTML. Check deployment routing.`;
              throw new Error(`Visitor fetch returned non-JSON (HTML). ${hint}`);
            }
            js = txt ? JSON.parse(txt) : null;
          } else {
            // if JSON
            if (isHtmlResponseText(txt)) {
              throw new Error(`Visitor fetch returned HTML. Check API base (${basePrefix || '/api'}).`);
            }
            try { js = txt ? JSON.parse(txt) : null; } catch (_e) { js = null; }
          }
        } else if (providedTicketCode) {
          const where = `ticket_code=${providedTicketCode}`;
          const url = `${basePrefix}/api/visitors?where=${encodeURIComponent(where)}&limit=1`.replace(/([^:]\/)\/+/g, "$1");
          const r = await fetch(url);
          const txt = await r.text().catch(()=>"");
          if (!r.ok) {
            if (isHtmlResponseText(txt)) throw new Error(`Visitors list endpoint returned HTML. Check API base: ${basePrefix}`);
            js = txt ? JSON.parse(txt) : null;
          } else {
            if (isHtmlResponseText(txt)) throw new Error(`Visitors list endpoint returned HTML. Check API base: ${basePrefix}`);
            const arr = txt ? JSON.parse(txt) : [];
            js = Array.isArray(arr) ? (arr[0] || null) : arr;
          }
        }

        if (!js) {
          if (mounted) setError("Visitor not found");
          if (mounted) setLoading(false);
          return;
        }

        if (mounted) setRecord(js);
        const cur = js.ticket_category || js.category || js.ticketCategory || "";
        if (mounted) setSelectedCategory(cur || "");
        if (cur) {
          const localPricing = readLocalPricing();
          if (localPricing && localPricing.visitors) {
            const found = localPricing.visitors.find(c => String(c.value).toLowerCase() === String(cur).toLowerCase());
            if (found && mounted) {
              const price = Number(found.price || 0);
              const gst = Number(found.gst || 0);
              setSelectedMeta({ price, gstRate: gst, gstAmount: Math.round(price * gst), total: Math.round(price + price * gst), label: found.label || found.value });
            }
          }
        }
      } catch (e) {
        console.error("load visitor", e);
        if (mounted) {
          setError(String(e.message || "Failed to load visitor. Check API base and that backend routes are reachable."));
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [entity, id, providedTicketCode, apiBase]);

  const onCategoryChange = useCallback((val, meta) => {
    setSelectedCategory(val);
    setSelectedMeta(meta || { price: 0, gstRate: 0, gstAmount: 0, total: 0, label: val });
  }, []);

  const isSelectedFree = useMemo(() => {
    const t = Number(selectedMeta.total || selectedMeta.price || 0);
    return !t || t === 0;
  }, [selectedMeta]);

  const currentCategory = (record && (record.ticket_category || record.category || record.ticketCategory)) || "";
  const isSameCategory = useMemo(() => {
    if (!selectedCategory) return true;
    return String(selectedCategory).toLowerCase() === String(currentCategory).toLowerCase();
  }, [selectedCategory, currentCategory]);

  const finalizeUpgrade = useCallback(async ({ method = "online", txId: tx = null, reference = null, proofUrl = null } = {}) => {
    setProcessing(true);
    setError("");
    setMessage("");
    try {
      const targetId = id || (record && (record.id || record._id || record.insertedId)) || "";
      const upgradePayload = { newCategory: selectedCategory, txId: tx, reference, proofUrl, amount: selectedMeta.total || selectedMeta.price || 0 };

      const basePrefix = apiBase || "";
      let res = null;
      if (targetId) {
        const url = `${basePrefix}/api/visitors/${encodeURIComponent(String(targetId))}/upgrade`.replace(/([^:]\/)\/+/g, "$1");
        res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(upgradePayload) }).catch(()=>null);
      }

      if (!res || !res.ok) {
        if (targetId) {
          const url = `${basePrefix}/api/visitors/${encodeURIComponent(String(targetId))}`.replace(/([^:]\/)\/+/g, "$1");
          res = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket_category: selectedCategory, txId: tx, payment_reference: reference, payment_proof_url: proofUrl }) }).catch(()=>null);
        } else {
          const url = `${basePrefix}/api/visitors/upgrade-by-code`.replace(/([^:]\/)\/+/g, "$1");
          res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket_code: providedTicketCode, ticket_category: selectedCategory, txId: tx, reference, proofUrl }) }).catch(()=>null);
        }
      }

      if (!res || !res.ok) {
        const bodyText = res ? await res.text().catch(()=>null) : null;
        setError(`Upgrade failed: ${String(bodyText) || "server error"}`);
        setProcessing(false);
        return null;
      }

      let updated = null;
      try {
        if (targetId) {
          const url = `${basePrefix}/api/visitors/${encodeURIComponent(String(targetId))}`.replace(/([^:]\/)\/+/g, "$1");
          const r = await fetch(url);
          if (r.ok) updated = await r.json().catch(()=>null);
        } else if (providedTicketCode) {
          const url = `${basePrefix}/api/visitors?where=${encodeURIComponent(`ticket_code=${providedTicketCode}`)}&limit=1`.replace(/([^:]\/)\/+/g, "$1");
          const r = await fetch(url);
          if (r.ok) {
            const arr = await r.json().catch(()=>[]);
            updated = Array.isArray(arr) ? (arr[0] || null) : arr;
          }
        }
      } catch (e) { /* ignore */ }

      const finalRecord = updated || { ...(record || {}), ticket_category: selectedCategory, ticket_code: (record && (record.ticket_code || record.ticketCode)) || providedTicketCode || "" };

      try {
        const cacheId = targetId || finalRecord.id || finalRecord._id || finalRecord.insertedId || providedTicketCode || "";
        if (cacheId) writeRegistrationCache("visitors", cacheId, finalRecord);
      } catch (e) { /* ignore */ }

      try {
        const frontendBase = (typeof window !== "undefined" && window.location && window.location.origin) ? window.location.origin : "";
        const bannerUrl = (readLocalPricing() && readLocalPricing().bannerUrl) || "";
        const emailModel = {
          frontendBase,
          entity: "visitors",
          id: targetId,
          name: finalRecord?.name || "",
          company: finalRecord?.company || "",
          ticket_code: finalRecord?.ticket_code || finalRecord?.ticketCode || providedTicketCode || "",
          ticket_category: selectedCategory,
          bannerUrl,
          badgePreviewUrl: "",
          downloadUrl: `${frontendBase}/ticket-download?entity=visitors&id=${encodeURIComponent(String(targetId || ""))}`,
          event: (finalRecord && finalRecord.event) || {}
        };
        const { subject, text, html } = buildTicketEmail(emailModel);
        const mailPayload = { to: finalRecord?.email, subject, text, html, attachments: [] };
        await fetch(`${apiBase || ""}/api/mailer`.replace(/([^:]\/)\/+/g, "$1"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mailPayload) }).catch(()=>null);
      } catch (e) { console.warn("mail send failed (no attachments)", e); }

      setRecord(finalRecord);
      setMessage("Upgrade successful — row updated. Check your inbox for details (no attachments).");
      setProcessing(false);
      return finalRecord;
    } catch (e) {
      console.error("finalizeUpgrade", e);
      setError("Finalize upgrade failed.");
      setProcessing(false);
      return null;
    }
  }, [selectedCategory, selectedMeta, id, record, providedTicketCode, apiBase]);

  const handleTxIdChange = useCallback((value) => {
    setTxId(value || "");
    latestTxRef.current = value || "";
  }, []);

  const handlePaymentConfirmed = useCallback(() => {
    const tx = latestTxRef.current || txId || null;
    finalizeUpgrade({ method: "online", txId: tx || null }).catch((e) => {
      console.error("finalizeUpgrade after manual payment failed", e);
    });
  }, [finalizeUpgrade, txId]);

  const onManualProofUpload = useCallback((file) => {
    setManualProofFile(file || null);
  }, []);

  const submitManualProof = useCallback(async () => {
    if (!manualProofFile) {
      setError("Select a proof file first.");
      return;
    }
    setProcessing(true);
    setError("");
    try {
      const proofUrl = await uploadAsset(manualProofFile);
      if (!proofUrl) {
        setError("Upload failed");
        setProcessing(false);
        return;
      }
      await finalizeUpgrade({ method: "manual", proofUrl, txId: null, reference: `manual-${Date.now()}` });
    } catch (e) {
      console.error(e);
      setError("Manual proof submission failed");
      setProcessing(false);
    }
  }, [manualProofFile, finalizeUpgrade]);

  const onCancelRegistration = useCallback(async () => {
    if (!window.confirm("Cancel registration? This will mark your registration as cancelled.")) return;
    setProcessing(true);
    setError("");
    try {
      const targetId = id || (record && (record.id || record._id || ""));
      const basePrefix = apiBase || "";
      const res = targetId ? await fetch(`${basePrefix}/api/visitors/${encodeURIComponent(String(targetId))}/cancel`.replace(/([^:]\/)\/+/g, "$1"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "Cancelled via upgrade page" }) }).catch(()=>null) : null;
      if (!res || !res.ok) {
        const r2 = targetId ? await fetch(`${basePrefix}/api/visitors/${encodeURIComponent(String(targetId))}`.replace(/([^:]\/)\/+/g, "$1"), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "cancelled" }) }).catch(()=>null) : null;
        if (!r2 || !r2.ok) {
          setError("Cancel failed");
          setProcessing(false);
          return;
        }
      }
      const cancelledRecord = { ...(record || {}), status: "cancelled" };
      const cacheId = id || (record && (record.id || record._id || "")) || providedTicketCode || "";
      if (cacheId) writeRegistrationCache("visitors", cacheId, cancelledRecord);
      setMessage("Registration cancelled.");
      setProcessing(false);
    } catch (e) {
      console.error("cancel", e);
      setError("Cancel failed");
      setProcessing(false);
    }
  }, [id, record, providedTicketCode, apiBase]);

  const availableCategories = useMemo(() => {
    const local = readLocalPricing();
    return local && local.visitors ? local.visitors : null;
  }, [record]);

  const canApplyFree = useMemo(() => {
    if (processing) return false;
    if (!selectedCategory) return false;
    if (!isSelectedFree) return false;
    if (isSameCategory) return false;
    return true;
  }, [processing, selectedCategory, isSelectedFree, isSameCategory]);

  return (
    <div className="min-h-screen flex items-start justify-center p-6 bg-gray-50">
      <div className="w-full max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Upgrade Your Visitor Ticket</h1>
            <div className="text-sm text-gray-600">Choose a new ticket category and complete payment to upgrade.</div>
          </div>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1 border rounded" onClick={() => navigate(-1)}>Back</button>
            <button className="px-3 py-1 border rounded text-red-700" onClick={onCancelRegistration} disabled={processing}>Cancel Registration</button>
          </div>
        </div>

        {loading ? (
          <div className="p-6 bg-white rounded shadow">Loading visitor…</div>
        ) : error ? (
          <div className="p-6 bg-red-50 text-red-700 rounded shadow">{error}</div>
        ) : !record ? (
          <div className="p-6 bg-yellow-50 rounded shadow">Visitor not found.</div>
        ) : (
          <div className="bg-white rounded shadow p-6">
            <div className="mb-4">
              <div className="text-sm text-gray-500">Visitor</div>
              <div className="text-xl font-semibold">{record.name || record.company || `#${record.id || providedTicketCode}`}</div>
              <div className="text-sm text-gray-600">{record.email || ""} • {record.mobile || ""}</div>
              <div className="mt-2 text-sm">Current category: <strong>{currentCategory || "—"}</strong></div>
            </div>

            <div className="mb-6">
              <div className="text-lg font-semibold mb-3">Choose a new ticket category</div>
              <TicketCategorySelector role="visitors" value={selectedCategory} onChange={onCategoryChange} categories={availableCategories} />
            </div>

            <div className="mb-4">
              <div className="text-sm text-gray-600">Selected: <strong>{selectedMeta.label || selectedCategory || "—"}</strong></div>
              <div className="text-2xl font-extrabold">{selectedMeta.total ? `₹${Number(selectedMeta.total).toLocaleString("en-IN")}` : "Free (no payment needed)"}</div>
              {selectedMeta.gstAmount ? <div className="text-sm text-gray-500">Includes GST: ₹{Number(selectedMeta.gstAmount).toLocaleString("en-IN")}</div> : null}
            </div>

            <div className="mb-6">
              {selectedMeta.total && Number(selectedMeta.total) > 0 ? (
                <>
                  <div className="mb-3">
                    <span className="text-sm text-gray-500">Use the manual payment section below (you may also open provider checkout from there).</span>
                  </div>

                  <ManualPaymentStep
                    ticketType={selectedCategory}
                    ticketPrice={selectedMeta.total}
                    onProofUpload={handlePaymentConfirmed}
                    onTxIdChange={handleTxIdChange}
                    txId={txId}
                    proofFile={manualProofFile}
                    setProofFile={setManualProofFile}
                  />

                  <div className="mt-3 flex gap-2">
                    <button className="px-4 py-2 bg-gray-700 text-white rounded" onClick={submitManualProof} disabled={processing || !manualProofFile}>
                      {processing ? "Submitting…" : "Submit Proof & Upgrade"}
                    </button>
                  </div>
                </>
              ) : (
                <div>
                  <button
                    className={`px-4 py-2 ${canApplyFree ? "bg-green-600 text-white" : "bg-gray-200 text-gray-500 cursor-not-allowed"} rounded font-semibold`}
                    onClick={async () => {
                      if (!canApplyFree) return;
                      if (!window.confirm(`Apply free upgrade to "${selectedMeta.label || selectedCategory}" for this visitor?`)) return;
                      await finalizeUpgrade({ method: "free" });
                    }}
                    disabled={!canApplyFree}
                  >
                    {processing ? "Applying…" : "Apply Upgrade (Free)"}
                  </button>

                  {!selectedCategory && <div className="mt-2 text-sm text-gray-500">Select a category to enable the free upgrade button.</div>}
                  {selectedCategory && isSameCategory && <div className="mt-2 text-sm text-gray-500">Selected category is same as current — choose a different category to upgrade.</div>}
                </div>
              )}
            </div>

            <div className="mb-6">
              <div className="text-lg font-semibold mb-3">Preview E‑Badge</div>
              <VisitorTicket visitor={record} qrSize={200} showQRCode={true} accentColor="#2b6b4a" />
            </div>

            <div className="flex gap-3 items-center">
              <a href={`${(window.__FRONTEND_BASE__ || window.location.origin)}/ticket-download?entity=visitors&id=${encodeURIComponent(String(record.id || id || providedTicketCode || ""))}`} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 underline">
                Open frontend download page
              </a>
            </div>

            {message && <div className="mt-3 text-green-700">{message}</div>}
          </div>
        )}
      </div>
    </div>
  );
}