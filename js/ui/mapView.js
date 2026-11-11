import { getState, patch, subscribe, effective } from '../state.js';
import { load, save, remove } from '../utils/storage.js';
import { toast } from './toast.js';
import { attachSearch } from './placeSearch.js';
import { reverseLabel } from '../providers/index.js';
import { createMapLibreMap } from './maps/maplibre.js';
import { createMapboxMap } from './maps/mapbox.js';
import { createGoogleMap } from './maps/google.js';
import { createTomTomMap } from './maps/tomtom.js';
import { setActiveMap } from '../net/activeMap.js';
import { resolveProvider, forceOsm } from '../net/mapConfig.js';
import { showTab } from './tabs.js';
import { navCamera, followAnchorPx, groundAheadPx } from './navCamera.js';
import { icon } from './icons.js';

/** Harita çizim API'si; initMap() çağrılınca dolar (routing/controller.js, nav/* kullanır). Harita henüz yüklenmediyse çizimler sıraya alınır. */
export const mapApi = {
  drawRoute() {}, clearRoute() {}, setTraffic() {}, drawStations() {}, drawNearby() {}, setPoint() {}, follow() {}, navView() {}, is3d: () => true, set3d() {},
  setSatellite() {}, isSatellite: () => false, hasRoute: () => false, cancelPick() {}, pickBar() {}, pickPlace() {}, // initMap doldurur (pickBar'ı ui/shell.js)
  snap: () => null, // navigator.js: konumu rotaya yapıştırır
  drawPlaces() {}, // ui/places.js kayıtlı yerleri çizer
  cam() {}, // nav/navigator.js: her karede araç + kamera (akıcı navigasyon)
};

let boot = async () => {};

