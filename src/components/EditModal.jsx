import React, { useEffect, useRef } from "react";

/**
 * Lightweight uncontrolled EditModal
 * - columns: [{ name, label, type, options, required, showIf }]
 * - row: initial values
 * - onSave(payload)
 */

const normalize = (cols = []) =>
  (Array.isArray(cols) ? cols : []).map((c) =>
    typeof c === "string"
      ? { name: c, label: c.replace(/_/g, " "), type: "text", options: [], required: false }
      : {
          name: c.name,
          label: c.label || c.name,
          type: c.type || "text",
          options: c.options || [],
          required: !!c.required,
          showIf: c.showIf || null,
        }
  );

function toCamel(s = "") {
  return String(s).replace(/[_-]([a-zA-Z0-9])/g, (_, ch) => ch.toUpperCase());
}

function normalizePayloadKeys(payload = {}) {
  const out = {};
  for (const k of Object.keys(payload)) {
    const v = payload[k];
    const camel = toCamel(k);
    out[camel] = v;
  }

  // Explicit company alias mapping
  if (out.company_name && !out.companyName) out.companyName = out.company_name;
  if (out.company && !out.companyName) out.companyName = out.company;

  return out;
}

/**
 * Ensures server receives companyName, company, company_name.
 */
function expandCompanyAliases(payload = {}) {
  const p = { ...payload };

  const company =
    p.companyName ||
    p.company ||
    p.company_name ||
    p.companyname ||
    p["Company Name"] ||
    "";

  if (company) {
    p.companyName = company;
    p.company = company;
    p.company_name = company;
  }

  return p;
}

export default function EditModal({
  open,
  onClose,
  row = {},
  columns = [],
  onSave,
  isNew = false,
  table,
}) {
  const metaBase = normalize(columns);

  // ------ FIX: Ensure Exhibitors always have a Company Name field ------
  let meta = [...metaBase];
  if (table === "exhibitors") {
    const hasCompany = meta.some((f) =>
      ["companyName", "company", "company_name"].includes(f.name)
    );
    if (!hasCompany) {
      meta.unshift({
        name: "companyName",
        label: "Company Name",
        type: "text",
        required: true,
      });
    }
  }
  // ----------------------------------------------------------------------

  const refs = useRef({});

  useEffect(() => {
    if (!open) return;
    meta.forEach((f) => {
      if (!refs.current[f.name]) refs.current[f.name] = React.createRef();
    });
    Object.keys(refs.current).forEach((k) => {
      if (!meta.find((m) => m.name === k)) delete refs.current[k];
    });
  }, [open, meta]);

  const isVisible = (f) => {
    if (!f.showIf) return true;
    const dep = refs.current[f.showIf.field];
    const current =
      dep && dep.current
        ? dep.current.type === "checkbox"
          ? dep.current.checked
          : dep.current.value
        : row[f.showIf.field];
    return Array.isArray(f.showIf.value)
      ? f.showIf.value.includes(current)
      : current === f.showIf.value;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = {};

    meta.forEach((f) => {
      if (!isVisible(f)) return;
      const r = refs.current[f.name];
      if (!r || !r.current) {
        payload[f.name] = row[f.name] ?? "";
        return;
      }
      const el = r.current;
      if (f.type === "checkbox") payload[f.name] = !!el.checked;
      else if (f.type === "number")
        payload[f.name] = el.value === "" ? "" : Number(el.value);
      else payload[f.name] = el.value;
    });

    const normalized = normalizePayloadKeys(payload);
    const expanded = expandCompanyAliases(normalized);

    console.debug("[EditModal] Final payload:", expanded);
    await Promise.resolve(onSave(expanded));
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="bg-white rounded-lg shadow-xl z-10 w-full max-w-2xl mx-4">
        <div className="px-4 py-3 border-b flex justify-between items-center">
          <div className="text-lg font-semibold">
            {isNew ? "Add New" : "Edit"}
          </div>
          <button onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 max-h-[70vh] overflow-auto">
          {meta.length === 0 && (
            <div className="text-gray-500">No fields</div>
          )}

          {meta.map((f) => {
            if (!isVisible(f)) return null;
            const initial =
              row?.[f.name] ?? (f.type === "checkbox" ? false : "");
            if (!refs.current[f.name])
              refs.current[f.name] = React.createRef();

            if (f.type === "textarea")
              return (
                <div key={f.name} className="mb-3">
                  <label className="block mb-1">
                    {f.label}
                    {f.required && " *"}
                  </label>
                  <textarea
                    ref={refs.current[f.name]}
                    defaultValue={initial}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
              );

            if (f.type === "select")
              return (
                <div key={f.name} className="mb-3">
                  <label className="block mb-1">
                    {f.label}
                    {f.required && " *"}
                  </label>
                  <select
                    ref={refs.current[f.name]}
                    defaultValue={initial}
                    className="w-full border rounded px-3 py-2"
                  >
                    <option value="">Select</option>
                    {f.options.map((o, i) => {
                      const val = typeof o === "object" ? o.value : o;
                      const lab = typeof o === "object" ? o.label : o;
                      return (
                        <option key={i} value={val}>
                          {lab}
                        </option>
                      );
                    })}
                  </select>
                </div>
              );

            if (f.type === "checkbox")
              return (
                <label key={f.name} className="mb-3 flex items-center gap-2">
                  <input
                    ref={refs.current[f.name]}
                    type="checkbox"
                    defaultChecked={!!initial}
                  />
                  <span>
                    {f.label}
                    {f.required && " *"}
                  </span>
                </label>
              );

            if (f.type === "radio")
              return (
                <div key={f.name} className="mb-3">
                  <label className="block mb-1">
                    {f.label}
                    {f.required && " *"}
                  </label>
                  <div className="flex gap-4">
                    {f.options.map((o, i) => {
                      const val = typeof o === "object" ? o.value : o;
                      const lab = typeof o === "object" ? o.label : o;
                      return (
                        <label key={i} className="flex items-center gap-2">
                          <input
                            name={f.name}
                            type="radio"
                            defaultChecked={String(initial) === String(val)}
                            value={val}
                            onChange={(e) => {
                              refs.current[f.name].current = e.target;
                            }}
                          />
                          {lab}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );

            return (
              <div key={f.name} className="mb-3">
                <label className="block mb-1">
                  {f.label}
                  {f.required && " *"}
                </label>
                <input
                  ref={refs.current[f.name]}
                  defaultValue={initial}
                  type={f.type || "text"}
                  className="w-full border rounded px-3 py-2"
                />
              </div>
            );
          })}

          <div className="flex justify-end gap-3 mt-4">
            <button
              type="button"
              className="px-4 py-2 border"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-indigo-600 text-white rounded"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
