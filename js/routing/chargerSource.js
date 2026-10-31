// Şarj istasyonu verisi YALNIZCA Google Places API (New)'den gelir ("electric_vehicle_charging_station" + evChargeOptions).
// Fiyat Google'da yoktur: operatör tablosundan (kullanıcının düzenlediği değerler) atanır. Kullanıcının elle eklediği
// istasyonlar ("Kendi istasyonlarım") da aday olur.
import { PLANNER } from '../config.js';
import { classify, operatorById } from './operators.js';
import { haversineKm } from '../utils/geo.js';
import { load, save } from '../utils/storage.js';
import { gfetch } from '../google/api.js';
import { slotsOf } from './slots.js';
import { cached, TTL } from '../utils/cache.js';

const NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby';
const TEXT_URL = 'https://places.googleapis.com/v1/places:searchText';
// Yalnızca gereken alanlar (faturalama alan düzeyine göre): kimlik, ad, konum, soket/güç, işletme durumu.
const FIELD_MASK = 'places.id,places.displayName,places.location,places.evChargeOptions,places.businessStatus';
const MAX_RESULTS = 20; // Nearby Search üst sınırı: dolu dönen daire daha küçük dairelere bölünür
const MAX_RADIUS_M = 50000; // Nearby Search yarıçap üst sınırı
const SPACING_KM = 45; // rota boyunca daire merkezleri arası
const CIRCLE_KM = 30; // her dairenin yarıçapı (koridor payı + virajlar için geniş)
const MAX_CALLS = 300; // bir aramada üst sınır (kota/fatura koruması)
const DC_TYPES = new Set(['EV_CONNECTOR_TYPE_CCS_COMBO_1', 'EV_CONNECTOR_TYPE_CCS_COMBO_2', 'EV_CONNECTOR_TYPE_CHADEMO']);
const AC_FALLBACK_KW = 11; // yalnızca AC/gücü bilinmeyen istasyonda varsayılan güç (aracın AC şarj sınırına yakın)
const CACHE_TTL_MS = 6 * 3600e3; // Google içeriği için kısa süreli yerel önbellek (hizmet şartları uzun saklamayı kısıtlar)

