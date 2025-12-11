import React, { useEffect, useRef, useState, useCallback } from "react";
import Topbar from "../components/Topbar";
import DynamicRegistrationForm from "./DynamicRegistrationForm";
import TicketCategorySelector from "../components/TicketCategoryGenerator";
import ManualPaymentStep from "../components/ManualPayemntStep";
import ThankYouMessage from "../components/ThankYouMessage";
import { generateVisitorBadgePDF } from "../utils/pdfGenerator";
import { buildTicketEmail } from "../utils/emailTemplate";

/*
  Speakers.jsx (ngrok header + canonical event-details + mail safety)

  Key fixes applied:
  - Removed client-side fetching/passing of logoUrl to mail payload. Server-side mailer / emailTemplate
    will fetch the admin-config logo and resolve it using the provided frontendBase.
  - sendTemplatedEmail now awaits buildTicketEmail and filters out any image attachments before
    posting to the mailer endpoint (so images are not sent as attachments).
  - When calling buildTicketEmail we pass frontendBase (server/public API base) so the template resolves
    relative paths (/uploads/...) to absolute public URLs.
  - Minor safety / logging improvements.
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

/* helpers */
function isEmailLike(v) {
  return typeof v === "string" && /\S+@\S+\.\S+/.test(v);
}
function ticketPriceForCategory(cat) {
  if (!cat) return 0;
  const c = String(cat).toLowerCase();
  if (c === "combo") return 5000;
  if (c === "delegate") return 2500;
  if (c === "vip") return 7500;
  if (/free|general|0/.test(c)) return 0;
  return 2500;
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

/* postJSON wrapper: add ngrok header to match other pages and surface response body */
async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "69420",
    },
    body: JSON.stringify(body),
  });
  let json = null;
  let text = null;
  try { text = await res.text(); } catch {}
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { ok: res.ok, status: res.status, body: json || text || null };
}

/* upload asset helper (adds ngrok header) */
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

