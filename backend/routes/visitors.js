const express = require('express');
const router = express.Router();
const db = require('../db');
const { registerVisitor } = require('../controllers/visitorsController');
const { appendStep } = require('../controllers/fileLogger');

// Ensure JSON parsing for this router
router.use(express.json({ limit: '3mb' }));

function normalizeRows(rows) {
  if (!rows && rows !== 0) return [];
  if (Array.isArray(rows)) {
    if (rows.length >= 1 && Array.isArray(rows[0])) return rows[0];
    return rows;
  }
  if (typeof rows === 'object') {
    const keys = Object.keys(rows);
    const numericKeys = keys.filter(k => /^\d+$/.test(k));
    if (numericKeys.length > 0 && numericKeys.length === keys.length) {
      return numericKeys
        .map(k => Number(k))
        .sort((a, b) => a - b)
        .map(n => rows[String(n)]);
    }
    // column-oriented
    const allAreArrays = keys.length > 0 && keys.every(k => Array.isArray(rows[k]));
    if (allAreArrays) {
      const lengths = keys.map(k => rows[k].length);
      const unique = Array.from(new Set(lengths));
      if (unique.length === 1) {
        const len = unique[0];
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
    if (Array.isArray(vals) && vals.length && typeof vals[0] === 'object') return vals;
  }
  return [];
}

// POST registration (existing controller handles insert and returns insertedId + ticket_code)
router.post('/', registerVisitor);

// POST /step - accept arbitrary step snapshots and save to logs
router.post('/step', async (req, res) => {
  try {
    const { step, data, meta } = req.body || {};
    if (!step) return res.status(400).json({ success: false, error: 'Missing step' });
    const ok = await appendStep(step, data || {}, meta || {});
    if (!ok) return res.status(500).json({ success: false, error: 'Failed to save step file' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[visitors] /step error:', err);
    return res.status(500).json({ success: false, error: 'Server error', details: String(err && err.message ? err.message : err) });
  }
});

// GET all visitors
router.get('/', async (req, res) => {
  try {
    const raw = await db.query('SELECT * FROM visitors ORDER BY id DESC LIMIT 200');
    const rows = normalizeRows(raw);
    console.debug('[API] GET /api/visitors -> rows.length =', rows.length);
    console.debug('[API] sample visitors:', rows.slice(0, 3));
    return res.json(rows);
  } catch (err) {
    console.error('[visitors] GET error:', err);
    return res.status(500).json({ error: 'Failed to fetch visitors' });
  }
});

// GET single visitor by id
router.get('/:id', async (req, res) => {
  try {
    const raw = await db.query('SELECT * FROM visitors WHERE id = ?', [req.params.id]);
    const rows = normalizeRows(raw);
    return res.json(rows && rows.length ? rows[0] : {});
  } catch (err) {
    console.error('[visitors] GET/:id error:', err);
    return res.status(500).json({ error: 'Failed to fetch visitor' });
  }
});

/**
 * POST /api/visitors/:id/confirm
 * - Safely updates allowed visitor fields.
 * - Does NOT overwrite existing ticket_code unless force: true is provided.
 * - Whitelisted fields: ticket_code, ticket_category, txId, email, name, company, mobile, designation, slots
 */
router.post('/:id/confirm', async (req, res) => {
  try {
    const visitorId = req.params.id;
    if (!visitorId) return res.status(400).json({ success: false, error: 'Missing visitor id in URL' });

    console.log(`[visitors/:id/confirm] id=${visitorId} payload:`, req.body);

    const payload = { ...req.body };
    const force = !!payload.force;
    delete payload.force;

    // Load existing row
    const rowsRaw = await db.query('SELECT * FROM visitors WHERE id = ?', [visitorId]);
    const rows = normalizeRows(rowsRaw);
    const existing = rows && rows.length ? rows[0] : null;
    if (!existing) return res.status(404).json({ success: false, error: 'Visitor not found' });

    // Get table columns
    const colsRaw = await db.query("SHOW COLUMNS FROM visitors");
    const cols = Array.isArray(colsRaw[0]) ? colsRaw[0] : colsRaw;
    const allowedColumns = Array.isArray(cols) ? cols.map(c => c.Field) : [];

    // Whitelist of allowed update fields
    const whitelist = new Set(['ticket_code', 'ticket_category', 'txId', 'email', 'name', 'company', 'mobile', 'designation', 'slots']);

    const updateData = {};
    for (const k of Object.keys(payload || {})) {
      if (!whitelist.has(k)) continue;
      if (!allowedColumns.includes(k)) continue;
      updateData[k] = payload[k];
    }

    // Defensive ticket_code handling
    if ('ticket_code' in updateData) {
      const incomingCode = updateData.ticket_code ? String(updateData.ticket_code).trim() : "";
      const existingCode = existing.ticket_code ? String(existing.ticket_code).trim() : "";
      if (!incomingCode) {
        // remove empty ticket_code updates
        delete updateData.ticket_code;
      } else if (existingCode && !force && incomingCode !== existingCode) {
        // do not overwrite canonical code unless force=true
        console.log(`[visitors/:id/confirm] NOT overwriting existing ticket_code (${existingCode}) with incoming (${incomingCode}) - use force:true to override`);
        delete updateData.ticket_code;
      }
      // else: no existing code or force=true -> allow updateData.ticket_code
    }

    if (Object.keys(updateData).length === 0) {
      // nothing to update; return current row so client receives canonical values
      return res.json({ success: true, updated: existing, note: "No changes applied (ticket_code protected if present)" });
    }

    const assignments = Object.keys(updateData).map(k => `\`${k}\` = ?`).join(', ');
    const params = [...Object.values(updateData), visitorId];

    await db.query(`UPDATE visitors SET ${assignments} WHERE id = ?`, params);

    const afterRaw = await db.query('SELECT * FROM visitors WHERE id = ?', [visitorId]);
    const afterRows = normalizeRows(afterRaw);
    const updated = afterRows && afterRows.length ? afterRows[0] : null;

    console.log(`[visitors/:id/confirm] updated row for id=${visitorId}:`, updated);
    return res.json({ success: true, updated });
  } catch (err) {
    console.error('[visitors] POST /:id/confirm error:', err && (err.stack || err));
    return res.status(500).json({ success: false, error: 'Failed to update visitor' });
  }
});

module.exports = router;