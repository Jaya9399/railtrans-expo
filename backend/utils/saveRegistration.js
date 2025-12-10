const mongo = require('./mongoClient');
const { safeFieldName } = require('./mongoSchemaSync'); // re-use the same normalization

async function obtainDb() {
  if (!mongo) throw new Error('mongoClient not available');
  if (typeof mongo.getDb === 'function') return await mongo.getDb();
  if (mongo.db) return mongo.db;
  throw new Error('mongoClient has no getDb/db');
}

/**
 * mapFormToDoc(form, allowedFields)
 * - form: object (raw submitted form)
 * - allowedFields: optional array of admin field objects (with .name) to whitelist only fields admin configured
 *
 * Returns an object with mapped normalized field names and _rawForm preserved.
 */
function mapFormToDoc(form = {}, allowedFields = null) {
  const doc = {};
  const raw = form || {};

  // build whitelist set of safe names if allowedFields provided
  let whitelist = null;
  if (Array.isArray(allowedFields)) {
    whitelist = new Set(
      allowedFields
        .map(f => (f && f.name ? safeFieldName(f.name) : null))
        .filter(Boolean)
    );
  }

  for (const [k, v] of Object.entries(raw)) {
    if (k === '_rawForm') continue;
    const safe = safeFieldName(k);
    if (!safe) continue;
    // if whitelist exists, skip fields not in it
    if (whitelist && !whitelist.has(safe)) continue;
    // store value as-is (you may sanitize/coerce here)
    doc[safe] = v === undefined ? null : v;
  }

  // Also coerce nested _rawForm keys (if front-end already provided nested)
  // but avoid overwriting mapped keys
  if (raw._rawForm && typeof raw._rawForm === 'object') {
    for (const [k, v] of Object.entries(raw._rawForm || {})) {
      const safe = safeFieldName(k);
      if (!safe) continue;
      if (doc[safe] === undefined) {
        if (whitelist && !whitelist.has(safe)) continue;
        doc[safe] = v === undefined ? null : v;
      }
    }
  }

  // Attach the raw payload for later debugging / email templates / admin
  doc._rawForm = raw;
  return doc;
}

/**
 * Ensure a unique sparse index on 'email' for the given collection.
 * - uses sparse:true so docs without email are allowed.
 */
async function ensureEmailUniqueIndex(db, collectionName) {
  try {
    const col = db.collection(collectionName);
    // create unique sparse index on email (create if not exists)
    await col.createIndex({ email: 1 }, { unique: true, sparse: true, name: 'unique_email_sparse' });
  } catch (err) {
    // log but don't fail the flow; index creation may fail if existing duplicates exist
    console.warn(`[registrations] ensureEmailUniqueIndex failed for ${collectionName}:`, err && (err.message || err));
  }
}

/**
 * saveRegistration(collectionName, form, options)
 * - collectionName: e.g. 'visitors', 'exhibitors', 'partners', 'awardees', 'speakers'
 * - form: object submitted from front-end
 * - options: { allowedFields: array } optional admin fields (use to whitelist)
 *
 * Uses idempotent upsert when email is present to avoid duplicates.
 * Returns { insertedId, doc, existed } where insertedId is String(ObjectId) if inserted and existed true if doc was pre-existing.
 */
async function saveRegistration(collectionName, form = {}, options = {}) {
  if (!collectionName) throw new Error('collectionName required');
  const db = await obtainDb();
  const col = db.collection(collectionName);

  const allowedFields = Array.isArray(options.allowedFields) ? options.allowedFields : null;
  const docToSave = mapFormToDoc(form, allowedFields);

  const now = new Date();
  docToSave.createdAt = now;
  docToSave.updatedAt = now;

  // Normalize email field if present
  let emailNorm = null;
  if (docToSave.email && typeof docToSave.email === 'string') {
    emailNorm = docToSave.email.trim().toLowerCase();
    docToSave.email = emailNorm;
  } else if (docToSave.email_address && typeof docToSave.email_address === 'string') {
    emailNorm = docToSave.email_address.trim().toLowerCase();
    docToSave.email = emailNorm;
    delete docToSave.email_address;
  }

  // If we have an email, try an idempotent upsert (atomic) to avoid duplicates
  if (emailNorm) {
    // Ensure there's a unique sparse index (best-effort)
    await ensureEmailUniqueIndex(db, collectionName);

    try {
      // Use findOneAndUpdate with upsert and $setOnInsert to avoid overwriting existing doc
      const filter = { email: emailNorm };
      const update = { $setOnInsert: docToSave, $set: { updatedAt: now } };
      const opts = { upsert: true, returnDocument: 'after' }; // node-driver v4: returnDocument: 'after' to get the post-op doc
      const result = await col.findOneAndUpdate(filter, update, opts);

      // result.value is the document in the DB after operation
      const finalDoc = result && result.value ? result.value : null;
      const insertedId = finalDoc && finalDoc._id ? String(finalDoc._id) : null;

      // Determine whether the doc existed before (if lastErrorObject && upserted)
      // For safety, test createdAt to see if doc existed prior to our insert.
      const existed = finalDoc && finalDoc.createdAt && finalDoc.createdAt < now;

      return { insertedId, doc: finalDoc, existed: !!existed };
    } catch (err) {
      // If duplicate key error still happens due to race or existing duplicates, find the existing doc and return it
      const isDup = err && err.code === 11000;
      if (isDup) {
        try {
          const existing = await col.findOne({ email: emailNorm });
          return { insertedId: existing && existing._id ? String(existing._id) : null, doc: existing, existed: true };
        } catch (e2) {
          // fallthrough to throw original
        }
      }
      // propagate error
      throw err;
    }
  }

  // If no email present, we can't upsert idempotently — insert once.
  const r = await col.insertOne(docToSave);
  const insertedId = r && r.insertedId ? String(r.insertedId) : null;
  return { insertedId, doc: docToSave, existed: false };
}

module.exports = { saveRegistration, mapFormToDoc, ensureEmailUniqueIndex };