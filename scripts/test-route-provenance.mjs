// Rota kaynağı etiketleme (js/providers/index.js → fetchRoute) testleri: node scripts/test-route-provenance.mjs
// Sağlayıcı modülleri (TomTom/Mapbox/Valhalla rota, proxy, aktif harita, Mapbox anahtarı) bellek içi sahtelerle değiştirilir;
// elle yazılmış çevrimdışı rota örnekleri kullanılır. Ağ engellidir, anahtar/sır yoktur. Gerçek routeMeta.js kullanılır.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond || !extra ? '' : '— ' + extra); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let netCalls = 0;
globalThis.fetch = () => { netCalls++; throw new Error('ağ yasak'); };
globalThis.XMLHttpRequest = function () { netCalls++; throw new Error('ağ yasak'); };
globalThis.WebSocket = function () { netCalls++; throw new Error('ağ yasak'); };

// ---- Sahte modüller: index.js'in içe aktardığı her şey (routeMeta.js hariç) ----
const S = (globalThis.__rpStub = {
  tomtomOn: false, mbKey: '', map: null, calls: [],
  tomtom: null, mapbox: null, osm: null, // () => sonuç | throw
});
const STUBS = {
  '../osm/route.js': "export const fetchRoute = async (...a) => { const S = globalThis.__rpStub; S.calls.push(['osm', a]); return S.osm(...a); };",
  '../mapbox/route.js': "export const fetchRoute = async (...a) => { const S = globalThis.__rpStub; S.calls.push(['mapbox', a]); return S.mapbox(...a); };",
  '../tomtom/route.js': "export const fetchRoute = async (...a) => { const S = globalThis.__rpStub; S.calls.push(['tomtom', a]); return S.tomtom(...a); };",
  '../nav/aheadTraffic.js': 'export const aheadFromRoute = (rt) => ({ ahead: true, rt });',
  '../mapbox/api.js': 'export const mapboxKey = () => globalThis.__rpStub.mbKey;',
  '../net/proxy.js': "export const proxyHas = (w) => w === 'tomtom' && globalThis.__rpStub.tomtomOn; export const premiumAccess = () => globalThis.__rpStub.tomtomOn;",
  '../net/activeMap.js': 'export const activeMap = () => globalThis.__rpStub.map;',
  '../osm/chargers.js': 'export const fetchChargers = () => {}; export const fetchAround = () => {};',
  '../routing/occupancyClient.js': 'export const fetchAvailability = () => {};',
  '../osm/search.js': 'export const searchPlaces = () => {}; export const resolvePlace = () => {}; export const reverseLabel = () => {};',
  '../osm/weather.js': 'export const fetchWeather = () => {};',
  '../osm/elevation.js': 'export const fetchElevations = () => {};',
  '../osm/speedLimit.js': 'export const fetchSpeedLimit = () => {};',
};
registerHooks({
  resolve(spec, ctx, next) {
    if (ctx.parentURL?.endsWith('/js/providers/index.js') && spec in STUBS) {
      return { url: 'data:text/javascript,' + encodeURIComponent(STUBS[spec]), format: 'module', shortCircuit: true };
    }
    return next(spec, ctx);
  },
});
const P = await import('../js/providers/index.js');
const src = readFileSync(new URL('../js/providers/index.js', import.meta.url), 'utf8');
const unstubbed = [...src.matchAll(/from '(\.\.\/[^']+)'/g)].map((m) => m[1]).filter((s) => !(s in STUBS) && s !== '../nav/routeMeta.js');
ok('index.js içe aktarmalarının tamamı sahte (routeMeta hariç)', unstubbed.length === 0, unstubbed.join(', '));

