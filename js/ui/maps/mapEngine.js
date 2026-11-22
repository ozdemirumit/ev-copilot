// Ortak vektör-harita motoru: MapLibre GL JS (OpenFreeMap) ve Mapbox GL JS aynı alt kümeyi kullandığından bağdaştırıcı gövdesi burada.
// lib: yüklenmiş kütüphane nesnesi (maplibregl | mapboxgl). Zoom web-mercator (Google) ölçeğinde verilir (512 px karo: 1 eksik uygulanır).
// Rota ve trafik katmanları tek bir installLayers() içinde kurulur: stil değişirse ('style.load') son veriyle yeniden uygulanır.
// Uydu stratejisi { install(map), set(map, on) }: install her katman kurulumunda çağrılır; set stil değiştirecekse
// setStyle(..., { diff: false }) kullanmalı ki 'style.load' gelsin ve rota/trafik katmanları geri konsun.
// Temaya bağlı taban stil (yalnız kayıtlı sağlayıcılar, ör. OpenFreeMap): registerThemedStyles(ad, { dark, light }) ile kaydedilir;
// motor themeHandle(adapter) ile { tone(), set(dark) } sunar. Diğer sağlayıcılar kayıtsızdır (koyu kalır, themeHandle null döner).
import { bindEngineGestures } from '../mapGesture.js';

export const ZOOM_OFFSET = 1;

const EMPTY = { type: 'FeatureCollection', features: [] };

// Temaya bağlı taban stiller: ad → { dark, light } stil adresleri.
const THEMED = new Map();
export function registerThemedStyles(name, { dark, light }) { THEMED.set(name, Object.freeze({ dark, light })); }

// Tema denetimi bağdaştırıcı nesnesine EKLENMEZ (tüm sağlayıcıların yöntem kümesi birebir aynı kalır: test-map-provider); yan kanaldan okunur.
const THEME_HANDLES = new WeakMap();
/** Bağdaştırıcının tema denetimi { tone(), set(dark) } ya da (temaya bağlı olmayan sağlayıcı/Google) null.
 *  tone(): 'dark' | 'light' (taban harita tonu). set(dark): taban stil yeniden yüklenir, değiştiyse true. */
export const themeHandle = (adapter) => THEME_HANDLES.get(adapter) || null;

/** Açık taban harita (OpenFreeMap positron) için rota çerçevesi/trafik/3B bina renkleri; mavi rota çizgisi (#1a73e8) her tonda aynı.
 *  Koyu harita değerleri installLayers içindeki sabitlerdir (sarı çerçeve, turuncu/kırmızı/koyu kırmızı trafik: bugünkü hâli aynen).
 *  Açık harita (≥3:1 hedefi, #f2f3f0 zemine göre): lacivert dış çerçeve 9.3:1, mavi çizgi 4.0:1 (beyaz yolda 4.5:1),
 *  trafik turuncu 3.4 / kırmızı 4.5 / koyu kırmızı 8.8. */
export const LIGHT_PALETTE = Object.freeze({ casing: '#0b3a91', traffic: Object.freeze(['#e65100', '#d32f2f', '#8e0000']), building: '#cfd2cc' });

/** OpenFreeMap positron üç yazı tipi yığını (Regular/Italic/Bold) kullanır: glif istekleri koyu stilin (yalnız Regular) üç katına çıkar ve
 *  cihazdaki ücretsiz servis koruması (providerGate openfreemap patlama 20) aşılınca glifler reddedilir, karolar "errored" olup harita boş kalır
 *  (2026-11-22 tarayıcıda görüldü). Temaya bağlı stillerde tüm etiketler tek yığına (Regular) indirgenir; istek sayısı koyu stille aynı kalır. */
const FONT = ['Noto Sans Regular'];
export const slimFonts = (_prev, style) => ({ ...style, layers: (style.layers || []).map((l) => (l.layout?.['text-font'] ? { ...l, layout: { ...l.layout, 'text-font': [...FONT] } } : l)) });
const trafficColor = (c) => ['match', ['get', 'lvl'], 'moderate', c[0], 'heavy', c[1], 'severe', c[2], c[0]];

