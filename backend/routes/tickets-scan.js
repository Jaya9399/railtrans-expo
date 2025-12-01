const express = require("express");
const router = express.Router();
const pool = require("../db");
const fs = require("fs");
const PDFDocument = require("pdfkit");

// optional server-side QR generator
let QRCode = null;
try { QRCode = require("qrcode"); } catch (e) { QRCode = null; }

// optional existing badge generator
let generateVisitorBadgePDF = null;
try { generateVisitorBadgePDF = require("../utils/pdfGenerator").generateVisitorBadgePDF; } catch (e) { generateVisitorBadgePDF = null; }

/* ---------- DB helpers ---------- */
async function getConn() {
  if (!pool) throw new Error("DB pool not found");
  if (typeof pool.getConnection === "function") {
    const conn = await pool.getConnection();
    return { conn, release: () => conn.release && conn.release() };
  }
  return { conn: pool, release: () => {} };
}

async function execQuery(conn, sql, params = []) {
  if (!conn) throw new Error("no db connection");
  if (typeof conn.execute === "function") {
    const r = await conn.execute(sql, params);
    return Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r;
  }
  if (typeof conn.query === "function") {
    const r = await conn.query(sql, params);
    return Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r;
  }
  throw new Error("DB driver has no execute/query");
}

function normalizeRows(rows) {
  if (!rows && rows !== 0) return [];
  if (Array.isArray(rows)) return rows;
  if (typeof rows === "object") return [rows];
  return [];
}

/* ---------- ticket id extractor ---------- */
function tryParseJsonSafe(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}
function looksLikeBase64(s) {
  if (typeof s !== "string") return false;
  const s2 = s.replace(/\s+/g, "");
  return /^[A-Za-z0-9+/=]+$/.test(s2) && (s2.length % 4 === 0);
}
function extractTicketIdFromObject(obj) {
  if (!obj || typeof obj !== "object") return null;
  // expanded preference list to include many variants
  const prefer = ["ticket_code","ticketCode","ticket_id","ticketId","ticket","ticketNo","ticketno","ticketid","ticketId","code","c","id","tk","t"];
  for (const k of prefer) {
    if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null && String(obj[k]).trim() !== "") {
      return String(obj[k]).trim();
    }
  }
  // deep scan
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === "object") {
      const found = extractTicketIdFromObject(v);
      if (found) return found;
    }
    if (Array.isArray(obj[k])) {
      for (const item of obj[k]) {
        if (item && typeof item === "object") {
          const found = extractTicketIdFromObject(item);
          if (found) return found;
        }
      }
    }
  }
  return null;
}
function extractTicketId(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // plain token
  if (/^[A-Za-z0-9\-_\.]{3,64}$/.test(s)) return s;
  // JSON
  let obj = tryParseJsonSafe(s);
  if (obj) {
    const id = extractTicketIdFromObject(obj);
    if (id) return id;
  }
  // base64 -> json
  if (looksLikeBase64(s)) {
    try {
      const decoded = Buffer.from(s, "base64").toString("utf8");
      obj = tryParseJsonSafe(decoded);
      if (obj) {
        const id = extractTicketIdFromObject(obj);
        if (id) return id;
      }
    } catch (e) {}
  }
  // JSON substring
  const jsonMatch = s.match(/\{.*\}/s);
  if (jsonMatch) {
    obj = tryParseJsonSafe(jsonMatch[0]);
    if (obj) {
      const id = extractTicketIdFromObject(obj);
      if (id) return id;
    }
  }
  // digits fallback
  const digits = s.match(/\d{4,12}/);
  if (digits) return digits[0];
  return null;
}

/* ---------- Helper: candidate ticket-like columns (fuzzy) ---------- */
async function getTicketColumnsForTable(conn, tableName) {
  try {
    const colsRaw = await execQuery(conn, `SHOW COLUMNS FROM \`${tableName}\``);
    const cols = normalizeRows(colsRaw).map(r => (r.Field || r.field || Object.values(r)[0] || '').toString());
    // pick columns that likely contain ticket id (case-insensitive)
    const ticketRegex = /^(ticket[_]?code|ticket[_]?id|ticketcode|ticketid|ticketno|code|c)$/i;
    const matches = cols.filter(c => ticketRegex.test(c));
    // also include columns explicitly named 'id' only as last-resort (we won't match id=code normally)
    // return matches (may be empty)
    return matches;
  } catch (e) {
    return [];
  }
}

