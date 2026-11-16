// D3-T5: doluluk TÜKETİCİ hizalaması — çevrimdışı regresyon testi (ağ yok, anahtar yok, sağlayıcı çağrısı yok; sentetik fikstür).
// node scripts/test-occupancy-consumers.mjs
//
// Kural (D3 K1/K2/K3/K4/AGE): rota planlayıcı, düşük pil önerisi (chargePick), yakın istasyon sıralaması (nearSort/nearby) ve
// sesli uyarı (livePlan) doluluğu YALNIZ doğrulanmış resmî veriyle "müsait/dolu/arızalı" sayar (saf occupancyDecision trusted
// + sunucu kararı vetosu yok). Zaman damgasız (eski biçim, NDW/TomTom 'fetched'), 15 dk'dan eski, NDW 0/N, simüle, sunucunun
// güvenilmez dediği ve topluluk bildirimi → 'unknown' (ne müsait ne dolu). Topluluk bildirimi ayrı kalır (yalnız gösterim).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(join(root, p)).href);
const read = (p) => readFileSync(join(root, p), 'utf8');
const stored = new Map(); // config.js (planlayıcı) localStorage okur; sahte, boş
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)), removeItem: (k) => stored.delete(k) };

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };

const { slotKind, isFresh } = await imp('js/routing/slots.js');
const { availability: nearAvail, sortNearby } = await imp('js/nav/nearSort.js');
const { planRoute, usable } = await imp('js/routing/planner.js');
const { stopRisks } = await imp('js/routing/routeOptions.js');
const { pickEmergency } = await imp('js/nav/chargePick.js');
const { buildAvailability, fromNdwAvailabilities, fromTomTom } = await imp('server/availability.mjs');

const NOW = Date.now();
const MIN = 60e3;
// Sunucu → istemci eşlemesi (occupancyClient.js) biçimi.
const slots = (src, av, extra = {}) => ({ total: av?.total ?? null, available: av?.available ?? null, out: av?.counts?.OUTOFORDER ?? 0, at: av?.at ?? null, checked: NOW, src, price: null, community: null, availability: av, decision: null, ...extra });
const prov = (counts, agoMin, source = 'here') => buildAvailability({ source, counts, at: NOW - agoMin * MIN, fetchedAt: NOW, now: NOW });

