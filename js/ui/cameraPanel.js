import { getState, patch, subscribe } from '../state.js';
import { load, save } from '../utils/storage.js';
import { persistCamera } from './roiBox.js';
import { startCamera, stopCamera, zoomRange, setZoom } from '../sensors/camera.js';
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

  // Yakınlaştırma: donanım zoom'u varsa o, yoksa dijital. Seçim hatırlanır.
  const zoom = $('cam-zoom');
  const zoomOut = $('cam-zoom-out');
  const paintZoom = () => { zoomOut.textContent = Number(zoom.value).toFixed(1) + '×'; };
  async function applyZoom() {
    paintZoom();
    try { await setZoom(video, Number(zoom.value)); } catch (err) { toast('Yakınlaştırma uygulanamadı: ' + (err.message || err.name)); }
  }
  async function setupZoom() {
    const r = zoomRange();
    zoom.min = r.min; zoom.max = r.max; zoom.step = r.step;
    zoom.value = Math.min(r.max, Math.max(r.min, load('camZoom', 1)));
    $('cam-zoom-kind').textContent = r.hardware ? 'kamera zoom\'u' : 'dijital (netlik azalır)';
    await applyZoom();
  }
  zoom.addEventListener('input', () => { save('camZoom', Number(zoom.value)); applyZoom(); });

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
      await setupZoom();
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
    zoom.disabled = !s.camera;
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

  // Eğim düzeltme: otomatik (varsayılan) ya da elle dönme/yatıklık; önizleme kutusu sonucu gösterir
  const skewAuto = $('ocr-skew-auto');
  const rot = $('ocr-rot');
  const shear = $('ocr-shear');
  const paintSkew = () => {
    $('ocr-rot-out').textContent = rot.value + '°';
    $('ocr-shear-out').textContent = shear.value + '°';
    rot.disabled = shear.disabled = skewAuto.checked;
  };
  skewAuto.checked = o.autoSkew;
  rot.value = o.rot;
  shear.value = o.shear;
  paintSkew();
  skewAuto.addEventListener('change', () => { patch('ocr', { autoSkew: skewAuto.checked }); paintSkew(); persist(); });
  rot.addEventListener('input', () => { patch('ocr', { rot: Number(rot.value) }); paintSkew(); persist(); });
  shear.addEventListener('input', () => { patch('ocr', { shear: Number(shear.value) }); paintSkew(); persist(); });
  setInterval(() => {
    const [r, s] = ($('ocr-preview').dataset.skew || '0,0').split(',').map(Number);
    $('ocr-skew-read').textContent = !getState('system').camera ? '' : skewAuto.checked ? `Algılanan eğim: dönme ${r}°, yatıklık ${s}°` : `Uygulanan: dönme ${r}°, yatıklık ${s}°`;
  }, 700);
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
    patch('ocr', { accepted: next, status: 'manual', lastOkAt: Date.now() });
  };
  $('soc-plus').addEventListener('click', () => bump(1));
  $('soc-minus').addEventListener('click', () => bump(-1));

  const paintOcr = (s) => {
    $('ocr-raw').textContent = s.raw == null ? '--' : s.raw;
    $('ocr-ok').textContent = s.accepted == null ? '--' : s.accepted;
    $('ocr-state').textContent = STATUS_TEXT[s.status] || s.status;
    $('ocr-err').textContent = s.error ? 'OCR hatası: ' + s.error : '';
    $('ocr-err').classList.toggle('hidden', !(s.status === 'error' && s.error));
    $('ocr-speed-read').textContent = !s.speedOn
      ? 'kapalı'
      : `${s.rawSpeed == null ? '--' : s.rawSpeed} km/h · ${STATUS_TEXT[s.speedStatus] || s.speedStatus}`;
  };
  subscribe('ocr', paintOcr);
  paintOcr(getState('ocr'));

  // ---------- Açılışta kamerayı ve OCR'ı otomatik başlat ----------
  // Sürüşte telefon yeniden açıldığında okumanın kendiliğinden sürmesi için. Kamera izni zaten verilmişse çalışır
  // (izin sorusu çıkarmaz); izin yoksa veya Test Modu açıksa hiçbir şey yapmaz.
  const auto = $('ocr-auto');
  auto.checked = load('autoOcr', false);
  auto.addEventListener('change', () => { save('autoOcr', auto.checked); if (auto.checked) autoStart(); }); // açınca hemen de başlat

  async function autoStart() {
    if (!auto.checked || getState('sim').enabled) return;
    try {
      const perm = await navigator.permissions.query({ name: 'camera' });
      if (perm.state !== 'granted') return;
    } catch { return; } // izin API'si yok: sormadan başlatma
    camBtn.click();
    for (let i = 0; i < 40 && !getState('system').camera; i++) await new Promise((r) => setTimeout(r, 150));
    if (getState('system').camera && !getState('system').ocr) ocrBtn.click();
  }
  autoStart();
}
