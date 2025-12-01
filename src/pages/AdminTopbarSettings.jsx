import React, { useEffect, useState } from "react";

/**
 * AdminTopbarSettings (frontend)
 *
 * - Supports file upload for logo (multipart/form-data -> /api/admin-config/upload)
 * - Saves settings via PUT /api/admin-config
 * - Falls back to localStorage if server unavailable
 */
export default function AdminTopbarSettings() {
  const [logoUrl, setLogoUrl] = useState("/images/logo.png");
  const [primaryColor, setPrimaryColor] = useState("#196e87");
  const [fileUploading, setFileUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const res = await fetch("/api/admin-config");
        if (!res.ok) throw new Error("no server");
        const json = await res.json();
        if (!mounted) return;
        if (json.logoUrl) setLogoUrl(json.logoUrl);
        if (json.primaryColor) setPrimaryColor(json.primaryColor);
        return;
      } catch (err) {
        const saved = localStorage.getItem("admin:topbar");
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            if (parsed.logoUrl) setLogoUrl(parsed.logoUrl);
            if (parsed.primaryColor) setPrimaryColor(parsed.primaryColor);
          } catch {}
        }
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  async function uploadFile(file) {
    if (!file) return null;
    setFileUploading(true);
    setMessage("");
    try {
      const fd = new FormData();
      fd.append("logo", file);

      const res = await fetch("/api/admin-config/upload", {
        method: "POST",
        body: fd,
        // don't set Content-Type header; browser will set multipart boundary
      });

      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }

      if (!res.ok) {
        console.error("Upload failed", res.status, text);
        setMessage(`Upload failed: ${res.status} ${json?.error || text}`);
        return null;
      }

      if (!json) {
        setMessage("Upload failed: server returned non-JSON response");
        console.error("Upload response text:", text);
        return null;
      }

      if (!json.url) {
        setMessage("Upload failed: no url returned");
        console.error("Upload response:", json);
        return null;
      }

      // success
      setMessage("Upload successful");
      // persist locally so Topbar can pick it up if needed
      try {
        const prev = JSON.parse(localStorage.getItem("admin:topbar") || "{}");
        const merged = { ...prev, logoUrl: json.url };
        localStorage.setItem("admin:topbar", JSON.stringify(merged));
        // broadcast storage event by writing again (some browsers don't fire in same tab)
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: "admin:topbar",
            newValue: JSON.stringify(merged),
          })
        );
      } catch {}
      return json.url;
    } catch (err) {
      console.error("Upload error", err);
      setMessage("Upload error: " + (err.message || err));
      return null;
    } finally {
      setFileUploading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    const payload = {
      logoUrl: logoUrl || null,
      primaryColor: primaryColor || null,
    };
    try {
      const res = await fetch("/api/admin-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("server failed");
      setMessage("Saved to server");
      localStorage.setItem("admin:topbar", JSON.stringify(payload));
    } catch (err) {
      console.warn("save failed, storing locally", err);
      try {
        localStorage.setItem("admin:topbar", JSON.stringify(payload));
        setMessage("Saved locally (server unavailable)");
      } catch {
        setMessage("Save failed");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div
        style={{
          backgroundColor: primaryColor,
          color: "#fff",
          padding: 12,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
        className="rounded mb-6"
      >
        <img
          src={logoUrl}
          alt="logo preview"
          style={{ height: 44, objectFit: "contain" }}
          onError={(e) => {
            e.currentTarget.src = "/images/logo.png";
          }}
        />
        <div style={{ flex: 1 }} />
        <div style={{ fontWeight: 700 }}>Topbar preview</div>
      </div>

      <h2 className="text-xl font-semibold mb-4">Topbar Settings</h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">
            Upload Logo (image)
          </label>
          <input
            type="file"
            accept="image/*"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const url = await uploadFile(f);
              if (url) setLogoUrl(url);
            }}
          />
          {fileUploading && (
            <div className="text-sm text-gray-600">Uploading…</div>
          )}
          <div className="text-xs text-gray-500 mt-1">
            File will be uploaded and URL saved in config.
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Primary Color
          </label>
          <div className="flex gap-3 items-center">
            <input
              type="color"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              className="w-12 h-10 p-0 border rounded"
            />
            <input
              type="text"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              className="w-full border rounded px-3 py-2"
            />
          </div>
        </div>

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
            className="px-3 py-2 border rounded"
            onClick={() => {
              setLogoUrl("/images/logo.png");
              setPrimaryColor("#196e87");
            }}
          >
            Reset
          </button>
          <div className="text-sm text-gray-600">{message}</div>
        </div>
      </form>
    </div>
  );
}
