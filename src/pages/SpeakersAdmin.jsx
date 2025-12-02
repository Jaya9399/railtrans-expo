import React, { useEffect, useState } from "react";
import DynamicRegistrationForm from "./DynamicRegistrationForm";

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

const API_BASE = (process.env.REACT_APP_API_BASE || window.__API_BASE__ || (typeof window !== "undefined" && window.__CONFIG__ && window.__CONFIG__.backendUrl) || (typeof window !== "undefined" && window.location && window.location.origin) || "http://localhost:5000").replace(/\/$/, "");

async function uploadFileToServer(file, endpoint = "/api/upload-asset") {
  const url = endpoint.startsWith("http") ? endpoint : `${API_BASE}${endpoint}`;
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(url, {
    method: "POST",
    headers: { "ngrok-skip-browser-warning": "69420" },
    body: formData
  });
  if (!res.ok) {
    let txt = "";
    try { txt = await res.text(); } catch {}
    throw new Error(`Upload failed (${res.status}) ${txt}`);
  }
  const data = await res.json().catch(()=> ({}));
  return data.imageUrl || data.fileUrl || data.url || data.path || "";
}

function normalizeConfig(cfg = {}) {
  const config = { ...(typeof cfg === "object" && cfg !== null ? cfg : {}) };

  config.fields = Array.isArray(config.fields) ? config.fields.map(f => {
    const ff = typeof f === "object" && f ? { ...f } : {};
    ff.name = (ff.name || "").toString();
    ff.label = (ff.label || "").toString();
    ff.type = (ff.type || "text").toString();
    ff.options = Array.isArray(ff.options) ? ff.options : [];
    ff.visible = typeof ff.visible === "boolean" ? ff.visible : true;
    ff.required = !!ff.required;
    return ff;
  }) : [];

  // strip accept_terms / "I agree" checkbox from admin-editable fields
  function isAcceptTermsField(f) {
    if (!f) return false;
    const name = (f.name || "").toString().toLowerCase().replace(/\s+/g,'');
    const label = (f.label || "").toString().toLowerCase();
    if (name === "accept_terms" || name === "acceptterms" || name === "i_agree" || name === "agree") return true;
    if (f.type === "checkbox" && (label.includes("i agree") || label.includes("accept the terms") || label.includes("terms & conditions") || label.includes("terms and conditions"))) return true;
    return false;
  }
  config.fields = config.fields.filter(f => !isAcceptTermsField(f));

  config.images = Array.isArray(config.images) ? config.images : [];
  config.eventDetails = typeof config.eventDetails === "object" && config.eventDetails !== null ? config.eventDetails : {};

  if (config.backgroundMedia && typeof config.backgroundMedia === "object" && config.backgroundMedia.url) {
    config.backgroundMedia = { type: config.backgroundMedia.type || "image", url: config.backgroundMedia.url || "" };
  } else if (config.backgroundVideo && config.backgroundVideo) {
    config.backgroundMedia = { type: "video", url: config.backgroundVideo };
  } else if (config.backgroundImage && config.backgroundImage) {
    config.backgroundMedia = { type: "image", url: config.backgroundImage };
  } else {
    config.backgroundMedia = config.backgroundMedia || { type: "image", url: "" };
  }

  config.backgroundColor = config.backgroundColor || config.background_color || "#ffffff";

  // TERMS
  config.termsUrl = config.termsUrl || config.terms_url || config.terms || "";
  config.termsText = config.termsText || config.terms_text || config.termsBody || "";
  config.termsLabel = config.termsLabel || config.terms_label || "Terms & Conditions";
  config.termsRequired = !!config.termsRequired || !!config.terms_required;

  config.badgeTemplateUrl = config.badgeTemplateUrl || config.badge_template_url || "";

  return config;
}

