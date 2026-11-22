// Harita teması: ücretsiz OpenFreeMap haritası arayüz temasına uyar (açık → positron, koyu → dark); diğer sağlayıcılar koyu kalır.
// Çevrimdışı/sahte harita: motorun (js/ui/maps/mapEngine.js) tema değişiminde rota/trafik/3B bina/uydu katmanlarını kayıpsız ve çiftsiz
// yeniden kurduğu, kamerayı (konum/zoom/yön/eğim) oynatmadığı, hızlı art arda değişimde tutarlı kaldığı ve renk kontrastları denetlenir.
// Gerçek cihazda/WebGL'de doğrulama bu testin kapsamı DEĞİL. Kullanım: node scripts/test-map-theme.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVectorMap, buildingsLayer, themeHandle, slimFonts, LIGHT_PALETTE, BUILDINGS_3D } from '../js/ui/maps/mapEngine.js';
import { STYLE_DARK, STYLE_LIGHT, styleFor } from '../js/ui/maps/maplibre.js';
import { freeMapRequest } from '../js/net/providerGate.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };

// ---------------------------------------------------------------- sahte MapLibre
class FakeMap {
  constructor(opts) {
    this.opts = opts;
    this.initialStyle = opts.style;
    this.handlers = {};
    this.calls = [];
    this.cam = { center: opts.center, zoom: opts.zoom, bearing: 0, pitch: 0 };
    this.sources = new Map();
    this.layers = [];
    if (opts.style) this.baseStyle(opts.style); // stilsiz kurucu: stil sonradan setStyle ile gelir
  }
  baseStyle(url) { // stilin kendi kaynağı + düz bina katmanı
    this.styleUrl = url;
    this.sources.set('openmaptiles', { def: { type: 'vector' } });
    this.layers.push({ id: 'building', type: 'fill', source: 'openmaptiles', layout: { visibility: 'visible' }, paint: {} });
  }
  on(t, f) { (this.handlers[t] ??= []).push(f); }
  once(t, f) { if (t === 'load') queueMicrotask(() => { if (this.pending) { this.baseStyle(this.pending); this.pending = null; } f(); }); else this.on(t, f); }
  fire(t) { for (const f of this.handlers[t] || []) f(); }
  addControl() {}
  getCanvas() { return { style: {} }; }
  getSource(id) { return this.sources.get(id); }
  addSource(id, def) { this.sources.set(id, { def, data: def.data, setData(d) { this.data = d; } }); }
  getLayer(id) { return this.layers.find((l) => l.id === id); }
  addLayer(layer, before) {
    if (this.getLayer(layer.id)) throw new Error('çift katman: ' + layer.id);
    const i = before ? this.layers.findIndex((l) => l.id === before) : -1;
    if (before && i < 0) throw new Error('önceki katman yok: ' + before);
    this.layers.splice(i < 0 ? this.layers.length : i, 0, { layout: {}, ...layer });
  }
  removeLayer(id) { this.layers = this.layers.filter((l) => l.id !== id); }
  setLayoutProperty(id, k, v) { this.getLayer(id).layout[k] = v; }
  setStyle(url, o) { // diff:false: eski stilin her şeyi (kaynak/katman) gider; 'style.load' ayrı (finishLoad) gelir
    this.calls.push(['setStyle', url, o]);
    this.sources.clear();
    this.layers = [];
    this.pending = url;
  }
  finishLoad() { const u = this.pending; this.pending = null; this.baseStyle(u); this.fire('style.load'); }
  jumpTo(o) { this.calls.push(['jumpTo']); Object.assign(this.cam, o); }
  easeTo(o) { this.calls.push(['easeTo']); Object.assign(this.cam, o); }
  fitBounds() { this.calls.push(['fitBounds']); }
  getBearing() { return this.cam.bearing; }
  resize() {}
  remove() {}
}
const lib = { Map: FakeMap, AttributionControl: class {}, Marker: class { setLngLat() { return this; } addTo() { return this; } remove() {} } };
const container = { querySelector: () => null };
const ids = (m) => m.layers.map((l) => l.id);
const BUILD = { layer: buildingsLayer({ source: 'openmaptiles', filter: ['!=', ['get', 'hide_3d'], true], height: 'render_height', base: 'render_min_height' }), hide: ['building'] };
const COORDS = [[32.8, 39.9], [32.9, 40.0], [33.1, 40.1]];
const SPANS = [{ from: 0, to: 8, lvl: 'heavy' }];
const trafficColor = (m) => m.getLayer('traffic-line').paint['line-color'];

