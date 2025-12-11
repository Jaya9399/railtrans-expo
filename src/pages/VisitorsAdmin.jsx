import React, { useEffect, useState } from "react";
import DynamicRegistrationForm from "./DynamicRegistrationForm";

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

// Use REACT_APP_API_BASE, or REACT_APP_API_BASE_URL, or window.__API_BASE__, or default to ""
const API_BASE = (
  process.env.REACT_APP_API_BASE ||
  process.env.REACT_APP_API_BASE_URL ||
  window.__API_BASE__ ||
  ""
).replace(/\/$/, "");

/**
 * Normalize admin asset URLs:
 * - If absolute (http/https) leave alone (but convert http->https on secure origins)
 * - If relative (starts with "/") prefix with API_BASE (or window.location.origin if API_BASE is empty)
 * - If bare path, prefix with API_BASE
 */
function normalizeAdminUrl(url) {
  try {
    if (!url) return "";
    const s = String(url).trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) {
      // convert http->https on secure pages for localhost-hosted assets behind ngrok
      if (/^http:\/\//i.test(s) && typeof window !== "undefined" && window.location && window.location.protocol === "https:") {
        try {
          const parsed = new URL(s);
          if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
            return window.location.origin + parsed.pathname + (parsed.search || "");
          }
        } catch {}
        return s.replace(/^http:/i, "https:");
      }
      return s;
    }
    // relative path
    if (s.startsWith("/")) {
      if (API_BASE) return `${API_BASE.replace(/\/$/, "")}${s}`;
      return `${window.location.origin.replace(/\/$/, "")}${s}`;
    }
    // bare path
    if (API_BASE) return `${API_BASE.replace(/\/$/, "")}/${s.replace(/^\//, "")}`;
    return `${window.location.origin.replace(/\/$/, "")}/${s.replace(/^\//, "")}`;
  } catch (e) {
    return String(url || "");
  }
}

/**
 * Upload helper: sends file to the backend upload endpoint.
 * - endpoint: API path or absolute URL (default to /api/upload-asset)
 * - fieldName: form field name expected by server ("file" by default)
 * Returns the returned public URL (data.url || data.imageUrl || ...)
 */
async function uploadFileToServer(file, endpoint = "/api/upload-asset", fieldName = "file") {
  if (!file) throw new Error("No file provided");
  // Client-side file size guard (match server limits)
  const MAX_SIZE = 250 * 1024 * 1024; // 250MB
  if (file.size && file.size > MAX_SIZE) throw new Error(`File too large (${Math.round(file.size/1024/1024)}MB). Max ${MAX_SIZE/1024/1024}MB.`);

  const url = endpoint.startsWith("http") ? endpoint : `${API_BASE}${endpoint}`;
  const formData = new FormData();
  formData.append(fieldName, file);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      // do not set Content-Type for FormData
      "ngrok-skip-browser-warning": "69420",
    },
    body: formData,
  });

  // helpful error body capture
  if (!res.ok) {
    let bodyText = "";
    try { bodyText = await res.text(); } catch {}
    // try to extract JSON error message
    try {
      const parsed = JSON.parse(bodyText || "{}");
      if (parsed && (parsed.error || parsed.message)) {
        throw new Error(`Upload failed (${res.status}) ${JSON.stringify(parsed)}`);
      }
    } catch (e) {
      // ignore parse error
    }
    throw new Error(`Upload failed (${res.status}) ${bodyText}`);
  }

  const data = await res.json().catch(() => ({}));
  return data.url || data.imageUrl || data.fileUrl || data.path || "";
}

/**
 * Important: default fields use names expected by backend (see registerVisitor)
 */
const DEFAULT_VISITOR_FIELDS = [
  { name: "title", label: "Title", type: "radio", options: ["Mr.", "Ms.", "Dr."], required: true, visible: true },
  { name: "name", label: "Name", type: "text", required: true, visible: true },
  { name: "mobile", label: "Mobile No.", type: "number", required: true, visible: true, meta: { useOtp: true } },
  { name: "email", label: "Email ID", type: "email", required: true, visible: true, meta: { useOtp: true } },
  { name: "designation", label: "Designation", type: "text", required: true, visible: true },
  { name: "company_type", label: "Company / Other", type: "radio", options: ["Company", "Other"], required: true, visible: true },
  { name: "company", label: "Company (if selected)", type: "text", required: true, visible: true },
  { name: "other_details", label: "Other (if selected)", type: "textarea", required: true, visible: true },
  { name: "purpose", label: "Purpose of Visit", type: "textarea", required: true, visible: true },
];

