import React, { useEffect, useState } from "react";
import DynamicRegistrationForm from "./DynamicRegistrationForm";

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

async function uploadFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("http://localhost:5000/api/upload-image", {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error("Upload failed");
  const data = await res.json();
  return data.imageUrl;
}

export default function VisitorsAdmin() {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetch("http://localhost:5000/api/visitor-config")
      .then(res => res.json())
      .then(cfg => {
        console.log("Fetched config (Admin):", cfg); // DEBUG LOG
        cfg.fields = Array.isArray(cfg.fields) ? cfg.fields : [];
        cfg.images = Array.isArray(cfg.images) ? cfg.images : [];
        cfg.eventDetails = typeof cfg.eventDetails === "object" && cfg.eventDetails !== null ? cfg.eventDetails : {};
        cfg.banner = cfg.banner || "";
        cfg.backgroundVideo = cfg.backgroundVideo || "";
        cfg.hostedByLogo = cfg.hostedByLogo || "";
        // Add options array to select/radio fields if missing
        cfg.fields = cfg.fields.map(f =>
          ["select", "radio"].includes(f.type)
            ? { ...f, options: Array.isArray(f.options) ? f.options : [""] }
            : { ...f, options: [] }
        );
        setConfig(cfg);
        setLoading(false);
      })
      .catch(() => {
        setError("Error loading config from backend."); setLoading(false);
      });
  }, []);

  function updateField(idx, updates) {
    const newConfig = clone(config);
    if (updates.type && ["select", "radio"].includes(updates.type)) {
      updates.options = Array.isArray(newConfig.fields[idx].options) && newConfig.fields[idx].options.length
        ? newConfig.fields[idx].options
        : [""];
    }
    if (updates.type && !["select", "radio"].includes(updates.type)) {
      updates.options = [];
    }
    Object.assign(newConfig.fields[idx], updates);
    setConfig(newConfig);
  }
  function deleteField(idx) {
    const newConfig = clone(config);
    newConfig.fields.splice(idx, 1);
    setConfig(newConfig);
  }
  function addField() {
    const newConfig = clone(config);
    newConfig.fields.push({
      name: "",
      label: "",
      type: "text",
      required: false,
      visible: true,
      options: [],
    });
    setConfig(newConfig);
  }
  function updateImage(idx, value) {
    const newConfig = clone(config);
    newConfig.images[idx] = value;
    setConfig(newConfig);
  }
  function deleteImage(idx) {
    const newConfig = clone(config);
    newConfig.images.splice(idx, 1);
    setConfig(newConfig);
  }
  function addImage() {
    const newConfig = clone(config);
    newConfig.images.push("");
    setConfig(newConfig);
  }
  function updateEventDetail(key, value) {
    const newConfig = clone(config);
    newConfig.eventDetails[key] = value;
    setConfig(newConfig);
  }
  async function handleAssetUpload(e, key, idx = null) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadFile(file);
      const newConfig = clone(config);
      if (key === "images" && idx !== null) {
        newConfig.images[idx] = url;
      } else {
        newConfig[key] = url;
      }
      setConfig(newConfig);
      setMsg("Asset uploaded!");
    } catch {
      setMsg("Failed to upload.");
    }
    setUploading(false);
  }
  async function saveConfig() {
    setMsg("Saving...");
    try {
      const res = await fetch("http://localhost:5000/api/visitor-config/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config)
      });
      if (res.ok) setMsg("Saved!");
      else setMsg("Failed to save.");
    } catch {
      setMsg("Error saving.");
    }
  }
  if (loading) return <div>Loading...</div>;
  if (error) return <div className="text-red-500">{error}</div>;
  if (!config) return <div className="text-red-500">No config found.</div>;

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold mb-4">Visitors Admin Config</h2>
      {/* Banner Section */}
      <h3 className="font-bold mb-2">Banner</h3>
      {config.banner && (
        <div className="mb-2">
          <img src={config.banner} alt="Banner" style={{ maxWidth: 400 }} />
        </div>
      )}
      <input type="file" accept="image/*" onChange={e => handleAssetUpload(e, "banner")} disabled={uploading} /><br />

      {/* Background Video Section */}
      <h3 className="font-bold mb-2 mt-8">Background Video (Desktop only)</h3>
      {config.backgroundVideo && (
        <div className="mb-2">
          <video src={config.backgroundVideo} controls style={{ maxWidth: 400 }} />
        </div>
      )}
      <input type="file" accept="video/*" onChange={e => handleAssetUpload(e, "backgroundVideo")} disabled={uploading} /><br />

      {/* Hosted By Logo */}
      <h3 className="font-bold mb-2 mt-8">Hosted By Logo (Urban Infra Group)</h3>
      {config.hostedByLogo && (
        <div className="mb-2">
          <img src={config.hostedByLogo} alt="Hosted By Logo" style={{ maxWidth: 200 }} />
        </div>
      )}
      <input type="file" accept="image/*" onChange={e => handleAssetUpload(e, "hostedByLogo")} disabled={uploading} /><br />

      {/* Images Section (Gallery) */}
      <h3 className="font-bold mb-2 mt-8">Gallery Images</h3>
      {(config.images || []).map((img, idx) => (
        <div key={idx} className="flex items-center gap-2 mb-2">
          {img && <img src={img} alt={"img-" + idx} style={{ maxHeight: 60, marginRight: 8 }} />}
          <input type="text" value={img} onChange={e => updateImage(idx, e.target.value)} placeholder="Image URL" className="border px-2" />
          <input type="file" accept="image/*" onChange={e => handleAssetUpload(e, "images", idx)} disabled={uploading} />
          <button onClick={() => deleteImage(idx)} className="text-red-500">Delete</button>
        </div>
      ))}
      <button onClick={addImage} className="mt-2 px-4 py-2 bg-blue-100">Add Gallery Image</button>

      {/* Fields Section */}
      <h3 className="font-bold mb-2 mt-8">Fields</h3>
      {(config.fields || []).map((field, idx) => (
        <div key={idx} className="flex flex-col gap-1 mb-2 border-b pb-2">
          <div className="flex gap-2 items-center">
            <input value={field.label} onChange={e => updateField(idx, { label: e.target.value })} placeholder="Label" className="border px-2" />
            <input value={field.name} onChange={e => updateField(idx, { name: e.target.value })} placeholder="Name" className="border px-2" />
            <select value={field.type} onChange={e => updateField(idx, { type: e.target.value })} className="border">
              <option value="text">Text</option>
              <option value="email">Email</option>
              <option value="select">Select</option>
              <option value="radio">Radio</option>
              <option value="checkbox">Checkbox</option>
              <option value="textarea">Textarea</option>
              <option value="number">Number</option>
            </select>
            <label>
              <input type="checkbox" checked={field.required} onChange={() => updateField(idx, { required: !field.required })} /> Required
            </label>
            <label>
              <input type="checkbox" checked={field.visible} onChange={() => updateField(idx, { visible: !field.visible })} /> Visible
            </label>
            <button onClick={() => deleteField(idx)} className="text-red-500">Delete</button>
          </div>
          {/* Options editor for select/radio */}
          {["select", "radio"].includes(field.type) && (
            <div className="flex gap-1 items-center mt-1 flex-wrap">
              {(field.options || []).map((opt, oidx) => (
                <span key={oidx}>
                  <input
                    type="text"
                    value={opt}
                    onChange={e => {
                      const newOptions = [...(field.options || [])];
                      newOptions[oidx] = e.target.value;
                      updateField(idx, { options: newOptions });
                    }}
                    className="border px-1"
                    placeholder="Option"
                  />
                  <button
                    onClick={() => {
                      const newOptions = [...(field.options || [])];
                      newOptions.splice(oidx, 1);
                      updateField(idx, { options: newOptions });
                    }}
                    className="text-red-500"
                  >x</button>
                </span>
              ))}
              <button
                onClick={() => {
                  const newOptions = [...(field.options || []), ""];
                  updateField(idx, { options: newOptions });
                }}
                className="text-green-600"
              >+ Option</button>
            </div>
          )}
        </div>
      ))}
      <button onClick={addField} className="mt-2 px-4 py-2 bg-blue-100">Add Field</button>

      {/* Event Details Section */}
      <h3 className="font-bold mb-2 mt-8">Event Details</h3>
      <input value={config.eventDetails?.name || ""} onChange={e => updateEventDetail("name", e.target.value)} placeholder="Event Name" className="border px-2 mb-2 block" />
      <input value={config.eventDetails?.date || ""} onChange={e => updateEventDetail("date", e.target.value)} placeholder="Date" className="border px-2 mb-2 block" />
      <input value={config.eventDetails?.venue || ""} onChange={e => updateEventDetail("venue", e.target.value)} placeholder="Venue/Address" className="border px-2 mb-2 block" />
      <input value={config.eventDetails?.tagline || ""} onChange={e => updateEventDetail("tagline", e.target.value)} placeholder="Tagline" className="border px-2 mb-2 block" />

      <button onClick={saveConfig} className="mt-6 px-6 py-3 bg-blue-600 text-white font-bold rounded" disabled={uploading}>Save Changes</button>
      {msg && <div className="mt-2 text-green-600 font-bold">{msg}</div>}
      <hr className="my-10" />
      <h3 className="font-bold mb-4">Live Form Preview</h3>
      <DynamicRegistrationForm config={config} form={form} setForm={setForm} onSubmit={() => alert("Submitted!")} />
    </div>
  );
}