// ---- Elle yazılmış rota örnekleri (uygulamanın rota biçimi) ----
const base = () => ({ coords: [[28.0, 40.0], [28.0, 40.01], [28.0, 40.02]], intervals: [], distanceKm: 2.2, durationH: 0.05, trafficRatio: 1 });
const osmFx = () => ({ ...base(), steps: [{ type: 'depart', modifier: null, text: 'Yola çıkın', distM: 1000 }, { type: 'arrive', modifier: null, text: 'Varış noktasına ulaştınız', distM: 0 }] });
const mbFx = (lanes = true) => ({
  ...base(), trafficRatio: 1.2, trafficSpans: [{ from: 0.2, to: 0.8, lvl: 'heavy' }], live: true,
  steps: [
    { type: 'depart', modifier: null, text: 'Yola çıkın', distM: 500, lanes: null },
    { type: 'turn', modifier: 'left', text: 'Sola dönün', distM: 700, lanes: lanes ? [{ arrow: '←', ok: true }, { arrow: '↑', ok: false }] : null },
    { type: 'arrive', modifier: null, text: 'Varış noktasına ulaştınız', distM: 0 },
  ],
});
const ttFx = () => ({ ...base(), trafficRatio: 1.1, trafficSpans: [], live: true, steps: [{ type: 'depart', modifier: null, text: 'Yola çıkın (Ana Cadde)', road: 'Ana Cadde', distM: 2200, staticSec: 180 }, { type: 'arrive', modifier: null, text: 'Varış noktasına ulaştınız', distM: 0 }], limitSpans: [[40, 28, 40.02, 28, 50]] });
const boom = (msg) => () => { throw new Error(msg); };
const A = { lat: 40, lon: 28 }, B = { lat: 40.02, lon: 28 }, VIA = [{ lat: 40.01, lon: 28 }];

function setup({ tomtomOn = false, mbKey = '', map = null, tomtom = boom('kullanılmamalı'), mapbox = boom('kullanılmamalı'), osm = boom('kullanılmamalı') }) {
  Object.assign(S, { tomtomOn, mbKey, map, tomtom, mapbox, osm, calls: [] });
}
// Rota alanları aynen korunur: routeMeta dışındaki her anahtar ve değer kaynakla birebir; anahtar sırası korunur.
const sameShape = (r, fx, note) => {
  const { routeMeta, ...rest } = r;
  const want = note === undefined ? fx : { ...fx, note };
  return eq(rest, want) && eq(Object.keys(r), [...Object.keys(want), 'routeMeta']);
};
const lanes = (r) => r.routeMeta.attrs.lanes;
const noSpansOrDenied = (r) => r.routeMeta.roadSpans.length === 0 && r.routeMeta.denied.length === 0;
const tunnelBridgeUnsupported = (r) => r.routeMeta.attrs.tunnel.status === 'unsupported' && r.routeMeta.attrs.bridge.status === 'unsupported';

// 1) Ücretsiz: Mapbox anahtarı yok → Valhalla, osm
{
  const fx = osmFx(); setup({ osm: () => fx });
  const r = await P.fetchRoute(A, B, VIA);
  ok('ücretsiz: rota Valhalla, provider osm', r.routeMeta.provider === 'osm' && r.routeMeta.v === 1);
  ok('ücretsiz: rota alanları aynen (not yok) + yalnızca routeMeta eklendi', sameShape(r, osmFx()) && !('note' in r));
  ok('ücretsiz: osm şerit unsupported, tünel/köprü unsupported, aralık/ret yok', lanes(r).status === 'unsupported' && lanes(r).source === null && tunnelBridgeUnsupported(r) && noSpansOrDenied(r));
  ok('ücretsiz: argümanlar aynen iletilir, tek çağrı', eq(S.calls, [['osm', [A, B, VIA]]]) && S.calls[0][1][2] === VIA);
  ok('ücretsiz: sağlayıcı sonucu değiştirilmez, koordinat dizisi aynı nesne', !('routeMeta' in fx) && r !== fx && r.coords === fx.coords && r.steps === fx.steps);
  ok('routeMeta dondurulmuş', Object.isFrozen(r.routeMeta) && Object.isFrozen(r.routeMeta.attrs) && Object.isFrozen(r.routeMeta.attrs.lanes));
}

// 2) Mapbox anahtarı, Mapbox başarılı, adımlarda şerit var → mapbox, lanes present
{
  const fx = mbFx(true); setup({ mbKey: 'proxy', map: 'osm', mapbox: () => fx });
  const r = await P.fetchRoute(A, B);
  ok('Mapbox: provider mapbox (harita osm olsa da)', r.routeMeta.provider === 'mapbox');
  ok('Mapbox: şerit present, kaynak mapbox', lanes(r).status === 'present' && lanes(r).source === 'mapbox' && noSpansOrDenied(r) && tunnelBridgeUnsupported(r));
  ok('Mapbox: rota alanları aynen, step.lanes dokunulmadı', sameShape(r, mbFx(true)) && r.steps === fx.steps && r.steps[1].lanes.length === 2 && r.steps[0].lanes === null);
  ok('Mapbox: üst veri şerit içeriğini kopyalamaz', !JSON.stringify(r.routeMeta).includes('arrow'));
  ok('Mapbox: yalnızca Mapbox çağrıldı', eq(S.calls.map((c) => c[0]), ['mapbox']));
}

