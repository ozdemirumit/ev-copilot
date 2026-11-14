// BL-P0-05: düşük pil / plan "ulaşılamıyor" iken navigasyonda otomatik şarj durağı (goTo(card, { auto: true }) → planTrip via)
// yalnızca güvenilir SOC kaynağıyla (socTrust.js: 'live', 'manual', 'sim') yapılır. Tahmin/eski/varsayılan pilde uyarı paneli ve
// sesli öneri sürer ama rota kendiliğinden değişmez. Kullanım: node scripts/test-auto-via-trust.mjs
// nearby.js gerçek modülüyle (state.js, chargePick.js, nearSort.js gerçek) çalışır; ağ, harita, ses, planlayıcı sahtedir (ücretli API yok).
import { registerHooks } from 'node:module';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond || !extra ? '' : '— ' + extra); };

globalThis.fetch = () => { throw new Error('ağ yasak'); };
const stored = new Map();
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) };
// DOM: her şeyi yutan sahte öğe (nearby.js panel çizimi testin konusu değil)
const fakeEl = () => new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : k === 'children' || k === 'childNodes' ? [] : fakeEl()),
  set: () => true,
  apply: () => fakeEl(),
});
globalThis.document = { getElementById: () => fakeEl(), querySelector: () => null, querySelectorAll: () => [], createElement: () => fakeEl(), addEventListener: () => {} };

const S = (globalThis.__avStub = { via: [], speaks: [], source: 'live', stations: [] });
const g = 'globalThis.__avStub';
const STUBS = {
  '../providers/index.js': `export const fetchAround = async () => ({ stations: ${g}.stations, errors: [], cached: false });`,
  '../routing/controller.js': `export const planTrip = (start, opts) => { ${g}.via.push(opts?.via?.id ?? null); return new Promise(() => {}); };`,
  '../ui/mapView.js': 'export const mapApi = new Proxy({}, { get: () => () => {} });',
  '../ui/toast.js': 'export const toast = () => {};',
  '../advisor/voice.js': `export const speak = (m, o) => { ${g}.speaks.push(o?.key); };`,
  '../routing/occupancyClient.js': 'export const fetchAvailability = async () => new Map();',
  '../net/proxy.js': 'export const proxyHas = () => false;',
  './navigator.js': 'export const startNav = () => {}; export const syncTopPanel = () => {};',
  '../ui/icons.js': 'export const icon = () => "";',
  '../ui/moreToggle.js': 'export const paintMore = () => {};',
  '../routing/planner.js': 'export const brandOk = () => true;',
  '../routing/powerFilter.js': 'export const loosenPower = () => ({ min: 0, from: 0, loosened: false }); export const paintPowerNote = () => {};',
  '../physics/socEstimate.js': `export const socSource = () => ${g}.source; export const measuredSoc = (e) => e.soc;`,
};
registerHooks({
  resolve(spec, ctx, next) {
    if (ctx.parentURL?.split('?')[0].endsWith('/js/nav/nearby.js') && spec in STUBS) return { url: 'data:text/javascript,' + encodeURIComponent(STUBS[spec]), format: 'module', shortCircuit: true };
    return next(spec, ctx);
  },
});

const { patch, getState } = await import('../js/state.js');
const HERE = { lat: 39.9, lon: 32.85 };
const DEST = { lat: 41.0, lon: 29.0, label: 'Varış' };
// 2 km ötede 180 kW hızlı istasyon: %12 pille ulaşılabilir (varış ≥ 5)
S.stations = [{ id: 'st-1', name: 'Hızlı İstasyon', lat: 39.918, lon: 32.85, kw: 180, price: 10, brand: 'X', slow: false }];

/** Her senaryo yeni nearby.js örneği (lastAutoVia/bands modül durumu sıfırlansın). */
let n = 0;
async function scenario({ source, sim = false }) {
  S.via = []; S.speaks = []; S.source = source;
  patch('sim', { enabled: sim, soc: 12, speed: 80, lat: HERE.lat, lon: HERE.lon });
  patch('live', { soc: 12, speed: 80, lat: HERE.lat, lon: HERE.lon });
  patch('nav', { active: true, lowSoc: 20 });
  patch('advisor', { level: 'bad' });
  patch('route', { end: DEST });
  patch('plan', { stops: [], status: 'ok', profile: { project: () => ({}) }, steps: [] });
  const nb = await import('../js/nav/nearby.js?s=' + n++);
  await nb.refreshNearby({ force: true, silent: true });
  await new Promise((r) => setTimeout(r, 0));
  return { via: [...S.via], speaks: [...S.speaks], alert: getState('nav').alert };
}

// Güvenilir kaynaklar: mevcut davranış korunur (otomatik durak eklenir)
for (const source of ['live', 'manual']) {
  const r = await scenario({ source });
  ok(`güvenilir '${source}': otomatik rota istasyon üzerinden güncellenir`, r.via.length === 1 && r.via[0] === 'st-1', JSON.stringify(r.via));
  ok(`güvenilir '${source}': sesli düşük pil önerisi`, r.speaks.some((k) => String(k).startsWith('low')), JSON.stringify(r.speaks));
}
{
  const r = await scenario({ source: 'estimate', sim: true }); // Test Modu sürgüsü: e.source 'sim' güvenilir sayılır
  ok("Test Modu 'sim': otomatik rota güncellenir", r.via.length === 1 && r.via[0] === 'st-1', JSON.stringify(r.via));
}

// Güvenilmeyen kaynaklar: uyarı + ses sürer, rota kendiliğinden değişmez
for (const source of ['estimate', 'stale', 'default', 'none']) {
  const r = await scenario({ source });
  ok(`güvenilmez '${source}': otomatik rota DEĞİŞMEZ (planTrip çağrılmaz)`, r.via.length === 0, JSON.stringify(r.via));
  ok(`güvenilmez '${source}': uyarı paneli yine gösterilir`, !!r.alert, JSON.stringify(r.alert)?.slice(0, 80));
  ok(`güvenilmez '${source}': sesli düşük pil önerisi yine yapılır`, r.speaks.some((k) => String(k).startsWith('low')), JSON.stringify(r.speaks));
  ok(`güvenilmez '${source}': başlıkta "(rota otomatik güncellendi)" yazmaz`, !String(r.alert?.title ?? r.alert ?? '').includes('otomatik güncellendi'));
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
