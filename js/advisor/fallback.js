import { getState, patch, effective } from '../state.js';
import { VEHICLE, PLANNER } from '../config.js';
import { replanFrom } from '../routing/controller.js';
import { safeSpeed } from './ecoSpeed.js';
import { speak } from './voice.js';

const BAT = VEHICLE.batteryNetKwh;
const CHECK_MS = 5000;
const FALLBACK_COOLDOWN_MS = 60000;
let lastFallback = 0;

const detour = (s) => s.offKm * 2 * PLANNER.detourKwhPerKm;
const set = (level, text) => patch('advisor', { level, text, at: Date.now() });

/**
 * Sürüş sırasında kalan rota için (güncel k ile) varış SoC'sini tahmin eder. Hedef = sıradaki planlı durak ya da varış.
 * Güvenli eşiğin altına düşülecekse:
 *   1) hedeften BİR ÖNCEKİ uygun istasyona (erişilebilir, ≥ hardMinArrival) otomatik yönlendir, sesli uyar;
 *   2) böyle bir istasyon yoksa aerodinamik hesapla "hızınızı X km/h'e düşürün" tavsiyesi ver.
 */
function check() {
  const plan = getState('plan');
  const eng = getState('engine');
  const sim = getState('sim');
  const route = getState('route');
  const e = effective();

  if (!plan.profile || plan.status !== 'ready' || eng.routeKm == null || e.soc == null) return set('ok', '');
  const driving = (e.speed ?? 0) > 5 || (sim.enabled && sim.play);
  if (!driving) return;
  if (eng.offRouteKm > 3) return set('warn', 'Rotadan ayrıldınız — yeniden planlama için Rotayı Planla\'ya dokunun.');

  const km = eng.routeKm;
  const k = eng.k;
  const profile = plan.profile;
  const next = plan.stops.find((s) => s.km > km + 0.3);
  const target = next
    ? { km: next.km, name: next.station.name, isEnd: false, extra: detour(next.station) }
    : { km: profile.totalKm, name: 'varış', isEnd: true, extra: 0 };
  const threshold = target.isEnd ? route.minArrivalSoc : PLANNER.chargerMinArrival;

  const needKwh = profile.energyBetween(km, target.km, k) + target.extra * k;
  const predicted = e.soc - (needKwh / BAT) * 100;
  const remain = Math.max(0, target.km - km);
  const info = `${target.name}: ${remain.toFixed(0)} km, tahmini varış %${predicted.toFixed(0)}`;
  if (predicted >= threshold) return set('ok', info);

  // 1) Bir önceki uygun istasyon
  const prev = plan.stations
    .filter((s) => s.km > km + 1 && s.km < target.km - 0.5 && s.id !== next?.station.id)
    .sort((a, b) => b.km - a.km)
    .find((s) => e.soc - ((profile.energyBetween(km, s.km, k) + detour(s) * k) / BAT) * 100 >= PLANNER.hardMinArrival);

  if (prev) {
    if (Date.now() - lastFallback < FALLBACK_COOLDOWN_MS) return set('bad', `${info} — yeniden planlanıyor`);
    lastFallback = Date.now();
    const ok = replanFrom({ km, soc: e.soc, maxFirstStopKm: prev.km });
    if (ok) {
      const msg = `Tüketim arttı. ${target.name} için pil yetmeyebilir. Rota bir önceki istasyon olan ${prev.name} noktasına güncellendi.`;
      speak(msg, { key: 'fallback', cooldownMs: 30000 });
      return set('bad', msg);
    }
  }

  // 2) Eco-hız
  const eco = safeSpeed({ profile, fromKm: km, toKm: target.km, extraKwh: target.extra, soc: e.soc, thresholdSoc: threshold, k, vMax: route.cruise });
  if (eco.speed != null) {
    const cur = e.speed ?? route.cruise;
    const msg = cur <= eco.speed + 2
      ? `${info}. Hız uygun, klima ve ani gaz kullanımını azaltın.`
      : `${target.name} noktasına güvenle varmak için hızınızı ${eco.speed} kilometreye düşürün.`;
    speak(msg, { key: 'eco' + eco.speed, cooldownMs: 90000 });
    return set('warn', msg);
  }
  const msg = `${target.name} noktasına ulaşmak mümkün görünmüyor. En yakın şarj noktasını arayın.`;
  speak(msg, { key: 'unreachable', cooldownMs: 90000 });
  return set('bad', msg);
}

export function initAdvisor() {
  setInterval(check, CHECK_MS);
}
