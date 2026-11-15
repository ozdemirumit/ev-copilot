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
const unstubbed = [...asrc.matchAll(/from '(\.\.?\/[^']+)'/g)].map((m) => m[1]).filter((s) => !(s in STUBS) && s !== './trafficGuard.js' && s !== './aheadEvents.js');
ok('ahead.js içe aktarmalarının tamamı sahte (saf trafficGuard/aheadEvents hariç)', unstubbed.length === 0, unstubbed.join(', '));

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
// v0.99.50: red yolunda liveRemain yalnızca null'a çekilebilir; yeni canlı süre yazılmaz
const noEffects = () => H.upd.length === 0 && H.setTraffic.length === 0 && H.speak.length === 0 && !H.patches.some(([k, v]) => k === 'nav' && 'liveRemain' in v && v.liveRemain !== null);
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
    ok(`${name}: canlı kalan süre yazılır (plana bağlı)`, H.state.nav.liveRemain?.h === 1.25 && H.state.nav.liveRemain.planId === planBefore && H.state.nav.liveRemain.at === clock);
  } else {
    ok(`${name}: hız/enerji/renk/süre/ses değişmez`, noEffects(), JSON.stringify({ upd: H.upd.length, st: H.setTraffic.length, sp: H.speak.length }));
    ok(`${name}: trafik metni silinir, diğer uyarılar korunur`, ahead().traffic === null && unrelatedKept());
    ok(`${name}: canlı kalan süre yok`, H.state.nav.liveRemain === null);
  }
}

// İzin verilen: davranış aynen (metin + ses)
await run('mapbox→mapbox @osm', { provider: 'mapbox', map: 'osm', src: 'mapbox', expectAllowed: true });
ok('mapbox→mapbox: yoğun trafik metni ve ses', /yoğun trafik \(3\.0 km\), rotada ≈ 7 dk gecikme/.test(ahead().traffic) && H.speak.length === 1 && H.speak[0][1].key === 'traffic@15' && unrelatedKept());
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
  // D1-T3 (v0.99.80): hata yolunda tek etki aynı planın eski canlı varışını ve eski trafik/gecikme metnini kaldırmaktır (önceden dokunulmazdı)
  ok('hata: hız/enerji/renk/ses etkisi yok; yalnızca liveRemain null ve eski trafik metni kalkar (D1-T3)', noEffects() && H.patches.length === 2 &&
    H.patches[0][0] === 'nav' && H.patches[0][1].liveRemain === null && Object.keys(H.patches[0][1]).length === 1 &&
    H.patches[1][0] === 'nav' && H.patches[1][1].ahead?.traffic === null && ahead().traffic === null && unrelatedKept());
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
  ok('aynı plan 2. tur uyumsuz: önceki liveRemain silinir (v0.99.50)', H.state.nav.liveRemain === null && H.patches.filter(([k, v]) => k === 'nav' && 'liveRemain' in v).length === 1);
  ok('aynı plan 2. tur uyumsuz: trafik metni silinir, diğer uyarılar korunur', ahead().traffic === null && unrelatedKept());
}

