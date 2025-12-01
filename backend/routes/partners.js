const express = require('express');
const router = express.Router();
const db = require('../db');
const { sendMail } = require('../utils/mailer');

// Optional external controllers (if you have them)
const controllers = require('../controllers/partnersController') || {};
const registerPartnerController = controllers.registerPartner;
const notifyPartnerController = controllers.notifyAdmin || controllers.notifyPartner || null;

/* ---------- DB helpers ---------- */

async function dbExec(sql, params = []) {
  if (!db) throw new Error('DB module not found');
  if (typeof db.execute === 'function') return await db.execute(sql, params);
  if (typeof db.query === 'function') return await db.query(sql, params);
  throw new Error('DB has no execute or query method');
}

function unwrapExecResult(execResult) {
  if (Array.isArray(execResult)) {
    if (execResult.length >= 1) return execResult[0];
    return execResult;
  }
  return execResult;
}

function normalizeRows(rows) {
  if (!rows && rows !== 0) return [];

  if (Array.isArray(rows)) {
    // mysql2 returns [rows, fields]
    if (rows.length >= 1 && Array.isArray(rows[0])) return rows[0];
    return rows;
  }

  if (typeof rows === 'object') {
    const keys = Object.keys(rows);
    const numericKeys = keys.filter((k) => /^\d+$/.test(k));
    if (numericKeys.length > 0 && numericKeys.length === keys.length) {
      return numericKeys
        .map((k) => Number(k))
        .sort((a, b) => a - b)
        .map((n) => rows[String(n)]);
    }
    const allArrays = keys.length > 0 && keys.every((k) => Array.isArray(rows[k]));
    if (allArrays) {
      const lens = keys.map((k) => rows[k].length);
      const uniq = Array.from(new Set(lens));
      if (uniq.length === 1) {
        const len = uniq[0];
        const out = [];
        for (let i = 0; i < len; i++) {
          const r = {};
          for (const k of keys) r[k] = rows[k][i];
          out.push(r);
        }
        return out;
      }
    }
    const vals = Object.values(rows);
    if (Array.isArray(vals) && vals.length && typeof vals[0] === 'object') return vals;
    return [rows];
  }

  return [];
}

function getAffectedRows(info) {
  if (!info) return 0;
  return info.affectedRows ?? info.affected_rows ?? info.affected ?? 0;
}

function camelToSnake(str = "") {
  return String(str).replace(/([A-Z])/g, "_$1").toLowerCase();
}

/* ---------- Utilities: BigInt-safe JSON conversion ---------- */

/**
 * Recursively convert BigInt values to strings inside an object/array/value.
 * Returns a new value (does not modify the input).
 */
function convertBigIntForJson(value) {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(convertBigIntForJson);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = convertBigIntForJson(v);
    }
    return out;
  }
  return value;
}

/* ---------- Routes ---------- */

/**
 * POST /api/partners/step
 * Snapshot intermediate steps from frontend (non-blocking)
 */
router.post('/step', async (req, res) => {
  try {
    console.debug('[partners] step snapshot:', req.body);
    return res.json({ success: true });
  } catch (err) {
    console.error('[partners] step error:', err && (err.stack || err));
    return res.status(500).json({ success: false, error: 'Failed to record step' });
  }
});

/**
 * POST /api/partners
 * Registers a partner. Accepts many field name variants.
 * Important: ensures insertId (including BigInt) is converted to string before res.json().
 */
