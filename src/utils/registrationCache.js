// Utilities to store/read registration records in localStorage and notify listeners.
// Used to keep TicketUpgrade and Dashboard in sync after an upgrade.

const REG_CACHE_PREFIX = "registration_cache";

/**
 * Write a single registration record to cache and dispatch update notifications.
 * @param {string} entity - e.g. "visitors"
 * @param {string|number} id
 * @param {object} data
 */
export function writeRegistrationCache(entity, id, data) {
  if (!entity || !id || !data) return;
  try {
    const key = `${REG_CACHE_PREFIX}_${entity}_${id}`;
    localStorage.setItem(key, JSON.stringify(data));
    // dispatch a window custom event so same-window listeners (dashboard) can react immediately
    try {
      window.dispatchEvent(new CustomEvent("registration-updated", { detail: { entity, id, data } }));
    } catch (e) { /* ignore */ }
    // also postMessage to opener if present (cross-window)
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: "registration", entity, data }, "*");
      }
    } catch (e) { /* ignore */ }
  } catch (e) {
    console.warn("writeRegistrationCache failed", e);
  }
}

/**
 * Read a cached registration record from localStorage if present.
 * @param {string} entity
 * @param {string|number} id
 * @returns {object|null}
 */
export function readRegistrationCache(entity, id) {
  try {
    const key = `${REG_CACHE_PREFIX}_${entity}_${id}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/**
 * Remove a cached registration
 */
export function removeRegistrationCache(entity, id) {
  try {
    const key = `${REG_CACHE_PREFIX}_${entity}_${id}`;
    localStorage.removeItem(key);
  } catch (e) {}
}