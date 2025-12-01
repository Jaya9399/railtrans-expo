const express = require("express");
const router = express.Router();
const db = require("../db");
const { sendMail } = require("../utils/mailer");

// If you have controller implementations, prefer them
const controllers = require("../controllers/exhibitorsController") || {};
const registerExhibitorController = controllers.registerExhibitor;
const notifyAdminController = controllers.notifyAdmin;

/**
 * Small DB helper - works with mysql2/mariadb
 */
async function dbExec(sql, params = []) {
  if (!db) throw new Error("DB module not found");
  if (typeof db.execute === "function") return await db.execute(sql, params);
  if (typeof db.query === "function") return await db.query(sql, params);
  throw new Error("DB has no execute or query method");
}

/**
 * Helpers for normalizing driver results
 */
function normalizeRows(rows) {
  if (!rows && rows !== 0) return [];

  if (Array.isArray(rows)) {
    // mysql2 often returns [rows, fields]
    if (rows.length >= 1 && Array.isArray(rows[0])) return rows[0];
    if (rows.length === 1 && Array.isArray(rows[0])) return rows[0];
    return rows;
  }

  if (typeof rows === "object") {
    const keys = Object.keys(rows);
    const numericKeys = keys.filter((k) => /^\d+$/.test(k));
    if (numericKeys.length > 0 && numericKeys.length === keys.length) {
      return numericKeys
        .map((k) => Number(k))
        .sort((a, b) => a - b)
        .map((n) => rows[String(n)]);
    }
    const allArrays = keys.length > 0 && keys.every((k) => Array.isArray(rows[k]));
    if (allArrays) {
      const lens = keys.map((k) => rows[k].length);
      const uniq = Array.from(new Set(lens));
      if (uniq.length === 1) {
        const len = uniq[0];
        const out = [];
        for (let i = 0; i < len; i++) {
          const r = {};
          for (const k of keys) r[k] = rows[k][i];
          out.push(r);
        }
        return out;
      }
    }
    const vals = Object.values(rows);
    if (Array.isArray(vals) && vals.length && typeof vals[0] === "object") return vals;
    return [rows];
  }

  return [];
}

function unwrapExecResult(execResult) {
  if (Array.isArray(execResult)) {
    if (execResult.length >= 1) return execResult[0];
    return execResult;
  }
  return execResult;
}

function getAffectedRows(info) {
  if (!info) return 0;
  return info.affectedRows ?? info.affected_rows ?? info.affected ?? 0;
}

/* ---------- Routes ---------- */

/**
 * POST /api/exhibitors/step
 * Accept step snapshots from front-end (non-blocking)
 */
router.post("/step", async (req, res) => {
  try {
    console.debug("[exhibitors] step snapshot:", req.body);
    return res.json({ success: true });
  } catch (err) {
    console.error("[exhibitors] step error:", err && (err.stack || err));
    return res.status(500).json({ success: false, error: "Failed to record step" });
  }
});

/**
 * POST /api/exhibitors
 * - Prefer controller.registerExhibitor if available (passes req,res)
 * - Otherwise fallback to in-file implementation that inserts row and sends emails
 */
