import React, { useEffect, useRef, useState } from "react";

/**
 * ManualPaymentStep (Instamojo-ready)
 *
 * - Calls POST /api/payment/create-order on YOUR backend with { amount, reference_id, metadata... }.
 * - Backend calls the provider (Instamojo) and returns { success, checkoutUrl, providerOrderId, raw }.
 * - Polls GET /api/payment/status?reference_id=... to detect success.
 *
 * IMPORTANT: configure REACT_APP_API_BASE or window.__API_BASE__ to point to your backend origin.
 * Do NOT set API_BASE to the payment provider URL.
 */

export default function ManualPaymentStep({
  ticketType,
  ticketPrice = 0,
  onProofUpload,
  onTxIdChange,
  txId,
  proofFile,
  setProofFile,
  apiBase, // optional prop: backend origin (e.g. "https://api.example.com")
}) {
  const [payLoading, setPayLoading] = useState(false);
  const [error, setError] = useState("");
  const [checkoutOpened, setCheckoutOpened] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState("created");
  const pollRef = useRef(null);

  const gst = Math.round(ticketPrice * 0.18);
  const total = ticketPrice + gst;

  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  // derive backend base URL: prop -> env -> window global -> empty (relative)
  const backendBaseCandidate =
    (apiBase && String(apiBase).trim()) ||
    (typeof process !== "undefined" && process.env && process.env.REACT_APP_API_BASE) ||
    (typeof window !== "undefined" && window.__API_BASE__) ||
    "";

  // Protect: if candidate looks like a payment provider host (instamojo/irmaindia/etc), ignore it.
  function likelyProviderHost(h) {
    if (!h) return false;
    const lc = String(h).toLowerCase();
    return lc.includes("instamojo") || lc.includes("irmaindia") || lc.includes("razorpay") || lc.includes("paytm") || lc.includes("stripe") || lc.includes("paypal");
  }

  const backendBase = likelyProviderHost(backendBaseCandidate) ? "" : backendBaseCandidate;

  function makeUrl(path) {
    // prefer relative path if backendBase empty — this will use the same origin (good with proxies)
    if (!backendBase) return path.startsWith("/") ? path : `/${path}`;
    // ensure path prefix
    return `${String(backendBase).replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  }

  async function createOrder() {
    setError("");
    setPayLoading(true);

    try {
      // build a reference id
      const verifiedEmail =
        (typeof window !== "undefined" && (localStorage.getItem("verifiedEmail") || sessionStorage.getItem("verifiedEmail"))) || "";
      const referenceId = (verifiedEmail && verifiedEmail.trim()) || `guest-${Date.now()}`;

      const payload = {
        amount: ticketPrice,
        currency: "INR",
        description: `Ticket - ${ticketType || "General"}`,
        reference_id: referenceId,
        metadata: {
          ticketType,
          referenceId,
          buyer_name: (typeof window !== "undefined" && localStorage.getItem("visitorName")) || "",
          email: (verifiedEmail && verifiedEmail.trim()) || "",
        },
      };

      const endpoint = makeUrl("/api/payment/create-order");
      console.log("[ManualPaymentStep] createOrder ->", endpoint, "payload:", payload);

      // If backendBaseCandidate looked like a provider host, show a clear message
      if (!backendBase && backendBaseCandidate && likelyProviderHost(backendBaseCandidate)) {
        const msg = `Frontend API base resolved to a payment provider host (${backendBaseCandidate}). Update REACT_APP_API_BASE or window.__API_BASE__ to point to your backend origin. Sending request to relative path instead.`;
        console.warn("[ManualPaymentStep] " + msg);
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });

      // attempt to parse JSON, but capture raw text if non-JSON
      let data = null;
      let rawText = null;
      try {
        rawText = await res.text();
        try { data = JSON.parse(rawText); } catch { data = null; }
      } catch (e) {
        rawText = null;
        data = null;
      }
      console.log("[ManualPaymentStep] create-order response:", res.status, data || rawText);

      if (!res.ok || !data || !data.success) {
        // helpful error: if provider host got the request directly you often get HTML or 405 text
        const providerHint = backendBaseCandidate && likelyProviderHost(backendBaseCandidate)
          ? "It looks like your frontend is configured to call the payment provider directly. Make sure REACT_APP_API_BASE / window.__API_BASE__ point to your backend (not the provider)."
          : null;
        const errMsg =
          (data && (data.error || data.provider_error || data.details || JSON.stringify(data))) ||
          (rawText && rawText.slice(0, 200)) ||
          `Failed to create payment order (status ${res.status})` +
          (providerHint ? " - " + providerHint : "");
        setError(errMsg);
        setPayLoading(false);
        return;
      }

      const checkoutUrl = data.checkoutUrl || data.longurl || data.raw?.payment_request?.longurl || data.raw?.longurl;
      if (!checkoutUrl) {
        setError("Payment provider did not return a checkout URL.");
        setPayLoading(false);
        return;
      }

      // open checkout
      const w = window.open(checkoutUrl, "_blank", "noopener,noreferrer");
      if (!w) {
        setError("Could not open payment window. Please allow popups.");
        setPayLoading(false);
        return;
      }

      setCheckoutOpened(true);
      setPaymentStatus("pending");

      // start polling payment status
      const reference_id = payload.reference_id;
      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts += 1;
        try {
          const statusUrl = makeUrl(`/api/payment/status?reference_id=${encodeURIComponent(reference_id)}`);
          const st = await fetch(statusUrl, { method: "GET", credentials: "include" });
          if (!st.ok) {
            console.warn("[ManualPaymentStep] status fetch not ok:", st.status);
            return;
          }
          const js = await st.json().catch(() => null);
          if (!js) return;
          const status = (js.status || "").toString().toLowerCase();
          if (["paid", "captured", "completed", "success"].includes(status)) {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setPaymentStatus("paid");
            const rec = js.record || js.data || js.payment || js;
            const providerPaymentId = rec?.provider_payment_id || rec?.payment_id || rec?.id || null;
            const finalTx = providerPaymentId || `provider-${Date.now()}`;
            try { onTxIdChange && onTxIdChange(finalTx); } catch (_) {}
            try { if (w && !w.closed) w.close(); } catch (_) {}
            onProofUpload && onProofUpload();
          } else if (["failed", "cancelled", "void"].includes(status)) {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setPaymentStatus("failed");
            setError("Payment failed or cancelled. You may retry.");
            try { if (w && !w.closed) w.close(); } catch (_) {}
          } else {
            if (attempts > 40) {
              clearInterval(pollRef.current);
              pollRef.current = null;
              setPaymentStatus("pending");
              setError("Payment not confirmed yet. If you completed payment, wait a bit and refresh the page.");
            }
          }
        } catch (e) {
          console.warn("[ManualPaymentStep] polling error:", e && e.message);
        }
      }, 3000);
    } catch (err) {
      console.error("[ManualPaymentStep] createOrder error:", err && (err.stack || err));
      setError(err.message || "Payment initiation failed");
    } finally {
      setPayLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-xl p-8 max-w-lg mx-auto mt-8">
      <div className="text-xl font-bold mb-2">
        Payment — {ticketType ? `${ticketType.charAt(0).toUpperCase() + ticketType.slice(1)} Ticket` : "Ticket"}
      </div>

      <div className="mb-4">
        <div className="text-sm text-gray-600">Amount</div>
        <div className="text-2xl font-semibold text-[#196e87]">₹{ticketPrice}</div>
        <div className="text-xs text-gray-500">GST (18%): ₹{gst} — Total: ₹{total}</div>
      </div>

      <div className="mb-6">
        <div className="font-semibold mb-2">Pay Online (Recommended)</div>
        <div className="text-sm text-gray-700 mb-3">Secure checkout via your payment provider.</div>

        <div className="flex gap-3">
          <button
            className="px-4 py-2 bg-green-600 text-white rounded disabled:opacity-60"
            onClick={createOrder}
            disabled={payLoading || checkoutOpened}
          >
            {payLoading ? "Opening checkout..." : checkoutOpened ? "Checkout opened" : "Pay Online"}
          </button>
        </div>

        {paymentStatus === "pending" && <div className="mt-2 text-sm text-yellow-600">Waiting for provider confirmation...</div>}
        {paymentStatus === "paid" && <div className="mt-2 text-sm text-green-600">Payment confirmed.</div>}
      </div>

      <hr className="my-4" />

      {error && <div className="mt-4 text-red-600 font-medium whitespace-pre-wrap">{error}</div>}
      <div className="mt-4 text-xs text-gray-500">
        If you pay online, the checkout will open in a new tab. After successful payment we will automatically continue the registration.
      </div>
    </div>
  );
}