const F = {
  free: slots('here', prov({ AVAILABLE: 3, CHARGING: 1 }, 2)),
  full: slots('here', prov({ CHARGING: 4 }, 2)),
  out: slots('here', prov({ OUTOFORDER: 4 }, 2)),
  at15free: slots('here', prov({ AVAILABLE: 3, CHARGING: 1 }, 15)),
  at15full: slots('here', prov({ CHARGING: 4 }, 15)),
  // Güvenilmez: hepsi 'unknown' olmalı
  legacyFull: { total: 4, available: 0, out: 0, at: NOW, checked: NOW, src: 'ocpi' }, // eski biçim: availability yok → zaman damgası yok
  legacyFree: { total: 4, available: 3, out: 0, at: NOW, checked: NOW, src: 'ocpi' },
  legacyOut: { total: 4, available: 0, out: 4, at: NOW, checked: NOW, src: 'ocpi' },
  noTsFull: slots('here', buildAvailability({ source: 'here', counts: { CHARGING: 4 }, at: null, fetchedAt: NOW, now: NOW })),
  noTsFree: slots('here', buildAvailability({ source: 'here', counts: { AVAILABLE: 4 }, at: null, fetchedAt: NOW, now: NOW })),
  ndw0: slots('ndw', fromNdwAvailabilities([{ available: 0, total: 4, power_max: 150000 }], { now: NOW }), { available: 0, total: 4 }),
  ndw2: slots('ndw', fromNdwAvailabilities([{ available: 2, total: 4, power_max: 150000 }], { now: NOW }), { available: 2, total: 4 }),
  ndw0prov: slots('ndw', { ...fromNdwAvailabilities([{ available: 0, total: 4, power_max: 150000 }], { now: NOW }), timestampKind: 'provider', at: NOW - MIN }, { available: 0, total: 4 }),
  stale16full: slots('here', prov({ CHARGING: 4 }, 16)),
  stale16free: slots('here', prov({ AVAILABLE: 4 }, 16)),
  stale16out: slots('here', prov({ OUTOFORDER: 4 }, 16)),
  stale3hFull: { ...slots('here', prov({ CHARGING: 4 }, 180)), checked: NOW - 180 * MIN },
  simFull: slots('here', { ...prov({ CHARGING: 4 }, 2), simulated: true }),
  vetoFull: slots('here', prov({ CHARGING: 4 }, 2), { decision: { trusted: false, state: 'unknown', reason: 'stale' } }),
  vetoBad: slots('here', prov({ CHARGING: 4 }, 2), { decision: 'yes' }),
  commFull: { total: null, available: null, out: null, at: null, checked: NOW, src: 'community', availability: null, community: { busy: 3, report: { status: 'full', at: NOW - MIN } } },
  commFree: { total: null, available: null, out: null, at: null, checked: NOW, src: 'community', availability: null, community: { busy: 0, report: { status: 'free', at: NOW - MIN } } },
  commAsOfficial: slots('community', { ...prov({ CHARGING: 4 }, 2), source: 'community' }),
};
try { F.ttFull = slots('tomtom', fromTomTom({ connectors: [{ type: 'IEC62196Type2CCS', total: 4, availability: { current: { available: 0, occupied: 4, reserved: 0, unknown: 0, outOfService: 0 } } }] }, { now: NOW })); } catch { F.ttFull = null; }
const UNTRUSTED = ['legacyFull', 'legacyFree', 'legacyOut', 'noTsFull', 'noTsFree', 'ndw0', 'ndw2', 'ndw0prov', 'stale16full', 'stale16free', 'stale16out', 'stale3hFull', 'simFull', 'vetoFull', 'vetoBad', 'commFull', 'commFree', 'commAsOfficial', ...(F.ttFull ? ['ttFull'] : [])];
const S = (id, sl, extra = {}) => ({ id, name: id, slots: sl, ...extra });

// ---------- 0) Fikstür ön koşulları ----------
ok('fikstür: sağlayıcı zamanlı taze', F.free.availability?.timestampKind === 'provider' && F.full.availability?.timestampKind === 'provider');
ok('fikstür: NDW fetched', F.ndw0.availability?.timestampKind === 'fetched');
ok('fikstür: TomTom fetched (varsa)', !F.ttFull || F.ttFull.availability?.timestampKind === 'fetched', JSON.stringify(F.ttFull?.availability));

// ---------- 1) slotKind / isFresh: tek karar noktası ----------
ok("slotKind: doğrulanmış taze boş → 'free'", slotKind(S('a', F.free)) === 'free');
ok("slotKind: doğrulanmış taze dolu → 'full'", slotKind(S('a', F.full)) === 'full');
ok("slotKind: doğrulanmış taze arızalı → 'out'", slotKind(S('a', F.out)) === 'out');
ok("slotKind: tam 15 dk → güncel (free/full)", slotKind(S('a', F.at15free), NOW) === 'free' && slotKind(S('a', F.at15full), NOW) === 'full');
ok('isFresh: doğrulanmış taze → true', isFresh(S('a', F.free)) && isFresh(S('a', F.full)) && isFresh(S('a', F.out)) && isFresh(S('a', F.at15full), NOW));
for (const k of UNTRUSTED) {
  ok(`slotKind(${k}) → 'unknown'`, slotKind(S(k, F[k])) === 'unknown', slotKind(S(k, F[k])));
  ok(`isFresh(${k}) → false`, isFresh(S(k, F[k])) === false);
}
ok("slotKind: veri yok → 'unknown', isFresh false", slotKind(S('n', null)) === 'unknown' && !isFresh(S('n', null)) && slotKind({}) === 'unknown' && !isFresh({}));
ok('slotKind/isFresh: now parametresi (16 dk sonra aynı kayıt bayat)', slotKind(S('a', F.full), NOW + 15 * MIN) === 'unknown' && !isFresh(S('a', F.full), NOW + 15 * MIN));

