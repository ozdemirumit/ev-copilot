// D3-T2: NDW / TomTom bağdaştırıcı çıktısı saf occupancyDecision'a bağlı mı? — çevrimdışı, yalnız sahte (mock) fikstür.
// node scripts/test-occupancy-adapter.mjs
// Kararlar (docs/beta-task-registry.json decisions[D3].sub_decisions): K1 sağlayıcı zaman damgası zorunlu; K4 TomTom (ve NDW) verisi
// ingest edilir (sonuç null değil, eski alanlar ve `availability` korunur) ama zaman damgası yoksa canlı doluluk "Bilinmiyor";
// K2 NDW 0/N doğrulanmamışsa "Bilinmiyor". Ağ yok: tüm istekler sahte fetchImpl'e gider; global fetch çağrılırsa test başarısız olur.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(join(root, p)).href);

// Gerçek ağa çıkış girişimi = başarısızlık (sahte fetchImpl dışında hiçbir şey çağrılmamalı).
let realFetchCalls = 0;
globalThis.fetch = async () => { realFetchCalls++; throw new Error('test: gerçek ağ yasak'); };

const { withOccupancyDecision, buildAvailability } = await imp('server/availability.mjs');
const { tomtomLookup, _clearIds } = await imp('server/tomtom.mjs');
const { ndwLookup, lookupAll, _clearCache, _setTariffs } = await imp('server/occupancy.mjs');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };

const NOW = 1_800_000_000_000;
const MIN = 60e3;
const KEY = 'test-fake-key-not-real';
const UNKNOWN = (d, reason) => d && d.trusted === false && d.state === 'unknown' && (reason === undefined || d.reason === reason);
const deepFreeze = (o) => { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };

// ---------- Sahte TomTom ----------
const ttAvail = (cur) => ({ connectors: [{ type: 'IEC62196Type2CCS', availability: { current: cur, perPowerLevel: [{ powerKW: 150, ...cur }] } }] });
const ttFetch = (cur, calls = []) => async (u) => {
  const url = new URL(u);
  calls.push(url.pathname);
  const body = url.pathname.includes('categorySearch')
    ? { results: [{ position: { lat: 41.0, lon: 28.98 }, dataSources: { chargingAvailability: { id: 'mock-tt-1' } } }] }
    : ttAvail(cur);
  return { ok: true, status: 200, json: async () => body };
};
const ST_TR = { id: 'tr1', lat: 41.0, lon: 28.98, dc: true };

// ---------- 1) TomTom zaman damgasız: veri kabul edilir, canlı doluluk Bilinmiyor (K1 + K4) ----------
{
  _clearIds();
  const calls = [];
  const r = await tomtomLookup(ST_TR, KEY, { fetchImpl: ttFetch({ available: 2, occupied: 1, outOfService: 0, unknown: 0, reserved: 0 }, calls), now: NOW });
  ok('TomTom 2/3: sonuç null değil (ingest)', r !== null && r.src === 'tomtom', JSON.stringify(r));
  ok('TomTom 2/3: eski alanlar aynen (total/available/out/at/price)', r.total === 3 && r.available === 2 && r.out === 0 && r.at === NOW && r.price === null, JSON.stringify(r));
  ok('TomTom 2/3: availability ingest edildi, timestampKind fetched', r.availability?.source === 'tomtom' && r.availability.timestampKind === 'fetched' && r.availability.total === 3);
  ok('TomTom 2/3: decision alanı var', r.decision && typeof r.decision === 'object', JSON.stringify(r));
  ok('TomTom 2/3: canlı doluluk Bilinmiyor (no-timestamp)', UNKNOWN(r.decision, 'no-timestamp'), JSON.stringify(r.decision));
  ok('TomTom 2/3: karar kaynağı TomTom', r.decision.source === 'TomTom', JSON.stringify(r.decision));
  ok('TomTom 2/3: karar dondurulmuş, sayı/yaş taşımaz', Object.isFrozen(r.decision) && r.decision.ageMin === null);
  ok('TomTom: yalnız sahte uç noktalar çağrıldı', calls.length === 2 && calls.every((p) => p.includes('/search/2/')), JSON.stringify(calls));
}
{
  _clearIds();
  const r = await tomtomLookup(ST_TR, KEY, { fetchImpl: ttFetch({ available: 0, occupied: 4, outOfService: 0, unknown: 0, reserved: 0 }), now: NOW });
  ok('TomTom 0/4 hepsi şarjda: veri kabul edilir (eski available 0)', r !== null && r.total === 4 && r.available === 0, JSON.stringify(r));
  ok('TomTom 0/4: "dolu" DEĞİL, Bilinmiyor', UNKNOWN(r.decision, 'no-timestamp') && r.decision.state !== 'busy', JSON.stringify(r.decision));
}
{
  _clearIds();
  const r = await tomtomLookup(ST_TR, KEY, { fetchImpl: ttFetch({ available: 0, occupied: 0, outOfService: 2, unknown: 0, reserved: 0 }), now: NOW });
  ok('TomTom hepsi arızalı: "arızalı" değil, Bilinmiyor', r !== null && UNKNOWN(r.decision, 'no-timestamp'), JSON.stringify(r?.decision));
}
{
  _clearIds();
  // Eski güvenlik kuralı korunur: boş yok + bilinmeyen var → tomtomSlots null → sonuç null (karar üretilmez, istasyon zaten bilinmiyor).
  const r = await tomtomLookup(ST_TR, KEY, { fetchImpl: ttFetch({ available: 0, occupied: 2, outOfService: 0, unknown: 2, reserved: 0 }), now: NOW });
  ok('TomTom belirsiz (0 boş + bilinmeyen): eski davranış null korunur', r === null);
}

