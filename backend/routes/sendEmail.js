const express = require("express");
const router = express.Router();
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.secureserver.net",
  port: 25, // Try 25 first; if not, try 587 or 465
  secure: false,
  tls: { rejectUnauthorized: false }
  // No auth block
});

router.post("/", async (req, res) => {
  const { to, subject, text, html } = req.body;
  try {
    const info = await transporter.sendMail({
      from: '"RailTrans Expo Support" <***REMOVED***>',
      to,
      subject,
      text,
      html,
    });
    res.json({ success: true, info });
  } catch (err) {
    console.error("GoDaddy mail send error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;