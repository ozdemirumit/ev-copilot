// Rota seçenekleri karşılaştırması: tek güzergâh dürüstlüğü, bilinen/tahmini/bilinmeyen fiyat, "En ucuz" iddia koşulu,
// "En düşük risk" ölçütleri, aynı plan birleştirme, plan kurulamayan mod ve mevcut planlayıcı davranışının (regresyon) korunması.
// Kullanım: node scripts/test-route-options.mjs
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const R = await import('../js/routing/routeOptions.js');
const { buildRouteOptions, planCost, priceClass, costText, optionText, routeAlternatives, RISK_CRITERIA } = R;

const st = (id, o = {}) => ({ id, name: id, kw: 180, uncertain: false, slow: false, tariff: 'list', price: 10, ...o });
const stop = (station, o = {}) => ({ station, km: 100, arriveSoc: 20, leaveSoc: 70, minutes: 25, cost: 300, ...o });
const plan = (stops, o = {}) => ({ feasible: true, stops, totals: { totalMin: 300, chargeMin: 40, driveMin: 260, arriveSoc: 25, cost: stops.reduce((a, s) => a + s.cost, 0), ...o } });

// ---- Fiyat sınıfı ----
ok('liste tarifesi bilinen', priceClass(st('a')) === 'known');
ok('ortalama tahmini', priceClass(st('a', { tariff: 'estimate' })) === 'estimate');
ok('yurt dışı bilinmiyor', priceClass(st('a', { foreign: true, price: 0, tariff: null })) === 'unknown');
ok('fiyat 0/yok bilinmiyor', priceClass(st('a', { price: 0 })) === 'unknown' && priceClass(st('a', { price: undefined })) === 'unknown');
ok('tarife alanı yok bilinmiyor', priceClass(st('a', { tariff: undefined })) === 'unknown');
ok('istasyon yok bilinmiyor', priceClass(undefined) === 'unknown');

// ---- Plan maliyeti ----
{
  const none = planCost([]);
  ok('şarjsız plan 0 TL karşılaştırılabilir', none.kind === 'none' && none.total === 0 && costText(none).startsWith('0 TL'));
  const k = planCost([stop(st('a'), { cost: 300 }), stop(st('b'), { cost: 200 })]);
  ok('tümü bilinen: toplam', k.kind === 'known' && k.total === 500 && costText(k) === '500 TL (tarife)');
  const e = planCost([stop(st('a'), { cost: 300 }), stop(st('b', { tariff: 'estimate' }), { cost: 200 })]);
  ok('tahmin içeren: toplam yok, ~ ile yazılır', e.kind === 'estimate' && e.total == null && costText(e) === '~500 TL (1 durak tahmini fiyat)');
  const u = planCost([stop(st('a'), { cost: 300 }), stop(st('f', { foreign: true, price: 0, tariff: null }), { cost: 0 })]);
  ok('bilinmeyen içeren: alt sınır', u.kind === 'unknown' && u.total == null && costText(u) === '≥ 300 TL · 1 durağın fiyatı bilinmiyor');
  const uu = planCost([stop(st('f', { foreign: true, price: 0, tariff: null }), { cost: 0 })]);
  ok('hiç fiyat yok: TL yazılmaz', costText(uu) === 'Fiyat bilinmiyor');
  const nan = planCost([stop(st('a'), { cost: NaN })]);
  ok('NaN maliyet toplamı bozmaz', nan.total === 0);
}

// ---- Tek güzergâh dürüstlüğü ----
{
  const r1 = routeAlternatives({ coords: [] });
  ok('tek güzergâh: alternatif yok', r1.count === 1 && !r1.available && /tek güzergâh/.test(r1.note));
  ok('rota yok: 0', routeAlternatives(null).count === 0 && !routeAlternatives(null).available);
  const r3 = routeAlternatives({ alternatives: [{}, {}] });
  ok('sağlayıcı alternatif verirse sayılır', r3.count === 3 && r3.available);
  const m = buildRouteOptions({ plans: { fast: plan([]) }, route: { coords: [] } });
  ok('model tek güzergâh notunu taşır', !m.routes.available && /alternatif güzergâh yok/.test(m.routes.note));
  ok('sağlayıcıda yalnız tek güzergâh isteniyor (Mapbox alternatives=false)', /alternatives: 'false'/.test(read('js/mapbox/route.js')));
}

