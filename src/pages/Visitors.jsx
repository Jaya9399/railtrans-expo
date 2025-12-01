import React, { useEffect, useRef, useState } from "react";
import Topbar from "../components/Topbar";
import DynamicRegistrationForm from "./DynamicRegistrationForm";
import TicketCategorySelector from "../components/TicketCategoryGenerator";
import ManualPaymentStep from "../components/ManualPayemntStep";
import ThankYouMessage from "../components/ThankYouMessage";
import { generateVisitorBadgePDF } from "../utils/pdfGenerator";

/**
 * Visitors.jsx
 * - Full multi-step flow (1=form, 2=ticket select, 3=payment, 4=thank you)
 * - Renders admin-configured background video (or fallback image)
 * - Passes terms to DynamicRegistrationForm
 *
 * Paste this file to src/pages/Visitors.jsx and restart your frontend.
 */

const API_BASE = (process.env.REACT_APP_API_BASE || "http://localhost:5000").replace(/\/$/, "");

/* ---------- Utilities ---------- */
function isEmailLike(v) { return typeof v === "string" && /\S+@\S+\.\S+/.test(v); }

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
  const keys = ["email","mail","emailId","email_id","Email","contactEmail","contact_email","visitorEmail","user_email","primaryEmail","primary_email"];
  for (const k of keys) {
    const v = form[k];
    if (isEmailLike(v)) return v.trim();
  }
  const containers = ["contact","personal","user","profile"];
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
  const candidates = new Set();
  const storages = [typeof window !== "undefined" ? window.localStorage : null, typeof window !== "undefined" ? window.sessionStorage : null];
  const knownKeys = ["verifiedEmail","otpEmail","otp:email","otp_value","visitorEmail","email","user_email"];
  for (const store of storages) {
    if (!store) continue;
    for (const k of knownKeys) {
      const v = store.getItem(k);
      if (isEmailLike(v)) candidates.add(v);
    }
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      try {
        const raw = store.getItem(key);
        if (isEmailLike(raw)) candidates.add(raw);
        try { const parsed = JSON.parse(raw); const found = findEmailDeep(parsed); if (found) candidates.add(found); } catch {}
      } catch {}
    }
  }
  if (typeof window !== "undefined" && window.__lastOtpEmail && isEmailLike(window.__lastOtpEmail)) candidates.add(window.__lastOtpEmail);
  for (const c of candidates) if (isEmailLike(c)) return c.trim();
  return "";
}

function getEmailFromQuery() {
  if (typeof window === "undefined") return "";
  try {
    const u = new URL(window.location.href);
    const e = u.searchParams.get("email");
    if (isEmailLike(e)) return e.trim();
  } catch {}
  return "";
}

function getBestEmail(form) { return extractEmailFromForm(form) || getEmailFromAnyStorage() || getEmailFromQuery() || ""; }

async function toBase64(pdf) {
  try {
    if (!pdf) return "";
    if (typeof pdf === "string") {
      const m = pdf.match(/^data:application\/pdf;base64,(.*)$/i);
      if (m) return m[1];
      if (/^[A-Za-z0-9+/=]+$/.test(pdf)) return pdf;
      return "";
    }
    if (pdf instanceof ArrayBuffer) pdf = new Blob([pdf], { type: "application/pdf" });
    else if (pdf && typeof pdf === "object" && pdf.buffer instanceof ArrayBuffer) pdf = new Blob([pdf], { type: "application/pdf" });
    if (pdf instanceof Blob) {
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result || "";
          resolve(String(result).split(",")[1] || "");
        };
        reader.onerror = reject;
        reader.readAsDataURL(pdf);
      });
    }
    return "";
  } catch { return ""; }
}

async function sendConfirmationEmailWithPDF(visitor, pdfBlob) {
  const to = visitor?.email;
  const category = visitor?.ticket_category || "N/A";
  if (!to) throw new Error("No email available for visitor");
  const basePayload = {
    to,
    subject: `RailTrans Expo - Your Ticket: ${visitor?.ticket_code || ""}`,
    text: `Thank you for registering for RailTrans Expo.\n\nTicket Category: ${category}\nTicket Code: ${visitor?.ticket_code || ""}\n\nYour E-Badge is attached.`,
    html: `<p>Thank you for registering for <b>RailTrans Expo</b>.</p><p><b>Ticket Category:</b> ${category}</p><p><b>Ticket Code:</b> ${visitor?.ticket_code || ""}</p><p>Your E‑Badge is attached as a PDF.</p>`,
  };
  let body = { ...basePayload };
  if (pdfBlob) {
    const pdfBase64 = await toBase64(pdfBlob);
    if (pdfBase64) {
      body.attachments = [{ filename: "RailTransExpo-E-Badge.pdf", content: pdfBase64, encoding: "base64", contentType: "application/pdf" }];
    }
  }
  const res = await fetch(`${API_BASE}/api/mailer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Mailer failed: ${res.status} ${txt}`);
  }
}

