import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import TicketCategorySelector from "../components/TicketCategoryGenerator";
import ManualPaymentStep from "../components/ManualPayemntStep";
import VisitorTicket from "../components/VisitorTicket";
import { buildTicketEmail } from "../utils/emailTemplate";
import { readRegistrationCache, writeRegistrationCache } from "../utils/registrationCache";

/*
 TicketUpgrade.jsx (manual-payment-only)
 - The legacy "Pay & Upgrade" button has been removed.
 - ManualPaymentStep remains and handles the provider checkout or manual proof flow.
 - ManualPaymentStep must call onTxIdChange(txId) when it receives a provider transaction id
   and call onProofUpload() when payment is confirmed so this page can finalize the upgrade.
 - finalizeUpgrade performs the server update and sends a no-attachment email with a frontend
   download link.
 - Fix: Apply Upgrade (Free) is only enabled when:
     * a category is selected
     * the selected category is different from the visitor's current category
     * the selected category is free (total === 0)
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

export default function TicketUpgrade() {
  const [search] = useSearchParams();
  const navigate = useNavigate();

  const entity = (search.get("entity") || "visitors").toString().toLowerCase();
  const id = search.get("id") || search.get("visitorId") || "";
  const providedTicketCode = search.get("ticket_code") || "";

  const [loading, setLoading] = useState(true);
  const [record, setRecord] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedMeta, setSelectedMeta] = useState({ price: 0, gstRate: 0, gstAmount: 0, total: 0, label: "" });

  const [processing, setProcessing] = useState(false);
  const [manualProofFile, setManualProofFile] = useState(null);
  const [txId, setTxId] = useState("");

  // keep last tx id in a ref to avoid race between setState and finalize call
  const latestTxRef = useRef(null);

  // preferred: load from registration cache, else API
  useEffect(() => {
    let mounted = true;
    async function load() {
      // allow either id OR ticket_code; error only if both missing
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

      // fallback: fetch from API
      try {
        let js = null;
        if (id) {
          const res = await fetch(`/api/visitors/${encodeURIComponent(String(id))}`);
          if (res.ok) js = await res.json().catch(() => null);
        } else if (providedTicketCode) {
          // fetch by ticket_code using list endpoint (adapt if your backend uses different query)
          const r = await fetch(`/api/visitors?where=${encodeURIComponent(`ticket_code=${providedTicketCode}`)}&limit=1`);
          if (r.ok) {
            const arr = await r.json().catch(() => []);
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
        if (mounted) setError("Failed to load visitor.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [entity, id, providedTicketCode]);

  const onCategoryChange = useCallback((val, meta) => {
    setSelectedCategory(val);
    setSelectedMeta(meta || { price: 0, gstRate: 0, gstAmount: 0, total: 0, label: val });
  }, []);

  // Derived flags: whether selected category is free and whether it's different from current
  const isSelectedFree = useMemo(() => {
    const t = Number(selectedMeta.total || selectedMeta.price || 0);
    return !t || t === 0;
  }, [selectedMeta]);

  const currentCategory = (record && (record.ticket_category || record.category || record.ticketCategory)) || "";
  const isSameCategory = useMemo(() => {
    if (!selectedCategory) return true; // treat no selection as same to prevent action
    return String(selectedCategory).toLowerCase() === String(currentCategory).toLowerCase();
  }, [selectedCategory, currentCategory]);

  // Minimal finalizeUpgrade: update server, update local cache, notify UI
  const finalizeUpgrade = useCallback(async ({ method = "online", txId: tx = null, reference = null, proofUrl = null } = {}) => {
    setProcessing(true);
    setError("");
    setMessage("");
    try {
      // determine best target id (use id from query or record)
      const targetId = id || (record && (record.id || record._id || record.insertedId)) || "";
      const upgradePayload = { newCategory: selectedCategory, txId: tx, reference, proofUrl, amount: selectedMeta.total || selectedMeta.price || 0 };

      let res = null;
      // If we have a numeric/identifier targetId, try the dedicated endpoint
      if (targetId) {
        res = await fetch(`/api/visitors/${encodeURIComponent(String(targetId))}/upgrade`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(upgradePayload) }).catch(()=>null);
      }

      // fallback to a PUT by id (if targetId available) or POST to a search/upgrade endpoint if your backend supports it
      if (!res || !res.ok) {
        if (targetId) {
          res = await fetch(`/api/visitors/${encodeURIComponent(String(targetId))}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket_category: selectedCategory, txId: tx, payment_reference: reference, payment_proof_url: proofUrl }) }).catch(()=>null);
        } else {
          // As last resort, try a POST to upgrade-by-ticket-code endpoint if available
          res = await fetch(`/api/visitors/upgrade-by-code`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket_code: providedTicketCode, ticket_category: selectedCategory, txId: tx, reference, proofUrl }) }).catch(()=>null);
        }
      }

      if (!res || !res.ok) {
        const bodyText = res ? await res.text().catch(()=>null) : null;
        setError(`Upgrade failed: ${String(bodyText) || "server error"}`);
        setProcessing(false);
        return null;
      }

      // fetch fresh record if possible
      let updated = null;
      try {
        if (targetId) {
          const r = await fetch(`/api/visitors/${encodeURIComponent(String(targetId))}`);
          if (r.ok) updated = await r.json().catch(()=>null);
        } else if (providedTicketCode) {
          const r = await fetch(`/api/visitors?where=${encodeURIComponent(`ticket_code=${providedTicketCode}`)}&limit=1`);
          if (r.ok) {
            const arr = await r.json().catch(()=>[]);
            updated = Array.isArray(arr) ? (arr[0] || null) : arr;
          }
        }
      } catch (e) { /* ignore */ }

      const finalRecord = updated || { ...(record || {}), ticket_category: selectedCategory, ticket_code: (record && (record.ticket_code || record.ticketCode)) || providedTicketCode || "" };

      // write updated record to cache and notify
      try {
        const cacheId = targetId || finalRecord.id || finalRecord._id || finalRecord.insertedId || providedTicketCode || "";
        if (cacheId) writeRegistrationCache("visitors", cacheId, finalRecord);
      } catch (e) { /* ignore */ }

      // build/send a simple notification email WITHOUT attachments (optional, best-effort)
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
        // best-effort send (no attachments)
        await fetch("/api/mailer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mailPayload) }).catch(()=>null);
      } catch (e) { console.warn("mail send failed (no attachments)", e); }

      // update UI state and finish
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
  }, [selectedCategory, selectedMeta, id, record, providedTicketCode]);

  // ManualPaymentStep handlers
  const handleTxIdChange = useCallback((value) => {
    setTxId(value || "");
    latestTxRef.current = value || "";
  }, []);

  const handlePaymentConfirmed = useCallback(() => {
    // ManualPaymentStep will call onTxIdChange first, then onProofUpload => use latestTxRef
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
      const res = targetId ? await fetch(`/api/visitors/${encodeURIComponent(String(targetId))}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "Cancelled via upgrade page" }) }).catch(()=>null) : null;
      if (!res || !res.ok) {
        const r2 = targetId ? await fetch(`/api/visitors/${encodeURIComponent(String(targetId))}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "cancelled" }) }).catch(()=>null) : null;
        if (!r2 || !r2.ok) {
          setError("Cancel failed");
          setProcessing(false);
          return;
        }
      }
      // update cache and notify
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
  }, [id, record, providedTicketCode]);

  const availableCategories = useMemo(() => {
    const local = readLocalPricing();
    return local && local.visitors ? local.visitors : null;
  }, [record]);

  // Apply (Free) button enabled/disabled logic:
  // Enabled when:
  //  - a category is selected (selectedCategory truthy)
  //  - selected category is free (isSelectedFree === true)
  //  - selected category is different from currentCategory (not isSameCategory)
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
                  {/* ManualPaymentStep is the single payment UI now */}
                  <div className="mb-3">
                    <span className="text-sm text-gray-500">Use the manual payment section below (you may also open provider checkout from there).</span>
                  </div>

                  <ManualPaymentStep
                    ticketType={selectedCategory}
                    ticketPrice={selectedMeta.total}
                    onProofUpload={handlePaymentConfirmed}    // called by ManualPaymentStep after provider confirms
                    onTxIdChange={handleTxIdChange}            // called by ManualPaymentStep with provider tx id
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
              <a href={`${window.__FRONTEND_BASE__ || window.location.origin}/ticket-download?entity=visitors&id=${encodeURIComponent(String(record.id || id || providedTicketCode || ""))}`} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 underline">
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