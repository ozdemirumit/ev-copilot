// Yol önü uyarıları (seçili veri kaynağından): ileride yağmur, ileride yoğun/yavaş trafik (kaynak sunuyorsa) ve kullanıcının
// belirlediği hız eşiği. Navigasyon açıkken periyodik yenilenir. Kaza, polis ve hız kamerası verisi yoktur; canlı trafik de yoktur (yalnızca yağış uyarısı çalışır).
import { getState, patch, subscribe, effective } from '../state.js';
import { save } from '../utils/storage.js';
import { fetchWeather, fetchTrafficAhead } from '../providers/index.js';
import { speak } from '../advisor/voice.js';
import { currentLimit } from './speedLimit.js';

const $ = (id) => document.getElementById(id);
const CHECK_MS = 5000;
const WEATHER_EVERY_MS = 10 * 60e3;
const TRAFFIC_EVERY_MS = 10 * 60e3; // her çağrı Routes "trafik çizgisi" ücretli: seyrek tut
const WX_AHEAD_KM = [10, 25, 50, 75, 100, 150, 200];
const RAIN_MM = 0.3; // mm/sa üstü "yağmur"
const SPEED_TOLERANCE = 3; // km/h
const SPEED_HOLD_MS = 5000; // eşik bu kadar süre aşılırsa uyar (anlık sıçrama sayılmasın)

let planId = null;
let wxAt = 0;
let trAt = 0;
let busyWx = false;
let busyTr = false;
let overSince = 0;

const setAhead = (part) => patch('nav', { ahead: { ...getState('nav').ahead, ...part } });

function render() {
  const a = getState('nav').ahead;
  const lines = [a.speed, a.rain, a.traffic].filter(Boolean);
  const bar = $('road-alert');
  bar.replaceChildren(...lines.map((t) => Object.assign(document.createElement('div'), { textContent: t })));
  bar.classList.toggle('hidden', !lines.length);
}

async function refreshRain(km) {
  busyWx = true;
  try {
    const plan = getState('plan');
    const prof = plan.profile;
    const remain = prof.totalKm - km;
    const now = Date.now();
    const pts = WX_AHEAD_KM.filter((d) => d < remain).map((d) => {
      const p = prof.pointAt(km + d);
      return { d, lat: p.lat, lon: p.lon, t: now + prof.timeBetween(km, km + d) * 3600e3 };
    });
    if (!pts.length) return setAhead({ rain: null });
    const res = await fetchWeather(pts);
    const i = res.findIndex((w) => w.rain >= RAIN_MM);
    if (i < 0) return setAhead({ rain: null });
    const w = res[i];
    const d = pts[i].d;
    const ice = w.temp <= 2 ? ', buzlanma riski' : '';
    setAhead({ rain: `🌧️ İleride yağmur: ~${d} km sonra (${w.rain.toFixed(1)} mm/sa, ${Math.round(w.temp)}°C${ice})` });
    speak(`İleride yaklaşık ${d} kilometre sonra yağmur bekleniyor${ice ? '. Buzlanma riski var' : ''}.`, { key: 'rain' + Math.round(d / 50), cooldownMs: 30 * 60e3 });
  } catch (err) {
    console.warn('Yol önü hava durumu alınamadı:', err.message);
    setAhead({ rain: null });
  } finally {
    wxAt = Date.now();
    busyWx = false;
  }
}

async function refreshTraffic() {
  busyTr = true;
  try {
    const e = effective();
    const t = await fetchTrafficAhead(e, getState('route').end);
    if (!t) return setAhead({ traffic: null });
    const { jam, delayMin } = t;
    patch('nav', { liveRemain: { h: t.remainH, at: Date.now() } });
    if (!jam) return setAhead({ traffic: delayMin >= 10 ? `🚦 Rotada trafik kaynaklı ≈ ${delayMin} dk gecikme var` : null });
    const len = jam.to - jam.from;
    const where = jam.from < 1 ? 'Şu an' : `~${Math.round(jam.from)} km ileride`;
    const what = jam.jam ? 'yoğun trafik' : 'yavaş trafik';
    setAhead({ traffic: `🚦 ${where} ${what} (${len.toFixed(1)} km)` + (delayMin >= 3 ? `, rotada ≈ ${delayMin} dk gecikme` : '') });
    speak(`${jam.from < 1 ? 'Şu an' : `${Math.round(jam.from)} kilometre ileride`} ${what}, yaklaşık ${len.toFixed(0)} kilometre.${delayMin >= 5 ? ` Tahmini gecikme ${delayMin} dakika.` : ''}`, { key: 'traffic' + Math.round(jam.from / 10), cooldownMs: 15 * 60e3 });
  } catch (err) {
    console.warn('Trafik bilgisi alınamadı:', err.message);
  } finally {
    trAt = Date.now();
    busyTr = false;
  }
}

function check() {
  const nav = getState('nav');
  const plan = getState('plan');
  const e = effective();

  // Hız eşiği (kullanıcı belirler; yolun yasal sınırı değildir)
  // Yol limiti (OpenStreetMap) biliniyorsa o; yoksa kullanıcının eşiği. Resmî limitte GPS payı için 5 km/h tolerans.
  const road = currentLimit();
  const limit = road ?? nav.speedAlert;
  const over = limit > 0 && (e.speed ?? 0) > limit + (road ? 5 : SPEED_TOLERANCE);
  if (over) {
    overSince ||= Date.now();
    if (Date.now() - overSince >= SPEED_HOLD_MS) {
      if (nav.ahead.speed == null) setAhead({ speed: `⚠️ ${road ? 'Yol hız limitini' : 'Hız eşiğini'} aştın: ${Math.round(e.speed)} km/s (${road ? 'limit' : 'eşik'} ${limit})` });
      speak(`${road ? 'Hız limitini' : 'Hız eşiğini'} aştınız. ${Math.round(e.speed)} kilometre, limit ${limit}.`, { key: 'speed', cooldownMs: 45000 });
    }
  } else {
    overSince = 0;
    if (nav.ahead.speed != null) setAhead({ speed: null });
  }

  if (plan.planId !== planId) { planId = plan.planId; wxAt = 0; trAt = 0; setAhead({ rain: null, traffic: null }); }
  if (!nav.active || !plan.profile || e.lat == null) {
    if (!nav.active && (nav.ahead.rain || nav.ahead.traffic)) setAhead({ rain: null, traffic: null });
    return;
  }
  const km = getState('engine').routeKm;
  if (km == null || plan.profile.totalKm - km < 3) return;
  if (!busyWx && Date.now() - wxAt > WEATHER_EVERY_MS) refreshRain(km);
  if (!busyTr && Date.now() - trAt > TRAFFIC_EVERY_MS && getState('route').end) refreshTraffic();
}

export function initAhead() {
  const slider = $('speed-alert');
  const out = $('speed-alert-out');
  const paint = () => { out.textContent = Number(slider.value) ? `${slider.value} km/s` : 'kapalı'; };
  slider.value = getState('nav').speedAlert;
  paint();
  slider.addEventListener('input', () => {
    paint();
    patch('nav', { speedAlert: Number(slider.value) });
    save('speedAlert', Number(slider.value));
  });
  subscribe('nav', render);
  render();
  setInterval(check, CHECK_MS);
}
