import React, { useEffect, useState, useRef, useCallback } from "react";
import Topbar from "../components/Topbar";
import DynamicRegistrationForm from "./DynamicRegistrationForm";
import TicketCategorySelector from "../components/TicketCategoryGenerator";
import ManualPaymentStep from "../components/ManualPayemntStep";
import ThankYouMessage from "../components/ThankYouMessage";
import { buildTicketEmail } from "../utils/emailTemplate";

/*
 Partners.jsx

 Fixes applied:
 - Use /api/reminders/send for scheduling reminders (same as other pages).
 - Ensure email template is called with the registration form (model.form) so event details
   appear in the email (buildTicketEmail reads form.event/form.eventDetails/flat keys).
 - Add ngrok bypass header ("ngrok-skip-browser-warning": "69420") to relevant fetches (postJSON, uploadAsset, payment status checks)
   to match other pages and avoid ngrok blocking.
 - Resolve logo via /api/admin/logo-url (best-effort) and include in email model.
 - Attach PDF if provided (best-effort).
 - Keep failures in optional parts non-fatal and surface useful messages.
*/

function getApiBaseFromEnvOrWindow() {
  if (typeof process !== "undefined" && process.env && process.env.REACT_APP_API_BASE) return process.env.REACT_APP_API_BASE.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.__API_BASE__) return String(window.__API_BASE__).replace(/\/$/, "");
  if (typeof window !== "undefined" && window.__CONFIG__ && window.__CONFIG__.backendUrl) return String(window.__CONFIG__.backendUrl).replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location && window.location.origin) return window.location.origin.replace(/\/$/, "");
  return "http://localhost:5000";
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

/* small helpers */
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
  let json = null;
  let text = null;
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
    const r = await fetch(apiUrl("/api/admin/logo-url"), {
      headers: { Accept: "application/json", "ngrok-skip-browser-warning": "69420" },
    });
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

/* templated email helper using buildTicketEmail
   - Passes the registration form as `form` in the model so buildTicketEmail reads event details from the form.
   - Includes resolved logoUrl in model (mailer may inline).
   - Attaches pdfBase64 when provided (pdfBlob may be base64 string).
*/
async function sendTemplatedAckEmail(partnerPayload, partnerId = null, images = [], pdfBlob = null, cfg = {}) {
  try {
    const to = pickFirstString(partnerPayload, ["email", "emailAddress", "contactEmail"]) || "";
    if (!to) return { ok: false, error: "no-recipient" };

    const frontendBase = (typeof window !== "undefined" && (window.__FRONTEND_BASE__ || window.location.origin)) || "";
    const bannerUrl = Array.isArray(images) && images.length ? images[0] : "";

    const logoUrl = await resolveLogoUrl(cfg);

    // IMPORTANT: pass form so email template reads event details from registration form
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
      form: formObj, // <-- this ensures event details (form.event / form.eventDetails / flat fields) are used by template
      pdfBase64: null,
    };

    const { subject, text, html, attachments: templateAttachments = [] } = buildTicketEmail(model);

    const payload = { to, subject, text, html, attachments: [] };

    // include template attachments if any
    if (Array.isArray(templateAttachments) && templateAttachments.length) {
      payload.attachments.push(...templateAttachments);
    }

    // attach provided PDF (if base64)
    if (pdfBlob) {
      if (typeof pdfBlob === "string") {
        // if already data URI or base64
        const m = pdfBlob.match(/^data:application\/pdf;base64,(.*)$/i);
        const b64 = m ? m[1] : ( /^[A-Za-z0-9+/=]+$/.test(pdfBlob) ? pdfBlob : null );
        if (b64) {
          payload.attachments.push({ filename: "e-badge.pdf", content: b64, encoding: "base64", contentType: "application/pdf" });
        }
      }
    }

    // debug preview (avoid logging full attachments)
    try {
      console.debug("[Partners] mailPayload preview:", { to: payload.to, subject: payload.subject, htmlStart: String(payload.html || "").slice(0, 240), attachmentsCount: payload.attachments.length });
    } catch (e) {}

    // send to mailer with ngrok header
    const res = await fetch(apiUrl("/api/mailer"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
      body: JSON.stringify(payload),
    });
    const txt = await res.text().catch(() => "");
    let js = null;
    try { js = txt ? JSON.parse(txt) : null; } catch {}
    if (!res.ok) {
      console.warn("[Partners] mailer failed:", res.status, js || txt);
      return { ok: false, status: res.status, body: js || txt, error: `mailer failed (${res.status})` };
    }
    return { ok: true, status: res.status, body: js || txt };
  } catch (e) {
    console.warn("sendTemplatedAckEmail failed", e);
    return { ok: false, error: String(e) };
  }
}

