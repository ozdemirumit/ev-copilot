const PREFIX = 'evcp.';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

const saveHooks = new Set();
/** Her kayıtta (anahtar, değer) ile çağrılır: hesap senkronu değişen ayarları fark etsin diye. */
export const onSave = (fn) => saveHooks.add(fn);

export function save(key, value, { silent = false } = {}) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch { /* özel pencere / kota: sessizce geç */ }
  if (!silent) saveHooks.forEach((fn) => { try { fn(key, value); } catch { /* senkron hatası kaydı bozmasın */ } });
}

export function remove(key) {
  try { localStorage.removeItem(PREFIX + key); } catch { /* yoksay */ }
}
