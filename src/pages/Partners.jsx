import React, { useEffect, useState, useRef, useCallback } from "react";
import Topbar from "../components/Topbar";
import DynamicRegistrationForm from "./DynamicRegistrationForm";
import ThankYouMessage from "../components/ThankYouMessage";

/*
 Partners.jsx
 
 Flow:  Registration Form → Thank You
 Backend automatically sends ACK email after POST /api/partners
*/

function getApiBaseFromEnvOrWindow() {
  if (
    typeof process !== "undefined" &&
    process.env &&
    process.env.REACT_APP_API_BASE
  )
    return process.env. REACT_APP_API_BASE. replace(/\/$/, "");
  if (
    typeof process !== "undefined" &&
    process.env &&
    process.env.REACT_APP_API_BASE_URL
  )
    return process.env.REACT_APP_API_BASE_URL.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.__API_BASE__)
    return String(window.__API_BASE__).replace(/\/$/, "");
  if (
    typeof window !== "undefined" &&
    window.__CONFIG__ &&
    window.__CONFIG__. backendUrl
  )
    return String(window.__CONFIG__.backendUrl).replace(/\/$/, "");
  if (
    typeof window !== "undefined" &&
    window. location &&
    window.location. origin
  )
    return window.location.origin.replace(/\/$/, "");
  return "/api";
}
const API_BASE = getApiBaseFromEnvOrWindow();

function apiUrl(path) {
  if (! path) return API_BASE;
  if (/^https?:\/\//i.test(path)) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE. replace(/\/$/, "")}${p}`;
}

function normalizeAdminUrl(url) {
  if (!url) return "";
  const t = String(url).trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  if (t.startsWith("//"))
    return (
      (typeof window !== "undefined" ?  window.location.protocol : "https:") + t
    );
  if (t.startsWith("/")) return apiUrl(t);
  return apiUrl(`/${t}`);
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function pickFirstString(obj, candidates = []) {
  if (!obj || typeof obj !== "object") return "";
  for (const cand of candidates) {
    if (Object.prototype.hasOwnProperty. call(obj, cand)) {
      const v = obj[cand];
      if (typeof v === "string" && v. trim()) return v.trim();
      if ((typeof v === "number" || typeof v === "boolean") && String(v).trim())
        return String(v).trim();
    }
    for (const k of Object.keys(obj)) {
      if (k. toLowerCase() === String(cand).toLowerCase()) {
        const v = obj[k];
        if (typeof v === "string" && v.trim()) return v.trim();
        if (
          (typeof v === "number" || typeof v === "boolean") &&
          String(v).trim()
        )
          return String(v).trim();
      }
    }
  }
  for (const v of Object.values(obj)) {
    if (! v) continue;
    if (typeof v === "string" && v.trim()) return v.trim();
    if (v && typeof v === "object") {
      if (typeof v.mobile === "string" && v.mobile.trim())
        return v.mobile.trim();
      if (typeof v.phone === "string" && v.phone.trim()) return v.phone.trim();
      if (typeof v.email === "string" && v.email. trim()) return v.email.trim();
      if (typeof v. name === "string" && v.name.trim()) return v.name.trim();
      if (typeof v.company === "string" && v.company.trim())
        return v.company.trim();
    }
  }
  return "";
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning":  "69420",
    },
    body: JSON.stringify(body),
  });
  let text = null;
  let json = null;
  try {
    text = await res. text();
  } catch {}
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { ok: res.ok, status: res.status, body: json || text || null };
}

async function savePartnerApi(payload) {
  const res = await fetch(apiUrl("/api/partners"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "69420",
    },
    body: JSON.stringify(payload),
  });
  const txt = await res.text().catch(() => null);
  let json = null;
  try {
    json = txt ? JSON. parse(txt) : null;
  } catch {
    json = { raw: txt };
  }
  if (!res.ok) {
    const errMsg =
      (json && (json.message || json.error)) || `Save failed (${res.status})`;
    throw new Error(errMsg);
  }
  return json;
}

