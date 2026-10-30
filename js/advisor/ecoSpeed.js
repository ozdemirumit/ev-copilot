import { VEHICLE } from '../config.js';

const V_MIN = 50;

/**
 * Hedefe (km) `thresholdSoc` pil ile varabilmek için izin verilen en yüksek seyir hızı (km/h), 5'in katı.
 * Aerodinamik direnç hızın karesiyle büyüdüğü için tek tek hızlar denenir (rota dilimleri bu hızda yeniden hesaplanır).
 * Dönüş: { speed } veya hiçbir hızda yetişilemiyorsa { speed: null, minNeed } (V_MIN'deki gereken % pil).
 */
export function safeSpeed({ profile, fromKm, toKm, extraKwh = 0, soc, thresholdSoc, k, vMax }) {
  const budgetKwh = ((soc - thresholdSoc) / 100) * VEHICLE.batteryNetKwh;
  const top = Math.floor(Math.min(vMax, 130) / 5) * 5;
  for (let v = top; v >= V_MIN; v -= 5) {
    if (profile.energyAtSpeed(fromKm, toKm, v, k) + extraKwh * k <= budgetKwh) return { speed: v };
  }
  const need = profile.energyAtSpeed(fromKm, toKm, V_MIN, k) + extraKwh * k;
  return { speed: null, minNeed: (need / VEHICLE.batteryNetKwh) * 100 };
}
