import React, { useEffect, useRef } from "react";

/**
 * Lightweight uncontrolled EditModal
 * - columns: [{ name|key, label, type, options, required, showIf }]
 * - row: initial values (raw backend object preferred)
 * - onSave(payload) -> returns saved doc when possible
 *
 * New: supports premium/generate flow by relying on backend create endpoints
 *      which generate ticket and send email for visitors/speakers/awardees.
 *
 * Notes:
 * - This modal intentionally does NOT render `id`/_id as an editable field.
 * - It preserves identifiers from `row` into the payload automatically and coerces them to strings.
 */

const normalize = (cols = []) =>
  (Array.isArray(cols) ? cols : []).map((c) => {
    if (typeof c === "string") {
      return { name: c, label: c.replace(/_/g, " "), type: "text", options: [], required: false };
    }
    // accept either { name } or { key } from various config shapes
    const name = c.name || c.key || c.field || c.id;
    return {
      name,
      label: c.label || c.name || c.key || name,
      type: c.type || "text",
      options: c.options || c.choices || c.values || [],
      required: !!c.required,
      showIf: c.showIf || null,
    };
  });

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

/* Utility: dedupe meta fields by normalized name (keeps first occurrence) */
function dedupeMeta(meta = []) {
  const seen = new Set();
  const out = [];
  for (const m of meta) {
    const name = String(m.name || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

const DISABLE_TICKET_KEYS = new Set(["ticket_code", "ticketCode", "code"]);

export default function EditModal({
  open,
  onClose,
  row = {},
  columns = [],
  onSave,
  isNew = false,
  table,
  // new props for premium/generate flow
  pendingPremium = false,
  newIsPremium = false,
  setPendingPremium = () => {},
  setNewIsPremium = () => {},
}) {
  // Normalize incoming columns to our internal shape
  const metaBase = normalize(columns);

  // ------ Ensure Exhibitors always have a Company Name field (but dedupe) ------
  let meta = [...metaBase];
  if (table === "exhibitors") {
    const hasCompany = meta.some((f) =>
      ["companyName", "company", "company_name"].includes((f.name || "").toString())
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

  // Deduplicate meta by normalized name to avoid duplicate fields
  meta = dedupeMeta(meta);
  // ----------------------------------------------------------------------

  const refs = useRef({});

  // Ensure refs exist for each meta field before rendering (some types use object-holder instead of DOM ref)
  useEffect(() => {
    if (!open) return;
    meta.forEach((f) => {
      // initial value for the field from row
      const initial = row?.[f.name] ?? (f.type === "checkbox" ? false : "");
      if (!refs.current[f.name]) {
        if (f.type === "radio") {
          // use a small holder for group value
          refs.current[f.name] = { current: { value: initial } };
        } else {
          refs.current[f.name] = React.createRef();
        }
      }
    });
    // cleanup any leftover refs for removed meta fields
    Object.keys(refs.current).forEach((k) => {
      if (!meta.find((m) => m.name === k)) delete refs.current[k];
    });
  }, [open, meta, row]);

  // When modal opens or row changes, write values into DOM refs (uncontrolled inputs use defaultValue only once)
  useEffect(() => {
    if (!open) return;
    meta.forEach((f) => {
      const r = refs.current[f.name];
      const initial = row?.[f.name] ?? (f.type === "checkbox" ? false : "");
      if (!r) return;
      // radio groups use holder
      if (f.type === "radio") {
        r.current = r.current || {};
        r.current.value = initial;
        return;
      }
      // DOM ref exists
      const el = r.current;
      if (!el) return;
      try {
        if (f.type === "checkbox") {
          el.checked = !!initial;
        } else {
          // set value for selects/inputs/textarea
          el.value = initial === undefined || initial === null ? "" : initial;
        }
      } catch (e) {
        // ignore if DOM not ready
      }
    });

    // Debug: helpful when fields not showing as expected
    // console.debug('[EditModal] opened meta:', meta, 'row:', row);
  }, [open, meta, row]);

  const isVisible = (f) => {
    if (!f.showIf) return true;
    const depRef = refs.current[f.showIf.field];
    const current =
      depRef && depRef.current
        ? depRef.current.type === "checkbox"
          ? depRef.current.checked
          : depRef.current.value
        : row[f.showIf.field];
    return Array.isArray(f.showIf.value)
      ? f.showIf.value.includes(current)
      : current === f.showIf.value;
  };

  // collect current payload from DOM refs
  function collectPayload() {
    const payload = {};
    meta.forEach((f) => {
      if (!isVisible(f)) return;
      const r = refs.current[f.name];
      if (!r || !r.current) {
        payload[f.name] = row[f.name] ?? "";
        return;
      }

      if (f.type === "radio") {
        payload[f.name] = r.current.value ?? "";
      } else if (f.type === "checkbox") {
        payload[f.name] = !!r.current.checked;
      } else if (f.type === "number") {
        payload[f.name] = r.current.value === "" ? "" : Number(r.current.value);
      } else {
        payload[f.name] = r.current.value;
      }
    });

    const normalized = normalizePayloadKeys(payload);
    const expanded = expandCompanyAliases(normalized);
    return expanded;
  }

  // Ensure identifiers are preserved and coerced to simple strings
  function preserveIdentifiers(payload) {
    if (!payload || typeof payload !== "object") return;
    if (!row || typeof row !== "object") return;

    const coerce = (v) => {
      if (v === undefined || v === null) return "";
      if (typeof v === "string") return v;
      if (typeof v === "number" || typeof v === "boolean") return String(v);
      try {
        if (v && typeof v === "object") {
          if (v.$oid) return String(v.$oid);
          if (v.toString && typeof v.toString === "function") {
            const s = v.toString();
            const m = s.match(/([a-f0-9]{24})/i);
            if (m && m[1]) return m[1];
            return String(s);
          }
        }
      } catch (e) {}
      return String(v);
    };

    if (row._id !== undefined && (payload._id === undefined || payload._id === "")) payload._id = coerce(row._id);
    if (row.id !== undefined && (payload.id === undefined || payload.id === "")) payload.id = coerce(row.id);
    if (row.ID !== undefined && (payload.ID === undefined || payload.ID === "")) payload.ID = coerce(row.ID);

    // keep both forms present
    if (!payload._id && payload.id) payload._id = payload.id;
    if (!payload.id && payload._id) payload.id = payload._id;
  }

  const handleSubmit = async (e) => {
    e && e.preventDefault();
    const payload = collectPayload();

    // preserve identifiers (coerced)
    try {
      preserveIdentifiers(payload);
    } catch (err) {
      console.warn("[EditModal] preserveIdentifiers warning:", err && (err.message || err));
    }

    try {
      await Promise.resolve(onSave(payload));
    } catch (err) {
      console.error("[EditModal] onSave error:", err);
    }
  };

  const handleCreateAndGenerate = async () => {
    try {
      setPendingPremium(true);
      const payload = collectPayload();
      try {
        preserveIdentifiers(payload);
      } catch (err) {
        console.warn("[EditModal] preserveIdentifiers on create warning:", err && (err.message || err));
      }
      await Promise.resolve(onSave(payload));
    } catch (err) {
      console.error("[EditModal] create+generate error:", err);
    } finally {
      setPendingPremium(false);
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="bg-white rounded-lg shadow-xl z-10 w-full max-w-2xl mx-4">
        <div className="px-4 py-3 border-b flex justify-between items-center">
          <div className="text-lg font-semibold">{isNew ? "Add New" : "Edit"}</div>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 max-h-[70vh] overflow-auto">
          {meta.length === 0 && <div className="text-gray-500">No fields</div>}

          {meta.map((f) => {
            if (!isVisible(f)) return null;

            const initial = row?.[f.name] ?? (f.type === "checkbox" ? false : "");
            if (!refs.current[f.name]) {
              if (f.type === "radio") refs.current[f.name] = { current: { value: initial } };
              else refs.current[f.name] = React.createRef();
            }

            const isTicketField = DISABLE_TICKET_KEYS.has(f.name);

            // textarea
            if (f.type === "textarea")
              return (
                <div key={f.name} className="mb-3">
                  <label className="block mb-1">
                    {f.label}{f.required && " *"}
                  </label>
                  <textarea
                    ref={refs.current[f.name]}
                    defaultValue={initial}
                    className="w-full border rounded px-3 py-2"
                    readOnly={isTicketField}
                    disabled={isTicketField}
                    placeholder={isTicketField && isNew ? "auto-generated by server" : undefined}
                  />
                </div>
              );

            // select
            if (f.type === "select")
              return (
                <div key={f.name} className="mb-3">
                  <label className="block mb-1">
                    {f.label}{f.required && " *"}
                  </label>
                  <select
                    ref={refs.current[f.name]}
                    defaultValue={initial}
                    className="w-full border rounded px-3 py-2"
                    disabled={isTicketField}
                    title={isTicketField ? "Ticket code cannot be edited" : undefined}
                  >
                    <option value="">{isTicketField && isNew ? "auto-generated by server" : "Select"}</option>
                    {Array.isArray(f.options) && f.options.map((o, i) => {
                      const val = typeof o === "object" ? o.value : o;
                      const lab = typeof o === "object" ? o.label : o;
                      return (
                        <option key={String(val ?? i)} value={val}>
                          {lab}
                        </option>
                      );
                    })}
                  </select>
                </div>
              );

            // checkbox
            if (f.type === "checkbox")
              return (
                <label key={f.name} className="mb-3 flex items-center gap-2">
                  <input
                    ref={refs.current[f.name]}
                    type="checkbox"
                    defaultChecked={!!initial}
                    disabled={isTicketField}
                    title={isTicketField ? "Ticket code cannot be edited" : undefined}
                  />
                  <span>
                    {f.label}{f.required && " *"}
                  </span>
                </label>
              );

            // radio
            if (f.type === "radio")
              return (
                <div key={f.name} className="mb-3">
                  <label className="block mb-1">
                    {f.label}{f.required && " *"}
                  </label>
                  <div className="flex gap-4">
                    {Array.isArray(f.options) && f.options.map((o, i) => {
                      const val = typeof o === "object" ? o.value : o;
                      const lab = typeof o === "object" ? o.label : o;
                      const checked = String(initial) === String(val);
                      return (
                        <label key={String(val ?? i)} className="flex items-center gap-2">
                          <input
                            name={f.name}
                            type="radio"
                            defaultChecked={checked}
                            value={val}
                            onChange={(e) => {
                              refs.current[f.name] = refs.current[f.name] || { current: {} };
                              refs.current[f.name].current.value = e.target.value;
                            }}
                            disabled={isTicketField}
                          />
                          <span>{lab}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );

            // default input
            return (
              <div key={f.name} className="mb-3">
                <label className="block mb-1">
                  {f.label}{f.required && " *"}
                </label>
                <input
                  ref={refs.current[f.name]}
                  defaultValue={initial}
                  type={f.type || "text"}
                  className="w-full border rounded px-3 py-2"
                  readOnly={isTicketField}
                  disabled={isTicketField}
                  placeholder={isTicketField && isNew ? "auto-generated by server" : undefined}
                />
              </div>
            );
          })}

          <div className="flex justify-end gap-3 mt-4">
            <button type="button" className="px-4 py-2 border" onClick={onClose}>Cancel</button>

            {isNew && newIsPremium && (
              <button
                type="button"
                className="px-4 py-2 bg-green-600 text-white rounded"
                onClick={handleCreateAndGenerate}
                disabled={pendingPremium}
                title="Create (server will generate ticket & send email when applicable)"
              >
                {pendingPremium ? "Processing..." : "Create & Send"}
              </button>
            )}

            <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}