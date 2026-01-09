import React, { useEffect, useRef, useState, useCallback } from "react";
import Topbar from "../components/Topbar";
import DynamicRegistrationForm from "./DynamicRegistrationForm";
import ThankYouMessage from "../components/ThankYouMessage";

/*
  Cleaned Awardees.jsx — FREE awardees flow

  Key points:
  - No payment / ticket-selection UI or state.
  - Form submits directly to /api/awardees, then shows Thank You.
  - Preserves background media, canonical event, admin controls (stats + reminders).
  - All fetches include ngrok bypass header where applicable.
*/

function getApiBaseFromEnvOrWindow() {
  if (
    typeof process !== "undefined" &&
    process.env &&
    process.env.REACT_APP_API_BASE
  )
    return process.env.REACT_APP_API_BASE.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.__API_BASE__)
    return String(window.__API_BASE__).replace(/\/$/, "");
  if (
    typeof window !== "undefined" &&
    window.__CONFIG__ &&
    window.__CONFIG__.backendUrl
  )
    return String(window.__CONFIG__.backendUrl).replace(/\/$/, "");
  if (
    typeof window !== "undefined" &&
    window.location &&
    window.location.origin
  )
    return window.location.origin.replace(/\/$/, "");
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

function isEmailLike(v) {
  return typeof v === "string" && /\S+@\S+\.\S+/.test(v);
}

