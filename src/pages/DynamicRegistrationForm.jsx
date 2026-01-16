import React, { useEffect, useState } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import EmailOtpVerifier from "../components/EmailOtpField";
import PhoneInput from "react-phone-input-2";
import "react-phone-input-2/lib/style.css";

/*
  DynamicRegistrationForm

  Changes related to your request "only 10 numbers should be allowed in phone numbers":
  - Phone input (react-phone-input-2) is used for any field detected as a phone field.
  - handlePhoneChange now derives the national (local) number (digits-only, excluding dialCode),
    trims it to max 10 digits, and stores:
      - form[fieldName] = "+<dialCode><national>" (E.164-like)
      - form[`${fieldName}_country`] = "+<dialCode>"
      - form[`${fieldName}_national`] = "<national digits>"  (always digits, max length 10)
  - A live helper/error message is shown under phone inputs when national length !== 10.
  - The submit button is disabled while any visible phone field has national length !== 10.
  - A small useEffect will normalise any pre-filled phone values into the same structure so validation works for edit modes too.

  Note:
  - This enforces a maximum of 10 digits for the national part. If you want to require exactly 10 (not less),
    the submit button is disabled until national length === 10. If you want to allow shorter numbers,
    adjust the validation logic accordingly.
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

function isPhoneFieldName(name = "") {
  if (!name || typeof name !== "string") return false;
  return /(phone|mobile|contact|msisdn|tel)/i.test(name);
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
    const emailField = (localConfig && localConfig.fields || []).find(f => f.type === "email");
    const emailValue = emailField ? (form[emailField.name] || "").trim().toLowerCase() : "";

    if (!emailValue) {
      setEmailVerified(false);
      return;
    }

    try {
      if (emailVerified) {
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

  // New: enforce max 10 digits for the national (subscriber) number.
  // react-phone-input-2's onChange gives value (digits without + usually) and countryData (contains dialCode).
  function handlePhoneChange(fieldName, value, countryData) {
    const rawDigits = String(value || "").replace(/\D/g, "");
    const dial = countryData && countryData.dialCode ? String(countryData.dialCode).replace(/\D/g, "") : "";
    // remove leading dial from rawDigits if present
    let national = rawDigits;
    if (dial && national.startsWith(dial)) {
      national = national.slice(dial.length);
    }
    // enforce max 10 digits for national part
    if (national.length > 10) national = national.slice(0, 10);

    // build stored full value as +<dial><national> if dial present, else '+' + national
    const fullValue = (dial ? `+${dial}${national}` : (national ? `+${national}` : ""));
    const countryStored = dial ? `+${dial}` : "";

    setForm((f) => ({ ...f, [fieldName]: fullValue, [`${fieldName}_country`]: countryStored, [`${fieldName}_national`]: national }));
  }

  // Ensure prefilled values are normalized into *_national fields (runs when config or form changes)
  useEffect(() => {
    const effectiveConfig = localConfig || { fields: [] };
    const phoneFields = (effectiveConfig.fields || []).filter(f => f && f.name && (f.type === "phone" || f.type === "tel" || isPhoneFieldName(f.name) || f.meta?.isPhone || f.usePhoneInput));
    if (!phoneFields.length) return;

    let updates = {};
    phoneFields.forEach((field) => {
      const val = form[field.name];
      const countryVal = form[`${field.name}_country`] || "";
      if (!val) {
        if (!form[`${field.name}_national`]) {
          // ensure there's at least an empty key to avoid undefined checks
          updates[`${field.name}_national`] = "";
        }
        return;
      }
      const digits = String(val).replace(/\D/g, "");
      const countryDial = String(countryVal || "").replace(/\D/g, "");
      let national = digits;
      if (countryDial && national.startsWith(countryDial)) national = national.slice(countryDial.length);
      if (national.length > 10) national = national.slice(0, 10);
      if (form[`${field.name}_national`] !== national) updates[`${field.name}_national`] = national;
      // also ensure country stored consistently
      if (countryDial && form[`${field.name}_country`] !== `+${countryDial}`) updates[`${field.name}_country`] = `+${countryDial}`;
    });

    if (Object.keys(updates).length) {
      setForm(f => ({ ...f, ...updates }));
    }
   
  }, [localConfig, JSON.stringify(form)]);

  function handleTermsChange(e) {
    const checked = !!e.target.checked;
    setForm((f) => ({ ...f, termsAccepted: checked }));
  }

  const effectiveConfig = localConfig || { fields: [] };
  const safeFields = (effectiveConfig.fields || []).filter((f) => f && f.name && f.label && isVisible(f, form));
  const emailField = safeFields.find((f) => f.type === "email");
  const emailValue = emailField ? (form[emailField.name] || "") : "";
  const termsRequired = terms && terms.required;

  // disable submit if any visible phone field does not have exactly 10 national digits
  const visiblePhoneFields = safeFields.filter(f => f && f.name && (f.type === "phone" || f.type === "tel" || isPhoneFieldName(f.name) || f.meta?.isPhone || f.usePhoneInput));
  const phoneValidationFailed = visiblePhoneFields.some(f => {
    const nat = form[`${f.name}_national`];
    // enforce exactly 10 digits before allowing submit (user requested "only 10 numbers")
    return !(typeof nat === "string" && nat.length === 10);
  });

  async function doFinalSubmit(payload) {
    if (onSubmit && typeof onSubmit === "function") {
      try {
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

    // Prevent submission while phone validation fails
    if (phoneValidationFailed) {
      setSubmitMessage({ type: "error", text: "Please enter a 10-digit phone number for the highlighted phone fields." });
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

        {safeFields.map((field) => {
          const shouldUsePhoneInput =
            field.type === "phone" ||
            field.type === "tel" ||
            field.meta?.isPhone ||
            field.usePhoneInput ||
            isPhoneFieldName(field.name);

          return (
            <div key={field.name}>
              {field.type === "checkbox" ? (
                <div className="flex items-center gap-2 mt-2">
                  <input type="checkbox" name={field.name} checked={!!form[field.name]} onChange={handleChange} disabled={!editable} required={field.required} />
                  <span className="text-lg text-gray-600">{field.label}</span>
                </div>
              ) : (
                <>
                  <label className="font-semibold text-[#21809b] text-lg">{field.label}</label>

                  {(field.type === "text" || field.type === "email" || field.type === "number" || field.type === "phone" || field.type === "tel") && (
                    <>
                      {shouldUsePhoneInput ? (
                        <div className="mt-2">
                          <PhoneInput
                            country={field.meta?.defaultCountry || "in"}
                            value={form[field.name] || ""}
                            onChange={(value, countryData) => handlePhoneChange(field.name, value, countryData)}
                            inputProps={{
                              name: field.name,
                              required: field.required,
                            }}
                            enableSearch
                            disableSearchIcon={false}
                            containerClass="phone-input-container"
                            inputClass="p-4 rounded-lg bg-[#eaf6fb] border border-[#bde0fe] text-lg w-full"
                            buttonClass="phone-flag-button"
                            specialLabel=""
                          />
                          {/* validation helper */}
                          { (form[`${field.name}_national`] && form[`${field.name}_national`].length !== 10) && (
                            <div className="text-sm text-red-600 mt-1">Phone number must be exactly 10 digits (local number).</div>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center">
                          <input
                            type={field.type === "number" ? "number" : field.type}
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
                    </>
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
          );
        })}

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
              submitting ||
              phoneValidationFailed
            }
          >
            {submitting ? "Processing..." : "Submit"}
          </button>
        </div>
      </div>
    </form>
  );
}