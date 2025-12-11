import React, { useEffect, useState } from "react";

/**
 * AdminTopbarSettings
 *
 * Fixes applied:
 * - Always call backend API using explicit API_BASE (window.__PUBLIC_BASE__ or REACT_APP_API_BASE_URL).
 * - Sends x-public-base header to help server construct absolute URL if needed.
 * - Uses server-returned absolute URL for preview; persists server-relative path.
 */

function getApiBase() {
  if (typeof process !== "undefined" && process.env?.REACT_APP_API_BASE_URL) {
    return String(process.env.REACT_APP_API_BASE_URL).replace(/\/$/, "");
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return String(window.location.origin).replace(/\/$/, "");
  }
  return "";
}

/** Normalize a server-returned URL for preview */
function normalizePreviewUrl(url, apiBase) {
  if (!url) return url;
  const s = String(url).trim();
  if (!s) return s;
  if (/^https?:\/\//i.test(s) || s.startsWith("data:")) return s;
  const base = apiBase || window?.location?.origin || "";
  return s.startsWith("/") ? base + s : base + "/" + s.replace(/^\//, "");
}

/** Convert absolute same-origin URL back to server-relative path */
function toRelative(url) {
  if (!url) return url;
  try {
    const u = new URL(url, window?.location?.origin);
    const origin = window?.location?.origin;
    if (origin && u.origin === origin) return u.pathname + (u.search || "");
    return url;
  } catch {
    return url;
  }
}

export default function AdminTopbarSettings() {
  const API_BASE = getApiBase();
  const [logoUrl, setLogoUrl] = useState("/images/logo.png");
  const [primaryColor, setPrimaryColor] = useState("#196e87");
  const [fileUploading, setFileUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [serverLogoPath, setServerLogoPath] = useState("");
  const [uploadedPath, setUploadedPath] = useState("");

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const res = await fetch(`${API_BASE}/api/admin-config`, { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error("server");
        const json = await res.json();
        if (!mounted) return;

        if (json.logoUrl) {
          setServerLogoPath(json.logoUrl || "");
          setLogoUrl(normalizePreviewUrl(json.logoUrl || "", API_BASE));
        }
        if (json.primaryColor) setPrimaryColor(json.primaryColor);

        try {
          window.localStorage.setItem("admin:topbar", JSON.stringify({ logoUrl: json.logoUrl || "", primaryColor: json.primaryColor || "" }));
        } catch {}
      } catch {
        try {
          const saved = JSON.parse(localStorage.getItem("admin:topbar") || "{}");
          if (saved.logoUrl) setLogoUrl(normalizePreviewUrl(saved.logoUrl, API_BASE));
          if (saved.primaryColor) setPrimaryColor(saved.primaryColor);
        } catch {}
      }
    }

    load();
    return () => { mounted = false; };
  }, [API_BASE]);

  async function persistAdminConfig(serverLogo, color) {
    const payload = { logoUrl: serverLogo || null, primaryColor: color || null };
    try {
      const res = await fetch(`${API_BASE}/api/admin-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `save failed (${res.status})`);
      }

      const json = await res.json().catch(() => null);
      const savedLogo = (json && (json.logoUrl || json.logo_url)) || payload.logoUrl || "";
      setServerLogoPath(savedLogo || "");
      setUploadedPath("");
      setLogoUrl(savedLogo ? normalizePreviewUrl(savedLogo, API_BASE) : logoUrl);

      try {
        localStorage.setItem("admin:topbar", JSON.stringify({ logoUrl: normalizePreviewUrl(savedLogo || payload.logoUrl || logoUrl, API_BASE), primaryColor: color }));
        window.dispatchEvent(new CustomEvent("admin:topbar-updated", { detail: { logoUrl: savedLogo || payload.logoUrl || "", primaryColor: color } }));
      } catch {}

      setMessage("Saved to server");
      return { ok: true, body: json || null };
    } catch (err) {
      console.error("persistAdminConfig error:", err);
      setMessage("Saved locally (server unavailable)");
      const srv = serverLogo || toRelative(logoUrl);
      const abs = srv ? normalizePreviewUrl(srv, API_BASE) : logoUrl;
      try {
        localStorage.setItem("admin:topbar", JSON.stringify({ logoUrl: abs, primaryColor: color }));
        window.dispatchEvent(new CustomEvent("admin:topbar-updated", { detail: { logoUrl: srv, primaryColor: color } }));
      } catch {}
      return { ok: false, error: err?.message || String(err) };
    }
  }

  async function uploadFile(file) {
    if (!file) return null;
    if (file.size > 10 * 1024 * 1024) { setMessage("File too large (max 10MB)"); return null; }

    const fd = new FormData();
    fd.append("file", file);
    setFileUploading(true); setMessage("");

    try {
      const UPLOAD_ENDPOINT = `${API_BASE}/api/upload-asset`;
      const headers = { "ngrok-skip-browser-warning": "69420", "x-public-base": API_BASE };
      const res = await fetch(UPLOAD_ENDPOINT, { method: "POST", headers, body: fd });

      const text = await res.text().catch(() => "");
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch {}

      if (!res.ok) {
        const errMsg = (json?.error || json?.message) || text || `Upload failed (${res.status})`;
        setMessage(errMsg);
        return null;
      }

      const urlReturned = json?.url || null;
      const relPath = json?.path || null;
      const preview = urlReturned ? normalizePreviewUrl(urlReturned, API_BASE) : normalizePreviewUrl(relPath, API_BASE);

      setLogoUrl(preview);
      setUploadedPath(relPath || "");
      setMessage("Upload successful (preview)");

      try {
        localStorage.setItem("admin:topbar", JSON.stringify({ logoUrl: urlReturned || relPath || preview, primaryColor }));
        window.dispatchEvent(new CustomEvent("admin:topbar-updated", { detail: { logoUrl: relPath || urlReturned, primaryColor } }));
      } catch {}

      const serverValueToSave = relPath || (urlReturned?.startsWith(API_BASE) ? toRelative(urlReturned) : urlReturned);
      if (serverValueToSave) {
        const persistRes = await persistAdminConfig(serverValueToSave, primaryColor);
        if (!persistRes.ok) setMessage(`Uploaded but save failed: ${persistRes.error}`);
        else setUploadedPath("");
      }

      return preview;
    } catch (err) {
      console.error("uploadFile error:", err);
      setMessage("Upload error: " + (err?.message || String(err)));
      return null;
    } finally {
      setFileUploading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setMessage("");
    const serverLogo = uploadedPath || toRelative(logoUrl) || "";
    await persistAdminConfig(serverLogo, primaryColor);
    setSaving(false);
  }

  async function handleRemoveLogo() {
    setLogoUrl("/images/logo.png");
    setUploadedPath("");
    setServerLogoPath("");
    setMessage("Logo cleared locally. Click Save to persist to server.");
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="rounded mb-6" style={{ backgroundColor: primaryColor, color: "#fff", padding: 12, display: "flex", alignItems: "center", gap: 12 }}>
        <img src={logoUrl} alt="logo preview" style={{ height: 44, objectFit: "contain" }} onError={(e) => { e.currentTarget.src = "/images/logo.png"; }} />
        <div style={{ flex: 1 }} />
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 700 }}>Topbar preview</div>
          <div style={{ fontSize: 12, opacity: 0.9, marginTop: 4 }}>{uploadedPath ? "Preview (not saved)" : (serverLogoPath ? "Saved on server" : "Using default")}</div>
        </div>
      </div>

      <h2 className="text-xl font-semibold mb-4">Topbar Settings</h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Upload Logo</label>
          <input type="file" accept="image/*" onChange={async (e) => { setMessage(""); const file = e.target.files?.[0]; if (!file) return; await uploadFile(file); }} />
          {fileUploading && <div className="text-sm">Uploading…</div>}
          <div className="text-sm mt-2">
            {uploadedPath && <span className="text-amber-600">Uploaded (not saved): {uploadedPath}</span>}
            {!uploadedPath && serverLogoPath && <span>Saved path: {serverLogoPath}</span>}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Primary Color</label>
          <div className="flex gap-3 items-center">
            <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="w-12 h-10 p-0 border rounded" />
            <input type="text" className="w-full border rounded px-3 py-2" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving} className="px-4 py-2 bg-indigo-600 text-white rounded">{saving ? "Saving…" : "Save"}</button>
          <button type="button" onClick={handleRemoveLogo} className="px-4 py-2 bg-gray-100 text-gray-800 rounded">Remove Logo</button>
          <div className="text-sm">{message}</div>
        </div>
      </form>
    </div>
  );
}
