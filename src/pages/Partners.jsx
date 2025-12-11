import React, { useEffect, useState, useRef, useCallback } from "react";
import Topbar from "../components/Topbar";
import DynamicRegistrationForm from "./DynamicRegistrationForm";
import TicketCategorySelector from "../components/TicketCategoryGenerator";
import ManualPaymentStep from "../components/ManualPayemntStep";
import ThankYouMessage from "../components/ThankYouMessage";
import { generateVisitorBadgePDF } from "../utils/pdfGenerator";
import { buildTicketEmail } from "../utils/emailTemplate";

/*
 Partners.jsx

 Fixes applied:
 - Await buildTicketEmail (it may be async).
 - Filter out image attachments returned by the template before posting to /api/mailer.
 - Always pass a canonical frontendBase to buildTicketEmail (getApiBaseFromEnvOrWindow()).
 - Keep ngrok header for fetch calls; defensive logging for mail payload.
*/

function getApiBaseFromEnvOrWindow() {
  if (typeof process !== "undefined" && process.env && process.env.REACT_APP_API_BASE)
    return process.env.REACT_APP_API_BASE.replace(/\/$/, "");
  if (typeof process !== "undefined" && process.env && process.env.REACT_APP_API_BASE_URL)
    return process.env.REACT_APP_API_BASE_URL.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.__API_BASE__) return String(window.__API_BASE__).replace(/\/$/, "");
  if (typeof window !== "undefined" && window.__CONFIG__ && window.__CONFIG__.backendUrl) return String(window.__CONFIG__.backendUrl).replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location && window.location.origin) return window.location.origin.replace(/\/$/, "");
  return "/api";
}
const API_BASE = getApiBaseFromEnvOrWindow();

function apiUrl(path) {
  if (!path) return API_BASE;
  if (/^https?:\/\//i.test(path)) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE.replace(/\/$/, "")}${p}`;
}

function normalizeAdminUrl(url) {
  if (!url) return "";
  const t = String(url).trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  if (t.startsWith("//")) return (typeof window !== "undefined" ? window.location.protocol : "https:") + t;
  if (t.startsWith("/")) return apiUrl(t);
  return apiUrl(`/${t}`);
}

/* small helpers */
function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

function pickFirstString(obj, candidates = []) {
  if (!obj || typeof obj !== "object") return "";
  for (const cand of candidates) {
    if (Object.prototype.hasOwnProperty.call(obj, cand)) {
      const v = obj[cand];
      if (typeof v === "string" && v.trim()) return v.trim();
      if ((typeof v === "number" || typeof v === "boolean") && String(v).trim()) return String(v).trim();
    }
    for (const k of Object.keys(obj)) {
      if (k.toLowerCase() === String(cand).toLowerCase()) {
        const v = obj[k];
        if (typeof v === "string" && v.trim()) return v.trim();
        if ((typeof v === "number" || typeof v === "boolean") && String(v).trim()) return String(v).trim();
      }
    }
  }
  for (const v of Object.values(obj)) {
    if (!v) continue;
    if (typeof v === "string" && v.trim()) return v.trim();
    if (v && typeof v === "object") {
      if (typeof v.mobile === "string" && v.mobile.trim()) return v.mobile.trim();
      if (typeof v.phone === "string" && v.phone.trim()) return v.phone.trim();
      if (typeof v.email === "string" && v.email.trim()) return v.email.trim();
      if (typeof v.name === "string" && v.name.trim()) return v.name.trim();
      if (typeof v.company === "string" && v.company.trim()) return v.company.trim();
    }
  }
  return "";
}

/* postJSON wrapper with ngrok header and structured response */
async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "69420",
    },
    body: JSON.stringify(body),
  });
  let text = null;
  let json = null;
  try { text = await res.text(); } catch {}
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { ok: res.ok, status: res.status, body: json || text || null };
}

