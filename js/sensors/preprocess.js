const TARGET_H = 96; // OCR için ROI bu yüksekliğe ölçeklenir
const PAD = 12; // Tesseract kenara yapışık karakterleri sevmez

// ---------- Eğim düzeltme ----------
// Telefon göstergeye açılı dururken rakamlar hem döner hem yatar (italik gibi). Düzeltme: önce dönme, sonra yatıklık
// (canvas: rotate, ardından transform(1,0,tan(shear),1,0,0); noktaya önce yatıklık, sonra dönme uygulanır).
// Otomatik: küçültülmüş görüntüdeki yazı pikselleri her (dönme, yatıklık) çifti için çevrilir; satır ve sütun
// izdüşüm histogramlarının kareler toplamı en büyük olan çift (yazı en dik/hizalı) seçilir.
const SKEW_H = 48;
const SKEW_MAX = 30; // derece
const SKEW_STEP = 2.5;
const scratch = document.createElement('canvas');
const rad = (d) => (d * Math.PI) / 180;

/** Gri değerlerden yazı piksellerinin (merkezli) koordinatları: Otsu eşiği, azınlık sınıfı = yazı. */
function inkPoints(g, w, h) {
  const hist = new Uint32Array(256);
  let sum = 0;
  for (let i = 0; i < g.length; i++) { hist[g[i]]++; sum += g[i]; }
  let wB = 0;
  let sB = 0;
  let best = -1;
  let thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = g.length - wB;
    if (!wF) break;
    sB += t * hist[t];
    const v = wB * wF * (sB / wB - (sum - sB) / wF) ** 2;
    if (v > best) { best = v; thr = t; }
  }
  let dark = 0;
  for (let i = 0; i < g.length; i++) if (g[i] <= thr) dark++;
  const inkDark = dark <= g.length / 2;
  const pts = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((g[y * w + x] <= thr) === inkDark) pts.push(x - w / 2, y - h / 2);
  return pts;
}

/** En iyi { rot, shear } (derece). Yeterli yazı yoksa { 0, 0 }. */
export function estimateSkew(pts, w, h) {
  if (pts.length < 40) return { rot: 0, shear: 0 };
  const R = Math.ceil(Math.hypot(w, h) * 1.5);
  const rows = new Int32Array(2 * R + 1);
  const cols = new Int32Array(2 * R + 1);
  let bestScore = -1;
  let best = { rot: 0, shear: 0 };
  for (let rd = -SKEW_MAX; rd <= SKEW_MAX; rd += SKEW_STEP) {
    const c = Math.cos(rad(rd));
    const s = Math.sin(rad(rd));
    for (let sd = -SKEW_MAX; sd <= SKEW_MAX; sd += SKEW_STEP) {
      const k = Math.tan(rad(sd));
      rows.fill(0);
      cols.fill(0);
      for (let i = 0; i < pts.length; i += 2) {
        const x = pts[i];
        const y = pts[i + 1];
        const x1 = x + k * y;
        rows[Math.round(x1 * s + y * c) + R]++;
        cols[Math.round(x1 * c - y * s) + R]++;
      }
      let score = 0;
      for (let i = 0; i < rows.length; i++) score += rows[i] * rows[i] + cols[i] * cols[i];
      score *= 1 - 0.0025 * (Math.abs(rd) + Math.abs(sd)); // eşit puanda eğimsiz olanı yeğle
      if (score > bestScore) { bestScore = score; best = { rot: rd, shear: sd }; }
    }
  }
  return best;
}

/**
 * <video> çerçevesindeki ROI'yi (video kutusunun 0..1 oranı) gerçek video piksellerine çevirir.
 * Video `object-fit: cover` ile gösterildiği için görünen kısım kırpılmış olabilir.
 */
