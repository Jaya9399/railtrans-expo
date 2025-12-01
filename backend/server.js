// Modified server.js - adds request logging and a guaranteed /api/visitor-config route
// Insert this file to replace your current server.js, then restart the server.
// This helps diagnose and (temporarily) fixes the 404/ngrok interstitial issue by:
//  - logging every request (method, url, host, headers) to the console
//  - providing a fallback /api/visitor-config response so ngrok and phones get JSON
// Remove or adapt the fallback when your real visitorConfig route is confirmed working.

require("dotenv").config();

const express = require('express');
const path = require("path");
const app = express();

const cors = require('cors');

// --- Simple request logger (helps see if phone/ngrok requests reach this server) ---
app.use((req, res, next) => {
  try {
    console.log(`[REQ] ${new Date().toISOString()} ${req.method} ${req.originalUrl} host=${req.headers.host} referer=${req.headers.referer || ""}`);
  } catch (e) { /* ignore logging errors */ }
  next();
});

// CORS (kept permissive for dev - lock down in production)
const allowedOrigins = [
  process.env.APP_URL,
];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!allowedOrigins || allowedOrigins.length === 0) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    // development fallback - allow all (remove in prod)
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const PORT = process.env.PORT || 5000;
app.use(express.json({ limit: "20mb" })); // supports base64 PDFs

// Serve uploaded images statically (ensure 'uploads' directory exists)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- TEMPORARY: Fallback /api/visitor-config endpoint ---
// Add this BEFORE mounting your real routes so we always have a reachable endpoint.
// This will help check whether the phone/ngrok requests reach your server.
// Replace the payload with real data or remove this once the real route works.
app.get("/api/visitor-config", (req, res) => {
  console.log("[FALLBACK] /api/visitor-config requested from", req.headers.host || req.ip);
  // Example minimal config that DynamicRegistrationForm will accept
  const exampleConfig = {
    backgroundMedia: { type: "image", url: "/uploads/bg.jpg" },
    images: ["/uploads/img1.jpg", "/uploads/img2.jpg"],
    eventDetails: { name: "RailTrans Expo", date: "2026-06-10", venue: "Expo Center" },
    termsUrl: "/uploads/terms.pdf",
    termsRequired: true,
    termsLabel: "I accept the Terms & Conditions",
    fields: [
      { name: "name", label: "Full name", type: "text", required: true },
      { name: "email", label: "Email", type: "email", required: true },
      { name: "company", label: "Company", type: "text", required: false }
    ]
  };
  res.json(exampleConfig);
});

// Import all registration and config routes
const visitorsRoutes = require('./routes/visitors');
const speakersRoutes = require('./routes/speakers');
const partnersRoutes = require('./routes/partners');
const exhibitorsRoutes = require('./routes/exhibitors');
const awardeesRoutes = require('./routes/awardees');
const exhibitorConfigRoutes = require('./routes/exhibitorConfig');
const visitorConfigRoutes = require('./routes/visitorConfig');
const partnerConfigRoutes = require('./routes/partnerConfig');
const speakerConfigRoutes = require('./routes/speakerConfig');
const awardeeConfigRoutes = require('./routes/awardeeConfig');
const imageUploadRoutes = require('./routes/imageUpload');

// --- NEW: adminConfig route (make sure this file exists)
const adminConfigRoutes = require('./routes/adminConfig');

// --- OTP, Payment, Email routes ---
const otpRoutes = require('./routes/otp');
const paymentRoutes = require('./routes/payment');
const emailRoutes = require('./routes/email');

// Mount registration and config routes
app.use('/api/visitors', visitorsRoutes);
app.use('/api/speakers', speakersRoutes);
app.use('/api/partners', partnersRoutes);
app.use('/api/exhibitors', exhibitorsRoutes);
app.use('/api/awardees', awardeesRoutes);
app.use('/api/exhibitor-config', exhibitorConfigRoutes);
app.use('/api/visitor-config', visitorConfigRoutes); // your real visitorConfig route (may also respond)
app.use('/api/partner-config', partnerConfigRoutes);
app.use('/api/speaker-config', speakerConfigRoutes);
app.use('/api/awardee-config', awardeeConfigRoutes);
app.use('/api', imageUploadRoutes);

// mount adminConfig under /api so endpoints are /api/admin-config and /api/admin-config/upload
app.use('/api', adminConfigRoutes);

// OTP/Payment/Email
app.use('/api/otp', otpRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/mailer', emailRoutes); // same handler
app.use("/api/tickets", require("./routes/tickets-scan"));

// Health + SMTP diagnostics
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    smtpConfigured: !!(process.env.SMTP_HOST || process.env.SMTP_SERVICE),
    host: process.env.SMTP_HOST || process.env.SMTP_SERVICE || null,
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
  console.log(`Server running on http://localhost:${PORT}`);
});