export default function SpeakersAdmin() {
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
        const res = await fetch(`${API_BASE}/api/speaker-config`, { cache: "no-store", headers: { "Accept": "application/json", "ngrok-skip-browser-warning": "69420" } });
        if (!res.ok) throw new Error(`Failed to fetch config (${res.status})`);
        const cfg = await res.json();
        if (!mounted) return;
        setConfig(normalizeConfig(cfg));
      } catch (e) {
        console.error("SpeakersAdmin load config error:", e && (e.stack || e));
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

  function updateImage(idx, value) { setConfig(prev => { const cfg = clone(prev); cfg.images[idx] = value; return cfg; }); }
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
      const endpoint = (key === "termsUrl" || file.type === "application/pdf") ? "/api/upload-file" : "/api/upload-asset";
      const url = await uploadFileToServer(file, endpoint);
      setConfig(prev => {
        const cfg = clone(prev);
        if (key === "images" && idx !== null) cfg.images[idx] = url;
        else if (key === "images" && idx === null) cfg.images.push(url);
        else if (key === "termsUrl") cfg.termsUrl = url;
        else if (key === "backgroundMedia") cfg.backgroundMedia = { type: mediaType, url };
        else cfg[key] = url;
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

  function updateTermsText(value) {
    setConfig(prev => ({ ...clone(prev), termsText: value }));
  }

  // strip accept_terms defensively before saving
  function stripAcceptTermsFields(cfg) {
    if (!cfg) return cfg;
    const copy = clone(cfg);
    copy.fields = (copy.fields || []).filter(f => {
      const name = (f.name || "").toString().toLowerCase().replace(/\s+/g,'');
      const label = (f.label || "").toString().toLowerCase();
      if (name === "accept_terms" || name === "acceptterms" || name === "i_agree" || name === "agree") return false;
      if (f.type === "checkbox" && (label.includes("i agree") || label.includes("accept the terms") || label.includes("terms & conditions") || label.includes("terms and conditions"))) return false;
      return true;
    });
    return copy;
  }

  async function saveConfig() {
    setMsg("");
    setError(null);
    try {
      const toSave = stripAcceptTermsFields(config);
      const res = await fetch(`${API_BASE}/api/speaker-config/config`, { method: "POST", headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" }, body: JSON.stringify(toSave) });
      if (!res.ok) {
        const txt = await res.text().catch(()=>"");
        throw new Error(txt || `HTTP ${res.status}`);
      }
      const json = await res.json().catch(()=>null);
      setMsg("Saved!");
      try { window.dispatchEvent(new Event("speaker-config-updated")); } catch {}
      if (json && json.config) setConfig(normalizeConfig(json.config));
    } catch (e) {
      console.error("saveConfig error:", e && (e.stack || e));
      setError("Error saving: " + (e && e.message ? e.message : ""));
    }
  }

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold mb-4">Speakers Admin Config</h2>

      {/* Appearance */}
      <div className="mb-6">
        <h3 className="font-bold mb-2">Registration Page Appearance</h3>
        <label className="block mb-1">Background Color (takes precedence if set)</label>
        <div className="flex items-center gap-3 mb-2">
          <input type="color" value={config.backgroundColor || "#ffffff"} onChange={(e) => setConfig(clone({ ...config, backgroundColor: e.target.value }))} className="w-12 h-10 p-0 border" />
          <input value={config.backgroundColor || ""} onChange={(e) => setConfig(clone({ ...config, backgroundColor: e.target.value }))} className="border px-2" placeholder="#ffffff" />
        </div>
      </div>

      {/* Background Media */}
      <h3 className="font-bold mb-2 mt-6">Background Media (image or video)</h3>
      <div className="mb-2">
        <label className="mr-3">Current:</label>
        {config.backgroundMedia?.url ? (
          config.backgroundMedia.type === "video"
            ? <video src={config.backgroundMedia.url} controls style={{ maxWidth: 400 }} />
            : <img src={config.backgroundMedia.url} alt="Background" style={{ maxWidth: 400 }} />
        ) : <span className="text-sm text-gray-500">No background media set</span>}
      </div>
      <div className="flex gap-3 items-center mb-3">
        <input type="file" accept="image/*" onChange={(e) => handleAssetUpload(e, "backgroundMedia", null, "image")} disabled={uploading} />
        <input type="file" accept="video/*" onChange={(e) => handleAssetUpload(e, "backgroundMedia", null, "video")} disabled={uploading} />
        <button onClick={() => setConfig(clone({ ...config, backgroundMedia: { type: "image", url: "" } }))} className="px-3 py-1 border">Clear Background</button>
        <div className="text-sm text-gray-600 ml-4">Background color takes precedence over media.</div>
      </div>

      {/* Gallery Images */}
      <h3 className="font-bold mb-2 mt-8">Gallery Images (optional)</h3>
      {(config.images || []).map((img, idx) => (
        <div key={idx} className="flex items-center gap-2 mb-2">
          {img && <img src={img} alt={"img-" + idx} style={{ maxHeight: 60, marginRight: 8 }} />}
          <input type="text" value={img} onChange={(e) => updateImage(idx, e.target.value)} placeholder="Image URL" className="border px-2" />
          <input type="file" accept="image/*" onChange={(e) => handleAssetUpload(e, "images", idx, "image")} disabled={uploading} />
          <button onClick={() => deleteImage(idx)} className="text-red-500">Delete</button>
        </div>
      ))}
      <div className="mt-2">
        <input type="file" accept="image/*" onChange={(e) => handleAssetUpload(e, "images", null, "image")} disabled={uploading} />
        <button onClick={addImage} className="ml-2 px-4 py-2 bg-blue-100">Add Gallery Image</button>
      </div>

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

        <label className="block mb-1 mt-3">Terms Text (editable):</label>
        <textarea value={config.termsText || ""} onChange={(e) => updateTermsText(e.target.value)} rows={8} className="border px-2 w-full mb-2" placeholder="Paste or write full terms / T&C text here (optional)"></textarea>

        <div className="mb-2">
          <strong>Preview:</strong>
          {config.termsUrl ? (<div className="mt-1"><a href={config.termsUrl} target="_blank" rel="noreferrer" className="text-indigo-700 underline">{config.termsUrl}</a></div>) : null}
          {config.termsText ? (<div className="mt-2 p-3 border rounded bg-gray-50" style={{ whiteSpace: "pre-wrap" }}>{config.termsText}</div>) : null}
        </div>
      </div>

      {/* Event Details */}
      <h3 className="font-bold mb-2 mt-8">Event Details</h3>
      <input value={config.eventDetails?.name || ""} onChange={e => updateEventDetail("name", e.target.value)} placeholder="Event Name" className="border px-2 mb-2 block" />
      <input value={config.eventDetails?.date || ""} onChange={e => updateEventDetail("date", e.target.value)} placeholder="Date" className="border px-2 mb-2 block" />
      <input value={config.eventDetails?.venue || ""} onChange={e => updateEventDetail("venue", e.target.value)} placeholder="Venue/Address" className="border px-2 mb-2 block" />
      <input value={config.eventDetails?.tagline || ""} onChange={e => updateEventDetail("tagline", e.target.value)} placeholder="Tagline" className="border px-2 mb-2 block" />

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