// v0.99.108 — Haritadaki istasyonu "Rotaya Ekle" (saf; ağ/DOM yok). Akış controller.js previewAddToRoute/applyAddToRoute içindedir:
//  1) uygunluk (bu modül): aktif rota var mı, istasyon geride mi, zaten kullanıcı kilitli durak mı, rotadan çok mu uzak;
//  2) yol ağıyla GİDİŞ YÖNÜNDE erişim (stopAccess.verifyStops; v0.99.107 fail-closed: doğrulanamayan/karşı şerit eklenmez);
//  3) istasyon GERÇEK ara nokta olarak sağlayıcıdan rota (kullanıcının kilitli durakları ve ara durağı da ara nokta, rota sırasıyla);
//  4) yeni rotada denetim (stopVia.viaCheck: rota girişe ulaşıyor mu, U dönüşü var mı; başlangıçta geri dönüş var mı);
//  5) kalan rota için plan (kilitli duraklar + yeni durak zorunlu, sonrakiler yeniden seçilir) → ÖNİZLEME; plan yalnız onayla değişir.
import { lineKm, travelDir, locateOnLine } from './stopAccess.js';
import { passCount, MAX_VIA } from './stopVia.js';

/** İstasyon aktif rota çizgisinden bundan uzaksa (km) "Rotaya Ekle" sunulmaz (Git ile doğrudan gidilebilir). */
export const ADD_MAX_OFF_KM = 15;
/** Önizleme bu süreden eskiyse onay kabul edilmez (araç ilerledi, pil/trafik değişti): yeniden hesaplanır. */
export const PREVIEW_TTL_MS = 120000;
/** Navigasyonda konum doğruluğu bundan kötüyse (m) ekleme yapılmaz (rota konumdan başlar; yanlış yol/şerit riski). */
export const GPS_MAX_ACC_M = 100;
/** Navigasyonda araç rota çizgisinden bundan uzaksa (km) konum belirsiz sayılır (yeniden rota sürüyor olabilir). */
export const GPS_MAX_OFF_KM = 0.3;
/** Yeni rotanın ilk ~0,5 km yönü mevcut gidiş yönünden bundan fazla saparsa (derece) başlangıçta geri dönüş var sayılır. */
export const START_TURN_DEG = 100;

const okPt = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon);

/** Kullanıcının kilitlediği ileri duraklar: elle seçilen (userPins), şarj hedefi verilen (leaveSocs), Git ile seçilen ilk durak. */
export function lockedAhead(plan, fromKm = plan?.fromKm ?? 0) {
  const lock = new Set([...(plan?.userPins || []), ...Object.keys(plan?.leaveSocs || {}), plan?.forceFirstId].filter(Boolean));
  return (plan?.stops || []).filter((s) => s?.station && s.km > fromKm + 0.5 && lock.has(s.station.id));
}

/**
 * "Rotaya Ekle" uygunluğu. at: istasyonun aktif rota çizgisindeki izdüşümü { km, offKm } (bilinmiyorsa null).
 * Dönüş: { show, ok, reason } — show: düğme/açıklama gösterilsin mi (rota yoksa hiç gösterilmez), ok: düğme etkin mi.
 * reason: 'noroute' | 'loading' | 'locked' | 'passed' | 'far' | 'beyond' | null.
 */
export function addEligibility({ plan, station, at, here = plan?.fromKm ?? 0 }) {
  if (!plan?.route?.coords?.length || !plan.profile || !['ready', 'infeasible'].includes(plan.status)) {
    return { show: plan?.status === 'loading', ok: false, reason: plan?.status === 'loading' ? 'loading' : 'noroute' };
  }
  if (!okPt(station)) return { show: false, ok: false, reason: 'noroute' };
  if (lockedAhead(plan, here).some((s) => s.station.id === station.id)) return { show: true, ok: false, reason: 'locked' };
  if (!at || !Number.isFinite(at.km)) return { show: true, ok: false, reason: 'far' };
  if (at.offKm > ADD_MAX_OFF_KM) return { show: true, ok: false, reason: 'far' };
  if (at.km <= here + 0.5) return { show: true, ok: false, reason: 'passed' };
  if (at.km >= plan.profile.totalKm - 0.5) return { show: true, ok: false, reason: 'beyond' };
  return { show: true, ok: true, reason: null };
}

/** İstasyonun rota çizgisindeki izdüşümü (km, offKm, side). */
export function stationAt(coords, station) {
  if (!Array.isArray(coords) || coords.length < 2 || !okPt(station)) return null;
  const at = locateOnLine(coords, lineKm(coords), station, null, 8);
  return at ? { km: at.km, offKm: at.offKm, side: at.side } : null;
}

/**
 * Sağlayıcıya gidecek ara noktalar (rota sırasıyla): kilitli ileri duraklar + eklenen istasyon + (ilerideyse) kullanıcının ara durağı.
 * Dönüş: { wps: [{ lat, lon }], ids: [istasyon kimliği] } ya da null (sağlayıcı sınırı aşıldı).
 */
