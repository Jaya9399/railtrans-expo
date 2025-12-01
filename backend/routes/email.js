const express = require("express");
const nodemailer = require("nodemailer");

const router = express.Router();

function buildTransporter() {
  // Prefer explicit SMTP host (GoDaddy, etc.)
  if (process.env.SMTP_HOST) {
    const port = Number(process.env.SMTP_PORT || 465);
    const secure =
      typeof process.env.SMTP_SECURE === "string"
        ? process.env.SMTP_SECURE.toLowerCase() === "true"
        : port === 465;

    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure, // true for 465, false for 587
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      pool: true,
    });
  }

  // Fallback: Gmail service (requires Gmail App Password)
  if (process.env.SMTP_SERVICE) {
    return nodemailer.createTransport({
      service: process.env.SMTP_SERVICE, // e.g., "gmail"
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      pool: true,
    });
  }

  throw new Error("No SMTP configuration provided.");
}

const transporter = buildTransporter();

// Optional: verify connection on boot
transporter.verify((err, success) => {
  if (err) {
    console.error("SMTP verify failed:", err.message);
  } else {
    console.log("SMTP server is ready to take our messages");
  }
});

router.post("/", async (req, res) => {
  try {
    const { to, subject, text, html, attachments = [] } = req.body || {};
    if (!to || !subject) {
      return res
        .status(400)
        .json({ success: false, error: "`to` and `subject` are required" });
    }

    // IMPORTANT: Align From with authenticated mailbox to satisfy SPF/DMARC
    const from = process.env.MAIL_FROM || process.env.SMTP_USER;

    const mailOptions = {
      from, // e.g., "RailTrans Expo Support <support@railtransexpo.com>"
      to,
      subject,
      text,
      html,
      // Expecting base64 attachments from frontend
      attachments: attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        encoding: a.encoding || "base64",
        contentType: a.contentType || "application/pdf",
      })),
    };

    const info = await transporter.sendMail(mailOptions);
    res.json({
      success: true,
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
    });
  } catch (err) {
    console.error("Mail send error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;