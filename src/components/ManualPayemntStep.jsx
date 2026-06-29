import React, { useEffect, useRef, useState } from "react";

/**
 * ManualPaymentStep (validated coupon flow, backend finalizes coupon)
 *
 * - Coupons are single-use and final.
 * - Coupon is validated (markUsed: false) in frontend.
 * - Coupon is ONLY consumed in backend during ticket upgrade/payment confirmation.
 * - Coupon/discount state is persisted in sessionStorage for UX.
 */
export default function ManualPaymentStep({
  ticketType,
  ticketPrice = 0,
  onProofUpload,
  onTxIdChange,
  txId,
  proofFile,
  setProofFile,
  apiBase,
}) {
  const [payLoading, setPayLoading] = useState(false);
  const [error, setError] = useState("");
  const [checkoutOpened, setCheckoutOpened] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState("created");
  const pollRef = useRef(null);
  const paymentCompletedRef = useRef(false);

  // coupon states
  const [couponCode, setCouponCode] = useState("");
  const [couponResult, setCouponResult] = useState(null);
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponError, setCouponError] = useState("");

  // LOAD persisted coupon state (for UX refresh)
  useEffect(() => {
    try {
      const sCode = sessionStorage.getItem("couponCode");
      const sResult = sessionStorage.getItem("couponResult");
      if (sCode) setCouponCode(sCode);
      if (sResult) setCouponResult(JSON.parse(sResult));
    } catch {}
  }, []);

  // PERSIST coupon state after result
  useEffect(() => {
    try {
      if (couponResult) {
        sessionStorage.setItem("couponCode", couponCode);
        sessionStorage.setItem("couponResult", JSON.stringify(couponResult));
      }
    } catch {}
  }, [couponCode, couponResult]);

  // totals
  const gst = 0;
  const originalTotal = Number((ticketPrice + gst).toFixed(2));
  const effectiveTotal =
    couponResult &&
    couponResult.valid &&
    typeof couponResult.reducedPrice === "number"
      ? Number((couponResult.reducedPrice || 0).toFixed(2))
      : originalTotal;

  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  // Determine backend base
  const backendBaseCandidate =
    (apiBase && String(apiBase).trim()) ||
    (typeof process !== "undefined" &&
      process.env &&
      process.env.REACT_APP_API_BASE) ||
    (typeof window !== "undefined" && window.__API_BASE__) ||
    "";

  function likelyProviderHost(h) {
    if (!h) return false;
    const lc = String(h).toLowerCase();
    return (
      lc.includes("instamojo") ||
      lc.includes("razorpay") ||
      lc.includes("paytm") ||
      lc.includes("stripe") ||
      lc.includes("paypal")
    );
  }

  const backendBase = likelyProviderHost(backendBaseCandidate)
    ? ""
    : backendBaseCandidate;

  function makeUrl(path) {
    const base = backendBase ? String(backendBase).replace(/\/$/, "") : "";
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    if (!base) return cleanPath;
    return `${base}${cleanPath}`;
  }

  /* ---------- Coupon: validate-only ---------- */
  async function applyCoupon() {
    setCouponBusy(true);
    setCouponError("");
    setCouponResult(null);
    setError("");

    try {
      const code = (couponCode || "").trim().toUpperCase();

      if (!code) {
        setCouponError("Enter a coupon code");
        setCouponBusy(false);
        return;
      }

      const payload = {
        code,
        price: originalTotal,
        markUsed: false,
      };

      const url = makeUrl("/api/coupons/validate");

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "69420",
        },
        body: JSON.stringify(payload),
        credentials: "include",
      });

      const js = await res.json().catch(() => null);

      if (!res.ok || !js) {
        const msg =
          (js && (js.error || js.message)) || `Validate failed (${res.status})`;
        setCouponError(msg);
        setCouponBusy(false);
        return;
      }

      if (!js.valid) {
        setCouponError(js.error || "Invalid or already used coupon");
        setCouponResult(js);
        setCouponBusy(false);
        return;
      }

      setCouponResult(js);
      setCouponError("");
    } catch (e) {
      setCouponError(String(e && (e.message || e)) || "Failed to apply coupon");
    } finally {
      setCouponBusy(false);
    }
  }

  async function markCouponAsUsed(couponId) {
    if (!couponId) return;
    try {
      const res = await fetch(makeUrl(`/api/coupons/${couponId}/use`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "69420",
        },
        body: JSON.stringify({ used_by: "payment_success" }),
      });
      if (res.ok) {
        console.log("[ManualPaymentStep] Coupon marked as used");
        sessionStorage.removeItem("couponCode");
        sessionStorage.removeItem("couponResult");
      }
    } catch (e) {
      console.error("Failed to mark coupon as used:", e);
    }
  }

  async function createOrder() {
    setError("");
    setPayLoading(true);
    paymentCompletedRef.current = false;

    try {
      const amountToPay = Number(effectiveTotal || 0);

      // FREE ticket flow (no payment needed)
      if (!amountToPay || amountToPay <= 0) {
        setPaymentStatus("paid");
        if (couponResult && couponResult.coupon && couponResult.coupon.id) {
          await markCouponAsUsed(couponResult.coupon.id);
        }

        const freeTxId = `free-${Date.now()}`;
        try {
          onTxIdChange && onTxIdChange(freeTxId);
        } catch (_) {}

        try {
          onProofUpload && onProofUpload(freeTxId, true);
        } catch (_) {}

        setCouponCode("");
        setCouponResult(null);
        setCouponError("");
        try {
          sessionStorage.removeItem("couponCode");
          sessionStorage.removeItem("couponResult");
        } catch {}

        setPayLoading(false);
        paymentCompletedRef.current = true;
        return;
      }

      // PAID ticket flow
      const verifiedEmail =
        (typeof window !== "undefined" &&
          (localStorage.getItem("verifiedEmail") ||
            sessionStorage.getItem("verifiedEmail"))) ||
        "";

      const referenceId =
        (verifiedEmail && verifiedEmail.trim()) || `guest-${Date.now()}`;

      const payload = {
        amount: amountToPay,
        currency: "INR",
        description: `Ticket - ${ticketType || "General"}`,
        reference_id: referenceId,
        metadata: {
          ticketType,
          referenceId,
          couponCode:
            couponResult && couponResult.coupon
              ? couponResult.coupon.code
              : couponCode.trim().toUpperCase(),
          buyer_name:
            (typeof window !== "undefined" &&
              localStorage.getItem("visitorName")) ||
            "",
          email: verifiedEmail || "",
        },
      };

      const endpoint = makeUrl("/api/payment/create-order");

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "69420",
        },
        body: JSON.stringify(payload),
        credentials: "include",
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data || !data.success) {
        const errMsg =
          (data &&
            (data.error ||
              data.provider_error ||
              data.details ||
              JSON.stringify(data))) ||
          `Failed to create payment order (${res.status})`;
        setError(errMsg);
        setPayLoading(false);
        return;
      }

      if (!window.Razorpay) {
        setError("Razorpay SDK not loaded. Check index.html script.");
        setPayLoading(false);
        return;
      }

      const options = {
        key: data.key,
        amount: data.amount,
        currency: data.currency,
        order_id: data.orderId,
        name: "RailTrans Expo",
        description: `Ticket - ${ticketType || "General"}`,
        prefill: {
          name:
            (typeof window !== "undefined" &&
              localStorage.getItem("visitorName")) ||
            "",
          email: verifiedEmail || "",
        },
        theme: {
          color: "#1B3A8A",
        },
        method: {
          upi: true,
          card: true,
          netbanking: true,
          wallet: true,
        },
        handler: function(response) {
          console.log("=========== PAYMENT SUCCESS ===========");
          console.log("Razorpay response:", response);
          setCheckoutOpened(true);
          setPaymentStatus("pending");
        },
        modal: {
          ondismiss: function() {
            setPayLoading(false);
          },
        },
      };

      const razor = new window.Razorpay(options);
      console.log("Opening Razorpay");
      razor.open();
      console.log("Razorpay opened");

      // Start polling for payment status
      let attempts = 0;
      console.log("Starting polling...");
      
      pollRef.current = setInterval(async () => {
        console.log("Polling payment status...");
        attempts++;

        try {
          const statusUrl = makeUrl(
            `/api/payment/status?reference_id=${encodeURIComponent(referenceId)}`
          );
          console.log("Calling:", statusUrl);

          const st = await fetch(statusUrl, {
            method: "GET",
            credentials: "include",
            headers: {
              "ngrok-skip-browser-warning": "69420",
            },
          });

          console.log("Status response:", st.status);

          if (!st.ok) return;

          const js = await st.json().catch(() => null);
          console.log("Payment Status:", js);

          if (!js) return;

          const status = (js.status || "").toString().toLowerCase();

          if (["paid", "captured", "completed", "success"].includes(status)) {
            // Payment successful!
            console.log("✅ Payment confirmed!");
            clearInterval(pollRef.current);
            pollRef.current = null;

            if (paymentCompletedRef.current) return;
            paymentCompletedRef.current = true;

            setPaymentStatus("paid");
            
            // Mark coupon as used if applicable
            if (couponResult && couponResult.coupon && couponResult.coupon.id) {
              await markCouponAsUsed(couponResult.coupon.id);
            }
            
            // Clear coupon from UI
            setCouponCode("");
            setCouponResult(null);
            setCouponError("");
            try {
              sessionStorage.removeItem("couponCode");
              sessionStorage.removeItem("couponResult");
            } catch {}

            // Get payment ID
            const rec = js.record || js.data || js.payment || js;
            const providerPaymentId =
              rec?.provider_payment_id || rec?.payment_id || rec?.id || null;
            const finalTx = providerPaymentId || `provider-${Date.now()}`;

            // ✅ CRITICAL: Call onProofUpload with the transaction ID
            try {
              onTxIdChange && onTxIdChange(finalTx);
            } catch (_) {}

            try {
              onProofUpload && onProofUpload(finalTx, false);
            } catch (_) {}

            setPayLoading(false);
            return;
          } else if (["failed", "cancelled", "void"].includes(status)) {
            // Payment failed
            console.log("❌ Payment failed:", status);
            clearInterval(pollRef.current);
            pollRef.current = null;
            setPaymentStatus("failed");
            setError("Payment failed or cancelled. You may retry.");
            setPayLoading(false);
          } else {
            // Still pending
            if (attempts > 40) {
              // Timeout after ~2 minutes
              console.log("⏰ Payment polling timeout");
              clearInterval(pollRef.current);
              pollRef.current = null;
              setPaymentStatus("pending");
              setError(
                "Payment not confirmed yet. If you completed payment, wait a bit and refresh."
              );
              setPayLoading(false);
            }
          }
        } catch (e) {
          console.error("Polling error:", e);
        }
      }, 3000);
    } catch (err) {
      console.error("createOrder error:", err);
      setError(err.message || "Payment initiation failed");
    } finally {
      setPayLoading(false);
    }
  }

  function handleClearCoupon() {
    setCouponCode("");
    setCouponResult(null);
    setCouponError("");
    try {
      sessionStorage.removeItem("couponCode");
      sessionStorage.removeItem("couponResult");
    } catch {}
  }

  return (
    <div className="bg-white rounded-xl shadow-xl p-8 max-w-lg mx-auto mt-8">
      <div className="text-xl font-bold mb-2">
        Payment —{" "}
        {ticketType
          ? `${ticketType.charAt(0).toUpperCase() + ticketType.slice(1)} Ticket`
          : "Ticket"}
      </div>

      <div className="mb-4">
        <div className="text-sm text-gray-600">Base Price</div>
        <div className="text-2xl font-semibold text-[#196e87]">
          ₹{ticketPrice}
        </div>
        <div className="text-xs text-gray-500">
          GST (18%): ₹{gst} — Original Total: ₹{originalTotal}
        </div>
      </div>

      {/* Coupon area */}
      <div className="mb-4 p-3 border rounded bg-gray-50">
        <div className="font-semibold mb-2">Have a coupon?</div>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="block text-xs text-gray-600">Coupon code</label>
            <input
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value)}
              placeholder="Enter coupon code"
              className="w-full border rounded px-2 py-1"
              disabled={couponResult && couponResult.valid}
            />
          </div>
          <div className="flex flex-col gap-2">
            <button
              className="px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50"
              onClick={applyCoupon}
              disabled={couponBusy || (couponResult && couponResult.valid)}
              type="button"
            >
              {couponBusy
                ? "Applying..."
                : couponResult && couponResult.valid
                  ? "Applied"
                  : "Apply"}
            </button>
            {couponResult && couponResult.valid && (
              <button
                className="px-2 py-1 text-xs border border-gray-500 rounded bg-white text-gray-700"
                onClick={handleClearCoupon}
                type="button"
              >
                Clear coupon
              </button>
            )}
          </div>
        </div>
        {couponError && (
          <div className="mt-2 text-red-600 text-sm">{couponError}</div>
        )}
        {couponResult && (
          <div className="mt-3 text-sm text-gray-700 p-2 bg-white border rounded">
            {couponResult.valid ? (
              <>
                <div className="font-medium text-green-700">
                  ✅ Coupon applied: {couponResult.coupon?.code || couponCode}
                </div>
                <div>Discount: {couponResult.discount}%</div>
                <div>
                  Reduced total:{" "}
                  <span className="font-semibold">
                    ₹{Number(couponResult.reducedPrice).toFixed(2)}
                  </span>
                </div>
                <div className="mt-2 text-xs text-gray-600">
                  Coupon will be consumed only after your ticket/registration is
                  confirmed.
                </div>
              </>
            ) : (
              <>
                <div className="font-medium text-red-600">
                  ❌ Coupon invalid
                </div>
                {couponResult.error && (
                  <div className="text-xs text-gray-600 mt-1">
                    {couponResult.error}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="mb-6">
        <div className="font-semibold mb-2">Pay Online</div>
        <div className="text-sm text-gray-700 mb-3">
          Secure checkout via your payment provider.
        </div>
        <div className="mb-3">
          <div className="text-sm text-gray-600">Amount to pay</div>
          <div className="text-2xl font-semibold text-[#196e87]">
            ₹{Number(effectiveTotal).toFixed(2)}
          </div>
          {effectiveTotal !== originalTotal && (
            <div className="text-xs text-gray-500">
              Original: ₹{originalTotal} — You saved ₹
              {(originalTotal - effectiveTotal).toFixed(2)}
            </div>
          )}
        </div>
        <div className="flex gap-3">
          <button
            className="px-4 py-2 bg-green-600 text-white rounded disabled:opacity-60"
            onClick={createOrder}
            disabled={payLoading || checkoutOpened || couponBusy}
          >
            {payLoading
              ? "Opening checkout..."
              : checkoutOpened
                ? "Checkout opened"
                : "Pay Online"}
          </button>
        </div>
        {paymentStatus === "pending" && (
          <div className="mt-2 text-sm text-yellow-600">
            Waiting for provider confirmation...
          </div>
        )}
        {paymentStatus === "paid" && (
          <div className="mt-2 text-sm text-green-600">
            ✅ Payment confirmed.
          </div>
        )}
      </div>
      <hr className="my-4" />
      {error && (
        <div className="mt-4 text-red-600 font-medium whitespace-pre-wrap">
          {error}
        </div>
      )}
      <div className="mt-4 text-xs text-gray-500">
        If you pay online, the checkout will open in a new tab. After successful
        payment your registration will continue and your coupon will be
        consumed.
      </div>
    </div>
  );
}
