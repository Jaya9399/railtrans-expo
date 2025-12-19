import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import EditModal from "../components/EditModal";
import DeleteModal from "../components/DeleteModal";
import AdminExhibitor from "../pages/AdminExhibitor";
import AdminPartner from "../pages/AdminPartner";
import DashboardStats from "../components/DashboardStats";
import DashboardSection from "../components/DashboardSection";

const apiEndpoints = [
  { label: "Visitors", url: "/api/visitors", configUrl: "/api/visitor-config" },
  { label: "Exhibitors", url: "/api/exhibitors", configUrl: "/api/exhibitor-config" },
  { label: "Partners", url: "/api/partners", configUrl: "/api/partner-config" },
  { label: "Speakers", url: "/api/speakers", configUrl: "/api/speaker-config" },
  { label: "Awardees", url: "/api/awardees", configUrl: "/api/awardee-config" },
];
const TABLE_KEYS = ["visitors", "exhibitors", "partners", "speakers", "awardees"];
const HIDDEN_FIELDS = new Set([]);
const PAGE_SIZE = 10;

function normalizeData(d) {
  if (Array.isArray(d)) return d;
  if (d && typeof d === "object") return [d];
  return [];
}

function sanitizeRow(row) {
  if (!row || typeof row !== "object") return {};
  const out = {};
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (v === null || typeof v === "undefined") {
      out[k] = "";
      continue;
    }
    if (typeof v === "object") {
      if (v.name || v.full_name || v.email || v.company) {
        const parts = [];
        if (v.name) parts.push(String(v.name));
        if (v.full_name && !v.name) parts.push(String(v.full_name));
        if (v.company) parts.push(String(v.company));
        if (v.email) parts.push(String(v.email));
        out[k] = parts.join(" • ");
      } else {
        try {
          out[k] = JSON.stringify(v);
        } catch {
          out[k] = String(v);
        }
      }
    } else out[k] = String(v);
  }
  return out;
}

