// Navigasyonda sol kenarda dikey pil sürgüsü: parmakla yukarı/aşağı sürükleyerek mevcut pil elle ayarlanır.
// Değer yolda kendiliğinden düşer (physics/socEstimate.js); kamera okuyunca o değer geçerli olur.
import { getState, patch, subscribe, effective } from '../state.js';
import { setManual } from '../physics/socEstimate.js';

const $ = (id) => document.getElementById(id);

export function initSocBar() {
  const track = $('socbar-track');
  const fill = $('socbar-fill');
  const thumb = $('socbar-thumb');
  const val = $('socbar-val');
  const src = $('socbar-src');
  const bar = $('socbar');
  let drag = false;

  const paint = () => {
    const e = effective();
    const v = e.soc;
    const pct = v == null ? 0 : Math.min(100, Math.max(0, v));
    fill.style.height = pct + '%';
    thumb.style.bottom = pct + '%';
    val.textContent = v == null ? '--' : Math.round(v);
    track.setAttribute('aria-valuenow', String(Math.round(pct)));
    const m = getState('engine').socSrc;
    const label = e.source === 'sim' ? 'test' : m === 'ocr' ? 'kamera' : m === 'manual' ? 'elle' : '—';
    src.textContent = label;
    bar.dataset.src = e.source === 'sim' ? 'sim' : m || 'none';
    bar.classList.toggle('low', v != null && v < getState('nav').lowSoc);
  };

  const setFromY = (clientY) => {
    const r = track.getBoundingClientRect();
    const v = Math.round(Math.min(100, Math.max(0, ((r.bottom - clientY) / r.height) * 100)));
    if (getState('sim').enabled) patch('sim', { soc: v });
    else setManual(v);
  };

  track.addEventListener('pointerdown', (e) => {
    drag = true;
    track.setPointerCapture(e.pointerId);
    setFromY(e.clientY);
    e.preventDefault();
  });
  track.addEventListener('pointermove', (e) => { if (drag) setFromY(e.clientY); });
  ['pointerup', 'pointercancel'].forEach((ev) => track.addEventListener(ev, () => { drag = false; }));
  track.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const cur = effective().soc ?? 50;
    const v = Math.min(100, Math.max(0, Math.round(cur) + step));
    if (getState('sim').enabled) patch('sim', { soc: v }); else setManual(v);
  });

  subscribe(['live', 'sim', 'engine', 'nav'], paint);
  paint();
}
