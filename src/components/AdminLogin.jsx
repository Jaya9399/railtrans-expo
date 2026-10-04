import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

const ENV_ADMIN_EMAIL =
  (process.env.REACT_APP_ADMIN_EMAIL) ||
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_ADMIN_EMAIL) || "";

const ENV_ADMIN_PASSWORD =
  (process.env.REACT_APP_ADMIN_PASSWORD) ||
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_ADMIN_PASSWORD) || "";

export default function AdminLogin({ open = false, onClose = () => {}, onSuccess = () => {} }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleAdminLogin = () => {
    setError("");
    const enteredEmail = (email || "").trim().toLowerCase();
    const requiredEmail = (ENV_ADMIN_EMAIL || "").trim().toLowerCase();
    const requiredPassword = ENV_ADMIN_PASSWORD;

    if (!requiredEmail || !requiredPassword) {
      setError("Admin login is not configured. Please set environment variables.");
      console.error("Admin credentials not configured. Set REACT_APP_ADMIN_EMAIL and REACT_APP_ADMIN_PASSWORD");
      return;
    }

    if (!enteredEmail || !password) {
      setError("Please enter both email and password.");
      return;
    }

    if (enteredEmail === requiredEmail && password === requiredPassword) {
      const user = { email: requiredEmail };

      try {
        localStorage.setItem("user", JSON.stringify(user));
      } catch (e) {
        console.warn("failed to write localStorage user", e);
      }

      try {
        window.dispatchEvent(new CustomEvent("auth:changed", { detail: { user } }));
      } catch (e) {}

      onSuccess && onSuccess();
      onClose && onClose();

      try { navigate("/admin", { replace: true }); } catch (e) {}
    } else {
      setError("Invalid credentials. Please try again.");
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 border">
        
        {/* ✅ RailTrans Logo */}
        <div className="mx-auto w-28 h-28 flex items-center justify-center rounded-2xl bg-white shadow-lg mb-6">
          <img 
            src="/images/logo.png" 
            alt="RailTrans Expo" 
            className="w-24 h-24 object-contain"
            onError={(e) => {
              e.currentTarget.src = "/images/logo.png";
            }}
          />
        </div>

        <div className="text-center mb-4">
          <h2 className="text-lg font-semibold text-gray-800">Admin Login</h2>
          <p className="text-sm text-gray-500">RailTrans Expo 2027</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
              className="w-full rounded-lg border border-gray-200 px-3 py-2 focus:ring-2 focus:ring-blue-300"
              placeholder="Enter password"
              autoComplete="current-password"
            />
          </div>

          {error && <div className="text-sm text-red-600 text-center">{error}</div>}

          <div className="flex gap-2">
            <button 
              onClick={handleAdminLogin} 
              className="flex-1 px-4 py-2 bg-[#196e87] text-white rounded-lg hover:bg-[#155d73] transition font-medium"
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