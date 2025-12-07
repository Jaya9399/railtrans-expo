import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";

/*
  DynamicRegistrationForm.jsx (robust registrationType detection)

  Changes:
  - If registrationType prop is not provided, infer it automatically from:
      1) route params (useParams)
      2) query string (?type=...)
      3) last segment of pathname (/register/visitor)
      4) fallback to "visitor"
  - Ensures EmailOtpVerifier always receives a concrete registrationType.
  - Adds a debug console.log in handleSendOtp to show which registrationType is being sent.
  - Keeps previous behavior otherwise.
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

const KNOWN_TYPES = ["visitor", "exhibitor", "speaker", "partner", "awardee"];

function normalizeType(t) {
  if (!t || typeof t !== "string") return null;
  const s = t.trim().toLowerCase();
  if (!s) return null;
  if (KNOWN_TYPES.includes(s)) return s;
  // tolerate plural or trailing s
  if (s.endsWith("s") && KNOWN_TYPES.includes(s.slice(0, -1))) return s.slice(0, -1);
  return null;
}

/* Email OTP verifier - sends registrationType and surfaces existing info */
function EmailOtpVerifier({
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
  const [existing, setExisting] = useState(null); // { id, ticket_code, registrationType }
  const sendingRef = useRef(false);
  const verifyingRef = useRef(false);

  const emailNorm = (email || "").trim().toLowerCase();
  const isEmailValid = isEmail(emailNorm);

  useEffect(() => {
    setOtp("");
    setOtpSent(false);
    setMsg("");
    setError("");
    setExisting(null);
    setVerified && setVerified(false);
    if (autoSend && isEmailValid) {
      setTimeout(() => {
        handleSendOtp();
      }, 200);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailNorm, autoSend, registrationType]);

  async function handleSendOtp() {
    if (sendingRef.current) return;
    if (!isEmailValid) {
      setError("Enter a valid email before sending OTP.");
      return;
    }
    sendingRef.current = true;
    setLoading(true);
    setMsg("");
    setError("");
    setExisting(null);
    try {
      const requestId = makeRequestId();

      // DEBUG: show what registrationType will be sent
      console.debug("[EmailOtpVerifier] sending /api/otp/send registrationType=", registrationType, "email=", emailNorm);

      const res = await fetch(`${apiBase || ""}/api/otp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "email",
          value: emailNorm,
          requestId,
          registrationType, // <<-- IMPORTANT: pass registrationType
        }),
      });

      const data = await res.json().catch(() => null);

      // If server returns 409 with existing, show message and DO NOT expect an OTP
      if (res.status === 409 && data && data.existing) {
        setExisting({ ...(data.existing), registrationType: data.registrationType || registrationType });
        setMsg("Email already exists in our records for this registration page.");
        setOtpSent(false);
        return;
      }

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
    if (!isEmailValid) {
      setError("Invalid email");
      return;
    }
    verifyingRef.current = true;
    setLoading(true);
    setError("");
    setMsg("");
    setExisting(null);
    try {
      const res = await fetch(`${apiBase || ""}/api/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: emailNorm, otp: String(otp).trim(), registrationType }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.success === false) {
        setError((data && (data.error || data.message)) || "OTP verification failed");
        return;
      }

      // mark verified
      setVerified && setVerified(true);
      setMsg("Email verified!");

      // update normalized email into form
      try {
        const verifiedAddr = (data.email || emailNorm).trim().toLowerCase();
        localStorage.setItem("verifiedEmail", verifiedAddr);
        sessionStorage.setItem("verifiedEmail", verifiedAddr);
        if (typeof setForm === "function" && fieldName) {
          setForm((prev) => ({ ...prev, [fieldName]: verifiedAddr, otpVerified: true }));
        }
      } catch {}

      // if server returned existing info for this registrationType, show it
      if (data.existing) {
        setExisting({ ...(data.existing), registrationType: data.registrationType || registrationType });
        setMsg("Email already exists in our records for this registration page.");
      }
    } catch (e) {
      console.error("handleVerifyOtp error:", e);
      setError("Network/server error.");
    } finally {
      setLoading(false);
      verifyingRef.current = false;
    }
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

      {existing && (
        <div className="ml-4 p-2 bg-yellow-50 border border-yellow-100 rounded text-xs">
          <div className="mb-1 font-medium text-[#b45309]">Email already exists</div>
          <div className="text-xs text-gray-700 mb-2">
            If you want to update your {existing.registrationType || registrationType} ticket/category, click Upgrade Ticket.
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => navigate(`/ticket-upgrade?type=${encodeURIComponent(existing.registrationType || registrationType)}&id=${encodeURIComponent(String(existing.id))}`)}
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

/* Main DynamicRegistrationForm (registrationType detection added) */
export default function DynamicRegistrationForm({
  config,
  form,
  setForm,
  onSubmit,
  editable = true,
  terms = null,
  apiBase = "",
  registrationType: propRegistrationType = null,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();

  const [emailVerified, setEmailVerified] = useState(false);
  const [localConfig, setLocalConfig] = useState(config || null);
  const [loadingConfig, setLoadingConfig] = useState(!config);

  const [serverNote, setServerNote] = useState("");
  const [requireOtp, setRequireOtp] = useState(false);
  const [autoOtpSend, setAutoOtpSend] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState(null);

  const [pendingSubmitAfterOtp, setPendingSubmitAfterOtp] = useState(false);
  const [verificationToken, setVerificationToken] = useState(null);

  // Determine registrationType: priority prop > query ?type= > route param "type" > last path segment > fallback "visitor"
  const inferredRegistrationType = (() => {
    const fromProp = normalizeType(propRegistrationType);
    if (fromProp) return fromProp;

    // query string ?type=...
    try {
      const q = new URLSearchParams(location.search || "");
      const qtype = normalizeType(q.get("type"));
      if (qtype) return qtype;
    } catch {}

    // route params (e.g., /register/:type)
    try {
      const p = normalizeType(params.type || params.registrationType || params.kind);
      if (p) return p;
    } catch {}

    // last path part
    try {
      const parts = (location.pathname || "").split("/").filter(Boolean);
      if (parts.length) {
        const last = normalizeType(parts[parts.length - 1]);
        if (last) return last;
        // sometimes path like /register/visitor -> second last
        if (parts.length >= 2) {
          const secondLast = normalizeType(parts[parts.length - 2]);
          if (secondLast) return secondLast;
        }
      }
    } catch {}

    // fallback
    return "visitor";
  })();

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
        const cfgEndpoint = inferredRegistrationType && inferredRegistrationType !== "visitor"
          ? `${apiBase || ""}/api/${encodeURIComponent(inferredRegistrationType)}-config`
          : `${apiBase || ""}/api/visitor-config`;
        const res = await fetch(cfgEndpoint);
        if (!res.ok) {
          setLocalConfig({ fields: [] });
          return;
        }
        const js = await res.json().catch(() => ({}));
        if (!mounted) return;
        js.fields = Array.isArray(js.fields) ? js.fields : [];
        setLocalConfig(js);
      } catch (e) {
        console.error("fetch config error", e);
        setLocalConfig({ fields: [] });
      } finally {
        if (mounted) setLoadingConfig(false);
      }
    }
    fetchCfg();
    return () => (mounted = false);
  }, [config, apiBase, inferredRegistrationType]);

  useEffect(() => {
    const emailField = (localConfig && localConfig.fields || []).find(f => f.type === "email");
    const emailValue = emailField ? (form[emailField.name] || "").trim().toLowerCase() : "";
    setServerNote("");
    setRequireOtp(false);
    setAutoOtpSend(false);
    setSubmitMessage(null);
    setEmailVerified(false);
    setPendingSubmitAfterOtp(false);
    setVerificationToken(null);

    try {
      const stored = localStorage.getItem("verifiedEmail") || sessionStorage.getItem("verifiedEmail");
      if (stored && stored.trim().toLowerCase() === emailValue && emailValue) {
        setEmailVerified(true);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form && JSON.stringify(form), localConfig, inferredRegistrationType]);

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
  const emailValue = emailField ? (form[emailField.name] || "") : "";
  const termsRequired = terms && terms.required;

  async function doFinalSubmit(payload) {
    try {
      const body = { ...payload };
      if (verificationToken) body.verificationToken = verificationToken;
      body.registrationType = inferredRegistrationType;
      // NOTE: adjust endpoint per your server (this example posts to /api/visitors for all types).
      const endpoint = `${apiBase || ""}/api/visitors`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);

      if (res.ok && data && data.success) {
        setSubmitMessage({ type: "success", text: data.message || "Registered successfully." });
        onSubmit && typeof onSubmit === "function" && onSubmit(form, data);
        return { ok: true, data };
      }

      if (data && data.showUpdate && data.existing && data.existing.id) {
        navigate(`/ticket-upgrade?type=${encodeURIComponent(inferredRegistrationType)}&id=${encodeURIComponent(String(data.existing.id))}`);
        return { ok: false, data };
      }

      setSubmitMessage({ type: "error", text: (data && (data.message || data.error)) || "Registration failed" });
      return { ok: false, data };
    } catch (err) {
      console.error("doFinalSubmit error:", err);
      setSubmitMessage({ type: "error", text: "Network/server error while submitting." });
      return { ok: false, data: null };
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitMessage(null);
    if (termsRequired && !form?.termsAccepted) {
      setSubmitMessage({ type: "error", text: "Please accept the Terms & Conditions before continuing." });
      return;
    }

    if (emailField && emailField.meta && emailField.meta.useOtp && !emailVerified) {
      setRequireOtp(true);
      setAutoOtpSend(true);
      setPendingSubmitAfterOtp(true);
      setServerNote("We will send an OTP to your email before completing registration.");
      return;
    }

    setSubmitting(true);
    try {
      await doFinalSubmit(form);
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (emailVerified && pendingSubmitAfterOtp) {
      (async () => {
        setSubmitting(true);
        setPendingSubmitAfterOtp(false);
        try {
          await doFinalSubmit(form);
        } finally {
          setSubmitting(false);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailVerified, pendingSubmitAfterOtp]);

  return (
    <form onSubmit={handleSubmit} className="mx-auto w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-[#bde0fe] p-8">
      <div className="flex flex-col gap-7">
        {loadingConfig && <div className="text-sm text-gray-500">Loading form...</div>}
        {safeFields.length === 0 && !loadingConfig && (
          <div className="text-red-500 text-center">No fields configured for this form.</div>
        )}

        {serverNote && (
          <div className="p-3 rounded bg-yellow-50 border border-yellow-200 text-sm">
            {serverNote}
          </div>
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
                    <input
                      type={field.type}
                      name={field.name}
                      value={form[field.name] || ""}
                      onChange={handleChange}
                      className="w-full mt-2 p-4 rounded-lg bg-[#eaf6fb] border border-[#bde0fe] text-lg"
                      disabled={!editable}
                      required={field.required}
                    />
                    {field.type === "email" && field.meta?.useOtp && (
                      <EmailOtpVerifier
                        email={form[field.name]}
                        fieldName={field.name}
                        setForm={setForm}
                        verified={emailVerified}
                        setVerified={setEmailVerified}
                        apiBase={apiBase}
                        autoSend={autoOtpSend}
                        registrationType={inferredRegistrationType}
                      />
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

        {submitMessage && (
          <div className={`p-3 rounded ${submitMessage.type === "error" ? "bg-red-50 border border-red-200" : submitMessage.type === "info" ? "bg-blue-50 border border-blue-200" : "bg-green-50 border border-green-200"}`}>
            <p className="text-sm">{submitMessage.text}</p>
          </div>
        )}

        <div className="flex justify-end items-center mt-8 gap-3">
          <button
            type="submit"
            className="px-8 py-3 rounded-xl bg-[#21809b] text-white font-semibold text-lg disabled:opacity-60"
            disabled={
              !editable ||
              safeFields.length === 0 ||
              (emailField?.required && emailField.meta?.useOtp && !emailVerified) ||
              (emailField && emailField.required && !isEmail(emailValue)) ||
              (termsRequired && !form?.termsAccepted) ||
              submitting
            }
          >
            {submitting ? "Processing..." : "Submit"}
          </button>
        </div>
      </div>
    </form>
  );
}