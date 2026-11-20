// Durak başına şarj hedefi (v0.99.98): planlayıcıda kilitli ayrılış SoC'si (leaveSocs), alt akış yeniden hesap, durak sırası,
// SoC/kWh/süre matematiği, maliyet yalnız doğrulanmış tarifede, önizleme farkı ve onay/iptal (kaynak denetimi). Kullanım: node scripts/test-stop-target.mjs
import { readFileSync } from 'node:fs';
const stored = new Map();
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) };
const { planRoute } = await import('../js/routing/planner.js');
const { chargeMinutes } = await import('../js/routing/chargeCurve.js');
const { PLANNER, VEHICLE } = await import('../js/config.js');
const ST = await import('../js/routing/stopTarget.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const BAT = VEHICLE.batteryNetKwh;
const near = (a, b, e = 0.01) => Math.abs(a - b) <= e;

const profile = { totalKm: 700, energyBetween: (a, b, k = 1) => Math.max(0, b - a) * 0.2 * k, timeBetween: (a, b) => Math.max(0, b - a) / 100 };
const st = (id, km, extra = {}) => ({ id, name: id, km, lat: 40, lon: 30, kw: 180, price: 10, opId: 'x', opName: 'X', slow: false, offKm: 0, tariffSrc: 'published', ...extra });
const stations = [st('s100', 100), st('s200', 200), st('s300', 300), st('s400', 400), st('s500', 500), st('s600', 600)];
const base = { profile, stations, startKm: 0, startSoc: 80, minArrival: 15, mode: 'fast', k: 1 };
const ids = (r) => r.stops.map((s) => s.station.id).join(',');

// 1) Kilitsiz plan değişmez (geriye uyum)
const p0 = planRoute(base);
ok('temel plan kurulur', p0.feasible, p0.reason);
ok('leaveSocs boşken sonuç aynı', ids(planRoute({ ...base, leaveSocs: {} })) === ids(p0) && ids(planRoute({ ...base, leaveSocs: null })) === ids(p0));
const first = p0.stops[0];

// 2) Kilit: durakta tam olarak hedefe şarj edilir (5'lik ızgara dışı değer de)
const lock = planRoute({ ...base, mustIds: [first.station.id], leaveSocs: { [first.station.id]: 97 } });
const ls = lock.stops.find((s) => s.station.id === first.station.id);
ok('kilitli durak planda', lock.feasible && !!ls, lock.reason);
ok('kilitli ayrılış %97 (ızgara dışı)', ls && ls.leaveSoc === 97, ls && ls.leaveSoc);
ok('eklenen kWh = (hedef-varış)×BAT', ls && near(ls.kwhAdded, ((97 - ls.arriveSoc) / 100) * BAT));
ok('şarj süresi eğriden (chargeMinutes)', ls && near(ls.minutes, chargeMinutes(180, ls.arriveSoc, 97)));
ok('kilit maxChargeTo (%' + PLANNER.maxChargeTo + ') üstünde kabul edilir', ls && ls.leaveSoc > PLANNER.maxChargeTo);

// 3) Alt akış: yüksek hedef → sonraki durak daha ileri / daha az durak; düşük hedef → daha erken/daha çok durak
const low = planRoute({ ...base, mustIds: ['s100'], leaveSocs: { s100: 65 } });
const high = planRoute({ ...base, mustIds: ['s100'], leaveSocs: { s100: 100 } });
ok('düşük hedefle plan kurulur', low.feasible, low.reason);
ok('yüksek hedefle plan kurulur', high.feasible, high.reason);
const nextKm = (r) => r.stops.find((s) => s.km > 100)?.km ?? Infinity;
ok('yüksek hedef → sonraki durak daha ileride', nextKm(high) > nextKm(low), `${nextKm(high)} vs ${nextKm(low)}`);
ok('yüksek hedef → durak sayısı ≤ düşük hedef', high.stops.length <= low.stops.length, `${high.stops.length} vs ${low.stops.length}`);
ok('duraklar rota sırasında (düşük)', low.stops.every((s, i) => i === 0 || s.km > low.stops[i - 1].km));
ok('duraklar rota sırasında (yüksek)', high.stops.every((s, i) => i === 0 || s.km > high.stops[i - 1].km));
ok('ilk durak kilitli ve %65/%100', low.stops[0].station.id === 's100' && low.stops[0].leaveSoc === 65 && high.stops[0].leaveSoc === 100);
ok('alt akış varış SoC zinciri tutarlı', low.stops.every((s, i) => i === 0 || near(s.arriveSoc, low.stops[i - 1].leaveSoc - (profile.energyBetween(low.stops[i - 1].km, s.km) / BAT) * 100)));
ok('varışta pil eşik üstü', low.totals.arriveSoc >= 15 - PLANNER.tolerance && high.totals.arriveSoc >= 15 - PLANNER.tolerance);

// 4) Yetersiz SoC: hedef bir sonraki adaya yetmiyor → kurulamaz (uydurma yok)
const sparse = [st('a100', 100), st('b450', 450)];
const bad = planRoute({ ...base, stations: sparse, profile: { ...profile, totalKm: 600 }, mustIds: ['a100'], leaveSocs: { a100: 30 } });
ok('yetersiz hedef: plan kurulamaz', bad.feasible === false);
// 5) Hedef varıştan düşük (0): şarj yok, ayrılış = varış
const zero = planRoute({ ...base, mustIds: ['s100'], leaveSocs: { s100: 0 } });
const z = zero.stops.find((s) => s.station.id === 's100');
ok('hedef %0: durakta şarj yok, ayrılış = varış', zero.feasible && z && near(z.leaveSoc, z.arriveSoc) && z.kwhAdded === 0 && z.minutes === 0, JSON.stringify(z && { a: z.arriveSoc, l: z.leaveSoc, r: zero.reason }));

// 6) Saf yardımcılar
const stop = { station: st('s', 100), km: 100, arriveSoc: 33.4, leaveSoc: 80 };
const b = ST.targetBounds(stop, { userMax: 80 });
ok('sınır: alt = varış (yukarı yuvarlı)', b.lo === 34, b.lo);
ok('sınır: üst = %100 (araç), kullanıcı üst sınırı ayrı', b.hi === 100 && b.userMax === 80);
ok('clamp: 120 → 100, 10 → 34', ST.clampTarget(120, b) === 100 && ST.clampTarget(10, b) === 34);
const c = ST.stopCharge(stop, 90);
ok('stopCharge kWh', near(c.kwh, ((90 - 33.4) / 100) * BAT));
ok('stopCharge süre', near(c.minutes, chargeMinutes(180, 33.4, 90)));
ok('stopCharge maliyet yalnız doğrulanmış tarifede', c.cost != null && ST.stopCharge({ ...stop, station: { ...stop.station, tariffSrc: 'documented' } }, 90).cost === null && ST.stopCharge({ ...stop, station: { ...stop.station, tariffSrc: null } }, 90).cost === null);
ok('stopCharge yabancı ülke maliyet yok', ST.stopCharge({ ...stop, station: { ...stop.station, foreign: true } }, 90).cost === null);
ok('stopCharge hedef ≤ varış → 0', ST.stopCharge(stop, 20).kwh === 0 && ST.stopCharge(stop, 20).minutes === 0);
ok('stopCharge eğri yaklaşık işaretli', c.curve === 'approx');
ok('stopCharge kullanıcı üst sınırı aşımı işaretli', ST.stopCharge(stop, 95, { userMax: 80 }).overUserMax === true && ST.stopCharge(stop, 70, { userMax: 80 }).overUserMax === false);

const d = ST.planDiff({ stops: low.stops, totals: low.totals }, { stops: high.stops, totals: high.totals });
ok('fark: süre ve varış pili deltası', near(d.totalMinDelta, high.totals.totalMin - low.totals.totalMin) && near(d.arriveSocDelta, high.totals.arriveSoc - low.totals.arriveSoc));
ok('fark: eklenen/çıkan duraklar', d.added.every((n) => high.stops.some((s) => s.station.name === n)) && d.removed.every((n) => low.stops.some((s) => s.station.name === n)) && (d.added.length + d.removed.length > 0 || d.changed.length > 0));
ok('fark: değişen ayrılış', d.changed.some((x) => x.id === 's100' && x.leaveFrom === 65 && x.leaveTo === 100));
ok('fark: aynı plan → değişiklik yok', ST.planDiff({ stops: low.stops, totals: low.totals }, { stops: low.stops, totals: low.totals }).same === true);
ok('fark: maliyet farkı yalnız tüm duraklar doğrulanmışsa', d.costDelta != null && ST.planDiff({ stops: [{ ...low.stops[0], station: { ...low.stops[0].station, tariffSrc: null } }], totals: low.totals }, { stops: high.stops, totals: high.totals }).costDelta === null);
ok('sanitize: geçersiz/aralık dışı atılır, ileri olmayan atılır', JSON.stringify(ST.sanitizeLeaveSocs({ a: 50, b: 'x', c: 150, d: -1, e: 70 }, ['a', 'c', 'd'])) === JSON.stringify({ a: 50, c: 100, d: 0 }));

// 7) Denetim: denetleyici + arayüz bağlantıları (onay zorunlu, iptal planı korur)
const ctl = read('js/routing/controller.js');
const fnBody = (raw, name) => { const src = raw.replace(/\r\n/g, '\n'); const i = src.indexOf(`export function ${name}(`); return i < 0 ? '' : src.slice(i, src.indexOf('\n}\n', i)); }; // CRLF çalışma kopyasında (autocrlf) da doğru keser
ok('controller: previewStopTarget ve applyStopTarget var', /export function previewStopTarget\(/.test(ctl) && /export function applyStopTarget\(/.test(ctl));
ok('controller: önizleme applyPlan/patch çağırmaz', fnBody(ctl, 'previewStopTarget') && !/applyPlan\(|patch\(/.test(fnBody(ctl, 'previewStopTarget')));
ok('controller: eski önizleme reddedilir (planId/tripSeq)', /planId/.test(fnBody(ctl, 'applyStopTarget')) && /tripSeq/.test(fnBody(ctl, 'applyStopTarget')));
ok("controller: leaveSocs planRoute'a gider", /leaveSocs/.test(fnBody(ctl, 'computePlan')));
ok('controller: yeni rota/temizlikte leaveSocs sıfırlanır', (ctl.match(/leaveSocs: \{\}/g) || []).length >= 2);
ok('controller: önizleme rota dışı onayı tetiklemez', !/offerAlternatives/.test(fnBody(ctl, 'previewStopTarget')));
const ui = read('js/ui/stopTarget.js');
ok('ui: Onayla ve İptal düğmeleri', /st-apply/.test(ui) && /st-cancel/.test(ui));
ok('ui: kaydırıcı yalnız önizler; tek uygulama noktası', /previewStopTarget\(/.test(ui) && (ui.match(/applyStopTarget\(/g) || []).length === 1);
const html = read('index.html');
ok('index.html: hedef iletişim kutusu', /id="target-dialog"/.test(html) && /id="st-range"/.test(html) && /id="st-apply"/.test(html) && /id="st-cancel"/.test(html));
ok('routePanel: Şarj hedefi düğmesi', /openTarget\(/.test(read('js/ui/routePanel.js')));

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