const fmt = (p) => (p ? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` : '');

function el(tag, cls, text) {
  const d = document.createElement(tag);
  d.className = cls;
  if (text != null) d.textContent = text;
  return d;
}
// Başlangıç: içi boş beyaz nokta, varış: bayrak simgesi (A/B harfi yok). Favori yerlerde simgesi/emojisi yazılır.
const pinEl = (kind, label) => {
  const d = el('div', 'pin ' + kind);
  if (kind === 'end') d.innerHTML = icon('flag');
  else if (kind === 'start') d.append(el('i', 'dot'));
  else if (kind === 'via') d.append(el('i', 'dot'));
  else d.append(el('b', '', label));
  return d;
};

/** İstasyon iğnesi: damla biçimi, güce göre renk (AC mavi, DC turuncu, ≥150 kW mor). num: planlanan durak sırası. */
const PIN_PATH = 'M18 45C18 45 3 28 3 17A15 15 0 0 1 33 17C33 28 18 45 18 45Z';
function stationPin(s, { planned = false, num = 0, focus = false } = {}) {
  const kw = s.kw || 0;
  const kind = kw >= 150 ? 'hpc' : kw >= 50 ? 'dc' : 'ac';
  const d = el('div', `spin ${kind}${planned ? ' planned' : ''}${focus ? ' focus' : ''}`);
  d.innerHTML = `<svg viewBox="0 0 36 46" aria-hidden="true"><path d="${PIN_PATH}"/></svg>`;
  d.append(el('b', '', kind === 'ac' ? 'AC' : 'DC'));
  if (num) d.append(el('i', '', String(num)));
  d.addEventListener('click', (ev) => { ev.stopPropagation(); mapApi.onStation?.(s); }); // istasyon kartı (ui/stationCard.js)
  return d;
}

/**
 * Harita: MapLibre GL JS + OpenFreeMap vektör karoları (maps/maplibre.js bağdaştırıcısı, koyu şema, OpenStreetMap verisi).
 * Harita nesnesi hazır olana dek yapılan işaretleme/çizim çağrıları sıraya alınır ve harita hazır olunca uygulanır.
 * Rota/arama/istasyon mantığı haritadan bağımsızdır. Konumlar { lat, lon }; zoom web-mercator (Google) ölçeğindedir, bağdaştırıcı MapLibre'a çevirir.
 */
export function initMap() {
  const mapEl = document.getElementById('map');
  let adapter = null; // hazır harita bağdaştırıcısı (maps/maplibre.js | maps/mapbox.js | maps/google.js)
  let booting = null;
  const queue = [];
  const readyHooks = []; // harita hazır olunca bir kez çalışacak güncellemeler (sıraya alınması gereksiz olanlar)
  const whenMap = (fn) => (adapter ? fn() : queue.push(fn));
  const note = (t) => { mapEl.dataset.msg = t || ''; mapEl.classList.toggle('nomap', !!t); };

  remove('noTiles'); // eski "Haritayı gizle (veri tasarrufu)" seçimi kaldırıldı: kayıtlı değer temizlenir, harita her zaman açılır

  /** Sunucunun seçtiği sağlayıcının bağdaştırıcısı (js/net/mapConfig.js). Seçili sağlayıcı açılamazsa bu cihaz oturumunda
   *  OpenFreeMap zorlanır (forceOsm), tek bildirim gösterilir ve OpenFreeMap açılır. OpenFreeMap hatası bugünkü gibi yukarı iletilir. */
  let fellBack = false; // bildirim bu açılışta bir kez
  const fallBackToOsm = () => {
    forceOsm();
    if (!fellBack) { fellBack = true; toast('Seçili harita açılamadı, OpenFreeMap kullanılıyor'); } // tek bildirim
  };
  async function openAdapter() {
    const cfg = await resolveProvider();
    if (cfg.provider !== 'osm') {
      try {
        if (cfg.provider === 'mapbox') {
          // Belirteç reddedildi (401/403). Harita açıldıktan sonraysa: bayrak + bildirim, kısa süre sonra yenile (bayrak varken
          // açılış doğrudan OpenFreeMap: döngü yok). Açılış sırasındaysa söz zaten reddedilir ve aşağıdaki catch OpenFreeMap açar.
          let shown = false;
          const onAuthFail = () => { fallBackToOsm(); if (shown) setTimeout(() => location.reload(), 1500); };
          const a = await createMapboxMap(mapEl, cfg.token, { onAuthFail });
          shown = true;
          return a;
        }
        if (cfg.provider === 'tomtom') {
          // Anahtar reddedildi (401/403): Mapbox ile aynı akış (bayrak + bildirim, harita gösterildiyse yenile; açılışta söz reddedilir ve OpenFreeMap açılır).
          let shown = false;
          const onAuthFail = () => { fallBackToOsm(); if (shown) setTimeout(() => location.reload(), 1500); };
          const a = await createTomTomMap(mapEl, cfg.key, { onAuthFail });
          shown = true;
          return a;
        }
        if (cfg.provider === 'google') {
          // Anahtar reddedildi (gm_authFailure). Mapbox ile aynı: harita gösterildikten sonraysa bayrak + bildirim + yenile;
          // açılış sırasındaysa söz reddedilir ve aşağıdaki catch aynı sayfa yüklemesinde OpenFreeMap açar.
          let shown = false;
          const onAuthFail = () => { fallBackToOsm(); if (shown) setTimeout(() => location.reload(), 1500); };
          const a = await createGoogleMap(mapEl, cfg.key, cfg.mapId, { onAuthFail });
          shown = true;
          return a;
        }
      } catch {
        fallBackToOsm();
        mapEl.replaceChildren(); // yarım kalan haritanın tuvali OpenFreeMap'in üstünde kalmasın
      }
    }
    return createMapLibreMap(mapEl);
  }

  boot = async () => {
    if (adapter) return;
    booting ??= (async () => {
      try {
        note(''); // uyarı katmanı kalksın: harita boş bir kapta kurulur
        adapter = await openAdapter();
        setActiveMap(adapter.name || 'osm'); // TomTom rotası yalnızca TomTom haritasıyla (js/net/activeMap.js)
        adapter.onClick(onMapClick);
        adapter.onDragStart(() => { lastDrag = Date.now(); lastFollow = null; if (navOn) navPan = true; });
        queue.splice(0).forEach((fn) => fn());
        readyHooks.forEach((fn) => fn());
      } catch (err) {
        booting = null;
        adapter = null;
        setActiveMap(null);
        note(err.message);
      }
    })();
    return booting;
  };

  let sat = load('sat', false);
  mapApi.isSatellite = () => sat;
  mapApi.setSatellite = (on) => { sat = !!on; save('sat', sat); whenMap(() => adapter.setSatellite(sat)); };
  readyHooks.push(() => adapter.setSatellite(sat));

  const marker = (pos, content, title = '') => adapter.marker(pos, content, title);
  const unmark = (m) => m?.remove();
  const fit = (points, pad) => adapter.fit(points, pad);

  const markers = { start: null, end: null };
  let pickMode = null; // 'start' | 'end' | null
  let me = null; // canlı konum işareti
  let lastDrag = 0;
  let navPan = false; // navigasyonda elle kaydırıldı: takip süreyle değil yalnızca Ortala (recenter) ile geri döner

  mapApi.setPoint = (...a) => setPoint(...a);

  const startInput = document.getElementById('route-start');
  const endInput = document.getElementById('route-end');
  const viaInput = document.getElementById('route-via');
  const pickBtns = { start: document.getElementById('pick-start'), end: document.getElementById('pick-end'), via: document.getElementById('pick-via') };

  function setPickMode(mode) {
    pickMode = mode;
    Object.entries(pickBtns).forEach(([k, b]) => b.classList.toggle('sel', k === mode));
    adapter?.cursor(mode ? 'crosshair' : null);
    mapApi.pickBar(mode);
    if (mode) showTab('map'); // sayfa kapanır, harita görünür
  }
  let placeCb = null; // Favoriler: haritadan seçilen noktayı geri çağırır (ui/places.js)
  mapApi.pickPlace = (cb) => { placeCb = cb; setPickMode('place'); };
  mapApi.cancelPick = () => { const was = pickMode; placeCb = null; setPickMode(null); showTab(was === 'place' ? 'favs' : 'route'); };

  const inputFor = (kind) => (kind === 'start' ? startInput : kind === 'via' ? viaInput : endInput);

  function setPoint(kind, point, { zoom = false, fit: doFit = true } = {}) {
    patch('route', { [kind]: point });
    inputFor(kind).value = point ? point.label || fmt(point) : '';
    whenMap(() => {
      unmark(markers[kind]);
      markers[kind] = point ? marker(point, pinEl(kind), point.label || '') : null;
      const { start, end, via } = getState('route');
      if (start && end && doFit) fit(via ? [start, via, end] : [start, end], 40);
      else if (point && zoom && doFit) adapter.moveTo({ center: point, zoom: 12 });
    });
  }

  // Yer/adres arama: yazarken öneri, seçince işaret koy ve oraya git
  ['start', 'via', 'end'].forEach((kind) => {
    attachSearch(inputFor(kind), document.getElementById('suggest-' + kind), (r) => {
      setPoint(kind, { lat: r.lat, lon: r.lon, label: r.sub ? `${r.label}, ${r.sub.split(', ').slice(-2)[0]}` : r.label }, { zoom: true });
      if (kind === 'start' && !getState('route').end) inputFor('end').focus();
    });
  });

  function onMapClick(p) {
    if (!pickMode) return;
    const kind = pickMode;
    const pt = { lat: p.lat, lon: p.lon };
    if (kind === 'place') { // Favoriler için nokta seçimi: rota kutularına dokunmaz
      const cb = placeCb;
      placeCb = null;
      setPickMode(null);
      showTab('favs');
      cb?.(pt);
      return;
    }
    setPoint(kind, pt);
    reverseLabel(pt.lat, pt.lon).then((label) => { // okunur ad gelince kutuyu güncelle
      if (label && getState('route')[kind] === pt) { pt.label = label; inputFor(kind).value = label; }
    });
    setPickMode(kind === 'start' ? 'end' : null); // başlangıçtan sonra otomatik varışa geç
    if (kind === 'end' || kind === 'via') showTab('route'); // nokta seçildi: plan sayfasına dön
  }

  pickBtns.start.addEventListener('click', () => setPickMode(pickMode === 'start' ? null : 'start'));
  pickBtns.end.addEventListener('click', () => setPickMode(pickMode === 'end' ? null : 'end'));
  pickBtns.via.addEventListener('click', () => setPickMode(pickMode === 'via' ? null : 'via'));

  document.getElementById('btn-clear-route').addEventListener('click', () => {
    setPoint('start', null);
    setPoint('via', null);
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
  const routeBounds = () => routeCoords.filter((_, i) => i % 20 === 0 || i === routeCoords.length - 1).map((c) => ({ lat: c[1], lon: c[0] }));
  mapApi.hasRoute = () => !!routeCoords;
  /** Navigasyon bitti: rota çizgisi, trafik renkleri ve istasyon işaretleri kalkar (başlangıç/ara/varış noktalarını controller.clearTrip siler). */
  mapApi.clearRoute = () => {
    routeCoords = null;
    whenMap(() => { unmark(routeLine); routeLine = null; adapter.traffic([], null); stationMarks.forEach(unmark); stationMarks = []; });
  };
  /** Rota yeniden hesaplanmadan trafik renkleri: coords = trafikli rotanın koordinatları, spans = [{ from, to, lvl }] (km; boş dizi hepsini kaldırır). */
  mapApi.setTraffic = (coords, spans) => whenMap(() => adapter.traffic(coords, spans));
  mapApi.drawRoute = (coords, { fit: doFit = true, traffic = null } = {}) => {
    routeCoords = coords;
    whenMap(() => {
      unmark(routeLine);
      routeLine = adapter.line(coords);
      adapter.traffic(coords, traffic); // trafik varsa yavaş/yoğun kesimler renkli çizilir (yoksa temizlenir)
      if (doFit && !navOn) fit(routeBounds(), 30); // navigasyondayken yeni rota haritayı uzaklaştırıp yönünü bozmasın
    });
  };

  // Navigasyonda harita aracı izler; kullanıcı haritayı elle kaydırırsa izleme Ortala düğmesine kadar durur (navigasyon dışında 15 sn).
  const held = () => navPan || Date.now() - lastDrag < 15000;
  let lastHeading = 0;
  let navOn = false;
  let driveOn = false; // rotasız sürüş takibi (nav/freeDrive.js): araç oku, gidiş yönü yukarı
  let headingUp = true;
  let zoomNow = 6;

  /**
   * Araç takibi. heading verilirse (navigasyon) harita gidiş yönüne döner (yön-yukarı): dönüş her güncellemede farkın ~%60'ı
   * kadar yumuşatılır. Navigasyonda merkez, aracın biraz İLERİSİNE konur: araç ekranın alt kısmında, yol önü geniş görünür.
   */
  let paused = false;
  mapApi.pause = (p) => { paused = p; if (!p) mapApi.recenter(); }; // karartma bitince araca dön
  let lastFollow = null; // son uygulanan konum/dönüş: değişmediyse harita yeniden çizilmez (pil)
  let glideAt = 0; // son kare kamera zamanı: sürerken updateMe konumu ezmesin
  let zoomCur = null;
  let bearCur = null;
  let pendingFollow = null; // harita henüz açılmadan gelen "konuma git" isteği: harita hazır olunca uygulanır (açılışta ilk konum haritadan önce gelebilir)
  /*
   * Navigasyon takip kamerası (v0.99.33): araç noktası görünür harita alanının alt kenarından ~%10 yukarıda (üstten %90). Görünür alan:
   * üst panelin (hudtop) altı ile aracın sütununu örten harita düğmeleri/istasyon kartının üstü arası; harita alt çubukta (dock, güvenli
   * alan dahil) bittiği için onlar zaten dışarıda. Ölçüm en çok saniyede bir yapılır (kare kamera her karede çağırır). Yalnızca kamera
   * merkezi kayar: aracın gerçek/rotaya yapışık konumu değişmez.
   */
  let tiltNow = 0;
  let insetAt = 0;
  let insets = { top: 0, bottom: 0, h: 0 };
  const navInsets = () => {
    const now = performance.now();
    if (insetAt && now - insetAt < 1000) return insets;
    insetAt = now;
    const r = mapEl.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const over = (b) => b.width > 0 && b.height > 0 && b.right > cx - 40 && b.left < cx + 40; // aracın sütunu (ok 24 px + pay)
    let top = 0;
    let bottom = 0;
    const hud = document.getElementById('hudtop')?.getBoundingClientRect();
    if (hud && over(hud)) top = Math.max(0, hud.bottom - r.top);
    document.querySelectorAll('#mapui button, #station-card').forEach((n) => {
      const b = n.getBoundingClientRect();
      if (over(b) && b.top > r.top + r.height / 2) bottom = Math.max(bottom, r.bottom - b.top);
    });
    return (insets = { top, bottom, h: r.height });
  };
  /** Kamera merkezinin araçtan ileri uzaklığı (metre); mpp: o zoomdaki metre/piksel. */
  const navAhead = (mpp) => {
    const { top, bottom, h } = navInsets();
    const mapH = h || mapEl.clientHeight;
    return groundAheadPx(followAnchorPx({ mapH, top, bottom }), mapH, tiltNow) * mpp;
  };
  mapApi.follow = (lat, lon, zoom = null, force = false, heading = null) => {
    if (!adapter) { if (force) pendingFollow = { lat, lon, zoom, heading }; return; }
    if (paused || (!force && held())) return;
    bearCur = null;
    zoomCur = null; // kare kamera bir sonraki karede haritanın gerçek değerinden devam eder
    if (zoom != null) zoomNow = zoom;
    let turn = null;
    if (heading != null && headingUp) {
      lastHeading = (adapter.bearing() + 360) % 360;
      const delta = ((heading - lastHeading + 540) % 360) - 180;
      if (Math.abs(delta) > 2) { lastHeading = (lastHeading + delta * 0.6 + 360) % 360; turn = lastHeading; }
    }
    let center = { lat, lon };
    if ((navOn || driveOn) && headingUp) {
      const mpp = (156543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoomNow; // metre/piksel
      const d = navOn ? navAhead(mpp) : mapEl.clientHeight * 0.22 * mpp; // navigasyon: araç görünür alanın altından ~%10 yukarıda; rotasız: ~%22 ileri
      const h = (lastHeading * Math.PI) / 180;
      center = { lat: lat + (d * Math.cos(h)) / 111320, lon: lon + (d * Math.sin(h)) / (111320 * Math.cos((lat * Math.PI) / 180)) };
    }
    const lf = lastFollow;
    const still = lf && zoom == null && turn == null && !force
      && Math.abs(center.lat - lf.lat) * 111320 < 2 && Math.abs(center.lon - lf.lon) * 111320 * Math.cos((lat * Math.PI) / 180) < 2;
    if (still) return; // araç durmuş: harita aynı kalır
    lastFollow = { lat: center.lat, lon: center.lon };
    adapter.moveTo({ center, zoom, heading: turn }, true);
  };
  /** Navigasyonda 3B/2B seçimi: yalnızca bu cihazda saklanır (hesap eşitlemesine girmez), varsayılan 3B. */
  let threeD = load('nav3d', true);
  mapApi.is3d = () => threeD;
  mapApi.set3d = (on) => {
    threeD = !!on;
    save('nav3d', threeD);
    if (navOn) mapApi.navView(true, headingUp, threeD);
  };
  /**
   * Navigasyon görünümü: up=true ise yön-yukarı, değilse kuzey-yukarı; threeD (varsayılan kayıtlı seçim) ise eğik kamera ve
   * yüksekliğiyle çizilen binalar, değilse düz. Kapanınca düz kuzey-yukarı harita. Harita hazır değilse sıraya alınır.
   */
  mapApi.navView = (on, up = true, d3 = threeD) => {
    navOn = on;
    headingUp = up;
    if (!on) navPan = false;
    const cam = navCamera(on, up, d3);
    tiltNow = cam.tilt;
    if (cam.resetHeading) lastHeading = 0;
    whenMap(() => {
      adapter.moveTo(cam.resetHeading ? { tilt: cam.tilt, heading: 0 } : { tilt: cam.tilt });
      adapter.setBuildings3d(cam.buildings);
    });
    updateMe();
  };
  /**
   * Rotasız sürüş takibi (navigasyon kapalı): on ise araç ok olarak çizilir ve up=true iken harita gidiş yönüne döner (follow'a verilen
   * yönle); kapanınca harita kuzey-yukarı döner. Navigasyon açıksa görünüm navView'dadır, burada değiştirilmez.
   */
  mapApi.driveView = (on, up = true) => {
    on = !!on;
    if (driveOn === on && (!on || headingUp === up)) return;
    driveOn = on;
    if (navOn || getState('nav').active) return; // navigasyon başlıyor/açık: görünüm navView'da
    if (on) {
      headingUp = up;
      if (!up) { lastHeading = 0; whenMap(() => adapter.moveTo({ heading: 0 })); }
    } else {
      lastHeading = 0;
      whenMap(() => adapter.moveTo({ tilt: 0, heading: 0 }));
    }
    updateMe();
  };
  mapApi.driving = () => driveOn && !navOn;
  /** Kullanıcı haritayı kaydırdı mı (takip duraklatıldı)? */
  mapApi.dragged = () => held();
  /** Takibe hemen dön (navigasyon görünümüne geri). */
  mapApi.recenter = () => {
    lastDrag = 0; navPan = false; lastFollow = null; bearCur = null; zoomCur = null; insetAt = 0;
    if (driveOn && !navOn) return updateMe(); // rotasız takipte yön korunur; sonraki konum (ya da çağıranın follow'u) araca ortalar
    mapApi.navView(navOn, headingUp);
  };

  /**
   * Akıcı navigasyon: her karede (navigator.js) araç rotadaki gösterilen konumda, kamera ona kilitli. Dönüş (yön-yukarı) ve zoom
   * üstel olarak yumuşatılır; kamera aracın biraz ilerisine bakar (araç ekranın alt kısmında). Kullanıcı haritayı kaydırdıysa 15 sn
   * yalnızca araç işareti hareket eder.
   */
  mapApi.cam = (lat, lon, heading, zoom) => {
    if (!adapter || paused) return;
    glideAt = performance.now();
    const color = effective().source === 'sim' ? '#5aa9ff' : '#2ee6a6';
    meArrow ??= el('div', 'me-arrow');
    meArrow.style.borderBottomColor = color;
    meArrow.style.transform = `translateY(50%) rotate(${headingUp ? 0 : heading ?? 0}deg)`;
    if (!me) me = marker({ lat, lon }, meArrow, 'Konumum');
    else { me.setPosition({ lat, lon }); me.setContent(meArrow); }
    if (held()) return;
    if (zoom != null) zoomCur = zoomCur == null || Math.abs(zoom - zoomCur) > 3 ? zoom : zoomCur + (zoom - zoomCur) * 0.07;
    if (heading != null && headingUp) {
      const cur = bearCur ?? (adapter.bearing() + 360) % 360;
      const d = ((heading - cur + 540) % 360) - 180;
      bearCur = (cur + d * 0.14 + 360) % 360;
    }
    const z = zoomCur ?? zoomNow;
    let center = { lat, lon };
    if (navOn && headingUp && bearCur != null) {
      const mpp = (156543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** z; // metre/piksel
      const d = navAhead(mpp);
      const h = (bearCur * Math.PI) / 180;
      center = { lat: lat + (d * Math.cos(h)) / 111320, lon: lon + (d * Math.sin(h)) / (111320 * Math.cos((lat * Math.PI) / 180)) };
    }
    adapter.moveTo({ center, zoom: z, heading: headingUp ? bearCur : null }, false);
  };
  /** Genel görünüm: tüm rota ekrana sığar (düz, kuzey-yukarı); 15 sn sonra veya Ortala ile takibe dönülür. */
  mapApi.overview = () => {
    if (!adapter || !routeCoords) return;
    lastDrag = Date.now();
    lastHeading = 0;
    adapter.moveTo({ tilt: 0, heading: 0 });
    fit(routeBounds(), 30);
  };

  /** Bir yeri haritada göster (araç takibi 15 sn bu görünümü bozmaz). */
  mapApi.showAt = (lat, lon, zoom = 14) => {
    if (!adapter) return;
    lastDrag = Date.now();
    lastFollow = null;
    lastHeading = 0;
    adapter.moveTo({ center: { lat, lon }, zoom, tilt: 0, heading: 0 }, false);
  };
  /** Noktaların tümü ekrana sığar (durakları birlikte görmek için). */
  mapApi.fitPoints = (points) => {
    if (!adapter || !points.length) return;
    lastDrag = Date.now();
    lastFollow = null;
    lastHeading = 0;
    adapter.moveTo({ tilt: 0, heading: 0 });
    fit(points, 60);
  };

  const dotEl = (color, size, ring = '#0b0f14') => {
    const d = el('div', 'dot');
    Object.assign(d.style, { width: size + 'px', height: size + 'px', background: color, borderColor: ring });
    return d;
  };

  // Kayıtlı yerler (Ev, İş, favoriler): küçük emoji iğneleri
  let placeMarks = [];
  mapApi.drawPlaces = (places) => whenMap(() => {
    placeMarks.forEach(unmark);
    placeMarks = places.map((p) => marker(p, pinEl('place', p.icon), p.name));
  });

  // "Yakınımdaki istasyonlar" listesindekiler (seçili olan vurgulanır)
  mapApi.drawNearby = (list, focusId = null) => whenMap(() => {
    nearMarks.forEach(unmark);
    nearMarks = list.map((s) => {
      return marker(s, stationPin(s, { focus: s.id === focusId }), s.foreign ? `${s.name} · ${s.kw} kW` : `${s.name} · ${s.kw} kW · ${s.price.toFixed(2)} TL/kWh`);
    });
  });

  mapApi.drawStations = (stations, stops) => whenMap(() => {
    stationMarks.forEach(unmark);
    const order = new Map(stops.map((s, i) => [s.station.id, i + 1]));
    stationMarks = stations.map((s) => marker(s, stationPin(s, { planned: order.has(s.id), num: order.get(s.id) || 0 }), `${s.name} · ${s.kw} kW`));
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
    if (performance.now() - glideAt < 500) return; // kare kamera aracı zaten yerleştiriyor
    const e = effective();
    if (!adapter || e.lat == null || e.lon == null) return;
    const color = e.source === 'sim' ? '#5aa9ff' : '#2ee6a6';
    const snap = navOn ? mapApi.snap(e.lat, e.lon) : null; // navigasyonda imleç rotaya yapışır
    const pos = snap || e;
    meDot ??= dotEl(color, 16, '#fff');
    meArrow ??= el('div', 'me-arrow');
    const content = navOn || driveOn ? meArrow : meDot;
    if (!me) me = marker(pos, content, 'Konumum');
    else { me.setPosition(pos); me.setContent(content); }
    meDot.style.background = color;
    meArrow.style.borderBottomColor = color;
    // yön-yukarıda ok hep yukarıdır (harita döner); kuzey-yukarıda ok gidiş yönünü gösterir
    meArrow.style.transform = `translateY(50%) rotate(${headingUp ? 0 : snap?.heading ?? e.heading ?? 0}deg)`;
  }
  subscribe(['live', 'sim'], updateMe);
  readyHooks.push(updateMe);

  // Açılışta harita bulunulan konuma yakınlaşır: konum haritadan önce geldiyse bekleyen istek uygulanır; henüz konum yoksa son bilinen konuma
  // (GPS ilk konumu verince shell.js daha yakına odaklar). Son konum yalnızca bu cihazda saklanır, hesaba eşitlenmez.
  const LAST_POS = 'lastPos';
  let lastSaved = 0;
  subscribe('live', () => {
    const e = effective();
    if (e.source !== 'live' || e.lat == null || getState('live').gps !== 'ok' || Date.now() - lastSaved < 30000) return;
    lastSaved = Date.now();
    save(LAST_POS, { lat: Math.round(e.lat * 1e4) / 1e4, lon: Math.round(e.lon * 1e4) / 1e4 }, { silent: true }); // ~10 m: yazma azalır
  });
  readyHooks.push(() => {
    const pf = pendingFollow;
    pendingFollow = null;
    if (pf) return mapApi.follow(pf.lat, pf.lon, pf.zoom, true, pf.heading);
    const lp = load(LAST_POS, null);
    if (!lp || !Number.isFinite(lp.lat) || !Number.isFinite(lp.lon) || routeCoords || navOn || effective().lat != null) return;
    adapter.moveTo({ center: { lat: lp.lat, lon: lp.lon }, zoom: 12 }, false);
  });

  // Gizli sekmede boyut 0 olur; görününce yeniden hesapla.
  document.addEventListener('tabchange', (e) => {
    if (e.detail === 'map' && adapter) setTimeout(() => adapter.resize(), 50);
  });

  boot();
}
