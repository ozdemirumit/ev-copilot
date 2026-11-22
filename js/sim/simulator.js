import { getState, patch } from '../state.js';
import { VEHICLE } from '../config.js';
import { batteryPowerKw } from '../physics/model.js';
import { stopGoOverhead } from '../physics/traffic.js';
import { headwindComponent } from '../utils/geo.js';
import { toast } from '../ui/toast.js';
import { prepareDrive, stepDrive, relocate } from './driver.js';

const TICK_MS = 200;
const BAT = VEHICLE.batteryNetKwh;
let last = performance.now();
let drive = null; // { track, cap }: planlı rotanın gerçek izi ve viraj hız tavanı (js/sim/driver.js)
let drivePlanId = null;

/**
 * Test Modu "oynat": araç planlı rotanın GERÇEK izinde (rota yoksa gidiş açısı yönünde) sürgüdeki hedef hıza ivmelenerek ilerler, virajlarda yavaşlar, varışta durur,
 * pil sürgülerdeki koşullarla (eğim, rüzgar, yağış, trafik, sıcaklık) fizik modeliyle azalır.
 * timeScale: gerçek saniye başına simüle saniye.
 */
function tick() {
  const now = performance.now();
  const dtReal = Math.min(1, (now - last) / 1000);
  last = now;

  const sim = getState('sim');
  if (!sim.enabled || !sim.play) return;
  const dt = dtReal * sim.timeScale;
  const dKm = (sim.speed * dt) / 3600;
  const plan = getState('plan');
  const coords = plan.profile && plan.route?.coords?.length > 1 ? plan.route.coords : null;

  const upd = {};
  let heading = sim.heading;
  let vKmh = sim.speed;
  if (coords) {
    let startKm = sim.routeKm ?? 0;
    if (!drive || drivePlanId !== plan.planId) { // yeni/yeniden planlanan rota: araç yeni izde bulunduğu yere oturur
      drive = prepareDrive(coords);
      drivePlanId = plan.planId;
      startKm = relocate(drive, sim.lat, sim.lon, sim.routeKm);
    }
    const r = stepDrive(drive, { km: startKm, v: (sim.vNow ?? 0) / 3.6, hdg: sim.lat == null ? undefined : sim.heading }, { targetKmh: sim.speed, dt });
    vKmh = r.v * 3.6;
    heading = r.hdg;
    Object.assign(upd, { routeKm: r.km, lat: r.lat, lon: r.lon, heading: Math.round(r.hdg) % 360, vNow: Math.round(vKmh * 10) / 10 });
    if (r.arrived) { upd.play = false; upd.vNow = 0; toast('Varışa ulaşıldı'); }
  } else {
    upd.vNow = null; // rota yok: sürgüdeki hız aynen
    const lat = sim.lat ?? getState('live').lat ?? 39.9334;
    const lon = sim.lon ?? getState('live').lon ?? 32.8597;
    const h = (heading * Math.PI) / 180;
    upd.lat = lat + (dKm * Math.cos(h)) / 110.57;
    upd.lon = lon + (dKm * Math.sin(h)) / (111.32 * Math.cos((lat * Math.PI) / 180));
  }

  const hw = headwindComponent(sim.windSpeed, sim.windDir, heading);
  const kw = batteryPowerKw({ v: vKmh, grade: sim.grade / 100, headwind: hw, temp: sim.temp, rain: sim.rain });
  // Simülasyonda pil yalnızca azalır: iniş/arka rüzgâr rejenerasyonu pili artırmasın, en az yardımcı yük + klima kadar harcansın.
  const kwIdle = batteryPowerKw({ v: 0, temp: sim.temp });
  const kwh = (Math.max(kw, kwIdle) * dt * stopGoOverhead(sim.traffic)) / 3600;
  upd.soc = Math.max(0, sim.soc - (kwh / BAT) * 100);
  // Pil bitince %80'den devam et (uzun test sürüşü kesilmesin)
  if (upd.soc <= 0) {
    upd.soc = 80;
    toast("Pil bitti: simülasyonda %80'e sıfırlandı, sürüş devam ediyor");
  }
  patch('sim', upd);
}

export function initSimulator() {
  setInterval(tick, TICK_MS);
}

export function resetSimPosition() {
  patch('sim', { routeKm: 0, lat: null, lon: null, play: false, vNow: null });
}
