import React, { useEffect, useState } from "react";
import EmailOtpVerifier from "../components/EmailOtpField";

// ---- utility functions ----
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

// ---- component ----
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
  const [emailVerified, setEmailVerified] = useState(false);
  const [verifiedEmailValue, setVerifiedEmailValue] = useState(null); // keep track of which email was last OTP-verified
  const [verificationToken, setVerificationToken] = useState(null);

  const [localConfig, setLocalConfig] = useState(config || null);
  const [loadingConfig, setLoadingConfig] = useState(!config);
  const [serverNote, setServerNote] = useState("");
  const [autoOtpSend, setAutoOtpSend] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState(null);
  const [pendingSubmitAfterOtp, setPendingSubmitAfterOtp] = useState(false);
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const [alreadyRegisteredInfo, setAlreadyRegisteredInfo] = useState(null);

  // Basic config load
  useEffect(() => { if (config) { setLocalConfig(config); setLoadingConfig(false); } }, [config]);

  // Optionally fetch config if not passed as prop
  useEffect(() => {
    let mounted = true;
    async function fetchCfg() {
      if (config) return;
      setLoadingConfig(true);
      try {
        // ...your fetch logic as in previous versions if needed...
      } catch (e) {
        setLocalConfig({ fields: [] });
      } finally { if (mounted) setLoadingConfig(false); }
    }
    fetchCfg();
    return () => (mounted = false);
  }, [config, apiBase, registrationType]);

  // --- Email field config lookup (always from config, NOT visible fields!)
  const effectiveConfig = localConfig || { fields: [] };
  const emailFieldConfig =
    (effectiveConfig.fields || []).find(f => f.type === "email") || null;
  const emailOtpRequired = Boolean(emailFieldConfig?.meta?.useOtp);
  const emailFieldName = emailFieldConfig?.name || "";

  // Current email value from form
  const emailValue = emailFieldName ? (form[emailFieldName] || "") : "";
  const emailValueNorm = String(emailValue).trim().toLowerCase();

  // Check: is the current visible email OTP verified (value matches what was verified)
  const isOtpVerifiedForCurrentEmail =
    emailVerified &&
    verifiedEmailValue === emailValueNorm &&
    !!verificationToken;

  // When the email field changes, reset OTP verified and token
  useEffect(() => {
    if (!emailValueNorm || verifiedEmailValue !== emailValueNorm) {
      setEmailVerified(false);
      setVerificationToken(null);
      setVerifiedEmailValue(null);
    }
  }, [emailValueNorm]);

  // --- Phone input processing and validation as in your previous code ---
  function handlePhoneChange(fieldName, value, countryData) {
    const rawDigits = String(value || "").replace(/\D/g, "");
    const dial = countryData && countryData.dialCode ? String(countryData.dialCode).replace(/\D/g, "") : "";
    let national = rawDigits;
    if (dial && national.startsWith(dial)) national = national.slice(dial.length);
    if (national.length > 10) national = national.slice(0, 10);
    const fullValue = (dial ? `+${dial}${national}` : (national ? `+${national}` : ""));
    const countryStored = dial ? `+${dial}` : "";
    setForm((f) => ({ ...f, [fieldName]: fullValue, [`${fieldName}_country`]: countryStored, [`${fieldName}_national`]: national }));
  }
  useEffect(() => {
    const phoneFields = (effectiveConfig.fields || []).filter(f => f && f.name && (f.type === "phone" || f.type === "tel" || isPhoneFieldName(f.name) || f.meta?.isPhone || f.usePhoneInput));
    if (!phoneFields.length) return;
    let updates = {};
    phoneFields.forEach((field) => {
      const val = form[field.name];
      const countryVal = form[`${field.name}_country`] || "";
      if (!val) {
        if (!form[`${field.name}_national`]) {
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
      if (countryDial && form[`${field.name}_country`] !== `+${countryDial}`) updates[`${field.name}_country`] = `+${countryDial}`;
    });
    if (Object.keys(updates).length) setForm(f => ({ ...f, ...updates }));
  }, [localConfig, JSON.stringify(form)]);

  // --- Terms change ---
  function handleTermsChange(e) {
    const checked = !!e.target.checked;
    setForm((f) => ({ ...f, termsAccepted: checked }));
  }

  function handleChange(e) {
    const { name, value, type, checked } = e.target;
    setForm((f) => ({ ...f, [name]: type === "checkbox" ? checked : value }));
  }

  const safeFields = (effectiveConfig.fields || []).filter((f) => f && f.name && f.label && isVisible(f, form));
  const termsRequired = terms && terms.required;
  const visiblePhoneFields = safeFields.filter(f => f && f.name && (f.type === "phone" || f.type === "tel" || isPhoneFieldName(f.name) || f.meta?.isPhone || f.usePhoneInput));
  const phoneValidationFailed = visiblePhoneFields.some(f => {
    const nat = form[`${f.name}_national`];
    return !(typeof nat === "string" && nat.length === 10);
  });

  // Already registered email disables form submit
  function handleEmailStatus(exists, info) {
    setAlreadyRegistered(Boolean(exists));
    setAlreadyRegisteredInfo(info || null);
  }

  // --- Can submit logic, ALWAYS enforces OTP for email even if field is hidden!
  const canSubmit =
    editable &&
    safeFields.length > 0 &&
    !alreadyRegistered &&
    (!emailOtpRequired || isOtpVerifiedForCurrentEmail) &&
    (!termsRequired || form?.termsAccepted) &&
    !phoneValidationFailed &&
    !submitting;

  // --- Strong submit handler disables on logic not UI
  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitMessage(null);

    if (alreadyRegistered) {
      setSubmitMessage({ type: "error", text: "Email already registered. Use upgrade." });
      return;
    }

    if (emailOtpRequired && !isOtpVerifiedForCurrentEmail) {
      setSubmitMessage({
        type: "error",
        text: "Please verify your email via OTP before submitting."
      });
      setAutoOtpSend(true);
      return;
    }

    if (termsRequired && !form?.termsAccepted) {
      setSubmitMessage({ type: "error", text: "Please accept the Terms & Conditions before continuing." });
      return;
    }

    if (phoneValidationFailed) {
      setSubmitMessage({ type: "error", text: "Please enter a 10-digit phone number for the highlighted phone fields." });
      return;
    }

    setSubmitting(true);
    try {
      // Pass verificationToken to backend (doFinalSubmit or onSubmit must send it)
      const payload = { ...form, verificationToken: (emailOtpRequired ? verificationToken : undefined) };
      if (onSubmit && typeof onSubmit === "function") {
        await onSubmit(payload);
      }
    } finally {
      setSubmitting(false);
    }
  }

  // --- Handler if OTP verifies
  function handleOtpSuccess({ email, token }) {
    setEmailVerified(true);
    setVerifiedEmailValue(email.toLowerCase());
    setVerificationToken(token);
    // may autosend form if pendingSubmitAfterOtp
    if (pendingSubmitAfterOtp) {
      setPendingSubmitAfterOtp(false);
      handleSubmit({ preventDefault: () => {} });
    }
  }

  // --- OTP Component --- Pass status/handler/token up!
  // You MUST update your EmailOtpVerifier to accept (onOtpSuccess) and call:
  //   onOtpSuccess({ email, token })
  // when OTP is verified, passing the token up to parent.
  //
  // You must also pass `onEmailStatus` to EmailOtpVerifier so parent gets email-exists.
  // See prev answer for details.

  // --- Form UI ---
  return (
    <form onSubmit={handleSubmit}
      className="mx-auto w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-[#bde0fe] p-8"
    >
      <div className="flex flex-col gap-7">
        {loadingConfig && <div className="text-sm text-gray-500">Loading form...</div>}
        {safeFields.length === 0 && !loadingConfig && (
          <div className="text-red-500 text-center">No fields configured for this form.</div>
        )}

        {/* Show "already registered" info and disable further registration */}
        {alreadyRegistered && (
          <div className="mt-3 p-2 bg-yellow-50 text-yellow-800 border border-yellow-200 rounded text-center text-sm">
            This email is already registered.
            {alreadyRegisteredInfo && (
              <div className="mt-1 text-xs text-gray-700">
                You may <a href={`/ticket-upgrade?entity=${encodeURIComponent(alreadyRegisteredInfo.collection || 'visitors')}&id=${encodeURIComponent(alreadyRegisteredInfo.id || '')}&email=${encodeURIComponent(form[emailFieldName])}`} className="text-[#21809b] underline">upgrade your ticket</a>.
              </div>
            )}
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
                          {(form[`${field.name}_national`] && form[`${field.name}_national`].length !== 10) && (
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
                          {/* Only show OTP for email field */}
                          {field.type === "email" && field.meta?.useOtp && (
                            <EmailOtpVerifier
                              email={form[field.name]}
                              fieldName={field.name}
                              setForm={setForm}
                              verified={emailVerified}
                              setVerified={setEmailVerified}
                              apiBase={apiBase}
                              autoSend={autoOtpSend}
                              registrationType={propRegistrationType}
                              onEmailStatus={handleEmailStatus}
                              onOtpSuccess={({ email, token }) => handleOtpSuccess({ email, token })}
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
            disabled={!canSubmit}
          >
            {submitting ? "Processing..." : "Submit"}
          </button>
        </div>
      </div>
    </form>
  );
}