router.post('/', async (req, res) => {
  // If you implemented a controller, prefer it (it should handle JSON-safe values itself).
  if (typeof registerPartnerController === 'function') {
    try {
      return await registerPartnerController(req, res);
    } catch (err) {
      console.error('[partners] registerPartner controller threw:', err && (err.stack || err));
      // fall through to inline implementation
    }
  }

  try {
    const body = req.body || {};

    // tolerant extraction helper (case-sensitive first, then case-insensitive)
    const pick = (cands) => {
      for (const k of cands) {
        if (Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined && body[k] !== null) return body[k];
      }
      for (const bk of Object.keys(body)) {
        for (const k of cands) {
          if (bk.toLowerCase() === String(k).toLowerCase()) return body[bk];
        }
      }
      return undefined;
    };

    const surname = String(pick(['surname','title']) || '').trim();
    const name = String(pick(['name','fullName','full_name','firstName','first_name']) || '').trim();
    const mobile = String(pick(['mobile','phone','contact','whatsapp']) || '').trim();
    const email = String(pick(['email','mail','emailId','email_id','contactEmail']) || '').trim();
    const designation = String(pick(['designation','title','role']) || '').trim();
    const company = String(pick(['companyName','company','organization','org']) || '').trim();
    const businessType = String(pick(['businessType','business_type','companyType']) || '').trim();
    const businessOther = String(pick(['businessOther','business_other','company_type_other']) || '').trim();
    const partnership = String(pick(['partnership','partnershipType','partnership_type']) || '').trim();
    const terms = body.terms ? 1 : 0;

    if (!mobile) {
      return res.status(400).json({ success: false, error: 'mobile is required' });
    }

    const sql = `INSERT INTO partners (
      surname, name, mobile, email, designation, company,
      businessType, businessOther, partnership, terms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`;
    const params = [surname || null, name || null, mobile || null, email || null, designation || null, company || null, businessType || null, businessOther || null, partnership || null, terms];

    const execRes = await dbExec(sql, params);
    const info = unwrapExecResult(execRes);

    // Normalize insertId for JSON serialization (BigInt -> string)
    let insertedId = null;
    if (info && (info.insertId || info.insert_id)) {
      const raw = info.insertId || info.insert_id;
      insertedId = (typeof raw === 'bigint') ? raw.toString() : String(raw);
    }

    console.debug('[partners] insertedId:', insertedId);

    // Respond with JSON-safe insertedId
    res.json(convertBigIntForJson({ success: true, insertedId }));

    // Background: acknowledgement email (best-effort)
    (async () => {
      try {
        if (!email) {
          console.warn('[partners] partner saved but no email present; skipping ack mail');
          return;
        }
        const subject = 'RailTrans Expo — We received your partner request';
        const text = `Hello ${name || company || ''},

Thank you for your partner request. We have received your details and our team will get back to you soon.

Regards,
RailTrans Expo Team`;
        const html = `<p>Hello ${name || company || ''},</p><p>Thank you for your partner request. We have received your details and our team will get back to you soon.</p>`;
        try {
          const mailResult = await sendMail({ to: email, subject, text, html });
          console.debug('[mailer] partner ack result:', email, mailResult);
        } catch (mailErr) {
          console.error('[partners] partner ack email error:', mailErr && (mailErr.stack || mailErr));
        }
      } catch (bgErr) {
        console.error('[partners] background ack error:', bgErr && (bgErr.stack || bgErr));
      }
    })();

    // Background: notify admins (best-effort)
    (async () => {
      try {
        const adminAddrs = (process.env.PARTNER_ADMIN_EMAILS || process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!adminAddrs.length) {
          console.debug('[partners] no admin emails configured (PARTNER_ADMIN_EMAILS / ADMIN_EMAILS)');
          return;
        }
        const subject = `New partner registration — ID: ${insertedId || 'n/a'}`;
        const html = `<p>A new partner has registered.</p>
          <ul>
            <li><b>ID:</b> ${insertedId || ''}</li>
            <li><b>Name:</b> ${name || ''}</li>
            <li><b>Company:</b> ${company || ''}</li>
            <li><b>Mobile:</b> ${mobile || ''}</li>
            <li><b>Email:</b> ${email || ''}</li>
          </ul>`;
        const text = `New partner registration
ID: ${insertedId || ''}
Name: ${name || ''}
Company: ${company || ''}
Mobile: ${mobile || ''}
Email: ${email || ''}`;

        await Promise.all(adminAddrs.map(async (a) => {
          try { await sendMail({ to: a, subject, text, html }); } catch (e) { console.error('[mailer] admin notify error', a, e && e.message); }
        }));
      } catch (bgErr) {
        console.error('[partners] background admin notify error:', bgErr && (bgErr.stack || bgErr));
      }
    })();

  } catch (err) {
    console.error('[partners] register error:', err && (err.stack || err));
    // Avoid returning non-serializable properties in error response
    return res.status(500).json({ success: false, error: err && err.message ? err.message : String(err) });
  }
});

/**
 * POST /api/partners/notify
 * Re-send notifications - partnerId or form required
 */
