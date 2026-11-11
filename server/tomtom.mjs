// TomTom EV canlı doluluk (Search API kategori araması + EV Charging Stations Availability API). Yalnızca sunucuda çalışır (TOMTOM_KEY).
// Türkiye'de ZES, Trugo, Eşarj, WAT, Sharz vb. için gerçek soket durumu döner (ölçüldü: aramada istasyonların ~%30'unda doluluk kimliği var).
// İki adım: (1) istasyonun ≤150 m çevresinde EV araması → doluluk kimliği (kimlik 24 saat saklanır), (2) kimlikle canlı durum.
// Not: yanıtta "güncellenme zamanı" alanı YOK; bu yüzden zaman okuma anı sayılır (NDW gibi). Anahtar yalnızca isteğe eklenir, hata iletileri anahtarı içermez.
const base = () => process.env.TOMTOM_BASE || 'https://api.tomtom.com'; // ortam değişkenleri çağrı anında okunur
import { fromTomTom } from './availability.mjs';
const EV_CATEGORY = '7309'; // TomTom POI kategorisi: elektrikli araç şarj istasyonu
const MATCH_M = 150; // marka bilinmiyorsa en çok bu uzaklık
const BRAND_MATCH_M = 400; // marka da tutuyorsa en çok bu uzaklık
const DC_MIN_KW = 40;
const ID_TTL_MS = 24 * 3600e3;
export const dailyCap = () => Number(process.env.TOMTOM_DAILY_CAP || 2000); // ücretsiz planın günlük sınırının altında kal (2.500 istek/gün)

// Günlük istek sayacı (bellekte; yeniden başlatmada sıfırlanır). Her HTTP isteği 1 sayılır.
let day = '';
let used = 0;
const today = () => new Date().toISOString().slice(0, 10);
export function tomtomUsage() { if (day !== today()) { day = today(); used = 0; } return { day, used, cap: dailyCap() }; }
export const tomtomAllowed = () => tomtomUsage().used < dailyCap();
const count = () => { tomtomUsage(); used++; };

const idCache = new Map(); // "lat,lon" → { id | null, exp }
const rad = (d) => (d * Math.PI) / 180;
const distM = (a, b) => 12742000 * Math.asin(Math.sqrt(Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2));

async function getJson(path, params, key, fetchImpl) {
  const u = new URL(path, base());
  u.search = new URLSearchParams({ ...params, key });
  count();
  const res = await fetchImpl(u, { signal: AbortSignal.timeout(8000), redirect: 'error' });
  if (!res.ok) throw Object.assign(new Error('TomTom HTTP ' + res.status), { status: res.status }); // yanıt gövdesi günlüğe yazılmaz
  return res.json();
}

// ---------- Marka denetimi ----------
// Aynı otoparkta farklı operatörlerin istasyonları yan yana olabilir; yalnızca uzaklığa bakmak başka operatörün doluluğunu gösterir (ölçüldü:
// Otopriz istasyonuna ZES'in verisi eşleşti). Marka biliniyorsa yalnızca AYNI marka kabul edilir (400 m'ye kadar); marka iki taraftan birinde
// bilinmiyorsa eski kural (150 m) geçerlidir.
const GENERIC = new Set(['sarj', 'charge', 'charging', 'istasyonu', 'istasyon', 'station', 'enerji', 'energy', 'mobilite', 'elektrikli', 'arac', 'otopark', 'park', 'avm', 'hizli', 'dc', 'ac', 've', 'diger', 'other', 'bilinmeyen', 'unknown', 'kw', 'ev', 'evse']);
const fold = (s) => String(s || '').toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, ' ').trim();
/** Markayı belirten sözcükler (genel sözcükler ve ≤2 harfliler atılır). */
export const brandTokens = (...names) => [...new Set(names.flatMap((n) => fold(n).split(' ')).filter((t) => t.length >= 3 && !GENERIC.has(t)))];
/** İki taraf da marka biliyorsa: ortak sözcük var mı (eşit ya da ≥4 harfli biri ötekini içerir)? Biri bilinmiyorsa null (karar yok). */
export function sameBrand(appTokens, ttTokens) {
  if (!appTokens.length || !ttTokens.length) return null;
  return appTokens.some((a) => ttTokens.some((b) => a === b || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a)))));
}

/**
 * Arama sonuçlarından istasyona uyan, doluluk kimliği olanı seç (en yakın). st.op (işletmeci) ve st.n (ad) varsa marka denetimi uygulanır:
 * aynı marka ≤ 400 m, farklı marka reddedilir, marka bilinmiyorsa ≤ 150 m. Dönüş: { id } ya da null.
 */
export function pickStation(results, st) {
  const app = brandTokens(st.op).length ? brandTokens(st.op) : brandTokens(st.n);
  let best = null;
  let bd = Infinity;
  for (const r of Array.isArray(results) ? results : []) {
    const id = r?.dataSources?.chargingAvailability?.id;
    if (!id || !r.position || !Number.isFinite(r.position.lat) || !Number.isFinite(r.position.lon)) continue;
    const d = distM(st, r.position);
    const brands = (r.poi?.brands || []).map((b) => b?.name);
    const same = sameBrand(app, brandTokens(...brands)); // TomTom tarafında marka yoksa bilinmiyor sayılır (ad adres gibi olabilir)
    const limit = same === true ? BRAND_MATCH_M : same === false ? -1 : MATCH_M;
    if (d <= limit && d < bd) { bd = d; best = r; }
  }
  return best ? { id: String(best.dataSources.chargingAvailability.id) } : null;
}

