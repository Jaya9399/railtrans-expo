import React, { useEffect, useState } from "react";
import Topbar from "../components/Topbar";
import DynamicRegistrationForm from "./DynamicRegistrationForm";
import TicketCategorySelector from "../components/TicketCategoryGenerator";
import ManualPaymentStep from "../components/ManualPayemntStep";
import ThankYouMessage from "../components/ThankYouMessage";
import VisitorTicket from "../components/VisitorTicket";
import { generateVisitorBadgePDF } from "../utils/pdfGenerator";

const API_BASE = (window.__API_BASE__ || "http://localhost:5000").replace(
  /\/$/,
  ""
);
const backgroundImg = "/images/train.png";

/* ---------- helpers ---------- */
function isEmailLike(v) {
  return typeof v === "string" && /\S+@\S+\.\S+/.test(v);
}

const isFreeCategory = (val) => {
  if (val == null) return false;
  const s = typeof val === "string" ? val.trim().toLowerCase() : val;
  return (
    s === "free" ||
    s === "free ticket" ||
    s === "general" ||
    s === "0" ||
    s === 0
  );
};

async function toBase64(pdf) {
  if (!pdf) return "";
  if (typeof pdf === "string") {
    const m = pdf.match(/^data:application\/pdf;base64,(.*)$/i);
    if (m) return m[1];
    if (/^[A-Za-z0-9+/=]+$/.test(pdf)) return pdf;
    return "";
  }
  if (pdf instanceof ArrayBuffer)
    pdf = new Blob([pdf], { type: "application/pdf" });
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
  try {
    body = await res.json();
  } catch {}
  return { ok: res.ok, status: res.status, body };
}

/* ---------- EventDetailsBlock (shared) ---------- */
function EventDetailsBlock({ event }) {
  if (!event)
    return <div className="text-[#21809b]">No event details available</div>;
  const logoGradient =
    "linear-gradient(90deg, #ffba08 0%, #19a6e7 60%, #21809b 100%)";
  const logoBlue = "#21809b";
  const logoDark = "#196e87";
  return (
    <div className="flex flex-col items-center justify-center h-full w-full mt-6">
      <div
        className="font-extrabold text-3xl sm:text-5xl mb-3 text-center"
        style={{
          background: logoGradient,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          letterSpacing: "0.03em",
        }}
      >
        {event?.name || "Event Name"}
      </div>
      <div
        className="text-xl sm:text-2xl font-bold mb-1 text-center"
        style={{ color: logoBlue }}
      >
        {event?.date || "Event Date"}
      </div>
      <div
        className="text-base sm:text-xl font-semibold text-center"
        style={{ color: logoDark }}
      >
        {event?.venue || "Event Venue"}
      </div>
      {event?.tagline && (
        <div className="text-base sm:text-xl font-semibold text-center text-[#21809b] mt-2">
          {event.tagline}
        </div>
      )}
    </div>
  );
}

