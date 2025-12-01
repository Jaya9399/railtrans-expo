const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const pool = require("../db"); // requires your existing mariadb pool module (the file you showed)

const router = express.Router();

// ensure uploads dir exists
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext).replace(/\s+/g, "_").replace(/[^\w\-]/g, "");
    cb(null, `${Date.now()}_${name}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB limit

// GET /api/admin-config
router.get("/admin-config", async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query("SELECT id, logo_url, primary_color, updated_at FROM admin_settings ORDER BY id LIMIT 1");
    // mariadb returns an array where last element may be meta; ensure first row used
    const row = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!row) return res.json({});
    return res.json({ logoUrl: row.logo_url, primaryColor: row.primary_color, updatedAt: row.updated_at });
  } catch (err) {
    console.error("GET /admin-config error:", err);
    return res.status(500).json({ error: "server error" });
  } finally {
    if (conn) conn.release();
  }
});

// PUT /api/admin-config
router.put("/admin-config", express.json(), async (req, res) => {
  const { logoUrl, primaryColor } = req.body || {};
  let conn;
  try {
    conn = await pool.getConnection();
    const exist = await conn.query("SELECT id FROM admin_settings ORDER BY id LIMIT 1");
    const existRow = Array.isArray(exist) && exist.length ? exist[0] : null;
    if (!existRow) {
      const result = await conn.query("INSERT INTO admin_settings (logo_url, primary_color) VALUES (?, ?)", [logoUrl || null, primaryColor || null]);
      const insertId = result.insertId;
      const [rows] = await conn.query("SELECT id, logo_url, primary_color, updated_at FROM admin_settings WHERE id = ? LIMIT 1", [insertId]);
      const out = rows && rows.length ? rows[0] : {};
      return res.json({ success: true, logoUrl: out.logo_url, primaryColor: out.primary_color, updatedAt: out.updated_at });
    } else {
      const id = existRow.id;
      await conn.query("UPDATE admin_settings SET logo_url = ?, primary_color = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [logoUrl || null, primaryColor || null, id]);
      const [rows] = await conn.query("SELECT id, logo_url, primary_color, updated_at FROM admin_settings WHERE id = ? LIMIT 1", [id]);
      const out = rows && rows.length ? rows[0] : {};
      return res.json({ success: true, logoUrl: out.logo_url, primaryColor: out.primary_color, updatedAt: out.updated_at });
    }
  } catch (err) {
    console.error("PUT /admin-config error:", err);
    return res.status(500).json({ error: "server error" });
  } finally {
    if (conn) conn.release();
  }
});

// POST /api/admin-config/upload  (field name "logo")
// Add these console.logs around multer handler and error handling
router.post("/admin-config/upload", upload.single("logo"), async (req, res) => {
  try {
    console.info("Upload endpoint hit, file present?", !!req.file);
    if (!req.file) {
      // multer may have rejected the file (size/type); try to check req.file and multer error
      // The multer error is passed to express error handler; but we can still return helpful message
      return res.status(400).json({ error: "no file uploaded or file rejected (size/type)" });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    console.info("Uploaded file saved:", req.file.path, "->", fileUrl);

    // persist to DB
    // ... existing DB code ...
    return res.json({ success: true, url: fileUrl });
  } catch (err) {
    console.error("Upload handler error:", err);
    return res.status(500).json({ error: err.message || "server error" });
  }
});

module.exports = router;