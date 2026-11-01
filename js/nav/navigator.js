// Dönüş dönüş navigasyon: üst banner, sesli yönlendirme, harita takibi, rotadan çıkınca yeniden rota.
// Konum/ilerleme rangeEngine'den gelir (engine.routeKm, offRouteKm); Test Modu'nda simüle araçla aynı şekilde çalışır.
import { getState, patch, subscribe, effective } from '../state.js';
import { save } from '../utils/storage.js';
import { mapApi } from '../ui/mapView.js';
import { toast } from '../ui/toast.js';
import { rerouteFromHere } from '../routing/controller.js';
import { speak } from '../advisor/voice.js';
import { instruction, fmtDist, spoken, isMinor } from './steps.js';
import { buildTrack, locate, headingAt, pointAtKm } from './track.js';

const $ = (id) => document.getElementById(id);
const TIERS_M = [120, 500, 2000]; // dönüşe bu kadar kala konuş (küçükten büyüğe)
const OFF_BASE_KM = 0.07; // rotadan bu kadar uzak = başka yol (GPS doğruluğu kötüyse payı büyür)
const OFF_MAX_KM = 0.2;
const FAR_OFF_KM = 0.4; // bu kadar uzaktaysan (yanlış çıkış vb.) beklemeden hemen yeni rota
const OFF_ROUTE_MS = 6000;
const REROUTE_COOLDOWN_MS = 45000; // başarılı yeni rotadan sonra bir daha hemen sapma kontrolü yapma
const RETRY_MS = 12000; // yeni rota alınamadıysa (internet yok vb.) bu kadar sonra tekrar dene

let said = new Set();
let planId = null;
let offSince = 0;
let lastReroute = 0;
let rerouting = false;
let track = null;
let trackKm = null; // son bilinen iz konumu (arama penceresi için)

/** Rota sapma/yapışma payı (km): GPS doğruluğunun 2,5 katı, en az 70 m, en çok 200 m. */
const offLimit = () => Math.min(OFF_MAX_KM, Math.max(OFF_BASE_KM, (2.5 * (getState('live').acc || 0)) / 1000));

/** Konumu rota üzerindeki en yakın noktaya yapıştır (harita imleci için): { lat, lon, heading } ya da yoldan sapmışsa null. */
export function snapPoint(lat, lon) {
  if (!track || !getState('nav').active) return null;
  const loc = locate(track, lat, lon, trackKm);
  if (loc.offKm > offLimit()) return null;
  const p = pointAtKm(track, loc.km);
  return { lat: p.lat, lon: p.lon, heading: headingAt(track, loc.km) };
}

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
  if (!nav.active) return followSim();

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
  const lim = offLimit();
  if (loc.offKm <= lim) trackKm = km;

  // Rotadan çıkış: kısa sapmalar (park, şerit) sayılmaz; 8 sn sürerse (1 km'den uzaktaysan hemen) bulunduğun yerden yeni rota.
  // GPS hızı yoksa (null) hareket ediyor sayılır: hız okunamayınca yeniden rota hiç kurulmaz olmasın.
  if (loc.offKm > lim) {
    offSince ||= Date.now();
    const moving = e.speed == null || e.speed > 5;
    const waited = Date.now() - offSince > OFF_ROUTE_MS || loc.offKm > FAR_OFF_KM;
    if (!rerouting) paint('⚠️', fmtDist(loc.offKm * 1000), 'Rotadan çıktınız', 'Yeni rota hesaplanıyor…', '', true);
    if (moving && waited && !rerouting && Date.now() - lastReroute > REROUTE_COOLDOWN_MS) {
      lastReroute = Date.now();
      rerouting = true;
      speak('Rota yeniden hesaplanıyor.', { key: 'reroute', cooldownMs: 0, interrupt: true });
      Promise.resolve(rerouteFromHere()).then((ok) => {
        if (ok) speak('Yeni rota hazır.', { key: 'rerouted', cooldownMs: 0 });
        else lastReroute = Date.now() - REROUTE_COOLDOWN_MS + RETRY_MS; // başarısız: kısa süre sonra tekrar
      }).catch(() => { lastReroute = Date.now() - REROUTE_COOLDOWN_MS + RETRY_MS; }).finally(() => { rerouting = false; });
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
    mapApi.navView(false);
    toast('Varış noktasına ulaştınız');
    return tick();
  }

  const ins = instruction(st);
  const remain = Math.max(0, plan.profile.totalKm - km);
  const nextStop = plan.stops.find((s) => s.km > km + 0.3);
  // Varış: canlı kalan süre varsa o (ahead.js yeniler; arada geçen süre düşülür) + kalan şarj molaları.
  // Yoksa rota süresinin kalan oranı, o da yoksa profil süresi.
  const live = nav.liveRemain;
  const driveH = live && Date.now() - live.at < 15 * 60e3 ? Math.max(0, live.h - (Date.now() - live.at) / 3600e3)
    : plan.route?.durationH ? plan.route.durationH * (remain / plan.profile.totalKm)
      : plan.profile.timeBetween(km, plan.profile.totalKm);
  const chargeMin = plan.stops.filter((s) => s.km > km).reduce((a, s) => a + s.minutes + s.overheadMin, 0);
  const eta = hhmm(Date.now() + driveH * 3600e3 + chargeMin * 60e3);
  const sub = `Kalan ${remain.toFixed(0)} km · varış ${eta}` + (nextStop ? ` · ⚡ ${nextStop.station.name} ${(nextStop.km - km).toFixed(0)} km` : '');
  paint(ins.arrow, fmtDist(distM), ins.text, ins.road, sub);
  const then = steps.slice(idx + 1).find((x) => !isMinor(x));
  $('nav-then').textContent = then && then.type !== 'arrive' ? `Sonra (${fmtDist((then.km - st.km) * 1000)} sonra): ${instruction(then).text}` : '';
  paintHud(e, remain, eta, driveH, chargeMin);

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

  // Harita: hıza göre zoom (yavaş = yakın), kavşağa 250 m kala en yakın zoom; sürerken yön-yukarı
  const onRoute = loc.offKm <= lim;
  const at = onRoute ? pointAtKm(track, km) : null; // imleç ve kamera yola yapışık konumu izler
  followMap(at ? { ...e, lat: at.lat, lon: at.lon } : e, distM, st, onRoute ? headingAt(track, km) : null);
}

