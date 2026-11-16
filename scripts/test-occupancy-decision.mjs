// D3-T1: js/routing/occupancyDecision.js saf doluluk karar modülü — çevrimdışı, yalnız sentetik veri. node scripts/test-occupancy-decision.mjs
// Kararlar (docs/beta-task-registry.json decisions[D3].sub_decisions): K1 sağlayıcı zaman damgası zorunlu; K2 NDW 0/N doğrulanmamışsa
// Bilinmiyor; K4 ingest edilen (fetched) veri doğrulanmış canlı doluluk değildir; AGE 15 dakikadan eski → Bilinmiyor.
// Fikstürler server/availability.mjs saf yardımcılarıyla `now` parametresi verilerek üretilir: ağ yok, sunucu yok, anahtar yok, Date.now yok.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOD = 'js/routing/occupancyDecision.js';
const { occupancyDecision, OCC_DECISION_MAX_AGE_MS } = await import(pathToFileURL(join(root, MOD)).href);
const { buildAvailability, fromNdwAvailabilities, fromTomTom, fromGoogleAggregation, fromHereItem } =
  await import(pathToFileURL(join(root, 'server/availability.mjs')).href);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };

const NOW = 1_800_000_000_000;
const MIN = 60e3;
const deepFreeze = (o) => { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
const av = (o) => deepFreeze(buildAvailability({ fetchedAt: NOW, now: NOW, ...o }));
// Karar fonksiyonu çağrılırken saat okunursa yakala (saflık: now yalnız parametreden).
const realNow = Date.now;
const dec = (input, ...rest) => {
  const now = rest.length ? rest[0] : NOW; // açıkça verilen undefined korunur
  let clockRead = false;
  Date.now = () => { clockRead = true; return realNow(); };
  try { const d = occupancyDecision(input, { now }); if (clockRead) { fail++; console.log('FAIL Date.now okundu'); } return d; }
  finally { Date.now = realNow; }
};
const UNKNOWN = (d) => d && d.trusted === false && d.state === 'unknown';
const TRUSTED = (d, state) => d && d.trusted === true && d.state === state && d.reason === null;

// ---------- 0) Dışa aktarım ve eşik ----------
ok('eşik 15 dk', OCC_DECISION_MAX_AGE_MS === 15 * MIN);
ok('occupancyDecision fonksiyon', typeof occupancyDecision === 'function');

// ---------- 1) Taze, sağlayıcı zamanlı → güvenilir, durum aynen (A6) ----------
{
  const d = dec(av({ source: 'google', counts: { AVAILABLE: 2, CHARGING: 1 }, at: NOW - 3 * MIN }));
  ok('Google taze 2/3 → trusted free', TRUSTED(d, 'free'), JSON.stringify(d));
  ok('yaş 3 dk, kaynak Google', d.ageMin === 3 && d.source === 'Google', JSON.stringify(d));
  ok('çıktı dondurulmuş', Object.isFrozen(d));
}
ok('Google taze hepsi şarjda → trusted busy', TRUSTED(dec(av({ source: 'google', counts: { CHARGING: 3, RESERVED: 1 }, at: NOW - 1 * MIN })), 'busy'));
ok('Google taze hepsi arızalı → trusted out', TRUSTED(dec(av({ source: 'google', counts: { OUTOFORDER: 1, INOPERATIVE: 1 }, at: NOW - 1 * MIN })), 'out'));
ok('HERE EVSE zamanlı taze → trusted free', TRUSTED(dec(av({ source: 'here', evses: [{ status: 'AVAILABLE', at: NOW - 2 * MIN }, { status: 'CHARGING', at: NOW - 4 * MIN }] })), 'free'));
ok('OCPI taze → trusted busy', TRUSTED(dec(av({ source: 'ocpi', counts: { CHARGING: 2 }, at: NOW - 5 * MIN })), 'busy'));
{
  // Gerçek dönüştürücülerden (sentetik giriş, now parametresiyle) üretilen sağlayıcı zamanlı kayıtlar.
  const g = deepFreeze(fromGoogleAggregation([{ count: 4, availableCount: 1, outOfServiceCount: 0, maxChargeRateKw: 150, availabilityLastUpdateTime: new Date(NOW - 2 * MIN).toISOString() }], { now: NOW }));
  const dg = dec(g);
  ok('fromGoogleAggregation 1/4 taze → trusted free', TRUSTED(dg, 'free'), JSON.stringify({ g, dg }));
  const h = deepFreeze(fromHereItem({ extended: { evAvailability: { stations: [{ evses: [{ id: 'e1', state: 'AVAILABLE', last_updated: new Date(NOW - 1 * MIN).toISOString(), connectors: [{ maxPowerLevel: 150 }] }] }] } } }, { now: NOW }));
  ok('fromHereItem taze → trusted free', TRUSTED(dec(h), 'free'), JSON.stringify(dec(h)));
}

// ---------- 2) AGE: 15 dakikadan eski → Bilinmiyor ----------
ok('tam 15 dk → hâlâ güvenilir (sınır dahil)', TRUSTED(dec(av({ source: 'google', counts: { AVAILABLE: 1 }, at: NOW - 15 * MIN })), 'free'));
{
  const d = dec(av({ source: 'google', counts: { AVAILABLE: 1 }, at: NOW - 15 * MIN - 1 }));
  ok('15 dk + 1 ms → unknown', UNKNOWN(d), JSON.stringify(d));
  ok('15 dk + 1 ms → reason aged', d.reason === 'aged', JSON.stringify(d));
}
for (const m of [16, 30, 90, 119]) ok(`${m} dk (biçimlendiricide "aging") → unknown/aged`, (() => { const d = dec(av({ source: 'google', counts: { CHARGING: 2 }, at: NOW - m * MIN })); return UNKNOWN(d) && d.reason === 'aged'; })());
{
  const d = dec(av({ source: 'here', counts: { AVAILABLE: 3 }, at: NOW - 3 * 60 * MIN }));
  ok('3 sa eski → unknown', UNKNOWN(d) && d.reason === 'stale', JSON.stringify(d));
}
{
  // Aynı kayıt zaman ilerledikçe Bilinmiyor'a düşer (now parametresi tek saat kaynağı).
  const rec = av({ source: 'google', counts: { AVAILABLE: 1 }, at: NOW });
  ok('aynı kayıt now=+10 dk → trusted', TRUSTED(dec(rec, NOW + 10 * MIN), 'free'));
  ok('aynı kayıt now=+16 dk → unknown', UNKNOWN(dec(rec, NOW + 16 * MIN)));
}
// "checked" (okuma anı) tek başına tazelik sayılmaz (A1): slots.checked yeni olsa da sağlayıcı zamanı eski.
{
  const slots = deepFreeze({ checked: NOW, free: 2, total: 4, availability: av({ source: 'google', counts: { AVAILABLE: 2, CHARGING: 2 }, at: NOW - 40 * MIN }) });
  ok('checked taze ama availability 40 dk → unknown', UNKNOWN(dec(slots)), JSON.stringify(dec(slots)));
  const slots2 = deepFreeze({ checked: NOW, free: 2, total: 4, availability: av({ source: 'google', counts: { AVAILABLE: 2, CHARGING: 2 }, at: NOW - 2 * MIN }) });
  ok('slots sarmalı taze availability → trusted free', TRUSTED(dec(slots2), 'free'));
}

// ---------- 3) K1: zaman damgası zorunlu ----------
{
  const noAt = deepFreeze({ source: 'google', timestampKind: 'provider', simulated: false, counts: { AVAILABLE: 1 }, total: 1, available: 1 });
  const d = dec(noAt);
  ok('provider ama at yok → unknown', UNKNOWN(d) && d.reason === 'no-timestamp', JSON.stringify(d));
  for (const bad of [null, NaN, Infinity, '1800000000000', new Date(NOW).toISOString()]) {
    ok(`at=${String(bad)} → unknown/no-timestamp`, (() => { const x = dec(deepFreeze({ ...noAt, at: bad })); return UNKNOWN(x) && x.reason === 'no-timestamp'; })());
  }
  const fetched = deepFreeze({ source: 'google', timestampKind: 'fetched', simulated: false, counts: { AVAILABLE: 1 }, total: 1, available: 1, at: NOW });
  ok('timestampKind fetched (at = okuma anı) → unknown/no-timestamp', (() => { const x = dec(fetched); return UNKNOWN(x) && x.reason === 'no-timestamp'; })());
  const kindMissing = deepFreeze({ source: 'google', simulated: false, counts: { AVAILABLE: 1 }, at: NOW });
  ok('timestampKind yok → unknown', UNKNOWN(dec(kindMissing)));
  ok('5 dk gelecekte → unknown/no-timestamp', (() => { const x = dec(av({ source: 'google', counts: { AVAILABLE: 1 }, at: NOW + 5 * MIN })); return UNKNOWN(x) && x.reason === 'no-timestamp'; })());
}
// now yok/geçersiz → saat okunmaz, Bilinmiyor.
for (const badNow of [undefined, null, NaN, '1800000000000']) {
  const d = dec(av({ source: 'google', counts: { AVAILABLE: 1 }, at: NOW - MIN }), badNow);
  ok(`now=${String(badNow)} → unknown/no-now`, UNKNOWN(d) && d.reason === 'no-now', JSON.stringify(d));
}
{
  let clockRead = false; Date.now = () => { clockRead = true; return realNow(); };
  let d; try { d = occupancyDecision(av({ source: 'google', counts: { AVAILABLE: 1 }, at: NOW - MIN })); } finally { Date.now = realNow; }
  ok('seçenek nesnesi hiç yok → unknown, saat okunmaz', UNKNOWN(d) && d.reason === 'no-now' && !clockRead);
}

// ---------- 4) K4: ingest (fetched) ≠ doğrulanmış canlı doluluk ----------
{
  const tt = deepFreeze(fromTomTom({ connectors: [{ availability: { current: { available: 2, occupied: 1, reserved: 0, unknown: 0, outOfService: 0 }, perPowerLevel: [] } }] }, { now: NOW }));
  ok('fromTomTom kaydı ingest edildi (null değil, fetched)', tt && tt.timestampKind === 'fetched' && tt.source === 'tomtom', JSON.stringify(tt));
  const d = dec(tt);
  ok('TomTom fetched 2/3 boş, okuma anı = now → unknown', UNKNOWN(d) && d.reason === 'no-timestamp', JSON.stringify(d));
  const busy = deepFreeze(fromTomTom({ connectors: [{ availability: { current: { available: 0, occupied: 3 } } }] }, { now: NOW }));
  ok('TomTom fetched hepsi dolu → unknown (dolu gösterilmez)', UNKNOWN(dec(busy)));
}

// ---------- 5) K2: NDW 0/N doğrulanmamışsa Bilinmiyor ----------
{
  const z = deepFreeze(fromNdwAvailabilities([{ available: 0, total: 4 }], { now: NOW }));
  ok('fromNdwAvailabilities 0/4 ingest edildi', z && z.source === 'ndw', JSON.stringify(z));
  ok('NDW 0/4 (fetched) → unknown', UNKNOWN(dec(z)), JSON.stringify(dec(z)));
  const two = deepFreeze(fromNdwAvailabilities([{ available: 2, total: 4 }], { now: NOW }));
  ok('NDW 2/4 (fetched) → unknown', UNKNOWN(dec(two)), JSON.stringify(dec(two)));
  // Gelecekte bir bağdaştırıcı NDW'ye sağlayıcı zamanı verse bile 0/N "dolu" kanıtı değildir (ayrıntısız sayı).
  const zProv = av({ source: 'ndw', counts: { CHARGING: 4 }, at: NOW - MIN });
  const dz = dec(zProv);
  ok('NDW sağlayıcı zamanlı 0/4 (CHARGING) → unknown/ndw-zero-unverified', UNKNOWN(dz) && dz.reason === 'ndw-zero-unverified', JSON.stringify(dz));
  const zOut = av({ source: 'ndw', counts: { OUTOFORDER: 2 }, at: NOW - MIN });
  ok('NDW sağlayıcı zamanlı 0/2 arızalı → unknown', UNKNOWN(dec(zOut)));
  const pProv = av({ source: 'ndw', counts: { AVAILABLE: 1, UNKNOWN: 3 }, at: NOW - MIN });
  ok('NDW sağlayıcı zamanlı 1/4 boş → trusted free (yalnız 0/N kısıtlı)', TRUSTED(dec(pProv), 'free'), JSON.stringify(dec(pProv)));
}

// ---------- 6) Veri yok / bozuk / simüle / bilinmeyen kaynak → Bilinmiyor (A7) ----------
for (const [name, input] of [
  ['null', null], ['undefined', undefined], ['dizi', []], ['sayı', 3],
  ['availability alanı olmayan slots (eski sunucu)', { checked: NOW, free: 2, total: 4 }],
  ['topluluk "Dolu bildirildi" (availability yok)', { checked: NOW, reportedFull: NOW }],
]) {
  const d = dec(input);
  ok(`${name} → unknown/no-data`, UNKNOWN(d) && d.reason === 'no-data', JSON.stringify(d));
}
ok('mock (simulated) → unknown', (() => { const d = dec(av({ source: 'mock', counts: { AVAILABLE: 1 }, at: NOW - MIN, simulated: true })); return UNKNOWN(d) && d.reason === 'simulated'; })());
ok('bilinmeyen kaynak → unknown', (() => { const d = dec(av({ source: 'acme', counts: { AVAILABLE: 1 }, at: NOW - MIN })); return UNKNOWN(d) && d.reason === 'unknown-source'; })());
ok('tutarsız sayılar → unknown', UNKNOWN(dec(deepFreeze({ source: 'google', timestampKind: 'provider', simulated: false, at: NOW - MIN, counts: { AVAILABLE: 1 }, total: 5 }))));
ok('UNKNOWN EVSE varken boş yok → unknown (dolu değil)', UNKNOWN(dec(av({ source: 'google', counts: { CHARGING: 2, UNKNOWN: 1 }, at: NOW - MIN }))));

// ---------- 7) Çıktı biçimi ve saflık ----------
{
  const keys = ['trusted', 'state', 'reason', 'source', 'ageMin'];
  const samples = [dec(null), dec(av({ source: 'google', counts: { AVAILABLE: 1 }, at: NOW - MIN })), dec(av({ source: 'google', counts: { AVAILABLE: 1 }, at: NOW - 40 * MIN }))];
  ok('çıktı alanları sabit', samples.every((d) => JSON.stringify(Object.keys(d).sort()) === JSON.stringify([...keys].sort())), JSON.stringify(samples));
  ok('güvenilmeyen çıktıda sayı/yaş taşınmaz', samples.filter((d) => !d.trusted).every((d) => d.ageMin === null && d.state === 'unknown'));
  ok('state yalnız free/busy/out/unknown', samples.every((d) => ['free', 'busy', 'out', 'unknown'].includes(d.state)));
  const input = av({ source: 'google', counts: { AVAILABLE: 1 }, at: NOW - MIN });
  const a = JSON.stringify(dec(input)), b = JSON.stringify(dec(input));
  ok('deterministik (aynı girdi + now → aynı çıktı)', a === b);
}
{
  const src = readFileSync(join(root, MOD), 'utf8');
  const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  ok('modül saat okumaz (Date.now / new Date yok)', !/Date\.now|new Date\b|performance\.now/.test(code));
  ok('modül ağ/DOM/depolama kullanmaz', !/\bfetch\b|XMLHttpRequest|WebSocket|document\.|window\.|localStorage|sessionStorage|navigator\./.test(code));
  const imports = [...code.matchAll(/import\s[^;]*?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  ok('yalnız occupancyLabel.js içe aktarılır', JSON.stringify(imports) === JSON.stringify(['./occupancyLabel.js']), JSON.stringify(imports));
}
// Bağlı DEĞİL (D3-T1 kapsamı: UI/adapter'a dokunulmaz): hiçbir çalışma zamanı dosyası ve sw.js içe aktarmaz.
{
  const walk = (dir) => readdirSync(join(root, dir), { withFileTypes: true }).filter((e) => !['data', 'node_modules'].includes(e.name)).flatMap((e) => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
  const users = [...walk('js'), ...walk('server'), 'sw.js', 'index.html']
    .filter((f) => /\.(m?js|html)$/.test(f) && !f.replace(/\\/g, '/').endsWith(MOD))
    .filter((f) => readFileSync(join(root, f), 'utf8').includes('occupancyDecision'));
  ok('çalışma zamanında çağıran yok (bağlı değil)', users.length === 0, JSON.stringify(users));
}

console.log(`test-occupancy-decision: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
