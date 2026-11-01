// İstasyon doluluğu ve canlı fiyat. Kaynaklar (sırayla):
//  1) NDW / DOT-NL (Hollanda): AFIR gereği açık veri. Konum çevresinden bounding-box GeoJSON (OCPI Locations'ın özeti: bağlayıcı türü başına
//     available/total, tariff_ids, last_updated) + tüm ülke OCPI 2.2.1 Tariffs dosyası (fiyat). Anahtar gerekmez.
//  2) Google Places (Yeni) `evChargeOptions` (isteğe bağlı: GOOGLE_PLACES_KEY, yalnızca sunucuda; kullanıcı başına günlük kota).
// Başka ülkelerin ulusal erişim noktaları aynı arayüzle (adapter) eklenir. Sonuç: { src, total, available, out, at, price }.
import { gunzipSync } from 'node:zlib';

const NDW_BBOX = process.env.NDW_BBOX_URL || 'https://dotnl.ndw.nu/api/rest/geojson/dynamic-road-status/charge-point-data/v1/features';
const NDW_TARIFFS = process.env.NDW_TARIFFS_URL || 'https://opendata.ndw.nu/charging_point_tariffs_ocpi.json.gz';
const GOOGLE_BASE = process.env.GOOGLE_PLACES_BASE || 'https://places.googleapis.com';
const NL_BOX = { minLat: 50.7, maxLat: 53.7, minLon: 3.2, maxLon: 7.3 };
const DC_MIN_W = 40000; // DC hızlı şarj sayılan alt güç (W)
const MATCH_M = 120; // istasyon ile kayıt arası en çok mesafe
const TARIFF_TTL_MS = 6 * 3600e3;
const GOOGLE_SOC_BELOW = Number(process.env.GOOGLE_SOC_BELOW || 25); // Google (ücretli) yalnızca pil bu yüzdenin altındayken sorulur

const rad = (d) => (d * Math.PI) / 180;
export function distM(a, b) {
  const x = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(x));
}
export const inNl = (p) => p.lat >= NL_BOX.minLat && p.lat <= NL_BOX.maxLat && p.lon >= NL_BOX.minLon && p.lon <= NL_BOX.maxLon;

// ---------- OCPI Tariffs: tarife → o anki kWh fiyatı ----------
const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

/** Yerel saat dilimindeki tarih (YYYY-MM-DD), saat (dk), haftanın günü. */
export function localParts(date, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'long' });
  const o = Object.fromEntries(f.formatToParts(date).map((p) => [p.type, p.value]));
  const hh = Number(o.hour) % 24;
  return { date: `${o.year}-${o.month}-${o.day}`, minutes: hh * 60 + Number(o.minute), dow: String(o.weekday).toUpperCase() };
}
const hm = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };

/** OCPI TariffRestrictions: oturum BAŞINDA geçerli mi? (min_kwh/min_duration/rezervasyon koşulları kullanım sonrası ya da başka duruma aittir: atlanır.) */
export function restrictionsMatch(r, now, powerKw) {
  if (!r) return true;
  if ((r.min_kwh ?? 0) > 0 || (r.min_duration ?? 0) > 0 || r.reservation) return false;
  if (r.start_date && now.date < r.start_date) return false;
  if (r.end_date && now.date >= r.end_date) return false;
  if (r.start_time && r.end_time) {
    const a = hm(r.start_time);
    const b = hm(r.end_time);
    const inside = a <= b ? now.minutes >= a && now.minutes < b : now.minutes >= a || now.minutes < b; // gece yarısını aşan aralık
    if (!inside) return false;
  } else if (r.start_time && now.minutes < hm(r.start_time)) return false;
  else if (r.end_time && now.minutes >= hm(r.end_time)) return false;
  if (r.day_of_week?.length && !r.day_of_week.includes(now.dow)) return false;
  if (r.min_power != null && powerKw < r.min_power) return false;
  if (r.max_power != null && powerKw >= r.max_power) return false;
  return true;
}

/**
 * OCPI Tariff → { currency, kwh, flat, hour } (KDV dahil; vat yüzde). Her boyut (ENERGY, FLAT, TIME, PARKING_TIME) için sıradaki ilk
 * uygun TariffElement'in fiyat bileşeni geçerlidir (OCPI kuralı). kwh: kWh başına, flat: oturum başına, hour: şarj süresi saat başına.
 */
