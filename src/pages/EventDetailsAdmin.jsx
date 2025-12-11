import React, { useEffect, useState, useCallback } from "react";

/**
 * EventDetailsAdmin.jsx
 *
 * Fetches the persisted event-details config and shows values directly in the form fields.
 * Saves to /api/configs/event-details (preferred) with fallback to /api/event-details/config.
 *
 * Adds ngrok skip header on all requests so uploads and fetches behind ngrok don't show warnings:
 *   "ngrok-skip-browser-warning": "69420"
 *
 * Usage:
 * - Place this file at src/pages/EventDetailsAdmin.jsx and add a route in your admin UI.
 */

const API_BASE = (
  process.env.REACT_APP_API_BASE ||
  process.env.REACT_APP_API_BASE_URL ||
  window.__API_BASE__ ||
  ""
).replace(/\/$/, "");

// Helpers to build URLs
function configsUrl(key = "") {
  if (!key) throw new Error("config key required");
  return `${API_BASE}/api/configs/${encodeURIComponent(key)}`;
}
function legacyGetUrl() {
  const base = API_BASE || "";
  return `${base}/api/event-details`;
}
function legacyPostUrl() {
  const base = API_BASE || "";
  return `${base}/api/event-details/config`;
}

const NGROK_HEADER = { "ngrok-skip-browser-warning": "69420" };

function normalize(raw = {}) {
  return {
    name: raw.name || "",
    date: raw.date || "",
    venue: raw.venue || "",
    time: raw.time || "",
    tagline: raw.tagline || "",
  };
}

