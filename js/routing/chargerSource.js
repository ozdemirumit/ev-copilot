import { PLANNER } from '../config.js';
import { classify, operatorById } from './operators.js';
import { haversineKm } from '../utils/geo.js';
import { load, save } from '../utils/storage.js';

// Herkese açık sunucular sık "at capacity" (502/504) verir veya hiç yanıt vermez: biri takılırsa sıradakine geçilir.
const OVERPASS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
];
const MIRROR_TIMEOUT_MS = 15000;
const HEDGE_MS = 4000; // sıradaki sunucu, öncekinden yanıt gelmezse bu kadar sonra paralel denenir
const DC_SOCKETS = ['socket:type2_combo', 'socket:ccs', 'socket:chademo'];
const KW_TAGS = ['socket:type2_combo:output', 'socket:ccs:output', 'socket:chademo:output', 'charging_station:output'];

function parseKw(v) {
  const nums = String(v).match(/[\d.]+/g)?.map(Number) || [];
  if (!nums.length) return null;
  let m = Math.max(...nums);
  if (m > 1000) m /= 1000; // watt yazılmış
  return m;
}

// Herkese açık olmayan erişim etiketleri (OSM access=*): bunlar aday olmaz.
const NON_PUBLIC = new Set(['private', 'no', 'customers', 'permit', 'delivery', 'agricultural', 'forestry', 'staff', 'residents']);
const AC_FALLBACK_KW = 11; // yalnızca AC/tipi bilinmeyen istasyonda varsayılan güç (aracın AC şarj sınırına yakın)

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

  // Yalnızca herkese açık istasyonlar (özel/müşteri/izinli erişim elenir).
  if (NON_PUBLIC.has(String(t.access || '').toLowerCase())) return null;

  // DC değilse (AC veya tipi bilinmeyen "Diğer" operatör) yavaş yedek aday olur: planlayıcı yalnızca DC yetmediğinde seçer.
  const slow = !hasDc && !(kwTagMax >= PLANNER.minKw) && (hasAnySocket || opId === 'other');

  return {
    id: 'osm' + el.id,
    name: t.name || t.operator || t.brand || 'Şarj istasyonu',
    lat, lon, opId,
    osmKw: slow ? Math.min(kwTagMax ?? AC_FALLBACK_KW, AC_FALLBACK_KW) : kwTagMax, // yoksa operatör tablosundaki kW kullanılır
    uncertain: kwTagMax == null,
    slow,
    src: 'OSM',
  };
}

/**
 * Bir parça için sunucuları sırayla dener ama sıradakini yanıtı beklemeden HEDGE_MS sonra başlatır (ilk gelen kazanır):
 * yanıtsız sunucu tüm süreyi tüketmesin. Yanıt vermeyen sunucu bu planlamada `down` kümesine alınıp bir daha denenmez.
 */
// Yerleşik istasyon listesi (data/stations.json): OSM'den alınmış herkese açık istasyonların anlık görüntüsü
// (Türkiye + Yunanistan + Balkanlar). Overpass yanıtsız kaldığında rotadaki istasyonlar buradan gelir; çevrimdışı da çalışır.
// Satır: [lat, lon, ad, operatör metni, kW (0 = yok), DC soket (1/0), herhangi soket etiketi (1/0)]
const SNAPSHOT_URL = 'data/stations.json';
let snapshotPromise = null;