export function tariffPrice(t, powerKw, at = new Date(), tz = 'Europe/Amsterdam') {
  if (!t?.elements?.length) return null;
  if (t.start_date_time && at < new Date(t.start_date_time)) return null;
  if (t.end_date_time && at >= new Date(t.end_date_time)) return null;
  const now = localParts(at, tz);
  const got = {};
  for (const el of t.elements) {
    if (!restrictionsMatch(el.restrictions, now, powerKw)) continue;
    for (const pc of el.price_components || []) if (got[pc.type] == null) got[pc.type] = pc.price * (1 + (pc.vat ?? 0) / 100);
  }
  const r = (v) => (v == null ? null : Math.round(v * 10000) / 10000);
  if (got.ENERGY == null && got.FLAT == null && got.TIME == null) return null;
  return { currency: t.currency, kwh: r(got.ENERGY), flat: r(got.FLAT), hour: r(got.TIME), parkingHour: r(got.PARKING_TIME) };
}

// Tarifler: ülke çapında OCPI dosyası (~4 MB gz); bellekte yalnızca gerekli alanlar. İlk kullanımda arka planda yüklenir.
let tariffs = null; // Map "partyId:id" → { currency, elements, start_date_time, end_date_time }
let tariffsAt = 0;
let tariffsBusy = null;
export function loadTariffs(fetchImpl = fetch) {
  if (tariffsBusy) return tariffsBusy;
  tariffsBusy = (async () => {
    try {
      const res = await fetchImpl(NDW_TARIFFS, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const list = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8'));
      const m = new Map();
      for (const t of list) {
        if (!t.id || !t.party_id || !t.elements) continue;
        m.set(`${t.party_id}:${t.id}`, {
          currency: t.currency, start_date_time: t.start_date_time, end_date_time: t.end_date_time,
          elements: t.elements.map((e) => ({ price_components: (e.price_components || []).map((p) => ({ type: p.type, price: p.price, vat: p.vat })), restrictions: e.restrictions })),
        });
      }
      tariffs = m;
      tariffsAt = Date.now();
    } catch (err) {
      console.error('tarife dosyası alınamadı:', err.message);
    } finally {
      tariffsBusy = null;
    }
  })();
  return tariffsBusy;
}
const tariffFor = (party, id) => tariffs?.get(`${party}:${id}`) || null;
export const _setTariffs = (m) => { tariffs = m; tariffsAt = Date.now(); }; // yalnızca denemeler için

// ---------- Adaptör: NDW (Hollanda) ----------
export async function ndwLookup(st, { fetchImpl = fetch, at = new Date() } = {}) {
  if (!tariffs || Date.now() - tariffsAt > TARIFF_TTL_MS) loadTariffs(fetchImpl); // arka planda; fiyat ilk istekte olmayabilir
  const dLat = 0.0021;
  const dLon = 0.0034; // ≈ 230 m
  const bbox = [st.lon - dLon, st.lat - dLat, st.lon + dLon, st.lat + dLat].map((v) => v.toFixed(6)).join(',');
  const res = await fetchImpl(`${NDW_BBOX}?bbox=${bbox}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('NDW HTTP ' + res.status);
  const gj = await res.json();
  const near = (gj.features || []).filter((f) => f.geometry?.coordinates && distM(st, { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }) <= MATCH_M);
  if (!near.length) return null;
  let conns = near.flatMap((f) => (f.properties?.availabilities || []).map((a) => ({ ...a, party: f.properties.cpo_id, upd: f.properties.last_updated })));
  if (st.dc) { const dc = conns.filter((c) => (c.power_max ?? 0) >= DC_MIN_W); if (dc.length) conns = dc; } // DC istasyonu için yalnızca hızlı soketler
  if (!conns.length) return null;
  const total = conns.reduce((a, c) => a + (c.total || 0), 0);
  const available = conns.reduce((a, c) => a + (c.available || 0), 0);
  let price = null;
  for (const c of conns) {
    for (const id of c.tariff_ids || []) {
      const p = tariffPrice(tariffFor(c.party, id), (c.power_max ?? 0) / 1000, at);
      if (p && (!price || (p.kwh ?? Infinity) < (price.kwh ?? Infinity))) price = p; // aynı yerde birden çok tarife: en ucuz kWh
    }
  }
  if (price) price.src = 'ndw';
  return { src: 'ndw', total, available, out: null, at: Date.now(), price }; // last_updated son DEĞİŞİMİ gösterir; veri AFIR gereği 1 dk içinde tazedir → okuma anı
}

// ---------- Adaptör: Google Places (Yeni) ----------
export async function googleLookup(st, key, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${GOOGLE_BASE}/v1/places:searchNearby`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.displayName,places.location,places.evChargeOptions' },
    body: JSON.stringify({ includedTypes: ['electric_vehicle_charging_station'], maxResultCount: 5, locationRestriction: { circle: { center: { latitude: st.lat, longitude: st.lon }, radius: MATCH_M } } }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error('Google HTTP ' + res.status); // yanıt gövdesi (anahtar içerebilir) günlüğe yazılmaz
  const { places = [] } = await res.json();
  let best = null;
  let bd = Infinity;
  for (const p of places) {
    if (!p.evChargeOptions?.connectorAggregation?.length || !p.location) continue;
    const d = distM(st, { lat: p.location.latitude, lon: p.location.longitude });
    if (d < bd) { bd = d; best = p; }
  }
  if (!best) return null;
  const agg = best.evChargeOptions.connectorAggregation;
  const dc = agg.filter((a) => (a.maxChargeRateKw ?? 0) * 1000 >= DC_MIN_W);
  const use = st.dc && dc.length ? dc : agg;
  if (!use.some((a) => a.availableCount != null)) return null; // canlı sayı yok
  const sum = (f) => use.reduce((t, a) => t + (f(a) || 0), 0);
  const times = use.map((a) => Date.parse(a.availabilityLastUpdateTime)).filter(Number.isFinite);
  return { src: 'google', total: sum((a) => a.count), available: sum((a) => a.availableCount), out: sum((a) => a.outOfServiceCount), at: times.length ? Math.max(...times) : null, price: null };
}

// ---------- Birleştirici ----------
const cache = new Map(); // anahtar → { exp, v }
const HIT_MS = 90e3;

// Google bir bölgede (≈ 11 km'lik hücre) üst üste 3 kez EV verisi vermediyse (hiç vermemişse) o bölge 7 gün atlanır: Türkiye'de Google istasyonları
// listeliyor ama soket/doluluk vermiyor (ölçüldü), boşuna ücret ödenmesin.
const gStats = new Map(); // hücre → { hit, miss, until }
const tile = (p) => `${p.lat.toFixed(1)},${p.lon.toFixed(1)}`;
function googleWanted(st, soc) {
  if (soc == null || soc >= GOOGLE_SOC_BELOW) return false;
  const g = gStats.get(tile(st));
  return !(g && g.until > Date.now());
}
function noteGoogle(st, got) {
  const g = gStats.get(tile(st)) || { hit: 0, miss: 0, until: 0 };
  if (got) { g.hit++; g.miss = 0; } else { g.miss++; if (!g.hit && g.miss >= 3) g.until = Date.now() + 7 * 86400e3; }
  gStats.set(tile(st), g);
}
const MISS_MS = 5 * 60e3; // sonuçsuzluk daha uzun saklanır (boşuna Google ücreti doğmasın)

/**
 * İstasyonlar için doluluk: { id → sonuç | null }. opts.google: { key, allow(): bool (kota) } verilirse NDW sonuç vermezse Google denenir.
 */
export async function lookupAll(stations, opts = {}) {
  const out = {};
  for (const st of stations) {
    const key = `${st.lat.toFixed(4)},${st.lon.toFixed(4)}:${st.dc ? 1 : 0}`;
    const hit = cache.get(key);
    if (hit && hit.exp > Date.now()) { out[st.id] = hit.v; continue; }
    let v = null;
    try {
      if (inNl(st)) v = await ndwLookup(st, opts);
    } catch (err) { console.error('doluluk (NDW):', err.message); }
    if (!v && opts.google?.key && googleWanted(st, opts.soc) && opts.google.allow()) {
      try { v = await googleLookup(st, opts.google.key, opts); noteGoogle(st, !!v); } catch (err) { console.error('doluluk (Google):', err.message); }
    }
    // Topluluk: şu an şarj eden kullanıcılar ve son Dolu/Boş bildirimi (resmî veri olmayan yerlerde asıl kaynak)
    const cm = opts.community?.summary(st);
    if (cm) v = v ? { ...v, community: cm } : { src: 'community', total: null, available: null, out: null, at: null, price: null, community: cm };
    // Fiyat defteri: canlı fiyat yoksa kullanıcıların bildirdiği son bilinen fiyat
    const b = opts.book?.nearest(st);
    if (b && !(v?.price)) {
      const price = { currency: b.currency, kwh: b.kwh, flat: null, hour: null, parkingHour: null, src: 'user', n: b.n, at: b.at };
      v = v ? { ...v, price } : { src: 'book', total: null, available: null, out: null, at: null, price };
    }
    cache.set(key, { exp: Date.now() + (v ? HIT_MS : MISS_MS), v });
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
    out[st.id] = v;
  }
  return out;
}
export const _clearCache = () => cache.clear();
