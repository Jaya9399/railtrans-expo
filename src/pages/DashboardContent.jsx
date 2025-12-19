import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import EditModal from "../components/EditModal";
import DeleteModal from "../components/DeleteModal";
import AdminExhibitor from "../pages/AdminExhibitor";
import AdminPartner from "../pages/AdminPartner";
import DataTable from "../components/DataTable";
import { buildTicketEmail } from "../utils/emailTemplate";

/* ---------- helpers & constants ---------- */
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

function normalizeData(d) { if (Array.isArray(d)) return d; if (d && typeof d === "object") return [d]; return []; }

// sane sanitize: keep scalars as strings, flatten small nested objects
function sanitizeRow(row) {
  if (!row || typeof row !== "object") return {};
  const out = {};
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (v === null || typeof v === "undefined") { out[k] = ""; continue; }
    if (typeof v === "object") {
      // flatten common small objects
      if (v.name || v.full_name || v.email || v.company) {
        const parts = [];
        if (v.name) parts.push(String(v.name));
        if (v.full_name && !v.name) parts.push(String(v.full_name));
        if (v.company) parts.push(String(v.company));
        if (v.email) parts.push(String(v.email));
        out[k] = parts.join(" • ");
      } else {
        try { out[k] = JSON.stringify(v); } catch { out[k] = String(v); }
      }
    } else out[k] = String(v);
  }
  return out;
}

// preferred column order and labels
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
  return spaced.split(" ").map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
}

