// Ortak vektör-harita motoru: MapLibre GL JS (OpenFreeMap) ve Mapbox GL JS aynı alt kümeyi kullandığından bağdaştırıcı gövdesi burada.
// lib: yüklenmiş kütüphane nesnesi (maplibregl | mapboxgl). Zoom web-mercator (Google) ölçeğinde verilir (512 px karo: 1 eksik uygulanır).
// Rota ve trafik katmanları tek bir installLayers() içinde kurulur: stil değişirse ('style.load') son veriyle yeniden uygulanır.
// Uydu stratejisi { install(map), set(map, on) }: install her katman kurulumunda çağrılır; set stil değiştirecekse
// setStyle(..., { diff: false }) kullanmalı ki 'style.load' gelsin ve rota/trafik katmanları geri konsun.
export const ZOOM_OFFSET = 1;

const EMPTY = { type: 'FeatureCollection', features: [] };

export async function createVectorMap(lib, container, { mapOptions = {}, name, satellite, onError } = {}) {
  const map = new lib.Map({
    container, center: [35.0, 39.0], zoom: 6 - ZOOM_OFFSET, maxPitch: 60,
    attributionControl: false, // atıf aşağıda kompakt denetimle eklenir (OSM atfı ODbL gereği zorunlu)
    ...mapOptions,
  });
  if (onError) map.on('error', onError); // dinleyici yalnızca istenirse: yoksa kütüphane hatayı bugünkü gibi konsola yazar
  map.addControl(new lib.AttributionControl({ compact: true }), 'bottom-left'); // atıf zorunlu; alt çubuğun altında durur
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Harita yüklenemedi (internet?)')), 25000);
    map.once('load', () => { clearTimeout(t); resolve(); });
  });

  // Kompakt atıf kutusu açık başlar ve haritayı kaplar: kapalı başlat (ⓘ düğmesiyle açılır, atıf erişilebilir kalır)
  const attrib = container.querySelector('.maplibregl-ctrl-attrib, .mapboxgl-ctrl-attrib');
  attrib?.classList.remove('maplibregl-compact-show', 'mapboxgl-compact-show');
  attrib?.removeAttribute('open');

  let routeData = EMPTY; // stil değişiminde geri yüklenecek son veriler
  let trafficData = EMPTY;

  // Rota çizgisi: tek kaynak + katman; remove() çizgiyi boşaltır. Trafik: rota çizgisinin üstünde yavaş (sarı), yoğun (kırmızı),
  // çok yoğun (koyu kırmızı) kesimler. Kaynak zaten varsa (aynı stil) dokunulmaz.
  function installLayers() {
    if (map.getSource('route')) return;
    map.addSource('route', { type: 'geojson', data: routeData });
    map.addSource('traffic', { type: 'geojson', data: trafficData });
    map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#2ee6a6', 'line-width': 5, 'line-opacity': 0.85 } });
    map.addLayer({
      id: 'traffic-line', type: 'line', source: 'traffic', layout: { 'line-join': 'round', 'line-cap': 'butt' },
      paint: { 'line-color': ['match', ['get', 'lvl'], 'moderate', '#ffb547', 'heavy', '#ff5d6c', 'severe', '#c4001d', '#ffb547'], 'line-width': 6, 'line-opacity': 0.95 },
    });
    satellite?.install?.(map);
  }
  installLayers();
  map.on('style.load', installLayers); // ilk yüklemeden sonraki stil değişimleri (ör. uydu stili) katmanları silerse geri koy

  return {
    name,
    installLayers, // stil değişimini kendisi yöneten bağdaştırıcılar için (uygulama kodu kullanmaz)
    setSatellite(on) { satellite?.set(map, on); },
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
    /** spans: [{ from, to, lvl }] (km). Her aralık, rota koordinatlarından kesilip ayrı çizgi olur. */
    traffic(coords, spans) {
      const src = map.getSource('traffic');
      if (!src) return;
      if (!spans?.length) { trafficData = EMPTY; return src.setData(trafficData); }
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
      src.setData(trafficData);
    },
    line(coords) {
      routeData = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} };
      map.getSource('route').setData(routeData);
      return { remove: () => { routeData = EMPTY; map.getSource('route').setData(EMPTY); } };
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
    bearing: () => map.getBearing(),
  };
}
