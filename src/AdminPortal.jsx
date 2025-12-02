import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

/**
 * RailTransExpoHomepage.jsx
 *
 * - Reads admin credentials from environment variables:
 *     - For Create React App: REACT_APP_ADMIN_EMAIL and REACT_APP_ADMIN_PASSWORD
 *     - For Vite: VITE_ADMIN_EMAIL and VITE_ADMIN_PASSWORD
 *   (If env vars are not provided, the component falls back to demo credentials.)
 *
 * - Uses react-router's useNavigate to go to the dashboard ("/") after successful login.
 * - Responsive: grid is 1 column on small screens, 2 columns on md+ screens.
 * - Uses inline SVG icons (no external icon deps).
 *
 * Security note: client-side env vars and client-side checks are not secure for protecting admin pages.
 * Use a real authentication system and server-side authorization for production.
 */

/* Default demo credentials (will be used only if env vars are missing) */
const FALLBACK_ADMIN_EMAIL = "support@railtransexpo.com";
const FALLBACK_ADMIN_PASSWORD = "admin123";

/* Read from environment (CRA or Vite). */
const ENV_ADMIN_EMAIL =
  (process.env.REACT_APP_ADMIN_EMAIL) ||
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_ADMIN_EMAIL) ||
  FALLBACK_ADMIN_EMAIL;

const ENV_ADMIN_PASSWORD =
  (process.env.REACT_APP_ADMIN_PASSWORD) ||
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_ADMIN_PASSWORD) ||
  FALLBACK_ADMIN_PASSWORD;

/* -------------------------
   Inline SVG icon components
   ------------------------- */
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

/* -------------------------
   Component
   ------------------------- */
export default function RailTransExpoHomepage() {
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleAdminLogin = () => {
    setError("");
    const enteredEmail = (email || "").trim().toLowerCase();
    const requiredEmail = (ENV_ADMIN_EMAIL || FALLBACK_ADMIN_EMAIL).trim().toLowerCase();
    const requiredPassword = ENV_ADMIN_PASSWORD || FALLBACK_ADMIN_PASSWORD;

    if (!enteredEmail || !password) {
      setError("Please enter both email and password.");
      return;
    }

    if (enteredEmail === requiredEmail && password === requiredPassword) {
      // Save user in localStorage so your existing AuthContext/AdminRoute can detect the admin session.
      try {
        localStorage.setItem("user", JSON.stringify({ email: requiredEmail }));
      } catch (e) {
        // ignore storage errors
      }

      // Redirect to dashboard ("/") which renders <DashboardContent />
      navigate("/admin", { replace: true });
    } else {
      setError("Invalid credentials. Please try again.");
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      handleAdminLogin();
    }
  };

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

  return (
    <div className="min-h-screen bg-gray-50 text-slate-900 antialiased">
      {/* Top-right Admin Access */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative">
          <div className="absolute top-6 right-6 z-20">
            <button
              onClick={() => {
                setShowAdminLogin((s) => !s);
                setError("");
                setEmail("");
                setPassword("");
              }}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-full shadow-sm text-sm hover:shadow-md transition"
              aria-label="Admin Access"
            >
              <ShieldIcon className="w-4 h-4 text-slate-600" />
              <span className="text-slate-700">Admin Access</span>
            </button>
          </div>
        </div>
      </div>

      {/* Admin Login Modal */}
      {showAdminLogin && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-login-title"
        >
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 border">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg shadow">
                <ShieldIcon className="w-6 h-6 text-white" />
              </div>
              <h2 id="admin-login-title" className="text-lg font-semibold">
                Admin Login
              </h2>
              <div className="ml-auto">
                <button
                  onClick={() => setShowAdminLogin(false)}
                  className="text-sm text-slate-500 hover:text-slate-800"
                  aria-label="Close"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={handleKeyPress}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 focus:ring-2 focus:ring-blue-300"
                  placeholder="admin@example.com"
                  autoComplete="username"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={handleKeyPress}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 focus:ring-2 focus:ring-blue-300"
                  placeholder="Enter password"
                  autoComplete="current-password"
                />
              </div>

              {error && <div className="text-sm text-red-600">{error}</div>}

              <div className="flex gap-2">
                <button
                  onClick={handleAdminLogin}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                >
                  Login to Admin Panel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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