import React, { useEffect, useRef, useState } from "react";

const DEFAULT_API_BASE = (typeof window !== "undefined" && (window.__API_BASE__ || "")) || "";

function isEmailLike(v) {
  return typeof v === "string" && /\S+@\S+\.\S+/.test(v);
}

function makeRequestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * EmailOtpField
 * - props:
 *   - email: current email value
 *   - onEmailChange(email): called when email changes (keeps parent form in sync)
 *   - onVerified(email): called when verification succeeds
 *   - apiBase: optional override of API base
 *   - disabled: boolean
 */
export default function EmailOtpField({ email = "", onEmailChange = () => {}, onVerified = () => {}, apiBase = DEFAULT_API_BASE, disabled = false }) {
  const BASE = (apiBase || DEFAULT_API_BASE).replace(/\/$/, "");
  const sendUrl = BASE ? `${BASE}/api/otp/send` : "/api/otp/send";
  const verifyUrl = BASE ? `${BASE}/api/otp/verify` : "/api/otp/verify";

  const [value, setValue] = useState((email || "").trim());
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [verified, setVerified] = useState(false);
  const [msg, setMsg] = useState("");
  const sendingRef = useRef(false);
  const verifyingRef = useRef(false);

  useEffect(() => {
    setValue((email || "").trim());
    // if email changes, reset OTP UI but keep verified if localStorage marks it
    const stored = (() => {
      try { return localStorage.getItem("verifiedEmail"); } catch { return null; }
    })();
    if (stored && stored === (email || "").trim().toLowerCase()) {
      setVerified(true);
      setMsg("Verified (cached)");
    } else {
      setVerified(false);
    }
    setOtpSent(false);
    setOtpCode("");
  }, [email]);

  useEffect(() => {
    onEmailChange(value);
  }, [value, onEmailChange]);

  async function handleSend() {
    if (sendingRef.current) return;
    setMsg("");
    if (!isEmailLike(value)) { setMsg("Enter valid email"); return; }
    sendingRef.current = true;
    setLoading(true);
    try {
      const requestId = makeRequestId();
      const res = await fetch(sendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" ,"ngrok-skip-browser-warning": "69420" },
        body: JSON.stringify({ type: "email", value: value.trim(), requestId }),
      });
      const js = await res.json().catch(() => ({}));
      if (!res.ok || !js.success) {
        setMsg((js && (js.error || js.message)) || "Failed to send OTP");
        setOtpSent(false);
      } else {
        setOtpSent(true);
        setMsg(`OTP sent to ${value.trim()}.`);
      }
    } catch (e) {
      console.error("sendOtp error", e);
      setMsg("Network error sending OTP");
      setOtpSent(false);
    } finally {
      setLoading(false);
      sendingRef.current = false;
    }
  }

  async function handleVerify() {
    if (verifyingRef.current) return;
    setMsg("");
    if (!otpSent) { setMsg("Send OTP first"); return; }
    if (!otpCode || otpCode.trim().length === 0) { setMsg("Enter OTP"); return; }
    verifyingRef.current = true;
    setLoading(true);
    try {
      const res = await fetch(verifyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" ,"ngrok-skip-browser-warning": "69420" },
        body: JSON.stringify({ value: value.trim(), otp: String(otpCode).trim() }),
      });
      const js = await res.json().catch(() => ({}));
      if (!res.ok || !js.success) {
        setMsg((js && (js.error || js.message)) || "OTP verification failed");
        setVerified(false);
      } else {
        setVerified(true);
        setMsg("Email verified");
        try { localStorage.setItem("verifiedEmail", value.trim().toLowerCase()); sessionStorage.setItem("verifiedEmail", value.trim().toLowerCase()); } catch {}
        onVerified(value.trim());
      }
    } catch (e) {
      console.error("verifyOtp error", e);
      setMsg("Network error");
      setVerified(false);
    } finally {
      setLoading(false);
      verifyingRef.current = false;
    }
  }

  function handleChange(e) {
    const v = (e.target.value || "").trim();
    setValue(v);
    // If email changed, clear previous verification state
    setVerified(false);
    setOtpSent(false);
    setOtpCode("");
    setMsg("");
    try { localStorage.removeItem("verifiedEmail"); } catch {}
  }

  if (verified) {
    return (
      <div className="ml-3 flex items-center gap-2">
        <span className="px-2 py-1 text-xs bg-green-600 text-white rounded">Verified ✓</span>
        <button type="button" className="text-xs underline text-gray-600" onClick={() => { setVerified(false); setOtpSent(false); setOtpCode(""); setMsg(""); try { localStorage.removeItem("verifiedEmail"); } catch{}; }}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="ml-3 flex items-center gap-2">
      {!otpSent ? (
        <button
          type="button"
          onClick={handleSend}
          disabled={loading || disabled || !isEmailLike(value)}
          className={`px-3 py-1 text-xs rounded ${loading ? "opacity-60" : "bg-[#196e87] text-white"}`}
          title={!isEmailLike(value) ? "Enter valid email" : "Send OTP"}
        >
          {loading ? "Sending..." : "Send OTP"}
        </button>
      ) : (
        <>
          <input
            type="text"
            value={otpCode}
            onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0,6))}
            placeholder="OTP"
            className="border px-2 py-1 rounded text-xs w-20"
            maxLength={6}
          />
          <button
            type="button"
            onClick={handleVerify}
            disabled={loading || otpCode.length !== 6}
            className="px-3 py-1 text-xs rounded bg-[#21809b] text-white"
          >
            {loading ? "Verifying..." : "Verify"}
          </button>
        </>
      )}
      {msg && <div className="text-sm text-gray-600 ml-2">{msg}</div>}
    </div>
  );
}