async function make(style, { name = 'osm', satellite } = {}) {
  const a = await createVectorMap(lib, container, { mapOptions: { style }, name, buildings: BUILD, satellite });
  // FakeMap örneğine erişim: bağdaştırıcı yöntemleri onu yakalar; en son oluşturulan harita testte yakalanır
  return { a, m: FakeMap.last };
}
FakeMap.last = null;
const OrigMap = lib.Map;
lib.Map = class extends OrigMap { constructor(o) { super(o); FakeMap.last = this; } };

// ---------------------------------------------------------------- 1) stil adresleri ve kapı
ok('styleFor: koyu → dark, açık → positron', styleFor(true) === STYLE_DARK && styleFor(false) === STYLE_LIGHT && STYLE_DARK.endsWith('/styles/dark') && STYLE_LIGHT.endsWith('/styles/positron'));
ok('freeMapRequest positron stilini geçirir (yalnız OpenFreeMap izin listesi)', freeMapRequest(STYLE_LIGHT).url === STYLE_LIGHT && freeMapRequest(STYLE_DARK).url === STYLE_DARK);
ok('freeMapRequest başka hosta açılmaz', freeMapRequest('https://example.com/styles/positron').url !== 'https://example.com/styles/positron');

// ---------------------------------------------------------------- 2) açık başlangıç
{
  const { a, m } = await make(STYLE_LIGHT);
  const h = themeHandle(a);
  ok('açık stille açılış: ton light', h?.tone() === 'light');
  ok('açık tonda rota çerçevesi lacivert, çizgi mavi, trafik açık palet', m.getLayer('route-casing').paint['line-color'] === LIGHT_PALETTE.casing && m.getLayer('route-line').paint['line-color'] === '#1a73e8' && JSON.stringify(trafficColor(m)).includes(LIGHT_PALETTE.traffic[1]));
  ok('katman sırası: çerçeve < rota < trafik', ids(m).indexOf('route-casing') < ids(m).indexOf('route-line') && ids(m).indexOf('route-line') < ids(m).indexOf('traffic-line'));
  a.setBuildings3d(true);
  ok('açık tonda 3B bina açık gri, rota çerçevesinin altında, düz bina gizli', m.getLayer(BUILDINGS_3D)?.paint['fill-extrusion-color'] === LIGHT_PALETTE.building && ids(m).indexOf(BUILDINGS_3D) < ids(m).indexOf('route-casing') && m.getLayer('building').layout.visibility === 'none');
}

