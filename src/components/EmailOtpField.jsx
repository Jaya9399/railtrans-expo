import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

/*
  EmailOtpVerifier (frontend)
  - Resolves backend base automatically from prop -> window.__API_BASE__ -> REACT_APP_API_BASE -> relative.
  - Calls /api/otp/check-email, /api/otp/send and /api/otp/verify on that backend.
  - Shows which collection/role was matched (info.collection / info.id) when email already exists.
  - "Upgrade Ticket" button now navigates using plural `entity=` (e.g. entity=visitors&id=...) OR uses ticket_code fallback.
  - Persists verifiedEmail to storage and notifies parent via setVerified and setForm.
  - If registrationType prop is missing, infers role from URL query param `entity` or `type`; logs a warning so you can pass explicit prop.
*/

function isEmail(str) {
  return typeof str === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((str || "").trim());
}
function makeRequestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function normalizeToRole(t) {
  if (!t) return null;
  const s = String(t).trim().toLowerCase();
  const singular = s.endsWith("s") ? s.slice(0, -1) : s;
  const map = { visitor: "visitor", exhibitor: "exhibitor", speaker: "speaker", partner: "partner", awardee: "awardee" };
  return map[singular] || "visitor";
}
function ensurePluralRole(role) {
  if (!role) return "visitors";
  return role.endsWith("s") ? role : `${role}s`;
}

