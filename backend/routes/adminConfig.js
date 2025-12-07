const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const pool = require("../db"); // your mariadb pool
const router = express.Router();

// ensure uploads dir exists
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// multer storage + simple image filter
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = path
      .basename(file.originalname, ext)
      .replace(/\s+/g, "_")
      .replace(/[^\w\-]/g, "");
    cb(null, `${Date.now()}_${name}${ext}`);
  },
});
function imageFileFilter(req, file, cb) {
  const allowed = [
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/gif",
    "image/svg+xml",
  ];
  if (!allowed.includes(file.mimetype))
    return cb(new Error("Only image uploads are allowed"), false);
  cb(null, true);
}
const upload = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
}); // 5MB

// Helper: build absolute URL for the uploaded file
function absoluteFileUrl(req, filePath) {
  // prefer X-Forwarded-Proto/Host if behind proxy
  const proto = req.get("x-forwarded-proto") || req.protocol;
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${proto}://${host}${filePath}`;
}

// GET /api/admin-config
router.get("/admin-config", async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      "SELECT id, logo_url, primary_color, updated_at FROM admin_settings ORDER BY id LIMIT 1"
    );
    const row = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!row) return res.json({});
    return res.json({
      logoUrl: row.logo_url,
      primaryColor: row.primary_color,
      updatedAt: row.updated_at,
    });
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
    const exist = await conn.query(
      "SELECT id FROM admin_settings ORDER BY id LIMIT 1"
    );
    const existRow = Array.isArray(exist) && exist.length ? exist[0] : null;
    if (!existRow) {
      const result = await conn.query(
        "INSERT INTO admin_settings (logo_url, primary_color) VALUES (?, ?)",
        [logoUrl || null, primaryColor || null]
      );
      const insertId = result.insertId;
      const rows = await conn.query(
        "SELECT id, logo_url, primary_color, updated_at FROM admin_settings WHERE id = ? LIMIT 1",
        [insertId]
      );
      const out = Array.isArray(rows) && rows.length ? rows[0] : {};
      return res.json({
        success: true,
        logoUrl: out.logo_url,
        primaryColor: out.primary_color,
        updatedAt: out.updated_at,
      });
    } else {
      const id = existRow.id;
      await conn.query(
        "UPDATE admin_settings SET logo_url = ?, primary_color = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [logoUrl || null, primaryColor || null, id]
      );
      const rows = await conn.query(
        "SELECT id, logo_url, primary_color, updated_at FROM admin_settings WHERE id = ? LIMIT 1",
        [id]
      );
      const out = Array.isArray(rows) && rows.length ? rows[0] : {};
      return res.json({
        success: true,
        logoUrl: out.logo_url,
        primaryColor: out.primary_color,
        updatedAt: out.updated_at,
      });
    }
  } catch (err) {
    console.error("PUT /admin-config error:", err);
    return res.status(500).json({ error: "server error" });
  } finally {
    if (conn) conn.release();
  }
});
// GET /api/admin/logo-url
router.get("/admin/logo-url", async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query("SELECT logo_url FROM admin_settings ORDER BY id LIMIT 1");
    const stored = Array.isArray(rows) && rows.length ? rows[0].logo_url || "" : "";

    // If stored is relative (starts with "/"), convert to absolute using request host/proto
    let absoluteUrl = "";
    if (stored) {
      if (/^https?:\/\//i.test(stored)) {
        absoluteUrl = stored;
      } else if (stored.startsWith("/")) {
        const proto = req.get("x-forwarded-proto") || req.protocol;
        const host = req.get("x-forwarded-host") || req.get("host");
        absoluteUrl = `${proto}://${host}${stored}`;
      } else {
        // not absolute and not leading slash: resolve relative to server root
        const proto = req.get("x-forwarded-proto") || req.protocol;
        const host = req.get("x-forwarded-host") || req.get("host");
        absoluteUrl = `${proto}://${host}/${stored.replace(/^\/+/, "")}`;
      }
    }

    console.log("ADMIN LOGO URL (resolved):", absoluteUrl);
    return res.json({ logo_url: absoluteUrl, logoUrl: absoluteUrl, url: absoluteUrl });
  } catch (err) {
    console.error("admin/logo-url error", err);
    return res.json({ logo_url: "", logoUrl: "", url: "" });
  } finally {
    if (conn) conn.release();
  }
});

// POST /api/admin-config/upload  (field name "logo")
router.post("/admin-config/upload", upload.single("logo"), async (req, res) => {
  let conn;
  try {
    console.info("Upload endpoint hit, file present?", !!req.file);
    if (!req.file) {
      return res
        .status(400)
        .json({ error: "no file uploaded or file rejected (size/type)" });
    }

    // Use a web-accessible path. Serve /uploads via express.static in your main app.
    const fileUrlPath = `/uploads/${req.file.filename}`;
    const publicUrl = absoluteFileUrl(req, fileUrlPath);

    console.info("Uploaded file saved:", req.file.path, "->", publicUrl);

    // Persist to DB (create or update admin_settings)
    try {
      conn = await pool.getConnection();
      const exist = await conn.query(
        "SELECT id FROM admin_settings ORDER BY id LIMIT 1"
      );
      const existRow = Array.isArray(exist) && exist.length ? exist[0] : null;
      if (!existRow) {
        await conn.query(
          "INSERT INTO admin_settings (logo_url, primary_color) VALUES (?, ?)",
          [publicUrl, null]
        );
      } else {
        await conn.query(
          "UPDATE admin_settings SET logo_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          [publicUrl, existRow.id]
        );
      }
    } catch (dbErr) {
      console.warn(
        "Failed to persist admin_settings logo_url (but upload succeeded):",
        dbErr
      );
      // continue — return upload url even if DB persist failed
    } finally {
      if (conn) conn.release();
      conn = null;
    }

    // Return the public url in `url` key since client expects json.url from upload
    return res.json({ success: true, url: publicUrl });
  } catch (err) {
    console.error("Upload handler error:", err);
    // If multer threw an error, it is often available here; send helpful message
    return res.status(500).json({ error: err.message || "server error" });
  }
});

module.exports = router;
