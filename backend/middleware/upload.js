const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Upload directory (project-root/uploads)
const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Multer storage: preserve extension, avoid collisions
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    const base = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    cb(null, base + ext);
  },
});

// Allow images, videos and common document types (pdf/doc/docx/txt)
function fileFilter(req, file, cb) {
  const mime = (file.mimetype || "").toLowerCase();
  const ext = path.extname(file.originalname || "").toLowerCase();

  const imageTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
  const videoTypes = ["video/mp4", "video/webm", "video/ogg", "video/quicktime", "video/x-matroska"];
  const docTypes = ["application/pdf", "text/plain", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];

  if (imageTypes.includes(mime) || videoTypes.includes(mime) || docTypes.includes(mime)) {
    return cb(null, true);
  }

  // Fallback by extension (some clients/providers may send different mime)
  const allowedExt = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".webm", ".mov", ".mkv", ".pdf", ".txt", ".doc", ".docx"];
  if (allowedExt.includes(ext)) return cb(null, true);

  cb(new Error("Unsupported file type"));
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 250 * 1024 * 1024, // 250 MB
  },
});

// POST /api/upload-asset
// Generic upload used for images/videos displayed on site
router.post("/upload-asset", upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: "No file uploaded" });
    const urlPath = `/uploads/${req.file.filename}`;
    return res.json({ success: true, url: urlPath, imageUrl: urlPath, fileUrl: urlPath });
  } catch (err) {
    console.error("[upload] upload-asset error:", err && (err.stack || err));
    return res.status(500).json({ success: false, error: "Upload failed", detail: String(err && err.message ? err.message : err) });
  }
});

// POST /api/upload-file
// Upload for docs/terms pdf etc (semantic alias)
router.post("/upload-file", upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: "No file uploaded" });
    const urlPath = `/uploads/${req.file.filename}`;
    return res.json({ success: true, url: urlPath, fileUrl: urlPath });
  } catch (err) {
    console.error("[upload] upload-file error:", err && (err.stack || err));
    return res.status(500).json({ success: false, error: "Upload failed", detail: String(err && err.message ? err.message : err) });
  }
});

module.exports = router;