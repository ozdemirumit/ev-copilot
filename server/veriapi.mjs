// VeriApi.Pro (https://veriapi.pro): Türkiye şarj işletmecilerinin yayımladığı genel kWh tarifeleri (GET /v1/sarj/fiyatlar, 1 birim).
// Anlık doluluk VERMEZ; yalnızca işletmeci tarifesi. Günde bir kez çekilir (ücretsiz plan: günde 500 birim), sunucuda saklanır, yeniden başlatmada
// yeniden harcanmaz. Anahtar yalnızca burada (VERIAPI_KEY) durur. Anahtar yoksa ya da yanıt anlaşılamazsa HİÇBİR fiyat üretilmez (sessizce kapalı).
// Yanıt şeması belgelenmediği için çözücü toleranslıdır; makul olmayan (≤0, >100) değerler atılır. Üretilen fiyat: { currency:'TRY', kwh, src:'veriapi', at }.
import { brandTokens, sameBrand } from './tomtom.mjs';

const BASE = process.env.VERIAPI_BASE || 'https://api.veriapi.pro';
const TTL_MS = 24 * 3600e3;
const RETRY_MS = 60 * 60e3; // başarısız denemeden sonra 1 saat bekle
const PATH = '/v1/sarj/fiyatlar';

const good = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 100;
const KEYS = ['tl_kwh', 'kwh', 'fiyat', 'ucret', 'tutar', 'en_dusuk', 'min'];
/** Sayı ya da { tl_kwh | kwh | fiyat … } nesnesi → sayı | null. */
function num(x) {
  if (good(x)) return x;
  if (typeof x === 'string') { const n = Number(x.replace(',', '.')); return good(n) ? n : null; }
  if (x && typeof x === 'object' && !Array.isArray(x)) for (const k of KEYS) { const n = num(x[k]); if (n != null) return n; }
  return null;
}
/** Güç kademeleri listesi → verilen güç için fiyat (yoksa en düşük). kademe: { min_kw|kw_min, max_kw|kw_max, tl_kwh … }. */
function tier(list, kw) {
  // Gerçek şema (doğrulandı): kademe { ust_kw (üst güç sınırı, null = sınırsız), tl_kwh (en düşük), en_cok (lokasyona göre üst sınır, çoğu zaman null) }.
  // Lokasyona göre değişen fiyatta üst sınır alınır: planlanan maliyet olduğundan düşük gösterilmesin.
  let prev = 0;
  const rows = list.map((t) => {
    const hi = Number(t?.ust_kw ?? t?.max_kw ?? t?.kw_max ?? t?.guc_max ?? Infinity);
    const lo = Number(t?.min_kw ?? t?.kw_min ?? t?.guc_min ?? prev);
    prev = Number.isFinite(hi) ? hi : prev;
    return { lo, hi, p: num(t?.en_cok) ?? num(t) };
  }).filter((t) => t.p != null);
  if (!rows.length) return null;
  const hit = kw != null ? rows.find((t) => kw >= t.lo && kw <= t.hi) : null;
  return (hit || rows.reduce((a, b) => (b.p > a.p ? b : a))).p; // güç bilinmiyorsa en pahalı kademe (maliyet olduğundan düşük gösterilmesin)
}
const side = (v, kw) => (Array.isArray(v) ? tier(v, kw) : num(v));

/** Yanıt gövdesi (zarf ya da düz) → [{ code, name, ac, dc }] (ac/dc: sayı | kademe listesi | null). Anlaşılamazsa []. */
export function extractTariffs(body) {
  const root = body && typeof body === 'object' && 'veri' in body ? body.veri : body;
  const list = Array.isArray(root) ? root : Object.values(root || {}).find((v) => Array.isArray(v) && v.length && typeof v[0] === 'object') || [];
  const out = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const name = String(r.ad ?? r.isim ?? r.operator_adi ?? r.operator ?? r.kod ?? '').trim();
    const code = String(r.kod ?? r.operator ?? r.id ?? '').trim();
    if (!name && !code) continue;
    const pick = (...ks) => { for (const k of ks) if (r[k] != null) return r[k]; return null; };
    const ac = pick('ac', 'ac_tl_kwh', 'ac_fiyat', 'ac_kademeler', 'ac_tarife');
    const dc = pick('dc', 'dc_tl_kwh', 'dc_fiyat', 'dc_kademeler', 'dc_tarife');
    if (side(ac) == null && side(dc) == null) continue;
    out.push({ code, name: name || code, ac, dc });
  }
  return out;
}

/** Tarife tablosu + istasyon → { currency, kwh, flat, hour, parkingHour, src, at } | null. Marka eşleşmesi yoksa null (yanlış işletmeci fiyatı gösterilmez). */
export function priceFromTariffs(rows, st, at = Date.now()) {
  const app = brandTokens(st.op).length ? brandTokens(st.op) : brandTokens(st.n);
  if (!app.length) return null;
  const row = rows.find((r) => sameBrand(app, brandTokens(r.code, r.name)) === true);
  if (!row) return null;
  const kwh = side(st.dc ? row.dc : row.ac, st.kw ?? null);
  return kwh == null ? null : { currency: 'TRY', kwh: Math.round(kwh * 100) / 100, flat: null, hour: null, parkingHour: null, src: 'veriapi', at };
}

/** key boşsa pasif nesne. store.data.veriapi = { at, rows } kalıcıdır. */
export function createVeriApi({ key, store, fetchImpl = fetch, now = () => Date.now() } = {}) {
  const mem = { at: 0, rows: [] };
  const d = () => (store ? (store.data.veriapi ||= { at: 0, rows: [] }) : mem);
  let busy = null;
  let failedAt = 0;
  let calls = 0;

  async function refresh() {
    if (!key) return false;
    if (busy) return busy;
    busy = (async () => {
      try {
        calls++;
        const res = await fetchImpl(new URL(PATH, BASE), { headers: { 'X-API-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { status: res.status });
        const rows = extractTariffs(await res.json());
        if (!rows.length) throw new Error('tarife çözülemedi (yanıt şeması beklenenden farklı)');
        Object.assign(d(), { at: now(), rows });
        failedAt = 0;
        store?.save();
        return true;
      } catch (err) {
        failedAt = now();
        console.error('VeriApi.Pro tarifeleri alınamadı:', typeof err?.status === 'number' ? 'HTTP ' + err.status : err.message); // anahtar iletide yok
        return false;
      } finally { busy = null; }
    })();
    return busy;
  }
  const stale = () => now() - d().at > TTL_MS;
  return {
    enabled: !!key,
    /** Eskiyse arka planda tazeler (istek beklemez); eldeki tablodan fiyat verir. */
    priceFor(st) {
      if (!key) return null;
      if (stale() && (!failedAt || now() - failedAt > RETRY_MS)) refresh();
      return d().rows.length ? priceFromTariffs(d().rows, st, d().at) : null;
    },
    refresh,
    /** İstemci için işletmeci tarifeleri: [{ code, name, ac, dc }] (kademe/lokasyon varsa üst sınır; yok → null). Eskiyse arka planda tazeler. */
    tariffs() {
      if (!key) return { at: null, operators: [] };
      if (stale() && (!failedAt || now() - failedAt > RETRY_MS)) refresh();
      return { at: d().at || null, operators: d().rows.map((r) => ({ code: r.code, name: r.name, ac: side(r.ac, null), dc: side(r.dc, null) })) };
    },
    status: () => ({ enabled: !!key, at: d().at || null, operators: d().rows.length, calls }),
  };
}
