// Canlı dolu/boş (EVSE availability) için normalize katman ve sağlayıcı adaptörleri.
// Mevcut doluluk akışı (server/occupancy.mjs: NDW → HERE → TomTom → Google → topluluk) aynen çalışır; bu modül her sağlayıcının ham yanıtını
// ortak bir biçime çevirir ve sonuca EK bir alan (`availability`) olarak eklenir. Eski alanlar (src, total, available, out, at, price) değişmez.
//
// Ortak biçim (StationAvailability):
//   { source, simulated, granularity: 'evse'|'counts', total, available, counts: {AVAILABLE..UNKNOWN}, evses: [{ uid, status, powerKw, at }] | null,
//     at, timestampKind: 'provider'|'fetched', ageMs, staleness: 'fresh'|'aging'|'stale'|'unknown' }
//   timestampKind 'fetched': sağlayıcı güncellenme zamanı vermiyor, `at` okuma anıdır (gerçek tazelik bilinmez).
//   simulated: true yalnızca test fikstürü (mock) için; mock sağlayıcı lookupAll'a bağlı DEĞİLDİR, kullanıcıya gerçek veri diye gösterilmez.
// Bu modül başka sunucu modülünü içe aktarmaz (döngü olmasın).

export const EVSE_STATUS = Object.freeze({
  AVAILABLE: 'AVAILABLE', CHARGING: 'CHARGING', RESERVED: 'RESERVED', BLOCKED: 'BLOCKED',
  OUTOFORDER: 'OUTOFORDER', INOPERATIVE: 'INOPERATIVE', UNKNOWN: 'UNKNOWN',
});
export const STATUS_LIST = Object.freeze(Object.values(EVSE_STATUS));
const S = EVSE_STATUS;
const DC_MIN_KW = 40;

// ---------- Durum eşlemesi ----------
// OCPI 2.2.1 Status: PLANNED/REMOVED henüz/artık kullanılamayan EVSE'dir; toplam sayıya katılmaz (null).
const OCPI_MAP = { AVAILABLE: S.AVAILABLE, BLOCKED: S.BLOCKED, CHARGING: S.CHARGING, INOPERATIVE: S.INOPERATIVE, OUTOFORDER: S.OUTOFORDER, RESERVED: S.RESERVED, UNKNOWN: S.UNKNOWN, PLANNED: null, REMOVED: null };
// HERE Browse evAvailability: OCCUPIED şarj ediyor, OUT_OF_SERVICE arızalı, UNAVAILABLE kullanılamaz; OTHER bilinmiyor.
const HERE_MAP = { AVAILABLE: S.AVAILABLE, OCCUPIED: S.CHARGING, RESERVED: S.RESERVED, OUT_OF_SERVICE: S.OUTOFORDER, UNAVAILABLE: S.INOPERATIVE, OTHER: S.UNKNOWN };
const MAPS = { ocpi: OCPI_MAP, ndw: OCPI_MAP, here: HERE_MAP };

