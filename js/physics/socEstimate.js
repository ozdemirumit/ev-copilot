// Pil yüzdesi kaynağı: kamera (OCR) okuması ya da elle girilen değer. Elle girilince (Rota sürgüsü, navigasyon sürgüsü, kalibrasyon +/-)
// yol alındıkça değer tüketim modeliyle kendiliğinden düşer (tahmin). Kamera okuması bu değeri her zaman geçersiz kılar:
// OCR bir değer kabul ettiği an kaynak "kamera"ya döner. OCR uzun süre okuyamazsa son değerden tahmine devam edilir.
// Test Modu'nda tahmin yapılmaz (sürgü değerleri kullanılır). Hiç bilgi yoksa %80 varsayılır ve kaynağı "Varsayılan" olarak gösterilir;
// son kullanılabilir değer bu cihazda saklanır, kamera kapanınca ya da sayfa yenilenince %80'e dönülmez.
import { getState, patch, subscribe } from '../state.js';
import { VEHICLE } from '../config.js';
import { load, save } from '../utils/storage.js';
import { releaseSoc } from '../sensors/ocr.js';

const FALLBACK_MS = 180_000; // kamera çalışıyor ama bu kadar süredir okuyamıyorsa tahmine geç (kısa kesintilerde son değer korunur)
const IDLE_FALLBACK_MS = 60_000; // kamera/OCR kapalıysa son okumadan bu kadar sonra tahmine geç
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r1 = (v) => Math.round(v * 10) / 10;

export const DEFAULT_SOC = 80; // hiç pil bilgisi yokken (ne kamera, ne elle giriş, ne kayıtlı son değer) hesaplarda kullanılan değer
const STORE_KEY = 'socLast'; // son kullanılabilir değer: yalnızca bu cihazda (hesap senkronuna girmez)
const STORE_EVERY_MS = 15_000; // tahmin/kamera değeri en çok bu sıklıkla yazılır (elle giriş hemen)

let est = null; // tahmin/elle değer (ondalıklı)
let mode = 'none'; // 'ocr' | 'manual' | 'default' | 'none'
let origin = null; // mode 'manual' iken: 'user' (kullanıcı girdi) | 'estimate' (kamera sustu ya da önceki oturumdan devam)
let reported = false; // bu oturumda gerçek bir okuma ya da elle giriş oldu mu? (ABRP varsayılan/eski oturum değerini göndermez)
let ocrAt = 0;
let seenRead = 0;
let beat = 0;
let storedAt = 0;

function setMode(m) {
  if (mode === m) return;
  mode = m;
  patch('engine', { socSrc: m });
}

const ONLINE_MS = 45_000; // kamera okuması bu süreden eskiyse pil "çevrimdışı" (kırmızı) sayılır; OCR 5 sn'de bir okur

/** Pil değeri şu an kameradan canlı mı okunuyor? (Yeşil: evet. Kırmızı: elle girilmiş, tahmin ya da kamera okuması eski/yok.) */
export const isOnline = () => mode === 'ocr' && Date.now() - ocrAt <= ONLINE_MS;

/** Elle pil ayarı kilitli mi? Yalnızca kamera açık, pili şu an sorunsuz okuyor ve değer canlıysa. Kamera kapalıysa ya da son okuma "okunamadı/reddedildi" ise sürgüler serbesttir. */
export const manualLocked = () => isOnline() && getState('system').camera && getState('ocr').status === 'ok';

/** Tahmin yapılıyor mu (elle değerden düşüyor)? rangeEngine bu durumda pili öğrenmeye katmaz. */
export const isEstimating = () => (mode === 'manual' || mode === 'default') && est != null && !getState('sim').enabled;

/** Pil değerinin görünen kaynağı: 'live' (taze kamera) | 'stale' (eski kamera) | 'manual' (elle) | 'estimate' (son değerden tahmin) | 'default' (varsayılan) | 'none'. */
export function socSource() {
  if (isOnline()) return 'live';
  if (mode === 'ocr') return 'stale';
  if (mode === 'manual') return origin === 'user' ? 'manual' : 'estimate';
  return mode;
}