// 3) Mapbox başarılı, şerit yok → absent; adım listesi yoksa unrequested (veri uydurulmaz)
{
  setup({ mbKey: 'proxy', mapbox: () => mbFx(false) });
  const r = await P.fetchRoute(A, B);
  ok('Mapbox şeritsiz: lanes absent (istendi, rota boyunca yok)', r.routeMeta.provider === 'mapbox' && lanes(r).status === 'absent' && lanes(r).source === 'mapbox');
  const noSteps = { ...base(), live: true }; setup({ mbKey: 'proxy', mapbox: () => noSteps });
  const r2 = await P.fetchRoute(A, B);
  ok('Mapbox adım listesi yok: lanes unrequested, kaynak null (uydurma yok)', lanes(r2).status === 'unrequested' && lanes(r2).source === null && !('steps' in r2) && noSpansOrDenied(r2));
  setup({ mbKey: 'proxy', mapbox: () => ({ ...base(), steps: 'bozuk' }) });
  const r3 = await P.fetchRoute(A, B);
  ok('Mapbox bozuk adım alanı: lanes unrequested, alan aynen', lanes(r3).status === 'unrequested' && r3.steps === 'bozuk');
}

// 4) Mapbox başarısız → Valhalla, osm (not korunur)
{
  setup({ mbKey: 'proxy', map: 'mapbox', mapbox: boom('HTTP 500'), osm: () => osmFx() });
  const r = await P.fetchRoute(A, B);
  ok('Mapbox hata → Valhalla: provider osm (harita mapbox olsa da)', r.routeMeta.provider === 'osm' && lanes(r).status === 'unsupported');
  ok('Mapbox hata → not metni aynen', r.note === 'Mapbox rotası alınamadı (HTTP 500); ücretsiz rota kullanıldı, trafik yok' && sameShape(r, osmFx(), r.note));
  ok('Mapbox hata → çağrı sırası mapbox, osm', eq(S.calls.map((c) => c[0]), ['mapbox', 'osm']));
}

// 5) TomTom açık ve başarılı → tomtom (şerit ayrıştırılmaz → unsupported)
{
  setup({ tomtomOn: true, map: 'tomtom', mbKey: 'proxy', tomtom: () => ttFx() });
  const r = await P.fetchRoute(A, B, VIA);
  ok('TomTom: provider tomtom, lanes unsupported, tünel/köprü unsupported', r.routeMeta.provider === 'tomtom' && lanes(r).status === 'unsupported' && tunnelBridgeUnsupported(r) && noSpansOrDenied(r));
  ok('TomTom: rota alanları aynen (limitSpans dahil)', sameShape(r, ttFx()) && !('note' in r));
  ok('TomTom: yalnızca TomTom çağrıldı', eq(S.calls.map((c) => c[0]), ['tomtom']) && eq(S.calls[0][1], [A, B, VIA]));
  // TomTom adımlarında (beklenmedik) şerit olsa bile tomtom için şerit kaydı yapılmaz
  setup({ tomtomOn: true, map: 'tomtom', tomtom: () => ({ ...ttFx(), steps: mbFx(true).steps }) });
  const r2 = await P.fetchRoute(A, B);
  ok('TomTom adımında şerit olsa da üst veri iddia etmez (unsupported)', lanes(r2).status === 'unsupported' && lanes(r2).source === null);
}

// 6) TomTom hata, Mapbox anahtarı yok → Valhalla, osm
{
  setup({ tomtomOn: true, map: 'tomtom', tomtom: boom('402'), osm: () => osmFx() });
  const r = await P.fetchRoute(A, B);
  ok('TomTom hata → Valhalla: provider osm (harita tomtom olsa da)', r.routeMeta.provider === 'osm' && lanes(r).status === 'unsupported');
  ok('TomTom hata → Valhalla: not metni aynen', r.note === 'TomTom rotası alınamadı (402); ücretsiz rota kullanıldı, trafik yok' && sameShape(r, osmFx(), r.note));
  ok('TomTom hata → çağrı sırası tomtom, osm', eq(S.calls.map((c) => c[0]), ['tomtom', 'osm']));
}

// 7) TomTom hata, Mapbox başarılı → mapbox
{
  setup({ tomtomOn: true, map: 'tomtom', mbKey: 'proxy', tomtom: boom('429'), mapbox: () => mbFx(true) });
  const r = await P.fetchRoute(A, B);
  ok('TomTom hata → Mapbox: provider mapbox, şerit present', r.routeMeta.provider === 'mapbox' && lanes(r).status === 'present');
  ok('TomTom hata → Mapbox: not metni aynen', r.note === 'TomTom rotası alınamadı (429); Mapbox rotası kullanıldı' && sameShape(r, mbFx(true), r.note));
}

