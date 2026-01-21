import React, { useEffect, useRef, useState } from "react";
import Topbar from "../components/Topbar";
import DynamicRegistrationForm from "./DynamicRegistrationForm";
import ThankYouMessage from "../components/ThankYouMessage";

/*
  Exhibitors.jsx
  - Simplified for free registrations only: 
    * No payment
    * No ticket / badge / PDF
    * Only one simple "Thank you for registering, we'll get back to you soon" email
  - NOW WITH MOBILE VIEW SUPPORT
*/

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
function getApiBaseFromEnvOrWindow() {
  if (
    typeof process !== "undefined" &&
    process.env &&
    process.env.REACT_APP_API_BASE
  ) {
    return process.env.REACT_APP_API_BASE.replace(/\/$/, "");
  }
  if (typeof window !== "undefined" && window.__API_BASE__) {
    return String(window.__API_BASE__).replace(/\/$/, "");
  }
  if (
    typeof window !== "undefined" &&
    window.__CONFIG__ &&
    window.__CONFIG__.backendUrl
  ) {
    return String(window.__CONFIG__.backendUrl).replace(/\/$/, "");
  }
  if (
    typeof window !== "undefined" &&
    window.location &&
    window.location.origin
  ) {
    return window.location.origin.replace(/\/$/, "");
  }
  return "/api";
}
function apiUrl(path) {
  const base = getApiBaseFromEnvOrWindow();
  if (!path) return base;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}
function normalizeAdminUrl(url) {
  if (!url) return "";
  const trimmed = String(url).trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return window.location.protocol + trimmed;
  if (trimmed.startsWith("/")) return apiUrl(trimmed);
  return apiUrl(trimmed);
}

