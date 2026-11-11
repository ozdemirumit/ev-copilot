// Normalize EVSE doluluk katmanı (server/availability.mjs) ve mevcut sağlayıcılara eklenen `availability` alanı.
// Gerçek anahtar/ağ YOK: sahte fetch ve scripts/fixtures/availability altındaki SAHTE fikstürler. Kullanım: node scripts/test-availability.mjs
import { readFileSync } from 'node:fs';
import {
  EVSE_STATUS, STATUS_LIST, normalizeStatus, staleness, STALENESS, buildAvailability, fromOcpiLocation, fromNdwAvailabilities,
  fromHereItem, fromTomTom, fromGoogleAggregation, fromMockFixture, PROVIDERS, provider, providerStatus,
} from '../server/availability.mjs';
import { tomtomLookup, _clearIds } from '../server/tomtom.mjs';
import { hereLookup } from '../server/here.mjs';
import { lookupAll, googleLookup, _clearCache } from '../server/occupancy.mjs';

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/availability/${n}`, import.meta.url), 'utf8'));
const NOW = Date.parse('2026-11-11T10:10:00Z');
const KEY = 'TEST-KEY-NOT-REAL';

// --- durum kümesi ve eşleme
ok('7 normalize durum, sabit sıra', eq(STATUS_LIST, ['AVAILABLE', 'CHARGING', 'RESERVED', 'BLOCKED', 'OUTOFORDER', 'INOPERATIVE', 'UNKNOWN']) && Object.isFrozen(EVSE_STATUS));
ok('OCPI durumları birebir', ['AVAILABLE', 'CHARGING', 'RESERVED', 'BLOCKED', 'OUTOFORDER', 'INOPERATIVE', 'UNKNOWN'].every((s) => normalizeStatus('ocpi', s) === s));
ok('OCPI PLANNED/REMOVED sayılmaz (null)', normalizeStatus('ocpi', 'PLANNED') === null && normalizeStatus('ocpi', 'REMOVED') === null);
ok('HERE: OCCUPIED→CHARGING, OUT_OF_SERVICE→OUTOFORDER, UNAVAILABLE→INOPERATIVE, OTHER→UNKNOWN',
  normalizeStatus('here', 'OCCUPIED') === 'CHARGING' && normalizeStatus('here', 'OUT_OF_SERVICE') === 'OUTOFORDER' && normalizeStatus('here', 'UNAVAILABLE') === 'INOPERATIVE' && normalizeStatus('here', 'OTHER') === 'UNKNOWN');
ok('yazım farkı ve küçük harf: "out-of-order", "available"', normalizeStatus('ocpi', 'out-of-order') === 'OUTOFORDER' && normalizeStatus('ocpi', 'available') === 'AVAILABLE');
ok('tanınmayan/boş değer → UNKNOWN (asla AVAILABLE değil)', normalizeStatus('ocpi', 'FREE?') === 'UNKNOWN' && normalizeStatus('here', null) === 'UNKNOWN' && normalizeStatus('xyz', '') === 'UNKNOWN');

// --- tazelik
ok('tazelik: 5 dk fresh, 1 sa aging, 3 sa stale', staleness(NOW - 5 * 60e3, NOW).staleness === 'fresh' && staleness(NOW - 3600e3, NOW).staleness === 'aging' && staleness(NOW - 3 * 3600e3, NOW).staleness === 'stale');
ok('tazelik sınırları dahil', staleness(NOW - STALENESS.freshMs, NOW).staleness === 'fresh' && staleness(NOW - STALENESS.staleMs, NOW).staleness === 'aging');
ok('zaman yok → unknown, gelecekteki zaman yaş 0', eq(staleness(null, NOW), { ageMs: null, staleness: 'unknown' }) && staleness(NOW + 60e3, NOW).ageMs === 0);

// --- birleştirici
ok('buildAvailability: EVSE yoksa null', buildAvailability({ source: 'x', evses: [], now: NOW }) === null && buildAvailability({ source: 'x', counts: {}, now: NOW }) === null);
{
  const r = buildAvailability({ source: 'x', counts: { AVAILABLE: 1, CHARGING: 2 }, fetchedAt: NOW - 1000, now: NOW });
  ok('sayılardan: total/available, zaman yok → fetched (okuma anı)', r.total === 3 && r.available === 1 && r.granularity === 'counts' && r.evses === null && r.timestampKind === 'fetched' && r.at === NOW - 1000 && r.ageMs === 1000 && r.simulated === false);
}

// --- mock fikstür (SAHTE): her durum sayılır, simulated işaretli
{
  const r = fromMockFixture(fx('mock-station.json'), { now: NOW });
  ok('mock: source=mock ve simulated=true', r.source === 'mock' && r.simulated === true);
  ok('mock: PLANNED atlanır, toplam 7, boş 1', r.total === 7 && r.available === 1 && r.evses.length === 7);
  ok('mock: her normalize durum sayıldı (bilinmeyen→UNKNOWN)', eq(r.counts, { AVAILABLE: 1, CHARGING: 1, RESERVED: 1, BLOCKED: 1, OUTOFORDER: 1, INOPERATIVE: 1, UNKNOWN: 1 }));
  ok('mock: zaman = en yeni EVSE zamanı (sağlayıcı), 5 dk → fresh', r.timestampKind === 'provider' && r.at === Date.parse('2026-11-11T10:05:00Z') && r.staleness === 'fresh');
  ok('mock sağlayıcı canlı akışa bağlı değil', provider('mock').live === false && !providerStatus({}).some((p) => p.id === 'mock'));
}

// --- OCPI (genel, ileride AFIR/CPO)
{
  const loc = fx('ocpi-location.json');
  const all = fromOcpiLocation(loc, { now: NOW });
  ok('OCPI: REMOVED sayılmaz, 3 EVSE, 2 boş', all.total === 3 && all.available === 2 && all.counts.CHARGING === 1 && all.granularity === 'evse');
  ok('OCPI: EVSE zamanı yoksa Location zamanı; en yeni zaman kullanılır', all.evses.find((e) => e.uid === 'E3').at === Date.parse('2026-11-11T09:00:00Z') && all.at === Date.parse('2026-11-11T10:02:00Z'));
  const dc = fromOcpiLocation(loc, { dcOnly: true, now: NOW });
  ok('OCPI: dcOnly yalnızca ≥40 kW', dc.total === 2 && dc.available === 1 && dc.evses.every((e) => e.powerKw === 150));
  ok('OCPI: boş/bozuk girdi → null ya da UNKNOWN', fromOcpiLocation(null) === null && fromOcpiLocation({ evses: [{}] }, { now: NOW })?.counts.UNKNOWN === 1);
}

// --- NDW (yalnızca available/total)
{
  const r = fromNdwAvailabilities([{ available: 1, total: 4 }, { available: 2, total: 2 }], { now: NOW });
  ok('NDW: boş olmayanlar UNKNOWN (dolu denmez), fetched', r.total === 6 && r.available === 3 && r.counts.UNKNOWN === 3 && r.counts.CHARGING === 0 && r.timestampKind === 'fetched');
  ok('NDW: tutarsız sayı (available>total) sınırlanır', fromNdwAvailabilities([{ available: 5, total: 2 }], { now: NOW }).available === 2);
  ok('NDW: boş → null', fromNdwAvailabilities([], { now: NOW }) === null);
}

// --- HERE
const hereItem = {
  position: { lat: 52.1, lng: 5.1 },
  extended: { evAvailability: { stations: [{ evses: [
    { id: 'h1', state: 'AVAILABLE', last_updated: '2026-11-11T10:00:00Z', connectors: [{ maxPowerLevel: 150 }] },
    { id: 'h2', state: 'OCCUPIED', last_updated: '2026-11-11T09:59:00Z', connectors: [{ maxPowerLevel: 150 }] },
    { id: 'h3', state: 'OUT_OF_SERVICE', last_updated: '2026-11-11T09:00:00Z', connectors: [{ maxPowerLevel: 22 }] },
    { id: 'h4', state: 'OTHER', connectors: [{ maxPowerLevel: 22 }] },
  ] }] } },
};
{
  const r = fromHereItem(hereItem, { now: NOW });
  ok('HERE: EVSE bazlı sayılar', r.total === 4 && eq(r.counts, { AVAILABLE: 1, CHARGING: 1, RESERVED: 0, BLOCKED: 0, OUTOFORDER: 1, INOPERATIVE: 0, UNKNOWN: 1 }));
  ok('HERE: sağlayıcı zamanı, 10 dk → fresh', r.timestampKind === 'provider' && r.at === Date.parse('2026-11-11T10:00:00Z') && r.staleness === 'fresh');
  ok('HERE: dcOnly', fromHereItem(hereItem, { dcOnly: true, now: NOW }).total === 2);
}

// --- TomTom
const ttAv = { connectors: [{ availability: { current: { available: 1, occupied: 2, reserved: 1, outOfService: 1, unknown: 1 }, perPowerLevel: [
  { powerKW: 22, available: 0, occupied: 1, reserved: 0, outOfService: 1, unknown: 1 }, { powerKW: 120, available: 1, occupied: 1, reserved: 1, outOfService: 0, unknown: 0 }] } }] };
{
  const r = fromTomTom(ttAv, { now: NOW });
  ok('TomTom: occupied→CHARGING, outOfService→OUTOFORDER, reserved→RESERVED', r.total === 6 && eq(r.counts, { AVAILABLE: 1, CHARGING: 2, RESERVED: 1, BLOCKED: 0, OUTOFORDER: 1, INOPERATIVE: 0, UNKNOWN: 1 }));
  ok('TomTom: zaman yok → fetched', r.timestampKind === 'fetched' && r.at === NOW);
  ok('TomTom: dcOnly yalnızca ≥40 kW seviye', fromTomTom(ttAv, { dcOnly: true, now: NOW }).total === 3);
  ok('TomTom: boş yanıt → null', fromTomTom({}, { now: NOW }) === null);
}

// --- Google
{
  const agg = [{ count: 4, availableCount: 1, outOfServiceCount: 1, maxChargeRateKw: 150, availabilityLastUpdateTime: '2026-11-11T07:00:00Z' }, { count: 2, maxChargeRateKw: 22 }];
  const r = fromGoogleAggregation(agg, { dcOnly: true, now: NOW });
  ok('Google: kalan UNKNOWN, 3 sa → stale', r.total === 4 && r.available === 1 && r.counts.OUTOFORDER === 1 && r.counts.UNKNOWN === 2 && r.staleness === 'stale');
  ok('Google: canlı sayı yoksa null', fromGoogleAggregation([{ count: 2 }], { now: NOW }) === null);
}

// --- sağlayıcı kaydı
ok('kayıt: her sağlayıcının normalize işlevi var', PROVIDERS.every((p) => typeof p.normalize === 'function' && p.id && p.license));
{
  const st = providerStatus({ HERE_API_KEY: 'x' });
  ok('providerStatus: anahtar değeri döndürmez, yalnızca var/yok', st.find((p) => p.id === 'here').configured === true && st.find((p) => p.id === 'tomtom').configured === false && st.find((p) => p.id === 'ndw').configured === true && !JSON.stringify(st).includes('"x"'));
}

// --- mevcut sağlayıcılara entegrasyon (sahte fetch): eski alanlar aynı, `availability` ek alan
const mk = (routes) => async (u) => { const r = routes(new URL(u)); return { ok: true, status: 200, json: async () => r }; };
{
  _clearIds();
  const st = { id: 's1', lat: 41.0, lon: 28.98, dc: true };
  const fetchImpl = mk((u) => (u.pathname.includes('categorySearch') ? { results: [{ position: { lat: 41.0, lon: 28.98 }, dataSources: { chargingAvailability: { id: 'a' } } }] } : ttAv));
  const r = await tomtomLookup(st, KEY, { fetchImpl, now: NOW });
  ok('tomtomLookup: eski alanlar korunur + availability', r.src === 'tomtom' && r.total === 3 && r.available === 1 && r.price === null && r.availability?.source === 'tomtom' && r.availability.total === 3 && r.availability.simulated === false);
}
{
  const r = await hereLookup({ lat: 52.1, lon: 5.1, dc: false }, KEY, { fetchImpl: mk(() => ({ items: [hereItem] })), now: NOW });
  ok('hereLookup: eski alanlar korunur + availability', r?.src === 'here' && r.total === 4 && r.available === 1 && r.availability?.source === 'here' && r.availability.counts.CHARGING === 1);
}
{
  const r = await googleLookup({ lat: 41, lon: 29, dc: true }, KEY, { fetchImpl: mk(() => ({ places: [{ location: { latitude: 41, longitude: 29 }, evChargeOptions: { connectorAggregation: [{ count: 2, availableCount: 2, maxChargeRateKw: 120, availabilityLastUpdateTime: '2026-11-11T10:00:00Z' }] } }] })) });
  ok('googleLookup: eski alanlar korunur + availability', r.src === 'google' && r.total === 2 && r.available === 2 && r.availability?.available === 2);
}
{
  _clearCache();
  const st = { id: 'nl', lat: 52.37, lon: 4.9, dc: false };
  const fetchImpl = async (u) => {
    if (String(u).includes('tariffs')) return { ok: false, status: 503 };
    return { ok: true, status: 200, json: async () => ({ features: [{ geometry: { coordinates: [4.9, 52.37] }, properties: { cpo_id: 'X', availabilities: [{ available: 1, total: 2, power_max: 22000 }] } }] }) };
  };
  const out = await lookupAll([st], { fetchImpl });
  ok('lookupAll (NDW): eski biçim + availability (UNKNOWN ile, dolu denmez)', out.nl?.src === 'ndw' && out.nl.total === 2 && out.nl.available === 1 && out.nl.availability?.counts.UNKNOWN === 1);
}
{
  _clearCache();
  const out = await lookupAll([{ id: 'tr', lat: 39.9, lon: 32.8, dc: true }], {});
  ok('anahtar yoksa: sahte/mock veri ÜRETİLMEZ (null)', out.tr === null);
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
if (fail) process.exit(1);
