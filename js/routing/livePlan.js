// Şarj planını araç konumuna göre canlı tutar: geçilen duraklar plandan çıkar, plan bulunulan konum ve gerçek pil % ile
// yeniden hesaplanır (aşağıdaki durumlarda), böylece kalan durak sayısı, süre ve maliyet güncel kalır.
import { getState, effective, patch } from '../state.js';
import { VEHICLE } from '../config.js';
import { replanFrom } from './controller.js';
import { fetchAvailability } from '../providers/index.js';
import { slotKind } from './slots.js';
import { speak } from '../advisor/voice.js';

const BAT = VEHICLE.batteryNetKwh;
const CHECK_MS = 5000;
const COOLDOWN_MS = 45000;
const REFRESH_KM = 25; // en az bu kadar yol sonrası kalan planı tazele
const SOC_TOLERANCE = 4; // plan beklentisinden bu kadar puan saparsa (rüzgâr, hız, gerçek tüketim) yeniden planla
const PASSED_KM = 0.3; // durağı bu kadar geçince "geride kaldı" say

let lastReplan = 0;
let lastAvail = 0;
let availBusy = false;
const AVAIL_EVERY_MS = 5 * 60e3; // yaklaşan duraklar için canlı doluluk sorgusu aralığı
const AVAIL_AHEAD_KM = 200;

function check() {
  const plan = getState('plan');
  const eng = getState('engine');
  const e = effective();
  if (plan.status !== 'ready' || !plan.profile || eng.routeKm == null || e.soc == null) return;
  if (eng.offRouteKm > 3) return; // rotadan çıkıldı: yeniden rota (navigasyon) halleder
  if (!getState('nav').active && (e.speed ?? 0) <= 5) return; // park halinde (rota önizlemesi): plan konuma göre kısaltılmaz
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
    const behind = plan.stops.filter((s) => s.km < km - PASSED_KM).map((s) => s.km);
    if (behind.length) patch('plan', { lastStopKm: Math.max(...behind) }); // sonraki durağa 'önceki duraktan' mesafe için
    replanFrom({ km, soc: e.soc, maxFirstStopKm: Infinity }); // uygun plan yoksa eski plan kalır
  }
}

/**
 * Yaklaşan (≤ 200 km) planlı durakların canlı doluluğunu 5 dakikada bir yenile. Bir durak dolu/arızalı çıkarsa plan bu bilgiyle
 * yeniden hesaplanır (arızalı istasyon aday olmaz, dolu olana bekleme süresi eklenir) ve sesli söylenir.
 */
export async function refreshAvailability({ force = false } = {}) {
  const plan = getState('plan');
  const km = getState('engine').routeKm;
  if (availBusy || plan.status !== 'ready' || km == null || (!force && Date.now() - lastAvail < AVAIL_EVERY_MS)) return;
  const next = plan.stops.filter((s) => s.km > km && s.km - km <= AVAIL_AHEAD_KM).slice(0, 2).map((s) => s.station);
  if (!next.length) return;
  availBusy = true;
  lastAvail = Date.now();
  try {
    const res = await fetchAvailability(next, 2, effective().soc); // pil %: sunucu ücretli Google'ı yalnızca düşük pilde sorar
    let worse = null;
    for (const st of plan.stations) {
      if (!res.has(st.id)) continue;
      const before = slotKind(st);
      st.slots = res.get(st.id) ?? st.slots;
      const after = slotKind(st);
      if ((after === 'full' || after === 'out') && before !== after) worse = st;
    }
    patch('plan', { availAt: Date.now() }); // listeleri yeniden çizdir
    if (worse) {
      speak(`${worse.name} istasyonunda ${slotKind(worse) === 'out' ? 'şarj üniteleri arızalı' : 'şu an boş yuva yok'}. Plan güncelleniyor.`, { key: 'slot' + worse.id, cooldownMs: 10 * 60e3 });
      const e = effective();
      if (e.soc != null) replanFrom({ km, soc: e.soc, maxFirstStopKm: Infinity });
    }
  } finally {
    availBusy = false;
  }
}

export function initLivePlan() {
  setInterval(check, CHECK_MS);
  setInterval(() => refreshAvailability(), 30000);
}
