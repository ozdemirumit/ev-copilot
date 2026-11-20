// v0.99.99 — Pil (kamera OCR / elle) değişince ya da şarj planlanandan farklı bitince kalan planın ÖNERİ + ONAY ile yeniden hesaplanması.
// 1) Saf js/routing/socReplan.js: beklenen pil (geçilen durağın ayrılış pili), durakta mı, kalan toplamlar, kararlılık/geri çekilme kapısı.
// 2) livePlan.check() entegrasyonu (bağımlılıklar bellek içi sahte): kamera kabul/ret (canlı vs eski/tahmin), elle giriş, kararsız okuma,
//    şarj sürerken/hedefe ulaşınca/erken bırakınca, İptal/Onay, plan kurulamadı (sağlayıcı/hesap hatası).
// 3) Planlayıcı: düşük pil → sonraki durak seti/sırası değişir (planDiff), aynı pil → değişiklik yok.
// 4) Kaynak denetimi: önizleme ağsız ve planı değiştirmez; uygulama yalnız onayla. Ağ yok, anahtar yok. Kullanım: node scripts/test-soc-replan.mjs
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond || !extra ? '' : '— ' + extra); };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const near = (a, b, e = 0.01) => Math.abs(a - b) <= e;
globalThis.fetch = () => { throw new Error('ağ yasak'); };
const stored = new Map();
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) };

// ---------- 1) Saf yardımcılar ----------
const R = await import('../js/routing/socReplan.js');
const prof = { energyBetween: (a, b, k = 1) => Math.max(0, b - a) * 0.2 * k, timeBetween: (a, b) => Math.max(0, b - a) / 100 };
const planA = { profile: prof, fromKm: 0, fromSoc: 80, stops: [{ km: 100, leaveSoc: 70, minutes: 20, overheadMin: 5, cost: 100, station: { id: 'A' } }, { km: 300, leaveSoc: 60, minutes: 15, overheadMin: 5, cost: 80, station: { id: 'B' } }], totals: { totalMin: 400, arriveSoc: 20, cost: 180 } };
ok('beklenen pil: başlangıçtan düşülür (50 km → %70)', near(R.expectedSoc(planA, 50, 1, 100), 70));
ok('beklenen pil: geçilen durağın ayrılış pili esas (150 km → %60)', near(R.expectedSoc(planA, 150, 1, 100), 60));
ok('beklenen pil: plan yoksa null', R.expectedSoc({}, 10, 1, 100) === null);
ok('durakta: yakın ve duruyor → durak', R.stopHere(planA, 100.4, 0)?.station.id === 'A');
ok('durakta değil: hareket ediyor', R.stopHere(planA, 100.4, 40) === null);
ok('durakta değil: uzak', R.stopHere(planA, 103, 0) === null);
const rem = R.remainingTotals(planA, 150);
ok('kalan toplam: geçilen yol (1.5 sa=90 dk) ve geçilen durak (25 dk) düşülür', near(rem.totalMin, 400 - 90 - 25), rem.totalMin);
ok('kalan maliyet yalnız ileri duraklar', rem.cost === 80);

const G = R.createSocGate();
const tol = 4;
ok('kapı: eski kamera (stale) asla', G.step({ now: 0, soc: 50, source: 'stale', drift: 30, tolerance: tol }) === false && G.step({ now: 60e3, soc: 50, source: 'stale', drift: 30, tolerance: tol }) === false);
for (const s of ['estimate', 'default', 'none']) ok(`kapı: ${s} asla`, G.step({ now: 0, soc: 50, source: s, drift: 30, tolerance: tol }) === false && G.step({ now: 60e3, soc: 50, source: s, drift: 30, tolerance: tol }) === false);
ok('kapı: eşik altı sapma yok', G.step({ now: 0, soc: 50, source: 'live', drift: 4, tolerance: tol }) === false && G.step({ now: 60e3, soc: 50, source: 'live', drift: 4, tolerance: tol }) === false);
ok('kapı: ilk okuma hemen açmaz', G.step({ now: 0, soc: 50, source: 'live', drift: 10, tolerance: tol }) === false);
ok('kapı: 5 sn sonra henüz değil', G.step({ now: 5e3, soc: 50.5, source: 'live', drift: 10, tolerance: tol }) === false);
ok('kapı: 10 sn kararlı → açar', G.step({ now: 10e3, soc: 50, source: 'live', drift: 10, tolerance: tol }) === true);
G.open();
ok('kapı: açık öneri varken yenisi yok', G.step({ now: 20e3, soc: 50, source: 'live', drift: 10, tolerance: tol }) === false);
G.decline(50, 20e3);
G.step({ now: 21e3, soc: 50, source: 'live', drift: 10, tolerance: tol });
ok('kapı: İptal edilen değer 10 dk sorulmaz', G.step({ now: 40e3, soc: 51, source: 'live', drift: 10, tolerance: tol }) === false);
G.step({ now: 41e3, soc: 44, source: 'live', drift: 16, tolerance: tol });
ok('kapı: pil İptal değerinden ≥ eşik değişince yeniden açar', G.step({ now: 52e3, soc: 44, source: 'live', drift: 16, tolerance: tol }) === true);
const G2 = R.createSocGate();
G2.step({ now: 0, soc: 50, source: 'live', drift: 10, tolerance: tol });
G2.step({ now: 5e3, soc: 62, source: 'live', drift: 10, tolerance: tol });
ok('kapı: zıplayan okuma (50→62) adayı sıfırlar', G2.step({ now: 10e3, soc: 50, source: 'live', drift: 10, tolerance: tol }) === false);

