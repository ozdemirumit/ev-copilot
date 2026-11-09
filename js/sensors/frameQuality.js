// ROI kare kalitesi (DOM'suz, saf; node ile test edilir): parlama, netlik, kontrast. Girdi: küçültülmüş ROI'nin gri değerleri.
// Eşikler gerçek görüntüyle ayarlanmadıysa OCR'ı kesmesin diye bulanık kare atılmaz, yalnızca ağırlığı düşer; yalnızca okunması
// imkânsız kareler (geniş doygunluk ya da yazısız düz görüntü) elenir.

const CELLS_X = 8;
const CELLS_Y = 4;
const SATURATED = 235; // hücre ortalaması: ince rakam çizgileri bir hücreyi doldurmaz, parlama doldurur
const GLARE_UNUSABLE = 0.6;
const GLARE_FIRST_CORE = 0.12; // bu oranda parlamada "parlak çekirdek" yöntemi önce denenir
const GLARE_EXPOSURE = 0.15;
const MIN_CONTRAST = 24; // binarize.js MIN_RANGE ile aynı
const SHARP_MIN = 0.12;
const BLUR_WEIGHT = 0.6;
const DARK_MEAN = 35;
const DARK_CONTRAST = 80;

const EMPTY = { glare: 0, sharpness: 0, contrast: 0, mean: 0, usable: false, blurry: true, weight: 0, reason: 'empty' };

function percentile(hist, total, p) {
  const target = total * p;
  let run = 0;
  for (let i = 0; i < hist.length; i++) {
    run += hist[i];
    if (run >= target) return i;
  }
  return hist.length - 1;
}

/** Dönüş: { glare 0..1, sharpness (kenar keskinliği / kontrast), contrast, mean, usable, blurry, weight 0..1, reason }. */
export function measureFrame(gray, w, h) {
  const n = w * h;
  if (!n || gray.length < n) return EMPTY;

  const hist = new Uint32Array(256);
  let sum = 0;
  for (let i = 0; i < n; i++) { hist[gray[i]]++; sum += gray[i]; }
  const contrast = percentile(hist, n, 0.95) - percentile(hist, n, 0.05);

  const cellSum = new Uint32Array(CELLS_X * CELLS_Y);
  const cellN = new Uint32Array(CELLS_X * CELLS_Y);
  for (let y = 0; y < h; y++) {
    const cy = Math.min(CELLS_Y - 1, Math.floor((y / h) * CELLS_Y));
    for (let x = 0; x < w; x++) {
      const c = cy * CELLS_X + Math.min(CELLS_X - 1, Math.floor((x / w) * CELLS_X));
      cellSum[c] += gray[y * w + x];
      cellN[c]++;
    }
  }
  let saturated = 0;
  let cells = 0;
  for (let c = 0; c < cellSum.length; c++) {
    if (!cellN[c]) continue;
    cells++;
    if (cellSum[c] / cellN[c] >= SATURATED) saturated++;
  }
  const glare = cells ? saturated / cells : 0;

  const lap = new Uint32Array(1021);
  let inner = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      lap[Math.abs(4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w])]++;
      inner++;
    }
  }
  const sharpness = inner ? percentile(lap, inner, 0.98) / Math.max(contrast, 1) : 0;
  const blurry = sharpness < SHARP_MIN;

  let reason = null;
  if (glare >= GLARE_UNUSABLE) reason = 'glare';
  else if (contrast < MIN_CONTRAST) reason = 'flat';
  const usable = !reason;
  const weight = usable ? (1 - glare) * (blurry ? BLUR_WEIGHT : 1) : 0;
  return { glare, sharpness, contrast, mean: sum / n, usable, blurry, weight, reason };
}

/** Okuma yöntemlerinin sırası: parlamada önce parlak çekirdek; son başarılı yöntem (preferred) öne alınır. */
export function variantOrder(quality, variants, preferred) {
  const order = (quality?.glare ?? 0) >= GLARE_FIRST_CORE ? [...variants.filter((v) => v !== 0), ...variants.filter((v) => v === 0)] : [...variants];
  return order.includes(preferred) ? [preferred, ...order.filter((v) => v !== preferred)] : order;
}

/** Pozlama telafisi önerisi: −1 kıs, +1 aç, 0 dokunma. */
export function exposureSignal(q) {
  if (!q) return 0;
  if (q.glare >= GLARE_EXPOSURE) return -1;
  if (q.mean < DARK_MEAN && q.contrast < DARK_CONTRAST) return 1;
  return 0;
}
