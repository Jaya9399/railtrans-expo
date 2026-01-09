import React, { useState, useMemo } from "react";

export default function DataTable({
  columns = [],
  data = [],
  defaultPageSize = 10,
  onEdit,
  onDelete,
  onRefreshRow,
  onResend, // callback(row) -> may be async
  prettifyKey,
  resendLoadingId, // new: id currently being resent
}) {
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");

  const sortedData = useMemo(() => {
    if (!sortKey) return data || [];
    return [...(data || [])].sort((a, b) => {
      const aVal = a?.[sortKey] ?? "";
      const bVal = b?.[sortKey] ?? "";
      const sa = typeof aVal === "string" ? aVal.toLowerCase() : String(aVal);
      const sb = typeof bVal === "string" ? bVal.toLowerCase() : String(bVal);
      if (sa < sb) return sortDir === "asc" ? -1 : 1;
      if (sa > sb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [data, sortKey, sortDir]);

  const pageCount = Math.max(
    1,
    Math.ceil((sortedData || []).length / defaultPageSize)
  );

  const pagedData = useMemo(() => {
    const start = page * defaultPageSize;
    return (sortedData || []).slice(start, start + defaultPageSize);
  }, [sortedData, page, defaultPageSize]);

  function toggleSort(colKey) {
    if (sortKey === colKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(colKey);
      setSortDir("asc");
    }
    setPage(0);
  }

  function formatDateTime(val) {
    if (!val) return "";

    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val);

    return d.toLocaleString("en-IN", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  }

  return (
    <div className="w-full overflow-x-auto max-h-[420px] overflow-y-auto rounded border border-gray-200">
      <table className="w-full text-left text-sm border-collapse">
        <thead className="bg-gray-100 sticky top-0 z-10">
          <tr>
            {columns.map(({ key, label }) => (
              <th
                key={key}
                className="px-3 py-2 border-b border-gray-300 cursor-pointer select-none whitespace-nowrap"
                onClick={() => toggleSort(key)}
                title={`Sort by ${label || key}`}
              >
                <div className="flex items-center gap-1">
                  <span className="font-medium">
                    {label || (prettifyKey ? prettifyKey(key) : key)}
                  </span>
                  {sortKey === key && (
                    <span className="text-xs">
                      {sortDir === "asc" ? "▲" : "▼"}
                    </span>
                  )}
                </div>
              </th>
            ))}

            <th className="px-3 py-2 border-b border-gray-300 text-center w-24">
              Admin
            </th>
            <th className="px-3 py-2 border-b border-gray-300 text-center w-36">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {pagedData.length === 0 && (
            <tr>
              <td
                colSpan={columns.length + 2}
                className="text-center py-6 text-gray-500"
              >
                No data available.
              </td>
            </tr>
          )}
          {pagedData.map((row, i) => {
            const keyId = row?.id ?? row?._id ?? row?.ID ?? i;
            const isResending = String(resendLoadingId || "") === String(keyId);
            return (
              <tr
                key={String(keyId)}
                className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}
              >
                {columns.map(({ key }) => (
                  <td
                    key={key}
                    className="px-2 py-2 border-b border-gray-200 max-w-xs truncate"
                    title={
                      row?.[key] !== undefined && row?.[key] !== null
                        ? String(row[key])
                        : ""
                    }
                  >
                    {(() => {
                      const value = row?.[key];

                      // detect date-like fields by key name
                      if (
                        key.toLowerCase().includes("date") ||
                        key.toLowerCase().includes("time") ||
                        key.toLowerCase().includes("at")
                      ) {
                        return formatDateTime(value);
                      }

                      if (typeof value === "string" && value.length > 100) {
                        return value.slice(0, 97) + "...";
                      }

                      return value ?? "";
                    })()}
                  </td>
                ))}

                <td className="px-2 py-2 border-b border-gray-200 text-center">
                  {row &&
                  (row.added_by_admin ||
                    row.addedByAdmin ||
                    row.addedBy ||
                    false) ? (
                    <span className="inline-block bg-green-100 text-green-800 px-2 py-0.5 rounded-full text-xs font-medium">
                      Admin
                    </span>
                  ) : (
                    <span className="inline-block bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs">
                      —
                    </span>
                  )}
                </td>

                <td className="px-2 py-2 border-b border-gray-200 text-center whitespace-nowrap">
                  <button
                    className="mr-2 text-blue-600 hover:underline text-xs"
                    onClick={() => typeof onEdit === "function" && onEdit(row)}
                    title="Edit"
                  >
                    Edit
                  </button>

                  <button
                    className="mr-2 text-red-600 hover:underline text-xs"
                    onClick={() =>
                      typeof onDelete === "function" && onDelete(row)
                    }
                    title="Delete"
                  >
                    Delete
                  </button>

                  {typeof onResend === "function" ? (
                    <button
                      className={`mr-2 text-indigo-600 hover:underline text-xs ${
                        isResending ? "opacity-60 cursor-not-allowed" : ""
                      }`}
                      onClick={() => {
                        if (!isResending) onResend(row);
                      }}
                      title="Resend Email"
                      disabled={isResending}
                    >
                      {isResending ? "Sending..." : "Resend"}
                    </button>
                  ) : (
                    <button
                      className="text-gray-600 hover:underline text-xs"
                      onClick={() =>
                        typeof onRefreshRow === "function" && onRefreshRow(row)
                      }
                      title="Refresh this row"
                    >
                      ↻
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-2 mt-2 p-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-2 py-1 border rounded disabled:opacity-50"
            aria-label="Previous Page"
          >
            Prev
          </button>
          <span className="text-sm">
            Page {Math.min(page + 1, pageCount)} of {pageCount}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page === pageCount - 1}
            className="px-2 py-1 border rounded disabled:opacity-50"
            aria-label="Next Page"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
