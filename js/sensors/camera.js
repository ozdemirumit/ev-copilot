let stream = null;
let track = null;
let hw = null; // cihaz donanım zoom'u destekliyorsa { min, max, step }

/** Arka kamerayı video elemanına bağlar. Güvenli bağlam (HTTPS/localhost) gerekir. */
const BACK = /back|rear|environment|arka/i;
const WIDE = /ultra|wide|geni[sş]|0[.,]5/i;
const TELE = /tele|zoom|macro/i;

/**
 * Arka kameralar arasından en geniş açılıyı seç (etiketten: "Ultra Wide", "0.5x" vb.). Etiket yoksa ya da böyle bir kamera yoksa null.
 * Zaten kullanılan kameraysa da null (yeniden açmaya gerek yok).
 */
export function pickWideDevice(devices, currentId) {
  const cams = (devices || []).filter((d) => d && d.kind === 'videoinput' && d.deviceId && d.label);
  const back = cams.filter((d) => BACK.test(d.label));
  const wide = (back.length ? back : cams).filter((d) => WIDE.test(d.label) && !TELE.test(d.label));
  const pick = wide[0] || null;
  return pick && pick.deviceId !== currentId ? pick : null;
}

/** Arka kamerayı video elemanına bağlar. Varsa en geniş açılı arka kamera seçilir. Güvenli bağlam (HTTPS/localhost) gerekir. */
export async function startCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Kamera API yok (HTTPS gerekli olabilir)');
  const base = { width: { ideal: 1280 }, height: { ideal: 720 } };
  stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, ...base }, audio: false });
  // İzin verildikten sonra kamera etiketleri görünür: daha geniş açılı bir arka kamera varsa ona geç (olmazsa ilk akış kalır)
  try {
    const cur = stream.getVideoTracks()[0]?.getSettings?.().deviceId;
    const wide = pickWideDevice(await navigator.mediaDevices.enumerateDevices(), cur);
    if (wide) {
      const s2 = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: wide.deviceId }, ...base }, audio: false });
      stream.getTracks().forEach((t) => t.stop());
      stream = s2;
    }
  } catch { /* geniş açılı kamera açılamadı: ilk akışla devam */ }
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