/* ---------- Helper: try to find a ticket row in a table ---------- */
async function findInTable(conn, tableName, ticketKey) {
  const ticketCols = await getTicketColumnsForTable(conn, tableName);
  if (!ticketCols || ticketCols.length === 0) {
    // no candidate columns
    console.debug(`[tickets.scan] no ticket-like columns found in ${tableName}`);
    return null;
  }

  // Build WHERE clause: (`col1` = ? OR `col2` = ? ...)
  const whereExpr = ticketCols.map(c => `\`${c}\` = ?`).join(" OR ");
  const params = ticketCols.map(() => ticketKey);

  try {
    const sql = `SELECT * FROM \`${tableName}\` WHERE ${whereExpr} LIMIT 1`;
    console.debug(`[tickets.scan] query ${tableName} with columns:`, ticketCols, "sql:", sql);
    const rowsRaw = await execQuery(conn, sql, params);
    const rows = normalizeRows(rowsRaw);
    return rows[0] || null;
  } catch (err) {
    console.warn(`[tickets.scan] findInTable ${tableName} query failed:`, err && (err.message || err));
    return null;
  }
}
// Add this near top of file (after helper functions) in backend/routes/tickets.js

// POST /api/tickets/validate
// Body: { ticketId } or { raw } — extracts ticket id and returns ticket metadata if found
router.post("/validate", express.json({ limit: "2mb" }), async (req, res) => {
  const { ticketId, raw } = req.body || {};
  const incoming = ticketId || raw;
  if (!incoming) return res.status(400).json({ success: false, error: "ticketId or raw payload required" });

  const ticketKey = extractTicketId(incoming);
  if (!ticketKey) return res.status(400).json({ success: false, error: "Could not extract ticket id from payload" });

  let dbWrap;
  try {
    dbWrap = await getConn();
    const conn = dbWrap.conn;

    // 1) Try tickets table (if exists)
    try {
      const ticketCols = await getTicketColumnsForTable(conn, "tickets");
      if (ticketCols.length > 0) {
        const whereExpr = ticketCols.map(c => `\`${c}\` = ?`).join(" OR ");
        const params = ticketCols.map(() => ticketKey);
        const rowsRaw = await execQuery(conn, `SELECT * FROM \`tickets\` WHERE ${whereExpr} LIMIT 1`, params);
        const rows = normalizeRows(rowsRaw);
        if (rows && rows.length) {
          const found = rows[0];
          const ticket = {
            ticket_code: found.ticket_code || found.code || found.c || ticketKey,
            entity_type: found.entity_type || null,
            entity_id: found.entity_id || null,
            name: found.name || found.n || null,
            email: found.email || found.e || null,
            company: found.company || found.org || null,
            category: found.category || found.ticket_category || null,
            raw_row: found,
          };
          return res.json({ success: true, ticket });
        }
      }
    } catch (e) {
      console.warn("[tickets.validate] tickets table check failed:", e && (e.message || e));
    }

    // 2) Try speakers, visitors, partners
    const tables = ["speakers", "visitors", "partners"];
    for (const table of tables) {
      try {
        const row = await findInTable(conn, table, ticketKey);
        if (row) {
          const ticket = {
            ticket_code: row.ticket_code || row.code || row.c || ticketKey,
            entity_type: table.slice(0, -1),
            entity_id: row.id || row.ID || null,
            name: row.name || row.full_name || row.n || null,
            email: row.email || row.e || null,
            company: row.company || row.org || row.organization || null,
            category: row.ticket_category || row.category || row.cat || null,
            txId: row.txId || row.tx_id || null,
            payment_status: row.payment_status || row.status || null,
            raw_row: row,
          };
          return res.json({ success: true, ticket });
        }
      } catch (e) {
        console.warn(`[tickets.validate] lookup ${table} failed:`, e && (e.message || e));
      }
    }

    return res.status(404).json({ success: false, error: "Ticket not found" });
  } catch (err) {
    console.error("tickets/validate error:", err && (err.stack || err));
    return res.status(500).json({ success: false, error: "Server error" });
  } finally {
    try { if (dbWrap && dbWrap.release) dbWrap.release(); } catch {}
  }
});

