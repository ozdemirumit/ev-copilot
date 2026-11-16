// D3-T3: SAF topluluk doluluk bildirimi VERİ MODELİ (yan etkisiz; DOM, ağ, depolama, saat okuması yok).
// Karar K3 (docs/beta-task-registry.json decisions[D3].sub_decisions, 2026-11-16): topluluk bildirimi resmî (sağlayıcı)
// doluluktan AYRI veri olarak tutulur; resmî doluluk durumunu belirlemez/üzerine yazmaz.
//  - Çıktı resmî karar alanlarını (trusted/state/available/total/source) TAŞIMAZ; official:false, verified:false sabittir.
//    Bu yüzden topluluk "Boş" bildirimi hiçbir yolda doğrulanmış resmî "Müsait"e dönüşemez
//    (D3-T1 saf doluluk karar modülü ayrıca source 'community' girdisini 'community-not-official' ile reddeder).
//  - Girdi: server/community.mjs summary() biçimi { busy, report: { status: 'full'|'free', at } } ya da onu `community`
//    alanında taşıyan slots (js/routing/occupancyClient.js).
//  - Bildirim en fazla 60 dk (sunucu REPORT_MS) eski olabilir; zamansız / gelecek (> 1 dk saat kayması) bildirim yok sayılır.
// Rota planlamasına BAĞLI DEĞİLDİR: planlayıcı bugünkü js/routing/slots.js slotKind davranışını korur (topluluk "Dolu"
// < 20 dk → 'full'); planlayıcının topluluk bildirimini kullanıp kullanmayacağı ayrı karar gerektirir. Arayüz bağlama D3-T4 işidir.

/** Topluluk bildirimi en fazla bu kadar eski olabilir (server/community.mjs REPORT_MS ile aynı). */
export const COMMUNITY_REPORT_MAX_AGE_MS = 60 * 60e3;
const SKEW_MS = 60e3; // istemci/sunucu saat kayması toleransı

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/**
 * Topluluk verisi modeli ya da null (geçerli varlık/bildirim yoksa). Saf: aynı girdi + now → aynı çıktı; girdiyi değiştirmez.
 * @param {object|null} input community özeti ya da { community } taşıyan slots
 * @param {{ now: number }} opts now ZORUNLU (ms); yoksa/geçersizse null
 * @returns {null | { kind:'community', official:false, verified:false, busy:number, report:null|{ status:'full'|'free', at:number, ageMin:number } }}
 */
export function communityReport(input, { now } = {}) {
  if (typeof now !== 'number' || !Number.isFinite(now)) return null;
  if (!isObj(input)) return null;
  const cm = isObj(input.community) ? input.community : ('busy' in input || 'report' in input) ? input : null;
  if (!cm) return null;
  const busy = Number.isInteger(cm.busy) && cm.busy > 0 ? cm.busy : 0;
  let report = null;
  const r = isObj(cm.report) ? cm.report : null;
  if (r && (r.status === 'full' || r.status === 'free') && typeof r.at === 'number' && Number.isFinite(r.at)) {
    const age = now - r.at;
    if (age >= -SKEW_MS && age <= COMMUNITY_REPORT_MAX_AGE_MS) {
      report = Object.freeze({ status: r.status, at: r.at, ageMin: Math.max(0, Math.round(age / 60e3)) });
    }
  }
  if (!busy && !report) return null;
  return Object.freeze({ kind: 'community', official: false, verified: false, busy, report });
}
