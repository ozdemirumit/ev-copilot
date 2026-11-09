import { getState, patch, effective } from '../state.js';
import { OCR, VEHICLE } from '../config.js';
import { preprocess, measureRoi, VARIANTS, PAD } from './preprocess.js';
import { readCanvasDigits, digitMismatch } from './digitRecognizer.js';
import { createSocFilter, createSpeedFilter } from './outlierFilter.js';
import { consensus } from './ocrConsensus.js';
import { createOcrLoop, collectSamples } from './ocrLoop.js';
import { variantOrder, exposureSignal } from './frameQuality.js';
import { isCameraLive, nudgeExposure } from './camera.js';
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

// En yüksek şarj hızı (%/dk): araç bilgisinden, %25 payla (bilinmiyorsa 3)
const chargeRate = (VEHICLE.maxDcKw / VEHICLE.batteryNetKwh) * (100 / 60) * 1.25;
const socFilter = createSocFilter({ chargePctPerMin: Number.isFinite(chargeRate) && chargeRate > 0 ? chargeRate : 3, maxJump: OCR.maxJumpPct });
const speedFilter = createSpeedFilter({ maxJump: OCR.maxJumpKmh });
const work = document.createElement('canvas'); // OCR'a giden görüntü; önizleme tuvalinden ayrı

const SOC_TOL = 1; // aynı çevrimdeki kareler arası tolerans
const SPEED_TOL = 3;
const MAX_VARIANTS_AFTER_PARSE = 2; // bu çevrimde değer okunduysa kare başına en çok bu kadar yöntem (5 sn'ye sığsın)