/* ---------- Speakers page component ---------- */
export default function Speakers() {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({});
  const [step, setStep] = useState(1); // 1=form, 2=choose ticket, 3=payment/process, 4=thank you
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [speakerId, setSpeakerId] = useState(null);
  const [ticketCategory, setTicketCategory] = useState("");
  const [txId, setTxId] = useState("");
  const [proofFile, setProofFile] = useState(null);
  const [pdfBlob, setPdfBlob] = useState(null);
  const [speaker, setSpeaker] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/speaker-config`);
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
    return () => {
      mounted = false;
    };
  }, []);

  /* ---------- Step 1: submit registration form ---------- */
  async function handleFormSubmit(payload) {
    setError("");
    if (!isEmailLike(payload.email)) {
      setError("Please enter a valid email.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/speakers`, {
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
      setSpeakerId(id);
      // store server canonical ticket_code in form so finalize uses it
      setForm((prev) => ({
        ...payload,
        ticket_code: serverTicket || prev.ticket_code || "",
      }));
      setStep(2);
    } catch (err) {
      console.error("save speaker error", err);
      setError("Failed to save registration. Try again.");
    } finally {
      setSubmitting(false);
    }
  }
  /* ---------- Step 2: ticket selection ---------- */
  function handleTicketSelect(cat) {
    setTicketCategory(cat);
    if (isFreeCategory(cat)) {
      finalizeRegistrationAndSend(null, cat);
    } else {
      setStep(3);
    }
  }

  /* ---------- Payment flow ---------- */
  async function createOrderAndOpenCheckout(price) {
    setProcessing(true);
    setError("");
    if (!speakerId) {
      setError("Registration id missing. Please refresh and try again.");
      setProcessing(false);
      return;
    }
    try {
      const payload = {
        amount: price,
        currency: "INR",
        description: `Speaker Ticket - ${ticketCategory}`,
        reference_id: String(speakerId),
        visitor_id: speakerId,
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
      const checkoutUrl =
        js.checkoutUrl ||
        js.checkout_url ||
        js.raw?.checkout_url ||
        js.raw?.payment_link;
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
          const st = await fetch(
            `${API_BASE}/api/payment/status?reference_id=${encodeURIComponent(
              String(speakerId)
            )}`
          );
          if (!st.ok) return;
          const js2 = await st.json().catch(() => ({}));
          const status = (js2.status || "").toString().toLowerCase();
          if (["paid", "captured", "completed", "success"].includes(status)) {
            clearInterval(poll);
            try {
              if (w && !w.closed) w.close();
            } catch {}
            const providerPaymentId =
              js2.record?.provider_payment_id ||
              js2.record?.providerPaymentId ||
              null;
            setTxId(providerPaymentId || null);
            await finalizeRegistrationAndSend(
              providerPaymentId || null,
              ticketCategory
            );
          } else if (["failed", "cancelled"].includes(status)) {
            clearInterval(poll);
            try {
              if (w && !w.closed) w.close();
            } catch {}
            setError("Payment failed or cancelled. Please retry.");
            setProcessing(false);
          } else if (attempts >= maxAttempts) {
            clearInterval(poll);
            setError(
              "Payment not confirmed yet. If you completed payment, refresh after a moment."
            );
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

  /* ---------- Finalize registration: persist ticket, generate PDF, mail, notify ---------- */
  // Replace your existing finalizeRegistrationAndSend with this function
  async function finalizeRegistrationAndSend(
    providerTxId = null,
    chosenCategory = null
  ) {
    setProcessing(true);
    setError("");
    try {
      const name =
        form.name ||
        `${form.firstName || ""} ${form.lastName || ""}`.trim() ||
        "Speaker";
      // Use server-provided ticket_code if present; fallback to speaker state; avoid generating a new one
      const ticket_code = form.ticket_code || speaker?.ticket_code || null;
      const chosen = chosenCategory || ticketCategory || "free";

      // if missing, defensively generate & persist once (rare)
      if (!ticket_code) {
        const generated = String(Math.floor(100000 + Math.random() * 900000));
        if (speakerId) {
          await fetch(
            `${API_BASE}/api/speakers/${encodeURIComponent(
              String(speakerId)
            )}/confirm`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ticket_code: generated, force: true }),
            }
          ).catch(() => {});
          setForm((prev) => ({ ...prev, ticket_code: generated }));
        }
      }

      const fullSpeaker = {
        ...form,
        name,
        ticket_category: chosen,
        ticket_code: form.ticket_code || ticket_code,
        txId: providerTxId || txId || null,
        slots: Array.isArray(form.slots) ? form.slots : [],
        eventDetails: config?.eventDetails || {},
      };
      setSpeaker(fullSpeaker);

      // persist ticket record server-side (idempotent)
      try {
        await fetch(`${API_BASE}/api/tickets/create`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ticket_code: fullSpeaker.ticket_code,
            entity_type: "speaker",
            entity_id: speakerId || null,
            name,
            email: fullSpeaker.email,
            company: fullSpeaker.company || null,
            category: chosen,
            meta: { createdFrom: "web" },
          }),
        }).catch(() => {});
      } catch (e) {
        console.warn("tickets.create failed", e);
      }

      // update the speakers row (do NOT overwrite ticket_code)
      if (speakerId) {
        try {
          await fetch(
            `${API_BASE}/api/speakers/${encodeURIComponent(
              String(speakerId)
            )}/confirm`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ticket_category: chosen,
                txId: providerTxId || txId || null,
              }),
            }
          ).catch(() => {});
        } catch (e) {
          console.warn("speakers.confirm failed", e);
        }
      }

      // 3) Attempt to generate badge PDF (server utility preferred)
      let pdf = null;
      try {
        if (typeof generateVisitorBadgePDF === "function") {
          pdf = await generateVisitorBadgePDF(
            fullSpeaker,
            config?.badgeTemplateUrl || "",
            { includeQRCode: true, event: config?.eventDetails || {} }
          );
        }
      } catch (e) {
        console.warn("generateVisitorBadgePDF error (primary):", e);
        try {
          pdf = await generateVisitorBadgePDF(fullSpeaker, "", {
            includeQRCode: true,
            event: config?.eventDetails || {},
          });
        } catch (err) {
          console.warn("generateVisitorBadgePDF fallback failed:", err);
          pdf = null;
        }
      }
      if (pdf) setPdfBlob(pdf);

      // 4) Send email with PDF attachment (best-effort)
      try {
        const mail = {
          to: fullSpeaker.email,
          subject: `RailTrans Expo - Your Ticket (${chosen})`,
          text: `Hello ${name},\n\nYour ticket code: ${fullSpeaker.ticket_code}\n\nThank you.`,
          html: `<p>Hi ${name},</p><p>Your ticket code: <strong>${fullSpeaker.ticket_code}</strong></p>`,
        };
        if (pdf) {
          const pdfBase64 = await toBase64(pdf);
          if (pdfBase64) {
            mail.attachments = [
              {
                filename: "RailTransExpo-E-Badge.pdf",
                content: pdfBase64,
                encoding: "base64",
                contentType: "application/pdf",
              },
            ];
          }
        }
        const mailRes = await sendMailPayload(mail);
        console.log("mailer result:", mailRes);
        if (!mailRes.ok) {
          console.warn("Mailer reported failure:", mailRes);
          // non-blocking: show a friendly message to user
          setError((prev) =>
            prev ? prev + " Email not sent." : "Email not sent. We'll retry."
          );
        }
      } catch (e) {
        console.warn("Failed to send email", e);
        setError((prev) =>
          prev ? prev + " Email not sent." : "Email not sent. We'll retry."
        );
      }

      // 5) WhatsApp notify (optional, best-effort)
      try {
        await fetch(`${API_BASE}/api/notify/whatsapp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: fullSpeaker.mobile,
            message: `Your RailTrans Expo ticket code: ${fullSpeaker.ticket_code}`,
          }),
        }).catch(() => {});
      } catch (e) {
        console.warn("WhatsApp notify failed", e);
      }

      // 6) Notify admin
      try {
        const adminEmail =
          process.env.REACT_APP_ADMIN_EMAIL || "admin@railtransexpo.com";
        await sendMailPayload({
          to: adminEmail,
          subject: `New Speaker Registered: ${name}`,
          text: `Name: ${name}\nEmail: ${
            fullSpeaker.email
          }\nCategory: ${chosen}\nTicket: ${fullSpeaker.ticket_code}\nTx: ${
            providerTxId || txId || "N/A"
          }`,
        }).catch(() => {});
      } catch (e) {
        console.warn("Admin notify failed", e);
      }

      // done
      setStep(4);
    } catch (err) {
      console.error("finalize error", err);
      setError("Failed to finalize registration.");
    } finally {
      setProcessing(false);
    }
  }

  /* ---------- small UI helpers ---------- */
  function HeroBlock() {
    const event = config?.eventDetails || {};
    return (
      <div className="rounded-3xl overflow-hidden shadow-2xl border-4 border-[#19a6e7] h-[220px] sm:h-[320px] w-[340px] sm:w-[500px] max-w-full bg-white/75 flex flex-col items-center justify-center mt-6 sm:mt-10 p-4">
        <img
          src={config?.images?.[0] || "/images/speaker_placeholder.jpg"}
          alt="hero"
          className="object-cover w-full h-full"
          style={{ maxHeight: 220 }}
        />
        <div className="mt-3 text-center">
          <div className="text-lg font-bold text-[#196e87]">
            {event.name || ""}
          </div>
          <div className="text-sm text-[#21809b]">{event.date || ""}</div>
        </div>
      </div>
    );
  }

  function TicketSelectionCard() {
    return (
      <div className="bg-white rounded-2xl shadow p-6 mb-6">
        <h3 className="text-lg font-semibold text-[#196e87] mb-3">
          Choose Ticket
        </h3>
        <TicketCategorySelector
          value={ticketCategory}
          onChange={handleTicketSelect}
        />
        {!isEmailLike(form.email) && (
          <div className="text-red-600 mt-3">
            No email available on your registration — go back and add email.
          </div>
        )}
      </div>
    );
  }

  /* ---------- render ---------- */
  return (
    <div
      className="min-h-screen w-full relative"
      style={{
        backgroundImage: `url(${backgroundImg})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="absolute inset-0 bg-white/50 pointer-events-none" />
      <div className="relative z-10">
        <Topbar />
        <div className="max-w-7xl mx-auto pt-8 px-4">
          <div
            className="flex flex-col sm:flex-row items-stretch mb-10"
            style={{ minHeight: 370 }}
          >
            <div className="sm:w-[60%] w-full flex items-center justify-center">
              {loading ? (
                <span className="text-[#21809b] text-2xl font-bold">
                  Loading images...
                </span>
              ) : (
                <HeroBlock />
              )}
            </div>

            <div className="sm:w-[40%] w-full flex items-center justify-center">
              {loading ? (
                <span className="text-[#21809b] text-xl font-semibold">
                  Loading event details...
                </span>
              ) : (
                <div className="w-full px-4">
                  <div>
                    <EventDetailsBlock event={config?.eventDetails || null} />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mb-6">
            <div className="flex items-center">
              <div className="flex-grow border-t border-[#21809b]" />
              <span className="mx-5 px-8 py-3 text-2xl font-extrabold text-[#21809b] bg-white rounded-2xl">
                Register as Speaker
              </span>
              <div className="flex-grow border-t border-[#21809b]" />
            </div>
          </div>

          {/* Step 1 */}
          {step === 1 && !loading && Array.isArray(config?.fields) && (
            <div className="max-w-3xl mx-auto">
              <DynamicRegistrationForm
                config={config}
                form={form}
                setForm={setForm}
                onSubmit={handleFormSubmit}
                editable={true}
                submitting={submitting}
              />
            </div>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <div className="max-w-3xl mx-auto">{TicketSelectionCard()}</div>
          )}

          {/* Step 3 - Payment */}
          {step === 3 && (
            <div className="max-w-3xl mx-auto">
              <ManualPaymentStep
                ticketType={ticketCategory}
                ticketPrice={ticketCategory === "combo" ? 5000 : 2500}
                onProofUpload={() =>
                  finalizeRegistrationAndSend(txId || null, ticketCategory)
                }
                onTxIdChange={(val) => setTxId(val)}
                txId={txId}
                proofFile={proofFile}
                setProofFile={setProofFile}
              />
              <div className="flex justify-center gap-3 mt-4">
                <button
                  className="px-6 py-2 bg-[#196e87] text-white rounded"
                  onClick={() =>
                    createOrderAndOpenCheckout(
                      ticketCategory === "combo" ? 5000 : 2500
                    )
                  }
                  disabled={processing}
                >
                  {processing ? "Processing..." : "Pay & Complete"}
                </button>
              </div>
              {processing && (
                <div className="mt-4 text-center text-gray-600">
                  Finalizing — please wait...
                </div>
              )}
              {error && (
                <div className="mt-3 text-red-600 font-medium">{error}</div>
              )}
            </div>
          )}

          {/* Step 4: Thank you + Ticket */}
          {step === 4 && (
            <div className="max-w-3xl mx-auto">
              <ThankYouMessage email={speaker?.email || form.email} />
            </div>
          )}

          <footer className="mt-12 text-center text-[#21809b] font-semibold py-6">
            © {new Date().getFullYear()}{" "}
            {config?.eventDetails?.name || "RailTrans Expo"} | All rights
            reserved.
          </footer>
        </div>
      </div>
    </div>
  );
}
