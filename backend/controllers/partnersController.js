const pool = require('../db');
exports.registerPartner = async (req, res) => {
  const {
    surname, name, mobile, email, designation,
    company, businessType, businessOther, partnership, terms
  } = req.body;
  try {
    const conn = await pool.getConnection();
    await conn.query(
      `INSERT INTO partners (
        surname, name, mobile, email, designation, company, businessType, businessOther, partnership, terms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [surname, name, mobile, email, designation, company, businessType, businessOther, partnership, terms ? 1 : 0]
    );
    conn.release();
    res.json({ success: true, message: "Partner registered successfully." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};