// Mapbox Search Box "category" araması ile şarj istasyonları (anahtar girilmişse Overpass yerine kullanılır). Yanıtta güç/soket bilgisi
// yoktur: kW operatör tablosundan tahmin edilir (listede `*`), operatörü bilinmeyen kayıt yavaş (AC) aday sayılır.
import { classify } from '../routing/operators.js';
import { candidate } from '../routing/chargerSource.js';
import { cached, cacheGet, cacheSet } from '../utils/cache.js';
import { mbfetch } from './api.js';

const LIMIT = 25; // category aramasının üst sınırı: dolu dönen kutu dörde bölünür
const HALF_KM = 25; // rota boyunca her kutunun yarı kenarı
const SPACING_KM = 40; // kutu merkezleri arası (kutular örtüşür)
const MAX_DEPTH = 2;
const MAX_CALLS = 150; // bir aramada üst sınır (kota koruması)
const BOX_TTL_MS = 2 * 3600e3; // yalnızca bellekte: Mapbox arama sonuçlarını kalıcı saklamayız
const CAT_TTL_MS = 30 * 24 * 3600e3;
const CAT_FALLBACK = 'charging_station'; // Mapbox mobil SDK belgelerindeki kanonik ad

const dLat = (km) => km / 111.2;
const dLon = (km, lat) => km / (111.2 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));

/** list/category yanıtında canonical_id'li nesneleri topla (yanıt biçimi belgelerde net değil: her derinlikte aranır). */
function collectIds(x, out = []) {
  if (Array.isArray(x)) x.forEach((v) => collectIds(v, out));
  else if (x && typeof x === 'object') {
    if (typeof x.canonical_id === 'string') out.push(x.canonical_id);
    Object.values(x).forEach((v) => collectIds(v, out));
  }
  return out;
}

/** Şarj istasyonu kategorisinin kanonik adı: Mapbox'ın kategori listesinden bulunur, bulunamazsa belgelerdeki ad. */
export async function categoryId() {
  const hit = cacheGet('mbcat');
  if (hit) return hit;
  try {
    const ids = collectIds(await mbfetch('/search/searchbox/v1/list/category', { limit: 1000 }));
    const found = ids.find((id) => /charging_station/i.test(id)) || ids.find((id) => /ev_?charg|charg/i.test(id));
    if (found) { cacheSet('mbcat', found, CAT_TTL_MS); return found; }
  } catch (err) {
    if (err.fatal) throw err;
  }
  return CAT_FALLBACK;
}

/** Search Box özelliği → aday istasyon. Tesla'ya özel kayıtlar elenir. */
export function fromMapbox(f, drop = {}) {
  const p = f.properties || {};
  const [lon, lat] = f.geometry?.coordinates || [];
  if (lat == null || lon == null) { drop['konumsuz'] = (drop['konumsuz'] || 0) + 1; return null; }
  const name = p.name || 'Şarj istasyonu';
  const brand = Array.isArray(p.brand) ? p.brand.join(' ') : p.brand || '';
  if (/tesla/i.test(`${name} ${brand}`)) { drop['Tesla'] = (drop['Tesla'] || 0) + 1; return null; }
  return candidate({
    id: 'mb' + (p.mapbox_id || `${lat.toFixed(5)},${lon.toFixed(5)}`), name, lat, lon, opId: classify(name, brand), src: 'Mapbox',
    hasDc: false, dcKw: null, acKw: null, anyInfo: false,
  });
}

function boxesAlong(pts) {
  const boxes = [];
  let next = 0;
  for (const p of pts) {
    if (p.km < next) continue;
    next = p.km + SPACING_KM;
    boxes.push({ lat: p.lat, lon: p.lon, hLat: dLat(HALF_KM), hLon: dLon(HALF_KM, p.lat), depth: 0 });
  }
  return boxes;
}

/** Kutu listesini (gerekirse bölerek) tara. Dönüş: { out: Map, raw, drop, calls, failed, fatal, lastError, skipped }. */
async function run(boxes) {
  const ctx = { out: new Map(), raw: 0, drop: {}, calls: 0, failed: 0, skipped: 0, fatal: null, lastError: '' };
  const cat = await categoryId();
  const queue = [...boxes];
  const one = async (b) => {
    const bbox = [b.lon - b.hLon, b.lat - b.hLat, b.lon + b.hLon, b.lat + b.hLat];
    const key = `mbc:${cat}:${bbox.map((x) => x.toFixed(3)).join(',')}`;
    const json = await cached(key, BOX_TTL_MS, () => {
      ctx.calls++;
      return mbfetch(`/search/searchbox/v1/category/${encodeURIComponent(cat)}`, {
        bbox: bbox.map((x) => x.toFixed(5)).join(','), proximity: `${b.lon.toFixed(5)},${b.lat.toFixed(5)}`, limit: LIMIT, exclude_fields: 'photos,reviews',
      });
    }, { persist: false });
    const feats = json.features || [];
    ctx.raw += feats.length;
    for (const f of feats) { const s = fromMapbox(f, ctx.drop); if (s) ctx.out.set(s.id, s); }
    if (feats.length >= LIMIT && b.depth < MAX_DEPTH) {
      const h = { hLat: b.hLat / 2, hLon: b.hLon / 2, depth: b.depth + 1 };
      for (const sy of [-1, 1]) for (const sx of [-1, 1]) queue.push({ lat: b.lat + (sy * b.hLat) / 2, lon: b.lon + (sx * b.hLon) / 2, ...h });
    }
  };
  const worker = async () => {
    while (queue.length && !ctx.fatal) {
      if (ctx.calls >= MAX_CALLS) { ctx.skipped += queue.length; queue.length = 0; break; }
      const b = queue.shift();
      try { await one(b); } catch (err) {
        if (err.fatal) ctx.fatal = err; else { ctx.failed++; ctx.lastError = err.message; }
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return ctx;
}

/** Rota boyunca istasyonlar (pts: { lat, lon, km } dizisi). */
export const stationsAlong = (pts) => run(boxesAlong(pts));

/** Bir noktanın etrafında (yarıçap km, en çok 50) istasyonlar. */
export const stationsAround = (lat, lon, radiusKm) => {
  const r = Math.min(radiusKm, 50);
  return run([{ lat, lon, hLat: dLat(r), hLon: dLon(r, lat), depth: 0 }]);
};
