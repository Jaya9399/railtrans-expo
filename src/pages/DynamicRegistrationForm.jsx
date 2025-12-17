import React, { useEffect, useState } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import EmailOtpVerifier from "../components/EmailOtpField";

/*
  DynamicRegistrationForm (updated)
  - Important change: If a parent passed an onSubmit callback, the form will DELEGATE
    persistence to the parent instead of POSTing to /api/visitors itself.
  - Added: full country-code selector next to phone/mobile fields. The selected country code
    is stored in form under `${fieldName}_country` and, when submitting, the payload
    will combine the code + number into the original field name (e.g. "mobile": "+91 9999999999").
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

// Simple phone-field heuristic
function isPhoneFieldName(name = "") {
  if (!name || typeof name !== "string") return false;
  return /(phone|mobile|contact)/i.test(name);
}

// Full list of country calling codes (common/official). Each entry: { code: "+XX", label: "Country (+XX)" }
// You can extend or reorder; this list is comprehensive for most use cases.
const COUNTRY_CODES = [
  { code: "+1", label: "United States/Canada (+1)" },
  { code: "+7", label: "Russia/Kazakhstan (+7)" },
  { code: "+20", label: "Egypt (+20)" },
  { code: "+27", label: "South Africa (+27)" },
  { code: "+30", label: "Greece (+30)" },
  { code: "+31", label: "Netherlands (+31)" },
  { code: "+32", label: "Belgium (+32)" },
  { code: "+33", label: "France (+33)" },
  { code: "+34", label: "Spain (+34)" },
  { code: "+36", label: "Hungary (+36)" },
  { code: "+39", label: "Italy (+39)" },
  { code: "+40", label: "Romania (+40)" },
  { code: "+41", label: "Switzerland (+41)" },
  { code: "+43", label: "Austria (+43)" },
  { code: "+44", label: "United Kingdom (+44)" },
  { code: "+45", label: "Denmark (+45)" },
  { code: "+46", label: "Sweden (+46)" },
  { code: "+47", label: "Norway (+47)" },
  { code: "+48", label: "Poland (+48)" },
  { code: "+49", label: "Germany (+49)" },
  { code: "+51", label: "Peru (+51)" },
  { code: "+52", label: "Mexico (+52)" },
  { code: "+53", label: "Cuba (+53)" },
  { code: "+54", label: "Argentina (+54)" },
  { code: "+55", label: "Brazil (+55)" },
  { code: "+56", label: "Chile (+56)" },
  { code: "+57", label: "Colombia (+57)" },
  { code: "+58", label: "Venezuela (+58)" },
  { code: "+60", label: "Malaysia (+60)" },
  { code: "+61", label: "Australia (+61)" },
  { code: "+62", label: "Indonesia (+62)" },
  { code: "+63", label: "Philippines (+63)" },
  { code: "+64", label: "New Zealand (+64)" },
  { code: "+65", label: "Singapore (+65)" },
  { code: "+66", label: "Thailand (+66)" },
  { code: "+81", label: "Japan (+81)" },
  { code: "+82", label: "South Korea (+82)" },
  { code: "+84", label: "Vietnam (+84)" },
  { code: "+86", label: "China (+86)" },
  { code: "+90", label: "Turkey (+90)" },
  { code: "+91", label: "India (+91)" },
  { code: "+92", label: "Pakistan (+92)" },
  { code: "+93", label: "Afghanistan (+93)" },
  { code: "+94", label: "Sri Lanka (+94)" },
  { code: "+95", label: "Myanmar (+95)" },
  { code: "+98", label: "Iran (+98)" },
  { code: "+211", label: "South Sudan (+211)" },
  { code: "+212", label: "Morocco (+212)" },
  { code: "+213", label: "Algeria (+213)" },
  { code: "+216", label: "Tunisia (+216)" },
  { code: "+218", label: "Libya (+218)" },
  { code: "+220", label: "Gambia (+220)" },
  { code: "+221", label: "Senegal (+221)" },
  { code: "+222", label: "Mauritania (+222)" },
  { code: "+223", label: "Mali (+223)" },
  { code: "+224", label: "Guinea (+224)" },
  { code: "+225", label: "Ivory Coast (+225)" },
  { code: "+226", label: "Burkina Faso (+226)" },
  { code: "+227", label: "Niger (+227)" },
  { code: "+228", label: "Togo (+228)" },
  { code: "+229", label: "Benin (+229)" },
  { code: "+230", label: "Mauritius (+230)" },
  { code: "+231", label: "Liberia (+231)" },
  { code: "+232", label: "Sierra Leone (+232)" },
  { code: "+233", label: "Ghana (+233)" },
  { code: "+234", label: "Nigeria (+234)" },
  { code: "+235", label: "Chad (+235)" },
  { code: "+236", label: "Central African Republic (+236)" },
  { code: "+237", label: "Cameroon (+237)" },
  { code: "+238", label: "Cape Verde (+238)" },
  { code: "+239", label: "São Tomé and Príncipe (+239)" },
  { code: "+240", label: "Equatorial Guinea (+240)" },
  { code: "+241", label: "Gabon (+241)" },
  { code: "+242", label: "Republic of the Congo (+242)" },
  { code: "+243", label: "DR Congo (+243)" },
  { code: "+244", label: "Angola (+244)" },
  { code: "+245", label: "Guinea-Bissau (+245)" },
  { code: "+246", label: "British Indian Ocean Territory (+246)" },
  { code: "+248", label: "Seychelles (+248)" },
  { code: "+249", label: "Sudan (+249)" },
  { code: "+250", label: "Rwanda (+250)" },
  { code: "+251", label: "Ethiopia (+251)" },
  { code: "+252", label: "Somalia (+252)" },
  { code: "+253", label: "Djibouti (+253)" },
  { code: "+254", label: "Kenya (+254)" },
  { code: "+255", label: "Tanzania (+255)" },
  { code: "+256", label: "Uganda (+256)" },
  { code: "+257", label: "Burundi (+257)" },
  { code: "+258", label: "Mozambique (+258)" },
  { code: "+260", label: "Zambia (+260)" },
  { code: "+261", label: "Madagascar (+261)" },
  { code: "+262", label: "Réunion (+262)" },
  { code: "+263", label: "Zimbabwe (+263)" },
  { code: "+264", label: "Namibia (+264)" },
  { code: "+265", label: "Malawi (+265)" },
  { code: "+266", label: "Lesotho (+266)" },
  { code: "+267", label: "Botswana (+267)" },
  { code: "+268", label: "Eswatini (Swaziland) (+268)" },
  { code: "+269", label: "Comoros (+269)" },
  { code: "+358", label: "Finland (+358)" },
  { code: "+351", label: "Portugal (+351)" },
  { code: "+352", label: "Luxembourg (+352)" },
  { code: "+353", label: "Ireland (+353)" },
  { code: "+354", label: "Iceland (+354)" },
  { code: "+355", label: "Albania (+355)" },
  { code: "+356", label: "Malta (+356)" },
  { code: "+357", label: "Cyprus (+357)" },
  { code: "+358", label: "Finland (+358)" },
  { code: "+359", label: "Bulgaria (+359)" },
  { code: "+370", label: "Lithuania (+370)" },
  { code: "+371", label: "Latvia (+371)" },
  { code: "+372", label: "Estonia (+372)" },
  { code: "+373", label: "Moldova (+373)" },
  { code: "+374", label: "Armenia (+374)" },
  { code: "+375", label: "Belarus (+375)" },
  { code: "+376", label: "Andorra (+376)" },
  { code: "+377", label: "Monaco (+377)" },
  { code: "+378", label: "San Marino (+378)" },
  { code: "+380", label: "Ukraine (+380)" },
  { code: "+381", label: "Serbia (+381)" },
  { code: "+382", label: "Montenegro (+382)" },
  { code: "+383", label: "Kosovo (+383)" },
  { code: "+385", label: "Croatia (+385)" },
  { code: "+386", label: "Slovenia (+386)" },
  { code: "+387", label: "Bosnia & Herzegovina (+387)" },
  { code: "+389", label: "North Macedonia (+389)" },
  { code: "+420", label: "Czech Republic (+420)" },
  { code: "+421", label: "Slovakia (+421)" },
  { code: "+423", label: "Liechtenstein (+423)" },
  { code: "+500", label: "Falkland Islands (+500)" },
  { code: "+501", label: "Belize (+501)" },
  { code: "+502", label: "Guatemala (+502)" },
  { code: "+503", label: "El Salvador (+503)" },
  { code: "+504", label: "Honduras (+504)" },
  { code: "+505", label: "Nicaragua (+505)" },
  { code: "+506", label: "Costa Rica (+506)" },
  { code: "+507", label: "Panama (+507)" },
  { code: "+508", label: "Saint Pierre & Miquelon (+508)" },
  { code: "+509", label: "Haiti (+509)" },
  { code: "+590", label: "Guadeloupe (+590)" },
  { code: "+591", label: "Bolivia (+591)" },
  { code: "+592", label: "Guyana (+592)" },
  { code: "+593", label: "Ecuador (+593)" },
  { code: "+594", label: "French Guiana (+594)" },
  { code: "+595", label: "Paraguay (+595)" },
  { code: "+596", label: "Martinique (+596)" },
  { code: "+597", label: "Suriname (+597)" },
  { code: "+598", label: "Uruguay (+598)" },
  { code: "+599", label: "Caribbean Netherlands (+599)" },
  { code: "+670", label: "East Timor (+670)" },
  { code: "+672", label: "Australian External Territories (+672)" },
  { code: "+673", label: "Brunei (+673)" },
  { code: "+674", label: "Nauru (+674)" },
  { code: "+675", label: "Papua New Guinea (+675)" },
  { code: "+676", label: "Tonga (+676)" },
  { code: "+677", label: "Solomon Islands (+677)" },
  { code: "+678", label: "Vanuatu (+678)" },
  { code: "+679", label: "Fiji (+679)" },
  { code: "+680", label: "Palau (+680)" },
  { code: "+681", label: "Wallis & Futuna (+681)" },
  { code: "+682", label: "Cook Islands (+682)" },
  { code: "+683", label: "Niue (+683)" },
  { code: "+685", label: "Samoa (+685)" },
  { code: "+686", label: "Kiribati (+686)" },
  { code: "+687", label: "New Caledonia (+687)" },
  { code: "+688", label: "Tuvalu (+688)" },
  { code: "+689", label: "French Polynesia (+689)" },
  { code: "+690", label: "Tokelau (+690)" },
  { code: "+691", label: "Micronesia (+691)" },
  { code: "+692", label: "Marshall Islands (+692)" },
  { code: "+850", label: "Hong Kong (+852)" },
  { code: "+853", label: "Macau (+853)" },
  { code: "+886", label: "Taiwan (+886)" },
  { code: "+960", label: "Maldives (+960)" },
  { code: "+961", label: "Lebanon (+961)" },
  { code: "+962", label: "Jordan (+962)" },
  { code: "+963", label: "Syria (+963)" },
  { code: "+964", label: "Iraq (+964)" },
  { code: "+965", label: "Kuwait (+965)" },
  { code: "+966", label: "Saudi Arabia (+966)" },
  { code: "+967", label: "Yemen (+967)" },
  { code: "+968", label: "Oman (+968)" },
  { code: "+970", label: "Palestine (+970)" },
  { code: "+971", label: "UAE (+971)" },
  { code: "+972", label: "Israel (+972)" },
  { code: "+973", label: "Bahrain (+973)" },
  { code: "+974", label: "Qatar (+974)" },
  { code: "+975", label: "Bhutan (+975)" },
  { code: "+976", label: "Mongolia (+976)" },
  { code: "+977", label: "Nepal (+977)" },
  { code: "+998", label: "Uzbekistan (+998)" }
];

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

  function handleCountryChange(fieldName, countryCode) {
    const countryKey = `${fieldName}_country`;
    setForm((f) => ({ ...f, [countryKey]: countryCode }));
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
   *
   * Before sending, combine any phone country + number into the main field name:
   * e.g., if there is "mobile" and "mobile_country", payload.mobile becomes "+91 99999..." and mobile_country removed.
   */
  async function doFinalSubmit(payload) {
    // Combine phone country codes into their number fields (non-destructive)
    try {
      const combined = { ...payload };
      for (const key of Object.keys(payload || {})) {
        if (isPhoneFieldName(key)) {
          const countryKey = `${key}_country`;
          const country = (payload[countryKey] || "").toString().trim();
          const num = (payload[key] || "").toString().trim();
          if (num && country) {
            combined[key] = `${country} ${num}`;
            delete combined[countryKey];
          } else if (num && !country) {
            combined[key] = num;
          }
        }
      }

      // If parent wants to handle submission, delegate and return its result.
      if (onSubmit && typeof onSubmit === "function") {
        try {
          const maybe = onSubmit(combined);
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
        const body = { ...combined };
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
        console.error("doFinalSubmit network error:", err);
        setSubmitMessage({ type: "error", text: "Network/server error while submitting." });
        return { ok: false, error: err };
      }
    } catch (err) {
      console.error("doFinalSubmit combine error:", err);
      setSubmitMessage({ type: "error", text: "Submission failed (processing phone number)." });
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
                  <>
                    {field.type === "number" && isPhoneFieldName(field.name) ? (
                      // Render phone number with country code select
                      <div className="flex items-center gap-2 mt-2">
                        <select
                          name={`${field.name}_country`}
                          value={form[`${field.name}_country`] || (COUNTRY_CODES[0] && COUNTRY_CODES[0].code) || ""}
                          onChange={(e) => handleCountryChange(field.name, e.target.value)}
                          className="p-3 rounded-lg bg-[#eaf6fb] border border-[#bde0fe] text-lg"
                          disabled={!editable}
                        >
                          {COUNTRY_CODES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                        </select>
                        <input
                          type="tel"
                          name={field.name}
                          value={form[field.name] || ""}
                          onChange={handleChange}
                          className="flex-1 mt-2 p-4 rounded-lg bg-[#eaf6fb] border border-[#bde0fe] text-lg"
                          disabled={!editable}
                          required={field.required}
                          placeholder="Enter number without country code"
                        />
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