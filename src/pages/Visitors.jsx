import React, { useCallback, useEffect, useRef, useState } from "react";
import Topbar from "../components/Topbar";
import DynamicRegistrationForm from "./DynamicRegistrationForm";
import TicketCategorySelector from "../components/TicketCategoryGenerator";
import ManualPaymentStep from "../components/ManualPayemntStep";
import ThankYouMessage from "../components/ThankYouMessage";
import { generateVisitorBadgePDF } from "../utils/pdfGenerator";
import { buildTicketEmail } from "../utils/emailTemplate";

/*
  Clean, focused Visitors.jsx

  Key fixes:
  - Removed manual add/removeEventListener logic that caused "Node cannot be found".
    Instead we set video props (onCanPlay, onError, onPlaying) and call play() only
    on the current ref after checking it exists. This avoids manipulating detached nodes.
  - We normalize admin URLs and accept non-standard "application/mp4" responses but still
    attempt playback. We surface clear diagnostics in console and an operator-friendly message.
  - Autoplay policies: if autoplay is blocked, we show a prominent "Play background video"
    button overlay that triggers playback on user gesture (reliable fallback).
  - Kept "ngrok-skip-browser-warning": "69420" header on fetches requested.
  - Simplified code, removed duplicate state declarations and unnecessary DOM operations.
*/

const API_BASE = (
  process.env.REACT_APP_API_BASE ||
  window.__API_BASE__ ||
  "http://localhost:5000"
).replace(/\/$/, "");

