import { getState, patch } from '../state.js';
import { OCR } from '../config.js';
import { preprocess } from './preprocess.js';
import { createFilter } from './outlierFilter.js';
import { countOcrEngineOnce } from '../net/meter.js';

// Tesseract dosyaları uygulamayla birlikte sunulur (vendor/tesseract): service worker ilk kullanımdan sonra bunları
// önbellekten verir, CDN'den tekrar tekrar indirilmez (veri tasarrufu) ve çevrimdışı açılış mümkün olur.
const VENDOR = new URL('../../vendor/tesseract/', import.meta.url);
const TESS_SRC = new URL('tesseract.min.js', VENDOR).href;
const WORKER_OPTIONS = {
  workerPath: new URL('worker.min.js', VENDOR).href,
  corePath: new URL('core', VENDOR).href, // dizin: SIMD desteğine göre tesseract-core[-simd]-lstm.wasm.js seçilir
  langPath: new URL('lang', VENDOR).href, // eng.traineddata.gz
};
const MIN_CONFIDENCE = 40;

const socFilter = createFilter({ maxJump: OCR.maxJumpPct });
const speedFilter = createFilter({ maxJump: OCR.maxJumpKmh, max: 250, resyncCount: 2 });
const work = document.createElement('canvas'); // OCR'a giden görüntü; önizleme tuvalinden ayrı

let workerPromise = null;
let running = false;
let timer = null;
let previewTimer = null;

export function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESS_SRC;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Tesseract.js yüklenemedi'));
    document.head.append(s);
  });
}

/** Yerel dosyalarla yeni bir Tesseract işçisi (pil OCR'ı ve token okuyucu ortak kullanır). */
export async function createTesseractWorker() {
  await loadTesseract();
  return window.Tesseract.createWorker('eng', window.Tesseract.OEM.LSTM_ONLY, WORKER_OPTIONS);
}

function getWorker() {
  workerPromise ||= (async () => {
    const worker = await createTesseractWorker();
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789%',
      tessedit_pageseg_mode: window.Tesseract.PSM.SINGLE_LINE,
    });
    countOcrEngineOnce(); // motor Web Worker içinde iner, sayfadan görünmez: ilk kurulumda tahmini ekle
    return worker;
  })().catch((err) => { workerPromise = null; throw err; });
  return workerPromise;
}

/**
 * OCR metninden % SoC çıkarır. Togg ekranında pil değeri iri rakamlardır ("75"), altında küçük "%" bulunur;
 * ROI yalnızca rakamlara oturtulmalıdır. Tesseract '%' simgesini sık sık rakam sanır ("85%" → "859"),
 * bu yüzden 3 haneli ve 100 olmayan sonuçlarda son hane atılır. Dönüş: 0..100 tamsayı veya null.
 */
export function parseSoc(text) {
  const m = String(text).match(/\d+/);
  if (!m || m[0].length > 3) return null;
  let digits = m[0];
  if (digits.length === 3 && digits !== '100') digits = digits.slice(0, 2);
  const v = Number(digits);
  return v >= 0 && v <= 100 ? v : null;
}

/** Ekran hızı: 0..250 tamsayı veya null. */
export function parseSpeed(text) {
  const m = String(text).match(/\d+/);
  if (!m || m[0].length > 3) return null;
  const v = Number(m[0]);
  return v <= 250 ? v : null;
}

async function readRoi(worker, video, stage, roi) {
  const o = getState('ocr');
  if (!preprocess(video, stage, { ...o, roi }, work)) return null;
  const { data } = await worker.recognize(work);
  return { text: data.text, confidence: data.confidence };
}

async function tick(video, stage) {
  if (!running) return;
  const t0 = Date.now();
  const o = getState('ocr');

  // Test Modu açıkken sensör okuması yapılmaz.
  if (!getState('sim').enabled) {
    try {
      const worker = await getWorker();

      const soc = await readRoi(worker, video, stage, o.roi);
      if (!running) return;
      if (soc) {
        const value = parseSoc(soc.text);
        if (value == null || soc.confidence < MIN_CONFIDENCE) {
          patch('ocr', { raw: value, status: 'unreadable' });
        } else {
          const res = socFilter.accept(value, Date.now());
          if (res.ok) {
            patch('ocr', { raw: value, accepted: res.value, status: 'ok', lastOkAt: Date.now() });
            patch('live', { soc: res.value });
          } else {
            patch('ocr', { raw: value, status: 'rejected' }); // son geçerli değer korunur
          }
        }
      }

      if (getState('ocr').speedOn) {
        const spd = await readRoi(worker, video, stage, o.roiSpeed);
        if (!running) return;
        if (spd) {
          const value = parseSpeed(spd.text);
          if (value == null || spd.confidence < MIN_CONFIDENCE) {
            patch('ocr', { rawSpeed: value, speedStatus: 'unreadable' });
          } else if (speedFilter.accept(value, Date.now()).ok) {
            patch('ocr', { rawSpeed: value, speedStatus: 'ok' });
            patch('live', { speedScr: value, speedScrAt: Date.now() });
          } else {
            patch('ocr', { rawSpeed: value, speedStatus: 'rejected' });
          }
        }
      }
    } catch (err) {
      patch('ocr', { status: 'error' });
      console.warn('OCR hatası:', err);
    }
  }
  if (running) timer = setTimeout(() => tick(video, stage), Math.max(250, OCR.intervalMs - (Date.now() - t0)));
}

export async function startOcr(video, stage) {
  if (running) return;
  running = true;
  patch('system', { ocr: true });
  patch('ocr', { status: 'loading' });
  try {
    await getWorker(); // ilk seferde Tesseract + dil verisi iner
  } catch (err) {
    stopOcr();
    patch('ocr', { status: 'error' });
    throw err;
  }
  if (running) tick(video, stage);
}

export function stopOcr() {
  running = false;
  clearTimeout(timer);
  patch('system', { ocr: false });
  patch('ocr', { status: 'idle', speedStatus: 'idle' });
}

/** Manuel +/- veya dış kaynak: outlier filtresinin referansını ayarla. */
export function calibrateSoc(value) {
  socFilter.reset(value);
}

/** Filtre önizlemesi: kullanıcı eşik/kontrastı ayarlarken pil ROI'sinin işlenmiş halini gösterir. */
export function startPreview(video, stage, canvas) {
  stopPreview();
  previewTimer = setInterval(() => {
    if (document.hidden || !stage.offsetParent) return;
    preprocess(video, stage, getState('ocr'), canvas);
  }, 400);
}

export function stopPreview() {
  clearInterval(previewTimer);
  previewTimer = null;
}
