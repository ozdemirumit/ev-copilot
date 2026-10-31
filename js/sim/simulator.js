import { getState, patch } from '../state.js';
import { VEHICLE } from '../config.js';
import { batteryPowerKw } from '../physics/model.js';
import { stopGoOverhead } from '../physics/traffic.js';
import { headwindComponent } from '../utils/geo.js';
import { toast } from '../ui/toast.js';

const TICK_MS = 200;
const BAT = VEHICLE.batteryNetKwh;
let last = performance.now();

/**
 * Test Modu "oynat": araç planlı rota boyunca (rota yoksa gidiş açısı yönünde) sürgü hızıyla ilerler,
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
  const profile = getState('plan').profile;

  const upd = {};
  let heading = sim.heading;
  if (profile) {
    const km = Math.min(profile.totalKm, (sim.routeKm ?? 0) + dKm);
    const p = profile.pointAt(km);
    Object.assign(upd, { routeKm: km, lat: p.lat, lon: p.lon, heading: Math.round(p.heading) });
    heading = p.heading;
    if (km >= profile.totalKm - 0.01) { upd.play = false; toast('Varışa ulaşıldı'); }
  } else {
    const lat = sim.lat ?? getState('live').lat ?? 39.9334;
    const lon = sim.lon ?? getState('live').lon ?? 32.8597;
    const h = (heading * Math.PI) / 180;
    upd.lat = lat + (dKm * Math.cos(h)) / 110.57;
    upd.lon = lon + (dKm * Math.sin(h)) / (111.32 * Math.cos((lat * Math.PI) / 180));
  }

  const hw = headwindComponent(sim.windSpeed, sim.windDir, heading);
  const kw = batteryPowerKw({ v: sim.speed, grade: sim.grade / 100, headwind: hw, temp: sim.temp, rain: sim.rain });
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
  patch('sim', { routeKm: 0, lat: null, lon: null, play: false });
}