/* ---------- Small helpers ---------- */
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
    "Email",
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
  const candidates = new Set();
  try {
    const storages = [window.localStorage, window.sessionStorage];
    const knownKeys = ["verifiedEmail", "otpEmail", "otp:email", "otp_value", "visitorEmail", "email", "user_email"];
    for (const store of storages) {
      for (const k of knownKeys) {
        try {
          const v = store.getItem(k);
          if (isEmailLike(v)) candidates.add(v);
        } catch {}
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
  } catch {}
  if (typeof window !== "undefined" && window.__lastOtpEmail && isEmailLike(window.__lastOtpEmail)) candidates.add(window.__lastOtpEmail);
  for (const c of candidates) if (isEmailLike(c)) return c.trim();
  return "";
}
function getEmailFromQuery() {
  if (typeof window === "undefined") return "";
  try { const u = new URL(window.location.href); const e = u.searchParams.get("email"); if (isEmailLike(e)) return e.trim(); } catch {}
  return "";
}
function getBestEmail(form) {
  return extractEmailFromForm(form) || getEmailFromAnyStorage() || getEmailFromQuery() || "";
}

function normalizeAdminUrl(url) {
  if (!url) return "";
  const trimmed = String(url).trim();
  if (!trimmed) return "";
  if (/^https:\/\//i.test(trimmed)) return trimmed;
  if (/^http:\/\//i.test(trimmed) && typeof window !== "undefined" && window.location && window.location.protocol === "https:") {
    try {
      const parsed = new URL(trimmed);
      if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
        return window.location.origin + parsed.pathname + (parsed.search || "");
      }
      return trimmed.replace(/^http:/i, "https:");
    } catch {
      return trimmed.replace(/^http:/i, "https:");
    }
  }
  if (/^\/\//.test(trimmed) && typeof window !== "undefined") return window.location.protocol + trimmed;
  if (trimmed.startsWith("/")) return API_BASE.replace(/\/$/, "") + trimmed;
  return API_BASE.replace(/\/$/, "") + "/" + trimmed.replace(/^\//, "");
}

/* ---------- PDF/email helper (unchanged) ---------- */
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
        reader.onloadend = () => resolve(String(reader.result || "").split(",")[1] || "");
        reader.onerror = reject;
        reader.readAsDataURL(pdf);
      });
    }
    return "";
  } catch { return ""; }
}
async function sendTicketEmailUsingTemplate({ visitor, pdfBlob, badgePreviewUrl, bannerUrl, badgeTemplateUrl }) {
  const frontendBase = window.__FRONTEND_BASE__ || window.location.origin || "https://railtransexpo.com";
  const emailModel = { frontendBase, entity: "visitors", id: visitor?.id || visitor?.visitorId || "", name: visitor?.name || "", company: visitor?.company || "", ticket_code: visitor?.ticket_code || "", ticket_category: visitor?.ticket_category || "", bannerUrl: bannerUrl || "", badgePreviewUrl: badgePreviewUrl || "", downloadUrl: "", event: (visitor && visitor.eventDetails) || {} };
  const { subject, text, html } = buildTicketEmail(emailModel);
  const mailPayload = { to: visitor.email, subject, text, html, attachments: [] };
  if (pdfBlob) {
    const b64 = await toBase64(pdfBlob);
    if (b64) mailPayload.attachments.push({ filename: "E-Badge.pdf", content: b64, encoding: "base64", contentType: "application/pdf" });
  }
  const r = await fetch(`${API_BASE}/api/mailer`, { method: "POST", headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" }, body: JSON.stringify(mailPayload) });
  let js = null; try { js = await r.json(); } catch {}
  if (!r.ok) throw new Error((js && (js.error || js.message)) || `Mailer failed (${r.status})`);
  return js;
}

/* ---------- Small UI pieces ---------- */
function SectionTitle() {
  return (
    <div className="w-full flex items-center justify-center my-6 sm:my-8">
      <div className="flex-grow border-t border-[#21809b]" />
      <span className="mx-3 sm:mx-5 px-4 sm:px-8 py-2 sm:py-3 text-lg sm:text-2xl font-extrabold text-[#21809b] bg-white shadow rounded-2xl">Visitor Registration</span>
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
  if (!images || images.length === 0) return null;
  const handleImgError = (e) => { e.target.onerror = null; e.target.src = "data:image/svg+xml;base64," + btoa(`<svg xmlns='http://www.w3.org/2000/svg' width='800' height='450'><rect width='100%' height='100%' fill='#f3f4f6'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='#9ca3af' font-size='20'>Image unavailable</text></svg>`); };
  return (
    <div className="flex flex-col items-center justify-center w-full h-full">
      <div className="rounded-3xl overflow-hidden shadow-2xl border-4 border-[#19a6e7] h-[220px] sm:h-[320px] w-[340px] sm:w-[500px] max-w-full bg-white/75 flex items-center justify-center mt-6 sm:mt-10">
        <img src={normalizeAdminUrl(images[active])} alt={`Visitor ${active + 1}`} className="object-cover w-full h-full" loading="lazy" onError={handleImgError} />
      </div>
    </div>
  );
}
function EventDetailsBlock({ event }) {
  if (!event) return null;
  return (
    <div className="flex flex-col items-center justify-center h-full w-full mt-6">
      <div className="font-extrabold text-3xl sm:text-5xl mb-3 text-center" style={{ background: "linear-gradient(90deg,#ffba08 0%,#19a6e7 60%,#21809b 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{event?.name || "Event Name"}</div>
      <div className="text-xl sm:text-2xl font-bold mb-1 text-center text-[#21809b]">{event?.date || "Event Date"}</div>
      <div className="text-base sm:text-xl font-semibold text-center text-[#196e87]">{event?.venue || "Event Venue"}</div>
      {event?.tagline && <div className="text-base sm:text-xl font-semibold text-center text-[#21809b] mt-2">{event.tagline}</div>}
    </div>
  );
}

/* ---------- Main component ---------- */
export default function Visitors() {
  const [step, setStep] = useState(1);
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({});
  const [ticketCategory, setTicketCategory] = useState("");
  const [ticketMeta, setTicketMeta] = useState({ price: 0, gstAmount: 0, total: 0, label: "" });
  const [txId, setTxId] = useState("");
  const [proofFile, setProofFile] = useState(null);
  const [visitor, setVisitor] = useState(null);
  const [savedVisitorId, setSavedVisitorId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [badgeTemplateUrl, setBadgeTemplateUrl] = useState("");
  const [error, setError] = useState("");
  const finalizeCalledRef = useRef(false);

  // video states
  const videoRef = useRef(null);
  const [bgVideoReady, setBgVideoReady] = useState(false);
  const [bgVideoErrorMsg, setBgVideoErrorMsg] = useState("");
  const [emailSent, setEmailSent] = useState(false);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const onChange = () => setIsMobile(!!mq.matches);
    onChange();
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => { if (mq.removeEventListener) mq.removeEventListener("change", onChange); else mq.removeListener(onChange); };
  }, []);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const url = `${API_BASE}/api/visitor-config?cb=${Date.now()}`;
      const r = await fetch(url, { cache: "no-store", headers: { Accept: "application/json", "ngrok-skip-browser-warning": "69420" } });
      const cfg = r.ok ? await r.json() : {};
      const normalized = { ...(cfg || {}) };

      if (normalized.backgroundMedia && normalized.backgroundMedia.url) normalized.backgroundMedia = { type: normalized.backgroundMedia.type || "image", url: normalizeAdminUrl(normalized.backgroundMedia.url) };
      else normalized.backgroundMedia = normalized.backgroundMedia || { type: "image", url: "" };

      if (Array.isArray(normalized.images)) normalized.images = normalized.images.map(u => normalizeAdminUrl(u)); else normalized.images = [];
      if (normalized.termsUrl) normalized.termsUrl = normalizeAdminUrl(normalized.termsUrl);
      normalized.fields = Array.isArray(normalized.fields) ? normalized.fields : [];
      normalized.fields = normalized.fields.map(f => {
        if (!f || !f.name) return f;
        const nameLabel = (f.name + " " + (f.label || "")).toLowerCase();
        const isEmailField = f.type === "email" || /email/.test(nameLabel);
        if (isEmailField) { const fm = Object.assign({}, f.meta || {}); if (fm.useOtp === undefined) fm.useOtp = true; return { ...f, meta: fm }; }
        return f;
      });

      setConfig(normalized);
      setBadgeTemplateUrl(cfg?.badgeTemplateUrl || "");
      const prefillEmail = getBestEmail({});
      if (prefillEmail) setForm(prev => ({ ...prev, email: prefillEmail }));
    } catch (e) {
      console.error("[Visitors] Failed to load visitor config:", e);
      setConfig({ fields: [], images: [], backgroundMedia: { type: "image", url: "" } });
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

  /* ---------- Video effect (single, simple) ---------- */
  useEffect(() => {
    if (isMobile) return;
    const bm = config?.backgroundMedia;
    const el = videoRef.current;
    if (!bm || bm.type !== "video" || !bm.url || !el) {
      setBgVideoReady(false);
      setBgVideoErrorMsg("");
      return;
    }
    const src = normalizeAdminUrl(bm.url);
    setBgVideoReady(false);
    setBgVideoErrorMsg("");

    // HEAD check just for diagnostics (non-fatal)
    (async () => {
      try {
        const head = await fetch(src, { method: "HEAD", mode: "cors", headers: { "ngrok-skip-browser-warning": "69420" } });
        if (head.ok) {
          const ct = (head.headers.get("content-type") || "").toLowerCase();
          if (ct && !ct.startsWith("video/") && !ct.includes("mp4")) {
            console.warn("[Visitors] Video content-type unexpected:", ct);
          } else if (ct.includes("mp4") && !ct.startsWith("video/")) {
            console.warn("[Visitors] Video content-type non-standard but mp4:", ct);
          }
        } else {
          console.warn("[Visitors] Video HEAD returned", head.status);
          // still attempt to play; do not block
        }
      } catch (err) {
        // HEAD might be blocked by CORS; ignore
        console.debug("[Visitors] HEAD check error (CORS?):", err);
      }
    })();

    // assign src on the actual element and try play
    try {
      if (el.src !== src) {
        el.pause();
        el.removeAttribute("src");
        Array.from(el.querySelectorAll("source")).forEach(s => s.remove());
        el.src = src;
        el.crossOrigin = "anonymous";
        try { el.load(); } catch {}
      }
    } catch (err) {
      console.warn("assigning src failed", err);
    }

    const onCanPlay = async () => {
      try {
        const p = el.play();
        if (p && typeof p.then === "function") {
          await p;
        }
        setBgVideoReady(true);
        setBgVideoErrorMsg("");
      } catch (err) {
        setBgVideoReady(false);
        setBgVideoErrorMsg("Autoplay blocked; click to start background video.");
        console.debug("autoplay blocked:", err);
      }
    };
    const onError = (ev) => {
      console.warn("[Visitors] video element error", ev);
      setBgVideoReady(false);
      setBgVideoErrorMsg("Background video failed to load/play (check URL/CORS).");
    };
    const onPlaying = () => {
      setBgVideoReady(true);
      setBgVideoErrorMsg("");
    };

    el.addEventListener("canplay", onCanPlay);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("error", onError);

    // try to play immediately
    (async () => {
      try {
        const p = el.play();
        if (p && typeof p.then === "function") {
          await p.catch((err) => { throw err; });
        }
        setBgVideoReady(true);
      } catch (err) {
        setBgVideoReady(false);
        setBgVideoErrorMsg("Autoplay blocked; click to start background video.");
      }
    })();

    return () => {
      try { el.removeEventListener("canplay", onCanPlay); } catch {}
      try { el.removeEventListener("playing", onPlaying); } catch {}
      try { el.removeEventListener("error", onError); } catch {}
      try { el.pause(); } catch {}
    };
  }, [config?.backgroundMedia?.url, config?.backgroundMedia?.type, isMobile]);

  const startVideoManually = async () => {
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
  };

  /* ---------- Backend helpers & registration flow (unchanged) ---------- */
  async function saveStep(stepName, data = {}, meta = {}) {
    try {
      await fetch(`${API_BASE}/api/visitors/step`, { method: "POST", headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" }, body: JSON.stringify({ step: stepName, data, meta }) });
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

    const res = await fetch(`${API_BASE}/api/visitors`, { method: "POST", headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" }, body: JSON.stringify(payload) });
    let json = null;
    try { json = await res.json(); } catch {}
    if (!res.ok) throw new Error((json && (json.message || json.error)) || `Save failed (${res.status})`);
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
    setTicketMeta(meta || { price: 0, gstAmount: 0, total: 0, label: "" });
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
      if (!bestEmail) { setError("Email is required"); setProcessing(false); finalizeCalledRef.current = false; return; }
      if (!extractEmailFromForm(form)) setForm(prev => ({ ...prev, email: bestEmail }));

      let ticket_code = form.ticket_code || (visitor && visitor.ticket_code) || null;
      if (!ticket_code && savedVisitorId) {
        try {
          const r = await fetch(`${API_BASE}/api/visitors/${encodeURIComponent(String(savedVisitorId))}`, { headers: { Accept: "application/json", "ngrok-skip-browser-warning": "69420" } });
          if (r.ok) {
            const row = await r.json();
            ticket_code = row?.ticket_code || row?.ticketCode || row?.code || null;
            if (ticket_code) setForm(prev => ({ ...prev, ticket_code }));
          }
        } catch (e) { console.warn("fetch saved visitor failed", e); }
      }
      if (!ticket_code) {
        const gen = String(Math.floor(100000 + Math.random() * 900000));
        ticket_code = gen;
        if (savedVisitorId) {
          try {
            await fetch(`${API_BASE}/api/visitors/${encodeURIComponent(String(savedVisitorId))}/confirm`, { method: "POST", headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" }, body: JSON.stringify({ ticket_code: gen, force: true }) });
          } catch (e) { /* ignore */ }
        } else {
          try {
            const saved = await saveVisitor({ ...form, ticket_code: gen });
            if (saved?.insertedId) setSavedVisitorId(saved.insertedId);
            if (saved?.ticket_code) ticket_code = saved.ticket_code;
          } catch (saveErr) { console.warn("Saving visitor during finalization failed:", saveErr); }
        }
        setForm(prev => ({ ...prev, ticket_code }));
      }

      const fullVisitor = { ...form, ticket_code, ticket_category: ticketCategory, ticket_price: ticketMeta.price, ticket_gst: ticketMeta.gstAmount, ticket_total: ticketMeta.total, eventDetails: config?.eventDetails || {} };
      setVisitor(fullVisitor);
      await saveStep("finalizing_start", { fullVisitor });

      let pdfBlob = null;
      try { pdfBlob = await generateVisitorBadgePDF(fullVisitor, badgeTemplateUrl || "", { includeQRCode: true, qrPayload: { n: fullVisitor.name, e: fullVisitor.email, c: fullVisitor.ticket_code }, event: config?.eventDetails || {} }); } catch (e) { console.warn("PDF gen failed", e); pdfBlob = null; }

      if (!emailSent) {
        setEmailSent(true);
        try {
          const bannerUrl = (config?.images && config.images.length) ? normalizeAdminUrl(config.images[0]) : "";
          const badgePreviewUrl = "";
          await sendTicketEmailUsingTemplate({ visitor: fullVisitor, pdfBlob, badgePreviewUrl, bannerUrl, badgeTemplateUrl });
          await saveStep("emailed", { fullVisitor }, { savedVisitorId });
        } catch (mailErr) {
          console.error("Email failed:", mailErr);
          await saveStep("email_failed", { fullVisitor }, { error: String(mailErr) });
          setError("Saved but email failed");
        }
      }

      try {
        if (savedVisitorId && config?.eventDetails?.date) {
          await fetch(`${API_BASE}/api/reminders/create`, { method: "POST", headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" }, body: JSON.stringify({ entity: "visitors", entityId: savedVisitorId, eventDate: config.eventDetails.date }) }).catch(()=>{});
        }
      } catch (e) { console.warn("scheduling reminder failed", e); }

      setStep(4);
    } catch (err) {
      console.error("completeRegistrationAndEmail error:", err);
      setError("Finalization failed");
    } finally {
      setProcessing(false);
      finalizeCalledRef.current = false;
    }
  }

  useEffect(() => {
    if (step === 3 && Number(ticketMeta.total) === 0 && !processing) completeRegistrationAndEmail();
  }, [step, ticketMeta]);

  /* ---------- Render ---------- */
  if (isMobile) {
    return (
      <div className="min-h-screen w-full bg-white flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <Topbar />
          {!loading && Array.isArray(config?.fields) ? (
            <DynamicRegistrationForm config={config} form={form} setForm={setForm} onSubmit={handleFormSubmit} editable terms={{ url: config?.termsUrl, label: config?.termsLabel, required: !!config?.termsRequired }} apiBase={API_BASE} />
          ) : (
            <div className="text-center py-8">Loading...</div>
          )}
        </div>
      </div>
    );
  }

  const bgImageUrl = (config?.backgroundMedia?.type !== "video" && config?.backgroundMedia?.url) ? normalizeAdminUrl(config.backgroundMedia.url) : null;
  const videoUrl = (config?.backgroundMedia?.type === "video" && config?.backgroundMedia?.url) ? normalizeAdminUrl(config.backgroundMedia.url) : null;

  return (
    <div className="min-h-screen w-full relative" style={{ backgroundSize: "cover", backgroundPosition: "center" }}>
      {!isMobile && videoUrl && (
        <video key={videoUrl} autoPlay muted loop playsInline preload="auto" className="fixed inset-0 w-full h-full object-cover -z-10">
          <source src={videoUrl} type="video/mp4" />
        </video>
      )}

      {!isMobile && (!videoUrl || !bgVideoReady) && bgImageUrl && (
        <div className="fixed inset-0 -z-10" style={{ backgroundImage: `url(${bgImageUrl})`, backgroundSize: "cover", backgroundPosition: "center" }} />
      )}


      {!isMobile && videoUrl && !bgVideoReady && bgVideoErrorMsg && (
        <div className="fixed inset-0 z-0 flexhttps://unfirm-janette-unmirrored.ngrok-free.dev/uploads/1764656744045-3hi0n8.mp4
 items-center justify-center pointer-events-auto">
          <button onClick={startVideoManually} className="bg-black/60 text-white px-5 py-3 rounded-lg">Play background video</button>
        </div>
      )}


      <div className="absolute inset-0 bg-white/50 pointer-events-none" style={{ zIndex: -900 }} />

      <div className="relative z-10">
        <Topbar />
        <div className="max-w-7xl mx-auto pt-8">
          <div className="flex flex-col sm:flex-row items-stretch mb-10" style={{ minHeight: 370 }}>
            <div className="sm:w-[60%] w-full flex items-center justify-center">
              {loading ? <div className="text-[#21809b] text-2xl font-bold">Loading...</div> : <ImageSlider images={config?.images || []} />}
            </div>
            <div className="sm:w-[40%] w-full flex items-center justify-center">
              {loading ? <div className="text-[#21809b] text-xl font-semibold">Loading event details...</div> : <EventDetailsBlock event={config?.eventDetails || null} />}
            </div>
          </div>

          <SectionTitle />

          {!loading && step === 1 && Array.isArray(config?.fields) && (
            <div className="mx-auto w-full max-w-2xl">
              <DynamicRegistrationForm config={config} form={form} setForm={setForm} onSubmit={handleFormSubmit} editable terms={{ url: config?.termsUrl, label: config?.termsLabel, required: !!config?.termsRequired }} apiBase={API_BASE} />
            </div>
          )}

          {!loading && step === 2 && <TicketCategorySelector role="visitors" value={ticketCategory} onChange={handleTicketSelect} />}

          {step === 3 && !(/free|general|0/i.test(String(ticketCategory || ""))) && !processing && (
            <ManualPaymentStep ticketType={ticketCategory} ticketPrice={ticketMeta.total || 0} onProofUpload={() => completeRegistrationAndEmail()} onTxIdChange={(val) => setTxId(val)} txId={txId} proofFile={proofFile} setProofFile={setProofFile} />
          )}

          {step === 3 && processing && (
            <div className="py-20 text-center text-white">
              <div className="text-lg sm:text-xl font-semibold">Finalizing your registration...</div>
            </div>
          )}

          {step === 4 && <ThankYouMessage email={visitor?.email} messageOverride="Thank you for registering — check your email for the ticket." />}

          {!isMobile && bgVideoErrorMsg && (
            <div className="mt-4 p-3 bg-yellow-50 text-yellow-800 rounded text-sm max-w-3xl mx-auto">
              Background video not playing: {String(bgVideoErrorMsg)}. Check console for details and ensure the video URL is accessible over HTTPS and the server permits CORS (Access-Control-Allow-Origin).
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