// ---------------------------------------------------------------- 2b) ilk stil tek yükleme + yazı tipi indirgeme (glif istek patlaması)
{
  const { m } = await make(STYLE_LIGHT);
  const first = m.calls.find((c) => c[0] === 'setStyle');
  ok('temalı harita kurucuya stil vermez; ilk stil setStyle(url, {diff:false, transformStyle}) ile tek yüklenir', m.initialStyle === undefined && first?.[1] === STYLE_LIGHT && first[2]?.diff === false && first[2]?.transformStyle === slimFonts && m.calls.filter((c) => c[0] === 'setStyle').length === 1);
  const sample = { version: 8, layers: [
    { id: 'a', type: 'symbol', layout: { 'text-font': ['Noto Sans Italic'], 'text-field': '{name}' } },
    { id: 'b', type: 'symbol', layout: { 'text-font': ['Noto Sans Bold'] } },
    { id: 'c', type: 'symbol', layout: { 'text-font': ['Noto Sans Regular'] } },
    { id: 'd', type: 'fill', paint: { 'fill-color': '#fff' } },
  ] };
  const out = slimFonts(null, sample);
  ok('slimFonts: tüm etiketler tek yığın (Regular), diğer katmanlar ve alanlar aynen, girdi değişmez', out.layers.filter((l) => l.layout?.['text-font']).every((l) => l.layout['text-font'].length === 1 && l.layout['text-font'][0] === 'Noto Sans Regular') && out.layers[0].layout['text-field'] === '{name}' && out.layers[3].paint['fill-color'] === '#fff' && out.version === 8 && sample.layers[0].layout['text-font'][0] === 'Noto Sans Italic');
  const mbm = await make('mapbox://styles/mapbox/dark-v11', { name: 'mapbox' });
  ok('temasız motor kurucuya stili verir, setStyle ve yazı tipi indirgemesi yok', mbm.m.initialStyle === 'mapbox://styles/mapbox/dark-v11' && mbm.m.calls.length === 0);
}

// ---------------------------------------------------------------- 3) açık → koyu → açık: katmanlar kayıpsız, çiftsiz; kamera dokunulmaz
{
  const sat = { installs: 0, install(map) { this.installs++; if (!map.getSource('sat')) map.addSource('sat', { type: 'raster' }); }, set() {} };
  const { a, m } = await make(STYLE_LIGHT, { satellite: sat });
  const h = themeHandle(a);
  a.line(COORDS);
  a.traffic(COORDS, SPANS);
  a.setBuildings3d(true);
  a.moveTo({ center: { lat: 40.1, lon: 33.1 }, zoom: 15, heading: 77, tilt: 55 });
  const cam0 = JSON.stringify(m.cam);
  const camCalls = m.calls.length;
  const instBefore = sat.installs;

  ok('set(true): taban stil dark olur, diff:false (style.load gelsin), yazı tipi indirgemeli, true döner', h.set(true) === true && m.calls.at(-1)[0] === 'setStyle' && m.calls.at(-1)[1] === STYLE_DARK && m.calls.at(-1)[2]?.diff === false && m.calls.at(-1)[2]?.transformStyle === slimFonts);
  ok('stil yüklenirken eski kaynak yok (geçiş durumu) ama line/traffic/setBuildings3d çökmez', (() => { try { a.line(COORDS); a.traffic(COORDS, SPANS); a.setBuildings3d(true); return !m.getSource('route'); } catch { return false; } })());
  m.finishLoad();
  ok('ton dark; yeni stilde rota/trafik kaynakları geri geldi, veri korundu', h.tone() === 'dark' && m.getSource('route')?.data?.geometry?.coordinates?.length === COORDS.length && m.getSource('traffic')?.data?.features?.length === 1);
  ok('koyu tonda renkler bugünküyle aynı (sarı çerçeve, #1a73e8, turuncu/kırmızı/koyu kırmızı)', m.getLayer('route-casing').paint['line-color'] === '#ffd600' && m.getLayer('route-line').paint['line-color'] === '#1a73e8' && JSON.stringify(trafficColor(m)) === JSON.stringify(['match', ['get', 'lvl'], 'moderate', '#ff9100', 'heavy', '#e53935', 'severe', '#b71c1c', '#ff9100']));
  ok('3B bina geri kuruldu, koyu stil rengi (#2b333d), düz bina gizli', m.getLayer(BUILDINGS_3D)?.paint['fill-extrusion-color'] === '#2b333d' && m.getLayer('building').layout.visibility === 'none');
  ok('hiçbir katman/kaynak çift değil (addLayer çift kimlikte atar), tüm kimlikler tek', new Set(ids(m)).size === ids(m).length && ['route', 'traffic', 'sat'].every((id) => m.getSource(id)));
  ok('uydu stratejisi her stil yüklemesinde install çağrıldı', sat.installs === instBefore + 1);
  ok('kamera (konum/zoom/yön/eğim) korundu: tema değişimi jumpTo/easeTo/fitBounds çağırmadı', JSON.stringify(m.cam) === cam0 && m.calls.slice(camCalls).every((c) => c[0] === 'setStyle'));

  ok('aynı ton tekrar: hiçbir şey yapmaz (false, ek setStyle yok)', (() => { const n = m.calls.length; return h.set(true) === false && m.calls.length === n; })());

  h.set(false);
  m.finishLoad();
  ok('koyu → açık: ton light, açık palet, 3B bina açık gri, katmanlar tek', h.tone() === 'light' && m.getLayer('route-casing').paint['line-color'] === LIGHT_PALETTE.casing && m.getLayer(BUILDINGS_3D)?.paint['fill-extrusion-color'] === LIGHT_PALETTE.building && new Set(ids(m)).size === ids(m).length);
  ok('rota verisi iki geçişten sonra da duruyor', m.getSource('route')?.data?.geometry?.coordinates?.length === COORDS.length);

  // hızlı art arda geçiş: son ton kazanır, tek style.load ile tutarlı kurulum
  h.set(true); h.set(false); h.set(true);
  m.finishLoad();
  ok('hızlı koyu/açık/koyu: son ton (koyu) uygulanır, katmanlar tutarlı ve tek', h.tone() === 'dark' && m.pending === null && m.styleUrl === STYLE_DARK && m.getLayer('route-casing').paint['line-color'] === '#ffd600' && new Set(ids(m)).size === ids(m).length);

  // 3B kapalıyken geçiş: bina eklenmez, düz bina görünür
  a.setBuildings3d(false);
  h.set(false); m.finishLoad();
  ok('3B kapalıyken tema değişiminde bina katmanı eklenmez, düz bina görünür', !m.getLayer(BUILDINGS_3D) && m.getLayer('building').layout.visibility === 'visible');
}

