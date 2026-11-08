// Rota sayfasında "Mevcut pil" sürgüsü: kamera/OCR okuması yoksa pil yüzdesi elle girilir. Değer, Manuel pil kalibrasyonuyla aynı
// yoldan geçer (canlı pil + OCR filtresinin referansı), bu yüzden HUD, plan ve navigasyon aynı değeri kullanır.
// Sürgü bırakılınca açık plan yeniden hesaplanır (ağ çağrısı yok).
import { getState, patch, subscribe, effective } from '../state.js';
import { setManual, manualLocked, socSource, DEFAULT_SOC } from '../physics/socEstimate.js';
import { t } from '../i18n/index.js';
import { setStartSoc } from '../routing/controller.js';

const $ = (id) => document.getElementById(id);

export function initSocInput() {
  const slider = $('cur-soc');
  const out = $('cur-soc-out');
  const note = $('cur-soc-note');
  let dragging = false;

  const paint = () => {
    const e = effective();
    const v = e.soc;
    const shown = v ?? DEFAULT_SOC; // kamera/okuma yoksa plan bunu varsayar (controller.planTrip ile aynı değer); sürgü de bunu gösterir
    if (!dragging) slider.value = Math.round(shown);
    out.textContent = '%' + Math.round(dragging ? Number(slider.value) : shown);
    const online = e.source !== 'sim' && manualLocked();
    slider.disabled = online; // kamera pili şu an canlı ve sorunsuz okuyorsa kilitli; kamera kapalıysa ya da "okunamadı" durumundaysa serbest
    const ocrOk = online;
    const src = socSource();
    note.textContent = e.source === 'sim' ? 'Test Modu: pil Test sekmesindeki değerdir.'
      : v == null ? 'Pil bilinmiyor: plan %80 varsayar. Sürgüyle gir.'
        : src === 'default' ? t('Pil bilgisi yok: %{0} varsayılıyor. Sürgüyle ayarla ya da kamerayla okut.', DEFAULT_SOC)
          : src === 'estimate' ? 'Son bilinen değerden tahmin ediliyor. Sürgüyle düzeltebilirsin.'
        : ocrOk ? 'Pil kameradan canlı okunuyor: elle ayar gerekmez (kamera durursa sürgü açılır).'
          : getState('engine').socSrc === 'manual' ? 'Elle girildi: yol alındıkça tüketim modeliyle düşer, kamera okuyunca düzelir.'
            : 'Son okunan değer.';
  };

  slider.addEventListener('input', () => {
    dragging = true;
    const v = Number(slider.value);
    out.textContent = '%' + v;
    if (getState('sim').enabled) patch('sim', { soc: v });
    else setManual(v); // yol alındıkça düşer, kamera okuyunca o değer geçerli olur
  });
  slider.addEventListener('change', () => {
    dragging = false;
    setStartSoc(Number(slider.value));
    paint();
  });

  subscribe(['live', 'sim', 'ocr', 'system'], paint);
  paint();
}
