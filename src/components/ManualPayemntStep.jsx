import React, { useEffect, useRef, useState } from "react";

/**
 * ManualPaymentStep (Instamojo-ready)
 *
 * - Calls POST /api/payment/create-order with amount, reference_id and metadata.
 * - Backend returns { success: true, checkoutUrl, providerOrderId, raw }.
 * - Polls GET /api/payment/status?reference_id=... to detect success.
 */
export default function ManualPaymentStep({
  ticketType,
  ticketPrice = 0,
  onProofUpload,
  onTxIdChange,
  txId,
  proofFile,
  setProofFile,
}) {
  const [loading] = useState(false);
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

  async function createOrder() {
    setError("");
    setPayLoading(true);
    try {
      const verifiedEmail = (typeof window !== "undefined" && (localStorage.getItem("verifiedEmail") || sessionStorage.getItem("verifiedEmail"))) || "";
      const referenceId = verifiedEmail || `guest-${Date.now()}`;
      const payload = {
        amount: ticketPrice,
        currency: "INR",
        description: `Ticket - ${ticketType}`,
        reference_id: referenceId,
        metadata: {
          ticketType,
          referenceId,
          buyer_name: (typeof window !== "undefined" && localStorage.getItem("visitorName")) || "",
          email: verifiedEmail || "",
        },
      };

      const res = await fetch("/api/payment/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data && (data.error || data.details || JSON.stringify(data)) ? (data.error || JSON.stringify(data)) : `Failed to create payment order (status ${res.status})`);
        setPayLoading(false);
        return;
      }

      const checkoutUrl = data.checkoutUrl || data.longurl || data.raw?.payment_request?.longurl || data.raw?.longurl;
      if (!checkoutUrl) {
        setError("Payment provider did not return a checkout URL.");
        setPayLoading(false);
        return;
      }

      const w = window.open(checkoutUrl, "_blank", "noopener,noreferrer");
      if (!w) {
        setError("Could not open payment window. Please allow popups.");
        setPayLoading(false);
        return;
      }
      setCheckoutOpened(true);
      setPaymentStatus("pending");

      const reference_id = payload.reference_id;
      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts += 1;
        try {
          const st = await fetch(`/api/payment/status?reference_id=${encodeURIComponent(reference_id)}`);
          if (!st.ok) return;
          const js = await st.json();
          const status = (js.status || "").toString().toLowerCase();
          if (["paid", "captured", "completed", "success"].includes(status)) {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setPaymentStatus("paid");
            const rec = js.record || js.data || js.payment || js;
            const providerPaymentId = rec?.provider_payment_id || rec?.payment_id || rec?.id || null;
            const finalTx = providerPaymentId || `instamojo-${Date.now()}`;
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
        } catch (e) {}
      }, 3000);
    } catch (err) {
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
          <button className="px-4 py-2 bg-green-600 text-white rounded disabled:opacity-60" onClick={createOrder} disabled={payLoading || checkoutOpened}>
            {payLoading ? "Opening checkout..." : checkoutOpened ? "Checkout opened" : "Pay Online"}
          </button>
          
        </div>
        {paymentStatus === "pending" && <div className="mt-2 text-sm text-yellow-600">Waiting for provider confirmation...</div>}
        {paymentStatus === "paid" && <div className="mt-2 text-sm text-green-600">Payment confirmed.</div>}
      </div>
      <hr className="my-4" />
    
      {error && <div className="mt-4 text-red-600 font-medium">{error}</div>}
      <div className="mt-4 text-xs text-gray-500">If you pay online, the checkout will open in a new tab. After successful payment we will automatically continue the registration.</div>
    </div>
  );
}