// ---- En hızlı / En ucuz (bilinen fiyatlar) / En düşük risk ----
const A = st('A'); const B = st('B', { price: 8 }); const C = st('C', { kw: 60 });
{
  const plans = {
    fast: plan([stop(A, { cost: 400 })], { totalMin: 280, arriveSoc: 15 }),
    cheap: plan([stop(B, { cost: 250 }), stop(C, { cost: 100, arriveSoc: 30 })], { totalMin: 330, arriveSoc: 22 }),
    opt: plan([stop(A, { cost: 380, leaveSoc: 75 })], { totalMin: 290, arriveSoc: 18 }),
  };
  const m = buildRouteOptions({ plans, route: {}, current: 'opt' });
  ok('üç farklı plan', m.distinct === 3);
  ok('en hızlı süreye göre', m.best.fast === 'fast');
  ok('en ucuz: tümü bilinen tarife → en düşük toplam', m.best.cheap === 'cheap' && m.options.find((o) => o.mode === 'cheap').cost.total === 350);
  // risk: en düşük pil fast=min(15,20)=15, cheap=min(22,20,30)=20, opt=min(18,20)=18 → cheap
  ok('en düşük risk: en düşük pili yüksek olan', m.best.risk === 'cheap');
  ok('risk ölçütleri notta açıkça yazılı', RISK_CRITERIA.every((c) => m.notes.risk.includes(c)));
  ok('seçili mod işaretli', m.options.find((o) => o.mode === 'opt').current && optionText(m.options.find((o) => o.mode === 'opt'), m).badges[0] === 'seçili');
  const tx = optionText(m.options.find((o) => o.mode === 'cheap'), m);
  ok('rozetler metinde', tx.badges.includes('En ucuz') && tx.badges.includes('En düşük risk') && !tx.badges.includes('En hızlı'));
  ok('satır metni süre/durak/maliyet', /5 sa 30 dk/.test(tx.line) && /2 durak/.test(tx.line) && /350 TL \(tarife\)/.test(tx.line), tx.line);
  ok('risk satırı en düşük pil', /En düşük pil %20/.test(tx.risk), tx.risk);
}

// ---- Eksik fiyat: En ucuz iddia edilmez ----
{
  const E = st('E', { tariff: 'estimate', price: 1 }); // tahmini çok ucuz görünüyor: kazanmamalı
  const F = st('F', { foreign: true, price: 0, tariff: null });
  const est = buildRouteOptions({ plans: { fast: plan([stop(A, { cost: 400 })]), cheap: plan([stop(E, { cost: 50 })], { totalMin: 320 }) } });
  ok('tahmini fiyatlı planla en ucuz yok', est.best.cheap === null && /tahmini/.test(est.notes.cheap), est.notes.cheap);
  const unk = buildRouteOptions({ plans: { fast: plan([stop(A, { cost: 400 })]), cheap: plan([stop(F, { cost: 0, arriveSoc: 30 })], { totalMin: 320, arriveSoc: 30 }) } });
  ok('fiyatı bilinmeyen planla en ucuz yok (0 TL kazanmaz)', unk.best.cheap === null && /bilinmeyen/.test(unk.notes.cheap), unk.notes.cheap);
  ok('bilinmeyen fiyatta en hızlı/risk yine verilir', unk.best.fast === 'fast' && unk.best.risk != null);
  const tie = buildRouteOptions({ plans: { fast: plan([stop(A, { cost: 300 })]), cheap: plan([stop(B, { cost: 300.2 })], { totalMin: 320 }) } });
  ok('eşit bilinen maliyet: en ucuz denmez', tie.best.cheap === null && /eşit/.test(tie.notes.cheap));
  const noCharge = buildRouteOptions({ plans: { fast: plan([], { totalMin: 200 }), cheap: plan([stop(A, { cost: 100 })], { totalMin: 260 }) } });
  ok('şarjsız plan bilinen 0 TL ile en ucuz olabilir', noCharge.best.cheap === 'fast');
}