/* upload asset with ngrok header */
async function uploadAsset(file) {
  if (!file) return "";
  try {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(apiUrl("/api/upload-asset"), {
      method: "POST",
      headers: { "ngrok-skip-browser-warning": "69420" },
      body: fd,
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.warn("uploadAsset failed", txt);
      return "";
    }
    const js = await r.json().catch(() => null);
    return js?.imageUrl || js?.fileUrl || js?.url || js?.path || "";
  } catch (e) {
    console.warn("uploadAsset error", e);
    return "";
  }
}

/* resolve logo url from server / fallback localStorage */
async function resolveLogoUrl(config = {}) {
  try {
    const r = await fetch(apiUrl("/api/admin/logo-url"), { headers: { Accept: "application/json", "ngrok-skip-browser-warning": "69420" } });
    if (r.ok) {
      const js = await r.json().catch(() => null);
      const candidate = js?.logo_url || js?.logoUrl || js?.url || "";
      if (candidate) return normalizeAdminUrl(candidate);
    }
  } catch (e) {}
  if (config && (config.logoUrl || config.topbarLogo || (config.adminTopbar && config.adminTopbar.logoUrl))) {
    return normalizeAdminUrl(config.logoUrl || config.topbarLogo || (config.adminTopbar && config.adminTopbar.logoUrl)) || "";
  }
  try {
    const raw = localStorage.getItem("admin:topbar");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.logoUrl) return normalizeAdminUrl(parsed.logoUrl) || String(parsed.logoUrl).trim();
    }
  } catch {}
  return "";
}

/* schedule reminder wrapper using /api/reminders/send */
async function scheduleReminder(partnerId, eventDate) {
  try {
    if (!partnerId || !eventDate) return { ok: false, error: "missing" };
    const payload = { entity: "partners", entityId: partnerId, eventDate };
    return await postJSON(apiUrl("/api/reminders/send"), payload);
  } catch (e) {
    console.warn("scheduleReminder failed", e);
    return { ok: false, error: String(e) };
  }
}

/* Helper: detect image attachment client-side */
function isImageAttachment(a = {}) {
  const ct = String(a.contentType || a.content_type || a.type || "").toLowerCase();
  if (ct && ct.startsWith("image/")) return true;
  const fn = String(a.filename || a.name || a.path || "").toLowerCase();
  if (fn.endsWith(".png") || fn.endsWith(".jpg") || fn.endsWith(".jpeg") || fn.endsWith(".gif") || fn.endsWith(".webp") || fn.endsWith(".svg")) return true;
  return false;
}

