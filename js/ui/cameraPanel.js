import { getState, patch, subscribe } from '../state.js';
import { persistCamera } from './roiBox.js';
import { startCamera, stopCamera } from '../sensors/camera.js';
import { startOcr, stopOcr, calibrateSoc, startPreview, stopPreview } from '../sensors/ocr.js';
import { toast } from './toast.js';

const STATUS_TEXT = {
  idle: '—', loading: 'Yükleniyor', ok: 'Geçerli', rejected: 'Reddedildi',
  unreadable: 'Okunamadı', manual: 'Manuel', error: 'Hata',
};

/** Kamera sekmesi: önizleme, OCR başlat/durdur, eşik/kontrast ayarları, manuel +/- kalibrasyon. */
export function initCameraPanel() {
  const $ = (id) => document.getElementById(id);
  const video = $('cam-video');
  const stage = $('cam-stage');
  const camBtn = $('btn-cam');
  const ocrBtn = $('btn-ocr');
  const thrOn = $('ocr-thr-on');
  const contrast = $('ocr-contrast');
  const threshold = $('ocr-threshold');

  camBtn.addEventListener('click', async () => {
    if (getState('system').camera) {
      stopOcr();
      stopPreview();
      stopCamera(video);
      patch('system', { camera: false });
      return;
    }
    try {
      await startCamera(video);
      patch('system', { camera: true });
      startPreview(video, stage, $('ocr-preview'));
    } catch (err) {
      toast('Kamera açılamadı: ' + (err.message || err.name));
    }
  });

  ocrBtn.addEventListener('click', async () => {
    if (getState('system').ocr) return stopOcr();
    try {
      await startOcr(video, stage);
    } catch (err) {
      toast(err.message);
    }
  });

  subscribe('system', (s) => {
    camBtn.textContent = s.camera ? '⏹ Kamerayı Durdur' : '📷 Kamerayı Başlat';
    $('cam-empty').classList.toggle('hidden', s.camera);
    ocrBtn.disabled = !s.camera;
    ocrBtn.textContent = s.ocr ? '⏹ OCR Durdur' : '🔍 OCR Başlat';
    ocrBtn.classList.toggle('sel', s.ocr);
  });
  patch('system', {}); // düğme metinlerini ilk kez boya

  // Filtre ayarları
  const o = getState('ocr');
  thrOn.checked = o.useThreshold;
  contrast.value = o.contrast;
  threshold.value = o.threshold;
  $('ocr-contrast-out').textContent = o.contrast.toFixed(1) + '×';
  $('ocr-threshold-out').textContent = o.threshold;

  const persist = persistCamera;
  const speedOn = $('ocr-speed-on');
  speedOn.checked = o.speedOn;
  speedOn.addEventListener('change', () => { patch('ocr', { speedOn: speedOn.checked }); persist(); });
  thrOn.addEventListener('change', () => { patch('ocr', { useThreshold: thrOn.checked }); persist(); });
  contrast.addEventListener('input', () => {
    patch('ocr', { contrast: Number(contrast.value) });
    $('ocr-contrast-out').textContent = Number(contrast.value).toFixed(1) + '×';
    persist();
  });
  threshold.addEventListener('input', () => {
    patch('ocr', { threshold: Number(threshold.value) });
    $('ocr-threshold-out').textContent = threshold.value;
    persist();
  });

  // Manuel pil kalibrasyonu: gerçek sensör değerini (live.soc) ±1 değiştirir ve outlier referansını sıfırlar.
  const bump = (d) => {
    if (getState('sim').enabled) return toast('Test Modu açık — pili Test sekmesinden değiştir');
    const cur = getState('live').soc;
    const next = Math.min(100, Math.max(0, (cur ?? 50) + d));
    calibrateSoc(next);
    patch('live', { soc: next });
    patch('ocr', { accepted: next, status: 'manual' });
  };
  $('soc-plus').addEventListener('click', () => bump(1));
  $('soc-minus').addEventListener('click', () => bump(-1));

  const paintOcr = (s) => {
    $('ocr-raw').textContent = s.raw == null ? '--' : s.raw;
    $('ocr-ok').textContent = s.accepted == null ? '--' : s.accepted;
    $('ocr-state').textContent = STATUS_TEXT[s.status] || s.status;
    $('ocr-speed-read').textContent = !s.speedOn
      ? 'kapalı'
      : `${s.rawSpeed == null ? '--' : s.rawSpeed} km/h · ${STATUS_TEXT[s.speedStatus] || s.speedStatus}`;
  };
  subscribe('ocr', paintOcr);
  paintOcr(getState('ocr'));
}