// ---------- 2) Rota planlayıcı ----------
{
  const KWH_PER_KM = 0.25;
  const profile = { totalKm: 400, energyBetween: (a, b, k = 1) => Math.max(0, b - a) * KWH_PER_KM * k, timeBetween: (a, b) => Math.max(0, b - a) / 100 };
  const st = (id, km, sl = null) => ({ id, name: id, km, lat: 40 + km * 1e-4, lon: 30, kw: 180, price: 14, opId: 'x', opName: 'X', slow: false, uncertain: false, offKm: 0.2, slots: sl });
  const base = { profile, startKm: 0, startSoc: 50, minArrival: 15, mode: 'fast', k: 1 };
  const mk = () => [st('a100', 100), st('b104', 104), st('c250', 250), st('d254', 254)];
  const plan0 = planRoute({ ...base, stations: mk() });
  const first = plan0.stops?.[0]?.station;
  ok('planlayıcı fikstürü: ilk durak var', plan0.feasible && !!first, JSON.stringify(plan0.stops?.map((s) => s.station.id)));
  const ids0 = plan0.stops.map((s) => s.station.id).join();
  const planWith = (sl) => planRoute({ ...base, stations: mk().map((s) => (s.id === first.id ? { ...s, slots: sl } : s)) });
  const sameAsNoData = (k) => { const p = planWith(F[k]); return p.feasible && p.stops.map((s) => s.station.id).join() === ids0 && p.stops.every((s, i) => s.waitMin === plan0.stops[i].waitMin); };
  for (const k of UNTRUSTED) ok(`planRoute: ${k} ilk durak → veri yokmuş gibi (çıkarılmaz, bekleme yok)`, sameAsNoData(k), planWith(F[k]).stops?.map((s) => `${s.station.id}/${s.waitMin}`).join());
  for (const k of UNTRUSTED) ok(`usable(${k}) → true (arızalı sayılmaz)`, usable({ ...st('u', 10), slots: F[k] }) === true);
  // İşlev korunur: doğrulanmış dolu/arızalı hâlâ etkiler
  const pFull = planWith(F.full);
  const idsF = pFull.stops.map((s) => s.station.id);
  ok('planRoute: doğrulanmış taze dolu ilk durak → çıkarılır ya da bekleme eklenir', !idsF.includes(first.id) || pFull.stops.some((s) => s.station.id === first.id && s.waitMin > 0), idsF.join());
  ok('usable: doğrulanmış taze arızalı → false', usable({ ...st('u', 10), slots: F.out }) === false);
  ok('usable: doğrulanmış taze dolu → true (yalnız arızalı aday dışı)', usable({ ...st('u', 10), slots: F.full }) === true);
}

// ---------- 3) Rota seçenekleri risk etiketi ----------
for (const k of UNTRUSTED) ok(`stopRisks(${k}) "dolu"/"arızalı" demez`, !stopRisks(S(k, F[k])).some((r) => r === 'dolu' || r === 'arızalı'), stopRisks(S(k, F[k])).join());
ok('stopRisks: doğrulanmış dolu → "dolu", arızalı → "arızalı"', stopRisks(S('a', F.full)).includes('dolu') && stopRisks(S('a', F.out)).includes('arızalı'));

// ---------- 4) Düşük pil önerisi (chargePick.pickEmergency) ----------
{
  const fast = (id, sl, rank) => ({ id, name: id, kw: 180, srcKw: 180, reachable: true, arrive: 40, distKm: rank, price: 10 + rank, slots: sl });
  for (const k of UNTRUSTED) {
    const r = pickEmergency([fast('x', F[k], 1)]);
    ok(`pickEmergency: ${k} aday dışı bırakılmaz (dolu sayılmaz)`, r.station?.id === 'x', JSON.stringify({ kind: r.kind, id: r.station?.id }));
  }
  ok('pickEmergency: doğrulanmış dolu/arızalı aday dışı', pickEmergency([fast('f', F.full, 1), fast('o', F.out, 2), fast('g', F.free, 3)]).fast.map((s) => s.id).join() === 'g');
}

