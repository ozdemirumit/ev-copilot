// Harita bağdaştırıcısı: MapLibre GL JS (yerel vendor/maplibre kopyası, BSD-3). Arayüz maps/google.js ile aynıdır; zoom Google ölçeğinde
// verilir (MapLibre 512 px karo kullandığından 1 eksik uygulanır).
// İki harita kaynağı: çevrimiçi OpenFreeMap (OpenStreetMap verisi, anahtarsız) ve cihaza indirilmiş ülke paketi (PMTiles, çevrimdışı).
// Seçim (localStorage `mapMode`): 'auto' (varsayılan: internet varsa çevrimiçi, yoksa paket) | 'offline' | 'online'.
// Auto'da bağlantı kopunca paket varsa stil kendiliğinden çevrimdışıya geçer, bağlantı gelince çevrimiçine döner.
import { load } from '../../utils/storage.js';
import { packInfo } from '../../offline/pack.js';
import { offlineStyle, preload } from '../../offline/style.js';

const ONLINE_STYLE = 'https://tiles.openfreemap.org/styles/dark';
const COUNTRY = 'tur';
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

export const mapMode = () => load('mapMode', 'auto');

/** Şu an hangi stil kullanılmalı: 'offline' (paket varsa ve moda uygunsa) veya 'online'. */
function wanted() {
  const mode = mapMode();
  const hasPack = !!packInfo(COUNTRY);
  if (mode === 'online' || !hasPack) return 'online';
  if (mode === 'offline') return 'offline';
  return navigator.onLine ? 'online' : 'offline';
}

export async function createMapLibreMap(container) {
  const ml = await loadMapLibre();
  if (packInfo(COUNTRY)) preload().catch(() => {}); // kütüphaneler bellekte hazır olsun (internet kopunca yüklenemez)

  // Rota çizgisi stilin KENDİ içinde taşınır (kaynak + katman): setStyle tüm kaynak/katmanları sildiği için stil değişince rota kaybolmasın.
  const EMPTY = { type: 'FeatureCollection', features: [] };
  let routeData = EMPTY;
  const withRoute = (style) => ({
    ...style,
    sources: { ...style.sources, route: { type: 'geojson', data: routeData } },
    layers: [...style.layers, { id: 'route-line', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#2ee6a6', 'line-width': 5, 'line-opacity': 0.85 } }],
  });

  /** Stil nesnesi ve gerçekte kullanılan tür (paket açılamazsa çevrimiçine düşer). */
  async function pickStyle() {
    if (wanted() === 'offline') {
      try {
        const style = await offlineStyle(ml, COUNTRY);
        if (style) return { style: withRoute(style), kind: 'offline' };
      } catch (err) {
        console.warn('Çevrimdışı harita açılamadı, çevrimiçine dönülüyor:', err.message);
      }
    }
    let res;
    try {
      res = await fetch(ONLINE_STYLE, { signal: AbortSignal.timeout(15000) });
    } catch {
      throw new Error('Alternatif harita yüklenemedi (internet?)');
    }
    if (!res.ok) throw new Error(`Alternatif harita stili alınamadı (HTTP ${res.status})`);
    return { style: withRoute(await res.json()), kind: 'online' };
  }

  const first = await pickStyle();
  let kind = first.kind;
  const map = new ml.Map({
    container, style: first.style, center: [35.0, 39.0], zoom: 6 - ZOOM_OFFSET, maxPitch: 60,
    attributionControl: { compact: true }, // "© OpenStreetMap" atfı (ODbL) zorunlu
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(kind === 'offline' ? 'Çevrimdışı harita yüklenemedi' : 'Alternatif harita yüklenemedi (internet?)')), 25000);
    map.once('load', () => { clearTimeout(t); resolve(); });
  });

  if (['127.0.0.1', 'localhost'].includes(location.hostname)) window.__map = map; // yalnızca yerel geliştirme: tarayıcıdan test için

  // Kompakt atıf kutusu açık başlar ve haritayı kaplar: kapalı başlat (ⓘ düğmesiyle açılır, atıf erişilebilir kalır)
  const collapseAttrib = () => {
    const a = container.querySelector('.maplibregl-ctrl-attrib');
    a?.classList.remove('maplibregl-compact-show');
    a?.removeAttribute('open');
  };
  collapseAttrib();

  // Bağlantı değişince (auto mod) stili değiştir: işaretler DOM olduğu için etkilenmez, rota çizgisi stilin içinde taşınır
  let switching = false;
  async function resync() {
    if (switching || mapMode() !== 'auto' || !packInfo(COUNTRY)) return;
    const want = wanted();
    if (want === kind) return;
    switching = true;
    try {
      const next = await pickStyle();
      if (next.kind === kind) return;
      kind = next.kind;
      map.setStyle(next.style);
      setTimeout(collapseAttrib, 1500);
    } finally {
      switching = false;
    }
  }
  window.addEventListener('offline', resync);
  window.addEventListener('online', resync);

  return {
    name: 'osm',
    get styleKind() { return kind; },
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
    onDragStart: (fn) => map.on('dragstart', fn), // yalnızca kullanıcı sürüklemesi (programatik hareket değil)
    cursor: (c) => { map.getCanvas().style.cursor = c || ''; },
    resize: () => map.resize(),
  };
}