// ---- Aynı plan birleştirilir, farklılık uydurulmaz ----
{
  const same = plan([stop(A)]);
  const m = buildRouteOptions({ plans: { fast: same, cheap: plan([stop(A)]), opt: plan([stop(A)]) }, current: 'fast' });
  ok('tüm modlar aynı plan: tek farklı seçenek', m.distinct === 1);
  ok('aynı planda rozet verilmez', m.best.fast === null && m.best.cheap === null && m.best.risk === null);
  ok('aynı plan notu', /aynı şarj planını/.test(m.notes.cheap));
  ok('sameAs ilk moda bağlanır', m.options[1].sameAs === 'fast' && /Hızlı ile aynı plan/.test(optionText(m.options[1], m).line));
  const two = buildRouteOptions({ plans: { fast: plan([stop(A)], { totalMin: 280 }), cheap: plan([stop(B, { cost: 200 })], { totalMin: 300 }), opt: plan([stop(A)], { totalMin: 280 }) } });
  ok('aynı planı veren mod rozeti paylaşır', two.distinct === 2 && optionText(two.options[2], two).badges.includes('En hızlı'));
}

// ---- Plan kurulamayan mod / boş girdi ----
{
  const m = buildRouteOptions({ plans: { fast: { feasible: false, reason: 'zincir yok', stops: [] }, cheap: plan([stop(A)]), opt: null } });
  const f = m.options.find((o) => o.mode === 'fast');
  ok('kurulamayan mod gösterilir, sebebiyle', !f.feasible && /zincir yok/.test(optionText(f, m).line));
  ok('kurulamayan mod rozet almaz', m.best.fast !== 'fast');
  const empty = buildRouteOptions();
  ok('boş girdi çökmez', empty.options.length === 0 && empty.best.fast === null && /Uygun plan yok/.test(empty.notes.fast));
}

// ---- Risk: belirsiz durak ve eşitlik bozma ----
{
  const U = st('U', { uncertain: true }); const S = st('S', { slow: true, kw: 11 });
  const m = buildRouteOptions({ plans: {
    fast: plan([stop(U, { arriveSoc: 20.4 })], { arriveSoc: 25, totalMin: 280 }),
    cheap: plan([stop(A, { arriveSoc: 20.2 })], { arriveSoc: 25, totalMin: 300 }),
    opt: plan([stop(B, { arriveSoc: 20.1 }), stop(C, { arriveSoc: 40 })], { arriveSoc: 25, totalMin: 290 }),
  } });
  ok('pil eşitse belirsiz durağı az olan', m.best.risk === 'cheap');
  ok('belirsiz durak sayılır', m.options[0].risky === 1 && R.stopRisks(S).includes('yavaş (AC)'));
  const NOW = Date.now();
  ok('taze dolu riskli, eski bilgi değil', R.stopRisks(st('x', { slots: { total: 2, available: 0, out: 0, checked: NOW } })).includes('dolu')
    && R.stopRisks(st('y', { slots: { total: 2, available: 0, out: 0, checked: NOW - 3600e3 } })).length === 0);
}

