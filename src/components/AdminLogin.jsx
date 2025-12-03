import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

/*
  AdminLogin component
  - Self-contained admin login modal component.
  - Reads admin credentials from environment variables (CRA or Vite), falling back to demo credentials.
  - Calls onSuccess() after successful login; calls onClose() to dismiss.
  - Stores a minimal user object in localStorage on success so existing route-guards can detect admin session.
*/


const ENV_ADMIN_EMAIL =
  (process.env.REACT_APP_ADMIN_EMAIL) ||
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_ADMIN_EMAIL) ;


const ENV_ADMIN_PASSWORD =
  (process.env.REACT_APP_ADMIN_PASSWORD) ||
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_ADMIN_PASSWORD) ;
 

function ShieldIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M12 2l7 3v5c0 5-3.5 9.5-7 11-3.5-1.5-7-6-7-11V5l7-3z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function AdminLogin({ open = false, onClose = () => {}, onSuccess = () => {} }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleAdminLogin = () => {
    setError("");
    const enteredEmail = (email || "").trim().toLowerCase();
    const requiredEmail = (ENV_ADMIN_EMAIL ).trim().toLowerCase();
    const requiredPassword = ENV_ADMIN_PASSWORD;

    if (!enteredEmail || !password) {
      setError("Please enter both email and password.");
      return;
    }

    if (enteredEmail === requiredEmail && password === requiredPassword) {
      try {
        localStorage.setItem("user", JSON.stringify({ email: requiredEmail }));
      } catch (e) { /* ignore */ }

      // call parent onSuccess so parent can navigate or update UI
      onSuccess();

      // also navigate here as a fallback (replace history)
      try { navigate("/admin", { replace: true }); } catch (e) {}
    } else {
      setError("Invalid credentials. Please try again.");
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") handleAdminLogin();
  };

  if (!open) return null;

  return (
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
          <h2 id="admin-login-title" className="text-lg font-semibold">Admin Login</h2>
          <div className="ml-auto">
            <button
              onClick={onClose}
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
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}