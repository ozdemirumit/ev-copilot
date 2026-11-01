// Karartma modu (pil tasarrufu): navigasyondayken belli süre dokunulmazsa ekran tam siyaha döner (OLED'de siyah piksel ışık
// harcamaz); yalnızca dönüş oku, mesafe, hız ve varış silik renkle görünür, harita çizimi durur. Dokununca uyanır.
// Telefonun parlaklığı web'den değiştirilemez; LCD ekranlarda kazanç sınırlıdır.
import { getState, subscribe } from '../state.js';
import { load, save } from '../utils/storage.js';
import { mapApi } from './mapView.js';

const $ = (id) => document.getElementById(id);

export function initDimmer() {
  const dim = $('dimmer');
  const btn = $('fab-dim');
  const auto = $('dim-auto');
  const delay = $('dim-delay');
  const delayOut = $('dim-delay-out');
  let on = false;
  let idleTimer = null;
  let loop = null;

  auto.checked = load('dimAuto', true);
  delay.value = load('dimDelay', 45);
  const paintDelay = () => { delayOut.textContent = delay.value + ' sn'; delay.disabled = !auto.checked; };
  paintDelay();

  const text = (id) => $(id)?.textContent || '';
  const paintDim = () => {
    $('dim-arrow').textContent = text('nav-arrow');
    $('dim-dist').textContent = text('nav-dist');
    $('dim-text').textContent = text('nav-text');
    $('dim-speed').textContent = text('nh-speed');
    $('dim-eta').textContent = `${text('nh-eta')} · ${text('nh-rem')}`;
    const warn = ['road-alert', 'near-alert-body'].map((id) => $(id)).find((x) => x && x.offsetParent && x.textContent.trim());
    $('dim-warn').textContent = warn ? '⚠ ' + warn.textContent.trim().slice(0, 120) : '';
  };

  function dimNow() {
    if (on || !getState('nav').active) return;
    on = true;
    clearTimeout(idleTimer);
    dim.classList.remove('hidden');
    document.body.classList.add('dimmed');
    mapApi.pause(true);
    paintDim();
    loop = setInterval(paintDim, 1000);
  }

  function wake() {
    if (!on) return schedule();
    on = false;
    clearInterval(loop);
    dim.classList.add('hidden');
    document.body.classList.remove('dimmed');
    mapApi.pause(false);
    schedule();
  }

  function schedule() {
    clearTimeout(idleTimer);
    if (!on && auto.checked && getState('nav').active) idleTimer = setTimeout(dimNow, Number(delay.value) * 1000);
  }

  // Dokunma ekranda hareketsizlik sayacını sıfırlar (karartma kapalıyken yakalama aşaması: hiçbir dokunuşu yutmaz)
  ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => { if (!on) schedule(); }, true));
  dim.addEventListener('click', wake);

  btn.addEventListener('click', () => (on ? wake() : dimNow()));
  auto.addEventListener('change', () => { save('dimAuto', auto.checked); paintDelay(); schedule(); });
  delay.addEventListener('input', () => { save('dimDelay', Number(delay.value)); paintDelay(); schedule(); });

  subscribe('nav', () => {
    const active = getState('nav').active;
    btn.classList.toggle('hidden', !active);
    if (!active && on) wake();
    schedule();
  });
  btn.classList.toggle('hidden', !getState('nav').active);
}
