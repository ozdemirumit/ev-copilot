import { loadTesseract } from './ocr.js';
import { preprocess } from './preprocess.js';
import { countOcrEngineOnce } from '../net/meter.js';

/** Kamera görüntüsünde okunacak bölge (görünen çerçevenin oranı); arayüzdeki kılavuz kutu bununla aynıdır. */
export const GUIDE = { x: 0.04, y: 0.28, w: 0.92, h: 0.44 };

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

/**
 * OCR metninden UUID biçimli token/anahtar çıkarır (ABRP token'ı 8-4-4-4-12 onaltılı). Satır sonunda bölünmüş
 * veya tireleri düşmüş okumaları da toparlar: boşluklar silinir, tam 32 onaltılı hane varsa tireler yeniden konur.
 * UUID doğrulaması OCR hatalarına karşı güvenlik ağıdır; başka biçimdeki değerler (ör. farklı uzunlukta API key) okunmaz.
 */
export function extractUuid(text) {
  const t = String(text).toLowerCase().replace(/[\s_]/g, '').replace(/[–—‐]/g, '-');
  const m = UUID.exec(t);
  if (m) return m[0];
  const hex = t.replace(/[^0-9a-f]/g, '');
  if (hex.length === 32 && t.replace(/[0-9a-f-]/g, '').length === 0) {
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return null;
}

/** İnce çizgili yazıları kalınlaştır (3×3 en koyu piksel): koyu yazı/açık zemin görüntüsünde çizgiler kalınlaşır. */
function thicken(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const src = ctx.getImageData(0, 0, w, h);
  const dst = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 255;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const v = src.data[(yy * w + Math.min(w - 1, Math.max(0, x + dx))) * 4];
          if (v < m) m = v;
        }
      }
      const i = (y * w + x) * 4;
      dst.data[i] = dst.data[i + 1] = dst.data[i + 2] = m;
      dst.data[i + 3] = 255;
    }
  }
  ctx.putImageData(dst, 0, 0);
}

/** Ayrı bir Tesseract işçisi (pil OCR'ından bağımsız): yalnızca onaltılı haneler ve tire. Bitince terminate() çağır. */
export async function createTokenReader() {
  await loadTesseract();
  const worker = await window.Tesseract.createWorker('eng');
  countOcrEngineOnce();
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789abcdef-', // UUID'ler küçük harfli onaltılı
    tessedit_pageseg_mode: window.Tesseract.PSM.SINGLE_BLOCK,
  });
  const canvas = document.createElement('canvas');

  return {
    /** video: kamera, stage: videonun gösterildiği kutu (object-fit: cover eşlemesi için). */
    async read(video, stage) {
      const opts = { roi: GUIDE, contrast: 1.6, threshold: 128, useThreshold: false, scale: 2, maxH: 640 };
      if (!preprocess(video, stage, opts, canvas)) return null;
      let { data } = await worker.recognize(canvas);
      let uuid = extractUuid(data.text);
      if (!uuid) { // ince çizgili yazı: kalınlaştırıp bir kez daha dene
        thicken(canvas);
        ({ data } = await worker.recognize(canvas));
        uuid = extractUuid(data.text);
      }
      return { text: data.text, confidence: data.confidence, uuid };
    },
    terminate: () => worker.terminate(),
  };
}