/* ---------- Main scan route (robust lookup across tables) ---------- */
/**
 * POST /api/tickets/scan
 * Body: { ticketId } OR { raw } (raw is the scanned QR string)
 *
 * Behavior:
 * - Extract ticketKey from incoming payload (many formats)
 * - First look in tickets table (if exists) by any ticket-like columns
 * - Then look into speakers, visitors, partners by ticket-like columns
 * - Return PDF when found (or 404 when not)
 */
router.post("/scan", express.json({ limit: "2mb" }), async (req, res) => {
  const { ticketId, raw } = req.body || {};
  const incoming = ticketId || raw;
  if (!incoming) return res.status(400).json({ success: false, error: "ticketId or raw payload required" });

  const ticketKey = extractTicketId(incoming);
  if (!ticketKey) {
    return res.status(400).json({ success: false, error: "Could not extract ticket id from payload" });
  }

  let dbWrap;
  try {
    dbWrap = await getConn();
    const conn = dbWrap.conn;

    // 1) Try tickets table first (if exists)
    try {
      const ticketCols = await getTicketColumnsForTable(conn, "tickets");
      if (ticketCols.length > 0) {
        const whereExpr = ticketCols.map(c => `\`${c}\` = ?`).join(" OR ");
        const params = ticketCols.map(() => ticketKey);
        const rowsRaw = await execQuery(conn, `SELECT * FROM \`tickets\` WHERE ${whereExpr} LIMIT 1`, params);
        const rows = normalizeRows(rowsRaw);
        if (rows && rows.length) {
          const found = rows[0];
          console.log("[tickets.scan] matched tickets table row:", { ticketKey });
          const ticket = {
            ticket_code: found.ticket_code || found.code || found.c || ticketKey,
            entity_type: found.entity_type || null,
            entity_id: found.entity_id || null,
            name: found.name || found.n || null,
            email: found.email || found.e || null,
            company: found.company || found.org || null,
            category: found.category || found.ticket_category || null,
            raw_row: found,
          };
          return await respondWithPdf(ticket, conn, dbWrap, res);
        }
      }
    } catch (e) {
      console.warn("[tickets.scan] tickets table check failed:", e && (e.message || e));
    }

    // 2) Try speakers, visitors, partners
    const tables = ["speakers", "visitors", "partners"];
    for (const table of tables) {
      try {
        const row = await findInTable(conn, table, ticketKey);
        if (row) {
          const ticket = {
            ticket_code: row.ticket_code || row.code || row.c || ticketKey,
            entity_type: table.slice(0, -1),
            entity_id: row.id || row.ID || null,
            name: row.name || row.full_name || row.n || null,
            email: row.email || row.e || null,
            company: row.company || row.org || row.organization || null,
            category: row.ticket_category || row.category || row.cat || null,
            txId: row.txId || row.tx_id || null,
            payment_status: row.payment_status || row.status || null,
            raw_row: row,
          };
          console.log(`[tickets.scan] matched ${table} row id=${ticket.entity_id} ticket=${ticket.ticket_code}`);
          return await respondWithPdf(ticket, conn, dbWrap, res);
        }
      } catch (e) {
        console.warn(`[tickets.scan] lookup ${table} failed:`, e && (e.message || e));
      }
    }

    // not found
    return res.status(404).json({ success: false, error: "Ticket not found" });
  } catch (err) {
    console.error("tickets/scan top-level error:", err && (err.stack || err));
    return res.status(500).json({ success: false, error: "Server error" });
  } finally {
    try { if (dbWrap && dbWrap.release) dbWrap.release(); } catch {}
  }
});

