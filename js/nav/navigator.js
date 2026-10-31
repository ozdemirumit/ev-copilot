// Dönüş dönüş navigasyon: üst banner, sesli yönlendirme, harita takibi, rotadan çıkınca yeniden rota.
// Konum/ilerleme rangeEngine'den gelir (engine.routeKm, offRouteKm); Test Modu'nda simüle araçla aynı şekilde çalışır.
import { getState, patch, subscribe, effective } from '../state.js';
import { save } from '../utils/storage.js';
import { mapApi } from '../ui/mapView.js';
import { toast } from '../ui/toast.js';
import { rerouteFromHere } from '../routing/controller.js';
import { speak } from '../advisor/voice.js';
import { instruction, fmtDist, spoken, isMinor } from './steps.js';
import { buildTrack, locate } from './track.js';

const $ = (id) => document.getElementById(id);
const TIERS_M = [120, 500, 2000]; // dönüşe bu kadar kala konuş (küçükten büyüğe)
const OFF_ROUTE_KM = 0.35;
const OFF_ROUTE_MS = 12000;
const REROUTE_COOLDOWN_MS = 90000;

let said = new Set();
let planId = null;
let offSince = 0;
let lastReroute = 0;
let track = null;
let trackKm = null; // son bilinen iz konumu (arama penceresi için)

function paint(arrow, dist, text, road, sub, warn = false) {
  $('nav-arrow').textContent = arrow;
  $('nav-dist').textContent = dist;
  $('nav-text').textContent = text;
  $('nav-road').textContent = road;
  $('nav-sub').textContent = sub;
  $('nav-banner').classList.toggle('warn', warn);
}

const hhmm = (ms) => new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

/** Her saniye: sıradaki manevrayı bul, bannerı çiz, eşiklerde konuş, harita aracı izlesin. */
function tick() {
  const nav = getState('nav');
  const bar = $('nav-banner');
  bar.classList.toggle('hidden', !nav.active);
  if (!nav.active) return;

  const plan = getState('plan');
  const e = effective();

  if (plan.status === 'loading') return paint('🧭', '', 'Rota hesaplanıyor…', '', '');
  if (!plan.profile || !plan.steps?.length) return paint('🧭', '', 'Önce Rotayı Planla', '', '', true);
  if (plan.planId !== planId || !track) {
    planId = plan.planId; said = new Set(); offSince = 0; trackKm = null;
    track = plan.route?.coords ? buildTrack(plan.route.coords) : null;
  }
  if (!track || e.lat == null) return paint('📍', '', 'Konum bekleniyor…', '', 'GPS kapalıysa üstteki 📍 düğmesine dokun', true);

  // Gerçek geometriye izdüşüm: dönüşe kalan mesafe ve rotadan sapma metre hassasiyetinde
  const loc = locate(track, e.lat, e.lon, trackKm);
  const km = loc.km;
  if (loc.offKm <= OFF_ROUTE_KM) trackKm = km;

  // Rotadan çıkış: kısa sapmalar (park, şerit) sayılmaz; 12 sn sürerse bulunduğun yerden yeni rota
  if (loc.offKm > OFF_ROUTE_KM) {
    offSince ||= Date.now();
    paint('⚠️', fmtDist(loc.offKm * 1000), 'Rotadan çıktınız', 'Yeni rota hesaplanıyor…', '', true);
    if ((e.speed ?? 0) > 5 && Date.now() - offSince > OFF_ROUTE_MS && Date.now() - lastReroute > REROUTE_COOLDOWN_MS) {
      lastReroute = Date.now();
      speak('Rota yeniden hesaplanıyor.', { key: 'reroute', cooldownMs: 0, interrupt: true });
      rerouteFromHere();
    }
    return;
  }
  offSince = 0;

  const steps = plan.steps;
  let idx = steps.findIndex((s) => !isMinor(s) && s.km > km - 0.03);
  if (idx < 0) idx = steps.length - 1;
  const st = steps[idx];
  const distM = Math.max(0, (st.km - km) * 1000);

  if (st.type === 'arrive' && distM < 40) {
    speak('Varış noktasına ulaştınız.', { key: 'arrived', cooldownMs: 0, interrupt: true });
    patch('nav', { active: false });
    toast('Varış noktasına ulaştınız');
    return tick();
  }

  const ins = instruction(st);
  const remain = Math.max(0, plan.profile.totalKm - km);
  const nextStop = plan.stops.find((s) => s.km > km + 0.3);
  const eta = hhmm(Date.now() + plan.profile.timeBetween(km, plan.profile.totalKm) * 3600e3);
  const sub = `Kalan ${remain.toFixed(0)} km · varış ${eta}` + (nextStop ? ` · ⚡ ${nextStop.station.name} ${(nextStop.km - km).toFixed(0)} km` : '');
  paint(ins.arrow, fmtDist(distM), ins.text, ins.road, sub);

  // Sesli yönlendirme: her manevra için en fazla bir kez, geçilen eşiklerin hepsi "söylendi" sayılır
  const tier = TIERS_M.find((t) => distM <= t);
  if (tier) {
    const key = `${idx}:${tier}`;
    if (!said.has(key)) {
      TIERS_M.filter((t) => t >= tier).forEach((t) => said.add(`${idx}:${t}`));
      speak(spoken(st, tier === TIERS_M[0] ? null : distM), { key: 'nav' + key, cooldownMs: 0, interrupt: true });
    }
  }
  if (nextStop) {
    const d = nextStop.km - km;
    const t = d <= 1.2 ? 1 : d <= 5 ? 5 : null;
    const key = `stop:${nextStop.station.id}:${t}`;
    if (t && !said.has(key)) {
      if (t === 1) said.add(`stop:${nextStop.station.id}:5`);
      said.add(key);
      speak(`${d >= 2 ? Math.round(d) : 1} kilometre sonra şarj durağı: ${nextStop.station.name}. Varışta tahmini pil yüzde ${Math.round(nextStop.arriveSoc)}.`, { key, cooldownMs: 0 });
    }
  }

  mapApi.follow(e.lat, e.lon);
}

