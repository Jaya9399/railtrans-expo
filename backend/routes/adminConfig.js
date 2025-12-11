const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const mongo = require('../utils/mongoClient'); // must expose getDb()

/* Canonical uploads directory */
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* Allowed mime types */
const allowedMime = [
  "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/svg+xml"
];

/* Multer storage -> writes into UPLOAD_DIR */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    const name = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (!file) return cb(new Error("invalid"));
    if (!allowedMime.includes(file.mimetype)) return cb(new Error("invalid_mime"));
    cb(null, true);
  }
});

/* Always use this env variable for public base */
function publicBaseUrl() {
  const base = (process.env.REACT_APP_API_BASE_URL || "").trim().replace(/\/$/, "");
  if (!base) console.warn('[admin-config] REACT_APP_API_BASE_URL not set; URLs may be incorrect');
  return base;
}

function fileUrl(relativePath) {
  const base = publicBaseUrl();
  return `${base}${relativePath.startsWith('/') ? '' : '/'}${relativePath}`;
}

/* GET /api/admin-config */
router.get("/admin-config", async (req, res) => {
  try {
    const db = await mongo.getDb();
    const row = await db.collection("admin_settings").findOne({}, { projection: { logo_url: 1, primary_color: 1 } });
    if (!row) return res.json({});
    const rel = row.logo_url || "";
    const logoAbsolute = rel ? fileUrl(rel) : "";
    return res.json({ logoUrl: logoAbsolute, primaryColor: row.primary_color || "" });
  } catch (e) {
    console.error("[admin-config] GET error", e && (e.stack || e));
    return res.json({});
  }
});

/* PUT /api/admin-config */
router.put("/admin-config", express.json(), async (req, res) => {
  const { logoUrl, primaryColor } = req.body || {};
  let serverLogo = null;

  try {
    if (logoUrl && typeof logoUrl === "string") {
      const base = publicBaseUrl();
      if (logoUrl.startsWith(base)) {
        serverLogo = logoUrl.substring(base.length);
        if (!serverLogo.startsWith("/")) serverLogo = "/" + serverLogo;
      } else if (logoUrl.startsWith("/")) {
        serverLogo = logoUrl;
      } else {
        serverLogo = logoUrl; // external CDN URL
      }
    }
  } catch (e) {
    serverLogo = logoUrl || null;
  }

  try {
    const db = await mongo.getDb();
    await db.collection("admin_settings").updateOne(
      {},
      {
        $set: {
          logo_url: serverLogo || null,
          primary_color: primaryColor || null,
          updated_at: new Date(),
        },
        $setOnInsert: { created_at: new Date() },
      },
      { upsert: true }
    );
    return res.json({ success: true });
  } catch (e) {
    console.error("[admin-config] PUT error", e && (e.stack || e));
    return res.status(500).json({ error: "server error" });
  }
});

/* POST /api/admin-config/upload */
router.post(
  "/admin-config/upload",
  upload.fields([
    { name: "file", maxCount: 1 },
    { name: "logo", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const file = (req.files?.file && req.files.file[0]) || (req.files?.logo && req.files.logo[0]);
      if (!file) return res.status(400).json({ error: "no file uploaded" });

      const relPath = "/uploads/" + file.filename;
      const absoluteUrl = fileUrl(relPath);

      // ensure file exists where static serves from
      const expectedFsPath = path.join(UPLOAD_DIR, file.filename);
      if (!fs.existsSync(expectedFsPath)) {
        console.error('[admin-config] uploaded file missing on disk:', expectedFsPath);
        return res.status(500).json({ error: "upload saved but file not found on disk" });
      }

      // persist relative path in DB
      try {
        const db = await mongo.getDb();
        await db.collection("admin_settings").updateOne(
          {},
          {
            $set: { logo_url: relPath, updated_at: new Date() },
            $setOnInsert: { created_at: new Date() }
          },
          { upsert: true }
        );
      } catch (e) {
        console.warn("[admin-config] save logo_url failed", e && e.message);
      }

      console.log('[admin-config] uploaded:', { filename: file.filename, relPath, absoluteUrl });
      return res.json({ success: true, url: absoluteUrl, path: relPath });
    } catch (err) {
      if (err.message === "invalid_mime") return res.status(400).json({ error: "invalid file type" });
      if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "file too large" });
      console.error("[admin-config] upload error", err && (err.stack || err));
      return res.status(500).json({ error: "server error" });
    }
  }
);

module.exports = router;