// ---------- 5) Yakın istasyon sıralaması (nearSort) ----------
for (const k of UNTRUSTED) {
  const a = nearAvail(S(k, F[k]), NOW);
  ok(`nearSort.availability(${k}) ne 'free' ne 'full'/'out'`, a === 'unknown' || a === 'stale', a);
}
ok("nearSort.availability: doğrulanmış → free/full/out", nearAvail(S('a', F.free), NOW) === 'free' && nearAvail(S('a', F.full), NOW) === 'full' && nearAvail(S('a', F.out), NOW) === 'out');
{
  const list = [S('ndw0', F.ndw0, { distKm: 1 }), S('comm', F.commFull, { distKm: 1.5 }), S('stale', F.stale16full, { distKm: 2 }), S('noTs', F.noTsFull, { distKm: 2.5 }), S('none', null, { distKm: 5 }), S('vfull', F.full, { distKm: 0.5 })];
  const r = sortNearby(list, 'near', NOW);
  ok('sortNearby: güvenilmez kayıtlar mesafe sırasında; yalnız doğrulanmış dolu sona', r.list.map((x) => x.id).join() === 'ndw0,comm,stale,noTs,none,vfull' && r.unusable === 1, r.list.map((x) => x.id).join() + ' unusable=' + r.unusable);
}

// ---------- 6) Kaynak denetimi: tüketiciler tek karar noktasını kullanır; sesli uyarı ve nearby ----------
{
  const sl = read('js/routing/slots.js'), lp = read('js/routing/livePlan.js'), nb = read('js/nav/nearby.js'), ns = read('js/nav/nearSort.js');
  const body = (n) => { const i = sl.search(new RegExp(`export (const|function) ${n}\\b`)); const j = sl.indexOf('\nexport ', i + 1); return i < 0 ? '' : sl.slice(i, j < 0 ? undefined : j); };
  ok('slots.js slotKind/isFresh güvenilir karar yardımcısını kullanır (checked/okuma anı yok)', /trustedOccupancy\(/.test(body('slotKind')) && /trustedOccupancy\(/.test(body('isFresh')) && !/checked/.test(body('isFresh')));
  ok('slots.js slotKind topluluk bildirimine bakmaz', !/community/.test(body('slotKind').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));
  ok('slots.js COMMUNITY_FULL_MS kaldırıldı', !/COMMUNITY_FULL_MS/.test(sl));
  ok('livePlan sesli uyarı slotKind ile (doğrulanmış full/out)', /const after = slotKind\(st\)/.test(lp) && /\(after === 'full' \|\| after === 'out'\) && before !== after/.test(lp));
  ok('nearby gone()/pen() slotKind+isFresh ile', /const gone = \(s\) => \{ const k = slotKind\(s\);/.test(nb) && /const pen = \(s\) => \(slotKind\(s\) === 'full'/.test(nb));
  ok('nearSort slotKind(s, now) kullanır', /slotKind\(s, now\)/.test(ns));
  // Sesli uyarı: güvenilmez yeni veri 'full'/'out' geçişi üretmez → speak tetiklenmez
  const voiceTrigger = (beforeSl, afterSl) => { const st = S('v', beforeSl); const b = slotKind(st); st.slots = afterSl; const a = slotKind(st); return (a === 'full' || a === 'out') && b !== a; };
  for (const k of UNTRUSTED) ok(`sesli uyarı: free → ${k} tetiklemez`, !voiceTrigger(F.free, F[k]));
  ok('sesli uyarı: free → doğrulanmış dolu tetikler (işlev korunur)', voiceTrigger(F.free, F.full) && voiceTrigger(null, F.out));
}

console.log(`\ntest-occupancy-consumers: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