// ---------- 2) NDW: zaman damgasız ingest + 0/N Bilinmiyor (K1 + K2) ----------
_setTariffs(new Map()); // tarife dosyası indirilmesin (fiyat kodu değişmedi; yalnız arka plan yüklemesi tetiklenmesin)
const ndwFetch = (avs, calls = []) => async (u) => {
  calls.push(String(u));
  if (String(u).includes('tariffs')) return { ok: false, status: 503 };
  return { ok: true, status: 200, json: async () => ({ features: [{ geometry: { coordinates: [4.9, 52.37] }, properties: { cpo_id: 'MOCK', last_updated: '2026-01-01T00:00:00Z', availabilities: avs } }] }) };
};
const ST_NL = { id: 'nl1', lat: 52.37, lon: 4.9, dc: false };
{
  const calls = [];
  const r = await ndwLookup(ST_NL, { fetchImpl: ndwFetch([{ available: 1, total: 2, power_max: 22000 }], calls) });
  ok('NDW 1/2: sonuç null değil (ingest), eski alanlar', r?.src === 'ndw' && r.total === 2 && r.available === 1 && r.out === null && typeof r.at === 'number', JSON.stringify(r));
  ok('NDW 1/2: availability fetched', r.availability?.source === 'ndw' && r.availability.timestampKind === 'fetched');
  ok('NDW 1/2: canlı doluluk Bilinmiyor (no-timestamp; last_updated tazelik sayılmaz)', UNKNOWN(r.decision, 'no-timestamp') && r.decision.source === 'NDW', JSON.stringify(r.decision));
  ok('NDW 1/2: fiyat alanı karar tarafından değiştirilmedi (tarife yok → null)', r.price === null);
  ok('NDW: yalnız sahte uç nokta', calls.length === 1 && calls[0].includes('bbox='), JSON.stringify(calls));
}
{
  const r = await ndwLookup(ST_NL, { fetchImpl: ndwFetch([{ available: 0, total: 4, power_max: 22000 }]) });
  ok('NDW 0/4: veri kabul edilir (eski available 0)', r?.total === 4 && r.available === 0, JSON.stringify(r));
  ok('NDW 0/4: "dolu" DEĞİL, Bilinmiyor', UNKNOWN(r.decision) && r.decision.state !== 'busy', JSON.stringify(r.decision));
}

// ---------- 3) lookupAll yolu: karar sonuçla birlikte taşınır, topluluk birleşmesi kararı bozmaz ----------
{
  _clearCache();
  const out = await lookupAll([ST_NL], { fetchImpl: ndwFetch([{ available: 0, total: 3, power_max: 22000 }]) });
  ok('lookupAll NDW 0/3: decision taşınır ve Bilinmiyor', UNKNOWN(out.nl1?.decision), JSON.stringify(out.nl1));
  _clearCache();
  const community = { summary: () => ({ charging: 1, report: 'free', at: NOW - MIN }) };
  const out2 = await lookupAll([ST_NL], { fetchImpl: ndwFetch([{ available: 2, total: 2, power_max: 22000 }]), community });
  ok('lookupAll + topluluk: topluluk resmî kararı güvenilir yapmaz', out2.nl1?.community && UNKNOWN(out2.nl1.decision, 'no-timestamp'), JSON.stringify(out2.nl1));
  _clearCache();
  const out3 = await lookupAll([{ id: 'tr0', lat: 39.9, lon: 32.8, dc: true }], {});
  ok('anahtar yoksa sonuç null (sahte veri/karar üretilmez)', out3.tr0 === null);
}

