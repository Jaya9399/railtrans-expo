import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import TicketCategorySelector from "../components/TicketCategoryGenerator";
import VisitorTicket from "../components/VisitorTicket";
import { readRegistrationCache, writeRegistrationCache } from "../utils/registrationCache";

const LOCAL_PRICE_KEY = "ticket_categories_local_v1";
const API_BASE = (
  (typeof window !== "undefined" && window.__API_BASE__) ||
  process.env.REACT_APP_API_BASE ||
  ""
).replace(/\/+$/, "");

const FRONTEND_BASE = (
  (typeof window !== "undefined" && window.__FRONTEND_BASE__) ||
  process.env.REACT_APP_FRONTEND_BASE ||
  window.location?. origin ||
  ""
).replace(/\/$/, "");

function readLocalPricing() {
  try {
    const raw = localStorage.getItem(LOCAL_PRICE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function normalizeEmail(e) {
  try {
    return String(e || "")
      .trim()
      .toLowerCase();
  } catch {
    return "";
  }
}

function buildApiUrl(path) {
  if (! API_BASE) return path;
  if (/^https?:\/\//i.test(path)) return path;
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${cleanPath}`;
}

async function tryFetch(url, opts = {}) {
  try {
    const r = await fetch(url, {
      ...opts,
      headers: {
        ...opts.headers,
        "ngrok-skip-browser-warning": "69420",
      },
    });
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") || "";
    if (! ct.toLowerCase().includes("application/json")) return null;
    return await r.json().catch(() => null);
  } catch {
    return null;
  }
}

export default function TicketUpgrade() {
  const [search] = useSearchParams();
  const navigate = useNavigate();

  const entity = (search.get("entity") || "visitors").toString().toLowerCase();
  const id = search.get("id") || "";
  const providedTicketCode = search.get("ticket_code") || "";
  const expectedEmailParam = search.get("email") || "";
  const expectedEmail = expectedEmailParam ? normalizeEmail(expectedEmailParam) : null;

  const [loading, setLoading] = useState(true);
  const [record, setRecord] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedMeta, setSelectedMeta] = useState({
    price: 0,
    gstRate: 0,
    gstAmount: 0,
    total: 0,
    label: "",
  });

  const [processing, setProcessing] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [paymentCheckoutUrl, setPaymentCheckoutUrl] = useState("");

  console.log("[TicketUpgrade] Init:", { entity, id, expectedEmail });

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError("");

      if (entity !== "visitors") {
        setError("Ticket upgrade is for visitors only.");
        setLoading(false);
        return;
      }

      if (! id && !providedTicketCode) {
        setError("Missing visitor id or ticket_code.");
        setLoading(false);
        return;
      }

      // Try ID first
      if (id) {
        try {
          // Check cache
          const cached = readRegistrationCache(entity, id);
          if (cached && (! expectedEmail || normalizeEmail(cached.email) === expectedEmail)) {
            if (! mounted) return;
            setRecord(cached);
            const cur = cached. ticket_category || "";
            setSelectedCategory(cur);
            updateMetaFromCategory(cur);
            setLoading(false);
            return;
          }

          // Fetch from API
          const url = buildApiUrl(`/api/visitors/${encodeURIComponent(id)}`);
          console.log("[TicketUpgrade] Fetching:", url);

          const js = await tryFetch(url, { credentials: "same-origin" });
          if (!js) {
            setError("Visitor not found by id.");
            setLoading(false);
            return;
          }

          const data = js.data || js;

          // Validate email
          if (expectedEmail) {
            const fetchedEmail = normalizeEmail(data.email || "");
            if (fetchedEmail !== expectedEmail) {
              setError("Email mismatch.");
              setLoading(false);
              return;
            }
          }

          if (! mounted) return;
          setRecord(data);
          const cur = data.ticket_category || "";
          setSelectedCategory(cur);
          updateMetaFromCategory(cur);
          setLoading(false);
          return;
        } catch (e) {
          console.error("[TicketUpgrade] Load by id failed:", e);
          setError("Failed to load visitor.");
          setLoading(false);
          return;
        }
      }

      // Try ticket code
      if (providedTicketCode) {
        try {
          const url = buildApiUrl(`/api/visitors/by-ticket/${encodeURIComponent(providedTicketCode)}`);
          console.log("[TicketUpgrade] Fetching by ticket:", url);

          const js = await tryFetch(url, { credentials: "same-origin" });
          if (!js) {
            setError("Visitor not found by ticket code.");
            setLoading(false);
            return;
          }

          const data = js.data || js;

          // Validate ticket
          const fetchedTicket = (data.ticket_code || "").toString().trim();
          if (!fetchedTicket || fetchedTicket !== String(providedTicketCode).trim()) {
            setError("Ticket code mismatch.");
            setLoading(false);
            return;
          }

          // Validate email
          if (expectedEmail) {
            const fetchedEmail = normalizeEmail(data. email || "");
            if (fetchedEmail !== expectedEmail) {
              setError("Email mismatch.");
              setLoading(false);
              return;
            }
          }

          if (! mounted) return;
          setRecord(data);
          const cur = data.ticket_category || "";
          setSelectedCategory(cur);
          updateMetaFromCategory(cur);
          setLoading(false);
          return;
        } catch (e) {
          console.error("[TicketUpgrade] Load by ticket failed:", e);
          setError("Failed to load visitor.");
          setLoading(false);
          return;
        }
      }
    }

    function updateMetaFromCategory(cat) {
      if (!cat) return;
      const localPricing = readLocalPricing();
      if (!localPricing?. visitors) return;

      const found = localPricing.visitors.find(
        (c) => String(c.value).toLowerCase() === String(cat).toLowerCase()
      );

      if (found) {
        const price = Number(found.price || 0);
        const gstRate = Number(found.gst || 0);
        const gstAmount = Math.round(price * gstRate);
        const total = Math.round(price + gstAmount);

        setSelectedMeta({
          price,
          gstRate,
          gstAmount,
          total,
          label: found. label || found.value,
        });
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [entity, id, providedTicketCode, expectedEmail]);

  const onCategoryChange = useCallback((val, meta) => {
    console.log("[TicketUpgrade] Category changed:", val, meta);
    setSelectedCategory(val);
    setSelectedMeta(meta || { price: 0, gstRate: 0, gstAmount:  0, total: 0, label: val });
    setShowPayment(false);
    setPaymentCheckoutUrl("");
  }, []);

  const isSelectedFree = useMemo(() => {
    const t = Number(selectedMeta.total || selectedMeta.price || 0);
    return ! t || t === 0;
  }, [selectedMeta]);

  const currentCategory = (record?.ticket_category || "");
  const isSameCategory = useMemo(() => {
    if (!selectedCategory) return true;
    return String(selectedCategory).toLowerCase() === String(currentCategory).toLowerCase();
  }, [selectedCategory, currentCategory]);

  const applyUpgrade = useCallback(async () => {
    setProcessing(true);
    setError("");
    setMessage("");
    setShowPayment(false);
    setPaymentCheckoutUrl("");

    try {
      const targetId = id || record?.id || record?._id || "";
      if (!targetId) {
        setError("Missing target id");
        setProcessing(false);
        return;
      }

      const payload = {
        entity_type:  "visitors",
        entity_id:  targetId,
        new_category: selectedCategory,
        amount: selectedMeta.total || 0,
        email: record?.email || null,
      };

      console.log("[TicketUpgrade] Sending upgrade request:", payload);

      const url = buildApiUrl("/api/tickets/upgrade");
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "69420",
        },
        body: JSON.stringify(payload),
        credentials: "same-origin",
      });

      const js = await res.json().catch(() => ({}));

      console.log("[TicketUpgrade] Response:", js);

      if (!res.ok) {
        setError(js. error || `Upgrade failed (${res.status})`);
        setProcessing(false);
        return;
      }

      // Check if payment required
      if (js.payment_required && js.checkoutUrl) {
        console.log("[TicketUpgrade] Payment required, opening checkout:", js.checkoutUrl);
        
        // Open checkout in new window
        const w = window.open(js.checkoutUrl, "_blank", "noopener,noreferrer");
        if (!w) {
          setError("Could not open payment window.  Please allow popups.");
          setProcessing(false);
          return;
        }

        setMessage("Payment window opened. Complete payment to finish upgrade.");
        setShowPayment(true);
        setPaymentCheckoutUrl(js.checkoutUrl);
        setProcessing(false);
        return;
      }

      // Upgrade completed
      console.log("[TicketUpgrade] ✅ Upgrade completed");

      // Refetch record
      const fetchUrl = buildApiUrl(`/api/visitors/${encodeURIComponent(targetId)}`);
      const updatedData = await tryFetch(fetchUrl, { credentials: "same-origin" });
      const updated = updatedData?. data || updatedData || null;

      if (updated) {
        setRecord(updated);
        try {
          writeRegistrationCache("visitors", targetId, updated);
        } catch {}
      }

      setMessage("✅ Upgrade successful!  Check your email for confirmation.");
      setProcessing(false);
    } catch (e) {
      console.error("[TicketUpgrade] Error:", e);
      setError("Upgrade failed:  " + e.message);
      setProcessing(false);
    }
  }, [selectedCategory, selectedMeta, id, record]);

  const availableCategories = useMemo(() => {
    const local = readLocalPricing();
    return local?.visitors || null;
  }, []);

  const canApply = useMemo(() => {
    if (processing) return false;
    if (!selectedCategory) return false;
    if (isSameCategory) return false;
    return true;
  }, [processing, selectedCategory, isSameCategory]);

  return (
    <div className="min-h-screen flex items-start justify-center p-6 bg-gray-50">
      <div className="w-full max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Upgrade Your Visitor Ticket</h1>
            <div className="text-sm text-gray-600">
              Choose a new ticket category and complete payment if required. 
            </div>
          </div>
          <button className="px-3 py-1 border rounded" onClick={() => navigate(-1)}>
            Back
          </button>
        </div>

        {loading ?  (
          <div className="p-6 bg-white rounded shadow">Loading visitor…</div>
        ) : error ? (
          <div className="p-6 bg-red-50 text-red-700 rounded shadow">{error}</div>
        ) : ! record ? (
          <div className="p-6 bg-yellow-50 rounded shadow">Visitor not found. </div>
        ) : (
          <div className="bg-white rounded shadow p-6">
            <div className="mb-4">
              <div className="text-sm text-gray-500">Visitor</div>
              <div className="text-xl font-semibold">
                {record.name || record.company || `#${id || providedTicketCode}`}
              </div>
              <div className="text-sm text-gray-600">
                {record.email || ""} • {record.mobile || ""}
              </div>
              <div className="mt-2 text-sm">
                Current category: <strong>{currentCategory || "—"}</strong>
              </div>
            </div>

            <div className="mb-6">
              <div className="text-lg font-semibold mb-3">Choose a new ticket category</div>
              <TicketCategorySelector
                role="visitors"
                value={selectedCategory}
                onChange={onCategoryChange}
                categories={availableCategories}
                disabled={processing}
              />
            </div>

            <div className="mb-4">
              <div className="text-sm text-gray-600">
                Selected:  <strong>{selectedMeta.label || selectedCategory || "—"}</strong>
              </div>
              <div className="text-2xl font-extrabold">
                {selectedMeta.total
                  ? `₹${Number(selectedMeta.total).toLocaleString("en-IN")}`
                  : "Free (no payment)"}
              </div>
              {selectedMeta.gstAmount ?  (
                <div className="text-sm text-gray-500">
                  Includes GST:  ₹{Number(selectedMeta.gstAmount).toLocaleString("en-IN")}
                </div>
              ) : null}
            </div>

            <div className="mb-6">
              <button
                className={`px-6 py-3 rounded font-semibold ${
                  canApply
                    ? "bg-green-600 text-white hover:bg-green-700"
                    :  "bg-gray-200 text-gray-500 cursor-not-allowed"
                }`}
                onClick={applyUpgrade}
                disabled={!canApply}
              >
                {processing
                  ? "Processing..."
                  : isSelectedFree
                  ? "Apply Upgrade (Free)"
                  : "Proceed to Payment"}
              </button>

              {! selectedCategory && (
                <div className="mt-2 text-sm text-gray-500">Select a category to continue. </div>
              )}
              {selectedCategory && isSameCategory && (
                <div className="mt-2 text-sm text-gray-500">
                  Selected category is same as current. 
                </div>
              )}
            </div>

            {showPayment && paymentCheckoutUrl && (
              <div className="mb-6 p-4 bg-blue-50 rounded border border-blue-200">
                <div className="font-semibold mb-2">Payment Required</div>
                <div className="text-sm text-gray-700 mb-3">
                  A payment window has been opened. Complete the payment to finish your upgrade.
                </div>
                <a
                  href={paymentCheckoutUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 underline text-sm"
                >
                  Click here if payment window didn't open
                </a>
              </div>
            )}

            <div className="mb-6">
              <div className="text-lg font-semibold mb-3">Preview E-Badge</div>
              <VisitorTicket
                visitor={record}
                qrSize={200}
                showQRCode={true}
                accentColor="#2b6b4a"
                apiBase={API_BASE}
              />
            </div>

            {message && (
              <div className="mt-4 p-3 bg-green-50 text-green-700 rounded">{message}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}