const pool = require('../db');

exports.registerVisitor = async (req, res) => {
  const {
    title, name, mobile, email, designation,
    company_type, company, other_details, purpose, ticket_category
  } = req.body;

  try {
    const conn = await pool.getConnection();
    await conn.query(
      `INSERT INTO visitors (
        title, name, mobile, email, designation, company_type, company, other_details, purpose, ticket_category
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, name, mobile, email, designation, company_type, company, other_details, purpose, ticket_category]
    );
    conn.release();
    res.json({ success: true, message: "Visitor registered successfully." });
  } catch (err) {
    console.error('MariaDB Error:', err);
    res.status(500).json({ success: false, message: "Database error." });
  }
};