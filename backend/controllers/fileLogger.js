const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(process.cwd(), 'logs', 'visitors');

function ensureDir() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (e) {
    // ignore
  }
}

// JSON replacer that safely handles BigInt by converting to string
function jsonReplacer(_key, value) {
  if (typeof value === 'bigint') {
    // convert BigInt to string to avoid JSON.stringify error
    return value.toString();
  }
  return value;
}

/**
 * Append a JSON line to logs/visitors/<step>.jsonl
 * Each line is a JSON object: { ts, step, data, meta }
 */
async function appendStep(stepName, data, meta = {}) {
  try {
    ensureDir();
    const safeStep = String(stepName).replace(/[^a-z0-9_-]/gi, '_');
    const file = path.join(LOG_DIR, `${safeStep}.jsonl`);
    const payload = {
      ts: new Date().toISOString(),
      step: stepName,
      data: data === undefined ? null : data,
      meta: meta === undefined ? null : meta,
    };
    const line = JSON.stringify(payload, jsonReplacer);
    await fs.promises.appendFile(file, line + '\n', 'utf8');
    return true;
  } catch (err) {
    console.error('[fileLogger] appendStep error:', err && err.message ? err.message : err);
    return false;
  }
}

module.exports = { appendStep };