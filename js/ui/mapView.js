import { getState, patch, subscribe, effective } from '../state.js';
import { load, save } from '../utils/storage.js';
import { toast } from './toast.js';
import { attachSearch, reverseLabel } from './placeSearch.js';
import { loadGoogle, googleKey } from '../google/loader.js';
import { record } from '../google/usage.js';

/** Harita çizim API'si; initMap() çağrılınca dolar (routing/controller.js, nav/* kullanır). Harita henüz yüklenmediyse çizimler sıraya alınır. */
export const mapApi = { drawRoute() {}, drawStations() {}, drawNearby() {}, setPoint() {}, follow() {}, navView() {} };

let boot = async () => {};
/** Google anahtarı girilince/değişince haritayı (yeniden) başlat. */
export const bootMap = () => boot();

const fmt = (p) => (p ? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` : '');
const toLL = (p) => ({ lat: p.lat, lng: p.lon });

function el(tag, cls, text) {
  const d = document.createElement(tag);
  d.className = cls;
  if (text != null) d.textContent = text;
  return d;
}
const pinEl = (kind, label) => { const d = el('div', 'pin ' + kind); d.append(el('b', '', label)); return d; };

/**
 * Harita: Google Maps JavaScript API (koyu şema). Harita nesnesi anahtar girilene dek oluşmaz; bu sırada yapılan
 * işaretleme/çizim çağrıları sıraya alınır ve harita hazır olunca uygulanır. Rota/arama/istasyon mantığı haritadan bağımsızdır.
 */
export function initMap() {
  const mapEl = document.getElementById('map');
  let gmap = null;
  let lib = null; // { Polyline, LatLngBounds, AdvancedMarkerElement, event }
  let booting = null;
  const queue = [];
  const readyHooks = []; // harita hazır olunca bir kez çalışacak güncellemeler (sıraya alınması gereksiz olanlar)
  const whenMap = (fn) => (gmap ? fn() : queue.push(fn));
  const note = (t) => { mapEl.dataset.msg = t || ''; mapEl.classList.toggle('nomap', !!t); };

  // Veri tasarrufu: harita kapalıyken Google harita karoları hiç istenmez (rota, istasyon ve konum sayısal olarak çalışır).
  const saver = document.getElementById('map-saver');
  saver.checked = load('noTiles', navigator.connection?.saveData === true);
  mapEl.classList.toggle('hidden', saver.checked);

  boot = async () => {
    if (gmap || saver.checked) return;
    if (!googleKey()) return note('Haritayı görmek için yukarıdaki kutuya Google anahtarını gir');
    booting ??= (async () => {
      try {
        await loadGoogle();
        const [maps, markerLib, core] = await Promise.all([
          google.maps.importLibrary('maps'), google.maps.importLibrary('marker'), google.maps.importLibrary('core'),
        ]);
        note('');
        gmap = new maps.Map(mapEl, {
          center: { lat: 39.0, lng: 35.0 }, zoom: 6, mapId: 'DEMO_MAP_ID', renderingType: 'VECTOR', colorScheme: 'DARK', clickableIcons: false, // vektör: dönme/eğim için şart
          gestureHandling: 'greedy', streetViewControl: false, mapTypeControl: false, fullscreenControl: false,
        });
        record('maps'); // her harita oluşturma bir Dynamic Maps yüklemesi sayılır
        lib = { Polyline: maps.Polyline, LatLngBounds: core.LatLngBounds, AdvancedMarkerElement: markerLib.AdvancedMarkerElement, event: core.event };
        gmap.addListener('click', onMapClick);
        gmap.addListener('dragstart', () => { lastDrag = Date.now(); });
        queue.splice(0).forEach((fn) => fn());
        readyHooks.forEach((fn) => fn());
      } catch (err) {
        booting = null;
        note(err.message);
      }
    })();
    return booting;
  };

  saver.addEventListener('change', () => {
    save('noTiles', saver.checked);
    mapEl.classList.toggle('hidden', saver.checked);
    if (!saver.checked) boot().then(() => gmap && lib.event.trigger(gmap, 'resize'));
  });

  const marker = (position, content, title = '') => new lib.AdvancedMarkerElement({ map: gmap, position, content, title });
  const unmark = (m) => { if (m) m.map = null; };
  const fit = (points, pad) => {
    const b = new lib.LatLngBounds();
    points.forEach((p) => b.extend(toLL(p)));
    gmap.fitBounds(b, pad);
  };

  const markers = { start: null, end: null };
  let pickMode = null; // 'start' | 'end' | null
  let me = null; // canlı konum işareti
  let lastDrag = 0;

  mapApi.setPoint = (...a) => setPoint(...a);

  const startInput = document.getElementById('route-start');
  const endInput = document.getElementById('route-end');
  const pickBtns = { start: document.getElementById('pick-start'), end: document.getElementById('pick-end') };

  function setPickMode(mode) {
    pickMode = mode;
    Object.entries(pickBtns).forEach(([k, b]) => b.classList.toggle('sel', k === mode));
    gmap?.setOptions({ draggableCursor: mode ? 'crosshair' : null });
    if (mode) toast(mode === 'start' ? 'Başlangıç için haritaya dokun' : 'Varış için haritaya dokun');
  }

  const inputFor = (kind) => (kind === 'start' ? startInput : endInput);

  function setPoint(kind, point, { zoom = false, fit: doFit = true } = {}) {
    patch('route', { [kind]: point });
    inputFor(kind).value = point ? point.label || fmt(point) : '';
    whenMap(() => {
      unmark(markers[kind]);
      markers[kind] = point ? marker(toLL(point), pinEl(kind, kind === 'start' ? 'A' : 'B'), point.label || '') : null;
      const { start, end } = getState('route');
      if (start && end && doFit) fit([start, end], 40);
      else if (point && zoom && doFit) { gmap.setCenter(toLL(point)); gmap.setZoom(12); }
    });
  }

  // Yer/adres arama: yazarken öneri, seçince işaret koy ve oraya git
  ['start', 'end'].forEach((kind) => {
    attachSearch(inputFor(kind), document.getElementById('suggest-' + kind), (r) => {
      setPoint(kind, { lat: r.lat, lon: r.lon, label: r.sub ? `${r.label}, ${r.sub.split(', ').slice(-2)[0]}` : r.label }, { zoom: true });
      if (kind === 'start' && !getState('route').end) inputFor('end').focus();
    });
  });

  function onMapClick(e) {
    if (!pickMode) return;
    const kind = pickMode;
    const pt = { lat: e.latLng.lat(), lon: e.latLng.lng() };
    setPoint(kind, pt);
    reverseLabel(pt.lat, pt.lon).then((label) => { // okunur ad gelince kutuyu güncelle
      if (label && getState('route')[kind] === pt) { pt.label = label; inputFor(kind).value = label; }
    });
    setPickMode(kind === 'start' ? 'end' : null); // başlangıçtan sonra otomatik varışa geç
  }

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

  // Rota çizgisi ve istasyon işaretleri
  let routeLine = null;
  let routeCoords = null;
  let stationMarks = [];
  let nearMarks = [];
  mapApi.drawRoute = (coords, { fit: doFit = true } = {}) => whenMap(() => {
    routeLine?.setMap(null);
    routeCoords = coords;
    const path = coords.map((c) => ({ lat: c[1], lng: c[0] }));
    routeLine = new lib.Polyline({ path, strokeColor: '#2ee6a6', strokeOpacity: 0.85, strokeWeight: 5, map: gmap });
    if (doFit) fit(coords.filter((_, i) => i % 20 === 0 || i === coords.length - 1).map((c) => ({ lat: c[1], lon: c[0] })), 30);
  });

  // Navigasyonda harita aracı izler; kullanıcı haritayı elle kaydırırsa 15 sn izleme durur.
  let lastHeading = 0;
  let navOn = false;
  let headingUp = true;
  let zoomNow = 6;

  /**
   * Araç takibi. heading verilirse (navigasyon) harita gidiş yönüne döner (yön-yukarı): dönüş her güncellemede farkın ~%60'ı
   * kadar yumuşatılır. Navigasyonda merkez, aracın biraz İLERİSİNE konur: araç ekranın alt kısmında, yol önü geniş görünür.
   */
  mapApi.follow = (lat, lon, zoom = null, force = false, heading = null) => {
    if (!gmap || (!force && Date.now() - lastDrag < 15000)) return;
    if (zoom != null) { gmap.setZoom(zoom); zoomNow = zoom; }
    let center = { lat, lng: lon };
    if (heading != null && headingUp && gmap.setHeading) {
      const delta = ((heading - lastHeading + 540) % 360) - 180;
      if (Math.abs(delta) > 2) { lastHeading = (lastHeading + delta * 0.6 + 360) % 360; gmap.setHeading(lastHeading); }
    }
    if (navOn && headingUp) {
      const mpp = (156543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoomNow; // metre/piksel
      const d = mapEl.clientHeight * 0.22 * mpp; // harita yüksekliğinin ~%22'si kadar ileri
      const h = (lastHeading * Math.PI) / 180;
      center = { lat: lat + (d * Math.cos(h)) / 111320, lng: lon + (d * Math.sin(h)) / (111320 * Math.cos((lat * Math.PI) / 180)) };
    }
    gmap.setCenter(center);
  };
  /** Navigasyon görünümü: açıkken eğik (3D); up=true ise yön-yukarı, değilse kuzey-yukarı. Kapanınca düz kuzey-yukarı harita. */
  mapApi.navView = (on, up = true) => {
    navOn = on;
    headingUp = up;
    if (gmap) {
      if (gmap.setTilt) gmap.setTilt(on && up ? 40 : 0);
      if ((!on || !up) && gmap.setHeading) { gmap.setHeading(0); lastHeading = 0; }
    }
    updateMe();
  };
  /** Kullanıcı haritayı kaydırdı mı (takip duraklatıldı)? */
  mapApi.dragged = () => Date.now() - lastDrag < 15000;
  /** Takibe hemen dön (navigasyon görünümüne geri). */
  mapApi.recenter = () => { lastDrag = 0; mapApi.navView(navOn, headingUp); };
  /** Genel görünüm: tüm rota ekrana sığar (düz, kuzey-yukarı); 15 sn sonra veya Ortala ile takibe dönülür. */
  mapApi.overview = () => {
    if (!gmap || !routeCoords) return;
    lastDrag = Date.now();
    if (gmap.setTilt) gmap.setTilt(0);
    if (gmap.setHeading) { gmap.setHeading(0); lastHeading = 0; }
    fit(routeCoords.filter((_, i) => i % 20 === 0 || i === routeCoords.length - 1).map((c) => ({ lat: c[1], lon: c[0] })), 30);
  };

  const dotEl = (color, size, ring = '#0b0f14') => {
    const d = el('div', 'dot');
    Object.assign(d.style, { width: size + 'px', height: size + 'px', background: color, borderColor: ring });
    return d;
  };

  // "Yakınımdaki istasyonlar" listesindekiler (seçili olan vurgulanır)
  mapApi.drawNearby = (list, focusId = null) => whenMap(() => {
    nearMarks.forEach(unmark);
    nearMarks = list.map((s) => {
      const on = s.id === focusId;
      return marker(toLL(s), dotEl('#b48cff', on ? 18 : 12, on ? '#fff' : '#0b0f14'), `${s.name} · ${s.kw} kW · ${s.price.toFixed(2)} TL/kWh`);
    });
  });

  mapApi.drawStations = (stations, stops) => whenMap(() => {
    stationMarks.forEach(unmark);
    const inPlan = new Set(stops.map((s) => s.station.id));
    stationMarks = stations.map((s) => {
      const planned = inPlan.has(s.id);
      return marker(toLL(s), dotEl(planned ? '#ffb547' : '#5aa9ff', planned ? 18 : 11), `${s.name} · ${s.kw} kW`);
    });
  });

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
  let meDot = null;
  let meArrow = null;
  function updateMe() {
    const e = effective();
    if (!gmap || e.lat == null || e.lon == null) return;
    const color = e.source === 'sim' ? '#5aa9ff' : '#2ee6a6';
    meDot ??= dotEl(color, 16, '#fff');
    meArrow ??= el('div', 'me-arrow');
    const arrow = navOn;
    if (!me) me = marker({ lat: e.lat, lng: e.lon }, arrow ? meArrow : meDot, 'Konumum');
    me.position = { lat: e.lat, lng: e.lon };
    if (me.content !== (arrow ? meArrow : meDot)) me.content = arrow ? meArrow : meDot;
    meDot.style.background = color;
    meArrow.style.borderBottomColor = color;
    // yön-yukarıda ok hep yukarıdır (harita döner); kuzey-yukarıda ok gidiş yönünü gösterir
    meArrow.style.transform = `translateY(50%) rotate(${headingUp ? 0 : e.heading ?? 0}deg)`;
  }
  subscribe(['live', 'sim'], updateMe);
  readyHooks.push(updateMe);

  // Gizli sekmede boyut 0 olur; görününce yeniden hesapla.
  document.addEventListener('tabchange', (e) => {
    if (e.detail === 'route' && gmap) setTimeout(() => lib.event.trigger(gmap, 'resize'), 50);
  });

  boot();
}