/** Google Place → aday istasyon. Tesla/NACS'a özel, kapalı ya da konumsuz kayıtlar elenir. */
function fromGoogle(p, drop = {}) {
  const no = (why) => { drop[why] = (drop[why] || 0) + 1; return null; };
  if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') return no('kapalı');
  const lat = p.location?.latitude;
  const lon = p.location?.longitude;
  if (lat == null || lon == null) return no('konumsuz');
  const name = p.displayName?.text || 'Şarj istasyonu';
  // Tesla Supercharger'lar Togg için varsayılan olarak aday değil (ağ erişimi garanti değil).
  if (/tesla/i.test(name)) return no('Tesla');
  const agg = p.evChargeOptions?.connectorAggregation || [];
  if (agg.length && agg.every((a) => /TESLA|NACS/.test(a.type))) return no('Tesla/NACS');

  const dcAgg = agg.filter((a) => DC_TYPES.has(a.type));
  const hasDc = dcAgg.length > 0;
  const kwMax = Math.max(0, ...agg.map((a) => a.maxChargeRateKw || 0)) || null;
  const kwDc = Math.max(0, ...dcAgg.map((a) => a.maxChargeRateKw || 0)) || null;
  const opId = classify(name);
  // DC değilse (AC veya tipi bilinmeyen "Diğer" operatör) yavaş yedek aday olur: planlayıcı yalnızca DC yetmediğinde seçer.
  const slow = !hasDc && !(kwMax >= PLANNER.minKw) && (agg.length > 0 || opId === 'other');
  return {
    id: 'g' + p.id,
    gid: p.id, // Google yer kimliği (canlı doluluk sorgusu için)
    slots: slotsOf(p.evChargeOptions, DC_TYPES), // yuva doluluğu (bilinmiyorsa null)
    name, lat, lon, opId,
    srcKw: slow ? Math.min(kwMax ?? AC_FALLBACK_KW, AC_FALLBACK_KW) : (hasDc ? kwDc : kwMax), // yoksa operatör tablosundaki kW
    uncertain: (hasDc ? kwDc : kwMax) == null,
    slow,
    src: 'Google',
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Tek daire sorgusu. Dönüş: sonuç sayısı 20'ye ulaştıysa true (dolu: bölünmeli). Anahtar/API sorunu (fatal) fırlatır. */
async function queryCircle(c, ctx) {
  if (ctx.calls >= MAX_CALLS) { ctx.capped = true; return false; }
  ctx.calls++;
  const body = {
    includedTypes: ['electric_vehicle_charging_station'],
    maxResultCount: MAX_RESULTS,
    rankPreference: 'DISTANCE',
    languageCode: 'tr',
    locationRestriction: { circle: { center: { latitude: c.lat, longitude: c.lon }, radius: Math.min(c.radiusM, MAX_RADIUS_M) } },
  };
  let json;
  try {
    try {
      json = await gfetch(NEARBY_URL, { method: 'POST', mask: FIELD_MASK, body });
    } catch (err) {
      if (err.status !== 429) throw err;
      await sleep(1500); // hız sınırı: bir kez bekleyip tekrar
      json = await gfetch(NEARBY_URL, { method: 'POST', mask: FIELD_MASK, body });
    }
  } catch (err) {
    if (err.fatal) throw err; // anahtar/etkin-API sorunu: tüm arama durur
    ctx.failed++;
    ctx.lastError = err.message;
    return false;
  }
  const places = json.places || [];
  ctx.raw += places.length;
  places.forEach((p) => { const s = fromGoogle(p, ctx.drop); if (s) ctx.out.set(s.id, s); });
  if (!places.length && c.textFallback) await textFallback(c, ctx); // tür filtresi boş döndü: serbest metin aramasıyla bir daha dene
  return places.length >= MAX_RESULTS;
}

/**
 * Yedek: bazı bölgelerde (ör. Yunanistan) istasyonlar `electric_vehicle_charging_station` türüyle etiketli olmayabilir.
 * Boş dönen daire için "EV charging station" metin aramasıyla bakılır; yalnızca şarj bilgisi (evChargeOptions) veya şarj türü
 * olan kayıtlar alınır. Çağrı sınırına dahildir.
 */
async function textFallback(c, ctx) {
  if (ctx.calls >= MAX_CALLS) { ctx.capped = true; return; }
  ctx.calls++;
  ctx.textCalls++;
  try {
    const json = await gfetch(TEXT_URL, {
      method: 'POST',
      mask: FIELD_MASK + ',places.types',
      body: {
        textQuery: 'EV charging station',
        languageCode: 'tr',
        maxResultCount: MAX_RESULTS,
        locationBias: { circle: { center: { latitude: c.lat, longitude: c.lon }, radius: Math.min(c.radiusM, MAX_RADIUS_M) } },
      },
    });
    for (const p of json.places || []) {
      if (!p.evChargeOptions && !(p.types || []).includes('electric_vehicle_charging_station')) continue;
      ctx.raw++;
      const s = fromGoogle(p, ctx.drop);
      if (s) { ctx.out.set(s.id, s); ctx.textFound++; }
    }
  } catch (err) {
    if (err.fatal) throw err;
    ctx.failed++;
    ctx.lastError = err.message;
  }
}

/** Dolu bir dairenin 4 alt dairesi; rota koridoruna değmeyenler atlanır (kota boşa gitmesin). */
function subCircles(c, ctx) {
  const dLat = (c.radiusM / 2000) / 110.57; // yarıçapın yarısı kadar kaydır (km → derece)
  const dLon = (c.radiusM / 2000) / (111.32 * Math.cos((c.lat * Math.PI) / 180));
  const rM = c.radiusM * 0.72;
  const out = [];
  for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const sub = { lat: c.lat + a * dLat, lon: c.lon + b * dLon, radiusM: rM };
    if (ctx.pts && !ctx.pts.some((p) => haversineKm(sub, p) <= rM / 1000 + PLANNER.corridorM / 1000)) continue;
    out.push(sub);
  }
  return out;
}

/**
 * Daireleri kademeli sorgula: önce hepsi (kapsam), sonra yalnızca dolu olanların koridora değen alt daireleri (en çok 2 kat).
 * Kademeli olması, çağrı sınırı dolduğunda rotanın sonunun sorgusuz kalmasını önler. ctx.pts: rota noktaları (yakın arama için null).
 */
async function runCircles(circles, { pts = null } = {}) {
  const ctx = { out: new Map(), calls: 0, failed: 0, lastError: '', capped: false, pts, raw: 0, drop: {}, textCalls: 0, textFound: 0 };
  let level = circles;
  for (let depth = 0; level.length && depth <= 2; depth++) {
    const full = [];
    let next = 0;
    const worker = async () => {
      while (next < level.length) {
        const c = level[next++];
        if (await queryCircle(c, ctx)) full.push(c);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    level = full.flatMap((c) => subCircles(c, ctx));
  }
  return ctx;
}

// ---------- Kullanıcının kendi istasyonları ----------
const CUSTOM_KEY = 'customStations';
export const getCustomStations = () => load(CUSTOM_KEY, []);
export function addCustomStation({ name, lat, lon, opId, kw }) {
  const list = getCustomStations();
  list.push({ id: `my${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name || 'Benim istasyonum', lat, lon, opId, kw: kw || null });
  save(CUSTOM_KEY, list);
}
export function removeCustomStation(id) {
  save(CUSTOM_KEY, getCustomStations().filter((c) => c.id !== id));
}
const customRaw = () => getCustomStations().map((c) => ({
  id: c.id, name: c.name, lat: c.lat, lon: c.lon, opId: c.opId, srcKw: c.kw, uncertain: !c.kw, slow: false, src: 'Benim',
}));

// Kullanıcının istasyon başına operatör düzeltmeleri { istasyonId: operatörId } (adlardan operatör tahmini yanlış olabilir).
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
  return { ...s, opId: ov || s.opId, opRaw: s.opRaw ?? s.opId, corrected: !!ov, opName: op.name, price: op.price, kw: ov ? op.kw : (s.srcKw ?? op.kw) };
}

/**
 * Yinelenenleri ele: ~80 m içinde AYNI operatörün ikinci kaydı atılır. Farklı operatörler aynı noktada olabilir
 * (ör. Astor + Trugo yan yana): ikisi de aday kalır. Operatörü bilinmeyen ("Diğer") kayıt, aynı noktadaki bilinen
 * operatör kaydının kopyası sayılır.
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

/** Arama özeti: Google kaç kayıt döndürdü, neden elendi, 100 km başına kaç aday kaldı (eksik bölgeleri göstermek için). */
function summarize(stations, profile, ctx) {
  const bins = [];
  for (let b = 0; b * 100 < profile.totalKm; b++) bins.push(0);
  stations.forEach((s) => { bins[Math.min(bins.length - 1, Math.floor(s.km / 100))]++; });
  return {
    raw: ctx?.raw ?? 0, kept: stations.length, drop: ctx?.drop ?? {}, calls: ctx?.calls ?? 0,
    textCalls: ctx?.textCalls ?? 0, textFound: ctx?.textFound ?? 0, bins,
  };
}

/**
 * Rota boyunca istasyonlar. Rota ~45 km aralıkla 30 km yarıçaplı dairelerle taranır (Nearby Search, her çağrı ≤ 20 sonuç;
 * dolu daireler bölünür). Başarılı sonuç `cacheKey` (rota uçları) ile 6 saat saklanır: aynı rotayı yeniden planlamak
 * Google'a yeniden gitmez. Dönüş: { stations, errors, cached }.
 */
export async function fetchChargers(pts, profile, cacheKey = null) {
  const key = cacheKey && 'chargersG:' + cacheKey;
  const cached = key && load(key, null);
  if (cached && Date.now() - cached.t < CACHE_TTL_MS) {
    return { stations: finalize([...customRaw(), ...cached.raw], profile), errors: [], cached: true, summary: cached.summary ?? null };
  }

  const circles = [];
  let nextKm = 0;
  for (const p of pts) {
    if (p.km >= nextKm) { circles.push({ lat: p.lat, lon: p.lon, radiusM: CIRCLE_KM * 1000, textFallback: true }); nextKm = p.km + SPACING_KM; }
  }
  const last = pts.at(-1);
  if (haversineKm(circles.at(-1), last) > SPACING_KM / 2) circles.push({ lat: last.lat, lon: last.lon, radiusM: CIRCLE_KM * 1000, textFallback: true });

  const errors = [];
  let raw = [];
  let ctxInfo = null;
  try {
    const ctx = await runCircles(circles, { pts });
    ctxInfo = ctx;
    raw = [...ctx.out.values()];
    if (ctx.failed) errors.push(`Google: ${ctx.failed} arama başarısız${ctx.lastError ? ' — ' + ctx.lastError : ''}`);
    if (ctx.capped) errors.push(`Çok uzun rota: arama ${MAX_CALLS} çağrıda kesildi (liste eksik olabilir)`);
  } catch (err) {
    errors.push(err.message);
  }
  const stations = finalize([...customRaw(), ...raw], profile);
  const summary = summarize(stations, profile, ctxInfo);
  if (key && raw.length && !errors.length) save(key, { t: Date.now(), raw, summary });
  return { stations, errors, cached: false, summary };
}

/** Rota değişti (yeniden rota): mevcut istasyonları yeni rotaya izdüşür, koridor dışını ele. Ağ çağrısı yok. */
export function reproject(stations, profile) {
  const out = [];
  for (const s of stations) {
    const { km, offKm } = profile.project(s.lat, s.lon);
    if (offKm <= PLANNER.corridorM / 1000 + 0.5) out.push({ ...s, km, offKm });
  }
  return out.sort((a, b) => a.km - b.km);
}

const NEAR_TTL_MS = 20 * 60e3;

/**
 * Bir noktanın etrafındaki (yarıçap km, en çok 50) istasyonlar, uzaklığa göre sıralı: { stations, errors, cached }.
 * Konum ~1 km hücreye yuvarlanıp 20 dk saklanır; `force` önbelleği atlar.
 */
export async function fetchAround(lat, lon, radiusKm, force = false) {
  const here = { lat, lon };
  const key = `nearG:${lat.toFixed(2)},${lon.toFixed(2)}:${radiusKm}`;
  const finish = (raw, errors, cached) => {
    const list = [];
    for (const s of dedupe([...customRaw(), ...raw])) {
      const distKm = haversineKm(here, s);
      if (distKm <= radiusKm) list.push({ ...priced(s), distKm });
    }
    return { stations: list.sort((a, b) => a.distKm - b.distKm), errors, cached };
  };

  const hit = !force && load(key, null);
  if (hit && Date.now() - hit.t < NEAR_TTL_MS) return finish(hit.raw, [], true);

  const errors = [];
  let raw = [];
  try {
    const ctx = await runCircles([{ lat, lon, radiusM: Math.min(radiusKm, 50) * 1000 }]);
    raw = [...ctx.out.values()];
    if (ctx.failed) errors.push(`Google: ${ctx.failed} arama başarısız${ctx.lastError ? ' — ' + ctx.lastError : ''}`);
  } catch (err) {
    errors.push(err.message);
  }
  if (raw.length && !errors.length) save(key, { t: Date.now(), raw });
  return finish(raw, errors, false);
}

/**
 * Seçili istasyonların canlı yuva doluluğunu Google'dan yenile (Place Details, yalnızca evChargeOptions). Çağrı başına bir istasyon;
 * en çok 3. Dönüş: { id → slots }. Kendi eklediğin ('Benim') istasyonlar atlanır; hata olursa o istasyon atlanır.
 */
export async function fetchAvailability(stations, max = 3) {
  const out = new Map();
  for (const s of stations.filter((x) => x.gid).slice(0, max)) {
    try {
      // aynı istasyon 2 dk içinde yeniden sorulmaz (ekran yenilemeleri/çift tetikleme)
      const j = await cached(`av:${s.gid}`, TTL.short, () => gfetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(s.gid)}`, { mask: 'evChargeOptions' }), { persist: false });
      out.set(s.id, slotsOf(j.evChargeOptions, DC_TYPES));
    } catch (err) {
      if (err.fatal) break;
    }
  }
  return out;
}

/** Operatör tablosu değişince fiyat/kW'yi yeniden uygula (ağ çağrısı yok). */
export function reprice(stations) {
  return stations.map((s) => priced({ ...s, opId: s.opRaw ?? s.opId }));
}
