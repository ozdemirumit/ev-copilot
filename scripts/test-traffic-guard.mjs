// Canlı trafik sağlayıcı koruması testleri: node scripts/test-traffic-guard.mjs
// 1) js/nav/trafficGuard.js saf matris (fail-closed). 2) js/nav/ahead.js refreshTraffic entegrasyonu: ahead.js'in içe aktardığı her şey
// (trafficGuard.js hariç) bellek içi sahtelerle değiştirilir; setInterval ile yakalanan check() sürülür. Ağ engellidir, anahtar/sır yoktur.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond || !extra ? '' : '— ' + extra); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let netCalls = 0;
globalThis.fetch = () => { netCalls++; throw new Error('ağ yasak'); };
globalThis.XMLHttpRequest = function () { netCalls++; throw new Error('ağ yasak'); };
globalThis.WebSocket = function () { netCalls++; throw new Error('ağ yasak'); };

// Konsol çıktısı yakalanır: ham sağlayıcı verisi / sahte anahtar sızmamalı
const logs = [];
for (const k of ['log', 'info', 'warn', 'error', 'debug']) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { if (k !== 'log') logs.push([k, a]); orig(...a); };
}
const SENTINEL = 'RAW_PAYLOAD_SENTINEL_x9';
const FAKE_KEY = 'pk.FAKEKEY_not_real_123';

