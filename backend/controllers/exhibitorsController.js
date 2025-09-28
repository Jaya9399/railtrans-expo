const pool = require('../db');

exports.registerExhibitor = async (req, res) => {
  const {
    surname, name, mobile, email, designation,
    companyName, category, categoryOther,
    spaceType, spaceSize, boothType,
    productDetails, terms
  } = req.body;

  try {
    const conn = await pool.getConnection();
    await conn.query(
      `INSERT INTO exhibitors (
        surname, name, mobile, email, designation, companyName, category, categoryOther,
        spaceType, spaceSize, boothType, productDetails, terms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [surname, name, mobile, email, designation, companyName, category, categoryOther, spaceType, spaceSize, boothType, productDetails, terms ? 1 : 0]
    );
    conn.release();
    res.json({ success: true, message: "Exhibitor registered successfully." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};