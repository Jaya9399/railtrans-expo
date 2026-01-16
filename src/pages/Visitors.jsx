import React, { useCallback, useEffect, useRef, useState } from "react";
import Topbar from "../components/Topbar";
import DynamicRegistrationForm from "./DynamicRegistrationForm";
import TicketCategorySelector from "../components/TicketCategoryGenerator";
import ManualPaymentStep from "../components/ManualPayemntStep";
import ThankYouMessage from "../components/ThankYouMessage";
import ProcessingCard from "../components/ProcessingCard";

const API_BASE = (
  process.env.REACT_APP_API_BASE ||
  process.env.REACT_APP_API_BASE_URL ||
  window.__API_BASE__ ||
  ""
).replace(/\/$/, "");

const FRONTEND_BASE = (
  process.env. REACT_APP_FRONTEND_BASE ||
  process.env. FRONTEND_BASE ||
  window.__FRONTEND_BASE__ ||
  (typeof window !== "undefined" && window. location
    ? window.location.origin
    : "")
).replace(/\/$/, "");

/* ---------- small helpers ---------- */

function normalizeAdminUrl(url) {
  if (!url) return "";
  const t = String(url).trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) {
    if (
      /^http: \/\//i.test(t) &&
      typeof window !== "undefined" &&
      window.location &&
      window.location.protocol === "https:"
    ) {
      try {
        const parsed = new URL(t);
        if (
          parsed.hostname === "localhost" ||
          parsed.hostname === "127.0.0.1"
        ) {
          return (
            FRONTEND_BASE. replace(/\/$/, "") +
            parsed.pathname +
            (parsed.search || "")
          );
        }
      } catch {}
      return t. replace(/^http:/i, "https:");
    }
    return t;
  }
  if (t.startsWith("/")) return FRONTEND_BASE. replace(/\/$/, "") + t;
  return FRONTEND_BASE. replace(/\/$/, "") + "/" + t. replace(/^\//, "");
}

/* ---------- reminder helper ---------- */
async function scheduleReminderClient(entityId) {
  if (!entityId) return { ok: false, error: "missing entityId" };
  try {
    const payload = {
      entity:  "visitors",
      entityId:  String(entityId),
      scheduleDays: [7, 3, 1, 0],
    };
    const res = await fetch(`${API_BASE}/api/reminders/scheduled`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "69420",
      },
      body:  JSON.stringify(payload),
    });
    const txt = await res.text().catch(() => null);
    let js = null;
    try {
      js = txt ? JSON.parse(txt) : null;
    } catch {}
    if (! res.ok) {
      return { ok: false, status: res.status, body: js || txt };
    }
    return { ok: true, status: res.status, body: js || txt };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/* ---------- Visitors component ---------- */
