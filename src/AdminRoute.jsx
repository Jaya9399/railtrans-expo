// DEBUGGING version of AdminRoute
// - Shows the current auth user object and storage keys on screen (useful for mobile debugging).
// - Temporarily loosens the strict email check so you can confirm auth state is working.
// Replace the existing AdminRoute with this while you debug; revert to the original after fixing.

import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

const ADMIN_EMAIL = "support@railtransexpo.com";

export default function AdminRoute({ children }) {
  const { user } = useAuth();

  // If not authenticated — show debug info and a hint (don't immediately redirect)
  if (!user) {
    let storageDump = {};
    try {
      storageDump.local = { ...(window.localStorage || {}) };
      storageDump.session = { ...(window.sessionStorage || {}) };
    } catch (e) {
      storageDump.error = String(e);
    }

    return (
      <div style={{ padding: 20, fontFamily: "system-ui, Arial" }}>
        <h2>Admin route — not authenticated</h2>
        <p>
          You're not signed in (user is null). On mobile this often happens when:
        </p>
        <ul>
          <li>Login didn't finish setting auth in localStorage/session</li>
          <li>Cookies used for sessions are blocked by the browser or SameSite settings</li>
          <li>The login flow navigated before auth state was persisted</li>
        </ul>
        <h3>Local debug</h3>
        <pre style={{ whiteSpace: "pre-wrap", maxHeight: 300, overflow: "auto", background: "#fff", padding: 10, borderRadius: 6, border: "1px solid #eee" }}>
{JSON.stringify(storageDump, null, 2)}
        </pre>
        <p>
          Tip: open your browser console on mobile (remote debugging) and inspect the network requests and console logs during login.
        </p>
        <p>
          For immediate testing you can log in and then refresh the page — if the user appears after refresh it means the login didn't persist state correctly before navigation.
        </p>
        <p>
          <strong>If you want a quick allow-all test:</strong> temporarily change this component to return children (bypassing the check) so you can inspect the admin UI even when user is null. Do not keep bypass in production.
        </p>
      </div>
    );
  }

  // Authenticated — show debug info about the user and access check result.
  const isAdminEmail = !!(user.email && user.email.toLowerCase().trim() === ADMIN_EMAIL.toLowerCase());

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
      {!isAdminEmail ? (
        <div style={{ padding: 20, fontFamily: "system-ui, Arial" }}>
          <h2>Access denied — not admin</h2>
          <p>
            You're signed in but your account is not the admin email required.
          </p>
          <h3>Signed in user object</h3>
          <pre style={{ whiteSpace: "pre-wrap", maxHeight: 300, overflow: "auto", background: "#fff", padding: 10, borderRadius: 6, border: "1px solid #eee" }}>
{JSON.stringify(user, null, 2)}
          </pre>
          <p>
            If you expected to be admin, check:
          </p>
          <ul>
            <li>You're logged in with support@railtransexpo.com exactly (case-insensitive).</li>
            <li>The auth provider returned your email and it's stored in the user object used by useAuth().</li>
            <li>If your auth uses cookies, ensure they're not blocked or SameSite prevents sending them on mobile.</li>
          </ul>
        </div>
      ) : (
        // Admin confirmed — render children (the real admin UI)
        children
      )}
    </div>
  );
}