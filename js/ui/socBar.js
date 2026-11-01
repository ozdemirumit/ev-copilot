// Navigasyonda sol kenarda dikey pil sürgüsü: parmakla yukarı/aşağı sürükleyerek mevcut pil elle ayarlanır.
// Değer yolda kendiliğinden düşer (physics/socEstimate.js); kamera okuyunca o değer geçerli olur.
import { getState, patch, subscribe, effective } from '../state.js';
import { VEHICLE } from '../config.js';
import { setManual, isOnline } from '../physics/socEstimate.js';
import { toast } from './toast.js';

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
    const sim = e.source === 'sim';
    const online = !sim && isOnline();
    // Yeşil = pil kameradan canlı okunuyor; kırmızı = okuma yok (elle girilmiş / tahmin / kamera eski); mavi = Test Modu
    const label = sim ? 'test' : online ? 'canlı' : m === 'manual' ? 'tahmin' : m === 'ocr' ? 'eski' : 'yok';
    src.textContent = label;
    bar.dataset.src = sim ? 'sim' : m || 'none';
    const cls = sim ? 'ind sim' : online ? 'ind on' : 'ind';
    $('socbar-dot').className = cls;
    const nhDot = $('nh-soc-dot');
    if (nhDot) nhDot.className = cls;
    // Şarjla tahmini menzil (eşik piline kadar; Menzil sekmesindeki ile aynı): km
    const r = getState('engine').rangeKm;
    $('socbar-range').textContent = r == null ? '--' : String(Math.max(0, Math.round(r)));
    const total = getState('engine').kwh100Est > 0 && v != null ? Math.round(((v / 100) * VEHICLE.batteryNetKwh / getState('engine').kwh100Est) * 100) : null;
    $('socbar-rangebox').title = `Tahmini menzil (%${getState('route').minArrivalSoc} eşik piline kadar)` + (total != null ? `; %0'a kadar yaklaşık ${total} km` : '');
    bar.classList.toggle('low', v != null && v < getState('nav').lowSoc);
  };

  let lastToast = 0;
  const blocked = () => {
    if (getState('sim').enabled || !isOnline()) return false;
    if (Date.now() - lastToast > 8000) { lastToast = Date.now(); toast('Pil kameradan canlı okunuyor: elle ayar gerekmez'); }
    return true;
  };
  const thumbY = () => {
    const r = track.getBoundingClientRect();
    const v = effective().soc;
    return r.bottom - (r.height * Math.min(100, Math.max(0, v ?? 0))) / 100;
  };
  const setFromY = (clientY) => {
    const r = track.getBoundingClientRect();
    const v = Math.round(Math.min(100, Math.max(0, ((r.bottom - clientY) / r.height) * 100)));
    if (getState('sim').enabled) patch('sim', { soc: v });
    else setManual(v);
  };

  track.addEventListener('pointerdown', (e) => {
    if (blocked()) return;
    if (Math.abs(e.clientY - thumbY()) > 44) return; // yanlışlıkla dokunuş (avuç, parmak) pili değiştirmesin: yalnızca başparmak yakınından
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
    if (blocked()) return;
    const cur = effective().soc ?? 50;
    const v = Math.min(100, Math.max(0, Math.round(cur) + step));
    if (getState('sim').enabled) patch('sim', { soc: v }); else setManual(v);
  });

  subscribe(['live', 'sim', 'engine', 'nav'], paint);
  setInterval(paint, 3000); // kamera okuması eskiyince (yeşil → kırmızı) değer değişmese de güncelle
  paint();
}
