// Şarj planını araç konumuna göre canlı tutar: geçilen duraklar plandan çıkar, plan bulunulan konum ve gerçek pil % ile
// yeniden hesaplanır (aşağıdaki durumlarda), böylece kalan durak sayısı, süre ve maliyet güncel kalır.
import { getState, effective } from '../state.js';
import { VEHICLE } from '../config.js';
import { replanFrom } from './controller.js';

const BAT = VEHICLE.batteryNetKwh;
const CHECK_MS = 5000;
const COOLDOWN_MS = 45000;
const REFRESH_KM = 25; // en az bu kadar yol sonrası kalan planı tazele
const SOC_TOLERANCE = 4; // plan beklentisinden bu kadar puan saparsa (rüzgâr, hız, gerçek tüketim) yeniden planla
const PASSED_KM = 0.3; // durağı bu kadar geçince "geride kaldı" say

let lastReplan = 0;

function check() {
  const plan = getState('plan');
  const eng = getState('engine');
  const e = effective();
  if (plan.status !== 'ready' || !plan.profile || eng.routeKm == null || e.soc == null) return;
  if (eng.offRouteKm > 3) return; // rotadan çıkıldı: yeniden rota (navigasyon) halleder
  if (Date.now() - lastReplan < COOLDOWN_MS) return;

  const km = eng.routeKm;
  const fromKm = plan.fromKm ?? 0;
  if (km < fromKm - 1) return; // geriye gidildi/rota sıfırlandı: dokunma

  const passed = plan.stops.some((s) => s.km < km - PASSED_KM);
  const baseSoc = plan.fromSoc ?? plan.startSoc;
  const k = plan.kInfo?.k ?? eng.k;
  const expected = baseSoc == null ? null : baseSoc - (plan.profile.energyBetween(fromKm, km, k) / BAT) * 100;
  const drift = expected == null ? 0 : Math.abs(e.soc - expected);
  const far = km - fromKm >= REFRESH_KM;

  if (passed || drift > SOC_TOLERANCE || far) {
    lastReplan = Date.now();
    replanFrom({ km, soc: e.soc, maxFirstStopKm: Infinity }); // uygun plan yoksa eski plan kalır
  }
}

export function initLivePlan() {
  setInterval(check, CHECK_MS);
}
