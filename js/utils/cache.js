// Ortak önbellek: aynı bilgiyi (hava, rakım, hız limiti, adres, arama…) Google'dan tekrar tekrar sormamak için.
// - Bellek + (persist ise) LocalStorage; her kayıt bir son kullanma süresiyle (TTL) saklanır, süresi dolan atılır.
// - Aynı anahtar için eşzamanlı çağrılar tek istekte birleşir (in-flight tekilleştirme).
// - İstatistik: isabet = Google'a gidilmeyen çağrı (kota/fatura tasarrufu).
// NOT: Google hizmet şartları Maps içeriğinin uzun süre saklanmasını kısıtlar; bu yüzden TTL'ler kısa tutulur (TTL sabitleri).
import { load, save, remove } from './storage.js';

export const TTL = {
  short: 2 * 60e3, // canlı doluluk
  route: 10 * 60e3, // trafikli rota, otomatik tamamlama
  weather: 30 * 60e3, // saatlik tahmin
  long: 6 * 3600e3, // rakım, adres, hız limiti, istasyon ayrıntısı
};

const PREFIX = 'c.';
const IDX = 'cidx';
const MAX_ENTRIES = 300;
const mem = new Map(); // anahtar → { e (bitiş ms), v }
const inflight = new Map();
const stats = { hits: 0, misses: 0 };
let idx = null; // kalıcı kayıtların dizini [{ k, e }]

function loadIdx() {
  if (idx) return idx;
  const now = Date.now();
  idx = load(IDX, []).filter((x) => x.e > now);
  // süresi dolanları depodan da sil
  load(IDX, []).filter((x) => x.e <= now).forEach((x) => remove(PREFIX + x.k));
  save(IDX, idx);
  return idx;
}

export function cacheGet(key) {
  const now = Date.now();
  const m = mem.get(key);
  if (m) return m.e > now ? m.v : (mem.delete(key), undefined);
  const rec = load(PREFIX + key, null);
  if (rec && rec.e > now) { mem.set(key, rec); return rec.v; }
  return undefined;
}

export function cacheSet(key, value, ttlMs, { persist = true } = {}) {
  const rec = { e: Date.now() + ttlMs, v: value };
  mem.set(key, rec);
  if (!persist) return;
  const list = loadIdx();
  const i = list.findIndex((x) => x.k === key);
  if (i >= 0) list.splice(i, 1);
  list.push({ k: key, e: rec.e });
  while (list.length > MAX_ENTRIES) remove(PREFIX + list.shift().k); // en eskiyi at
  save(PREFIX + key, rec);
  save(IDX, list);
}

/** key için önbellekte varsa onu, yoksa fn()'i çalıştırıp sonucu ttl süresince sakla. undefined/null sonuç saklanmaz. */
export async function cached(key, ttlMs, fn, opts = {}) {
  const hit = cacheGet(key);
  if (hit !== undefined) { stats.hits++; return hit; }
  if (inflight.has(key)) { stats.hits++; return inflight.get(key); }
  stats.misses++;
  const p = (async () => {
    try {
      const v = await fn();
      if (v != null) cacheSet(key, v, ttlMs, opts);
      return v;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export function cacheStats() {
  return { ...stats, entries: loadIdx().length, memory: mem.size };
}

export function clearCache() {
  loadIdx().forEach((x) => remove(PREFIX + x.k));
  idx = [];
  save(IDX, idx);
  mem.clear();
  stats.hits = 0;
  stats.misses = 0;
}
