const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const mongo = require('../utils/mongoClient'); // must expose getDb()

/* ===================== Upload directory ===================== */
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/* ===================== Multer config ===================== */
const allowedMime = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/svg+xml"
];

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

/* ===================== Build absolute URL ===================== */
function fileUrl(req, relative) {
  const proto = req.get("x-forwarded-proto") || req.protocol;
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${proto}://${host}${relative}`;
}

/* =============================================================
   GET /api/admin-config
   ============================================================= */
router.get("/admin-config", async (req, res) => {
  try {
    const db = mongo.getDb();
    const row = await db.collection("admin_settings")
      .findOne({}, { projection: { logo_url: 1, primary_color: 1 } });

    if (!row) return res.json({});

    return res.json({
      logoUrl: row.logo_url || "",
      primaryColor: row.primary_color || "",
    });
  } catch {
    return res.json({});
  }
});

/* =============================================================
   PUT /api/admin-config
   ============================================================= */
router.put("/admin-config", express.json(), async (req, res) => {
  const { logoUrl, primaryColor } = req.body || {};

  try {
    const db = mongo.getDb();
    await db.collection("admin_settings").updateOne(
      {},
      {
        $set: {
          logo_url: logoUrl || null,
          primary_color: primaryColor || null,
          updated_at: new Date(),
        },
        $setOnInsert: { created_at: new Date() }
      },
      { upsert: true }
    );
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "server error" });
  }
});

/* =============================================================
   POST /api/admin-config/upload
   Accepts: file or logo (field names)
   Saves disk file
   Stores relative path in DB
   Returns absolute URL for frontend
   ============================================================= */
router.post(
  "/admin-config/upload",
  upload.fields([
    { name: "file", maxCount: 1 },
    { name: "logo", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      let file =
        (req.files?.file && req.files.file[0]) ||
        (req.files?.logo && req.files.logo[0]);

      if (!file) {
        return res.status(400).json({ error: "no file uploaded" });
      }

      const relPath = "/uploads/" + file.filename;
      const url = fileUrl(req, relPath);

      // Save to admin_settings
      try {
        const db = mongo.getDb();
        await db.collection("admin_settings").updateOne(
          {},
          {
            $set: { logo_url: relPath, updated_at: new Date() },
            $setOnInsert: { created_at: new Date() },
          },
          { upsert: true }
        );
      } catch (_) {}

      return res.json({ success: true, url });
    } catch (err) {
      if (err.message === "invalid_mime")
        return res.status(400).json({ error: "invalid file type" });

      if (err.code === "LIMIT_FILE_SIZE")
        return res.status(400).json({ error: "file too large" });

      return res.status(500).json({ error: "server error" });
    }
  }
);

module.exports = router;
