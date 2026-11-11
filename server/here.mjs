// HERE Search (Browse) "show=ev": istasyon listesi (konum, güç, soket türü) ve bağlantı bazlı canlı durum. Yalnızca sunucuda çalışır (HERE_API_KEY).
// Not: EV Charge Points API v3 (tarifeler) bu anahtara kapalı (403): fiyat yok. Durum bilgisi her istasyonda canlı değildir ("OTHER" = bilinmiyor).
const base = () => process.env.HERE_BASE || 'https://browse.search.hereapi.com'; // ortam değişkenleri çağrı anında okunur
import { fromHereItem } from './availability.mjs';
const CATEGORY = '700-7600-0322'; // elektrikli araç şarj noktası (otomobil)
const DC_TYPE = /combo|chademo|ccs/i; // DC soket adları (HERE: "IEC 62196-3 type 2 combo", "JEVS G 105 (CHAdeMO)")
const DC_MIN_KW = 40;
const LIVE = new Set(['AVAILABLE', 'OCCUPIED', 'OUT_OF_SERVICE', 'UNAVAILABLE']); // canlı beslenen durumlar; "OTHER" bilinmiyor demektir
const OUT = new Set(['OUT_OF_SERVICE', 'UNAVAILABLE']);
export const FEED_MS = 6 * 3600e3; // istasyonda bu süre içinde güncellenen canlı durum yoksa besleme ölü sayılır

const rad = (d) => (d * Math.PI) / 180;
const distM = (a, b) => 12742000 * Math.asin(Math.sqrt(Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2));

/** Daire içindeki şarj noktaları (en çok 100). Anahtar yalnızca isteğe eklenir; hata iletileri anahtarı içermez. */
export async function hereBrowse(key, { lat, lon, r, limit = 100, fetchImpl = fetch }) {
  const u = new URL('/v1/browse', base());
  u.search = new URLSearchParams({ at: `${lat.toFixed(5)},${lon.toFixed(5)}`, in: `circle:${lat.toFixed(5)},${lon.toFixed(5)};r=${Math.round(r)}`, categories: CATEGORY, limit: String(limit), show: 'ev', apiKey: key });
  const res = await fetchImpl(u, { signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!res.ok) throw Object.assign(new Error('HERE HTTP ' + res.status), { status: res.status }); // yanıt gövdesi günlüğe yazılmaz
  const j = await res.json();
  return Array.isArray(j.items) ? j.items : [];
}

/** Browse öğesi → kısa istasyon kaydı { id, n (ad), la, lo, s (işletmeci), dc (en büyük DC kW), ac (en büyük AC kW) }. Tesla'ya özel/yalnızca müşteri kayıtları elenir. */
export function compact(it) {
  const ev = it?.extended?.evStation;
  const p = it?.position;
  if (!ev || !p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
  if ((ev.restrictions || []).includes('customersOnly')) return null;
  const conns = ev.connectors || [];
  const sup = conns.map((c) => c.supplierName).find(Boolean) || '';
  const n = String(it.title || '').slice(0, 80);
  if (/tesla/i.test(`${n} ${sup}`)) return null;
  let dc = 0;
  let ac = 0;
  for (const c of conns) {
    const kw = Number(c.maxPowerLevel) || 0;
    if (DC_TYPE.test(c.connectorType?.name || '')) dc = Math.max(dc, kw); else ac = Math.max(ac, kw);
  }
  return { id: String(it.id || '').replace(/^here:pds:place:/, '').slice(0, 80), n, la: p.lat, lo: p.lng, s: String(sup).slice(0, 40), dc: dc || null, ac: ac || null };
}

/**
 * Canlı durum → { total, available, out, at } ya da null. Yalnızca beslemesi canlı istasyon (son 6 saatte güncellenmiş canlı durum var) dikkate alınır;
 * "OTHER" yuvalar bilinmiyor sayılır. Hiç boş görünmeyen ama bilinmeyen yuvası olan istasyon "dolu" denmez (belirsiz → null).
 */
export function hereSlots(it, dcOnly, now = Date.now()) {
  const evses = (it?.extended?.evAvailability?.stations || []).flatMap((s) => s.evses || []);
  const pool = dcOnly ? evses.filter((e) => (e.connectors || []).some((c) => (c.maxPowerLevel || 0) >= DC_MIN_KW)) : evses;
  if (!pool.length) return null;
  const live = pool.filter((e) => LIVE.has(e.state));
  const times = live.map((e) => Date.parse(e.last_updated)).filter(Number.isFinite);
  if (!live.length || !times.length || now - Math.max(...times) > FEED_MS) return null;
  const available = live.filter((e) => e.state === 'AVAILABLE').length;
  if (available === 0 && live.length < pool.length) return null;
  return { total: pool.length, available, out: live.filter((e) => OUT.has(e.state)).length, at: Math.max(...times) };
}

/** Bir istasyonun (≤150 m) canlı doluluğu. Dönüş: { src: 'here', total, available, out, at, price: null } ya da null. */
export async function hereLookup(st, key, { fetchImpl = fetch, now = Date.now() } = {}) {
  const items = await hereBrowse(key, { lat: st.lat, lon: st.lon, r: 150, limit: 5, fetchImpl });
  let best = null;
  let bd = Infinity;
  for (const it of items) {
    if (!it.extended?.evAvailability?.stations?.length || !it.position) continue;
    const d = distM(st, { lat: it.position.lat, lon: it.position.lng });
    if (d < bd) { bd = d; best = it; }
  }
  const s = best && hereSlots(best, st.dc, now);
  return s ? { src: 'here', ...s, price: null, availability: fromHereItem(best, { dcOnly: st.dc, now }) } : null;
}
