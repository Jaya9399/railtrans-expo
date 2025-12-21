import React, { useEffect, useRef, useState, useCallback } from "react";
import Topbar from "../components/Topbar";
import DynamicRegistrationForm from "./DynamicRegistrationForm";
import ThankYouMessage from "../components/ThankYouMessage";
/*
  Speakers.jsx - updated reminder integration and thank-you email signature
  - Replaced calls to non-existent /api/reminders/send and /api/reminders/create
    with a single call to /api/reminders/scheduled (server route provided).
  - sendThankYouEmail now signs as "Railtrans Expo Team".
  - Frontend flow:
      - POST /api/speakers to save
      - POST /api/mailer to send a simple thank-you email (frontend triggers mailer)
      - POST /api/reminders/scheduled to let server schedule/send reminders (best-effort)
  - All requests include the "ngrok-skip-browser-warning" header used elsewhere.
*/

function getApiBaseFromEnvOrWindow() {
  if (typeof process !== "undefined" && process.env && process.env.REACT_APP_API_BASE)
    return process.env.REACT_APP_API_BASE.replace(/\/$/, "");
  if (typeof process !== "undefined" && process.env && process.env.REACT_APP_API_BASE_URL)
    return process.env.REACT_APP_API_BASE_URL.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.__API_BASE__) return String(window.__API_BASE__).replace(/\/$/, "");
  if (typeof window !== "undefined" && window.__FRONTEND_BASE__) return String(window.__FRONTEND_BASE__).replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location && window.location.origin) return window.location.origin.replace(/\/$/, "");
  return "";
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
  if (trimmed.startsWith("//")) return (typeof window !== "undefined" && window.location ? window.location.protocol : "https:") + trimmed;
  if (trimmed.startsWith("/")) return apiUrl(trimmed);
  return apiUrl(trimmed);
}

function isEmailLike(v) {
  return typeof v === "string" && /\S+@\S+\.\S+/.test(v);
}