/** Ham durum → normalize durum. Tanınmayan değer UNKNOWN; null dönerse EVSE sayılmaz (OCPI PLANNED/REMOVED). */
export function normalizeStatus(source, raw) {
  const k = String(raw ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const m = MAPS[source] || OCPI_MAP;
  if (Object.prototype.hasOwnProperty.call(m, k)) return m[k];
  const k2 = k.replace(/_/g, ''); // "OUT_OF_ORDER" → OUTOFORDER gibi yazım farkları
  return STATUS_LIST.includes(k2) ? k2 : S.UNKNOWN;
}

// ---------- Tazelik ----------
export const STALENESS = Object.freeze({ freshMs: 15 * 60e3, staleMs: 2 * 3600e3 });
/** at (ms) → { ageMs, staleness }. Zaman yok/geçersiz → 'unknown'. Gelecekteki zaman (saat kayması) yaş 0 sayılır. */
export function staleness(at, now = Date.now(), th = STALENESS) {
  if (!Number.isFinite(at)) return { ageMs: null, staleness: 'unknown' };
  const ageMs = Math.max(0, now - at);
  return { ageMs, staleness: ageMs <= th.freshMs ? 'fresh' : ageMs <= th.staleMs ? 'aging' : 'stale' };
}

const emptyCounts = () => Object.fromEntries(STATUS_LIST.map((s) => [s, 0]));
const time = (v) => { const t = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(t) ? t : null; };

/**
 * Ortak sonuç üretir. evses (EVSE bazlı) ya da counts (yalnızca sayılar) verilir. Hiç EVSE yoksa null.
 * at verilmezse EVSE zamanlarının en yenisi; o da yoksa fetchedAt (timestampKind 'fetched').
 */
export function buildAvailability({ source, evses = null, counts = null, at = null, fetchedAt = Date.now(), now = fetchedAt, simulated = false }) {
  const c = emptyCounts();
  let list = null;
  if (evses) {
    list = evses.filter((e) => e && e.status).map((e) => ({ uid: e.uid != null ? String(e.uid) : null, status: e.status, powerKw: Number.isFinite(e.powerKw) ? e.powerKw : null, at: time(e.at) }));
    for (const e of list) c[e.status]++;
  } else if (counts) {
    for (const s of STATUS_LIST) c[s] = Math.max(0, Math.round(Number(counts[s]) || 0));
  }
  const total = STATUS_LIST.reduce((a, s) => a + c[s], 0);
  if (!total) return null;
  let ts = time(at);
  if (ts == null && list) { const t = list.map((e) => e.at).filter((v) => v != null); if (t.length) ts = Math.max(...t); }
  const kind = ts == null ? 'fetched' : 'provider';
  if (ts == null) ts = fetchedAt;
  return {
    source, simulated: !!simulated, granularity: list ? 'evse' : 'counts', total, available: c.AVAILABLE, counts: c, evses: list,
    at: ts, timestampKind: kind, ...staleness(ts, now),
  };
}

// ---------- Adaptörler (saf: ham yanıt → ortak biçim) ----------

/** OCPI 2.2.1 Location (ulusal erişim noktaları / AFIR, ileride doğrudan CPO beslemeleri). EVSE bazlı, zaman EVSE.last_updated. */
export function fromOcpiLocation(loc, { dcOnly = false, now = Date.now(), source = 'ocpi' } = {}) {
  const evses = [];
  for (const e of Array.isArray(loc?.evses) ? loc.evses : []) {
    const status = normalizeStatus('ocpi', e?.status);
    if (!status) continue;
    const powerKw = Math.max(0, ...(e.connectors || []).map((k) => (Number(k.max_electric_power) || 0) / 1000));
    evses.push({ uid: e.uid ?? e.evse_id, status, powerKw: powerKw || null, at: e.last_updated ?? loc.last_updated });
  }
  const dc = evses.filter((e) => (e.powerKw ?? 0) >= DC_MIN_KW);
  return buildAvailability({ source, evses: dcOnly && dc.length ? dc : evses, now, fetchedAt: now });
}

/** NDW GeoJSON `availabilities` (bağlayıcı türü başına available/total; durum ayrıntısı yok): boş olmayanlar UNKNOWN sayılır. */
export function fromNdwAvailabilities(conns, { now = Date.now() } = {}) {
  let available = 0, total = 0;
  for (const a of Array.isArray(conns) ? conns : []) { available += a.available || 0; total += a.total || 0; }
  if (!total) return null;
  return buildAvailability({ source: 'ndw', counts: { AVAILABLE: Math.min(available, total), UNKNOWN: Math.max(0, total - available) }, now, fetchedAt: now }); // last_updated son DEĞİŞİMDİR, tazelik değil
}

/** HERE Browse öğesi (show=ev): EVSE bazlı durum ve last_updated. dcOnly: yalnızca ≥40 kW bağlayıcılı EVSE'ler (yoksa hepsi). */
export function fromHereItem(it, { dcOnly = false, now = Date.now() } = {}) {
  const raw = (it?.extended?.evAvailability?.stations || []).flatMap((s) => s.evses || []);
  const evses = raw.map((e) => ({
    uid: e.id ?? null, status: normalizeStatus('here', e.state),
    powerKw: Math.max(0, ...(e.connectors || []).map((k) => Number(k.maxPowerLevel) || 0)) || null, at: e.last_updated,
  }));
  const dc = evses.filter((e) => (e.powerKw ?? 0) >= DC_MIN_KW);
  return buildAvailability({ source: 'here', evses: dcOnly && dc.length ? dc : evses, now, fetchedAt: now });
}

/** TomTom chargingAvailability: bağlayıcı/güç seviyesi başına sayılar (EVSE kimliği ve zaman yok → 'fetched'). */
export function fromTomTom(av, { dcOnly = false, now = Date.now() } = {}) {
  const add = (o, acc) => { acc.AVAILABLE += o.available || 0; acc.CHARGING += o.occupied || 0; acc.RESERVED += o.reserved || 0; acc.OUTOFORDER += o.outOfService || 0; acc.UNKNOWN += o.unknown || 0; };
  const all = emptyCounts();
  const dc = emptyCounts();
  let dcFound = false;
  for (const c of Array.isArray(av?.connectors) ? av.connectors : []) {
    const cur = c?.availability?.current;
    if (!cur) continue;
    add(cur, all);
    for (const l of Array.isArray(c.availability.perPowerLevel) ? c.availability.perPowerLevel : []) if ((l.powerKW || 0) >= DC_MIN_KW) { add(l, dc); dcFound = true; }
  }
  return buildAvailability({ source: 'tomtom', counts: dcOnly && dcFound ? dc : all, now, fetchedAt: now });
}

/** Google Places evChargeOptions.connectorAggregation: count / availableCount / outOfServiceCount; kalan UNKNOWN (dolu mu bilinmiyor). */
export function fromGoogleAggregation(agg, { dcOnly = false, now = Date.now() } = {}) {
  const list = Array.isArray(agg) ? agg : [];
  const dc = list.filter((a) => (a.maxChargeRateKw ?? 0) >= DC_MIN_KW);
  const use = dcOnly && dc.length ? dc : list;
  if (!use.some((a) => a.availableCount != null)) return null;
  const c = emptyCounts();
  for (const a of use) {
    const n = a.count || 0, av = Math.min(n, a.availableCount || 0), out = Math.min(n - av, a.outOfServiceCount || 0);
    c.AVAILABLE += av; c.OUTOFORDER += out; c.UNKNOWN += n - av - out;
  }
  const times = use.map((a) => Date.parse(a.availabilityLastUpdateTime)).filter(Number.isFinite);
  return buildAvailability({ source: 'google', counts: c, at: times.length ? Math.max(...times) : null, now, fetchedAt: now });
}

/** Test fikstürü → ortak biçim, HER ZAMAN simulated: true, source 'mock'. Yalnızca birim testleri içindir. */
export function fromMockFixture(fx, { now = Date.now() } = {}) {
  if (!fx || !Array.isArray(fx.evses)) return null;
  const evses = fx.evses.map((e) => ({ uid: e.uid, status: normalizeStatus('ocpi', e.status), powerKw: e.powerKw, at: e.at })).filter((e) => e.status);
  return buildAvailability({ source: 'mock', evses, now, fetchedAt: now, simulated: true });
}

// ---------- Sağlayıcı kaydı ----------
// requires: sunucu ortam değişkeni (anahtar). license: bilinen kullanım koşulu (doğrulanmamışsa böyle yazılır). live: lookupAll'a bağlı mı.
export const PROVIDERS = Object.freeze([
  { id: 'ndw', label: 'NDW / DOT-NL (Hollanda)', requires: null, coverage: 'NL', granularity: 'counts', timestamp: 'fetched', live: true, license: 'AFIR açık veri; ayrıntılı lisans koşulu bu görevde doğrulanmadı', normalize: fromNdwAvailabilities },
  { id: 'here', label: 'HERE Browse (show=ev)', requires: 'HERE_API_KEY', coverage: 'kısmi, beslemesi canlı istasyonlar', granularity: 'evse', timestamp: 'provider', live: true, license: 'ticari HERE sözleşmesi', normalize: fromHereItem },
  { id: 'tomtom', label: 'TomTom EV Charging Availability', requires: 'TOMTOM_KEY', coverage: 'TR dahil, istasyonların bir kısmı', granularity: 'counts', timestamp: 'fetched', live: true, license: 'TomTom ToS (gösterim şartları doğrulanmadı)', normalize: fromTomTom },
  { id: 'google', label: 'Google Places evChargeOptions', requires: 'GOOGLE_PLACES_KEY', coverage: 'TR için veri yok (ölçüldü), yalnızca düşük pilde', granularity: 'counts', timestamp: 'provider', live: true, license: 'ücretli Google Maps Platform', normalize: fromGoogleAggregation },
  { id: 'ocpi', label: 'OCPI 2.2.1 Locations (genel)', requires: 'erişim noktası/CPO anlaşması', coverage: 'yok (bağlı besleme yok)', granularity: 'evse', timestamp: 'provider', live: false, license: 'beslemeye göre', normalize: fromOcpiLocation },
  { id: 'mock', label: 'Test fikstürü (gerçek değil)', requires: null, coverage: 'yalnızca test', granularity: 'evse', timestamp: 'provider', live: false, license: '-', normalize: fromMockFixture },
]);
export const provider = (id) => PROVIDERS.find((p) => p.id === id) || null;

/** Hangi canlı sağlayıcılar yapılandırılmış? Anahtar DEĞERİ döndürülmez, yalnızca var/yok. */
export function providerStatus(env = process.env) {
  return PROVIDERS.filter((p) => p.live).map((p) => ({ id: p.id, label: p.label, configured: !p.requires || !!env[p.requires], license: p.license }));
}
