const pool = require("../db");
const { sendMail } = require("../utils/mailer");

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const EXHIBITOR_ADMIN_EMAILS = (process.env.EXHIBITOR_ADMIN_EMAILS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// small helper
function safeTrim(v) {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

async function registerExhibitor(req, res) {
  try {
    console.log(
      "[exhibitors] incoming body:",
      JSON.stringify(req.body || {}).slice(0, 2000)
    );
    const body = req.body || {};

    const name = safeTrim(
      body.name || `${body.firstName || ""} ${body.lastName || ""}`
    );
    const companyName = safeTrim(
      body.companyName ||
        body.company ||
        body.company_name ||
        body.companyname ||
        body["Company Name"] ||
        ""
    );

    const email = safeTrim(body.email || "");
    const mobile = safeTrim(body.mobile || body.phone || "");

    if (!companyName)
      return res
        .status(400)
        .json({ success: false, error: "companyName is required" });
    if (!name)
      return res
        .status(400)
        .json({ success: false, error: "name is required" });

    const conn = await pool.getConnection();
    try {
      const sql = `INSERT INTO exhibitors ( surname, name, mobile, email, designation, companyName, category, categoryOther, spaceType, spaceSize, boothType, productDetails, terms, created_at )
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`;
      const params = [
        safeTrim(body.surname || body.title || ""),
        name,
        mobile,
        email,
        safeTrim(body.designation || ""),
        companyName,
        safeTrim(body.category || body.company_type || ""),
        safeTrim(body.categoryOther || body.category_other || ""),
        safeTrim(body.spaceType || ""),
        safeTrim(body.spaceSize || ""),
        safeTrim(body.boothType || ""),
        safeTrim(body.productDetails || ""),
        body.terms ? 1 : 0,
      ];

      const qres = await conn.query(sql, params);
      const resultObj = Array.isArray(qres) ? qres[0] : qres;
      let insertedId =
        resultObj && (resultObj.insertId || resultObj.insert_id)
          ? resultObj.insertId || resultObj.insert_id
          : null;
      if (typeof insertedId === "bigint") {
        const asNum = Number(insertedId);
        insertedId = Number.isSafeInteger(asNum)
          ? asNum
          : insertedId.toString();
      }

      console.log("[exhibitors] insertedId:", insertedId);

      // Respond immediately
      res.json({ success: true, insertedId, companyName });

      // Send a simple acknowledgement to exhibitor (non-blocking)
      (async () => {
        try {
          if (email) {
            const subject = "RailTrans Expo — Thank you for reaching out";
            const text = `Hi ${name || ""},

Thank you for reaching out to RailTrans Expo. We have received your exhibitor registration for "${companyName}". Our team will review and get back to you soon.

If you need immediate assistance, please contact ${
              process.env.MAIL_FROM || "support@railtransexpo.com"
            }.

Regards,
RailTrans Expo Team`;
            const html = `<p>Hi ${name || ""},</p>
<p>Thank you for reaching out to <b>RailTrans Expo</b>. We have received your exhibitor registration for "<b>${companyName}</b>". Our team will review and get back to you soon.</p>
<p>If you need immediate assistance, please contact <a href="mailto:${
              process.env.MAIL_FROM || "support@railtransexpo.com"
            }">${process.env.MAIL_FROM || "support@railtransexpo.com"}</a>.</p>
<p>Regards,<br/>RailTrans Expo Team</p>`;

            const mailRes = await sendMail({ to: email, subject, text, html });
            if (!mailRes.success)
              console.warn("[exhibitors] ack email failed:", mailRes.error);
            else console.log("[exhibitors] ack email sent to", email);
          } else {
            console.log(
              "[exhibitors] no exhibitor email provided, skipping ack email"
            );
          }
        } catch (e) {
          console.error(
            "[exhibitors] ack email exception:",
            e && e.message ? e.message : e
          );
        }
      })();

      // Also notify exhibitor admin team with a concise message
      (async () => {
        try {
          const toAddrs = EXHIBITOR_ADMIN_EMAILS.length
            ? EXHIBITOR_ADMIN_EMAILS
            : ADMIN_EMAILS;
          if (!toAddrs.length) {
            console.warn(
              "[exhibitors] no EXHIBITOR_ADMIN_EMAILS or ADMIN_EMAILS configured"
            );
            return;
          }
          const subject = `New Exhibitor Registration${
            insertedId ? ` — #${insertedId}` : ""
          }`;
          const html = `<p>New exhibitor registration submitted.</p>
            <ul>
              <li><b>ID:</b> ${insertedId || "N/A"}</li>
              <li><b>Name:</b> ${name}</li>
              <li><b>Company:</b> ${companyName}</li>
              <li><b>Email:</b> ${email}</li>
              <li><b>Mobile:</b> ${mobile}</li>
            </ul>
            <p>Open admin panel to review.</p>`;
          const text = `New exhibitor registration
ID: ${insertedId || "N/A"}
Name: ${name}
Company: ${companyName}
Email: ${email}
Mobile: ${mobile}
Review in admin panel.`;

          const results = await Promise.all(
            toAddrs.map(async (addr) => {
              const r = await sendMail({ to: addr, subject, text, html });
              return { to: addr, ok: r.success, error: r.error || null };
            })
          );
          console.log("[exhibitors] admin notify results:", results);
        } catch (e) {
          console.error(
            "[exhibitors] admin notify exception:",
            e && e.message ? e.message : e
          );
        }
      })();
    } finally {
      try {
        conn.release && conn.release();
      } catch (_) {}
    }
  } catch (err) {
    console.error(
      "[exhibitors] register error:",
      err && err.message ? err.message : err
    );
    return res
      .status(500)
      .json({
        success: false,
        message: "Server error",
        details: String(err && err.message ? err.message : err),
      });
  }
}

async function notifyAdmin(req, res) {
  try {
    const { form = {}, exhibitorId = null } = req.body || {};
    const toAddrs = EXHIBITOR_ADMIN_EMAILS.length
      ? EXHIBITOR_ADMIN_EMAILS
      : ADMIN_EMAILS;
    if (!toAddrs.length)
      return res
        .status(500)
        .json({ success: false, error: "No admin emails configured" });

    const subject = `Exhibitor Notification${
      exhibitorId ? ` (#${exhibitorId})` : ""
    }`;
    const html = `<p>Admin notification: please review new exhibitor registration.</p>
      <ul>
        <li><b>ID:</b> ${exhibitorId || "N/A"}</li>
        <li><b>Name:</b> ${safeTrim(form.name || "")}</li>
        <li><b>Company:</b> ${safeTrim(
          form.companyName || form.company || ""
        )}</li>
        <li><b>Email:</b> ${safeTrim(form.email || "")}</li>
        <li><b>Mobile:</b> ${safeTrim(form.mobile || "")}</li>
      </ul>
      <p>Open admin panel to review.</p>`;
    const text = `Admin notification:
ID: ${exhibitorId || "N/A"}
Name: ${safeTrim(form.name || "")}
Company: ${safeTrim(form.companyName || form.company || "")}
Email: ${safeTrim(form.email || "")}
Mobile: ${safeTrim(form.mobile || "")}
Review: ${process.env.ADMIN_PANEL_URL || "#"}
`;

    const results = await Promise.all(
      toAddrs.map(async (addr) => {
        const r = await sendMail({ to: addr, subject, text, html });
        return { to: addr, ok: r.success, error: r.error || null };
      })
    );

    console.log("[exhibitors] notifyAdmin results:", results);
    return res.json({ success: true, results });
  } catch (err) {
    console.error(
      "[exhibitors] notifyAdmin error:",
      err && err.message ? err.message : err
    );
    return res
      .status(500)
      .json({
        success: false,
        message: "Notify failed",
        details: String(err && err.message ? err.message : err),
      });
  }
}

module.exports = { registerExhibitor, notifyAdmin };
