// İstasyonlar ekranındaki "En az şarj gücü (kW)" süzgeci: yalnızca listeleri (Rotadakiler, Yakındakiler) süzer,
// rota planını ve düşük pil önerisini değiştirmez. Seçili değere tekrar dokunmak süzgeci kaldırır (0 = süzgeç yok).
import { load, save } from '../utils/storage.js';
import { t } from '../i18n/index.js';

export const POWER_STEPS = [22, 60, 120, 150, 180];
let min = POWER_STEPS.includes(load('listMinKw', 0)) ? load('listMinKw', 0) : 0;

/**
 * Uygun istasyon yoksa süzgeci bir basamak gevşetir: seçilen değerden başlayıp 150 → 120 → 60 → 22 → (süzgeçsiz) diye iner,
 * istasyon bulunan ilk basamakta durur. countAt(v): en az v kW için kaç istasyon var. Hiç istasyon yoksa değişmez.
 * Dönüş: { min: uygulanacak değer, from: seçilen değer, loosened: gevşetildi mi }
 */
export function loosenPower(countAt) {
  const from = min;
  if (!from || countAt(from) > 0) return { min: from, from, loosened: false };
  for (const v of [...POWER_STEPS].filter((x) => x < from).reverse().concat(0)) {
    if (countAt(v) > 0) return { min: v, from, loosened: true };
  }
  return { min: from, from, loosened: false };
}

/** Gevşetme notunu (yazı) gösterir; gevşetilmediyse gizler. */
export function paintPowerNote(el, info) {
  if (!el) return;
  const msg = info?.loosened
    ? (info.min ? t('En az {0} kW için uygun istasyon yok; filtre gevşetildi: en az {1} kW gösteriliyor.', info.from, info.min)
      : t('En az {0} kW için uygun istasyon yok; filtre gevşetildi: tüm güçler gösteriliyor.', info.from))
    : '';
  el.textContent = msg;
  el.classList.toggle('hidden', !msg);
}

export function setListMinKw(v) {
  min = POWER_STEPS.includes(v) ? v : 0;
  save('listMinKw', min);
  document.dispatchEvent(new CustomEvent('powerfilter', { detail: min }));
}

export function initPowerFilter() {
  const btns = [...document.querySelectorAll('#list-min-kw [data-listkw]')];
  const paint = () => btns.forEach((b) => {
    const on = Number(b.dataset.listkw) === min;
    b.classList.toggle('sel', on);
    b.setAttribute('aria-pressed', String(on));
  });
  btns.forEach((b) => b.addEventListener('click', () => {
    const v = Number(b.dataset.listkw);
    setListMinKw(v === min ? 0 : v);
    paint();
  }));
  paint();
}
