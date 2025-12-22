import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import AdminLogin from "./components/AdminLogin";

/* ================= API HELPERS ================= */

const API_BASE = (
  process.env.REACT_APP_API_BASE ||
  process.env.REACT_APP_API_BASE_URL ||
  window.__API_BASE__ ||
  ""
).replace(/\/$/, "");

const NGROK_HEADER = { "ngrok-skip-browser-warning": "69420" };

function configsUrl(key) {
  return `${API_BASE}/api/configs/${encodeURIComponent(key)}`;
}

function legacyGetUrl() {
  return `${API_BASE}/api/event-details`;
}

function normalizeEvent(raw = {}) {
  return {
    name: raw.name || "Rail Trans Expo",
    date: raw.date || "",
    time: raw.time || "",
    venue: raw.venue || "",
  };
}

/* ================= ICONS (UNCHANGED) ================= */

const IconWrapper = ({ children, className = "" }) => (
  <div
    className={`p-3 bg-white/14 rounded-xl inline-flex items-center justify-center ${className}`}
    aria-hidden="true"
  >
    {children}
  </div>
);

function TrainIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M12 3v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="3" y="9" width="18" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 19l1.5-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 19l-1.5-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UsersIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M16 11a4 4 0 10-8 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 20a6 6 0 0118 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BriefcaseIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <rect x="3" y="7" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MicIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <rect x="9" y="2" width="6" height="10" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 14v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 18h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function AwardIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M12 2l2.5 4.5L19 8l-4 3 1 5-4.5-2.5L7 16l1-5-4-3 4.5-1.5L12 2z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

function ShieldIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M12 2l7 3v5c0 5-3.5 9.5-7 11-3.5-1.5-7-6-7-11V5l7-3z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ================= REGISTRATION CARDS (UNCHANGED) ================= */

const registrationButtons = [
  {
    title: "Visitors",
    description: "Register as a visitor to explore the expo",
    Icon: UsersIcon,
    url: "/visitors",
    color: "from-blue-500 to-blue-600",
  },
  {
    title: "Exhibitors",
    description: "Showcase your products and services",
    Icon: BriefcaseIcon,
    url: "/exhibitors",
    color: "from-slate-700 to-slate-600",
  },
  {
    title: "Speakers",
    description: "Share your expertise with the industry",
    Icon: MicIcon,
    url: "/speakers",
    color: "from-stone-600 to-stone-500",
  },
  {
    title: "Partners",
    description: "Collaborate and grow together",
    Icon: AwardIcon,
    url: "/partners",
    color: "from-blue-400 to-blue-500",
  },
  {
    title: "Awardees",
    description: "Register as an awardee to receive recognition at the expo",
    Icon: AwardIcon,
    url: "/awardees",
    color: "from-amber-400 to-amber-500",
  },
];

/* ================= MAIN COMPONENT ================= */

export default function RailTransExpoHomepage() {
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [eventDetails, setEventDetails] = useState(normalizeEvent({}));
  const navigate = useNavigate();

  const onAdminSuccess = () => {
    setShowAdminLogin(false);
    navigate("/admin", { replace: true });
  };

  const fetchEventDetails = useCallback(async () => {
    try {
      const res = await fetch(configsUrl("event-details"), {
        headers: { Accept: "application/json", ...NGROK_HEADER },
        cache: "no-store",
      });
      if (res.ok) {
        const js = await res.json();
        setEventDetails(normalizeEvent(js?.value ?? js));
        return;
      }
    } catch {}

    try {
      const res2 = await fetch(legacyGetUrl(), {
        headers: { Accept: "application/json", ...NGROK_HEADER },
        cache: "no-store",
      });
      if (res2.ok) {
        const js2 = await res2.json();
        setEventDetails(normalizeEvent(js2));
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchEventDetails();

    const refresh = () => fetchEventDetails();
    window.addEventListener("config-updated", refresh);
    window.addEventListener("event-details-updated", refresh);

    return () => {
      window.removeEventListener("config-updated", refresh);
      window.removeEventListener("event-details-updated", refresh);
    };
  }, [fetchEventDetails]);

  return (
    <div className="min-h-screen bg-gray-50 text-slate-900 antialiased">
      {/* Admin Access */}
      <div className="absolute top-6 right-6 z-20">
        <button
          onClick={() => setShowAdminLogin(s => !s)}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-full shadow-sm text-sm hover:shadow-md transition"
        >
          <ShieldIcon className="w-4 h-4 text-slate-600" />
          <span className="text-slate-700">Admin Access</span>
        </button>
      </div>

      <AdminLogin open={showAdminLogin} onClose={() => setShowAdminLogin(false)} onSuccess={onAdminSuccess} />

      <main className="pt-16 pb-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* HERO */}
          <section className="text-center max-w-3xl mx-auto">
            <div className="mx-auto w-28 h-28 flex items-center justify-center rounded-2xl bg-white shadow-lg mb-6">
              <TrainIcon className="w-12 h-12 text-slate-800" />
            </div>

            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4">
              {eventDetails.name}
            </h1>

            {(eventDetails.date || eventDetails.time || eventDetails.venue) && (
              <div className="text-slate-600 mb-6 space-y-1">
                {eventDetails.date && <div>📅 {eventDetails.date}</div>}
                {eventDetails.venue && <div>📍 {eventDetails.venue}</div>}
              </div>
            )}

            <p className="text-slate-500 max-w-2xl mx-auto">
              Join us for the premier event connecting rail industry professionals, innovators, and enthusiasts.
            </p>
          </section>

          {/* REGISTRATION SECTION (UNCHANGED) */}
          <section className="mt-16 mb-8 text-center">
            <h2 className="text-2xl md:text-3xl font-bold">Choose Your Registration Type</h2>
          </section>

          <section className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {registrationButtons.map((btn, idx) => (
                <a
                  key={idx}
                  href={btn.url}
                  className={`group block rounded-2xl p-8 shadow-lg transform hover:-translate-y-2 transition bg-gradient-to-br ${btn.color}`}
                >
                  <div className="flex items-start gap-6">
                    <IconWrapper>
                      <btn.Icon className="w-6 h-6 text-white" />
                    </IconWrapper>
                    <div className="flex-1 text-white">
                      <h3 className="text-2xl font-semibold mb-2">{btn.title}</h3>
                      <p className="text-sm opacity-90 mb-4 max-w-lg">{btn.description}</p>
                      <span className="inline-flex items-center gap-2 text-sm font-medium opacity-95">
                        Register now
                      </span>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
