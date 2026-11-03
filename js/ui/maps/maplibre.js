// Harita bağdaştırıcısı: MapLibre GL JS (yerel vendor/maplibre kopyası, BSD-3) + OpenFreeMap vektör karoları (OpenStreetMap verisi,
// anahtarsız). Gövde ortak vektör-harita motorundadır (mapEngine.js); burada kütüphane yükleme, stil ve Esri uydu stratejisi kalır.
import { createVectorMap, buildingsLayer, BUILDINGS_3D } from './mapEngine.js';

const STYLE = 'https://tiles.openfreemap.org/styles/dark';
const VENDOR = new URL('../../../vendor/maplibre/', import.meta.url).href;

let loading = null;
function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  loading ??= new Promise((resolve, reject) => {
    const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: VENDOR + 'maplibre-gl.css' });
    document.head.append(css);
    const s = Object.assign(document.createElement('script'), { src: VENDOR + 'maplibre-gl.js', async: true });
    s.onload = () => resolve(window.maplibregl);
    s.onerror = () => { loading = null; reject(new Error('Harita kütüphanesi yüklenemedi')); };
    document.head.append(s);
  });
  return loading;
}

/** Uydu görüntüsü (Esri World Imagery) + yol ve yer adı katmanları; rota çizgisinin altına, vektör haritanın üstüne konur.
 *  Yalnızca OpenFreeMap'te kullanılır (başka sağlayıcının haritasına Esri karıştırılmaz). İlk açılışta tembel eklenir. */
function esriSatellite() {
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  const SAT_LAYERS = [
    ['sat', 'World_Imagery/MapServer/tile', 'Tiles © Esri — Esri, Maxar, Earthstar Geographics ve GIS Kullanıcı Topluluğu'],
    ['sat-roads', 'Reference/World_Transportation/MapServer/tile', ''],
    ['sat-places', 'Reference/World_Boundaries_and_Places/MapServer/tile', ''],
  ];
  let satReady = false;
  let visible = false;
  // 3B binalar zaten çiziliyorsa uydu onların altına girer (yoksa görüntü binaları örter); her durumda rota çizgisinin altında.
  const addLayers = (map) => {
    const before = map.getLayer(BUILDINGS_3D) ? BUILDINGS_3D : 'route-line';
    for (const [id, path, attribution] of SAT_LAYERS) {
      map.addSource(id, { type: 'raster', tiles: [`${ESRI}${path}/{z}/{y}/{x}`], tileSize: 256, maxzoom: 18, attribution });
      map.addLayer({ id, type: 'raster', source: id, layout: { visibility: visible ? 'visible' : 'none' } }, before);
    }
  };
  return {
    // Katmanlar yeniden kurulursa (stil değişimi) uydu daha önce açıldıysa geri eklenir; ilk kurulumda bir şey yapılmaz.
    install(map) { if (satReady && !map.getSource('sat')) addLayers(map); },
    set(map, on) {
      if (!on && !satReady) return;
      if (!satReady) { satReady = true; addLayers(map); }
      visible = !!on;
      for (const [id] of SAT_LAYERS) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    },
  };
}

/** 3B binalar (navigasyonda 3B): OpenFreeMap karolarındaki (openmaptiles) bina yükseklikleri. Koyu stil binaları zoom 12'den düz
 *  ('building' dolgusu) çizer; 3B açıkken o gizlenir. hide_3d işaretli parçalar yükseltilmez. */
const BUILDINGS = {
  layer: buildingsLayer({ source: 'openmaptiles', filter: ['!=', ['get', 'hide_3d'], true], height: 'render_height', base: 'render_min_height' }),
  hide: ['building'],
};

export async function createMapLibreMap(container) {
  const ml = await loadMapLibre();
  return createVectorMap(ml, container, { mapOptions: { style: STYLE }, name: 'osm', satellite: esriSatellite(), buildings: BUILDINGS });
}