function loadSnapshot() {
  snapshotPromise ??= fetch(SNAPSHOT_URL, { signal: AbortSignal.timeout(20000) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return snapshotPromise;
}

function fromSnapshot([lat, lon, name, opText, kw, dc, anySocket]) {
  const opId = classify(name, opText);
  const slow = !dc && !(kw >= PLANNER.minKw) && (anySocket || opId === 'other');
  return {
    id: `sn${lat}_${lon}_${opId}`, // koordinat tabanlı: liste yenilense de operatör düzeltmeleri geçerli kalır
    name: name || opText || 'Şarj istasyonu',
    lat, lon, opId,
    osmKw: slow ? Math.min(kw || AC_FALLBACK_KW, AC_FALLBACK_KW) : (kw || null),
    uncertain: !kw,
    slow,
    src: 'Liste',
  };
}

/** Rota koridorundaki yerleşik liste istasyonları. Liste yoksa/okunamazsa { date: null, list: [] }. */
async function snapshotStations(pts, profile) {
  const snap = await loadSnapshot();
  if (!snap?.rows) return { date: null, list: [] };
  const pad = 0.05;
  const lats = pts.map((p) => p.lat);
  const lons = pts.map((p) => p.lon);
  const [s, n, w, e] = [Math.min(...lats) - pad, Math.max(...lats) + pad, Math.min(...lons) - pad, Math.max(...lons) + pad];
  const list = [];
  for (const row of snap.rows) {
    if (row[0] < s || row[0] > n || row[1] < w || row[1] > e) continue;
    if (profile.project(row[0], row[1]).offKm > PLANNER.corridorM / 1000 + 0.5) continue;
    list.push(fromSnapshot(row));
  }
  return { date: snap.date, list };
}

async function queryChunk(bbox, down) {
  const q = `[out:json][timeout:15];(node["amenity"="charging_station"](${bbox});way["amenity"="charging_station"](${bbox}););out center tags;`;
  const urls = OVERPASS.filter((u) => !down.has(u));
  if (!urls.length) throw new Error('tüm Overpass sunucuları yanıtsız');
  const ctrl = new AbortController();
  const reasons = [];

  const attempt = async (url, i) => {
    await new Promise((r) => setTimeout(r, i * HEDGE_MS));
    if (ctrl.signal.aborted) throw new Error('iptal');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
        signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(MIRROR_TIMEOUT_MS)]),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      // Overpass zaman aşımı/bellek hatasında HTTP 200 + boş "elements" + "remark" döndürür: bunu başarı sayma.
      if (json.remark && /error|timed out|out of memory/i.test(json.remark)) throw new Error('sunucu hata verdi');
      return json.elements;
    } catch (err) {
      if (!ctrl.signal.aborted) {
        down.add(url);
        reasons.push(`${new URL(url).hostname}: ${err.name === 'TimeoutError' ? 'yanıt yok' : err.message}`);
      }
      throw err;
    }
  };

  try {
    return await Promise.any(urls.map(attempt));
  } catch {
    throw new Error(reasons.join('; '));
  } finally {
    ctrl.abort();
  }
}

/**
 * Rota ~10 km aralıkla seyreltilir ve ~60 km'lik parçalara bölünür; her parça için sınır kutusu (bbox) sorgulanır:
 * `around` çoklu nokta sorgusuna göre sunucuya çok daha ucuzdur (uzun rotada zaman aşımı vermez). Kutu koridor payı kadar
 * genişletilir, koridor dışı sonuçlar finalize()'da izdüşümle elenir. Parçalar 2'şerli çalışır.
 * Dönüş: { list, failed, total } — başarısız parça olsa bile kısmi sonuç döner.
 */
function bboxOf(c) {
  const lats = c.map((p) => p.lat);
  const lons = c.map((p) => p.lon);
  const padLat = PLANNER.corridorM / 111000;
  const padLon = padLat / Math.cos((((Math.min(...lats) + Math.max(...lats)) / 2) * Math.PI) / 180);
  return [Math.min(...lats) - padLat, Math.min(...lons) - padLon, Math.max(...lats) + padLat, Math.max(...lons) + padLon]
    .map((v) => v.toFixed(4)).join(',');
}

async function overpass(pts) {
  const thin = pts.filter((_, i) => i % 5 === 0);
  if (thin.at(-1) !== pts.at(-1)) thin.push(pts.at(-1));
  const chunks = [];
  for (let i = 0; i < thin.length - 1; i += 6) chunks.push(thin.slice(i, i + 7));

  const byId = new Map();
  let failed = 0;
  let lastError = '';
  let next = 0;
  const down = new Set();
  const worker = async () => {
    while (next < chunks.length) {
      const c = chunks[next++];
      try {
        const els = await queryChunk(bboxOf(c), down);
        els.forEach((el) => { const s = fromOsm(el); if (s) byId.set(s.id, s); });
      } catch (err) {
        console.warn('Overpass parçası başarısız:', err.message);
        failed++;
        lastError = err.message;
      }
    }
  };
  await Promise.all([worker(), worker()]);
  return { list: [...byId.values()], failed, total: chunks.length, lastError };
}

