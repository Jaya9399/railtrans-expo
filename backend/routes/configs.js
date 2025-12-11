const express = require('express');
const router = express.Router();
const mongo = require('../utils/mongoClient'); // expects getDb() or .db shape

/**
 * obtainDb()
 * Accept both mongo.getDb() (async) and mongo.db sync shapes.
 */
async function obtainDb() {
  if (!mongo) return null;
  if (typeof mongo.getDb === 'function') {
    const db = await mongo.getDb();
    return db;
  }
  if (mongo.db) return mongo.db;
  return null;
}

/**
 * GET /api/configs/:key
 * Returns the stored config for the given key (JSON value).
 */
router.get('/:key', async (req, res) => {
  try {
    const db = await obtainDb();
    if (!db) return res.status(500).json({ success: false, message: 'database not available' });

    const key = String(req.params.key || '').trim();
    if (!key) return res.status(400).json({ success: false, message: 'key required' });

    const col = db.collection('app_configs');
    const doc = await col.findOne({ key });
    if (!doc) return res.json({ success: true, key, value: null });

    return res.json({ success: true, key: doc.key, value: doc.value, updatedAt: doc.updatedAt });
  } catch (err) {
    console.error('[configs] GET error', err && (err.stack || err));
    return res.status(500).json({ success: false, message: 'Failed to read config' });
  }
});

/**
 * POST /api/configs/:key
 * Upsert config value for the given key. Accepts JSON body representing the value.
 * Example: POST /api/configs/event-details  { name: "...", date: "...", time: "..." }
 */
router.post('/:key', async (req, res) => {
  try {
    const db = await obtainDb();
    if (!db) return res.status(500).json({ success: false, message: 'database not available' });

    const key = String(req.params.key || '').trim();
    if (!key) return res.status(400).json({ success: false, message: 'key required' });

    const value = req.body || {};
    const col = db.collection('app_configs');

    const update = {
      $set: {
        key,
        value,
        updatedAt: new Date(),
      },
    };

    await col.updateOne({ key }, update, { upsert: true });

    const after = await col.findOne({ key });
    return res.json({ success: true, key: after.key, value: after.value, updatedAt: after.updatedAt });
  } catch (err) {
    console.error('[configs] POST error', err && (err.stack || err));
    return res.status(500).json({ success: false, message: 'Failed to save config' });
  }
});

module.exports = router;