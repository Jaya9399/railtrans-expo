import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import EditModal from "../components/EditModal";
import Topbar from "../components/Topbar";
import Sidebar from "../components/Sidebar";
import DeleteModal from "../components/DeleteModal";
import AdminExhibitor from "../pages/AdminExhibitor";
import AdminPartner from "../pages/AdminPartner";
import { buildTicketEmail } from "../utils/emailTemplate";

/*
  DashboardContent

  Changes made:
  - Implemented handleEditSave (was missing) — handles create/update flows with basic normalization,
    posts to API, updates local report state, and falls back to refetch when needed.
  - Keeps the delete fix and removal of Upgrade button from previous edit.
  - Adds ngrok header where we POST for consistency.
*/

const apiEndpoints = [
  { label: "Visitors", url: "/api/visitors", configUrl: "/api/visitor-config" },
  { label: "Exhibitors", url: "/api/exhibitors", configUrl: "/api/exhibitor-config" },
  { label: "Partners", url: "/api/partners", configUrl: "/api/partner-config" },
  { label: "Speakers", url: "/api/speakers", configUrl: "/api/speaker-config" },
  { label: "Awardees", url: "/api/awardees", configUrl: "/api/awardee-config" },
];

const HIDDEN_FIELDS = new Set([
  "ticket_code",
  "txId",
  "tx_id",
  "payment_id",
  "payment_status",
  "payment_proof",
  "proof_path",
  "ticket_category",
  "paid",
  "amount",
  "provider_payment_id",
  "payment_txn",
]);

const PAGE_SIZE = 5;

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
    if (v === null || typeof v === "undefined") out[k] = "";
    else if (typeof v === "object") {
      try {
        out[k] = JSON.stringify(v);
      } catch {
        out[k] = String(v);
      }
    } else out[k] = String(v);
  }
  return out;
}

function getColumnsFromRows(rows) {
  const cols = [];
  const seen = new Set();
  for (const r of rows || []) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k);
        cols.push(k);
      }
    }
  }
  return cols;
}

function Pagination({ currentPage, totalPages, onPageChange }) {
  if (!totalPages || totalPages <= 1) return null;
  return (
    <div className="flex items-center space-x-2 mt-2">
      <button
        className="px-2 py-1 border rounded disabled:opacity-50"
        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        disabled={currentPage === 1}
      >
        Prev
      </button>
      {[...Array(totalPages)].map((_, i) => (
        <button
          key={i}
          className={`px-2 py-1 border rounded ${currentPage === i + 1 ? "bg-indigo-100 font-bold" : ""}`}
          onClick={() => onPageChange(i + 1)}
        >
          {i + 1}
        </button>
      ))}
      <button
        className="px-2 py-1 border rounded disabled:opacity-50"
        onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
        disabled={currentPage === totalPages}
      >
        Next
      </button>
    </div>
  );
}

/* Actions menu */
function ActionsMenu({ onEdit, onDelete, onRefresh }) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef();
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        className="text-gray-600 hover:bg-gray-100 rounded-full p-2"
        onClick={() => setOpen((v) => !v)}
        style={{ minWidth: 32 }}
        tabIndex={0}
      >
        <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="4" cy="10" r="2" />
          <circle cx="10" cy="10" r="2" />
          <circle cx="16" cy="10" r="2" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-10 right-0 mt-2 bg-white border shadow-lg rounded-lg w-44">
          <button className="block w-full text-left px-4 py-2 hover:bg-indigo-50 text-indigo-700 font-semibold" onClick={() => { setOpen(false); onEdit(); }}>
            Update
          </button>
          <button className="block w-full text-left px-4 py-2 hover:bg-gray-50 text-gray-700 font-medium" onClick={() => { setOpen(false); onRefresh(); }}>
            Refresh
          </button>
          <button className="block w-full text-left px-4 py-2 hover:bg-red-50 text-red-700 font-semibold" onClick={() => { setOpen(false); onDelete(); }}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

