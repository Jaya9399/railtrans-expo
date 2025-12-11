import React, { useEffect, useRef, useState } from "react";
import Topbar from "../components/Topbar";
import DynamicRegistrationForm from "./DynamicRegistrationForm";
import TicketCategorySelector from "../components/TicketCategoryGenerator";
import ManualPaymentStep from "../components/ManualPayemntStep";
import ThankYouMessage from "../components/ThankYouMessage";
import { generateVisitorBadgePDF } from "../utils/pdfGenerator";
import { buildTicketEmail } from "../utils/emailTemplate";

/*
  Exhibitors.jsx
  - Adds ngrok bypass header on key fetches
  - Fetches canonical event-details from /api/configs/event-details (fallback /api/event-details)
    and shows it in the UI (preview). Listens to config-updated and event-details-updated to refresh.
  - Makes payment status polling and proof uploads include ngrok header.
  - Keeps previous robust field/config normalization and defaults.
*/

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
function getApiBaseFromEnvOrWindow() {
  if (typeof process !== "undefined" && process.env && process.env.REACT_APP_API_BASE) {
    return process.env.REACT_APP_API_BASE.replace(/\/$/, "");
  }
  if (typeof window !== "undefined" && window.__API_BASE__) {
    return String(window.__API_BASE__).replace(/\/$/, "");
  }
  if (typeof window !== "undefined" && window.__CONFIG__ && window.__CONFIG__.backendUrl) {
    return String(window.__CONFIG__.backendUrl).replace(/\/$/, "");
  }
  if (typeof window !== "undefined" && window.location && window.location.origin) {
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

/* Small UI helpers (unchanged) */
function ImageSlider({ images = [] }) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!images || images.length === 0) return;
    const t = setInterval(() => setActive((p) => (p + 1) % images.length), 3500);
    return () => clearInterval(t);
  }, [images]);
  if (!images || images.length === 0) return null;
  return (
    <div className="flex flex-col items-center justify-center w-full h-full">
      <div className="rounded-3xl overflow-hidden shadow-2xl border-4 border-[#19a6e7] h-[220px] sm:h-[320px] w-[340px] sm:w-[500px] max-w-full bg-white/75 flex items-center justify-center mt-6 sm:mt-10">
        <img src={images[active]} alt={`Slide ${active + 1}`} className="object-cover w-full h-full" loading="lazy" />
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
  if (!event) return <div className="text-[#21809b]">No event details available</div>;
  const logoGradient = "linear-gradient(90deg, #ffba08 0%, #19a6e7 60%, #21809b 100%)";
  const logoBlue = "#21809b";
  const logoDark = "#196e87";
  return (
    <div className="flex flex-col items-center justify-center h-full w-full mt-6">
      <div className="font-extrabold text-3xl sm:text-5xl mb-3 text-center" style={{ background: logoGradient, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
        {event?.name || "Event Name"}
      </div>
      <div className="text-xl sm:text-2xl font-bold mb-1 text-center" style={{ color: logoBlue }}>
        {event?.date || event?.dates || "Event Date"}
      </div>
      <div className="text-base sm:text-xl font-semibold text-center" style={{ color: logoDark }}>
        {event?.venue || "Event Venue"}
      </div>
      {event?.tagline && <div className="text-base sm:text-xl font-semibold text-center text-[#21809b] mt-2">{event.tagline}</div>}
    </div>
  );
}

/* Utility helpers (unchanged) */
function findFieldValue(obj = {}, candidates = []) {
  if (!obj || typeof obj !== "object") return "";
  const keys = Object.keys(obj);
  const normCandidates = candidates.map((s) => String(s).replace(/[^a-z0-9]/gi, "").toLowerCase());
  for (const k of keys) {
    const kn = String(k).replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (normCandidates.includes(kn)) {
      const v = obj[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
    }
  }
  for (const k of keys) {
    const kn = String(k).replace(/[^a-z0-9]/gi, "").toLowerCase();
    for (const cand of normCandidates) {
      if (kn.includes(cand) || cand.includes(kn)) {
        const v = obj[k];
        if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
      }
    }
  }
  for (const k of keys) {
    const kn = String(k).replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (kn.includes("company") || kn.includes("organization") || kn.includes("org")) {
      const v = obj[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
    }
  }
  return "";
}
async function toBase64(pdf) {
  if (!pdf) return "";
  if (typeof pdf === "string") {
    const m = pdf.match(/^data:application\/pdf;base64,(.*)$/i);
    if (m) return m[1];
    if (/^[A-Za-z0-9+/=]+$/.test(pdf)) return pdf;
    return "";
  }
  if (pdf instanceof ArrayBuffer) pdf = new Blob([pdf], { type: "application/pdf" });
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
}
async function sendMailPayload(payload) {
  const res = await fetch(apiUrl("/api/mailer"), {
    method: "POST",
    headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
    body: JSON.stringify(payload),
  });
  let body = null;
  try { body = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, body };
}

/* Helper: fetch logo URL from server endpoint */
async function fetchLogoUrlFromServer() {
  try {
    const r = await fetch(apiUrl("/api/admin/logo-url"), { headers: { Accept: "application/json", "ngrok-skip-browser-warning": "69420" } });
    if (!r.ok) return "";
    const js = await r.json().catch(() => null);
    return js?.logo_url || js?.logoUrl || js?.url || "";
  } catch (e) {
    return "";
  }
}

/* Build & send templated email using buildTicketEmail (unchanged) */
/* Replace the existing sendTemplatedAckEmail function with the following in src/pages/Exhibitors.jsx */
async function sendTemplatedAckEmail(exhibitor, insertedId, eventDetails = {}, images = [], pdfBlob = null, config = {}) {
  const to = exhibitor.email || (exhibitor._rawForm && (exhibitor._rawForm.email || exhibitor._rawForm.contactEmail)) || "";
  if (!to) return { ok: false, error: "no-recipient" };

  // Pass a frontendBase so buildTicketEmail can resolve relative paths server-side.
  const frontendBase = (typeof window !== "undefined" && (window.__FRONTEND_BASE__ || window.location.origin)) || "";

  // Do not call /api/admin/logo-url from the browser (removed).
  // If config contains an explicit logo reference, keep it as a fallback, but do not rely on it for correctness.
  let logoUrl = "";
  if (config && (config.logoUrl || config.topbarLogo || (config.adminTopbar && config.adminTopbar.logoUrl))) {
    logoUrl = normalizeAdminUrl(config.logoUrl || config.topbarLogo || (config.adminTopbar && config.adminTopbar.logoUrl)) || "";
  } else {
    try {
      const raw = localStorage.getItem("admin:topbar");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.logoUrl) logoUrl = normalizeAdminUrl(parsed.logoUrl) || String(parsed.logoUrl).trim();
      }
    } catch {}
  }
  logoUrl = logoUrl || "";

  const emailModel = {
    // Pass frontendBase so buildTicketEmail will try to fetch admin-config / resolve relative uploads using this base.
    frontendBase,
    entity: "exhibitors",
    id: insertedId || exhibitor.insertedId || exhibitor.id || "",
    name: exhibitor.name || exhibitor.company || (exhibitor._rawForm && (exhibitor._rawForm.name || exhibitor._rawForm.company)) || "",
    company: exhibitor.company || exhibitor._rawForm?.company || "",
    ticket_category: exhibitor.ticket_category || exhibitor._rawForm?.ticket_category || "",
    badgePreviewUrl: "",
    downloadUrl: "",
    // Pass fallback logoUrl (optional); mailer will prefer server-resolved admin-config.
    logoUrl,
    form: exhibitor._rawForm || exhibitor || {},
    pdfBase64: null,
  };

  // Let buildTicketEmail fetch admin-config server-side when called on the server, or use frontendBase to build absolute URLs.
  const { subject, text, html, attachments: templateAttachments = [] } = await buildTicketEmail(emailModel);

  const attachments = Array.isArray(templateAttachments) ? [...templateAttachments] : [];
  if (pdfBlob) {
    const b64 = await toBase64(pdfBlob);
    if (b64) attachments.push({ filename: `e-badge.pdf`, content: b64, encoding: "base64", contentType: "application/pdf" });
  }

  const mailPayload = { to, subject, text, html, logoUrl, attachments };
  return await sendMailPayload(mailPayload);
}
/* API helpers (unchanged) */
async function saveExhibitorApi(payload) {
  const res = await fetch(apiUrl("/api/exhibitors"), {
    method: "POST",
    headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
    body: JSON.stringify(payload),
  });
  const txt = await res.text().catch(() => null);
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch { json = { raw: txt }; }
  if (!res.ok) {
    const errMsg = (json && (json.message || json.error)) || `Save failed (${res.status})`;
    throw new Error(errMsg);
  }
  return json;
}

/* REMINDER helper */
async function scheduleReminder(entityId, eventDate) {
  try {
    if (!entityId || !eventDate) return;
    const payload = { entity: "exhibitors", entityId, eventDate };
    const res = await fetch(apiUrl("/api/reminders/send"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.warn("[Exhibitors] reminder scheduling failed:", res.status, txt);
    }
  } catch (e) {
    console.warn("[Exhibitors] scheduleReminder error:", e);
  }
}

async function saveStep(stepName, data = {}, meta = {}) {
  try {
    await fetch(apiUrl("/api/exhibitors/step"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
      body: JSON.stringify({ step: stepName, data, meta }),
    });
  } catch (e) {
    console.warn("[Exhibitors] saveStep failed:", e);
  }
}

/* ---------- DEFAULTS for Exhibitors fields ---------- */
const DEFAULT_EXHIBITOR_FIELDS = [
  { name: "name", label: "Name", type: "text", required: true, visible: true },
  { name: "email", label: "Email", type: "email", required: true, visible: true },
  { name: "mobile", label: "Mobile No.", type: "text", required: true, visible: true, meta: { useOtp: true } },
  { name: "designation", label: "Designation", type: "text", required: false, visible: true },
  { name: "company", label: "Company / Organization", type: "text", required: false, visible: true },
  { name: "stall_size", label: "Stall / Booth Size", type: "select", options: ["3x3", "3x6", "6x6", "Custom"], required: false, visible: true },
  { name: "product_category", label: "Product / Service Category", type: "text", required: false, visible: true },
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
  const [savedId, setSavedId] = useState(null);

  const [ticketCategory, setTicketCategory] = useState("");
  const [ticketMeta, setTicketMeta] = useState({ price: 0, gstRate: 0, gstAmount: 0, total: 0, label: "" });

  const [txId, setTxId] = useState("");
  const [proofFile, setProofFile] = useState(null);

  const videoRef = useRef(null);
  const apiBase = getApiBaseFromEnvOrWindow();

  async function fetchConfig() {
    setLoading(true);
    try {
      const url = apiUrl("/api/exhibitor-config?cb=" + Date.now());
      const r = await fetch(url, { cache: "no-store", headers: { Accept: "application/json", "ngrok-skip-browser-warning": "69420" } });
      const raw = r.ok ? await r.json().catch(() => ({})) : {};
      // support both shapes: { config: {...} } or {...} directly
      const cfg = raw && raw.config ? raw.config : raw;

      const normalized = { ...(cfg || {}) };

      // Ensure fields array exists
      normalized.fields = Array.isArray(normalized.fields) ? normalized.fields : [];

      // Merge defaults if fields missing
      try {
        const existing = new Set(normalized.fields.map(f => (f && f.name) ? f.name : ""));
        DEFAULT_EXHIBITOR_FIELDS.forEach(def => {
          if (!existing.has(def.name)) normalized.fields.push(clone(def));
        });
      } catch (e) { /* ignore */ }

      // normalize images/background/terms
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

      if (normalized.termsUrl) normalized.termsUrl = normalizeAdminUrl(normalized.termsUrl);
      normalized.images = Array.isArray(normalized.images) ? normalized.images.map(normalizeAdminUrl) : [];
      normalized.eventDetails = typeof normalized.eventDetails === "object" && normalized.eventDetails ? normalized.eventDetails : {};

      // ensure email fields are OTP-enabled by default if not explicitly disabled
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
      setConfig({ fields: DEFAULT_EXHIBITOR_FIELDS.slice(), images: [], backgroundMedia: { type: "image", url: "" }, eventDetails: {} });
      setError("Failed to load configuration.");
    } finally {
      setLoading(false);
    }
  }

  const fetchCanonicalEvent = async () => {
    try {
      const url = apiUrl("/api/configs/event-details");
      const r = await fetch(`${url}?cb=${Date.now()}`, { cache: "no-store", headers: { Accept: "application/json", "ngrok-skip-browser-warning": "69420" } });
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
      // fallback legacy
      const r2 = await fetch(apiUrl("/api/event-details?cb=" + Date.now()), { cache: "no-store", headers: { Accept: "application/json", "ngrok-skip-browser-warning": "69420" } }).catch(() => null);
      if (r2 && r2.ok) {
        const js2 = await r2.json().catch(() => ({}));
        setCanonicalEvent({ name: js2.name || "", date: js2.date || js2.dates || "", venue: js2.venue || "", time: js2.time || "", tagline: js2.tagline || "" });
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
    const onCfg = () => { fetchConfig(); fetchCanonicalEvent(); };
    const onConfigUpdated = (e) => {
      const key = e && e.detail && e.detail.key ? e.detail.key : null;
      if (!key || key === "event-details") fetchCanonicalEvent().catch(()=>{});
    };
    window.addEventListener("exhibitor-config-updated", onCfg);
    window.addEventListener("config-updated", onConfigUpdated);
    window.addEventListener("event-details-updated", fetchCanonicalEvent);
    return () => {
      window.removeEventListener("exhibitor-config-updated", onCfg);
      window.removeEventListener("config-updated", onConfigUpdated);
      window.removeEventListener("event-details-updated", fetchCanonicalEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleFormSubmit(formData) {
    setError("");
    setForm(formData || {});
    await saveStep("registration_attempt", { form: formData }).catch(() => {});
    setStep(2);
  }

  function handleTicketSelect(value, meta = {}) {
    setTicketCategory(value);
    const price = Number(meta.price || 0);
    const gstRate = Number(meta.gst || meta.gstRate || 0);
    const gstAmount = Math.round(price * gstRate);
    const total = meta.total !== undefined ? Number(meta.total) : price + gstAmount;
    setTicketMeta({ price, gstRate, gstAmount, total, label: meta.label || "" });

    if (total === 0) {
      finalizeSave({ ticket_category: value, ticket_price: price, ticket_gst: gstAmount, ticket_total: total });
      return;
    }
    setStep(3);
  }

  async function createOrderAndOpenCheckout() {
    setError("");
    if (!form) { setError("Please fill the form first."); return; }
    const amount = Number(ticketMeta.total || ticketMeta.price || 0);
    if (!amount || amount <= 0) { setError("Invalid payment amount."); return; }
    try {
      const payload = { amount, currency: "INR", description: `Exhibitor Ticket - ${ticketCategory}`, reference_id: form.email || `guest-${Date.now()}`, metadata: { ticketCategory, email: form.email || "" } };
      const res = await fetch(apiUrl("/api/payment/create-order"), { method: "POST", headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" }, body: JSON.stringify(payload) });
      const js = await res.json().catch(() => ({}));
      if (!res.ok || !js.success) { setError(js.error || "Failed to create payment order"); return; }
      const checkoutUrl = js.checkoutUrl || js.longurl || js.raw?.payment_request?.longurl || js.raw?.longurl;
      if (!checkoutUrl) { setError("Payment provider did not return a checkout URL."); return; }
      const w = window.open(checkoutUrl, "_blank", "noopener,noreferrer");
      if (!w) { setError("Popup blocked. Allow popups to continue payment."); return; }

      let attempts = 0;
      const poll = setInterval(async () => {
        attempts += 1;
        try {
          const st = await fetch(apiUrl(`/api/payment/status?reference_id=${encodeURIComponent(String(payload.reference_id))}`), { headers: { "ngrok-skip-browser-warning": "69420" } });
          if (!st.ok) return;
          const js2 = await st.json().catch(() => ({}));
          const status = (js2.status || "").toString().toLowerCase();
          if (["paid", "captured", "completed", "success"].includes(status)) {
            clearInterval(poll);
            try { if (w && !w.closed) w.close(); } catch {}
            const providerPaymentId = js2.record?.provider_payment_id || js2.record?.payment_id || js2.record?.id || null;
            setTxId(providerPaymentId || "");
            await finalizeSave({ ticket_category: ticketCategory, ticket_price: ticketMeta.price, ticket_gst: ticketMeta.gstAmount, ticket_total: ticketMeta.total });
          } else if (["failed", "cancelled", "void"].includes(status)) {
            clearInterval(poll);
            try { if (w && !w.closed) w.close(); } catch {}
            setError("Payment failed or cancelled. Please retry.");
          } else if (attempts > 40) {
            clearInterval(poll);
            setError("Payment not confirmed yet. If you completed payment, wait a bit and retry.");
          }
        } catch (e) {}
      }, 3000);
    } catch (e) {
      console.error("createOrderAndOpenCheckout error", e);
      setError("Payment initiation failed.");
    }
  }

  async function uploadProofFile(file) {
    if (!file) return "";
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(apiUrl("/api/upload-asset"), { method: "POST", headers: { "ngrok-skip-browser-warning": "69420" }, body: fd });
      if (!r.ok) { console.warn("proof upload failed", await r.text().catch(() => "")); return ""; }
      const js = await r.json().catch(() => null);
      return js?.imageUrl || js?.fileUrl || js?.url || js?.path || "";
    } catch (e) { console.warn("uploadProofFile failed", e); return ""; }
  }

  async function finalizeSave({ ticket_category, ticket_price = 0, ticket_gst = 0, ticket_total = 0 } = {}) {
    setError("");
    const companyCandidates = ["companyName", "company", "company_name", "company name", "organization", "organizationName", "organization_name", "companyTitle", "companytitle"];
    let companyValue = findFieldValue(form || {}, companyCandidates);
    if (!companyValue && form && typeof form._rawForm === "object") companyValue = findFieldValue(form._rawForm, companyCandidates);
    companyValue = companyValue || "";

    let proofUrl = "";
    if (proofFile) proofUrl = await uploadProofFile(proofFile);

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
      ticket_category: ticket_category || ticketCategory || null,
      ticket_price,
      ticket_gst,
      ticket_total,
      txId: txId || null,
      payment_proof_url: proofUrl || null,
      termsAccepted: !!form.termsAccepted,
      _rawForm: form,
    };

    try {
      const json = await saveExhibitorApi(payload);
      if (json?.insertedId) {
        setSavedId(json.insertedId);
        scheduleReminder(json.insertedId, config?.eventDetails?.date).catch(() => {});
        let pdf = null;
        try {
          if (typeof generateVisitorBadgePDF === "function") {
            pdf = await generateVisitorBadgePDF({ ...payload, id: json.insertedId }, config?.badgeTemplateUrl || "", { includeQRCode: true, qrPayload: { n: payload.name, e: payload.email, c: json?.ticket_code || payload.ticket_code || "" }, event: config?.eventDetails || {} });
          }
        } catch (e) { console.warn("PDF gen failed", e); pdf = null; }

        (async () => {
          try {
            await sendTemplatedAckEmail(payload, json.insertedId, config?.eventDetails || {}, config?.images || [], pdf, config);
          } catch (e) { console.warn("Ack email failed", e); }
        })();
      } else {
        (async () => {
          try { await sendTemplatedAckEmail(payload, null, config?.eventDetails || {}, config?.images || [], null, config); } catch (e) { console.warn("Ack email failed", e); }
        })();
      }
      await saveStep("registration", { form }, { insertedId: json?.insertedId || null }).catch(() => {});
      setStep(4);
    } catch (err) {
      console.error("[Exhibitors] finalize save error:", err);
      setError(err.message || "Failed to save registration");
    }
  }

  function handlePaymentProofSubmitted() {
    finalizeSave({ ticket_category: ticketCategory, ticket_price: ticketMeta.price, ticket_gst: ticketMeta.gstAmount, ticket_total: ticketMeta.total });
  }

  return (
    <div className="min-h-screen w-full relative">
      {config?.backgroundMedia?.type === "video" && config?.backgroundMedia?.url ? (
        <video src={config.backgroundMedia.url} autoPlay muted loop playsInline className="fixed inset-0 w-full h-full object-cover" onError={(e) => console.error("Video error", e)} />
      ) : config?.backgroundMedia?.type === "image" && config?.backgroundMedia?.url ? (
        <div className="fixed inset-0 -z-10" style={{ backgroundImage: `url(${config.backgroundMedia.url})`, backgroundSize: "cover", backgroundPosition: "center" }} />
      ) : null}

      <div className="absolute inset-0 bg-white/50 pointer-events-none" style={{ zIndex: -900 }} />

      <div className="relative z-10">
        <Topbar />
        <div className="max-w-7xl mx-auto pt-8">
          <div className="flex flex-col sm:flex-row items-stretch mb-10" style={{ minHeight: 370 }}>
            <div className="sm:w-[60%] w-full flex items-center justify-center">
              {loading ? <div className="text-[#21809b] text-2xl font-bold">Loading...</div> : <ImageSlider images={config?.images || []} />}
            </div>
            <div className="sm:w-[40%] w-full flex items-center justify-center">
              {loading ? <div className="text-[#21809b] text-xl font-semibold">Loading event details...</div> : <EventDetailsBlock event={canonicalEvent || config?.eventDetails || null} />}
            </div>
          </div>

          <SectionTitle />

          {!loading && step === 1 && (
            <div className="mx-auto w-full max-w-2xl">
              <DynamicRegistrationForm config={config} form={form} setForm={setForm} onSubmit={handleFormSubmit} editable apiBase={apiBase} terms={{ url: config?.termsUrl, label: config?.termsLabel || "Terms & Conditions", required: !!config?.termsRequired }} />
            </div>
          )}

          {!loading && step === 2 && (
            <div className="mx-auto w-full max-w-4xl">
              <TicketCategorySelector role="exhibitors" value={ticketCategory} onChange={handleTicketSelect} />
            </div>
          )}

          {!loading && step === 3 && (
            <div className="mx-auto w-full max-w-2xl">
              <ManualPaymentStep ticketType={ticketCategory} ticketPrice={ticketMeta.total || ticketMeta.price || 0} onProofUpload={handlePaymentProofSubmitted} onTxIdChange={(val) => setTxId(val)} txId={txId} proofFile={proofFile} setProofFile={setProofFile} apiBase={apiBase} />
              <div className="flex justify-center mt-4">
                <button className="px-6 py-2 bg-[#196e87] text-white rounded" onClick={() => createOrderAndOpenCheckout()} disabled={!ticketMeta.total || ticketMeta.total <= 0}>
                  Pay & Complete
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="my-6">
              <ThankYouMessage email={form.email || ""} />
            </div>
          )}

          {error && <div className="text-red-600 font-semibold mb-2 text-center">{error}</div>}

          <footer className="mt-16 text-center text-[#21809b] font-semibold py-6 text-lg">© {new Date().getFullYear()} { (canonicalEvent && canonicalEvent.name) || config?.eventDetails?.name || "RailTrans Expo" }</footer>
        </div>
      </div>
    </div>
  );
}