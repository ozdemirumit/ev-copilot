// SOC güven kapısı (aşama 1). Kullanım: node scripts/test-soc-trust.mjs
// 1) Saf yardımcı js/routing/socTrust.js: hangi pil kaynağı SOC farkıyla otomatik yeniden plan tetikleyebilir.
// 2) js/routing/livePlan.js check(): kaynak live/manual (ya da Test Modu sim) değilse — stale/estimate/default/none — plan beklentisinden
//    sapma TEK BAŞINA replanFrom çağırmaz; geçilen durak ve 25 km tazeleme normal çalışmaya devam eder.
// Ağ yoktur, anahtar/sır yoktur; livePlan'in tüm bağımlılıkları bellek içi sahtedir.
import { registerHooks } from 'node:module';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond || !extra ? '' : '— ' + extra); };

globalThis.fetch = () => { throw new Error('ağ yasak'); };

// ---------- 1) Saf yardımcı ----------
const T = await import('../js/routing/socTrust.js');
for (const s of ['live', 'manual', 'sim']) ok(`socTrusted('${s}') → true`, T.socTrusted(s) === true);
for (const s of ['stale', 'estimate', 'default', 'none', null, undefined, '', 'LIVE']) ok(`socTrusted(${JSON.stringify(s)}) → false`, T.socTrusted(s) === false);

const base = { passed: false, far: false, drift: 0, tolerance: 4, source: 'live' };
ok('shouldReplan: hiçbir koşul yok → false', T.shouldReplan(base) === false);
ok('shouldReplan: live + sapma > tolerans → true', T.shouldReplan({ ...base, drift: 6 }) === true);
ok('shouldReplan: manual + sapma > tolerans → true', T.shouldReplan({ ...base, drift: 6, source: 'manual' }) === true);
ok('shouldReplan: sapma = tolerans → false (eşik aynen korunur)', T.shouldReplan({ ...base, drift: 4 }) === false);
for (const s of ['stale', 'estimate', 'default', 'none']) {
  ok(`shouldReplan: ${s} + sapma tek başına → false`, T.shouldReplan({ ...base, drift: 30, source: s }) === false);
  ok(`shouldReplan: ${s} + geçilen durak → true`, T.shouldReplan({ ...base, drift: 30, source: s, passed: true }) === true);
  ok(`shouldReplan: ${s} + 25 km tazeleme → true`, T.shouldReplan({ ...base, drift: 30, source: s, far: true }) === true);
}
ok('shouldReplan: drift NaN → false', T.shouldReplan({ ...base, drift: NaN }) === false);

// ---------- 2) livePlan.check() entegrasyonu ----------
const S = (globalThis.__stStub = { state: {}, eff: {}, src: 'live', replans: [], patches: [] });
const g = 'globalThis.__stStub';
const STUBS = {
  '../state.js': `
    export const getState = (k) => ${g}.state[k];
    export const effective = () => ${g}.eff;
    export const patch = (k, v) => { ${g}.patches.push([k, v]); };`,
  '../config.js': 'export const VEHICLE = { batteryNetKwh: 100 };',
  './controller.js': `export const replanFrom = (o) => { ${g}.replans.push(o); };`,
  '../providers/index.js': 'export const fetchAvailability = async () => new Map();',
  './slots.js': 'export const slotKind = () => "free";',
  '../advisor/voice.js': 'export const speak = () => {};',
  '../i18n/index.js': 'export const t = (s) => s;',
  '../net/proxy.js': 'export const proxyHas = () => false;',
  '../physics/socEstimate.js': `export const socSource = () => ${g}.src;`,
};
registerHooks({
  resolve(spec, ctx, next) {
    if (ctx.parentURL?.endsWith('/js/routing/livePlan.js') && spec in STUBS) return { url: 'data:text/javascript,' + encodeURIComponent(STUBS[spec]), format: 'module', shortCircuit: true };
    return next(spec, ctx);
  },
});

// initLivePlan check'i setInterval ile kurar: geri çağrıyı yakala (gerçek zamanlayıcı kurulmaz).
const timers = [];
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (fn, ms) => { timers.push({ fn, ms }); return 0; };
const LP = await import('../js/routing/livePlan.js');
LP.initLivePlan();
globalThis.setInterval = realSetInterval;
const check = timers.find((x) => x.ms === 5000)?.fn;
ok('initLivePlan: 5 sn check zamanlayıcısı kuruldu', typeof check === 'function');
ok('initLivePlan: doluluk zamanlayıcısı korunuyor (30 sn)', timers.some((x) => x.ms === 30000));
ok('livePlan API korunuyor (initLivePlan, refreshAvailability)', typeof LP.initLivePlan === 'function' && typeof LP.refreshAvailability === 'function');

// Plan: 0. km'de %80 ile başladı, km başına 0,2 kWh (100 kWh batarya → km başına 0,2 puan). 10. km'de beklenen %78.
const realNow = Date.now;
let now = 1e12;
Date.now = () => now;
function scenario({ src, soc = 60, km = 10, stops = [{ km: 100 }], simSrc = false }) {
  now += 60_000; // COOLDOWN_MS (45 sn) her senaryoda aşılır
  S.src = src;
  S.replans = []; S.patches = [];
  S.state = {
    plan: { status: 'ready', profile: { energyBetween: (a, b, k) => (b - a) * 0.2 * k }, fromKm: 0, fromSoc: 80, stops, kInfo: { k: 1 } },
    engine: { routeKm: km, offRouteKm: 0, k: 1 },
    nav: { active: true },
  };
  S.eff = { source: simSrc ? 'sim' : 'live', soc, speed: 80 };
  check();
  return S.replans;
}

// SOC farkı 18 puan (beklenen 78, okunan 60) — tek tetikleyici bu.
ok('live: SOC farkı → replan', scenario({ src: 'live' }).length === 1);
ok('manual: SOC farkı → replan', scenario({ src: 'manual' }).length === 1);
ok('Test Modu (sim): SOC farkı → replan (sürgü kullanıcı girdisi)', scenario({ src: 'default', simSrc: true }).length === 1);
for (const s of ['stale', 'estimate', 'default', 'none']) {
  ok(`${s}: SOC farkı tek başına → replan YOK`, scenario({ src: s }).length === 0);
}
ok('live: küçük fark (≤ 4 puan) → replan yok', scenario({ src: 'live', soc: 76 }).length === 0);

// Diğer normal yenilemeler güvenilmeyen kaynakta da çalışır.
for (const s of ['stale', 'estimate', 'default']) {
  const r = scenario({ src: s, stops: [{ km: 5 }, { km: 100 }] });
  ok(`${s}: geçilen durak → replan (lastStopKm yazıldı)`, r.length === 1 && S.patches.some(([k, v]) => k === 'plan' && v.lastStopKm === 5));
  ok(`${s}: 25 km tazeleme → replan`, scenario({ src: s, km: 30, soc: 74 - 20 }).length === 1);
}
const r0 = scenario({ src: 'estimate', km: 30, soc: 40 });
ok('replanFrom argümanları değişmedi (km, soc, maxFirstStopKm: Infinity)', r0[0]?.km === 30 && r0[0]?.soc === 40 && r0[0]?.maxFirstStopKm === Infinity, JSON.stringify(r0[0]));

// Bekleme süresi (cooldown) korunur
scenario({ src: 'live' });
now += 1000;
check();
ok('cooldown: 45 sn içinde ikinci replan yok', S.replans.length === 1);

Date.now = realNow;
console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