/* Registration cache helpers (localStorage) */
const REG_CACHE_PREFIX = "registration_cache";
function writeRegistrationCache(entity, id, data) {
  try {
    if (!entity || !id || !data) return;
    const key = `${REG_CACHE_PREFIX}_${entity}_${id}`;
    localStorage.setItem(key, JSON.stringify(data));
    try {
      window.dispatchEvent(new CustomEvent("registration-updated", { detail: { entity, id: String(id), data } }));
    } catch (e) { /* ignore */ }
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: "registration", entity, data }, "*");
      }
    } catch (e) { /* ignore */ }
  } catch (e) {
    console.warn("writeRegistrationCache failed", e);
  }
}
function readRegistrationCache(entity, id) {
  try {
    if (!entity || !id) return null;
    const key = `${REG_CACHE_PREFIX}_${entity}_${id}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export default function DashboardContent() {
  const navigate = useNavigate();
  const location = useLocation();

  const [report, setReport] = useState({});
  const [configs, setConfigs] = useState({});
  const [loading, setLoading] = useState(true);
  const [pageState, setPageState] = useState({});
  const [editOpen, setEditOpen] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [modalColumns, setModalColumns] = useState([]);
  const [editTable, setEditTable] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTable, setDeleteTable] = useState("");
  const [deleteRow, setDeleteRow] = useState(null);
  const [actionMsg, setActionMsg] = useState("");

  const [pendingPremium, setPendingPremium] = useState(null);
  const [showExhibitorManager, setShowExhibitorManager] = useState(false);
  const [showPartnerManager, setShowPartnerManager] = useState(false);

  const mountedRef = useRef(true);
  const autoGenRef = useRef(false);
  const apiMap = useRef(apiEndpoints.reduce((a, e) => {
    a[e.label.toLowerCase()] = e.url;
    a[e.label.toLowerCase() + "_config"] = e.configUrl;
    return a;
  }, {}));

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
        const res = await fetch(configUrl);
        out[k] = await res.json().catch(() => null);
      } catch (e) {
        console.warn("fetch config", k, e);
        out[k] = null;
      }
    }));
    if (mountedRef.current) setConfigs(out);
    return out;
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      await fetchConfigs();
      const results = {};
      await Promise.all(apiEndpoints.map(async ({ label, url }) => {
        try {
          const res = await fetch(url);
          let j = await res.json().catch(() => null);
          if (Array.isArray(j) && j.length === 2 && Array.isArray(j[0])) j = j[0];
          if (j && typeof j === "object" && !Array.isArray(j)) j = j.data || j.rows || j;
          const rows = normalizeData(j).map(sanitizeRow);
          results[label.toLowerCase()] = rows;
        } catch (e) {
          console.warn("fetch data", label, e);
          results[label.toLowerCase()] = [];
        }
      }));
      if (!mountedRef.current) return;
      setReport(results);
      setLoading(false);
      setPageState((prev) => {
        const next = { ...prev };
        apiEndpoints.forEach((e) => {
          const k = e.label.toLowerCase();
          if (!next[k]) next[k] = 1;
        });
        return next;
      });
    } catch (e) {
      console.error(e);
      setReport({});
      setLoading(false);
    }
  }, [fetchConfigs]);

  useEffect(() => {
    mountedRef.current = true;
    fetchAll();
    return () => { mountedRef.current = false; };
  }, [fetchAll]);

  // Listen for single-row updates (registration-updated & postMessage)
  useEffect(() => {
    function onRegistrationUpdated(e) {
      try {
        const detail = e && e.detail ? e.detail : null;
        if (!detail) return;
        const { entity, id, data } = detail;
        if (String(entity).toLowerCase() !== "visitors") return;
        setReport((prev) => {
          if (!prev || !prev.visitors) return prev;
          return { ...prev, visitors: (prev.visitors || []).map((r) => (String(r.id) === String(id) ? sanitizeRow(data) : r)) };
        });
      } catch (err) { /* ignore */ }
    }

    function onMessage(e) {
      try {
        const d = e && e.data ? e.data : null;
        if (!d || d.type !== "registration") return;
        const { entity, data } = d;
        if (String(entity).toLowerCase() !== "visitors") return;
        const id = data && (data.id || data._id) ? (data.id || data._id) : null;
        if (!id) return;
        setReport((prev) => {
          if (!prev || !prev.visitors) return prev;
          return { ...prev, visitors: (prev.visitors || []).map((r) => (String(r.id) === String(id) ? sanitizeRow(data) : r)) };
        });
      } catch (err) { /* ignore */ }
    }

    window.addEventListener("registration-updated", onRegistrationUpdated);
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("registration-updated", onRegistrationUpdated);
      window.removeEventListener("message", onMessage);
    };
  }, []);

  const normalizeMetaFromConfig = (cfg = {}) =>
    Array.isArray(cfg.fields) ? cfg.fields.map((f) => ({
      name: f.name,
      label: f.label || f.name,
      type: f.type || "text",
      options: f.options || [],
      required: !!f.required,
      showIf: f.showIf || null,
    })).filter((x) => x.name && !HIDDEN_FIELDS.has(x.name)) : [];

  const normalizeMetaFromRowKeys = (keys = []) =>
    keys.filter((k) => k && !HIDDEN_FIELDS.has(k)).map((k) => ({ name: k, label: k.replace(/_/g, " "), type: "text" }));

  const handleEdit = useCallback((table, row) => {
    const key = table.toLowerCase();
    const cfg = configs[key];
    let meta = [];
    if (cfg && Array.isArray(cfg.fields) && cfg.fields.length) meta = normalizeMetaFromConfig(cfg);
    else {
      const rows = Array.isArray(report[key]) ? report[key] : [];
      const cols = rows.length ? getColumnsFromRows(rows) : Object.keys(row || {});
      meta = normalizeMetaFromRowKeys(cols);
    }
    if (meta.some((m) => m.name === "id")) meta = [{ name: "id", label: "Id", type: "text", required: false }, ...meta.filter((m) => m.name !== "id")];
    setModalColumns(meta);
    const prepared = {};
    meta.forEach((f) => (prepared[f.name] = row && f.name in row ? row[f.name] : ""));
    setEditTable(key);
    setEditRow(prepared);
    setIsCreating(false);
    autoGenRef.current = false;
    setEditOpen(true);
  }, [configs, report]);

  const handleAddNew = useCallback((table) => {
    const key = table.toLowerCase();
    const cfg = configs[key];
    let meta = [];
    if (cfg && Array.isArray(cfg.fields) && cfg.fields.length) {
      meta = normalizeMetaFromConfig(cfg);
      meta.sort((a, b) => (b.required === true) - (a.required === true));
    } else {
      const defaults = {
        visitors: [
          { name: "name", label: "Name", type: "text", required: true },
          { name: "email", label: "Email", type: "email", required: true },
          { name: "mobile", label: "Mobile", type: "text" },
        ],
      };
      meta = defaults[key] || [{ name: "name", label: "Name", type: "text", required: true }, { name: "email", label: "Email", type: "email" }];
    }
    meta = meta.filter((m) => m.name && !HIDDEN_FIELDS.has(m.name));
    setModalColumns(meta);
    const empty = {};
    meta.forEach((f) => (empty[f.name] = ""));
    setEditTable(key);
    setEditRow(empty);
    setIsCreating(true);
    setEditOpen(true);
  }, [configs]);

  const handleDelete = useCallback((table, row) => {
    setDeleteTable(table.toLowerCase());
    setDeleteRow(row);
    setDeleteOpen(true);
  }, []);

  // Fix: handleDeleteConfirm resolves id robustly and uses ngrok header
  const handleDeleteConfirm = useCallback(async () => {
    setActionMsg(""); setDeleteOpen(false);
    if (!deleteTable || !deleteRow) return;
    try {
      const base = apiMap.current[deleteTable];
      if (!base) { setActionMsg("Unknown table"); return; }

      // Resolve id from multiple possible fields
      let id = deleteRow.id || deleteRow._id || deleteRow.ID || deleteRow.Id || "";
      if (!id && deleteRow._id && typeof deleteRow._id === "object") {
        id = deleteRow._id.$oid || deleteRow._id.toString() || "";
      }
      if (!id) {
        for (const k of Object.keys(deleteRow || {})) {
          if (/id$/i.test(k) && deleteRow[k]) { id = deleteRow[k]; break; }
        }
      }
      if (!id) { setActionMsg("Delete failed: no id found"); return; }

      const res = await fetch(`${base}/${encodeURIComponent(String(id))}`, { method: "DELETE", headers: { "ngrok-skip-browser-warning": "69420" } });
      let data = null;
      try { data = await res.json().catch(() => null); } catch {}
      if (res.ok && (data === null || data.success !== false)) {
        setReport((prev) => {
          const copy = { ...(prev || {}) };
          copy[deleteTable] = (copy[deleteTable] || []).filter((r) => {
            const rId = r.id || r._id || (r._id && (typeof r._id === "object" ? r._id.$oid : undefined)) || "";
            return String(rId) !== String(id);
          });
          return copy;
        });
        setActionMsg("Deleted");
      } else {
        setActionMsg(`Delete failed: ${JSON.stringify(data)}`);
      }
    } catch (e) {
      console.error(e);
      setActionMsg("Delete failed");
    } finally {
      setDeleteRow(null); setDeleteTable("");
    }
  }, [deleteRow, deleteTable]);

  const handleRefreshRow = useCallback(async (tableKey, row) => {
    if (!row?.id) { setActionMsg("Cannot refresh"); return; }
    try {
      const res = await fetch(`${apiMap.current[tableKey]}/${encodeURIComponent(String(row.id))}`);
      if (!res.ok) { setActionMsg("Failed to fetch row"); return; }
      const json = await res.json().catch(() => null);
      const sanitized = sanitizeRow(json || {});
      setReport((prev) => ({ ...prev, [tableKey]: (prev[tableKey] || []).map((r) => String(r.id) === String(row.id) ? sanitized : r) }));
      setActionMsg("Refreshed");
    } catch (e) {
      console.error(e);
      setActionMsg("Refresh failed");
    }
  }, []);

  const tryGenerateEndpoint = useCallback(async (base, id, premium = false) => {
    const candidates = [
      `${base}/${encodeURIComponent(String(id))}/generate-ticket${premium ? "?premium=1" : ""}`,
      `${base}/${encodeURIComponent(String(id))}/generate${premium ? "?premium=1" : ""}`,
      `${base}/generate-ticket/${encodeURIComponent(String(id))}${premium ? "?premium=1" : ""}`,
      `${base}/generate/${encodeURIComponent(String(id))}${premium ? "?premium=1" : ""}`,
      `${base}/${encodeURIComponent(String(id))}/ticket${premium ? "?premium=1" : ""}`,
    ];
    for (const url of candidates) {
      try {
        const res = await fetch(url, { method: "POST" });
        const bodyText = await res.text().catch(() => "");
        let body; try { body = JSON.parse(bodyText); } catch { body = bodyText; }
        if (res.ok) return { ok: true, url, body };
      } catch (e) {
        // try next
      }
    }
    return { ok: false, message: "No generate endpoint matched (404 or failed)" };
  }, []);

  const generateAndEmailTicket = useCallback(async ({ tableKey, id, premium = false }) => {
    if (!tableKey || !id) { setActionMsg("Missing table or id"); return { ok: false }; }
    const base = apiMap.current[tableKey];
    if (!base) { setActionMsg("Unknown table"); return { ok: false }; }

    setActionMsg("Generating ticket...");
    const gen = await tryGenerateEndpoint(base, id, !!premium);
    let genResult = gen;
    let refreshed = null;

    try {
      const r = await fetch(`${base}/${encodeURIComponent(String(id))}`);
      if (r.ok) {
        const js = await r.json().catch(() => null);
        refreshed = sanitizeRow(js || {});
      }
    } catch (e) { /* ignore */ }

    if (!gen.ok) {
      setActionMsg("No generate endpoint — creating ticket locally as fallback...");
      const existingTicket = refreshed && (refreshed.ticket_code || refreshed.ticketCode || refreshed.code) ? (refreshed.ticket_code || refreshed.ticketCode || refreshed.code) : null;
      const ticket_code = existingTicket || String(Math.floor(100000 + Math.random() * 900000));
      try {
        await fetch("/api/tickets/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" , "ngrok-skip-browser-warning": "69420" },
          body: JSON.stringify({
            ticket_code,
            entity_type: tableKey === "exhibitors" ? "exhibitor" : tableKey === "partners" ? "partner" : tableKey.slice(0, -1),
            entity_id: id,
            name: (refreshed && (refreshed.name || refreshed.company)) || "",
            email: (refreshed && (refreshed.email || refreshed.email_address)) || "",
            company: (refreshed && (refreshed.company || refreshed.organization)) || "",
            category: (refreshed && refreshed.ticket_category) || "",
            meta: { createdFrom: "admin-dashboard-fallback" }
          })
        }).catch(() => {});
      } catch (e) {
        console.warn("fallback ticket create failed", e);
      }

      try {
        const confirmUrl = `${base}/${encodeURIComponent(String(id))}/confirm`;
        const r1 = await fetch(confirmUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket_code }) }).catch(() => null);
        if (!r1 || !r1.ok) {
          await fetch(`${base}/${encodeURIComponent(String(id))}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket_code }) }).catch(() => null);
        }
      } catch (e) {
        console.warn("fallback update ticket_code failed", e);
      }

      try {
        const r2 = await fetch(`${base}/${encodeURIComponent(String(id))}`);
        if (r2.ok) {
          const js2 = await r2.json().catch(() => null);
          refreshed = sanitizeRow(js2 || {});
        }
      } catch (e) {}
      genResult = { ok: false, fallback: true, ticket_code: ticket_code };
    }

    const ticket_code_final = (genResult && (genResult.body && (genResult.body.ticket_code || genResult.body.code || genResult.body.ticketCode))) || (refreshed && (refreshed.ticket_code || refreshed.ticketCode)) || (genResult && genResult.ticket_code) || "";
    const email = (refreshed && (refreshed.email || refreshed.email_address || refreshed.contactEmail)) || (genResult && genResult.body && (genResult.body.email || genResult.body.email_address)) || "";
    const name = (refreshed && (refreshed.name || refreshed.company)) || "";

    if (email && typeof buildTicketEmail === "function") {
      setActionMsg(`Sending ticket to ${email}...`);
      const frontendBase = (typeof window !== "undefined" && (window.__FRONTEND_BASE__ || window.location.origin)) || "";
      const bannerUrl = (configs && configs[tableKey] && Array.isArray(configs[tableKey].images) && configs[tableKey].images.length) ? configs[tableKey].images[0] : "";
      const model = {
        frontendBase,
        entity: tableKey,
        id,
        name,
        company: (refreshed && (refreshed.company || refreshed.organization)) || "",
        ticket_code: ticket_code_final,
        ticket_category: (refreshed && refreshed.ticket_category) || "",
        bannerUrl,
        badgePreviewUrl: "",
        downloadUrl: "",
        event: (configs && configs[tableKey] && configs[tableKey].eventDetails) || {}
      };
      try {
        const { subject, text, html } = buildTicketEmail(model);
        const mailRes = await fetch("/api/mailer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: email, subject, text, html }) });
        if (!mailRes.ok) {
          const err = await parseErrorBody(mailRes);
          setActionMsg(`Ticket created but emailing failed: ${JSON.stringify(err)}`);
          return { ok: true, generated: true, emailed: false, err };
        }
        setActionMsg("Ticket generated and emailed");
        return { ok: true, generated: true, emailed: true };
      } catch (e) {
        console.error("templated email send failed", e);
        setActionMsg("Ticket generated but email failed");
        return { ok: true, generated: true, emailed: false, err: String(e) };
      }
    } else {
      setActionMsg("Ticket generated (no email found)");
      return { ok: true, generated: true, emailed: false };
    }
  }, [configs, fetchAll, parseErrorBody, tryGenerateEndpoint]);

  const handleGeneratePremium = useCallback(async () => {
    if (!pendingPremium) { setActionMsg("Nothing to generate"); return; }
    const { table, id } = pendingPremium;
    await generateAndEmailTicket({ tableKey: table, id, premium: true });
    setPendingPremium(null);
  }, [pendingPremium, generateAndEmailTicket]);

  const handleGenerateSkip = useCallback(() => { setPendingPremium(null); setActionMsg("Generation skipped"); }, []);

  const handleGenerateTicket = useCallback(async (tableKey, row) => {
    if (!row?.id) { setActionMsg("Missing id"); return; }
    await generateAndEmailTicket({ tableKey, id: row.id, premium: false });
  }, [generateAndEmailTicket]);

  const handleSidebarSelect = useCallback((pathOrLabel) => {
    if (typeof pathOrLabel !== "string") return;
    if (pathOrLabel.startsWith("/")) { navigate(pathOrLabel); return; }
    const map = { Dashboard: "/", Visitors: "/visitors", Exhibitors: "/exhibitors", Partners: "/partners", Speakers: "/speakers", Awardees: "/awardees" };
    if (map[pathOrLabel]) navigate(map[pathOrLabel]);
  }, [navigate]);

  const shouldShowGenerateForRow = (tableKey, row) => !!(pendingPremium && pendingPremium.table === tableKey && String(pendingPremium.id) === String(row?.id));

  // ---------- NEW: handleEditSave implementation (was missing) ----------
  const handleEditSave = useCallback(async (edited) => {
    setActionMsg("");
    setEditOpen(false);
    try {
      const base = apiMap.current[editTable];
      if (!base) { setActionMsg("Unknown table"); return; }

      // basic normalization before sending
      function normalizeForServer(obj = {}) {
        const p = { ...obj };
        // coalesce company fields
        const companyCandidates = [p.companyName, p.company, p.company_name, p.companyName?.value, p.company?.value, p["Company Name"]];
        const company = (companyCandidates.find((v) => typeof v !== "undefined" && v !== null && String(v).trim() !== "") || "").toString().trim();
        if (company) { p.companyName = company; p.company = p.company || company; p.company_name = p.company_name || company; }
        // normalize email
        const emailCandidates = [p.email, p.emailAddress, p.email_address, p.contactEmail, p.mail];
        const email = (emailCandidates.find((v) => typeof v === "string" && v.trim() && /\S+@\S+\.\S+/.test(v)) || "").toString().trim();
        if (email) p.email = email;
        if (typeof p.terms === "string") p.terms = p.terms === "1" || p.terms === "true" || p.terms === "on";
        return p;
      }

      if (isCreating) {
        const payload = normalizeForServer(edited);
        const res = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" }, body: JSON.stringify(payload) });
        if (res.ok) {
          const data = await res.json().catch(() => null);
          setActionMsg("Created");
          const id = data?.insertedId || data?.insertId || data?.id;
          if (id) {
            const r = await fetch(`${base}/${encodeURIComponent(String(id))}`);
            const newRowRaw = (await r.json().catch(() => null)) || {};
            const newRow = sanitizeRow(newRowRaw);
            setReport((prev) => ({ ...prev, [editTable]: [newRow, ...(prev[editTable] || [])] }));
            const email = newRow.email || newRow.email_address || newRow.contact || newRow.emailAddress || "";
            setPendingPremium({ table: editTable, id: String(id), email });
          } else {
            await fetchAll();
          }
        } else {
          const body = await parseErrorBody(res);
          const message = typeof body === "string" ? body : body?.message || body?.error || JSON.stringify(body);
          setActionMsg(`Create failed: ${message} (status ${res.status})`);
        }
      } else {
        const payload = normalizeForServer(edited);
        const id = edited.id || edited._id;
        if (!id) {
          setActionMsg("Missing id for update");
          return;
        }
        const res = await fetch(`${base}/${encodeURIComponent(String(id))}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (res.ok) {
          const r = await fetch(`${base}/${encodeURIComponent(String(id))}`);
          const updated = sanitizeRow((await r.json().catch(() => null)) || {});
          setReport((prev) => ({ ...prev, [editTable]: (prev[editTable] || []).map((x) => String(x.id) === String(id) ? updated : x) }));
          setActionMsg("Updated");
        } else {
          const body = await parseErrorBody(res);
          const message = typeof body === "string" ? body : body?.message || body?.error || JSON.stringify(body);
          setActionMsg(`Update failed: ${message} (status ${res.status})`);
        }
      }
    } catch (e) {
      console.error(e);
      setActionMsg("Save failed: " + (e.message || e));
    } finally {
      setIsCreating(false);
      autoGenRef.current = false;
      fetchAll();
    }
  }, [editTable, isCreating, fetchAll, parseErrorBody]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Topbar />
      <div className="flex max-w-full">
        <div className="w-64 hidden md:block">
          <Sidebar selected={location.pathname} onSelect={handleSidebarSelect} />
        </div>

        <main className="flex-1 p-4 sm:p-8 overflow-auto" style={{ maxHeight: "calc(100vh - 80px)" }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold">Admin Dashboard</h1>
              <div className="text-sm text-gray-600">Live registration report</div>
            </div>
            <div className="flex gap-2">
              <button className="px-3 py-1 bg-gray-100 rounded" onClick={fetchAll}>Refresh</button>
              <button className="px-3 py-1 bg-gray-100 rounded" onClick={fetchConfigs}>Reload Configs</button>
            </div>
          </div>

          {actionMsg && <div className="mb-4 text-green-700 break-words">{actionMsg}</div>}

          {pendingPremium && (
            <div className="mb-4 p-4 bg-yellow-50 border-l-4 border-yellow-400 rounded">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">Generate Premium Ticket</div>
                  <div className="text-sm text-gray-700">A new record was created. Click below to generate a premium ticket and (optionally) email it to {pendingPremium.email || "the user"}.</div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={handleGeneratePremium} className="px-3 py-1 bg-indigo-600 text-white rounded">Generate & Email</button>
                  <button onClick={handleGenerateSkip} className="px-3 py-1 border rounded">Skip</button>
                </div>
              </div>
            </div>
          )}

          <EditModal open={editOpen} onClose={() => setEditOpen(false)} row={editRow} columns={modalColumns} onSave={handleEditSave} isNew={isCreating} table="exhibitors" />
          {deleteOpen && <DeleteModal open={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDeleteConfirm} title="Delete record" message={`Delete "${deleteRow?.name || deleteRow?.id}"?`} confirmLabel="Delete" cancelLabel="Cancel" />}

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

          {loading ? (
            <div className="text-gray-500">Loading...</div>
          ) : (
            apiEndpoints.map(({ label }) => {
              const key = label.toLowerCase();
              const rows = report[key] || [];
              const current = pageState[key] || 1;
              const total = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
              const shown = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
              const cols = getColumnsFromRows(rows).filter((c) => !HIDDEN_FIELDS.has(c));

              return (
                <section key={label} className="mb-10">
                  <div className="flex justify-between items-center mb-2">
                    <h2 className="text-xl font-bold">{label} ({rows.length})</h2>
                    <div>
                      <button onClick={() => handleAddNew(label)} className="px-3 py-1 border rounded mr-2">Add New</button>

                      {label === "Exhibitors" && (
                        <button onClick={() => setShowExhibitorManager(true)} className="px-3 py-1 bg-indigo-600 text-white rounded mr-2">Manage Exhibitors</button>
                      )}

                      {label === "Partners" && (
                        <button onClick={() => setShowPartnerManager(true)} className="px-3 py-1 bg-indigo-600 text-white rounded">Manage Partners</button>
                      )}
                    </div>
                  </div>

                  {rows.length === 0 ? (
                    <div className="text-gray-500">No {key}</div>
                  ) : (
                    <div className="bg-white rounded shadow-sm overflow-auto" style={{ maxHeight: "48vh" }}>
                      <table className="min-w-full w-full table-auto border-collapse hidden md:table">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            {cols.map((c) => <th key={c} className="border px-3 py-2 text-left">{c}</th>)}
                            <th className="border px-3 py-2">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shown.map((r, idx) => (
                            <tr key={r.id ?? idx} className="hover:bg-gray-50">
                              {cols.map((c) => <td key={c} className="border px-3 py-2 align-top whitespace-pre-wrap">{r[c] ?? ""}</td>)}
                              <td className="border px-3 py-2">
                                <div className="flex gap-2 items-center">
                                  <ActionsMenu onEdit={() => handleEdit(label, r)} onDelete={() => handleDelete(label, r)} onRefresh={() => handleRefreshRow(key, r)} />
                                  {shouldShowGenerateForRow(key, r) && <button onClick={() => handleGenerateTicket(key, r)} className="px-2 py-1 text-sm bg-yellow-100 rounded">Generate</button>}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {/* Mobile: card list view */}
                      <div className="md:hidden space-y-3 p-3">
                        {shown.map((r, idx) => {
                          const previewCols = cols.slice(0, 3);
                          return (
                            <div key={r.id ?? idx} className="bg-white border rounded p-3 shadow-sm">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1">
                                  <div className="flex items-center justify-between">
                                    <div className="font-medium">{r.name || r.title || r.id || `#${r.id ?? idx}`}</div>
                                    <div className="text-sm text-gray-500">{r.id ? `ID: ${r.id}` : null}</div>
                                  </div>
                                  <div className="mt-2 text-sm text-gray-700 space-y-1">
                                    {previewCols.map((c) => (
                                      <div key={c}>
                                        <span className="font-semibold mr-2">{c}:</span>
                                        <span className="break-words">{String(r[c] ?? "")}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>

                              <div className="mt-3 flex gap-2 flex-wrap">
                                <button onClick={() => handleEdit(label, r)} className="px-3 py-1 border rounded text-sm">Edit</button>
                                <button onClick={() => handleRefreshRow(key, r)} className="px-3 py-1 border rounded text-sm">Refresh</button>

                                {shouldShowGenerateForRow(key, r) && <button onClick={() => handleGenerateTicket(key, r)} className="px-3 py-1 bg-yellow-100 rounded text-sm">Generate</button>}
                                <button onClick={() => { setDeleteTable(key); setDeleteRow(r); setDeleteOpen(true); }} className="px-3 py-1 border rounded text-sm text-red-600">Delete</button>
                              </div>
                            </div>
                          );
                        })}
                        <div className="pt-2">
                          <Pagination currentPage={pageState[key] || 1} totalPages={Math.max(1, Math.ceil(rows.length / PAGE_SIZE))} onPageChange={(pg) => setPageState((prev) => ({ ...prev, [key]: pg }))} />
                        </div>
                      </div>

                      <div className="p-3 hidden md:block">
                        <Pagination currentPage={pageState[key] || 1} totalPages={Math.max(1, Math.ceil(rows.length / PAGE_SIZE))} onPageChange={(pg) => setPageState((prev) => ({ ...prev, [key]: pg }))} />
                      </div>
                    </div>
                  )}
                </section>
              );
            })
          )}
        </main>
      </div>
    </div>
  );
}