/* Small UI helpers */
function ImageSlider({ images = [] }) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!images || images.length === 0) return;
    const t = setInterval(
      () => setActive((p) => (p + 1) % images.length),
      3500
    );
    return () => clearInterval(t);
  }, [images]);
  if (!images || images.length === 0) return null;
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
function SectionTitle() {
  return (
    <div className="w-full flex items-center justify-center my-8">
      <div className="flex-grow border-t border-[#21809b]" />
      <span className="mx-5 px-8 py-3 text-2xl font-extrabold text-[#21809b] bg-white shadow rounded-2xl">
        Exhibitor Registration
      </span>
      <div className="flex-grow border-t border-[#21809b]" />
    </div>
  );
}
function EventDetailsBlock({ event }) {
  if (!event)
    return <div className="text-[#21809b]">No event details available</div>;
  const logoGradient =
    "linear-gradient(90deg, #ffba08 0%, #19a6e7 60%, #21809b 100%)";
  const logoBlue = "#21809b";
  const logoDark = "#196e87";
  return (
    <div className="flex flex-col items-center justify-center h-full w-full mt-6">
      <div
        className="font-extrabold text-3xl sm:text-5xl mb-3 text-center"
        style={{
          background: logoGradient,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}
      >
        {event?.name || "Event Name"}
      </div>
      <div
        className="text-xl sm:text-2xl font-bold mb-1 text-center"
        style={{ color: logoBlue }}
      >
        {event?.date || event?.dates || "Event Date"}
      </div>
      <div
        className="text-base sm: text-xl font-semibold text-center"
        style={{ color: logoDark }}
      >
        {event?.venue || "Event Venue"}
      </div>
      {event?.tagline && (
        <div className="text-base sm:text-xl font-semibold text-center text-[#21809b] mt-2">
          {event.tagline}
        </div>
      )}
    </div>
  );
}

/* Utility helpers */
function findFieldValue(obj = {}, candidates = []) {
  if (!obj || typeof obj !== "object") return "";
  const keys = Object.keys(obj);
  const normCandidates = candidates.map((s) =>
    String(s)
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase()
  );
  for (const k of keys) {
    const kn = String(k)
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase();
    if (normCandidates.includes(kn)) {
      const v = obj[k];
      if (v !== undefined && v !== null && String(v).trim() !== "")
        return String(v).trim();
    }
  }
  for (const k of keys) {
    const kn = String(k)
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase();
    for (const cand of normCandidates) {
      if (kn.includes(cand) || cand.includes(kn)) {
        const v = obj[k];
        if (v !== undefined && v !== null && String(v).trim() !== "")
          return String(v).trim();
      }
    }
  }
  for (const k of keys) {
    const kn = String(k)
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase();
    if (
      kn.includes("company") ||
      kn.includes("organization") ||
      kn.includes("org")
    ) {
      const v = obj[k];
      if (v !== undefined && v !== null && String(v).trim() !== "")
        return String(v).trim();
    }
  }
  return "";
}

/* API helpers */
async function saveExhibitorApi(payload) {
  const res = await fetch(apiUrl("/api/exhibitors"), {
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
    json = txt ? JSON.parse(txt) : null;
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

/* REMINDER helper */
async function scheduleReminder(entityId, eventDate) {
  try {
    if (!entityId || !eventDate) return;
    const payload = { entity: "exhibitors", entityId, eventDate };
    const res = await fetch(apiUrl("/api/reminders/scheduled"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        entity: "exhibitors",
        entityId,
        scheduleDays: [0], // send immediately
      }),
    });
  } catch (e) {
    console.warn("[Exhibitors] scheduleReminder error:", e);
  }
}

async function saveStep(stepName, data = {}, meta = {}) {
  try {
    await fetch(apiUrl("/api/exhibitors/step"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "69420",
      },
      body: JSON.stringify({ step: stepName, data, meta }),
    });
  } catch (e) {
    console.warn("[Exhibitors] saveStep failed:", e);
  }
}

/* ---------- DEFAULTS for Exhibitors fields ---------- */
const DEFAULT_EXHIBITOR_FIELDS = [
  { name: "name", label: "Name", type: "text", required: true, visible: true },
  {
    name: "email",
    label: "Email",
    type: "email",
    required: true,
    visible: true,
  },
  {
    name: "mobile",
    label: "Mobile No.",
    type: "text",
    required: true,
    visible: true,
    meta: { useOtp: true },
  },
  {
    name: "designation",
    label: "Designation",
    type: "text",
    required: false,
    visible: true,
  },
  {
    name: "company",
    label: "Company / Organization",
    type: "text",
    required: false,
    visible: true,
  },
  {
    name: "stall_size",
    label: "Stall / Booth Size",
    type: "select",
    options: ["3x3", "3x6", "6x6", "Custom"],
    required: false,
    visible: true,
  },
  {
    name: "product_category",
    label: "Product / Service Category",
    type: "text",
    required: false,
    visible: true,
  },
];
/* ---------- end defaults ---------- */

/* ---------- Component ---------- */
export default function Exhibitors() {
  const [config, setConfig] = useState(null);
  const [canonicalEvent, setCanonicalEvent] = useState(null);
  const [form, setForm] = useState({});
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  const apiBase = getApiBaseFromEnvOrWindow();
  const videoRef = useRef(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
  
    const tryPlay = async () => {
      try {
        await v.play();
      } catch {
        // Autoplay blocked – ignore silently
      }
    };
  
    tryPlay();
  }, [config?.backgroundMedia?.url]);
  
  // Mobile detection
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const onChange = () => setIsMobile(!!mq.matches);
    onChange();
    mq.addEventListener
      ? mq.addEventListener("change", onChange)
      : mq.addListener(onChange);
    return () => {
      mq.removeEventListener
        ? mq.removeEventListener("change", onChange)
        : mq.removeListener(onChange);
    };
  }, []);

  async function fetchConfig() {
    setLoading(true);
    try {
      const url = apiUrl("/api/exhibitor-config? cb=" + Date.now());
      const r = await fetch(url, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "ngrok-skip-browser-warning": "69420",
        },
      });
      const raw = r.ok ? await r.json().catch(() => ({})) : {};
      const cfg = raw && raw.config ? raw.config : raw;

      const normalized = { ...(cfg || {}) };

      normalized.fields = Array.isArray(normalized.fields)
        ? normalized.fields
        : [];

      try {
        const existing = new Set(
          normalized.fields.map((f) => (f && f.name ? f.name : ""))
        );
        DEFAULT_EXHIBITOR_FIELDS.forEach((def) => {
          if (!existing.has(def.name)) normalized.fields.push(clone(def));
        });
      } catch (e) { }

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
            type: isVideo ? "video" : "image",
            url: normalizeAdminUrl(candidate),
          };
        } else {
          normalized.backgroundMedia = { type: "image", url: "" };
        }
      }

      if (normalized.termsUrl)
        normalized.termsUrl = normalizeAdminUrl(normalized.termsUrl);
      normalized.images = Array.isArray(normalized.images)
        ? normalized.images.map(normalizeAdminUrl)
        : [];
      normalized.eventDetails =
        typeof normalized.eventDetails === "object" && normalized.eventDetails
          ? normalized.eventDetails
          : {};

      normalized.fields = normalized.fields.map((f) => {
        if (!f || !f.name) return f;
        const nameLabel = (f.name + " " + (f.label || "")).toLowerCase();
        const isEmailField = f.type === "email" || /email/.test(nameLabel);
        if (isEmailField) {
          const fm = Object.assign({}, f.meta || {});
          if (fm.useOtp === undefined) fm.useOtp = true;
          return { ...f, meta: fm };
        }
        return f;
      });

      setConfig(normalized);
    } catch (e) {
      console.error("[Exhibitors] fetchConfig error:", e);
      setConfig({
        fields: DEFAULT_EXHIBITOR_FIELDS.slice(),
        images: [],
        backgroundMedia: { type: "image", url: "" },
        eventDetails: {},
      });
      setError("Failed to load configuration.");
    } finally {
      setLoading(false);
    }
  }

  const fetchCanonicalEvent = async () => {
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
      console.warn("[Exhibitors] fetchCanonicalEvent failed", e);
      setCanonicalEvent(null);
    }
  };

  useEffect(() => {
    fetchConfig();
    fetchCanonicalEvent();
    const onCfg = () => {
      fetchConfig();
      fetchCanonicalEvent();
    };
    const onConfigUpdated = (e) => {
      const key = e && e.detail && e.detail.key ? e.detail.key : null;
      if (!key || key === "event-details")
        fetchCanonicalEvent().catch(() => { });
    };
    window.addEventListener("exhibitor-config-updated", onCfg);
    window.addEventListener("config-updated", onConfigUpdated);
    window.addEventListener("event-details-updated", fetchCanonicalEvent);
    return () => {
      window.removeEventListener("exhibitor-config-updated", onCfg);
      window.removeEventListener("config-updated", onConfigUpdated);
      window.removeEventListener("event-details-updated", fetchCanonicalEvent);
    };
  }, []);

  async function handleFormSubmit(formData) {
    setError("");
    setForm(formData || {});
    await saveStep("registration_attempt", { form: formData }).catch(() => { });
    await finalizeSave();
  }

  async function finalizeSave() {
    setError("");
    const companyCandidates = [
      "companyName",
      "company",
      "company_name",
      "company name",
      "organization",
      "organizationName",
      "organization_name",
      "companyTitle",
      "companytitle",
    ];
    let companyValue = findFieldValue(form || {}, companyCandidates);
    if (!companyValue && form && typeof form._rawForm === "object")
      companyValue = findFieldValue(form._rawForm, companyCandidates);
    companyValue = companyValue || "";

    const payload = {
      name: form.name || form.fullName || "",
      email: form.email || "",
      mobile: form.mobile || form.phone || "",
      designation: form.designation || "",
      company: companyValue,
      companyName: companyValue,
      other_details: form.other_details || form.otherDetails || "",
      purpose: form.purpose || "",
      slots: Array.isArray(form.slots) ? form.slots : [],
      termsAccepted: !!form.termsAccepted,
      _rawForm: form,
    };

    try {
      const json = await saveExhibitorApi(payload);
      if (json?.insertedId) {
        scheduleReminder(json.insertedId, config?.eventDetails?.date).catch(
          () => { }
        );
      }

      await saveStep(
        "registration",
        { form },
        { insertedId: json?.insertedId || null }
      ).catch(() => { });
      setStep(4);
    } catch (err) {
      console.error("[Exhibitors] finalize save error:", err);
      setError(err.message || "Failed to save registration");
    }
  }

  useEffect(() => {
    if (step === 4) {
      const timer = setTimeout(() => {
        try {
          // Use replace instead of href (cleaner navigation, no history entry)
          window.location.replace("https://www.railtransexpo.com/");
        } catch (e) {
          // Fallback if replace fails
          console.warn("Redirect failed, using fallback:", e);
          window.location.href = "https://www.railtransexpo.com/";
        }
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [step]);

  /* ---------- MOBILE RENDER ---------- */
  if (isMobile) {
    return (
      <div className="min-h-screen w-full bg-white flex items-start justify-center p-4">
        <div className="w-full max-w-md">
          <Topbar />

          {!loading && step === 1 && Array.isArray(config?.fields) ? (
            <>
              <div className="mt-4">
                <h2 className="text-xl font-bold text-[#21809b] mb-4 text-center">
                  Exhibitor Registration
                </h2>
                <DynamicRegistrationForm
                  config={config}
                  form={form}
                  setForm={setForm}
                  onSubmit={handleFormSubmit}
                  editable
                  apiBase={apiBase}
                  registrationType="exhibitor"
                  terms={{
                    url: config?.termsUrl,
                    label: config?.termsLabel || "Terms & Conditions",
                    required: !!config?.termsRequired,
                  }}
                />
              </div>
              <div className="mt-3 mb-4" aria-hidden />
            </>
          ) : loading ? (
            <div className="text-center py-8">Loading...</div>
          ) : null}

          {step === 4 && (
            <div className="mt-4">
              <ThankYouMessage
                email={form.email || ""}
                messageOverride="Thank you for registering as an exhibitor. We have received your details and our team will contact you shortly."
              />
            </div>
          )}

          {error && (
            <div className="text-red-600 mt-3 text-center text-sm">
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ---------- DESKTOP RENDER ---------- */
  return (
    <div className="min-h-screen w-full relative">
      {config?.backgroundMedia?.type === "video" &&
        config?.backgroundMedia?.url ? (
          <video
          ref={videoRef}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          className="fixed inset-0 w-full h-full object-cover"
        >
        
          <source src={config.backgroundMedia.url} type="video/mp4" />
          Your browser does not support the video tag.
        </video>
      ) : config?.backgroundMedia?.type === "image" &&
        config?.backgroundMedia?.url ? (
        <div
          className="fixed inset-0 -z-10"
          style={{
            backgroundImage: `url(${config.backgroundMedia.url})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
      ) : null}


      <div
        className="absolute inset-0 bg-white/50 pointer-events-none"
        style={{ zIndex: -900 }}
      />

      <div className="relative z-10">
        <Topbar />
        <div className="max-w-7xl mx-auto pt-8">
          <div
            className="flex flex-col sm:flex-row items-stretch mb-10"
            style={{ minHeight: 370 }}
          >
            <div className="sm:w-[60%] w-full flex items-center justify-center">
              {loading ? (
                <div className="text-[#21809b] text-2xl font-bold">
                  Loading...
                </div>
              ) : (
                <ImageSlider images={config?.images || []} />
              )}
            </div>
            <div className="sm:w-[40%] w-full flex items-center justify-center">
              {loading ? (
                <div className="text-[#21809b] text-xl font-semibold">
                  Loading event details...
                </div>
              ) : (
                <EventDetailsBlock
                  event={canonicalEvent || config?.eventDetails || null}
                />
              )}
            </div>
          </div>

          <SectionTitle />

          {!loading && step === 1 && (
            <div className="mx-auto w-full max-w-2xl">
              <DynamicRegistrationForm
                config={config}
                form={form}
                setForm={setForm}
                onSubmit={handleFormSubmit}
                editable
                apiBase={apiBase}
                terms={{
                  url: config?.termsUrl,
                  label: config?.termsLabel || "Terms & Conditions",
                  required: !!config?.termsRequired,
                }}
              />
            </div>
          )}

          {step === 4 && (
            <div className="my-6">
              <ThankYouMessage email={form.email || ""} />
            </div>
          )}

          {error && (
            <div className="text-red-600 font-semibold mb-2 text-center">
              {error}
            </div>
          )}

          <footer className="mt-16 text-center text-[#21809b] font-semibold py-6 text-lg">
            © {new Date().getFullYear()}{" "}
            {(canonicalEvent && canonicalEvent.name) ||
              config?.eventDetails?.name ||
              "RailTrans Expo"}
          </footer>
        </div>
      </div>
    </div>
  );
}