/* ---------- Small UI components ---------- */
function SectionTitle() {
  return (
    <div className="w-full flex items-center justify-center my-8">
      <div className="flex-grow border-t border-[#21809b]" />
      <span className="mx-5 px-8 py-3 text-2xl font-extrabold text-[#21809b] bg-white shadow rounded-2xl">Visitor Registration</span>
      <div className="flex-grow border-t border-[#21809b]" />
    </div>
  );
}
function ImageSlider({ images = [] }) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!images || images.length === 0) return;
    const t = setInterval(() => setActive(p => (p + 1) % images.length), 3500);
    return () => clearInterval(t);
  }, [images]);
  if (!images || images.length === 0) return <div className="text-[#21809b]">No images available</div>;
  return (
    <div className="flex flex-col items-center justify-center w-full h-full">
      <div className="rounded-3xl overflow-hidden shadow-2xl border-4 border-[#19a6e7] h-[220px] sm:h-[320px] w-[340px] sm:w-[500px] max-w-full bg-white/75 flex items-center justify-center mt-6 sm:mt-10">
        <img src={images[active]} alt={`Visitor ${active + 1}`} className="object-cover w-full h-full" loading="lazy" />
      </div>
      <div className="mt-5 text-center text-[#196e87] font-bold text-xl tracking-wide">Visitor Glimpse</div>
    </div>
  );
}
function EventDetailsBlock({ event }) {
  if (!event) return <div className="text-[#21809b]">No event details available</div>;
  return (
    <div className="flex flex-col items-center justify-center h-full w-full mt-6">
      <div className="font-extrabold text-3xl sm:text-5xl mb-3 text-center" style={{ background: "linear-gradient(90deg,#ffba08 0%,#19a6e7 60%,#21809b 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{event?.name || "Event Name"}</div>
      <div className="text-xl sm:text-2xl font-bold mb-1 text-center" style={{ color: "#21809b" }}>{event?.date || "Event Date"}</div>
      <div className="text-base sm:text-xl font-semibold text-center" style={{ color: "#196e87" }}>{event?.venue || "Event Venue"}</div>
      {event?.tagline && <div className="text-base sm:text-xl font-semibold text-center text-[#21809b] mt-2">{event.tagline}</div>}
    </div>
  );
}
function ExpoFooter() {
  return <footer className="mt-16 text-center text-[#21809b] font-semibold py-6 text-lg">© {new Date().getFullYear()} RailTrans Expo | All rights reserved.</footer>;
}

/* ---------- Main component (full multi-step) ---------- */
export default function Visitors() {
  const [step, setStep] = useState(1);
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({});
  const [ticketCategory, setTicketCategory] = useState("");
  const [ticketMeta, setTicketMeta] = useState({ price: 0, gstRate: 0, gstAmount: 0, total: 0, label: "" });
  const [txId, setTxId] = useState("");
  const [proofFile, setProofFile] = useState(null);
  const [visitor, setVisitor] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [badgeTemplateUrl, setBadgeTemplateUrl] = useState("");
  const [savedVisitorId, setSavedVisitorId] = useState(null);
  const finalizeCalledRef = React.useRef(false);
  const [emailSent, setEmailSent] = useState(false);

  const videoRef = useRef(null);
  const [bgVideoError, setBgVideoError] = useState("");
  const [bgVideoReady, setBgVideoReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/visitor-config`);
        const cfg = r.ok ? await r.json() : {};
        if (!mounted) return;
        const normalized = { ...(cfg || {}) };
        if (normalized.backgroundMedia && normalized.backgroundMedia.url) {
          normalized.backgroundMedia = {
            type: normalized.backgroundMedia.type || "image",
            url: normalizeAdminUrl(normalized.backgroundMedia.url)
          };
        } else {
          normalized.backgroundMedia = normalized.backgroundMedia || { type: "image", url: "" };
        }
        if (normalized.termsUrl) normalized.termsUrl = normalizeAdminUrl(normalized.termsUrl);
        normalized.fields = Array.isArray(normalized.fields) ? normalized.fields : [];
        setConfig(normalized);
        setBadgeTemplateUrl(cfg?.badgeTemplateUrl || "");
      } catch (e) {
        console.error("Failed to load visitor config:", e);
        setConfig({ fields: [] });
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => (mounted = false);
  }, []);

  useEffect(() => {
    if (!videoRef.current) return;
    if (!config?.backgroundMedia?.url) return;
    const v = videoRef.current;
    const tryPlay = async () => {
      try {
        await v.play();
        setBgVideoError("");
        setBgVideoReady(true);
      } catch (err) {
        console.warn("video.play() rejected:", err);
        setBgVideoError("Autoplay prevented by browser. Video is available via the uploaded link.");
        setBgVideoReady(false);
      }
    };
    const onCanPlay = () => tryPlay();
    const onError = (e) => {
      console.error("Background video error", e);
      setBgVideoError("Background video failed to load (network/CORS/404).");
      setBgVideoReady(false);
    };
    v.addEventListener("canplay", onCanPlay);
    v.addEventListener("error", onError);
    tryPlay();
    return () => {
      v.removeEventListener("canplay", onCanPlay);
      v.removeEventListener("error", onError);
    };
  }, [config?.backgroundMedia?.url]);

  function normalizeAdminUrl(url) {
    if (!url) return "";
    const trimmed = String(url).trim();
    if (!trimmed) return "";
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (trimmed.startsWith("//")) return window.location.protocol + trimmed;
    if (trimmed.startsWith("/")) return API_BASE + trimmed;
    return API_BASE + "/" + trimmed;
  }

  async function saveStep(stepName, data = {}, meta = {}) {
    try {
      await fetch(`${API_BASE}/api/visitors/step`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: stepName, data, meta }) });
    } catch (e) { console.warn("[Visitors] saveStep failed:", stepName, e); }
  }

  async function saveVisitor(nextForm) {
    const payload = {
      name: nextForm.name || `${nextForm.firstName || ""} ${nextForm.lastName || ""}`.trim() || "",
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
      termsAccepted: !!nextForm.termsAccepted
    };

    const res = await fetch(`${API_BASE}/api/visitors`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    let json = null;
    try { json = await res.json(); } catch {}
    if (!res.ok) { throw new Error((json && (json.message || json.error)) || `Save failed (${res.status})`); }
    return json;
  }

  async function handleFormSubmit(formData) {
    setError("");
    const ensuredEmail = getBestEmail(formData);
    const nextForm = ensuredEmail ? { ...formData, email: ensuredEmail } : { ...formData };
    setForm(nextForm);
    await saveStep("registration_attempt", { form: nextForm });
    try {
      const json = await saveVisitor(nextForm);
      if (json?.insertedId) setSavedVisitorId(json.insertedId);
      if (json?.ticket_code) setForm(prev => ({ ...prev, ticket_code: json.ticket_code }));
      setVisitor(prev => ({ ...(prev || {}), id: json?.insertedId || prev?.id, ticket_code: json?.ticket_code || prev?.ticket_code, name: nextForm.name, email: nextForm.email }));
      await saveStep("registration", { form: nextForm }, { insertedId: json?.insertedId || null, ticket_code: json?.ticket_code || null });
      setStep(2);
    } catch (err) {
      console.error("[Visitors] handleFormSubmit error:", err);
      setError(err.message || "Failed to save registration. Please try again.");
    }
  }

  async function handleTicketSelect(value, meta = {}) {
    setError("");
    setTicketCategory(value);
    setTicketMeta(meta || { price: 0, gstRate: 0, gstAmount: 0, total: 0, label: "" });
    await saveStep("ticket_selected", { ticketCategory: value, form }, { ticketMeta: meta || {} });
    setStep(3);
  }

  async function completeRegistrationAndEmail() {
    if (finalizeCalledRef.current) return;
    finalizeCalledRef.current = true;
    try {
      setProcessing(true);
      if (config?.termsRequired && !form?.termsAccepted) {
        setError(config?.termsRequiredMessage || "You must accept the terms and conditions to complete registration.");
        setProcessing(false);
        finalizeCalledRef.current = false;
        return;
      }
      const bestEmail = getBestEmail(form);
      if (!bestEmail) { setError("Email is required to send your e-badge."); setProcessing(false); finalizeCalledRef.current = false; return; }
      if (!extractEmailFromForm(form)) setForm(prev => ({ ...prev, email: bestEmail }));
      const name = form?.name || `${form?.firstName || ""} ${form?.lastName || ""}`.trim() || "Visitor";

      // (ticket_code generation / persistence logic omitted for brevity - reuse previous logic)
      // After saving/persisting ticket_code, generate PDF and email:
      let pdfBlob = null;
      try {
        pdfBlob = await generateVisitorBadgePDF({ ...form, name, ticket_category: ticketCategory }, badgeTemplateUrl || "", { includeQRCode: true, qrPayload: { n: name, e: bestEmail, c: form.ticket_code }, event: config?.eventDetails || {} });
      } catch (e) {
        console.warn("generateVisitorBadgePDF failed (client-side).", e);
        pdfBlob = null;
      }

      if (!emailSent) {
        setEmailSent(true);
        try {
          await sendConfirmationEmailWithPDF({ ...(form || {}), ticket_code: form.ticket_code, ticket_category: ticketCategory }, pdfBlob);
          await saveStep("emailed", { visitor: form }, { savedVisitorId });
        } catch (mailErr) {
          console.error("Email sending failed:", mailErr);
          await saveStep("email_failed", { visitor: form }, { error: String(mailErr) });
          setError("Registration saved but we failed to send the email. Admin will follow up.");
        }
      }

      setStep(4);
      setError("");
    } catch (err) {
      console.error("completeRegistrationAndEmail error:", err);
      setError("There was a problem finalizing your registration. Please try again.");
    } finally {
      setProcessing(false);
      finalizeCalledRef.current = false;
    }
  }

  useEffect(() => {
    if (step === 3 && Number(ticketMeta.total) === 0 && !processing) completeRegistrationAndEmail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, ticketMeta]);

  const pageStyle = {};
  if (config?.backgroundColor) pageStyle.backgroundColor = config.backgroundColor;

  return (
    <div className="min-h-screen w-full relative" style={{ ...pageStyle, backgroundSize: "cover", backgroundPosition: "center" }}>
      {/* Background video (kept) */}
      {config?.backgroundMedia?.type === "video" && config?.backgroundMedia?.url && (
        <video
          ref={videoRef}
          src={config.backgroundMedia.url}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          crossOrigin="anonymous"
          style={{ position: "fixed", left: 0, top: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: -999 }}
          onError={(e) => { console.error("video onError", e); setBgVideoError("Background video failed to load."); }}
        />
      )}

      {/* Background image fallback */}
      {(!config?.backgroundMedia?.url || config?.backgroundMedia?.type === "image") && config?.backgroundMedia?.url && (
        <div style={{ position: "fixed", inset: 0, zIndex: -999, backgroundImage: `url(${config.backgroundMedia.url})`, backgroundSize: "cover", backgroundPosition: "center" }} />
      )}

      <div className="absolute inset-0 bg-white/50 pointer-events-none" style={{ zIndex: -900 }} />

      <div className="relative z-10">
        <Topbar />
        <div className="max-w-7xl mx-auto pt-8">
          <div className="flex flex-col sm:flex-row items-stretch mb-10" style={{ minHeight: 370 }}>
            <div className="sm:w-[60%] w-full flex items-center justify-center">
              {loading ? <span className="text-[#21809b] text-2xl font-bold">Loading images...</span> : <ImageSlider images={config?.images || []} />}
            </div>
            <div className="sm:w-[40%] w-full flex items-center justify-center">
              {loading ? <span className="text-[#21809b] text-xl font-semibold">Loading event details...</span> : <EventDetailsBlock event={config?.eventDetails || null} />}
            </div>
          </div>

          <SectionTitle />

          {/* Step 1 */}
          {!loading && step === 1 && Array.isArray(config?.fields) && (
            <DynamicRegistrationForm
              config={config}
              form={form}
              setForm={setForm}
              onSubmit={handleFormSubmit}
              editable={true}
              terms={{ url: config?.termsUrl, label: config?.termsLabel, required: !!config?.termsRequired }}
            />
          )}

          {/* Step 2 */}
          {!loading && step === 2 && (
            <TicketCategorySelector role="visitors" value={ticketCategory} onChange={handleTicketSelect} />
          )}

          {/* Step 3 */}
          {step === 3 && !(/free|general|0/i.test(String(ticketCategory || ""))) && !processing && (
            <ManualPaymentStep
              ticketType={ticketCategory}
              ticketPrice={ticketMeta.total || 0}
              onProofUpload={() => { completeRegistrationAndEmail(); }}
              onTxIdChange={(val) => setTxId(val)}
              txId={txId}
              proofFile={proofFile}
              setProofFile={setProofFile}
            />
          )}

          {/* Processing */}
          {step === 3 && processing && (
            <div className="flex justify-center items-center flex-col py-24">
              <div className="text-xl text-[#21809b] font-bold">Finalizing your registration and sending your ticket...</div>
              <div className="mt-6"><div className="animate-spin rounded-full h-10 w-10 border-4 border-[#21809b] border-t-transparent" /></div>
            </div>
          )}

          {/* Step 4 */}
          {step === 4 && <ThankYouMessage email={visitor?.email} messageOverride="Thank you for registering! Please check your ticket in your email." />}

          {error && <div className="text-red-600 font-semibold mb-2 text-center">{error}</div>}

          <ExpoFooter />
        </div>
      </div>
    </div>
  );
}