import React, { useMemo, useCallback } from "react";
import DataTable from "./DataTable";

/**
 * DashboardSection
 * - When "Add New" is clicked this component will attempt to fetch
 *   /api/registration-configs/:page and extract fields to use for the Add-New modal.
 * - It then calls onAddNew(tableKey, premium, configCols) so the parent can open the modal
 *   with the provided columns. If fetch fails we call onAddNew(tableKey, premium) as before.
 */
export default function DashboardSection({
  label,
  data = [],
  tableKey,
  configs = {},
  onEdit,
  onAddNew,
  onDelete,
  onRefreshRow,
  setShowExhibitorManager,
  setShowPartnerManager,
  PAGE_SIZE = 10,
  HIDDEN_FIELDS = new Set(),
  prettifyKey = (k) => String(k || "").replace(/[_-]/g, " ").replace(/\b\w/g, (s) => s.toUpperCase()),
}) {
  const columns = useMemo(() => {
    const keysSet = new Set();
    (data || []).forEach((row) => {
      Object.keys(row || {}).forEach((k) => {
        if (!HIDDEN_FIELDS.has(k)) keysSet.add(k);
      });
    });

    // Prefer configured column order if available
    let configCols = configs?.[tableKey]?.columns?.map((c) => c.key) || configs?.[tableKey]?.fields?.map((c) => c.name);
    if (configCols && configCols.length > 0) {
      const missing = [...keysSet].filter((k) => !configCols.includes(k));
      configCols = [...configCols, ...missing];
    } else {
      configCols = [...keysSet];
    }

    const preferred = ["name", "full_name", "company", "email", "ticket_code", "ticket_category", "mobile", "phone", "id", "_id"];
    const ordered = [];
    const seen = new Set();
    for (const p of preferred) {
      if (configCols.includes(p) && !seen.has(p)) { ordered.push(p); seen.add(p); }
    }
    for (const k of configCols) {
      if (!seen.has(k)) { ordered.push(k); seen.add(k); }
    }

    return ordered.map((k) => ({ key: k, label: prettifyKey(k) }));
  }, [data, configs, tableKey, HIDDEN_FIELDS, prettifyKey]);

  const handleRowAction = useCallback(
    (action, row) => {
      if (!row) return;
      if (action === "edit") {
        typeof onEdit === "function" && onEdit(tableKey, row);
      } else if (action === "delete") {
        typeof onDelete === "function" && onDelete(tableKey, row);
      } else if (action === "refresh") {
        typeof onRefreshRow === "function" && onRefreshRow(tableKey, row);
      }
    },
    [onEdit, onDelete, onRefreshRow, tableKey]
  );

  function handleManage() {
    if (tableKey === "exhibitors") setShowExhibitorManager && setShowExhibitorManager(true);
    else if (tableKey === "partners") setShowPartnerManager && setShowPartnerManager(true);
  }

  // Called when the "Add New" button is pressed.
  // This will try to fetch per-page config at /api/registration-configs/:page and pass it to parent.
  async function handleAddClick() {
    // determine singular page name for the API: visitors -> visitor
    const page = String(tableKey || "").replace(/s$/i, "").toLowerCase();
    let configCols = null;

    try {
      const res = await fetch(`/api/registration-configs/${encodeURIComponent(page)}`);
      if (res.ok) {
        const js = await res.json().catch(() => null);
        // Support a few shapes: { config: {...} } or { fields: [...] } or the config object itself
        const cfg = js && (js.config || js.value || js) ? (js.config || js.value || js) : null;
        if (cfg) {
          // find fields in common places
          configCols = cfg.fields || cfg.columns || (cfg.form && cfg.form.fields) || null;
        }
      } else {
        // if 404 or other, we'll fallback to parent behavior
        console.debug(`[DashboardSection] no central config for ${page}: ${res.status}`);
      }
    } catch (e) {
      console.debug('[DashboardSection] fetch registration-configs failed', e && e.message);
    }

    if (Array.isArray(configCols) && configCols.length > 0) {
      // Normalize columns to { name, label, type, options, required }
      const normalized = configCols.map((c) => {
        if (typeof c === "string") return { name: c, label: prettifyKey(c), type: "text" };
        const name = c.name || c.key || c.field || c.id;
        return {
          name,
          label: c.label || prettifyKey(name),
          type: c.type || "text",
          options: c.options || [],
          required: !!c.required,
        };
      });
      // pass normalized columns to parent (third parameter)
      return typeof onAddNew === "function" ? onAddNew(tableKey, true, normalized) : null;
    }

    // fallback: call parent with existing signature (no config cols)
    return typeof onAddNew === "function" ? onAddNew(tableKey) : null;
  }

  return (
    <section className="border border-gray-200 rounded bg-white p-4 shadow">
      <header className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold">{label}</h2>
          <div className="text-xs text-gray-500">{(data || []).length} total</div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleAddClick}
            className="text-sm px-3 py-1 border rounded bg-blue-100 text-blue-700 hover:bg-blue-200"
          >
            Add New
          </button>

          {(tableKey === "exhibitors" || tableKey === "partners") && (
            <button onClick={handleManage} className="text-sm px-3 py-1 border rounded bg-gray-100 hover:bg-gray-200">
              Manage
            </button>
          )}
        </div>
      </header>

      <div>
        <DataTable
          columns={columns}
          data={data}
          defaultPageSize={PAGE_SIZE}
          onEdit={(row) => handleRowAction("edit", row)}
          onDelete={(row) => handleRowAction("delete", row)}
          onRefreshRow={(row) => handleRowAction("refresh", row)}
          prettifyKey={prettifyKey}
        />
      </div>
    </section>
  );
}