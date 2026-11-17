// Yol olayı uyarılarının canlı ilerleme mantığı (v0.99.102; SAF: DOM/ağ/depolama/zaman okumaz, zaman parametreyle gelir).
// Girdi: seçilen plan rotasının yol olayları modeli (js/nav/roadEvents.js; bugün yalnız Valhalla/OSM rotası tünel + ücretli yol verir,
// Mapbox/TomTom rotasında model yoktur → uyarı da yoktur). Her konum güncellemesinde kalan mesafe yeniden hesaplanır:
// - Gösterim: SHOW_M içinde, henüz girilmemiş en yakın olay (geçilen/içine girilen olay düşer).
// - Ses: olay başına iki aşama (uzak ~1 km, yakın ~300 m), her aşama bir kez; aynı tick'te yalnız en yakın olay konuşulur.
// - Rota değişince (planId) her şey sıfırlanır. Rotadan çıkınca (offRouteKm > OFF_ROUTE_KM) ya da konum taze değilken
//   (GPS aranıyor/hata) hiçbir şey gösterilmez/söylenmez. Konum sıçramasında (GPS atlaması) o tick konuşulmaz.
// - Olay uydurulmaz: model yoksa, yetenek yoksa ya da olay türü desteklenmiyorsa boş döner.
import { eventsAhead } from './roadEvents.js';

export const ALERT_KINDS = Object.freeze(['tunnel', 'toll']); // bugün gerçek veriyle doğrulanan türler
export const MIN_TUNNEL_M = 100; // daha kısa "tünel" (ör. 29 m'lik alt geçit parçası) uyarı üretmez
export const SHOW_M = 2000; // üst barda gösterim ufku
export const SOON_M = 500; // bu kadar yakınsa uyarı dönüşümde sabitlenir (öncelikli)
export const STAGES = Object.freeze({ far: Object.freeze([700, 1300]), near: Object.freeze([150, 450]) }); // metre
export const OFF_ROUTE_KM = 0.1;
export const JUMP_KM = 1.5; // tick'ler arası bundan büyük (ve hıza göre olanaksız) ilerleme = GPS sıçraması
const MAX_MPS = 70; // ~250 km/s: bundan hızlı ilerleme fiziksel değil

const startOf = (e) => (e.fromM !== undefined ? e.fromM : e.atM);

/** Modelden uyarı verilecek olaylar (desteklenen tür, yeterli uzunluk); model geçersizse boş. */
export function alertable(model) {
  if (!model || !Array.isArray(model.events) || !Array.isArray(model.supports)) return [];
  return model.events.filter((e) => ALERT_KINDS.includes(e.kind) && model.supports.includes(e.kind)
    && (e.kind !== 'tunnel' || e.toM - e.fromM >= MIN_TUNNEL_M));
}

export function createRoadAlerts() {
  return { planId: null, said: new Set(), lastKm: null, lastAt: null };
}

/**
 * Bir konum adımı. st: createRoadAlerts() durumu (burada güncellenir).
 * keyOf(e): isteğe bağlı olay kimliği (ör. coğrafi nokta: yeniden rotada aynı tünel aynı anahtarı alır, ses tekrarlanmaz).
 * Dönüş: { line: { kind, key, dM, lenM } | null, soon: boolean, speak: [{ kind, key, stage, dM, lenM }] }.
 */
export function stepRoadAlerts(st, { model, planId, routeKm, offRouteKm = null, fresh = true, now = 0, keyOf = null } = {}) {
  const none = { line: null, soon: false, speak: [] };
  if (planId !== st.planId) { st.planId = planId; st.said = new Set(); st.lastKm = null; st.lastAt = null; }
  const evs = alertable(model);
  if (!evs.length || typeof routeKm !== 'number' || !Number.isFinite(routeKm) || routeKm < 0) return none;
  if (!fresh || (offRouteKm != null && offRouteKm > OFF_ROUTE_KM)) { st.lastKm = null; st.lastAt = null; return none; }

  let jump = false;
  if (st.lastKm != null) {
    const dt = Math.max(0, (now - (st.lastAt ?? now)) / 1000);
    const d = routeKm - st.lastKm;
    jump = d < -0.3 || d > Math.max(JUMP_KM, (MAX_MPS * dt) / 1000);
  }
  st.lastKm = routeKm;
  st.lastAt = now;

  const m = routeKm * 1000;
  const sub = { ...model, events: evs };
  const up = eventsAhead(sub, m, SHOW_M).filter((e) => startOf(e) > m); // içine girilen aralık artık "ileride" değil
  if (!up.length) return none;
  const view = (e) => ({ kind: e.kind, key: (keyOf && keyOf(e)) || `${e.kind}@${startOf(e)}`, dM: startOf(e) - m, lenM: e.toM !== undefined ? e.toM - e.fromM : null });
  const line = view(up[0]);
  const speak = [];
  if (!jump) {
    for (const e of up) {
      const v = view(e);
      const stage = v.dM >= STAGES.near[0] && v.dM <= STAGES.near[1] ? 'near' : v.dM >= STAGES.far[0] && v.dM <= STAGES.far[1] ? 'far' : null;
      if (!stage) continue;
      const k = `${v.key}:${stage}`;
      if (st.said.has(k)) continue;
      st.said.add(k);
      if (stage === 'near') st.said.add(`${v.key}:far`); // yakın söylendiyse uzak (geri sıçramada) söylenmez
      speak.push({ ...v, stage, key: k });
      break; // aynı anda tek konuşma: en yakın olay
    }
  }
  return { line, soon: line.dM <= SOON_M, speak };
}

/**
 * Üst bar dönüşümlü uyarı satırının sırası. alerts: mevcut uyarı metinleri; road: yol olayı metni (yoksa null).
 * Yol olayı listenin başına girer; soon ise yalnızca o gösterilir (hız aşımı panelLogic.pickSlot ile yine araya girer).
 */
export function orderAlerts(alerts, road, soon = false) {
  const base = (alerts || []).filter((x) => typeof x === 'string' && x.trim());
  if (typeof road !== 'string' || !road.trim()) return base;
  return soon ? [road] : [road, ...base];
}
