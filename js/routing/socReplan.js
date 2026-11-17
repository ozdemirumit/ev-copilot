// v0.99.99 — Pil (SOC) değişince kalan şarj planını yeniden değerlendirme: saf yardımcılar (DOM/ağ yok).
// Kamera (doğrulanmış OCR) ya da elle giriş plan beklentisinden belirgin saparsa, ya da bir şarj durağında gerçek şarj planlanan
// hedeften farklı biterse, v0.99.98 durak hedefi motoru (controller.computePlan + planDiff + applyStopTarget) ile ÖNERİ hazırlanır;
// aktif plan yalnızca kullanıcı onaylayınca değişir. Bu dosya yalnızca karar verir: beklenen pil, kalan toplamlar, kararlılık/geri çekilme kapısı.
import { socTrusted } from './socTrust.js';

export const AT_STOP_KM = 1; // araç durağa bu kadar yakın ve duruyorsa "durakta" sayılır
export const STOP_KMH = 5;
export const STABLE_MS = 10_000; // aynı (±1 puan) güvenilir değer en az bu kadar sürmeli (OCR 5 sn'de bir; elle sürgü sürüklemesi oturmalı)
export const DECLINE_MS = 10 * 60e3; // İptal edilen öneri bu süre boyunca (pil belirgin değişmedikçe) yeniden sorulmaz

/**
 * Plana göre bu km'de beklenen pil (%). Geçilmiş son durak varsa onun planlanan ayrılış pilinden (şarj dahil), yoksa planın
 * başlangıcından (fromSoc) düşülür. Plan/profil yoksa null.
 */
export function expectedSoc(plan, km, k, bat) {
  if (!plan?.profile || km == null) return null;
  const fromKm = plan.fromKm ?? 0;
  let baseKm = fromKm;
  let base = plan.fromSoc ?? plan.startSoc;
  for (const s of plan.stops || []) {
    if (s.km >= fromKm && s.km <= km && Number.isFinite(s.leaveSoc)) { baseKm = s.km; base = s.leaveSoc; }
  }
  if (base == null) return null;
  return base - (plan.profile.energyBetween(baseKm, km, k) / bat) * 100;
}

/** Araç şu an planlı bir şarj durağında mı (yakın ve duruyor)? Durak ya da null. */
export function stopHere(plan, km, speed) {
  if (km == null || (speed ?? 0) > STOP_KMH) return null;
  return (plan?.stops || []).find((s) => Math.abs(s.km - km) <= AT_STOP_KM) || null;
}

/**
 * Mevcut planın km'den sonraki kısmı için toplamlar (önizleme farkı elmayla elma kıyaslasın): geçilen yol süresi ve geçilen
 * durakların süresi düşülür; maliyet yalnız ilerideki durakların toplamı.
 */
export function remainingTotals(plan, km) {
  const t = plan?.totals;
  if (!t) return null;
  const fromKm = plan.fromKm ?? 0;
  const passed = (plan.stops || []).filter((s) => s.km <= km + 0.5);
  const ahead = (plan.stops || []).filter((s) => s.km > km + 0.5);
  const driven = km > fromKm && plan.profile?.timeBetween ? plan.profile.timeBetween(fromKm, km) * 60 : 0;
  const spent = passed.reduce((a, s) => a + (s.minutes || 0) + (s.overheadMin || 0), 0);
  return { totalMin: Math.max(0, (t.totalMin ?? 0) - driven - spent), arriveSoc: t.arriveSoc, cost: ahead.reduce((a, s) => a + (s.cost || 0), 0) };
}

/**
 * Öneri kapısı (debounce + geri çekilme). step() true dönerse öneri hazırlanabilir.
 * - Yalnız güvenilir kaynak (canlı kamera, elle, Test Modu): eski/tahmin/varsayılan pil hiçbir zaman öneri/ağ tetiklemez.
 * - Sapma eşiği aşılmalı ve değer STABLE_MS boyunca ±1 puan içinde kalmalı (tek okuma ya da sürgü sürüklemesi yetmez).
 * - Açık bir öneri varken yenisi yok; İptal edilen pil değerinden en az `tolerance` puan farklı olmadıkça DECLINE_MS boyunca yok.
 */
export function createSocGate({ stableMs = STABLE_MS, declineMs = DECLINE_MS } = {}) {
  let cand = null; // { soc, since }
  let declined = null; // { soc, at }
  let pending = false;
  return {
    step({ now, soc, source, drift, tolerance }) {
      if (!socTrusted(source) || soc == null || !(drift > tolerance)) { cand = null; return false; }
      if (!cand || Math.abs(soc - cand.soc) > 1) { cand = { soc, since: now }; return false; }
      if (now - cand.since < stableMs || pending) return false;
      if (declined && now - declined.at < declineMs && Math.abs(soc - declined.soc) < tolerance) return false;
      return true;
    },
    open() { pending = true; },
    decline(soc, now) { pending = false; cand = null; declined = { soc, at: now }; },
    accept() { pending = false; cand = null; declined = null; },
    get pending() { return pending; },
    reset() { cand = null; declined = null; pending = false; },
  };
}

// Öneriyi gösteren arayüz (ui/socReplan.js) kendini buraya kaydeder; yönlendirme katmanı DOM bilmez.
let sink = null;
export const setProposalSink = (fn) => { sink = fn; };
export const proposalSink = () => sink;
