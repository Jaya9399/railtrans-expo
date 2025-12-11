import React, { useEffect, useState, useCallback, useRef } from "react";
import DynamicRegistrationForm from "./DynamicRegistrationForm";

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

// Use REACT_APP_API_BASE, or window.__API_BASE__, or default to host-relative "/api"
const BACKEND_BASE = (process.env.REACT_APP_API_BASE || window.__API_BASE__ || "").replace(/\/$/, "");

/**
 * Build a correct URL for API endpoints:
 * - If endpoint is absolute (http/https) return unchanged
 * - Otherwise join API_BASE and endpoint without doubling slashes
 */
function buildApiUrl(endpoint = "") {
  if (!endpoint) endpoint = "";
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  let e = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  if (!e.startsWith("/api")) e = `/api${e}`;
  if (BACKEND_BASE && /^https?:\/\//i.test(BACKEND_BASE)) {
    return BACKEND_BASE.replace(/\/$/, "") + e;
  }
  return e;
}

/* Upload helper */
async function uploadFileToServer(file, endpoint = "/upload-asset", fieldName = "file") {
  if (!file) throw new Error("No file provided");
  const MAX_SIZE = 300 * 1024 * 1024;
  if (file.size && file.size > MAX_SIZE) throw new Error(`File too large (${Math.round(file.size/1024/1024)}MB). Max ${MAX_SIZE/1024/1024}MB.`);
  const url = buildApiUrl(endpoint);
  const formData = new FormData();
  formData.append(fieldName, file);
  const res = await fetch(url, {
    method: "POST",
    headers: { "ngrok-skip-browser-warning": "69420" },
    body: formData
  });
  if (!res.ok) {
    let txt = "";
    try { txt = await res.text(); } catch {}
    try {
      const parsed = JSON.parse(txt || "{}");
      if (parsed && (parsed.error || parsed.message)) throw new Error(`Upload failed (${res.status}) ${JSON.stringify(parsed)}`);
    } catch {}
    throw new Error(`Upload failed (${res.status}) ${txt}`);
  }
  const data = await res.json().catch(()=> ({}));
  return data.imageUrl || data.fileUrl || data.url || data.path || "";
}

/* Normalize config */
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

  function isAcceptTermsField(f) {
    if (!f || typeof f !== "object") return false;
    const name = (f.name || "").toString().toLowerCase().replace(/\s+/g, "");
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

  config.termsUrl = config.termsUrl || config.terms_url || config.terms || "";
  config.termsText = config.termsText || config.terms_text || config.termsBody || "";
  config.termsLabel = config.termsLabel || config.terms_label || "Terms & Conditions";
  config.termsRequired = !!config.termsRequired || !!config.terms_required;

  config.badgeTemplateUrl = config.badgeTemplateUrl || config.badge_template_url || "";

  return config;
}

/* ---------- DEFAULT EXHIBITOR FIELDS (admin-only defaults) ---------- */
const DEFAULT_EXHIBITOR_FIELDS = [
  { name: "title", label: "Surname", type: "radio", options: ["Mr.","Ms.","Dr."], required: true, visible: true },
  { name: "name", label: "Name", type: "text", required: true, visible: true },
  { name: "mobile", label: "Mobile No.", type: "number", required: false, visible: true, meta: { useOtp: true } },
  { name: "email", label: "Email ID", type: "email", required: true, visible: true, meta: { useOtp: true } },
  { name: "designation", label: "Designation", type: "text", required: false, visible: true },
  { name: "company_name", label: "Company Name", type: "text", required: false, visible: true },
  { name: "category", label: "Category", type: "select", options: ["MSME","NON MSME","Academic","Others"], required: false, visible: true },
  { name: "category_other", label: "If Others -> Specify", type: "textarea", required: false, visible: true },
  { name: "space_type", label: "Space Type", type: "radio", options: ["Shell","Bare"], required: false, visible: true },
  { name: "space_size", label: "Space Size", type: "select", options: ["6sqm","9sqm","15sqm","18sqm","27sqm","30sqm","36sqm","54sqm","72sqm"], required: false, visible: true },
  { name: "type_of_space", label: "Type of Space", type: "radio", options: ["Inline Booth (1 Side Open)","Corner Booth (2 Side Open)","Peninsula (3 Side Open)","Island (4 Side Open)"], required: false, visible: true },
  { name: "product_details", label: "Product Details", type: "textarea", required: false, visible: true }
];
/* ---------- end defaults ---------- */

