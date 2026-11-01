// Pil yüzdesi kaynağı: kamera (OCR) okuması ya da elle girilen değer. Elle girilince (Rota sürgüsü, navigasyon sürgüsü, kalibrasyon +/-)
// yol alındıkça değer tüketim modeliyle kendiliğinden düşer (tahmin). Kamera okuması bu değeri her zaman geçersiz kılar:
// OCR bir değer kabul ettiği an kaynak "kamera"ya döner. OCR uzun süre okuyamazsa son değerden tahmine devam edilir.
// Test Modu'nda tahmin yapılmaz (sürgü değerleri kullanılır).
import { getState, patch, subscribe } from '../state.js';
import { VEHICLE } from '../config.js';
import { releaseSoc } from '../sensors/ocr.js';

const FALLBACK_MS = 90_000; // OCR bu kadar süredir okuyamıyorsa tahmine geç
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r1 = (v) => Math.round(v * 10) / 10;

let est = null; // tahmin/elle değer (ondalıklı)
let mode = 'none'; // 'ocr' | 'manual' | 'none'
let ocrAt = 0;
let seenOk = 0;
let beat = 0;

function setMode(m) {
  if (mode === m) return;
  mode = m;
  patch('engine', { socSrc: m });
}

const ONLINE_MS = 45_000; // kamera okuması bu süreden eskiyse pil "çevrimdışı" (kırmızı) sayılır; OCR sabit değerde 15 sn'de bir okur

/** Pil değeri şu an kameradan canlı mı okunuyor? (Yeşil: evet. Kırmızı: elle girilmiş, tahmin ya da kamera okuması eski/yok.) */
export const isOnline = () => mode === 'ocr' && Date.now() - ocrAt <= ONLINE_MS;

/** Tahmin yapılıyor mu (elle değerden düşüyor)? rangeEngine bu durumda pili öğrenmeye katmaz. */
export const isEstimating = () => mode === 'manual' && est != null && !getState('sim').enabled;

/** Elle pil gir (0-100). OCR filtresi serbest bırakılır: kamera okuyunca bu değeri geçersiz kılar. */
export function setManual(v) {
  est = clamp(v, 0, 100);
  setMode('manual');
  releaseSoc();
  beat = Date.now();
  patch('live', { soc: r1(est) });
  patch('ocr', { accepted: Math.round(est), status: 'manual', lastOkAt: beat });
}

/** Yol alındıkça harcanan enerji (kWh, geri kazanım eksi): tahmini pili düşür. */
export function consume(kwh) {
  if (!isEstimating()) return;
  est = clamp(est - (kwh / VEHICLE.batteryNetKwh) * 100, 0, 100);
  patch('live', { soc: r1(est) });
  if (Date.now() - beat > 10_000) { // ABRP: "pil okuması eski" sayılmasın
    beat = Date.now();
    patch('ocr', { lastOkAt: beat });
  }
}

export function initSocEstimate() {
  subscribe('ocr', () => {
    const o = getState('ocr');
    if (o.status === 'ok' && o.accepted != null && o.lastOkAt !== seenOk) { // gerçek kamera okuması: her zaman öncelikli
      seenOk = o.lastOkAt;
      ocrAt = Date.now();
      est = o.accepted;
      setMode('ocr');
    }
  });
  setInterval(() => {
    if (mode === 'ocr' && Date.now() - ocrAt > FALLBACK_MS && getState('live').soc != null && !getState('sim').enabled) {
      est = getState('live').soc;
      setMode('manual'); // kamera okumuyor: son değerden tahmin
    }
  }, 5000);
}
