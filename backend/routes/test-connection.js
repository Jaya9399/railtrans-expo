const nodemailer = require("nodemailer");
const transporter = nodemailer.createTransport({
  host: "smtp.secureserver.net",
  port: 587,
  secure: false,
  auth: {
    user: "support@railtransexpo.com",
    pass: "RailTrans@2025**"
  },
  tls: { rejectUnauthorized: false }
});

transporter.verify(function(error, success) {
  if (error) {
    console.error("SMTP connection error:", error);
  } else {
    console.log("Server is ready to take our messages");
  }
});