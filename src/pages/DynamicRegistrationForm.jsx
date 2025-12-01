import React, { useEffect, useRef, useState } from "react";

// Helper for conditional visibility
function isVisible(field, form) {
  if (!field.visibleIf) return true;
  return Object.entries(field.visibleIf).every(([k, v]) => form[k] === v);
}

// Very simple email validator
function isEmail(str) {
  return typeof str === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str.trim());
}

// Small helper for a simple request id
function makeRequestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/* Email OTP verifier kept minimal and defensive.
   If your app already has an OTP flow you can adapt this to call the same endpoints.
*/
function EmailOtpVerifier({ email, fieldName, setForm, verified, setVerified }) {
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
    setVerified(false);
  }, [emailNorm, setVerified]);

  async function handleSendOtp() {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setLoading(true);
    setMsg("");
    setError("");
    try {
      const requestId = makeRequestId();
      const res = await fetch(`/api/otp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "email", value: emailNorm, requestId }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data && data.success) {
        setOtpSent(true);
        setMsg("OTP sent to your email.");
        try { localStorage.setItem("otpEmail", emailNorm); } catch {}
      } else {
        setError((data && data.error) || "Failed to send OTP");
      }
    } catch (e) {
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
      const res = await fetch("/api/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: emailNorm, otp: String(otp).trim() }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data && data.success) {
        setVerified(true);
        setMsg("Email verified!");
        try {
          const verifiedAddr = (data.email || emailNorm).trim().toLowerCase();
          localStorage.setItem("verifiedEmail", verifiedAddr);
          sessionStorage.setItem("verifiedEmail", verifiedAddr);
          if (typeof setForm === "function" && fieldName) {
            setForm(prev => ({ ...prev, [fieldName]: verifiedAddr, otpVerified: true }));
          }
        } catch {}
      } else {
        setError((data && data.error) || "Incorrect OTP");
      }
    } catch (e) {
      setError("Network/server error.");
    } finally {
      setLoading(false);
      verifyingRef.current = false;
    }
  }

  if (verified) return <span className="ml-3 text-green-600 font-semibold text-xs">Verified ✓</span>;

  return (
    <div className="flex items-center gap-2 mt-2">
      {!otpSent ? (
        <button
          type="button"
          className={`ml-2 px-3 py-1 rounded bg-[#21809b] text-white text-xs font-medium shadow transition-all duration-150 hover:bg-[#196e87] active:scale-95 ${loading ? "opacity-60 cursor-not-allowed" : ""}`}
          onClick={handleSendOtp}
          disabled={!isEmailValid || loading}
          title={!isEmailValid ? "Enter a valid email first" : "Send OTP"}
        >
          Send OTP
        </button>
      ) : (
        <>
          <input
            type="text"
            value={otp}
            onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="Enter OTP"
            className="border px-2 py-1 rounded text-xs"
            maxLength={6}
            disabled={loading}
          />
          <button
            type="button"
            className="px-3 py-1 rounded bg-[#21809b] text-white text-xs font-medium shadow transition hover:bg-[#196e87] active:scale-95 disabled:opacity-60"
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

export default function DynamicRegistrationForm({
  config,
  form,
  setForm,
  onSubmit,
  editable = true,
  terms = null, // { url, label, required }
}) {
  const [emailVerified, setEmailVerified] = useState(false);

  // Debug: log config/form shape to help diagnose missing fields
  React.useEffect(() => {
    console.debug("DynamicRegistrationForm config:", config);
    console.debug("DynamicRegistrationForm form:", form);
  }, [config, form]);
  
  function handleChange(e) {
    const { name, value, type, checked } = e.target;
    if (type === "email") {
      const v = (value || "").trim();
      setForm(f => ({ ...f, [name]: v }));
      return;
    }
    setForm(f => ({ ...f, [name]: type === "checkbox" ? checked : value }));
  }

  // Provide a handler for terms checkbox (keeps form.termsAccepted)
  function handleTermsChange(e) {
    const checked = !!e.target.checked;
    setForm(f => ({ ...f, termsAccepted: checked }));
  }

  const safeFields = (config?.fields || []).filter(f =>
    f.visible !== false &&
    f.name &&
    f.label &&
    isVisible(f, form)
  );

  const emailField = safeFields.find(f => f.type === "email");
  const emailValue = emailField ? (form[emailField.name] || "") : "";

  const termsRequired = terms && terms.required;

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        // enforce terms if required
        if (termsRequired && !form?.termsAccepted) {
          // optionally show a message - set an error state on parent; here we prevent submit
          alert("Please accept the Terms & Conditions before continuing.");
          return;
        }
        if (emailField?.required && !emailVerified) {
          // block submit until verification
          alert("Please verify your email to continue.");
          return;
        }
        onSubmit && onSubmit(form);
      }}
      className="mx-auto w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-[#bde0fe] p-8"
    >
      <div className="flex flex-col gap-7">
        {safeFields.length === 0 && <div className="text-red-500 text-center">No fields configured for this form.</div>}

        {safeFields.map(field => (
          <div key={field.name}>
            {field.type === "checkbox" ? (
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="checkbox"
                  name={field.name}
                  checked={!!form[field.name]}
                  onChange={handleChange}
                  disabled={!editable}
                  required={field.required}
                />
                <span className="text-lg text-gray-600">{field.label}</span>
              </div>
            ) : (
              <>
                <label className="font-semibold text-[#21809b] text-lg">{field.label}</label>

                {(field.type === "text" || field.type === "email" || field.type === "number") && (
                  <div className="flex items-center">
                    <input
                      type={field.type}
                      name={field.name}
                      value={form[field.name] || ""}
                      onChange={handleChange}
                      className="w-full mt-2 p-4 rounded-lg bg-[#eaf6fb] border border-[#bde0fe] text-lg"
                      disabled={!editable}
                      required={field.required}
                    />
                    {field.type === "email" && (
                      <EmailOtpVerifier
                        email={form[field.name]}
                        fieldName={field.name}
                        setForm={setForm}
                        verified={emailVerified}
                        setVerified={setEmailVerified}
                      />
                    )}
                  </div>
                )}

                {field.type === "textarea" && (
                  <textarea
                    name={field.name}
                    value={form[field.name] || ""}
                    onChange={handleChange}
                    className="w-full mt-2 p-4 rounded-lg bg-[#eaf6fb] border border-[#bde0fe] text-lg"
                    rows={3}
                    disabled={!editable}
                    required={field.required}
                  />
                )}

                {field.type === "select" && (
                  <select
                    name={field.name}
                    value={form[field.name] || ""}
                    onChange={handleChange}
                    className="w-full mt-2 p-4 rounded-lg bg-[#eaf6fb] border border-[#bde0fe] text-lg"
                    disabled={!editable}
                    required={field.required}
                  >
                    <option value="">Select {field.label}</option>
                    {(field.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                )}

                {field.type === "radio" && (
                  <div className="flex gap-4 mt-2">
                    {(field.options || []).map(opt => (
                      <label key={opt} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={field.name}
                          value={opt}
                          checked={form[field.name] === opt}
                          onChange={handleChange}
                          disabled={!editable}
                          required={field.required}
                        />
                        <span>{opt}</span>
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ))}

        {/* Terms & Conditions block rendered after fields when provided via props */}
        {terms && (
          <div className="mt-2">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                name="termsAccepted"
                checked={!!form.termsAccepted}
                onChange={handleTermsChange}
                className="mt-1"
              />
              <div>
                <span className="text-gray-700">
                  {terms.label || "I accept the Terms & Conditions"}{" "}
                  {terms.url && (
                    <a href={terms.url} target="_blank" rel="noopener noreferrer" className="text-[#21809b] underline">
                      (View)
                    </a>
                  )}
                </span>
                {terms.required && <div className="text-xs text-red-600 mt-1">You must accept the terms to continue.</div>}
              </div>
            </label>
          </div>
        )}

        <div className="flex justify-end items-center mt-8">
          <button
            type="submit"
            className="px-8 py-3 rounded-xl bg-[#21809b] text-white font-semibold text-lg disabled:opacity-60"
            disabled={!editable || safeFields.length === 0 || (emailField?.required && !emailVerified) || (emailField && emailField.required && !isEmail(emailValue)) || (termsRequired && !form?.termsAccepted)}
            title={termsRequired && !form?.termsAccepted ? "Accept terms to continue" : undefined}
          >
            Submit
          </button>
        </div>
      </div>
    </form>
  );
}