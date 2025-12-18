import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import TicketCategorySelector from "../components/TicketCategoryGenerator";
import ManualPaymentStep from "../components/ManualPayemntStep";
import VisitorTicket from "../components/VisitorTicket";
import { buildTicketEmail } from "../utils/emailTemplate";
import { readRegistrationCache, writeRegistrationCache } from "../utils/registrationCache";

/* ---------- helper functions (added to fix build errors) ---------- */

// Local price cache key and reader (used by the component)
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

// uploadAsset helper used for manual proof uploads
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

/* ---------- API base helpers ---------- */
function sanitizeApiBaseCandidate(candidate) {
  if (!candidate) return "";
  let s = String(candidate).trim().replace(/\/+$/, "");
  const low = s.toLowerCase();
  const idx = low.indexOf("/api/");
  const idxExact = low.endsWith("/api") ? low.lastIndexOf("/api") : -1;
  if (idx >= 0) s = s.slice(0, idx);
  if (idxExact >= 0) s = s.slice(0, idxExact);
  return s;
}

const RAW_API_BASE =
  (typeof window !== "undefined" && (window.__API_BASE__ || "")) ||
  (process.env.REACT_APP_API_BASE || process.env.API_BASE || process.env.BACKEND_URL || "");
const API_BASE = sanitizeApiBaseCandidate(RAW_API_BASE);

const RAW_FRONTEND_BASE =
  (typeof window !== "undefined" && (window.__FRONTEND_BASE__ || "")) ||
  (process.env.REACT_APP_FRONTEND_BASE || process.env.FRONTEND_BASE || process.env.APP_URL || "");
const FRONTEND_BASE = String(RAW_FRONTEND_BASE || window.location?.origin || "http://localhost:3000").replace(/\/$/, "");

function buildApiUrl(path) {
  if (!path) return API_BASE || path;
  if (/^https?:\/\//i.test(path)) return path;
  if (!API_BASE) return path.startsWith("/") ? path : `/${path}`;
  if (path.startsWith("/")) return `${API_BASE}${path}`;
  return `${API_BASE}/${path}`;
}

/* ---------- fetching helpers ---------- */
async function tryFetchCandidates(pathVariants = []) {
  // Iterate candidates (caller should order abs -> rel)
  for (const url of pathVariants) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" }, credentials: "same-origin" });
      const ct = (res && res.headers && typeof res.headers.get === "function") ? (res.headers.get("content-type") || "") : "";
      if (!res.ok) {
        if (res.status === 404) continue;
        const text = await res.text().catch(() => "");
        console.warn(`Request ${url} failed ${res.status} - ${text.slice(0, 400)}`);
        continue;
      }
      if (!ct.toLowerCase().includes("application/json")) {
        // likely index.html or non-json; skip
        const txt = await res.text().catch(() => "");
        console.warn(`[tryFetchCandidates] Non-JSON response from ${url} (content-type=${ct}). Snippet:`, txt ? txt.slice(0, 400) : "(empty)");
        continue;
      }
      const js = await res.json().catch(() => null);
      if (js !== null) return js;
    } catch (e) {
      console.warn("[tryFetchCandidates] fetch error for", url, e && e.message ? e.message : e);
      continue;
    }
  }
  return null;
}

/* ---------- candidate builders (ABS first then relative) ---------- */
function qCandidatesForVisitors(q) {
  const abs = buildApiUrl(`/api/visitors?q=${encodeURIComponent(q)}&limit=1`);
  const rel = `/api/visitors?q=${encodeURIComponent(q)}&limit=1`;
  return [abs, rel];
}

function idCandidatesForVisitors(id) {
  const abs = buildApiUrl(`/api/visitors/${encodeURIComponent(String(id))}`);
  const rel = `/api/visitors/${encodeURIComponent(String(id))}`;
  return [abs, rel];
}

/* ---------- main TicketUpgrade component ---------- */

