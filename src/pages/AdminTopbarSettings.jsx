import React, { useEffect, useState } from "react";

/** Convert `/uploads/...` → `http://domain/uploads/...` */
function toAbsolute(url) {
  if (!url) return url;
  if (String(url).startsWith("http")) return url;
  return `${window.location.origin}${url}`;
}

/** Convert absolute same-origin URL back to server-relative path */
function toRelative(url) {
  if (!url) return url;
  try {
    const u = new URL(String(url), window.location.origin);
    if (u.origin === window.location.origin) return u.pathname + (u.search || "");
  } catch {}
  return url;
}

export default function AdminTopbarSettings() {
  const [logoUrl, setLogoUrl] = useState("/images/logo.png"); // absolute preview URL
  const [primaryColor, setPrimaryColor] = useState("#196e87");
  const [fileUploading, setFileUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  // server-side saved relative path (e.g. /uploads/123.png) or empty
  const [serverLogoPath, setServerLogoPath] = useState("");
  // pending uploaded path (relative) that hasn't been saved to server yet
  const [uploadedPath, setUploadedPath] = useState("");

  /* Load settings from backend */
  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const res = await fetch("/api/admin-config", { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error("server");
        const json = await res.json();

        if (!mounted) return;

        if (json.logoUrl) {
          const rel = String(json.logoUrl || "");
          setServerLogoPath(rel);
          setLogoUrl(toAbsolute(rel));
        } else {
          setServerLogoPath("");
        }
        if (json.primaryColor) setPrimaryColor(json.primaryColor);
        // persist preview locally too
        try {
          window.localStorage.setItem("admin:topbar", JSON.stringify({ logoUrl: json.logoUrl || "", primaryColor: json.primaryColor || "" }));
        } catch {}
      } catch {
        // fallback local
        try {
          const saved = JSON.parse(localStorage.getItem("admin:topbar") || "{}");
          if (saved.logoUrl) {
            setLogoUrl(toAbsolute(saved.logoUrl));
            setServerLogoPath(saved.logoUrl || "");
          }
          if (saved.primaryColor) setPrimaryColor(saved.primaryColor);
        } catch {}
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  /** Persist admin-config to server */
  async function persistAdminConfig(serverLogo, color) {
    const payload = {
      logoUrl: serverLogo || null,
      primaryColor: color || null,
    };
    try {
      const res = await fetch("/api/admin-config", {
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
      // update state
      setServerLogoPath(savedLogo || "");
      setUploadedPath("");
      setLogoUrl(savedLogo ? toAbsolute(savedLogo) : (logoUrl || "/images/logo.png"));
      // persist local preview
      const toStore = { logoUrl: toAbsolute(savedLogo || toRelative(logoUrl)), primaryColor: color };
      try { localStorage.setItem("admin:topbar", JSON.stringify(toStore)); } catch {}
      try { window.dispatchEvent(new CustomEvent("admin:topbar-updated", { detail: { logoUrl: savedLogo, primaryColor: color } })); } catch {}
      setMessage("Saved to server");
      return { ok: true, body: json || null };
    } catch (err) {
      console.error("persistAdminConfig error:", err);
      setMessage("Saved locally (server unavailable)");
      // fallback: persist local preview
      const srv = serverLogo || toRelative(logoUrl);
      const abs = srv ? toAbsolute(srv) : logoUrl;
      const toStore = { logoUrl: abs, primaryColor: color };
      try { localStorage.setItem("admin:topbar", JSON.stringify(toStore)); } catch {}
      try { window.dispatchEvent(new CustomEvent("admin:topbar-updated", { detail: { logoUrl: srv, primaryColor: color } })); } catch {}
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  }

  /** Upload file to backend and auto-save the uploaded path to admin-config */
  async function uploadFile(file) {
    if (!file) return null;

    if (file.size > 10 * 1024 * 1024) {
      setMessage("File too large (max 10MB)");
      return null;
    }

    const fd = new FormData();
    fd.append("file", file);

    setFileUploading(true);
    setMessage("");

    try {
      // endpoint matches server multer route
      const UPLOAD_ENDPOINT = "/api/upload-asset";

      const res = await fetch(UPLOAD_ENDPOINT, {
        method: "POST",
        headers: { "ngrok-skip-browser-warning": "69420" },
        body: fd,
      });

      const text = await res.text().catch(() => "");
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }

      if (!res.ok) {
        const errMsg = (json && (json.error || json.message)) || text || `Upload failed (${res.status})`;
        setMessage(errMsg);
        return null;
      }

      const urlPath = (json && (json.url || json.imageUrl || json.fileUrl)) || null;
      if (!urlPath) {
        setMessage("Upload succeeded but server did not return a file URL");
        return null;
      }

      const absUrl = toAbsolute(urlPath);
      setMessage("Upload successful (preview)");

      // show preview immediately and store uploaded relative path pending save
      setUploadedPath(urlPath);
      setLogoUrl(absUrl);

      // persist preview locally as absolute URL so reload shows preview
      const merged = { logoUrl: absUrl, primaryColor };
      try { localStorage.setItem("admin:topbar", JSON.stringify(merged)); } catch {}

      // broadcast preview update so other components update live
      try { window.dispatchEvent(new CustomEvent("admin:topbar-updated", { detail: { logoUrl: urlPath, primaryColor } })); } catch {}

      // AUTO-SAVE: attempt to persist the uploaded path to server immediately
      // This avoids "Uploaded (not saved)" UX; if the server persist fails we'll keep uploadedPath so user can retry Save.
      const persistRes = await persistAdminConfig(urlPath, primaryColor);
      if (persistRes && persistRes.ok) {
        // saved; clear uploadedPath (persistAdminConfig clears it)
        setUploadedPath("");
      } else {
        // not saved: keep uploadedPath and inform the user they can click Save
        setMessage((persistRes && persistRes.error) ? `Uploaded but save failed: ${persistRes.error}` : "Uploaded (not saved): click Save to persist");
      }

      return absUrl;
    } catch (err) {
      console.error("uploadFile error:", err);
      setMessage("Upload error: " + (err && err.message ? err.message : String(err)));
      return null;
    } finally {
      setFileUploading(false);
    }
  }

  /** Save to backend (manual Save) */
  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    // determine the server value to persist: if user uploaded a new file, prefer that (relative path),
    // otherwise convert current logoUrl back to relative (if same-origin).
    let serverLogo = "";
    if (uploadedPath) {
      serverLogo = uploadedPath;
    } else {
      serverLogo = toRelative(logoUrl) || "";
    }

    await persistAdminConfig(serverLogo, primaryColor);
    setSaving(false);
  }

  async function handleRemoveLogo() {
    // clear preview and server value (on save they can persist null)
    setLogoUrl("/images/logo.png");
    setUploadedPath("");
    setServerLogoPath("");
    setMessage("Logo cleared locally. Click Save to persist to server.");
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* PREVIEW */}
      <div
        className="rounded mb-6"
        style={{
          backgroundColor: primaryColor,
          color: "#fff",
          padding: 12,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <img
          src={logoUrl}
          alt="logo preview"
          style={{ height: 44, objectFit: "contain" }}
          onError={(e) => (e.currentTarget.src = "/images/logo.png")}
        />
        <div style={{ flex: 1 }} />

        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 700 }}>Topbar preview</div>
          <div style={{ fontSize: 12, opacity: 0.9, marginTop: 4 }}>
            {uploadedPath ? "Preview (not saved)" : (serverLogoPath ? "Saved on server" : "Using default")}
          </div>
        </div>
      </div>

      <h2 className="text-xl font-semibold mb-4">Topbar Settings</h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* UPLOAD LOGO */}
        <div>
          <label className="block text-sm font-medium mb-1">Upload Logo</label>
          <input
            type="file"
            accept="image/*"
            onChange={async (e) => {
              setMessage("");
              const file = e.target.files?.[0];
              if (!file) return;

              const url = await uploadFile(file);
              if (url) setLogoUrl(url);
            }}
          />
          {fileUploading && <div className="text-sm">Uploading…</div>}
          <div className="text-sm mt-2">
            {uploadedPath ? <span className="text-amber-600">Uploaded (not saved): {uploadedPath}</span> : null}
           
          </div>
        </div>

        {/* PRIMARY COLOR */}
        <div>
          <label className="block text-sm font-medium mb-1">Primary Color</label>
          <div className="flex gap-3 items-center">
            <input
              type="color"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              className="w-12 h-10 p-0 border rounded"
            />
            <input
              type="text"
              className="w-full border rounded px-3 py-2"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-indigo-600 text-white rounded"
          >
            {saving ? "Saving…" : "Save"}
          </button>

          <button
            type="button"
            onClick={handleRemoveLogo}
            className="px-4 py-2 bg-gray-100 text-gray-800 rounded"
          >
            Remove Logo
          </button>

          <div className="text-sm">{message}</div>
        </div>
      </form>
    </div>
  );
}