router.post('/notify', async (req, res) => {
  try {
    const { partnerId, form } = req.body || {};
    let partner = null;

    if (partnerId) {
      const raw = await dbExec('SELECT * FROM partners WHERE id = ? LIMIT 1', [partnerId]);
      const rows = normalizeRows(raw);
      partner = rows && rows.length ? rows[0] : null;
    } else if (form) {
      partner = form;
    } else {
      return res.status(400).json({ success: false, error: 'partnerId or form required' });
    }

    const to = partner && (partner.email || partner.emailAddress || partner.contactEmail);
    const name = partner && (partner.name || partner.company || '');
    const subject = 'RailTrans Expo — Partner Notification';
    const text = `Hello ${name || ''},

This is a notification regarding your partner registration.

Regards,
RailTrans Expo Team`;
    const html = `<p>Hello ${name || ''},</p><p>This is a notification regarding your partner registration.</p><p>Regards,<br/>RailTrans Expo Team</p>`;

    const resPartnerMail = to ? await sendMail({ to, subject, text, html }).catch(e => ({ success: false, error: String(e && e.message ? e.message : e) })) : { success: false, error: 'no-recipient' };

    const adminAddrs = (process.env.PARTNER_ADMIN_EMAILS || process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
    const adminResults = [];
    if (adminAddrs.length) {
      const adminSubject = `Partner notification — ${partnerId || (partner && (partner.name || partner.company)) || 'new'}`;
      const adminHtml = `<p>Partner notification sent.</p><pre>${JSON.stringify(partner, null, 2)}</pre>`;
      const adminText = `Partner notification\n${JSON.stringify(partner, null, 2)}`;
      for (const a of adminAddrs) {
        try {
          const r = await sendMail({ to: a, subject: adminSubject, text: adminText, html: adminHtml });
          adminResults.push({ to: a, result: r });
        } catch (e) {
          adminResults.push({ to: a, error: String(e && e.message ? e.message : e) });
        }
      }
    }

    return res.json(convertBigIntForJson({ success: true, partnerMail: resPartnerMail, adminResults }));
  } catch (err) {
    console.error('[partners] notify error:', err && (err.stack || err));
    return res.status(500).json({ success: false, error: err && err.message ? err.message : String(err) });
  }
});

/* ---------- Read / Update / Delete endpoints ---------- */

router.get('/', async (req, res) => {
  try {
    const raw = await dbExec('SELECT * FROM partners ORDER BY id DESC');
    const rows = normalizeRows(raw);
    return res.json(convertBigIntForJson(rows));
  } catch (err) {
    console.error('[partners] fetch error:', err && (err.stack || err));
    return res.status(500).json({ error: 'Failed to fetch partners' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const raw = await dbExec('SELECT * FROM partners WHERE id = ? LIMIT 1', [req.params.id]);
    const rows = normalizeRows(raw);
    return res.json(convertBigIntForJson(rows && rows.length ? rows[0] : {}));
  } catch (err) {
    console.error('[partners] fetch by id error:', err && (err.stack || err));
    return res.status(500).json({ error: 'Failed to fetch partner' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const fields = { ...(req.body || {}) };
    delete fields.id;
    const keys = Object.keys(fields);
    if (!keys.length) return res.status(400).json({ success: false, error: 'No fields to update' });

    const colRes = await dbExec('SHOW COLUMNS FROM partners');
    const colRows = unwrapExecResult(colRes);
    const colMap = new Map((Array.isArray(colRows) ? colRows : []).map(r => [String(r.Field || r.COLUMN_NAME || '').toLowerCase(), r.Field || r.COLUMN_NAME || r]));

    const assignments = [];
    const values = [];
    for (const k of keys) {
      const cand = colMap.get(k.toLowerCase()) ?? colMap.get(camelToSnake(k).toLowerCase());
      if (cand) {
        let v = fields[k];
        if (v !== null && typeof v === 'object') {
          try { v = JSON.stringify(v); } catch { v = String(v); }
        }
        assignments.push(`${cand} = ?`);
        values.push(v);
      } else {
        console.debug(`[partners] Ignoring update field "${k}" - not a column`);
      }
    }

    if (!assignments.length) return res.status(400).json({ success: false, error: 'No valid fields to update' });

    values.push(req.params.id);
    const execRes = await dbExec(`UPDATE partners SET ${assignments.join(', ')} WHERE id = ?`, values);
    const info = unwrapExecResult(execRes);
    const affected = getAffectedRows(info);
    if (!affected) return res.status(404).json({ success: false, error: 'Partner not found' });

    return res.json({ success: true });
  } catch (err) {
    console.error('[partners] update error:', err && (err.stack || err));
    return res.status(500).json({ success: false, error: 'Failed to update partner' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const execRes = await dbExec('DELETE FROM partners WHERE id = ?', [req.params.id]);
    const info = unwrapExecResult(execRes);
    const affected = getAffectedRows(info);
    if (!affected) return res.status(404).json({ success: false, error: 'Partner not found' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[partners] delete error:', err && (err.stack || err));
    return res.status(500).json({ success: false, error: 'Failed to delete partner' });
  }
});

/* ---------- Approve / Cancel endpoints (keep same email behavior) ---------- */

router.post('/:id/approve', async (req, res) => {
  const id = req.params.id;
  const admin = req.body && req.body.admin ? String(req.body.admin) : 'web-admin';
  if (!id) return res.status(400).json({ success: false, error: 'Missing id' });

  try {
    let hasApprovedCols = false;
    try {
      const colCheck = await dbExec("SHOW COLUMNS FROM partners LIKE 'approved_by'");
      const checkRows = normalizeRows(colCheck);
      hasApprovedCols = Array.isArray(checkRows) && checkRows.length > 0;
    } catch (e) {
      console.warn('Could not check approved_by column existence:', e && e.message);
      hasApprovedCols = false;
    }

    const sql = hasApprovedCols
      ? `UPDATE partners SET status = 'approved', approved_by = ?, approved_at = NOW() WHERE id = ?`
      : `UPDATE partners SET status = 'approved' WHERE id = ?`;
    const params = hasApprovedCols ? [admin, id] : [id];

    const execRes = await dbExec(sql, params);
    const info = unwrapExecResult(execRes);
    const affected = getAffectedRows(info);
    if (!affected) return res.status(404).json({ success: false, error: 'Partner not found' });

    const raw = await dbExec('SELECT * FROM partners WHERE id = ? LIMIT 1', [id]);
    const rows = normalizeRows(raw);
    const updated = rows && rows.length ? rows[0] : null;

    res.json(convertBigIntForJson({ success: true, id, updated }));

    // send approval email in background...
    if (updated && updated.email) {
      (async () => {
        try {
          const to = updated.email;
          const fullName = updated.name || updated.company || '';
          const subject = `Your partner request has been approved — RailTrans Expo`;
          const text = `Hello ${fullName || ''},

Good news — your partner registration (ID: ${updated.id}) has been approved. Our team will contact you with next steps.

Regards,
RailTrans Expo Team`;
          const html = `<p>Hello ${fullName || ''},</p><p>Your partner registration (ID: <strong>${updated.id}</strong>) has been <strong>approved</strong>.</p>`;
          await sendMail({ to, subject, text, html });
          console.debug('[mailer] Approval email result for partner:', to);
        } catch (mailErr) {
          console.error('[mailer] Approval email error for partner:', mailErr && (mailErr.stack || mailErr));
        }
      })();
    }

  } catch (err) {
    console.error('Approve partner error:', err && (err.stack || err));
    const message = (err && (err.sqlMessage || err.message)) || 'Server error approving partner';
    return res.status(500).json({ success: false, error: message });
  }
});

router.post('/:id/cancel', async (req, res) => {
  const id = req.params.id;
  const admin = req.body && req.body.admin ? String(req.body.admin) : 'web-admin';
  if (!id) return res.status(400).json({ success: false, error: 'Missing id' });

  try {
    let hasCancelledCols = false;
    try {
      const colCheck = await dbExec("SHOW COLUMNS FROM partners LIKE 'cancelled_by'");
      const checkRows = normalizeRows(colCheck);
      hasCancelledCols = Array.isArray(checkRows) && checkRows.length > 0;
    } catch (e) {
      console.warn('Could not check cancelled_by column existence:', e && e.message);
      hasCancelledCols = false;
    }

    const sql = hasCancelledCols
      ? `UPDATE partners SET status = 'cancelled', cancelled_by = ?, cancelled_at = NOW() WHERE id = ?`
      : `UPDATE partners SET status = 'cancelled' WHERE id = ?`;
    const params = hasCancelledCols ? [admin, id] : [id];

    const execRes = await dbExec(sql, params);
    const info = unwrapExecResult(execRes);
    const affected = getAffectedRows(info);
    if (!affected) return res.status(404).json({ success: false, error: 'Partner not found' });

    const raw = await dbExec('SELECT * FROM partners WHERE id = ? LIMIT 1', [id]);
    const rows = normalizeRows(raw);
    const updated = rows && rows.length ? rows[0] : null;

    res.json(convertBigIntForJson({ success: true, id, updated }));

    // send cancellation email in background...
    if (updated && updated.email) {
      (async () => {
        try {
          const to = updated.email;
          const fullName = updated.name || updated.company || '';
          const subject = `Your partner registration has been cancelled — RailTrans Expo`;
          const text = `Hello ${fullName || 'there'},

Your partner registration (ID: ${updated.id}) has been cancelled. If you believe this is an error, contact support@railtransexpo.com.

Regards,
RailTrans Expo Team`;
          const html = `<p>Hello ${fullName || 'there'},</p><p>Your partner registration (ID: <strong>${updated.id}</strong>) has been <strong>cancelled</strong>.</p>`;
          await sendMail({ to, subject, text, html });
          console.debug('[mailer] Cancel email result for partner:', to);
        } catch (mailErr) {
          console.error('[mailer] Cancel email error for partner:', mailErr && (mailErr.stack || mailErr));
        }
      })();
    }

  } catch (err) {
    console.error('Cancel partner error:', err && (err.stack || err));
    const message = (err && (err.sqlMessage || err.message)) || 'Server error cancelling partner';
    return res.status(500).json({ success: false, error: message });
  }
});

module.exports = router;