/* sendTemplatedAckEmail: uses buildTicketEmail (awaited), filters image attachments */
async function sendTemplatedAckEmail(partnerPayload, partnerId = null, images = [], pdfBlob = null, cfg = {}) {
  try {
    const to = pickFirstString(partnerPayload, ["email", "emailAddress", "contactEmail"]) || "";
    if (!to) return { ok: false, error: "no-recipient" };

    const frontendBase = getApiBaseFromEnvOrWindow();
    const bannerUrl = Array.isArray(images) && images.length ? images[0] : "";
    const logoUrl = await resolveLogoUrl(cfg);

    const formObj = partnerPayload._rawForm || partnerPayload.form || partnerPayload || {};

    const model = {
      frontendBase,
      entity: "partners",
      id: partnerId || "",
      name: partnerPayload.name || partnerPayload.company || pickFirstString(formObj, ["name", "company"]) || "",
      company: partnerPayload.company || formObj.company || "",
      ticket_code: partnerPayload.ticket_code || partnerPayload.ticketCode || "",
      ticket_category: partnerPayload.ticket_category || "",
      bannerUrl,
      badgePreviewUrl: "",
      downloadUrl: "",
      logoUrl: logoUrl || "",
      form: formObj,
      pdfBase64: null,
    };

    // buildTicketEmail may be async — await it
    const built = await buildTicketEmail(model);
    const subject = built.subject || "(no subject)";
    const text = built.text || "";
    const html = built.html || "";
    const templateAttachments = Array.isArray(built.attachments) ? built.attachments : [];

    // Filter out image attachments defensively (so mailer doesn't receive image attachments)
    const attachments = templateAttachments.filter((a) => !isImageAttachment(a)).map((a) => {
      const out = {};
      if (a.filename) out.filename = a.filename;
      if (a.content) out.content = a.content;
      if (a.encoding) out.encoding = a.encoding;
      if (a.contentType || a.content_type) out.contentType = a.contentType || a.content_type;
      return out;
    });

    // Attach pdfBlob if present
    if (pdfBlob) {
      // accept base64 string or Blob
      if (typeof pdfBlob === "string") {
        const m = pdfBlob.match(/^data:application\/pdf;base64,(.*)$/i);
        const b64 = m ? m[1] : ( /^[A-Za-z0-9+/=]+$/.test(pdfBlob) ? pdfBlob : null );
        if (b64) {
          attachments.push({ filename: "e-badge.pdf", content: b64, encoding: "base64", contentType: "application/pdf" });
        }
      } else {
        // try to convert Blob to base64 (client-only)
        try {
          const b64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = reader.result || "";
              resolve(String(result).split(",")[1] || "");
            };
            reader.onerror = reject;
            reader.readAsDataURL(pdfBlob);
          });
          if (b64) attachments.push({ filename: "e-badge.pdf", content: b64, encoding: "base64", contentType: "application/pdf" });
        } catch (e) { /* ignore */ }
      }
    }

    const payload = { to, subject, text, html, attachments };

    try { console.debug("[Partners] mailPayload preview:", { to: payload.to, subject: payload.subject, htmlStart: String(payload.html || "").slice(0, 240), attachmentsCount: payload.attachments.length }); } catch (e) {}

    const r = await fetch(apiUrl("/api/mailer"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
      body: JSON.stringify(payload),
    });
    const txt = await r.text().catch(() => "");
    let js = null;
    try { js = txt ? JSON.parse(txt) : null; } catch {}
    if (!r.ok) {
      console.warn("[Partners] mailer failed:", r.status, js || txt);
      return { ok: false, status: r.status, body: js || txt, error: `mailer failed (${r.status})` };
    }
    return { ok: true, status: r.status, body: js || txt };
  } catch (e) {
    console.warn("sendTemplatedAckEmail failed", e);
    return { ok: false, error: String(e) };
  }
}

