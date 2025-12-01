import React, { useEffect, useState } from "react";
import Topbar from "../components/Topbar";
import DynamicRegistrationForm from "./DynamicRegistrationForm";
import ThankYouMessage from "../components/ThankYouMessage";

const API_BASE = (window.__API_BASE__ || "http://localhost:5000").replace(/\/$/, "");

/* ---------- Small helpers to pick fields robustly ---------- */
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

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, body: json };
}

async function saveStep(stepName, data = {}, meta = {}) {
  try {
    await fetch(`${API_BASE}/api/partners/step`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: stepName, data, meta }),
    });
  } catch (e) {
    console.warn("[Partners] saveStep failed:", stepName, e);
  }
}

/* ---------- UI bits (unchanged) ---------- */
function ImageSlider({ images = [] }) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!images || images.length === 0) return;
    const t = setInterval(() => setActive((p) => (p + 1) % images.length), 3500);
    return () => clearInterval(t);
  }, [images]);
  if (!images || images.length === 0) return <div className="text-[#21809b]">No images available</div>;
  return (
    <div className="flex flex-col items-center justify-center w-full h-full">
      <div className="rounded-3xl overflow-hidden shadow-2xl border-4 border-[#19a6e7] h-[220px] sm:h-[320px] w-[340px] sm:w-[500px] max-w-full bg-white/75 flex items-center justify-center mt-6 sm:mt-10">
        <img src={images[active]} alt={`Partner ${active + 1}`} className="object-cover w-full h-full" loading="lazy" style={{ transition: "opacity 0.5s" }} />
      </div>
      <div className="mt-5 text-center text-[#196e87] font-bold text-xl tracking-wide">Partnership Glimpse</div>
      <div className="flex justify-center mt-3 gap-3">
        {images.map((_, idx) => (
          <span key={idx} style={{ background: active === idx ? "#21809b" : "#fff", border: `1.5px solid #21809b`, display: "inline-block", opacity: active === idx ? 1 : 0.7, transition: "all 0.2s" }} className="h-3 w-3 rounded-full" />
        ))}
      </div>
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
      <div className="font-extrabold text-3xl sm:text-5xl mb-3 text-center" style={{ background: logoGradient, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: "0.03em" }}>
        {event?.name || "Event Name"}
      </div>
      <div className="text-xl sm:text-2xl font-bold mb-1 text-center" style={{ color: logoBlue }}>{event?.date || "Event Date"}</div>
      <div className="text-base sm:text-xl font-semibold text-center" style={{ color: logoDark }}>{event?.venue || "Event Venue"}</div>
      {event?.tagline && <div className="text-base sm:text-xl font-semibold text-center text-[#21809b] mt-2">{event.tagline}</div>}
    </div>
  );
}

