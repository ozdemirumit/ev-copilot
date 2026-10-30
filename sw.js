// Uygulama kabuğu önbelleği. Sürüm değişince eski önbellek silinir.
const CACHE = 'ev-copilot-shell-v2';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './icons/icon.svg', './css/styles.css',
  './js/app.js', './js/config.js', './js/state.js',
  './js/utils/storage.js', './js/utils/geo.js',
  './js/ui/toast.js', './js/ui/tabs.js', './js/ui/mapView.js', './js/ui/roiBox.js', './js/ui/cameraPanel.js',
  './js/ui/testPanel.js', './js/ui/abrpPanel.js', './js/ui/stationsView.js', './js/ui/cards.js',
  './js/ui/gpsControl.js', './js/ui/statusBadges.js', './js/ui/routePanel.js',
  './js/physics/model.js', './js/physics/traffic.js', './js/physics/weather.js', './js/physics/elevation.js',
  './js/physics/routeProfile.js', './js/physics/consumption.js', './js/physics/rangeEngine.js',
  './js/routing/operators.js', './js/routing/osrm.js', './js/routing/chargeCurve.js', './js/routing/chargerSource.js',
  './js/routing/planner.js', './js/routing/controller.js',
  './js/advisor/voice.js', './js/advisor/ecoSpeed.js', './js/advisor/fallback.js',
  './js/abrp/telemetry.js', './js/sim/simulator.js',
  './js/sensors/camera.js', './js/sensors/wakeLock.js', './js/sensors/gps.js', './js/sensors/ocr.js',
  './js/sensors/preprocess.js', './js/sensors/outlierFilter.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // API çağrıları (OSRM, Open-Meteo, ABRP...) ve harita karoları hiç önbelleğe alınmaz.
  if (url.origin !== location.origin) return;
  // Önce ağ, olmazsa önbellek: geliştirme sırasında bayat dosya görmemek için.
  e.respondWith(fetch(request).catch(() => caches.match(request)));
});