// ---------------------------------------------------------------- 3) v0.99.50: plana bağlı trafik zamanlayıcısı ve canlı varış süresi
// A planının isteği sürerken B planına geçilir: A'nın finally'si trAt'ı güncellememeli, B hemen (sonraki check) kendi isteğini yapmalı
for (const [name, settle] of [
  ['izinli sonuç', (q) => q.res(trafficResult('mapbox'))],
  ['boş sonuç', (q) => q.res(null)],
  ['hata', (q) => q.rej(new Error('Mapbox 503'))],
  ['uyumsuz kaynak', (q) => q.res(trafficResult('tomtom'))],
]) {
  H.map = 'osm';
  const q = await start({ provider: 'mapbox' });
  const pidA = H.state.plan.planId;
  clock += 60e3;
  H.state.plan = { ...H.state.plan, planId: 'B-' + name, route: { coords: ROUTE_COORDS, routeMeta: { provider: 'mapbox' } } };
  check(); // B görülür: trAt=0, ama A sürdüğü için yeni istek yok
  ok(`A→B (${name}): A sürerken ikinci istek yok`, H.traffic.length === 0);
  reset();
  settle(q[0]);
  await flush();
  ok(`A→B (${name}): A sonucu B'ye etki etmez (liveRemain yazılmaz/silinmez)`, noEffects() && H.patches.length === 0);
  clock += 5000;
  check();
  ok(`A→B (${name}): B'nin ilk trafik isteği ertelenmeden yapılır (tek istek)`, H.traffic.length === 1 && pidA !== H.state.plan.planId);
  H.traffic[0].res(trafficResult('mapbox'));
  await flush();
  ok(`A→B (${name}): B sonucu B planına bağlı yazılır`, H.state.nav.liveRemain?.planId === 'B-' + name);
  reset();
  clock += 5000; check();
  ok(`A→B (${name}): B sonrası 10 dk kısıtı geçerli`, H.traffic.length === 0);
}
// Aynı plan kısıtı: istek bitince 10 dk dolmadan yeni istek yok (izinli, boş, hata, red)
for (const [name, settle] of [
  ['izinli', (q) => q.res(trafficResult('mapbox'))], ['boş', (q) => q.res(null)],
  ['hata', (q) => q.rej(new Error('x'))], ['red', (q) => q.res(trafficResult('tomtom'))],
]) {
  H.map = 'osm';
  const q = await start({ provider: 'mapbox' });
  clock += 30e3; // yanıt 30 sn sürdü: kısıt yanıt anından sayılır (eski davranış)
  settle(q[0]);
  await flush();
  reset();
  const t0 = clock;
  for (const dt of [5e3, 60e3, 9 * 60e3, 10 * 60e3]) { clock = t0 + dt; check(); }
  ok(`aynı plan (${name}): ≤10 dk içinde ek istek yok`, H.traffic.length === 0);
  clock = t0 + 10 * 60e3 + 1; check();
  ok(`aynı plan (${name}): 10 dk sonra tek istek`, H.traffic.length === 1);
  H.traffic[0].rej(new Error('kapat')); await flush();
}