export default function ExhibitorsAdmin() {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);

  // track server-provided field names so defaults are NOT persisted unless user modifies them
  const serverFieldNamesRef = useRef(new Set());

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(buildApiUrl("/exhibitor-config"), { cache: "no-store", headers: { "Accept": "application/json", "ngrok-skip-browser-warning": "69420" } });
      if (!res.ok) {
        const txt = await res.text().catch(()=>"");
        throw new Error(`Failed to fetch config (${res.status}) ${txt}`);
      }
      const cfg = await res.json();
      const normalized = normalizeConfig(cfg);

      // remember server field names (so we don't persist admin-only defaults)
      serverFieldNamesRef.current = new Set((cfg.fields || []).map(f => (f && f.name) ? f.name : []));

      // Merge defaults into editor view — mark them as admin defaults (meta.default=true)
      try {
        const existing = new Set((normalized.fields || []).map(f => (f && f.name) ? f.name : ""));
        DEFAULT_EXHIBITOR_FIELDS.forEach(def => {
          if (!existing.has(def.name)) {
            const copy = clone(def);
            copy.meta = copy.meta || {};
            copy.meta.default = true; // indicates this field is a UI-only default unless edited
            normalized.fields.push(copy);
          }
        });
      } catch (e) {
        // ignore
      }

      setConfig(normalized);
      setError(null);
    } catch (e) {
      console.error("ExhibitorsAdmin load config error:", e && (e.stack || e));
      setError("Error loading config from backend. See server logs.");
      // still set a config with defaults so admin can edit
      const fallback = normalizeConfig({});
      // attach defaults as admin-only defaults
      fallback.fields = [];
      DEFAULT_EXHIBITOR_FIELDS.forEach(def => {
        const copy = clone(def);
        copy.meta = copy.meta || {};
        copy.meta.default = true;
        fallback.fields.push(copy);
      });
      setConfig(fallback);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  if (loading) return <div>Loading...</div>;
  if (error) return <div className="text-red-600 p-4">{error}</div>;
  if (!config) return <div className="text-red-600 p-4">No config found.</div>;

  function updateField(idx, updates) {
    setConfig(prev => {
      const cfg = clone(prev);
      const prevField = cfg.fields[idx] || {};
      const merged = { ...prevField, ...updates };
      // If this was a default and the admin is editing it, mark as userAdded so it will persist
      merged.meta = merged.meta || {};
      if (prevField.meta && prevField.meta.default) {
        merged.meta.userAdded = true;
        delete merged.meta.default;
      } else {
        merged.meta.userAdded = merged.meta.userAdded || false;
      }
      if (updates.type && ["select","radio"].includes(updates.type) && !Array.isArray(merged.options)) merged.options = [""];
      if (updates.type && !["select","radio"].includes(updates.type)) merged.options = [];
      cfg.fields[idx] = merged;
      return cfg;
    });
  }

  function deleteField(idx) { setConfig(prev => { const cfg = clone(prev); cfg.fields.splice(idx,1); return cfg; }); }

  function addField() {
    setConfig(prev => {
      const cfg = clone(prev);
      const f = { name: `f${Date.now()}`, label: "New Field", type: "text", required:false, visible:true, options: [] };
      f.meta = { userAdded: true };
      cfg.fields.push(f);
      return cfg;
    });
  }

  function addCheckboxField() {
    setConfig(prev => {
      const cfg = clone(prev);
      const f = { name: `cb${Date.now()}`, label: "Checkbox", type: "checkbox", required:false, visible:true, options: [] };
      f.meta = { userAdded: true };
      cfg.fields.push(f);
      return cfg;
    });
  }

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
      const endpoint = (key === "termsUrl" || file.type === "application/pdf") ? "/upload-file" : "/upload-asset";
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

      // Determine which fields to persist:
      // - Always persist fields that were present on server originally
      // - Persist fields that admin explicitly added/edited (meta.userAdded===true)
      // - Do NOT persist admin-only defaults (meta.default===true) unless userEdited them (we set userAdded when edited)
      const serverNames = serverFieldNamesRef.current || new Set();
      const fieldsToPersist = (toSave.fields || []).filter(f => {
        const meta = f.meta || {};
        if (serverNames.has(f.name)) return true;
        if (meta.userAdded) return true;
        // if it's a default and not userAdded, skip it
        if (meta.default) return false;
        // otherwise persist
        return true;
      }).map(f => {
        // strip internal meta before saving
        const copy = { ...f };
        if (copy.meta) delete copy.meta;
        return copy;
      });

      const payload = { ...toSave, fields: fieldsToPersist };

      const res = await fetch(buildApiUrl("/exhibitor-config/config"), {
        method: "POST",
        headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const txt = await res.text().catch(()=>"");
        throw new Error(txt || `HTTP ${res.status}`);
      }
      const json = await res.json().catch(()=>null);
      setMsg("Saved!");
      try { window.dispatchEvent(new Event("exhibitor-config-updated")); } catch {}
      // After successful save, update serverFieldNames set to include persisted fields so defaults won't be re-saved
      try {
        const persistedNames = new Set((payload.fields || []).map(f => f.name));
        serverFieldNamesRef.current = new Set([...serverFieldNamesRef.current, ...persistedNames]);
      } catch {}
      if (json && json.config) {
        const normalized = normalizeConfig(json.config);
        setConfig(normalized);
      }
    } catch (e) {
      console.error("saveConfig error:", e && (e.stack || e));
      setError("Error saving: " + (e && e.message ? e.message : ""));
    }
  }

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold mb-4">Exhibitors Admin Config</h2>

      <div className="mb-6">
        <h3 className="font-bold mb-2">Registration Page Appearance</h3>
        <label className="block mb-1">Background Color (takes precedence if set)</label>
        <div className="flex items-center gap-3 mb-2">
          <input type="color" value={config.backgroundColor || "#ffffff"} onChange={(e) => setConfig(clone({ ...config, backgroundColor: e.target.value }))} className="w-12 h-10 p-0 border" />
          <input value={config.backgroundColor || ""} onChange={(e) => setConfig(clone({ ...config, backgroundColor: e.target.value }))} className="border px-2" placeholder="#ffffff" />
        </div>
      </div>

      <h3 className="font-bold mb-2 mt-6">Background Media (image or video) — used when backgroundColor not set</h3>
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
            {/* indicate default-only fields in the admin UI */}
            {field.meta && field.meta.default && <span className="ml-2 text-sm text-gray-500">Default (not on registration page unless edited)</span>}
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

      <h3 className="font-bold mb-2 mt-8">Terms &amp; Conditions (appears at end of form)</h3>
      <div className="mb-2">
        <label className="block mb-1">Label shown to users</label>
        <input type="text" value={config.termsLabel || "Terms & Conditions"} onChange={(e) => setConfig(clone({ ...config, termsLabel: e.target.value }))} className="border px-2 w-full mb-2" />

        <label className="block mb-1">Link to Terms (paste URL) — this will be used by the frontend</label>
        <input type="text" placeholder="https://..." value={config.termsUrl || ""} onChange={(e) => setConfig(clone({ ...config, termsUrl: e.target.value }))} className="border px-2 w-full mb-2" />

        <div className="flex items-center gap-3 mb-2">
          <input type="file" accept=".pdf,.txt,.doc,.docx" onChange={(e) => handleAssetUpload(e, "termsUrl")} disabled={uploading} />
          <button type="button" onClick={removeTermsFile} className="px-3 py-1 border">Remove Terms File</button>
          <label className="ml-2"><input type="checkbox" checked={!!config.termsRequired} onChange={(e) => setConfig(clone({ ...config, termsRequired: e.target.checked }))} /><span className="ml-2">Require acceptance on registration</span></label>
        </div>

        
        <div className="mb-2">
          <strong>Preview:</strong>
          {config.termsUrl ? (<div className="mt-1"><a href={config.termsUrl} target="_blank" rel="noreferrer" className="text-indigo-700 underline">{config.termsUrl}</a></div>) : null}
          {config.termsText ? (<div className="mt-2 p-3 border rounded bg-gray-50" style={{ whiteSpace: "pre-wrap" }}>{config.termsText}</div>) : null}
        </div>
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