export default function TicketUpgrade() {
  const [search] = useSearchParams();
  const navigate = useNavigate();

  const entity = (search.get("entity") || search.get("type") || "visitors").toString().toLowerCase();
  const id = search.get("id") || search.get("visitorId") || "";
  const providedTicketCode = search.get("ticket_code") || search.get("ticket") || "";

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

      if (id) {
        try {
          const cached = readRegistrationCache(entity, id);
          if (cached) {
            if (!mounted) return;
            setRecord(cached);
            const cur = cached.ticket_category || cached.category || cached.ticketCategory || "";
            setSelectedCategory(cur || "");
            const localPricing = readLocalPricing();
            if (cur && localPricing && localPricing.visitors) {
              const found = localPricing.visitors.find(c => String(c.value).toLowerCase() === String(cur).toLowerCase());
              if (found && mounted) {
                const price = Number(found.price || 0);
                const gst = Number(found.gst || 0);
                setSelectedMeta({ price, gstRate: gst, gstAmount: Math.round(price * gst), total: Math.round(price + price * gst), label: found.label || found.value });
              }
            }
            setLoading(false);
            return;
          }
        } catch (e) {
          // ignore cache errors
        }
      }

      try {
        let js = null;
        if (id) {
          const candidates = idCandidatesForVisitors(id);
          js = await tryFetchCandidates(candidates);
          if (!js) {
            js = await tryFetchCandidates(qCandidatesForVisitors(id));
            if (Array.isArray(js)) js = js[0] || null;
            if (js && Array.isArray(js.rows)) js = js.rows[0] || null;
          }
        }
        if (!js && providedTicketCode) {
          const arr = await tryFetchCandidates(qCandidatesForVisitors(providedTicketCode));
          if (Array.isArray(arr)) js = arr[0] || null;
          else js = arr;
        }
        if (!js) {
          if (mounted) setError("Visitor not found");
          if (mounted) setLoading(false);
          return;
        }
        if (js && js.data && (typeof js.data === "object")) js = js.data;
        if (Array.isArray(js)) js = js[0] || null;

        if (mounted) {
          setRecord(js);
          const cur = js.ticket_category || js.category || js.ticketCategory || "";
          setSelectedCategory(cur || "");
          if (cur) {
            const localPricing = readLocalPricing();
            if (localPricing && localPricing.visitors) {
              const found = localPricing.visitors.find(c => String(c.value).toLowerCase() === String(cur).toLowerCase());
              if (found) {
                const price = Number(found.price || 0);
                const gst = Number(found.gst || 0);
                setSelectedMeta({ price, gstRate: gst, gstAmount: Math.round(price * gst), total: Math.round(price + price * gst), label: found.label || found.value });
              }
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
      const payload = {
        entity_type: "visitors",
        entity_id: targetId || providedTicketCode || null,
        new_category: selectedCategory,
        amount: selectedMeta.total || selectedMeta.price || 0,
        email: record?.email || null,
        txId: tx,
        reference,
        proofUrl,
        method
      };

      const res = await fetch("/api/tickets/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => null);

      if (!res || !res.ok) {
        const bodyText = res ? await res.text().catch(() => "") : "";
        setError(`Upgrade failed: ${String(bodyText) || "server error"}`);
        setProcessing(false);
        return null;
      }

      const js = await res.json().catch(() => ({}));

      let updated = null;
      try {
        if (targetId) {
          const candidates = idCandidatesForVisitors(targetId);
          const result = await tryFetchCandidates(candidates);
          updated = result || null;
        }
        if (!updated && providedTicketCode) {
          const result = await tryFetchCandidates(qCandidatesForVisitors(providedTicketCode));
          if (Array.isArray(result)) updated = result[0] || null;
          else updated = result;
        }
      } catch (e) { /* ignore */ }

      if (updated && updated.data) updated = updated.data;
      if (Array.isArray(updated)) updated = updated[0] || null;

      const finalRecord = updated || { ...(record || {}), ticket_category: selectedCategory, ticket_code: (js.ticket_code || record && (record.ticket_code || record.ticketCode) || providedTicketCode) };

      try {
        const cacheId = targetId || finalRecord.id || finalRecord._id || finalRecord.insertedId || providedTicketCode || "";
        if (cacheId) writeRegistrationCache("visitors", cacheId, finalRecord);
      } catch (e) {}

      try {
        const bannerUrl = (readLocalPricing() && readLocalPricing().bannerUrl) || "";
        const emailModel = {
          frontendBase: FRONTEND_BASE,
          entity: "visitors",
          id: targetId || providedTicketCode || "",
          name: finalRecord?.name || "",
          company: finalRecord?.company || "",
          ticket_code: finalRecord?.ticket_code || finalRecord?.ticketCode || js.ticket_code || providedTicketCode || "",
          ticket_category: selectedCategory,
          bannerUrl,
          badgePreviewUrl: "",
          downloadUrl: `${FRONTEND_BASE}/ticket-download?entity=visitors&id=${encodeURIComponent(String(targetId || ""))}`,
          event: (finalRecord && finalRecord.event) || null
        };
        const tpl = await buildTicketEmail(emailModel);
        const { subject, text, html } = tpl;
        const mailPayload = { to: finalRecord?.email, subject, text, html, attachments: [] };
        await fetch("/api/mailer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mailPayload) }).catch(()=>null);
      } catch (e) {
        console.warn("mail send failed (no attachments)", e);
      }

      setManualProofFile(null);
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
      const res = targetId ? await fetch(`/api/visitors/${encodeURIComponent(String(targetId))}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "Cancelled via upgrade page" }) }).catch(()=>null) : null;
      if (!res || !res.ok) {
        const r2 = targetId ? await fetch(`/api/visitors/${encodeURIComponent(String(targetId))}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "cancelled" }) }).catch(()=>null) : null;
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
  }, [id, record, providedTicketCode]);

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
              <VisitorTicket visitor={record} qrSize={200} showQRCode={true} accentColor="#2b6b4a" apiBase={API_BASE} />
            </div>

            <div className="flex gap-3 items-center">
              <a href={`${FRONTEND_BASE}/ticket-download?entity=visitors&id=${encodeURIComponent(String(record.id || id || providedTicketCode || ""))}`} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 underline">
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