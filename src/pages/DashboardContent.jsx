import React, { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import EditModal from "../components/EditModal";
import Topbar from "../components/Topbar";
import Sidebar from "../components/Sidebar";
import DeleteModal from "../components/DeleteModal";

/*
  DashboardContent (responsive + improved error reporting + generate only for created row)
*/

const apiEndpoints = [
  { label: "Visitors", url: "/api/visitors", configUrl: "/api/visitor-config" },
  {
    label: "Exhibitors",
    url: "/api/exhibitors",
    configUrl: "/api/exhibitor-config",
  },
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

// Helpers (unchanged)
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
          className={`px-2 py-1 border rounded ${
            currentPage === i + 1 ? "bg-indigo-100 font-bold" : ""
          }`}
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

/* Actions menu (unchanged) */
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
        <svg
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="4" cy="10" r="2" />
          <circle cx="10" cy="10" r="2" />
          <circle cx="16" cy="10" r="2" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-10 right-0 mt-2 bg-white border shadow-lg rounded-lg w-44">
          <button
            className="block w-full text-left px-4 py-2 hover:bg-indigo-50 text-indigo-700 font-semibold"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
          >
            Update
          </button>
          <button
            className="block w-full text-left px-4 py-2 hover:bg-gray-50 text-gray-700 font-medium"
            onClick={() => {
              setOpen(false);
              onRefresh();
            }}
          >
            Refresh
          </button>
          <button
            className="block w-full text-left px-4 py-2 hover:bg-red-50 text-red-700 font-semibold"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
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

  // pending premium generation after creation: { table, id, email }
  const [pendingPremium, setPendingPremium] = useState(null);

  const mountedRef = useRef(true);
  const autoGenRef = useRef(false);
  const apiMap = useRef(
    apiEndpoints.reduce((a, e) => {
      a[e.label.toLowerCase()] = e.url;
      a[e.label.toLowerCase() + "_config"] = e.configUrl;
      return a;
    }, {})
  );

  // parse error response: try JSON, else text
  const parseErrorBody = useCallback(async (res) => {
    try {
      const txt = await res.text();
      try {
        return JSON.parse(txt);
      } catch {
        return txt;
      }
    } catch (e) {
      return null;
    }
  }, []);

  // Fetch configs (raw JSON)
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
          const res = await fetch(configUrl);
          out[k] = await res.json().catch(() => null);
        } catch (e) {
          console.warn("fetch config", k, e);
          out[k] = null;
        }
      })
    );
    if (mountedRef.current) setConfigs(out);
    return out;
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      await fetchConfigs();
      const results = {};
      await Promise.all(
        apiEndpoints.map(async ({ label, url }) => {
          try {
            const res = await fetch(url);
            let j = await res.json().catch(() => null);
            if (Array.isArray(j) && j.length === 2 && Array.isArray(j[0]))
              j = j[0];
            if (j && typeof j === "object" && !Array.isArray(j))
              j = j.data || j.rows || j;
            const rows = normalizeData(j).map(sanitizeRow);
            results[label.toLowerCase()] = rows;
          } catch (e) {
            console.warn("fetch data", label, e);
            results[label.toLowerCase()] = [];
          }
        })
      );
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
    return () => {
      mountedRef.current = false;
    };
  }, [fetchAll]);

  const normalizeMetaFromConfig = (cfg = {}) =>
    Array.isArray(cfg.fields)
      ? cfg.fields
          .map((f) => ({
            name: f.name,
            label: f.label || f.name,
            type: f.type || "text",
            options: f.options || [],
            required: !!f.required,
            showIf: f.showIf || null,
          }))
          .filter((x) => x.name && !HIDDEN_FIELDS.has(x.name))
      : [];
  const normalizeMetaFromRowKeys = (keys = []) =>
    keys
      .filter((k) => k && !HIDDEN_FIELDS.has(k))
      .map((k) => ({ name: k, label: k.replace(/_/g, " "), type: "text" }));

  // Open edit modal for an existing row
  const handleEdit = useCallback(
    (table, row) => {
      const key = table.toLowerCase();
      const cfg = configs[key];
      let meta = [];
      if (cfg && Array.isArray(cfg.fields) && cfg.fields.length)
        meta = normalizeMetaFromConfig(cfg);
      else {
        const rows = Array.isArray(report[key]) ? report[key] : [];
        const cols = rows.length
          ? getColumnsFromRows(rows)
          : Object.keys(row || {});
        meta = normalizeMetaFromRowKeys(cols);
      }
      if (meta.some((m) => m.name === "id"))
        meta = [
          { name: "id", label: "Id", type: "text", required: false },
          ...meta.filter((m) => m.name !== "id"),
        ];
      setModalColumns(meta);
      const prepared = {};
      meta.forEach(
        (f) => (prepared[f.name] = row && f.name in row ? row[f.name] : "")
      );
      setEditTable(key);
      setEditRow(prepared);
      setIsCreating(false);
      autoGenRef.current = false;
      setEditOpen(true);
    },
    [configs, report]
  );

  // Open add-new modal
  const handleAddNew = useCallback(
    (table) => {
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
        meta = defaults[key] || [
          { name: "name", label: "Name", type: "text", required: true },
          { name: "email", label: "Email", type: "email" },
        ];
      }
      meta = meta.filter((m) => m.name && !HIDDEN_FIELDS.has(m.name));
      setModalColumns(meta);
      const empty = {};
      meta.forEach((f) => (empty[f.name] = ""));
      setEditTable(key);
      setEditRow(empty);
      setIsCreating(true);
      setEditOpen(true);
    },
    [configs]
  );

  const handleDelete = useCallback((table, row) => {
    setDeleteTable(table.toLowerCase());
    setDeleteRow(row);
    setDeleteOpen(true);
  }, []);

  // Save (create/update) with improved error handling and validation messages
  const handleEditSave = useCallback(
    async (edited) => {
      setActionMsg("");
      setEditOpen(false);
      try {
        const base = apiMap.current[editTable];
        if (!base) {
          setActionMsg("Unknown table");
          return;
        }

        // Normalize payload before sending so admin always includes companyName/company/company_name
        function normalizeForServer(obj = {}) {
          const p = { ...obj };

          // Collect company possible values
          const companyCandidates = [
            p.companyName,
            p.company,
            p.company_name,
            p.companyname,
            // handles case where form libs send { field: { value: ... } }
            p.companyName?.value,
            p.company?.value,
            p["Company Name"],
            p.CompanyName,
          ];
          const company = (
            companyCandidates.find(
              (v) =>
                typeof v !== "undefined" &&
                v !== null &&
                String(v).trim() !== ""
            ) || ""
          )
            .toString()
            .trim();
          if (company) {
            p.companyName = company;
            p.company = p.company || company;
            p.company_name = p.company_name || company;
          }

          // Normalize email
          const emailCandidates = [
            p.email,
            p.emailAddress,
            p.email_address,
            p.contactEmail,
            p.mail,
          ];
          const email = (
            emailCandidates.find(
              (v) => typeof v === "string" && v.trim() && /\S+@\S+\.\S+/.test(v)
            ) || ""
          )
            .toString()
            .trim();
          if (email) p.email = email;

          // Coerce booleans from strings if needed
          if (typeof p.terms === "string") {
            p.terms = p.terms === "1" || p.terms === "true" || p.terms === "on";
          }
          return p;
        }

        if (isCreating) {
          const payload = normalizeForServer(edited);
          console.debug("[Admin] creating payload:", payload);

          const res = await fetch(base, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (res.ok) {
            const data = await res.json().catch(() => null);
            setActionMsg("Created");
            const id = data?.insertedId || data?.insertId || data?.id;
            if (id) {
              // fetch created row
              const r = await fetch(
                `${base}/${encodeURIComponent(String(id))}`
              );
              const newRowRaw = (await r.json().catch(() => null)) || {};
              const newRow = sanitizeRow(newRowRaw);
              setReport((prev) => ({
                ...prev,
                [editTable]: [newRow, ...(prev[editTable] || [])],
              }));
              // only set pendingPremium for this newly created row
              const email =
                newRow.email ||
                newRow.email_address ||
                newRow.contact ||
                newRow.emailAddress ||
                "";
              setPendingPremium({ table: editTable, id: String(id), email });
            } else {
              await fetchAll();
            }
          } else {
            // parse and surface server validation / error payload
            const body = await parseErrorBody(res);
            const message =
              typeof body === "string"
                ? body
                : body?.message || body?.error || JSON.stringify(body);
            // if body contains field errors, present them more clearly
            if (body && typeof body === "object" && body.errors) {
              const fields = Object.entries(body.errors)
                .map(([k, v]) => `${k}: ${v}`)
                .join("; ");
              setActionMsg(`Create failed: ${fields}`);
            } else {
              setActionMsg(`Create failed: ${message} (status ${res.status})`);
            }
          }
        } else {
          const payload = normalizeForServer(edited);
          const res = await fetch(
            `${base}/${encodeURIComponent(String(edited.id))}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            }
          );
          if (res.ok) {
            const r = await fetch(
              `${base}/${encodeURIComponent(String(edited.id))}`
            );
            const updated = sanitizeRow(
              (await r.json().catch(() => null)) || {}
            );
            setReport((prev) => ({
              ...prev,
              [editTable]: (prev[editTable] || []).map((x) =>
                String(x.id) === String(edited.id) ? updated : x
              ),
            }));
            setActionMsg("Updated");
          } else {
            const body = await parseErrorBody(res);
            const message =
              typeof body === "string"
                ? body
                : body?.message || body?.error || JSON.stringify(body);
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
    },
    [editTable, isCreating, fetchAll, parseErrorBody]
  );

  const handleDeleteConfirm = useCallback(async () => {
    setActionMsg("");
    setDeleteOpen(false);
    if (!deleteTable || !deleteRow) return;
    try {
      const base = apiMap.current[deleteTable];
      const res = await fetch(
        `${base}/${encodeURIComponent(String(deleteRow.id))}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => null);
      if (res.ok && data && data.success !== false) {
        setReport((prev) => ({
          ...prev,
          [deleteTable]: (prev[deleteTable] || []).filter(
            (r) => String(r.id) !== String(deleteRow.id)
          ),
        }));
        setActionMsg("Deleted");
      } else {
        setActionMsg(`Delete failed: ${JSON.stringify(data)}`);
      }
    } catch (e) {
      console.error(e);
      setActionMsg("Delete failed");
    } finally {
      setDeleteRow(null);
      setDeleteTable("");
    }
  }, [deleteTable, deleteRow]);

  const handleRefreshRow = useCallback(async (tableKey, row) => {
    if (!row?.id) {
      setActionMsg("Cannot refresh");
      return;
    }
    try {
      const res = await fetch(
        `${apiMap.current[tableKey]}/${encodeURIComponent(String(row.id))}`
      );
      if (!res.ok) {
        setActionMsg("Failed to fetch row");
        return;
      }
      const json = await res.json().catch(() => null);
      const sanitized = sanitizeRow(json || {});
      setReport((prev) => ({
        ...prev,
        [tableKey]: (prev[tableKey] || []).map((r) =>
          String(r.id) === String(row.id) ? sanitized : r
        ),
      }));
      setActionMsg("Refreshed");
    } catch (e) {
      console.error(e);
      setActionMsg("Refresh failed");
    }
  }, []);

  // try multiple possible endpoint patterns for generate-ticket to avoid 404s
  const tryGenerateEndpoint = useCallback(async (base, id, premium = false) => {
    const candidates = [
      `${base}/${encodeURIComponent(String(id))}/generate-ticket${
        premium ? "?premium=1" : ""
      }`,
      `${base}/${encodeURIComponent(String(id))}/generate${
        premium ? "?premium=1" : ""
      }`,
      `${base}/generate-ticket/${encodeURIComponent(String(id))}${
        premium ? "?premium=1" : ""
      }`,
      `${base}/generate/${encodeURIComponent(String(id))}${
        premium ? "?premium=1" : ""
      }`,
      `${base}/${encodeURIComponent(String(id))}/ticket${
        premium ? "?premium=1" : ""
      }`,
    ];

    for (const url of candidates) {
      try {
        const res = await fetch(url, { method: "POST" });
        const bodyText = await res.text().catch(() => "");
        let body;
        try {
          body = JSON.parse(bodyText);
        } catch {
          body = bodyText;
        }
        if (res.ok) return { ok: true, url, body };
        // 404 or other non-ok -> keep trying
        // if 4xx with detailed message, return it to display
        if (res.status >= 400 && res.status < 500) {
          // continue trying in case another shape exists, but remember the error
          // return the first non-ok body if you want; here continue to try
          // collect last error below
          // store last error
          // continue
          // but if 404 specifically, keep trying
        }
      } catch (e) {
        // network / CORS / other - try next
      }
    }
    return {
      ok: false,
      message: "No generate endpoint matched (404 or failed)",
    };
  }, []);

  // Generate premium ticket and optionally email it to the record's email
  const handleGeneratePremium = useCallback(async () => {
    if (!pendingPremium) {
      setActionMsg("Nothing to generate");
      return;
    }
    const { table, id, email } = pendingPremium;
    const base = apiMap.current[table];
    if (!base) {
      setActionMsg("Unknown table for generation");
      return;
    }
    setActionMsg("Generating premium ticket...");
    try {
      const result = await tryGenerateEndpoint(base, id, true);
      if (!result.ok) {
        setActionMsg(result.message || "Generation failed (no endpoint)");
        setPendingPremium(null);
        return;
      }

      // success: refresh row
      try {
        const r = await fetch(`${base}/${encodeURIComponent(String(id))}`);
        const updated = sanitizeRow((await r.json().catch(() => null)) || {});
        setReport((prev) => ({
          ...prev,
          [table]: (prev[table] || []).map((x) =>
            String(x.id) === String(id) ? updated : x
          ),
        }));
      } catch (e) {
        console.warn("Failed to refresh row after generation", e);
      }

      // email if available
      if (email) {
        setActionMsg("Sending ticket to email...");
        try {
          const mailPayload = {
            to: email,
            subject: "Your Premium Ticket",
            text: `Your premium ticket has been generated. Ticket details: ${JSON.stringify(
              result.body || {}
            )}`,
            html: `<p>Your premium ticket has been generated.</p><pre>${JSON.stringify(
              result.body || {},
              null,
              2
            )}</pre>`,
          };
          const mailRes = await fetch("/api/email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(mailPayload),
          });
          if (!mailRes.ok) {
            const err = await parseErrorBody(mailRes);
            setActionMsg(
              `Ticket generated but emailing failed: ${JSON.stringify(err)}`
            );
            setPendingPremium(null);
            fetchAll();
            return;
          }
          setActionMsg("Premium ticket generated and emailed");
        } catch (e) {
          console.error("Email send failed", e);
          setActionMsg("Ticket generated but email failed");
        }
      } else {
        setActionMsg("Premium ticket generated (no email available)");
      }
    } catch (err) {
      console.error("Generate premium failed", err);
      setActionMsg("Generation failed: " + (err.message || err));
    } finally {
      setPendingPremium(null);
      fetchAll();
    }
  }, [pendingPremium, tryGenerateEndpoint, fetchAll, parseErrorBody]);

  const handleGenerateSkip = useCallback(() => {
    setPendingPremium(null);
    setActionMsg("Generation skipped");
  }, []);

  // Inline generate for an individual row: try the endpoints similarly
  const handleGenerateTicket = useCallback(
    async (tableKey, row) => {
      if (!row?.id) {
        setActionMsg("Missing id");
        return;
      }
      const base = apiMap.current[tableKey];
      setActionMsg("Generating ticket...");
      const result = await tryGenerateEndpoint(base, row.id, false);
      if (!result.ok) {
        setActionMsg(result.message || "Generation failed (no endpoint)");
        return;
      }
      // refresh row
      try {
        const r = await fetch(`${base}/${encodeURIComponent(String(row.id))}`);
        const updated = sanitizeRow((await r.json().catch(() => null)) || {});
        setReport((prev) => ({
          ...prev,
          [tableKey]: (prev[tableKey] || []).map((x) =>
            String(x.id) === String(row.id) ? updated : x
          ),
        }));
        setActionMsg("Ticket generated");
      } catch (e) {
        console.warn("Failed to refresh after generate", e);
        setActionMsg("Ticket generated (refresh failed)");
      } finally {
        fetchAll();
      }
    },
    [tryGenerateEndpoint, fetchAll]
  );

  const handleSidebarSelect = useCallback(
    (pathOrLabel) => {
      if (typeof pathOrLabel !== "string") return;
      if (pathOrLabel.startsWith("/")) {
        navigate(pathOrLabel);
        return;
      }
      const map = {
        Dashboard: "/",
        Visitors: "/visitors",
        Exhibitors: "/exhibitors",
        Partners: "/partners",
        Speakers: "/speakers",
        Awardees: "/awardees",
      };
      if (map[pathOrLabel]) navigate(map[pathOrLabel]);
    },
    [navigate]
  );

  // Only show inline Generate for the newly created pending row
  const shouldShowGenerateForRow = (tableKey, row) => {
    return !!(
      pendingPremium &&
      pendingPremium.table === tableKey &&
      String(pendingPremium.id) === String(row?.id)
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Topbar />
      <div className="flex max-w-full">
        <div className="w-64 hidden md:block">
          <Sidebar
            selected={location.pathname}
            onSelect={handleSidebarSelect}
          />
        </div>
        <main
          className="flex-1 p-4 sm:p-8 overflow-auto"
          style={{ maxHeight: "calc(100vh - 80px)" }}
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold">Admin Dashboard</h1>
              <div className="text-sm text-gray-600">
                Live registration report
              </div>
            </div>
            <div className="flex gap-2">
              <button
                className="px-3 py-1 bg-gray-100 rounded"
                onClick={fetchAll}
              >
                Refresh
              </button>
              <button
                className="px-3 py-1 bg-gray-100 rounded"
                onClick={fetchConfigs}
              >
                Reload Configs
              </button>
            </div>
          </div>

          {actionMsg && (
            <div className="mb-4 text-green-700 break-words">{actionMsg}</div>
          )}

          {/* If there's a recent created row pending premium generation, show CTA */}
          {pendingPremium && (
            <div className="mb-4 p-4 bg-yellow-50 border-l-4 border-yellow-400 rounded">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">Generate Premium Ticket</div>
                  <div className="text-sm text-gray-700">
                    A new record was created. Click below to generate a premium
                    ticket and (optionally) email it to{" "}
                    {pendingPremium.email || "the user"}.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleGeneratePremium}
                    className="px-3 py-1 bg-indigo-600 text-white rounded"
                  >
                    Generate & Email
                  </button>
                  <button
                    onClick={handleGenerateSkip}
                    className="px-3 py-1 border rounded"
                  >
                    Skip
                  </button>
                </div>
              </div>
            </div>
          )}

          <EditModal
            open={editOpen}
            onClose={() => setEditOpen(false)}
            row={editRow}
            columns={modalColumns}
            onSave={handleEditSave}
            isNew={isCreating}
            table="exhibitors" // <-- This works 100%
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

          {loading ? (
            <div className="text-gray-500">Loading...</div>
          ) : (
            apiEndpoints.map(({ label }) => {
              const key = label.toLowerCase();
              const rows = report[key] || [];
              const current = pageState[key] || 1;
              const total = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
              const shown = rows.slice(
                (current - 1) * PAGE_SIZE,
                current * PAGE_SIZE
              );
              const cols = getColumnsFromRows(rows).filter(
                (c) => !HIDDEN_FIELDS.has(c)
              );

              return (
                <section key={label} className="mb-10">
                  <div className="flex justify-between items-center mb-2">
                    <h2 className="text-xl font-bold">
                      {label} ({rows.length})
                    </h2>
                    <div>
                      <button
                        onClick={() => handleAddNew(label)}
                        className="px-3 py-1 border rounded mr-2"
                      >
                        Add New
                      </button>
                    </div>
                  </div>

                  {rows.length === 0 ? (
                    <div className="text-gray-500">No {key}</div>
                  ) : (
                    <div
                      className="bg-white rounded shadow-sm overflow-auto"
                      style={{ maxHeight: "48vh" }}
                    >
                      <table className="min-w-full w-full table-auto border-collapse hidden md:table">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            {cols.map((c) => (
                              <th
                                key={c}
                                className="border px-3 py-2 text-left"
                              >
                                {c}
                              </th>
                            ))}
                            <th className="border px-3 py-2">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shown.map((r, idx) => (
                            <tr key={r.id ?? idx} className="hover:bg-gray-50">
                              {cols.map((c) => (
                                <td
                                  key={c}
                                  className="border px-3 py-2 align-top whitespace-pre-wrap"
                                >
                                  {r[c] ?? ""}
                                </td>
                              ))}
                              <td className="border px-3 py-2">
                                <div className="flex gap-2 items-center">
                                  <ActionsMenu
                                    onEdit={() => handleEdit(label, r)}
                                    onDelete={() => handleDelete(label, r)}
                                    onRefresh={() => handleRefreshRow(key, r)}
                                  />
                                  {/* Only show generate inline for the newly created pending row */}
                                  {shouldShowGenerateForRow(key, r) && (
                                    <button
                                      onClick={() =>
                                        handleGenerateTicket(key, r)
                                      }
                                      className="px-2 py-1 text-sm bg-yellow-100 rounded"
                                    >
                                      Generate
                                    </button>
                                  )}
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
                            <div
                              key={r.id ?? idx}
                              className="bg-white border rounded p-3 shadow-sm"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1">
                                  <div className="flex items-center justify-between">
                                    <div className="font-medium">
                                      {r.name ||
                                        r.title ||
                                        r.id ||
                                        `#${r.id ?? idx}`}
                                    </div>
                                    <div className="text-sm text-gray-500">
                                      {r.id ? `ID: ${r.id}` : null}
                                    </div>
                                  </div>
                                  <div className="mt-2 text-sm text-gray-700 space-y-1">
                                    {previewCols.map((c) => (
                                      <div key={c}>
                                        <span className="font-semibold mr-2">
                                          {c}:
                                        </span>
                                        <span className="break-words">
                                          {String(r[c] ?? "")}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>

                              <div className="mt-3 flex gap-2 flex-wrap">
                                <button
                                  onClick={() => handleEdit(label, r)}
                                  className="px-3 py-1 border rounded text-sm"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => handleRefreshRow(key, r)}
                                  className="px-3 py-1 border rounded text-sm"
                                >
                                  Refresh
                                </button>
                                {shouldShowGenerateForRow(key, r) && (
                                  <button
                                    onClick={() => handleGenerateTicket(key, r)}
                                    className="px-3 py-1 bg-yellow-100 rounded text-sm"
                                  >
                                    Generate
                                  </button>
                                )}
                                <button
                                  onClick={() => {
                                    setDeleteTable(key);
                                    setDeleteRow(r);
                                    setDeleteOpen(true);
                                  }}
                                  className="px-3 py-1 border rounded text-sm text-red-600"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          );
                        })}
                        <div className="pt-2">
                          <Pagination
                            currentPage={current}
                            totalPages={total}
                            onPageChange={(pg) =>
                              setPageState((prev) => ({ ...prev, [key]: pg }))
                            }
                          />
                        </div>
                      </div>

                      <div className="p-3 hidden md:block">
                        <Pagination
                          currentPage={current}
                          totalPages={total}
                          onPageChange={(pg) =>
                            setPageState((prev) => ({ ...prev, [key]: pg }))
                          }
                        />
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