// ---------- 4) withOccupancyDecision saf yardımcı ----------
{
  ok('null → null', withOccupancyDecision(null, NOW) === null);
  const noAv = deepFreeze({ src: 'community', total: null, available: null, at: null, price: null });
  const d0 = withOccupancyDecision(noAv, NOW);
  ok('availability yok → decision unknown/no-data, alanlar korunur', UNKNOWN(d0.decision, 'no-data') && d0.src === 'community' && d0.price === null, JSON.stringify(d0));
  const inp = deepFreeze({ src: 'tomtom', total: 1, available: 1, out: 0, at: NOW, price: null, availability: buildAvailability({ source: 'tomtom', counts: { AVAILABLE: 1 }, fetchedAt: NOW, now: NOW }) });
  const before = JSON.stringify(inp);
  const a = withOccupancyDecision(inp, NOW), b = withOccupancyDecision(inp, NOW);
  ok('girdi değişmez (dondurulmuş girdiyle hata yok), yeni nesne', JSON.stringify(inp) === before && a !== inp);
  ok('belirlenimci', JSON.stringify(a) === JSON.stringify(b));
  ok('now yoksa unknown/no-now (saat okunmaz)', UNKNOWN(withOccupancyDecision(inp, undefined).decision, 'no-now'));
  // Kural kaynağa değil zaman damgasına bağlıdır: TomTom ileride sağlayıcı zamanı verirse K1 sağlanır.
  const prov = deepFreeze({ src: 'tomtom', availability: buildAvailability({ source: 'tomtom', counts: { AVAILABLE: 1, CHARGING: 1 }, at: NOW - 2 * MIN, fetchedAt: NOW, now: NOW }) });
  const dp = withOccupancyDecision(prov, NOW).decision;
  ok('TomTom sağlayıcı zamanlı taze (varsayımsal) → trusted free', dp.trusted === true && dp.state === 'free', JSON.stringify(dp));
  const old = deepFreeze({ src: 'tomtom', availability: buildAvailability({ source: 'tomtom', counts: { AVAILABLE: 1 }, at: NOW - 16 * MIN, fetchedAt: NOW, now: NOW }) });
  ok('TomTom sağlayıcı zamanlı 16 dk → unknown/aged', UNKNOWN(withOccupancyDecision(old, NOW).decision, 'aged'));
  const nz = deepFreeze({ src: 'ndw', availability: buildAvailability({ source: 'ndw', counts: { CHARGING: 4 }, at: NOW - MIN, fetchedAt: NOW, now: NOW }) });
  ok('NDW sağlayıcı zamanlı 0/4 → unknown/ndw-zero-unverified', UNKNOWN(withOccupancyDecision(nz, NOW).decision, 'ndw-zero-unverified'));
  const mock = deepFreeze({ src: 'mock', availability: buildAvailability({ source: 'mock', counts: { AVAILABLE: 1 }, at: NOW - MIN, fetchedAt: NOW, now: NOW, simulated: true }) });
  ok('mock (simulated) → unknown', UNKNOWN(withOccupancyDecision(mock, NOW).decision, 'simulated'));
  ok('karar çıktısında anahtar/ham kimlik yok', !JSON.stringify(a.decision).includes(KEY) && !/mock-tt-1/.test(JSON.stringify(a.decision)));
}

// ---------- 5) Bağlantı kapsamı (statik): yalnız sunucu bağdaştırıcıları; istemci/UI/sw.js/fiyat bağlı değil ----------
{
  const strip = (s) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const avSrc = strip(readFileSync(join(root, 'server/availability.mjs'), 'utf8'));
  const avImports = [...avSrc.matchAll(/import\s[^;]*?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  ok('availability.mjs yalnız saf occupancyDecision içe aktarır', JSON.stringify(avImports) === JSON.stringify(['../js/routing/occupancyDecision.js']), JSON.stringify(avImports));
  const occ = strip(readFileSync(join(root, 'server/occupancy.mjs'), 'utf8'));
  const tt = strip(readFileSync(join(root, 'server/tomtom.mjs'), 'utf8'));
  ok('ndwLookup kararı bağlar', /withOccupancyDecision\(/.test(occ.slice(occ.indexOf('export async function ndwLookup'), occ.indexOf('export async function googleLookup'))));
  ok('tomtomLookup kararı bağlar', /withOccupancyDecision\(/.test(tt.slice(tt.indexOf('export async function tomtomLookup'), tt.indexOf('export const _clearIds'))));
  const walk = (dir) => readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name).replace(/\\/g, '/')]);
  const clientUsers = [...walk('js'), 'sw.js', 'index.html']
    .filter((f) => /\.(m?js|html)$/.test(f) && f !== 'js/routing/occupancyDecision.js')
    .filter((f) => /occupancyDecision|withOccupancyDecision/.test(readFileSync(join(root, f), 'utf8')));
  ok('istemci tarafında karar yalnız js/routing/slots.js (D3-T4 arayüz) + sw.js SHELL; index.html bağlı değil', JSON.stringify(clientUsers) === JSON.stringify(['js/routing/slots.js', 'sw.js']), JSON.stringify(clientUsers));
}

ok('gerçek fetch hiç çağrılmadı', realFetchCalls === 0, String(realFetchCalls));
console.log(`test-occupancy-adapter: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