// ---- Gerçek planlayıcıyla uçtan uca (ağsız) ----
{
  const { planRoute } = await import('../js/routing/planner.js');
  const profile = { totalKm: 600, energyBetween: (a, b, k = 1) => Math.max(0, b - a) * 0.2 * k, timeBetween: (a, b) => Math.max(0, b - a) / 100 };
  const pst = (id, km, o = {}) => ({ id, name: id, km, kw: 180, price: 14, opId: 'x', slow: false, uncertain: false, offKm: 0.2, tariff: 'list', ...o });
  const stations = [pst('h1', 200, { kw: 300, price: 16 }), pst('u1', 210, { kw: 150, price: 8 }), pst('h2', 400, { kw: 300, price: 16 }), pst('u2', 410, { kw: 150, price: 8 })];
  const args = { profile, stations, startKm: 0, startSoc: 90, minArrival: 15, k: 1 };
  const plans = { fast: planRoute({ ...args, mode: 'fast' }), cheap: planRoute({ ...args, mode: 'cheap' }), opt: planRoute({ ...args, mode: 'opt' }) };
  const before = JSON.stringify(stations);
  const m = buildRouteOptions({ plans, route: {}, current: 'opt' });
  ok('gerçek plan: tüm modlar kurulur', m.options.every((o) => o.feasible), JSON.stringify(m.options.map((o) => o.reason)));
  ok('gerçek plan: hızlı mod 300 kW durakları seçer', plans.fast.stops.every((s) => s.station.kw === 300));
  ok('gerçek plan: en hızlı = hızlı modun grubu', m.best.fast === 'fast' || m.options.find((o) => o.mode === 'fast').sameAs === m.best.fast);
  ok('gerçek plan: hızlı ve ekonomik farklı plan', m.distinct >= 2, String(m.distinct));
  ok('gerçek plan: tümü bilinen tarife → en ucuz ekonomik', m.best.cheap === 'cheap', m.notes.cheap);
  ok('gerçek plan: girdi istasyonları değişmez', JSON.stringify(stations) === before);
  const est = stations.map((s) => (s.id === 'u1' ? { ...s, tariff: 'estimate' } : s));
  const plans2 = { fast: planRoute({ ...args, stations: est, mode: 'fast' }), cheap: planRoute({ ...args, stations: est, mode: 'cheap' }) };
  const m2 = buildRouteOptions({ plans: plans2 });
  ok('gerçek plan: ucuz plan tahmini fiyatlı durağı kullanıyor', plans2.cheap.stops.some((s) => s.station.id === 'u1'));
  ok('gerçek plan: tahmini fiyat varken en ucuz denmez', m2.best.cheap === null && /tahmini/.test(m2.notes.cheap), m2.notes.cheap);
}

