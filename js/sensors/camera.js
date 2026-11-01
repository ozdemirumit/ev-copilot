let stream = null;
let track = null;
let hw = null; // cihaz donanım zoom'u destekliyorsa { min, max, step }

/** Arka kamerayı video elemanına bağlar. Güvenli bağlam (HTTPS/localhost) gerekir. */
export async function startCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Kamera API yok (HTTPS gerekli olabilir)');
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  track = stream.getVideoTracks()[0] || null;
  const z = track?.getCapabilities?.().zoom;
  hw = z && z.max > z.min ? { min: z.min, max: z.max, step: z.step || 0.1 } : null;
  resetView(video);
  video.srcObject = stream;
  await video.play().catch(() => {});
}

export function stopCamera(video) {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  track = null;
  hw = null;
  video.srcObject = null;
  resetView(video);
}

function resetView(video) {
  video.dataset.dz = '1';
  video.style.transform = '';
}

/**
 * Yakınlaştırma aralığı: cihaz donanım zoom'u veriyorsa o (netlik bozulmaz, OCR aynı kalır), yoksa 1-4× dijital
 * (görüntü kutuda büyütülür, OCR kırpması buna göre eşlenir: sensors/preprocess.js `data-dz`).
 */
export function zoomRange() {
  return hw ? { min: hw.min, max: Math.min(hw.max, 8), step: hw.step, hardware: true } : { min: 1, max: 4, step: 0.1, hardware: false };
}

export async function setZoom(video, z) {
  if (hw && track) {
    await track.applyConstraints({ advanced: [{ zoom: z }] });
    resetView(video);
  } else {
    video.dataset.dz = String(z);
    video.style.transform = `scale(${z})`;
  }
}
