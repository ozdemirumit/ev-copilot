import { PLANNER } from '../config.js';
import { classify, operatorById } from './operators.js';
import { haversineKm } from '../utils/geo.js';
import { load, save } from '../utils/storage.js';

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const DC_SOCKETS = ['socket:type2_combo', 'socket:ccs', 'socket:chademo'];
const KW_TAGS = ['socket:type2_combo:output', 'socket:ccs:output', 'socket:chademo:output', 'charging_station:output'];

function parseKw(v) {
  const nums = String(v).match(/[\d.]+/g)?.map(Number) || [];
  if (!nums.length) return null;
  let m = Math.max(...nums);
  if (m > 1000) m /= 1000; // watt yazılmış
  return m;
}

function fromOsm(el) {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null) return null;
  const kwTag = KW_TAGS.map((k) => (t[k] ? parseKw(t[k]) : null)).filter(Boolean);
  const kwTagMax = kwTag.length ? Math.max(...kwTag) : null;
  const hasDc = DC_SOCKETS.some((k) => t[k] && t[k] !== 'no');
  const hasAnySocket = Object.keys(t).some((k) => k.startsWith('socket:'));
  const opId = classify(t.name, t.operator, t.brand, t.network);
  // Tesla Supercharger'lar Togg için varsayılan olarak aday değil (ağ erişimi garanti değil).
  if (/tesla/i.test([t.name, t.operator, t.brand, t.network].join(' '))) return null;

  // AC-only istasyonları ele: DC soket yok, DC güç yok, ve hiç soket etiketi olmayan "Diğer" operatör.
  if (!hasDc && !(kwTagMax >= PLANNER.minKw) && (hasAnySocket || opId === 'other')) return null;

  return {
    id: 'osm' + el.id,
    name: t.name || t.operator || t.brand || 'Şarj istasyonu',
    lat, lon, opId,
    osmKw: kwTagMax, // yoksa operatör tablosundaki kW kullanılır
    uncertain: kwTagMax == null,
    src: 'OSM',
  };
}

async function queryChunk(poly) {
  const q = `[out:json][timeout:25];(node["amenity"="charging_station"](around:${PLANNER.corridorM},${poly});`
    + `way["amenity"="charging_station"](around:${PLANNER.corridorM},${poly}););out center tags;`;
  let lastErr;
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) throw new Error('Overpass HTTP ' + res.status);
      return (await res.json()).elements;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * Rota ~10 km aralıkla seyreltilir ve ~110 km'lik parçalara bölünür (tek büyük sorgu herkese açık sunucuda
 * zaman aşımına uğruyor). Overpass `around` çoklu nokta (polyline) destekler. Parçalar 2'şerli çalışır.
 * Dönüş: { list, failed, total } — başarısız parça olsa bile kısmi sonuç döner.
 */
async function overpass(pts) {
  const thin = pts.filter((_, i) => i % 5 === 0);
  if (thin.at(-1) !== pts.at(-1)) thin.push(pts.at(-1));
  const chunks = [];
  for (let i = 0; i < thin.length - 1; i += 11) chunks.push(thin.slice(i, i + 12));

  const byId = new Map();
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const c = chunks[next++];
      try {
        const els = await queryChunk(c.map((p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join(','));
        els.forEach((el) => { const s = fromOsm(el); if (s) byId.set(s.id, s); });
      } catch (err) {
        console.warn('Overpass parçası başarısız:', err.message);
        failed++;
      }
    }
  };
  await Promise.all([worker(), worker()]);
  return { list: [...byId.values()], failed, total: chunks.length };
}

// OpenChargeMap (isteğe bağlı, ücretsiz API anahtarı gerekir): rota boyunca ~100 km aralıkla yarıçap sorgusu.
async function openChargeMap(pts, key) {
  const samples = pts.filter((_, i) => i % 50 === 0 || i === pts.length - 1);
  const out = [];
  for (const p of samples) {
    const url = 'https://api.openchargemap.io/v3/poi?output=json&verbose=false&maxresults=200&minpowerkw=40'
      + `&latitude=${p.lat.toFixed(4)}&longitude=${p.lon.toFixed(4)}&distance=60&distanceunit=KM&key=${encodeURIComponent(key)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error('OpenChargeMap HTTP ' + res.status);
    for (const poi of await res.json()) {
      const a = poi.AddressInfo;
      const kw = Math.max(0, ...(poi.Connections || []).map((c) => c.PowerKW || 0));
      if (!a || kw < PLANNER.minKw) continue;
      out.push({
        id: 'ocm' + poi.ID, name: a.Title, lat: a.Latitude, lon: a.Longitude,
        opId: classify(a.Title, poi.OperatorInfo?.Title), osmKw: kw, uncertain: false, src: 'OCM',
      });
    }
  }
  return out;
}

/** Rotaya izdüşür, koridor dışını ele, yinelenenleri birleştir, operatör tablosuyla fiyat/kW ata. */
function finalize(raw, profile) {
  const seen = [];
  const list = [];
  for (const s of raw) {
    if (seen.some((o) => haversineKm(o, s) < 0.08)) continue; // ~80 m içindeki yineleme
    seen.push(s);
    const { km, offKm } = profile.project(s.lat, s.lon);
    if (offKm > PLANNER.corridorM / 1000 + 0.5) continue;
    const op = operatorById(s.opId);
    list.push({ ...s, km, offKm, opName: op.name, price: op.price, kw: s.osmKw ?? op.kw });
  }
  list.sort((a, b) => a.km - b.km);
  if (list.length > PLANNER.maxStations) {
    return list.sort((a, b) => b.kw - a.kw).slice(0, PLANNER.maxStations).sort((a, b) => a.km - b.km);
  }
  return list;
}

const CACHE_TTL_MS = 7 * 24 * 3600e3;

/**
 * İstasyonları getir. Overpass herkese açık ve sık yavaşlıyor/sınırlıyor; başarılı sonuçlar `cacheKey` (rota uçları)
 * ile 7 gün saklanır, böylece aynı rotayı yeniden planlamak ağ gerektirmez.
 */
export async function fetchChargers(pts, profile, ocmKey, cacheKey = null) {
  const key = cacheKey && 'chargers:' + cacheKey + (ocmKey ? ':ocm' : '');
  const cached = key && load(key, null);
  if (cached && Date.now() - cached.t < CACHE_TTL_MS) {
    return { stations: finalize(cached.raw, profile), errors: [], cached: true };
  }

  const raw = [];
  const errors = [];
  const jobs = [overpass(pts).then((r) => {
    raw.push(...r.list);
    if (r.failed) errors.push(`Overpass: ${r.failed}/${r.total} rota bölümü alınamadı (istasyon listesi eksik olabilir)`);
  }).catch((e) => errors.push('Overpass: ' + e.message))];
  if (ocmKey) jobs.push(openChargeMap(pts, ocmKey).then((r) => raw.push(...r)).catch((e) => errors.push('OCM: ' + e.message)));
  await Promise.all(jobs);
  if (key && raw.length && !errors.length) save(key, { t: Date.now(), raw });
  return { stations: finalize(raw, profile), errors, cached: false };
}

/** Operatör tablosu değişince fiyat/kW'yi yeniden uygula (ağ çağrısı yok). */
export function reprice(stations) {
  return stations.map((s) => {
    const op = operatorById(s.opId);
    return { ...s, opName: op.name, price: op.price, kw: s.osmKw ?? op.kw };
  });
}