export default function Visitors() {
  const [step, setStep] = useState(1);
  const [config, setConfig] = useState(null);
  const [canonicalEvent, setCanonicalEvent] = useState(null);
  const [form, setForm] = useState({ email: "" });
  const [ticketCategory, setTicketCategory] = useState("");
  const [ticketMeta, setTicketMeta] = useState({
    price: 0,
    gstAmount: 0,
    total: 0,
    label: "",
  });
  const [txId, setTxId] = useState("");
  const [proofFile, setProofFile] = useState(null);
  const [visitor, setVisitor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const submittingRef = useRef(false);

  const [reminderScheduled, setReminderScheduled] = useState(false);
  const [reminderError, setReminderError] = useState("");

  const videoRef = useRef(null);
  const [bgVideoReady, setBgVideoReady] = useState(false);
  const [bgVideoErrorMsg, setBgVideoErrorMsg] = useState("");
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const onChange = () => setIsMobile(!! mq.matches);
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

  const normalizeEvent = (raw = {}) => ({
    name: raw.name || raw.eventName || raw.title || "",
    date: raw. date || raw.dates || "",
    venue: raw.venue || raw.location || "",
    time: raw. time || raw.startTime || "",
    tagline: raw.tagline || raw.subtitle || "",
  });

  const fetchCanonicalEvent = useCallback(async () => {
    try {
      const url = `${API_BASE}/api/configs/event-details`;
      const res = await fetch(`${url}?cb=${Date.now()}`, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "ngrok-skip-browser-warning": "69420",
        },
      });
      if (res.ok) {
        const js = await res.json().catch(() => ({}));
        const val = js && js.value !== undefined ? js.value : js;
        if (val && typeof val === "object" && Object.keys(val).length) {
          setCanonicalEvent(normalizeEvent(val));
          return;
        }
      }
      const legacyUrl = `${API_BASE}/api/event-details`;
      try {
        const r2 = await fetch(`${legacyUrl}?cb=${Date.now()}`, {
          cache: "no-store",
          headers: {
            Accept: "application/json",
            "ngrok-skip-browser-warning": "69420",
          },
        });
        if (r2.ok) {
          const js2 = await r2.json().catch(() => ({}));
          setCanonicalEvent(normalizeEvent(js2 || {}));
          return;
        }
      } catch {}
      setCanonicalEvent(null);
    } catch (e) {
      console.warn("[Visitors] fetchCanonicalEvent failed", e);
      setCanonicalEvent(null);
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/visitor-config? cb=${Date.now()}`, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "ngrok-skip-browser-warning": "69420",
        },
      });
      const cfg = r.ok ? await r.json() : {};
      const normalized = { ...(cfg || {}) };
      if (normalized.backgroundMedia && normalized.backgroundMedia.url)
        normalized.backgroundMedia = {
          type: normalized.backgroundMedia.type || "image",
          url: normalizeAdminUrl(normalized.backgroundMedia.url),
        };
      else
        normalized.backgroundMedia = normalized.backgroundMedia || {
          type: "image",
          url: "",
        };
      if (Array.isArray(normalized.images))
        normalized.images = normalized. images.map((u) => normalizeAdminUrl(u));
      else normalized.images = [];
      if (normalized.termsUrl)
        normalized.termsUrl = normalizeAdminUrl(normalized. termsUrl);
      normalized.fields = Array.isArray(normalized.fields)
        ? normalized.fields.map((f) => {
            if (! f || ! f.name) return f;
            const nameLabel = (f.name + " " + (f.label || "")).toLowerCase();
            const isEmailField = f.type === "email" || /email/.test(nameLabel);
            if (isEmailField) {
              const fm = Object.assign({}, f. meta || {});
              if (fm.useOtp === undefined) fm.useOtp = true;
              return { ...f, meta: fm };
            }
            return f;
          })
        : [];
      setConfig(normalized);
    } catch (e) {
      console.error("[Visitors] Failed to load visitor config:", e);
      setConfig({
        fields: [],
        images: [],
        backgroundMedia: { type: "image", url: "" },
      });
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
    window.addEventListener("visitor-config-updated", onCfg);
    window.addEventListener("config-updated", (e) => {
      const key = e && e.detail && e.detail.key ?  e.detail.key : null;
      if (! key || key === "event-details")
        fetchCanonicalEvent().catch(() => {});
    });
    window.addEventListener("event-details-updated", fetchCanonicalEvent);

    return () => {
      window.removeEventListener("visitor-config-updated", onCfg);
      window.removeEventListener("config-updated", fetchCanonicalEvent);
      window.removeEventListener("event-details-updated", fetchCanonicalEvent);
    };
  }, [fetchConfig, fetchCanonicalEvent]);

  const startVideoManually = useCallback(async () => {
    const el = videoRef.current;
    if (!el) return;
    try {
      await el.play();
      setBgVideoReady(true);
      setBgVideoErrorMsg("");
    } catch (err) {
      console.warn("manual play failed", err);
      setBgVideoErrorMsg("Unable to play video.");
    }
  }, []);

  const saveVisitor = useCallback(
    async (nextForm) => {
      const payload = {
        name: 
          nextForm.name ||
          `${nextForm.firstName || ""} ${nextForm.lastName || ""}`.trim() ||
          "",
        email: nextForm.email || "",
        mobile: nextForm.mobile || nextForm.phone || nextForm.contact || "",
        designation: nextForm.designation || "",
        company_type: nextForm.company_type || nextForm.companyType || null,
        company:  nextForm.company || nextForm.organization || null,
        other_details: nextForm.other_details || nextForm.otherDetails || "",
        purpose: nextForm.purpose || "",
        ticket_category: ticketCategory || null,
        ticket_label: ticketMeta.label || null,
        ticket_price: ticketMeta.price || 0,
        ticket_gst: ticketMeta.gstAmount || 0,
        ticket_total: ticketMeta.total || 0,
        category: ticketCategory || null,
        slots: Array.isArray(nextForm.slots) ? nextForm.slots : [],
        ...(ticketMeta.total > 0 && txId ? { txId } : {}),
        termsAccepted: !!nextForm.termsAccepted,
      };

      try {
        const res = await fetch(`${API_BASE}/api/visitors`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "ngrok-skip-browser-warning": "69420",
          },
          body: JSON.stringify({ form: payload }),
        });

        const json = await res.json().catch(() => null);

        if (res.ok || (json && json.success)) {
          // Backend should return { success: true, id: insertedId }
          // Prioritize json.id, fallback to legacy fields for compatibility
          const id =
            (json && json.id) ||
            (json && json.insertedId) ||
            (json && json.inserted_id) ||
            null;
          const existed = ! !(json && (json.existed || json.existing));
          return {
            ok: true,
            id:  id ?  String(id) : null,
            raw:  json || null,
            existed,
          };
        }

        if (res.status === 409 && json && json.existing) {
          const id = (json.existing && json.existing.id) || null;
          return {
            ok: true,
            id: id ? String(id) : null,
            raw: json,
            existed: true,
          };
        }

        const errMsg =
          (json && (json.message || json.error)) ||
          `Save failed (${res.status})`;
        return { ok: false, error: errMsg, raw: json };
      } catch (err) {
        console.error("[Visitors] saveVisitor network error:", err);
        return { ok: false, error: String(err && (err.message || err)) };
      }
    },
    [ticketCategory, ticketMeta, txId]
  );

  const handleTicketSelect = useCallback(
    async (value, meta = {}) => {
      setError("");
      setTicketCategory(value);
      setTicketMeta(meta || { price: 0, gstAmount:  0, total: 0, label: "" });
      setStep(3);
    },
    []
  );

  async function handleFormSubmit(formData) {
    setError("");
    const nextForm = { ...formData };
    setForm(nextForm);

    setVisitor((prev) => ({
      ...(prev || {}),
      name: nextForm.name,
      email: nextForm.email,
    }));
    setStep(2);
  }

  const completeRegistrationAndEmail = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      setProcessing(true);
      if (config?. termsRequired && !form?. termsAccepted) {
        setError(
          config?. termsRequiredMessage ||
            "You must accept the terms and conditions to complete registration."
        );
        setProcessing(false);
        submittingRef.current = false;
        return;
      }
      
      const finalEmail = (form?.email || "").trim();
      if (!finalEmail) {
        setError("Email is required");
        setProcessing(false);
        submittingRef.current = false;
        return;
      }
      
      // Basic email format validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(finalEmail)) {
        setError("Please enter a valid email address");
        setProcessing(false);
        submittingRef.current = false;
        return;
      }

      const saveResult = await saveVisitor({ ...form, email: finalEmail });

      if (!saveResult.ok) {
        throw new Error(saveResult.error || "Registration failed");
      }

      setVisitor({
        ...form,
        email: finalEmail,
        ticket_category: ticketCategory,
        ticket_price: ticketMeta.price,
        ticket_gst: ticketMeta.gstAmount,
        ticket_total: ticketMeta.total,
      });

      // Schedule reminder (best-effort)
      if (saveResult.id) {
        try {
          const schedRes = await scheduleReminderClient(saveResult.id);
          if (schedRes && schedRes.ok) {
            setReminderScheduled(true);
            setReminderError("");
          } else {
            setReminderScheduled(false);
            const errMsg =
              (schedRes &&
                (schedRes.error || schedRes.body || schedRes.status)) ||
              "Schedule failed";
            setReminderError(String(errMsg).slice(0, 500));
            console.warn("[Visitors] scheduleReminderClient response:", schedRes);
          }
        } catch (e) {
          console.warn("[Visitors] schedule reminder step failed", e);
        }
      }

      setStep(4);
    } catch (err) {
      console.error("completeRegistrationAndEmail error:", err);
      setError(err?.message || "Finalization failed");
    } finally {
      setProcessing(false);
      submittingRef.current = false;
    }
  }, [
    config,
    form,
    ticketCategory,
    ticketMeta,
    saveVisitor,
  ]);

  useEffect(() => {
    if (step === 3 && Number(ticketMeta.total) === 0 && !processing) {
      completeRegistrationAndEmail();
    }
  }, [step, ticketMeta, processing, completeRegistrationAndEmail]);

  useEffect(() => {
    if (step === 4) {
      const timer = setTimeout(() => {
        window.location.href = "https://www.railtransexpo.com/";
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [step]);

  /* ---------- render ---------- */
  if (isMobile) {
    return (
      <div className="min-h-screen w-full bg-white flex items-start justify-center p-4">
        <div className="w-full max-w-md">
          <Topbar />
          {! loading && Array.isArray(config?.fields) ? (
            <>
              <div className="mt-4">
                <DynamicRegistrationForm
                  config={config}
                  form={form}
                  setForm={setForm}
                  onSubmit={handleFormSubmit}
                  editable
                  terms={{
                    url: config?.termsUrl,
                    label: config?.termsLabel,
                    required: !!config?.termsRequired,
                  }}
                  apiBase={API_BASE}
                />
              </div>
              <div className="mt-3 mb-4" aria-hidden />
            </>
          ) : (
            <div className="text-center py-8">Loading...</div>
          )}
          {! loading && step === 2 && (
            <TicketCategorySelector
              role="visitors"
              value={ticketCategory}
              onChange={(val, meta) => {
                setTicketCategory(val);
                setTicketMeta(
                  meta || { price: 0, gstAmount: 0, total: 0, label: "" }
                );
                setStep(3);
              }}
            />
          )}
          {step === 3 &&
            !/free|general|0/i.test(String(ticketCategory || "")) &&
            !processing && (
              <ManualPaymentStep
                ticketType={ticketCategory}
                ticketPrice={ticketMeta.total || 0}
                onProofUpload={() => completeRegistrationAndEmail()}
                onTxIdChange={(val) => setTxId(val)}
                txId={txId}
                proofFile={proofFile}
                setProofFile={setProofFile}
              />
            )}
          {step === 3 && processing && (
            <ProcessingCard
              title="Finalizing your registration…"
              message="Please don't close this page. We're completing your registration and sending your ticket — this may take up to a minute."
              note="If you paid in another tab, we will detect and continue automatically."
            />
          )}
          {step === 4 && (
            <div className="mt-4">
              <ThankYouMessage
                email={visitor?.email}
                messageOverride="Thank you for registering — check your email for the ticket."
              />
              {reminderScheduled && (
                <div className="text-green-700 mt-3 text-center">
                  Reminder scheduled for event date. 
                </div>
              )}
              {reminderError && (
                <div className="text-red-600 mt-3 text-center">
                  Reminder error: {reminderError}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  const bgImageUrl =
    config?.backgroundMedia?.type !== "video" && config?.backgroundMedia?.url
      ?  normalizeAdminUrl(config. backgroundMedia.url)
      : null;
  const videoUrl =
    config?.backgroundMedia?.type === "video" && config?.backgroundMedia?.url
      ? normalizeAdminUrl(config.backgroundMedia.url)
      : null;

  return (
    <div
      className="min-h-screen w-full relative"
      style={{ backgroundSize: "cover", backgroundPosition: "center" }}
    >
      {! isMobile && videoUrl && (
        <video
          key={videoUrl}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          className="fixed inset-0 w-full h-full object-cover -z-10"
        >
          <source src={videoUrl} type="video/mp4" />
        </video>
      )}
      {!isMobile && (! videoUrl || !bgVideoReady) && bgImageUrl && (
        <div
          className="fixed inset-0 -z-10"
          style={{
            backgroundImage: `url(${bgImageUrl})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
      )}
      {!isMobile && videoUrl && !bgVideoReady && bgVideoErrorMsg && (
        <div className="fixed inset-0 z-0 flex items-center justify-center pointer-events-auto">
          <button
            onClick={startVideoManually}
            className="bg-black/60 text-white px-5 py-3 rounded-lg"
          >
            Play background video
          </button>
        </div>
      )}
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
              {loading ?  (
                <div className="text-[#21809b] text-2xl font-bold">
                  Loading...
                </div>
              ) : (
                <div className="rounded-3xl overflow-hidden shadow-2xl h-[220px] sm:h-[320px] w-[340px] sm:w-[500px] bg-white/75 flex items-center justify-center">
                  {config?.images?.length ?  (
                    <img
                      src={normalizeAdminUrl(config.images[0])}
                      alt="banner"
                      className="object-cover w-full h-full"
                    />
                  ) : null}
                </div>
              )}
            </div>
            <div className="sm:w-[40%] w-full flex items-center justify-center">
              <div className="flex flex-col items-center justify-center h-full w-full mt-6">
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
                    config?.title ||
                    "Welcome"}
                </div>

                <div className="text-xl sm:text-2xl font-bold mb-1 text-center text-[#21809b]">
                  {(canonicalEvent &&
                    (canonicalEvent.date || canonicalEvent.dates)) ||
                    config?.eventDetails?. date ||
                    "Event Date"}
                </div>
                <div className="text-base sm:text-xl font-semibold text-center text-[#196e87]">
                  {(canonicalEvent && canonicalEvent.venue) ||
                    config?.eventDetails?.venue ||
                    "Event Venue"}
                </div>
                {(canonicalEvent && canonicalEvent. time) ||
                (config?.eventDetails && config.eventDetails.time) ? (
                  <div className="text-sm mt-2 text-center text-gray-700">
                    {(canonicalEvent && canonicalEvent.time) ||
                      (config?.eventDetails && config.eventDetails.time)}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="w-full flex items-center justify-center my-6 sm:my-8">
            <div className="flex-grow border-t border-[#21809b]" />
            <span className="mx-3 sm:mx-5 px-4 sm:px-8 py-2 sm:py-3 text-lg sm:text-2xl font-extrabold text-[#21809b] bg-white shadow rounded-2xl">
              Visitor Registration
            </span>
            <div className="flex-grow border-t border-[#21809b]" />
          </div>

          {!loading && step === 1 && Array.isArray(config?.fields) && (
            <div className="mx-auto w-full max-w-2xl">
              <DynamicRegistrationForm
                config={config}
                form={form}
                setForm={setForm}
                onSubmit={handleFormSubmit}
                editable
                terms={{
                  url: config?.termsUrl,
                  label: config?.termsLabel,
                  required: !!config?.termsRequired,
                }}
                apiBase={API_BASE}
              />
            </div>
          )}

          {!loading && step === 2 && (
            <TicketCategorySelector
              role="visitors"
              value={ticketCategory}
              onChange={handleTicketSelect}
            />
          )}

          {step === 3 &&
            !/free|general|0/i.test(String(ticketCategory || "")) &&
            !processing && (
              <ManualPaymentStep
                ticketType={ticketCategory}
                ticketPrice={ticketMeta.total || 0}
                onProofUpload={() => completeRegistrationAndEmail()}
                onTxIdChange={(val) => setTxId(val)}
                txId={txId}
                proofFile={proofFile}
                setProofFile={setProofFile}
              />
            )}

          {step === 3 && processing && (
            <ProcessingCard
              title="Finalizing your registration…"
              message="Please don't close this page. We're completing your registration and sending your ticket — this may take up to a minute."
              note="If you paid in another tab, we will detect and continue automatically."
            />
          )}

          {step === 4 && (
            <>
              <ThankYouMessage
                email={visitor?.email}
                messageOverride="Thank you for registering — check your email for the ticket."
              />
              <div className="mt-4 text-center">
                {reminderScheduled && (
                  <div className="text-green-700">
                    Reminder scheduled for event date.
                  </div>
                )}
                {reminderError && (
                  <div className="text-red-600">
                    Reminder error: {reminderError}
                  </div>
                )}
              </div>
            </>
          )}

          {! isMobile && bgVideoErrorMsg && (
            <div className="mt-4 p-3 bg-yellow-50 text-yellow-800 rounded text-sm max-w-3xl mx-auto">
              Background video not playing:  {String(bgVideoErrorMsg)}. Check
              console for details.
            </div>
          )}

          {error && (
            <div className="text-red-400 text-center mt-4">{error}</div>
          )}

          <div className="mt-10 sm:mt-12 pb-8">
            <footer className="text-center text-white font-semibold py-4 text-sm sm:text-lg">
              © {new Date().getFullYear()} RailTrans Expo
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}