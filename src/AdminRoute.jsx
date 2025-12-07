import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

/*
  AdminRoute (no AuthProvider required)
  - Reads `user` from localStorage on mount.
  - Listens for "auth:changed" custom events and the window "storage" event so it updates when AdminLogin writes localStorage.
  - Shows debug UI when not authenticated (same style as your debug version).
  - Use this as a drop-in replacement for your AdminRoute while you don't have a full AuthProvider.
*/

const ADMIN_EMAIL = "support@railtransexpo.com";

function readUserFromStorage() {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      // tolerate double-encoded or plain strings
      try { return JSON.parse(JSON.parse(raw)); } catch { return null; }
    }
  } catch (e) {
    console.warn("readUserFromStorage failed", e);
    return null;
  }
}

export default function AdminRoute({ children }) {
  const [user, setUser] = useState(() => readUserFromStorage());
  const [storageDump, setStorageDump] = useState(null);

  useEffect(() => {
    // update storage dump for debug screen
    function dump() {
      try {
        setStorageDump({
          local: { ...(window.localStorage || {}) },
          session: { ...(window.sessionStorage || {}) },
        });
      } catch (e) {
        setStorageDump({ error: String(e) });
      }
    }
    dump();

    function onAuthChanged(e) {
      const u = e && e.detail && e.detail.user ? e.detail.user : readUserFromStorage();
      setUser(u || null);
      dump();
    }

    function onStorage(e) {
      // storage events occur on other windows/tabs; update local view
      setUser(readUserFromStorage());
      dump();
    }

    window.addEventListener("auth:changed", onAuthChanged);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("auth:changed", onAuthChanged);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // If not authenticated — show debug info and a hint (don't immediately redirect)
  if (!user) {
    return (
      <div style={{ padding: 20, fontFamily: "system-ui, Arial" }}>
        <h2>Admin route — not authenticated</h2>
        <p>You're not signed in (user is null). On mobile this often happens when:</p>
        <ul>
          <li>Login didn't finish setting auth in localStorage/session</li>
          <li>Cookies used for sessions are blocked by the browser or SameSite settings</li>
          <li>The login flow navigated before auth state was persisted</li>
        </ul>

        <h3>Local debug</h3>
        <pre style={{ whiteSpace: "pre-wrap", maxHeight: 300, overflow: "auto", background: "#fff", padding: 10, borderRadius: 6, border: "1px solid #eee" }}>
{JSON.stringify(storageDump || { local: { ...(window.localStorage || {}) }, session: { ...(window.sessionStorage || {}) } }, null, 2)}
        </pre>

        <p>
          Tip: open your browser console on mobile (remote debugging) and inspect the network requests and console logs during login.
        </p>
        <p>
          For immediate testing you can log in and then refresh the page — if the user appears after refresh it means the login didn't persist state correctly before navigation.
        </p>
        <p><strong>If you want a quick allow-all test:</strong> temporarily change this component to return children (bypassing the check) so you can inspect the admin UI even when user is null. Do not keep bypass in production.</p>
      </div>
    );
  }

  // Authenticated — check admin email
  const isAdminEmail = !!(user.email && user.email.toLowerCase().trim() === ADMIN_EMAIL.toLowerCase());

  if (!isAdminEmail) {
    return (
      <div style={{ padding: 20, fontFamily: "system-ui, Arial" }}>
        <h2>Access denied — not admin</h2>
        <p>You're signed in but your account is not the admin email required.</p>
        <h3>Signed in user object</h3>
        <pre style={{ whiteSpace: "pre-wrap", maxHeight: 300, overflow: "auto", background: "#fff", padding: 10, borderRadius: 6, border: "1px solid #eee" }}>
{JSON.stringify(user, null, 2)}
        </pre>
        <p>If you expected to be admin, check:</p>
        <ul>
          <li>You're logged in with support@railtransexpo.com exactly (case-insensitive).</li>
          <li>The auth provider returned your email and it's stored in the "user" localStorage key.</li>
          <li>If your auth uses cookies, ensure they're not blocked or SameSite prevents sending them on mobile.</li>
        </ul>
      </div>
    );
  }

  // Admin confirmed — render children (the real admin UI)
  return <>{children}</>;
}