export default function EmailOtpVerifier({
  email = "",
  fieldName,
  setForm,
  verified,
  setVerified,
  apiBase = "",
  autoSend = false,
  registrationType = undefined,
  onOtpSuccess,
}) {
  const navigate = useNavigate();
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [existing, setExisting] = useState(null);
  const [checkingEmail, setCheckingEmail] = useState(false);

  const sendingRef = useRef(false);
  const verifyingRef = useRef(false);
  const checkTimerRef = useRef(null);

  const emailNorm = (email || "").trim();
  const emailValid = isEmail(emailNorm);

  // Resolve role: prefer explicit prop, else infer from URL query (entity|type), else fall back to visitor
  let inferredFromUrl = false;
  let initialRole = registrationType;
  if (!initialRole) {
    try {
      if (typeof window !== "undefined") {
        const qs = new URLSearchParams(window.location.search || "");
        const urlRole = qs.get("entity") || qs.get("type") || qs.get("registrationType") || "";
        if (urlRole) {
          initialRole = urlRole;
          inferredFromUrl = true;
        }
      }
    } catch (e) {
      /* ignore */
    }
  }
  const role = normalizeToRole(initialRole);
  if (!role) {
    console.error("registrationType is required for OTP flow, defaulting to 'visitor'");
    role = "visitor"; // Fallback
  }

  useEffect(() => {
    if (inferredFromUrl) {
      console.warn(`[EmailOtpVerifier] registrationType prop not provided — inferred role="${role}" from URL. Prefer passing registrationType prop to this component for accuracy.`);
    }
  }, []);

  // Resolve backend base (prop -> window -> env -> "")
  const resolvedApiBase = (apiBase && String(apiBase).trim())
    || (typeof window !== "undefined" && (window.__API_BASE__ || window.__API_HOST__ || ""))
    || (typeof process !== "undefined" && process.env && (process.env.REACT_APP_API_BASE || process.env.API_BASE) || "")
    || "";

  function buildUrl(path) {
    if (!resolvedApiBase) return path.startsWith("/") ? path : `/${path}`;
    return `${String(resolvedApiBase).replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  }

  useEffect(() => {
    // Debounced check-email with timeout and better error handling
    if (!emailValid) {
      setExisting(null);
      setMsg("");
      setError("");
      return;
    }
    
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    checkTimerRef.current = setTimeout(async () => {
      setCheckingEmail(true);
      try {
        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout
        
        const url = buildUrl(`/api/otp/check-email?email=${encodeURIComponent(emailNorm)}&type=${encodeURIComponent(role)}`);
        console.log(`[EmailOtpVerifier] Checking email: ${emailNorm}`);
        
        const res = await fetch(url, { 
          signal: controller.signal,
          headers: { 
            "ngrok-skip-browser-warning": "true", 
            Accept: "application/json" 
          } 
        });
        
        clearTimeout(timeoutId);
        
        let data = null;
        try { 
          data = await res.json(); 
        } catch (parseErr) {
          console.error("[EmailOtpVerifier] Failed to parse response:", parseErr);
          data = null;
        }
        
        // Handle successful response
        if (res.ok && data && data.success) {
          if (data.found) {
            setExisting(data.info || null);
            setMsg("Email already registered. You can upgrade the ticket.");
            setOtpSent(false);
            setError("");
          } else {
            setExisting(null);
            setMsg("");
            setError("");
          }
        } else {
          // Backend returned error but we don't want to block registration
          console.warn("[EmailOtpVerifier] check-email response not OK:", res.status, data);
          setExisting(null);
          setMsg("");
          setError("");
        }
      } catch (err) {
        // Handle timeout or network errors gracefully - don't block registration
        if (err.name === 'AbortError') {
          console.warn("[EmailOtpVerifier] check-email timeout after 8s");
        } else {
          console.error("[EmailOtpVerifier] check-email error:", err);
        }
        // Don't show error to user - just allow registration to proceed
        setExisting(null);
        setMsg("");
        setError("");
      } finally {
        setCheckingEmail(false);
      }
    }, 500); // Increased debounce to 500ms
    
    return () => { 
      if (checkTimerRef.current) clearTimeout(checkTimerRef.current); 
    };
  }, [emailNorm, resolvedApiBase, role, emailValid]);

  useEffect(() => {
    // reset OTP UI when email changes
    setOtp("");
    setOtpSent(false);
    setMsg("");
    setError("");
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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout for OTP send
      
      const url = buildUrl("/api/otp/send");
      const res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
        body: JSON.stringify({ type: role, value: emailNorm, requestId, registrationType: role }),
      });
      
      clearTimeout(timeoutId);
      
      let data = null;
      try { data = await res.json(); } catch { data = null; }

      if (res.status === 409 && data && data.existing) {
        setExisting({ ...(data.existing || {}), registrationType: role });
        setMsg("Email already exists. Use Upgrade Ticket.");
        setOtpSent(false);
        return;
      }
      
      if (res.ok && data && data.success) {
        setOtpSent(true);
        setMsg("OTP sent to your email. Please check your inbox (and spam folder).");
        setError("");
        return;
      }
      
      setError((data && (data.error || data.message)) || `Failed to send OTP (${res.status}). Please try again.`);
    } catch (err) {
      console.error("[EmailOtpVerifier] send-otp error:", err);
      if (err.name === 'AbortError') {
        setError("Request timed out. Please check your internet connection and try again.");
      } else {
        setError("Network error while sending OTP. Please try again.");
      }
    } finally {
      sendingRef.current = false;
      setLoading(false);
    }
  }

  async function handleVerifyOtp() {
    if (verifyingRef.current) return;
    if (!emailValid) { setError("Invalid email"); return; }
    if (!otp || otp.length !== 6) { setError("Please enter a valid 6-digit OTP"); return; }

    verifyingRef.current = true;
    setLoading(true);
    setMsg(""); setError(""); setExisting(null);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const url = buildUrl("/api/otp/verify");
      const res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
        body: JSON.stringify({
          type: role,
          value: emailNorm,
          otp: String(otp).trim(),
          registrationType: role
        })
      });
      
      clearTimeout(timeoutId);
      
      let data = null;
      try { data = await res.json(); } catch { data = null; }

      if (!data || !data.success) {
        setError((data && (data.error || data.message)) || "Invalid OTP. Please try again.");
        return;
      }

      // Persist verified email so parent and other pages can reuse it (UX only)
      try {
        const verifiedAddr = (data.email || emailNorm).trim().toLowerCase();
        localStorage.setItem("verifiedEmail", verifiedAddr);
        sessionStorage.setItem("verifiedEmail", verifiedAddr);
      } catch (e) { /* ignore */ }

      setVerified && setVerified(true);
      setMsg("Email verified successfully!");

      if (setForm && fieldName) {
        try {
          const verifiedAddr = emailNorm.toLowerCase();
          setForm(prev => ({ ...prev, [fieldName]: verifiedAddr, otpVerified: true }));
        } catch (e) { /* ignore */ }
      }

      // Pass the verificationToken to parent (MANDATORY for backend)
      if (typeof onOtpSuccess === "function" && data.verificationToken) {
        onOtpSuccess({ email: emailNorm, token: data.verificationToken });
      }
    } catch (err) {
      console.error("[EmailOtpVerifier] verify error", err);
      if (err.name === 'AbortError') {
        setError("Verification timeout. Please try again.");
      } else {
        setError("Network/server error while verifying OTP. Please try again.");
      }
    } finally {
      verifyingRef.current = false;
      setLoading(false);
    }
  }

  function handleUpgradeNavigate() {
    if (!existing) return;

    const collection = existing.collection || ensurePluralRole(existing.registrationType || role);
    const id = existing.id || existing._id || existing._id_str || (existing._id && existing._id.$oid) || null;
    const ticket = existing.ticket_code || existing.ticketCode || null;
    const emailParam = encodeURIComponent(emailNorm);

    if (id) {
      navigate(`/ticket-upgrade?entity=${encodeURIComponent(collection)}&id=${encodeURIComponent(String(id))}&email=${emailParam}`);
      return;
    }

    if (ticket) {
      navigate(`/ticket-upgrade?entity=${encodeURIComponent(collection)}&ticket_code=${encodeURIComponent(String(ticket))}&email=${emailParam}`);
      return;
    }

    navigate(`/ticket-upgrade?entity=visitors&email=${emailParam}`);
  }

  return (
    <div className="ml-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        {!otpSent ? (
          <button
            type="button"
            onClick={handleSendOtp}
            disabled={!emailValid || loading || !!existing || checkingEmail}
            className={`ml-2 px-3 py-1 rounded bg-[#21809b] text-white text-xs transition-colors ${
              loading || checkingEmail ? "opacity-60 cursor-not-allowed" : "hover:bg-[#1a5f73]"
            }`}
            title={!emailValid ? "Enter a valid email" : checkingEmail ? "Checking email..." : "Send OTP"}
          >
            {loading ? "Sending..." : checkingEmail ? "Checking..." : "Send OTP"}
          </button>
        ) : (
          <>
            <input
              type="text"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="Enter 6-digit OTP"
              className="border px-2 py-1 rounded text-xs w-32"
              maxLength={6}
              disabled={loading}
              autoFocus
            />
            <button
              type="button"
              onClick={handleVerifyOtp}
              disabled={loading || otp.length !== 6}
              className={`px-3 py-1 rounded bg-[#21809b] text-white text-xs transition-colors ${
                loading || otp.length !== 6 ? "opacity-60 cursor-not-allowed" : "hover:bg-[#1a5f73]"
              }`}
            >
              {loading ? "Verifying..." : "Verify"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOtpSent(false);
                setOtp("");
                setError("");
              }}
              className="px-2 py-1 rounded bg-gray-200 text-gray-700 text-xs hover:bg-gray-300"
            >
              Back
            </button>
          </>
        )}
      </div>

      {msg && <div className="text-xs text-green-600 mt-1">{msg}</div>}
      {error && <div className="text-xs text-red-600 mt-1">{error}</div>}

      {existing && (
        <div className="ml-0 mt-2 p-2 bg-yellow-50 border border-yellow-100 rounded text-xs">
          <div className="mb-1 font-medium text-[#b45309]">Email already registered</div>
          <div className="text-xs text-gray-700 mb-2">
            Found in: <strong>{existing.collection || (existing.registrationType ? ensurePluralRole(existing.registrationType) : "visitors")}</strong>
            {existing.id ? <> — ID: <code className="bg-gray-100 px-1 rounded">{existing.id}</code></> : null}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleUpgradeNavigate}
              className="px-2 py-1 bg-white border rounded text-[#21809b] text-xs hover:bg-gray-50"
            >
              Upgrade Ticket →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}