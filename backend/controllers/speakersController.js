const pool = require('../db');
const { appendStep } = require('./fileLogger'); // optional, keep if you use it

/**
 * registerSpeaker - create speaker row and return inserted id + ticket_code
 * - Builds INSERT dynamically based on actual speakers table columns (defensive)
 * - Generates ticket_code if not supplied
 */
exports.registerSpeaker = async (req, res) => {
  try {
    console.log('[speakers] incoming body (trim):', JSON.stringify(req.body || {}).slice(0, 2000));

    const body = req.body || {};
    const {
      title, name, mobile, email, designation,
      organization, sessionType, sessionOther, topic, abstract, terms,
      ticket_code: incomingTicketCode, txId, slots
    } = body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ success: false, message: 'Valid email is required.' });
    }

    const ticketCode = incomingTicketCode && String(incomingTicketCode).trim()
      ? String(incomingTicketCode).trim()
      : String(Math.floor(100000 + Math.random() * 900000)); // 6-digit by default

    const conn = await pool.getConnection();
    try {
      // Discover columns on speakers table
      const colsRaw = await conn.query('SHOW COLUMNS FROM speakers');
      const colsResolved = Array.isArray(colsRaw) && Array.isArray(colsRaw[0]) ? colsRaw[0] : colsRaw;
      const allowedColumns = Array.isArray(colsResolved) ? colsResolved.map(c => c.Field) : [];

      // Map potential fields -> column names
      const candidateMap = {
        title: 'title',
        name: 'name',
        mobile: 'mobile',
        email: 'email',
        designation: 'designation',
        organization: 'organization',
        sessionType: 'sessionType',
        sessionOther: 'sessionOther',
        topic: 'topic',
        abstract: 'abstract',
        terms: 'terms',
        ticket_code: 'ticket_code',
        txId: 'txId',
        slots: 'slots',
      };

      const insertCols = [];
      const insertPlaceholders = [];
      const insertParams = [];

      // Helper to add a column if it exists in allowedColumns
      const pushIfAllowed = (colName, value, asNow = false) => {
        if (!allowedColumns.includes(colName)) return;
        insertCols.push(colName);
        if (asNow) {
          insertPlaceholders.push('NOW()');
        } else {
          insertPlaceholders.push('?');
          insertParams.push(value);
        }
      };

      // Add standard fields if present in table
      pushIfAllowed(candidateMap.title, title || '');
      pushIfAllowed(candidateMap.name, name || '');
      pushIfAllowed(candidateMap.mobile, mobile || '');
      pushIfAllowed(candidateMap.email, email || '');
      pushIfAllowed(candidateMap.designation, designation || '');
      pushIfAllowed(candidateMap.organization, organization || '');
      pushIfAllowed(candidateMap.sessionType, sessionType || '');
      pushIfAllowed(candidateMap.sessionOther, sessionOther || '');
      pushIfAllowed(candidateMap.topic, topic || '');
      pushIfAllowed(candidateMap.abstract, abstract || '');
      // terms -> convert to 1/0 if column exists
      pushIfAllowed(candidateMap.terms, terms ? 1 : 0);
      // ticket_code -> always include if column exists (use generated value)
      pushIfAllowed(candidateMap.ticket_code, ticketCode);
      // txId only if column exists
      if (txId) pushIfAllowed(candidateMap.txId, txId);
      // slots -> store JSON string if column exists
      if (slots !== undefined) {
        const slotsJson = Array.isArray(slots) ? JSON.stringify(slots) : (typeof slots === 'string' ? slots : JSON.stringify([]));
        pushIfAllowed(candidateMap.slots, slotsJson);
      }

      // registered_at: if table has column, set to NOW()
      if (allowedColumns.includes('registered_at')) {
        insertCols.push('registered_at');
        insertPlaceholders.push('NOW()');
      }

      if (insertCols.length === 0) {
        return res.status(500).json({ success: false, message: 'No writable columns found in speakers table.' });
      }

      const sql = `INSERT INTO speakers (${insertCols.join(', ')}) VALUES (${insertPlaceholders.join(', ')})`;
      // Execute
      const queryResult = await conn.query(sql, insertParams);

      // Normalize result shape to get insert id
      let resultObj = null;
      if (Array.isArray(queryResult) && queryResult.length > 0 && typeof queryResult[0] === 'object') {
        resultObj = queryResult[0];
      } else if (typeof queryResult === 'object') {
        resultObj = queryResult;
      }

      let insertedId = null;
      if (resultObj) {
        if ('insertId' in resultObj) insertedId = resultObj.insertId;
        else if ('insert_id' in resultObj) insertedId = resultObj.insert_id;
        else if ('insertId' in queryResult) insertedId = queryResult.insertId;
      }

      if (typeof insertedId === 'bigint') {
        const asNumber = Number(insertedId);
        insertedId = Number.isSafeInteger(asNumber) ? asNumber : String(insertedId);
      }

      console.log('[speakers] insertedId:', insertedId, 'ticketCode:', ticketCode);

      // optional: append step log
      try {
        if (appendStep && typeof appendStep === 'function') {
          await appendStep('speaker-registration', { name, email, mobile, ticket_category: body.ticket_category || '' }, { insertedId, ticketCode });
        }
      } catch (e) {
        console.warn('[speakers] appendStep failed:', e && e.message ? e.message : e);
      }

      return res.json({ success: true, message: 'Speaker registered successfully.', insertedId, ticket_code: ticketCode });
    } finally {
      try { conn.release && conn.release(); } catch (e) {}
    }
  } catch (err) {
    console.error('[speakers] registerSpeaker error:', err && (err.stack || err));
    return res.status(500).json({ success: false, message: 'Database error.', details: String(err && err.message ? err.message : err) });
  }
};