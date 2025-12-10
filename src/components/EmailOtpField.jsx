import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

/* Small helpers */
function isEmail(str) {
  return typeof str === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((str || "").trim());
}
function makeRequestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function normalizeToRole(t) {
  if (!t) return "visitor";
  const s = String(t).trim().toLowerCase();
  const singular = s.endsWith("s") ? s.slice(0, -1) : s;
  const map = { visitor: "visitor", exhibitor: "exhibitor", speaker: "speaker", partner: "partner", awardee: "awardee" };
  return map[singular] || "visitor";
}

/* EmailOtpVerifier
   - Ensures verified email is persisted to localStorage/sessionStorage when verification succeeds.
   - Normalizes registrationType -> canonical role before calling APIs.
   - Debounces check-email calls and hides raw server debug output by default.
*/
export default function EmailOtpVerifier({
  email = "",
  fieldName,
  setForm,
  verified,
  setVerified,
  apiBase = "",
  autoSend = false,
  registrationType = "visitor",
}) {
  const navigate = useNavigate();
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [existing, setExisting] = useState(null);

  const sendingRef = useRef(false);
  const verifyingRef = useRef(false);
  const checkTimerRef = useRef(null);

  const emailNorm = (email || "").trim();
  const emailValid = isEmail(emailNorm);
  const role = normalizeToRole(registrationType);

  useEffect(() => {
    // Auto-check email in DB (debounced)
    if (!emailValid) {
      setExisting(null);
      setMsg("");
      return;
    }
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    checkTimerRef.current = setTimeout(async () => {
      try {
        const url = `${apiBase}/api/otp/check-email?email=${encodeURIComponent(emailNorm)}&type=${encodeURIComponent(role)}`;
        const res = await fetch(url, { headers: { "ngrok-skip-browser-warning": "true", Accept: "application/json" } });
        const ct = res.headers.get("content-type") || "";
        let data;
        if (ct.includes("application/json")) data = await res.json().catch(() => null);
        else {
          setMsg("Unexpected server response");
          return;
        }
        if (data && data.success && data.found) {
          setExisting({ ...(data.info || {}), registrationType: role });
          setMsg("Email already exists. Use Upgrade Ticket.");
          setOtpSent(false);
          return;
        }
        setExisting(null);
        setMsg("");
      } catch (err) {
        console.error("[check-email] error", err);
        setMsg("Failed to check email");
        setExisting(null);
      }
    }, 350);
    return () => { if (checkTimerRef.current) clearTimeout(checkTimerRef.current); };
  }, [emailNorm, apiBase, role, emailValid]);

  useEffect(() => {
    // reset OTP UI when email changes
    setOtp("");
    setOtpSent(false);
    setMsg("");
    setError("");
    // Do not touch verified flag here; parent will manage it via localStorage or setVerified callback.
    // (This avoids race where setForm triggers parent to clear verification before we persist it.)
  }, [emailNorm]);

  async function handleSendOtp() {
    if (sendingRef.current) return;
    if (!emailValid) { setError("Enter a valid email"); return; }
    if (existing) { setMsg("Email already exists. Use Upgrade"); return; }

    sendingRef.current = true;
    setLoading(true);
    setMsg(""); setError(""); setExisting(null);
    const requestId = makeRequestId();

    try {
      const res = await fetch(`${apiBase}/api/otp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
        body: JSON.stringify({ type: "email", value: emailNorm, requestId, registrationType: role }),
      });
      const data = await res.json().catch(() => null);

      if (res.status === 409 && data && data.existing) {
        setExisting({ ...(data.existing || {}), registrationType: role });
        setMsg("Email already exists. Use Upgrade Ticket.");
        setOtpSent(false);
        return;
      }
      if (res.ok && data && data.success) {
        setOtpSent(true);
        setMsg("OTP sent");
        return;
      }
      setError((data && (data.error || data.message)) || `Send failed (${res.status})`);
    } catch (err) {
      console.error("[send-otp] error", err);
      setError("Network error");
    } finally {
      sendingRef.current = false;
      setLoading(false);
    }
  }

  async function handleVerifyOtp() {
    if (verifyingRef.current) return;
    if (!emailValid) { setError("Invalid email"); return; }

    verifyingRef.current = true;
    setLoading(true);
    setMsg(""); setError(""); setExisting(null);

    try {
      const res = await fetch(`${apiBase}/api/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
        body: JSON.stringify({ value: emailNorm, otp: String(otp).trim(), registrationType: role }),
      });
      const data = await res.json().catch(() => null);

      if (!data || !data.success) {
        setError((data && (data.error || data.message)) || "Verify failed");
        return;
      }

      // Persist verified email so parent can detect it reliably when the form is updated
      try {
        const verifiedAddr = (data.email || emailNorm).trim().toLowerCase();
        localStorage.setItem("verifiedEmail", verifiedAddr);
        sessionStorage.setItem("verifiedEmail", verifiedAddr);
      } catch (e) { /* ignore storage errors */ }

      // Mark verified in parent state and update the form value (normalized)
      setVerified && setVerified(true);
      setMsg("Email verified");

      if (setForm && fieldName) {
        try {
          const verifiedAddr = emailNorm.toLowerCase();
          setForm(prev => ({ ...prev, [fieldName]: verifiedAddr, otpVerified: true }));
        } catch (e) { /* ignore */ }
      }
    } catch (err) {
      console.error("[verify] error", err);
      setError("Network/server error");
    } finally {
      verifyingRef.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="ml-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {!otpSent ? (
          <button
            type="button"
            onClick={handleSendOtp}
            disabled={!emailValid || loading || !!existing}
            className={`ml-2 px-3 py-1 rounded bg-[#21809b] text-white text-xs ${loading ? "opacity-60 cursor-not-allowed" : ""}`}
            title={!emailValid ? "Enter a valid email" : "Send OTP"}
          >
            {loading ? "Sending..." : "Send OTP"}
          </button>
        ) : (
          <>
            <input
              type="text"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="Enter OTP"
              className="border px-2 py-1 rounded text-xs"
              maxLength={6}
              disabled={loading}
            />
            <button
              type="button"
              onClick={handleVerifyOtp}
              disabled={loading || otp.length !== 6}
              className="px-3 py-1 rounded bg-[#21809b] text-white text-xs"
            >
              Verify
            </button>
          </>
        )}
      </div>

      {msg && <div className="text-xs text-green-600 mt-1">{msg}</div>}
      {error && <div className="text-xs text-red-600 mt-1">{error}</div>}

      {existing && (
        <div className="ml-0 mt-2 p-2 bg-yellow-50 border border-yellow-100 rounded text-xs">
          <div className="mb-1 font-medium text-[#b45309]">Email already exists</div>
          <div className="text-xs text-gray-700 mb-2">
            This email is already registered as {existing.registrationType}. Use Upgrade Ticket to update it.
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => navigate(`/ticket-upgrade?type=${encodeURIComponent(existing.registrationType)}&id=${encodeURIComponent(String(existing.id || ""))}`)}
              className="px-2 py-1 bg-white border rounded text-[#21809b] text-xs"
            >
              Upgrade Ticket
            </button>
          </div>
        </div>
      )}
    </div>
  );
}