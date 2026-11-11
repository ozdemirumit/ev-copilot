import { createTesseractWorker } from './ocr.js';
import { parseShot } from './shotParse.js';
import { countOcrEngineOnce } from '../net/meter.js';

const MAX_W = 1600; // çok büyük ekran görüntüsü OCR'ı yavaşlatır; küçükse büyütülür
const MIN_W = 1100;

/** Dosyadan tuval: EXIF yönü uygulanır, genişlik MIN_W..MAX_W aralığına getirilir. */
async function toCanvas(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(MAX_W / bmp.width, Math.max(1, MIN_W / bmp.width));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}

/** Gri tonlama + (koyu zeminse) ters çevirme: Tesseract koyu yazı/açık zemin sever; widget'lar çoğunlukla açık yazı/koyu zemin. */
function grayCanvas(src, invert) {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    const v = invert ? 255 - g : g;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function meanLuma(canvas) {
  const small = document.createElement('canvas');
  small.width = 64;
  small.height = Math.max(1, Math.round(64 * canvas.height / canvas.width));
  const ctx = small.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, small.width, small.height);
  const d = ctx.getImageData(0, 0, small.width, small.height).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
  return s / (d.length / 4);
}

/**
 * Ekran görüntüsünü okur: { soc, rangeKm, at, ambiguous, text }. Önce görüntünün baskın tonuna uygun (koyuysa ters çevrilmiş) kopya, pil bulunamazsa
 * ters polarite denenir. Hepsi cihazda (Tesseract); görüntü hiçbir yere gönderilmez.
 */
export async function readShot(file, onStatus = () => {}) {
  onStatus('prep');
  const base = await toCanvas(file);
  const dark = meanLuma(base) < 128;
  const worker = await createTesseractWorker();
  countOcrEngineOnce();
  try {
    await worker.setParameters({ tessedit_pageseg_mode: window.Tesseract.PSM.SPARSE_TEXT });
    let best = null;
    for (const invert of [dark, !dark]) {
      onStatus('read');
      const { data } = await worker.recognize(grayCanvas(base, invert));
      const r = { ...parseShot(data.text), text: data.text };
      if (!best || (best.soc == null && r.soc != null)) best = r;
      if (best.soc != null && (best.rangeKm != null || best.at)) break; // pil ve en az bir ek bilgi okundu: yeter
    }
    return best;
  } finally {
    worker.terminate();
  }
}
