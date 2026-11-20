// Google Places istasyon listesi (ara sunucu üzerinden: /google/stations). Ücretli ve yalnızca Premium: ek kaynak olarak kullanılır (öteki kaynakların bulamadığını tamamlar;
// aynı yerde aynı işletmeci varsa önce gelen kayıt kalır, bkz. routing/chargerSource.js dedupe). Tek çağrı en çok 20 kayıt döndürür; 20 dolarsa daire bir kez dörde bölünür.
// Sunucuda anahtar yoksa, hesap Premium değilse, sunucunun günlük tavanı dolduysa (402 google_cap) ya da Google hız sınırı (429) geldiyse fatal hata; çağıran diğer kaynaklarla sürer.
// Google'ın geçici hatası (sunucudan JSON 502/503/504) sınırlı sayıda yeniden denenir; ücretli çağrı sınırı (MAX_CALLS) yeniden denemelerle aşılmaz.
import { classify } from '../routing/operators.js';
import { candidate } from '../routing/chargerSource.js';
import { cached } from '../utils/cache.js';
import { proxyFetchRetry, proxyHas } from '../net/proxy.js';

const R_KM = 20; // her dairenin yarıçapı (sunucu en çok 30 km kabul eder)
const SPACING_KM = 35; // daire merkezleri arası: rota çizgisi ±3 km koridorda her zaman bir daireye girer
const MAX_DEPTH = 1; // 20 kayıtla dolan daire dörde bölünür
export const MAX_CALLS = 30; // bir arama için ücretli çağrı üst sınırı — uygulamanın kendi maliyet sınırı, Google kotası değil (çağrı başına ~0,04 USD, ayda ilk 1000 ücretsiz). Yeniden denemeler de bundan düşer.
const TTL_MS = 2 * 3600e3;
const PARALLEL = 3;
const RETRY_PER_CIRCLE = 1; // geçici hata (502/503/504) alan daire en çok bir kez yeniden denenir
const MAX_RETRIES = 4; // bir aramadaki toplam yeniden deneme hakkı (Google uzun süre yanıt vermiyorsa ücretli sınırı yeniden denemeyle tüketmemek için)
export const googleTuning = { sleep: (ms) => new Promise((r) => setTimeout(r, ms)), delayMs: 1500 }; // testler uykuyu değiştirir

export const googleOn = () => proxyHas('googleStations');

/** kind: cap (sunucu günlük tavanı, 402 google_cap) | rate (Google geçici istek sınırı, 429) | premium | key | aborted (yeni rota planlandı) | ''. transient: yeniden denenebilir (502/503/504). */
export class GoogleError extends Error {
  constructor(message, { fatal = false, kind = '', transient = false } = {}) { super(message); this.fatal = fatal; this.kind = kind; this.transient = transient; }
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

const aborted = () => new GoogleError('Google araması iptal edildi', { kind: 'aborted' });

async function circle(lat, lon, r, signal) {
  let res;
  try { res = await proxyFetchRetry(`/google/stations?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&r=${r}`, { signal }, { timeoutMs: 20000 }); } catch {
    if (signal?.aborted) throw aborted();
    throw new GoogleError('Ara sunucuya ulaşılamadı', { fatal: true });
  }
  if (res.status === 402) {
    const j = await res.json().catch(() => null);
    if (j?.error === 'premium_required') throw new GoogleError('Google istasyonları Premium gerektirir', { fatal: true, kind: 'premium' });
    throw new GoogleError('Google istasyon aramasının sunucudaki günlük sınırı doldu; yarın yenilenir', { fatal: true, kind: 'cap' }); // 402 google_cap: bizim sunucumuzun tavanı
  }
  if (res.status === 501 || res.status === 401) throw new GoogleError(res.status === 501 ? 'Sunucuda Google anahtarı yok' : 'Sunucu erişim kodu geçersiz', { fatal: true, kind: 'key' });
  if (res.status === 429) throw new GoogleError('Google geçici istek sınırına ulaşıldı (HTTP 429); biraz sonra yeniden dene', { fatal: true, kind: 'rate' }); // Google hız sınırı: bu aramada daha fazla istek atılmaz
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    const j = await res.json().catch(() => null);
    const e = String(j?.error || '');
    if (/Google HTTP 40[03]/.test(e)) throw new GoogleError('Google anahtarı ya da API izni geçersiz', { fatal: true, kind: 'key' }); // tek tek denemenin anlamı yok
    const m = /Google HTTP (4\d\d)/.exec(e);
    if (m) throw new GoogleError(`Google HTTP ${m[1]}`); // kalıcı istek hatası: yeniden denenmez
    throw new GoogleError(`Google geçici olarak yanıt vermedi (HTTP ${res.status})`, { transient: true }); // Google 5xx / zaman aşımı / sunucu meşgul
  }
  if (!res.ok) throw new GoogleError(`Google HTTP ${res.status}`);
  return res.json();
}

