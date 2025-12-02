// url: (local file) server.js
require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const app = express();

const cors = require("cors");

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "uploads");
try {
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
} catch (e) {
  console.warn("Could not ensure uploads directory:", e && e.message);
}

// --- Simple request logger (helps see if phone/ngrok requests reach this server) ---
app.use((req, res, next) => {
  try {
    console.log(
      `[REQ] ${new Date().toISOString()} ${req.method} ${req.originalUrl} host=${req.headers.host} referer=${req.headers.referer || ""}`
    );
  } catch (e) {
    /* ignore logging errors */
  }
  next();
});

// CORS (kept permissive for dev - lock down in production)
const allowedOrigins = [
  process.env.APP_URL,
  process.env.APP_URL2,
].filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!allowedOrigins || allowedOrigins.length === 0) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    // development fallback - allow all (remove/restrict in prod)
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, ngrok-skip-browser-warning"
  );
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const PORT = process.env.PORT || 5000;
app.use(express.json({ limit: "20mb" })); // supports base64 PDFs
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ---------- IMPORTANT FIX: serve uploads with correct MIME + CORS + Accept-Ranges ----------
app.use("/uploads", express.static(uploadsDir, {
  setHeaders: (res, filePath) => {
    // Ensure correct MIME for common video types (override if server/mime lookup is wrong)
    if (filePath.match(/\.(mp4)$/i)) {
      res.setHeader("Content-Type", "video/mp4");
    } else if (filePath.match(/\.(webm)$/i)) {
      res.setHeader("Content-Type", "video/webm");
    }
    // Allow cross-origin access from frontend (replace '*' with your origin in prod)
    res.setHeader("Access-Control-Allow-Origin", "*");
    // Allow the custom header used by client
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, ngrok-skip-browser-warning");
    // Expose Accept-Ranges (useful for video seeking)
    res.setHeader("Accept-Ranges", "bytes");
  }
}));

// Helper to safely require route modules without crashing server if a file is missing.
// If the module cannot be required, returns a router that responds 501 on each path.
function safeRequireRoutes(routePath, name) {
  try {
    const mod = require(routePath);
    // If the module is an express.Router or function, return it; else try to return as router.default
    if (typeof mod === "function" || typeof mod === "object") return mod;
    return mod.default || mod;
  } catch (err) {
    console.warn(`Warning: route module ${routePath} (${name}) could not be loaded:`, err && err.message);
    const r = express.Router();
    r.all("/*", (req, res) => res.status(501).json({ error: `Route ${name} not implemented on server` }));
    return r;
  }
}

// Import registration/config routes (use safeRequireRoutes)
const visitorsRoutes = safeRequireRoutes("./routes/visitors", "visitors");
const speakersRoutes = safeRequireRoutes("./routes/speakers", "speakers");
const partnersRoutes = safeRequireRoutes("./routes/partners", "partners");
const exhibitorsRoutes = safeRequireRoutes("./routes/exhibitors", "exhibitors");
const awardeesRoutes = safeRequireRoutes("./routes/awardees", "awardees");

const exhibitorConfigRoutes = safeRequireRoutes("./routes/exhibitorConfig", "exhibitor-config");
const visitorConfigRoutes = safeRequireRoutes("./routes/visitorConfig", "visitor-config");
const partnerConfigRoutes = safeRequireRoutes("./routes/partnerConfig", "partner-config");
const speakerConfigRoutes = safeRequireRoutes("./routes/speakerConfig", "speaker-config");
const awardeeConfigRoutes = safeRequireRoutes("./routes/awardeeConfig", "awardee-config");
const imageUploadRoutes = safeRequireRoutes("./routes/imageUpload", "image-upload");

// Admin config route
const adminConfigRoutes = safeRequireRoutes("./routes/adminConfig", "admin-config");

// OTP, Payment, Email routes
const otpRoutes = safeRequireRoutes("./routes/otp", "otp");
const paymentRoutes = safeRequireRoutes("./routes/payment", "payment");
const emailRoutes = safeRequireRoutes("./routes/email", "email");

// Additional routes that may be used by frontend
const ticketsScanRoutes = safeRequireRoutes("./routes/tickets-scan", "tickets-scan");

// Mount registration and config routes
app.use("/api/visitors", visitorsRoutes);
app.use("/api/speakers", speakersRoutes);
app.use("/api/partners", partnersRoutes);
app.use("/api/exhibitors", exhibitorsRoutes);
app.use("/api/awardees", awardeesRoutes);

// Config endpoints (note: the fallback above will always respond if nothing else)
app.use("/api/exhibitor-config", exhibitorConfigRoutes);
app.use("/api/visitor-config", visitorConfigRoutes);
app.use("/api/partner-config", partnerConfigRoutes);
app.use("/api/speaker-config", speakerConfigRoutes);
app.use("/api/awardee-config", awardeeConfigRoutes);

// image upload and admin config
app.use("/api", imageUploadRoutes);
app.use("/api", adminConfigRoutes);

// OTP/Payment/Email
app.use("/api/otp", otpRoutes);
app.use("/api/payment", paymentRoutes);

// Mount email route under /api/email and /api/mailer for backward compatibility
app.use("/api/email", emailRoutes);
app.use("/api/mailer", emailRoutes);

// Tickets scan/routes
app.use("/api/tickets", ticketsScanRoutes);

// Optional: expose reminders and tickets-upgrade if present
const remindersRoutes = safeRequireRoutes("./routes/reminders", "reminders");
app.use("/api/reminders", remindersRoutes);

const ticketsUpgradeRoutes = safeRequireRoutes("./routes/tickets-upgrade", "tickets-upgrade");
app.use("/api/tickets/upgrade", ticketsUpgradeRoutes);

// Health + SMTP diagnostics
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    smtpConfigured: !!(process.env.SMTP_HOST || process.env.SMTP_SERVICE || process.env.SMTP_USER),
    host: process.env.SMTP_HOST || process.env.SMTP_SERVICE || null,
    uploadsDirExists: fs.existsSync(uploadsDir),
  });
});

app.get("/", (req, res) => {
  res.send("API is running");
});

// --- error handler ---
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err && err.stack ? err.stack : err);
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "File too large" });
  }
  res.status(err?.status || 500).json({ error: err?.message || "server error" });
});

// Start
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT} (PORT=${PORT})`);
});