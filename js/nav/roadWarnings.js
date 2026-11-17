// Yol önü sesli uyarıları (dik eğim, hız kamerası). Navigasyon açıkken rotadaki konuma göre çalışır.
//  - Dik eğim: rota profilinden (rakım verisi) hesaplanır, internet gerekmez; kesime 0,5–2,2 km kala bir kez uyarır.
//  - Hız kamerası: OpenStreetMap'te işaretli kameralar (eksik olabilir); 1 km ve 300 m kala uyarır.
//  - Tünel / ücretli yol (v0.99.102): yalnız seçilen rotanın kendi yanıtındaki veriden (bugün Valhalla/OSM rotası; nav/roadAlerts.js).
//    Köprü / alt geçit / üst geçit verisi hiçbir rota sağlayıcısında doğrulanmadı: bu uyarılar yoktur. Ek ağ isteği yapılmaz.
// Yağış, trafik ve hız eşiği uyarıları nav/ahead.js içindedir. Kaza ve mobil kamera verisi ücretsiz kaynakta yoktur.
import { getState, patch, effective, subscribe } from '../state.js';
import { t, locale } from '../i18n/index.js';
import { load, save } from '../utils/storage.js';
import { speak } from '../advisor/voice.js';
import { fetchCameras } from '../osm/cameras.js';
import { buildTrack, locate, pointAtKm } from './track.js';
import { steepSections, pickWarnings, dedupeCams, distText } from './warnLogic.js';
import { createRoadAlerts, stepRoadAlerts } from './roadAlerts.js';

const $ = (id) => document.getElementById(id);
const CHECK_MS = 3000;
const MAX_OFF_KM = 0.12; // rotaya 120 m'den uzak kameralar bu yolda değildir

const on = { grade: load('warnGrade', true), camera: load('warnCam', true) };
let planId = null;
let sections = [];
let cams = [];
let said = new Set();
let camBusy = false;
let camTriedFor = null; // kameraları bu rota için denedik (başarısızsa sürekli yeniden denenmesin)
const roadSt = createRoadAlerts();
let roadTrack = { planId: null, track: null }; // olay anahtarı için rota izi (plan başına bir kez)

const setAhead = (part) => patch('nav', { ahead: { ...getState('nav').ahead, ...part } });

async function loadCams(plan) {
  if (camBusy || !on.camera || !plan.route?.coords) return;
  camBusy = true;
  const id = plan.planId;
  try {
    const list = await fetchCameras(plan.route.coords);
    if (getState('plan').planId !== id) return; // araya yeni bir rota girdi
    const track = buildTrack(plan.route.coords);
    cams = dedupeCams(list.map((c) => ({ ...c, ...locate(track, c.lat, c.lon, null) })).filter((c) => c.offKm <= MAX_OFF_KM));
  } catch (err) {
    console.warn('Hız kamerası verisi alınamadı:', err.message);
  } finally {
    camBusy = false;
  }
}

function tick() {
  const nav = getState('nav');
  const plan = getState('plan');
  if (!nav.active || !plan.profile) {
    if (nav.ahead.grade || nav.ahead.cam || nav.ahead.road) setAhead({ grade: null, cam: null, road: null, roadSoon: false });
    return;
  }
  if (plan.planId !== planId) { // yeni rota: kesimleri hesapla, kameraları (varsa) yükle
    planId = plan.planId;
    sections = steepSections(plan.profile.segs || []);
    cams = [];
    said = new Set();
    camTriedFor = null;
    setAhead({ grade: null, cam: null, road: null, roadSoon: false });
  }
  if (on.camera && camTriedFor !== planId && !camBusy) { // kamera uyarısı sonradan açıldıysa da yüklenir; rota başına bir deneme
    camTriedFor = planId;
    loadCams(plan);
  }
  const km = getState('engine').routeKm;
  roadTick(plan, km);
  if (km == null) return;
  const w = pickWarnings(km, sections, cams, said, { grade: on.grade, camera: on.camera });
  for (const s of w.speak) {
    if (s.kind === 'grade') {
      const where = distText(s.dKm);
      const len = distText(Math.max(0.5, s.lenKm));
      const pct = Math.round(s.grade * 100);
      speak(`${where} ileride ${s.dir < 0 ? 'dik iniş' : 'dik yokuş'}, %${pct} eğim, ${len} boyunca. ${s.dir < 0 ? 'Hızını kontrol et.' : 'Tüketim artar.'}`, { key: s.key, cooldownMs: 60000 });
    } else {
      speak(s.maxspeed ? `Hız kamerası ${distText(s.dKm)} ileride, limit ${s.maxspeed}.` : `Hız kamerası ${distText(s.dKm)} ileride.`, { key: s.key, cooldownMs: 30000 });
    }
  }
  const g = w.gradeLine;
  const gl = g ? `⛰️ ${distText(g.dKm)} ileride ${g.dir < 0 ? 'dik iniş' : 'dik yokuş'} (%${Math.round(g.grade * 100)})` : null;
  const c = w.camLine;
  const cl = c ? `📷 Hız kamerası ${distText(c.dKm)} ileride` : null;
  const a = nav.ahead;
  if (a.grade !== gl || a.cam !== cl) setAhead({ grade: gl, cam: cl });
}