// ---------- 2) livePlan.check() ----------
const S = (globalThis.__srStub = { state: {}, eff: {}, src: 'live', replans: [], previews: [], said: [], previewResult: null });
const g = 'globalThis.__srStub';
const STUBS = {
  '../state.js': `export const getState = (k) => ${g}.state[k]; export const effective = () => ${g}.eff; export const patch = () => {};`,
  '../config.js': 'export const VEHICLE = { batteryNetKwh: 100 };',
  './controller.js': `export const replanFrom = (o) => { ${g}.replans.push(o); return true; };
    export const previewSocReplan = (o) => { ${g}.previews.push(o); return ${g}.previewResult(o); };`,
  '../providers/index.js': 'export const fetchAvailability = async () => new Map();',
  './slots.js': 'export const slotKind = () => "free";',
  '../advisor/voice.js': `export const speak = (m) => { ${g}.said.push(m); };`,
  '../i18n/index.js': 'export const t = (s, ...a) => a.reduce((x, v, i) => x.replace("{" + i + "}", v), s);',
  '../net/proxy.js': 'export const proxyHas = () => false;',
  '../physics/socEstimate.js': `export const socSource = () => ${g}.src;`,
};
registerHooks({
  resolve(spec, ctx, next) {
    if (ctx.parentURL?.endsWith('/js/routing/livePlan.js') && spec in STUBS) return { url: 'data:text/javascript,' + encodeURIComponent(STUBS[spec]), format: 'module', shortCircuit: true };
    return next(spec, ctx);
  },
});
const timers = [];
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (fn, ms) => { timers.push({ fn, ms }); return 0; };
await import('../js/routing/livePlan.js');
const LP = await import('../js/routing/livePlan.js');
LP.initLivePlan();
globalThis.setInterval = realSetInterval;
const check = timers.find((x) => x.ms === 5000)?.fn;
ok('5 sn check zamanlayıcısı', typeof check === 'function');

const realNow = Date.now;
let now = 1e12;
Date.now = () => now;
const proposals = [];
R.setProposalSink((p) => proposals.push(p));
const okPreview = (o) => ({ ok: true, preview: { soc: o.soc, km: o.fromKm, diff: { same: false, added: ['X'], removed: [], changed: [], orderChanged: false }, out: {}, next: { fromKm: o.fromKm, fromSoc: o.soc } } });
function setup({ src = 'live', soc = 60, km = 20, speed = 80, stops = [{ km: 200, leaveSoc: 80, station: { id: 'A' } }], nav = true } = {}) {
  for (const p of proposals) p.onDone(true); // önceki senaryonun açık önerisi kapanır (arayüz her zaman onDone çağırır)
  now += 15 * 60e3; // önceki senaryonun bekleme/geri çekilmesi biter
  S.src = src; S.replans = []; S.previews = []; S.said = []; proposals.length = 0; S.previewResult = okPreview;
  S.state = { plan: { status: 'ready', planId: 'p1', profile: prof, fromKm: 0, fromSoc: 80, stops, kInfo: { k: 1 } }, engine: { routeKm: km, offRouteKm: 0, k: 1 }, nav: { active: nav } };
  S.eff = { source: 'live', soc, speed };
}
const tick = (n = 1, set = {}) => { for (let i = 0; i < n; i++) { Object.assign(S.eff, set); check(); now += 5000; } };

// 20 km'de beklenen %76; kamera %60 okuyor (sapma 16; 25 km tazelemesi henüz yok)
setup({ src: 'live' });
tick(1);
ok('kamera kabul: ilk okumada öneri yok (kararlılık)', proposals.length === 0 && S.replans.length === 0);
tick(2);
ok('kamera kabul: 10 sn kararlı → öneri gösterildi', proposals.length === 1, JSON.stringify(S.previews));
ok('kamera kabul: plan otomatik değişmedi (replanFrom yok)', S.replans.length === 0);
ok('öneri doğru km/pil ile hazırlandı', S.previews[0]?.km === 20 && S.previews[0]?.soc === 60 && S.previews[0]?.fromKm === 20);
ok('öneri nedeni: pil sapması', proposals[0]?.why === 'soc');

