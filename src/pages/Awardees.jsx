import React, { useEffect, useRef, useState } from "react";
import Topbar from "../components/Topbar";
import DynamicRegistrationForm from "./DynamicRegistrationForm";
import TicketCategorySelector from "../components/TicketCategoryGenerator";
import ManualPaymentStep from "../components/ManualPayemntStep";
import ThankYouMessage from "../components/ThankYouMessage";
import VisitorTicket from "../components/VisitorTicket";
import { generateVisitorBadgePDF } from "../utils/pdfGenerator";

const API_BASE = (window.__API_BASE__ || "http://localhost:5000").replace(/\/$/, "");
const backgroundImg = "/images/train.png";

/* ---------- helpers ---------- */
function isEmailLike(v) {
  return typeof v === "string" && /\S+@\S+\.\S+/.test(v);
}
const isFreeCategory = (val) => {
  if (val == null) return false;
  const s = typeof val === "string" ? val.trim().toLowerCase() : val;
  return s === "free" || s === "free ticket" || s === "general" || s === "0" || s === 0;
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
async function sendMailPayload(payload) {
  const res = await fetch(`${API_BASE}/api/mailer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let body = null;
  try { body = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, body };
}

/* ---------- EventDetailsBlock (shared) ---------- */
function EventDetailsBlock({ event }) {
  if (!event) return <div className="text-[#21809b]">No event details available</div>;
  const logoGradient = "linear-gradient(90deg, #ffba08 0%, #19a6e7 60%, #21809b 100%)";
  const logoBlue = "#21809b";
  const logoDark = "#196e87";
  return (
    <div className="flex flex-col items-center justify-center h-full w-full mt-6">
      <div
        className="font-extrabold text-3xl sm:text-5xl mb-3 text-center"
        style={{ background: logoGradient, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: "0.03em" }}
      >
        {event?.name || "Event Name"}
      </div>
      <div className="text-xl sm:text-2xl font-bold mb-1 text-center" style={{ color: logoBlue }}>
        {event?.date || "Event Date"}
      </div>
      <div className="text-base sm:text-xl font-semibold text-center" style={{ color: logoDark }}>
        {event?.venue || "Event Venue"}
      </div>
      {event?.tagline && <div className="text-base sm:text-xl font-semibold text-center text-[#21809b] mt-2">{event.tagline}</div>}
    </div>
  );
}

/* ---------- Awardees page (adapted from Speakers) ---------- */
export default function Awardees() {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({});
  const [step, setStep] = useState(1); // 1=form, 2=choose ticket, 3=payment, 4=thank you
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  const [awardeeId, setAwardeeId] = useState(null);
  const [ticketCategory, setTicketCategory] = useState("");
  const [ticketCode, setTicketCode] = useState("");
  const [txId, setTxId] = useState("");
  const [proofFile, setProofFile] = useState(null);
  const [pdfBlob, setPdfBlob] = useState(null);

  // admin
  const [stats, setStats] = useState(null);
  const [sendingReminders, setSendingReminders] = useState(false);

  const finalizeCalledRef = useRef(false);
  const emailSentRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/awardee-config`);
        const cfg = res.ok ? await res.json() : {};
        if (!mounted) return;
        setConfig(cfg || {});
      } catch (e) {
        if (!mounted) return;
        setConfig({});
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  /* ---------- Step 1: submit registration form (like speakers) ---------- */
  async function handleFormSubmit(payload) {
    setError("");
    if (!isEmailLike(payload.email)) {
      setError("Please enter a valid email.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/awardees`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const js = await res.json().catch(() => ({}));
      if (!res.ok || !js.success) {
        setError(js.error || "Failed to save registration.");
        return;
      }
      const id = js.insertedId || js.insertId || js.id || null;
      const serverTicket = js.ticket_code || js.ticketCode || null;
      setAwardeeId(id);
      setTicketCode(serverTicket || "");
      // store canonical server code in local form so later finalize uses it
      setForm(prev => ({ ...payload, ticket_code: serverTicket || prev.ticket_code || "" }));
      setStep(2);
    } catch (err) {
      console.error("save awardee error", err);
      setError("Failed to save registration. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  /* ---------- Step 2: choose ticket ---------- */
  function handleTicketSelect(cat) {
    setTicketCategory(cat);
    if (isFreeCategory(cat)) {
      finalizeRegistrationAndSend(null, cat);
    } else {
      setStep(3);
    }
  }

  /* ---------- Payment helpers (reused pattern) ---------- */
  function ticketPriceForCategory(cat) {
    if (!cat) return 0;
    const c = String(cat).toLowerCase();
    if (c === "combo") return 5000;
    if (c === "delegate") return 2500;
    if (c === "vip") return 7500;
    if (/free|general|0/.test(c)) return 0;
    return 2500;
  }

  async function createOrderAndOpenCheckout(price) {
    setProcessing(true);
    setError("");
    if (!awardeeId) {
      setError("Registration id missing. Please refresh and try again.");
      setProcessing(false);
      return;
    }
    try {
      const payload = {
        amount: price,
        currency: "INR",
        description: `Awardee Ticket - ${ticketCategory}`,
        reference_id: String(awardeeId),
        metadata: { ticketCategory, email: form.email },
      };
      const res = await fetch(`${API_BASE}/api/payment/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const js = await res.json().catch(() => ({}));
      if (!res.ok || !js.success) {
        setError(js.error || "Failed to create payment order");
        setProcessing(false);
        return;
      }
      const checkoutUrl = js.checkoutUrl || js.checkout_url || js.raw?.checkout_url;
      if (!checkoutUrl) {
        setError("Payment provider did not return a checkout URL.");
        setProcessing(false);
        return;
      }
      const w = window.open(checkoutUrl, "_blank", "noopener,noreferrer");
      if (!w) {
        setError("Popup blocked. Allow popups to continue payment.");
        setProcessing(false);
        return;
      }

      let attempts = 0;
      const maxAttempts = 80;
      const poll = setInterval(async () => {
        attempts += 1;
        try {
          const st = await fetch(`${API_BASE}/api/payment/status?reference_id=${encodeURIComponent(String(awardeeId))}`);
          if (!st.ok) return;
          const js2 = await st.json().catch(() => ({}));
          const status = (js2.status || "").toString().toLowerCase();
          if (["paid", "captured", "completed", "success"].includes(status)) {
            clearInterval(poll);
            try { if (w && !w.closed) w.close(); } catch {}
            const providerPaymentId = js2.record?.provider_payment_id || js2.record?.providerPaymentId || null;
            setTxId(providerPaymentId || null);
            await finalizeRegistrationAndSend(providerPaymentId || null, ticketCategory);
          } else if (["failed", "cancelled"].includes(status)) {
            clearInterval(poll);
            try { if (w && !w.closed) w.close(); } catch {}
            setError("Payment failed or cancelled. Please retry.");
            setProcessing(false);
          } else if (attempts >= maxAttempts) {
            clearInterval(poll);
            setError("Payment not confirmed yet. If you completed payment, refresh after a moment.");
            setProcessing(false);
          }
        } catch (e) {
          // ignore transient
        }
      }, 3000);
    } catch (err) {
      console.error("createOrderAndOpenCheckout error", err);
      setError("Payment initiation failed.");
      setProcessing(false);
    }
  }

  async function onManualProofSubmit(file) {
    try {
      if (file && awardeeId) {
        const fd = new FormData();
        fd.append("proof", file);
        fd.append("awardeeId", awardeeId);
        await fetch(`${API_BASE}/api/awardees/${encodeURIComponent(String(awardeeId))}/upload-proof`, { method: "POST", body: fd }).catch(() => {});
      }
    } catch (e) {
      console.warn("upload proof failed", e);
    }
    await finalizeRegistrationAndSend(txId || null, ticketCategory);
  }

  /* ---------- Finalize registration (pattern from Speakers) ---------- */
  async function finalizeRegistrationAndSend(providerTxId = null, chosenCategory = null) {
    if (finalizeCalledRef.current) {
      console.debug("finalizeRegistrationAndSend already invoked; skipping.");
      return;
    }
    finalizeCalledRef.current = true;

    setProcessing(true);
    setError("");
    try {
      const name = form.name || `${form.firstName || ""} ${form.lastName || ""}`.trim() || "Awardee";
      const chosen = chosenCategory || ticketCategory || "free";

      // Prefer server-provided ticket_code (stored in form.ticket_code or ticketCode)
      let ticket_code = form.ticket_code || ticketCode || null;

      // if missing, try fetching server row for canonical code
      if (!ticket_code && awardeeId) {
        try {
          const r = await fetch(`${API_BASE}/api/awardees/${encodeURIComponent(String(awardeeId))}`);
          if (r.ok) {
            const row = await r.json().catch(() => null);
            ticket_code = (row && (row.ticket_code || row.code)) || ticket_code;
            if (ticket_code) setTicketCode(ticket_code);
            setForm(prev => ({ ...prev, ticket_code: ticket_code || prev.ticket_code }));
          }
        } catch (e) { /* ignore */ }
      }

      // If still missing, generate and persist once (last resort)
      if (!ticket_code) {
        const generated = String(Math.floor(100000 + Math.random() * 900000));
        if (awardeeId) {
          try {
            await fetch(`${API_BASE}/api/awardees/${encodeURIComponent(String(awardeeId))}/confirm`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ticket_code: generated, force: true }),
            }).catch(() => {});
            ticket_code = generated;
            setTicketCode(generated);
            setForm(prev => ({ ...prev, ticket_code: generated }));
          } catch (e) {
            ticket_code = generated;
            setTicketCode(generated);
            setForm(prev => ({ ...prev, ticket_code: generated }));
          }
        } else {
          // attempt to save a row now (rare)
          try {
            const saveRes = await fetch(`${API_BASE}/api/awardees`, {
              method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, ticket_code: generated })
            });
            const saveJs = await saveRes.json().catch(() => ({}));
            if (saveRes.ok && saveJs.success && saveJs.insertedId) setAwardeeId(saveJs.insertedId);
            ticket_code = saveJs.ticket_code || generated;
            setTicketCode(ticket_code);
            setForm(prev => ({ ...prev, ticket_code: ticket_code }));
          } catch (e) {
            ticket_code = generated;
            setTicketCode(generated);
            setForm(prev => ({ ...prev, ticket_code: generated }));
          }
        }
      }

      const full = { ...form, name, ticket_category: chosen, ticket_code, txId: providerTxId || txId, eventDetails: config?.eventDetails || {} };
      // persist ticket central record (idempotent)
      try {
        await fetch(`${API_BASE}/api/tickets/create`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ticket_code,
            entity_type: "awardee",
            entity_id: awardeeId || null,
            name,
            email: form.email || null,
            company: form.company || null,
            category: chosen,
            meta: { createdFrom: "awardee-frontend" },
          }),
        }).catch(() => {});
      } catch (e) { /* ignore */ }

      // update awardee row (do not overwrite ticket_code)
      try {
        await fetch(`${API_BASE}/api/awardees/${encodeURIComponent(String(awardeeId))}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticket_category: chosen, txId: providerTxId || txId || null }),
        }).catch(() => {});
      } catch (e) {}

      // generate PDF (client utility preferred)
      let pdf = null;
      try {
        if (typeof generateVisitorBadgePDF === "function") {
          pdf = await generateVisitorBadgePDF(full, config?.badgeTemplateUrl || "", { includeQRCode: true, qrPayload: { ticket_code }, event: config?.eventDetails || {} });
          setPdfBlob(pdf);
        }
      } catch (e) {
        console.warn("PDF generation failed:", e);
        pdf = null;
      }

      // send mail (guarded)
      if (!emailSentRef.current) {
        emailSentRef.current = true;
        try {
          const mail = {
            to: form.email,
            subject: `${config?.eventDetails?.name || "Event"} - Your Ticket`,
            text: `Hello ${name},\n\nYour ticket code: ${ticket_code}\n\nThank you.`,
            html: `<p>Hello ${name},</p><p>Your ticket code: <strong>${ticket_code}</strong></p>`,
          };
          if (pdf) {
            const b64 = await toBase64(pdf);
            if (b64) mail.attachments = [{ filename: "Ticket.pdf", content: b64, encoding: "base64", contentType: "application/pdf" }];
          }
          await sendMailPayload(mail);
        } catch (e) {
          console.warn("mail send failed", e);
        }
      }

      // WhatsApp notify (best-effort)
      try {
        if (form.mobile) {
          await fetch(`${API_BASE}/api/notify/whatsapp`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to: form.mobile, message: `Your ticket code: ${ticket_code}` }),
          });
        }
      } catch (e) { console.warn("whatsapp failed", e); }

      // admin notify
      try {
        const adminEmail = process.env.REACT_APP_ADMIN_EMAIL || "admin@railtransexpo.com";
        await sendMailPayload({ to: adminEmail, subject: `New Awardee: ${name}`, text: `Name: ${name}\nEmail: ${form.email}\nTicket: ${ticket_code}\nID: ${awardeeId}` });
      } catch (e) { /* ignore */ }

      setStep(4);
    } catch (err) {
      console.error("finalizeRegistrationAndSend error", err);
      setError("Failed to finalize registration.");
    } finally {
      setProcessing(false);
    }
  }

  /* ---------- Admin helpers ---------- */
  async function fetchStats() {
    try {
      const res = await fetch(`${API_BASE}/api/awardees/stats`);
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
      const res = await fetch(`${API_BASE}/api/awardees?limit=1000`);
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

  /* ---------- Small UI pieces ---------- */
  function TicketSelectionCard() {
    return (
      <div className="bg-white rounded-2xl shadow p-6 mb-6">
        <h3 className="text-lg font-semibold text-[#196e87] mb-3">Choose Ticket</h3>
        <TicketCategorySelector value={ticketCategory} onChange={handleTicketSelect} />
        {!isEmailLike(form.email) && <div className="text-red-600 mt-3">No email available on your registration — go back and add email.</div>}
      </div>
    );
  }

  /* ---------- Render ---------- */
  return (
    <div className="min-h-screen w-full relative" style={{ backgroundImage: `url(${backgroundImg})`, backgroundSize: "cover", backgroundPosition: "center" }}>
      <div className="absolute inset-0 bg-white/50 pointer-events-none" />
      <div className="relative z-10">
        <Topbar />
        <div className="max-w-7xl mx-auto pt-8 px-4">
          <div className="flex flex-col sm:flex-row items-stretch mb-10" style={{ minHeight: 370 }}>
            <div className="sm:w-[60%] w-full flex items-center justify-center">
              {loading ? <span className="text-[#21809b] text-2xl font-bold">Loading images...</span> : <div className="rounded-3xl overflow-hidden shadow-2xl border-4 border-[#19a6e7] h-[220px] sm:h-[320px] w-[340px] sm:w-[500px] max-w-full bg-white/75 flex items-center justify-center p-4"><img src={config?.images?.[0] || "/images/speaker_placeholder.jpg"} alt="hero" className="object-cover w-full h-full" style={{ maxHeight: 220 }} /></div>}
            </div>

            <div className="sm:w-[40%] w-full flex items-center justify-center">
              {loading ? <span className="text-[#21809b] text-xl font-semibold">Loading event details...</span> : <div className="w-full px-4"><EventDetailsBlock event={config?.eventDetails || null} /></div>}
            </div>
          </div>

          <div className="mb-6">
            <div className="flex items-center">
              <div className="flex-grow border-t border-[#21809b]" />
              <span className="mx-5 px-8 py-3 text-2xl font-extrabold text-[#21809b] bg-white rounded-2xl">Register as Awardee</span>
              <div className="flex-grow border-t border-[#21809b]" />
            </div>
          </div>

          {/* Step 1 */}
          {step === 1 && !loading && Array.isArray(config?.fields) && (
            <div className="max-w-3xl mx-auto">
              <DynamicRegistrationForm config={config} form={form} setForm={setForm} onSubmit={handleFormSubmit} editable={true} submitting={submitting} />
            </div>
          )}

          {/* Step 2 */}
          {step === 2 && <div className="max-w-3xl mx-auto">{TicketSelectionCard()}</div>}

          {/* Step 3 - Payment */}
          {step === 3 && (
            <div className="max-w-3xl mx-auto">
              <ManualPaymentStep
                ticketType={ticketCategory}
                ticketPrice={ticketPriceForCategory(ticketCategory)}
                onProofUpload={(file) => onManualProofSubmit(file)}
                onTxIdChange={(val) => setTxId(val)}
                txId={txId}
                proofFile={proofFile}
                setProofFile={setProofFile}
              />
              <div className="flex justify-center gap-3 mt-4">
                <button className="px-6 py-2 bg-[#196e87] text-white rounded" onClick={() => createOrderAndOpenCheckout(ticketPriceForCategory(ticketCategory))} disabled={processing}>
                  {processing ? "Processing..." : "Pay & Complete"}
                </button>
              </div>
              {processing && <div className="mt-4 text-center text-gray-600">Finalizing — please wait...</div>}
              {error && <div className="mt-3 text-red-600 font-medium">{error}</div>}
            </div>
          )}

          {/* Step 4: Thank you + Ticket */}
          {step === 4 && (
            <div className="max-w-3xl mx-auto">
              <ThankYouMessage email={form.email} />
             
            </div>
          )}

          {/* Admin area */}
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