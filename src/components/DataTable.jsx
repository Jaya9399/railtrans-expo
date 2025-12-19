import React, { useMemo, useState } from "react";

/**
 * Simple DataTable
 * Props:
 *  - columns: [{ key: 'email', label: 'Email' }, ...]
 *  - data: array of objects
 *  - pageSizeOptions: [5,10,25]
 *  - defaultPageSize: number
 *  - onRowAction: (action, row) => {}
 *  - renderRowDetails: (row) => ReactNode  // content for details modal/expanded row
 */
export default function DataTable({
  columns = [],
  data = [],
  pageSizeOptions = [5, 10, 25, 50],
  defaultPageSize = 10,
  onRowAction,
  renderRowDetails,
}) {
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState({ key: null, dir: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [visibleCols, setVisibleCols] = useState(() => (columns && columns.length ? columns.map(c => c.key) : []));
  const [expandedRow, setExpandedRow] = useState(null);

  // normalized columns (fall back to data keys if not provided)
  const allKeys = useMemo(() => {
    if (columns && columns.length) return columns;
    const keys = new Set();
    data.forEach(r => Object.keys(r || {}).forEach(k => keys.add(k)));
    return Array.from(keys).map(k => ({ key: k, label: k }));
  }, [columns, data]);

  // ensure visibleCols contains defaults when columns prop is provided after mount
  React.useEffect(() => {
    if (columns && columns.length && visibleCols.length === 0) {
      setVisibleCols(columns.map(c => c.key));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns]);

  // filter
  const filtered = useMemo(() => {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return data;
    return data.filter(row => {
      return visibleCols.some(colKey => {
        const v = row?.[colKey];
        if (v === undefined || v === null) return false;
        return String(typeof v === "object" ? JSON.stringify(v) : v).toLowerCase().includes(q);
      });
    });
  }, [data, query, visibleCols]);

  // sort
  const sorted = useMemo(() => {
    if (!sortBy.key) return filtered;
    const arr = [...filtered];
    arr.sort((a, b) => {
      const va = (a?.[sortBy.key] ?? "").toString().toLowerCase();
      const vb = (b?.[sortBy.key] ?? "").toString().toLowerCase();
      if (va < vb) return sortBy.dir === "asc" ? -1 : 1;
      if (va > vb) return sortBy.dir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filtered, sortBy]);

  // paging
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageData = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, page, pageSize]);

  // CSV export
  function exportCsv() {
    const keys = visibleCols;
    const rows = [keys.join(",")].concat(sorted.map(r => keys.map(k => {
      const v = r?.[k];
      if (v === undefined || v === null) return "";
      const s = typeof v === "object" ? JSON.stringify(v) : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    }).join(",")));
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `export-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function toggleSort(key) {
    if (sortBy.key !== key) return setSortBy({ key, dir: "asc" });
    setSortBy(prev => ({ key, dir: prev.dir === "asc" ? "desc" : "asc" }));
  }

  function toggleCol(key) {
    setVisibleCols(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }

  return (
    <div className="bg-white rounded shadow p-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <input className="border rounded px-2 py-1 text-sm" placeholder="Search..." value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} />
          <button className="px-2 py-1 bg-gray-100 rounded text-sm" onClick={() => { setQuery(""); }}>Clear</button>
          <button className="px-2 py-1 bg-indigo-600 text-white rounded text-sm" onClick={exportCsv}>Export CSV</button>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-xs text-gray-500">Columns</div>
          <div className="flex gap-1 flex-wrap max-w-xs">
            {allKeys.map(c => (
              <label key={c.key} className="inline-flex items-center text-xs bg-gray-50 border rounded px-2 py-1">
                <input type="checkbox" checked={visibleCols.includes(c.key)} onChange={() => toggleCol(c.key)} className="mr-1" />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="ml-2 border rounded px-2 py-1 text-sm">
            {pageSizeOptions.map(s => <option key={s} value={s}>{s} / page</option>)}
          </select>
        </div>
      </div>

      <div className="overflow-auto">
        <table className="min-w-full table-auto border-collapse">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {allKeys.filter(c => visibleCols.includes(c.key)).map(c => (
                <th key={c.key} className="text-left text-sm px-3 py-2 text-gray-600 cursor-pointer" onClick={() => toggleSort(c.key)}>
                  <div className="flex items-center gap-2">
                    <span>{c.label}</span>
                    {sortBy.key === c.key ? <span className="text-xs text-gray-400">{sortBy.dir === "asc" ? "▲" : "▼"}</span> : null}
                  </div>
                </th>
              ))}
              <th className="px-3 py-2 text-left text-sm">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageData.length === 0 ? (
              <tr><td colSpan={visibleCols.length + 1} className="p-6 text-gray-500">No records</td></tr>
            ) : pageData.map((row, i) => (
              <tr key={row.id ?? i} className="border-t hover:bg-gray-50">
                {allKeys.filter(c => visibleCols.includes(c.key)).map(c => (
                  <td key={c.key} className="px-3 py-2 text-sm align-top whitespace-pre-wrap break-words">
                    {(() => {
                      const v = row?.[c.key];
                      if (v === undefined || v === null) return "";
                      if (typeof v === "object") return <pre className="text-xs whitespace-pre-wrap break-words">{JSON.stringify(v)}</pre>;
                      return String(v);
                    })()}
                  </td>
                ))}
                <td className="px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <button className="px-2 py-1 border rounded text-xs" onClick={() => onRowAction?.("edit", row)}>Edit</button>
                    <button className="px-2 py-1 border rounded text-xs" onClick={() => onRowAction?.("refresh", row)}>Refresh</button>
                    <button className="px-2 py-1 border rounded text-xs" onClick={() => onRowAction?.("delete", row)}>Delete</button>
                    {renderRowDetails && <button className="px-2 py-1 border rounded text-xs" onClick={() => setExpandedRow(row)}>Details</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-3">
        <div className="text-sm text-gray-600">Showing {(page - 1) * pageSize + 1} — {Math.min(page * pageSize, total)} of {total}</div>
        <div className="flex items-center gap-2">
          <button className="px-2 py-1 border rounded disabled:opacity-50" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</button>
          <div className="text-sm">Page</div>
          <input type="number" min={1} max={totalPages} value={page} onChange={(e) => setPage(Math.min(Math.max(1, Number(e.target.value || 1)), totalPages))} className="w-12 text-center border rounded px-1 py-1" />
          <div className="text-sm">/ {totalPages}</div>
          <button className="px-2 py-1 border rounded disabled:opacity-50" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</button>
        </div>
      </div>

      {/* details modal */}
      {expandedRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black opacity-40" onClick={() => setExpandedRow(null)} />
          <div className="relative z-60 w-full max-w-3xl bg-white rounded shadow-lg p-4 overflow-auto" style={{ maxHeight: "90vh" }}>
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-lg font-semibold">Details</h3>
              <button className="px-3 py-1 border rounded" onClick={() => setExpandedRow(null)}>Close</button>
            </div>
            <div className="text-sm">
              {renderRowDetails ? renderRowDetails(expandedRow) : <pre className="whitespace-pre-wrap">{JSON.stringify(expandedRow, null, 2)}</pre>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}