// HERE Search istasyon listesi (ara sunucu üzerinden: /here/stations). Yanıtta güç ve soket türü vardır (Mapbox'ta yoktu): DC kW doğrudan gelir.
// Sunucuda HERE anahtarı yoksa ya da aylık hak dolduysa (402) fatal hata fırlatılır; çağıran Mapbox/Overpass'e düşer.
import { classify } from '../routing/operators.js';
import { candidate } from '../routing/chargerSource.js';
import { cached } from '../utils/cache.js';
import { proxyFetchRetry, proxyHas } from '../net/proxy.js';

const R_KM = 20; // her dairenin yarıçapı (sunucu en çok 40 km kabul eder)
const SPACING_KM = 30; // daire merkezleri arası (daireler örtüşür)
const MAX_DEPTH = 1; // 100 kayıtla dolan daire dörde bölünür
const MAX_CALLS = 120;
const TTL_MS = 2 * 3600e3;
const PARALLEL = 3;

export const hereOn = () => proxyHas('here');

export class HereError extends Error {
  constructor(message, { fatal = false } = {}) { super(message); this.fatal = fatal; }
}

const dLat = (km) => km / 111.2;
const dLon = (km, lat) => km / (111.2 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));

/** Sunucunun kısa kaydı { id, n, la, lo, s, dc, ac } → aday istasyon. */
export function fromHere(f) {
  if (f?.la == null || f?.lo == null) return null;
  const name = f.n || 'Şarj istasyonu';
  return candidate({
    id: 'h' + f.id, name, lat: f.la, lon: f.lo, opId: classify(name, f.s), src: 'HERE',
    hasDc: !!f.dc, dcKw: f.dc || null, acKw: f.ac || null, anyInfo: true,
  });
}

async function circle(lat, lon, r) {
  let res;
  try { res = await proxyFetchRetry(`/here/stations?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&r=${r}`, {}, { timeoutMs: 20000 }); } catch { throw new HereError('Ara sunucuya ulaşılamadı', { fatal: true }); }
  if (res.status === 402) throw new HereError('HERE aylık hakkı doldu', { fatal: true });
  if (res.status === 501 || res.status === 401) throw new HereError(res.status === 501 ? 'Sunucuda HERE anahtarı yok' : 'Sunucu erişim kodu geçersiz', { fatal: true });
  if (res.status === 502) { // sunucu HERE'den 401/403 aldıysa (anahtar iptal/süresi dolmuş) tek tek denemenin anlamı yok: diğer kaynağa geç
    const j = await res.json().catch(() => null);
    if (/HERE HTTP 40[13]/.test(j?.error || '')) throw new HereError('HERE anahtarı geçersiz', { fatal: true });
    throw new HereError('HERE HTTP 502');
  }
  if (!res.ok) throw new HereError(`HERE HTTP ${res.status}`);
  return res.json();
}

/** Daire listesini (gerekirse bölerek) tara. Dönüş: { out: Map, raw, calls, failed, skipped, fatal, lastError }. */
async function run(circles) {
  const ctx = { out: new Map(), raw: 0, calls: 0, failed: 0, skipped: 0, fatal: null, lastError: '' };
  const queue = [...circles];
  const one = async (c) => {
    const j = await cached(`here:${c.lat.toFixed(3)},${c.lon.toFixed(3)}:${c.r}`, TTL_MS, async () => { ctx.calls++; return circle(c.lat, c.lon, c.r); }, { persist: false });
    ctx.raw += j.items?.length || 0;
    for (const f of j.items || []) { const s = fromHere(f); if (s) ctx.out.set(s.id, s); }
    if (j.full && c.depth < MAX_DEPTH && c.r > 6) {
      const r = Math.ceil(c.r / 2);
      for (const sy of [-1, 1]) for (const sx of [-1, 1]) queue.push({ lat: c.lat + sy * dLat(c.r / 2), lon: c.lon + sx * dLon(c.r / 2, c.lat), r, depth: c.depth + 1 });
    }
  };
  const worker = async () => {
    while (queue.length && !ctx.fatal) {
      if (ctx.calls >= MAX_CALLS) { ctx.skipped += queue.length; queue.length = 0; break; }
      const c = queue.shift();
      try { await one(c); } catch (err) {
        if (err.fatal) ctx.fatal = err; else { ctx.failed++; ctx.lastError = err.message; }
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  if (!ctx.fatal && ctx.failed && !ctx.out.size) ctx.fatal = new HereError('HERE yanıt vermedi', { fatal: true }); // hiç sonuç yok: Mapbox/Overpass'e düşülsün
  return ctx;
}

/** Rota boyunca istasyonlar (pts: { lat, lon, km } dizisi). */
export function stationsAlong(pts) {
  const circles = [];
  let next = 0;
  for (const p of pts) {
    if (p.km < next) continue;
    next = p.km + SPACING_KM;
    circles.push({ lat: p.lat, lon: p.lon, r: R_KM, depth: 0 });
  }
  return run(circles);
}

/** Bir noktanın etrafında (yarıçap km, en çok 40) istasyonlar. */
export const stationsAround = (lat, lon, radiusKm) => run([{ lat, lon, r: Math.min(40, Math.max(1, Math.round(radiusKm))), depth: 0 }]);
