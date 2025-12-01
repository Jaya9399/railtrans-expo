import React, { useEffect, useState } from "react";
import Topbar from "../components/Topbar";
import DynamicRegistrationForm from "./DynamicRegistrationForm";
import ThankYouMessage from "../components/ThankYouMessage";

// API base (use window.__API_BASE__ for ngrok / remote)
const API_BASE = (window.__API_BASE__ || "http://localhost:5000").replace(/\/$/, "");

/* ---------- Small helpers ---------- */
function isEmailLike(v) {
  return typeof v === "string" && /\S+@\S+\.\S+/.test(v);
}
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
  const keys = ["email","mail","emailId","email_id","contactEmail","visitorEmail","user_email","companyEmail","primaryEmail"];
  for (const k of keys) {
    const v = form[k];
    if (isEmailLike(v)) return v.trim();
  }
  const containers = ["contact","personal","user","profile"];
  for (const c of containers) {
    const v = form[c];
    if (v && typeof v === "object") {
      const found = extractEmailFromForm(v);
      if (found) return found;
    }
  }
  return findEmailDeep(form);
}

/* pick a value from possible keys (case-insensitive and nested) */
function getFieldValue(obj, candidates = []) {
  if (!obj || typeof obj !== "object") return "";
  // direct keys (case-sensitive then case-insensitive)
  for (const cand of candidates) {
    for (const k of Object.keys(obj)) {
      if (k === cand) return obj[k];
      if (k.toLowerCase() === String(cand).toLowerCase()) return obj[k];
    }
  }
  // shallow deep-search for strings inside nested objects/arrays
  for (const v of Object.values(obj)) {
    if (typeof v === "string" && v.trim()) return v;
    if (v && typeof v === "object") {
      if (typeof v.name === "string" && v.name.trim()) return v.name;
      if (typeof v.companyName === "string" && v.companyName.trim()) return v.companyName;
      if (typeof v.company === "string" && v.company.trim()) return v.company;
    }
  }
  return "";
}

/* ---------- UI small pieces ---------- */
function ImageSlider({ images = [] }) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!images || images.length === 0) return;
    const t = setInterval(()=> setActive(p => (p+1)%images.length), 3500);
    return ()=> clearInterval(t);
  }, [images]);
  if (!images || images.length===0) return <div className="text-[#21809b]">No images available</div>;
  return (
    <div className="flex flex-col items-center justify-center w-full h-full">
      <div className="rounded-3xl overflow-hidden shadow-2xl border-4 border-[#19a6e7] h-[220px] sm:h-[320px] w-[340px] sm:w-[500px] max-w-full bg-white/75 flex items-center justify-center mt-6 sm:mt-10">
        <img src={images[active]} alt={`Exhibitor ${active+1}`} className="object-cover w-full h-full" loading="lazy" style={{transition:"opacity 0.5s"}}/>
      </div>
      <div className="mt-5 text-center text-[#196e87] font-bold text-xl tracking-wide">Exhibitor Glimpse</div>
      <div className="flex justify-center mt-3 gap-3">
        {images.map((_,idx)=>(
          <span key={idx} style={{background: active===idx ? "#21809b" : "#fff", border:"1.5px solid #21809b", display:"inline-block", opacity: active===idx?1:0.7, transition:"all 0.2s"}} className="h-3 w-3 rounded-full"/>
        ))}
      </div>
    </div>
  );
}
function SectionTitle(){ return (<div className="w-full flex items-center justify-center my-8"><div className="flex-grow border-t border-[#21809b]" /><span className="mx-5 px-8 py-3 text-2xl font-extrabold text-[#21809b] bg-white shadow rounded-2xl">Exhibitor Registration</span><div className="flex-grow border-t border-[#21809b]" /></div>); }
function ExpoFooter(){ return <footer className="mt-16 text-center text-[#21809b] font-semibold py-6 text-lg">© {new Date().getFullYear()} RailTrans Expo | All rights reserved.</footer>; }

