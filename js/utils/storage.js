const PREFIX = 'evcp.';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch { /* özel pencere / kota: sessizce geç */ }
}

export function remove(key) {
  try { localStorage.removeItem(PREFIX + key); } catch { /* yoksay */ }
}
