import React, { useEffect, useState } from "react";
import EmailOtpVerifier from "../components/EmailOtpField";
import PhoneInput from "react-phone-input-2";
import "react-phone-input-2/lib/style.css";

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
  skipOtp = false,
}) {
  const [emailVerified, setEmailVerified] = useState(false);
  const [verifiedEmailValue, setVerifiedEmailValue] = useState(null);
  const [verificationToken, setVerificationToken] = useState(null);

  const [localConfig, setLocalConfig] = useState(config || null);
  const [loadingConfig, setLoadingConfig] = useState(!config);
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
        // ...your fetch logic if needed...
      } catch (e) {
        setLocalConfig({ fields: [] });
      } finally { if (mounted) setLoadingConfig(false); }
    }
    fetchCfg();
    return () => (mounted = false);
  }, [config, apiBase, propRegistrationType]);

  // --- Email field config lookup
  const effectiveConfig = localConfig || { fields: [] };
  const emailFieldConfig = (effectiveConfig.fields || []).find(f => f.type === "email") || null;
  const emailOtpRequired = Boolean(emailFieldConfig?.meta?.useOtp);
  const emailFieldName = emailFieldConfig?.name || "";

  // Current email value from form
  const emailValue = emailFieldName ? (form[emailFieldName] || "") : "";
  const emailValueNorm = String(emailValue).trim().toLowerCase();

  // Check: is the current visible email OTP verified
  const isOtpVerifiedForCurrentEmail = emailVerified && verifiedEmailValue === emailValueNorm && !!verificationToken;

  // When the email field changes, reset OTP verified and token
  useEffect(() => {
    if (!emailValueNorm || verifiedEmailValue !== emailValueNorm) {
      setEmailVerified(false);
      setVerificationToken(null);
      setVerifiedEmailValue(null);
    }
  }, [emailValueNorm]);

  // --- Phone input processing
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

  // --- Terms change
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

  // --- Can submit logic
  const canSubmit = editable && safeFields.length > 0 && !alreadyRegistered && (!emailOtpRequired || skipOtp || isOtpVerifiedForCurrentEmail) && (!termsRequired || form?.termsAccepted) && !phoneValidationFailed && !submitting;

  // --- Submit handler
  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitMessage(null);

    if (alreadyRegistered) {
      setSubmitMessage({ type: "error", text: "Email already registered. Use upgrade." });
      return;
    }

    if (emailOtpRequired && !isOtpVerifiedForCurrentEmail && !skipOtp) {
      setSubmitMessage({ type: "error", text: "Please verify your email via OTP before submitting." });
      setAutoOtpSend(true);
      return;
    }

    if (termsRequired && !form?.termsAccepted) {
      setSubmitMessage({ type: "error", text: "Please accept the Terms & Conditions before continuing." });
      return;
    }

    if (phoneValidationFailed) {
      setSubmitMessage({ type: "error", text: "Please enter a 10-digit phone number." });
      return;
    }

    setSubmitting(true);
    try {
      const payload = { ...form, verificationToken: (emailOtpRequired ? verificationToken : undefined) };
      if (onSubmit && typeof onSubmit === "function") {
        await onSubmit(payload);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleOtpSuccess({ email, token }) {
    setEmailVerified(true);
    setVerifiedEmailValue(email.toLowerCase());
    setVerificationToken(token);
    setForm(prev => ({ 
      ...prev, 
      verificationToken: token,
      emailVerified: true 
    }));
    
    if (pendingSubmitAfterOtp) {
      setPendingSubmitAfterOtp(false);
      handleSubmit({ preventDefault: () => {} });
    }
  }

  // Helper to render field with reduced padding and spacing
  const renderField = (field) => {
    const shouldUsePhoneInput = field.type === "phone" || field.type === "tel" || field.meta?.isPhone || field.usePhoneInput || isPhoneFieldName(field.name);
    
    return (
      <div key={field.name} className="mb-4"> {/* Reduced from mb-6 to mb-4 */}
        {field.type === "checkbox" ? (
          <div className="flex items-center gap-2">
            <input 
              type="checkbox" 
              name={field.name} 
              checked={!!form[field.name]} 
              onChange={handleChange} 
              disabled={!editable} 
              required={field.required} 
              className="w-4 h-4"
            />
            <span className="text-gray-700">{field.label}</span>
          </div>
        ) : (
          <>
            <label className="font-semibold text-[#21809b] text-base block mb-1"> {/* Reduced text-lg to text-base, added mb-1 */}
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </label>

            {(field.type === "text" || field.type === "email" || field.type === "number" || field.type === "phone" || field.type === "tel") && (
              <>
                {shouldUsePhoneInput ? (
                  <div>
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
                      inputClass="p-2 rounded-lg bg-[#eaf6fb] border border-[#bde0fe] text-base w-full" 
                      buttonClass="phone-flag-button"
                      specialLabel=""
                    />
                    {(form[`${field.name}_national`] && form[`${field.name}_national`].length !== 10) && (
                      <div className="text-xs text-red-600 mt-1">Phone must be 10 digits</div>
                    )}
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      type={field.type === "number" ? "number" : field.type}
                      name={field.name}
                      value={form[field.name] || ""}
                      onChange={handleChange}
                      className="w-full p-2 rounded-lg bg-[#eaf6fb] border border-[#bde0fe] text-base" 
                      disabled={!editable}
                      required={field.required}
                      placeholder={`Enter ${field.label.toLowerCase()}`}
                    />
                    {/* OTP button positioned inline for email fields */}
                    {field.type === "email" && field.meta?.useOtp && (
                      <div className="mt-2">
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
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
            
            {field.type === "textarea" && (
              <textarea 
                name={field.name} 
                value={form[field.name] || ""} 
                onChange={handleChange} 
                className="w-full p-2 rounded-lg bg-[#eaf6fb] border border-[#bde0fe] text-base" 
                rows={2} // Reduced from 3 to 2
                disabled={!editable} 
                required={field.required}
                placeholder={`Enter ${field.label.toLowerCase()}`}
              />
            )}
            
            {field.type === "select" && (
              <select 
                name={field.name} 
                value={form[field.name] || ""} 
                onChange={handleChange} 
                className="w-full p-2 rounded-lg bg-[#eaf6fb] border border-[#bde0fe] text-base" 
                disabled={!editable} 
                required={field.required}
              >
                <option value="">Select {field.label}</option>
                {(field.options || []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            )}
            
            {field.type === "radio" && (
              <div className="flex flex-wrap gap-3 mt-1"> {/* Changed from flex-col to flex-wrap, reduced mt-2 to mt-1 */}
                {(field.options || []).map((opt) => (
                  <label key={opt} className={`flex items-center gap-2 px-3 py-1.5 border rounded-lg cursor-pointer bg-white shadow-sm text-sm ${form[field.name] === opt ? "border-[#21809b] bg-[#e8f6ff]" : "border-gray-300"}`}>
                    <input 
                      type="radio" 
                      name={field.name} 
                      value={opt} 
                      checked={form[field.name] === opt} 
                      onChange={handleChange} 
                      disabled={!editable} 
                      required={field.required} 
                      className="w-3.5 h-3.5 text-[#21809b]"
                    />
                    <span className="font-medium text-gray-700">{opt}</span>
                  </label>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  // Split fields into rows (2 columns for better layout)
  const renderFieldsInGrid = () => {
    // Group fields that can be side by side
    const textFields = safeFields.filter(f => f.type !== "textarea" && f.type !== "checkbox" && f.type !== "radio");
    const otherFields = safeFields.filter(f => f.type === "textarea" || f.type === "checkbox" || f.type === "radio");
    
    return (
      <>
        {/* Two-column layout for text/email/phone/select fields */}
        {textFields.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {textFields.map(field => renderField(field))}
          </div>
        )}
        {/* Full-width for textarea, checkbox, radio */}
        {otherFields.map(field => renderField(field))}
      </>
    );
  };

  // --- Form UI with reduced padding and better layout ---
  return (
    <form onSubmit={handleSubmit}
      className="mx-auto w-full max-w-4xl bg-white rounded-xl shadow-lg border border-[#bde0fe] p-6" // Reduced padding from p-8 to p-6
    >
      <div className="flex flex-col gap-4"> {/* Reduced gap from gap-7 to gap-4 */}
        {loadingConfig && <div className="text-sm text-gray-500">Loading form...</div>}
        
        {safeFields.length === 0 && !loadingConfig && (
          <div className="text-red-500 text-center">No fields configured for this form.</div>
        )}

        {/* Already registered warning */}
        {alreadyRegistered && (
          <div className="p-2 bg-yellow-50 text-yellow-800 border border-yellow-200 rounded text-center text-sm">
            This email is already registered.
            {alreadyRegisteredInfo && (
              <div className="mt-1 text-xs text-gray-700">
                You may <a href={`/ticket-upgrade?entity=${encodeURIComponent(alreadyRegisteredInfo.collection || 'visitors')}&id=${encodeURIComponent(alreadyRegisteredInfo.id || '')}&email=${encodeURIComponent(form[emailFieldName])}`} className="text-[#21809b] underline">upgrade your ticket</a>.
              </div>
            )}
          </div>
        )}

        {/* Render fields in responsive grid */}
        {renderFieldsInGrid()}

        {/* Terms and Conditions */}
        {terms && (
          <div className="mt-2 pt-2 border-t border-gray-200">
            <label className="flex items-start gap-2">
              <input 
                type="checkbox" 
                name="termsAccepted" 
                checked={!!form.termsAccepted} 
                onChange={handleTermsChange} 
                className="mt-0.5 w-4 h-4"
              />
              <div className="text-sm">
                <span className="text-gray-700">{terms.label || "I accept the Terms & Conditions"} </span>
                {terms.url && <a href={terms.url} target="_blank" rel="noopener noreferrer" className="text-[#21809b] underline text-sm">View</a>}
                {terms.required && <div className="text-xs text-red-600 mt-0.5">You must accept the terms to continue.</div>}
              </div>
            </label>
          </div>
        )}

        {/* Submit message */}
        {submitMessage && (
          <div className={`p-2 rounded text-sm ${submitMessage.type === "error" ? "bg-red-50 border border-red-200" : submitMessage.type === "info" ? "bg-blue-50 border border-blue-200" : "bg-green-50 border border-green-200"}`}>
            <p>{submitMessage.text}</p>
          </div>
        )}

        {/* Submit button */}
        <div className="flex justify-end items-center mt-4 pt-2 border-t border-gray-200">
          <button
            type="submit"
            className="px-6 py-2 rounded-lg bg-[#21809b] text-white font-semibold text-base disabled:opacity-60 transition-colors hover:bg-[#1a6a80]"
            disabled={!canSubmit}
          >
            {submitting ? "Processing..." : "Submit"}
          </button>
        </div>
      </div>
    </form>
  );
}