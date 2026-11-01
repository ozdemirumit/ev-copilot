// Uygulama kabuğu önbelleği. Sürüm değişince eski önbellek silinir.
importScripts('./version.js'); // self.APP_VERSION: sürüm değişince önbellek adı ve sw.js'in bağımlılığı değişir → güncelleme
const CACHE = 'ev-copilot-' + self.APP_VERSION;
const SHELL = [
  './', './index.html', './manifest.webmanifest', './icons/icon.svg', './css/styles.css',
  './js/app.js', './js/config.js', './js/state.js',
  './js/utils/storage.js', './js/utils/cache.js', './js/utils/idb.js', './js/utils/geo.js',
  './js/ui/toast.js', './js/ui/tabs.js', './js/ui/shell.js', './js/vehicleCatalog.js', './js/ui/places.js', './js/ui/dimmer.js', './js/ui/socInput.js', './js/routing/progress.js', './js/ui/socBar.js', './js/physics/socEstimate.js', './js/ui/mapView.js', './js/ui/maps/maplibre.js', './js/ui/ocmKey.js', './js/mapbox/api.js', './js/mapbox/route.js', './js/mapbox/chargers.js', './js/mapbox/test.js', './js/ui/roiBox.js', './js/ui/cameraPanel.js',
  './js/ui/testPanel.js', './js/ui/abrpPanel.js', './js/ui/stationsView.js', './js/ui/cards.js', './js/ui/historyPanel.js', './js/physics/history.js',
  './js/ui/gpsControl.js', './js/ui/statusBadges.js', './js/ui/routePanel.js', './js/ui/vehiclePanel.js', './js/ui/customStations.js', './js/ui/collapse.js', './js/nav/steps.js', './js/nav/track.js', './js/nav/navigator.js', './js/nav/nearby.js', './js/nav/ahead.js', './js/nav/speedLimit.js', './js/ui/placeSearch.js', './js/ui/tokenScanner.js', './js/ui/installPrompt.js', './js/ui/dataUsage.js', './js/ui/versionInfo.js', './js/net/meter.js', './version.js', './icons/icon-192.png', './icons/icon-512.png',
  './js/physics/model.js', './js/physics/traffic.js', 
  './js/physics/routeProfile.js', './js/physics/routeSpeed.js', './js/physics/consumption.js', './js/physics/rangeEngine.js',
  './js/routing/operators.js', './js/providers/index.js', './js/osm/valhalla.js', './js/osm/route.js', './js/osm/chargers.js', './js/osm/search.js', './js/osm/speedLimit.js', './js/osm/weather.js', './js/osm/elevation.js', './js/routing/chargeCurve.js', './js/routing/chargerSource.js',
  './js/routing/planner.js', './js/routing/controller.js', './js/routing/livePlan.js', './js/routing/slots.js',
  './js/advisor/voice.js', './js/advisor/ecoSpeed.js', './js/advisor/fallback.js',
  './js/abrp/telemetry.js', './js/sim/simulator.js',
  './js/sensors/camera.js', './js/sensors/wakeLock.js', './js/sensors/gps.js', './js/sensors/ocr.js',
  './js/sensors/preprocess.js', './js/sensors/tokenOcr.js', './js/sensors/outlierFilter.js',
];

// Kütüphaneler (vendor/): uygulama sürümünden BAĞIMSIZ önbellek ve önce-önbellek stratejisi. Uygulama sürümü artınca
// yeniden indirilmez (Tesseract ~4 MB). Kütüphane dosyaları değişirse bu adı artır.
const VENDOR_CACHE = 'ev-copilot-vendor-v4'; // v4: MapLibre geri geldi (PMTiles/stil dosyaları yok), eski önbellek silinsin
const VENDOR_PRECACHE = []; // Tesseract ilk kullanımda önbelleğe girer
const VENDOR_PATH = new URL('./vendor/', self.registration.scope).pathname;

self.addEventListener('install', (e) => {
  e.waitUntil(
    Promise.all([
      caches.open(CACHE).then((c) => c.addAll(SHELL)),
      caches.open(VENDOR_CACHE).then((c) => c.addAll(VENDOR_PRECACHE)),
    ]).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== VENDOR_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // API çağrıları (Google, ABRP...) ve harita karoları hiç önbelleğe alınmaz.
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith(VENDOR_PATH)) {
    e.respondWith(
      caches.open(VENDOR_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok && res.status === 200) cache.put(request, res.clone());
        return res;
      })
    );
    return;
  }
  // Önce ağ (HTTP önbelleğini atlayıp sunucuyla doğrulayarak), olmazsa önbellek: güncellemeler hemen görünsün.
  e.respondWith(
    fetch(request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(request, res.clone()));
        return res;
      })
      .catch(() => caches.match(request))
  );
});
