const express = require('express');
const router = express.Router();
const db = require('../db');
const { registerAwardee } = require('../controllers/awardeesController');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' }); // adjust storage/settings as needed

// ensure JSON body parsing
router.use(express.json({ limit: '3mb' }));

/**
 * POST /api/awardees
 * Create a new awardee (controller generates ticket_code and returns it)
 */
router.post('/', registerAwardee);

/**
 * GET /api/awardees
 * List awardees (optional ?limit=)
 */
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit || '200', 10)));
    const rowsRaw = await db.query('SELECT * FROM awardees ORDER BY id DESC LIMIT ?', [limit]);
    const rows = Array.isArray(rowsRaw[0]) ? rowsRaw[0] : rowsRaw;
    return res.json(rows);
  } catch (err) {
    console.error('[awardees] GET / error:', err && (err.stack || err));
    return res.status(500).json({ error: 'Failed to fetch awardees' });
  }
});

/**
 * GET /api/awardees/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const rowsRaw = await db.query('SELECT * FROM awardees WHERE id = ?', [req.params.id]);
    const rows = Array.isArray(rowsRaw[0]) ? rowsRaw[0] : rowsRaw;
    return res.json(rows && rows.length ? rows[0] : {});
  } catch (err) {
    console.error('[awardees] GET/:id error:', err && (err.stack || err));
    return res.status(500).json({ error: 'Failed to fetch awardee' });
  }
});

/**
 * POST /api/awardees/:id/confirm
 * - Safely updates allowed fields
 * - Does NOT overwrite existing ticket_code unless force: true is provided
 */
router.post('/:id/confirm', async (req, res) => {
  try {
    const id = req.params.id;
    const payload = { ...req.body };
    const force = !!payload.force;
    delete payload.force;

    // load existing row
    const rowsRaw = await db.query('SELECT * FROM awardees WHERE id = ?', [id]);
    const rows = Array.isArray(rowsRaw[0]) ? rowsRaw[0] : rowsRaw;
    const existing = rows && rows.length ? rows[0] : null;
    if (!existing) return res.status(404).json({ success: false, error: 'Awardee not found' });

    // read table columns
    const colsRaw = await db.query("SHOW COLUMNS FROM awardees");
    const cols = Array.isArray(colsRaw[0]) ? colsRaw[0] : colsRaw;
    const allowedColumns = Array.isArray(cols) ? cols.map(c => c.Field) : [];

    const whitelist = new Set(['ticket_code','ticket_category','txId','email','name','organization','mobile','designation','awardType','awardOther','bio']);
    const updateData = {};
    for (const k of Object.keys(payload || {})) {
      if (!whitelist.has(k)) continue;
      if (!allowedColumns.includes(k)) continue;
      updateData[k] = payload[k];
    }

    // defensive ticket_code handling
    if ('ticket_code' in updateData) {
      const incoming = updateData.ticket_code ? String(updateData.ticket_code).trim() : "";
      const existingCode = existing.ticket_code ? String(existing.ticket_code).trim() : "";
      if (!incoming) {
        delete updateData.ticket_code;
      } else if (existingCode && !force && incoming !== existingCode) {
        console.log(`[awardees/:id/confirm] NOT overwriting existing ticket_code (${existingCode}) with incoming (${incoming}) - use force:true to override`);
        delete updateData.ticket_code;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return res.json({ success: true, updated: existing, note: "No changes applied (ticket_code protected)" });
    }

    const assignments = Object.keys(updateData).map(k => `\`${k}\` = ?`).join(', ');
    const params = [...Object.values(updateData), id];
    await db.query(`UPDATE awardees SET ${assignments} WHERE id = ?`, params);

    const afterRaw = await db.query('SELECT * FROM awardees WHERE id = ?', [id]);
    const afterRows = Array.isArray(afterRaw[0]) ? afterRaw[0] : afterRaw;
    const updated = afterRows && afterRows.length ? afterRows[0] : null;
    return res.json({ success: true, updated });
  } catch (err) {
    console.error('[awardees] POST /:id/confirm error:', err && (err.stack || err));
    return res.status(500).json({ success: false, error: 'Failed to update awardee' });
  }
});

/**
 * PUT /api/awardees/:id
 * Generic update (skip id/title fields, handle datetime normalization)
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

    const columnsResultRaw = await db.query("SHOW COLUMNS FROM awardees");
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
    await db.query(`UPDATE awardees SET ${assignments} WHERE id=?`, [...Object.values(updateData), req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Update awardee error:', err && (err.stack || err));
    res.status(500).json({ success: false, error: 'Failed to update awardee', details: err.message });
  }
});

/**
 * POST /api/awardees/:id/upload-proof
 * Accept a manual payment proof file (multipart/form-data) using multer
 */
router.post('/:id/upload-proof', upload.single('proof'), async (req, res) => {
  try {
    // req.file contains uploaded file info (dest: uploads/)
    // Save filename/path in awardees table if desired
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
    // store proof path (best-effort)
    try {
      await db.query('UPDATE awardees SET proof_path = ? WHERE id = ?', [req.file.path, req.params.id]);
    } catch (e) { console.warn('saving proof path failed', e); }
    return res.json({ success: true, file: req.file });
  } catch (err) {
    console.error('upload-proof error', err && (err.stack || err));
    return res.status(500).json({ success: false, error: 'Failed to upload proof' });
  }
});

/**
 * GET /api/awardees/stats
 * Basic statistics for admin panels
 */
router.get('/stats', async (req, res) => {
  try {
    const sql = `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN COALESCE(txId,'') <> '' THEN 1 ELSE 0 END) AS paid,
        SUM(CASE WHEN COALESCE(ticket_category,'') REGEXP 'free|general|0' THEN 1 ELSE 0 END) AS free
      FROM awardees
    `;
    const rowsRaw = await db.query(sql);
    const rows = Array.isArray(rowsRaw[0]) ? rowsRaw[0] : rowsRaw;
    return res.json(rows && rows[0] ? rows[0] : { total: 0, paid: 0, free: 0 });
  } catch (err) {
    console.error('awardees stats error', err && (err.stack || err));
    return res.status(500).json({ error: 'Failed to compute stats' });
  }
});

/**
 * DELETE /api/awardees/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM awardees WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/awardees/:id error', err && (err.stack || err));
    res.status(500).json({ success: false, error: 'Failed to delete awardee' });
  }
});

module.exports = router;