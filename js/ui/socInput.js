// Rota sayfasında "Mevcut pil" sürgüsü: kamera/OCR okuması yoksa pil yüzdesi elle girilir. Değer, Manuel pil kalibrasyonuyla aynı
// yoldan geçer (canlı pil + OCR filtresinin referansı), bu yüzden HUD, plan ve navigasyon aynı değeri kullanır.
// Sürgü bırakılınca açık plan yeniden hesaplanır (ağ çağrısı yok).
import { getState, patch, subscribe, effective } from '../state.js';
import { setManual } from '../physics/socEstimate.js';
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
    if (!dragging && v != null) slider.value = Math.round(v);
    out.textContent = v == null ? '—' : '%' + Math.round(dragging ? Number(slider.value) : v);
    const ocrOk = getState('system').ocr && getState('ocr').status === 'ok';
    note.textContent = e.source === 'sim' ? 'Test Modu: pil Test sekmesindeki değerdir.'
      : v == null ? 'Pil bilinmiyor: plan %80 varsayar. Sürgüyle gir.'
        : ocrOk ? 'Kamera okuyor: okunan değer geçerli. Elle girersen bir sonraki okuma bunu geçersiz kılar.'
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