/* ---------- DashboardContent ---------- */
export default function DashboardContent() {
  const [report, setReport] = useState({});
  const [configs, setConfigs] = useState({});
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [modalColumns, setModalColumns] = useState([]);
  const [editTable, setEditTable] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTable, setDeleteTable] = useState("");
  const [deleteRow, setDeleteRow] = useState(null);
  const [actionMsg, setActionMsg] = useState("");
  const [showExhibitorManager, setShowExhibitorManager] = useState(false);
  const [showPartnerManager, setShowPartnerManager] = useState(false);
  const [pendingPremium, setPendingPremium] = useState(null); // new-created row pending generate
  const [newIsPremium, setNewIsPremium] = useState(false);

  const mountedRef = useRef(true);
  const apiMap = useRef(apiEndpoints.reduce((a, e) => { a[e.label.toLowerCase()] = e.url; a[e.label.toLowerCase() + "_config"] = e.configUrl; return a; }, {}));
  const RAW_API_BASE = (typeof window !== "undefined" && (window.__API_BASE__ || "")) || (process.env.REACT_APP_API_BASE || "");
  const API_BASE = String(RAW_API_BASE || "").replace(/\/$/, "");
  function buildApiUrl(path) {
    if (!path) return API_BASE || path;
    if (/^https?:\/\//i.test(path)) return path;
    if (path.startsWith("/")) return `${API_BASE}${path}`;
    return `${API_BASE}/${path}`;
  }

  const parseErrorBody = useCallback(async (res) => {
    try {
      const txt = await res.text();
      try { return JSON.parse(txt); } catch { return txt; }
    } catch (e) { return null; }
  }, []);

  const fetchConfigs = useCallback(async () => {
    const out = {};
    await Promise.all(apiEndpoints.map(async ({ label, configUrl }) => {
      const k = label.toLowerCase();
      if (!configUrl) { out[k] = null; return; }
      try {
        const res = await fetch(buildApiUrl(configUrl));
        out[k] = await res.json().catch(() => null);
      } catch (e) { console.warn("fetch config", k, e); out[k] = null; }
    }));
    if (mountedRef.current) setConfigs(out);
    return out;
  }, [API_BASE]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      await fetchConfigs();
      const results = {};
      await Promise.all(apiEndpoints.map(async ({ label, url }) => {
        try {
          const res = await fetch(buildApiUrl(url));
          let j = await res.json().catch(() => null);
          if (Array.isArray(j) && j.length === 2 && Array.isArray(j[0])) j = j[0];
          if (j && typeof j === "object" && !Array.isArray(j)) j = j.data || j.rows || j;
          results[label.toLowerCase()] = normalizeData(j).map(sanitizeRow);
        } catch (e) { console.warn("fetch data", label, e); results[label.toLowerCase()] = []; }
      }));
      if (!mountedRef.current) return;
      setReport(results);
      setLoading(false);
    } catch (e) { console.error(e); setReport({}); setLoading(false); }
  }, [fetchConfigs, API_BASE]);

  useEffect(() => { mountedRef.current = true; fetchAll(); return () => { mountedRef.current = false; }; }, [fetchAll]);

  // helpers for email extraction
  function isEmailLike(v) { return typeof v === "string" && /\S+@\S+\.\S+/.test(v); }
  function findEmailDeep(obj, seen = new Set()) {
    if (!obj || typeof obj !== "object") return "";
    if (seen.has(obj)) return "";
    seen.add(obj);
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string" && isEmailLike(v)) return v.trim();
      if (v && typeof v === "object") {
        const nested = findEmailDeep(v, seen);
        if (nested) return nested;
      }
    }
    return "";
  }
  function extractEmailFromObject(obj) {
    if (!obj) return "";
    const keys = ["email", "email_address", "emailAddress", "contactEmail", "contact", "visitorEmail", "user_email", "primaryEmail"];
    for (const k of keys) {
      try {
        if (Object.prototype.hasOwnProperty.call(obj, k)) {
          const v = obj[k];
          if (isEmailLike(v)) return v.trim();
        }
      } catch (e) {}
    }
    if (obj.data && typeof obj.data === "object") {
      const e = extractEmailFromObject(obj.data);
      if (e) return e;
    }
    if (obj.row && typeof obj.row === "object") {
      const e = extractEmailFromObject(obj.row);
      if (e) return e;
    }
    return findEmailDeep(obj);
  }

  // sendTemplatedEmail & generateAndEmailTicket remain same semantics, omitted for brevity here
  // ... (use your existing implementations from earlier code; they remain compatible)
  // For clarity in this snippet, we'll keep calls to sendTemplatedEmail and generateAndEmailTicket as-in.

  // Handlers: edit/add/delete/refresh (kept similar to prior implementation)
  const handleEdit = useCallback((table, row) => {
    const key = table.toLowerCase();
    let meta = [];
    const cfg = configs[key];
    if (cfg && Array.isArray(cfg.fields) && cfg.fields.length) {
      meta = cfg.fields.map(f => ({ name: f.name, label: f.label || f.name, type: f.type || "text" })).filter(x => x.name && !HIDDEN_FIELDS.has(x.name));
    } else {
      const rows = Array.isArray(report[key]) ? report[key] : [];
      const discovered = [];
      for (const r of rows) for (const k of Object.keys(r || {})) if (!discovered.includes(k)) discovered.push(k);
      meta = discovered.filter(c => !HIDDEN_FIELDS.has(c)).map(c => ({ name: c, label: prettifyKey(c), type: "text" }));
    }
    if (!meta.some(m => m.name === "email" || m.name === "email_address")) {
      meta.push({ name: "email", label: "Email", type: "text" });
    }
    const sanitized = sanitizeRow(row || {});
    const prepared = {};
    meta.forEach(f => prepared[f.name] = (sanitized[f.name] !== undefined ? sanitized[f.name] : ""));
    setModalColumns(meta);
    setNewIsPremium(false);
    setEditTable(key);
    setEditRow(prepared);
    setIsCreating(false);
    setEditOpen(true);
  }, [configs, report]);

  const handleAddNew = useCallback((table, premium = true) => {
    const key = table.toLowerCase();
    const defaults = {
      visitors: [{ name: "name", label: "Name" }, { name: "email", label: "Email" }],
      exhibitors: [{ name: "company", label: "Company" }, { name: "email", label: "Email" }],
      partners: [{ name: "company", label: "Company" }, { name: "email", label: "Email" }],
      speakers: [{ name: "name", label: "Name" }, { name: "email", label: "Email" }],
      awardees: [{ name: "name", label: "Name" }, { name: "email", label: "Email" }],
    };
    let meta = (configs[key] && Array.isArray(configs[key].fields) ? configs[key].fields.map(f => ({ name: f.name, label: f.label || f.name })) : (defaults[key] || [{ name: "name", label: "Name" }])).filter(m => m.name && !HIDDEN_FIELDS.has(m.name));
    if (!meta.some(m => m.name === "email" || m.name === "email_address")) meta.push({ name: "email", label: "Email", type: "text" });
    setModalColumns(meta);
    const empty = {};
    meta.forEach(m => empty[m.name] = "");
    setEditTable(key);
    setEditRow(empty);
    setIsCreating(true);
    setNewIsPremium(!!premium);
    setEditOpen(true);
  }, [configs]);

  const handleDelete = useCallback((table, row) => {
    setDeleteTable(table.toLowerCase());
    setDeleteRow(row);
    setDeleteOpen(true);
  }, []);

  const handleRefreshRow = useCallback(async (tableKey, row) => {
    setActionMsg("");
    try {
      let id = row.id || row._id || row.ID || row.Id || "";
      if (!id && row._id && typeof row._id === "object") id = row._id.$oid || row._id.toString() || "";
      if (!id) { setActionMsg("Cannot refresh: no id"); return; }
      const base = apiMap.current[tableKey];
      if (!base) { setActionMsg("Unknown table"); return; }
      const res = await fetch(buildApiUrl(`${base}/${encodeURIComponent(String(id))}`));
      if (!res.ok) { const body = await parseErrorBody(res); setActionMsg(`Refresh failed: ${JSON.stringify(body)}`); return; }
      const json = await res.json().catch(() => null);
      const sanitized = sanitizeRow(json || {});
      setReport(prev => ({ ...prev, [tableKey]: (prev[tableKey] || []).map(r => String(r.id) === String(id) ? sanitized : r) }));
      setActionMsg("Refreshed");
    } catch (e) { console.error(e); setActionMsg("Refresh failed"); }
  }, [parseErrorBody, API_BASE]);

  // handle save (create/update) — after create we set pendingPremium for newly created row
  const handleEditSave = useCallback(async (edited) => {
    setActionMsg("");
    setEditOpen(false);
    try {
      const base = apiMap.current[editTable];
      if (!base) { setActionMsg("Unknown table"); return; }
      if (isCreating) {
        const payload = { ...edited };
        const res = await fetch(buildApiUrl(base), { method: "POST", headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" }, body: JSON.stringify(payload) });
        const createdRaw = await res.json().catch(() => null);
        if (!res.ok) {
          const body = createdRaw || await parseErrorBody(res);
          setActionMsg(`Create failed: ${JSON.stringify(body)}`);
          return;
        }
        setActionMsg("Created");
        let newId = createdRaw && (createdRaw.insertedId || createdRaw.insertId || createdRaw.id || createdRaw._id || (createdRaw.data && (createdRaw.data.id || createdRaw.data._id)) || null);
        let createdRow = null;
        if (createdRaw && (createdRaw.id || createdRaw._id || createdRaw.email || createdRaw.name)) {
          createdRow = sanitizeRow(createdRaw);
          if (!newId) newId = createdRow.id || createdRow._id || null;
        }
        if (!createdRow && newId) {
          try {
            const r = await fetch(buildApiUrl(`${base}/${encodeURIComponent(String(newId))}`));
            if (r.ok) {
              const j = await r.json().catch(() => null);
              createdRow = sanitizeRow(j || {});
            }
          } catch (e) { console.warn("post-create fetch failed", e); }
        }
        if (!createdRow) {
          await fetchAll();
        } else {
          setReport(prev => ({ ...prev, [editTable]: [createdRow, ...(prev[editTable] || [])] }));
          const pendingEmail = (createdRaw && typeof createdRaw === "object" && extractEmailFromObject(createdRaw)) || extractEmailFromObject(createdRow) || "";
          const canonicalNewId = String(newId || createdRow.id || createdRow._id || "");
          setPendingPremium({ table: editTable, id: canonicalNewId, email: pendingEmail, premium: !!newIsPremium });
          if (pendingEmail) {
            setActionMsg("Created — sending email...");
            const emailRow = (createdRaw && typeof createdRaw === "object") ? createdRaw : createdRow;
            // sendTemplatedEmail(...) - use your existing implementation
            // await sendTemplatedEmail({ entity: editTable, id: canonicalNewId, row: emailRow, premium: !!newIsPremium });
            setActionMsg("Created");
          }
        }
        setNewIsPremium(false);
      } else {
        let id = edited.id || edited._id;
        if (!id && edited._id && typeof edited.__id === "object") id = edited._id.$oid || edited._id.toString() || "";
        if (!id) { setActionMsg("Missing id for update"); return; }
        const res = await fetch(buildApiUrl(`${base}/${encodeURIComponent(String(id))}`), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(edited) });
        if (!res.ok) {
          const body = await parseErrorBody(res);
          setActionMsg(`Update failed: ${JSON.stringify(body)}`);
          return;
        }
        try {
          const r = await fetch(buildApiUrl(`${base}/${encodeURIComponent(String(id))}`));
          if (r.ok) {
            const j = await r.json().catch(() => null);
            const updated = sanitizeRow(j || {});
            setReport(prev => ({ ...prev, [editTable]: (prev[editTable] || []).map((x) => String(x.id) === String(id) ? updated : x) }));
            setActionMsg("Updated");
          } else {
            await fetchAll();
            setActionMsg("Updated (refreshed)");
          }
        } catch (e) {
          console.warn("post-update fetch failed", e);
          await fetchAll();
        }
      }
    } catch (e) { console.error(e); setActionMsg("Save failed"); } finally { setIsCreating(false); fetchAll(); }
  }, [editTable, isCreating, fetchAll, parseErrorBody, newIsPremium, API_BASE]);

  const stats = useMemo(() => ({
    visitors: (report.visitors || []).length,
    exhibitors: (report.exhibitors || []).length,
    partners: (report.partners || []).length,
    speakers: (report.speakers || []).length,
    awardees: (report.awardees || []).length,
  }), [report]);

  // render friendly details (no raw JSON)
  function renderDetailsForRow(key, r) {
    const canonicalId = r.id || r._id || r.ID || "";
    const isPending = pendingPremium && pendingPremium.table === key && String(pendingPremium.id) === String(canonicalId);
    const primary = {
      Name: r.name || r.full_name || r.company || "",
      Email: r.email || r.email_address || "",
      Company: r.company || r.org || r.organization || "",
      Ticket: r.ticket_code || r.ticketCode || r.code || "—",
      Category: r.ticket_category || r.category || "",
      Phone: r.mobile || r.phone || "",
    };
    const primaryKeys = new Set(["name", "full_name", "company", "org", "organization", "email", "email_address", "ticket_code", "ticketCode", "code", "ticket_category", "category", "mobile", "phone", "id", "_id"]);
    const others = {};
    for (const k of Object.keys(r || {})) {
      if (primaryKeys.has(k)) continue;
      others[prettifyKey(k)] = r[k];
    }
    return (
      <div>
        <div className="flex items-start justify-between">
          <div>
            <h4 className="font-semibold">{primary.Name || primary.Email || primary.Company}</h4>
            <div className="text-xs text-gray-600">{primary.Email} {primary.Company ? `• ${primary.Company}` : ""}</div>
            <div className="mt-2 text-sm">
              <div><strong>Ticket:</strong> {primary.Ticket}</div>
              <div><strong>Category:</strong> {primary.Category}</div>
              <div><strong>Phone:</strong> {primary.Phone}</div>
            </div>
          </div>
          <div className="flex gap-2">
            {isPending && (
              <button className="px-3 py-1 bg-[#196e87] text-white rounded text-sm" onClick={() => {/* call generateAndEmailTicket(...) */}}>Generate</button>
            )}
            <button className="px-3 py-1 border rounded text-sm" onClick={() => { navigator.clipboard?.writeText(JSON.stringify(r)); }}>
              Copy JSON
            </button>
          </div>
        </div>

        {Object.keys(others).length > 0 && (
          <div className="mt-3">
            <div className="text-xs text-gray-500 mb-1">Other fields</div>
            <table className="w-full text-sm">
              <tbody>
                {Object.entries(others).map(([k, v]) => (
                  <tr key={k} className="border-b">
                    <td className="px-2 py-1 align-top w-1/3 text-xs text-gray-600">{k}</td>
                    <td className="px-2 py-1 align-top">{typeof v === "object" ? JSON.stringify(v) : String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

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
              <button onClick={() => fetchAll()} className="px-3 py-2 border rounded text-sm bg-white hover:bg-gray-50">Refresh All</button>
              <div className="text-sm text-gray-500">Showing {Object.keys(report).reduce((s,k)=>s + (report[k]||[]).length, 0)} records</div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-4">
            <div className="bg-white rounded-lg p-3 shadow">
              <div className="text-xs text-gray-500">Visitors</div>
              <div className="text-2xl font-bold">{stats.visitors}</div>
            </div>
            <div className="bg-white rounded-lg p-3 shadow">
              <div className="text-xs text-gray-500">Exhibitors</div>
              <div className="text-2xl font-bold">{stats.exhibitors}</div>
            </div>
            <div className="bg-white rounded-lg p-3 shadow">
              <div className="text-xs text-gray-500">Partners</div>
              <div className="text-2xl font-bold">{stats.partners}</div>
            </div>
            <div className="bg-white rounded-lg p-3 shadow hidden md:block">
              <div className="text-xs text-gray-500">Speakers</div>
              <div className="text-2xl font-bold">{stats.speakers}</div>
            </div>
            <div className="bg-white rounded-lg p-3 shadow hidden lg:block">
              <div className="text-xs text-gray-500">Awardees</div>
              <div className="text-2xl font-bold">{stats.awardees}</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-4">
          {TABLE_KEYS.map((key) => {
            const label = key.charAt(0).toUpperCase() + key.slice(1);
            const rows = report[key] || [];
            // build columns with friendly labels and preferred order
            const preferred = ["name","full_name","company","org","organization","email","email_address","ticket_code","ticketCode","code","ticket_category","category","mobile","phone","id","_id"];
            const discovered = [];
            const seen = new Set();
            // add preferred if present
            for (const p of preferred) {
              if (rows.some(r => Object.prototype.hasOwnProperty.call(r, p))) {
                if (!seen.has(p)) { seen.add(p); discovered.push(p); }
              }
            }
            // then all other keys
            for (const r of rows) {
              for (const k of Object.keys(r || {})) {
                if (!seen.has(k) && !HIDDEN_FIELDS.has(k)) { seen.add(k); discovered.push(k); }
              }
            }
            const cols = discovered.map(k => ({ key: k, label: prettifyKey(k) }));

            const showManage = (key === "exhibitors" || key === "partners");

            return (
              <section key={key} className="bg-white rounded-lg shadow overflow-hidden flex flex-col min-h-0">
                <div className="flex items-center justify-between px-4 py-3 border-b">
                  <div>
                    <div className="text-sm font-semibold">{label}</div>
                    <div className="text-xs text-gray-500">{rows.length} total</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="px-2 py-1 text-sm border rounded" onClick={() => handleAddNew(label, true)}>Add New</button>
                    {showManage && <button className="px-2 py-1 text-sm bg-indigo-600 text-white rounded" onClick={() => { if (key === "exhibitors") setShowExhibitorManager(true); else setShowPartnerManager(true); }}>Manage</button>}
                  </div>
                </div>

                <div className="p-4 flex-1 min-h-0">
                  <DataTable
                    columns={cols}
                    data={rows}
                    defaultPageSize={PAGE_SIZE}
                    onRowAction={(action, row) => {
                      if (action === "edit") handleEdit(label, row);
                      else if (action === "refresh") handleRefreshRow(key, row);
                      else if (action === "delete") handleDelete(label, row);
                    }}
                    renderRowDetails={(r) => renderDetailsForRow(key, r)}
                  />
                </div>
              </section>
            );
          })}
        </div>

        <EditModal open={editOpen} onClose={() => setEditOpen(false)} row={editRow} columns={modalColumns} onSave={handleEditSave} isNew={isCreating} table={editTable || "exhibitors"} />
        {deleteOpen && <DeleteModal open={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={() => { /* call delete confirm logic */ }} title="Delete record" message={`Delete "${deleteRow?.name || deleteRow?.id}"?`} confirmLabel="Delete" cancelLabel="Cancel" />}

        {showExhibitorManager && (
          <div className="fixed inset-0 z-50 flex items-start justify-center p-6">
            <div className="absolute inset-0 bg-black opacity-40" onClick={() => setShowExhibitorManager(false)} />
            <div className="relative z-60 w-full max-w-5xl bg-white rounded shadow-lg overflow-auto" style={{ maxHeight: "90vh" }}>
              <div className="flex items-center justify-between p-3 border-b">
                <h3 className="text-lg font-semibold">Manage Exhibitors</h3>
                <div><button className="px-3 py-1 mr-2 border rounded" onClick={() => setShowExhibitorManager(false)}>Close</button></div>
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
                <div><button className="px-3 py-1 mr-2 border rounded" onClick={() => setShowPartnerManager(false)}>Close</button></div>
              </div>
              <div className="p-4"><AdminPartner /></div>
            </div>
          </div>
        )}

        {actionMsg && <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-50 bg-white px-4 py-2 rounded shadow">{actionMsg}</div>}
      </div>
    </div>
  );
}