/* ---------- Helper that validates and returns PDF (shared) ---------- */
async function respondWithPdf(ticket, conn, dbWrap, res) {
  // Optionally validate payment status
  const paidStatuses = ["paid", "captured", "success", "completed"];
  const category = (ticket.category || "").toString().toLowerCase();
  const isFree = /free|general|0/.test(category);
  const pstatus = (ticket.payment_status || ticket.status || "").toString().toLowerCase();
  if (!isFree && pstatus && !paidStatuses.includes(pstatus)) {
    return res.status(402).json({ success: false, error: "Ticket not paid" });
  }

  // mark printed in tickets table if exists (best-effort)
  try {
    await execQuery(conn, "UPDATE tickets SET printed_at = NOW(), used = 1 WHERE ticket_code = ?", [ticket.ticket_code]);
  } catch (e) {}

  // Generate PDF using server utility if available
  if (generateVisitorBadgePDF) {
    try {
      const pdfResult = await generateVisitorBadgePDF(ticket, process.env.BADGE_TEMPLATE_URL || "", {
        includeQRCode: true,
        qrPayload: { ticket_code: ticket.ticket_code },
        event: {
          name: process.env.EVENT_NAME || "RailTrans Expo",
          date: process.env.EVENT_DATE || "",
          venue: process.env.EVENT_VENUE || "",
        },
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename=ticket-${ticket.ticket_code}.pdf`);
      if (pdfResult && typeof pdfResult.pipe === "function") { pdfResult.pipe(res); return; }
      if (Buffer.isBuffer(pdfResult)) { res.end(pdfResult); return; }
      if (typeof pdfResult === "string" && pdfResult.startsWith("data:application/pdf;base64,")) {
        const b64 = pdfResult.split(",")[1];
        res.end(Buffer.from(b64, "base64"));
        return;
      }
      return res.status(500).json({ success: false, error: "PDF generator returned unsupported result" });
    } catch (e) {
      console.warn("generateVisitorBadgePDF failed, falling back to pdfkit:", e && (e.message || e));
    }
  }

  // pdfkit fallback
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename=ticket-${ticket.ticket_code}.pdf`);
  const doc = new PDFDocument({ size: [300, 450], margin: 12 });
  doc.pipe(res);
  doc.rect(0, 0, doc.page.width, doc.page.height).fill("#ffffff");
  doc.fontSize(12).fillColor("#196e87").font("Helvetica-Bold").text(process.env.EVENT_NAME || "RailTrans Expo", { align: "center" });
  doc.moveDown(2);
  doc.fontSize(18).fillColor("#000000").font("Helvetica-Bold").text(ticket.name || ticket.company || "", { align: "center" });
  if (ticket.company) { doc.moveDown(0.5); doc.fontSize(11).fillColor("#555").text(ticket.company, { align: "center" }); }
  if (QRCode) {
    try {
      const qrDataUrl = await QRCode.toDataURL(ticket.ticket_code, { margin: 1, width: 140 });
      const base64 = qrDataUrl.split(",")[1];
      const qrBuf = Buffer.from(base64, "base64");
      const qrW = 120;
      doc.image(qrBuf, (doc.page.width - qrW) / 2, doc.y + 8, { width: qrW, height: qrW });
    } catch (e) {}
  } else {
    const boxSize = 120;
    doc.rect((doc.page.width - boxSize) / 2, doc.y + 8, boxSize, boxSize).stroke("#ccc");
  }
  const barHeight = 48;
  const barY = doc.page.height - barHeight - 12;
  doc.rect(0, barY, doc.page.width, barHeight).fill("#e54b4b");
  doc.fillColor("#fff").fontSize(12).text(((ticket.category || "DELEGATE") + "").toUpperCase(), 0, barY + 14, { align: "center" });
  doc.fontSize(8).fillColor("#fff").text(`Ticket: ${ticket.ticket_code}`, 8, barY + barHeight - 14);
  doc.end();
}

module.exports = router;