const db = require("../db");

/**
 * Helper: generate a 6-digit ticket code
 */
function genTicketCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Normalize db.query result into an array of rows (works with mysql2 and other helpers)
 */
function rowsFromQuery(q) {
  if (Array.isArray(q) && Array.isArray(q[0])) return q[0];
  if (Array.isArray(q)) return q;
  return q && typeof q === "object" ? [q] : [];
}

/**
 * registerAwardee
 * - Generates a server-side canonical ticket_code (retries a few times to avoid collisions)
 * - Inserts awardee row and returns insertedId + ticket_code
 */
exports.registerAwardee = async (req, res) => {
  const {
    title, name, mobile, email, designation,
    organization, awardType, awardOther, bio, terms
  } = req.body || {};

  try {
    // generate unique ticket_code (simple loop, few attempts)
    let ticket_code = genTicketCode();
    for (let attempts = 0; attempts < 6; attempts++) {
      const q = await db.query("SELECT 1 FROM awardees WHERE ticket_code = ? LIMIT 1", [ticket_code]);
      const rows = rowsFromQuery(q);
      const exists = Array.isArray(rows) ? rows.length > 0 : !!rows;
      if (!exists) break;
      ticket_code = genTicketCode();
    }

    const insertSql = `INSERT INTO awardees (
      title, name, mobile, email, designation, organization,
      awardType, awardOther, bio, terms, ticket_code, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`;

    const params = [
      title || null,
      name || null,
      mobile || null,
      email || null,
      designation || null,
      organization || null,
      awardType || null,
      awardOther || null,
      bio || null,
      terms ? 1 : 0,
      ticket_code,
    ];

    const insertRes = await db.query(insertSql, params);

    // extract insertId robustly for different db helpers
    let insertedId = null;
    if (Array.isArray(insertRes) && insertRes[0] && typeof insertRes[0].insertId !== 'undefined') {
      insertedId = insertRes[0].insertId;
    } else if (insertRes && typeof insertRes.insertId !== 'undefined') {
      insertedId = insertRes.insertId;
    } else if (insertRes && typeof insertRes.affectedRows !== 'undefined' && insertRes.affectedRows > 0) {
      insertedId = insertRes.insertId || null;
    }

    // JSON cannot serialize BigInt — convert to string if necessary
    if (typeof insertedId === 'bigint') insertedId = insertedId.toString();
    // also coerce other non-serializable values
    if (insertedId !== null && typeof insertedId !== 'number' && typeof insertedId !== 'string') {
      insertedId = String(insertedId);
    }

    console.log(`[awardees] registerAwardee insertedId:${insertedId} ticket_code:${ticket_code} email:${email || ''} name:${name || ''}`);

    return res.json({ success: true, insertedId, ticket_code });
  } catch (err) {
    console.error("registerAwardee error:", err && (err.stack || err));
    return res.status(500).json({ success: false, error: err && err.message ? err.message : String(err) });
  }
};