// ---- Ek model durumları: tahmin+bilinmeyen, eşit maliyet/süre/risk, 1 puan altı pil farkı ----
{
  const E = st('E', { tariff: 'estimate' }); const F = st('F', { foreign: true, price: 0, tariff: null });
  const mix = planCost([stop(A, { cost: 100 }), stop(E, { cost: 50 }), stop(F, { cost: 0 })]);
  ok('tahmin + bilinmeyen: bilinmeyen baskın, alt sınır', mix.kind === 'unknown' && mix.total == null && costText(mix) === '≥ 150 TL · 1 durağın fiyatı bilinmiyor', costText(mix));
  const m = buildRouteOptions({ plans: { fast: plan([stop(A, { cost: 300 })], { totalMin: 280 }), cheap: plan([stop(E, { cost: 50 })], { totalMin: 300 }), opt: plan([stop(F, { cost: 0 })], { totalMin: 290 }) } });
  ok('tahmin ve bilinmeyen birlikte: en ucuz yok, bilinmeyen notu', m.best.cheap === null && /bilinmeyen/.test(m.notes.cheap), m.notes.cheap);
  ok('bilinmeyen 0 TL ve tahmini 50 TL rozet almaz', m.options.every((o) => !optionText(o, m).badges.includes('En ucuz')));
  const tie3 = buildRouteOptions({ plans: { fast: plan([stop(A, { cost: 200 })], { totalMin: 280 }), cheap: plan([stop(B, { cost: 200 })], { totalMin: 300 }), opt: plan([stop(C, { cost: 260 })], { totalMin: 290 }) } });
  ok('üç planda en düşük iki maliyet eşit: en ucuz yok', tie3.best.cheap === null && /eşit/.test(tie3.notes.cheap));
  const tieT = buildRouteOptions({ plans: { fast: plan([stop(A)], { totalMin: 280.2 }), cheap: plan([stop(B, { cost: 200 })], { totalMin: 279.9 }) } });
  ok('eşit süre (1 dk içinde): en hızlı yok', tieT.best.fast === null && /eşit/.test(tieT.notes.fast), tieT.notes.fast);
  const tieR = buildRouteOptions({ plans: { fast: plan([stop(A, { arriveSoc: 20.9 })], { totalMin: 280 }), cheap: plan([stop(B, { cost: 200, arriveSoc: 21.0 })], { totalMin: 300 }) } });
  ok('risk ölçütlerinin hepsi eşit: en düşük risk yok, ölçütler yine yazılı', tieR.best.risk === null && /eşit/.test(tieR.notes.risk) && RISK_CRITERIA.every((c) => tieR.notes.risk.includes(c)), tieR.notes.risk);
  const near = buildRouteOptions({ plans: { fast: plan([stop(A, { arriveSoc: 20.95 })], { totalMin: 280 }), cheap: plan([stop(B, { cost: 200, arriveSoc: 21.05 }), stop(C, { arriveSoc: 40 })], { totalMin: 300 }) } });
  ok('0,1 puan pil farkı (taban sınırını aşsa da) üstün sayılmaz: durak sayısı karar verir', near.best.risk === 'fast', near.best.risk);
  const big = buildRouteOptions({ plans: { fast: plan([stop(A, { arriveSoc: 18 })], { totalMin: 280 }), cheap: plan([stop(st('U2', { uncertain: true }), { cost: 200, arriveSoc: 25 })], { totalMin: 300 }) } });
  ok('pil farkı ≥ 1 puan ilk ölçüttür (belirsiz durağa rağmen)', big.best.risk === 'cheap');
}