for (const s of ['stale', 'estimate', 'default', 'none']) {
  setup({ src: s });
  tick(6);
  ok(`kamera reddi/eskisi (${s}): öneri yok, önizleme hesaplanmadı, plan değişmedi`, proposals.length === 0 && S.previews.length === 0 && S.replans.length === 0);
}
setup({ src: 'manual' });
tick(3);
ok('elle giriş: kararlı değer → öneri', proposals.length === 1 && S.replans.length === 0);
setup({ src: 'manual' });
tick(1, { soc: 40 }); tick(1, { soc: 55 }); tick(1, { soc: 30 }); tick(1, { soc: 62 });
ok('elle sürgü sürükleniyor (değer oturmadı): öneri yok', proposals.length === 0);

// İptal → plan aynen; aynı değer tekrar sorulmaz; belirgin değişince yeniden sorulur
setup({ src: 'live' });
tick(3);
proposals[0]?.onDone(false);
const n0 = S.previews.length;
tick(30);
ok('İptal: aynı pilde 2,5 dk boyunca yeniden önizleme/öneri yok, replanFrom yok', S.previews.length === n0 && proposals.length === 1 && S.replans.length === 0);
tick(3, { soc: 50 });
ok('İptal sonrası pil belirgin değişti (%60→%50): yeni öneri', proposals.length === 2);
proposals[1]?.onDone(true);

// Sağlayıcı/hesap hatası: önizleme kurulamaz → öneri yok, plan değişmez, rota dışı onayı açılmaz
setup({ src: 'live' });
S.previewResult = () => ({ ok: false, reason: 'Plan hesaplanamadı: sağlayıcı yanıt vermedi' });
tick(3);
ok('plan kurulamadı: öneri yok, replanFrom yok', proposals.length === 0 && S.previews.length === 1 && S.replans.length === 0);
tick(10);
ok('plan kurulamadı: aynı değerde tekrar tekrar hesaplanmaz', S.previews.length === 1);
setup({ src: 'live' });
S.previewResult = (o) => ({ ok: true, preview: { soc: o.soc, diff: { same: true } } });
tick(3);
ok('önizleme planı değiştirmiyor (same): öneri gösterilmez', proposals.length === 0);

// Şarj durağı: durakta (200 km, duruyor), hedef %80
const atStop = { km: 200.2, speed: 0, stops: [{ km: 200, leaveSoc: 80, station: { id: 'A' } }, { km: 400, leaveSoc: 70, station: { id: 'B' } }] };
setup({ src: 'live', soc: 45, ...atStop });
tick(6);
ok('şarj sürüyor (hedefin altında): öneri yok', proposals.length === 0 && S.replans.length === 0);
tick(4, { soc: 80 });
ok('hedefe ulaşıldı: bir kez söylendi, öneri yok (plan zaten bu hedefle)', S.said.filter((m) => /hedefine ulaşıldı/.test(m)).length === 1 && proposals.length === 0);
tick(4, { soc: 92 });
ok('hedef belirgin aşıldı: sonraki duraklar önerildi (durağın ötesinden)', proposals.length === 1 && proposals[0].why === 'charge' && S.previews.at(-1).fromKm > 200 && S.previews.at(-1).fromKm < 201);
// Erken bırakma: %62'de durakttan ayrıldı (hedef %80) → 210 km'de beklenen %78, okunan %60
setup({ src: 'live', soc: 60, km: 210, speed: 70, stops: atStop.stops });
tick(3);
ok('şarj erken bitti: kalkışta öneri (neden: şarj)', proposals.length === 1 && proposals[0].why === 'charge' && S.replans.length === 0);
// Planlandığı gibi şarj (%80'de ayrıldı, 210 km'de %78): öneri yok, durak geçildi → olağan tazeleme
setup({ src: 'live', soc: 78, km: 210, speed: 70, stops: atStop.stops });
tick(1);
ok('planlandığı gibi şarj: öneri yok, geçilen durak tazelemesi', proposals.length === 0 && S.replans.length === 1 && S.replans[0].soc === 78);
// Tahmin kaynağında geçilen durak: tahmini pil (şarjı görmez) planı değiştirmez — planın beklentisi kullanılır
setup({ src: 'estimate', soc: 30, km: 210, speed: 70, stops: atStop.stops });
tick(1);
ok('tahmini pil: öneri yok; tazeleme planın beklentisiyle (%78), %30 ile değil', proposals.length === 0 && S.replans.length === 1 && near(S.replans[0].soc, 78), JSON.stringify(S.replans));
// Durmuş ve pil beklentinin üstünde (plan dışı şarj): kalkışa kadar öneri yok
setup({ src: 'live', soc: 90, km: 20, speed: 0 });
tick(6);
ok('plan dışı yerde şarj (duruyor, pil yükseliyor): öneri yok', proposals.length === 0);
Date.now = realNow;