router.post("/", async (req, res) => {
  // Delegate to controller if implemented
  if (typeof registerExhibitorController === "function") {
    try {
      // controller may send response itself
      return await registerExhibitorController(req, res);
    } catch (err) {
      console.error("[exhibitors] controller registerExhibitor threw:", err && (err.stack || err));
      // fall through to fallback implementation
    }
  }

  // Fallback insertion implementation
  let conn;
  try {
    const body = req.body || {};
    console.info("[exhibitors] create payload:", Object.keys(body).length ? body : "(empty)");

    // tolerant pick for company / other
    const pick = (keys = []) => {
      for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined && body[k] !== null && String(body[k]).trim() !== "") return String(body[k]).trim();
      }
      // case-insensitive
      for (const bk of Object.keys(body)) {
        for (const k of keys) {
          if (bk.toLowerCase() === String(k).toLowerCase() && body[bk] !== undefined && body[bk] !== null && String(body[bk]).trim() !== "") {
            return String(body[bk]).trim();
          }
        }
      }
      return "";
    };

    const companyVal = pick(["companyName", "company", "company_name", "companyname", "organization", "org"]);
    const otherVal = pick(["other", "other_company", "otherCompany"]);

    if (!companyVal && !otherVal) {
      return res.status(400).json({ success: false, error: "companyName is required", message: "Provide companyName or other" });
    }

    // Allowed fields mapping - only include if present
    const FIELD_MAP = {
      surname: "surname",
      name: "name",
      email: "email",
      mobile: "mobile",
      designation: "designation",
      category: "category",
      spaceType: "space_type",
      space_size: "space_size",
      boothType: "boothType",
      productDetails: "productDetails",
      notes: "notes",
      address: "address"
    };

    // Build columns/values dynamically
    const columns = [];
    const values = [];
    for (const [inputKey, dbCol] of Object.entries(FIELD_MAP)) {
      const val = body[inputKey] ?? body[inputKey.toLowerCase()];
      if (typeof val !== "undefined" && val !== null && String(val).trim() !== "") {
        columns.push(dbCol);
        values.push(String(val).trim());
      }
    }

    // company: prefer column company_name or company depending on schema
    // We'll insert into 'company' if exists; otherwise 'company_name' if exists; otherwise include as 'notes'
    // To detect columns, use SHOW COLUMNS
    conn = await dbExec("SHOW COLUMNS FROM exhibitors");
    const colRows = unwrapExecResult(conn);
    const colNames = (Array.isArray(colRows) ? colRows : []).map(r => (r.Field || r.COLUMN_NAME || "").toLowerCase());
    const has = (n) => colNames.includes(n.toLowerCase());

    if (has("company")) {
      columns.push("company");
      values.push(companyVal);
    } else if (has("company_name")) {
      columns.push("company_name");
      values.push(companyVal);
    } else if (has("organization")) {
      columns.push("organization");
      values.push(companyVal);
    } else if (has("notes")) {
      columns.push("notes");
      values.push(companyVal);
    } else {
      // no place to store company - return a clear error so user can migrate DB
      return res.status(500).json({
        success: false,
        error: "No column available for company",
        detail: "Add a column (company or company_name) to exhibitors table or update server mapping"
      });
    }

    // other -> store in 'other' if exists, otherwise 'notes' appended
    if (otherVal) {
      if (has("other")) { columns.push("other"); values.push(otherVal); }
      else if (has("notes")) { columns.push("notes"); values.push(otherVal); }
    }

    if (!columns.length) return res.status(400).json({ success: false, error: "No valid fields to insert" });

    // Insert using parameterized query via db.query / execute
    // Use db.query directly since dbExec was used above returning result for SHOW COLUMNS
    const placeholders = columns.map(() => "?").join(", ");
    const sql = `INSERT INTO exhibitors (${columns.join(",")}) VALUES (${placeholders})`;
    const insertRes = await dbExec(sql, values);
    const info = unwrapExecResult(insertRes);
    const insertedId = info && (info.insertId || info.insert_id) ? (info.insertId || info.insert_id) : (Array.isArray(insertRes) && insertRes[0] && insertRes[0].insertId ? insertRes[0].insertId : null);

    // respond immediately and then send emails in background (but attempt here to send and include status)
    const response = { success: true, insertedId: insertedId || null, id: insertedId || null };
    res.status(201).json(response);

    // background: send acknowledgement to exhibitor if email present
    (async () => {
      try {
        // fetch the inserted row to get canonical fields if needed
        if (!insertedId) return;
        const raw = await dbExec("SELECT * FROM exhibitors WHERE id = ? LIMIT 1", [insertedId]);
        const rows = normalizeRows(raw);
        const saved = rows && rows.length ? rows[0] : null;
        const to = saved?.email || body.email || null;
        if (to) {
          const name = saved?.name || saved?.company || companyVal || "";
          const subject = "RailTrans Expo — We received your exhibitor request";
          const text = `Hello ${name},

Thank you for your exhibitor request. We have received your details and our team will get back to you soon.

Regards,
RailTrans Expo Team`;
          const html = `<p>Hello ${name},</p><p>Thank you for your exhibitor request. We have received your details and our team will get back to you soon.</p><p>Regards,<br/>RailTrans Expo Team</p>`;
          await sendMail({ to, subject, text, html });
          console.debug("[exhibitors] ack email sent to", to);
        } else {
          console.debug("[exhibitors] no email to send ack to");
        }

        // notify admins
        const adminList = (process.env.EXHIBITOR_ADMIN_EMAILS || process.env.ADMIN_EMAILS || "")
          .split(",").map(s => s.trim()).filter(Boolean);
        if (adminList.length) {
          const subject = `New exhibitor registration — ID: ${insertedId}`;
          const html = `<p>New exhibitor registered.</p><pre>${JSON.stringify(saved || body, null, 2)}</pre>`;
          const text = `New exhibitor\n${JSON.stringify(saved || body, null, 2)}`;
          await Promise.all(adminList.map(async (addr) => {
            try {
              await sendMail({ to: addr, subject, text, html });
            } catch (e) {
              console.error("[exhibitors] admin notify error to", addr, e && (e.message || e));
            }
          }));
        } else {
          console.debug("[exhibitors] no admin emails configured");
        }
      } catch (e) {
        console.error("[exhibitors] background email error:", e && (e.stack || e));
      }
    })();

    return;
  } catch (err) {
    console.error("[exhibitors] register fallback error:", err && (err.stack || err));
    return res.status(500).json({ success: false, error: "Server error registering exhibitor", detail: err && err.message ? err.message : String(err) });
  }
});