/** Bu oturumda gerçek bir pil bilgisi (kamera ya da elle) var mı? */
export const socReported = () => reported;

/** Dışarı gönderilecek pil (ABRP, doluluk sorgusu): varsayılan ve önceki oturumdan kalan değer ölçüm değildir, gönderilmez. Test Modu sürgüsü aynen gider. */
export const measuredSoc = (e) => (e.source === 'sim' || reported ? e.soc : null);

/** Son kullanılabilir değeri bu cihaza yaz. Varsayılanın kendisi yazılmaz: yol alınıp düşmedikçe kayıt gerekmez. */
function persist(force = false) {
  if (est == null || mode === 'none' || getState('sim').enabled) return;
  if (!force && Date.now() - storedAt < STORE_EVERY_MS) return;
  storedAt = Date.now();
  save(STORE_KEY, { v: r1(est), o: mode === 'manual' ? origin : mode }, { silent: true });
}

/**
 * Açılışta pil başlangıcı (paneller ilk kez çizilmeden önce): kayıtlı son değer varsa ondan devam edilir (0 da geçerlidir),
 * hiç bilgi yoksa varsayılan. İkisi de tahmin sayılır, canlı/ölçülmüş gibi gösterilmez; kamera okuyunca geçersiz olur.
 */
export function restoreSoc() {
  if (mode !== 'none') return;
  const saved = load(STORE_KEY, null);
  const v = Number.isFinite(saved?.v) && saved.v >= 0 && saved.v <= 100 ? saved.v : null;
  if (v == null) {
    est = DEFAULT_SOC;
    setMode('default');
  } else {
    est = v;
    origin = saved.o === 'user' ? 'user' : 'estimate';
    setMode(saved.o === 'default' ? 'default' : 'manual');
  }
  patch('live', { soc: r1(est) });
}

/** Elle pil gir (0-100). OCR filtresi serbest bırakılır: kamera okuyunca bu değeri geçersiz kılar. */
export function setManual(v) {
  est = clamp(v, 0, 100);
  origin = 'user';
  reported = true;
  setMode('manual');
  releaseSoc();
  beat = Date.now();
  patch('live', { soc: r1(est) });
  patch('ocr', { accepted: Math.round(est), status: 'manual', lastOkAt: beat });
  persist(true);
}

/** Yol alındıkça harcanan enerji (kWh, geri kazanım eksi): tahmini pili düşür. */
export function consume(kwh) {
  if (!isEstimating()) return;
  est = clamp(est - (kwh / VEHICLE.batteryNetKwh) * 100, 0, 100);
  patch('live', { soc: r1(est) });
  persist();
  if (reported && Date.now() - beat > 10_000) { // ABRP: "pil okuması eski" sayılmasın
    beat = Date.now();
    patch('ocr', { lastOkAt: beat });
  }
}

export function initSocEstimate() {
  subscribe('ocr', () => {
    const o = getState('ocr');
    if (o.readAt && o.readAt !== seenRead && o.accepted != null) { // gerçek kamera okuması: her zaman öncelikli (tahminin lastOkAt güncellemesi buraya sayılmaz)
      seenRead = o.readAt;
      ocrAt = Date.now();
      est = o.accepted;
      reported = true;
      setMode('ocr');
      persist();
    }
  });
  setInterval(() => {
    const limit = getState('system').ocr ? FALLBACK_MS : IDLE_FALLBACK_MS;
    if (mode === 'ocr' && Date.now() - ocrAt > limit && getState('live').soc != null && !getState('sim').enabled) {
      est = getState('live').soc;
      origin = 'estimate';
      setMode('manual'); // kamera okumuyor: son değerden tahmin
      persist(true);
    }
  }, 5000);
}