// OpenChargeMap (isteğe bağlı, ücretsiz API anahtarı gerekir): rota boyunca ~100 km aralıkla yarıçap sorgusu.
async function openChargeMap(pts, key) {
  const samples = pts.filter((_, i) => i % 50 === 0 || i === pts.length - 1);
  const out = [];
  for (const p of samples) {
    const url = 'https://api.openchargemap.io/v3/poi?output=json&verbose=false&maxresults=200&minpowerkw=40'
      + `&latitude=${p.lat.toFixed(4)}&longitude=${p.lon.toFixed(4)}&distance=60&distanceunit=KM&key=${encodeURIComponent(key)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (res.status === 401 || res.status === 403) throw new Error(`OpenChargeMap anahtarı reddedildi (HTTP ${res.status}): anahtarı kontrol et (kamerayla okurken bir karakter yanlış olabilir)`);
    if (!res.ok) throw new Error('OpenChargeMap HTTP ' + res.status);
    for (const poi of await res.json()) {
      const a = poi.AddressInfo;
      const kw = Math.max(0, ...(poi.Connections || []).map((c) => c.PowerKW || 0));
      if (!a || kw < PLANNER.minKw) continue;
      // OCM UsageType: 2 = kısıtlı erişim, 3 = özel mülk (bildirimle), 6 = müşteri/personel → herkese açık değil
      if ([2, 3, 6].includes(poi.UsageType?.ID) || poi.StatusType?.IsOperational === false) continue;
      out.push({
        id: 'ocm' + poi.ID, name: a.Title, lat: a.Latitude, lon: a.Longitude,
        opId: classify(a.Title, poi.OperatorInfo?.Title), osmKw: kw, uncertain: false, src: 'OCM',
      });
    }
  }
  return out;
}

// Yedek (Overpass tamamen yanıtsızken): Photon'da bilinen operatör adlarıyla, rota boyunca ~80 km aralıklı konum
// yanlılığıyla arama. Eksik ve yaklaşık bir listedir (DC/kW doğrulanamaz): yalnızca tanınan operatörler alınır.
const PHOTON = 'https://photon.komoot.io/api/';
const PHOTON_QUERIES = ['şarj', 'ZES', 'Trugo', 'Eşarj', 'Voltrun', 'Astor'];

async function photonFallback(pts) {
  const samples = pts.filter((_, i) => i % 40 === 0 || i === pts.length - 1);
  const jobs = samples.flatMap((p) => PHOTON_QUERIES.map((q) => ({ p, q })));
  const out = new Map();
  let next = 0;
  let misses = 0; // art arda başarısızlık: Photon yoğun/sınırlıyor, vazgeç
  const worker = async () => {
    while (next < jobs.length && misses < 4) {
      const { p, q } = jobs[next++];
      try {
        const url = `${PHOTON}?q=${encodeURIComponent(q)}&lat=${p.lat.toFixed(3)}&lon=${p.lon.toFixed(3)}`
          + '&location_bias_scale=1&zoom=9&osm_tag=amenity:charging_station&limit=25';
        const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
        if (!res.ok) { misses++; continue; }
        misses = 0;
        for (const f of (await res.json()).features) {
          const pr = f.properties;
          const name = pr.name || '';
          const opId = classify(name, pr.operator, pr.brand);
          if (opId === 'other' || /tesla/i.test(name)) continue;
          out.set(pr.osm_type + pr.osm_id, {
            id: 'ph' + pr.osm_type + pr.osm_id, name, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
            opId, osmKw: null, uncertain: true, src: 'Photon',
          });
        }
      } catch { misses++; /* bu sorgu atlanır */ }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return [...out.values()];
}

/** OpenChargeMap anahtarını tek bir küçük istekle sına. Dönüş: { ok, text }. */
export async function testOcmKey(key) {
  if (!key) return { ok: false, text: 'Anahtar boş' };
  try {
    const res = await fetch(`https://api.openchargemap.io/v3/poi?output=json&verbose=false&maxresults=1&latitude=41&longitude=29&distance=5&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(15000) });
    if (res.ok) return { ok: true, text: 'Anahtar geçerli' };
    if (res.status === 401 || res.status === 403) return { ok: false, text: `Anahtar reddedildi (HTTP ${res.status}): yanlış karakter olabilir, tekrar gir` };
    return { ok: false, text: 'OpenChargeMap HTTP ' + res.status };
  } catch (err) {
    return { ok: false, text: 'Ulaşılamadı: ' + (err.name === 'TimeoutError' ? 'yanıt yok' : err.message) };
  }
}

/** Rotaya izdüşür, koridor dışını ele, yinelenenleri birleştir, operatör tablosuyla fiyat/kW ata. */
// Kullanıcının istasyon başına operatör düzeltmeleri { istasyonId: operatörId } (OSM adı/etiketi yanlış veya eski olabilir).
const OVERRIDE_KEY = 'stationOps';
const overrides = () => load(OVERRIDE_KEY, {});

export function setStationOperator(stationId, opId) {
  const o = overrides();
  if (opId) o[stationId] = opId; else delete o[stationId];
  save(OVERRIDE_KEY, o);
}

/** Operatörü (varsa kullanıcı düzeltmesiyle) uygulayıp fiyat/kW'yi ata. */
function priced(s) {
  const ov = overrides()[s.id];
  const op = operatorById(ov || s.opId);
  return { ...s, opId: ov || s.opId, opRaw: s.opRaw ?? s.opId, corrected: !!ov, opName: op.name, price: op.price, kw: ov ? op.kw : (s.osmKw ?? op.kw) };
}

