import React, { useEffect, useRef, useState } from "react";

/*
  DynamicRegistrationForm.jsx

  - Removed the "cards" preview UI that displayed backend fields.
  - Keeps inline OTP control next to any email-like field that has meta.useOtp.
  - If no config prop is provided, it still fetches /api/visitor-config and renders fields.
*/

function isVisible(field, form) {
  if (!field) return false;
  if (field.visible === false) return false;
  if (!field.visibleIf) return true;
  return Object.entries(field.visibleIf).every(([k, v]) => form[k] === v);
}
function isEmail(str) {
  return typeof str === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((str || "").trim());
}
function makeRequestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/* Inline Email OTP verifier */
function EmailOtpVerifier({ email = "", fieldName, setForm, verified, setVerified, apiBase = "" }) {
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const sendingRef = useRef(false);
  const verifyingRef = useRef(false);

  const emailNorm = (email || "").trim().toLowerCase();
  const isEmailValid = isEmail(emailNorm);

  useEffect(() => {
    setOtp("");
    setOtpSent(false);
    setMsg("");
    setError("");
    setVerified && setVerified(false);
  }, [emailNorm, setVerified]);

  async function handleSendOtp() {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setLoading(true);
    setMsg("");
    setError("");
    try {
      const requestId = makeRequestId();
      const res = await fetch(`${apiBase || ""}/api/otp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" , "ngrok-skip-browser-warning": "69420" },
        body: JSON.stringify({ type: "email", value: emailNorm, requestId }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data && data.success) {
        setOtpSent(true);
        setMsg("OTP sent to your email.");
        try { localStorage.setItem("otpEmail", emailNorm); } catch {}
      } else {
        setError((data && (data.error || data.message)) || "Failed to send OTP");
      }
    } catch (e) {
      console.error("handleSendOtp error", e);
      setError("Network error sending OTP");
    } finally {
      setLoading(false);
      sendingRef.current = false;
    }
  }

  async function handleVerifyOtp() {
    if (verifyingRef.current) return;
    verifyingRef.current = true;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBase || ""}/api/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" , "ngrok-skip-browser-warning": "69420" },
        body: JSON.stringify({ value: emailNorm, otp: String(otp).trim() }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data && data.success) {
        setVerified && setVerified(true);
        setMsg("Email verified!");
        try {
          const verifiedAddr = (data.email || emailNorm).trim().toLowerCase();
          localStorage.setItem("verifiedEmail", verifiedAddr);
          sessionStorage.setItem("verifiedEmail", verifiedAddr);
          if (typeof setForm === "function" && fieldName) {
            setForm((prev) => ({ ...prev, [fieldName]: verifiedAddr, otpVerified: true }));
          }
        } catch {}
      } else {
        setError((data && data.error) || "Incorrect OTP");
      }
    } catch (e) {
      console.error("handleVerifyOtp error", e);
      setError("Network/server error.");
    } finally {
      setLoading(false);
      verifyingRef.current = false;
    }
  }

  if (verified) {
    return (
      <div className="ml-3 flex items-center gap-2">
        <span className="px-2 py-1 text-xs bg-green-600 text-white rounded">Verified ✓</span>
      </div>
    );
  }

  return (
    <div className="ml-3 flex items-center gap-2">
      {!otpSent ? (
        <button
          type="button"
          className={`ml-2 px-3 py-1 rounded bg-[#21809b] text-white text-xs font-medium ${loading ? "opacity-60 cursor-not-allowed" : ""}`}
          onClick={handleSendOtp}
          disabled={!isEmailValid || loading}
          title={!isEmailValid ? "Enter a valid email first" : "Send OTP"}
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
            className="px-3 py-1 rounded bg-[#21809b] text-white text-xs font-medium"
            onClick={handleVerifyOtp}
            disabled={loading || !otp || otp.length !== 6}
          >
            Verify
          </button>
        </>
      )}
      {msg && <span className="ml-2 text-green-600 text-xs">{msg}</span>}
      {error && <span className="ml-2 text-red-600 text-xs">{error}</span>}
    </div>
  );
}

/* Main DynamicRegistrationForm */
export default function DynamicRegistrationForm({
  config,
  form,
  setForm,
  onSubmit,
  editable = true,
  terms = null,
  apiBase = "",
}) {
  const [emailVerified, setEmailVerified] = useState(false);
  const [localConfig, setLocalConfig] = useState(config || null);
  const [loadingConfig, setLoadingConfig] = useState(!config);

  useEffect(() => {
    if (config) {
      setLocalConfig(config);
      setLoadingConfig(false);
    }
  }, [config]);

  useEffect(() => {
    let mounted = true;
    async function fetchCfg() {
      if (config) return;
      setLoadingConfig(true);
      try {
        const res = await fetch(`${apiBase || ""}/api/visitor-config`);
        if (!res.ok) {
          console.warn("Failed to fetch /api/visitor-config", res.status);
          setLocalConfig({ fields: [] });
          return;
        }
        const js = await res.json().catch(() => ({}));
        if (!mounted) return;
        js.fields = Array.isArray(js.fields) ? js.fields : [];
        setLocalConfig(js);
      } catch (e) {
        console.error("fetch visitor-config error", e);
        setLocalConfig({ fields: [] });
      } finally {
        if (mounted) setLoadingConfig(false);
      }
    }
    fetchCfg();
    return () => (mounted = false);
  }, [config, apiBase]);

  useEffect(() => {
    console.debug("DynamicRegistrationForm config:", localConfig);
    console.debug("DynamicRegistrationForm form:", form);
  }, [localConfig, form]);

  function handleChange(e) {
    const { name, value, type, checked } = e.target;
    if (type === "email") {
      const v = (value || "").trim();
      setForm((f) => ({ ...f, [name]: v }));
      return;
    }
    setForm((f) => ({ ...f, [name]: type === "checkbox" ? checked : value }));
  }

  function handleTermsChange(e) {
    const checked = !!e.target.checked;
    setForm((f) => ({ ...f, termsAccepted: checked }));
  }

  const effectiveConfig = localConfig || { fields: [] };
  const safeFields = (effectiveConfig.fields || []).filter((f) => f && f.name && f.label && isVisible(f, form));
  const emailField = safeFields.find((f) => f.type === "email");
  const emailValue = emailField ? form[emailField.name] || "" : "";
  const termsRequired = terms && terms.required;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (termsRequired && !form?.termsAccepted) {
          alert("Please accept the Terms & Conditions before continuing.");
          return;
        }
        if (emailField?.required && emailField.meta?.useOtp && !emailVerified) {
          alert("Please verify your email to continue.");
          return;
        }
        onSubmit && onSubmit(form);
      }}
      className="mx-auto w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-[#bde0fe] p-8"
    >
      <div className="flex flex-col gap-7">
        {safeFields.length === 0 && (
          <div className="text-red-500 text-center">No fields configured for this form.</div>
        )}

        {safeFields.map((field) => (
          <div key={field.name}>
            {field.type === "checkbox" ? (
              <div className="flex items-center gap-2 mt-2">
                <input type="checkbox" name={field.name} checked={!!form[field.name]} onChange={handleChange} disabled={!editable} required={field.required} />
                <span className="text-lg text-gray-600">{field.label}</span>
              </div>
            ) : (
              <>
                <label className="font-semibold text-[#21809b] text-lg">{field.label}</label>

                {(field.type === "text" || field.type === "email" || field.type === "number") && (
                  <div className="flex items-center">
                    <input type={field.type} name={field.name} value={form[field.name] || ""} onChange={handleChange} className="w-full mt-2 p-4 rounded-lg bg-[#eaf6fb] border border-[#bde0fe] text-lg" disabled={!editable} required={field.required} />
                    {field.type === "email" && field.meta?.useOtp && (
                      <EmailOtpVerifier email={form[field.name]} fieldName={field.name} setForm={setForm} verified={emailVerified} setVerified={setEmailVerified} apiBase={apiBase} />
                    )}
                  </div>
                )}

                {field.type === "textarea" && (
                  <textarea name={field.name} value={form[field.name] || ""} onChange={handleChange} className="w-full mt-2 p-4 rounded-lg bg-[#eaf6fb] border border-[#bde0fe] text-lg" rows={3} disabled={!editable} required={field.required} />
                )}

                {field.type === "select" && (
                  <select name={field.name} value={form[field.name] || ""} onChange={handleChange} className="w-full mt-2 p-4 rounded-lg bg-[#eaf6fb] border border-[#bde0fe] text-lg" disabled={!editable} required={field.required}>
                    <option value="">Select {field.label}</option>
                    {(field.options || []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                )}

                {field.type === "radio" && (
                  <div className="flex flex-col gap-3 mt-2">
                    {(field.options || []).map((opt) => (
                      <label key={opt} className={`flex items-center gap-3 px-4 py-2 border rounded-lg cursor-pointer bg-white shadow-sm whitespace-nowrap text-sm ${form[field.name] === opt ? "border-[#21809b] bg-[#e8f6ff]" : "border-gray-300"}`}>
                        <input type="radio" name={field.name} value={opt} checked={form[field.name] === opt} onChange={handleChange} disabled={!editable} required={field.required} className="h-4 w-4 text-[#21809b]" />
                        <span className="font-medium text-gray-700">{opt}</span>
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ))}

        {terms && (
          <div className="mt-2">
            <label className="flex items-start gap-3">
              <input type="checkbox" name="termsAccepted" checked={!!form.termsAccepted} onChange={handleTermsChange} className="mt-1" />
              <div>
                <span className="text-gray-700">{terms.label || "I accept the Terms & Conditions"} {terms.url && <a href={terms.url} target="_blank" rel="noopener noreferrer" className="text-[#21809b] underline">(View)</a>}</span>
                {terms.required && <div className="text-xs text-red-600 mt-1">You must accept the terms to continue.</div>}
              </div>
            </label>
          </div>
        )}

        <div className="flex justify-end items-center mt-8">
          <button type="submit" className="px-8 py-3 rounded-xl bg-[#21809b] text-white font-semibold text-lg disabled:opacity-60" disabled={!editable || safeFields.length === 0 || (emailField?.required && emailField.meta?.useOtp && !emailVerified) || (emailField && emailField.required && !isEmail(emailValue)) || (termsRequired && !form?.termsAccepted)}>
            Submit
          </button>
        </div>
      </div>
    </form>
  );
}