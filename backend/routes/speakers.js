const express = require('express');
const router = express.Router();
const db = require('../db');
const { registerSpeaker } = require('../controllers/speakersController');

/**
 * Create new speaker (existing)
 */
router.post('/', registerSpeaker);

/**
 * Get all speakers
 */
router.get('/', async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM speakers');
    res.json(rows);
  } catch (err) {
    console.error('GET /api/speakers error:', err);
    res.status(500).json({ error: 'Failed to fetch speakers' });
  }
});

/**
 * Get speaker by id
 */
router.get('/:id', async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM speakers WHERE id = ?', [req.params.id]);
    res.json(Array.isArray(rows) && rows.length ? rows[0] : {});
  } catch (err) {
    console.error('GET /api/speakers/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch speaker' });
  }
});

/**
 * Confirm endpoint (defensive):
 * POST /api/speakers/:id/confirm
 * - Body may contain: ticket_code, ticket_category, txId, ...
 * - By default does NOT overwrite ticket_code if the DB already has one.
 * - To force overwrite pass { ticket_code, force: true } (use sparingly).
 */
router.post('/:id/confirm', express.json(), async (req, res) => {
  try {
    const speakerId = req.params.id;
    if (!speakerId) return res.status(400).json({ success: false, error: 'Missing speaker id in URL' });

    console.log(`[speakers/:id/confirm] id=${speakerId} payload:`, req.body);

    const payload = { ...req.body };
    const force = !!payload.force;
    delete payload.force;

    // Load existing row
    const rows = await db.query('SELECT * FROM speakers WHERE id = ?', [speakerId]);
    const existing = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!existing) return res.status(404).json({ success: false, error: 'Speaker not found' });

    // Determine allowed columns
    const colsRaw = await db.query("SHOW COLUMNS FROM speakers");
    const cols = Array.isArray(colsRaw[0]) ? colsRaw[0] : colsRaw;
    const allowedColumns = cols.map(c => c.Field);

    // Whitelist fields to update
    const whitelist = new Set(['ticket_code', 'ticket_category', 'txId', 'email', 'name', 'company', 'mobile', 'designation', 'slots']);

    const updateData = {};
    for (const k of Object.keys(payload || {})) {
      if (!whitelist.has(k)) continue;
      if (!allowedColumns.includes(k)) continue;
      updateData[k] = payload[k];
    }

    // Defensive: ticket_code handling
    if ('ticket_code' in updateData) {
      const incomingCode = updateData.ticket_code ? String(updateData.ticket_code).trim() : "";
      const existingCode = existing.ticket_code ? String(existing.ticket_code).trim() : "";
      if (!incomingCode) {
        // remove empty ticket_code from updates
        delete updateData.ticket_code;
      } else if (existingCode && !force && incomingCode !== existingCode) {
        // do not overwrite canonical server-generated code unless force=true
        console.log(`[speakers/:id/confirm] NOT overwriting existing ticket_code (${existingCode}) with incoming (${incomingCode}) - use force:true to override`);
        delete updateData.ticket_code;
      }
      // if no existing code or force=true, we allow updateData.ticket_code
    }

    if (Object.keys(updateData).length === 0) {
      // Nothing to update - return current row so client can get canonical code
      return res.json({ success: true, updated: existing, note: "No changes applied (ticket_code protected)" });
    }

    const assignments = Object.keys(updateData).map(k => `${k} = ?`).join(', ');
    const params = [...Object.values(updateData), speakerId];

    await db.query(`UPDATE speakers SET ${assignments} WHERE id = ?`, params);

    const after = await db.query('SELECT * FROM speakers WHERE id = ?', [speakerId]);
    const updated = Array.isArray(after) && after.length ? after[0] : null;

    console.log(`[speakers/:id/confirm] updated row for id=${speakerId}:`, updated);
    return res.json({ success: true, updated });
  } catch (err) {
    console.error('POST /api/speakers/:id/confirm error:', err && (err.stack || err));
    return res.status(500).json({ success: false, error: 'Failed to update speaker' });
  }
});

/**
 * General update (existing)
 */
router.put('/:id', async (req, res) => {
  function toMariaDbDatetime(val) {
    if (!val) return null;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(val)) return val;
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return null;
      return d.toISOString().replace('T',' ').substring(0,19);
    } catch {
      return null;
    }
  }
  try {
    const data = { ...req.body };
    delete data.id;
    delete data.title;

    const columnsResultRaw = await db.query("SHOW COLUMNS FROM speakers");
    const columnsResult = Array.isArray(columnsResultRaw[0]) ? columnsResultRaw[0] : columnsResultRaw;
    const allowedColumns = columnsResult.map(col => col.Field);

    const updateData = {};
    for (const key of Object.keys(data)) {
      if (allowedColumns.includes(key)) updateData[key] = data[key];
    }

    if (updateData.registered_at) updateData.registered_at = toMariaDbDatetime(updateData.registered_at);
    if (updateData.created_at) updateData.created_at = toMariaDbDatetime(updateData.created_at);

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ success: false, error: "No valid fields to update." });
    }

    const assignments = Object.keys(updateData).map(col => `${col}=?`).join(",");
    await db.query(`UPDATE speakers SET ${assignments} WHERE id=?`, [...Object.values(updateData), req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Update speaker error:', err);
    res.status(500).json({ success: false, error: 'Failed to update speaker', details: err.message });
  }
});

/**
 * Delete speaker
 */
router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM speakers WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/speakers/:id error:', err);
    res.status(500).json({ success: false, error: 'Failed to delete speaker' });
  }
});

module.exports = router;