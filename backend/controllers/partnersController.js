const pool = require("../db");
const { sendMail } = require("../utils/mailer");

/**
 * Robust registerPartner controller.
 * - Handles different db driver return shapes (mysql2/mariadb).
 * - Converts BigInt insertId to string so res.json() won't throw.
 * - Releases the connection in all cases.
 */
exports.registerPartner = async (req, res) => {
  const {
    surname, name, mobile, email, designation,
    company, businessType, businessOther, partnership, terms
  } = req.body || {};

  let conn;
  try {
    conn = await pool.getConnection();

    const sql = `INSERT INTO partners (
      surname, name, mobile, email, designation, company, businessType, businessOther, partnership, terms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`;

    const params = [
      surname || null,
      name || null,
      mobile || null,
      email || null,
      designation || null,
      company || null,
      businessType || null,
      businessOther || null,
      partnership || null,
      terms ? 1 : 0
    ];

    // Execute query. Different drivers return different shapes:
    // - mysql2: returns [result, fields]
    // - mariadb: returns result object
    const execRes = await conn.query(sql, params);

    // Normalize result -> resultObj
    let resultObj = execRes;
    if (Array.isArray(execRes) && execRes.length > 0) {
      // mysql2 style [result, fields]
      resultObj = execRes[0];
    }

    // Get insertId from common places
    let rawInsertId = null;
    if (resultObj && (resultObj.insertId || resultObj.insert_id)) {
      rawInsertId = resultObj.insertId || resultObj.insert_id;
    } else if (Array.isArray(execRes) && execRes[0] && execRes[0].insertId) {
      rawInsertId = execRes[0].insertId;
    }

    // Convert BigInt to string (JSON cannot serialize BigInt)
    let insertedId = null;
    if (rawInsertId !== null && typeof rawInsertId !== "undefined") {
      insertedId = (typeof rawInsertId === "bigint") ? rawInsertId.toString() : String(rawInsertId);
    }

    console.log("[partners] insertedId:", insertedId);

    // Respond with JSON-safe value
    return res.json({ success: true, insertedId });
  } catch (err) {
    console.error('[partnersController] registerPartner error:', err && (err.stack || err));
    return res.status(500).json({ success: false, error: err && err.message ? err.message : String(err) });
  } finally {
    if (conn) {
      try { conn.release(); } catch (_) {}
    }
  }
};