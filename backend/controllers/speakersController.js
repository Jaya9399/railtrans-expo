const pool = require('../db');

exports.registerSpeaker = async (req, res) => {
  const {
    title, name, mobile, email, designation,
    organization, sessionType, sessionOther, topic, abstract, terms
  } = req.body;

  try {
    const conn = await pool.getConnection();
    await conn.query(
      `INSERT INTO speakers (
        title, name, mobile, email, designation, organization, sessionType, sessionOther, topic, abstract, terms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, name, mobile, email, designation, organization, sessionType, sessionOther, topic, abstract, terms ? 1 : 0]
    );
    conn.release();
    res.json({ success: true, message: "Speaker registered successfully." });
  } catch (err) {
    console.error('MariaDB Error:', err);
    res.status(500).json({ success: false, message: "Database error." });
  }
};