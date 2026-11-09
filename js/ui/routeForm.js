// Rota sayfasının üst bölümü: seçili araç ve tüketim özeti, mevcut pil ve güvenli menzil, şarj hedefi (sürgü + sayı), isteğe bağlı ara durak.
// Şarj hedefi Araç ve menzil sayfasındaki "max-charge" denetimine yazar: kaydetme, plan yenileme tek yerde kalır, kullanıcının kayıtlı değeri korunur.
import { getState, subscribe, effective } from '../state.js';
import { VEHICLE } from '../config.js';
import { locale } from '../i18n/index.js';
import { mapApi } from './mapView.js';

const $ = (id) => document.getElementById(id);
const STEP = 5;

/** Şarj hedefi girişi: 50-100 arası, 5'lik adım. Geçersiz girişte null (değer değişmez). */
export function clampTarget(raw) {
  if (raw === '' || raw == null) return null;
  const v = Number(raw);
  if (!Number.isFinite(v)) return null;
  return Math.min(100, Math.max(50, Math.round(v / STEP) * STEP));
}

export function initRouteForm() {
  // Araç, tüketim, pil ve güvenli menzil (eşik piline kadar): gerçek değerler; veri yoksa "--"
  const paintSummary = () => {
    const e = effective();
    const g = getState('engine');
    const cons = g.kwh100Measured ?? g.kwh100Est;
    $('rp-veh').textContent = VEHICLE.name || '—';
    $('rp-cons').textContent = cons == null ? '--' : cons.toFixed(1);
    $('rp-soc').textContent = e.soc == null ? '--' : new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(e.soc / 100);
    $('rp-range').textContent = g.rangeKm == null || e.soc == null ? '--' : String(Math.max(0, Math.round(g.rangeKm)));
  };
  subscribe(['live', 'sim', 'engine', 'route'], paintSummary);
  paintSummary();

  // Şarj hedefi
  const range = $('charge-target');
  const num = $('charge-target-num');
  const master = $('max-charge');
  const paintTarget = () => {
    const v = getState('route').maxChargeTo;
    range.value = v;
    if (document.activeElement !== num) num.value = v;
  };
  const setTarget = (v) => {
    master.value = v;
    master.dispatchEvent(new Event('input')); // vehiclePanel kaydeder ve planı yeniler
    paintTarget();
  };
  range.addEventListener('input', () => setTarget(Number(range.value)));
  num.addEventListener('change', () => {
    const v = clampTarget(num.value);
    if (v != null) setTarget(v);
    num.blur();
    paintTarget();
  });
  subscribe('route', paintTarget);
  paintTarget();

  // Ara durak: varsayılan kapalı; eklenince satır açılır, kaldırılınca rota kutusu ve harita işareti temizlenir
  const row = $('via-row');
  const add = $('btn-add-via');
  let open = false;
  const paintVia = () => {
    const show = open || !!getState('route').via;
    row.classList.toggle('hidden', !show);
    add.classList.toggle('hidden', show);
  };
  add.addEventListener('click', () => { open = true; paintVia(); $('route-via').focus(); });
  $('via-remove').addEventListener('click', () => { open = false; mapApi.setPoint('via', null, { fit: false }); paintVia(); });
  subscribe('route', paintVia);
  paintVia();
}