/**
 * POST /api/exhibitors/notify
 * - prefer controller.notifyAdmin if available, otherwise send admin emails based on provided form or id
 */
router.post("/notify", async (req, res) => {
  if (typeof notifyAdminController === "function") {
    try {
      return await notifyAdminController(req, res);
    } catch (err) {
      console.error("[exhibitors] notify controller threw:", err && (err.stack || err));
      // fall through to fallback
    }
  }

  try {
    const { exhibitorId, form } = req.body || {};
    let exhibitor = null;
    if (exhibitorId) {
      const raw = await dbExec("SELECT * FROM exhibitors WHERE id = ? LIMIT 1", [exhibitorId]);
      const rows = normalizeRows(raw);
      exhibitor = rows && rows.length ? rows[0] : null;
    } else if (form) exhibitor = form;

    if (!exhibitor) return res.status(400).json({ success: false, error: "exhibitorId or form required" });

    const to = exhibitor.email || exhibitor.contactEmail || exhibitor.emailAddress;
    const subject = "RailTrans Expo — Notification";
    const text = `Hello,\n\nThis is a notification regarding your exhibitor registration.\n\nRegards,\nRailTrans Expo Team`;
    const html = `<p>Hello,</p><p>This is a notification regarding your exhibitor registration.</p>`;

    const results = { partnerMail: null, adminResults: [] };
    if (to) {
      try {
        const r = await sendMail({ to, subject, text, html });
        results.partnerMail = { to, result: r };
      } catch (e) {
        results.partnerMail = { to, error: e && (e.message || String(e)) };
      }
    }

    const adminList = (process.env.EXHIBITOR_ADMIN_EMAILS || process.env.ADMIN_EMAILS || "")
      .split(",").map(s => s.trim()).filter(Boolean);
    for (const addr of adminList) {
      try {
        const r = await sendMail({ to: addr, subject: `Exhibitor notify — ${exhibitorId || ''}`, text: `Exhibitor\n${JSON.stringify(exhibitor, null, 2)}`, html: `<pre>${JSON.stringify(exhibitor, null, 2)}</pre>` });
        results.adminResults.push({ to: addr, result: r });
      } catch (e) {
        results.adminResults.push({ to: addr, error: e && (e.message || String(e)) });
      }
    }

    return res.json({ success: true, results });
  } catch (err) {
    console.error("[exhibitors] notify fallback error:", err && (err.stack || err));
    return res.status(500).json({ success: false, error: "Server error sending notifications", detail: err && err.message ? err.message : String(err) });
  }
});

/* ---------- Read / Update / Delete endpoints (same defensive behavior as before) ---------- */

