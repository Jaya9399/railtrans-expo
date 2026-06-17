// (full file, updated handleResend implementation)
import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import * as XLSX from "xlsx";
import EditModal from "../components/EditModal";
import DeleteModal from "../components/DeleteModal";
import AdminExhibitor from "../pages/AdminExhibitor";
import AdminPartner from "../pages/AdminPartner";
import DashboardStats from "../components/DashboardStats";
import DashboardSection from "../components/DashboardSection";
import AddRegistrantModal from "../components/AddRegistrantModal";

// ✅ Password Modal Component for Download Protection
const PasswordModal = ({ onConfirm, onCancel, title, action }) => {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleConfirm = () => {
    const validPassword = process.env.REACT_APP_EXPORT_PASSWORD || "Admin@2026";
    if (password === validPassword) {
      onConfirm(password);
    } else {
      setError("Invalid password! Please try again.");
      setTimeout(() => setError(""), 3000);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white p-6 rounded-xl shadow-2xl max-w-md w-full mx-4">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-800">{title || "Enter Password"}</h3>
          <p className="text-sm text-gray-500 mt-1">{action || "Please enter the admin password to continue."}</p>
        </div>
        <input
          type="password"
          placeholder="Enter admin password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
          autoFocus
        />
        {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
        <div className="flex gap-3 mt-5">
          <button onClick={handleConfirm} className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors">Confirm</button>
          <button onClick={onCancel} className="flex-1 px-4 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-medium transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  );
};

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

  if (row._id !== undefined && row._id !== null) {
    try {
      out.id = typeof row._id === "string" ? row._id : row._id.$oid ? String(row._id.$oid) : String(row._id);
    } catch {
      out.id = String(row._id);
    }
  } else if (row.id !== undefined && row.id !== null) {
    out.id = String(row.id);
  }

  if (row.data && typeof row.data === "object") {
    for (const [dataKey, dataValue] of Object.entries(row.data)) {
      if (dataValue !== undefined && dataValue !== null && dataValue !== "") {
        if (!(dataKey in out) || out[dataKey] === undefined || out[dataKey] === null) {
          out[dataKey] = typeof dataValue === "object" ? JSON.stringify(dataValue) : String(dataValue);
        }
      }
    }
  }

  for (const k of Object.keys(row)) {
    if (k === "_id" || k === "data") continue;
    const v = row[k];
    if (v === null || typeof v === "undefined") {
      out[k] = "";
      continue;
    }
    if (k === "added_by_admin") {
      out[k] = v === true || v === "true" || v === 1 ? "Admin" : "User";
      continue;
    }
    if (typeof v === "boolean") {
      out[k] = v ? "Yes" : "No";
      continue;
    }
    if (typeof v === "number") {
      out[k] = v;
      continue;
    }
    if (v instanceof Date) {
      out[k] = v.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      continue;
    }
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) {
      try {
        const d = new Date(v);
        if (!isNaN(d.getTime())) {
          out[k] = d.toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
          continue;
        }
      } catch {}
    }
    if (typeof v === "object") {
      try {
        out[k] = JSON.stringify(v);
      } catch {
        out[k] = String(v);
      }
      continue;
    }
    out[k] = String(v);
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
  ticket_category: "Ticket Type",
  category: "Category",
  mobile: "Phone",
  phone: "Phone",
  id: "ID",
  _id: "ID",
  ticket_price: "Base Price",
  ticket_gst: "GST",
  ticket_total: "Total Amount",
  txId: "Payment ID",
  added_by_admin: "Created By",
};

function prettifyKey(k) {
  if (!k) return "";
  if (LABEL_MAP[k]) return LABEL_MAP[k];
  const spaced = k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  return spaced.split(" ").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
}

const HIDE_ON_CREATE_RE = /(ticket|tx|transaction|payment|paid|(^id$)|timestamp)$/i;
function shouldHideOnCreate(name = "") {
  if (!name) return false;
  return HIDE_ON_CREATE_RE.test(String(name));
}

const CLEAN_EXPORT_FIELDS = {
  visitors: [
    "name", "email", "mobile", "company", "designation", "role",
    "ticket_category", "ticket_price", "ticket_gst", "ticket_total",
    "txId", "ticket_code", "status", "purpose", "other_details",
    "added_by_admin", "payment_status", "amount_paid",
  ],
  exhibitors: [
    "name", "email", "mobile", "company", "designation",
    "company_type", "role", "ticket_category", "ticket_code",
    "status", "productDetails", "notes",
  ],
  partners: [
    "name", "email", "mobile", "company", "designation",
    "role", "ticket_code", "status", "partnership",
  ],
  speakers: [
    "name", "email", "mobile", "company", "designation",
    "topic", "role", "ticket_code", "status",
  ],
  awardees: [
    "name", "email", "mobile", "company", "designation",
    "award_category", "role", "ticket_code", "status", "bio",
  ],
};

export default function DashboardContent() {
  const [report, setReport] = useState({});
  const [rawReport, setRawReport] = useState({});
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
  const [pendingPremium, setPendingPremium] = useState(false);
  const [newIsPremium, setNewIsPremium] = useState(false);
  const [addRegistrantOpen, setAddRegistrantOpen] = useState(false);
  const [resendLoadingId, setResendLoadingId] = useState(null);
  const mountedRef = useRef(true);

  const [showExportPasswordModal, setShowExportPasswordModal] = useState(false);
  const [exportData, setExportData] = useState(null);

  const apiMap = useRef(
    apiEndpoints.reduce((a, e) => {
      a[e.label.toLowerCase()] = e.url;
      a[e.label.toLowerCase() + "_config"] = e.configUrl;
      return a;
    }, {}),
  );

  const RAW_API_BASE = (typeof window !== "undefined" && (window.__API_BASE__ || "")) || process.env.REACT_APP_API_BASE || "";
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
        if (!configUrl) { out[k] = null; return; }
        try {
          const res = await fetch(buildApiUrl(configUrl));
          out[k] = await res.json().catch(() => null);
        } catch (e) {
          console.warn("fetch config", k, e);
          out[k] = null;
        }
      }),
    );
    if (mountedRef.current) setConfigs(out);
    return out;
  }, [API_BASE]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      await fetchConfigs();
      const results = {}, raws = {};
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
            raws[label.toLowerCase()] = [];
            results[label.toLowerCase()] = [];
          }
        }),
      );
      if (!mountedRef.current) return;
      setRawReport(raws);
      setReport(results);
      setLoading(false);
    } catch (e) {
      setRawReport({});
      setReport({});
      setLoading(false);
    }
  }, [fetchConfigs, API_BASE]);

  useEffect(() => {
    mountedRef.current = true;
    fetchAll();
    return () => { mountedRef.current = false; };
  }, [fetchAll]);

  function flattenForSheet(doc = {}, tableKey) {
    const allowed = CLEAN_EXPORT_FIELDS[tableKey] || [];
    const merged = { ...(doc.data || {}), ...(doc.form || {}), ...doc };
    const out = {};
    for (const field of allowed) {
      let value = merged[field];
      if (value === undefined || value === null) out[field] = "";
      else if (typeof value === "object") {
        try {
          out[field] = JSON.stringify(value);
        } catch {
          out[field] = String(value);
        }
      } else out[field] = value;
    }
    return out;
  }

  const handleExportClick = () => {
    setShowExportPasswordModal(true);
  };

  const confirmExport = () => {
    setShowExportPasswordModal(false);
    performExport();
  };

  const performExport = () => {
    try {
      const wb = XLSX.utils.book_new();
      for (const key of TABLE_KEYS) {
        const arr = rawReport[key] || [];
        const allowed = CLEAN_EXPORT_FIELDS[key] || [];
        if (!arr || arr.length === 0) {
          XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["No records"]]), key.substring(0, 31));
          continue;
        }
        const headers = allowed.slice();
        const headerLabels = headers.map((h) => prettifyKey(h));
        const sheetData = [headerLabels];
        for (const doc of arr) {
          const flat = flattenForSheet(doc, key);
          sheetData.push(headers.map((h) => flat[h] === null || typeof flat[h] === "undefined" ? "" : flat[h]));
        }
        const ws = XLSX.utils.aoa_to_sheet(sheetData);
        ws["!cols"] = headers.map((h) => ({
          wch: Math.max(8, Math.min(40, (prettifyKey(h) || "").length + 6)),
        }));
        XLSX.utils.book_append_sheet(wb, ws, key.substring(0, 31));
      }
      XLSX.writeFile(wb, `railtransexpo_clean_export_${new Date().toISOString().replace(/[:.]/g, "-")}.xlsx`);
      setActionMsg("Export started (clean Excel)");
    } catch (e) {
      console.error("Export error:", e);
      setActionMsg("Export failed");
    }
  };

  // ✅ Separate component for individual search per section with filters
  const SearchableSection = ({
    label,
    data,
    tableKey,
    onResend,
    resendLoadingId,
    sectionProps,
    showSendTicket,
  }) => {
    const [search, setSearch] = useState("");
    const [filterStatus, setFilterStatus] = useState("all");
    
    const filtered = useMemo(() => {
      let result = data;
      if (search.trim()) {
        result = result.filter(row =>
          Object.values(row).some(v =>
            String(v || "").toLowerCase().includes(search.toLowerCase().trim())
          )
        );
      }
      if (tableKey === "visitors" && filterStatus !== "all") {
        result = result.filter(row => {
          if (filterStatus === "free") return !row.ticket_total || row.ticket_total === 0;
          if (filterStatus === "premium_paid") return row.ticket_total > 0 && row.txId;
          if (filterStatus === "premium_free") return row.ticket_total > 0 && (row.added_by_admin === true || row.added_by_admin === "Admin") && !row.txId;
          if (filterStatus === "premium_pending") return row.ticket_total > 0 && !row.txId && row.added_by_admin !== true && row.added_by_admin !== "Admin";
          return true;
        });
      }
      return result;
    }, [data, search, filterStatus, tableKey]);

    return (
      <div>
        <div className="relative mb-2">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder={`Search ${label}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-8 py-1.5 border rounded text-xs outline-none focus:ring-1 focus:ring-blue-300 bg-white"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
          )}
        </div>
        
        {tableKey === "visitors" && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            <button onClick={() => setFilterStatus("all")} className={`px-2.5 py-1 text-xs rounded-full font-medium transition-colors ${filterStatus === "all" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>All</button>
            <button onClick={() => setFilterStatus("free")} className={`px-2.5 py-1 text-xs rounded-full font-medium transition-colors ${filterStatus === "free" ? "bg-green-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>👤 Visitors</button>
            <button onClick={() => setFilterStatus("premium_paid")} className={`px-2.5 py-1 text-xs rounded-full font-medium transition-colors ${filterStatus === "premium_paid" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>🎫 Paid Delegate</button>
            <button onClick={() => setFilterStatus("premium_free")} className={`px-2.5 py-1 text-xs rounded-full font-medium transition-colors ${filterStatus === "premium_free" ? "bg-yellow-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>⭐ Free Delegate</button>
            <button onClick={() => setFilterStatus("premium_pending")} className={`px-2.5 py-1 text-xs rounded-full font-medium transition-colors ${filterStatus === "premium_pending" ? "bg-red-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>⏳ Pending</button>
          </div>
        )}
        
        <DashboardSection
          label={label}
          data={filtered}
          tableKey={tableKey}
          onResend={onResend}
          resendLoadingId={resendLoadingId}
          onAddNew={null}
          PAGE_SIZE={PAGE_SIZE}
          HIDDEN_FIELDS={HIDDEN_FIELDS}
          showSendTicket={showSendTicket}
          {...sectionProps}
        />
      </div>
    );
  };

  function handleEdit(table, displayRow) {
    setEditTable(table);
    setIsCreating(false);
    const raws = rawReport[table] || [];
    let raw = raws.find((r) =>
      ["id", "_id", "ID", "Id"].some((k) => r?.[k] !== undefined && String(r[k]) === String(displayRow[k]))
    );
    if (!raw && displayRow?.email) raw = raws.find((r) => String(r?.email || "").toLowerCase() === String(displayRow.email).toLowerCase());
    if (!raw) raw = displayRow || null;

    function inferFieldFromSample(name, sample, cfgEntry = null) {
      const out = { name, label: prettifyKey(name), type: "text", options: [], required: false, showIf: null };
      if (cfgEntry) {
        out.label = cfgEntry.label || out.label;
        out.type = (cfgEntry.type || out.type).toLowerCase();
        out.options = cfgEntry.options || cfgEntry.choices || [];
        out.required = !!cfgEntry.required;
        out.showIf = cfgEntry.showIf || null;
        return out;
      }
      if (typeof sample === "boolean") out.type = "checkbox";
      else if (typeof sample === "number") out.type = "number";
      else if (Array.isArray(sample)) {
        out.type = "select";
        out.options = sample.map((v) => typeof v === "object" ? (v.value ?? v.label ?? String(v)) : v);
      } else if (typeof sample === "string") out.type = sample.length > 200 ? "textarea" : "text";
      else if (sample && typeof sample === "object") out.type = "text";
      return out;
    }

    let configCols = null;
    try {
      const src = configs[table]?.config?.fields || configs[table]?.fields || null;
      if (Array.isArray(src)) configCols = src.map((c) => ({
        name: c.name || c.key || c.field || c.id,
        label: c.label || c.name || c.key || "",
        type: (c.type || "text").toLowerCase(),
        options: c.options || c.choices || [],
        required: !!c.required,
        showIf: c.showIf || null,
      }));
    } catch {}
    setModalColumns(configCols || Object.keys(raw || {}).filter((k) => k !== "_id").map((k) => inferFieldFromSample(k, raw[k])));
    setEditRow(raw);
    setEditOpen(true);
  }

  async function handleDelete(table, displayRow) {
    const raws = rawReport[table] || [];
    const idVal = displayRow?.id || displayRow?._id || "";
    let raw = raws.find((r) => String(r.id || r._id || "") === String(idVal)) || displayRow;
    setDeleteTable(table);
    setDeleteRow(raw);
    setDeleteOpen(true);
  }

  async function handleDeleteConfirm() {
    if (!deleteTable || !deleteRow) return;
    try {
      const idVal = deleteRow.id || deleteRow._id || "";
      const res = await fetch(buildApiUrl(`${apiMap.current[deleteTable]}/${encodeURIComponent(String(idVal))}`), { method: "DELETE" });
      if (res.ok) {
        setActionMsg(`Deleted from ${deleteTable}`);
        await fetchAll();
      } else {
        const body = await res.text().catch(() => null);
        setActionMsg(`Failed: ${body || res.status}`);
      }
    } catch (e) {
      setActionMsg(`Error: ${e.message}`);
    } finally {
      setDeleteOpen(false);
    }
  }

  async function handleEditSave(updatedRowRaw) {
    if (!editTable) return null;
    const base = apiMap.current[editTable];
    try {
      let url = buildApiUrl(base), method = "POST";
      if (!isCreating) {
        const idVal = updatedRowRaw.id || updatedRowRaw._id || "";
        url = buildApiUrl(`${base}/${encodeURIComponent(String(idVal))}`);
        method = "PUT";
      } else {
        updatedRowRaw.added_by_admin = true;
      }
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(updatedRowRaw) });
      const json = await res.json().catch(() => null);
      if (res.ok) {
        setActionMsg(isCreating ? `Created` : `Updated`);
        setEditOpen(false);
        await fetchAll();
        return json;
      } else {
        setActionMsg(`Failed: ${json?.error || res.status}`);
        return null;
      }
    } catch (e) {
      setActionMsg(`Error: ${e.message}`);
      return null;
    }
  }

  async function handleRefreshRow(table, displayRow) {
    const idVal = displayRow.id || displayRow._id || "";
    try {
      const res = await fetch(buildApiUrl(`${apiMap.current[table]}/${encodeURIComponent(String(idVal))}`));
      if (res.ok) {
        const fresh = await res.json();
        setRawReport((p) => ({
          ...p,
          [table]: (p[table] || []).map((r) => String(r.id || r._id || "") === String(idVal) ? fresh : r),
        }));
        setReport((p) => ({
          ...p,
          [table]: (p[table] || []).map((r) => String(r.id || r._id || "") === String(idVal) ? sanitizeRow(fresh || {}) : r),
        }));
        setActionMsg("Refreshed");
      }
    } catch (e) {
      setActionMsg(`Refresh error: ${e.message}`);
    }
  }

  async function handleResend(table, row) {
    const idVal = row.id || row._id || "";
    if (!idVal) return;
    setResendLoadingId(idVal);
    try {
      let res = await fetch(buildApiUrl(`${apiMap.current[table]}/${encodeURIComponent(String(idVal))}/send-ticket`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
      });
      if (res.status === 404 || res.status === 405) res = await fetch(buildApiUrl(`${apiMap.current[table]}/${encodeURIComponent(String(idVal))}/resend-email`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
      });
      const js = await res.json().catch(() => null);
      if (res.ok) {
        setActionMsg(`Email sent to ${row.email || "recipient"}`);
        handleRefreshRow(table, row);
      } else setActionMsg(`Resend failed: ${js?.error || res.status}`);
    } catch (e) {
      setActionMsg(`Resend error: ${e.message}`);
    } finally {
      setResendLoadingId(null);
    }
  }

  // ✅ DEFINE stats HERE
  const stats = useMemo(
    () => ({
      visitors: (report.visitors || []).length,
      exhibitors: (report.exhibitors || []).length,
      partners: (report.partners || []).length,
      speakers: (report.speakers || []).length,
      awardees: (report.awardees || []).length,
    }),
    [report],
  );

  // ✅ DEFINE sectionProps HERE
  const sectionProps = {
    configs,
    onEdit: handleEdit,
    onDelete: handleDelete,
    onRefreshRow: handleRefreshRow,
    setShowExhibitorManager,
    setShowPartnerManager,
    prettifyKey,
  };

  return (
    <div className="pt-4 pb-6 w-full">
      <div className="w-full mx-auto px-4 md:px-6">
        <div className="top-16 z-20 bg-transparent pb-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">Admin Dashboard</h1>
              <div className="text-sm text-gray-600">Live registration report</div>
            </div>
            <div className="flex items-center gap-3 justify-start md:justify-end">
              <button onClick={fetchAll} className="px-3 py-2 border rounded text-sm bg-white hover:bg-gray-50">Refresh All</button>
              <button onClick={handleExportClick} className="px-3 py-2 border rounded text-sm bg-yellow-50 hover:bg-yellow-100 flex items-center gap-1">🔒 Download Excel</button>
              <button onClick={() => setAddRegistrantOpen(true)} className="px-3 py-2 border rounded text-sm bg-green-50 hover:bg-green-100">Add Registrant</button>
              <div className="text-sm text-gray-500">
                Showing {Object.values(report).reduce((s, arr) => s + arr.length, 0)} records
              </div>
            </div>
          </div>
          <DashboardStats stats={stats} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-4">
          {TABLE_KEYS.map((key) => (
            <SearchableSection
              key={key}
              label={key.charAt(0).toUpperCase() + key.slice(1)}
              data={report[key] || []}
              tableKey={key}
              onResend={(row) => handleResend(key, row)}
              resendLoadingId={resendLoadingId}
              sectionProps={sectionProps}
              showSendTicket={true}
            />
          ))}
        </div>

        {showExportPasswordModal && (
          <PasswordModal
            onConfirm={confirmExport}
            onCancel={() => setShowExportPasswordModal(false)}
            title="🔒 Download Excel Report"
            action="Enter admin password to download the Excel export."
          />
        )}

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
        <AddRegistrantModal
          open={addRegistrantOpen}
          onClose={() => setAddRegistrantOpen(false)}
          apiBase={API_BASE}
          onCreated={async (doc, col) => {
            await fetchAll();
            setActionMsg(`Created in ${col}`);
          }}
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
                <button className="px-3 py-1 border rounded" onClick={() => setShowExhibitorManager(false)}>Close</button>
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
                <button className="px-3 py-1 border rounded" onClick={() => setShowPartnerManager(false)}>Close</button>
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