import React, { useState } from "react";

export default function RegistrationAdminConfig({ config, setConfig }) {
  function handleFieldChange(idx, key, value) {
    setConfig(cfg => {
      const newFields = [...cfg.fields];
      newFields[idx] = { ...newFields[idx], [key]: value };
      return { ...cfg, fields: newFields };
    });
  }
  function addField() {
    setConfig(cfg => ({
      ...cfg,
      fields: [
        ...cfg.fields,
        { name: "newField", label: "New Field", type: "text", required: false, visible: true }
      ]
    }));
  }
  function removeField(idx) {
    setConfig(cfg => ({
      ...cfg,
      fields: cfg.fields.filter((_, i) => i !== idx)
    }));
  }
  function moveField(idx, dir) {
    setConfig(cfg => {
      const fields = [...cfg.fields];
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= fields.length) return cfg;
      [fields[idx], fields[newIdx]] = [fields[newIdx], fields[idx]];
      return { ...cfg, fields };
    });
  }
  return (
    <div>
      <h3 className="font-bold mb-4">Edit Form Fields</h3>
      {config.fields.map((field, idx) => (
        <div key={idx} className="bg-gray-100 p-2 mb-2 rounded flex items-center gap-2">
          <input value={field.label} onChange={e => handleFieldChange(idx, "label", e.target.value)} className="border px-2 rounded" />
          <select value={field.type} onChange={e => handleFieldChange(idx, "type", e.target.value)} className="border px-2 rounded">
            <option value="text">Text</option>
            <option value="email">Email</option>
            <option value="textarea">Textarea</option>
            <option value="select">Select</option>
            <option value="checkbox">Checkbox</option>
          </select>
          <input value={field.name} onChange={e => handleFieldChange(idx, "name", e.target.value)} className="border px-2 rounded w-24" />
          <label>
            <input type="checkbox" checked={field.required} onChange={e => handleFieldChange(idx, "required", e.target.checked)} />
            Required
          </label>
          <label>
            <input type="checkbox" checked={field.visible} onChange={e => handleFieldChange(idx, "visible", e.target.checked)} />
            Visible
          </label>
          <button onClick={() => moveField(idx, -1)} disabled={idx === 0}>↑</button>
          <button onClick={() => moveField(idx, 1)} disabled={idx === config.fields.length-1}>↓</button>
          <button onClick={() => removeField(idx)} className="text-red-500">Remove</button>
        </div>
      ))}
      <button onClick={addField} className="bg-blue-500 text-white px-4 py-2 rounded">Add Field</button>
      {/* Images & event details config can be added similarly */}
    </div>
  );
}