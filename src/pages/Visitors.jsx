import React, { useEffect, useState } from "react";
import Topbar from "../components/Topbar";
import DynamicRegistrationForm from "./DynamicRegistrationForm";

async function fetchConfig() {
  const res = await fetch("http://localhost:5000/api/visitor-config");
  if (!res.ok) throw new Error("Failed to fetch config");
  return await res.json();
}

function ImageSlider({ images = [] }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!images || images.length === 0) return;
    const timer = setInterval(() => {
      setActive((prev) => (prev + 1) % images.length);
    }, 3500);
    return () => clearInterval(timer);
  }, [images]);

  if (!images || images.length === 0) {
    return <div className="text-[#21809b]">No images available</div>;
  }

  return (
    <div className="flex flex-col items-center justify-center w-full h-full">
      <div className="rounded-3xl overflow-hidden shadow-2xl border-4 border-[#19a6e7] h-[220px] sm:h-[320px] w-[340px] sm:w-[500px] max-w-full bg-white/75 flex items-center justify-center mt-6 sm:mt-10">
        <img
          src={images[active]}
          alt={`Visitor ${active + 1}`}
          className="object-cover w-full h-full"
          loading="lazy"
          style={{ transition: "opacity 0.5s" }}
        />
      </div>
      <div className="mt-5 text-center text-[#196e87] font-bold text-xl tracking-wide">
        Visitor Glimpse
      </div>
      <div className="flex justify-center mt-3 gap-3">
        {images.map((_, idx) => (
          <span
            key={idx}
            style={{
              background: active === idx ? "#21809b" : "#fff",
              border: `1.5px solid #21809b`,
              display: "inline-block",
              opacity: active === idx ? 1 : 0.7,
              transition: "all 0.2s",
            }}
            className={`h-3 w-3 rounded-full`}
          />
        ))}
      </div>
    </div>
  );
}

function EventDetailsBlock({ event }) {
  const logoGradient = "linear-gradient(90deg, #ffba08 0%, #19a6e7 60%, #21809b 100%)";
  const logoBlue = "#21809b";
  const logoDark = "#196e87";
  // Provide default/fallback event details if missing
  const name = event?.name || "RailTrans Expo 2026";
  const date = event?.date || "12-14 December 2026";
  const venue = event?.venue || "Bharat Mandapam, Pragati Maidan, Delhi";
  const tagline = event?.tagline || "India's Premier Rail Event";

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
        {name}
      </div>
      <div className="text-xl sm:text-2xl font-bold mb-1 text-center" style={{ color: logoBlue }}>
        {date}
      </div>
      <div className="text-base sm:text-xl font-semibold text-center" style={{ color: logoDark }}>
        {venue}
      </div>
      {tagline && (
        <div className="text-base sm:text-xl font-semibold text-center text-[#21809b] mt-2">
          {tagline}
        </div>
      )}
    </div>
  );
}

function SectionTitle() {
  return (
    <div className="w-full flex items-center justify-center my-8">
      <div className="flex-grow border-t border-[#21809b]" />
      <span className="mx-5 px-8 py-3 text-2xl font-extrabold text-[#21809b] bg-white shadow rounded-2xl">
        Visitor Registration
      </span>
      <div className="flex-grow border-t border-[#21809b]" />
    </div>
  );
}

function ThankYouForm({ email, mobile }) {
  return (
    <div className="mx-auto w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-[#bde0fe] p-8 flex flex-col items-center">
      <div className="text-2xl font-extrabold mb-4 text-[#21809b]">Thank You for Registering!</div>
      <div className="text-lg mb-2 text-[#196e87]">Your registration has been received.</div>
      <div className="text-base mb-1">
        Email: <span className="font-bold">{email || "N/A"}</span>
      </div>
      <div className="text-base mb-1">
        WhatsApp: <span className="font-bold">{mobile || "N/A"}</span>
      </div>
      <div className="mt-3 text-[#21809b] text-base">
        Please check your inbox and WhatsApp for your registration acknowledgement.
      </div>
    </div>
  );
}

function ExpoFooter() {
  return (
    <footer className="mt-16 text-center text-[#21809b] font-semibold py-6 text-lg">
      © {new Date().getFullYear()} RailTrans Expo | All rights reserved.
    </footer>
  );
}

export default function Visitors() {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({});
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetchConfig()
      .then((cfg) => {
        if (mounted) {
          console.log("Fetched config (Public):", cfg); // DEBUG LOG
          setConfig(cfg || {});
          setLoading(false);
        }
      })
      .catch((e) => {
        if (mounted) {
          console.log("Config fetch error:", e);
          setConfig({});
          setLoading(false);
        }
      });
    return () => (mounted = false);
  }, []);

  async function handleContinue() {
    setError("");
    if (step === 1) {
      try {
        const res = await fetch("http://localhost:5000/api/visitors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const data = await res.json();
        if (data.success) {
          setStep(2);
        } else {
          setError(data.error || "Registration failed");
        }
      } catch (e) {
        setError("Network or server error.");
      }
    } else {
      setStep((prev) => prev + 1);
    }
  }

  return (
    <div
      className="min-h-screen w-full relative"
      style={{
        backgroundImage: `url(/images/train.png)`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="absolute inset-0 bg-white/50 pointer-events-none" />
      <div className="relative z-10">
        <Topbar />

        <div className="max-w-7xl mx-auto pt-8">
          <div className="flex flex-col sm:flex-row items-stretch mb-10" style={{ minHeight: 370 }}>
            <div className="sm:w-[60%] w-full flex items-center justify-center">
              {loading ? (
                <span className="text-[#21809b] text-2xl font-bold">Loading images...</span>
              ) : (
                <ImageSlider images={config?.images || []} />
              )}
            </div>
            <div className="sm:w-[40%] w-full flex items-center justify-center">
              {loading ? (
                <span className="text-[#21809b] text-xl font-semibold">Loading event details...</span>
              ) : (
                <EventDetailsBlock event={config?.eventDetails || {}} />
              )}
            </div>
          </div>

          <SectionTitle />

          {!loading && step === 1 && config?.fields && (
            <DynamicRegistrationForm
              config={config}
              form={form}
              setForm={setForm}
              onSubmit={handleContinue}
              editable={true}
            />
          )}

          {error && <div className="text-red-600 font-semibold mb-2 text-center">{error}</div>}

          {step === 2 && <ThankYouForm email={form.email} mobile={form.mobile} />}

          <ExpoFooter />
        </div>
      </div>
    </div>
  );
}