/**
 * Yinelenenleri ele: ~80 m içinde AYNI operatörün ikinci kaydı (ör. aynı istasyonun node + way hali) atılır.
 * Farklı operatörler aynı noktada olabilir (ör. Astor + Trugo yan yana): ikisi de aday kalır. Operatörü bilinmeyen
 * ("Diğer") kayıt, aynı noktadaki bilinen operatör kaydının kopyası sayılır.
 */
function dedupe(raw) {
  const out = [];
  for (const s of raw) {
    const near = out.filter((o) => haversineKm(o, s) < 0.08);
    if (near.some((o) => o.opId === s.opId)) continue;
    if (s.opId === 'other' && near.length) continue;
    for (const o of near) if (o.opId === 'other') out.splice(out.indexOf(o), 1);
    out.push(s);
  }
  return out;
}

function finalize(raw, profile) {
  const list = [];
  for (const s of dedupe(raw)) {
    const { km, offKm } = profile.project(s.lat, s.lon);
    if (offKm > PLANNER.corridorM / 1000 + 0.5) continue;
    list.push(priced({ ...s, km, offKm }));
  }
  list.sort((a, b) => a.km - b.km);
  if (list.length <= PLANNER.maxStations) return list;
  // Çok istasyonlu rotada en güçlüleri global seçmek seyrek bölgeleri (az ama gerekli istasyon) silerdi:
  // her 15 km'lik dilimde en güçlü 2 istasyon korunur, sonra kalan kota güce göre doldurulur.
  const keep = new Set();
  const bins = new Map();
  [...list].sort((a, b) => b.kw - a.kw).forEach((s) => {
    const b = Math.floor(s.km / 15);
    const n = bins.get(b) || 0;
    if (n < 2) { bins.set(b, n + 1); keep.add(s); }
  });
  const rest = list.filter((s) => !keep.has(s)).sort((a, b) => b.kw - a.kw);
  const out = [...keep];
  for (const s of rest) if (out.length < PLANNER.maxStations) out.push(s);
  return out.sort((a, b) => a.km - b.km);
}

const CACHE_TTL_MS = 7 * 24 * 3600e3;

/**
 * İstasyonları getir. Overpass herkese açık ve sık yavaşlıyor/sınırlıyor; başarılı sonuçlar `cacheKey` (rota uçları)
 * ile 7 gün saklanır, böylece aynı rotayı yeniden planlamak ağ gerektirmez.
 */
export async function fetchChargers(pts, profile, ocmKey, cacheKey = null) {
  const key = cacheKey && 'chargers2:' + cacheKey + (ocmKey ? ':ocm' : '');
  const cached = key && load(key, null);
  if (cached && Date.now() - cached.t < CACHE_TTL_MS) {
    return { stations: finalize(cached.raw, profile), errors: [], cached: true };
  }

  const raw = [];
  const errors = [];
  const jobs = [overpass(pts).then((r) => {
    raw.push(...r.list);
    if (r.failed) errors.push(`Overpass: ${r.failed}/${r.total} rota bölümü alınamadı${r.lastError ? ' — ' + r.lastError : ''}`);
  }).catch((e) => errors.push('Overpass: ' + e.message))];
  if (ocmKey) jobs.push(openChargeMap(pts, ocmKey).then((r) => raw.push(...r)).catch((e) => errors.push('OCM: ' + e.message)));
  await Promise.all(jobs);
  // Canlı sorgu eksik/başarısızsa yerleşik listeyle tamamla (canlı sonuçlar önce gelir; yinelenenler finalize'da elenir).
  if (errors.length || !raw.length) {
    const snap = await snapshotStations(pts, profile);
    if (snap.list.length) {
      raw.push(...snap.list);
      errors.push(`Canlı sorgu eksik: ${snap.list.length} istasyon yerleşik listeden eklendi (${snap.date} tarihli)`);
    }
  }
  if (!raw.length && errors.length) {
    const approx = await photonFallback(pts);
    if (approx.length) {
      raw.push(...approx);
      errors.push(`Overpass yanıtsız: ${approx.length} istasyon operatör adıyla Photon'dan alındı (yaklaşık, eksik olabilir)`);
    }
  }
  if (key && raw.length && !errors.length) save(key, { t: Date.now(), raw });
  return { stations: finalize(raw, profile), errors, cached: false };
}

/** Operatör tablosu değişince fiyat/kW'yi yeniden uygula (ağ çağrısı yok). */
export function reprice(stations) {
  return stations.map((s) => priced({ ...s, opId: s.opRaw ?? s.opId }));
}
