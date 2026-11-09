// İstasyonlar ekranındaki "En az şarj gücü (kW)" süzgeci: yalnızca listeleri (Rotadakiler, Yakındakiler) süzer,
// rota planını ve düşük pil önerisini değiştirmez. Seçili değere tekrar dokunmak süzgeci kaldırır (0 = süzgeç yok).
import { load, save } from '../utils/storage.js';

export const POWER_STEPS = [22, 60, 120, 150, 180];
let min = POWER_STEPS.includes(load('listMinKw', 0)) ? load('listMinKw', 0) : 0;

export const getListMinKw = () => min;
/** İstasyon seçili en az güce uyuyor mu (süzgeç yoksa hep evet). */
export const powerListOk = (s) => !min || s.kw >= min;

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