// ---- Denetleyici: routeOptionPlans (ağsız; DOM için en küçük taklit) ----
{
  const el = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : el()), apply: () => el(), set: () => true });
  globalThis.document ??= el(); globalThis.window ??= globalThis;
  const { getState, patch } = await import('../js/state.js');
  const ctl = await import('../js/routing/controller.js');
  const { planRoute, rankStations } = await import('../js/routing/planner.js');
  const profile = { totalKm: 600, energyBetween: (a, b, k = 1) => Math.max(0, b - a) * 0.2 * k, timeBetween: (a, b) => Math.max(0, b - a) / 100 };
  const pst = (id, km, o = {}) => ({ id, name: id, km, kw: 180, price: 14, opId: 'x', slow: false, uncertain: false, offKm: 0.2, tariff: 'list', ...o });
  const stations = [pst('n60', 60, { kw: 300, price: 16 }), pst('h200', 200, { kw: 300, price: 16 }), pst('u210', 210, { kw: 150, price: 8 }), pst('h400', 400, { kw: 300, price: 16 }), pst('u410', 410, { kw: 150, price: 8 })];
  patch('route', { minArrivalSoc: 15 });
  ok('boş plan: null döner', ctl.routeOptionPlans() === null);
  patch('plan', { status: 'ready', profile, stations, mode: 'opt', fromKm: 0, fromSoc: 90, pinIds: [], banIds: [], forceFirstId: null, maxFirstStopKm: null, stops: [{ marker: 1 }], totals: { marker: 1 } });
  const k = ctl.planK().k;
  const args = { profile, stations, startKm: 0, startSoc: 90, minArrival: 15, k, mustIds: [], excludeIds: [], forceFirstId: null };

  // computePlan varsayılanı değişmedi: plan.mode + sıralama
  const d = ctl.computePlan({ fromKm: 0, soc: 90 });
  ok('computePlan varsayılanı plan.mode ile aynı', JSON.stringify(d.result) === JSON.stringify(planRoute({ ...args, mode: 'opt' })));
  ok('computePlan varsayılanı sıralamayı da üretir', d.ranking.length > 0 && JSON.stringify(d.ranking) === JSON.stringify(rankStations({ profile, stations, startKm: 0, startSoc: 90, k, mode: 'opt' })));
  ok('computePlan varsayılan ilk durak sınırı yok', d.maxFirstStopKm === Infinity);

  // Mevcut plan değişmez
  const before = getState('plan'); const snap = JSON.stringify(before); const stSnap = JSON.stringify(stations);
  const plans = ctl.routeOptionPlans();
  ok('üç modun planı döner', ['fast', 'cheap', 'opt'].every((m) => plans[m]?.feasible), JSON.stringify(Object.values(plans).map((p) => p?.reason)));
  ok('her mod gerçek planlayıcıyla aynı', ['fast', 'cheap', 'opt'].every((m) => JSON.stringify(plans[m]) === JSON.stringify(planRoute({ ...args, mode: m }))));
  ok('mevcut plan nesnesi ve içeriği değişmez', getState('plan') === before && JSON.stringify(getState('plan')) === snap);
  ok('istasyon listesi değişmez', JSON.stringify(stations) === stSnap);
  ok('mod seçimi değişmez', getState('plan').mode === 'opt');

  // maxFirstStopKm: canlı planın sınırı seçeneklerde de uygulanır
  const free = ctl.routeOptionPlans(['fast']).fast;
  ok('sınırsızken hızlı modun ilk durağı 100 km ötesinde (sınır anlamlı)', free.feasible && free.stops[0].km > 100, JSON.stringify(free.stops.map((s) => s.km)));
  patch('plan', { fromKm: 20, fromSoc: 70, maxFirstStopKm: 100 });
  const lim = ctl.routeOptionPlans();
  ok('ilk durak sınırı tüm modlarda uygulanır', ['fast', 'cheap', 'opt'].every((m) => !lim[m]?.feasible || lim[m].stops[0].km <= 100), JSON.stringify(Object.values(lim).map((p) => p?.stops?.[0]?.km)));
  ok('sınırlı modlar canlı planlayıcıyla aynı (başlangıç km/pil dahil)', ['fast', 'cheap', 'opt'].every((m) => JSON.stringify(lim[m]) === JSON.stringify(planRoute({ ...args, startKm: 20, startSoc: 70, maxFirstStopKm: 100, mode: m }))));
  ok('sınır olmadan farklı olurdu', JSON.stringify(lim.fast) !== JSON.stringify(planRoute({ ...args, startKm: 20, startSoc: 70, mode: 'fast' })));

  // applyPlan sınırı kaydeder (replanFrom) ve sınırsız yeniden planlamada temizler
  patch('plan', { fromKm: 0, fromSoc: 90, maxFirstStopKm: null });
  let drew = true;
  try { ctl.replanFrom({ km: 20, soc: 70, maxFirstStopKm: 100 }); } catch { drew = false; }
  if (drew) {
    ok('replanFrom sınırı plan durumuna yazar', getState('plan').maxFirstStopKm === 100 && getState('plan').stops[0].km <= 100);
    ctl.replanFrom({ km: 20, soc: 70, maxFirstStopKm: Infinity });
    ok('sınırsız yeniden planda sınır temizlenir', getState('plan').maxFirstStopKm === null);
  } else console.log('atlandı: replanFrom harita çizimi Node ortamında çalışmadı');

  // Kaynak denetimi: routeOptionPlans durum yazmaz
  const src = read('js/routing/controller.js');
  ok('routeOptionPlans plan durumuna yazmaz', !/patch\(/.test(src.split('export function routeOptionPlans')[1].split(/\r?\n\}\r?\n/)[0]));
}
// Arayüz (index.html, app.js, sw.js, routeOptionsView.js) denetimleri Faz B2'de kendi testinde.

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