// liveRemainH saf okuma kuralı (navigator.js bunu kullanır)
{
  const { liveRemainH, LIVE_REMAIN_MAX_MS } = G;
  const now = 1_800_000_000_000;
  ok('liveRemainH: 15 dk sınırı', LIVE_REMAIN_MAX_MS === 15 * 60e3);
  ok('liveRemainH: aynı plan, yeni kayıt → kalan süre (geçen süre düşülür)', Math.abs(liveRemainH({ h: 1, at: now - 6 * 60e3, planId: 'P' }, 'P', now) - 0.9) < 1e-12);
  ok('liveRemainH: aynı an → h', liveRemainH({ h: 2, at: now, planId: 'P' }, 'P', now) === 2);
  ok('liveRemainH: başka planın kaydı kullanılmaz', liveRemainH({ h: 1, at: now, planId: 'A' }, 'B', now) === null);
  ok("liveRemainH: planId'siz eski kayıt kullanılmaz", liveRemainH({ h: 1, at: now }, 'P', now) === null && liveRemainH({ h: 1, at: now }, undefined, now) === null);
  ok('liveRemainH: plan kimliği yoksa kullanılmaz', liveRemainH({ h: 1, at: now, planId: null }, null, now) === null);
  ok('liveRemainH: 14:59 geçerli, tam 15 dk ve sonrası süresi dolmuş', liveRemainH({ h: 1, at: now - (15 * 60e3 - 1000), planId: 'P' }, 'P', now) > 0 &&
    liveRemainH({ h: 1, at: now - 15 * 60e3, planId: 'P' }, 'P', now) === null && liveRemainH({ h: 1, at: now - 16 * 60e3, planId: 'P' }, 'P', now) === null);
  ok("liveRemainH: negatif kalan süre yok (0'a kırpılır)", liveRemainH({ h: 0.05, at: now - 10 * 60e3, planId: 'P' }, 'P', now) === 0 && liveRemainH({ h: -1, at: now, planId: 'P' }, 'P', now) === 0);
  ok('liveRemainH: geleceğe tarihli / geçersiz kayıt yok sayılır', liveRemainH({ h: 1, at: now + 1000, planId: 'P' }, 'P', now) === null &&
    liveRemainH({ h: NaN, at: now, planId: 'P' }, 'P', now) === null && liveRemainH({ h: 1, at: 'x', planId: 'P' }, 'P', now) === null &&
    liveRemainH(null, 'P', now) === null && liveRemainH(undefined, 'P', now) === null);
  // Uçtan uca: ahead.js'in yazdığı kayıt, plan değişince navigator kuralıyla okunmaz
  H.map = 'osm';
  const q = await start({ provider: 'mapbox' });
  q[0].res(trafficResult('mapbox')); await flush();
  const rec = H.state.nav.liveRemain, pA = H.state.plan.planId;
  ok('uçtan uca: aynı plan okunur', liveRemainH(rec, pA, clock) === 1.25);
  ok('uçtan uca: yeni plan önceki planın varış süresini görmez', liveRemainH(rec, 'baska-plan', clock) === null);
  ok('uçtan uca: 15 dk sonra kullanılmaz', liveRemainH(rec, pA, clock + 15 * 60e3) === null);
  const nsrc = readFileSync(new URL('../js/nav/navigator.js', import.meta.url), 'utf8');
  ok("statik: navigator.js liveRemain'i yalnızca liveRemainH(…, plan.planId, Date.now()) ile okur", /liveRemainH\(nav\.liveRemain, plan\.planId, Date\.now\(\)\)/.test(nsrc) &&
    (nsrc.match(/\.liveRemain\b/g) || []).length === 1 && /import \{ liveRemainH \} from '\.\/trafficGuard\.js'/.test(nsrc));
  const body = asrc.slice(asrc.indexOf('async function refreshTraffic'), asrc.indexOf('function check()'));
  ok('statik: finally trAt yalnızca aynı planda', /finally \{\s*if \(getState\('plan'\)\.planId === id\) trAt = Date\.now\(\);/.test(body));
}

// v0.99.56: kalan mesafe konumla güncellenir (3 km sonra trafik → 1 / 2,5 / 3 km ilerle); yeni sağlayıcı isteği yapılmaz
{
  H.map = 'osm';
  const q = await start({ provider: 'mapbox' }); // routeKm 10
  q[0].res({ ...trafficResult('mapbox'), jam: { from: 3, to: 4.2, jam: true }, delayMin: 4 });
  await flush();
  ok('uçtan uca: ilk metin ~3.0 km', /^🚦 ~3\.0 km ileride yoğun trafik \(1\.2 km\)/.test(ahead().traffic), ahead().traffic);
  ok('uçtan uca: ilk ses bir kez (konuma bağlı anahtar)', H.speak.length === 1 && H.speak[0][1].key === 'traffic@13');
  const step = (km) => { H.state.engine = { ...H.state.engine, routeKm: km }; clock += 5000; check(); return ahead().traffic; };
  reset();
  ok('uçtan uca: 1 km ilerledi → ~2.0 km', /^🚦 ~2\.0 km ileride/.test(step(11)));
  ok('uçtan uca: 2 km eşiği bir kez sesli', H.speak.length === 1 && H.speak[0][1].key === 'traffic@13:2');
  step(11.05); step(11.1);
  ok('uçtan uca: her GPS adımında ses tekrarlanmaz', H.speak.length === 1);
  ok('uçtan uca: GPS geri sıçraması (−0,1 km) metni büyütmez', /^🚦 ~1\.9 km/.test(step(11.1)) && /^🚦 ~1\.9 km/.test(step(11.0)));
  ok('uçtan uca: 2,5 km ilerledi → ~0.5 km + 0,5 km eşiği', /^🚦 ~0\.5 km ileride/.test(step(12.5)) && H.speak.length === 2 && H.speak[1][1].key === 'traffic@13:0.5');
  ok('uçtan uca: 3 km ilerledi → Şu an', /^🚦 Şu an yoğun trafik/.test(step(13)));
  ok('uçtan uca: sıkışıklık geçildi → metin kalkar (gecikme < 10 dk)', step(14.5) === null);
  ok('uçtan uca: yolda yeni ücretli trafik isteği yok', H.traffic.length === 0);
  // Rota dışı: geri sayım yok, "mesafe belirsiz"; yeniden katılınca geri sayım sürer
  const q2 = await start({ provider: 'mapbox' });
  q2[0].res({ ...trafficResult('mapbox'), jam: { from: 6, to: 7, jam: false } });
  await flush();
  H.state.engine = { routeKm: 12, offRouteKm: 2 }; clock += 5000; check();
  ok('uçtan uca: rota dışında mesafe belirsiz', /mesafe belirsiz/.test(ahead().traffic) && !/~\d/.test(ahead().traffic));
  H.state.engine = { routeKm: 13, offRouteKm: 0 }; clock += 5000; check();
  ok('uçtan uca: yeniden katılınca ~3.0 km', /^🚦 ~3\.0 km ileride yavaş trafik/.test(ahead().traffic));
  // Yeniden rota (yeni planId): eski olay temizlenir
  H.state.plan = { ...H.state.plan, planId: 'reroute-' + pid }; clock += 5000; check();
  ok('uçtan uca: yeniden rotada eski trafik metni kalmaz', ahead().traffic === null);
}

// ---------------------------------------------------------------- 4) D1-T2: trafik sağlayıcı hatası / doğrulanamayan olay konumu
// Kullanıcı kararı D1 (2026-11-15): her başarılı yenilemede mesafe güncel konum + güncel olay verisinden yeniden hesaplanır;
// istek başarısızsa ya da olay konumu doğrulanamıyorsa eski sayısal mesafe kesinmiş gibi gösterilmez ("mesafe belirsiz"), ses yok;
// olay en fazla son başarılı alınmadan 20 dk (TRAFFIC_STALE_MS) izlenir. Sahte sağlayıcı, ağ engelli.
{
  const num = (t) => (t && /~(\d+(?:\.\d)?) km ileride/.exec(t) ? Number(/~(\d+(?:\.\d)?) km ileride/.exec(t)[1]) : null);
  const step = (km, dtMs = 5000, off = 0) => { H.state.engine = { routeKm: km, offRouteKm: off }; clock += dtMs; check(); return ahead().traffic; };
  const jamAt = (from, to = from + 1.2) => ({ ...trafficResult('mapbox'), jam: { from, to, jam: true }, delayMin: 4 });
  H.traffic.forEach((r) => r.rej(new Error('kapat'))); await flush(); reset(); // önceki bölümün yeniden rota isteği açık kalmasın
  /** Yeni plan, 10. km'de başarılı alınma (sıkışıklık 10+from); sonra 10 dk + 1 ms ilerleyip ikinci isteği açar ve onu döndürür. */
  async function failSetup(from = 3, kmAtRefresh = 10.5) {
    H.map = 'osm'; H.sameRoad = true;
    const q = await start({ provider: 'mapbox' });
    q[0].res(jamAt(from)); await flush();
    const at0 = clock;
    step(kmAtRefresh, 10 * 60e3 + 1);
    const req = H.traffic[H.traffic.length - 1];
    reset();
    return { req, at0 };
  }
  // 4a) Hata yolu: eski sayısal mesafe gösterilmez, ses yok, olay 20 dk sınırında düşer
  {
    const { req, at0 } = await failSetup(3, 10.5);
    ok('D1-T2 hata: istek sürerken (henüz hata yok) güncel konumdan ~2.5 km', num(ahead().traffic) === 2.5, ahead().traffic);
    req.rej(new Error('Mapbox 503')); await flush();
    ok('D1-T2 hata: "mesafe belirsiz", sayısal mesafe yok', /mesafe belirsiz/.test(ahead().traffic) && num(ahead().traffic) === null, ahead().traffic);
    ok('D1-T2 hata: hata anında ses yok', H.speak.length === 0);
    const t1 = step(11.2); // eski olaya göre 1,8 km: 2 km eşiği geçilirdi
    ok('D1-T2 hata: ilerleyince de sayı yok (eski olay konumundan geri sayım yok)', /mesafe belirsiz/.test(t1) && num(t1) === null, t1);
    ok('D1-T2 hata: eşik geçilse de ses yok', H.speak.length === 0);
    step(12.6);
    ok('D1-T2 hata: "Şu an" (eski konuma göre içinde) iddiası da yok', /mesafe belirsiz/.test(ahead().traffic) && !/Şu an/.test(ahead().traffic) && H.speak.length === 0, ahead().traffic);
    clock = at0 + 20 * 60e3 - 5000; step(12.7, 0);
    ok('D1-T2 hata: son başarılı alınmadan <20 dk: hâlâ "mesafe belirsiz"', /mesafe belirsiz/.test(ahead().traffic));
    clock = at0 + 20 * 60e3 + 1; step(12.8, 0);
    ok('D1-T2 hata: 20 dk dolunca sıkışıklık metni kalkar (gecikme < 10 dk)', ahead().traffic === null, ahead().traffic);
    ok('D1-T2 hata: tüm süreçte ses yok', H.speak.length === 0);
  }
  // 4b) Hata → sonraki başarılı yenileme: mesafe güncel konum + güncel olay verisinden. Yenileme hatadan ≥10 dk sonra, yani son
  // başarılı alınmadan ≥20 dk sonra gelir: eski olay o an süresi dolmuş (stale) ve düşmüştür; güncel olay yeni olarak bir kez duyurulur.
  {
    const { req } = await failSetup(3, 10.5); // olay 13. km
    req.rej(new Error('zaman aşımı')); await flush();
    step(11, 10 * 60e3 + 1); // hatadan 10 dk sonra yeni istek (son başarılıdan ~20 dk önce)
    ok('D1-T2 kurtarma: hatadan sonra 10 dk kısıtı ile tek istek', H.traffic.length === 1, String(H.traffic.length));
    H.traffic[0].res(jamAt(2.4)); await flush(); // güncel veri: sıkışıklık 11 + 2,4 = 13,4. km
    ok('D1-T2 kurtarma: mesafe güncel konum + güncel olaydan (~2.4 km)', num(ahead().traffic) === 2.4, ahead().traffic);
    ok('D1-T2 kurtarma: güncel olay bir kez, güncel mesafeyle duyurulur', H.speak.length === 1 && /^2\.4 kilometre ileride yoğun trafik/.test(H.speak[0][0]) && H.speak[0][1].key === 'traffic@13', JSON.stringify(H.speak));
    reset();
    ok('D1-T2 kurtarma: ilerleyince geri sayım sürer (~1.4 km)', num(step(12)) === 1.4, ahead().traffic);
    // Kurtarma sonrası olay yeni "at" taşır: 20 dk sayacı yeniden başlar
    ok('D1-T2 kurtarma: geri sayımda 2 km eşiği bir kez sesli', H.speak.length === 1 && H.speak[0][1].key === 'traffic@13:2', JSON.stringify(H.speak));
    reset();
    H.traffic.length = 0;
  }
  // 4c) Hata → başarılı yenileme başka yerde sıkışıklık: yeni olay, yeni mesafe ve tek duyuru
  {
    const { req } = await failSetup(3, 10.5);
    req.rej(new Error('x')); await flush();
    step(11, 10 * 60e3 + 1);
    H.traffic[0].res(jamAt(8)); await flush(); // 19. km: eski 13. km değil
    ok('D1-T2 yeni olay: ~8.0 km (eski olaydan bağımsız)', num(ahead().traffic) === 8, ahead().traffic);
    ok('D1-T2 yeni olay: bir kez duyurulur', H.speak.length === 1 && H.speak[0][1].key === 'traffic@19', JSON.stringify(H.speak));
    reset();
  }
  // 4d) Başarılı ama olay konumu doğrulanamıyor (trafik rotası plan yoluyla aynı değil / araç rota dışında): "belirsiz", ses yok
  for (const [name, setup] of [
    ['farklı yol', () => { H.sameRoad = false; }],
    ['rota dışı', () => { H.state.engine = { routeKm: 10, offRouteKm: 2 }; }],
  ]) {
    H.map = 'osm'; H.sameRoad = true;
    const q = await start({ provider: 'mapbox' });
    setup();
    q[0].res(jamAt(3)); await flush();
    ok(`D1-T2 doğrulanamayan konum (${name}): "mesafe belirsiz", sayı yok`, /mesafe belirsiz/.test(ahead().traffic) && num(ahead().traffic) === null, ahead().traffic);
    ok(`D1-T2 doğrulanamayan konum (${name}): seslendirme yok`, H.speak.length === 0, JSON.stringify(H.speak));
    H.sameRoad = true;
  }
  // 4e) Hata, önceki olay yokken: metin uydurulmaz
  {
    H.map = 'osm'; H.sameRoad = true;
    const q = await start({ provider: 'mapbox' });
    q[0].rej(new Error('Mapbox 503')); await flush();
    ok('D1-T2 hata (önceki olay yok): trafik metni yok, ses yok', ahead().traffic == null && H.speak.length === 0, String(ahead().traffic));
  }
  // 4f) Hata, önceki olay başka plana ait: taşınmaz
  {
    const { req } = await failSetup(3, 10.5);
    H.state.plan = { ...H.state.plan, planId: 'D1T2-yeni' }; clock += 5000; check(); // check() eski olayı temizler, yeni plan isteği A sürerken açılmaz
    req.rej(new Error('x')); await flush();
    ok('D1-T2 hata (plan değişti): eski olay geri gelmez', ahead().traffic === null && H.speak.length === 0, String(ahead().traffic));
    H.traffic.forEach((r) => r.rej(new Error('kapat'))); await flush(); reset();
  }
  const body = asrc.slice(asrc.indexOf('async function refreshTraffic'), asrc.indexOf('function check()'));
  ok('statik D1-T2: hata yolunda ses ve yeni sağlayıcı isteği yok', !/catch \(err\) \{[^}]*(speak|fetchTrafficAhead)\(/.test(body));
}

// ---------------------------------------------------------------- 5) D1-T3: sağlayıcı hatasında eski canlı varış (liveRemain) ve "≈ X dk gecikme"
// İstek başarısızsa son başarılı canlı varış süresi ve gecikme tahmini güncelmiş gibi kullanılmaz/gösterilmez (navigator plan süresine döner);
// başarılı yenilemede eski davranış aynen sürer. Sahte sağlayıcı, ağ engelli.
{
  const G = await import('../js/nav/trafficGuard.js');
  const step = (km, dtMs = 5000) => { H.state.engine = { routeKm: km, offRouteKm: 0 }; clock += dtMs; check(); return ahead().traffic; };
  const res = (jam, delayMin) => ({ ...trafficResult('mapbox', { jam: !!jam, delayMin }), ...(jam ? { jam: { from: jam, to: jam + 1.2, jam: true } } : {}) });
  H.traffic.forEach((r) => r.rej(new Error('kapat'))); await flush(); reset();
  /** Yeni plan + başarılı ilk alınma (r); 10 dk + 1 ms sonra ikinci isteği açar ve döndürür. */
  async function setup(r) {
    H.map = 'osm'; H.sameRoad = true;
    const q = await start({ provider: 'mapbox' });
    q[0].res(r); await flush();
    const okLive = H.state.nav.liveRemain?.h === 1.25;
    const text0 = ahead().traffic;
    step(10.5, 10 * 60e3 + 1);
    const req = H.traffic[H.traffic.length - 1];
    reset();
    return { req, okLive, text0 };
  }
  // 5a) Sıkışıklıksız büyük gecikme: hata sonrası "≈ 15 dk gecikme" ve canlı varış kalmaz
  {
    const { req, okLive, text0 } = await setup(res(0, 15));
    ok('D1-T3 başarılı (gecikme): canlı varış yazılır ve "≈ 15 dk gecikme" gösterilir', okLive && /≈ 15 dk gecikme/.test(text0), text0);
    req.rej(new Error('Mapbox 503')); await flush();
    ok('D1-T3 hata (gecikme): eski canlı varış silinir', H.state.nav.liveRemain === null, JSON.stringify(H.state.nav.liveRemain));
    ok('D1-T3 hata (gecikme): navigator canlı süre bulamaz (plan süresine döner)', G.liveRemainH(H.state.nav.liveRemain, H.state.plan.planId, clock) === null);
    ok('D1-T3 hata (gecikme): eski "≈ X dk gecikme" iddiası kalkar', !/dk gecikme/.test(ahead().traffic ?? ''), String(ahead().traffic));
    step(11, 5 * 60e3);
    ok('D1-T3 hata (gecikme): sonraki kontrollerde de geri gelmez', !/dk gecikme/.test(ahead().traffic ?? ''), String(ahead().traffic));
    ok('D1-T3 hata (gecikme): ilgisiz uyarılar korunur, ses yok', unrelatedKept() && H.speak.length === 0);
    H.traffic.forEach((r) => r.rej(new Error('kapat'))); await flush(); reset();
  }
  // 5b) Sıkışıklık + gecikme: hata sonrası "mesafe belirsiz" kalır ama gecikme dakikası iddia edilmez; 20 dk sonra eski gecikme dönmez
  {
    const { req, okLive, text0 } = await setup(res(3, 12));
    ok('D1-T3 başarılı (sıkışıklık): metinde "≈ 12 dk gecikme"', okLive && /≈ 12 dk gecikme/.test(text0), text0);
    req.rej(new Error('zaman aşımı')); await flush();
    ok('D1-T3 hata (sıkışıklık): canlı varış silinir', H.state.nav.liveRemain === null);
    ok('D1-T3 hata (sıkışıklık): "mesafe belirsiz", gecikme dakikası yok', /mesafe belirsiz/.test(ahead().traffic) && !/dk gecikme/.test(ahead().traffic), ahead().traffic);
    step(12.9, 10 * 60e3); // son başarılıdan 20 dk + 1 ms sonra: olay eskir (TRAFFIC_STALE_MS)
    ok('D1-T3 hata (sıkışıklık): olay eskiyince eski "≈ 12 dk gecikme" geri gelmez', !/dk gecikme/.test(ahead().traffic ?? ''), String(ahead().traffic));
    ok('D1-T3 hata (sıkışıklık): ses yok', H.speak.filter((s) => /gecikme/.test(s[0])).length === 0, JSON.stringify(H.speak));
    H.traffic.forEach((r) => r.rej(new Error('kapat'))); await flush(); reset();
  }
  // 5c) Hata → sonraki başarılı yenileme: canlı varış ve gecikme normal biçimde geri gelir
  {
    const { req } = await setup(res(0, 15));
    req.rej(new Error('x')); await flush();
    step(11, 10 * 60e3 + 1);
    ok('D1-T3 kurtarma: tek yeni istek', H.traffic.length === 1, String(H.traffic.length));
    H.traffic[0].res(res(0, 18)); await flush();
    ok('D1-T3 kurtarma: canlı varış yeniden yazılır (plana bağlı)', H.state.nav.liveRemain?.h === 1.25 && H.state.nav.liveRemain.planId === H.state.plan.planId && H.state.nav.liveRemain.at === clock);
    ok('D1-T3 kurtarma: güncel "≈ 18 dk gecikme" gösterilir', /≈ 18 dk gecikme/.test(ahead().traffic), String(ahead().traffic));
    reset();
  }
  // 5d) Hata geldiğinde plan değişmişse: yeni planın canlı varışı ve trafik metni silinmez
  {
    const { req } = await setup(res(0, 15));
    H.state.plan = { ...H.state.plan, planId: 'D1T3-yeni' }; clock += 5000; check();
    const liveB = { h: 2, at: clock, planId: 'D1T3-yeni' };
    H.state.nav = { ...H.state.nav, liveRemain: liveB, ahead: { ...H.state.nav.ahead, traffic: '🚦 B planı' } };
    reset();
    req.rej(new Error('x')); await flush();
    ok('D1-T3 hata (plan değişti): yeni planın canlı varışı ve metni korunur', H.state.nav.liveRemain === liveB && ahead().traffic === '🚦 B planı' && H.patches.length === 0, JSON.stringify(H.patches));
    H.traffic.forEach((r) => r.rej(new Error('kapat'))); await flush(); reset();
  }
  const body = asrc.slice(asrc.indexOf('async function refreshTraffic'), asrc.indexOf('function check()'));
  ok('statik D1-T3: hata yolunda yeni canlı varış yazılmaz (yalnızca null)', !/catch \(err\) \{[^}]*liveRemain: \{/.test(body));
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
    [/updateAhead\(/, /mapApi\.setTraffic\(/, /liveRemain/, /speak\(/, /setAhead\(\{ traffic: r\.text \}\)/].every((re) => at(re) > guard));
  ok('statik: koruma girdisi routeMeta.provider + trafficSource + activeMap()', /trafficUse\(\{ routeProvider: plan\.route\?\.routeMeta\?\.provider, trafficSource: t\.trafficSource, map: activeMap\(\) \}\)/.test(body));
  ok('statik: ahead.js HERE etkinleştirmez', !/\bhere\b/i.test(asrc.replace(/\/\/.*$/gm, '')));
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  ok("sw.js SHELL './js/nav/trafficGuard.js' ve './js/net/activeMap.js' içerir", sw.includes("'./js/nav/trafficGuard.js'") && sw.includes("'./js/net/activeMap.js'"));
}

ok('ağ çağrısı yapılmadı', netCalls === 0);
console.log(`\n${pass} geçti, ${fail} başarısız`);
if (fail) process.exit(1);