// 8) TomTom hata, Mapbox hata → Valhalla
{
  setup({ tomtomOn: true, map: 'tomtom', mbKey: 'proxy', tomtom: boom('zaman aşımı'), mapbox: boom('HTTP 503'), osm: () => osmFx() });
  const r = await P.fetchRoute(A, B);
  ok('TomTom + Mapbox hata → Valhalla: provider osm', r.routeMeta.provider === 'osm' && lanes(r).status === 'unsupported');
  ok('TomTom + Mapbox hata → birleşik not aynen', r.note === 'TomTom rotası alınamadı (zaman aşımı); Mapbox rotası alınamadı (HTTP 503); ücretsiz rota kullanıldı, trafik yok');
  ok('TomTom + Mapbox hata → çağrı sırası tomtom, mapbox, osm', eq(S.calls.map((c) => c[0]), ['tomtom', 'mapbox', 'osm']));
}

// 9) Harita sağlayıcısı rota sağlayıcısı sayılmaz
{
  for (const map of ['tomtom', 'mapbox', 'google', 'osm', null]) {
    setup({ map, osm: () => osmFx() }); // TomTom kapalı (Premium/anahtar yok), Mapbox anahtarı yok
    const r = await P.fetchRoute(A, B);
    ok(`harita ${map}: Valhalla rotası osm olarak etiketlenir`, r.routeMeta.provider === 'osm' && eq(S.calls.map((c) => c[0]), ['osm']));
  }
  setup({ tomtomOn: true, map: 'osm', osm: () => osmFx() }); // Premium + anahtar ama harita TomTom değil → TomTom rotası istenmez
  const r = await P.fetchRoute(A, B);
  ok('Premium ama harita osm: TomTom çağrılmaz, osm', r.routeMeta.provider === 'osm' && eq(S.calls.map((c) => c[0]), ['osm']));
}

// 10) Valhalla hatası eskisi gibi yukarı iletilir; boş sonuç değiştirilmez
{
  setup({ osm: boom('Valhalla 400') });
  let err = null; try { await P.fetchRoute(A, B); } catch (e) { err = e; }
  ok('Valhalla hatası yutulmaz (aynı hata)', err?.message === 'Valhalla 400');
  setup({ mbKey: 'proxy', mapbox: boom('x'), osm: boom('Valhalla 500') });
  err = null; try { await P.fetchRoute(A, B); } catch (e) { err = e; }
  ok('Mapbox + Valhalla hatası yukarı iletilir', err?.message === 'Valhalla 500');
  setup({ osm: () => null });
  ok('sağlayıcı null dönerse null aynen (etiket uydurulmaz)', (await P.fetchRoute(A, B)) === null);
}

// 11) fetchTrafficAhead değişmedi (etiket eklenmez; yalnızca seçilen plan rotası etiketlenir)
{
  const fx = mbFx(true); setup({ mbKey: 'proxy', mapbox: () => fx });
  const t = await P.fetchTrafficAhead(A, B);
  ok('fetchTrafficAhead: Mapbox rotası aynen iletilir (routeMeta yok)', t.rt === fx && !('routeMeta' in t.rt));
  setup({});
  ok('fetchTrafficAhead: kaynak yoksa null', (await P.fetchTrafficAhead(A, B)) === null);
}

// 12) Statik: sözleşmeler
{
  const body = src.slice(src.indexOf('export async function fetchRoute'), src.indexOf('export async function fetchTrafficAhead'));
  ok('fetchRoute her dönüşte etiketler (4 dönüş, hepsi tagRoute)', (body.match(/\breturn\b/g) || []).length === 4 && (body.match(/return tagRoute\(/g) || []).length === 4);
  ok('etiket yalnızca sabit rota sağlayıcı adlarıyla (activeMap’ten değil)', [...src.matchAll(/tagRoute\([^;]*, '(\w+)'\)/gs)].every((m) => ['tomtom', 'mapbox', 'osm'].includes(m[1])) && !/tagRoute\([^)]*activeMap/.test(src));
  ok('index.js HERE rota/sağlayıcı eklemez', !/here/i.test(src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  ok("sw.js SHELL './js/nav/routeMeta.js' içerir", sw.includes("'./js/nav/routeMeta.js'"));
}

ok('ağ çağrısı yapılmadı', netCalls === 0);
console.log(`\n${pass} geçti, ${fail} başarısız`);
if (fail) process.exit(1);