// 3B binalar (navigasyonda 3B görünüm): buildings = { layer, hide } sağlayıcıya özgü tanımdır. layer: kimliksiz 'fill-extrusion'
// katmanı (kaynak/kaynak katmanı stile göre); hide: 3B açıkken gizlenecek düz bina dolgusu katmanları. Katman rota çizgisinin altına
// konur; stil değişiminde ('style.load') istenen durum installLayers ile yeniden uygulanır.
export const BUILDINGS_3D = 'buildings-3d';

/** Sağlayıcıya özgü 3B bina katmanı (ortak görünüm: koyu stile uygun renk, ~%80 opaklık; minzoom kütüphane ölçeğinde,
 *  14 = uygulama zoom'u 15). source: vektör kaynağı, filter: yükseltilecek binalar, height/base: yükseklik alanlarının adları. */
export const buildingsLayer = ({ source, filter, height, base }) => ({
  type: 'fill-extrusion', source, 'source-layer': 'building', minzoom: 14, filter,
  paint: {
    'fill-extrusion-color': '#2b333d',
    'fill-extrusion-height': ['coalesce', ['get', height], 0],
    'fill-extrusion-base': ['coalesce', ['get', base], 0],
    'fill-extrusion-opacity': 0.8,
  },
});

// onError(e): kütüphanenin 'error' olayları; isFatal(e) true dönerse yükleme bitmeden gelen hata yüklemeyi hemen bitirir (ör. Mapbox 401/403).
// Yükleme başarısızsa (zaman aşımı / ölümcül hata) map.remove() çağrılır: WebGL bağlamı ve dinleyiciler bırakılır.
export async function createVectorMap(lib, container, { mapOptions = {}, name, satellite, buildings, onError, isFatal, timeoutMs = 25000 } = {}) {
  const themed = THEMED.get(name); // temaya bağlı mı (OpenFreeMap)? Değilse ton hep koyu
  // Temaya bağlı haritada ilk stil de slimFonts ile yüklenir: kurucuya stil verilmez, hemen ardından setStyle (tek yükleme, istek artmaz).
  const bootStyle = themed && typeof mapOptions.style === 'string' ? mapOptions.style : null;
  const map = new lib.Map({
    container, center: [35.0, 39.0], zoom: 6 - ZOOM_OFFSET, maxPitch: 60,
    attributionControl: false, // atıf aşağıda kompakt denetimle eklenir (OSM atfı ODbL gereği zorunlu)
    ...mapOptions,
    ...(bootStyle ? { style: undefined } : {}),
  });
  if (bootStyle) map.setStyle(bootStyle, { diff: false, transformStyle: slimFonts });
  let failLoad = null; // yükleme sürerken ölümcül hatayı yükleme sözüne iletir
  if (onError) {
    // dinleyici yalnızca istenirse: yoksa kütüphane hatayı bugünkü gibi konsola yazar
    map.on('error', (e) => { onError(e); if (failLoad && isFatal?.(e)) failLoad(new Error('Harita yüklenemedi (anahtar reddedildi)')); });
  }
  map.addControl(new lib.AttributionControl({ compact: true }), 'bottom-left'); // atıf zorunlu; alt çubuğun altında durur
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Harita yüklenemedi (internet?)')), timeoutMs);
      failLoad = (err) => { clearTimeout(t); reject(err); };
      map.once('load', () => { clearTimeout(t); resolve(); });
    });
  } catch (err) {
    try { map.remove(); } catch { /* yarım harita: kaldırma hatası yoksayılır */ }
    throw err;
  } finally {
    failLoad = null;
  }

  // Kompakt atıf kutusu açık başlar ve haritayı kaplar: kapalı başlat (ⓘ düğmesiyle açılır, atıf erişilebilir kalır)
  const attrib = container.querySelector('.maplibregl-ctrl-attrib, .mapboxgl-ctrl-attrib');
  attrib?.classList.remove('maplibregl-compact-show', 'mapboxgl-compact-show');
  attrib?.removeAttribute('open');

  let routeData = EMPTY; // stil değişiminde geri yüklenecek son veriler
  let trafficData = EMPTY;
  let want3d = false; // istenen bina görünümü (stil değişiminde yeniden uygulanır)
  let tone = themed && mapOptions.style === themed.light ? 'light' : 'dark';

  // 3B bina katmanını istenen duruma getirir. Rota kaynağı yoksa stil henüz yükleniyordur: 'style.load' → installLayers uygular.
  // Stilde bina kaynağı yoksa (beklenmedik stil) katman eklenmez.
  function applyBuildings() {
    if (!buildings || !map.getSource('route')) return;
    const on = want3d && !!map.getSource(buildings.layer.source);
    const bColor = tone === 'light' ? LIGHT_PALETTE.building : null; // açık harita: açık gri bina; koyuda sağlayıcının kendi rengi
    const layer = bColor ? { ...buildings.layer, paint: { ...buildings.layer.paint, 'fill-extrusion-color': bColor } } : buildings.layer;
    if (on && !map.getLayer(BUILDINGS_3D)) map.addLayer({ ...layer, id: BUILDINGS_3D }, 'route-casing');
    else if (!on && map.getLayer(BUILDINGS_3D)) map.removeLayer(BUILDINGS_3D);
    for (const id of buildings.hide || []) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'none' : 'visible');
  }

  // Rota çizgisi: tek kaynak + katman; remove() çizgiyi boşaltır. Trafik: rota çizgisinin üstünde yavaş (sarı), yoğun (kırmızı),
  // çok yoğun (koyu kırmızı) kesimler. Kaynak zaten varsa (aynı stil) dokunulmaz.
  function installLayers() {
    if (map.getSource('route')) return;
    map.addSource('route', { type: 'geojson', data: routeData });
    map.addSource('traffic', { type: 'geojson', data: trafficData });
    const casing = { id: 'route-casing', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffd600', 'line-width': 12, 'line-opacity': 1 } }; // sarı dış çerçeve
    const line = { id: 'route-line', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#1a73e8', 'line-width': 8, 'line-opacity': 1 } }; // kalın mavi rota
    const traffic = {
      id: 'traffic-line', type: 'line', source: 'traffic', layout: { 'line-join': 'round', 'line-cap': 'butt' },
      paint: { 'line-color': ['match', ['get', 'lvl'], 'moderate', '#ff9100', 'heavy', '#e53935', 'severe', '#b71c1c', '#ff9100'], 'line-width': 8, 'line-opacity': 1 },
    };
    if (tone === 'light') { // açık harita: yukarıdaki koyu harita renkleri açık zeminde okunmaz (sarı 1.3:1, turuncu 2.0:1)
      casing.paint['line-color'] = LIGHT_PALETTE.casing;
      traffic.paint['line-color'] = trafficColor(LIGHT_PALETTE.traffic);
    }
    map.addLayer(casing);
    map.addLayer(line);
    map.addLayer(traffic);
    satellite?.install?.(map);
    if (want3d) applyBuildings(); // yeni stilde 3B binalar (kapalıysa yeni stil zaten düz)
  }
  installLayers();
  map.on('style.load', installLayers); // ilk yüklemeden sonraki stil değişimleri (ör. uydu stili) katmanları silerse geri koy

  const adapter = {
    name,
    installLayers, // stil değişimini kendisi yöneten bağdaştırıcılar için (uygulama kodu kullanmaz)
    setSatellite(on) { satellite?.set(map, on); },

    /** Navigasyonda 3B: binalar yüksekliğiyle (fill-extrusion) çizilir; false düz haritaya döner. */
    setBuildings3d(on) { want3d = !!on; applyBuildings(); },
    marker(pos, content, title = '') {
      // Kütüphane, verdiği elemanın transform'unu kendisi yönetir: içeriği (kendi transform'u olan nokta/ok) bir sarmalayıcıya koy.
      const wrap = document.createElement('div');
      wrap.append(content);
      if (title) wrap.title = title;
      const m = new lib.Marker({ element: wrap, anchor: 'bottom' }).setLngLat([pos.lon, pos.lat]).addTo(map);
      return {
        setPosition: (p) => m.setLngLat([p.lon, p.lat]),
        setContent: (c) => { if (wrap.firstChild !== c) wrap.replaceChildren(c); },
        remove: () => m.remove(),
      };
    },
    // Stil değişirken (uydu) kaynak geçici olarak yoktur: veri yine saklanır ve 'style.load' ile installLayers onu uygular.
    /** spans: [{ from, to, lvl }] (km). Her aralık, rota koordinatlarından kesilip ayrı çizgi olur. */
    traffic(coords, spans) {
      if (!spans?.length) { trafficData = EMPTY; return map.getSource('traffic')?.setData(trafficData); }
      const cum = [0];
      for (let i = 1; i < coords.length; i++) {
        const dLat = ((coords[i][1] - coords[i - 1][1]) * Math.PI) / 180;
        const dLon = ((coords[i][0] - coords[i - 1][0]) * Math.PI) / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos((coords[i - 1][1] * Math.PI) / 180) * Math.cos((coords[i][1] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
        cum.push(cum[i - 1] + 6371 * 2 * Math.asin(Math.sqrt(a)));
      }
      const at = (km) => { let i = 0; while (i < cum.length - 1 && cum[i + 1] < km) i++; return i; };
      const features = spans.map((s) => {
        const i0 = at(s.from);
        const i1 = Math.min(coords.length - 1, at(s.to) + 1);
        return { type: 'Feature', properties: { lvl: s.lvl }, geometry: { type: 'LineString', coordinates: coords.slice(i0, i1 + 1) } };
      }).filter((f) => f.geometry.coordinates.length >= 2);
      trafficData = { type: 'FeatureCollection', features };
      map.getSource('traffic')?.setData(trafficData);
    },
    line(coords) {
      routeData = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} };
      map.getSource('route')?.setData(routeData);
      return { remove: () => { routeData = EMPTY; map.getSource('route')?.setData(EMPTY); } };
    },
    fit(points, pad) {
      const lons = points.map((p) => p.lon);
      const lats = points.map((p) => p.lat);
      map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: pad, duration: 0, maxZoom: 16 });
    },
    moveTo({ center, zoom, heading, tilt }, animate = false) {
      const o = {};
      if (center) o.center = [center.lon, center.lat];
      if (zoom != null) o.zoom = zoom - ZOOM_OFFSET;
      if (heading != null) o.bearing = heading;
      if (tilt != null) o.pitch = tilt;
      if (animate) map.easeTo({ ...o, duration: 700, easing: (t) => t }); // takip: art arda gelen güncellemeler akıcı birleşir
      else map.jumpTo(o);
    },
    onClick: (fn) => map.on('click', (e) => fn({ lat: e.lngLat.lat, lon: e.lngLat.lng })),
    onDragStart: (fn) => bindEngineGestures(map, fn), // kullanıcı sürükleme/pinch/çift dokunma/döndürme/eğme (programatik hareket değil)
    cursor: (c) => { map.getCanvas().style.cursor = c || ''; },
    resize: () => map.resize(),
    bearing: () => map.getBearing(),
  };
  if (themed) {
    THEME_HANDLES.set(adapter, {
      tone: () => tone,
      // Arayüz teması değişti: taban stil yeniden yüklenir (konum/zoom/yön/eğim korunur; rota, trafik, uydu ve 3B bina 'style.load' →
      // installLayers ile bu tonun renkleriyle geri kurulur). Ton aynıysa hiçbir şey yapmaz.
      set(dark) {
        const next = dark ? 'dark' : 'light';
        if (next === tone) return false;
        tone = next;
        map.setStyle(themed[next], { diff: false, transformStyle: slimFonts });
        return true;
      },
    });
  }
  return adapter;
}