// ---------------------------------------------------------------- 4) temaya bağlı olmayan sağlayıcılar
{
  const { a: mb } = await make('mapbox://styles/mapbox/dark-v11', { name: 'mapbox' });
  const { a: off } = await make({ version: 8, sources: {}, layers: [] }, { name: 'offline' });
  ok('Mapbox/TomTom/HERE/offline motorunda tema denetimi yok (koyu kalır)', themeHandle(mb) === null && themeHandle(off) === null);
  const { a: osm } = await make(STYLE_DARK);
  ok('bağdaştırıcı yöntem kümesi temalı ve temasız motorda birebir aynı (test-map-provider sözleşmesi)', Object.keys(osm).sort().join() === Object.keys(mb).sort().join());
  const { m: mbm } = await make('mapbox://styles/mapbox/dark-v11', { name: 'mapbox' });
  ok('temasız motor koyu paletle kurulur (sarı çerçeve)', mbm.getLayer('route-casing').paint['line-color'] === '#ffd600');
}

// ---------------------------------------------------------------- 5) kontrast (açık harita)
{
  const lum = (hex) => { const n = hex.replace('#', ''); const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const BG = ['#f2f3f0', '#ffffff']; // positron zemin ve yollar (OpenFreeMap positron stilinden, 2026-11-22 okundu)
  const L = LIGHT_PALETTE;
  for (const bg of BG) {
    ok(`açık harita: rota çerçevesi ${L.casing} / ${bg} ≥ 3:1`, ratio(L.casing, bg) >= 3, ratio(L.casing, bg).toFixed(2));
    ok(`açık harita: rota çizgisi #1a73e8 / ${bg} ≥ 3:1`, ratio('#1a73e8', bg) >= 3, ratio('#1a73e8', bg).toFixed(2));
    for (const c of L.traffic) ok(`açık harita: trafik ${c} / ${bg} ≥ 3:1`, ratio(c, bg) >= 3, ratio(c, bg).toFixed(2));
    ok(`açık harita: araç işareti #087f52 ve simülasyon #1558c0 / ${bg} ≥ 4.5:1`, ratio('#087f52', bg) >= 4.5 && ratio('#1558c0', bg) >= 4.5);
    ok(`açık harita: istasyon iğnesi koyu kenarı #16263d / ${bg} ≥ 3:1`, ratio('#16263d', bg) >= 3);
  }
  const mv = read('js/ui/mapView.js');
  ok('mapView.js açık haritada araç işareti renkleri #087f52 / #1558c0', mv.includes("'#1558c0'") && mv.includes("'#087f52'") && mv.includes("'#5aa9ff'") && mv.includes("'#2ee6a6'"));
}

// ---------------------------------------------------------------- 6) kaynak sözleşmesi (arayüz bağı, not, ağ)
{
  const mv = read('js/ui/mapView.js'), ml = read('js/ui/maps/maplibre.js'), eng = read('js/ui/maps/mapEngine.js'), css = read('css/styles.css');
  ok('mapView.js: <html data-theme> MutationObserver ile izlenir; değişince harita tonu uygulanır ve araç işareti tazelenir', /new MutationObserver\(\(\) => \{ if \(!adapter\) return; applyTone\(\); recolorMe\(\); updateMe\(\); \}\)\.observe\(document\.documentElement, \{ attributes: true, attributeFilter: \['data-theme'\] \}\)/.test(mv));
  ok('mapView.js: harita açılırken de ton eşitlenir (yükleme sırasında tema değişmiş olabilir)', /setActiveMap\([^\n]*\n\s*applyTone\(\);/.test(mv));
  ok('mapView.js: #map[data-tone] işaretlenir', /mapEl\.dataset\.tone = th\?\.tone\(\) \|\| 'dark'/.test(mv));
  ok('maplibre.js: stil yüklemeden hemen önce temadan seçilir; E4 kilitli free-only satırı yerinde', /const STYLE = styleFor\(isDark\(\)\)/.test(ml) && /if \(freeOnly\) return createVectorMap\(ml, container, \{ mapOptions: \{ style: STYLE, transformRequest: freeMapRequest \}, name: 'osm', buildings: BUILDINGS \}\)/.test(ml));
  ok('maplibre.js: OFFLINE_STYLE (duraklatma) değişmedi, tema ona bağlı değil', /name: 'offline-paused'/.test(ml) && /'background-color': '#1c2128'/.test(ml));
  ok('yeni ağ çağrısı yok: mapEngine.js/maplibre.js/mapView.js stil/tema kodunda fetch eklenmedi', !/\bfetch\(/.test(eng) && !/\bfetch\(/.test(ml));
  ok('CSS: açık haritada istasyon iğnesi kenarı koyu, planlı durak uyarı kenarı korunur, odak kuralı sonda', /#map\[data-tone="light"\] \.spin path \{ stroke: #16263d; \}/.test(css) && /#map\[data-tone="light"\] \.spin\.planned path \{ stroke: var\(--warn\); \}/.test(css) && css.indexOf('.spin.planned path { stroke: var(--warn)') < css.indexOf('#map[data-tone="light"] .spin.focus path'));
  const html = read('index.html');
  ok('Görünüm notu doğru söylüyor: OpenFreeMap temaya uyar, diğer sağlayıcılar koyu kalır; eski "her sağlayıcıda koyu" yok', html.includes('Ücretsiz OpenFreeMap haritası temaya uyar; diğer harita sağlayıcıları koyu kalır.') && !/her sağlayıcıda koyu/.test(html + read('i18n/keys.extra.json')));
}

console.log(`\n${pass} geçti, ${fail} kaldı`);
if (fail) process.exit(1);
