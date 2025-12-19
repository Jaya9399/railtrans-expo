import React, { useMemo, useCallback } from "react";
import DataTable from "./DataTable";

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

    let configCols = configs?.[tableKey]?.columns?.map((c) => c.key);
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

  return (
    <section className="border border-gray-200 rounded bg-white p-4 shadow">
      <header className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold">{label}</h2>
          <div className="text-xs text-gray-500">{(data || []).length} total</div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => typeof onAddNew === "function" && onAddNew(tableKey)}
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