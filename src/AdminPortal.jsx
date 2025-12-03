import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import AdminLogin from "./components/AdminLogin";

/* Inline icons (kept same as before) */
const IconWrapper = ({ children, className = "" }) => (
  <div className={`p-3 bg-white/14 rounded-xl inline-flex items-center justify-center ${className}`} aria-hidden="true">
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

/* Admin button icon (small shield) */
function ShieldIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M12 2l7 3v5c0 5-3.5 9.5-7 11-3.5-1.5-7-6-7-11V5l7-3z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}


/* Registration cards */
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
];

export default function RailTransExpoHomepage() {
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const navigate = useNavigate();

  const onAdminSuccess = () => {
    // Parent-level callback after successful login in AdminLogin component
    setShowAdminLogin(false);
    // navigate to admin dashboard
    navigate("/admin", { replace: true });
  };

  return (
    <div className="min-h-screen bg-gray-50 text-slate-900 antialiased">
      {/* Top-right Admin Access */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative">
          <div className="absolute top-6 right-6 z-20">
            <button
              onClick={() => setShowAdminLogin((s) => !s)}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-full shadow-sm text-sm hover:shadow-md transition"
              aria-label="Admin Access"
            >
              <ShieldIcon className="w-4 h-4 text-slate-600" />
              <span className="text-slate-700">Admin Access</span>
            </button>
          </div>
        </div>
      </div>

      {/* Admin Login (component) */}
      <AdminLogin open={showAdminLogin} onClose={() => setShowAdminLogin(false)} onSuccess={onAdminSuccess} />

      {/* Main content */}
      <main className="pt-16 pb-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Hero */}
          <section className="text-center max-w-3xl mx-auto">
            <div className="mx-auto w-28 h-28 flex items-center justify-center rounded-2xl bg-white shadow-lg mb-6">
              <TrainIcon className="w-12 h-12 text-slate-800" />
            </div>

            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-3">Rail Trans Expo 2025</h1>
            <p className="text-lg text-slate-600 mb-6">The Future of Rail Transportation</p>
            <p className="text-slate-500 max-w-2xl mx-auto">
              Join us for the premier event connecting rail industry professionals, innovators, and enthusiasts.
            </p>
          </section>

          {/* Section title */}
          <section className="mt-16 mb-8 text-center">
            <h2 className="text-2xl md:text-3xl font-bold">Choose Your Registration Type</h2>
          </section>

          {/* Cards grid */}
          <section className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {registrationButtons.map((btn, idx) => {
                const { title, description, Icon, url, color } = btn;
                return (
                  <a
                    key={idx}
                    href={url}
                    className={`group block rounded-2xl p-8 shadow-lg transform hover:-translate-y-2 transition bg-gradient-to-br ${color}`}
                    aria-label={`Register as ${title}`}
                  >
                    <div className="flex items-start gap-6">
                      <div className="flex-shrink-0">
                        <IconWrapper>
                          <Icon className="w-6 h-6 text-white" />
                        </IconWrapper>
                      </div>

                      <div className="flex-1 text-white">
                        <h3 className="text-2xl font-semibold mb-2">{title}</h3>
                        <p className="text-sm opacity-90 mb-4 max-w-lg">{description}</p>
                        <span className="inline-flex items-center gap-2 text-sm font-medium opacity-95">
                          <span>Register now</span>
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          </section>

          {/* Footer */}
          <footer className="mt-20 text-center">
            <div className="inline-block px-6 py-3 bg-white border border-gray-100 rounded-full shadow-sm">
              <p className="text-sm text-slate-600">
                Need help? Contact us at{" "}
                <a href="mailto:support@railtransexpo.com" className="text-blue-600 font-semibold">
                  support@railtransexpo.com
                </a>
              </p>
            </div>
          </footer>
        </div>
      </main>
    </div>
  );
}