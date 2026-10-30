const TARGET_H = 96; // OCR için ROI bu yüksekliğe ölçeklenir
const PAD = 12; // Tesseract kenara yapışık karakterleri sevmez

/**
 * <video> çerçevesindeki ROI'yi (video kutusunun 0..1 oranı) gerçek video piksellerine çevirir.
 * Video `object-fit: cover` ile gösterildiği için görünen kısım kırpılmış olabilir.
 */
export function roiToVideoRect(video, stage, roi) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const sw = stage.clientWidth;
  const sh = stage.clientHeight;
  const scale = Math.max(sw / vw, sh / vh);
  const visW = sw / scale;
  const visH = sh / scale;
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

  const h = TARGET_H;
  const w = Math.max(16, Math.round((sw / sh) * h));
  canvas.width = w + PAD * 2;
  canvas.height = h + PAD * 2;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(video, sx, sy, sw, sh, PAD, PAD, w, h);

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