export function roiToVideoRect(video, stage, roi) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  // Sekme gizliyken (display:none) kutunun ölçüsü 0 olur. Eşleme yalnızca en-boy oranına bağlıdır; kamera kutusu CSS'te
  // sabit 16:10 olduğu için gizliyken bu orana düş, böylece OCR başka sekmedeyken de çalışır.
  const hidden = !stage.clientWidth || !stage.clientHeight;
  const sw = hidden ? 160 : stage.clientWidth;
  const sh = hidden ? 100 : stage.clientHeight;
  const scale = Math.max(sw / vw, sh / vh);
  const dz = Number(video.dataset?.dz) || 1; // dijital yakınlaştırma: kutuda görünen alan ortadan küçülür
  const visW = sw / scale / dz;
  const visH = sh / scale / dz;
  const offX = (vw - visW) / 2;
  const offY = (vh - visH) / 2;
  return {
    sx: offX + roi.x * visW,
    sy: offY + roi.y * visH,
    sw: roi.w * visW,
    sh: roi.h * visH,
  };
}

/**
 * ROI'yi kırp → gri → kontrast → (koyu zemin ise ters çevir) → eşikle. Sonucu `canvas`a çizer.
 * Togg ekranında rakamlar genelde açık renk/koyu zemin; Tesseract koyu-yazı/açık-zemin tercih eder,
 * bu yüzden ortalama parlaklık düşükse görüntü otomatik ters çevrilir.
 * Dönüş: false = video hazır değil.
 */
export function preprocess(video, stage, opts, canvas) {
  if (!video.videoWidth || !video.videoHeight) return false;
  const { sx, sy, sw, sh } = roiToVideoRect(video, stage, opts.roi);
  if (sw < 4 || sh < 4) return false;

  // maxH verilirse ROI özgün yüksekliğinin `scale` katına (varsayılan 1) ölçeklenir, en çok maxH piksel; yoksa sabit hedef yükseklik.
  const h = opts.maxH ? Math.min(Math.round(sh * (opts.scale || 1)), opts.maxH) : opts.targetH || TARGET_H;
  const w = Math.max(16, Math.round((sw / sh) * h));
  canvas.width = w + PAD * 2;
  canvas.height = h + PAD * 2;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Eğim: otomatik (küçük görüntüden tahmin) ya da elle ayarlanan değerler
  let rot = 0;
  let shear = 0;
  if (opts.autoSkew) {
    const sh2 = SKEW_H;
    const sw2 = Math.max(16, Math.round((sw / sh) * sh2));
    scratch.width = sw2;
    scratch.height = sh2;
    const sctx = scratch.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw2, sh2);
    const px = sctx.getImageData(0, 0, sw2, sh2).data;
    const g = new Uint8Array(sw2 * sh2);
    for (let i = 0; i < g.length; i++) g[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    ({ rot, shear } = estimateSkew(inkPoints(g, sw2, sh2), sw2, sh2));
  } else if (opts.rot || opts.shear) {
    rot = opts.rot || 0;
    shear = opts.shear || 0;
  }
  canvas.dataset.skew = `${rot},${shear}`;

  if (rot || shear) {
    // Döndürülünce boş kalan köşeler yazı gibi görünmesin: kenar rengiyle doldur (görüntünün dört köşesinin ortalaması)
    ctx.drawImage(video, sx, sy, sw, sh, PAD, PAD, w, h);
    const e = ctx.getImageData(PAD, PAD, 1, 1).data;
    const f = ctx.getImageData(PAD + w - 1, PAD + h - 1, 1, 1).data;
    ctx.fillStyle = `rgb(${(e[0] + f[0]) >> 1},${(e[1] + f[1]) >> 1},${(e[2] + f[2]) >> 1})`;
    ctx.fillRect(PAD, PAD, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD, PAD, w, h);
    ctx.clip();
    ctx.translate(PAD + w / 2, PAD + h / 2);
    ctx.rotate(rad(rot));
    ctx.transform(1, 0, Math.tan(rad(shear)), 1, 0, 0);
    ctx.drawImage(video, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(video, sx, sy, sw, sh, PAD, PAD, w, h);
  }

  const img = ctx.getImageData(PAD, PAD, w, h);
  const d = img.data;
  const c = opts.contrast;

  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    g = Math.min(255, Math.max(0, (g - 128) * c + 128));
    d[i] = g;
    sum += g;
  }
  const invert = sum / (d.length / 4) < 128;

  for (let i = 0; i < d.length; i += 4) {
    let g = invert ? 255 - d[i] : d[i];
    if (opts.useThreshold) g = g >= opts.threshold ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = g;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, PAD, PAD);
  return true;
}