router.get("/", async (req, res) => {
  try {
    const raw = await dbExec("SELECT * FROM exhibitors ORDER BY id DESC");
    const rows = normalizeRows(raw);
    res.json(rows);
  } catch (err) {
    console.error("Fetch exhibitors error:", err && (err.stack || err));
    res.status(500).json({ error: "Failed to fetch exhibitors" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const raw = await dbExec("SELECT * FROM exhibitors WHERE id = ? LIMIT 1", [req.params.id]);
    const rows = normalizeRows(raw);
    res.json(rows && rows.length ? rows[0] : {});
  } catch (err) {
    console.error("Fetch exhibitor error:", err && (err.stack || err));
    res.status(500).json({ error: "Failed to fetch exhibitor" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const fields = { ...(req.body || {}) };
    delete fields.id;
    const keys = Object.keys(fields);
    if (keys.length === 0) return res.status(400).json({ success: false, error: "No fields to update" });

    const colRes = await dbExec("SHOW COLUMNS FROM exhibitors");
    const colRows = unwrapExecResult(colRes);
    const colMap = new Map((Array.isArray(colRows) ? colRows : []).map(r => [String(r.Field || r.COLUMN_NAME || "").toLowerCase(), r.Field || r.COLUMN_NAME || r]));

    const assignments = [];
    const values = [];
    const camelToSnake = (s = "") => String(s).replace(/([A-Z])/g, "_$1").toLowerCase();

    for (const k of keys) {
      const cand = colMap.get(k.toLowerCase()) ?? colMap.get(camelToSnake(k).toLowerCase());
      if (cand) {
        let v = fields[k];
        if (v !== null && typeof v === "object") {
          try { v = JSON.stringify(v); } catch { v = String(v); }
        }
        assignments.push(`${cand} = ?`);
        values.push(v);
      } else {
        console.debug(`[exhibitors] Ignoring update field "${k}" - not a column`);
      }
    }

    if (assignments.length === 0) return res.status(400).json({ success: false, error: "No valid fields to update" });

    values.push(req.params.id);
    const execRes = await dbExec(`UPDATE exhibitors SET ${assignments.join(", ")} WHERE id = ?`, values);
    const info = unwrapExecResult(execRes);
    const affected = getAffectedRows(info);
    if (affected === 0) return res.status(404).json({ success: false, error: "Exhibitor not found" });

    res.json({ success: true });
  } catch (err) {
    console.error("Exhibitor update error:", err && (err.stack || err));
    res.status(500).json({ success: false, error: "Failed to update exhibitor" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const execRes = await dbExec("DELETE FROM exhibitors WHERE id = ?", [req.params.id]);
    const info = unwrapExecResult(execRes);
    const affected = getAffectedRows(info);
    if (affected === 0) return res.status(404).json({ success: false, error: "Exhibitor not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("Exhibitor delete error:", err && (err.stack || err));
    res.status(500).json({ success: false, error: "Failed to delete exhibitor" });
  }
});

/* ---------- Approve / Cancel (keeps email notifications) ---------- */

router.post("/:id/approve", async (req, res) => {
  const id = req.params.id;
  const admin = req.body && req.body.admin ? String(req.body.admin) : "web-admin";
  if (!id) return res.status(400).json({ success: false, error: "Missing id" });

  try {
    let hasApprovedCols = false;
    try {
      const colCheck = await dbExec("SHOW COLUMNS FROM exhibitors LIKE 'approved_by'");
      const checkRows = normalizeRows(colCheck);
      hasApprovedCols = Array.isArray(checkRows) && checkRows.length > 0;
    } catch (e) {
      console.warn("Could not check approved_by column existence:", e && e.message);
      hasApprovedCols = false;
    }

    const sql = hasApprovedCols
      ? `UPDATE exhibitors SET status = 'approved', approved_by = ?, approved_at = NOW() WHERE id = ?`
      : `UPDATE exhibitors SET status = 'approved' WHERE id = ?`;
    const params = hasApprovedCols ? [admin, id] : [id];

    const execRes = await dbExec(sql, params);
    const info = unwrapExecResult(execRes);
    const affected = getAffectedRows(info);
    if (affected === 0) return res.status(404).json({ success: false, error: "Exhibitor not found" });

    const raw = await dbExec("SELECT * FROM exhibitors WHERE id = ? LIMIT 1", [id]);
    const rows = normalizeRows(raw);
    const updated = rows && rows.length ? rows[0] : null;

    res.json({ success: true, id, updated, mail: { exhibitor: null, admins: null } });

    // background email to exhibitor
    if (updated && updated.email) {
      (async () => {
        try {
          const to = updated.email;
          const name = updated.name || updated.company || "";
          const subject = `Your exhibitor request has been approved — RailTrans Expo`;
          const text = `Hello ${name},\n\nYour exhibitor registration (ID: ${updated.id}) has been approved.\n\nRegards,\nRailTrans Expo Team`;
          const html = `<p>Hello ${name},</p><p>Your exhibitor registration (ID: <strong>${updated.id}</strong>) has been <strong>approved</strong>.</p>`;
          const r = await sendMail({ to, subject, text, html });
          console.debug("[exhibitors] approval email sent:", to, r);
        } catch (e) {
          console.error("[exhibitors] approval email error:", e && (e.stack || e));
        }
      })();
    }

    // notify admins
    (async () => {
      try {
        const toAddrs = (process.env.EXHIBITOR_ADMIN_EMAILS || process.env.ADMIN_EMAILS || "").split(",").map(s => s.trim()).filter(Boolean);
        if (!toAddrs.length) return;
        const subject = `Exhibitor approved — ID: ${updated ? updated.id : id}`;
        const text = `Exhibitor approved\nID: ${updated ? updated.id : id}\nName: ${updated ? updated.name || updated.company || "" : ""}\nEmail: ${updated ? updated.email : ""}`;
        const html = `<p>Exhibitor approved</p><pre>${JSON.stringify(updated || {}, null, 2)}</pre>`;
        await Promise.all(toAddrs.map(addr => sendMail({ to: addr, subject, text, html }).catch(e => console.error("[exhibitors] admin email error:", addr, e && (e.message || e)))));
      } catch (e) {
        console.error("[exhibitors] admin notify error:", e && (e.stack || e));
      }
    })();

    return;
  } catch (err) {
    console.error("Approve exhibitor error:", err && (err.stack || err));
    const message = (err && (err.sqlMessage || err.message)) || "Server error approving exhibitor";
    return res.status(500).json({ success: false, error: message });
  }
});

router.post("/:id/cancel", async (req, res) => {
  const id = req.params.id;
  const admin = req.body && req.body.admin ? String(req.body.admin) : "web-admin";
  if (!id) return res.status(400).json({ success: false, error: "Missing id" });

  try {
    let hasCancelledCols = false;
    try {
      const colCheck = await dbExec("SHOW COLUMNS FROM exhibitors LIKE 'cancelled_by'");
      const checkRows = normalizeRows(colCheck);
      hasCancelledCols = Array.isArray(checkRows) && checkRows.length > 0;
    } catch (e) {
      console.warn("Could not check cancelled_by column existence:", e && e.message);
      hasCancelledCols = false;
    }

    const sql = hasCancelledCols
      ? `UPDATE exhibitors SET status = 'cancelled', cancelled_by = ?, cancelled_at = NOW() WHERE id = ?`
      : `UPDATE exhibitors SET status = 'cancelled' WHERE id = ?`;
    const params = hasCancelledCols ? [admin, id] : [id];

    const execRes = await dbExec(sql, params);
    const info = unwrapExecResult(execRes);
    const affected = getAffectedRows(info);
    if (affected === 0) return res.status(404).json({ success: false, error: "Exhibitor not found" });

    const raw = await dbExec("SELECT * FROM exhibitors WHERE id = ? LIMIT 1", [id]);
    const rows = normalizeRows(raw);
    const updated = rows && rows.length ? rows[0] : null;

    res.json({ success: true, id, updated });

    if (updated && updated.email) {
      (async () => {
        try {
          const to = updated.email;
          const name = updated.name || updated.company || "";
          const subject = `Your exhibitor registration has been cancelled — RailTrans Expo`;
          const text = `Hello ${name},\n\nYour exhibitor registration (ID: ${updated.id}) has been cancelled.\n\nRegards,\nRailTrans Expo Team`;
          const html = `<p>Hello ${name},</p><p>Your exhibitor registration (ID: <strong>${updated.id}</strong>) has been cancelled.</p>`;
          await sendMail({ to, subject, text, html });
        } catch (e) {
          console.error("[exhibitors] cancel email error:", e && (e.stack || e));
        }
      })();
    }

    // notify admins
    (async () => {
      try {
        const toAddrs = (process.env.EXHIBITOR_ADMIN_EMAILS || process.env.ADMIN_EMAILS || "").split(",").map(s => s.trim()).filter(Boolean);
        if (!toAddrs.length) return;
        const subject = `Exhibitor cancelled — ID: ${updated ? updated.id : id}`;
        const text = `Exhibitor cancelled\nID: ${updated ? updated.id : id}\nName: ${updated ? updated.name || updated.company || "" : ""}\nEmail: ${updated ? updated.email : ""}`;
        const html = `<p>Exhibitor cancelled</p><pre>${JSON.stringify(updated || {}, null, 2)}</pre>`;
        await Promise.all(toAddrs.map(addr => sendMail({ to: addr, subject, text, html }).catch(e => console.error("[exhibitors] admin cancel notify error:", addr, e && (e.message || e)))));
      } catch (e) {
        console.error("[exhibitors] admin cancel notify error:", e && (e.stack || e));
      }
    })();

    return;
  } catch (err) {
    console.error("Cancel exhibitor error:", err && (err.stack || err));
    const message = (err && (err.sqlMessage || err.message)) || "Server error cancelling exhibitor";
    return res.status(500).json({ success: false, error: message });
  }
});

module.exports = router;