// Şarj durağına varınca pil kalibrasyonu istemi: araç bir istasyonda durunca ve kamera pili okumuyorsa sürücüden araçtaki gerçek yüzdeyi ister.
// Girilen değer elle pil olarak kaydedilir (tüketim öğrenmeye katılır) ve tahmin/gerçek farkı geçmişe yazılır (physics/arrivals.js).
import { getState, effective } from '../state.js';
import { setManual, isOnline } from '../physics/socEstimate.js';
import { odometerKm } from '../physics/history.js';
import { nearestWithin, shouldPrompt, addArrival, STOP_KMH } from '../physics/arrivals.js';
import { t } from '../i18n/index.js';
import { toast } from './toast.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function initArrivalCalib() {
  const dlg = $('arrival-dialog');
  if (!dlg) return;
  const input = $('arrival-soc');
  let stoppedSince = null;
  let lastOdo = odometerKm();
  const lastAt = new Map(); // istasyon kimliği → son istem zamanı
  let ctx = null; // açık istemin bağlamı: { station, est, plan, lat, lon }

  const read = () => clamp(Math.round(Number(input.value)), 0, 100);
  const step = (d) => { input.value = String(clamp((Number.isFinite(Number(input.value)) ? Number(input.value) : 0) + d, 0, 100)); };

  const finish = () => { // kaydetsin ya da geçsin: bir sonraki istem için yeniden yol almak gerekir
    lastAt.set(ctx.station.id ?? ctx.station.name, Date.now());
    lastOdo = odometerKm();
    ctx = null;
    if (dlg.open) dlg.close();
  };

  $('arrival-plus').addEventListener('click', () => step(1));
  $('arrival-minus').addEventListener('click', () => step(-1));
  $('arrival-skip').addEventListener('click', () => ctx && finish());
  $('arrival-x').addEventListener('click', () => ctx && finish());
  dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); if (ctx) finish(); });
  $('arrival-save').addEventListener('click', () => {
    if (!ctx) return;
    const v = read();
    addArrival({ station: ctx.station.name, lat: ctx.lat, lon: ctx.lon, est: ctx.est, actual: v, plan: ctx.plan });
    setManual(v); // elle pil girişi: iki giriş arasındaki düşüş ve yol tüketim ölçümü olur
    toast(t('Kaydedildi: tahmin %{0}, gerçek %{1}', Math.round(ctx.est), v), 5000);
    finish();
  });

  function open(station, e) {
    const plan = getState('plan');
    const stop = plan.stops?.find((s) => s.station?.id === station.id);
    ctx = { station, est: e.soc, plan: stop?.arriveSoc ?? null, lat: e.lat, lon: e.lon };
    $('arrival-text').textContent = t('{0} istasyonundasın. Uygulama pili %{1} tahmin ediyor. Araçta gördüğün yüzdeyi gir: tüketim hesabı buna göre kalibre olur.', station.name, Math.round(e.soc));
    const pl = $('arrival-plan');
    pl.textContent = ctx.plan != null ? t('Planda bu durağa varış %{0} idi.', Math.round(ctx.plan)) : '';
    pl.classList.toggle('hidden', ctx.plan == null);
    input.value = String(Math.round(e.soc));
    dlg.showModal();
  }

  setInterval(() => {
    const e = effective();
    if (ctx || getState('sim').enabled || e.soc == null || e.lat == null) { stoppedSince = null; return; }
    if (isOnline()) { lastOdo = odometerKm(); return; } // kamera pili canlı okuyor: sormaya gerek yok
    if ((e.speed ?? 0) > STOP_KMH) { stoppedSince = null; return; }
    stoppedSince ??= Date.now();
    if (document.querySelector('dialog[open]')) return; // başka pencere açıkken bölme
    const station = nearestWithin(getState('plan').stations, e);
    const now = Date.now();
    if (!shouldPrompt({
      station, speed: e.speed, stoppedMs: now - stoppedSince, driven: odometerKm() - lastOdo,
      lastForStation: station ? lastAt.get(station.id ?? station.name) : undefined, now,
    })) return;
    open(station, e);
  }, 5000);
}
