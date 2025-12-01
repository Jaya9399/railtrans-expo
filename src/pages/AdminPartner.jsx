import React, { useEffect, useState, useRef } from "react";
import EditModal from "../components/EditModal";
import DeleteModal from "../components/DeleteModal";

/**
 * AdminPartners.jsx
 *
 * Management UI for Partners (approve / cancel / view / delete).
 * Follows the same pattern and UX as ExhibitorsAdmin.
 */

const PAGE_SIZE = 12;

function StatusBadge({ status }) {
  const map = {
    pending: "bg-yellow-100 text-yellow-700",
    approved: "bg-green-100 text-green-700",
    cancelled: "bg-red-100 text-red-700",
  };
  return (
    <span className={`px-2 py-1 rounded text-sm font-semibold ${map[status] || "bg-gray-100 text-gray-700"}`}>
      {status || "unknown"}
    </span>
  );
}

export default function AdminPartners() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [selectedRow, setSelectedRow] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [actionMsg, setActionMsg] = useState("");
  const [approvingId, setApprovingId] = useState(null); // per-row approving state
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    load();
    // optional: socket.io realtime hook if available
    let socket;
    try {
      if (window.io) {
        socket = window.io();
        socket.on("partners.updated", () => load());
      }
    } catch (e) { /* ignore */ }

    return () => {
      mountedRef.current = false;
      if (socket && socket.disconnect) socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/partners");
      if (!res.ok) throw new Error("Failed to fetch partners");
      const js = await res.json();
      // Accept either array or { rows: [...] } shapes
      let list = [];
      if (Array.isArray(js)) list = js;
      else if (js && Array.isArray(js.rows)) list = js.rows;
      else if (js && Array.isArray(js.data)) list = js.data;
      else list = [];
      if (!mountedRef.current) return;
      setRows(list);
      setLoading(false);
    } catch (err) {
      console.error("Load partners failed:", err);
      if (!mountedRef.current) return;
      setRows([]);
      setLoading(false);
      setActionMsg("Failed to load partners");
    }
  }

  function paginated() {
    const start = (page - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }

  function openEdit(row) {
    setSelectedRow(row);
    setEditOpen(true);
  }
  function openDelete(row) {
    setSelectedRow(row);
    setDeleteOpen(true);
  }

  // Approve partner
  async function doApprove(id) {
    if (!id) return;
    setActionMsg("");
    setApprovingId(id);
    try {
      const res = await fetch(`/api/partners/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ admin: "web-admin" }),
      });
      let js = null;
      try { js = await res.json(); } catch {}
      if (!res.ok) {
        const msg = (js && (js.error || js.message)) || `Approve failed (${res.status})`;
        throw new Error(msg);
      }

      // Provide helpful message about notification
      if (js && js.updated && js.updated.email) {
        setActionMsg(`Approved. Notification will be sent to ${js.updated.email}.`);
      } else {
        setActionMsg("Approved. Notification will be sent if email configured on server.");
      }
      await load();
    } catch (err) {
      console.error("Approve error:", err);
      setActionMsg(err.message || "Approve failed");
    } finally {
      setApprovingId(null);
    }
  }

  // Cancel partner
  async function doCancel(id) {
    if (!id) return;
    setActionMsg("");
    try {
      const res = await fetch(`/api/partners/${id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ admin: "web-admin" }),
      });
      let js = null;
      try { js = await res.json(); } catch {}
      if (!res.ok) {
        const msg = (js && (js.error || js.message)) || `Cancel failed (${res.status})`;
        throw new Error(msg);
      }
      setActionMsg("Cancelled successfully.");
      await load();
    } catch (err) {
      console.error("Cancel error:", err);
      setActionMsg(err.message || "Cancel failed");
    }
  }

  // Delete partner
  async function doDelete() {
    if (!selectedRow || !selectedRow.id) return;
    setActionMsg("");
    setDeleteOpen(false);
    try {
      const id = selectedRow.id;
      const res = await fetch(`/api/partners/${id}`, { method: "DELETE" });
      const js = await res.json().catch(() => null);
      if (!res.ok) throw new Error((js && (js.error || js.message)) || "Delete failed");
      setActionMsg("Deleted successfully");
      setSelectedRow(null);
      await load();
    } catch (err) {
      console.error("Delete error:", err);
      setActionMsg(err.message || "Delete failed");
    }
  }

  // Save edited partner
  async function handleEditSave(edited) {
    setEditOpen(false);
    setActionMsg("");
    try {
      const res = await fetch(`/api/partners/${edited.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(edited),
      });
      const js = await res.json().catch(() => null);
      if (!res.ok) throw new Error((js && (js.error || js.message)) || "Update failed");
      setActionMsg("Updated successfully");
      await load();
    } catch (err) {
      console.error("Update error:", err);
      setActionMsg(err.message || "Update failed");
    }
  }

  // View details helper (simple alert)
  function handleView(row) {
    const details = [
      `ID: ${row.id || "N/A"}`,
      `Name: ${row.name || row.company || "N/A"}`,
      `Company: ${row.company || row.organization || "N/A"}`,
      `Mobile: ${row.mobile || "N/A"}`,
      `Email: ${row.email || "N/A"}`,
      `Designation: ${row.designation || "N/A"}`,
      `Status: ${row.status || "pending"}`,
      `Created: ${row.created_at || row.registered_at || "N/A"}`
    ].join("\n");
    window.alert(details);
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Manage Partners</h1>
        <div className="text-sm text-gray-600">Total: <strong>{rows.length}</strong></div>
      </div>

      {actionMsg && <div className="mb-4 text-green-700">{actionMsg}</div>}

      {loading ? (
        <div>Loading...</div>
      ) : rows.length === 0 ? (
        <div className="text-gray-500">No partners registered yet.</div>
      ) : (
        <div className="bg-white rounded shadow overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">#</th>
                <th className="px-3 py-2 text-left font-semibold">Name</th>
                <th className="px-3 py-2 text-left font-semibold">Company</th>
                <th className="px-3 py-2 text-left font-semibold">Email</th>
                <th className="px-3 py-2 text-left font-semibold">Mobile</th>
                <th className="px-3 py-2 text-left font-semibold">Status</th>
                <th className="px-3 py-2 text-left font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginated().map((r, i) => (
                <tr key={r.id || i} className="hover:bg-gray-50">
                  <td className="px-3 py-2 align-top">{(page - 1) * PAGE_SIZE + i + 1}</td>
                  <td className="px-3 py-2 align-top">{r.name}</td>
                  <td className="px-3 py-2 align-top">{r.company || r.organization || ""}</td>
                  <td className="px-3 py-2 align-top">{r.email}</td>
                  <td className="px-3 py-2 align-top">{r.mobile}</td>
                  <td className="px-3 py-2 align-top"><StatusBadge status={r.status} /></td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex items-center gap-2">
                      <button className="px-3 py-1 bg-blue-50 text-blue-700 rounded text-sm" onClick={() => openEdit(r)}>Edit</button>

                      {r.status !== "approved" && (
                        <button
                          className="px-3 py-1 bg-green-50 text-green-700 rounded text-sm disabled:opacity-50"
                          onClick={() => doApprove(r.id)}
                          disabled={approvingId === r.id}
                        >
                          {approvingId === r.id ? "Approving..." : "Approve"}
                        </button>
                      )}

                      {r.status !== "cancelled" && (
                        <button className="px-3 py-1 bg-red-50 text-red-700 rounded text-sm" onClick={() => doCancel(r.id)}>Cancel</button>
                      )}

                      <button className="px-3 py-1 bg-gray-50 text-gray-700 rounded text-sm" onClick={() => handleView(r)}>View</button>
                      <button className="px-3 py-1 bg-white border text-sm rounded text-red-700" onClick={() => openDelete(r)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex items-center justify-between p-3 border-t">
            <div>
              Page {page} / {totalPages}
            </div>
            <div className="flex items-center gap-2">
              <button className="px-2 py-1 border rounded disabled:opacity-50" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</button>
              <button className="px-2 py-1 border rounded disabled:opacity-50" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</button>
            </div>
          </div>
        </div>
      )}

      {editOpen && selectedRow && (
        <EditModal open={editOpen} onClose={() => setEditOpen(false)} row={selectedRow} columns={Object.keys(selectedRow)} onSave={handleEditSave} />
      )}
      {deleteOpen && selectedRow && (
        <DeleteModal open={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={doDelete} />
      )}
    </div>
  );
}