const DEFAULT_PARTNER_FIELDS = [
  {
    name: "company",
    label: "Company / Organisation",
    type: "text",
    required: true,
    visible: true,
  },
  {
    name:  "name",
    label: "Contact person",
    type: "text",
    required: true,
    visible: true,
  },
  {
    name: "mobile",
    label: "Mobile No.",
    type: "text",
    required: true,
    visible: true,
    meta: { useOtp: false },
  },
  {
    name: "email",
    label: "Email",
    type: "email",
    required: false,
    visible: true,
  },
  {
    name:  "designation",
    label: "Designation",
    type: "text",
    required: false,
    visible: true,
  },
  {
    name: "businessType",
    label: "Business Type",
    type: "text",
    required: false,
    visible: true,
  },
  {
    name: "partnership",
    label: "Partnership Interested In",
    type: "text",
    required: false,
    visible: true,
  },
];

function ImageSlider({ images = [], intervalMs = 4000 }) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (! images || images.length === 0) return;
    const t = setInterval(
      () => setActive((p) => (p + 1) % images.length),
      intervalMs
    );
    return () => clearInterval(t);
  }, [images, intervalMs]);
  if (! images || images.length === 0) return null;
  return (
    <div className="flex flex-col items-center justify-center w-full h-full">
      <div className="rounded-3xl overflow-hidden shadow-2xl border-4 border-[#19a6e7] h-[220px] sm:h-[320px] w-[340px] sm:w-[500px] max-w-full bg-white/75 flex items-center justify-center mt-6 sm:mt-10">
        <img
          src={images[active]}
          alt={`Slide ${active + 1}`}
          className="object-cover w-full h-full"
          loading="lazy"
        />
      </div>
    </div>
  );
}