export default function VisitorsAdmin() {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/visitor-config`, { method: "GET", headers: { "Accept": "application/json", "ngrok-skip-browser-warning": "69420" } });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Failed to fetch config: ${res.status} ${text}`);
        }
        const cfg = await res.json().catch(() => ({}));
        if (!mounted) return;

        const normalized = {
          ...cfg,
          fields: Array.isArray(cfg.fields) ? cfg.fields : [],
          images: Array.isArray(cfg.images) ? cfg.images : [],
          eventDetails: typeof cfg.eventDetails === "object" && cfg.eventDetails ? cfg.eventDetails : {},
          backgroundMedia: cfg.backgroundMedia || { type: "image", url: "" },
          termsUrl: cfg.termsUrl || "",
          termsLabel: cfg.termsLabel || "Terms & Conditions",
          termsRequired: !!cfg.termsRequired,
          backgroundColor: cfg.backgroundColor || "#ffffff",
          badgeTemplateUrl: cfg.badgeTemplateUrl || ""
        };

        // normalize image/background/terms urls so admin preview works for both relative and absolute urls
        if (Array.isArray(normalized.images)) {
          normalized.images = normalized.images.map(u => normalizeAdminUrl(u));
        } else {
          normalized.images = [];
        }
        if (normalized.backgroundMedia && normalized.backgroundMedia.url) {
          normalized.backgroundMedia = {
            type: normalized.backgroundMedia.type || "image",
            url: normalizeAdminUrl(normalized.backgroundMedia.url)
          };
        } else {
          normalized.backgroundMedia = { type: "image", url: "" };
        }
        if (normalized.termsUrl) normalized.termsUrl = normalizeAdminUrl(normalized.termsUrl);

        normalized.fields = normalized.fields.map(f =>
          ["select","radio"].includes(f.type) ? { ...f, options: Array.isArray(f.options) ? f.options : [""] } : { ...f, options: Array.isArray(f.options) ? f.options : [] }
        );

        const existing = new Set(normalized.fields.map(f => f.name));
        DEFAULT_VISITOR_FIELDS.forEach(def => {
          if (!existing.has(def.name)) normalized.fields.push(clone(def));
        });

        normalized.fields = normalized.fields.map(f => {
          if (!f || !f.name) return f;
          if (f.name === "company") {
            const copy = { ...f };
            if (!copy.visibleIf) copy.visibleIf = { company_type: "Company" };
            return copy;
          }
          if (f.name === "other_details") {
            const copy = { ...f };
            if (!copy.visibleIf) copy.visibleIf = { company_type: "Other" };
            return copy;
          }
          return f;
        });

        setConfig(normalized);
      } catch (e) {
        console.error("VisitorsAdmin load config error:", e && (e.stack || e));
        setError("Error loading config from backend. See server logs.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => (mounted = false);
  }, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div className="text-red-600 p-4">{error}</div>;
  if (!config) return <div className="text-red-600 p-4">No config found.</div>;

  function updateField(idx, updates) {
    setConfig(prev => {
      const cfg = clone(prev);
      const prevField = cfg.fields[idx] || {};
      const merged = { ...prevField, ...updates };
      if (updates.type && ["select","radio"].includes(updates.type) && !Array.isArray(merged.options)) merged.options = [""];
      if (updates.type && !["select","radio"].includes(updates.type)) merged.options = [];
      cfg.fields[idx] = merged;
      return cfg;
    });
  }
  function deleteField(idx) { setConfig(prev => { const cfg = clone(prev); cfg.fields.splice(idx,1); return cfg; }); }
  function addField() { setConfig(prev => { const cfg = clone(prev); cfg.fields.push({ name: `f${Date.now()}`, label: "New Field", type: "text", required:false, visible:true, options: [] }); return cfg; }); }
  function addCheckboxField() { setConfig(prev => { const cfg = clone(prev); cfg.fields.push({ name: `cb${Date.now()}`, label: "Checkbox", type: "checkbox", required:false, visible:true, options: [] }); return cfg; }); }

  function updateImage(idx, value) { setConfig(prev => { const cfg = clone(prev); cfg.images[idx] = value ? normalizeAdminUrl(value) : ""; return cfg; }); }
  function deleteImage(idx) { setConfig(prev => { const cfg = clone(prev); cfg.images.splice(idx,1); return cfg; }); }
  function addImage() { setConfig(prev => { const cfg = clone(prev); cfg.images.push(""); return cfg; }); }
  function updateEventDetail(key, value) { setConfig(prev => { const cfg = clone(prev); cfg.eventDetails = cfg.eventDetails || {}; cfg.eventDetails[key] = value; return cfg; }); }

  async function handleAssetUpload(e, key, idx = null, mediaType = "image") {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setUploading(true);
    setMsg("");
    setError(null);
    try {
      // use generic upload endpoints that expect field name "file"
      const endpoint = (key === "termsUrl") ? "/api/upload-file" : "/api/upload-asset";
      const url = await uploadFileToServer(file, endpoint, "file");
      setConfig(prev => {
        const cfg = clone(prev);
        if (key === "images" && idx !== null) cfg.images[idx] = normalizeAdminUrl(url);
        else if (key === "termsUrl") cfg.termsUrl = normalizeAdminUrl(url);
        else if (key === "backgroundMedia") cfg.backgroundMedia = { type: mediaType, url: normalizeAdminUrl(url) };
        else cfg[key] = normalizeAdminUrl(url);
        return cfg;
      });
      setMsg("Asset uploaded!");
    } catch (err) {
      console.error("asset upload failed:", err && (err.stack || err));
      setError("Upload failed: " + (err && err.message ? err.message : ""));
      setMsg("");
    } finally {
      setUploading(false);
    }
  }

  function removeTermsFile() {
    setConfig(prev => ({ ...clone(prev), termsUrl: "" }));
    setMsg("Terms file cleared (save to persist).");
  }

  async function saveConfig() {
    setMsg("");
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/visitor-config/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
        body: JSON.stringify(config)
      });
      if (!res.ok) {
        const txt = await res.text().catch(()=>"");
        throw new Error(txt || `HTTP ${res.status}`);
      }
      setMsg("Saved!");
      try { window.dispatchEvent(new Event("visitor-config-updated")); } catch {}
    } catch (e) {
      console.error("saveConfig error:", e && (e.stack || e));
      setError("Error saving: " + (e && e.message ? e.message : ""));
    }
  }

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold mb-4">Visitors Admin Config</h2>

      {/* Appearance */}
      <div className="mb-6">
        <h3 className="font-bold mb-2">Registration Page Appearance</h3>
        <label className="block mb-2">Background Color</label>
        <input type="color" value={config.backgroundColor || "#ffffff"} onChange={(e) => setConfig(clone({ ...config, backgroundColor: e.target.value }))} className="w-16 h-10 p-0 border" />
        <input value={config.backgroundColor || ""} onChange={(e) => setConfig(clone({ ...config, backgroundColor: e.target.value }))} className="border px-2 ml-2" placeholder="#ffffff" />
      </div>

      {/* Background Media */}
      <h3 className="font-bold mb-2 mt-6">Background Media (image or video)</h3>
      <div className="mb-2">
        <label className="mr-3">Current:</label>
        {config.backgroundMedia?.url ? (
          config.backgroundMedia.type === "video" ? <video src={config.backgroundMedia.url} controls style={{ maxWidth: 400 }} /> : <img src={config.backgroundMedia.url} alt="Background" style={{ maxWidth: 400 }} />
        ) : <span className="text-sm text-gray-500">No background media set</span>}
      </div>
      <div className="flex gap-3 items-center mb-3">
        <input type="file" accept="image/*" onChange={(e) => handleAssetUpload(e, "backgroundMedia", null, "image")} disabled={uploading} />
        <input type="file" accept="video/*" onChange={(e) => handleAssetUpload(e, "backgroundMedia", null, "video")} disabled={uploading} />
        <button onClick={() => setConfig(clone({ ...config, backgroundMedia: { type: "image", url: "" } }))} className="px-3 py-1 border">Clear Background</button>
      </div>

      {/* Legacy Images */}
      <h3 className="font-bold mb-2 mt-8">Additional Images (legacy)</h3>
      {(config.images || []).map((img, idx) => (
        <div key={idx} className="flex items-center gap-2 mb-2">
          {img && <img src={img} alt={"img-" + idx} style={{ maxHeight: 60, marginRight: 8 }} />}
          <input type="text" value={img} onChange={(e) => updateImage(idx, e.target.value)} placeholder="Image URL" className="border px-2" />
          <input type="file" accept="image/*" onChange={(e) => handleAssetUpload(e, "images", idx, "image")} disabled={uploading} />
          <button onClick={() => deleteImage(idx)} className="text-red-500">Delete</button>
        </div>
      ))}
      <button onClick={addImage} className="mt-2 px-4 py-2 bg-blue-100">Add Legacy Image</button>

      {/* Fields */}
      <h3 className="font-bold mb-2 mt-8">Fields</h3>
      {(config.fields || []).map((field, idx) => (
        <div key={idx} className="flex flex-col gap-1 mb-2 border-b pb-2">
          <div className="flex gap-2 items-center">
            <input value={field.label} onChange={(e) => updateField(idx, { label: e.target.value })} placeholder="Label" className="border px-2" />
            <input value={field.name} onChange={(e) => updateField(idx, { name: e.target.value })} placeholder="Name" className="border px-2" />
            <select value={field.type} onChange={(e) => updateField(idx, { type: e.target.value })} className="border">
              <option value="text">Text</option>
              <option value="email">Email</option>
              <option value="select">Select</option>
              <option value="radio">Radio</option>
              <option value="checkbox">Checkbox</option>
              <option value="textarea">Textarea</option>
              <option value="number">Number</option>
            </select>
            <label><input type="checkbox" checked={!!field.required} onChange={() => updateField(idx, { required: !field.required })} /> Required</label>
            <label><input type="checkbox" checked={!!field.visible} onChange={() => updateField(idx, { visible: !field.visible })} /> Visible</label>
            <button onClick={() => deleteField(idx)} className="text-red-500">Delete</button>
          </div>

          {["select","radio"].includes(field.type) && (
            <div className="flex gap-1 items-center mt-1 flex-wrap">
              {(field.options || []).map((opt, oidx) => (
                <div key={oidx} className="flex items-center gap-1">
                  <input type="text" value={opt} onChange={e => {
                    const newOptions = [...(field.options || [])]; newOptions[oidx] = e.target.value; updateField(idx, { options: newOptions });
                  }} className="border px-1" placeholder="Option label" />
                  <button onClick={() => { const newOptions = [...(field.options || [])]; newOptions.splice(oidx,1); updateField(idx, { options: newOptions }); }} className="text-red-500">x</button>
                </div>
              ))}
              <button onClick={() => { const newOptions = [...(field.options || []), ""]; updateField(idx, { options: newOptions }); }} className="text-green-600">+ Option</button>
            </div>
          )}
        </div>
      ))}

      <div className="flex gap-2 mt-2">
        <button onClick={addField} className="px-4 py-2 bg-blue-100">Add Field</button>
        <button onClick={addCheckboxField} className="px-4 py-2 bg-yellow-100">Add Checkbox Field</button>
      </div>

      {/* Terms */}
      <h3 className="font-bold mb-2 mt-8">Terms &amp; Conditions (appears at end of form)</h3>
      <div className="mb-2">
        <label className="block mb-1">Label shown to users</label>
        <input type="text" value={config.termsLabel || "Terms & Conditions"} onChange={(e) => setConfig(clone({ ...config, termsLabel: e.target.value }))} className="border px-2 w-full mb-2" />
        <label className="block mb-1">Link to Terms (paste URL)</label>
        <input type="text" placeholder="https://..." value={config.termsUrl || ""} onChange={(e) => setConfig(clone({ ...config, termsUrl: e.target.value }))} className="border px-2 w-full mb-2" />
        <div className="flex items-center gap-3 mb-2">
          <input type="file" accept=".pdf,.txt,.doc,.docx" onChange={(e) => handleAssetUpload(e, "termsUrl")} disabled={uploading} />
          <button type="button" onClick={removeTermsFile} className="px-3 py-1 border">Remove Terms File</button>
          <label className="ml-2"><input type="checkbox" checked={!!config.termsRequired} onChange={(e) => setConfig(clone({ ...config, termsRequired: e.target.checked }))} /><span className="ml-2">Require acceptance on registration</span></label>
        </div>
        {config.termsUrl ? (<div className="mb-2"><a href={config.termsUrl} target="_blank" rel="noreferrer" className="text-indigo-700 underline">{config.termsUrl}</a></div>) : null}
      </div>

      
      <div className="mt-6">
        <button onClick={saveConfig} className="px-6 py-3 bg-blue-600 text-white font-bold rounded" disabled={uploading}>Save Changes</button>
        {msg && <div className="mt-2 text-green-600 font-bold">{msg}</div>}
      </div>

      <hr className="my-10" />
      <h3 className="font-bold mb-4">Live Form Preview</h3>
      <DynamicRegistrationForm config={config} form={form} setForm={setForm} onSubmit={() => alert("Submitted!")} />
    </div>
  );
}