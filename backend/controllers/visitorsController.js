const pool = require("../db");
const { appendStep } = require("./fileLogger");

/**
 * registerVisitor - save visitor to DB and append a registration file
 */
async function registerVisitor(req, res) {
  try {
    console.log("[visitors] incoming body:", JSON.stringify(req.body || {}).slice(0, 2000));

    const {
      name,
      mobile,
      email,
      designation,
      company_type,
      company,
      other_details,
      purpose,
      ticket_category,
      slots,
      category, // Indian/Foreigner
      txId,
      ticket_code,
    } = req.body || {};

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({ success: false, message: "Valid email is required." });
    }

    const ticketCode = ticket_code || Math.floor(10000 + Math.random() * 90000).toString();

    const conn = await pool.getConnection();
    try {
      const sql = `INSERT INTO visitors (
        name, mobile, email, designation, company_type, company,
        other_details, purpose, ticket_category, slots, category, ticket_code, txId, registered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`;

      const params = [
        name || "",
        mobile || "",
        email || "",
        designation || "",
        company_type || "",
        company || "",
        other_details || "",
        purpose || "",
        ticket_category || "",
        JSON.stringify(slots || []),
        category || "",
        ticketCode,
        txId || null,
      ];

      const queryResult = await conn.query(sql, params);

      // Normalize different driver return shapes
      let resultObj = null;
      if (Array.isArray(queryResult) && queryResult.length > 0 && typeof queryResult[0] === 'object') {
        resultObj = queryResult[0];
      } else if (typeof queryResult === 'object') {
        resultObj = queryResult;
      }

      let insertedId = resultObj && (resultObj.insertId || resultObj.insert_id) ? (resultObj.insertId || resultObj.insert_id) : null;

      // Normalize BigInt to safe JS types for JSON (convert to Number if safe, otherwise to string)
      if (typeof insertedId === 'bigint') {
        const asNumber = Number(insertedId);
        if (Number.isSafeInteger(asNumber)) {
          insertedId = asNumber;
        } else {
          insertedId = insertedId.toString();
        }
      }

      console.log("[visitors] insertedId:", insertedId);

      // Save a file log for this registration step (appendStep will stringify BigInt safely)
      try {
        await appendStep('registration', { name, email, mobile, ticket_category, slots }, { insertedId, ticketCode });
      } catch (e) {
        console.warn("[visitors] appendStep failed:", e && e.message ? e.message : e);
      }

      return res.json({ success: true, message: "Visitor registered successfully.", ticket_code: ticketCode, insertedId });
    } finally {
      try { conn.release && conn.release(); } catch (_) {}
    }
  } catch (err) {
    console.error("[visitors] register error:", err && err.message ? err.message : err);
    return res.status(500).json({ success: false, message: "Database error.", details: String(err && err.message ? err.message : err) });
  }
}

module.exports = { registerVisitor };