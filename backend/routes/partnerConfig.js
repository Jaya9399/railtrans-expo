const express = require('express');
const router = express.Router();
const mongo = require('../utils/mongoClient');
let syncFieldsToCollection = null;
try { syncFieldsToCollection = require('../utils/mongoSchemaSync').syncFieldsToCollection; } catch (e) { /* optional helper may not exist */ }

/* Debug: indicate this file was required and executed */
console.log('[startup] loaded route: routes/partner-config-mongo.js');

async function obtainDb() {
  if (!mongo) return null;
  if (typeof mongo.getDb === 'function') {
    try {
      const db = await mongo.getDb();
      return db;
    } catch (e) {
      console.warn('[partner-config-mongo] mongo.getDb() threw:', e && e.message);
      return null;
    }
  }
  if (mongo.db) return mongo.db;
  return null;
}

function canonicalizeConfig(cfg = {}) {
  const config = { ...(typeof cfg === 'object' && cfg !== null ? cfg : {}) };

  config.fields = Array.isArray(config.fields)
    ? config.fields.map(f => {
        const ff = typeof f === 'object' && f !== null ? { ...f } : {};
        ff.name = String(ff.name || '').trim();
        ff.label = String(ff.label || ff.name || '').trim();
        ff.type = String(ff.type || 'text').trim();
        ff.options = Array.isArray(ff.options) ? ff.options.map(o => (o == null ? '' : String(o))) : [];
        ff.visible = typeof ff.visible === 'boolean' ? ff.visible : true;
        ff.required = !!ff.required;
        ff.meta = typeof ff.meta === 'object' && ff.meta !== null ? ff.meta : {};
        return ff;
      }).filter(f => f && f.name)
    : [];

  config.images = Array.isArray(config.images)
    ? config.images.map(i => (i == null ? '' : String(i)))
    : (config.images ? [String(config.images)] : []);

  config.eventDetails = typeof config.eventDetails === 'object' && config.eventDetails !== null ? config.eventDetails : {};

  if (config.backgroundMedia && typeof config.backgroundMedia === 'object' && config.backgroundMedia.url) {
    config.backgroundMedia = { type: config.backgroundMedia.type || 'image', url: String(config.backgroundMedia.url) };
  } else if (config.backgroundVideo && config.backgroundVideo) {
    config.backgroundMedia = { type: 'video', url: String(config.backgroundVideo) };
  } else if (config.backgroundImage && config.backgroundImage) {
    config.backgroundMedia = { type: 'image', url: String(config.backgroundImage) };
  } else {
    config.backgroundMedia = config.backgroundMedia || { type: 'image', url: '' };
  }

  config.banner = config.banner || config.bannerUrl || config.banner_url || '';
  config.hostedByLogo = config.hostedByLogo || config.hosted_by_logo || '';
  config.termsUrl = config.termsUrl || config.terms || config.terms_url || '';
  config.termsLabel = config.termsLabel || config.terms_label || 'Terms & Conditions';
  config.termsRequired = !!config.termsRequired;
  config.backgroundColor = config.backgroundColor || config.background_color || '#ffffff';
  config.badgeTemplateUrl = config.badgeTemplateUrl || config.badge_template_url || '';

  return config;
}

/**
 * GET /api/partner-config
 */
router.get('/', async (req, res) => {
  try {
    console.log('[partner-config] GET called from', req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress);
    const db = await obtainDb();
    if (!db) {
      console.warn('[partner-config-mongo] db not available');
      return res.json({ fields: [], images: []  });
    }
    const col = db.collection('registration_configs');
    const doc = await col.findOne({ page: 'partner' });
    if (!doc || !doc.config) {
      console.log('[partner-config] no config document found for page=partner');
      return res.json({ fields: [], images: []  });
    }
    const canonical = canonicalizeConfig(doc.config || {});
    return res.json(canonical);
  } catch (err) {
    console.error('[partner-config-mongo] GET error', err && (err.stack || err));
    return res.status(500).json({ fields: [], images: [] });
  }
});

/**
 * POST /api/partner-config/config
 */
router.post('/config', express.json(), async (req, res) => {
  try {
    console.log('[partner-config] POST /config called');
    const incoming = req.body || {};
    const canonical = canonicalizeConfig(incoming);

    const db = await obtainDb();
    if (!db) return res.status(500).json({ success: false, error: 'database not available' });

    const col = db.collection('registration_configs');
    const now = new Date();
    await col.updateOne(
      { page: 'partner' },
      { $set: { config: canonical, updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true }
    );

    let syncResult = null;
    if (typeof syncFieldsToCollection === 'function') {
      try {
        const fields = Array.isArray(canonical.fields) ? canonical.fields : [];
        syncResult = await syncFieldsToCollection('partners', fields);
        console.log('[partner-config-mongo] syncFieldsToCollection result:', syncResult);
      } catch (syncErr) {
        console.warn('[partner-config-mongo] field sync failed:', syncErr && (syncErr.stack || syncErr));
      }
    }

    return res.json({ success: true, config: canonical, sync: syncResult });
  } catch (err) {
    console.error('[partner-config-mongo] POST error', err && (err.stack || err));
    return res.status(500).json({ success: false, error: 'Database update failed' });
  }
});

/**
 * DELETE /api/partner-config
 */
router.delete('/', async (req, res) => {
  try {
    const db = await obtainDb();
    if (!db) return res.status(500).json({ success: false, error: 'database not available' });
    const col = db.collection('registration_configs');
    await col.deleteOne({ page: 'partner' });
    return res.json({ success: true, message: 'Partner config deleted.' });
  } catch (err) {
    console.error('[partner-config-mongo] DELETE error', err && (err.stack || err));
    return res.status(500).json({ success: false, error: 'Database delete failed' });
  }
});

module.exports = router;