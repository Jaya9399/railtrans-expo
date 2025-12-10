import React, { useCallback, useEffect, useRef, useState } from "react";
import Topbar from "../components/Topbar";
import DynamicRegistrationForm from "./DynamicRegistrationForm";
import TicketCategorySelector from "../components/TicketCategoryGenerator";
import ManualPaymentStep from "../components/ManualPayemntStep";
import ThankYouMessage from "../components/ThankYouMessage";
import { buildTicketEmail } from "../utils/emailTemplate";
import ProcessingCard from "../components/ProcessingCard";

const API_BASE = (
  process.env.REACT_APP_API_BASE ||
  process.env.REACT_APP_API_BASE_URL ||
  window.__API_BASE__ ||
  ""
).replace(/\/$/, "");

/* ---------- small helpers ---------- */
const isEmailLike = (v) => typeof v === "string" && /\S+@\S+\.\S+/.test(v);

function findEmailDeep(obj, seen = new Set()) {
  if (!obj || typeof obj !== "object") return "";
  if (seen.has(obj)) return "";
  seen.add(obj);
  for (const [, v] of Object.entries(obj)) {
    if (typeof v === "string" && isEmailLike(v)) return v.trim();
    if (v && typeof v === "object") {
      const nested = findEmailDeep(v, seen);
      if (nested) return nested;
    }
  }
  return "";
}

function extractEmailFromForm(form) {
  if (!form || typeof form !== "object") return "";
  const keys = [
    "email",
    "mail",
    "emailId",
    "email_id",
    "contactEmail",
    "contact_email",
    "visitorEmail",
    "user_email",
    "primaryEmail",
    "primary_email",
  ];
  for (const k of keys) {
    const v = form[k];
    if (isEmailLike(v)) return v.trim();
  }
  const containers = ["contact", "personal", "user", "profile"];
  for (const c of containers) {
    const v = form[c];
    if (v && typeof v === "object") {
      const f = extractEmailFromForm(v);
      if (f) return f;
    }
  }
  return findEmailDeep(form);
}

function getEmailFromAnyStorage() {
  try {
    const stores = [window.localStorage, window.sessionStorage];
    for (const store of stores) {
      const known = [
        "verifiedEmail",
        "otpEmail",
        "visitorEmail",
        "email",
        "user_email",
      ];
      for (const k of known) {
        try {
          const v = store.getItem(k);
          if (isEmailLike(v)) return v.trim();
        } catch {}
      }
      for (let i = 0; i < store.length; i++) {
        try {
          const raw = store.getItem(store.key(i));
          if (isEmailLike(raw)) return raw.trim();
          const parsed = JSON.parse(raw);
          const found = findEmailDeep(parsed);
          if (found) return found;
        } catch {}
      }
    }
  } catch {}
  if (
    typeof window !== "undefined" &&
    window.__lastOtpEmail &&
    isEmailLike(window.__lastOtpEmail)
  )
    return window.__lastOtpEmail;
  return "";
}

function getEmailFromQuery() {
  try {
    const u = new URL(window.location.href);
    const e = u.searchParams.get("email");
    if (isEmailLike(e)) return e.trim();
  } catch {}
  return "";
}

function getBestEmail(form) {
  return (
    extractEmailFromForm(form) ||
    getEmailFromAnyStorage() ||
    getEmailFromQuery() ||
    ""
  );
}

function normalizeAdminUrl(url) {
  if (!url) return "";
  const t = String(url).trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) {
    if (
      /^http:\/\//i.test(t) &&
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
            window.location.origin + parsed.pathname + (parsed.search || "")
          );
        }
      } catch {}
      return t.replace(/^http:/i, "https:");
    }
    return t;
  }
  if (t.startsWith("/")) return (API_BASE || "").replace(/\/$/, "") + t;
  return (API_BASE || "").replace(/\/$/, "") + "/" + t.replace(/^\//, "");
}

/* ---------- mailer POST helper (tries /api/mailer then /api/email) ---------- */
async function postMailer(payload) {
  const endpoints = [
    `${API_BASE}/api/mailer`,
    `${API_BASE}/api/email`,
    `/api/mailer`,
    `/api/email`,
  ].filter(Boolean);

  let lastErr = null;
  for (const url of endpoints) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "69420",
        },
        body: JSON.stringify(payload),
      });
      const body = await r.json().catch(() => null);
      if (r.ok) {
        return { ok: true, body, url, status: r.status };
      }
      // try next endpoint only if 404 (route missing) — treat other errors as final
      if (r.status === 404) {
        lastErr = { status: r.status, body, url };
        continue;
      }
      // non-404 error -> return failed
      return { ok: false, status: r.status, body, url };
    } catch (err) {
      lastErr = err;
      continue;
    }
  }
  return { ok: false, error: lastErr || "all endpoints failed" };
}

