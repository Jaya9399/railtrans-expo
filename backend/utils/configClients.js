// Central client utility to read/write config docs stored via /api/configs/:key
// Usage:
//   import { getConfig, saveConfig, useConfig, subscribeConfig } from '../utils/configClient';
//   const cfg = await getConfig('event-details');
//   await saveConfig('event-details', { name: '...', date: '...' });
//   const [value, reload] = useConfig('event-details');

const API_BASE = (
  process.env.REACT_APP_API_BASE ||
  process.env.REACT_APP_API_BASE_URL ||
  window.__API_BASE__ ||
  ""
).replace(/\/$/, "");

function buildUrl(key) {
  const k = encodeURIComponent(String(key || '').trim());
  if (!k) throw new Error('config key required');
  const base = API_BASE || '';
  return `${base}/api/configs/${k}`;
}

async function getConfig(key) {
  const url = buildUrl(key);
  const res = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Failed to fetch config ${key}: ${res.status} ${txt}`);
  }
  const js = await res.json().catch(() => ({}));
  // server returns { success:true, key, value: {...} } shape; handle both shapes
  if (js && js.success !== false && ('value' in js)) return js.value;
  if (js && js.value !== undefined) return js.value;
  return js;
}

async function saveConfig(key, value) {
  const url = buildUrl(key);
  const res = await fetch(`${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value || {}),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Failed to save config ${key}: ${res.status} ${txt}`);
  }
  const js = await res.json().catch(() => ({}));
  // notify other listeners in the SPA
  try { window.dispatchEvent(new CustomEvent('config-updated', { detail: { key } })); } catch {}
  return js;
}

/* lightweight cache + subscription system */
const cache = {};
const subs = {};

function notify(key, val) {
  cache[key] = val;
  (subs[key] || []).slice().forEach(fn => {
    try { fn(val); } catch (e) { console.warn('configClient subscriber error', e); }
  });
}

async function fetchAndCache(key) {
  try {
    const v = await getConfig(key);
    notify(key, v);
    return v;
  } catch (e) {
    console.warn('fetchAndCache error', key, e);
    notify(key, cache[key] || null);
    return cache[key] || null;
  }
}

function subscribeConfig(key, cb) {
  subs[key] = subs[key] || [];
  subs[key].push(cb);
  return () => { subs[key] = (subs[key] || []).filter(f => f !== cb); };
}

/* React hook */
import React from 'react';
function useConfig(key) {
  const [value, setValue] = React.useState(() => cache[key]);
  React.useEffect(() => {
    let mounted = true;
    const unsub = subscribeConfig(key, (v) => { if (mounted) setValue(v); });
    if (cache[key] === undefined) {
      fetchAndCache(key).then(() => { if (mounted) setValue(cache[key]); }).catch(() => {});
    }
    // also listen to global config-updated events
    function onGlobal(e) {
      const k = (e && e.detail && e.detail.key) ? e.detail.key : null;
      if (!k || k === key) fetchAndCache(key).catch(()=>{});
    }
    window.addEventListener('config-updated', onGlobal);
    window.addEventListener('event-details-updated', onGlobal); // backward compat
    return () => { mounted = false; unsub(); window.removeEventListener('config-updated', onGlobal); window.removeEventListener('event-details-updated', onGlobal); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const reload = React.useCallback(() => fetchAndCache(key), [key]);
  return [value, reload];
}

export {
  getConfig,
  saveConfig,
  useConfig,
  subscribeConfig,
  fetchAndCache as fetchConfigAndCache,
};