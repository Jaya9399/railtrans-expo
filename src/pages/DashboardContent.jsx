import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import EditModal from "../components/EditModal";
import DeleteModal from "../components/DeleteModal";
import AdminExhibitor from "../pages/AdminExhibitor";
import AdminPartner from "../pages/AdminPartner";
import { buildTicketEmail } from "../utils/emailTemplate";

/* ---------- helpers ---------- */
const apiEndpoints = [
  { label: "Visitors", url: "/api/visitors", configUrl: "/api/visitor-config" },
  { label: "Exhibitors", url: "/api/exhibitors", configUrl: "/api/exhibitor-config" },
  { label: "Partners", url: "/api/partners", configUrl: "/api/partner-config" },
  { label: "Speakers", url: "/api/speakers", configUrl: "/api/speaker-config" },
  { label: "Awardees", url: "/api/awardees", configUrl: "/api/awardee-config" },
];
const TABLE_KEYS = ["visitors", "exhibitors", "partners", "speakers", "awardees"];

// DO NOT hide any fields — keep the hidden set empty
const HIDDEN_FIELDS = new Set([]);

const PAGE_SIZE = 5;

function normalizeData(d) { if (Array.isArray(d)) return d; if (d && typeof d === "object") return [d]; return []; }
function sanitizeRow(row) {
  if (!row || typeof row !== "object") return {};
  const out = {};
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (v === null || typeof v === "undefined") out[k] = "";
    else if (typeof v === "object") {
      try { out[k] = JSON.stringify(v); } catch { out[k] = String(v); }
    } else out[k] = String(v);
  }
  return out;
}
function getColumnsFromRows(rows) {
  const cols = []; const seen = new Set();
  for (const r of rows || []) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
  return cols;
}

/* ---------- small components ---------- */
function Pagination({ currentPage, totalPages, onPageChange }) {
  if (!totalPages || totalPages <= 1) return null;
  return (
    <div className="flex items-center space-x-2 mt-3">
      <button className="px-2 py-1 border rounded disabled:opacity-50" onClick={() => onPageChange(Math.max(1, currentPage - 1))} disabled={currentPage === 1}>Prev</button>
      {[...Array(totalPages)].map((_, i) => (
        <button key={i} className={`px-2 py-1 border rounded ${currentPage === i + 1 ? "bg-indigo-100 font-bold" : ""}`} onClick={() => onPageChange(i + 1)}>{i + 1}</button>
      ))}
      <button className="px-2 py-1 border rounded disabled:opacity-50" onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages}>Next</button>
    </div>
  );
}
function ActionsMenu({ onEdit, onDelete, onRefresh }) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef();
  useEffect(() => {
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button className="text-gray-600 hover:bg-gray-100 rounded-full p-2" onClick={() => setOpen(v => !v)} style={{ minWidth: 32 }}>
        <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="4" cy="10" r="2" /><circle cx="10" cy="10" r="2" /><circle cx="16" cy="10" r="2" /></svg>
      </button>
      {open && (
        <div className="absolute z-10 right-0 mt-2 bg-white border shadow-lg rounded-lg w-44">
          <button className="block w-full text-left px-4 py-2 hover:bg-indigo-50 text-indigo-700 font-semibold" onClick={() => { setOpen(false); onEdit(); }}>Edit</button>
          <button className="block w-full text-left px-4 py-2 hover:bg-gray-50 text-gray-700 font-medium" onClick={() => { setOpen(false); onRefresh(); }}>Refresh</button>
          <button className="block w-full text-left px-4 py-2 hover:bg-red-50 text-red-700 font-semibold" onClick={() => { setOpen(false); onDelete(); }}>Delete</button>
        </div>
      )}
    </div>
  );
}