/* send a simple thank-you email (frontend triggers mailer).
   Uses Railtrans Expo Team signature per request.
*/
async function sendThankYouEmail(exhibitor, config = {}, canonicalEvent = null) {
  const to = exhibitor && exhibitor.email;
  if (!to) return { ok: false, error: "no-recipient" };

  const eventName =
    (config && config.eventDetails && (config.eventDetails.name || config.eventDetails.eventName)) ||
    (canonicalEvent && (canonicalEvent.name || canonicalEvent.eventName)) ||
    "the event";

  const subject = `Thank you for registering for ${eventName}`;
  const text = `Thank you for registering for ${eventName}.\nWe have received your details and our team will get back to you soon.\n\nRegards,\nRailtrans Expo Team`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <h2>Thank you for registering</h2>
      <p>Thank you for registering for <strong>${eventName}</strong>.</p>
      <p>We have received your details successfully. Our team will review your submission and get back to you soon.</p>
      <p>Regards,<br/>Railtrans Expo Team</p>
    </div>
  `;

  try {
    const res = await fetch(apiUrl("/api/mailer"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
      body: JSON.stringify({ to, subject, text, html }),
    });
    const txt = await res.text().catch(() => "");
    let js = null;
    try { js = txt ? JSON.parse(txt) : null; } catch {}
    return { ok: res.ok, status: res.status, body: js || txt };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/* Use server's /api/reminders/scheduled route to schedule/send reminders.
   We call it with a query that attempts to limit to the single saved record.
   The server code you provided expects: { entity, scheduleDays?, query? }.
*/
async function scheduleReminder(entityId, eventDate) {
  if (!entityId || !eventDate) return { ok: false, error: "missing" };

  const entity = "speakers";
  const candidateQueries = [
    `?id=${encodeURIComponent(String(entityId))}&limit=1`,
    `?_id=${encodeURIComponent(String(entityId))}&limit=1`,
    `?where=_id=${encodeURIComponent(String(entityId))}&limit=1`,
    `?where=id=${encodeURIComponent(String(entityId))}&limit=1`,
  ];

  const scheduledUrl = apiUrl("/api/reminders/scheduled");
  const apiBase = (typeof process !== "undefined" && process.env && (process.env.API_BASE || process.env.BACKEND_URL)) || window.__API_BASE__ || "/api";

  const errors = [];
  for (const q of candidateQueries) {
    const payload = { entity, scheduleDays: [7, 3, 1, 0], query: q };
    try {
      const res = await fetch(scheduledUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
        body: JSON.stringify(payload),
      });
      const txt = await res.text().catch(() => "");
      let js = null;
      try { js = txt ? JSON.parse(txt) : null; } catch {}

      if (res.ok) {
        // success
        return { ok: true, status: res.status, body: js || txt, usedQuery: q };
      }

      // Not OK — gather diagnostic data. Try to fetch the listUrl the server tried to access
      const listUrl = `${apiBase.replace(/\/$/, "")}/api/${entity}${q}`;
      let listRespText = null;
      let listRespStatus = null;
      try {
        const lr = await fetch(listUrl, { headers: { Accept: "application/json", "ngrok-skip-browser-warning": "69420" } });
        listRespStatus = lr.status;
        listRespText = await lr.text().catch(() => "");
      } catch (listErr) {
        listRespText = `list fetch error: ${String(listErr && (listErr.message || listErr))}`;
      }

      errors.push({
        query: q,
        scheduledStatus: res.status,
        scheduledBody: js || txt,
        attemptedListUrl: listUrl,
        attemptedListStatus: listRespStatus,
        attemptedListBody: listRespText,
      });

      // try next query shape
    } catch (err) {
      errors.push({ query: q, error: String(err && (err.message || err)) });
    }
  }

  // none succeeded
  return { ok: false, error: "all queries failed", details: errors };
}

/* UI helpers */
function EventDetailsBlock({ event }) {
  if (!event) return <div className="text-[#21809b]">No event details available</div>;
  const logoGradient = "linear-gradient(90deg, #ffba08 0%, #19a6e7 60%, #21809b 100%)";
  const logoBlue = "#21809b";
  const logoDark = "#196e87";
  return (
    <div className="flex flex-col items-center justify-center h-full w-full mt-6">
      <div className="font-extrabold text-3xl sm:text-5xl mb-3 text-center" style={{ background: logoGradient, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
        {event?.name || "Event Name"}
      </div>
      <div className="text-xl sm:text-2xl font-bold mb-1 text-center" style={{ color: logoBlue }}>{event?.date || "Event Date"}</div>
      <div className="text-base sm:text-xl font-semibold text-center" style={{ color: logoDark }}>{event?.venue || "Event Venue"}</div>
      {event?.tagline && <div className="text-base sm:text-xl font-semibold text-center text-[#21809b] mt-2">{event.tagline}</div>}
    </div>
  );
}


function ImageSlider({ images = [], intervalMs = 3500 }) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!images || images.length === 0) return;
    const t = setInterval(() => setActive((p) => (p + 1) % images.length), intervalMs);
    return () => clearInterval(t);
  }, [images, intervalMs]);
  if (!images || images.length === 0) return null;
  return (
    <div className="flex flex-col items-center justify-center w-full h-full">
      <div className="rounded-3xl overflow-hidden shadow-2xl border-4 border-[#19a6e7] h-[220px] sm:h-[320px] w-[340px] sm:w-[500px] max-w-full bg-white/75 flex items-center justify-center mt-6 sm:mt-10">
        <img src={images[active]} alt={`Slide ${active + 1}`} className="object-cover w-full h-full" loading="lazy" />
      </div>
    </div>
  );
}

/* ---------- Component ---------- */
export default function Speakers() {
  const [config, setConfig] = useState(null);
  const [canonicalEvent, setCanonicalEvent] = useState(null);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [speakerId, setSpeakerId] = useState(null);
  const [speaker, setSpeaker] = useState(null);
  const [submissionComplete, setSubmissionComplete] = useState(false);

  const videoRef = useRef(null);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (submissionComplete) {
      const timer = setTimeout(() => {
        window.location.href = "https://www.railtransexpo.com/";
      }, 3000); // 3 seconds delay to show thank-you message

      return () => clearTimeout(timer); // cleanup
    }
  }, [submissionComplete]);
  const fetchCanonicalEvent = useCallback(async () => {
    try {
      const url = apiUrl("/api/configs/event-details");
      const res = await fetch(`${url}?cb=${Date.now()}`, { cache: "no-store", headers: { Accept: "application/json", "ngrok-skip-browser-warning": "69420" } });
      if (res.ok) {
        const js = await res.json().catch(() => ({}));
        const val = js && js.value !== undefined ? js.value : js;
        if (val && typeof val === "object" && Object.keys(val).length) {
          setCanonicalEvent({ name: val.name || "", date: val.date || "", venue: val.venue || "", time: val.time || "", tagline: val.tagline || "" });
          return;
        }
      }
      const legacy = await fetch(`${apiUrl("/api/event-details")}?cb=${Date.now()}`, { cache: "no-store", headers: { Accept: "application/json", "ngrok-skip-browser-warning": "69420" } }).catch(() => null);
      if (legacy && legacy.ok) {
        const ljs = await legacy.json().catch(() => ({}));
        setCanonicalEvent({ name: ljs.name || "", date: ljs.date || "", venue: ljs.venue || "", time: ljs.time || "", tagline: ljs.tagline || "" });
        return;
      }
      setCanonicalEvent(null);
    } catch (e) {
      console.warn("fetchCanonicalEvent failed", e);
      setCanonicalEvent(null);
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/speaker-config?cb=" + Date.now()), { cache: "no-store", headers: { Accept: "application/json", "ngrok-skip-browser-warning": "69420" } });
      const cfg = res.ok ? await res.json().catch(() => ({})) : {};
      const normalized = { ...(cfg || {}) };

      if (normalized.backgroundMedia && normalized.backgroundMedia.url) {
        normalized.backgroundMedia = { type: normalized.backgroundMedia.type || "image", url: normalizeAdminUrl(normalized.backgroundMedia.url) };
      } else {
        const candidate = normalized.backgroundVideo || normalized.backgroundImage || normalized.background_image || "";
        if (candidate) {
          const isVideo = typeof candidate === "string" && /\.(mp4|webm|ogg)(\?|$)/i.test(candidate);
          normalized.backgroundMedia = { type: isVideo ? "video" : "image", url: normalizeAdminUrl(candidate) };
        } else {
          normalized.backgroundMedia = { type: "image", url: "" };
        }
      }

      normalized.termsUrl = normalized.termsUrl ? normalizeAdminUrl(normalized.termsUrl) : (normalized.terms || "");
      normalized.termsText = normalized.termsText || "";
      normalized.termsLabel = normalized.termsLabel || "Terms & Conditions";
      normalized.termsRequired = !!normalized.termsRequired;
      normalized.fields = Array.isArray(normalized.fields) ? normalized.fields : [];

      // remove auto-accept fields
      normalized.fields = normalized.fields.filter((f) => {
        if (!f || typeof f !== "object") return false;
        const name = (f.name || "").toString().toLowerCase().replace(/\s+/g, "");
        const label = (f.label || "").toString().toLowerCase();
        if (["accept_terms", "acceptterms", "i_agree", "agree"].includes(name)) return false;
        if (f.type === "checkbox" && (label.includes("i agree") || label.includes("accept the terms") || label.includes("terms & conditions") || label.includes("terms and conditions"))) return false;
        return true;
      });

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

      normalized.images = Array.isArray(normalized.images) ? normalized.images.map(normalizeAdminUrl) : [];
      normalized.eventDetails = typeof normalized.eventDetails === "object" && normalized.eventDetails ? normalized.eventDetails : {};

      setConfig(normalized);
    } catch (e) {
      console.error("fetchConfig error", e);
      setConfig({ fields: [], images: [], backgroundMedia: { type: "image", url: "" }, eventDetails: {} });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
    fetchCanonicalEvent();

    const onCfg = () => {
      fetchConfig();
      fetchCanonicalEvent();
    };
    const onConfigUpdated = (e) => {
      const key = e && e.detail && e.detail.key ? e.detail.key : null;
      if (!key || key === "event-details") fetchCanonicalEvent().catch(() => {});
    };

    window.addEventListener("speaker-config-updated", onCfg);
    window.addEventListener("visitor-config-updated", onCfg);
    window.addEventListener("config-updated", onConfigUpdated);
    window.addEventListener("event-details-updated", fetchCanonicalEvent);

    return () => {
      window.removeEventListener("speaker-config-updated", onCfg);
      window.removeEventListener("visitor-config-updated", onCfg);
      window.removeEventListener("config-updated", onConfigUpdated);
      window.removeEventListener("event-details-updated", fetchCanonicalEvent);
    };
  }, [fetchConfig, fetchCanonicalEvent]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const onChange = () => setIsMobile(!!mq.matches);
    onChange();
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, []);

  // background video autoplay best-effort
  useEffect(() => {
    if (isMobile) return;
    const v = videoRef.current;
    if (!v || !config?.backgroundMedia?.url || config.backgroundMedia.type !== "video") return;
    let mounted = true;
    let attemptId = 0;
    const prevSrc = { src: v.src || "" };
    async function tryPlay() {
      const myId = ++attemptId;
      try {
        const currentSrc = v.currentSrc || v.src || "";
        if (prevSrc.src !== currentSrc) {
          try {
            v.load();
          } catch {}
          prevSrc.src = currentSrc;
        }
        await new Promise((resolve, reject) => {
          if (!mounted) return reject(new Error("unmounted"));
          if (v.readyState >= 3) return resolve();
          const onCan = () => {
            cleanup();
            resolve();
          };
          const onErr = () => {
            cleanup();
            reject(new Error("media error"));
          };
          const timer = setTimeout(() => {
            cleanup();
            resolve();
          }, 3000);
          function cleanup() {
            clearTimeout(timer);
            v.removeEventListener("canplay", onCan);
            v.removeEventListener("error", onErr);
          }
          v.addEventListener("canplay", onCan);
          v.addEventListener("error", onErr);
        });
        if (!mounted || myId !== attemptId) return;
        await v.play();
      } catch (err) {}
    }
    const onCan = () => tryPlay();
    const onErr = () => {};
    v.addEventListener("canplay", onCan);
    v.addEventListener("error", onErr);
    tryPlay();
    return () => {
      mounted = false;
      attemptId++;
      try {
        v.removeEventListener("canplay", onCan);
        v.removeEventListener("error", onErr);
      } catch {}
    };
  }, [config?.backgroundMedia?.url, isMobile]);

  /* Handle form submit: validate and save immediately. Backend sends confirmation email. */
  async function handleFormSubmit(payload) {
    setError("");
    if (!isEmailLike(payload.email)) {
      setError("Please enter a valid email.");
      return;
    }
    setSubmitting(true);
    try {
      setForm(payload || {});
      await finalizeRegistrationAndSend(payload);
    } catch (e) {
      setError("Failed to submit. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  /* Finalize: save speaker, send simple thank-you email, schedule reminder */
  async function finalizeRegistrationAndSend(submittedForm) {
    if (processing) return;
    setProcessing(true);
    setError("");

    try {
      const formData = submittedForm || form || {};
      const name = formData.name || `${formData.firstName || ""} ${formData.lastName || ""}`.trim() || "Speaker";

      const payload = {
        ...formData,
        name,
        termsAccepted: !!formData.termsAccepted,
        _rawForm: formData,
      };

      // Save to backend
      const res = await fetch(apiUrl("/api/speakers"), {
        method: "POST",
        headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
        body: JSON.stringify(payload),
      });
      const js = await res.json().catch(() => ({}));
      if (!res.ok || !(js && (js.success || js.insertedId || js.id))) {
        const em = (js && (js.error || js.message)) || `Save failed (${res.status})`;
        setError(em);
        setProcessing(false);
        return;
      }
      const insertedId = js.insertedId || js.insertId || js.id || null;
      if (insertedId) setSpeakerId(insertedId);

      const savedSpeaker = { ...payload, id: insertedId };
      setSpeaker(savedSpeaker);

      // Send simple thank-you email (include event name)
      try {
        await sendThankYouEmail(savedSpeaker, config, canonicalEvent);
      } catch (e) {
        console.warn("Thank-you email failed", e);
      }

      // Schedule reminder using server's /api/reminders/scheduled
      try {
        const evDate =
          (config && config.eventDetails && (config.eventDetails.date || config.eventDetails.dates)) ||
          (canonicalEvent && (canonicalEvent.date || canonicalEvent.dates)) ||
          (formData && (formData.eventDates || formData.date)) || null;
        if (insertedId && evDate) {
          const sch = await scheduleReminder(insertedId, evDate);
          if (!sch || !sch.ok) {
            console.warn("Reminder scheduling issue", sch);
          }
        }
      } catch (e) {
        console.warn("scheduleReminder error", e);
      }

      // Mark submission complete and clear form
      setSubmissionComplete(true);
      setForm({});
    } catch (err) {
      console.error("finalizeRegistrationAndSend error", err);
      setError("Failed to finalize registration.");
    } finally {
      setProcessing(false);
    }
  }

  /* Render */
  return (
    <div className="min-h-screen w-full relative">
      {!isMobile && config?.backgroundMedia?.type === "video" && config?.backgroundMedia?.url && (
        <video
          ref={videoRef}
          src={config.backgroundMedia.url}
          autoPlay
          muted
          loop
          playsInline
          className="fixed inset-0 w-full h-full object-cover"
          onError={(e) => console.error("Video error", e)}
        />
      )}
      {(!config?.backgroundColor) && config?.backgroundMedia?.type === "image" && config?.backgroundMedia?.url && (
        <div style={{ position: "fixed", inset: 0, zIndex: -999, backgroundImage: `url(${config.backgroundMedia.url})`, backgroundSize: "cover", backgroundPosition: "center" }} />
      )}
      <div style={{ position: "fixed", inset: 0, background: "rgba(255,255,255,0.55)", zIndex: -900 }} />

      <div className="relative z-10">
        <Topbar />
        <div className="max-w-7xl mx-auto pt-8 px-4">
          <div className="flex flex-col sm:flex-row items-stretch mb-10" style={{ minHeight: 370 }}>
            <div className="sm:w-[60%] w-full flex items-center justify-center">
              {loading ? (
                <span className="text-[#21809b] text-2xl font-bold">Loading images...</span>
              ) : config?.images && config.images.length ? (
                <ImageSlider images={config.images} intervalMs={4000} />
              ) : (
                <div className="rounded-3xl overflow-hidden shadow-2xl border-4 border-[#19a6e7] h-[220px] sm:h-[320px] w-[340px] sm:w-[500px] max-w-full bg-white/75 flex flex-col items-center justify-center mt-6 sm:mt-10 p-4">
                  <img src={config?.images?.[0] || "/images/speaker_placeholder.jpg"} alt="hero" className="object-cover w-full h-full" style={{ maxHeight: 220 }} />
                </div>
              )}
            </div>

            <div className="sm:w-[40%] w-full flex items-center justify-center">
              {loading ? (
                <span className="text-[#21809b] text-xl font-semibold">Loading event details...</span>
              ) : (
                <div className="w-full px-4">
                  <EventDetailsBlock event={canonicalEvent || config?.eventDetails || null} />
                </div>
              )}
            </div>
          </div>

          <div className="mb-6">
            <div className="flex items-center">
              <div className="flex-grow border-t border-[#21809b]" />
              <span className="mx-5 px-8 py-3 text-2xl font-extrabold text-[#21809b] bg-white rounded-2xl">Register as Speaker</span>
              <div className="flex-grow border-t border-[#21809b]" />
            </div>
          </div>

          {/* Registration Form */}
          {!submissionComplete && !loading && Array.isArray(config?.fields) && (
            <div className="max-w-3xl mx-auto">
              <DynamicRegistrationForm
                config={{ ...config, fields: config.fields || [] }}
                form={form}
                setForm={setForm}
                onSubmit={handleFormSubmit}
                editable={true}
                submitting={submitting || processing}
                terms={(config && (config.termsUrl || config.termsText)) ? { url: config.termsUrl, text: config.termsText, label: config.termsLabel || "Terms & Conditions", required: !!config.termsRequired } : null}
              />
            </div>
          )}

          {/* Thank you message component shown after submission */}
          {submissionComplete && (
            <div className="max-w-3xl mx-auto">
              <ThankYouMessage email={speaker?.email || form.email} />
            </div>
          )}

          {!isMobile && config?.backgroundMedia?.type === "video" && !loading && <div className="mt-4 p-3 text-sm text-gray-600">Background video active</div>}
          {error && <div className="text-red-400 text-center mt-4">{error}</div>}

          <footer className="mt-12 text-center text-[#21809b] font-semibold py-6">© {new Date().getFullYear()} { (canonicalEvent && canonicalEvent.name) || config?.eventDetails?.name || "RailTrans Expo" } | All rights reserved.</footer>
        </div>
      </div>
    </div>
  );
}