let simFollowing = false;

/** Navigasyon kapalıyken de Test Modu sürüş simülasyonu çalışıyorsa harita aracı izler (kaydırınca 15 sn durur). */
function followSim() {
  const sim = getState('sim');
  const e = effective();
  const on = sim.enabled && sim.play && e.lat != null;
  if (!on) { simFollowing = false; return; }
  const z = (e.speed ?? 0) < 40 ? 17 : (e.speed ?? 0) < 80 ? 16 : 15;
  mapApi.follow(e.lat, e.lon, simFollowing ? null : z, !simFollowing); // ilk seferde yakınlaş ve odakla
  simFollowing = true;
}

/** Harita üstü alt bilgi: hız, varış saati + kalan, pil; ortala düğmesi (harita kaydırıldıysa). */
function paintHud(e, remainKm, eta, driveH, chargeMin) {
  const totalMin = Math.round(driveH * 60 + chargeMin);
  $('nh-speed').textContent = e.speed == null ? '--' : Math.round(e.speed);
  $('nh-eta').textContent = eta;
  $('nh-rem').textContent = `${remainKm.toFixed(0)} km · ${totalMin >= 60 ? `${Math.floor(totalMin / 60)} sa ${totalMin % 60} dk` : `${totalMin} dk`}`;
  $('nh-soc').textContent = e.soc == null ? '--' : Math.round(e.soc);
  $('nh-recenter').classList.toggle('hidden', !mapApi.dragged());
}

let zoomNow = null;
let zoomAt = 0;
let speedAvg = 0;

/** Hıza göre hedef zoom (ortalama hızla yumuşatılmış); kavşağa yaklaşınca 18. */
function followMap(e, distM, st, routeHeading) {
  speedAvg = speedAvg * 0.8 + (e.speed ?? 0) * 0.2;
  const junction = !isMinor(st) && st.type !== 'arrive' && distM <= 250;
  const want = junction ? 18 : speedAvg < 40 ? 17 : speedAvg < 80 ? 16 : 15;
  const now = Date.now();
  // Kavşak zoom'u hemen; hız kaynaklı değişim en fazla 8 sn'de bir (titreşmesin)
  const change = want !== zoomNow && (junction || now - zoomAt > 8000);
  if (change) { zoomNow = want; zoomAt = now; }
  // Dönüş yönü rotanın gidiş yönünden alınır (GPS yönü olmasa da çalışır); rota dışındaysa GPS yönü
  const heading = routeHeading ?? ((e.speed ?? 0) > 5 ? e.heading : null);
  mapApi.follow(e.lat, e.lon, change ? want : null, change, getState('nav').headingUp ? heading : null);
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
  track = plan.route?.coords ? buildTrack(plan.route.coords) : null; // her başlatışta güncel rotanın izi
  trackKm = null;
  offSince = 0;
  patch('nav', { active: true });
  document.querySelector('.bottomnav [data-tab="map"]')?.click();
  zoomNow = 16; zoomAt = Date.now(); speedAvg = e.speed ?? 0;
  const up = getState('nav').headingUp;
  mapApi.navView(true, up);
  if (e.lat != null) mapApi.follow(e.lat, e.lon, 16, true, up ? (track ? headingAt(track, trackKm ?? 0) : (e.speed ?? 0) > 5 ? e.heading : null) : null);
  speak('Navigasyon başladı.', { key: 'navstart', cooldownMs: 0, interrupt: true });
  tick();
}

export function stopNav() {
  patch('nav', { active: false });
  mapApi.navView(false);
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
  mapApi.snap = snapPoint;

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

  // Navigasyon modu: harita zaten tam ekran; yalnızca düzen sınıfı (Rota düğmesi gizlenir, kontroller yükselir)
  const sizeMap = () => document.body.classList.toggle('navmode', getState('nav').active);
  subscribe('nav', () => { paintBtn(); sizeMap(); tick(); });

  // Harita yönü: gidiş yönü yukarı (3D) ya da kuzey yukarı
  const hu = $('nav-headingup');
  hu.checked = nav.headingUp;
  hu.addEventListener('change', () => {
    patch('nav', { headingUp: hu.checked });
    save('headingUp', hu.checked);
    if (getState('nav').active) mapApi.navView(true, hu.checked);
  });

  // Harita üstü düğmeler: sesli aç/kapat, tüm rota, aracı ortala
  $('nh-voice').addEventListener('click', () => {
    const on = !getState('nav').voice;
    patch('nav', { voice: on });
    save('voiceOn', on);
    voice.checked = on;
    if (!on) window.speechSynthesis?.cancel();
  });
  $('nh-overview').addEventListener('click', () => mapApi.overview());
  $('nh-recenter').addEventListener('click', () => { mapApi.recenter(); tick(); });
  subscribe('nav', () => {
    $('nh-voice').textContent = getState('nav').voice ? '🔊' : '🔇';
    $('navhud').classList.toggle('hidden', !getState('nav').active);
  });
  paintBtn();
  setInterval(tick, 1000);
}
