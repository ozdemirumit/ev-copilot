let stream = null;

/** Arka kamerayı video elemanına bağlar. Güvenli bağlam (HTTPS/localhost) gerekir. */
export async function startCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Kamera API yok (HTTPS gerekli olabilir)');
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play().catch(() => {});
}

export function stopCamera(video) {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
}
