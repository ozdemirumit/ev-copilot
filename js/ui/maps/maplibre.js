// Harita bağdaştırıcısı: MapLibre GL JS (yerel vendor/maplibre kopyası, BSD-3) + OpenFreeMap vektör karoları (OpenStreetMap verisi,
// anahtarsız). Arayüz maps/google.js ile aynıdır; zoom Google ölçeğinde verilir (MapLibre 512 px karo kullandığından 1 eksik uygulanır).
const STYLE = 'https://tiles.openfreemap.org/styles/dark';
const VENDOR = new URL('../../../vendor/maplibre/', import.meta.url).href;
const ZOOM_OFFSET = 1;

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

export async function createMapLibreMap(container) {
  const ml = await loadMapLibre();
  const map = new ml.Map({
    container, style: STYLE, center: [35.0, 39.0], zoom: 6 - ZOOM_OFFSET, maxPitch: 60,
    attributionControl: { compact: true }, // "© OpenStreetMap" atfı (ODbL) zorunlu
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Alternatif harita yüklenemedi (internet?)')), 25000);
    map.once('load', () => { clearTimeout(t); resolve(); });
  });

  // Kompakt atıf kutusu açık başlar ve haritayı kaplar: kapalı başlat (ⓘ düğmesiyle açılır, atıf erişilebilir kalır)
  const attrib = container.querySelector('.maplibregl-ctrl-attrib');
  attrib?.classList.remove('maplibregl-compact-show');
  attrib?.removeAttribute('open');

  // Rota çizgisi: tek kaynak + katman; remove() çizgiyi boşaltır
  const EMPTY = { type: 'FeatureCollection', features: [] };
  map.addSource('route', { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#2ee6a6', 'line-width': 5, 'line-opacity': 0.85 } });

  return {
    name: 'osm',
    marker(pos, content, title = '') {
      // MapLibre, verdiği elemanın transform'unu kendisi yönetir: içeriği (kendi transform'u olan nokta/ok) bir sarmalayıcıya koy.
      const wrap = document.createElement('div');
      wrap.append(content);
      if (title) wrap.title = title;
      const m = new ml.Marker({ element: wrap, anchor: 'bottom' }).setLngLat([pos.lon, pos.lat]).addTo(map);
      return {
        setPosition: (p) => m.setLngLat([p.lon, p.lat]),
        setContent: (c) => { if (wrap.firstChild !== c) wrap.replaceChildren(c); },
        remove: () => m.remove(),
      };
    },
    line(coords) {
      map.getSource('route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} });
      return { remove: () => map.getSource('route').setData(EMPTY) };
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
    onDragStart: (fn) => map.on('dragstart', fn), // yalnızca kullanıcı sürüklemesi (programatik hareket değil)
    cursor: (c) => { map.getCanvas().style.cursor = c || ''; },
    resize: () => map.resize(),
  };
}