// ---------------------------------------------------------------- 1) Saf koruma matrisi
const G = await import('../js/nav/trafficGuard.js');
{
  const vals = ['tomtom', 'mapbox', 'osm', 'here', 'google', null, undefined, '', 'TomTom', ' mapbox', 'mapbox ', 123, {}, ['mapbox'], true];
  const maps = ['tomtom', 'mapbox', 'osm', 'google', 'here', null, undefined, '', 'TOMTOM'];
  const want = (r, t, m) => (r === 'mapbox' && t === 'mapbox') || (r === 'tomtom' && t === 'tomtom' && m === 'tomtom');
  let bad = [], allows = 0, n = 0;
  for (const r of vals) for (const t of vals) for (const m of maps) {
    n++;
    const res = G.trafficUse({ routeProvider: r, trafficSource: t, map: m });
    const exp = want(r, t, m);
    if (exp) allows++;
    if (res.ok !== exp || !Object.isFrozen(res) || typeof res.reason !== 'string') bad.push(`${String(r)}/${String(t)}/${String(m)}`);
  }
  ok(`matris: ${n} birleşim, yalnızca tomtom→tomtom@tomtom ve mapbox→mapbox@her harita izinli`, bad.length === 0, bad.slice(0, 5).join(', '));
  ok('matris: izinli birleşim sayısı tam 1 + 9', allows === 10);
  ok('argümansız çağrı reddedilir', G.trafficUse().ok === false && G.trafficUse({}).ok === false);
  ok('gerekçe: farklı sağlayıcı', G.trafficUse({ routeProvider: 'tomtom', trafficSource: 'mapbox', map: 'tomtom' }).reason === 'provider-mismatch');
  ok('gerekçe: TomTom haritası dışında TomTom', G.trafficUse({ routeProvider: 'tomtom', trafficSource: 'tomtom', map: 'osm' }).reason === 'tomtom-needs-tomtom-map');
  ok('gerekçe: osm/here desteklenmez', G.trafficUse({ routeProvider: 'osm', trafficSource: 'osm', map: 'osm' }).reason === 'unsupported-provider' && G.trafficUse({ routeProvider: 'here', trafficSource: 'here', map: 'here' }).ok === false);
  ok('gerekçe: rota sağlayıcısı yok / trafik kaynağı yok', G.trafficUse({ trafficSource: 'mapbox' }).reason === 'no-route-provider' && G.trafficUse({ routeProvider: 'mapbox' }).reason === 'no-traffic-source');
  const inp = Object.freeze({ routeProvider: 'mapbox', trafficSource: 'mapbox', map: 'osm' });
  ok('dondurulmuş girdi kabul edilir, değiştirilmez', G.trafficUse(inp).ok === true);
  const res = G.trafficUse({ routeProvider: 'mapbox', trafficSource: 'mapbox', map: 'osm', extra: SENTINEL });
  ok('sonuç yalnızca ok + sabit gerekçe (girdi yansıtılmaz)', eq(Object.keys(res).sort(), ['ok', 'reason']) && !JSON.stringify(res).includes(SENTINEL));
  const gsrc = readFileSync(new URL('../js/nav/trafficGuard.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  ok('statik: trafficGuard.js saf (import/fetch/DOM/depolama/process/console yok)', !/\bimport\b|fetch\(|document|window|localStorage|process\.|console\./.test(gsrc));
}

// ---------------------------------------------------------------- 2) ahead.js refreshTraffic entegrasyonu
const H = (globalThis.__at = {
  state: null, map: null, traffic: [], weather: 0, upd: [], setTraffic: [], speak: [], patches: [], interval: null,
  sameRoad: true,
});
const STUBS = {
  '../state.js': `const H = globalThis.__at;
    export const getState = (k) => H.state[k];
    export const patch = (k, v) => { H.patches.push([k, v]); H.state[k] = { ...H.state[k], ...v }; };
    export const subscribe = () => {};
    export const effective = () => H.state.eff;`,
  '../utils/storage.js': 'export const save = () => {}; export const load = () => null;',
  '../providers/index.js': `const H = globalThis.__at;
    export const fetchWeather = () => { H.weather++; return new Promise(() => {}); };
    export const fetchTrafficAhead = (...a) => new Promise((res, rej) => H.traffic.push({ a, res, rej }));`,
  '../advisor/voice.js': 'export const speak = (...a) => globalThis.__at.speak.push(a);',
  './speedLimit.js': 'export const currentLimit = () => null;',
  '../routing/controller.js': 'export const updateAhead = (o) => globalThis.__at.upd.push(o);',
  '../routing/aheadUpdate.js': 'export const wxQueryKms = () => [];',
  '../ui/mapView.js': 'export const mapApi = { setTraffic: (...a) => globalThis.__at.setTraffic.push(a) };',
  './track.js': 'export const buildTrack = (c) => c; export const locate = () => ({ offKm: globalThis.__at.sameRoad ? 0 : 5 });',
  '../net/activeMap.js': 'export const activeMap = () => globalThis.__at.map;',
};
registerHooks({
  resolve(spec, ctx, next) {
    if (ctx.parentURL?.endsWith('/js/nav/ahead.js') && spec in STUBS) {
      return { url: 'data:text/javascript,' + encodeURIComponent(STUBS[spec]), format: 'module', shortCircuit: true };
    }
    return next(spec, ctx);
  },
});
const asrc = readFileSync(new URL('../js/nav/ahead.js', import.meta.url), 'utf8');
const unstubbed = [...asrc.matchAll(/from '(\.\.?\/[^']+)'/g)].map((m) => m[1]).filter((s) => !(s in STUBS) && s !== './trafficGuard.js');
ok('ahead.js içe aktarmalarının tamamı sahte (trafficGuard hariç)', unstubbed.length === 0, unstubbed.join(', '));

// DOM / zamanlayıcı / saat sahteleri
const el = () => ({ value: 0, textContent: '', classList: { toggle() {} }, replaceChildren() {}, addEventListener() {} });
globalThis.document = { getElementById: () => el(), createElement: () => ({}) };
globalThis.setInterval = (fn) => { H.interval = fn; return 1; };
let clock = 1_700_000_000_000;
Date.now = () => clock;

const A = await import('../js/nav/ahead.js');
H.state = { nav: { speedAlert: 0, ahead: {} } }; // initAhead yalnızca kaydırıcı ve render için okur
A.initAhead();
const check = H.interval;
ok('initAhead check() zamanlayıcısını kurar', typeof check === 'function');

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
let pid = 0;
const ROUTE_COORDS = [[28, 40], [28, 40.01], [28, 40.02]];
function freshState({ provider = 'mapbox', meta = true, route = true } = {}) {
  const rt = route ? { coords: ROUTE_COORDS, durationH: 1, ...(meta ? { routeMeta: Object.freeze({ provider }) } : {}) } : null;
  H.state = {
    eff: { lat: 40, lon: 28, speed: 0 },
    nav: { active: true, speedAlert: 0, ahead: { rain: null, traffic: null, speed: null, grade: null, cam: null }, liveRemain: null },
    plan: { planId: 'p' + ++pid, profile: { totalKm: 100, pointAt: () => ({ lat: 40, lon: 28 }), timeBetween: () => 0 }, route: rt },
    engine: { routeKm: 10, offRouteKm: 0 },
    route: { end: { lat: 41, lon: 29 } },
  };
}
const reset = () => Object.assign(H, { traffic: [], upd: [], setTraffic: [], speak: [], patches: [] });
const trafficResult = (src, { jam = true, delayMin = 7 } = {}) => ({
  jam: jam ? { from: 5, to: 8, jam: true } : null, delayMin, remainH: 1.25, trafficSource: src,
  rt: { coords: ROUTE_COORDS, trafficSpans: [{ from: 0.1, to: 0.3, lvl: 'heavy' }], raw: SENTINEL, key: FAKE_KEY },
});
/** Yeni plan + tek trafik yenilemesi başlatır; çözülmemiş istek döner. Sonra yağmur/kamera alanları uyarı içeriği olarak doldurulur. */
async function start(opts) {
  freshState(opts);
  reset();
  clock += 11 * 60e3;
  check(); // plan değişti → trAt=0 → refreshTraffic
  H.state.nav = { ...H.state.nav, ahead: { ...H.state.nav.ahead, rain: '🌧️ yağmur', cam: '📷 kamera', grade: '⛰️ eğim' } };
  const q = H.traffic;
  reset();
  return q;
}
const ahead = () => H.state.nav.ahead;
const noEffects = () => H.upd.length === 0 && H.setTraffic.length === 0 && H.speak.length === 0 && !H.patches.some(([k, v]) => k === 'nav' && 'liveRemain' in v);
const unrelatedKept = () => ahead().rain === '🌧️ yağmur' && ahead().cam === '📷 kamera' && ahead().grade === '⛰️ eğim';

async function run(name, { provider = 'mapbox', meta, route, map, src, res, during, expectAllowed, jam, delayMin }) {
  H.map = map;
  const q = await start({ provider, meta, route });
  ok(`${name}: tek trafik isteği (ek ücretli çağrı yok), aynı argümanlar`, q.length === 1 && q[0].a[0] === H.state.eff && q[0].a[1] === H.state.route.end);
  const planBefore = H.state.plan.planId;
  if (during) during();
  q[0].res(res !== undefined ? res : trafficResult(src, { jam, delayMin }));
  await flush();
  if (expectAllowed) {
    ok(`${name}: hız/enerji güncellenir (updateAhead, aynı planId)`, H.upd.length === 1 && H.upd[0].planId === planBefore && H.upd[0].km === 10 && H.upd[0].rt.coords === ROUTE_COORDS);
    ok(`${name}: trafik renkleri çizilir`, H.setTraffic.length === 1 && H.setTraffic[0][0] === ROUTE_COORDS);
    ok(`${name}: canlı kalan süre yazılır`, H.state.nav.liveRemain?.h === 1.25);
  } else {
    ok(`${name}: hız/enerji/renk/süre/ses değişmez`, noEffects(), JSON.stringify({ upd: H.upd.length, st: H.setTraffic.length, sp: H.speak.length }));
    ok(`${name}: trafik metni silinir, diğer uyarılar korunur`, ahead().traffic === null && unrelatedKept());
  }
}

// İzin verilen: davranış aynen (metin + ses)
await run('mapbox→mapbox @osm', { provider: 'mapbox', map: 'osm', src: 'mapbox', expectAllowed: true });
ok('mapbox→mapbox: yoğun trafik metni ve ses', /yoğun trafik \(3\.0 km\), rotada ≈ 7 dk gecikme/.test(ahead().traffic) && H.speak.length === 1 && H.speak[0][1].key === 'traffic1' && unrelatedKept());
await run('mapbox→mapbox @tomtom', { provider: 'mapbox', map: 'tomtom', src: 'mapbox', expectAllowed: true });
await run('mapbox→mapbox @harita yok', { provider: 'mapbox', map: null, src: 'mapbox', expectAllowed: true });
await run('tomtom→tomtom @tomtom', { provider: 'tomtom', map: 'tomtom', src: 'tomtom', expectAllowed: true });
ok('tomtom→tomtom: metin ve ses', /yoğun trafik/.test(ahead().traffic) && H.speak.length === 1);
await run('mapbox→mapbox gecikme (sıkışma yok)', { provider: 'mapbox', map: 'osm', src: 'mapbox', jam: false, delayMin: 12, expectAllowed: true });
ok('gecikme metni aynen, ses yok', ahead().traffic === '🚦 Rotada trafik kaynaklı ≈ 12 dk gecikme var' && H.speak.length === 0);
{ // izinli ama trafik rotası başka yoldan: eskisi gibi hız/süre işlenir, renk çizilmez
  H.map = 'osm';
  const q = await start({ provider: 'mapbox' });
  H.sameRoad = false;
  q[0].res(trafficResult('mapbox'));
  await flush();
  ok('mapbox→mapbox başka yol: updateAhead + liveRemain var, renk yok (eski davranış)', H.upd.length === 1 && H.setTraffic.length === 0 && H.state.nav.liveRemain?.h === 1.25 && /yoğun trafik/.test(ahead().traffic));
  H.sameRoad = true;
}

// Reddedilen: uyumsuzluklar, eksik üst veri, desteklenmeyen sağlayıcı
await run('tomtom rota ← mapbox trafik @tomtom', { provider: 'tomtom', map: 'tomtom', src: 'mapbox' });
await run('tomtom rota ← mapbox trafik @osm', { provider: 'tomtom', map: 'osm', src: 'mapbox' });
await run('mapbox rota ← tomtom trafik @tomtom', { provider: 'mapbox', map: 'tomtom', src: 'tomtom' });
await run('osm rota ← mapbox trafik', { provider: 'osm', map: 'osm', src: 'mapbox' });
await run('osm rota ← tomtom trafik @tomtom', { provider: 'osm', map: 'tomtom', src: 'tomtom' });
await run('here rota ← here trafik', { provider: 'here', map: 'here', src: 'here' });
await run('routeMeta yok', { meta: false, map: 'osm', src: 'mapbox' });
await run('plan rotası yok', { route: false, map: 'osm', src: 'mapbox' });
await run('trafficSource yok', { provider: 'mapbox', map: 'osm', src: undefined });
await run('trafficSource null', { provider: 'mapbox', map: 'osm', src: null });
await run('bilinmeyen trafficSource', { provider: 'mapbox', map: 'osm', src: 'Mapbox' });
// Harita istek sürerken değişir
await run('tomtom→tomtom, istek sırasında harita osm oldu', { provider: 'tomtom', map: 'tomtom', src: 'tomtom', during: () => { H.map = 'osm'; } });
await run('tomtom→tomtom, istek sırasında harita mapbox oldu', { provider: 'tomtom', map: 'tomtom', src: 'tomtom', during: () => { H.map = 'mapbox'; } });
await run('mapbox→mapbox, istek sırasında harita tomtom oldu (izinli)', { provider: 'mapbox', map: 'osm', src: 'mapbox', during: () => { H.map = 'tomtom'; }, expectAllowed: true });
await run('tomtom→tomtom, harita osm iken başlayıp tomtom oldu (izinli)', { provider: 'tomtom', map: 'osm', src: 'tomtom', during: () => { H.map = 'tomtom'; }, expectAllowed: true });

// Eski plan: istek sürerken plan değişti → hiçbir etki yok (trafik metni bile yazılmaz)
for (const [name, res] of [['izinli sonuç', null], ['boş sonuç', 'null']]) {
  H.map = 'osm';
  const q = await start({ provider: 'mapbox' });
  H.state.plan = { ...H.state.plan, planId: 'yeni-plan', route: { coords: ROUTE_COORDS, routeMeta: { provider: 'mapbox' } } };
  H.state.nav = { ...H.state.nav, ahead: { ...H.state.nav.ahead, traffic: 'yeni planın metni' } };
  q[0].res(res === 'null' ? null : trafficResult('mapbox'));
  await flush();
  ok(`eski plan (${name}): hız/enerji/renk/süre/ses değişmez`, noEffects());
  ok(`eski plan (${name}): hiçbir nav yaması yok, yeni planın metni korunur`, H.patches.length === 0 && ahead().traffic === 'yeni planın metni' && unrelatedKept());
}

// Kaynak yok (null) → eskisi gibi metin silinir, başka etki yok
await run('trafik kaynağı yok (null)', { provider: 'mapbox', map: 'osm', res: null });
// Hata → eskisi gibi yalnızca uyarı günlüğü, etki yok
{
  H.map = 'osm';
  const q = await start({ provider: 'mapbox' });
  H.state.nav = { ...H.state.nav, ahead: { ...H.state.nav.ahead, traffic: 'önceki' } };
  const n0 = logs.length;
  q[0].rej(new Error('Mapbox 429'));
  await flush();
  const w = logs.slice(n0);
  ok('hata: etki yok, metin dokunulmaz (eski davranış)', noEffects() && H.patches.length === 0 && ahead().traffic === 'önceki');
  ok('hata: tek uyarı, yalnızca mesaj', w.length === 1 && w[0][0] === 'warn' && w[0][1][1] === 'Mapbox 429');
}

// Aynı planda: önce izinli sonuç, sonra uyumsuz sonuç → önceki metin silinir; liveRemain/renk/hız tekrar yazılmaz
{
  H.map = 'tomtom';
  const q = await start({ provider: 'tomtom' });
  q[0].res(trafficResult('tomtom'));
  await flush();
  const live = H.state.nav.liveRemain;
  ok('aynı plan 1. tur izinli: metin var', /yoğun trafik/.test(ahead().traffic) && live?.h === 1.25);
  reset();
  clock += 11 * 60e3;
  check(); // aynı plan, süre doldu → yeni istek
  ok('aynı plan 2. tur: tek yeni istek', H.traffic.length === 1);
  H.map = 'osm';
  H.traffic[0].res(trafficResult('mapbox'));
  await flush();
  ok('aynı plan 2. tur uyumsuz: hız/enerji/renk/ses yok', H.upd.length === 0 && H.setTraffic.length === 0 && H.speak.length === 0);
  ok('aynı plan 2. tur uyumsuz: liveRemain değişmez (aynı nesne)', H.state.nav.liveRemain === live);
  ok('aynı plan 2. tur uyumsuz: trafik metni silinir, diğer uyarılar korunur', ahead().traffic === null && unrelatedKept());
}

// Günlüklerde ham veri / sahte anahtar yok
const allLogs = JSON.stringify(logs.map(([k, a]) => [k, a.map(String)]));
ok('günlüklerde ham sağlayıcı verisi ve anahtar yok', !allLogs.includes(SENTINEL) && !allLogs.includes(FAKE_KEY));

// Statik: bağlantı sırası ve kapsam
{
  const body = asrc.slice(asrc.indexOf('async function refreshTraffic'), asrc.indexOf('function check()'));
  const at = (re) => body.search(re);
  const guard = at(/trafficUse\(/), stale = at(/plan\.planId !== id\) return;/), fetchI = at(/await fetchTrafficAhead/);
  ok('statik: planId denetimi ve koruma fetch sonrası, tüm etkilerden önce', fetchI > 0 && stale > fetchI && guard > stale &&
    [/updateAhead\(/, /mapApi\.setTraffic\(/, /liveRemain/, /speak\(/, /setAhead\(\{ traffic: `/].every((re) => at(re) > guard));
  ok('statik: koruma girdisi routeMeta.provider + trafficSource + activeMap()', /trafficUse\(\{ routeProvider: plan\.route\?\.routeMeta\?\.provider, trafficSource: t\.trafficSource, map: activeMap\(\) \}\)/.test(body));
  ok('statik: ahead.js HERE etkinleştirmez', !/\bhere\b/i.test(asrc.replace(/\/\/.*$/gm, '')));
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  ok("sw.js SHELL './js/nav/trafficGuard.js' ve './js/net/activeMap.js' içerir", sw.includes("'./js/nav/trafficGuard.js'") && sw.includes("'./js/net/activeMap.js'"));
}

ok('ağ çağrısı yapılmadı', netCalls === 0);
console.log(`\n${pass} geçti, ${fail} başarısız`);
if (fail) process.exit(1);