export default function EventDetailsAdmin() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const [serverValue, setServerValue] = useState(null); // authoritative server value (object or null)
  const [local, setLocal] = useState({ name: "", date: "", venue: "", time: "", tagline: "" });
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchServer = useCallback(async () => {
    setLoading(true);
    setError("");
    setMsg("");
    try {
      // Preferred: unified configs endpoint
      try {
        const res = await fetch(configsUrl("event-details"), {
          cache: "no-store",
          headers: { Accept: "application/json", ...NGROK_HEADER },
        });
        if (res.ok) {
          const js = await res.json().catch(() => ({}));
          const val = js && js.value !== undefined ? js.value : js;
          const normalized = normalize(val || {});
          setServerValue(normalized);
          setLocal(normalized); // populate form fields with server data
          setLastUpdated(js && js.updatedAt ? js.updatedAt : (val && val.updatedAt ? val.updatedAt : null));
          setLoading(false);
          return;
        }
      } catch (e) {
        // fallthrough to legacy
        console.warn("configs endpoint fetch failed, falling back to legacy:", e && e.message);
      }

      // Legacy GET
      try {
        const res2 = await fetch(legacyGetUrl(), {
          cache: "no-store",
          headers: { Accept: "application/json", ...NGROK_HEADER },
        });
        if (res2.ok) {
          const js2 = await res2.json().catch(() => ({}));
          const normalized = normalize(js2 || {});
          setServerValue(normalized);
          setLocal(normalized);
          setLastUpdated(js2 && js2.updatedAt ? js2.updatedAt : null);
          setLoading(false);
          return;
        }
      } catch (e) {
        console.warn("legacy event-details GET failed:", e && e.message);
      }

      // Nothing stored
      setServerValue(null);
      setLocal({ name: "", date: "", venue: "", time: "", tagline: "" });
    } catch (err) {
      console.error("fetchServer error", err);
      setError("Failed to load persisted event details");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServer();

    function onGlobal(e) {
      const key = e && e.detail && e.detail.key ? e.detail.key : null;
      if (!key || key === "event-details") fetchServer().catch(() => {});
      if (e && e.type === "event-details-updated") fetchServer().catch(() => {});
      const entityKeys = ["visitor-config-updated","exhibitor-config-updated","partner-config-updated","speaker-config-updated","awardee-config-updated"];
      if (entityKeys.includes(e && e.type)) fetchServer().catch(() => {});
    }
    window.addEventListener("config-updated", onGlobal);
    window.addEventListener("event-details-updated", onGlobal);
    window.addEventListener("visitor-config-updated", onGlobal);
    window.addEventListener("exhibitor-config-updated", onGlobal);
    window.addEventListener("partner-config-updated", onGlobal);
    window.addEventListener("speaker-config-updated", onGlobal);
    window.addEventListener("awardee-config-updated", onGlobal);

    return () => {
      window.removeEventListener("config-updated", onGlobal);
      window.removeEventListener("event-details-updated", onGlobal);
      window.removeEventListener("visitor-config-updated", onGlobal);
      window.removeEventListener("exhibitor-config-updated", onGlobal);
      window.removeEventListener("partner-config-updated", onGlobal);
      window.removeEventListener("speaker-config-updated", onGlobal);
      window.removeEventListener("awardee-config-updated", onGlobal);
    };
  }, [fetchServer]);

  function update(field, value) {
    setLocal(prev => ({ ...prev, [field]: value }));
  }

  const isDirty = serverValue
    ? JSON.stringify(serverValue) !== JSON.stringify(local)
    : JSON.stringify(local) !== JSON.stringify({ name: "", date: "", venue: "", time: "", tagline: "" });

  async function save() {
    setSaving(true);
    setMsg("");
    setError("");
    try {
      const payload = {
        name: local.name || "",
        date: local.date || "",
        venue: local.venue || "",
        time: local.time || "",
        tagline: local.tagline || "",
      };

      // Try unified endpoint first
      let posted = false;
      try {
        const res = await fetch(configsUrl("event-details"), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...NGROK_HEADER },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(txt || `HTTP ${res.status}`);
        }
        posted = true;
      } catch (e) {
        // fallback to legacy POST
        try {
          const res2 = await fetch(legacyPostUrl(), {
            method: "POST",
            headers: { "Content-Type": "application/json", ...NGROK_HEADER },
            body: JSON.stringify(payload),
          });
          if (!res2.ok) {
            const txt2 = await res2.text().catch(() => "");
            throw new Error(txt2 || `HTTP ${res2.status}`);
          }
          posted = true;
        } catch (e2) {
          throw e2;
        }
      }

      if (!posted) throw new Error("Failed to persist event details");

      // Re-fetch authoritative server value and populate the form
      await fetchServer();

      setMsg("Saved successfully.");
      try { window.dispatchEvent(new CustomEvent("config-updated", { detail: { key: "event-details" } })); } catch {}
      try { window.dispatchEvent(new Event("event-details-updated")); } catch {}
    } catch (err) {
      console.error("save error", err);
      setError("Save failed: " + (err && err.message ? err.message : ""));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6">Loading event details…</div>;

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-2xl font-bold mb-4">Event Details (Admin)</h2>

      {lastUpdated ? (
        <div className="mb-2 text-sm text-gray-600">Last saved: {new Date(lastUpdated).toLocaleString()}</div>
      ) : null}

      {error && <div className="mb-4 text-red-600">{error}</div>}
      {msg && <div className="mb-4 text-green-600">{msg}</div>}

      <label className="block mb-2">Event Name</label>
      <input className="w-full border px-3 py-2 mb-4" value={local.name} onChange={(e) => update("name", e.target.value)} />

      <label className="block mb-2">Date</label>
      <input className="w-full border px-3 py-2 mb-4" value={local.date} onChange={(e) => update("date", e.target.value)} placeholder="e.g. 2025-12-10 or Dec 10, 2025" />

      <label className="block mb-2">Venue / Address</label>
      <input className="w-full border px-3 py-2 mb-4" value={local.venue} onChange={(e) => update("venue", e.target.value)} />

      <label className="block mb-2">Time</label>
      <input className="w-full border px-3 py-2 mb-4" value={local.time} onChange={(e) => update("time", e.target.value)} placeholder="e.g. 10:00 AM - 5:00 PM" />

      <label className="block mb-2">Tagline</label>
      <input className="w-full border px-3 py-2 mb-4" value={local.tagline} onChange={(e) => update("tagline", e.target.value)} />

      <div className="flex items-center gap-3 mt-6">
        <button onClick={save} className="px-5 py-2 bg-blue-600 text-white rounded" disabled={saving || !isDirty}>
          {saving ? "Saving..." : "Save"}
        </button>
        {!isDirty && <div className="text-sm text-gray-500">No changes to save</div>}
      </div>
    </div>
  );
}