/* schedule reminder wrapper using /api/reminders/send (same as other pages) */
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

/* ---------- Component ---------- */
export default function Partners() {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(1); // 1=form, 2=ticket, 3=payment, 4=thankyou
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

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/partner-config?cb=" + Date.now()), { cache: "no-store", headers: { Accept: "application/json", "ngrok-skip-browser-warning": "69420" } });
      const cfg = res.ok ? await res.json() : {};
      const normalized = { ...(cfg || {}) };

      // background media normalization
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
      // strip accept_terms-like fields
      normalized.fields = normalized.fields.filter(f => {
        if (!f || typeof f !== "object") return false;
        const name = (f.name || "").toString().toLowerCase().replace(/\s+/g, "");
        const label = (f.label || "").toString().toLowerCase();
        if (["accept_terms","acceptterms","i_agree","agree"].includes(name)) return false;
        if (f.type === "checkbox" && (label.includes("i agree") || label.includes("accept the terms") || label.includes("terms & conditions") || label.includes("terms and conditions"))) return false;
        return true;
      });

      // ensure email fields have OTP enabled
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
    const onCfg = () => fetchConfig();
    window.addEventListener("partner-config-updated", onCfg);
    return () => window.removeEventListener("partner-config-updated", onCfg);
  }, [fetchConfig]);

  // autoplay video best-effort
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

  // Step 1: don't save yet. Store form client-side and create payment reference id.
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
      // telemetry (best-effort)
      try { await postJSON(apiUrl("/api/partners/step"), { step: "registration_attempt", data: { form: formData } }); } catch {}
      setStep(2);
    } catch (e) {
      console.error("handleSubmit error", e);
      setError("Failed to continue. Try again.");
    } finally {
      setSaving(false);
    }
  }

  // Step 2: ticket selection
  function handleTicketSelect(value, meta = {}) {
    setTicketCategory(value);
    const price = Number(meta.price || 0);
    const gstRate = Number(meta.gst || meta.gstRate || 0);
    const gstAmount = Math.round(price * gstRate);
    const total = (meta.total !== undefined) ? Number(meta.total) : price + gstAmount;
    setTicketMeta({ price, gstRate, gstAmount, total, label: meta.label || "" });

    if (total === 0) {
      finalizeSave({ ticket_category: value, ticket_price: price, ticket_gst: gstAmount, ticket_total: total, referenceId: paymentReferenceId });
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

      // Poll payment status using reference (include ngrok header)
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
            await finalizeSave({ ticket_category: ticketCategory, ticket_price: ticketMeta.price, ticket_gst: ticketMeta.gstAmount, ticket_total: ticketMeta.total, txId: providerPaymentId || null, referenceId: reference });
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

  async function finalizeSave({ ticket_category, ticket_price = 0, ticket_gst = 0, ticket_total = 0, payment_proof_url = null, txId: providerTx = null, referenceId: ref = null } = {}) {
    setError("");
    setSaving(true);
    try {
      const payload = {
        ...form,
        ticket_category: ticket_category || ticketCategory || null,
        ticket_price,
        ticket_gst,
        ticket_total,
        txId: providerTx || txId || null,
        payment_proof_url: payment_proof_url || null,
        referenceId: ref || paymentReferenceId || null,
        termsAccepted: !!form.termsAccepted,
        _rawForm: form
      };

      const { ok, status, body } = await postJSON(apiUrl("/api/partners"), payload);
      if (!ok) {
        const msg = (body && (body.error || body.message)) || `Save failed (${status})`;
        setError(msg);
        setSaving(false);
        return;
      }

      const insertedId = (body && body.insertedId) || null;
      setSavedPartnerId(insertedId || null);

      // attempt creating ticket (best-effort)
      try {
        const ticket_code = body?.ticket_code || payload.ticket_code || String(Math.floor(100000 + Math.random() * 900000));
        await postJSON(apiUrl("/api/tickets/create"), {
          ticket_code,
          entity_type: "partner",
          entity_id: insertedId || null,
          name: payload.name || "",
          email: payload.email || "",
          company: payload.company || "",
          category: payload.ticket_category || "",
          meta: { createdFrom: "partner-frontend" }
        });
      } catch (e) { console.warn("create ticket failed", e); }

      // send templated email (pass form so template reads event details)
      try {
        setAckLoading(true);
        const mailRes = await sendTemplatedAckEmail(payload, insertedId, config?.images || [], null, config);
        setAckLoading(false);
        if (!mailRes || !mailRes.ok) {
          setAckError(mailRes && (mailRes.error || (mailRes.body && (mailRes.body.error || mailRes.body.message))) || "Mailer failed");
        } else {
          setAckResult(mailRes.body || { ok: true });
          setAckError("");
        }
      } catch (e) {
        setAckLoading(false);
        console.warn("templated mail failed", e);
        setAckError("Acknowledgement email failed");
      }

      // schedule reminder using common endpoint
      try {
        if (insertedId) {
          const evDate = (form && (form.eventDetails?.date || form.eventDates || form.date)) || config?.eventDetails?.date || null;
          if (evDate) {
            const sch = await scheduleReminder(insertedId, evDate);
            if (sch && sch.ok) { setReminderScheduled(true); setReminderError(""); }
            else { setReminderScheduled(false); setReminderError((sch && (sch.error || (sch.body && (sch.body.error || sch.body.message)))) || "Schedule failed"); }
          }
        }
      } catch (e) {
        console.warn("schedule reminder failed", e);
      }

      // telemetry (best-effort)
      try { await postJSON(apiUrl("/api/partners/step"), { step: "registration_completed", data: { id: insertedId, payload } }); } catch {}

      setStep(4);
    } catch (err) {
      console.error("finalizeSave error", err);
      setError("Failed to save registration. Try again later.");
    } finally {
      setSaving(false);
    }
  }

  /* Render */
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
              {loading ? <span className="text-[#21809b] text-2xl font-bold">Loading images...</span> : (config?.images && config.images.length ? <div className="rounded-3xl overflow-hidden shadow-2xl border-4 border-[#19a6e7] h-[220px] sm:h-[320px] w-[340px] sm:w-[500px] max-w-full bg-white/75 flex items-center justify-center p-4"><img src={config.images[0]} alt="hero" className="object-cover w-full h-full" /></div> : <div className="text-[#21809b]"> </div>)}
            </div>
            <div className="sm:w-[40%] w-full flex items-center justify-center">
              {loading ? <span className="text-[#21809b] text-xl font-semibold">Loading event details...</span> : <div className="w-full px-4"><div className="font-extrabold text-3xl text-center text-[#21809b]">{config?.eventDetails?.name}</div><div className="text-center mt-2 text-[#196e87]">{config?.eventDetails?.date} • {config?.eventDetails?.venue}</div></div>}
            </div>
          </div>

          <div className="w-full flex items-center justify-center my-8">
            <div className="flex-grow border-t border-[#21809b]" />
            <span className="mx-5 px-8 py-3 text-2xl font-extrabold text-[#21809b] bg-white shadow rounded-2xl">Partner Registration</span>
            <div className="flex-grow border-t border-[#21809b]" />
          </div>

          {/* Step 1 - form (client only) */}
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

          {/* Step 2 - ticket selection */}
          {step === 2 && (
            <div className="mx-auto w-full max-w-4xl">
              <TicketCategorySelector role="partners" value={ticketCategory} onChange={handleTicketSelect} />
            </div>
          )}

          {/* Step 3 - payment / proof */}
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

          {/* Step 4 - thank you */}
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

          <footer className="mt-16 text-center text-[#21809b] font-semibold py-6 text-lg">© {new Date().getFullYear()} RailTrans Expo | All rights reserved.</footer>
        </div>
      </div>
    </div>
  );
}