export function addVias({ locked = [], add, stopover = null, stopoverKm = null, fromKm = 0, max = MAX_VIA }) {
  const list = [];
  for (const s of locked) if (okPt(s.station) && s.station.id !== add.station.id) list.push({ km: s.km, lat: s.station.lat, lon: s.station.lon, id: s.station.id });
  list.push({ km: add.km, lat: add.station.lat, lon: add.station.lon, id: add.station.id });
  if (okPt(stopover) && Number.isFinite(stopoverKm) && stopoverKm > fromKm + 0.5) list.push({ km: stopoverKm, lat: stopover.lat, lon: stopover.lon, id: null });
  if (list.length > max) return null;
  list.sort((a, b) => a.km - b.km);
  return { wps: list.map(({ lat, lon }) => ({ lat, lon })), ids: list.map((x) => x.id).filter(Boolean) };
}

/** İki yön (derece) arasındaki mutlak fark (0-180). */
const turn = (a, b) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

/**
 * Yeni rota başlangıçta geri dönüş istiyor mu (yalnız navigasyonda: araç hareket hâlinde, rota konumdan başlar).
 * curDir: mevcut rotada aracın gidiş yönü (derece). Dönüş: true → yeni rota ilk ~0,5 km'de ters yöne gidiyor ya da başlangıca geri dönüyor.
 */
export function startUturn(coords, curDir, origin) {
  if (!Array.isArray(coords) || coords.length < 2 || !Number.isFinite(curDir)) return false;
  const cum = lineKm(coords);
  if (cum.at(-1) < 1.2) return false;
  const dir = travelDir(coords, cum, 0.5, 0.5);
  if (turn(dir, curDir) > START_TURN_DEG) return true;
  return okPt(origin) && passCount(coords, origin, 0.15) > 1; // başlangıç noktasından ikinci kez geçiyor: ileride dönüp geri geliyor
}

/**
 * Yeni rota doğrulaması (saf). Eklenen istasyon (ve kilitli duraklar) rotada gerçekten ziyaret edilmeli; başlangıçta geri dönüş olmamalı.
 * viaIssues: stopVia.viaCheck sorunları (yeni rota + yeni plan). Dönüş: { ok, reason, names }.
 */
export function judgeAddRoute({ viaIssues = [], addId, startTurn = false }) {
  if (startTurn) return { ok: false, reason: 'startuturn', names: [] };
  const mine = viaIssues.find((x) => x.id === addId);
  if (mine) return { ok: false, reason: mine.reason, names: [mine.name] };
  if (viaIssues.length) return { ok: false, reason: 'others', names: viaIssues.map((x) => x.name) };
  return { ok: true, reason: null, names: [] };
}

/** Uygunluk ve başarısızlık açıklamaları (Türkçe kaynak; sözlükte çevrilir). */
export const ADD_TEXT = {
  noroute: 'Rotaya eklemek için önce bir rota oluştur.',
  loading: 'Rota hesaplanıyor; bitince yeniden dene.',
  locked: 'Bu istasyon zaten rotanda zorunlu şarj durağı.',
  passed: 'Bu istasyon rotada geride kaldı; rotaya eklenemez.',
  far: 'İstasyon rotadan çok uzak; doğrudan gitmek için Git\'i kullan.',
  beyond: 'İstasyon varış noktasının ötesinde; rotaya eklenemez.',
  busy: 'Başka bir istasyon için rota hesaplanıyor; bitmesini bekle.',
  gps: 'Konum belirsiz (GPS zayıf ya da rotada değilsin); mevcut rota korundu.',
  blocked: 'İstasyona gidiş yönünde yasal giriş yok (karşı şerit / bariyer); mevcut rota korundu.',
  unverified: 'İstasyona gidiş yönünde erişim yol ağıyla doğrulanamadı ({0}); güvenlik için eklenmedi, mevcut rota korundu.',
  provider: 'Rota sağlayıcısı istasyon üzerinden rota veremedi ({0}); mevcut rota korundu.',
  noreach: 'Rota sağlayıcısı istasyonu ara nokta olarak almadı (rota girişe ulaşmıyor); mevcut rota korundu.',
  novia: 'Rota istasyona girmiyor; mevcut rota korundu.',
  uturn: 'İstasyona ancak geri dönüşle (karşı şerit) ulaşılıyor; mevcut rota korundu.',
  startuturn: 'Yeni rota bulunduğun yerden geri dönüş gerektiriyor; mevcut rota korundu.',
  others: 'Yeni rotada diğer duraklar ziyaret edilmiyor ({0}); mevcut rota korundu.',
  plan: 'Bu istasyonla şarj planı kurulamadı ({0}); mevcut rota korundu.',
  changed: 'Rota bu arada değişti (yeniden rota / yeni plan); ekleme iptal edildi, yeniden dene.',
  stale: 'Önizleme eskidi; yeniden hesapla.',
};
