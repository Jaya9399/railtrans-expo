const pool = require('../db');

exports.registerAwardee = async (req, res) => {
  const {
    title, name, mobile, email, designation,
    organization, awardType, awardOther, bio, terms
  } = req.body;

  try {
    const conn = await pool.getConnection();
    await conn.query(
      `INSERT INTO awardees (
        title, name, mobile, email, designation, organization,
        awardType, awardOther, bio, terms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, name, mobile, email, designation, organization, awardType, awardOther, bio, terms ? 1 : 0]
    );
    conn.release();
    res.json({ success: true, message: "Awardee registered successfully." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};