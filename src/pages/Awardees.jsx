import React, { useEffect, useRef, useState, useCallback } from "react";
import Topbar from "../components/Topbar";
import DynamicRegistrationForm from "./DynamicRegistrationForm";
import TicketCategorySelector from "../components/TicketCategoryGenerator";
import ManualPaymentStep from "../components/ManualPayemntStep";
import ThankYouMessage from "../components/ThankYouMessage";
import { generateVisitorBadgePDF } from "../utils/pdfGenerator";
import { buildTicketEmail } from "../utils/emailTemplate";

/*
  Awardees.jsx (fixed + canonical event-details + ngrok headers + gradient title)

  Fixes / behavior included in this file:
  - sendTemplatedEmail now:
    - ensures model.frontendBase is present (so buildTicketEmail resolves relative paths to public URL),
    - awaits buildTicketEmail (it may be async),
    - filters out image attachments returned by the template before posting to the mailer (defensive).
  - Other pages (Speakers/Partners) had similar fixes applied previously; Awardees follows same pattern.
  - All fetches include the ngrok bypass header where applicable.
*/

function getApiBaseFromEnvOrWindow() {
  if (typeof process !== "undefined" && process.env && process.env.REACT_APP_API_BASE) return process.env.REACT_APP_API_BASE.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.__API_BASE__) return String(window.__API_BASE__).replace(/\/$/, "");
  if (typeof window !== "undefined" && window.__CONFIG__ && window.__CONFIG__.backendUrl) return String(window.__CONFIG__.backendUrl).replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location && window.location.origin) return window.location.origin.replace(/\/$/, "");
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

function isEmailLike(v) { return typeof v === "string" && /\S+@\S+\.\S+/.test(v); }
const ticketPriceForCategory = (cat) => {
  if (!cat) return 0;
  const c = String(cat).toLowerCase();
  if (c === "combo") return 5000;
  if (c === "delegate") return 2500;
  if (c === "vip") return 7500;
  if (/free|general|0/.test(c)) return 0;
  return 2500;
};

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

/* Mail POST wrapper (ngrok header) */
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

/* Helper: detect image attachment meta (client-side) */
function isImageAttachmentMeta(a = {}) {
  const ct = String(a.contentType || a.content_type || a.type || "").toLowerCase();
  if (ct && ct.startsWith("image/")) return true;
  const fn = String(a.filename || a.name || a.path || "").toLowerCase();
  if (fn.endsWith(".png") || fn.endsWith(".jpg") || fn.endsWith(".jpeg") || fn.endsWith(".gif") || fn.endsWith(".webp") || fn.endsWith(".svg")) return true;
  return false;
}

