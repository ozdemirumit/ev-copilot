import { getState, patch, subscribe, effective } from '../state.js';
import { load, save } from '../utils/storage.js';
import { toast } from './toast.js';
import { attachSearch, reverseLabel } from './placeSearch.js';

/** Harita çizim API'si; initMap() çağrılınca dolar (routing/controller.js kullanır). */
export const mapApi = { drawRoute() {}, drawStations() {}, drawNearby() {}, setPoint() {}, follow() {} };

const fmt = (p) => (p ? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` : '');

function pinIcon(kind, label) {
  return L.divIcon({
    className: '',
    html: `<div class="pin ${kind}"><b>${label}</b></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
  });
}

export function initMap() {
  const map = L.map('map', { zoomControl: true }).setView([39.0, 35.0], 6); // Türkiye
  // Varsayılan: OpenStreetMap karoları, koyu görünüm CSS filtresiyle (.dark-tiles). Kullanıcı CARTO anahtarı girerse
  // yerel koyu CARTO karoları kullanılır. Anahtar kod/depoda tutulmaz; yalnızca bu cihazın LocalStorage'ında durur.
  const osmTiles = () => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    className: 'dark-tiles',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  });
  const cartoTiles = (key) => L.tileLayer(`https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`, {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  });
  const keyInput = document.getElementById('carto-key');
  keyInput.value = load('cartoKey', '');
  let tiles = keyInput.value ? cartoTiles(keyInput.value) : osmTiles();

  // Veri tasarrufu: harita karoları kapalıyken rota çizgisi, istasyonlar ve araç koyu zeminde görünür (karo başı ≈ 15–20 KB).
  // Tarayıcının "Veri Tasarrufu" modu açıksa varsayılan kapalıdır.
  const saver = document.getElementById('map-saver');
  saver.checked = load('noTiles', navigator.connection?.saveData === true);
  const applyTiles = () => (saver.checked ? map.removeLayer(tiles) : tiles.addTo(map));
  saver.addEventListener('change', () => { save('noTiles', saver.checked); applyTiles(); });
  keyInput.addEventListener('change', () => {
    const key = keyInput.value.trim();
    save('cartoKey', key);
    map.removeLayer(tiles);
    tiles = key ? cartoTiles(key) : osmTiles();
    applyTiles();
  });
  applyTiles();

  const markers = { start: null, end: null };
  let pickMode = null; // 'start' | 'end' | null
  let me = null; // canlı konum işareti

  mapApi.setPoint = (...a) => setPoint(...a);

  const startInput = document.getElementById('route-start');
  const endInput = document.getElementById('route-end');
  const pickBtns = { start: document.getElementById('pick-start'), end: document.getElementById('pick-end') };

  function setPickMode(mode) {
    pickMode = mode;
    Object.entries(pickBtns).forEach(([k, b]) => b.classList.toggle('sel', k === mode));
    document.getElementById('map').style.cursor = mode ? 'crosshair' : '';
    if (mode) toast(mode === 'start' ? 'Başlangıç için haritaya dokun' : 'Varış için haritaya dokun');
  }

  const inputFor = (kind) => (kind === 'start' ? startInput : endInput);

  function setPoint(kind, point, { zoom = false, fit = true } = {}) {
    patch('route', { [kind]: point });
    if (markers[kind]) { markers[kind].remove(); markers[kind] = null; }
    inputFor(kind).value = point ? point.label || fmt(point) : '';
    if (point) {
      markers[kind] = L.marker([point.lat, point.lon], { icon: pinIcon(kind, kind === 'start' ? 'A' : 'B') }).addTo(map);
    }
    const { start, end } = getState('route');
    if (start && end && fit) map.fitBounds(L.latLngBounds([start.lat, start.lon], [end.lat, end.lon]), { padding: [40, 40] });
    else if (point && zoom && fit) map.setView([point.lat, point.lon], 12);
  }

  // Yer/adres arama: yazarken öneri, seçince işaret koy ve oraya git
  ['start', 'end'].forEach((kind) => {
    attachSearch(inputFor(kind), document.getElementById('suggest-' + kind), (r) => {
      setPoint(kind, { lat: r.lat, lon: r.lon, label: r.sub ? `${r.label}, ${r.sub.split(', ').slice(-2)[0]}` : r.label }, { zoom: true });
      if (kind === 'start' && !getState('route').end) inputFor('end').focus();
    });
  });

  map.on('click', (e) => {
    if (!pickMode) return;
    const kind = pickMode;
    const pt = { lat: e.latlng.lat, lon: e.latlng.lng };
    setPoint(kind, pt);
    reverseLabel(pt.lat, pt.lon).then((label) => { // okunur ad gelince kutuyu güncelle
      if (label && getState('route')[kind] === pt) { pt.label = label; inputFor(kind).value = label; }
    });
    setPickMode(kind === 'start' ? 'end' : null); // başlangıçtan sonra otomatik varışa geç
  });

  pickBtns.start.addEventListener('click', () => setPickMode(pickMode === 'start' ? null : 'start'));
  pickBtns.end.addEventListener('click', () => setPickMode(pickMode === 'end' ? null : 'end'));

  document.getElementById('btn-clear-route').addEventListener('click', () => {
    setPoint('start', null);
    setPoint('end', null);
    setPickMode(null);
  });

  document.getElementById('btn-mylocation').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Bu tarayıcıda Geolocation yok');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'Konumum' };
        setPoint('start', p, { zoom: true });
      },
      (err) => toast('Konum alınamadı: ' + err.message),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  // Rota çizgisi ve istasyon işaretleri (routing/controller.js çağırır)
  let routeLine = null;
  const stationLayer = L.layerGroup().addTo(map);
  mapApi.drawRoute = (coords, { fit = true } = {}) => {
    routeLine?.remove();
    routeLine = L.polyline(coords.map((c) => [c[1], c[0]]), { color: '#2ee6a6', weight: 5, opacity: 0.85 }).addTo(map);
    if (fit) map.fitBounds(routeLine.getBounds(), { padding: [30, 30] });
  };

  // Navigasyonda harita aracı izler; kullanıcı haritayı elle kaydırırsa 15 sn izleme durur.
  let lastDrag = 0;
  map.on('dragstart', () => { lastDrag = Date.now(); });
  mapApi.follow = (lat, lon, zoom = null, force = false) => {
    if (!force && Date.now() - lastDrag < 15000) return;
    map.setView([lat, lon], zoom ?? map.getZoom(), { animate: false });
  };

  // "Yakınımdaki istasyonlar" listesindekiler (seçili olan vurgulanır)
  const nearLayer = L.layerGroup().addTo(map);
  mapApi.drawNearby = (list, focusId = null) => {
    nearLayer.clearLayers();
    list.forEach((s) => {
      const tip = document.createElement('span');
      tip.textContent = `${s.name} · ${s.kw} kW · ${s.price.toFixed(2)} TL/kWh`;
      const on = s.id === focusId;
      L.circleMarker([s.lat, s.lon], { radius: on ? 9 : 6, color: on ? '#fff' : '#b48cff', fillColor: '#b48cff', fillOpacity: 0.85, weight: on ? 3 : 1 })
        .bindTooltip(tip).addTo(nearLayer);
    });
  };
  mapApi.drawStations = (stations, stops) => {
    stationLayer.clearLayers();
    const inPlan = new Set(stops.map((s) => s.station.id));
    stations.forEach((s) => {
      const planned = inPlan.has(s.id);
      const tip = document.createElement('span'); // OSM adları HTML olarak yorumlanmasın
      tip.textContent = `${s.name} · ${s.kw} kW`;
      L.circleMarker([s.lat, s.lon], {
        radius: planned ? 9 : 5, color: planned ? '#ffb547' : '#5aa9ff', fillColor: planned ? '#ffb547' : '#5aa9ff', fillOpacity: 0.85,
      }).bindTooltip(tip).addTo(stationLayer);
    });
  };

  // Minimum varış pili eşiği
  const slider = document.getElementById('min-arrival');
  const out = document.getElementById('min-arrival-out');
  slider.value = getState('route').minArrivalSoc;
  out.textContent = '%' + slider.value;
  slider.addEventListener('input', () => {
    out.textContent = '%' + slider.value;
    patch('route', { minArrivalSoc: Number(slider.value) });
    save('minArrival', Number(slider.value));
  });

  // Araç konumu: GPS, Test Modu'nda simülatör konumu
  subscribe(['live', 'sim'], () => {
    const e = effective();
    if (e.lat == null || e.lon == null) return;
    const color = e.source === 'sim' ? '#5aa9ff' : '#2ee6a6';
    if (!me) me = L.circleMarker([e.lat, e.lon], { radius: 7, weight: 3, fillOpacity: 0.9 }).addTo(map);
    me.setLatLng([e.lat, e.lon]).setStyle({ color, fillColor: color });
  });

  // Gizli sekmede boyut 0 olur; görününce yeniden hesapla.
  document.addEventListener('tabchange', (e) => {
    if (e.detail === 'route') setTimeout(() => map.invalidateSize(), 50);
  });

  return map;
}
