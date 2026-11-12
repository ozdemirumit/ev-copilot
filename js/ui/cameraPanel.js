import { getState, patch, subscribe } from '../state.js';
import { load, save, remove } from '../utils/storage.js';
import { persistCamera } from './roiBox.js';
import { startCamera, stopCamera, zoomInfo, legacyZoomRoi, onCameraStatus, cameraDiag } from '../sensors/camera.js';
import { invalidateSkew, roiToVideoRect } from '../sensors/preprocess.js';
import { startOcr, stopOcr, startPreview, stopPreview, setOcrEngine } from '../sensors/ocr.js';
import { startCamPreview, stopCamPreview, mirrorActive } from './camPreview.js';
import { setManual, manualLocked } from '../physics/socEstimate.js';
import { toast } from './toast.js';
import { t } from '../i18n/index.js';

const STATUS_TEXT = {
  idle: '—', loading: 'Yükleniyor', ok: 'Geçerli', rejected: 'Reddedildi',
  unreadable: 'Okunamadı', manual: 'Manuel', error: 'Hata', verifying: 'Doğrulanıyor', paused: 'Duraklatıldı',
};
const HEALTH_TEXT = {
  off: 'Kapalı', live: 'Canlı', muted: 'Görüntü duraklatıldı', ended: 'Kapandı', recovering: 'Yeniden açılıyor', lost: 'Kayboldu',
};
const METHOD_TEXT = { label: 'en geniş açılı', facing: 'varsayılan arka', fallback: 'geri dönüldü' };
const REASON_TEXT = {
  range: 'Aralık dışı', 'low-score': 'Güven skoru düşük', verifying: 'Doğrulanıyor', jump: 'Fiziksel olmayan sıçrama',
  fragment: 'Hane kaybı şüphesi', recovering: 'Eksik değerden dönüş doğrulanıyor', truncated: 'Hane eksik okundu',
  'extra-digit': 'Fazla hane okundu', flat: 'Görüntü düz veya siyah', glare: 'Parlama', 'low-confidence': 'Motor güveni düşük',
  'no-consensus': 'Kareler uyuşmadı', 'no-digits': 'Rakam bulunamadı', confirming: 'Yeni değer teyit ediliyor',
};
const RESULT_TEXT = { ok: 'Geçerli', confirmed: 'Teyit edildi, geçerli', first: 'İlk değer geçerli', resync: 'Yeniden eşitlendi', recovered: 'Geri alındı', paused: 'Arka planda duraklatıldı', resumed: 'Ön plana dönüldü', restarted: 'Döngü yeniden başlatıldı' };
const ENGINE_TEXT = { tess: 'OCR 1', digit: 'OCR 2' };

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

  // Yakınlaştırma ayarı yok: kamera en geniş görüşte sabittir (camera.js). Eski sürümlerin kayıtlı yakınlaştırması (camZoom) bir kez
  // ROI'ye çevrilir (dijitalse kesin eşleme) ya da ROI korunup yeniden ayar istenir (donanım zoom'u güvenli eşlenemez); sonra silinir.
  function migrateLegacyZoom() {
    const saved = load('camZoom', null);
    if (saved == null) return;
    const z = zoomInfo();
    const o = getState('ocr');
    const res = legacyZoomRoi(saved, { roi: o.roi, roiSpeed: o.roiSpeed }, { hardware: z.hardware, hwMin: z.min });
    if (res.changed) { patch('ocr', res.rois); persistCamera(); }
    remove('camZoom');
    if (res.recalibrate) toast('Kamera artık en geniş görüşte sabit. Okuma kutusunu (ROI) ekrandaki rakamlara göre yeniden ayarlayın.');
    else if (res.changed) toast('Kamera artık en geniş görüşte sabit; okuma kutusu buna göre uyarlandı.');
  }

  camBtn.addEventListener('click', async () => {
    if (getState('system').camera) {
      stopOcr();
      stopPreview();
      stopCamPreview();
      stopCamera(video);
      patch('system', { camera: false });
      return;
    }
    try {
      await startCamera(video);
      invalidateSkew();
      migrateLegacyZoom();
      patch('system', { camera: true });
      startPreview(video, stage, $('ocr-preview'));
      startCamPreview(video, stage, $('cam-mirror'));
    } catch (err) {
      toast('Kamera açılamadı: ' + (err.message || err.name));
    }
  });

  // Kamera akışı kendiliğinden kapanırsa camera.js aynı kamerayı yeniden açar; olmazsa kamera durumu kapatılır
  onCameraStatus((event) => {
    if (event === 'recovered') {
      invalidateSkew();
    } else if (event === 'lost') {
      stopOcr();
      stopPreview();
      stopCamPreview();
      stopCamera(video);
      patch('system', { camera: false });
      toast('Kamera bağlantısı kesildi, yeniden açılamadı');
    }
    paintDiag();
  });

  ocrBtn.addEventListener('click', async () => {
    if (getState('system').ocr) return stopOcr();
    try {
      patch('ocr', { readCount: 0, readings: [], trace: [], rejected: null, reason: null }); // sayaç bu OCR oturumunu gösterir
      await startOcr(video, stage);
    } catch (err) {
      toast(err.message);
    }
  });

  // Video kaynağı boyut değiştirirse (döndürme, yeniden yapılandırma) eğim önbelleği eskir; iOS kesintiden sonra videoyu duraklatırsa akış değiştirilmeden sürdürülür
  video.addEventListener('resize', invalidateSkew);
  video.addEventListener('pause', () => { if (getState('system').camera && !document.hidden) video.play().catch(() => {}); });

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
    if (manualLocked()) return toast('Pil kameradan canlı okunuyor: elle ayar gerekmez'); // kamera sorunsuz okuyorsa değer değiştirilemez; kapalıysa ya da okuyamıyorsa serbest
    const cur = getState('live').soc;
    const next = Math.min(100, Math.max(0, (cur ?? 50) + d));
    setManual(next); // yol alındıkça düşer, kamera okuyunca o değer geçerli olur
  };
  $('soc-plus').addEventListener('click', () => bump(1));
  $('soc-minus').addEventListener('click', () => bump(-1));

  document.querySelectorAll('[data-ocr-engine]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await setOcrEngine(b.dataset.ocrEngine);
      persist();
    } catch (err) {
      toast(err.message);
    }
  }));

  const timeOf = (at) => (at ? new Date(at).toLocaleTimeString() : '--');
  const paintOcr = (s) => {
    document.querySelectorAll('[data-ocr-engine]').forEach((b) => b.classList.toggle('sel', b.dataset.ocrEngine === s.engine));
    $('ocr-last').textContent = `${timeOf(s.lastReadAt)} · ${t('{0} okuma', s.readCount || 0)}`;
    $('ocr-stale').classList.toggle('hidden', !(s.stale && s.accepted != null && s.status !== 'manual'));
    $('ocr-raw').textContent = s.raw == null ? '--' : s.raw;
    $('ocr-ok').textContent = s.accepted == null ? '--' : s.accepted;
    $('ocr-ok').style.opacity = s.stale && s.accepted != null && s.status !== 'manual' ? '0.55' : ''; // son doğrulanmış değer duruyor ama bu çevrimde doğrulanmadı
    $('ocr-state').textContent = STATUS_TEXT[s.status] || s.status;
    $('ocr-err').textContent = s.error ? 'OCR hatası: ' + s.error : '';
    $('ocr-err').classList.toggle('hidden', !(s.status === 'error' && s.error));
    $('ocr-speed-read').textContent = !s.speedOn
      ? 'kapalı'
      : `${s.rawSpeed == null ? '--' : s.rawSpeed} km/h · ${STATUS_TEXT[s.speedStatus] || s.speedStatus}`;
  };
  subscribe('ocr', paintOcr);
  paintOcr(getState('ocr'));

  // Tanılama kartı: son doğrulanmış değerler, okuma zamanı, güvenilirlik, stale durumu ve kamera/tarayıcı sınırlamaları
  function paintDiag() {
    const s = getState('ocr');
    const live = getState('live');
    const diag = cameraDiag();
    $('diag-soc').textContent = s.accepted == null ? '--' : `%${s.accepted}`;
    $('diag-speed').textContent = live.speedScr == null ? '--' : `${live.speedScr} km/h${s.speedOn && s.speedStale ? ' (eski)' : ''}`;
    $('diag-read-at').textContent = s.readAt ? `${new Date(s.readAt).toLocaleTimeString()} (${Math.max(0, Math.round((Date.now() - s.readAt) / 1000))} sn önce)` : '--';
    $('diag-reliability').textContent = s.readAt || s.reliability ? `%${s.reliability}` : '--';
    const age = s.readAt ? Math.max(0, Math.round((Date.now() - s.readAt) / 1000)) : null;
    $('diag-stale').textContent = !getState('system').ocr ? 'OCR kapalı' : s.status === 'manual' ? 'Elle girildi' : s.stale ? `Eski (doğrulanmadı${age != null ? ` · geçerli değer ${age} sn önce` : ''})` : 'Güncel';
    $('diag-decision').textContent = decisionText(s.trace?.[0]);
    const parts = [diag.label || 'Arka kamera', HEALTH_TEXT[diag.health] || diag.health];
    if (METHOD_TEXT[diag.method]) parts.push(METHOD_TEXT[diag.method]);
    $('diag-camera').textContent = getState('system').camera ? parts.join(' · ') : HEALTH_TEXT.off;
    const notes = [s.note, diag.note, diag.unsupported.length && getState('system').camera ? `Bu tarayıcıda desteklenmiyor: ${diag.unsupported.join(', ')}` : ''];
    $('diag-note').textContent = notes.filter(Boolean).join(' · ');
    const rej = s.rejected;
    $('diag-reject').textContent = rej ? `${timeOf(rej.at)} · ${rej.value ?? '--'} · ${REASON_TEXT[rej.reason] || rej.reason}${rej.need ? ` (${rej.count}/${rej.need})` : ''}` : '--';
    $('diag-geom').textContent = video.videoWidth && stage.clientWidth ? geometryText(s) : '--';
    paintReadings(s.readings || []);
  }

  // Son pil kararı: kareler → çevrim/pencere adayı → filtre sonucu → geçerli değer (ham değer neden SOC olmadı, burada görünür)
  function decisionText(e) {
    if (!e) return '--';
    if (e.kind === 'lifecycle') return `${timeOf(e.at)} · ${RESULT_TEXT[e.result] || e.result}${e.gapSec != null ? ` (${e.gapSec} sn)` : ''}`;
    const parts = [timeOf(e.at), `kareler ${e.frames.join('/') || '-'}`];
    if (e.via === 'window') parts.push(`çevrimler arası ${e.candidate} (%${e.window.share}, ${e.window.cycles} çevrim)`);
    else if (e.via === 'cycle') parts.push(`çevrim ${e.candidate}`);
    else if (e.window?.raw != null) parts.push(`pencere ${e.window.raw} yetersiz (%${e.window.share}, ${e.window.cycles} çevrim)`);
    const res = RESULT_TEXT[e.result] || REASON_TEXT[e.result] || e.result;
    parts.push(e.need ? `${res} (${e.count}/${e.need})` : res);
    parts.push(`geçerli ${e.accepted ?? '--'}`);
    return parts.join(' · ');
  }

  function geometryText(s) {
    const r = roiToVideoRect(video, stage, s.roi);
    const crop = [r.sx, r.sy, r.sw, r.sh].map(Math.round);
    return `Kutu ${stage.clientWidth}×${stage.clientHeight} · video kutusu ${video.offsetWidth}×${video.offsetHeight} · kaynak ${video.videoWidth}×${video.videoHeight} · kırpma ${crop[0]},${crop[1]} ${crop[2]}×${crop[3]} px${mirrorActive() ? ' · tuval yansıtma' : ''}`;
  }

  // Satırlar her saniye yeniden kurulmasın (seçim/ekran okuyucu kaymasın): yalnızca liste değişince
  let readingsDrawn = null;
  function paintReadings(list) {
    if (list === readingsDrawn) return;
    readingsDrawn = list;
    $('diag-readings').replaceChildren(...list.map((e) => {
      const li = document.createElement('li');
      // Saat ayrı ve kalın: satırlar bir bakışta zamana göre taranır
      const time = document.createElement('b');
      time.textContent = timeOf(e.at);
      const parts = [ENGINE_TEXT[e.engine] || e.engine, `"${e.text}"`];
      if (e.value != null) parts.push(`→ ${e.value}`);
      if (e.confidence) parts.push(`%${e.confidence}`);
      if (e.digits != null) parts.push(`${e.digits} hane`);
      if (e.alt) parts.push(`OCR 2: "${e.alt.text}" %${e.alt.confidence}`);
      if (e.reason) parts.push(REASON_TEXT[e.reason] || e.reason);
      if (e.clipped) parts.push('Rakam kutu kenarında');
      li.append(time, ' ' + parts.join(' · '));
      return li;
    }));
  }
  subscribe(['ocr', 'system'], paintDiag);
  paintDiag();
  setInterval(paintDiag, 1000);

  // ---------- Açılışta kamerayı ve OCR'ı otomatik başlat ----------
  // Sürüşte telefon yeniden açıldığında okumanın kendiliğinden sürmesi için. Kamera izni zaten verilmişse çalışır
  // (izin sorusu çıkarmaz); izin yoksa veya Test Modu açıksa hiçbir şey yapmaz.
  const auto = $('ocr-auto');
  auto.checked = load('autoOcr', false);
  auto.addEventListener('change', () => { save('autoOcr', auto.checked); if (auto.checked) autoStart(); }); // açınca hemen de başlat

  async function autoStart() {
    if (!auto.checked || getState('sim').enabled || !document.body.classList.contains('is-premium')) return; // kamera Premium'a özel
    try {
      const perm = await navigator.permissions.query({ name: 'camera' });
      if (perm.state !== 'granted') return;
    } catch { return; } // izin API'si yok: sormadan başlatma
    camBtn.click();
    for (let i = 0; i < 40 && !getState('system').camera; i++) await new Promise((r) => setTimeout(r, 150));
    if (getState('system').camera && !getState('system').ocr) ocrBtn.click();
  }
  autoStart();
  document.addEventListener('plan-changed', () => { if (!getState('system').camera) autoStart(); }); // plan sunucudan gelince (Premium doğrulanınca) otomatik başlat
}