// ---------- 3) Planlayıcı: alt akış ----------
const { planRoute } = await import('../js/routing/planner.js');
const { planDiff } = await import('../js/routing/stopTarget.js');
const st = (id, km) => ({ id, name: id, km, lat: 40, lon: 30, kw: 180, price: 10, opId: 'x', opName: 'X', slow: false, offKm: 0, tariffSrc: 'published' });
const stations = [100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600].map((k) => st('s' + k, k));
const profile = { totalKm: 700, energyBetween: (a, b, k = 1) => Math.max(0, b - a) * 0.2 * k, timeBetween: (a, b) => Math.max(0, b - a) / 100 };
const basePlan = { profile, stations, minArrival: 15, mode: 'fast', k: 1 };
const planned = planRoute({ ...basePlan, startKm: 50, startSoc: 70 });
const lower = planRoute({ ...basePlan, startKm: 50, startSoc: 35 });
const same = planRoute({ ...basePlan, startKm: 50, startSoc: 70 });
ok('planlanan ve düşük pil planları kurulur', planned.feasible && lower.feasible, lower.reason);
const dLow = planDiff({ stops: planned.stops, totals: planned.totals }, { stops: lower.stops, totals: lower.totals });
ok('düşük pil: ilk durak daha erken', lower.stops[0].km < planned.stops[0].km, `${lower.stops[0].km} vs ${planned.stops[0].km}`);
ok('düşük pil: durak seti/sırası değişti (eklenen/çıkan/değişen)', dLow.added.length + dLow.removed.length + dLow.changed.length > 0 && !dLow.same);
const lower1 = planRoute({ ...basePlan, startKm: 50, startSoc: 36 });
ok('düşük pil: ilk duraktaki varış pili yeni pilden türer (+1 puan → +1 puan)', lower1.stops[0].km === lower.stops[0].km && near(lower1.stops[0].arriveSoc - lower.stops[0].arriveSoc, 1), `${lower1.stops[0].arriveSoc} vs ${lower.stops[0].arriveSoc}`);
ok('aynı pil: plan farkı yok (öneri açılmaz)', planDiff({ stops: planned.stops, totals: planned.totals }, { stops: same.stops, totals: same.totals }).same === true);

// ---------- 4) Kaynak denetimi ----------
const ctl = read('js/routing/controller.js');
const fnBody = (raw, name) => { const src = raw.replace(/\r\n/g, '\n'); const i = src.indexOf(`export function ${name}(`); return i < 0 ? '' : src.slice(i, src.indexOf('\n}\n', i)); }; // CRLF çalışma kopyasında (autocrlf) da doğru keser
const pv = fnBody(ctl, 'previewSocReplan');
ok('controller: previewSocReplan var', !!pv);
ok('önizleme planı değiştirmez, ağ yok, rota dışı onayı açmaz', !/applyPlan\(|patch\(|fetch|await|offerAlternatives/.test(pv));
ok('önizleme hesap hatasını yakalar (mevcut plan kalır)', /try\s*\{[\s\S]*computePlan[\s\S]*catch/.test(pv));
ok('önizleme planId + tripSeq taşır (onayda bayatlık denetimi)', /planId/.test(pv) && /tripSeq/.test(pv));
const lp = read('js/routing/livePlan.js');
ok('livePlan: SOC sapmasında doğrudan replanFrom yok, öneri (propose) var', /propose\(e\.soc/.test(lp) && /trusted && drift > SOC_TOLERANCE/.test(lp));
const ui = read('js/ui/socReplan.js');
ok('ui: tek uygulama noktası (applyStopTarget) Onayla düğmesinde', (ui.match(/applyStopTarget\(/g) || []).length === 1 && /sr-apply/.test(ui));
ok('ui: İptal/kapat yalnız finish(false)', /sr-cancel/.test(ui) && /const close = \(\) => \{ finish\(false\); dlg\.close\(\); \}/.test(ui));
ok('ui: ham OCR ile doğrulanmış değer ayrı, güven ve son okuma yaşı', /o\.raw/.test(ui) && /o\.accepted/.test(ui) && /reliability/.test(ui) && /readAt/.test(ui));
const html = read('index.html');
ok('index.html: öneri penceresi', /id="soc-replan-dialog"/.test(html) && /id="sr-apply"/.test(html) && /id="sr-cancel"/.test(html) && /id="sr-diff"/.test(html));
ok('app.js: initSocReplan çağrılır', /initSocReplan\(\)/.test(read('js/app.js')));

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