/* scheduleReminder helper (unchanged) */
async function scheduleReminder(entityId, eventDate) {
  if (!entityId || !eventDate) return { ok: false, error: "missing" };
  const payload = { entity: "speakers", entityId, eventDate };
  try {
    const res = await fetch(apiUrl("/api/reminders/send"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
      body: JSON.stringify(payload),
    });
    const text = await res.text().catch(() => "");
    try { const parsed = text ? JSON.parse(text) : null; if (res.ok) return { ok: true, status: res.status, body: parsed || text }; } catch {}
    if (res.ok) return { ok: true, status: res.status, body: text || null };
    const r2 = await fetch(apiUrl("/api/reminders/create"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
      body: JSON.stringify(payload),
    });
    const t2 = await r2.text().catch(() => "");
    try { const p2 = t2 ? JSON.parse(t2) : null; if (r2.ok) return { ok: true, status: r2.status, body: p2 || t2 }; } catch {}
    return { ok: false, status: r2.status, body: t2 || null };
  } catch (e) {
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

/* sendTemplatedEmail: build HTML via buildTicketEmail then POST to /api/mailer
   - Await buildTicketEmail (it may be async)
   - Filter out image attachments from template before sending
   - Attach pdfBlob (if provided) as base64 pdf
*/
async function sendTemplatedEmail({ recipientEmail, model, pdfBlob = null }) {
  if (!recipientEmail) return { ok: false, error: "no-recipient" };
  try {
    // Ensure frontendBase passed to buildTicketEmail is a public base
    const frontendBase = getApiBaseFromEnvOrWindow();

    // buildTicketEmail may be async
    const ticketEmailModel = { ...(model || {}), frontendBase };
    const built = await buildTicketEmail(ticketEmailModel);
    const subject = built.subject || "(no subject)";
    const text = built.text || "";
    const html = built.html || "";
    const templateAttachments = Array.isArray(built.attachments) ? built.attachments : [];

    // filter out image attachments defensively
    const attachments = templateAttachments.filter((a) => !isImageAttachment(a)).map((a) => {
      // normalize client-side attachment shape
      const out = {};
      if (a.filename) out.filename = a.filename;
      if (a.content) out.content = a.content;
      if (a.encoding) out.encoding = a.encoding;
      if (a.contentType || a.content_type) out.contentType = a.contentType || a.content_type;
      return out;
    });

    // include pdfBlob if present
    if (pdfBlob) {
      const b64 = await toBase64(pdfBlob);
      if (b64) {
        attachments.push({
          filename: "Ticket.pdf",
          content: b64,
          encoding: "base64",
          contentType: "application/pdf",
        });
      }
    }

    try {
      console.debug("[sendTemplatedEmail] sending mail:", { to: recipientEmail, subject, attachmentsCount: attachments.length });
    } catch (e) {}

    const res = await fetch(apiUrl("/api/mailer"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
      body: JSON.stringify({ to: recipientEmail, subject, text, html, attachments }),
    });
    const txt = await res.text().catch(() => "");
    let js = null;
    try { js = txt ? JSON.parse(txt) : null; } catch {}
    if (!res.ok) {
      console.warn("[sendTemplatedEmail] mailer response failed:", res.status, js || txt);
      return { ok: false, status: res.status, body: js || txt, error: `mailer failed (${res.status})` };
    }
    return { ok: true, status: res.status, body: js || txt };
  } catch (e) {
    console.warn("sendTemplatedEmail failed:", e);
    return { ok: false, error: String(e) };
  }
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
    const t = setInterval(() => setActive(p => (p + 1) % images.length), intervalMs);
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
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [speakerId, setSpeakerId] = useState(null);
  const [ticketCategory, setTicketCategory] = useState("");
  const [ticketMeta, setTicketMeta] = useState({ price: 0, gstRate: 0, gstAmount: 0, total: 0, label: "" });
  const [txId, setTxId] = useState("");
  const [proofFile, setProofFile] = useState(null);
  const [pdfBlob, setPdfBlob] = useState(null);
  const [speaker, setSpeaker] = useState(null);

  const [ackLoading, setAckLoading] = useState(false);
  const [ackError, setAckError] = useState("");
  const [ackResult, setAckResult] = useState(null);

  const [reminderScheduled, setReminderScheduled] = useState(false);
  const [reminderError, setReminderError] = useState("");

  const videoRef = useRef(null);
  const [isMobile, setIsMobile] = useState(false);
  const [paymentReferenceId, setPaymentReferenceId] = useState("");

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
      const url = `${apiUrl("/api/configs/event-details")}`;
      const res = await fetch(`${url}?cb=${Date.now()}`, { cache: "no-store", headers: { Accept: "application/json", "ngrok-skip-browser-warning": "69420" } });
      if (res.ok) {
        const js = await res.json().catch(() => ({}));
        const val = js && js.value !== undefined ? js.value : js;
        if (val && typeof val === "object" && Object.keys(val).length) {
          setCanonicalEvent({ name: val.name || "", date: val.date || "", venue: val.venue || "", time: val.time || "", tagline: val.tagline || "" });
          return;
        }
      }
      const legacy = await fetch(`${apiUrl("/api/event-details")}?cb=${Date.now()}`, { cache: "no-store", headers: { Accept: "application/json", "ngrok-skip-browser-warning": "69420" } }).catch(()=>null);
      if (legacy && legacy.ok) {
        const ljs = await legacy.json().catch(()=>({}));
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
      const cfg = res.ok ? await res.json().catch(()=>({})) : {};
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

      normalized.fields = normalized.fields.filter(f => {
        if (!f || typeof f !== "object") return false;
        const name = (f.name || "").toString().toLowerCase().replace(/\s+/g,"");
        const label = (f.label || "").toString().toLowerCase();
        if (["accept_terms","acceptterms","i_agree","agree"].includes(name)) return false;
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

    const onCfg = () => { fetchConfig(); fetchCanonicalEvent(); };
    const onConfigUpdated = (e) => {
      const key = e && e.detail && e.detail.key ? e.detail.key : null;
      if (!key || key === "event-details") fetchCanonicalEvent().catch(()=>{});
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
        if (prevSrc.src !== currentSrc) { try { v.load(); } catch {} prevSrc.src = currentSrc; }
        await new Promise((resolve, reject) => {
          if (!mounted) return reject(new Error("unmounted"));
          if (v.readyState >= 3) return resolve();
          const onCan = () => { cleanup(); resolve(); };
          const onErr = () => { cleanup(); reject(new Error("media error")); };
          const timer = setTimeout(() => { cleanup(); resolve(); }, 3000);
          function cleanup() { clearTimeout(timer); v.removeEventListener("canplay", onCan); v.removeEventListener("error", onErr); }
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
    return () => { mounted = false; attemptId++; try { v.removeEventListener("canplay", onCan); v.removeEventListener("error", onErr); } catch {} };
  }, [config?.backgroundMedia?.url, isMobile]);

  /* Step 1: client-only submit */
  async function handleFormSubmit(payload) {
    setError("");
    if (!isEmailLike(payload.email)) { setError("Please enter a valid email."); return; }
    setSubmitting(true);
    try {
      setForm(payload || {});
      const ref = (payload.email && payload.email.trim()) ? payload.email.trim() : `guest-${Date.now()}`;
      setPaymentReferenceId(ref);
      setStep(2);
    } catch (e) {
      setError("Failed to continue. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  /* Ticket selection */
  function handleTicketSelect(value, meta = {}) {
    setTicketCategory(value);
    const price = Number(meta.price || 0);
    const gstRate = Number(meta.gst || meta.gstRate || 0);
    const gstAmount = Math.round(price * gstRate);
    const total = (meta.total !== undefined) ? Number(meta.total) : price + gstAmount;
    setTicketMeta({ price, gstRate, gstAmount, total, label: meta.label || "" });
    if (total === 0) {
      finalizeRegistrationAndSend(null, value, null);
      return;
    }
    setStep(3);
  }

  /* Payment checkout */
  async function createOrderAndOpenCheckout() {
    setProcessing(true);
    setError("");
    const reference = paymentReferenceId || (form && form.email) || `guest-${Date.now()}`;
    const amount = Number(ticketMeta.total || ticketMeta.price || ticketPriceForCategory(ticketCategory));
    if (!amount || amount <= 0) {
      setError("Invalid payment amount.");
      setProcessing(false);
      return;
    }
    try {
      const payload = { amount, currency: "INR", description: `Speaker Ticket - ${ticketCategory}`, reference_id: String(reference), metadata: { ticketCategory, email: form.email || "" } };
      const res = await fetch(apiUrl("/api/payment/create-order"), { method: "POST", headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" }, body: JSON.stringify(payload) });
      const js = await res.json().catch(()=>({}));
      if (!res.ok || !js.success) { setError(js.error || "Failed to create payment order"); setProcessing(false); return; }
      const checkoutUrl = js.checkoutUrl || js.checkout_url || js.longurl || js.raw?.payment_request?.longurl;
      if (!checkoutUrl) { setError("Payment provider did not return a checkout URL."); setProcessing(false); return; }
      const w = window.open(checkoutUrl, "_blank", "noopener,noreferrer");
      if (!w) { setError("Popup blocked. Allow popups to continue payment."); setProcessing(false); return; }

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
            await finalizeRegistrationAndSend(providerPaymentId || null, ticketCategory, null);
          } else if (["failed","cancelled","void"].includes(status)) {
            clearInterval(poll);
            try { if (w && !w.closed) w.close(); } catch {}
            setError("Payment failed or cancelled. Please retry.");
            setProcessing(false);
          } else if (attempts > 60) {
            clearInterval(poll);
            setError("Payment not yet confirmed. If you completed payment, submit proof or wait a bit.");
            setProcessing(false);
          }
        } catch (e) {}
      }, 3000);
    } catch (e) {
      console.error("createOrderAndOpenCheckout error", e);
      setError("Payment initiation failed.");
      setProcessing(false);
    }
  }

  /* Manual proof -> upload then finalize */
  async function onManualProofSubmit(file) {
    setError("");
    try {
      const proofUrl = file ? await uploadAsset(file) : "";
      await finalizeRegistrationAndSend(txId || null, ticketCategory, proofUrl || null);
    } catch (e) {
      console.warn("onManualProofSubmit error", e);
      setError("Failed to upload proof. Try again.");
    }
  }

  /* Finalize: save speaker, generate PDF, send email, schedule reminder */
  async function finalizeRegistrationAndSend(providerTxId = null, chosenCategory = null, paymentProofUrl = null) {
    if (processing) return;
    setProcessing(true);
    setError("");
    setAckError("");
    setAckResult(null);
    setReminderError("");
    setReminderScheduled(false);

    try {
      const name = form.name || `${form.firstName || ""} ${form.lastName || ""}`.trim() || "Speaker";
      const chosen = chosenCategory || ticketCategory || "free";

      const payload = {
        ...form,
        name,
        ticket_category: chosen,
        ticket_price: ticketMeta.price || 0,
        ticket_gst: ticketMeta.gstAmount || 0,
        ticket_total: ticketMeta.total || 0,
        txId: providerTxId || txId || null,
        payment_proof_url: paymentProofUrl || null,
        referenceId: paymentReferenceId || null,
        termsAccepted: !!form.termsAccepted,
        _rawForm: form
      };

      // save speaker
      const res = await fetch(apiUrl("/api/speakers"), {
        method: "POST",
        headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
        body: JSON.stringify(payload),
      });
      const js = await res.json().catch(()=>({}));
      if (!res.ok || !(js && (js.success || js.insertedId || js.id))) {
        const em = (js && (js.error || js.message)) || `Save failed (${res.status})`;
        setError(em);
        setProcessing(false);
        return;
      }
      const insertedId = js.insertedId || js.insertId || js.id || null;
      if (insertedId) setSpeakerId(insertedId);

      // ticket_code generation / confirm
      let ticket_code = js.ticket_code || js.ticketCode || payload.ticket_code || String(Math.floor(100000 + Math.random() * 900000));
      if (insertedId) {
        try {
          await fetch(apiUrl(`/api/speakers/${encodeURIComponent(String(insertedId))}/confirm`), {
            method: "POST",
            headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
            body: JSON.stringify({ ticket_code, ticket_category: chosen, txId: providerTxId || txId || null })
          }).catch(()=>{});
        } catch (e) {}
      }

      const fullSpeaker = { ...payload, ticket_code, id: insertedId };

      // generate PDF (best-effort)
      let pdf = null;
      try {
        if (typeof generateVisitorBadgePDF === "function") {
          pdf = await generateVisitorBadgePDF(fullSpeaker, config?.badgeTemplateUrl || "", { includeQRCode: true, qrPayload: { ticket_code }, event: config?.eventDetails || {} });
          setPdfBlob(pdf);
        }
      } catch (e) { console.warn("PDF generation failed:", e); }

      // send templated email (server-side will resolve admin logo using frontendBase)
      try {
        setAckLoading(true);
        const frontendBase = getApiBaseFromEnvOrWindow();
        const safeForm = { ...(form || {}) };
        if (safeForm.eventDetails) delete safeForm.eventDetails;

        const emailModel = {
          frontendBase,
          entity: "speakers",
          id: insertedId || "",
          name,
          company: payload.company || "",
          ticket_code,
          ticket_category: chosen,
          bannerUrl: config?.images && config.images.length ? config.images[0] : "",
          badgePreviewUrl: "",
          downloadUrl: "",
          // do NOT include client-side logoUrl; server will resolve admin-config logo
          form: safeForm || {},
          pdfBase64: null,
        };

        const mailRes = await sendTemplatedEmail({ recipientEmail: payload.email, model: emailModel, pdfBlob: pdf });
        setAckLoading(false);
        if (!mailRes || !mailRes.ok) {
          setAckError((mailRes && (mailRes.error || (mailRes.body && (mailRes.body.error || mailRes.body.message)))) || `Acknowledgement failed (${mailRes && mailRes.status})`);
        } else {
          setAckResult(mailRes.body || { ok: true });
          setAckError("");
        }
      } catch (e) {
        setAckLoading(false);
        setAckError("Acknowledgement send failed");
        console.warn("templated email send error", e);
      }

      // schedule reminder using canonical event date when possible
      try {
        const evDate = config?.eventDetails?.date || (canonicalEvent && canonicalEvent.date) || (form && (form.eventDates || form.date)) || null;
        if (insertedId && evDate) {
          const sch = await scheduleReminder(insertedId, evDate);
          if (sch && sch.ok) {
            setReminderScheduled(true);
            setReminderError("");
          } else {
            setReminderScheduled(false);
            const msg = sch && (sch.error || (sch.body && (sch.body.error || sch.body.message))) || "Schedule failed";
            setReminderError(String(msg));
            console.warn("Reminder schedule response", sch);
          }
        }
      } catch (e) {
        setReminderScheduled(false);
        setReminderError("Reminder scheduling failed");
        console.warn("scheduleReminder error", e);
      }

      // optional whatsapp notify (include ngrok header)
      try {
        if (payload.mobile) {
          await fetch(apiUrl("/api/notify/whatsapp"), {
            method: "POST",
            headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
            body: JSON.stringify({ to: payload.mobile, message: `Your ticket code: ${ticket_code}` }),
          }).catch((e)=>{ console.warn("whatsapp call failed", e); });
        }
      } catch (e) { console.warn("whatsapp failed", e); }

      // admin notify (best-effort)
      try {
        const adminEmail = process.env.REACT_APP_ADMIN_EMAIL || "admin@railtransexpo.com";
        await postJSON(apiUrl("/api/mailer"), { to: adminEmail, subject: `New Speaker Registered: ${name}`, text: `Name: ${name}\nEmail: ${payload.email}\nCategory: ${chosen}\nTicket: ${ticket_code}\nTx: ${providerTxId || txId || "N/A"}` });
      } catch (e) {}

      setSpeaker(fullSpeaker);
      setStep(4);
    } catch (err) {
      console.error("finalizeRegistrationAndSend error", err);
      setError("Failed to finalize registration.");
    } finally {
      setProcessing(false);
    }
  }

  /* render */
  return (
    <div className="min-h-screen w-full relative">
      {!isMobile && config?.backgroundMedia?.type === "video" && config?.backgroundMedia?.url && (
        <video
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
              {loading ? <span className="text-[#21809b] text-2xl font-bold">Loading images...</span> : (config?.images && config.images.length ? <ImageSlider images={config.images} intervalMs={4000} /> : <div className="rounded-3xl overflow-hidden shadow-2xl border-4 border-[#19a6e7] h-[220px] sm:h-[320px] w-[340px] sm:w-[500px] max-w-full bg-white/75 flex flex-col items-center justify-center mt-6 sm:mt-10 p-4"><img src={config?.images?.[0] || "/images/speaker_placeholder.jpg"} alt="hero" className="object-cover w-full h-full" style={{ maxHeight: 220 }} /></div>)}
            </div>

            <div className="sm:w-[40%] w-full flex items-center justify-center">
              {loading ? <span className="text-[#21809b] text-xl font-semibold">Loading event details...</span> : <div className="w-full px-4"><EventDetailsBlock event={canonicalEvent || config?.eventDetails || null} /></div>}
            </div>
          </div>

          <div className="mb-6">
            <div className="flex items-center">
              <div className="flex-grow border-t border-[#21809b]" />
              <span className="mx-5 px-8 py-3 text-2xl font-extrabold text-[#21809b] bg-white rounded-2xl">Register as Speaker</span>
              <div className="flex-grow border-t border-[#21809b]" />
            </div>
          </div>

          {/* Step 1 */}
          {step === 1 && !loading && Array.isArray(config?.fields) && (
            <div className="max-w-3xl mx-auto">
              <DynamicRegistrationForm
                config={{ ...config, fields: (config.fields || []) }}
                form={form}
                setForm={setForm}
                onSubmit={handleFormSubmit}
                editable={true}
                submitting={submitting}
                terms={(config && (config.termsUrl || config.termsText)) ? { url: config.termsUrl, text: config.termsText, label: config.termsLabel || "Terms & Conditions", required: !!config.termsRequired } : null}
              />
            </div>
          )}

          {/* Step 2 */}
          {step === 2 && <div className="max-w-3xl mx-auto"><div className="bg-white rounded-2xl shadow p-6 mb-6"><h3 className="text-lg font-semibold text-[#196e87] mb-3">Choose Ticket</h3><TicketCategorySelector role="speakers" value={ticketCategory} onChange={handleTicketSelect} /></div></div>}

          {/* Step 3 */}
          {step === 3 && (
            <div className="max-w-3xl mx-auto">
              <ManualPaymentStep
                ticketType={ticketCategory}
                ticketPrice={ticketMeta.total || ticketMeta.price || ticketPriceForCategory(ticketCategory)}
                onProofUpload={(file) => onManualProofSubmit(file)}
                onTxIdChange={(val) => setTxId(val)}
                txId={txId}
                proofFile={proofFile}
                setProofFile={setProofFile}
              />
              <div className="flex justify-center gap-3 mt-4">
                <button className="px-6 py-2 bg-[#196e87] text-white rounded" onClick={() => createOrderAndOpenCheckout()} disabled={processing}>
                  {processing ? "Processing..." : "Pay & Complete"}
                </button>
              </div>
              {processing && <div className="mt-4 text-center text-gray-600">Finalizing — please wait...</div>}
              {error && <div className="mt-3 text-red-600 font-medium">{error}</div>}
            </div>
          )}

          {/* Step 4 */}
          {step === 4 && (
            <div className="max-w-3xl mx-auto">
              <ThankYouMessage email={speaker?.email || form.email} />
              <div className="mt-4 text-center">
                {ackLoading && <div className="text-gray-600">Sending acknowledgement...</div>}
                {ackError && <div className="text-red-600">Acknowledgement failed: {ackError}</div>}
                {ackResult && <div className="text-green-700">Acknowledgement sent</div>}
                {reminderScheduled && <div className="text-green-700 mt-2">Reminder scheduled for event date.</div>}
                {reminderError && <div className="text-red-600 mt-2">Reminder error: {reminderError}</div>}
              </div>
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