const LABEL_MAP = {
  name: "Name",
  full_name: "Name",
  company: "Company",
  org: "Company",
  organization: "Company",
  email: "Email",
  email_address: "Email",
  ticket_code: "Ticket",
  ticketCode: "Ticket",
  code: "Ticket",
  ticket_category: "Category",
  category: "Category",
  mobile: "Phone",
  phone: "Phone",
  id: "ID",
  _id: "ID",
};
function prettifyKey(k) {
  if (!k) return "";
  if (LABEL_MAP[k]) return LABEL_MAP[k];
  const spaced = k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  return spaced
    .split(" ")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

// pattern used to detect fields we will hide on "Add New"
const HIDE_ON_CREATE_RE = /(ticket|tx|transaction|payment|paid|(^id$)|id$|created(_at)?|updated(_at)?|timestamp|_at)$/i;
function shouldHideOnCreate(name = "") {
  if (!name) return false;
  return HIDE_ON_CREATE_RE.test(String(name));
}

export default function DashboardContent() {
  // store both sanitized display rows (report) and raw backend rows (rawReport)
  const [report, setReport] = useState({});
  const [rawReport, setRawReport] = useState({});
  const [configs, setConfigs] = useState({});
  const [loading, setLoading] = useState(true);

  const [editOpen, setEditOpen] = useState(false);
  const [editRow, setEditRow] = useState(null); // raw row for modal
  const [modalColumns, setModalColumns] = useState([]);
  const [editTable, setEditTable] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTable, setDeleteTable] = useState("");
  const [deleteRow, setDeleteRow] = useState(null);

  const [actionMsg, setActionMsg] = useState("");
  const [showExhibitorManager, setShowExhibitorManager] = useState(false);
  const [showPartnerManager, setShowPartnerManager] = useState(false);

  const [pendingPremium, setPendingPremium] = useState(false);
  const [newIsPremium, setNewIsPremium] = useState(false);

  const mountedRef = useRef(true);
  const apiMap = useRef(
    apiEndpoints.reduce((a, e) => {
      a[e.label.toLowerCase()] = e.url;
      a[e.label.toLowerCase() + "_config"] = e.configUrl;
      return a;
    }, {})
  );

  const RAW_API_BASE =
    (typeof window !== "undefined" && (window.__API_BASE__ || "")) || (process.env.REACT_APP_API_BASE || "");
  const API_BASE = String(RAW_API_BASE || "").replace(/\/$/, "");
  function buildApiUrl(path) {
    if (!path) return API_BASE || path;
    if (/^https?:\/\//i.test(path)) return path;
    return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  }

  const fetchConfigs = useCallback(async () => {
    const out = {};
    await Promise.all(
      apiEndpoints.map(async ({ label, configUrl }) => {
        const k = label.toLowerCase();
        if (!configUrl) {
          out[k] = null;
          return;
        }
        try {
          const res = await fetch(buildApiUrl(configUrl));
          out[k] = await res.json().catch(() => null);
        } catch (e) {
          console.warn("fetch config", k, e);
          out[k] = null;
        }
      })
    );
    if (mountedRef.current) setConfigs(out);
    return out;
  }, [API_BASE]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      await fetchConfigs();
      const results = {};
      const raws = {};
      await Promise.all(
        apiEndpoints.map(async ({ label, url }) => {
          try {
            const res = await fetch(buildApiUrl(url));
            let j = await res.json().catch(() => null);
            if (Array.isArray(j) && j.length === 2 && Array.isArray(j[0])) j = j[0];
            if (j && typeof j === "object" && !Array.isArray(j)) j = j.data || j.rows || j;
            const raw = normalizeData(j);
            raws[label.toLowerCase()] = raw;
            results[label.toLowerCase()] = raw.map(sanitizeRow);
          } catch (e) {
            console.warn("fetch data", label, e);
            raws[label.toLowerCase()] = [];
            results[label.toLowerCase()] = [];
          }
        })
      );
      if (!mountedRef.current) return;
      setRawReport(raws);
      setReport(results);
      setLoading(false);
    } catch (e) {
      console.error(e);
      setRawReport({});
      setReport({});
      setLoading(false);
    }
  }, [fetchConfigs, API_BASE]);

  useEffect(() => {
    mountedRef.current = true;
    fetchAll();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchAll]);

  // === Handlers ===

  // open modal for edit: find raw object by id and pass to modal
  function handleEdit(table, displayRow) {
    setEditTable(table);
    setIsCreating(false);

    const raws = rawReport[table] || [];
    const idKeys = ["id", "_id", "ID", "Id"];
    let raw = null;
    for (const r of raws) {
      for (const k of idKeys) {
        if (r && r[k] !== undefined && String(r[k]) === String(displayRow[k])) {
          raw = r;
          break;
        }
      }
      if (raw) break;
    }
    if (!raw && displayRow && displayRow.email) {
      raw = raws.find((r) => r && String(r.email || r.data?.email || r.form?.email || "").toLowerCase() === String(displayRow.email).toLowerCase());
    }
    if (!raw) raw = displayRow || null;

    let configCols = (configs[table] && configs[table].columns) || null;
    if (!configCols && raw) configCols = Object.keys(raw).map((k) => ({ key: k, name: k, label: prettifyKey(k) }));
    if (!configCols) configCols = [];

    setModalColumns(configCols);
    setEditRow(raw);
    setEditOpen(true);
  }

  // ADD NEW: ensure modalColumns has fields even when configs missing
  function handleAddNew(table, premium = false, configCols = null) {
    setEditTable(table);
    setIsCreating(true);
    setEditRow(null);

    // If caller provided configCols (from DashboardSection fetch), use it directly.
    if (Array.isArray(configCols) && configCols.length > 0) {
      // normalize to objects accepted by EditModal
      const normalizedCols = configCols.map((c) => {
        if (typeof c === "string") return { name: c, label: prettifyKey(c), type: "text" };
        return { name: c.name || c.key, label: c.label || prettifyKey(c.name || c.key), type: c.type || "text", options: c.options || [], required: !!c.required };
      });
      setModalColumns(normalizedCols);
    } else {
      // existing fallback behavior (infer from configs/rawReport/defaults)
      let cfg = (configs[table] && (configs[table].fields || configs[table].columns)) || null;
      if (!cfg && rawReport[table] && rawReport[table].length > 0) {
        const sample = rawReport[table][0];
        const keys = Object.keys(sample).filter(k => !HIDDEN_FIELDS.has(k));
        cfg = keys.map(k => ({ name: k, label: prettifyKey(k), type: 'text' }));
      }
      if (!cfg || cfg.length === 0) {
        const defaultsMap = {
          visitors: ["name", "email", "company", "mobile"],
          exhibitors: ["company", "name", "email", "mobile"],
          partners: ["company", "name", "email", "mobile"],
          speakers: ["name", "email", "company"],
          awardees: ["name", "email", "company"],
        };
        const keys = defaultsMap[table] || ["name", "email", "company"];
        cfg = keys.map(k => ({ name: k, label: prettifyKey(k), type: 'text' }));
      }
      // filter out ticket/payment/id/created fields for create
      const normalizedCols = cfg.map(c => (typeof c === 'string' ? { name: c, label: prettifyKey(c), type: 'text' } : { name: c.name || c.key, label: c.label || prettifyKey(c.name || c.key), type: c.type || 'text', options: c.options || [], required: !!c.required })).filter(c => !shouldHideOnCreate(c.name));
      setModalColumns(normalizedCols);
    }

    setPendingPremium(false);
    setNewIsPremium(!!premium);
    setEditOpen(true);
  }

  async function handleDelete(table, displayRow) {
    if (!table || !displayRow) return;
    const raws = rawReport[table] || [];
    const idVal = displayRow?.id || displayRow?._id || displayRow?.ID || "";
    let raw = raws.find((r) => String(r.id || r._id || r.ID || "") === String(idVal));
    if (!raw) raw = displayRow;
    setDeleteTable(table);
    setDeleteRow(raw);
    setDeleteOpen(true);
  }

  async function handleDeleteConfirm() {
    if (!deleteTable || !deleteRow) return;
    try {
      const idVal = deleteRow.id || deleteRow._id || deleteRow.ID || "";
      if (!idVal) throw new Error("missing id");
      const base = apiMap.current[deleteTable];
      if (!base) throw new Error("unknown base");
      const url = buildApiUrl(`${base}/${encodeURIComponent(String(idVal))}`);
      const res = await fetch(url, { method: "DELETE" });
      if (res.ok) {
        setActionMsg(`Deleted from ${deleteTable}`);
        await fetchAll();
      } else {
        const body = await res.text().catch(() => null);
        setActionMsg(`Failed to delete: ${body || res.status}`);
      }
    } catch (e) {
      console.error("delete error", e);
      setActionMsg(`Error deleting from ${deleteTable}: ${e.message || e}`);
    } finally {
      setDeleteOpen(false);
    }
  }

  async function handleEditSave(updatedRowRaw) {
    if (!editTable) return;
    const base = apiMap.current[editTable];
    if (!base) {
      setActionMsg("Unknown table");
      return;
    }
    try {
      let url = buildApiUrl(base);
      let method = "POST";
      if (!isCreating) {
        const idVal = updatedRowRaw.id || updatedRowRaw._id || updatedRowRaw.ID || "";
        if (!idVal) {
          setActionMsg("Missing id for update");
          return;
        }
        url = buildApiUrl(`${base}/${encodeURIComponent(String(idVal))}`);
        method = "PUT";
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedRowRaw),
      });
      if (res.ok) {
        setActionMsg(isCreating ? `Created new ${editTable}` : `Updated ${editTable}`);
        setEditOpen(false);
        await fetchAll();
      } else {
        const body = await res.text().catch(() => null);
        setActionMsg(`Failed to save: ${body || res.status}`);
      }
    } catch (e) {
      console.error("save error", e);
      setActionMsg(`Error saving ${editTable}: ${e.message || e}`);
    }
  }

  async function handleRefreshRow(table, displayRow) {
    if (!table || !displayRow) return;
    try {
      const raws = rawReport[table] || [];
      const idVal = displayRow.id || displayRow._id || displayRow.ID || "";
      if (!idVal) { setActionMsg("Cannot refresh: missing id"); return; }
      const base = apiMap.current[table];
      if (!base) { setActionMsg("Unknown table"); return; }
      const url = buildApiUrl(`${base}/${encodeURIComponent(String(idVal))}`);
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.text().catch(() => null);
        setActionMsg(`Failed to refresh: ${body || res.status}`);
        return;
      }
      const fresh = await res.json().catch(() => null);
      setRawReport((prev) => {
        const prevList = [...(prev[table] || [])];
        const idx = prevList.findIndex((r) => String(r.id || r._id || r.ID || "") === String(idVal));
        if (idx >= 0) prevList[idx] = fresh;
        else prevList.unshift(fresh);
        return { ...prev, [table]: prevList };
      });
      setReport((prev) => {
        const prevList = [...(prev[table] || [])];
        const idx = prevList.findIndex((r) => String(r.id || r._id || r.ID || "") === String(idVal));
        const sanitized = sanitizeRow(fresh || {});
        if (idx >= 0) prevList[idx] = sanitized;
        else prevList.unshift(sanitized);
        return { ...prev, [table]: prevList };
      });
      setActionMsg(`Refreshed ${table} record`);
    } catch (e) {
      console.error("refresh error", e);
      setActionMsg(`Error refreshing ${table} record`);
    }
  }

  const stats = useMemo(
    () => ({
      visitors: (report.visitors || []).length,
      exhibitors: (report.exhibitors || []).length,
      partners: (report.partners || []).length,
      speakers: (report.speakers || []).length,
      awardees: (report.awardees || []).length,
    }),
    [report]
  );

  return (
    <div className="pt-4 pb-6 w-full">
      <div className="w-full mx-auto px-4 md:px-6">
        <div className="sticky top-16 z-20 bg-transparent pb-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">Admin Dashboard</h1>
              <div className="text-sm text-gray-600">Live registration report</div>
            </div>
            <div className="flex items-center gap-3 justify-start md:justify-end">
              <button
                onClick={() => fetchAll()}
                className="px-3 py-2 border rounded text-sm bg-white hover:bg-gray-50"
              >
                Refresh All
              </button>
              <div className="text-sm text-gray-500">
                Showing {Object.keys(report).reduce((s, k) => s + (report[k] || []).length, 0)} records
              </div>
            </div>
          </div>

          <DashboardStats stats={stats} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-4">
          {TABLE_KEYS.map((key) => (
            <DashboardSection
              key={key}
              label={key.charAt(0).toUpperCase() + key.slice(1)}
              data={report[key] || []}
              tableKey={key}
              configs={configs}
              onEdit={handleEdit}
              onAddNew={handleAddNew}
              onDelete={handleDelete}
              onRefreshRow={handleRefreshRow}
              setShowExhibitorManager={setShowExhibitorManager}
              setShowPartnerManager={setShowPartnerManager}
              PAGE_SIZE={PAGE_SIZE}
              HIDDEN_FIELDS={HIDDEN_FIELDS}
              prettifyKey={prettifyKey}
            />
          ))}
        </div>

        <EditModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          row={editRow}
          columns={modalColumns}
          onSave={handleEditSave}
          isNew={isCreating}
          table={editTable || "exhibitors"}
          pendingPremium={pendingPremium}
          newIsPremium={newIsPremium}
          setPendingPremium={setPendingPremium}
          setNewIsPremium={setNewIsPremium}
        />

        {deleteOpen && (
          <DeleteModal
            open={deleteOpen}
            onClose={() => setDeleteOpen(false)}
            onConfirm={handleDeleteConfirm}
            title="Delete record"
            message={`Delete "${deleteRow?.name || deleteRow?.id}"?`}
            confirmLabel="Delete"
            cancelLabel="Cancel"
          />
        )}

        {showExhibitorManager && (
          <div className="fixed inset-0 z-50 flex items-start justify-center p-6">
            <div className="absolute inset-0 bg-black opacity-40" onClick={() => setShowExhibitorManager(false)} />
            <div className="relative z-60 w-full max-w-5xl bg-white rounded shadow-lg overflow-auto" style={{ maxHeight: "90vh" }}>
              <div className="flex items-center justify-between p-3 border-b">
                <h3 className="text-lg font-semibold">Manage Exhibitors</h3>
                <div>
                  <button className="px-3 py-1 mr-2 border rounded" onClick={() => setShowExhibitorManager(false)}>Close</button>
                </div>
              </div>
              <div className="p-4"><AdminExhibitor /></div>
            </div>
          </div>
        )}

        {showPartnerManager && (
          <div className="fixed inset-0 z-50 flex items-start justify-center p-6">
            <div className="absolute inset-0 bg-black opacity-40" onClick={() => setShowPartnerManager(false)} />
            <div className="relative z-60 w-full max-w-5xl bg-white rounded shadow-lg overflow-auto" style={{ maxHeight: "90vh" }}>
              <div className="flex items-center justify-between p-3 border-b">
                <h3 className="text-lg font-semibold">Manage Partners</h3>
                <div>
                  <button className="px-3 py-1 mr-2 border rounded" onClick={() => setShowPartnerManager(false)}>Close</button>
                </div>
              </div>
              <div className="p-4"><AdminPartner /></div>
            </div>
          </div>
        )}

        {actionMsg && (
          <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-50 bg-white px-4 py-2 rounded shadow">
            {actionMsg}
          </div>
        )}
      </div>
    </div>
  );
}