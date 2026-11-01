// Görünür yüksekliği (adres çubuğu/gezinme çubuğu hariç) CSS değişkenine yaz: sayfa yenilendikten sonra 100dvh bazı
// tarayıcılarda gerçek alandan büyük kalıp alt menüyü ekranın dışına itiyordu.
(() => {
  const fit = () => {
    const h = Math.round(window.visualViewport?.height ?? window.innerHeight);
    document.documentElement.style.setProperty('--app-h', h + 'px');
    window.scrollTo(0, 0); // yenilemede geri yüklenen belge kaydırması varsa sıfırla (gövde kaydırılmaz)
  };
  fit();
  ['resize', 'orientationchange', 'pageshow'].forEach((ev) => window.addEventListener(ev, fit));
  window.visualViewport?.addEventListener('resize', fit);
})();

import { installMeter } from './net/meter.js';
import { initI18n } from './i18n/index.js';
import { initLangSelect } from './ui/langSelect.js';
import { initVersionInfo } from './ui/versionInfo.js';
import { initDataUsage } from './ui/dataUsage.js';
import { initTabs } from './ui/tabs.js';
import { initShell } from './ui/shell.js';
import { initPlaces } from './ui/places.js';
import { initRecentDest } from './ui/recentDest.js';
import { initAccountPanel } from './ui/accountPanel.js';
import { captureInviteFromUrl, listenInviteDeepLink } from './account/auth.js';
import { initSync } from './account/sync.js';
import { initHistorySync } from './account/historySync.js';
import { initCharging } from './physics/charging.js';
import { initRoadWarnings } from './nav/roadWarnings.js';
import { refreshCaps } from './net/proxy.js';
import { initDimmer } from './ui/dimmer.js';
import { initSocInput } from './ui/socInput.js';
import { initSocBar } from './ui/socBar.js';
import { initDefaultStart } from './ui/defaultStart.js';
import { initSocEstimate } from './physics/socEstimate.js';
import { initMap } from './ui/mapView.js';
import { initRoiBox } from './ui/roiBox.js';
import { initCameraPanel } from './ui/cameraPanel.js';
import { initTestPanel } from './ui/testPanel.js';
import { initAbrpPanel } from './ui/abrpPanel.js';
import { initStationsView } from './ui/stationsView.js';
import { initRoutePanel } from './ui/routePanel.js';
import { initVehiclePanel } from './ui/vehiclePanel.js';
import { initCustomStations } from './ui/customStations.js';
import { initCards } from './ui/cards.js';
import { initHistoryPanel } from './ui/historyPanel.js';
import { initCollapse } from './ui/collapse.js';
import { initOcmKey } from './ui/ocmKey.js';
import { initNavigator } from './nav/navigator.js';
import { initNearby } from './nav/nearby.js';
import { initAhead } from './nav/ahead.js';
import { initSpeedLimit } from './nav/speedLimit.js';
import { initLivePlan } from './routing/livePlan.js';
import { initTokenScanner } from './ui/tokenScanner.js';
import { initInstallPrompt } from './ui/installPrompt.js';
import { initGpsControl } from './ui/gpsControl.js';
import { initStatusBadges } from './ui/statusBadges.js';
import { initWakeLock } from './sensors/wakeLock.js';
import { initRangeEngine } from './physics/rangeEngine.js';
import { initRouteController } from './routing/controller.js';
import { initAdvisor } from './advisor/fallback.js';
import { initTelemetry } from './abrp/telemetry.js';
import { initSimulator } from './sim/simulator.js';

// Sıra önemli: paneller state'i okuyup boyar; motorlar en sonda başlar; sekme en son açılır.
await initI18n(); // önce dil: sayfa metinleri çevrilir, sonra paneller kendi metinlerini yazar (gözlemci onları da çevirir)
installMeter(); // sonraki tüm fetch çağrıları sayılsın
initLangSelect();
initVersionInfo();
initDataUsage();
initStatusBadges();
initCards();
initHistoryPanel();
initGpsControl();
initTestPanel();
initAbrpPanel();
initTokenScanner();
initInstallPrompt();
initStationsView();
initRoutePanel();
initVehiclePanel();
initCustomStations();
initNavigator();
initNearby();
initAhead();
initSpeedLimit();
initLivePlan();
initCollapse();
initRoiBox();
initCameraPanel();
initWakeLock();
initOcmKey();
initMap();
initRouteController();
initRangeEngine();
initAdvisor();
initTelemetry();
initSimulator();
initTabs();
initShell();
initPlaces();
initRecentDest();
captureInviteFromUrl();
listenInviteDeepLink();
initAccountPanel();
initSync();
initHistorySync();
initCharging();
initRoadWarnings();
refreshCaps(); // sunucu özellikleri (Mapbox/OpenChargeMap sunucuda mı) bu oturum için tazelenir
initDimmer();
initSocInput();
initSocBar();
initDefaultStart();
initSocEstimate();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* file:// vb. */ });
}

// Kaldırılan özelliklerden (Google, çevrimdışı harita) kalan ayarlar ve indirme dosyası: telefondaki yer boşalsın, Google anahtarı cihazda kalmasın
(async () => {
  try {
    ['pack.tur', 'mapBase', 'mapMode', 'source', 'gKey', 'gUsage', 'trafficLayer'].forEach((k) => localStorage.removeItem('evcp.' + k));
    const root = await navigator.storage?.getDirectory?.();
    await root?.removeEntry('maps', { recursive: true });
  } catch { /* hiç indirilmemişti */ }
})();