/* ---------- email/send helper (client-side) ---------- */
async function sendTicketEmailUsingTemplate({
  visitor,
  badgePreviewUrl,
  bannerUrl,
  badgeTemplateUrl,
  config,
}) {
  const frontendBase =
    window.__FRONTEND_BASE__ ||
    window.location.origin ||
    "https://railtransexpo.com";

  const visitorId =
    visitor?.id || visitor?.visitorId || visitor?.insertedId || "";
  const ticketCode = visitor?.ticket_code || visitor?.ticketCode || "";

  const downloadUrl = `${frontendBase.replace(/\/$/, "")}/ticket-download?entity=visitors&${
    visitorId
      ? `id=${encodeURIComponent(String(visitorId))}`
      : `ticket_code=${encodeURIComponent(String(ticketCode || ""))}`
  }`;

  const resolvedEvent =
    (config && config.eventDetails) ||
    visitor?.eventDetails ||
    visitor?.event ||
    {};

  // 1) Try server endpoint that returns the persisted (absolute) logo URL
  let logoUrl = "";
  try {
    const r = await fetch(`${API_BASE}/api/admin/logo-url`, {
      headers: {
        Accept: "application/json",
        "ngrok-skip-browser-warning": "69420",
      },
    });
    if (r.ok) {
      const js = await r.json().catch(() => null);
      const candidate = js?.logo_url || js?.logoUrl || js?.url || "";
      if (candidate) {
        logoUrl = normalizeAdminUrl(candidate) || String(candidate).trim();
      }
    }
  } catch (err) {
    console.warn("Failed to read /api/admin/logo-url:", err);
  }

  // 2) Fallback to config.logoUrl if endpoint missing or empty
  if (!logoUrl && config && (config.logoUrl || config.topbarLogo || (config.adminTopbar && config.adminTopbar.logoUrl))) {
    logoUrl = normalizeAdminUrl(config.logoUrl || config.topbarLogo || (config.adminTopbar && config.adminTopbar.logoUrl)) || "";
  }

  // 3) Last fallback: read localStorage 'admin:topbar' (client-side only)
  if (!logoUrl) {
    try {
      const raw = localStorage.getItem("admin:topbar");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.logoUrl) {
          logoUrl = normalizeAdminUrl(parsed.logoUrl) || String(parsed.logoUrl).trim();
        }
      }
    } catch {}
  }

  logoUrl = logoUrl || "";

  try {
    console.debug("[sendTicketEmailUsingTemplate] resolved logoUrl:", logoUrl);
  } catch {}

  const emailModel = {
    frontendBase,
    entity: "visitors",
    id: visitorId,
    name: visitor?.name || "",
    company: visitor?.company || "",
    ticket_code: ticketCode,
    ticket_category: visitor?.ticket_category || visitor?.ticketCategory || "",
    badgePreviewUrl: badgePreviewUrl || "",
    downloadUrl,
    event: resolvedEvent || {},
    form: visitor || null,
    logoUrl,
  };

  const { subject, text, html } = await buildTicketEmail(emailModel);

  const mailPayload = {
    to: visitor?.email,
    subject,
    text,
    html,
    logoUrl,
    attachments: [],
  };

  // Use postMailer which will try /api/mailer then /api/email and fall back to relative paths.
  const result = await postMailer(mailPayload);
  if (!result.ok) {
    const errMsg = result.body?.error || result.error || `Mailer failed (${result.status || "unknown"})`;
    throw new Error(errMsg);
  }
  return result.body;
}
/* ---------- Visitors component ---------- */
export default function Visitors() {
  const [step, setStep] = useState(1);
  const [config, setConfig] = useState(null);
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
  const [savedVisitorId, setSavedVisitorId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [badgeTemplateUrl, setBadgeTemplateUrl] = useState("");
  const [error, setError] = useState("");
  const finalizeCalledRef = useRef(false);

  // New ref to avoid repeated finalization upserts
  const savedAttemptedRef = useRef(false);

  const videoRef = useRef(null);
  const [bgVideoReady, setBgVideoReady] = useState(false);
  const [bgVideoErrorMsg, setBgVideoErrorMsg] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const onChange = () => setIsMobile(!!mq.matches);
    onChange();
    mq.addEventListener ? mq.addEventListener("change", onChange) : mq.addListener(onChange);
    return () => {
      mq.removeEventListener ? mq.removeEventListener("change", onChange) : mq.removeListener(onChange);
    };
  }, []);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/visitor-config?cb=${Date.now()}`, {
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
        normalized.images = normalized.images.map((u) => normalizeAdminUrl(u));
      else normalized.images = [];
      if (normalized.termsUrl)
        normalized.termsUrl = normalizeAdminUrl(normalized.termsUrl);
      normalized.fields = Array.isArray(normalized.fields)
        ? normalized.fields.map((f) => {
            if (!f || !f.name) return f;
            const nameLabel = (f.name + " " + (f.label || "")).toLowerCase();
            const isEmailField = f.type === "email" || /email/.test(nameLabel);
            if (isEmailField) {
              const fm = Object.assign({}, f.meta || {});
              if (fm.useOtp === undefined) fm.useOtp = true;
              return { ...f, meta: fm };
            }
            return f;
          })
        : [];
      setConfig(normalized);
      setBadgeTemplateUrl(cfg?.badgeTemplateUrl || "");
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
    const onCfg = () => fetchConfig();
    window.addEventListener("visitor-config-updated", onCfg);
    return () => window.removeEventListener("visitor-config-updated", onCfg);
  }, [fetchConfig]);

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

  /**
   * saveVisitor
   * - Sends form to server and returns a normalized result object instead of throwing
   * - Handles both upsert-success and existed/409 shapes
   * - Guarantees returned { ok: boolean, id?: string, ticket_code?: string, raw?: any, existed?: boolean }
   */
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
        company: nextForm.company || nextForm.organization || null,
        other_details: nextForm.other_details || nextForm.otherDetails || "",
        purpose: nextForm.purpose || "",
        ticket_category: ticketCategory || null,
        ticket_label: ticketMeta.label || null,
        ticket_price: ticketMeta.price || 0,
        ticket_gst: ticketMeta.gstAmount || 0,
        ticket_total: ticketMeta.total || 0,
        category: ticketCategory || null,
        slots: Array.isArray(nextForm.slots) ? nextForm.slots : [],
        txId: txId || null,
        termsAccepted: !!nextForm.termsAccepted,
      };

      try {
        const res = await fetch(`${API_BASE}/api/visitors`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "ngrok-skip-browser-warning": "69420",
          },
          body: JSON.stringify(payload),
        });

        const json = await res.json().catch(() => null);

        // Accept successful HTTP 2xx responses or server responses with { success: true }
        if (res.ok || (json && json.success)) {
          // Support multiple shapes returned by different server versions
          const id =
            (json && (json.insertedId || json.inserted_id)) ||
            (json && json.id) ||
            null;
          const ticket =
            (json && (json.ticket_code || json.ticketCode)) ||
            (payload && payload.ticket_code) ||
            null;
          const existed = !!(json && (json.existed || json.existing));
          return { ok: true, id: id ? String(id) : null, ticket_code: ticket || null, raw: json || null, existed };
        }

        // Some servers return 409 with existing info
        if (res.status === 409 && json && json.existing) {
          const id = json.existing.id || null;
          const ticket = json.existing.ticket_code || null;
          return { ok: true, id: id ? String(id) : null, ticket_code: ticket || null, raw: json, existed: true };
        }

        // Otherwise treat as error
        const errMsg = (json && (json.message || json.error)) || `Save failed (${res.status})`;
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
      setTicketMeta(meta || { price: 0, gstAmount: 0, total: 0, label: "" });
      setStep(3);
    },
    [form]
  );

  async function handleFormSubmit(formData) {
    setError("");
    const nextForm = { ...formData };
    setForm(nextForm);

    // Now only advance to ticket selection without any server persistence
    setVisitor((prev) => ({
      ...(prev || {}),
      name: nextForm.name,
      email: nextForm.email,
    }));
    setStep(2);
  }

  const completeRegistrationAndEmail = useCallback(async () => {
    if (finalizeCalledRef.current) return;
    finalizeCalledRef.current = true;
    try {
      setProcessing(true);
      if (config?.termsRequired && !form?.termsAccepted) {
        setError(
          config?.termsRequiredMessage ||
            "You must accept the terms and conditions to complete registration."
        );
        setProcessing(false);
        finalizeCalledRef.current = false;
        return;
      }
      const bestEmail = getBestEmail(form);
      if (!bestEmail && !form?.email) {
        setError("Email is required");
        setProcessing(false);
        finalizeCalledRef.current = false;
        return;
      }
      const finalEmail = form && form.email ? form.email : bestEmail;
      let ticket_code = form.ticket_code || (visitor && visitor.ticket_code) || null;

      // --- Persist only once here (when completing) ---
      if (!savedAttemptedRef.current) {
        try {
          const saveResult = await saveVisitor({ ...form, email: finalEmail });
          if (saveResult.ok) {
            if (saveResult.id) {
              setSavedVisitorId(saveResult.id);
            }
            if (saveResult.ticket_code) {
              ticket_code = saveResult.ticket_code;
              setForm((prev) => ({ ...prev, ticket_code }));
            }
            savedAttemptedRef.current = true;
          } else {
            // If save failed but returned useful info (e.g. existed), honor it
            if (saveResult.id) {
              setSavedVisitorId(saveResult.id);
              savedAttemptedRef.current = true;
            } else {
              // treat as fatal for finalization
              throw new Error(saveResult.error || "Failed to save visitor");
            }
          }
        } catch (e) {
          console.warn("Initial save during finalization failed:", e);
          setError("Failed to save registration. Please try again.");
          setProcessing(false);
          finalizeCalledRef.current = false;
          return;
        }
      }

      // If we already saved and can fetch ticket_code from saved record, prefer that
      if (!ticket_code && savedVisitorId) {
        try {
          const r = await fetch(
            `${API_BASE}/api/visitors/${encodeURIComponent(String(savedVisitorId))}`,
            { headers: { Accept: "application/json", "ngrok-skip-browser-warning": "69440" } }
          );
          if (r.ok) {
            const row = await r.json().catch(() => null);
            ticket_code = row?.ticket_code || row?.ticketCode || row?.code || null;
            if (ticket_code) setForm((prev) => ({ ...prev, ticket_code }));
          }
        } catch (e) {
          console.warn("fetch saved visitor failed", e);
        }
      }

      // If still no ticket_code, generate one and persist it (only once)
      if (!ticket_code) {
        const gen = String(Math.floor(100000 + Math.random() * 900000));
        ticket_code = gen;

        if (!savedAttemptedRef.current) {
          // If not yet saved (unlikely), call saveVisitor with ticket_code
          try {
            const saved = await saveVisitor({ ...form, ticket_code: gen, email: finalEmail });
            if (saved.ok && saved.id) {
              setSavedVisitorId(saved.id);
            }
            if (saved.ticket_code) ticket_code = saved.ticket_code;
            savedAttemptedRef.current = true;
          } catch (saveErr) {
            console.warn("Saving visitor with ticket_code failed:", saveErr);
          }
        } else if (savedVisitorId) {
          // If record exists, call confirm endpoint to set ticket_code
          try {
            await fetch(
              `${API_BASE}/api/visitors/${encodeURIComponent(String(savedVisitorId))}/confirm`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "ngrok-skip-browser-warning": "69440",
                },
                body: JSON.stringify({ ticket_code: gen, force: true }),
              }
            );
          } catch (e) {
            console.warn("confirm ticket_code failed", e);
          }
        }
        setForm((prev) => ({ ...prev, ticket_code }));
      }

      const fullVisitor = {
        ...form,
        email: finalEmail,
        ticket_code,
        ticket_category: ticketCategory,
        ticket_price: ticketMeta.price,
        ticket_gst: ticketMeta.gstAmount,
        ticket_total: ticketMeta.total,
        eventDetails: config?.eventDetails || {},
      };
      setVisitor(fullVisitor);

      if (!emailSent) {
        setEmailSent(true);
        try {
          const bannerUrl = config?.images && config.images.length ? normalizeAdminUrl(config.images[0]) : "";
          await sendTicketEmailUsingTemplate({
            visitor: fullVisitor,
            badgePreviewUrl: "",
            bannerUrl,
            badgeTemplateUrl,
            config,
          });
        } catch (mailErr) {
          console.error("Email failed:", mailErr);
          setError("Saved but email failed");
        }
      }

      try {
        if (savedVisitorId && config?.eventDetails?.date) {
          const payload = {
            entity: "visitors",
            filter: { limit: 1, where: `id=${encodeURIComponent(String(savedVisitorId))}` },
          };
          await fetch(`${API_BASE}/api/reminders/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69440" },
            body: JSON.stringify(payload),
          }).catch(() => {});
        }
      } catch (e) {
        console.warn("scheduling reminder failed", e);
      }

      setStep(4);
    } catch (err) {
      console.error("completeRegistrationAndEmail error:", err);
      setError("Finalization failed");
    } finally {
      setProcessing(false);
      finalizeCalledRef.current = false;
    }
  }, [
    config,
    form,
    savedVisitorId,
    visitor,
    ticketCategory,
    ticketMeta,
    emailSent,
    badgeTemplateUrl,
    saveVisitor,
    sendTicketEmailUsingTemplate,
    API_BASE,
  ]);

  useEffect(() => {
    if (step === 3 && Number(ticketMeta.total) === 0 && !processing) {
      completeRegistrationAndEmail();
    }
  }, [step, ticketMeta, processing, completeRegistrationAndEmail]);

  /* ---------- render (unchanged) ---------- */
  if (isMobile) {
    return (
      <div className="min-h-screen w-full bg-white flex items-start justify-center p-4">
        <div className="w-full max-w-md">
          <Topbar />
          {!loading && Array.isArray(config?.fields) ? (
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
          {!loading && step === 2 && (
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
            </div>
          )}
        </div>
      </div>
    );
  }

  const bgImageUrl =
    config?.backgroundMedia?.type !== "video" && config?.backgroundMedia?.url
      ? normalizeAdminUrl(config.backgroundMedia.url)
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
      {!isMobile && videoUrl && (
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
      {!isMobile && (!videoUrl || !bgVideoReady) && bgImageUrl && (
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
      <div className="absolute inset-0 bg-white/50 pointer-events-none" style={{ zIndex: -900 }} />
      <div className="relative z-10">
        <Topbar />
        <div className="max-w-7xl mx-auto pt-8">
          <div className="flex flex-col sm:flex-row items-stretch mb-10" style={{ minHeight: 370 }}>
            <div className="sm:w-[60%] w-full flex items-center justify-center">
              {loading ? (
                <div className="text-[#21809b] text-2xl font-bold">Loading...</div>
              ) : (
                <div className="rounded-3xl overflow-hidden shadow-2xl h-[220px] sm:h-[320px] w-[340px] sm:w-[500px] bg-white/75 flex items-center justify-center">
                  {config?.images?.length ? <img src={normalizeAdminUrl(config.images[0])} alt="banner" className="object-cover w-full h-full" /> : null}
                </div>
              )}
            </div>
            <div className="sm:w-[40%] w-full flex items-center justify-center">
              {loading ? (
                <div className="text-[#21809b] text-xl font-semibold">Loading event details...</div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full w-full mt-6">
                  <div className="font-extrabold text-3xl sm:text-5xl mb-3 text-center" style={{ background: "linear-gradient(90deg,#ffba08 0%,#19a6e7 60%,#21809b 100%)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>
                    {config?.eventDetails?.name || "Event Name"}
                  </div>
                  <div className="text-xl sm:text-2xl font-bold mb-1 text-center text-[#21809b]">
                    {config?.eventDetails?.date || config?.eventDetails?.dates || "Event Date"}
                  </div>
                  <div className="text-base sm:text-xl font-semibold text-center text-[#196e87]">
                    {config?.eventDetails?.venue || "Event Venue"}
                  </div>
                </div>
              )}
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

          {step === 3 && !/free|general|0/i.test(String(ticketCategory || "")) && !processing && (
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
            <ThankYouMessage email={visitor?.email} messageOverride="Thank you for registering — check your email for the ticket." />
          )}

          {!isMobile && bgVideoErrorMsg && (
            <div className="mt-4 p-3 bg-yellow-50 text-yellow-800 rounded text-sm max-w-3xl mx-auto">
              Background video not playing: {String(bgVideoErrorMsg)}. Check console for details.
            </div>
          )}

          {error && <div className="text-red-400 text-center mt-4">{error}</div>}

          <div className="mt-10 sm:mt-12 pb-8">
            <footer className="text-center text-white font-semibold py-4 text-sm sm:text-lg">© {new Date().getFullYear()} RailTrans Expo</footer>
          </div>
        </div>
      </div>
    </div>
  );
}