let workerPromise = null;
let loop = null;
let active = false;
let startToken = 0;
let target = null; // { video, stage }
let lastFrameToken = null; // video.currentTime: aynı kareyi iki kez okuma (donmuş görüntü başarılı okuma sayılmasın)
let previewTimer = null;
const preferredVariant = {}; // ROI başına son başarılı okuma yöntemi

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
 * Geniş aralıklı rakamlar boşlukla bölünebilir ("4 2"): aynı satırdaki gruplar birleştirilir (yalnızca ilk grubu almak 42'yi 4 okuyordu).
 */
function digitsOf(text) {
  const line = String(text).split(/\r?\n/).find((l) => /\d/.test(l));
  if (!line) return null;
  const runs = line.replace(/^\D+/, '').split('%')[0].match(/\d+/g);
  return runs ? runs.join('') : null;
}

export function parseSoc(text) {
  let digits = digitsOf(text);
  if (!digits || digits.length > 3) return null;
  if (digits.length === 3 && digits !== '100') digits = digits.slice(0, 2);
  const v = Number(digits);
  return v >= 0 && v <= 100 ? v : null;
}

/** Ekran hızı: 0..250 tamsayı veya null. */
export function parseSpeed(text) {
  const digits = digitsOf(text);
  if (!digits || digits.length > 3) return null;
  const v = Number(digits);
  return v <= 250 ? v : null;
}

/**
 * ROI'yi bir kare için okur. Kalite ölçülür; okunması imkânsız kare OCR'a verilmez. Normalde önce Otsu, parlamada önce "parlak çekirdek"
 * yöntemi denenir (kamera rakamı aşırı pozlayıp ışıma yaptığında Otsu rakamı ışımayla tek leke yapar); son başarılı yöntem öne alınır.
 * Değer null ise kare okunamamıştır; yine de örnek listesinde kalır ve güven skorunu düşürür.
 */
const GOOD_CONFIDENCE = 60;
const EMPTY_SAMPLE = { value: null, raw: null, confidence: 0, quality: 0, q: null, digits: null, reason: null };
const READINGS_MAX = 5;

/** Pil ROI'sinin her kare okuması tanılamaya yazılır (son 5 ham okuma, sayaç, son okuma zamanı). */
function logReading(key, entry) {
  if (key !== 'soc') return;
  const o = getState('ocr');
  const at = Date.now();
  patch('ocr', { lastReadAt: at, readCount: (o.readCount || 0) + 1, readings: [{ at, ...entry }, ...(o.readings || [])].slice(0, READINGS_MAX) });
}

async function readRoi(worker, video, stage, key, roi, parse, { timeLeft, isCurrent, parsedKeys, engine }) {
  const o = getState('ocr');
  const q = measureRoi(video, stage, { ...o, roi });
  if (!q) return EMPTY_SAMPLE;
  if (!q.usable) {
    logReading(key, { engine, text: '', value: null, confidence: 0, digits: null, reason: q.reason, alt: null });
    return { ...EMPTY_SAMPLE, q, reason: q.reason };
  }
  const order = o.useThreshold ? variantOrder(q, VARIANTS, preferredVariant[key]) : [0]; // eşiksiz modda yalnızca tek yöntem anlamlı (çekirdek yöntemi eşiğe dayanır)
  const limit = parsedKeys.has(key) ? Math.min(MAX_VARIANTS_AFTER_PARSE, order.length) : order.length;
  let best = null;
  for (let i = 0; i < limit; i++) {
    if (i > 0 && timeLeft() <= 0) break;
    if (!isCurrent()) return EMPTY_SAMPLE;
    if (!preprocess(video, stage, { ...o, roi, variant: order[i] }, work)) break;
    const seg = readCanvasDigits(work, PAD); // OCR 2 sonucu; OCR 1 için hane sayısı kanıtı ve karşılaştırma
    const read = engine === 'digit' ? { text: seg.text, confidence: seg.confidence } : (await worker.recognize(work)).data;
    const rawValue = parse(read.text);
    const mismatch = digitMismatch(rawValue, seg.n);
    const r = {
      variant: order[i], value: mismatch ? null : rawValue, rawValue, text: read.text, confidence: read.confidence, mismatch,
      digits: seg.n, clipped: seg.clipped, alt: engine === 'digit' ? null : { text: seg.text, confidence: seg.confidence },
    };
    const parsed = r.value != null;
    if (parsed && r.confidence >= GOOD_CONFIDENCE) { best = r; break; }
    if (!best || (parsed && (best.value == null || r.confidence > best.confidence)) || (best.value == null && !parsed && r.confidence > best.confidence)) best = r;
  }
  if (!best) return { ...EMPTY_SAMPLE, q };
  const valid = best.value != null && best.confidence >= MIN_CONFIDENCE;
  if (valid) { preferredVariant[key] = best.variant; parsedKeys.add(key); } else delete preferredVariant[key];
  const reason = valid ? null : best.mismatch || (best.rawValue != null ? 'low-confidence' : 'no-digits');
  logReading(key, { engine, text: String(best.text ?? '').trim(), value: best.rawValue, confidence: Math.round(best.confidence), digits: best.digits, reason, clipped: best.clipped, alt: best.alt });
  return { value: valid ? best.value : null, raw: best.rawValue, confidence: best.confidence, quality: q.weight, q, digits: best.digits, reason };
}

const rawOf = (samples, c) => c.raw ?? samples.find((s) => s.raw != null)?.raw ?? null;
const percent = (score) => Math.round((score || 0) * 100);

/** Elde güvenilir bir ön bilgi varsa (kayıtlı/elle değer) ilk okumanın doğrulanmasında ipucu olur; varsayılan %80 bilgi değildir. */
function socHint() {
  const src = getState('engine').socSrc;
  return src && src !== 'default' ? getState('live').soc : null;
}

/** Red kaydı: son 5 ham okumanın yanında neden reddedildiği görünür. */
const rejection = (reason, value, count, need, now) => ({ reason, rejected: { reason, value, count: count ?? null, need: need ?? null, at: now } });

function applySoc(samples) {
  const c = consensus(samples, { tol: SOC_TOL });
  const reliability = percent(c.score);
  const now = Date.now();
  if (c.value == null) {
    const reason = [...samples].reverse().find((s) => s.reason)?.reason || (c.raw != null ? 'no-consensus' : 'no-digits');
    patch('ocr', { raw: rawOf(samples, c), status: 'unreadable', stale: true, reliability, ...rejection(reason, rawOf(samples, c), null, null, now) });
    return;
  }
  const res = socFilter.accept(c.value, now, { score: c.score, speedKmh: effective().speed, hint: socHint(), digits: c.digits });
  if (res.ok) {
    patch('ocr', { raw: c.value, accepted: res.value, status: 'ok', lastOkAt: now, readAt: now, stale: false, reliability, reason: null }); // readAt: yalnızca gerçek kamera okuması (tahmin/elle girişte değişmez)
    patch('live', { soc: res.value });
  } else {
    patch('ocr', { raw: c.value, status: res.reason === 'verifying' || res.reason === 'recovering' ? 'verifying' : 'rejected', stale: true, reliability, ...rejection(res.reason, c.value, res.count, res.need, now) }); // son geçerli değer korunur
  }
}

function applySpeed(samples) {
  const c = consensus(samples, { tol: SPEED_TOL });
  const speedReliability = percent(c.score);
  const now = Date.now();
  if (c.value == null) {
    patch('ocr', { rawSpeed: rawOf(samples, c), speedStatus: 'unreadable', speedStale: true, speedReliability });
    return;
  }
  const res = speedFilter.accept(c.value, now, { score: c.score });
  if (res.ok) {
    patch('ocr', { rawSpeed: c.value, speedStatus: 'ok', speedAt: now, speedStale: false, speedReliability });
    patch('live', { speedScr: res.value, speedScrAt: now });
  } else {
    patch('ocr', { rawSpeed: c.value, speedStatus: res.reason === 'verifying' ? 'verifying' : 'rejected', speedStale: true, speedReliability });
  }
}

/** Bir OCR çevrimi: birkaç kare örnekle, ortak karar + fiziksel makullük, sonucu yaz. Kare akmıyorsa son doğrulanmış değer korunur ve eski işaretlenir. */
async function runCycle(isCurrent) {
  if (getState('sim').enabled) return; // Test Modu açıkken sensör okuması yapılmaz.
  const { video, stage } = target;
  const engine = getState('ocr').engine === 'digit' ? 'digit' : 'tess';
  const worker = engine === 'tess' ? await getWorker() : null; // OCR 2 Tesseract indirmez: tamamen çevrimdışı
  if (!isCurrent()) return;

  const o = getState('ocr');
  const speedOn = o.speedOn;
  const socSamples = [];
  const speedSamples = [];
  const parsedKeys = new Set();
  const started = Date.now();
  const ctx = { isCurrent, parsedKeys, engine, timeLeft: () => OCR.cycleBudgetMs - (Date.now() - started) };
  let delivered = 0;
  let lastQuality = null;
  const strong = (samples, tol) => {
    const c = consensus(samples, { tol });
    return c.value != null && c.score >= OCR.strongScore;
  };

  await collectSamples({
    minFrames: OCR.samples, maxFrames: OCR.maxSamples, gapMs: OCR.sampleGapMs, budgetMs: OCR.cycleBudgetMs, isCurrent,
    enough: () => strong(socSamples, SOC_TOL) && (!speedOn || strong(speedSamples, SPEED_TOL)),
    readFrame: async () => {
      if (!isCameraLive()) return;
      const token = video.currentTime;
      if (token === lastFrameToken) return; // görüntü akmıyor
      lastFrameToken = token;
      delivered++;
      const soc = await readRoi(worker, video, stage, 'soc', o.roi, parseSoc, ctx);
      socSamples.push(soc);
      if (soc.q) lastQuality = soc.q;
      if (speedOn && isCurrent()) speedSamples.push(await readRoi(worker, video, stage, 'speed', o.roiSpeed, parseSpeed, ctx));
    },
  });
  if (!isCurrent()) return;

  if (!delivered) {
    patch('ocr', { status: 'unreadable', stale: true, reliability: 0, speedStale: true, speedStatus: speedOn ? 'unreadable' : 'idle', speedReliability: 0, note: 'Kameradan yeni görüntü gelmiyor' });
    return;
  }
  patch('ocr', { note: '' });
  applySoc(socSamples);
  if (speedOn) applySpeed(speedSamples);
  nudgeExposure(exposureSignal(lastQuality));
}

function failCycle(err) {
  patch('ocr', { status: 'error', error: String(err?.message || err).slice(0, 160), stale: true, reliability: 0, speedStale: true });
  console.warn('OCR hatası:', err);
}

/** Takılan Tesseract işçisini kapat: sonraki çevrim yenisini kurar. */
function dropWorker() {
  const old = workerPromise;
  workerPromise = null;
  old?.then((w) => w.terminate()).catch(() => {});
}

function ensureLoop() {
  loop ||= createOcrLoop({
    runCycle, intervalMs: OCR.intervalMs, cycleTimeoutMs: OCR.cycleTimeoutMs, onError: failCycle,
    onTimeout: () => { dropWorker(); failCycle(new Error('OCR zaman aşımı')); },
  });
  return loop;
}

export async function startOcr(video, stage) {
  if (active) return;
  active = true;
  const token = ++startToken;
  target = { video, stage };
  patch('system', { ocr: true });
  patch('ocr', { status: 'loading', error: null });
  try {
    if (getState('ocr').engine !== 'digit') await getWorker(); // ilk seferde Tesseract + dil verisi iner; OCR 2 yüklemez
  } catch (err) {
    if (token === startToken) stopOcr();
    patch('ocr', { status: 'error', error: String(err?.message || err).slice(0, 160) });
    throw err;
  }
  if (active && token === startToken) ensureLoop().start();
}

export function stopOcr() {
  active = false;
  startToken++;
  loop?.stop();
  patch('system', { ocr: false });
  patch('ocr', { status: 'idle', speedStatus: 'idle', stale: true, speedStale: true });
}

/** OCR 1 (tess) / OCR 2 (digit) seçimi. Aynı kamera ve ROI; son doğrulanmış değer korunur, birikmiş aday kanıtı silinir. */
export async function setOcrEngine(engine) {
  if ((engine !== 'tess' && engine !== 'digit') || getState('ocr').engine === engine) return;
  patch('ocr', { engine, reason: null });
  socFilter.clearEvidence();
  speedFilter.clearEvidence();
  Object.keys(preferredVariant).forEach((k) => delete preferredVariant[k]);
  if (engine === 'digit') dropWorker(); // kullanılmayan Tesseract belleği bırakılır
  if (active) {
    const { video, stage } = target;
    stopOcr();
    await startOcr(video, stage);
  }
}

/** Manuel +/- veya dış kaynak: outlier filtresinin referansını ayarla. */
export function calibrateSoc(value) {
  socFilter.reset(value);
}

/** Elle/tahmin pil girildi: filtre referansı bırakılır, kamera okuması bir sonraki okumada bu değeri geçersiz kılar. */
export function releaseSoc() {
  socFilter.reset(null);
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