/** Konuşma ve gösterim için kısa mesafe: 850 m, 1,2 km (ondalık ayırıcı seçili dile göre). */
const shortDist = (m) => (m < 950 ? `${Math.max(50, Math.round(m / 50) * 50)} m` : `${(m / 1000).toLocaleString(locale(), { maximumFractionDigits: m < 9950 ? 1 : 0 })} km`);

/** Tünel / ücretli yol: kalan mesafe her tick'te konumdan yeniden hesaplanır; model yalnızca rotayı veren sağlayıcınınsa kullanılır. */
function roadTick(plan, km) {
  const model = plan.route?.roadEvents;
  const own = model && model.provider && plan.route?.routeMeta?.provider === model.provider; // başka sağlayıcının verisi bu rotaya bağlanmaz
  const e = effective();
  const fresh = e.source !== 'live' || getState('live').gps === 'ok';
  if (own && roadTrack.planId !== plan.planId) roadTrack = { planId: plan.planId, track: plan.route.coords?.length > 1 ? buildTrack(plan.route.coords) : null };
  const keyOf = (ev) => { // coğrafi anahtar: yeniden rota (yeni planId) aynı tüneli/gişeyi 10 dk içinde yeniden söyletmez
    if (roadTrack.planId !== plan.planId || !roadTrack.track) return null;
    const p = pointAtKm(roadTrack.track, (ev.fromM ?? ev.atM) / 1000);
    return `${ev.kind}@${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
  };
  const r = stepRoadAlerts(roadSt, { model: own ? model : null, planId: plan.planId, routeKm: km, offRouteKm: getState('engine').offRouteKm, fresh, now: Date.now(), keyOf });
  for (const s of r.speak) {
    const where = distText(s.dM / 1000);
    if (s.kind === 'tunnel') speak(t('{0} ileride tünel, uzunluğu {1}.', where, distText(s.lenM / 1000)), { key: 'road:' + s.key, cooldownMs: 10 * 60e3 });
    else speak(t('{0} ileride ücretli yol.', where), { key: 'road:' + s.key, cooldownMs: 10 * 60e3 });
  }
  const l = r.line;
  const text = !l ? null : l.kind === 'tunnel' ? t('🚇 Tünel {0} ileride ({1})', shortDist(l.dM), shortDist(l.lenM)) : t('💰 Ücretli yol {0} ileride', shortDist(l.dM));
  const a = getState('nav').ahead;
  if (a.road !== text || !!a.roadSoon !== r.soon) setAhead({ road: text, roadSoon: r.soon });
}

export function initRoadWarnings() {
  const bind = (id, key, store) => {
    const el = $(id);
    if (!el) return;
    el.checked = on[key];
    el.addEventListener('change', () => {
      on[key] = el.checked;
      save(store, el.checked);
      if (key === 'camera' && el.checked) camTriedFor = null;
      tick();
    });
  };
  bind('warn-grade', 'grade', 'warnGrade');
  bind('warn-cam', 'camera', 'warnCam');
  setInterval(tick, CHECK_MS);
  subscribe('engine', () => { // her konum güncellemesinde (rota km'si değişince) tünel/gişe mesafesi yenilenir
    const plan = getState('plan');
    if (getState('nav').active && plan.profile && plan.planId === planId) roadTick(plan, getState('engine').routeKm);
  });
}