/* Robust field finder used to extract company etc. */
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
async function saveAwardeeApi(payload) {
  const res = await fetch(apiUrl("/api/awardees"), {
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

/* REMINDERS: POST /api/reminders/send (ngrok header) */
async function scheduleReminder(entityId, eventDate) {
  try {
    if (!entityId || !eventDate) return;
    const payload = { entity: "awardees", entityId, eventDate };
    const res = await fetch(apiUrl("/api/reminders/send"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "69420",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.warn("[Awardees] reminder scheduling failed:", res.status, txt);
    }
  } catch (e) {
    console.warn("[Awardees] scheduleReminder error:", e);
  }
}

/* UI helper */
function EventDetailsBlock({ event }) {
  if (!event)
    return <div className="text-[#21809b]">No event details available</div>;
  const logoGradient =
    "linear-gradient(90deg, #ffba08 0%, #19a6e7 60%, #21809b 100%)";
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
      <div className="text-xl sm:text-2xl font-bold mb-1 text-center text-[#21809b]">
        {event?.date || "Event Date"}
      </div>
      <div className="text-base sm:text-xl font-semibold text-center text-[#196e87]">
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

/* ---------- Component ---------- */
export default function Awardees() {
  const [config, setConfig] = useState(null);
  const [canonicalEvent, setCanonicalEvent] = useState(null);
  const [form, setForm] = useState({});
  const [step, setStep] = useState(1); // 1=form, 2=thankyou
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [stats, setStats] = useState(null);
  const [sendingReminders, setSendingReminders] = useState(false);
  const [awardeeId, setAwardeeId] = useState(null);
  const [awardeeTicketCode, setAwardeeTicketCode] = useState(null);

  const videoRef = useRef(null);
  const [isMobile, setIsMobile] = useState(false);

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

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/awardee-config?cb=" + Date.now()), {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "ngrok-skip-browser-warning": "69420",
        },
      });
      const cfg = res.ok ? await res.json() : {};
      const normalized = { ...(cfg || {}) };

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

      normalized.termsUrl = normalized.termsUrl
        ? normalizeAdminUrl(normalized.termsUrl)
        : normalized.terms || "";
      normalized.termsText = normalized.termsText || "";
      normalized.termsLabel = normalized.termsLabel || "Terms & Conditions";
      normalized.fields = Array.isArray(normalized.fields)
        ? normalized.fields
        : [];
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
      console.error("fetchConfig error", e);
      setConfig({
        fields: [],
        images: [],
        backgroundMedia: { type: "image", url: "" },
        eventDetails: {},
      });
    } finally {
      setLoading(false);
    }
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
      const r2 = await fetch(apiUrl("/api/event-details?cb=" + Date.now()), {
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
      console.warn("[Awardees] fetchCanonicalEvent failed", e);
      setCanonicalEvent(null);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
    fetchCanonicalEvent();
    const onCfg = () => {
      fetchConfig();
      fetchCanonicalEvent();
    };
    const onCfgUpdated = (e) => {
      const key = e && e.detail && e.detail.key ? e.detail.key : null;
      if (!key || key === "event-details")
        fetchCanonicalEvent().catch(() => {});
    };
    window.addEventListener("awardee-config-updated", onCfg);
    window.addEventListener("config-updated", onCfgUpdated);
    window.addEventListener("event-details-updated", fetchCanonicalEvent);
    return () => {
      window.removeEventListener("awardee-config-updated", onCfg);
      window.removeEventListener("config-updated", onCfgUpdated);
      window.removeEventListener("event-details-updated", fetchCanonicalEvent);
    };
  }, [fetchConfig, fetchCanonicalEvent]);

  // background video play best-effort
  useEffect(() => {
    if (isMobile) return;
    const v = videoRef.current;
    if (
      !v ||
      !config?.backgroundMedia?.url ||
      config.backgroundMedia.type !== "video"
    )
      return;
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

  // Redirect to home after Thank You step (short delay)
  useEffect(() => {
    if (step === 2) {
      const timer = setTimeout(() => {
        // keep short redirect; remove or increase if you want users to stay
        window.location.href = "https://www.railtransexpo.com/";
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [step]);

  // Form submit: validate and create awardee (FREE flow)
  async function handleFormSubmit(payload) {
    setError("");
    if (!isEmailLike(payload.email)) {
      setError("Please enter a valid email.");
      return;
    }
    setSubmitting(true);
    try {
      setForm(payload || {});
      // build server payload; minimal fields only
      const serverPayload = {
        name: payload.name || payload.fullName || "Awardee",
        email: payload.email || "",
        mobile: payload.mobile || "",
        designation: payload.designation || null,
        organization:
          findFieldValue(payload, ["company", "organization"]) || "",
        awardType: payload.awardType || null,
        awardOther: payload.awardOther || null,
        bio: payload.bio || null,
        ticket_category: "awardee",
        txId: null,
        _rawForm: payload,
      };

      const res = await saveAwardeeApi(serverPayload);
      setAwardeeId(res.insertedId || null);
      setAwardeeTicketCode(res.ticket_code || (res.saved && res.saved.ticket_code) || null);

      // optionally schedule reminder if canonical event has date
      const eventDate = canonicalEvent && canonicalEvent.date ? canonicalEvent.date : null;
      if (eventDate && res.insertedId) {
        scheduleReminder(res.insertedId, eventDate).catch(() => {});
      }

      // Show Thank You
      setStep(2);
    } catch (e) {
      console.error("handleFormSubmit error", e);
      setError(e && e.message ? e.message : "Failed to submit registration.");
    } finally {
      setSubmitting(false);
    }
  }

  async function fetchStats() {
    try {
      const res = await fetch(apiUrl("/api/awardees/stats"), {
        headers: { "ngrok-skip-browser-warning": "69420" },
      });
      if (!res.ok) return;
      const js = await res.json();
      setStats(js);
    } catch (e) {
      console.warn("fetchStats failed", e);
    }
  }

  async function sendReminders() {
    setSendingReminders(true);
    setError("");

    try {
      const res = await fetch(apiUrl("/api/awardees/send-reminders"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "69420",
        },
      });

      if (!res.ok) {
        setError("Failed to send reminders.");
        return;
      }

      const js = await res.json();
      console.log("Reminder result:", js);
    } catch (e) {
      setError("Reminder sending failed.");
    } finally {
      setSendingReminders(false);
    }
  }

  return (
    <div className="min-h-screen w-full relative">
      {!isMobile &&
        config?.backgroundMedia?.type === "video" &&
        config?.backgroundMedia?.url && (
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
      {!config?.backgroundColor &&
        config?.backgroundMedia?.type === "image" &&
        config?.backgroundMedia?.url && (
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
        )}
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
        <div className="max-w-7xl mx-auto pt-8 px-4">
          <div
            className="flex flex-col sm:flex-row items-stretch mb-10"
            style={{ minHeight: 370 }}
          >
            <div className="sm:w-[60%] w-full flex items-center justify-center">
              {loading ? (
                <span className="text-[#21809b] text-2xl font-bold">
                  Loading images...
                </span>
              ) : (
                <div className="rounded-3xl overflow-hidden shadow-2xl border-4 border-[#19a6e7] h-[220px] sm:h-[320px] w-[340px] sm:w-[500px] max-w-full bg-white/75 flex items-center justify-center p-4">
                  <img
                    src={
                      config?.images?.[0] || "/images/speaker_placeholder.jpg"
                    }
                    alt="hero"
                    className="object-cover w-full h-full"
                    style={{ maxHeight: 220 }}
                  />
                </div>
              )}
            </div>

            <div className="sm:w-[40%] w-full flex items-center justify-center">
              {loading ? (
                <span className="text-[#21809b] text-xl font-semibold">
                  Loading event details...
                </span>
              ) : (
                <div className="w-full px-4">
                  <EventDetailsBlock
                    event={canonicalEvent || config?.eventDetails || null}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="mb-6">
            <div className="flex items-center">
              <div className="flex-grow border-t border-[#21809b]" />
              <span className="mx-5 px-8 py-3 text-2xl font-extrabold text-[#21809b] bg-white rounded-2xl">
                Register as Awardee
              </span>
              <div className="flex-grow border-t border-[#21809b]" />
            </div>
          </div>

          {step === 1 && !loading && Array.isArray(config?.fields) && (
            <div className="max-w-3xl mx-auto">
              <DynamicRegistrationForm
                config={{
                  ...config,
                  fields: (config.fields || []).filter((f) => {
                    const name = (f.name || "")
                      .toString()
                      .toLowerCase()
                      .replace(/\s+/g, "");
                    const label = (f.label || "").toString().toLowerCase();
                    if (
                      name === "accept_terms" ||
                      name === "acceptterms" ||
                      name === "i_agree" ||
                      name === "agree"
                    )
                      return false;
                    if (
                      f.type === "checkbox" &&
                      (label.includes("i agree") ||
                        label.includes("accept the terms") ||
                        label.includes("terms & conditions") ||
                        label.includes("terms and conditions"))
                    )
                      return false;
                    return true;
                  }),
                }}
                form={form}
                setForm={setForm}
                onSubmit={handleFormSubmit}
                editable={true}
                submitting={submitting}
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
            <div className="max-w-3xl mx-auto">
              <ThankYouMessage
                email={form.email}
                ticketCode={awardeeTicketCode}
                // You can extend ThankYouMessage to show ticket / download link.
              />
            </div>
          )}

          {new URLSearchParams(window.location.search).get("admin") === "1" && (
            <div className="max-w-3xl mx-auto mt-8 bg-white p-4 rounded shadow">
              <h3 className="font-semibold text-[#196e87] mb-3">
                Admin Controls
              </h3>
              <div className="flex gap-3 mb-3">
                <button
                  onClick={fetchStats}
                  className="px-3 py-1 bg-[#196e87] text-white rounded"
                >
                  Load Stats
                </button>
                <button
                  onClick={sendReminders}
                  disabled={sendingReminders}
                  className="px-3 py-1 bg-orange-500 text-white rounded"
                >
                  {sendingReminders ? "Sending…" : "Send Reminders"}
                </button>
              </div>
              {stats && (
                <div className="text-sm text-gray-700">
                  <div>Total Registrants: {stats.total || 0}</div>
                  <div>
                    Paid: {stats.paid || 0} — Free: {stats.free || 0}
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="text-red-600 font-semibold mt-4 text-center">
              {error}
            </div>
          )}

          <footer className="mt-12 text-center text-[#21809b] font-semibold py-6">
            © {new Date().getFullYear()}{" "}
            {config?.eventDetails?.name || "RailTrans Expo"} | All rights
            reserved.
          </footer>
        </div>
      </div>
    </div>
  );
}