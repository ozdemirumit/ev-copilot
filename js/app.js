import { initTabs } from './ui/tabs.js';
import { initMap } from './ui/mapView.js';
import { initRoiBox } from './ui/roiBox.js';
import { initCameraPanel } from './ui/cameraPanel.js';
import { initTestPanel } from './ui/testPanel.js';
import { initAbrpPanel } from './ui/abrpPanel.js';
import { initStationsView } from './ui/stationsView.js';
import { initRoutePanel } from './ui/routePanel.js';
import { initCards } from './ui/cards.js';
import { initQrTransfer } from './ui/qrTransfer.js';
import { initGpsControl } from './ui/gpsControl.js';
import { initStatusBadges } from './ui/statusBadges.js';
import { initWakeLock } from './sensors/wakeLock.js';
import { initRangeEngine } from './physics/rangeEngine.js';
import { initRouteController } from './routing/controller.js';
import { initAdvisor } from './advisor/fallback.js';
import { initTelemetry } from './abrp/telemetry.js';
import { initSimulator } from './sim/simulator.js';

// Sıra önemli: paneller state'i okuyup boyar; motorlar en sonda başlar; sekme en son açılır.
initStatusBadges();
initCards();
initGpsControl();
initTestPanel();
initAbrpPanel();
initQrTransfer();
initStationsView();
initRoutePanel();
initRoiBox();
initCameraPanel();
initWakeLock();
initMap();
initRouteController();
initRangeEngine();
initAdvisor();
initTelemetry();
initSimulator();
initTabs();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* file:// vb. */ });
}
