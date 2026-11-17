// Şarj planını araç konumuna göre canlı tutar: geçilen duraklar plandan çıkar, plan bulunulan konum ve gerçek pil % ile
// yeniden hesaplanır (aşağıdaki durumlarda), böylece kalan durak sayısı, süre ve maliyet güncel kalır.
import { getState, effective, patch } from '../state.js';
import { VEHICLE } from '../config.js';
import { replanFrom, previewSocReplan } from './controller.js';
import { fetchAvailability } from '../providers/index.js';
import { slotKind } from './slots.js';
import { speak } from '../advisor/voice.js';
import { t } from '../i18n/index.js';
import { proxyHas } from '../net/proxy.js';
import { socSource } from '../physics/socEstimate.js';
import { shouldReplan, socTrusted } from './socTrust.js';
import { expectedSoc, stopHere, createSocGate, proposalSink, STOP_KMH } from './socReplan.js';

const BAT = VEHICLE.batteryNetKwh;
const CHECK_MS = 5000;
const COOLDOWN_MS = 45000;
const REFRESH_KM = 25; // en az bu kadar yol sonrası kalan planı tazele
const SOC_TOLERANCE = 4; // plan beklentisinden bu kadar puan saparsa (rüzgâr, hız, gerçek tüketim) yeniden planla
const PASSED_KM = 0.3; // durağı bu kadar geçince "geride kaldı" say

let lastReplan = 0;
const gate = createSocGate(); // v0.99.99: SOC kaynaklı plan değişikliği yalnız kararlı güvenilir değerde ve kullanıcı onayıyla
let reachedId = null; // hedefine ulaşıldığı bildirilen durak (bir kez)
let seenPlanId; // plan değişince (yeni rota/onay/tazeleme) eski İptal geri çekilmesi geçersiz
let lastAvail = 0;
let availBusy = false;
const AVAIL_EVERY_MS = 5 * 60e3; // yaklaşan duraklar için canlı doluluk sorgusu aralığı (Premium'da sıklaştırılır, aşağıya bak)
const AVAIL_LOW_SOC = 20; // pil bunun altındaysa durak sorguları en sıkı ve daha çok durağa yapılır
const AVAIL_AHEAD_KM = 200;

function check() {
  const plan = getState('plan');
  const eng = getState('engine');
  const e = effective();
  if (plan.status !== 'ready' || !plan.profile || eng.routeKm == null || e.soc == null) return;
  if (eng.offRouteKm > 3) return; // rotadan çıkıldı: yeniden rota (navigasyon) halleder
  if (!getState('nav').active && (e.speed ?? 0) <= 5) return; // park halinde (rota önizlemesi): plan konuma göre kısaltılmaz
  if (Date.now() - lastReplan < COOLDOWN_MS) return;
  if (plan.planId !== seenPlanId) { seenPlanId = plan.planId; if (!gate.pending) gate.reset(); }

  const km = eng.routeKm;
  const fromKm = plan.fromKm ?? 0;
  if (km < fromKm - 1) return; // geriye gidildi/rota sıfırlandı: dokunma

  const passed = plan.stops.some((s) => s.km < km - PASSED_KM);
  const k = plan.kInfo?.k ?? eng.k;
  // Beklenen pil: geçilen durakta planlanan ayrılış pili (şarj dahil) ya da plan başlangıcı, ardından tüketim
  const expected = expectedSoc(plan, km, k, BAT);
  const drift = expected == null ? 0 : Math.abs(e.soc - expected);
  const far = km - fromKm >= REFRESH_KM;
  const source = e.source === 'sim' ? 'sim' : socSource();
  const trusted = socTrusted(source);

  // v0.99.99: planlı durakta duruluyor (şarj sürüyor): şarj sürerken öneri yok; hedefe ulaşılınca bir kez bildirilir,
  // hedef belirgin aşılırsa sonraki duraklar durağın ötesinden önerilir. Erken bitirme kalkışta (durak geçilince) sapmadan yakalanır.
  const here = getState('nav').active ? stopHere(plan, km, e.speed) : null;
  if (here) {
    if (!trusted || !Number.isFinite(here.leaveSoc)) return;
    if (e.soc >= here.leaveSoc - 0.5 && reachedId !== here.station.id) {
      reachedId = here.station.id;
      speak(t('Şarj hedefine ulaşıldı: %{0}.', Math.round(here.leaveSoc)), { key: 'reach' + here.station.id, cooldownMs: 10 * 60e3 });
    }
    const over = e.soc - here.leaveSoc;
    if (gate.step({ now: Date.now(), soc: e.soc, source, drift: over, tolerance: SOC_TOLERANCE })) propose(e.soc, km, here.km + PASSED_KM + 0.3, 'charge');
    return;
  }

  // SOC farkı yalnız güvenilir ve kararlı değerde ÖNERİ olur (onaysız plan değişmez); eski/tahmin/varsayılan değer öneri de tetiklemez.
  if (trusted && drift > SOC_TOLERANCE) {
    if ((e.speed ?? 0) <= STOP_KMH && e.soc > expected) return; // duruyor ve pil beklentinin üstünde: şarj sürüyor olabilir, kalkışta değerlendirilir
    if (gate.step({ now: Date.now(), soc: e.soc, source, drift, tolerance: SOC_TOLERANCE })) propose(e.soc, km, km, passed ? 'charge' : 'soc');
    return;
  }
  gate.step({ now: Date.now(), soc: e.soc, source, drift: 0, tolerance: SOC_TOLERANCE }); // aday sıfırlanır
  if (shouldReplan({ passed, far, drift, tolerance: SOC_TOLERANCE, source })) {
    lastReplan = Date.now();
    const behind = plan.stops.filter((s) => s.km < km - PASSED_KM).map((s) => s.km);
    if (behind.length) patch('plan', { lastStopKm: Math.max(...behind) }); // sonraki durağa 'önceki duraktan' mesafe için
    // Güvenilmeyen pil (eski kamera/tahmin/varsayılan) planı değiştirmesin: mesafe/geçilen durak tazelemesi planın kendi beklentisiyle yapılır
    replanFrom({ km, soc: trusted || expected == null ? e.soc : expected, maxFirstStopKm: Infinity }); // uygun plan yoksa eski plan kalır
  }
}

