import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import TicketCategorySelector from "../components/TicketCategorySelector";
import ManualPaymentStep from "../components/ManualPayemntStep";
import VisitorTicket from "../components/VisitorTicket";
import { generateVisitorBadgePDF } from "../utils/pdfGenerator";
import { buildTicketEmail } from "../utils/emailTemplate";
import { readRegistrationCache, writeRegistrationCache } from "../utils/registrationCache";

/*
 TicketUpgrade.jsx (updated)
 - After successful upgrade, writes the updated record to registration cache and notifies dashboard.
 - Uses registration cache first to pre-fill visitor details; falls back to fetching /api/visitors/:id.
 - Uses ManualPaymentStep and TicketCategorySelector (reads pricing from local storage managed by TicketPricingManager).
 - Sends acknowledgement email and attaches generated PDF (best-effort).
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

  // preferred: load from registration cache, else API
  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!id) {
        if (mounted) { setError("Missing visitor id in query parameters."); setLoading(false); }
        return;
      }
      setLoading(true);
      setError("");

      if (entity !== "visitors") {
        setError("Ticket upgrade page is for visitors only.");
        setLoading(false);
        return;
      }

      // try cache
      const cached = readRegistrationCache(entity, id);
      if (cached) {
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

      // fallback: fetch from API
      try {
        const res = await fetch(`/api/visitors/${encodeURIComponent(String(id))}`);
        if (!res.ok) {
          if (mounted) setError(`Failed to fetch visitor (status ${res.status})`);
          if (mounted) setLoading(false);
          return;
        }
        const js = await res.json().catch(() => null);
        if (!js) {
          if (mounted) setError("Empty response from server");
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
  }, [entity, id]);

  const onCategoryChange = useCallback((val, meta) => {
    setSelectedCategory(val);
    setSelectedMeta(meta || { price: 0, gstRate: 0, gstAmount: 0, total: 0, label: val });
  }, []);

  // create order and poll, then finalize
  const createOrderAndOpenCheckout = useCallback(async () => {
    setProcessing(true);
    setError("");
    setMessage("");
    try {
      const amount = Number(selectedMeta.total || selectedMeta.price || 0);
      if (!amount || amount <= 0) {
        setError("Selected category requires payment but amount is invalid.");
        setProcessing(false);
        return;
      }
      const reference = `upgrade-${id}-${Date.now()}`;
      const payload = {
        amount,
        currency: "INR",
        description: `Upgrade visitor ${id} → ${selectedCategory}`,
        reference_id: reference,
        metadata: { visitorId: id, newCategory: selectedCategory }
      };
      const res = await fetch("/api/payment/create-order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const js = await res.json().catch(() => null);
      if (!res.ok || !js || !(js.checkoutUrl || js.checkout_url || js.longurl)) {
        setError((js && (js.error || js.message)) || "Payment initiation failed");
        setProcessing(false);
        return;
      }
      const checkoutUrl = js.checkoutUrl || js.checkout_url || js.longurl;

      // cache record before opening external payment
      if (record) writeRegistrationCache(entity, id, record);

      const w = window.open(checkoutUrl, "_blank", "noopener,noreferrer");
      if (!w) {
        setError("Popup blocked. Allow popups to continue payment.");
        setProcessing(false);
        return;
      }

      let attempts = 0;
      const poll = setInterval(async () => {
        attempts += 1;
        try {
          const st = await fetch(`/api/payment/status?reference_id=${encodeURIComponent(reference)}`);
          if (!st.ok) return;
          const js2 = await st.json().catch(() => null);
          const status = (js2 && (js2.status || js2.payment_status || js2.state) || "").toString().toLowerCase();
          if (["paid","captured","completed","success"].includes(status)) {
            clearInterval(poll);
            try { if (w && !w.closed) w.close(); } catch {}
            const providerPaymentId = js2.record?.provider_payment_id || js2.record?.payment_id || js2.record?.id || "";
            setTxId(providerPaymentId || "");
            await finalizeUpgrade({ method: "online", txId: providerPaymentId, reference });
          } else if (["failed","cancelled","void"].includes(status)) {
            clearInterval(poll);
            try { if (w && !w.closed) w.close(); } catch {}
            setError("Payment failed or cancelled. Please retry or submit proof.");
            setProcessing(false);
          } else if (attempts > 60) {
            clearInterval(poll);
            setError("Payment not confirmed yet. If you completed payment, please upload proof or retry.");
            setProcessing(false);
          }
        } catch (e) {
          // ignore transient
        }
      }, 3000);
    } catch (e) {
      console.error("createOrder error", e);
      setError("Payment initiation failed.");
      setProcessing(false);
    }
  }, [selectedMeta, selectedCategory, id, record, entity, finalizeUpgrade]);

  // finalize upgrade and update cached row only (and notify)
  const finalizeUpgrade = useCallback(async ({ method = "online", txId = null, reference = null, proofUrl = null } = {}) => {
    setProcessing(true);
    setError("");
    setMessage("");
    try {
      const upgradePayload = { newCategory: selectedCategory, txId, reference, proofUrl, amount: selectedMeta.total || selectedMeta.price || 0 };

      // Try dedicated endpoint first; fallback to PUT
      let res = await fetch(`/api/visitors/${encodeURIComponent(String(id))}/upgrade`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(upgradePayload) }).catch(()=>null);
      if (!res || !res.ok) {
        res = await fetch(`/api/visitors/${encodeURIComponent(String(id))}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket_category: selectedCategory, txId, payment_reference: reference, payment_proof_url: proofUrl }) }).catch(()=>null);
      }

      if (!res || !res.ok) {
        const bodyText = res ? await res.text().catch(()=>null) : null;
        setError(`Upgrade failed: ${String(bodyText) || "server error"}`);
        setProcessing(false);
        return;
      }

      // fetch fresh record if possible
      let updated = null;
      try {
        const r = await fetch(`/api/visitors/${encodeURIComponent(String(id))}`);
        if (r.ok) {
          updated = await r.json().catch(()=>null);
        }
      } catch (e) { /* ignore */ }

      // If we couldn't fetch updated record, mutate local 'record' minimally
      const finalRecord = updated || { ...(record || {}), ticket_category: selectedCategory, ticket_code: (record && (record.ticket_code || record.ticketCode)) || providedTicketCode || "" };

      // write updated record to cache and notify dashboard/other windows
      try {
        writeRegistrationCache("visitors", id, finalRecord);
      } catch (e) { /* ignore */ }

      // generate PDF and email (best-effort)
      try {
        let pdf = null;
        if (typeof generateVisitorBadgePDF === "function") {
          pdf = await generateVisitorBadgePDF(finalRecord, "", { includeQRCode: true, qrPayload: { ticket_code: finalRecord.ticket_code || finalRecord.ticketCode || providedTicketCode || "" }, event: (finalRecord && finalRecord.event) || {} });
        }
        // build and send email
        try {
          const frontendBase = (typeof window !== "undefined" && window.location && window.location.origin) ? window.location.origin : "";
          const bannerUrl = (readLocalPricing() && readLocalPricing().bannerUrl) || "";
          const emailModel = {
            frontendBase,
            entity: "visitors",
            id,
            name: finalRecord?.name || "",
            company: finalRecord?.company || "",
            ticket_code: finalRecord?.ticket_code || finalRecord?.ticketCode || providedTicketCode || "",
            ticket_category: selectedCategory,
            bannerUrl,
            badgePreviewUrl: "",
            downloadUrl: "",
            event: (finalRecord && finalRecord.event) || {}
          };
          const { subject, text, html } = buildTicketEmail(emailModel);
          const mailPayload = { to: finalRecord?.email, subject, text, html, attachments: [] };
          if (pdf) {
            const b64 = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(String(reader.result || "").split(",")[1] || "");
              reader.onerror = () => resolve("");
              reader.readAsDataURL(pdf);
            });
            if (b64) mailPayload.attachments.push({ filename: "E-Badge.pdf", content: b64, encoding: "base64", contentType: "application/pdf" });
          }
          await fetch("/api/mailer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mailPayload) }).catch(()=>null);
        } catch (e) { console.warn("mail send failed", e); }
      } catch (e) {
        console.warn("PDF generation failed", e);
      }

      // update UI state and finish
      setRecord(finalRecord);
      setMessage("Upgrade successful — row updated. Check email for e‑badge.");
      setProcessing(false);
    } catch (e) {
      console.error("finalizeUpgrade", e);
      setError("Finalize upgrade failed.");
      setProcessing(false);
    }
  }, [selectedCategory, selectedMeta, id, record, providedTicketCode]);

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
      const res = await fetch(`/api/visitors/${encodeURIComponent(String(id))}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "Cancelled via upgrade page" }) }).catch(()=>null);
      if (!res || !res.ok) {
        const r2 = await fetch(`/api/visitors/${encodeURIComponent(String(id))}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "cancelled" }) }).catch(()=>null);
        if (!r2 || !r2.ok) {
          setError("Cancel failed");
          setProcessing(false);
          return;
        }
      }
      // update cache and notify
      const cancelledRecord = { ...(record || {}), status: "cancelled" };
      writeRegistrationCache("visitors", id, cancelledRecord);
      setMessage("Registration cancelled.");
      setProcessing(false);
    } catch (e) {
      console.error("cancel", e);
      setError("Cancel failed");
      setProcessing(false);
    }
  }, [id, record]);

  const availableCategories = useMemo(() => {
    const local = readLocalPricing();
    return local && local.visitors ? local.visitors : null;
  }, [record]);

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
              <div className="text-xl font-semibold">{record.name || record.company || `#${record.id}`}</div>
              <div className="text-sm text-gray-600">{record.email || ""} • {record.mobile || ""}</div>
              <div className="mt-2 text-sm">Current category: <strong>{record.ticket_category || record.category || "—"}</strong></div>
            </div>

            <div className="mb-6">
              <div className="text-lg font-semibold mb-3">Choose a new ticket category</div>
              <TicketCategorySelector role="visitors" value={selectedCategory} onChange={onCategoryChange} categories={availableCategories} />
            </div>

            <div className="mb-4">
              <div className="text-sm text-gray-600">Selected: <strong>{selectedMeta.label || selectedCategory}</strong></div>
              <div className="text-2xl font-extrabold">{selectedMeta.total ? `₹${Number(selectedMeta.total).toLocaleString("en-IN")}` : "Free (no payment needed)"}</div>
              {selectedMeta.gstAmount ? <div className="text-sm text-gray-500">Includes GST: ₹{Number(selectedMeta.gstAmount).toLocaleString("en-IN")}</div> : null}
            </div>

            <div className="mb-6">
              {selectedMeta.total && Number(selectedMeta.total) > 0 ? (
                <>
                  <div className="mb-3">
                    <button className="px-4 py-2 bg-indigo-600 text-white rounded font-semibold mr-3" onClick={createOrderAndOpenCheckout} disabled={processing}>
                      {processing ? "Processing…" : "Pay & Upgrade"}
                    </button>
                    <span className="text-sm text-gray-500">or upload payment proof below</span>
                  </div>

                  <ManualPaymentStep
                    ticketType={selectedCategory}
                    ticketPrice={selectedMeta.total}
                    onProofUpload={onManualProofUpload}
                    onTxIdChange={(v) => setTxId(v)}
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
                  <button className="px-4 py-2 bg-green-600 text-white rounded font-semibold" onClick={() => finalizeUpgrade({ method: "free" })} disabled={processing}>
                    {processing ? "Applying…" : "Apply Upgrade (Free)"}
                  </button>
                </div>
              )}
            </div>

            <div className="mb-6">
              <div className="text-lg font-semibold mb-3">Preview E‑Badge</div>
              <VisitorTicket visitor={record} qrSize={200} showQRCode={true} accentColor="#2b6b4a" />
            </div>

            {message && <div className="mt-3 text-green-700">{message}</div>}
          </div>
        )}
      </div>
    </div>
  );
}