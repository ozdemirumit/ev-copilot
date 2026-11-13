// Uygulama kabuğu önbelleği. Sürüm değişince eski önbellek silinir.
importScripts('./version.js'); // self.APP_VERSION: sürüm değişince önbellek adı ve sw.js'in bağımlılığı değişir → güncelleme
const CACHE = 'ev-copilot-' + self.APP_VERSION;
const SHELL = [
  './', './index.html', './manifest.webmanifest', './icons/icon.svg', './css/styles.css',
  './js/app.js', './js/config.js', './js/state.js',
  './js/utils/storage.js', './js/utils/cache.js', './js/utils/idb.js', './js/utils/geo.js',
  './js/ui/toast.js', './js/ui/icons.js', './js/ui/moreToggle.js', './js/ui/tabs.js', './js/ui/shell.js', './js/ui/routeForm.js', './js/vehicleCatalog.js', './js/ui/places.js', './js/ui/socInput.js', './js/routing/progress.js', './js/ui/socBar.js', './js/ui/premiumGate.js', './js/i18n/index.js', './js/ui/langSelect.js', './js/ui/defaultStart.js', './js/physics/socEstimate.js', './js/ui/mapView.js', './js/ui/navCamera.js', './js/ui/maps/maplibre.js', './js/ui/maps/mapEngine.js', './js/ui/maps/mapbox.js', './js/ui/maps/google.js', './js/ui/maps/tomtom.js', './js/net/activeMap.js', './js/tomtom/route.js', './js/ui/ocmKey.js', './js/mapbox/api.js', './js/mapbox/route.js', './js/mapbox/chargers.js', './js/here/chargers.js', './js/google/chargers.js','./js/mapbox/test.js', './js/ui/roiBox.js', './js/ui/cameraPanel.js',
  './js/ui/testPanel.js', './js/ui/abrpPanel.js', './js/ui/stationsView.js', './js/ui/cards.js', './js/ui/historyPanel.js', './js/physics/history.js',
  './js/ui/gpsControl.js', './js/ui/statusBadges.js', './js/ui/routePanel.js', './js/ui/routeOptionsView.js', './js/ui/vehiclePanel.js', './js/ui/customStations.js', './js/ui/collapse.js', './js/nav/steps.js', './js/nav/lanes.js', './js/nav/track.js', './js/nav/navigator.js', './js/nav/freeDrive.js', './js/nav/avgSpeed.js', './js/nav/panelLogic.js', './js/ui/avgSpeedView.js', './js/nav/course.js', './js/nav/nearby.js', './js/nav/chargePick.js', './js/nav/nearSort.js', './js/nav/ahead.js', './js/nav/aheadTraffic.js', './js/nav/speedLimit.js', './js/nav/limitSpans.js', './js/ui/placeSearch.js', './js/ui/tokenScanner.js', './js/ui/installPrompt.js', './js/ui/dataUsage.js', './js/ui/versionInfo.js', './js/net/meter.js', './js/net/proxy.js', './js/net/mapConfig.js', './js/ui/recentDest.js', './js/ui/accountPanel.js', './js/account/auth.js', './js/account/sync.js', './js/account/historySync.js', './js/physics/charging.js', './js/physics/chargeSanity.js', './js/physics/arrivals.js', './js/ui/arrivalCalib.js', './js/ui/stopSwap.js', './js/ui/keyboard.js', './js/nav/roadWarnings.js', './js/nav/warnLogic.js', './js/osm/cameras.js', './js/routing/occupancyClient.js', './js/account/community.js', './js/ui/stationCard.js', './version.js', './icons/icon-192.png', './icons/icon-512.png',
  './js/physics/model.js', './js/physics/rangeCalc.js', './js/physics/traffic.js', 
  './js/physics/routeProfile.js', './js/physics/routeSpeed.js', './js/physics/consumption.js', './js/physics/rangeEngine.js',
  './js/routing/operators.js', './js/routing/tariffs.js', './js/providers/index.js', './js/nav/routeMeta.js', './js/nav/trafficGuard.js', './js/osm/valhalla.js', './js/osm/route.js', './js/osm/chargers.js', './js/osm/search.js', './js/osm/speedLimit.js', './js/osm/weather.js', './js/osm/elevation.js', './js/routing/chargeCurve.js', './js/routing/chargerSource.js', './js/routing/region.js', './js/account/stationInfo.js', './js/routing/tesla.js',
  './js/routing/planner.js', './js/routing/routeOptions.js', './js/routing/powerFilter.js', './js/routing/controller.js', './js/routing/stopVia.js', './js/routing/aheadUpdate.js', './js/routing/livePlan.js', './js/routing/slots.js',
  './js/advisor/voice.js', './js/advisor/ecoSpeed.js', './js/advisor/fallback.js',
  './js/abrp/telemetry.js', './js/sim/simulator.js',
  './js/sensors/camera.js', './js/sensors/wakeLock.js', './js/sensors/gps.js', './js/sensors/driveGuard.js', './js/sensors/ocr.js',
  './js/sensors/preprocess.js', './js/sensors/binarize.js', './js/sensors/tokenOcr.js', './js/sensors/outlierFilter.js', './js/sensors/ocrConsensus.js', './js/sensors/ocrLoop.js', './js/sensors/frameQuality.js', './js/sensors/digitRecognizer.js', './js/sensors/digitModel.js', './js/ui/camPreview.js',
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