export default function Partners() {
  const [config, setConfig] = useState(null);
  const [canonicalEvent, setCanonicalEvent] = useState(null);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");

  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const onChange = () => setIsMobile(!! mq.matches);
    onChange();
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, []);

  const fetchCanonicalEvent = useCallback(async () => {
    try {
      const url = apiUrl("/api/configs/event-details");
      const r = await fetch(`${url}?cb=${Date.now()}`, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "ngrok-skip-browser-warning": "69420",
        },
      });
      if (r.ok) {
        const js = await r.json().catch(() => ({}));
        const val = js && js.value !== undefined ? js.value : js;
        if (val && typeof val === "object" && Object.keys(val).length) {
          setCanonicalEvent({
            name: val.name || "",
            date: val.date || val.dates || "",
            venue: val.venue || "",
            time: val.time || "",
            tagline: val.tagline || "",
          });
          return;
        }
      }
      const r2 = await fetch(apiUrl("/api/event-details? cb=" + Date.now()), {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "ngrok-skip-browser-warning": "69420",
        },
      }).catch(() => null);
      if (r2 && r2.ok) {
        const js2 = await r2.json().catch(() => ({}));
        setCanonicalEvent({
          name: js2.name || "",
          date: js2.date || js2.dates || "",
          venue: js2.venue || "",
          time: js2.time || "",
          tagline: js2.tagline || "",
        });
        return;
      }
      setCanonicalEvent(null);
    } catch (e) {
      console.warn("[Partners] fetchCanonicalEvent failed", e);
      setCanonicalEvent(null);
    }
  }, []);

  async function fetchConfig() {
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/partner-config? cb=" + Date.now()), {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "ngrok-skip-browser-warning": "69420",
        },
      });
      const cfg = res.ok ? await res.json().catch(() => ({})) : {};
      const normalized = { ...(cfg || {}) };

      normalized.fields = Array.isArray(normalized.fields)
        ? normalized.fields
        : [];
      try {
        const existing = new Set(
          (normalized.fields || []).map((f) => (f && f.name ?  f.name : ""))
        );
        DEFAULT_PARTNER_FIELDS.forEach((def) => {
          if (! existing.has(def.name)) normalized.fields.push(clone(def));
        });
      } catch (e) {}

      if (normalized.backgroundMedia && normalized.backgroundMedia.url) {
        normalized.backgroundMedia = {
          type: normalized.backgroundMedia.type || "image",
          url: normalizeAdminUrl(normalized.backgroundMedia.url),
        };
      } else {
        const candidate =
          normalized.backgroundVideo ||
          normalized.backgroundImage ||
          normalized.background_image ||
          "";
        if (candidate) {
          const isVideo =
            typeof candidate === "string" &&
            /\.(mp4|webm|ogg)(\?|$)/i.test(candidate);
          normalized.backgroundMedia = {
            type: isVideo ? "video" :  "image",
            url: normalizeAdminUrl(candidate),
          };
        } else {
          normalized.backgroundMedia = { type: "image", url: "" };
        }
      }

      normalized.termsUrl = normalized.termsUrl
        ? normalizeAdminUrl(normalized.termsUrl)
        : normalized.terms || "";
      normalized.termsText = normalized.termsText || "";
      normalized.termsLabel = normalized.termsLabel || "Terms & Conditions";
      normalized.termsRequired = !!normalized.termsRequired;

      normalized.images = Array.isArray(normalized. images)
        ? normalized.images. map(normalizeAdminUrl)
        : [];
      normalized.eventDetails =
        typeof normalized.eventDetails === "object" && normalized.eventDetails
          ? normalized. eventDetails
          : {};

      normalized.fields = normalized.fields. map((f) => {
        if (! f || !f.name) return f;
        const nameLabel = (f.name + " " + (f.label || "")).toLowerCase();
        const isEmailField = f.type === "email" || /email/. test(nameLabel);
        if (isEmailField) {
          const fm = Object.assign({}, f. meta || {});
          if (fm.useOtp === undefined) fm.useOtp = true;
          return { ...f, meta: fm };
        }
        return f;
      });

      setConfig(normalized);
    } catch (e) {
      console.error("[Partners] fetchConfig error:", e);
      setConfig({
        fields: DEFAULT_PARTNER_FIELDS. slice(),
        images: [],
        backgroundMedia: { type: "image", url: "" },
        eventDetails: {},
      });
      setError("Failed to load configuration.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchConfig();
    fetchCanonicalEvent();
    const onCfg = () => {
      fetchConfig();
      fetchCanonicalEvent();
    };
    const onConfigUpdated = (e) => {
      const key = e && e.detail && e.detail.key ?  e.detail.key : null;
      if (! key || key === "event-details")
        fetchCanonicalEvent().catch(() => {});
    };
    window.addEventListener("partner-config-updated", onCfg);
    window.addEventListener("config-updated", onConfigUpdated);
    window.addEventListener("event-details-updated", fetchCanonicalEvent);
    return () => {
      window.removeEventListener("partner-config-updated", onCfg);
      window.removeEventListener("config-updated", onConfigUpdated);
      window.removeEventListener("event-details-updated", fetchCanonicalEvent);
    };
  }, [fetchCanonicalEvent]);

  // Step 1: Submit form and save to backend (which automatically sends ACK email)
  async function handleFormSubmit(formData) {
    setError("");
    setSaving(true);
    try {
      const email =
        pickFirstString(formData, ["email", "emailAddress", "contactEmail"]) ||
        "";
      if (!email) {
        setError("Email is required to proceed.");
        setSaving(false);
        return;
      }

      setForm(formData || {});

      // Log step attempt
      try {
        await postJSON(apiUrl("/api/partners/step"), {
          step: "registration_attempt",
          data: { form: formData },
        });
      } catch {}

      // Save partner (backend will send ACK email automatically)
      const payload = {
        ...formData,
        termsAccepted: !!formData.termsAccepted,
        _rawForm: formData,
      };

      const json = await savePartnerApi(payload);
      
      // Log completion
      try {
        await postJSON(apiUrl("/api/partners/step"), {
          step: "registration_completed",
          data: { id: json?. insertedId || null, payload },
        });
      } catch {}

      // Go directly to thank you page (backend sends ACK email in background)
      setStep(2);
    } catch (e) {
      console.error("[Partners] handleFormSubmit error:", e);
      setError(e.message || "Failed to submit registration.  Please try again.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (step === 2) {
      const timer = setTimeout(() => {
        window.location.href = "https://www.railtransexpo.com/";
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [step]);

  return (
    <div className="min-h-screen w-full relative">
      {! isMobile &&
      config?. backgroundMedia?.type === "video" &&
      config?.backgroundMedia?.url ? (
        <video
          src={config.backgroundMedia.url}
          autoPlay
          muted
          loop
          playsInline
          className="fixed inset-0 w-full h-full object-cover"
          onError={(e) => console.error("Video error", e)}
        />
      ) : config?.backgroundMedia?.type === "image" &&
        config?.backgroundMedia?.url ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: -999,
            backgroundImage: `url(${config.backgroundMedia.url})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
      ) : null}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(255,255,255,0.55)",
          zIndex: -900,
        }}
      />

      <div className="relative z-10">
        <Topbar />
        <div className="max-w-7xl mx-auto pt-8">
          <div
            className="flex flex-col sm:flex-row items-stretch mb-10"
            style={{ minHeight: 370 }}
          >
            <div className="sm:w-[60%] w-full flex items-center justify-center">
              {loading ?  (
                <span className="text-[#21809b] text-2xl font-bold">
                  Loading images...
                </span>
              ) : config?.images && config.images.length ?  (
                <ImageSlider images={config.images} />
              ) : (
                <div className="text-[#21809b]"> </div>
              )}
            </div>

            <div className="sm:w-[40%] w-full flex items-center justify-center">
              {loading ? (
                <span className="text-[#21809b] text-xl font-semibold">
                  Loading event details...
                </span>
              ) : (
                <div className="w-full px-4">
                  <div
                    className="font-extrabold text-3xl sm:text-5xl mb-3 text-center"
                    style={{
                      background: 
                        "linear-gradient(90deg,#ffba08 0%,#19a6e7 60%,#21809b 100%)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                    }}
                  >
                    {(canonicalEvent && canonicalEvent.name) ||
                      config?.eventDetails?.name ||
                      "Event Name"}
                  </div>

                  <div className="text-xl sm:text-2xl font-bold mb-1 text-center text-[#21809b]">
                    {(canonicalEvent &&
                      (canonicalEvent.date || canonicalEvent.dates)) ||
                      config?.eventDetails?.date ||
                      "Event Date"}
                  </div>

                  <div className="text-base sm:text-xl font-semibold text-center text-[#196e87]">
                    {(canonicalEvent && canonicalEvent.venue) ||
                      config?.eventDetails?.venue ||
                      "Event Venue"}
                  </div>

                  {(canonicalEvent && canonicalEvent. tagline) ||
                  config?. eventDetails?.tagline ?  (
                    <div className="text-sm mt-2 text-center text-gray-700">
                      {(canonicalEvent && canonicalEvent. tagline) ||
                        config?.eventDetails?.tagline}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          <div className="w-full flex items-center justify-center my-8">
            <div className="flex-grow border-t border-[#21809b]" />
            <span className="mx-5 px-8 py-3 text-2xl font-extrabold text-[#21809b] bg-white shadow rounded-2xl">
              Partner Registration
            </span>
            <div className="flex-grow border-t border-[#21809b]" />
          </div>

          {! loading && step === 1 && config?.fields && (
            <div className="mx-auto w-full max-w-2xl">
              <DynamicRegistrationForm
                config={{ ... config, fields: config.fields }}
                form={form}
                setForm={setForm}
                onSubmit={handleFormSubmit}
                editable={true}
                saving={saving}
                terms={
                  config && (config.termsUrl || config.termsText)
                    ? {
                        url: config.termsUrl,
                        text: config.termsText,
                        label: config.termsLabel || "Terms & Conditions",
                        required: !!config.termsRequired,
                      }
                    : null
                }
              />
            </div>
          )}

          {step === 2 && (
            <div className="my-6">
              <ThankYouMessage 
                email={form.email || ""} 
                messageOverride="Thank you for registering as a partner.  We have received your details and our team will review your request.  You will receive a confirmation email shortly."
              />
            </div>
          )}

          {error && (
            <div className="text-red-600 font-semibold mb-2 text-center">
              {error}
            </div>
          )}

          <footer className="mt-16 text-center text-[#21809b] font-semibold py-6 text-lg">
            © {new Date().getFullYear()}{" "}
            {(canonicalEvent && canonicalEvent. name) ||
              config?.eventDetails?.name ||
              "RailTrans Expo"}
          </footer>
        </div>
      </div>
    </div>
  );
}