/* Send templated email using buildTicketEmail
   - Ensures model.frontendBase is set (so buildTicketEmail resolves '/uploads/..' to public URL)
   - Awaits buildTicketEmail (it may be async)
   - Filters image attachments from the template before sending to mailer (defensive)
*/
async function sendTemplatedEmail({ recipientEmail, model, pdfBlob = null }) {
  if (!recipientEmail) return { ok: false, error: "no-recipient" };
  try {
    // Ensure model.frontendBase is set
    const frontendCandidate =
      (typeof window !== "undefined" && (window.__FRONTEND_BASE__ || window.location.origin)) || getApiBaseFromEnvOrWindow();
    model = { ...(model || {}), frontendBase: model && model.frontendBase ? model.frontendBase : frontendCandidate };

    // buildTicketEmail may be async and may return attachments (we filter images)
    const built = await buildTicketEmail(model);
    const subject = built.subject || "";
    const text = built.text || "";
    const html = built.html || "";
    const templateAttachments = Array.isArray(built.attachments) ? built.attachments : [];

    // Filter out image attachments defensively (many mail clients show image attachments separately)
    const safeAttachments = [];
    for (const a of templateAttachments) {
      if (isImageAttachmentMeta(a)) {
        console.log("[sendTemplatedEmail] skipping image attachment from template:", a.filename || a.path || "<unknown>");
        continue;
      }
      // normalize shape for mailer
      const out = {};
      if (a.filename) out.filename = a.filename;
      if (a.content) out.content = a.content;
      if (a.encoding) out.encoding = a.encoding;
      if (a.contentType || a.content_type) out.contentType = a.contentType || a.content_type;
      if (a.path) out.path = a.path;
      safeAttachments.push(out);
    }

    // include pdfBlob if provided
    if (pdfBlob) {
      const b64 = await toBase64(pdfBlob);
      if (b64) {
        safeAttachments.push({ filename: "Ticket.pdf", content: b64, encoding: "base64", contentType: "application/pdf" });
      }
    }

    const payload = { to: recipientEmail, subject, text, html, attachments: safeAttachments };

    try { console.debug("[sendTemplatedEmail] mail preview:", { to: recipientEmail, subject, attachmentsCount: safeAttachments.length }); } catch (e) {}

    return await sendMailPayload(payload);
  } catch (e) {
    console.warn("sendTemplatedEmail failed", e);
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

/* Robust field finder used to extract company etc. */
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

/* API helpers */
async function saveAwardeeApi(payload) {
  const res = await fetch(apiUrl("/api/awardees"), {
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

/* REMINDERS: POST /api/reminders/send (ngrok header) */
async function scheduleReminder(entityId, eventDate) {
  try {
    if (!entityId || !eventDate) return;
    const payload = { entity: "awardees", entityId, eventDate };
    const res = await fetch(apiUrl("/api/reminders/send"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.warn("[Awardees] reminder scheduling failed:", res.status, txt);
    }
  } catch (e) { console.warn("[Awardees] scheduleReminder error:", e); }
}

async function uploadProofFile(file) {
  if (!file) return "";
  try {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(apiUrl("/api/upload-asset"), { method: "POST", headers: { "ngrok-skip-browser-warning": "69420" }, body: fd });
    if (!r.ok) {
      console.warn("proof upload failed", await r.text().catch(() => ""));
      return "";
    }
    const js = await r.json().catch(() => null);
    return js?.imageUrl || js?.fileUrl || js?.url || js?.path || "";
  } catch (e) {
    console.warn("uploadProofFile failed", e);
    return "";
  }
}

/* UI helper */
function EventDetailsBlock({ event }) {
  if (!event) return <div className="text-[#21809b]">No event details available</div>;
  const logoGradient = "linear-gradient(90deg, #ffba08 0%, #19a6e7 60%, #21809b 100%)";
  return (
    <div className="flex flex-col items-center justify-center h-full w-full mt-6">
      <div className="font-extrabold text-3xl sm:text-5xl mb-3 text-center" style={{ background: logoGradient, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
        {event?.name || "Event Name"}
      </div>
      <div className="text-xl sm:text-2xl font-bold mb-1 text-center text-[#21809b]">{event?.date || "Event Date"}</div>
      <div className="text-base sm:text-xl font-semibold text-center text-[#196e87]">{event?.venue || "Event Venue"}</div>
      {event?.tagline && <div className="text-base sm:text-xl font-semibold text-center text-[#21809b] mt-2">{event.tagline}</div>}
    </div>
  );
}

/* ---------- Component ---------- */
export default function Awardees() {
  const [config, setConfig] = useState(null);
  const [canonicalEvent, setCanonicalEvent] = useState(null);
  const [form, setForm] = useState({});
  const [step, setStep] = useState(1); // 1=form,2=ticket,3=payment,4=thankyou
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  const [awardeeId, setAwardeeId] = useState(null);
  const [ticketCategory, setTicketCategory] = useState("");
  const [ticketMeta, setTicketMeta] = useState({ price: 0, gstRate: 0, gstAmount: 0, total: 0, label: "" });
  const [txId, setTxId] = useState("");
  const [proofFile, setProofFile] = useState(null);
  const [pdfBlob, setPdfBlob] = useState(null);

  const [stats, setStats] = useState(null);
  const [sendingReminders, setSendingReminders] = useState(false);

  const finalizeCalledRef = useRef(false);
  const emailSentRef = useRef(false);

  const videoRef = useRef(null);
  const [isMobile, setIsMobile] = useState(false);

  // payment reference before saving awardee
  const [referenceId, setReferenceId] = useState("");

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const onChange = () => setIsMobile(!!mq.matches);
    onChange();
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => { if (mq.removeEventListener) mq.removeEventListener("change", onChange); else mq.removeListener(onChange); };
  }, []);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/awardee-config?cb=" + Date.now()), { cache: "no-store", headers: { Accept: "application/json", "ngrok-skip-browser-warning": "69420" } });
      const cfg = res.ok ? await res.json() : {};
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
      normalized.fields = Array.isArray(normalized.fields) ? normalized.fields : [];
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
      console.error("fetchConfig error", e);
      setConfig({ fields: [], images: [], backgroundMedia: { type: "image", url: "" }, eventDetails: {} });
    } finally {
      setLoading(false);
    }
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
      console.warn("[Awardees] fetchCanonicalEvent failed", e);
      setCanonicalEvent(null);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
    fetchCanonicalEvent();
    const onCfg = () => { fetchConfig(); fetchCanonicalEvent(); };
    const onCfgUpdated = (e) => {
      const key = e && e.detail && e.detail.key ? e.detail.key : null;
      if (!key || key === "event-details") fetchCanonicalEvent().catch(()=>{});
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

    return () => {
      mounted = false;
      attemptId++;
      try { v.removeEventListener("canplay", onCan); v.removeEventListener("error", onErr); } catch {}
    };
  }, [config?.backgroundMedia?.url, isMobile]);

  // Step 1: keep form locally; DON'T POST telemetry to /api/awardees/step to avoid 404 noise.
  async function handleFormSubmit(payload) {
    setError("");
    if (!isEmailLike(payload.email)) {
      setError("Please enter a valid email.");
      return;
    }
    setSubmitting(true);
    try {
      setForm(payload || {});
      const ref = (payload.email && payload.email.trim()) ? payload.email.trim() : `guest-${Date.now()}`;
      setReferenceId(ref);
      setStep(2);
    } catch (e) {
      console.error("handleFormSubmit error", e);
      setError("Failed to proceed. Try again.");
    } finally {
      setSubmitting(false);
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
      finalizeRegistrationAndSend(null, value, null);
      return;
    }
    setStep(3);
  }

  async function createOrderAndOpenCheckout() {
    setError("");
    if (!referenceId) { setError("Missing payment reference. Please re-enter your email and try again."); return; }
    const amount = Number(ticketMeta.total || ticketMeta.price || ticketPriceForCategory(ticketCategory));
    if (!amount || amount <= 0) { setError("Invalid payment amount."); return; }

    try {
      const payload = { amount, currency: "INR", description: `Awardee Ticket - ${ticketCategory}`, reference_id: String(referenceId), metadata: { ticketCategory, email: form.email || "" } };
      const res = await fetch(apiUrl("/api/payment/create-order"), { method: "POST", headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" }, body: JSON.stringify(payload) });
      const js = await res.json().catch(() => ({}));
      if (!res.ok || !js.success) { setError(js.error || "Failed to create payment order"); return; }
      const checkoutUrl = js.checkoutUrl || js.checkout_url || js.raw?.checkout_url || js.longurl || js.raw?.payment_request?.longurl;
      if (!checkoutUrl) { setError("Payment provider did not return a checkout URL."); return; }
      const w = window.open(checkoutUrl, "_blank", "noopener,noreferrer");
      if (!w) { setError("Popup blocked. Allow popups to continue payment."); return; }

      let attempts = 0;
      const poll = setInterval(async () => {
        attempts += 1;
        try {
          const st = await fetch(apiUrl(`/api/payment/status?reference_id=${encodeURIComponent(String(referenceId))}`), { headers: { "ngrok-skip-browser-warning": "69420" } });
          if (!st.ok) return;
          const js2 = await st.json().catch(() => ({}));
          const status = (js2.status || "").toString().toLowerCase();
          if (["paid", "captured", "completed", "success"].includes(status)) {
            clearInterval(poll);
            try { if (w && !w.closed) w.close(); } catch {}
            const providerPaymentId = js2.record?.provider_payment_id || js2.record?.providerPaymentId || js2.record?.payment_id || js2.record?.id || null;
            setTxId(providerPaymentId || "");
            await finalizeRegistrationAndSend(providerPaymentId || null, ticketCategory, null);
          } else if (["failed", "cancelled", "void"].includes(status)) {
            clearInterval(poll);
            try { if (w && !w.closed) w.close(); } catch {}
            setError("Payment failed or cancelled. Please retry.");
          } else if (attempts > 60) {
            clearInterval(poll);
            setError("Payment not confirmed yet. If you completed payment, wait a bit and retry.");
          }
        } catch (e) { /* ignore */ }
      }, 3000);
    } catch (e) {
      console.error("createOrderAndOpenCheckout error", e);
      setError("Payment initiation failed.");
    }
  }

  async function onManualProofSubmit(file) {
    setError("");
    try {
      const proofUrl = file ? await uploadProofFile(file) : "";
      await finalizeRegistrationAndSend(txId || null, ticketCategory, proofUrl);
    } catch (e) {
      console.warn("onManualProofSubmit error", e);
      setError("Failed to upload proof. Try again.");
    }
  }

  async function finalizeRegistrationAndSend(providerTxId = null, chosenCategory = null, paymentProofUrl = null) {
    if (finalizeCalledRef.current) return;
    finalizeCalledRef.current = true;
    setProcessing(true);
    setError("");
    try {
      const name = form.name || `${form.firstName || ""} ${form.lastName || ""}`.trim() || "Awardee";
      const chosen = chosenCategory || ticketCategory || "free";

      const companyCandidates = ["companyName","company","company_name","company name","organization","organizationName","organization_name","companyTitle","companytitle"];
      let companyValue = findFieldValue(form || {}, companyCandidates);
      if (!companyValue && form && typeof form._rawForm === "object") companyValue = findFieldValue(form._rawForm, companyCandidates);
      companyValue = companyValue || "";

      const title = form.title || form.prefix || null;
      const awardType = form.awardType || form.award_type || null;
      const awardOther = form.awardOther || form.award_other || null;
      const bio = form.bio || null;
      const termsAccepted = !!form.termsAccepted;

      const payload = {
        title,
        name,
        mobile: form.mobile || null,
        email: form.email || null,
        designation: form.designation || null,
        organization: companyValue || "",
        companyName: companyValue || "",
        awardType,
        awardOther,
        bio,
        terms: termsAccepted,
        ticket_category: chosen,
        ticket_price: ticketMeta.price || 0,
        ticket_gst: ticketMeta.gstAmount || 0,
        ticket_total: ticketMeta.total || 0,
        txId: providerTxId || txId || null,
        payment_proof_url: paymentProofUrl || null,
        referenceId: referenceId || null,
        _rawForm: form,
      };

      const js = await saveAwardeeApi(payload);
      const id = js?.insertedId || js?.insertId || js?.id || null;
      if (id) setAwardeeId(id);

      const ticket_code = js?.ticket_code || js?.ticketCode || payload.ticket_code || (String(Math.floor(100000 + Math.random() * 900000)));
      if (!js?.ticket_code && id) {
        try {
          await fetch(apiUrl(`/api/awardees/${encodeURIComponent(String(id))}/confirm`), {
            method: "POST",
            headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
            body: JSON.stringify({ ticket_code, ticket_category: chosen, txId: providerTxId || txId || null }),
          }).catch(() => {});
        } catch (_) {}
      }

      let pdf = null;
      try {
        if (typeof generateVisitorBadgePDF === "function") {
          pdf = await generateVisitorBadgePDF({ ...payload, ticket_code }, config?.badgeTemplateUrl || "", { includeQRCode: true, qrPayload: { ticket_code }, event: config?.eventDetails || {} });
          setPdfBlob(pdf);
        }
      } catch (e) {
        console.warn("PDF generation failed:", e);
        pdf = null;
      }

      if (!emailSentRef.current) {
        emailSentRef.current = true;
        try {
          const frontendBase = (typeof window !== "undefined" && (window.__FRONTEND_BASE__ || window.location.origin)) || "";
          const bannerUrl = (config?.images && config.images.length) ? config.images[0] : "";

          let logoUrl = "";
          try {
            const r = await fetch(apiUrl("/api/admin/logo-url"), { headers: { Accept: "application/json", "ngrok-skip-browser-warning": "69420" } });
            if (r.ok) {
              const jsLogo = await r.json().catch(() => null);
              const candidate = jsLogo?.logo_url || jsLogo?.logoUrl || jsLogo?.url || "";
              if (candidate) logoUrl = normalizeAdminUrl(candidate);
            }
          } catch (e) {}
          if (!logoUrl && config && (config.logoUrl || config.topbarLogo || (config.adminTopbar && config.adminTopbar.logoUrl))) {
            logoUrl = normalizeAdminUrl(config.logoUrl || config.topbarLogo || (config.adminTopbar && config.adminTopbar.logoUrl)) || "";
          }
          if (!logoUrl) {
            try {
              const raw = localStorage.getItem("admin:topbar");
              if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.logoUrl) logoUrl = normalizeAdminUrl(parsed.logoUrl) || String(parsed.logoUrl).trim();
              }
            } catch {}
          }

          const emailModel = {
            frontendBase,
            entity: "awardees",
            id: id || "",
            name,
            company: companyValue || "",
            ticket_code,
            ticket_category: chosen,
            bannerUrl,
            badgePreviewUrl: "",
            downloadUrl: "",
            logoUrl,
            form: form || {}, // pass form so template can use registration event details
            pdfBase64: null,
          };

          await sendTemplatedEmail({ recipientEmail: payload.email, model: emailModel, pdfBlob: pdf });
        } catch (e) {
          console.warn("templated email failed", e);
        }
      }

      try {
        if (payload.mobile) {
          await fetch(apiUrl("/api/notify/whatsapp"), {
            method: "POST",
            headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
            body: JSON.stringify({ to: payload.mobile, message: `Your ticket code: ${ticket_code}` }),
          });
        }
      } catch (e) { console.warn("whatsapp failed", e); }

      try {
        const adminEmail = process.env.REACT_APP_ADMIN_EMAIL || "admin@railtransexpo.com";
        await sendMailPayload({ to: adminEmail, subject: `New Awardee: ${name}`, text: `Name: ${name}\nEmail: ${payload.email}\nTicket: ${ticket_code}\nID: ${id}` });
      } catch (e) {}

      const eventDateFromForm = (form && (form.eventDetails?.date || form.eventDates || form.event_date || form.date)) || config?.eventDetails?.date || null;
      if (id && eventDateFromForm) scheduleReminder(id, eventDateFromForm).catch(() => {});

      setStep(4);
    } catch (err) {
      console.error("finalizeRegistrationAndSend error", err);
      setError("Failed to finalize registration.");
    } finally {
      setProcessing(false);
      finalizeCalledRef.current = false;
    }
  }

  async function fetchStats() {
    try {
      const res = await fetch(apiUrl("/api/awardees/stats"), { headers: { "ngrok-skip-browser-warning": "69420" } });
      if (!res.ok) return;
      const js = await res.json();
      setStats(js);
    } catch (e) {
      console.warn("fetchStats failed", e);
    }
  }

  async function sendReminders() {
    setSendingReminders(true);
    try {
      const res = await fetch(apiUrl("/api/awardees?limit=1000"), { headers: { "ngrok-skip-browser-warning": "69420" } });
      if (!res.ok) {
        setError("Failed to fetch registrants for reminders.");
        setSendingReminders(false);
        return;
      }
      const list = await res.json();
      for (const item of list) {
        if (!item || !item.email) continue;
        try {
          await sendMailPayload({
            to: item.email,
            subject: `Reminder: ${config?.eventDetails?.name || "Event"} — Your ticket`,
            text: `Hello ${item.name || ""},\n\nThis is a reminder. Your ticket code: ${item.ticket_code || ""}`,
          });
          await new Promise(r => setTimeout(r, 250));
        } catch (e) {
          console.warn("reminder failed for", item.email, e);
        }
      }
    } catch (e) {
      console.error("sendReminders failed", e);
      setError("Reminder sending failed.");
    } finally {
      setSendingReminders(false);
    }
  }

  function TicketSelectionCard() {
    return (
      <div className="bg-white rounded-2xl shadow p-6 mb-6">
        <h3 className="text-lg font-semibold text-[#196e87] mb-3">Choose Ticket</h3>
        <TicketCategorySelector role="awardees" value={ticketCategory} onChange={handleTicketSelect} />
        {!isEmailLike(form.email) && <div className="text-red-600 mt-3">No email available on your registration — go back and add email.</div>}
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full relative">
      {!isMobile && config?.backgroundMedia?.type === "video" && config?.backgroundMedia?.url && (
        <video src={config.backgroundMedia.url} autoPlay muted loop playsInline className="fixed inset-0 w-full h-full object-cover" onError={(e) => console.error("Video error", e)} />
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
              {loading ? <span className="text-[#21809b] text-2xl font-bold">Loading images...</span> : <div className="rounded-3xl overflow-hidden shadow-2xl border-4 border-[#19a6e7] h-[220px] sm:h-[320px] w-[340px] sm:w-[500px] max-w-full bg-white/75 flex items-center justify-center p-4"><img src={config?.images?.[0] || "/images/speaker_placeholder.jpg"} alt="hero" className="object-cover w-full h-full" style={{ maxHeight: 220 }} /></div>}
            </div>

            <div className="sm:w-[40%] w-full flex items-center justify-center">
              {loading ? <span className="text-[#21809b] text-xl font-semibold">Loading event details...</span> : <div className="w-full px-4"><EventDetailsBlock event={canonicalEvent || config?.eventDetails || null} /></div>}
            </div>
          </div>

          <div className="mb-6">
            <div className="flex items-center">
              <div className="flex-grow border-t border-[#21809b]" />
              <span className="mx-5 px-8 py-3 text-2xl font-extrabold text-[#21809b] bg-white rounded-2xl">Register as Awardee</span>
              <div className="flex-grow border-t border-[#21809b]" />
            </div>
          </div>

          {step === 1 && !loading && Array.isArray(config?.fields) && (
            <div className="max-w-3xl mx-auto">
              <DynamicRegistrationForm
                config={{
                  ...config,
                  fields: (config.fields || []).filter(f => {
                    const name = (f.name || "").toString().toLowerCase().replace(/\s+/g, "");
                    const label = (f.label || "").toString().toLowerCase();
                    if (name === "accept_terms" || name === "acceptterms" || name === "i_agree" || name === "agree") return false;
                    if (f.type === "checkbox" && (label.includes("i agree") || label.includes("accept the terms") || label.includes("terms & conditions") || label.includes("terms and conditions"))) return false;
                    return true;
                  })
                }}
                form={form}
                setForm={setForm}
                onSubmit={handleFormSubmit}
                editable={true}
                submitting={submitting}
                terms={(config && (config.termsUrl || config.termsText)) ? { url: config.termsUrl, text: config.termsText, label: config.termsLabel || "Terms & Conditions", required: !!config.termsRequired } : null}
              />
            </div>
          )}

          {step === 2 && <div className="max-w-3xl mx-auto">{TicketSelectionCard()}</div>}

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

          {step === 4 && (
            <div className="max-w-3xl mx-auto">
              <ThankYouMessage email={form.email} />
            </div>
          )}

          {new URLSearchParams(window.location.search).get("admin") === "1" && (
            <div className="max-w-3xl mx-auto mt-8 bg-white p-4 rounded shadow">
              <h3 className="font-semibold text-[#196e87] mb-3">Admin Controls</h3>
              <div className="flex gap-3 mb-3">
                <button onClick={fetchStats} className="px-3 py-1 bg-[#196e87] text-white rounded">Load Stats</button>
                <button onClick={sendReminders} disabled={sendingReminders} className="px-3 py-1 bg-orange-500 text-white rounded">{sendingReminders ? "Sending…" : "Send Reminders"}</button>
              </div>
              {stats && <div className="text-sm text-gray-700"><div>Total Registrants: {stats.total || 0}</div><div>Paid: {stats.paid || 0} — Free: {stats.free || 0}</div></div>}
            </div>
          )}

          {error && <div className="text-red-600 font-semibold mt-4 text-center">{error}</div>}

          <footer className="mt-12 text-center text-[#21809b] font-semibold py-6">© {new Date().getFullYear()} {config?.eventDetails?.name || "RailTrans Expo"} | All rights reserved.</footer>
        </div>
      </div>
    </div>
  );
}