/* ---------- Event details component (use this to display event info) ---------- */
function EventDetails({ event }) {
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

/* ---------- Backend mail helper (simple acknowledgement, no PDF) ---------- */
async function sendSimpleAckEmail(exhibitor) {
  try {
    const to = extractEmailFromForm(exhibitor) || exhibitor.email;
    if (!to) return { ok: false, error: "no-recipient" };
    const name = exhibitor.name || exhibitor.companyName || exhibitor.company || "";
    const subject = "RailTrans Expo — We received your exhibitor request";
    const text = `Hello ${name || ""},

Thank you for your exhibitor request. We have received your details and our team will get back to you soon.

Regards,
RailTrans Expo Team`;
    const html = `<p>Hello ${name || ""},</p><p>Thank you for your exhibitor request. We have received your details and our team will get back to you soon.</p><p>Regards,<br/>RailTrans Expo Team</p>`;

    const res = await fetch(`${API_BASE}/api/mailer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, subject, text, html }),
    });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    console.warn("[Exhibitors] sendSimpleAckEmail failed:", e && (e.message || e));
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

/* ---------- Main component ---------- */
export default function Exhibitors() {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({});
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savedExhibitorId, setSavedExhibitorId] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(()=> {
    let mounted = true;
    (async ()=>{
      try {
        const res = await fetch(`${API_BASE}/api/exhibitor-config`);
        const cfg = res.ok ? await res.json() : {};
        if (!mounted) return;
        setConfig(cfg || {});
      } catch (e) {
        if (!mounted) return;
        setConfig({});
      } finally { if (mounted) setLoading(false); }
    })();
    return ()=> mounted = false;
  },[]);

  async function saveStep(stepName, data={}, meta={}) {
    try {
      await fetch(`${API_BASE}/api/exhibitors/step`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: stepName, data, meta }),
      });
    } catch (e) {
      console.warn("[Exhibitors] saveStep failed:", stepName, e);
    }
  }

  // Save exhibitor (simple payload -> backend) with improved logging/error parsing
  async function saveExhibitor(payload) {
    const url = `${API_BASE}/api/exhibitors`;
    console.debug("[Exhibitors] POST", url, "payload:", payload);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text().catch(()=>null);
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { rawText: text }; }
    if (!res.ok) {
      console.error("[Exhibitors] POST /api/exhibitors failed", { status: res.status, body: json });
      const errMsg = (json && (json.message || json.error)) || `Save failed (${res.status})`;
      throw new Error(errMsg);
    }
    return json;
  }

  // handle form submit
  async function handleContinue(formData) {
    setError("");
    setSaving(true);
    const nextForm = { ...formData };
    setForm(nextForm);

    await saveStep("registration_attempt", { form: nextForm }).catch(()=>{});

    // pick up company value from possible names (companyname, companyName, company, ...)
    const companyValue = String(getFieldValue(nextForm, ["companyName","company","companyname","company_name","organization","org"]) || "").trim();

    // Build payload matching backend expected keys (ensure companyName present)
    const payload = {
      surname: nextForm.surname || nextForm.title || "",
      name: nextForm.name || `${nextForm.firstName||""} ${nextForm.lastName||""}`.trim(),
      mobile: nextForm.mobile || nextForm.phone || nextForm.contact || "",
      email: nextForm.email || extractEmailFromForm(nextForm) || "",
      designation: nextForm.designation || "",
      companyName: companyValue, // canonical key backend expects
      company: companyValue,     // also send company as fallback
      category: nextForm.category || "",
      spaceType: nextForm.spaceType || "",
      spaceSize: nextForm.spaceSize || "",
      boothType: nextForm.boothType || "",
      productDetails: nextForm.productDetails || "",
      terms: nextForm.terms ? 1 : 0,
    };

    console.debug("[Exhibitors] final payload prepared:", payload);

    try {
      const json = await saveExhibitor(payload);
      if (json?.insertedId) setSavedExhibitorId(json.insertedId);
      await saveStep("registration", { form: nextForm }, { insertedId: json?.insertedId || null }).catch(()=>{});

      // send simple acknowledgement email (best-effort, background)
      (async () => {
        try {
          const mailRes = await sendSimpleAckEmail(payload);
          if (mailRes && mailRes.ok) {
            await saveStep("exhibitor_ack_sent", { form: payload }, { insertedId: json?.insertedId || null, mail: mailRes.body || null }).catch(()=>{});
            console.debug("[Exhibitors] ack email sent", mailRes);
          } else {
            await saveStep("exhibitor_ack_failed", { form: payload }, { insertedId: json?.insertedId || null, resp: mailRes }).catch(()=>{});
            console.warn("[Exhibitors] ack email not sent", mailRes);
          }
        } catch (e) {
          console.warn("[Exhibitors] ack email background job failed:", e);
          await saveStep("exhibitor_ack_failed", { form: payload }, { insertedId: json?.insertedId || null, error: String(e && e.message ? e.message : e) }).catch(()=>{});
        }
      })();

      setStep(2);
    } catch (err) {
      console.error("[Exhibitors] handleContinue error:", err);
      setError(err.message || "Failed to save registration. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen w-full relative" style={{ backgroundImage:`url(/images/train.png)`, backgroundSize:"cover", backgroundPosition:"center" }}>
      <div className="absolute inset-0 bg-white/50 pointer-events-none" />
      <div className="relative z-10">
        <Topbar />
        <div className="max-w-7xl mx-auto pt-8">
          <div className="flex flex-col sm:flex-row items-stretch mb-10" style={{ minHeight: 370 }}>
            <div className="sm:w-[60%] w-full flex items-center justify-center">{ loading ? <span className="text-[#21809b] text-2xl font-bold">Loading images...</span> : <ImageSlider images={config?.images || []} /> }</div>
            <div className="sm:w-[40%] w-full flex items-center justify-center">{ loading ? <span className="text-[#21809b] text-xl font-semibold">Loading event details...</span> : <EventDetails event={config?.eventDetails || config?.EventDetails || {}} /> }</div>
          </div>

          <SectionTitle />

          {!loading && step === 1 && config?.fields && (
            <DynamicRegistrationForm config={config} form={form} setForm={setForm} onSubmit={handleContinue} editable={true} saving={saving} />
          )}

          {step === 2 && (
            <div className="my-6">
              <ThankYouMessage email={form.email || ""} />
            </div>
          )}

          {error && <div className="text-red-600 font-semibold mb-2 text-center">{error}</div>}

          <ExpoFooter />
        </div>
      </div>
    </div>
  );
}