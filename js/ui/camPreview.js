// iOS Safari'de yerel video katmanı kaydırma sırasında kutudan küçük çizilebiliyor (DOM ölçüleri doğru kaldığı için koddan algılanamıyor).
// iOS'ta önizleme, OCR'ın okuduğu kare ve aynı koordinat eşlemesiyle üst tuvale çizilir; video elemanı altta oynamaya devam eder.
// Akışa, lense, zoom'a dokunmaz. Tuval çizilemezse şeffaf/gizli kalır ve alttaki video görünür.
import { roiToVideoRect } from '../sensors/preprocess.js';

const FRAME_MS = 66;
const FULL = { x: 0, y: 0, w: 1, h: 1 };
let stopLoop = null;

export const needsMirror = (nav = navigator) => /iPad|iPhone|iPod/.test(nav.userAgent || '') || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
export const mirrorActive = () => !!stopLoop;

export function stopCamPreview() {
  stopLoop?.();
  stopLoop = null;
}

export function startCamPreview(video, stage, canvas) {
  stopCamPreview();
  if (!needsMirror()) return;
  const ctx = canvas.getContext('2d', { alpha: false });
  let raf = 0;
  let last = 0;
  const draw = (now) => {
    raf = requestAnimationFrame(draw);
    if (now - last < FRAME_MS || document.hidden || !stage.offsetParent || video.readyState < 2 || !video.videoWidth) return;
    last = now;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(stage.clientWidth * dpr);
    const h = Math.round(stage.clientHeight * dpr);
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const r = roiToVideoRect(video, stage, FULL); // dijital zoom dahil, OCR ile aynı eşleme
    ctx.drawImage(video, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h);
    canvas.classList.add('on');
  };
  raf = requestAnimationFrame(draw);
  stopLoop = () => {
    cancelAnimationFrame(raf);
    canvas.classList.remove('on');
  };
}
