// Google Places (Yeni) Nearby Search ile şarj istasyonu LİSTESİ (doluluk değil: o server/occupancy.mjs'te). GOOGLE_PLACES_KEY yalnızca sunucuda durur.
// Tek istek en çok 20 yer döndürür (sayfalama yok); 20 dolarsa istemci daireyi böler. EV alanı (evChargeOptions) Enterprise katmanındadır: ücretli,
// bu yüzden çağıran (proxy.mjs) Premium + kullanıcı/toplam günlük tavan uygular. Ham yanıt değil, kısa kayıt döner: { id, n, la, lo, dc, ac }.
const base = () => process.env.GOOGLE_PLACES_BASE || 'https://places.googleapis.com'; // ortam değişkeni çağrı anında okunur (.env sonradan işlenir)
export const MAX_RESULTS = 20;
const DC_KW_MIN = 40; // bağlayıcı türü belirtilmemişse bu güç ve üstü DC sayılır
const DC_TYPES = new Set(['EV_CONNECTOR_TYPE_CCS_COMBO_1', 'EV_CONNECTOR_TYPE_CCS_COMBO_2', 'EV_CONNECTOR_TYPE_CHADEMO']);
const AC_TYPES = new Set(['EV_CONNECTOR_TYPE_J1772', 'EV_CONNECTOR_TYPE_TYPE_2', 'EV_CONNECTOR_TYPE_UNSPECIFIED_GB_T']);
const TESLA = 'EV_CONNECTOR_TYPE_TESLA';

/** Places kaydı → kısa kayıt ya da null (konumsuz, kalıcı kapalı, yalnızca Tesla). Bağlayıcı bilgisi yoksa dc/ac null (güç bilinmiyor). */
export function compact(p) {
  const la = p?.location?.latitude;
  const lo = p?.location?.longitude;
  if (!p?.id || !Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (p.businessStatus === 'CLOSED_PERMANENTLY') return null;
  const agg = p.evChargeOptions?.connectorAggregation || [];
  if (agg.length && agg.every((a) => a.type === TESLA)) return null; // yalnızca Tesla: öteki kaynaklar da eler (Supercharger ayrı kaynaktan)
  let dc = 0;
  let ac = 0;
  for (const a of agg) {
    const kw = a.maxChargeRateKw || 0;
    if (a.type === TESLA) continue;
    if (DC_TYPES.has(a.type) || (!AC_TYPES.has(a.type) && kw >= DC_KW_MIN)) dc = Math.max(dc, kw);
    else ac = Math.max(ac, kw);
  }
  return { id: p.id, n: p.displayName?.text || 'Şarj istasyonu', la, lo, dc: dc || null, ac: ac || null, k: agg.length ? 1 : 0 };
}

/** Daire içindeki istasyonlar: { items, full } (full: 20 doldu, daha fazlası olabilir). Hata: { status } taşıyan Error (gövde/anahtar günlüğe yazılmaz). */
export async function googleStationsNear(key, { lat, lon, r }, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${base()}/v1/places:searchNearby`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.businessStatus,places.evChargeOptions.connectorAggregation.type,places.evChargeOptions.connectorAggregation.maxChargeRateKw',
    },
    body: JSON.stringify({ includedTypes: ['electric_vehicle_charging_station'], maxResultCount: MAX_RESULTS, rankPreference: 'DISTANCE', locationRestriction: { circle: { center: { latitude: lat, longitude: lon }, radius: Math.min(50000, Math.max(100, r)) } } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw Object.assign(new Error('Google HTTP ' + res.status), { status: res.status });
  const { places = [] } = await res.json();
  return { items: places.map(compact).filter(Boolean), full: places.length >= MAX_RESULTS };
}
