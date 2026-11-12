// Google Places istasyon listesi (ara sunucu üzerinden: /google/stations). Ücretli ve yalnızca Premium: ek kaynak olarak kullanılır (öteki kaynakların bulamadığını tamamlar;
// aynı yerde aynı işletmeci varsa önce gelen kayıt kalır, bkz. routing/chargerSource.js dedupe). Tek çağrı en çok 20 kayıt döndürür; 20 dolarsa daire bir kez dörde bölünür.
// Sunucuda anahtar yoksa, hesap Premium değilse ya da günlük tavan dolduysa fatal hata fırlatılır; çağıran diğer kaynaklarla sürer.
import { classify } from '../routing/operators.js';
import { candidate } from '../routing/chargerSource.js';
import { cached } from '../utils/cache.js';
import { proxyFetchRetry, proxyHas } from '../net/proxy.js';

const R_KM = 20; // her dairenin yarıçapı (sunucu en çok 30 km kabul eder)
const SPACING_KM = 35; // daire merkezleri arası: rota çizgisi ±3 km koridorda her zaman bir daireye girer
const MAX_DEPTH = 1; // 20 kayıtla dolan daire dörde bölünür
const MAX_CALLS = 30; // bir arama için üst sınır (ücretli: çağrı başına ~0,04 USD, ayda ilk 1000 ücretsiz)
const TTL_MS = 2 * 3600e3;
const PARALLEL = 3;

export const googleOn = () => proxyHas('googleStations');

export class GoogleError extends Error {
  constructor(message, { fatal = false } = {}) { super(message); this.fatal = fatal; }
}

const dLat = (km) => km / 111.2;
const dLon = (km, lat) => km / (111.2 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));

/** Sunucunun kısa kaydı { id, n, la, lo, dc, ac, k } → aday istasyon. k=0: bağlayıcı bilgisi yok (güç bilinmiyor, "belirsiz"). */
export function fromGoogle(f) {
  if (f?.la == null || f?.lo == null) return null;
  const name = f.n || 'Şarj istasyonu';
  return candidate({
    id: 'g' + f.id, name, lat: f.la, lon: f.lo, opId: classify(name), src: 'Google',
    hasDc: !!f.dc, dcKw: f.dc || null, acKw: f.ac || null, anyInfo: !!f.k,
  });
}

async function circle(lat, lon, r) {
  let res;
  try { res = await proxyFetchRetry(`/google/stations?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&r=${r}`, {}, { timeoutMs: 20000 }); } catch { throw new GoogleError('Ara sunucuya ulaşılamadı', { fatal: true }); }
  if (res.status === 402) {
    const j = await res.json().catch(() => null);
    throw new GoogleError(j?.error === 'premium_required' ? 'Google istasyonları Premium gerektirir' : 'Google günlük hakkı doldu', { fatal: true });
  }
  if (res.status === 501 || res.status === 401) throw new GoogleError(res.status === 501 ? 'Sunucuda Google anahtarı yok' : 'Sunucu erişim kodu geçersiz', { fatal: true });
  if (res.status === 429) throw new GoogleError('Google günlük hakkı doldu', { fatal: true });
  if (res.status === 502) { // sunucu Google'dan 400/403 aldıysa (anahtar/API izni sorunu) tek tek denemenin anlamı yok
    const j = await res.json().catch(() => null);
    if (/Google HTTP 40[03]/.test(j?.error || '')) throw new GoogleError('Google anahtarı ya da API izni geçersiz', { fatal: true });
    throw new GoogleError('Google HTTP 502');
  }
  if (!res.ok) throw new GoogleError(`Google HTTP ${res.status}`);
  return res.json();
}

/** Daire listesini (gerekirse bölerek) tara. Dönüş: { out: Map, raw, calls, failed, skipped, fatal, lastError }. */
async function run(circles) {
  const ctx = { out: new Map(), raw: 0, calls: 0, failed: 0, skipped: 0, fatal: null, lastError: '' };
  const queue = [...circles];
  const one = async (c) => {
    const j = await cached(`gplaces:${c.lat.toFixed(3)},${c.lon.toFixed(3)}:${c.r}`, TTL_MS, async () => { ctx.calls++; return circle(c.lat, c.lon, c.r); }, { persist: false });
    ctx.raw += j.items?.length || 0;
    for (const f of j.items || []) { const s = fromGoogle(f); if (s) ctx.out.set(s.id, s); }
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

/** Bir noktanın etrafında (yarıçap km, en çok 30) istasyonlar. */
export const stationsAround = (lat, lon, radiusKm) => run([{ lat, lon, r: Math.min(30, Math.max(1, Math.round(radiusKm))), depth: 0 }]);