/** Navigasyonu başlat (plan hazırsa). Kullanıcı dokunuşuyla çağrıldığı için sesli yönlendirme tarayıcıda açılır. */
export function startNav() {
  const plan = getState('plan');
  if (!plan.profile || !plan.steps?.length) return toast('Önce rotayı planla');
  const e = effective();
  if (e.lat == null) toast('Konum yok: üstteki 📍 ile GPS\'i aç (veya Test Modu)', 4000);
  else if (!getState('system').wakeLock) toast('İpucu: ekran kapanmasın diye 🔆 düğmesine dokun', 3500);
  said = new Set();
  planId = plan.planId;
  patch('nav', { active: true });
  document.querySelector('.bottomnav [data-tab="route"]')?.click();
  if (e.lat != null) mapApi.follow(e.lat, e.lon, 15, true);
  speak('Navigasyon başladı.', { key: 'navstart', cooldownMs: 0, interrupt: true });
  tick();
}

export function stopNav() {
  patch('nav', { active: false });
  window.speechSynthesis?.cancel();
  tick();
}

export function initNavigator() {
  const nav = getState('nav');
  const btn = $('btn-nav');
  const voice = $('nav-voice');
  const low = $('low-soc');
  const lowOut = $('low-soc-out');

  const paintBtn = () => {
    const on = getState('nav').active;
    btn.textContent = on ? '⏹ Navigasyonu durdur' : '▶ Navigasyonu başlat';
    btn.classList.toggle('primary', !on);
    btn.classList.toggle('danger', on);
  };
  btn.addEventListener('click', () => (getState('nav').active ? stopNav() : startNav()));
  $('nav-stop').addEventListener('click', stopNav);

  voice.checked = nav.voice;
  voice.addEventListener('change', () => {
    patch('nav', { voice: voice.checked });
    save('voiceOn', voice.checked);
    if (voice.checked) speak('Sesli yönlendirme açık.', { force: true, key: 'voicetest', cooldownMs: 0, interrupt: true });
    else window.speechSynthesis?.cancel();
  });

  low.value = nav.lowSoc;
  lowOut.textContent = '%' + nav.lowSoc;
  low.addEventListener('input', () => {
    lowOut.textContent = '%' + low.value;
    patch('nav', { lowSoc: Number(low.value) });
    save('lowSoc', Number(low.value));
  });

  subscribe('nav', () => { paintBtn(); tick(); });
  paintBtn();
  setInterval(tick, 1000);
}