/**
 * Önerilen planı hazırla (ağ yok) ve arayüze göster. Plan yalnız arayüzde Onayla ile değişir (applyStopTarget); İptal → mevcut plan kalır,
 * aynı pil için bir süre yeniden sorulmaz. Plan kurulamazsa (rota üstünde zincir yok, hesap hatası) mevcut plan kalır, rota dışı onayı açılmaz.
 */
function propose(soc, km, fromKm, why) {
  const sink = proposalSink();
  const now = Date.now();
  const r = previewSocReplan({ km, soc, fromKm });
  if (!r.ok || r.preview.diff.same || !sink) {
    gate.decline(soc, now); // değişiklik yok / kurulamadı: aynı değerde tekrar hesaplanmaz
    if (!r.ok) console.info('[SOC] öneri kurulamadı, mevcut plan korunuyor:', r.reason);
    return;
  }
  gate.open();
  lastReplan = now;
  sink({ preview: r.preview, why, source: socSource(), onDone: (applied) => (applied ? gate.accept() : gate.decline(soc, Date.now())) });
}

/**
 * Yaklaşan (≤ 200 km) planlı durakların canlı doluluğunu 5 dakikada bir yenile. Bir durak dolu/arızalı çıkarsa plan bu bilgiyle
 * yeniden hesaplanır (arızalı istasyon aday olmaz, dolu olana bekleme süresi eklenir) ve sesli söylenir.
 */
export async function refreshAvailability({ force = false } = {}) {
  const plan = getState('plan');
  const km = getState('engine').routeKm;
  // Premium: canlı veri daha güncel gelsin (2 dk; pil kritikse 1 dk ve ilk 3 durak). Ücretsizde 5 dk, ilk 2 durak. Sunucu önbelleği 90 sn.
  const premium = proxyHas('occupancy');
  const soc = effective().soc;
  const low = premium && soc != null && soc <= AVAIL_LOW_SOC;
  const every = !premium ? AVAIL_EVERY_MS : low ? 60e3 : 2 * 60e3;
  const ahead = low ? 3 : 2;
  if (availBusy || plan.status !== 'ready' || km == null || (!force && Date.now() - lastAvail < every)) return;
  const next = plan.stops.filter((s) => s.km > km && s.km - km <= AVAIL_AHEAD_KM).slice(0, ahead).map((s) => s.station);
  if (!next.length) return;
  availBusy = true;
  lastAvail = Date.now();
  try {
    const res = await fetchAvailability(next, ahead, soc); // pil %: sunucu ücretli Google'ı yalnızca düşük pilde sorar
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
      const e = effective();
      const ids = () => getState('plan').stops.map((s) => s.station.id).join();
      const before = ids();
      if (e.soc != null) replanFrom({ km, soc: e.soc, maxFirstStopKm: Infinity });
      const changed = ids() !== before; // plan gerçekten değişti mi (dolu durak yerine başka istasyon seçildi mi)
      const why = slotKind(worse) === 'out' ? 'şarj üniteleri arızalı' : 'şu an boş yuva yok';
      speak(t(changed ? '{0} istasyonunda {1}. Plan güncellendi.' : '{0} istasyonunda {1}. Başka uygun istasyon yok, plan değişmedi.', worse.name, why), { key: 'slot' + worse.id, cooldownMs: 10 * 60e3 });
    }
  } finally {
    availBusy = false;
  }
}

export function initLivePlan() {
  setInterval(check, CHECK_MS);
  setInterval(() => refreshAvailability(), 30000);
}
