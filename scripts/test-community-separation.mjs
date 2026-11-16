// D3-T3: topluluk doluluk bildirimi resmî (sağlayıcı) doluluktan veri modelinde AYRI mı? — çevrimdışı, sentetik.
// node scripts/test-community-separation.mjs
// Karar K3 (docs/beta-task-registry.json decisions[D3].sub_decisions): topluluk bildirimi resmî doluluktan ayrı veri olarak
// tutulur; resmî doluluk durumunu belirlemez/üzerine yazmaz. Topluluk bildirimi doğrulanmış resmî "Müsait"e DÖNÜŞEMEZ.
// D3-T5: tüketici kararları (slots.js slotKind/isFresh → planlayıcı, düşük pil, yakın sıralama, sesli uyarı) yalnız doğrulanmış
// resmî doluluğu kullanır; topluluk bildirimi AYRI kalır (yalnız gösterim) ve hiçbir tüketicide 'full'/'free' üretmez.
// Ağ yok: global fetch çağrılırsa test başarısız olur; sunucu açılmaz.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(join(root, p)).href);

let realFetchCalls = 0;
globalThis.fetch = async () => { realFetchCalls++; throw new Error('test: gerçek ağ yasak'); };

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };

const NOW = 1_800_000_000_000;
const MIN = 60e3;
const deepFreeze = (o) => { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
const UNKNOWN = (d, reason) => d && d.trusted === false && d.state === 'unknown' && (reason === undefined || d.reason === reason);

const { occupancyDecision } = await imp('js/routing/occupancyDecision.js');
let communityReport, COMMUNITY_REPORT_MAX_AGE_MS;
try {
  ({ communityReport, COMMUNITY_REPORT_MAX_AGE_MS } = await imp('js/routing/communityReport.js'));
} catch (e) {
  console.log('FAIL js/routing/communityReport.js yüklenemedi:', e.message);
  console.log(`test-community-separation: 0 geçti, 1 başarısız`);
  process.exit(1);
}
const { buildAvailability } = await imp('server/availability.mjs');

// Resmî, doğrulanmış (sağlayıcı zaman damgalı, taze) Müsait örneği — karşılaştırma çapası
const officialFree = buildAvailability({ source: 'mock', evses: [{ status: 'AVAILABLE' }, { status: 'CHARGING' }], now: NOW, fetchedAt: NOW, at: NOW - MIN });
const hereFree = { ...officialFree, source: 'here', simulated: false };
{
  const d = occupancyDecision(hereFree, { now: NOW });
  ok('çapa: resmî HERE sağlayıcı zamanlı taze 1/2 → trusted free', d.trusted === true && d.state === 'free', JSON.stringify(d));
}

// ---------- 1) occupancyDecision topluluk verisini asla resmî/güvenilir saymaz ----------
{
  // Topluluk kaynaklı sahte "availability" (biri yanlışlıkla topluluğu resmî biçime koysa bile)
  const forged = deepFreeze({ ...hereFree, source: 'community' });
  const d = occupancyDecision(forged, { now: NOW });
  ok('source community + sağlayıcı zamanı + AVAILABLE → Bilinmiyor (community-not-official)', UNKNOWN(d, 'community-not-official'), JSON.stringify(d));
  for (const s of ['Community', ' community ', 'COMMUNITY', 'user', 'crowd']) {
    const d2 = occupancyDecision({ ...hereFree, source: s }, { now: NOW });
    ok(`source "${s}" → güvenilir değil`, d2.trusted === false && d2.state === 'unknown', JSON.stringify(d2));
  }
  ok('community (büyük/küçük harf, boşluk) → community-not-official', UNKNOWN(occupancyDecision({ ...hereFree, source: ' Community ' }, { now: NOW }), 'community-not-official'));
  ok('source community (slots içinde availability) → community-not-official', UNKNOWN(occupancyDecision({ availability: forged }, { now: NOW }), 'community-not-official'));
}
{
  // Yalnız topluluk verisi olan slots (server/occupancy.mjs lookupAll topluluk-yalnız kaydı)
  const slots = deepFreeze({ src: 'community', total: null, available: null, out: null, at: null, price: null, availability: null,
    community: { busy: 0, report: { status: 'free', at: NOW - MIN } } });
  const d = occupancyDecision(slots, { now: NOW });
  ok('yalnız topluluk "Boş" bildirimi → resmî karar Bilinmiyor (no-data)', UNKNOWN(d, 'no-data'), JSON.stringify(d));
  const slots2 = { ...slots, availability: undefined };
  ok('availability alanı hiç yok + topluluk Boş → Bilinmiyor', UNKNOWN(occupancyDecision(slots2, { now: NOW })));
  // Topluluk alanı doğrudan girdi olarak verilse bile
  ok('community nesnesi girdi → Bilinmiyor', UNKNOWN(occupancyDecision(slots.community, { now: NOW })));
  ok('community.report girdi → Bilinmiyor', UNKNOWN(occupancyDecision(slots.community.report, { now: NOW })));
}
{
  // Resmî Bilinmiyor + topluluk "Boş": resmî karar Bilinmiyor kalır (topluluk yükseltmez)
  const ttFetched = buildAvailability({ source: 'tomtom', counts: { AVAILABLE: 2, OCCUPIED: 1 }, now: NOW, fetchedAt: NOW });
  const slots = deepFreeze({ src: 'tomtom', total: 3, available: 2, out: 0, at: NOW, availability: ttFetched,
    community: { busy: 0, report: { status: 'free', at: NOW - MIN } } });
  const base = occupancyDecision({ availability: ttFetched }, { now: NOW });
  const d = occupancyDecision(slots, { now: NOW });
  ok('TomTom fetched + topluluk Boş → yine Bilinmiyor (no-timestamp)', UNKNOWN(d, 'no-timestamp'), JSON.stringify(d));
  ok('topluluk alanı resmî kararı değiştirmez (aynı çıktı)', JSON.stringify(d) === JSON.stringify(base));
  // Resmî doğrulanmış Dolu + topluluk "Boş": resmî Dolu kalır (topluluk üzerine yazmaz)
  const busyAv = { ...hereFree, counts: { ...hereFree.counts, AVAILABLE: 0, CHARGING: 2 }, available: 0 };
  const dBusyBase = occupancyDecision(busyAv, { now: NOW });
  const dBusy = occupancyDecision({ availability: busyAv, community: { busy: 0, report: { status: 'free', at: NOW } } }, { now: NOW });
  ok('resmî karar topluluk alanından bağımsız (Dolu örneği)', JSON.stringify(dBusy) === JSON.stringify(dBusyBase), JSON.stringify([dBusy, dBusyBase]));
  // Resmî doğrulanmış Müsait + topluluk "Dolu": resmî karar aynı (topluluk resmîyi belirlemez)
  const dFree = occupancyDecision({ availability: hereFree, community: { busy: 5, report: { status: 'full', at: NOW } } }, { now: NOW });
  ok('resmî Müsait + topluluk Dolu → resmî karar değişmez', dFree.trusted === true && dFree.state === 'free' && dFree.source === 'HERE', JSON.stringify(dFree));
}

// ---------- 2) communityReport: ayrı, saf topluluk veri modeli ----------
ok('COMMUNITY_REPORT_MAX_AGE_MS = 60 dk (server/community.mjs REPORT_MS ile aynı)', COMMUNITY_REPORT_MAX_AGE_MS === 60 * MIN);
{
  const cm = deepFreeze({ busy: 2, report: { status: 'free', at: NOW - 5 * MIN } });
  const r = communityReport({ community: cm }, { now: NOW });
  ok('model: kind community, official false, verified false', r && r.kind === 'community' && r.official === false && r.verified === false, JSON.stringify(r));
  ok('model: busy ve bildirim taşınır', r.busy === 2 && r.report.status === 'free' && r.report.at === NOW - 5 * MIN && r.report.ageMin === 5, JSON.stringify(r));
  ok('model: resmî karar alanları YOK (trusted/state/available/total/source)', !('trusted' in r) && !('state' in r) && !('available' in r) && !('total' in r) && !('source' in r), JSON.stringify(r));
  ok('model: dondurulmuş (iç içe)', Object.isFrozen(r) && Object.isFrozen(r.report));
  ok('model: girdi değişmedi', cm.busy === 2 && cm.report.status === 'free');
  ok('community nesnesi doğrudan verilebilir', JSON.stringify(communityReport(cm, { now: NOW })) === JSON.stringify(r));
  // Topluluk modeli resmî karara verilirse yine güvenilir olmaz
  ok('topluluk modeli occupancyDecision girdisi → Bilinmiyor', UNKNOWN(occupancyDecision(r, { now: NOW })));
  ok('topluluk modeli { availability: model } → Bilinmiyor', UNKNOWN(occupancyDecision({ availability: r }, { now: NOW })));
}
{
  ok('now yok → null', communityReport({ busy: 1, report: null }) === null);
  ok('now geçersiz → null', communityReport({ busy: 1, report: null }, { now: NaN }) === null);
  ok('girdi yok → null', communityReport(null, { now: NOW }) === null && communityReport({}, { now: NOW }) === null);
  ok('slots community null → null', communityReport({ src: 'tomtom', community: null }, { now: NOW }) === null);
  ok('busy 0 ve bildirim yok → null', communityReport({ busy: 0, report: null }, { now: NOW }) === null);
  const onlyBusy = communityReport({ busy: 3 }, { now: NOW });
  ok('yalnız varlık (busy) → report null', onlyBusy && onlyBusy.busy === 3 && onlyBusy.report === null, JSON.stringify(onlyBusy));
  for (const b of [-1, 1.5, '2', NaN, Infinity]) ok(`busy ${String(b)} → 0`, communityReport({ busy: b, report: { status: 'full', at: NOW } }, { now: NOW })?.busy === 0);
  ok('bilinmeyen durum (available) → bildirim yok sayılır', communityReport({ busy: 0, report: { status: 'available', at: NOW } }, { now: NOW }) === null);
  ok('durum "free" dışında Müsait eşdeğeri üretmez', communityReport({ busy: 1, report: { status: 'AVAILABLE', at: NOW } }, { now: NOW })?.report === null);
  ok('zamansız bildirim yok sayılır', communityReport({ busy: 0, report: { status: 'full' } }, { now: NOW }) === null);
  ok('gelecek zamanlı bildirim (+2 dk) yok sayılır', communityReport({ busy: 0, report: { status: 'free', at: NOW + 2 * MIN } }, { now: NOW }) === null);
  ok('tam 60 dk eski bildirim dahil', communityReport({ busy: 0, report: { status: 'full', at: NOW - 60 * MIN } }, { now: NOW })?.report?.ageMin === 60);
  ok('60 dk + 1 ms eski bildirim düşer', communityReport({ busy: 0, report: { status: 'full', at: NOW - 60 * MIN - 1 } }, { now: NOW }) === null);
  ok('saat kayması ≤ 1 dk ileri tolerans → ageMin 0', communityReport({ busy: 0, report: { status: 'free', at: NOW + 30e3 } }, { now: NOW })?.report?.ageMin === 0);
}

// ---------- 3) D3-T5: tüketici kararı yalnız doğrulanmış resmî doluluk; topluluk ayrı ----------
{
  const realNow = Date.now();
  const { slotKind, isFresh } = await imp('js/routing/slots.js');
  const { buildAvailability } = await imp('server/availability.mjs');
  const s = (sl) => ({ slots: sl });
  const official = (counts) => { const availability = buildAvailability({ source: 'here', counts, at: realNow - MIN, fetchedAt: realNow, now: realNow }); return { total: availability.total, available: availability.available, out: 0, checked: realNow, src: 'here', availability }; };
  ok('slotKind: topluluk Boş (resmî sayı yok) → unknown (asla free)', slotKind(s({ available: null, community: { busy: 0, report: { status: 'free', at: realNow } } })) === 'unknown');
  ok('slotKind: topluluk Boş + varlık → unknown', slotKind(s({ available: null, community: { busy: 4, report: { status: 'free', at: realNow } } })) === 'unknown');
  ok('slotKind: D3-T5 — taze topluluk Dolu (<20 dk) → unknown (topluluk ayrı, tüketici dolu saymaz)', slotKind(s({ available: null, community: { busy: 0, report: { status: 'full', at: realNow - MIN } } })) === 'unknown');
  ok('isFresh: taze topluluk Dolu → false', isFresh(s({ available: null, community: { busy: 3, report: { status: 'full', at: realNow - MIN } } })) === false);
  ok('slotKind: 20 dk+ topluluk Dolu → unknown', slotKind(s({ available: null, community: { busy: 0, report: { status: 'full', at: realNow - 21 * MIN } } })) === 'unknown');
  ok('slotKind: doğrulanmış resmî varsa topluluk yok sayılır (1/2 + topluluk Dolu → free)', slotKind(s({ ...official({ AVAILABLE: 1, CHARGING: 1 }), community: { busy: 0, report: { status: 'full', at: realNow } } })) === 'free');
  ok('slotKind: doğrulanmış resmî 0/2 + topluluk Boş → full (topluluk resmîyi ezmez)', slotKind(s({ ...official({ CHARGING: 2 }), community: { busy: 0, report: { status: 'free', at: realNow } } })) === 'full');
  ok('slotKind: zaman damgasız resmî 0/2 + topluluk Dolu → unknown (ikisi birleşip dolu olmaz)', slotKind(s({ total: 2, available: 0, out: 0, checked: realNow, community: { busy: 2, report: { status: 'full', at: realNow } } })) === 'unknown');
  ok('isFresh topluluğa bakmaz (checked yok → bayat)', isFresh(s({ available: null, community: { busy: 1, report: { status: 'free', at: realNow } } })) === false);
}
{
  // Planlayıcı / planla ilgili modüller yeni topluluk modelini ya da occupancyDecision'ı doğrudan içe aktarmaz: tek karar noktası
  // slots.js'tir (D3-T4 arayüz + D3-T5 slotKind/isFresh → trustedOccupancy → occupancyDecision). Topluluk kararı slotKind'e girmez.
  {
    const sl = readFileSync(join(root, 'js/routing/slots.js'), 'utf8').replace(/\/\/.*$/gm, '');
    const body = (n) => { const i = sl.indexOf(`export ${n.startsWith('isFresh') ? 'const' : 'function'} ${n}`); const j = sl.indexOf('\nexport ', i + 1); return i < 0 ? '' : sl.slice(i, j < 0 ? undefined : j); };
    ok('slots.js slotKind/isFresh doğrulanmış karar yardımcısını kullanır, topluluk modelini kullanmaz (D3-T5)', ['slotKind', 'isFresh'].every((n) => body(n).length > 20 && /trustedOccupancy\(/.test(body(n)) && !/communityReport|community/.test(body(n))));
    const helper = sl.slice(sl.indexOf('function trustedOccupancy'), sl.indexOf('export function slotKind'));
    ok('slots.js trustedOccupancy: occupancyDecision + sunucu vetosu, topluluk yok', /occupancyDecision\(sl, \{ now \}\)/.test(helper) && /decision\.trusted !== true/.test(helper) && !/community/.test(helper));
  }
  const PLAN = ['js/routing/planner.js', 'js/routing/livePlan.js', 'js/routing/routeOptions.js', 'js/routing/controller.js', 'js/nav/nearSort.js', 'js/nav/nearby.js', 'js/nav/chargePick.js'];
  for (const f of PLAN) {
    const src = readFileSync(join(root, f), 'utf8');
    ok(`${f} communityReport/occupancyDecision kullanmaz`, !/communityReport|occupancyDecision/.test(src));
  }
  // communityReport çağıranları kesin liste: yalnız js/routing/slots.js (D3-T4 arayüz) + sw.js SHELL girdisi
  const walk = (d) => readdirSync(join(root, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
  const users = [...walk('js'), ...walk('server').filter((f) => !/[\\/]data[\\/]/.test(f) && /\.m?js$/.test(f)), 'sw.js', 'index.html']
    .filter((f) => !/communityReport\.js$/.test(f) && /\.(m?js|html)$/.test(f))
    .filter((f) => /communityReport/.test(readFileSync(join(root, f), 'utf8'))).map((f) => f.split('\\').join('/'));
  ok('communityReport çağıranları tam olarak js/routing/slots.js + sw.js (D3-T4)', JSON.stringify(users) === JSON.stringify(['js/routing/slots.js', 'sw.js']), JSON.stringify(users));
  const mod = readFileSync(join(root, 'js/routing/communityReport.js'), 'utf8');
  ok('communityReport saf: Date.now / fetch / document / localStorage yok', !/Date\.now|fetch\(|document\.|localStorage|import\(/.test(mod));
}

// ---------- 4) Sunucu: topluluk özeti resmî alan taşımaz ----------
{
  const { createCommunity } = await imp('server/community.mjs');
  const store = { data: {}, save() {} };
  const c = createCommunity(store);
  c.report('u-test-1', { lat: 41.0, lon: 28.98, status: 'free' });
  c.presence('u-test-2', { lat: 41.0, lon: 28.98, state: 'start' });
  const sm = c.summary({ lat: 41.0, lon: 28.98 });
  ok('community.summary: yalnız busy + report', sm && Object.keys(sm).sort().join() === 'busy,report' && sm.busy === 1 && sm.report.status === 'free', JSON.stringify(sm));
  ok('community.summary: kullanıcı kimliği dışarı verilmez', !JSON.stringify(sm).includes('u-test'));
  ok('community.summary → occupancyDecision Bilinmiyor', UNKNOWN(occupancyDecision(sm, { now: Date.now() })) && UNKNOWN(occupancyDecision({ community: sm }, { now: Date.now() })));
  const m = communityReport(sm, { now: Date.now() });
  ok('community.summary → communityReport official false', m && m.official === false && m.report.status === 'free' && m.busy === 1, JSON.stringify(m));
}

ok('gerçek fetch çağrılmadı', realFetchCalls === 0, String(realFetchCalls));
console.log(`test-community-separation: ${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
