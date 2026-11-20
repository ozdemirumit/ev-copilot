// Navigasyon üst paneli mantığı (DOM'suz, node ile test edilir): dönüşümlü bilgi/uyarı seçimi ve hız aşımı.
import { socTrusted } from '../routing/socTrust.js'; // güvenilir pil kaynağı kararı TEK yerde (routing/socTrust.js)

export const ALERT_MS = 3000; // pil/varış/durak bilgisi ve gerçek uyarılar bu aralıkla dönüşümlü gösterilir
export const OVER_TOL_KMH = 5; // limitin bu kadar üstü "aşıldı" (GPS payı; ahead.js yol limiti toleransıyla aynı)

/** Dönüşümlü uyarı: yalnızca gerçek (dolu metin) uyarılar sırayla döner; hiç yoksa null (uydurma uyarı gösterilmez). */
export function pickAlert(items, tick) {
  const list = (items || []).filter((x) => typeof x === 'string' && x.trim());
  return list.length ? list[Math.abs(Math.trunc(tick) || 0) % list.length] : null;
}

/**
 * Hız aşımı: aynı güncel hız kaynağıyla (effective().speed) hem hız rengi hem uyarı metni hesaplanır.
 * Yol limiti biliniyorsa o (+5 km/s GPS payı), yoksa kullanıcının eşiği (+3); ikisi de yoksa ya da hız yoksa aşım yok.
 */
export function speedOver(speed, roadLimit, userLimit) {
  const road = Number.isFinite(roadLimit) && roadLimit > 0 ? roadLimit : null;
  const limit = road ?? (Number.isFinite(userLimit) && userLimit > 0 ? userLimit : null);
  if (limit == null || !Number.isFinite(speed)) return null;
  return speed > limit + (road ? OVER_TOL_KMH : 3) ? { kph: Math.round(speed), limit, road: road != null } : null;
}

/**
 * Sağ bölümdeki dönüşümlü hücre: slots = gösterilebilir öğeler (boşlar atlanır), over = hız aşımı var mı.
 * Aşımda her ikinci adım aşım uyarısıdır ('over'), arada diğer öğeler sırayla döner (önemli uyarılar tamamen engellenmez).
 */
export function pickSlot(slots, tick, over) {
  const list = (slots || []).filter(Boolean);
  const n = Math.abs(Math.trunc(tick) || 0);
  if (over) return n % 2 === 0 || !list.length ? 'over' : list[Math.floor(n / 2) % list.length];
  return list.length ? list[n % list.length] : null;
}

/** Varış saati dönüşümlü hücrede gösterilebilir mi: dolu, '--:--' değil, rakam içerir, "Invalid Date"/NaN değil (v0.99.51). */
export function etaShown(text) {
  const s = typeof text === 'string' ? text.trim() : '';
  return !!s && s !== '--:--' && /\d/.test(s) && !/invalid|nan/i.test(s);
}

// Durakta varış pili yalnızca bu pil kaynaklarında gösterilir (socSource(): taze kamera, elle girilen; Test Modu 'sim').
// Eski kamera/tahmin/varsayılan değerden çıkan plan pili ölçüme dayanmaz: '--' gösterilir. Liste: routing/socTrust.js.

/**
 * Sonraki PLANLI şarj durağı görünümü (DOM'suz). stop = plan.stops içindeki sıradaki durak, km = aracın rota üstü km'si,
 * source = pil kaynağı. Durak yoksa null (hücre gizlenir). km: rota boyunca kalan mesafe (durak km − araç km, ≥ 0);
 * name: plandaki istasyon adı (yoksa ''); soc: plandaki durakta varış pili (yuvarlanmış), güvenilir kaynak yoksa null.
 */
export function nextChargeView(stop, km, source) {
  if (!stop || !Number.isFinite(stop.km) || !Number.isFinite(km)) return null;
  const name = typeof stop.station?.name === 'string' ? stop.station.name.trim() : '';
  const soc = socTrusted(source) && Number.isFinite(stop.arriveSoc) ? Math.max(0, Math.round(stop.arriveSoc)) : null;
  return { name, km: Math.max(0, stop.km - km), soc };
}

/** v0.99.97 Sonraki şarj işaretinin (routing/onRoute.js stopFlag) açıklaması (Türkçe kaynak metin; sözlükte çevrilir). */
export const FLAG_TEXT = {
  unverified: 'Erişim yol ağıyla doğrulanmadı',
  off: 'Rota dışı: rota bu istasyondan geçmiyor',
  blocked: 'Karşı yönde/erişilemez olabilir',
  // v0.99.107 ara nokta tutarsızlığı (routing/stopVia.js viaCheck; metinler onRoute.js VIA_ISSUE_TEXT ile aynı)
  novia: 'Rota bu şarj durağına girmiyor (ara nokta değil)',
  noreach: 'Rota şarj durağının girişine ulaşmıyor',
  uturn: 'Durağa ancak geri dönüşle (karşı şerit) ulaşılıyor',
};

// --- v0.99.59 üst bar: altı sabit metrik (Hız | Limit | Pil | Menzil | Sonraki şarj | Varışta). Değerler mevcut hesaplardan gelir
// (effective().soc, engine.totalRangeKm, plan.totals.arriveSoc, plan.stops[].km − locate(track).km); burada yalnızca güvene göre süzülür.

/**
 * Pil değerine güven: 'trusted' (live/manual/sim), 'approx' (stale/estimate: ≈ ile gösterilir), 'contested' (kamera okumaları tutulan
 * değerle çelişiyor: ocr.contested), 'none' (default/none/bilinmeyen). Çelişki yalnızca kamera kaynağını (live/stale) etkiler.
 */
export function socTrust(source, contested = null) {
  if (contested != null && (source === 'live' || source === 'stale')) return 'contested';
  if (socTrusted(source)) return 'trusted';
  if (source === 'stale' || source === 'estimate') return 'approx';
  return 'none';
}

/**
 * Üst bar pil/menzil/varışta pil (yuvarlanmış sayılar ya da null = '--'). Varsayılan/olmayan pilde hepsi null; çelişkili kamerada pil ≈ ile,
 * menzil ve varışta pil null (yanlış pille yanlış menzil gösterilmez). approx: değerler ≈ ile işaretlenir.
 */
export function topMetrics({ soc, source, contested = null, rangeKm, arriveSoc } = {}) {
  const trust = socTrust(source, contested);
  const pct = trust !== 'none' && Number.isFinite(soc) ? Math.min(100, Math.max(0, Math.round(soc))) : null;
  const sure = pct != null && (trust === 'trusted' || trust === 'approx');
  return {
    trust,
    approx: trust === 'approx' || trust === 'contested',
    soc: pct,
    range: sure && Number.isFinite(rangeKm) ? Math.max(0, Math.round(rangeKm)) : null,
    arrive: sure && Number.isFinite(arriveSoc) ? Math.round(arriveSoc) : null,
  };
}

export const NO_STOP = 'Durak yok'; // Türkçe kaynak metin (sözlükte çevrilir)

/**
 * Sonraki şarj hücresi metni. view = nextChargeView(...) (rota boyunca kalan km); ready = plan hazır; reliable = araç rotada ve konum
 * biliniyor. Güvenilmez ya da plan hazır değilse '--'; hazır ve sıradaki durak yoksa NO_STOP; aksi halde "42 km".
 */
export function nextChargeText(view, { ready = false, reliable = false } = {}) {
  if (!reliable || !ready) return '--';
  return view ? `${view.km.toFixed(0)} km` : NO_STOP;
}