/* API helpers */
async function savePartnerApi(payload) {
  const res = await fetch(apiUrl("/api/partners"), {
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

/* defaults */
const DEFAULT_PARTNER_FIELDS = [
  { name: "company", label: "Company / Organisation", type: "text", required: true, visible: true },
  { name: "name", label: "Contact person", type: "text", required: true, visible: true },
  { name: "mobile", label: "Mobile No.", type: "text", required: true, visible: true, meta: { useOtp: false } },
  { name: "email", label: "Email", type: "email", required: false, visible: true },
  { name: "designation", label: "Designation", type: "text", required: false, visible: true },
  { name: "businessType", label: "Business Type", type: "text", required: false, visible: true },
  { name: "partnership", label: "Partnership Interested In", type: "text", required: false, visible: true },
];

/* image slider */
function ImageSlider({ images = [], intervalMs = 4000 }) {
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
};

/* component */
export default function Partners() {
  const [config, setConfig] = useState(null);
  const [canonicalEvent, setCanonicalEvent] = useState(null);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");

  const [ticketCategory, setTicketCategory] = useState("");
  const [ticketMeta, setTicketMeta] = useState({ price: 0, gstRate: 0, gstAmount: 0, total: 0, label: "" });
  const [paymentReferenceId, setPaymentReferenceId] = useState("");
  const [txId, setTxId] = useState("");
  const [proofFile, setProofFile] = useState(null);
  const [savedPartnerId, setSavedPartnerId] = useState(null);
  const [ackLoading, setAckLoading] = useState(false);
  const [ackError, setAckError] = useState("");
  const [ackResult, setAckResult] = useState(null);
  const [reminderScheduled, setReminderScheduled] = useState(false);
  const [reminderError, setReminderError] = useState("");

  const videoRef = useRef(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const onChange = () => setIsMobile(!!mq.matches);
    onChange();
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => { if (mq.removeEventListener) mq.removeEventListener("change", onChange); else mq.removeListener(onChange); };
  }, []);

  const fetchCanonicalEvent = useCallback(async () => {
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
      const r2 = await fetch(apiUrl("/api/event-details?cb=" + Date.now()), { cache: "no-store", headers: { Accept: "application/json", "ngrok-skip-browser-warning": "69420" } }).catch(() => null);
      if (r2 && r2.ok) {
        const js2 = await r2.json().catch(() => ({}));
        setCanonicalEvent({ name: js2.name || "", date: js2.date || js2.dates || "", venue: js2.venue || "", time: js2.time || "", tagline: js2.tagline || "" });
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
      const res = await fetch(apiUrl("/api/partner-config?cb=" + Date.now()), { cache: "no-store", headers: { Accept: "application/json", "ngrok-skip-browser-warning": "69420" } });
      const cfg = res.ok ? await res.json().catch(() => ({})) : {};
      const normalized = { ...(cfg || {}) };

      normalized.fields = Array.isArray(normalized.fields) ? normalized.fields : [];
      try {
        const existing = new Set((normalized.fields || []).map(f => (f && f.name) ? f.name : ""));
        DEFAULT_PARTNER_FIELDS.forEach(def => {
          if (!existing.has(def.name)) normalized.fields.push(clone(def));
        });
      } catch (e) {}

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

      normalized.images = Array.isArray(normalized.images) ? normalized.images.map(normalizeAdminUrl) : [];
      normalized.eventDetails = typeof normalized.eventDetails === "object" && normalized.eventDetails ? normalized.eventDetails : {};

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
      console.error("[Partners] fetchConfig error:", e);
      setConfig({ fields: DEFAULT_PARTNER_FIELDS.slice(), images: [], backgroundMedia: { type: "image", url: "" }, eventDetails: {} });
      setError("Failed to load configuration.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchConfig();
    fetchCanonicalEvent();
    const onCfg = () => { fetchConfig(); fetchCanonicalEvent(); };
    const onConfigUpdated = (e) => {
      const key = e && e.detail && e.detail.key ? e.detail.key : null;
      if (!key || key === "event-details") fetchCanonicalEvent().catch(()=>{});
    };
    window.addEventListener("partner-config-updated", onCfg);
    window.addEventListener("config-updated", onConfigUpdated);
    window.addEventListener("event-details-updated", fetchCanonicalEvent);
    return () => {
      window.removeEventListener("partner-config-updated", onCfg);
      window.removeEventListener("config-updated", onConfigUpdated);
      window.removeEventListener("event-details-updated", fetchCanonicalEvent);
    };
  }, []);

  /* Step 1: client-only submit */
  async function handleFormSubmit(formData) {
    setError("");
    setSaving(true);
    try {
      const email = pickFirstString(formData, ["email", "emailAddress", "contactEmail"]) || "";
      if (!email) {
        setError("Email is required to proceed.");
        setSaving(false);
        return;
      }
      setForm(formData || {});
      const ref = email.trim() || `guest-${Date.now()}`;
      setPaymentReferenceId(ref);
      try { await postJSON(apiUrl("/api/partners/step"), { step: "registration_attempt", data: { form: formData } }); } catch {}
      setStep(2);
    } catch (e) {
      console.error("handleSubmit error", e);
      setError("Failed to continue. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function handleTicketSelect(value, meta = {}) {
    setTicketCategory(value);
    const price = Number(meta.price || 0);
    const gstRate = Number(meta.gst || meta.gstRate || 0);
    const gstAmount = Math.round(price * gstRate);
    const total = (meta.total !== undefined) ? Number(meta.total) : price + gstAmount;
    setTicketMeta({ price, gstRate, gstAmount, total, label: meta.label || "" });

    if (total === 0) {
      finalizeSave({ ticket_category: value, ticket_price: price, ticket_gst: gstAmount, ticket_total: total });
      return;
    }
    setStep(3);
  }

  async function createOrderAndOpenCheckout() {
    setError("");
    setSaving(true);
    const reference = paymentReferenceId || (form && pickFirstString(form, ["email", "emailAddress", "contactEmail"])) || `guest-${Date.now()}`;
    const amount = Number(ticketMeta.total || ticketMeta.price || 0);
    if (!amount || amount <= 0) {
      setError("Invalid payment amount.");
      setSaving(false);
      return;
    }
    try {
      const payload = { amount, currency: "INR", description: `Partner Ticket - ${ticketCategory}`, reference_id: String(reference), metadata: { ticketCategory, email: form.email || "" } };
      const res = await fetch(apiUrl("/api/payment/create-order"), {
        method: "POST",
        headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
        body: JSON.stringify(payload),
      });
      const js = await res.json().catch(()=>({}));
      if (!res.ok || !js.success) { setError(js.error || "Failed to create payment order"); setSaving(false); return; }
      const checkoutUrl = js.checkoutUrl || js.checkout_url || js.longurl || js.raw?.payment_request?.longurl;
      if (!checkoutUrl) { setError("Payment provider did not return a checkout URL."); setSaving(false); return; }
      const w = window.open(checkoutUrl, "_blank", "noopener,noreferrer");
      if (!w) { setError("Popup blocked. Allow popups to continue payment."); setSaving(false); return; }

      let attempts = 0;
      const poll = setInterval(async () => {
        attempts += 1;
        try {
          const st = await fetch(apiUrl(`/api/payment/status?reference_id=${encodeURIComponent(String(reference))}`), { headers: { "ngrok-skip-browser-warning": "69420" } });
          if (!st.ok) return;
          const js2 = await st.json().catch(()=>({}));
          const status = (js2.status || "").toString().toLowerCase();
          if (["paid","captured","completed","success"].includes(status)) {
            clearInterval(poll);
            try { if (w && !w.closed) w.close(); } catch {}
            const providerPaymentId = js2.record?.provider_payment_id || js2.record?.payment_id || js2.record?.id || null;
            setTxId(providerPaymentId || "");
            await finalizeSave({ ticket_category: ticketCategory, ticket_price: ticketMeta.price, ticket_gst: ticketMeta.gstAmount, ticket_total: ticketMeta.total });
          } else if (["failed","cancelled","void"].includes(status)) {
            clearInterval(poll);
            try { if (w && !w.closed) w.close(); } catch {}
            setError("Payment failed or cancelled. Please retry.");
            setSaving(false);
          } else if (attempts > 60) {
            clearInterval(poll);
            setError("Payment not confirmed yet. If you completed payment, upload proof on the next screen.");
            setSaving(false);
          }
        } catch (e) { /* ignore */ }
      }, 3000);
    } catch (e) {
      console.error("createOrderAndOpenCheckout error", e);
      setError("Payment initiation failed.");
      setSaving(false);
    }
  }

  async function onManualProofSubmit(file) {
    setError("");
    setSaving(true);
    try {
      const proofUrl = file ? await uploadAsset(file) : "";
      await finalizeSave({ ticket_category: ticketCategory, ticket_price: ticketMeta.price, ticket_gst: ticketMeta.gstAmount, ticket_total: ticketMeta.total, payment_proof_url: proofUrl, txId: txId || null, referenceId: paymentReferenceId });
    } catch (e) {
      console.warn("onManualProofSubmit error", e);
      setError("Failed to upload proof. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function finalizeSave({ ticket_category, ticket_price = 0, ticket_gst = 0, ticket_total = 0 } = {}) {
    setError("");
    try {
      const payload = {
        ...form,
        ticket_category: ticket_category || ticketCategory || null,
        ticket_price,
        ticket_gst,
        ticket_total,
        txId: txId || null,
        payment_proof_url: proofFile ? await uploadAsset(proofFile) : null,
        termsAccepted: !!form.termsAccepted,
        _rawForm: form
      };

      const json = await savePartnerApi(payload);
      const insertedId = json?.insertedId || json?.id || null;
      if (insertedId) {
        setSavedPartnerId(insertedId);
        const evDate = (form && (form.eventDetails?.date || form.eventDates || form.date)) || config?.eventDetails?.date || (canonicalEvent && canonicalEvent.date) || null;
        if (evDate) {
          const sch = await scheduleReminder(insertedId, evDate);
          if (sch && sch.ok) { setReminderScheduled(true); setReminderError(""); } else { setReminderScheduled(false); setReminderError((sch && (sch.error || (sch.body && (sch.body.error || sch.body.message)))) || "Schedule failed"); }
        }

        let pdf = null;
        try {
          if (typeof generateVisitorBadgePDF === "function") {
            pdf = await generateVisitorBadgePDF({ ...payload, id: insertedId }, config?.badgeTemplateUrl || "", { includeQRCode: true, qrPayload: { ticket_code: json?.ticket_code || payload.ticket_code || "" }, event: config?.eventDetails || {} });
          }
        } catch (e) { console.warn("PDF gen failed", e); }

        try {
          const mailRes = await sendTemplatedAckEmail(payload, insertedId, config?.images || [], pdf, config);
          if (!mailRes || !mailRes.ok) console.warn("Ack mail returned:", mailRes);
          else setAckResult(mailRes.body || { ok: true });
        } catch (e) { console.warn("Ack email failed", e); }
      } else {
        try { await sendTemplatedAckEmail(payload, null, config?.images || [], null, config); } catch (e) { console.warn("Ack email failed", e); }
      }
      try { await postJSON(apiUrl("/api/partners/step"), { step: "registration_completed", data: { id: json?.insertedId || null, payload } }); } catch {}
      setStep(4);
    } catch (err) {
      console.error("[Partners] finalize save error:", err);
      setError(err.message || "Failed to save registration");
    }
  }

  useEffect(() => {
    fetchConfig();
    fetchCanonicalEvent();
    const onCfg = () => { fetchConfig(); fetchCanonicalEvent(); };
    const onConfigUpdated = (e) => {
      const key = e && e.detail && e.detail.key ? e.detail.key : null;
      if (!key || key === "event-details") fetchCanonicalEvent().catch(()=>{});
    };
    window.addEventListener("partner-config-updated", onCfg);
    window.addEventListener("config-updated", onConfigUpdated);
    window.addEventListener("event-details-updated", fetchCanonicalEvent);
    return () => {
      window.removeEventListener("partner-config-updated", onCfg);
      window.removeEventListener("config-updated", onConfigUpdated);
      window.removeEventListener("event-details-updated", fetchCanonicalEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen w-full relative">
      {!isMobile && config?.backgroundMedia?.type === "video" && config?.backgroundMedia?.url ? (
        <video
          src={config.backgroundMedia.url}
          autoPlay
          muted
          loop
          playsInline
          className="fixed inset-0 w-full h-full object-cover"
          onError={(e) => console.error("Video error", e)}
        />
      ) : (config?.backgroundMedia?.type === "image" && config?.backgroundMedia?.url) ? (
        <div style={{ position: "fixed", inset: 0, zIndex: -999, backgroundImage: `url(${config.backgroundMedia.url})`, backgroundSize: "cover", backgroundPosition: "center" }} />
      ) : null}
      <div style={{ position: "fixed", inset: 0, background: "rgba(255,255,255,0.55)", zIndex: -900 }} />

      <div className="relative z-10">
        <Topbar />
        <div className="max-w-7xl mx-auto pt-8">
          <div className="flex flex-col sm:flex-row items-stretch mb-10" style={{ minHeight: 370 }}>
            <div className="sm:w-[60%] w-full flex items-center justify-center">
              {loading ? <span className="text-[#21809b] text-2xl font-bold">Loading images...</span> : (config?.images && config.images.length ? <ImageSlider images={config.images} /> : <div className="text-[#21809b]"> </div>)}
            </div>

            <div className="sm:w-[40%] w-full flex items-center justify-center">
              {loading ? (
                <span className="text-[#21809b] text-xl font-semibold">Loading event details...</span>
              ) : (
                <div className="w-full px-4">
                  <div
                    className="font-extrabold text-3xl sm:text-5xl mb-3 text-center"
                    style={{
                      background: "linear-gradient(90deg,#ffba08 0%,#19a6e7 60%,#21809b 100%)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                    }}
                  >
                    {(canonicalEvent && canonicalEvent.name) || config?.eventDetails?.name || "Event Name"}
                  </div>

                  <div className="text-xl sm:text-2xl font-bold mb-1 text-center text-[#21809b]">
                    {(canonicalEvent && (canonicalEvent.date || canonicalEvent.dates)) || config?.eventDetails?.date || "Event Date"}
                  </div>

                  <div className="text-base sm:text-xl font-semibold text-center text-[#196e87]">
                    {(canonicalEvent && canonicalEvent.venue) || config?.eventDetails?.venue || "Event Venue"}
                  </div>

                  {(canonicalEvent && canonicalEvent.tagline) || config?.eventDetails?.tagline ? (
                    <div className="text-sm mt-2 text-center text-gray-700">
                      {(canonicalEvent && canonicalEvent.tagline) || config?.eventDetails?.tagline}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          <div className="w-full flex items-center justify-center my-8">
            <div className="flex-grow border-t border-[#21809b]" />
            <span className="mx-5 px-8 py-3 text-2xl font-extrabold text-[#21809b] bg-white shadow rounded-2xl">Partner Registration</span>
            <div className="flex-grow border-t border-[#21809b]" />
          </div>

          {!loading && step === 1 && config?.fields && (
            <div className="mx-auto w-full max-w-2xl">
              <DynamicRegistrationForm
                config={{ ...config, fields: config.fields }}
                form={form}
                setForm={setForm}
                onSubmit={handleFormSubmit}
                editable={true}
                saving={saving}
                terms={(config && (config.termsUrl || config.termsText)) ? { url: config.termsUrl, text: config.termsText, label: config.termsLabel || "Terms & Conditions", required: !!config.termsRequired } : null}
              />
            </div>
          )}

          {step === 2 && (
            <div className="mx-auto w-full max-w-4xl">
              <TicketCategorySelector role="partners" value={ticketCategory} onChange={handleTicketSelect} />
            </div>
          )}

          {step === 3 && (
            <div className="mx-auto w-full max-w-2xl">
              <ManualPaymentStep
                ticketType={ticketCategory}
                ticketPrice={ticketMeta.total || ticketMeta.price || 0}
                onProofUpload={(file) => onManualProofSubmit(file)}
                onTxIdChange={(val) => setTxId(val)}
                txId={txId}
                proofFile={proofFile}
                setProofFile={setProofFile}
              />
              <div className="flex justify-center gap-3 mt-4">
                <button className="px-6 py-2 bg-[#196e87] text-white rounded" onClick={() => createOrderAndOpenCheckout()} disabled={saving}>
                  {saving ? "Processing..." : "Pay & Complete"}
                </button>
              </div>
              {error && <div className="mt-3 text-red-600 font-medium text-center">{error}</div>}
            </div>
          )}

          {step === 4 && (
            <div className="my-6">
              <ThankYouMessage email={form.email || ""} />
              <div className="mt-4 text-center">
                {ackLoading && <div className="text-gray-600">Sending acknowledgement...</div>}
                {ackError && <div className="text-red-600">Acknowledgement failed: {ackError}</div>}
                {ackResult && <div className="text-green-700">Acknowledgement sent</div>}
                {reminderScheduled && <div className="text-green-700 mt-2">Reminder scheduled for event date.</div>}
                {reminderError && <div className="text-red-600 mt-2">Reminder error: {reminderError}</div>}
              </div>
            </div>
          )}

          {error && <div className="text-red-600 font-semibold mb-2 text-center">{error}</div>}

          <footer className="mt-16 text-center text-[#21809b] font-semibold py-6 text-lg">© {new Date().getFullYear()} {(canonicalEvent && canonicalEvent.name) || config?.eventDetails?.name || "RailTrans Expo"}</footer>
        </div>
      </div>
    </div>
  );
}