/**
 * Canlı durum yanıtı → { total, available, out } ya da null. dcOnly: yalnızca ≥40 kW seviyeler sayılır (yoksa hepsi).
 * Bilinmeyen soketler "boş" sayılmaz; hiç boş görünmeyen ama bilinmeyen soketi olan istasyon "dolu" denmez (belirsiz → null).
 */
export function tomtomSlots(av, dcOnly) {
  const conns = Array.isArray(av?.connectors) ? av.connectors : [];
  const sum = { total: 0, available: 0, occupied: 0, out: 0, unknown: 0 };
  let dcFound = false;
  const add = (o, acc) => { acc.available += o.available || 0; acc.occupied += o.occupied || 0; acc.out += o.outOfService || 0; acc.unknown += o.unknown || 0; acc.total += (o.available || 0) + (o.occupied || 0) + (o.outOfService || 0) + (o.unknown || 0) + (o.reserved || 0); };
  const dc = { total: 0, available: 0, occupied: 0, out: 0, unknown: 0 };
  const all = { total: 0, available: 0, occupied: 0, out: 0, unknown: 0 };
  for (const c of conns) {
    const cur = c?.availability?.current;
    if (!cur) continue;
    add(cur, all);
    const levels = Array.isArray(c.availability.perPowerLevel) ? c.availability.perPowerLevel : [];
    for (const l of levels) if ((l.powerKW || 0) >= DC_MIN_KW) { add(l, dc); dcFound = true; }
  }
  const use = dcOnly && dcFound ? dc : all;
  Object.assign(sum, use);
  if (!sum.total) return null;
  if (sum.available === 0 && sum.unknown > 0) return null; // belirsiz: "dolu" deme
  if (sum.unknown === sum.total) return null; // hiçbiri canlı değil
  return { total: sum.total, available: sum.available, out: sum.out };
}

/** Bir istasyonun canlı doluluğu. Dönüş: { src: 'tomtom', total, available, out, at, price: null } ya da null. */
export async function tomtomLookup(st, key, { fetchImpl = fetch, now = Date.now() } = {}) {
  const ck = `${st.lat.toFixed(4)},${st.lon.toFixed(4)}:${brandTokens(st.op, st.n).join('+')}`;
  let hit = idCache.get(ck);
  if (!hit || hit.exp < now) {
    const j = await getJson('/search/2/categorySearch/electric%20vehicle%20station.json',
      { lat: st.lat.toFixed(5), lon: st.lon.toFixed(5), radius: String(BRAND_MATCH_M), limit: '10', categorySet: EV_CATEGORY, relatedPois: 'off' }, key, fetchImpl);
    hit = { id: pickStation(j?.results, st)?.id || null, exp: now + ID_TTL_MS };
    idCache.set(ck, hit);
    if (idCache.size > 3000) idCache.delete(idCache.keys().next().value);
  }
  if (!hit.id) return null; // bu istasyonun canlı beslemesi yok
  const av = await getJson('/search/2/chargingAvailability.json', { chargingAvailability: hit.id }, key, fetchImpl);
  const s = tomtomSlots(av, st.dc);
  return s ? { src: 'tomtom', ...s, at: now, price: null, availability: fromTomTom(av, { dcOnly: st.dc, now }) } : null;
}
export const _clearIds = () => idCache.clear();

// ---------- Rota (Routing API v1, canlı trafik) ----------
// Yalnızca sunucu çağırır (anahtar tarayıcıya gitmez). Sabit parametreler: trafikli en hızlı otomobil rotası, Türkçe adım metni, trafik + hız limiti
// bölümleri, üç süre türü (canlı / trafiksiz / olağan). İstemci dönüşümü js/tomtom/route.js içindedir.
const PTS = /^-?\d{1,2}(\.\d{1,6})?,-?\d{1,3}(\.\d{1,6})?(:-?\d{1,2}(\.\d{1,6})?,-?\d{1,3}(\.\d{1,6})?){1,25}$/;
export const validPts = (s) => typeof s === 'string' && s.length <= 700 && PTS.test(s);

/** pts: "lat,lon:lat,lon[:lat,lon…]" (en çok 27 nokta). Dönüş: TomTom yanıtı (JSON). HTTP hatası status taşır; anahtar iletilerde yoktur. */
export async function tomtomRoute(key, pts, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (!validPts(pts)) throw Object.assign(new Error('geçersiz noktalar'), { status: 400 });
  const u = new URL(`/routing/1/calculateRoute/${pts}/json`, base());
  u.search = new URLSearchParams([
    ['traffic', 'true'], ['travelMode', 'car'], ['routeType', 'fastest'], ['instructionsType', 'text'], ['language', 'tr-TR'],
    ['sectionType', 'traffic'], ['sectionType', 'speedLimit'], ['computeTravelTimeFor', 'all'], ['routeRepresentation', 'polyline'], ['key', key],
  ]);
  count();
  const res = await fetchImpl(u, { signal: AbortSignal.timeout(40000), redirect: 'error' });
  if (!res.ok) throw Object.assign(new Error('TomTom HTTP ' + res.status), { status: res.status }); // yanıt gövdesi günlüğe yazılmaz
  return res.json();
}
