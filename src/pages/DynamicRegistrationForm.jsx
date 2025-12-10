import React, { useEffect, useState } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import EmailOtpVerifier from "../components/EmailOtpField";

/*
  DynamicRegistrationForm (updated)
  - Important change: If a parent passed an onSubmit callback, the form will DELEGATE
    persistence to the parent instead of POSTing to /api/visitors itself.
  - This prevents duplicate saves when the form lives inside a page (like Visitors)
    that is responsible for persisting the record.
*/

function isVisible(field, form) {
  if (!field) return false;
  if (field.visible === false) return false;
  if (!field.visibleIf && !field.showIf) return true;
  return Object.entries(field.showIf || field.visibleIf || {}).every(([k, v]) => form[k] === v);
}
function isEmail(str) {
  return typeof str === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((str || "").trim());
}
const KNOWN_TYPES = ["visitor", "exhibitor", "speaker", "partner", "awardee"];
function normalizeType(t) {
  if (!t || typeof t !== "string") return null;
  const s = t.trim().toLowerCase();
  if (!s) return null;
  if (KNOWN_TYPES.includes(s)) return s;
  if (s.endsWith("s") && KNOWN_TYPES.includes(s.slice(0, -1))) return s.slice(0, -1);
  return null;
}

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
  const [autoOtpSend, setAutoOtpSend] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState(null);
  const [pendingSubmitAfterOtp, setPendingSubmitAfterOtp] = useState(false);
  const [verificationToken, setVerificationToken] = useState(null);

  const inferredRegistrationType = (() => {
    const fromProp = normalizeType(propRegistrationType);
    if (fromProp) return fromProp;
    try { const q = new URLSearchParams(location.search || ""); const qtype = normalizeType(q.get("type")); if (qtype) return qtype; } catch {}
    try { const p = normalizeType(params.type || params.registrationType || params.kind); if (p) return p; } catch {}
    try { const parts = (location.pathname || "").split("/").filter(Boolean); if (parts.length) { const last = normalizeType(parts[parts.length - 1]); if (last) return last; if (parts.length >= 2) { const secondLast = normalizeType(parts[parts.length - 2]); if (secondLast) return secondLast; } } } catch {}
    return "visitor";
  })();

  useEffect(() => { if (config) { setLocalConfig(config); setLoadingConfig(false); } }, [config]);

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
        if (!res.ok) { setLocalConfig({ fields: [] }); return; }
        const js = await res.json().catch(() => ({}));
        if (!mounted) return;
        js.fields = Array.isArray(js.fields) ? js.fields : [];
        setLocalConfig(js);
      } catch (e) {
        console.error("fetch config error", e);
        setLocalConfig({ fields: [] });
      } finally { if (mounted) setLoadingConfig(false); }
    }
    fetchCfg();
    return () => (mounted = false);
  }, [config, apiBase, inferredRegistrationType]);

  useEffect(() => {
    // Determine emailVerified from either parent-set state (setVerified) or localStorage fallback.
    const emailField = (localConfig && localConfig.fields || []).find(f => f.type === "email");
    const emailValue = emailField ? (form[emailField.name] || "").trim().toLowerCase() : "";

    // If parent has already marked verified true, keep it.
    // Otherwise check localStorage/sessionStorage for a previously stored verified email that matches current input.
    if (!emailValue) {
      setEmailVerified(false);
      return;
    }

    try {
      if (emailVerified) {
        // already verified by child; keep it
        return;
      }
      const stored = (localStorage.getItem("verifiedEmail") || sessionStorage.getItem("verifiedEmail") || "").trim().toLowerCase();
      if (stored && stored === emailValue) {
        setEmailVerified(true);
        return;
      }
      setEmailVerified(false);
    } catch (e) {
      setEmailVerified(false);
    }
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

  /**
   * doFinalSubmit(payload)
   * - If parent provided onSubmit, DELEGATE persistence to parent by calling onSubmit(form).
   * - Otherwise perform the previous behavior (POST to /api/visitors).
   */
  async function doFinalSubmit(payload) {
    // If parent wants to handle submission, delegate and return its result.
    if (onSubmit && typeof onSubmit === "function") {
      try {
        // allow parent to handle saving; parent may be synchronous or return a promise
        const maybe = onSubmit(payload);
        const result = maybe && typeof maybe.then === "function" ? await maybe : maybe;
        setSubmitMessage({ type: "success", text: "Submitted (handled by parent)." });
        return { ok: true, delegated: true, data: result || null };
      } catch (err) {
        console.error("Delegated onSubmit failed:", err);
        setSubmitMessage({ type: "error", text: (err && err.message) || "Submission failed (parent)." });
        return { ok: false, error: err };
      }
    }

    // No parent onSubmit — perform network submit ourselves (backwards-compatible)
    try {
      const body = { ...payload };
      if (verificationToken) body.verificationToken = verificationToken;
      body.registrationType = inferredRegistrationType;
      const endpoint = `${apiBase || ""}/api/visitors`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);

      if (res.ok && data && data.success) {
        setSubmitMessage({ type: "success", text: data.message || "Registered successfully." });
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
      return { ok: false, error: err };
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