/* ---------- Main component ---------- */
export default function Partners() {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");

  const [savedPartnerId, setSavedPartnerId] = useState(null);

  // ack & reminder UI states
  const [ackLoading, setAckLoading] = useState(false);
  const [ackError, setAckError] = useState("");
  const [ackResult, setAckResult] = useState(null);

  const [reminderScheduled, setReminderScheduled] = useState(false);
  const [reminderError, setReminderError] = useState("");

  useEffect(() => {
    let mounted = true;
    fetch(`${API_BASE}/api/partner-config`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to fetch config"))))
      .then((cfg) => { if (!mounted) return; setConfig(cfg || {}); setLoading(false); })
      .catch(() => { if (!mounted) return; setConfig({}); setLoading(false); });
    return () => (mounted = false);
  }, []);

  // send acknowledgement email using backend mailer
  async function sendAckEmail(partnerPayload, partnerId = null) {
    setAckLoading(true);
    setAckError("");
    setAckResult(null);

    const to = pickFirstString(partnerPayload, ["email", "emailAddress", "contactEmail"]) || "";
    if (!to) {
      setAckLoading(false);
      setAckError("No partner email available");
      setAckResult(null);
      return { ok: false, error: "no-recipient" };
    }

    const name = pickFirstString(partnerPayload, ["name", "organization", "company"]) || "";
    const subject = "RailTrans Expo — We received your partner request";
    const text = `Hello ${name || ""},

Thank you for your partner request. We have received your details and our team will get back to you soon.

Regards,
RailTrans Expo Team`;
    const html = `<p>Hello ${name || ""},</p><p>Thank you for your partner request. We have received your details and our team will get back to you soon.</p><p>Regards,<br/>RailTrans Expo Team</p>`;

    try {
      const { ok, status, body } = await postJSON(`${API_BASE}/api/mailer`, { to, subject, text, html });
      setAckLoading(false);
      if (!ok) {
        const msg = (body && (body.error || body.message)) || `Mailer failed (${status})`;
        setAckError(msg);
        setAckResult(null);
        await saveStep("partner_ack_failed", { partner: partnerPayload, partnerId }, { resp: body || null }).catch(()=>{});
        return { ok: false, body };
      }
      setAckResult(body || { ok: true });
      setAckError("");
      await saveStep("partner_ack_sent", { partner: partnerPayload, partnerId }, { resp: body || null }).catch(()=>{});
      return { ok: true, body };
    } catch (err) {
      setAckLoading(false);
      const msg = err && (err.message || String(err));
      setAckError(msg);
      setAckResult(null);
      await saveStep("partner_ack_failed", { partner: partnerPayload, partnerId }, { error: msg }).catch(()=>{});
      return { ok: false, error: msg };
    }
  }

  // schedule reminder via backend (backend must compute time from event details)
  async function scheduleReminder(partnerId) {
    setReminderError("");
    try {
      const eventDate = config?.eventDetails?.date || config?.eventDate || null;
      if (!eventDate) {
        setReminderError("Event date not available to schedule reminder");
        return { ok: false, error: "no-event-date" };
      }
      const { ok, status, body } = await postJSON(`${API_BASE}/api/partners/schedule-reminder`, { partnerId, eventDate });
      if (!ok) {
        const msg = (body && (body.error || body.message)) || `Schedule failed (${status})`;
        setReminderError(msg);
        await saveStep("partner_reminder_failed", { partnerId, eventDate }, { resp: body || null }).catch(()=>{});
        setReminderScheduled(false);
        return { ok: false, body };
      }
      setReminderScheduled(true);
      setReminderError("");
      await saveStep("partner_reminder_scheduled", { partnerId, eventDate }, { resp: body || null }).catch(()=>{});
      return { ok: true, body };
    } catch (err) {
      const msg = err && (err.message || String(err));
      setReminderError(msg);
      setReminderScheduled(false);
      await saveStep("partner_reminder_failed", { partnerId }, { error: msg }).catch(()=>{});
      return { ok: false, error: msg };
    }
  }

  // corrected submit handler - ensures mobile is provided from multiple possible form keys
  async function handleSubmit(formData) {
    setError("");
    setSaving(true);

    const surname = pickFirstString(formData, ["surname", "title"]);
    const name = pickFirstString(formData, ["name", "fullName", "firstName", "first_name"]) || `${pickFirstString(formData, ["firstName", "first_name"]) || ""} ${pickFirstString(formData, ["lastName", "last_name"]) || ""}`.trim();
    const mobile = pickFirstString(formData, ["mobile", "phone", "contact", "whatsapp", "mobileNumber", "telephone"]);
    const email = pickFirstString(formData, ["email", "mail", "emailId", "email_id"]) || "";
    const designation = pickFirstString(formData, ["designation", "title", "role"]) || "";
    const company = pickFirstString(formData, ["companyName", "company", "organization", "org"]) || "";
    const businessType = pickFirstString(formData, ["businessType", "business_type", "companyType"]) || "";
    const businessOther = pickFirstString(formData, ["businessOther", "business_other", "company_type_other"]) || "";
    const partnership = pickFirstString(formData, ["partnership", "partnershipType", "partnership_type"]) || "";
    const terms = formData.terms ? 1 : 0;

    if (!mobile) {
      setSaving(false);
      setError("Mobile / phone is required. Please fill the mobile field.");
      return;
    }

    const payload = {
      surname: surname || "",
      name: name || "",
      mobile: mobile || "",
      email: email || "",
      designation: designation || "",
      company: company || "",
      businessType,
      businessOther,
      partnership,
      terms,
    };

    await saveStep("partner_attempt", { form: payload }).catch(()=>{});

    try {
      const { ok, status, body } = await postJSON(`${API_BASE}/api/partners`, payload);
      if (!ok) {
        const errMsg = (body && (body.message || body.error)) || `Save failed (${status})`;
        throw new Error(errMsg);
      }

      const insertedId = (body && body.insertedId) || null;
      setSavedPartnerId(insertedId || null);

      await saveStep("partner_saved", { id: insertedId, form: payload }).catch(()=>{});

      setForm(payload);
      setStep(2);

      // Background: auto-send acknowledgement and auto-schedule reminder (no UI interaction needed)
      (async () => {
        try {
          await sendAckEmail(payload, insertedId).catch(()=>{});
        } catch (e) {
          console.warn("[Partners] ack background error", e);
        }
        try {
          if (insertedId) {
            await scheduleReminder(insertedId).catch(()=>{});
          }
        } catch (e) {
          console.warn("[Partners] reminder scheduling error", e);
        }
      })();
    } catch (err) {
      console.error("[Partners] submit error:", err);
      setError(err.message || "Failed to save partner");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen w-full relative" style={{ backgroundImage: `url(/images/train.png)`, backgroundSize: "cover", backgroundPosition: "center" }}>
      <div className="absolute inset-0 bg-white/50 pointer-events-none" />
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

          <div className="w-full flex items-center justify-center my-8">
            <div className="flex-grow border-t border-[#21809b]" />
            <span className="mx-5 px-8 py-3 text-2xl font-extrabold text-[#21809b] bg-white shadow rounded-2xl">Partner Registration</span>
            <div className="flex-grow border-t border-[#21809b]" />
          </div>

          {!loading && step === 1 && config?.fields && (
            <DynamicRegistrationForm config={config} form={form} setForm={setForm} onSubmit={handleSubmit} editable={true} saving={saving} />
          )}

          {step === 2 && (
            <div className="my-6">
              <ThankYouMessage email={form.email || ""} message="Please check your email for acknowledgement. Our team will contact you shortly." />
              <div className="mt-4 text-center">
                {ackLoading && <div className="text-gray-600">Sending acknowledgement...</div>}
                {ackError && <div className="text-red-600">Acknowledgement failed: {ackError}</div>}
                {ackResult && <div className="text-green-700">Acknowledgement sent</div>}
                {!ackLoading && !ackResult && !ackError && <div className="text-gray-600">Acknowledgement will be sent shortly.</div>}
                {reminderScheduled && <div className="text-green-700 mt-2">Reminder scheduled for event date.</div>}
                {reminderError && <div className="text-red-600 mt-2">Reminder error: {reminderError}</div>}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="my-6">
              <div className="mx-auto w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-[#bde0fe] p-8 flex flex-col items-center">
                <div className="text-2xl font-extrabold mb-4 text-[#21809b]">Registration Notification Sent!</div>
                <div className="text-lg mb-2 text-[#196e87]">Your registration details have been sent to the admin for review.</div>
                <div className="text-base mb-1">Name: <span className="font-bold">{form.name || "N/A"}</span></div>
                <div className="text-base mb-1">Email: <span className="font-bold">{form.email || "N/A"}</span></div>
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