/* ---------- DashboardContent ---------- */
export default function DashboardContent() {
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
  const [showExhibitorManager, setShowExhibitorManager] = useState(false);
  const [showPartnerManager, setShowPartnerManager] = useState(false);
  const [pendingPremium, setPendingPremium] = useState(null); // {table, id, email, premium}
  const [newIsPremium, setNewIsPremium] = useState(false); // flag set when clicking Add New

  const mountedRef = useRef(true);
  const apiMap = useRef(apiEndpoints.reduce((a, e) => { a[e.label.toLowerCase()] = e.url; a[e.label.toLowerCase() + "_config"] = e.configUrl; return a; }, {}));

  // Build API base from window.__API_BASE__ or env var (REACT_APP_API_BASE). If empty, fallback to relative paths.
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
  }, [API_BASE]); // API_BASE included by closure

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      await fetchConfigs();
      const results = {};
      await Promise.all(apiEndpoints.map(async ({ label, url }) => {
        try {
          const res = await fetch(buildApiUrl(url));
          let j = await res.json().catch(() => null);
          // Some APIs return [rows, count] in older adapters; normalize.
          if (Array.isArray(j) && j.length === 2 && Array.isArray(j[0])) j = j[0];
          if (j && typeof j === "object" && !Array.isArray(j)) j = j.data || j.rows || j;
          results[label.toLowerCase()] = normalizeData(j).map(sanitizeRow);
        } catch (e) { console.warn("fetch data", label, e); results[label.toLowerCase()] = []; }
      }));
      if (!mountedRef.current) return;
      setReport(results);
      setLoading(false);
      setPageState(prev => { const next = { ...prev }; TABLE_KEYS.forEach((k) => { if (!next[k]) next[k] = 1; }); return next; });
    } catch (e) { console.error(e); setReport({}); setLoading(false); }
  }, [fetchConfigs, API_BASE]);

  useEffect(() => { mountedRef.current = true; fetchAll(); return () => { mountedRef.current = false; }; }, [fetchAll]);

  useEffect(() => {
    setPageState(prev => {
      let changed = false;
      const next = { ...prev };
      TABLE_KEYS.forEach(k => {
        const len = (report[k] || []).length;
        const max = Math.max(1, Math.ceil(len / PAGE_SIZE));
        const cur = Number(prev[k] || 1);
        if (cur > max) { next[k] = 1; changed = true; }
      });
      return changed ? next : prev;
    });
  }, [report]);

  // Helper to determine public frontend base (prefer explicit window overrides or origin)
  function getFrontendBase() {
    try {
      if (typeof window !== "undefined") {
        if (window.__FRONTEND_BASE__) return String(window.__FRONTEND_BASE__).replace(/\/$/, "");
        if (window.__API_BASE__) return String(window.__API_BASE__).replace(/\/$/, "");
        if (window.location && window.location.origin) return String(window.location.origin).replace(/\/$/, "");
      }
      if (typeof process !== "undefined" && process.env) {
        return (process.env.REACT_APP_API_BASE_URL || process.env.PUBLIC_BASE_URL || process.env.REACT_APP_API_BASE || "").replace(/\/$/, "");
      }
    } catch (e) {}
    return "";
  }

  // Helper: detect image attachments (contentType or filename)
  function isImageAttachmentMeta(a = {}) {
    const ct = String(a.contentType || a.content_type || a.type || "").toLowerCase();
    if (ct && ct.startsWith("image/")) return true;
    const fn = String(a.filename || a.name || a.path || "").toLowerCase();
    if (fn.endsWith(".png") || fn.endsWith(".jpg") || fn.endsWith(".jpeg") || fn.endsWith(".gif") || fn.endsWith(".webp") || fn.endsWith(".svg")) return true;
    return false;
  }

  // NEW HELPERS: robust email extraction (deep search)
  function isEmailLike(v) {
    return typeof v === "string" && /\S+@\S+\.\S+/.test(v);
  }
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
    // common keys
    const keys = ["email", "email_address", "emailAddress", "contactEmail", "contact", "visitorEmail", "user_email", "primaryEmail"];
    for (const k of keys) {
      try {
        if (Object.prototype.hasOwnProperty.call(obj, k)) {
          const v = obj[k];
          if (isEmailLike(v)) return v.trim();
        }
      } catch (e) {}
    }
    // if obj has nested 'data' or 'row', try them
    if (obj.data && typeof obj.data === "object") {
      const e = extractEmailFromObject(obj.data);
      if (e) return e;
    }
    if (obj.row && typeof obj.row === "object") {
      const e = extractEmailFromObject(obj.row);
      if (e) return e;
    }
    // deep search
    return findEmailDeep(obj);
  }

  // --- send templated email using buildTicketEmail; ensure frontendBase is set, and strip image attachments
  const sendTemplatedEmail = useCallback(async ({ entity, id, row, premium = false }) => {
    try {
      // Use robust email extraction
      const email = extractEmailFromObject(row);
      if (!email) {
        console.warn("[sendTemplatedEmail] no recipient email for", entity, id, "row:", row);
        return { ok: false };
      }

      if (typeof buildTicketEmail !== "function") {
        console.warn("[sendTemplatedEmail] no buildTicketEmail");
        return { ok: false, reason: "no-builder" };
      }

      // Choose a reliable frontendBase so template resolves relative uploads to public host
      const frontendBase = getFrontendBase();
      const bannerUrl = (configs && configs[entity] && Array.isArray(configs[entity].images) && configs[entity].images.length) ? configs[entity].images[0] : "";

      // Build model. IMPORTANT: do NOT force client-side logoUrl that may be a localhost path.
      // Let server-side template (buildTicketEmail) try admin-config itself. We still pass frontendBase.
      const model = {
        frontendBase,
        entity,
        id,
        name: row?.name || row?.company || "",
        company: row?.company || row?.organization || "",
        ticket_category: row?.ticket_category || (premium ? "Premium" : ""),
        badgePreviewUrl: row?.badgePreviewUrl || row?.badge_preview || "",
        downloadUrl: row?.downloadUrl || row?.download_url || "",
        upgradeUrl: premium ? "" : (row?.upgradeUrl || row?.upgrade_url || ""),
        // Do NOT include logoUrl here; server will fetch admin-config logo and resolve with frontendBase.
        form: row || null,
        pdfBase64: row?.pdfBase64 || null,
      };

      // build template (await because buildTicketEmail may be async)
      const tpl = await buildTicketEmail(model) || {};
      let { subject, text, html, attachments } = tpl;
      attachments = Array.isArray(attachments) ? attachments : [];

      // Defensive: filter out image attachments (these show up as attachments in mail clients)
      const safeAttachments = [];
      for (const a of attachments) {
        if (isImageAttachmentMeta(a)) {
          console.log("[Dashboard] stripping image attachment from template before mailer:", a.filename || a.path || "<unknown>");
          continue;
        }
        // normalize attachment fields for the mailer
        const out = {};
        if (a.filename) out.filename = a.filename;
        if (a.content) out.content = a.content;
        if (a.encoding) out.encoding = a.encoding;
        if (a.contentType || a.content_type) out.contentType = a.contentType || a.content_type;
        if (a.cid) out.cid = a.cid;
        safeAttachments.push(out);
      }

      // fallback to minimal content if template returned nothing
      const finalSubject = (subject && String(subject).trim()) ? subject : `RailTrans Expo — Your E‑Badge`;
      const finalText = text || `Hello ${model.name || "Participant"},\n\nYour ticket category: ${model.ticket_category || ""}\n\nDownload: ${model.downloadUrl || frontendBase}`;
      const finalHtml = html || `<p>Hello ${model.name || "Participant"},</p><p>Your ticket info has been generated.</p><p><a href="${model.downloadUrl || frontendBase}">Download E‑Badge</a></p>`;

      const mailPayload = {
        to: email,
        subject: finalSubject,
        text: finalText,
        html: finalHtml,
        attachments: safeAttachments,
      };

      console.debug("[sendTemplatedEmail] mailPayload preview:", { to: mailPayload.to, subject: mailPayload.subject, attachments: mailPayload.attachments.length });

      const r = await fetch(buildApiUrl("/api/mailer".replace(/^\/+/, "/")), { method: "POST", headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" }, body: JSON.stringify(mailPayload) });
      const body = await parseErrorBody(r);
      if (!r.ok) {
        console.warn("[sendTemplatedEmail] mailer responded non-ok:", body);
        return { ok: false, reason: "mailer-failed", body };
      }
      const resJson = await r.json().catch(() => null);
      console.debug("[sendTemplatedEmail] mailer success", resJson);
      return { ok: true, info: resJson };
    } catch (e) { console.warn("[sendTemplatedEmail] exception", e); return { ok: false, reason: "exception", error: String(e) }; }
  }, [configs, parseErrorBody, API_BASE]);

  // --- generate ticket (server endpoints optional). If not available, create client ticket_code and PATCH entity.
  const generateAndEmailTicket = useCallback(async ({ tableKey, row, premium = false }) => {
    setActionMsg(`Generating ticket for ${row?.name || row?.company || row?.id || ""}...`);
    try {
      const base = apiMap.current[tableKey];
      if (!base) { setActionMsg("Unknown table"); return { ok: false }; }

      // canonical id extraction
      const id = row.id || row._id || row.ID || row.Id || (row && row._id && (row._id.$oid || row._id.toString())) || "";
      if (!id) { setActionMsg("Missing id"); return { ok: false }; }

      // If a ticket_code already exists, skip generate step
      let ticket_code = row && (row.ticket_code || row.ticketCode || row.code) || "";

      // try server generate endpoints
      if (!ticket_code) {
        const candidates = [
          `${base}/${encodeURIComponent(String(id))}/generate-ticket`,
          `${base}/${encodeURIComponent(String(id))}/generate`,
          `${base}/generate-ticket/${encodeURIComponent(String(id))}`,
          `${base}/generate/${encodeURIComponent(String(id))}`,
          `${base}/${encodeURIComponent(String(id))}/ticket`,
        ];
        for (const url of candidates) {
          try {
            const r = await fetch(buildApiUrl(url));
            if (!r.ok) continue;
            const js = await r.json().catch(() => null);
            const maybe = js && (js.ticket_code || js.code || js.ticketCode || (js.data && (js.data.ticket_code || js.data.code)));
            if (maybe) { ticket_code = maybe; break; }
          } catch (e) { /* ignore and continue */ }
        }
      }

      // fallback: create local ticket_code and PATCH the entity
      if (!ticket_code) {
        ticket_code = String(Math.floor(100000 + Math.random() * 900000));
        try {
          await fetch(buildApiUrl(`${base}/${encodeURIComponent(String(id))}`), {
            method: "PUT",
            headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
            body: JSON.stringify({ ticket_code }),
          }).catch(()=>null);
        } catch(e){}
      }

      // fetch latest row
      let workingRow = row;
      try {
        const r2 = await fetch(buildApiUrl(`${base}/${encodeURIComponent(String(id))}`));
        if (r2.ok) {
          const j2 = await r2.json().catch(() => null);
          workingRow = sanitizeRow(j2 || {});
        }
      } catch(e){}

      // send email; pass premium flag so template hides upgrade button
      const mailResult = await sendTemplatedEmail({ entity: tableKey, id: String(id), row: workingRow, premium });
      if (mailResult && mailResult.ok) {
        setActionMsg("Ticket generated and emailed");
        if (pendingPremium && pendingPremium.table === tableKey && String(pendingPremium.id) === String(id)) setPendingPremium(null);
        return { ok: true };
      } else {
        setActionMsg("Ticket generated but email failed");
        console.warn("mailResult:", mailResult);
        return { ok: false, mailResult };
      }
    } catch (e) {
      console.error("generateAndEmailTicket error", e);
      setActionMsg("Generation failed");
      return { ok: false, error: String(e) };
    }
  }, [sendTemplatedEmail, pendingPremium, API_BASE]);

  // --- Handlers (create, update, delete, refresh) ---
  const handleEdit = useCallback((table, row) => {
    const key = table.toLowerCase();
    const cfg = configs[key];
    let meta = [];
    if (cfg && Array.isArray(cfg.fields) && cfg.fields.length) {
      meta = cfg.fields.map(f => ({ name: f.name, label: f.label || f.name, type: f.type || "text" })).filter(x => x.name && !HIDDEN_FIELDS.has(x.name));
    } else {
      const rows = Array.isArray(report[key]) ? report[key] : [];
      const cols = rows.length ? getColumnsFromRows(rows) : Object.keys(row || {});
      meta = cols.filter(c => !HIDDEN_FIELDS.has(c)).map(c => ({ name: c, label: c.replace(/_/g, " "), type: "text" }));
    }
    // Ensure email field present in modal
    if (!meta.some(m => m.name === "email" || m.name === "email_address")) {
      meta.push({ name: "email", label: "Email", type: "text" });
    }

    // IMPORTANT: sanitize row values so modal inputs receive strings, not nested objects
    const sanitized = sanitizeRow(row || {});
    const prepared = {};
    meta.forEach(f => prepared[f.name] = (sanitized[f.name] !== undefined ? sanitized[f.name] : ""));

    setModalColumns(meta);
    setNewIsPremium(false); // editing existing => not a new premium creation
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
    // Ensure email exists
    if (!meta.some(m => m.name === "email" || m.name === "email_address")) {
      meta.push({ name: "email", label: "Email", type: "text" });
    }
    setModalColumns(meta);
    const empty = {};
    meta.forEach(m => empty[m.name] = "");

    // DO NOT prefill eventDetails — template will fetch canonical event-details itself
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

  const handleDeleteConfirm = useCallback(async () => {
    setActionMsg("");
    setDeleteOpen(false);
    if (!deleteTable || !deleteRow) return;
    try {
      const base = apiMap.current[deleteTable];
      if (!base) { setActionMsg("Unknown table"); return; }
      let id = deleteRow.id || deleteRow._id || deleteRow.ID || deleteRow.Id || "";
      if (!id && deleteRow._id && typeof deleteRow._id === "object") id = deleteRow._id.$oid || deleteRow._id.toString() || "";
      if (!id) { for (const k of Object.keys(deleteRow || {})) { if (/id$/i.test(k) && deleteRow[k]) { id = deleteRow[k]; break; } } }
      if (!id) { setActionMsg("Delete failed: no id found"); return; }
      const res = await fetch(buildApiUrl(`${base}/${encodeURIComponent(String(id))}`), { method: "DELETE", headers: { "ngrok-skip-browser-warning": "69420" } });
      let data = null; try { data = await res.json().catch(() => null); } catch {}
      if (res.ok && (data === null || data.success !== false)) {
        setReport(prev => {
          const copy = { ...(prev || {}) };
          copy[deleteTable] = (copy[deleteTable] || []).filter(r => {
            const rId = r.id || r._id || (r._id && (typeof r._id === "object" ? r._id.$oid : undefined)) || "";
            return String(rId) !== String(id);
          });
          return copy;
        });
        setActionMsg("Deleted");
      } else {
        const body = data || await parseErrorBody(res);
        setActionMsg(`Delete failed: ${JSON.stringify(body)}`);
      }
    } catch (e) { console.error(e); setActionMsg("Delete failed"); } finally { setDeleteRow(null); setDeleteTable(""); }
  }, [deleteRow, deleteTable, parseErrorBody, API_BASE]);

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

  // CREATE/UPDATE flow with robust id detection and email sending
  const handleEditSave = useCallback(async (edited) => {
    setActionMsg("");
    setEditOpen(false);
    try {
      const base = apiMap.current[editTable];
      if (!base) { setActionMsg("Unknown table"); return; }

      if (isCreating) {
        // create payload as-is (do NOT attach eventDetails)
        const payload = { ...edited };

        const res = await fetch(buildApiUrl(base), { method: "POST", headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" }, body: JSON.stringify(payload) });
        const createdRaw = await res.json().catch(() => null);
        if (!res.ok) {
          const body = createdRaw || await parseErrorBody(res);
          setActionMsg(`Create failed: ${JSON.stringify(body)}`);
          return;
        }
        setActionMsg("Created");
        // robust id extraction and row extraction
        let newId = createdRaw && (createdRaw.insertedId || createdRaw.insertId || createdRaw.id || createdRaw._id || (createdRaw.data && (createdRaw.data.id || createdRaw.data._id)) || null);
        let createdRow = null;
        // if API returned created row directly
        if (createdRaw && (createdRaw.id || createdRaw._id || createdRaw.email || createdRaw.name)) {
          createdRow = sanitizeRow(createdRaw);
          if (!newId) newId = createdRow.id || createdRow._id || null;
        }
        // if we have id, fetch the fresh row to ensure canonical shape
        if (!createdRow && newId) {
          try {
            const r = await fetch(buildApiUrl(`${base}/${encodeURIComponent(String(newId))}`));
            if (r.ok) {
              const j = await r.json().catch(() => null);
              createdRow = sanitizeRow(j || {});
            }
          } catch (e) { console.warn("post-create fetch failed", e); }
        }
        // fallback: refresh all if we couldn't fetch createdRow
        if (!createdRow) {
          await fetchAll();
          setActionMsg("Created");
        } else {
          // insert sanitized row into report
          setReport(prev => ({ ...prev, [editTable]: [createdRow, ...(prev[editTable] || [])] }));

          // set pending premium for quick generate UI; include premium flag from newIsPremium
          // Use robust email extraction for pendingPremium
          const pendingEmail = (createdRaw && typeof createdRaw === "object" && extractEmailFromObject(createdRaw)) || extractEmailFromObject(createdRow) || "";
          setPendingPremium({ table: editTable, id: String(newId || createdRow.id || createdRow._id || ""), email: pendingEmail, premium: !!newIsPremium });

          // if email present, attempt to send templated email immediately with premium info
          const email = pendingEmail;
          if (email) {
            setActionMsg("Created — sending email...");
            // pass createdRaw if available (original object), otherwise pass sanitized createdRow
            const emailRow = (createdRaw && typeof createdRaw === "object") ? createdRaw : createdRow;
            const mailResult = await sendTemplatedEmail({ entity: editTable, id: String(newId || createdRow.id || createdRow._id || ""), row: emailRow, premium: !!newIsPremium });
            if (mailResult && mailResult.ok) setActionMsg("Created and emailed");
            else setActionMsg((mailResult && mailResult.reason) ? `Created  (${mailResult.reason})` : "Created");
          }
        }
        setNewIsPremium(false);
      } else {
        // update path
        let id = edited.id || edited._id;
        if (!id && edited._id && typeof edited.__id === "object") id = edited._id.$oid || edited._id.toString() || "";
        if (!id) { setActionMsg("Missing id for update"); return; }
        const res = await fetch(buildApiUrl(`${base}/${encodeURIComponent(String(id))}`), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(edited) });
        if (!res.ok) {
          const body = await parseErrorBody(res);
          setActionMsg(`Update failed: ${JSON.stringify(body)}`);
          return;
        }
        // fetch updated row and replace
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
  }, [editTable, isCreating, fetchAll, parseErrorBody, sendTemplatedEmail, newIsPremium, API_BASE]);

  const stats = useMemo(() => ({
    visitors: (report.visitors || []).length,
    exhibitors: (report.exhibitors || []).length,
    partners: (report.partners || []).length,
    speakers: (report.speakers || []).length,
    awardees: (report.awardees || []).length,
  }), [report]);

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
            const cols = getColumnsFromRows(rows).filter(c => !HIDDEN_FIELDS.has(c));
            const current = Math.max(1, Number(pageState[key] || 1));
            const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
            const start = (current - 1) * PAGE_SIZE;
            const shown = rows.slice(start, start + PAGE_SIZE);
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

                <div className="p-0 flex-1 min-h-0">
                  {shown.length === 0 ? (
                    <div className="p-6 text-gray-500">No records</div>
                  ) : (
                    <div className="overflow-auto h-full max-h-[56vh] md:max-h-[60vh]">
                      <div className="min-w-full">
                        <table className="min-w-full w-full table-auto border-collapse">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              {cols.slice(0, 5).map(c => <th key={c} className="text-left text-sm px-3 py-2 text-gray-600">{c}</th>)}
                              <th className="px-3 py-2 text-left">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {shown.map((r, idx) => {
                              const canonicalId = r.id || r._id || r.ID || "";
                              const isPendingPremium = pendingPremium && pendingPremium.table === key && String(pendingPremium.id) === String(canonicalId);
                              const premiumFlag = isPendingPremium || String((r.ticket_category || "").toLowerCase()).includes("premium");
                              return (
                                <tr key={r.id ?? `${key}-${idx}`} className="border-t">
                                  {cols.slice(0, 5).map(c => <td key={c} className="px-3 py-3 text-sm text-gray-700 align-top whitespace-pre-wrap break-words">{r[c] ?? ""}</td>)}
                                  <td className="px-3 py-3">
                                    <div className="flex items-center gap-2">
                                      {pendingPremium && pendingPremium.table === key && String(pendingPremium.id) === String(canonicalId) ? (
                                        <button className="px-2 py-1 border rounded text-sm" onClick={() => generateAndEmailTicket({ tableKey: key, row: r, premium: premiumFlag })}>
                                          {premiumFlag ? "Generate (Premium)" : "Generate"}
                                        </button>
                                      ) : null}

                                      <ActionsMenu
                                        onEdit={() => handleEdit(label, r)}
                                        onRefresh={() => handleRefreshRow(key, r)}
                                        onDelete={() => handleDelete(label, r)}
                                      />
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-4 border-t">
                  <Pagination currentPage={current} totalPages={totalPages} onPageChange={(pg) => setPageState(prev => ({ ...prev, [key]: pg }))} />
                </div>
              </section>
            );
          })}
        </div>

        <EditModal open={editOpen} onClose={() => setEditOpen(false)} row={editRow} columns={modalColumns} onSave={handleEditSave} isNew={isCreating} table={editTable || "exhibitors"} />
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

        {actionMsg && <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-50 bg-white px-4 py-2 rounded shadow">{actionMsg}</div>}
      </div>
    </div>
  );
}