/**
 * Daire listesini (gerekirse bölerek) tara. Dönüş: { out: Map, raw, calls, failed, skipped, retries, cancelled, fatal, lastError }.
 * calls: atılan ücretli istek (yeniden denemeler dahil, en çok MAX_CALLS). skipped: sınır nedeniyle taranmayan alt bölge (daire) sayısı.
 * signal iptal edilirse (yeni rota planlandı) yeni istek atılmaz, süren istek kesilir; cancelled = true, hata sayılmaz.
 */
async function run(circles, signal) {
  const ctx = { out: new Map(), raw: 0, calls: 0, failed: 0, skipped: 0, retries: 0, cancelled: false, fatal: null, lastError: '' };
  const queue = [...circles];
  const fetchCircle = async (c) => { // her deneme ücretli sınırdan düşer; sınır doluysa, fatal hata geldiyse ya da arama iptal edildiyse yeniden denenmez
    for (let n = 0; ; n++) {
      try { return await circle(c.lat, c.lon, c.r, signal); } catch (err) {
        if (!err.transient || n >= RETRY_PER_CIRCLE || ctx.retries >= MAX_RETRIES || ctx.fatal || signal?.aborted) throw err;
        ctx.retries++;
        await googleTuning.sleep(googleTuning.delayMs * (n + 1));
        if (signal?.aborted) throw aborted();
        if (ctx.calls >= MAX_CALLS || ctx.fatal) throw err;
        ctx.calls++;
      }
    }
  };
  const one = async (c) => {
    const j = await cached(`gplaces:${c.lat.toFixed(3)},${c.lon.toFixed(3)}:${c.r}`, TTL_MS, async () => { ctx.calls++; return fetchCircle(c); }, { persist: false });
    ctx.raw += j.items?.length || 0;
    for (const f of j.items || []) { const s = fromGoogle(f); if (s) ctx.out.set(s.id, s); }
    if (j.full && c.depth < MAX_DEPTH && c.r > 6) {
      const r = Math.ceil(c.r / 2);
      for (const sy of [-1, 1]) for (const sx of [-1, 1]) queue.push({ lat: c.lat + sy * dLat(c.r / 2), lon: c.lon + sx * dLon(c.r / 2, c.lat), r, depth: c.depth + 1 });
    }
  };
  const worker = async () => {
    while (queue.length && !ctx.fatal) {
      if (signal?.aborted) break;
      if (ctx.calls >= MAX_CALLS) { ctx.skipped += queue.length; queue.length = 0; break; }
      const c = queue.shift();
      try { await one(c); } catch (err) {
        if (err.kind === 'aborted') {
          if (signal?.aborted) break;
          if (!c.again) { c.again = true; queue.unshift(c); } // iptal edilen başka aramanın ortak (in-flight) isteğiydi: bir kez kendimiz deneriz
          else ctx.failed++;
        } else if (err.fatal) ctx.fatal = err;
        else { ctx.failed++; ctx.lastError = err.message; }
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  if (signal?.aborted) ctx.cancelled = true;
  return ctx;
}

/** Arama sonucunu kullanıcı metnine çevir: errors (başarısız/eksik veri) ve notices (bilgi: maliyet sınırı nedeniyle taranmayan alt bölgeler). İptal edilen arama sessizdir. */
export function googleNotes(r) {
  const errors = [];
  const notices = [];
  if (!r || r.cancelled) return { errors, notices };
  if (r.failed) errors.push(`Google: ${r.failed} arama başarısız${r.lastError ? ' — ' + r.lastError : ''}`);
  if (r.skipped) notices.push(`Google: ${r.skipped} alt bölge taranmadı (arama başına ${MAX_CALLS} ücretli sorgu sınırı)`);
  if (r.fatal && r.fatal.kind !== 'aborted') errors.push(r.fatal.message);
  return { errors, notices };
}

/** Rota boyunca istasyonlar (pts: { lat, lon, km } dizisi). signal: yeni rota planlanınca arama iptal edilir. */
export function stationsAlong(pts, { signal } = {}) {
  const circles = [];
  let next = 0;
  for (const p of pts) {
    if (p.km < next) continue;
    next = p.km + SPACING_KM;
    circles.push({ lat: p.lat, lon: p.lon, r: R_KM, depth: 0 });
  }
  return run(circles, signal);
}

/** Bir noktanın etrafında (yarıçap km, en çok 30) istasyonlar. */
export const stationsAround = (lat, lon, radiusKm, { signal } = {}) => run([{ lat, lon, r: Math.min(30, Math.max(1, Math.round(radiusKm))), depth: 0 }], signal);
