// Yol önü sesli uyarıları (dik eğim, hız kamerası). Navigasyon açıkken rotadaki konuma göre çalışır.
//  - Dik eğim: rota profilinden (rakım verisi) hesaplanır, internet gerekmez; kesime 0,5–2,2 km kala bir kez uyarır.
//  - Hız kamerası: OpenStreetMap'te işaretli kameralar (eksik olabilir); 1 km ve 300 m kala uyarır.
//  - Tünel / ücretli yol (v0.99.102): yalnız seçilen rotanın kendi yanıtındaki veriden (bugün Valhalla/OSM rotası; nav/roadAlerts.js).
//  - Köprü / alt geçit / (Mapbox, TomTom rotasında) tünel ve gişe (v0.99.118): OpenStreetMap ekstralarından (nav/roadExtras.js; Valhalla trace_attributes + Overpass),
//    HER sağlayıcının rotasında; rota başına bir kez ek istek, ayar (warnRoad) kapalıysa istek yok. Rotayı veren sağlayıcının kendi modeli kazanır. Üst geçit uyarısı yoktur.
//  - Sert viraj (v0.99.114): rotanın kendi geometrisinden (nav/curveLogic.js; tüm sağlayıcılarda aynı, ek istek yok); kavşak/dönüş adımlarının
//    yakınındaki kesimler elenir, kaba geometride uyarı üretilmez. Kesime 200–600 m kala bir kez uyarır, 1 km'den itibaren ekranda görünür.
// Yağış, trafik ve hız eşiği uyarıları nav/ahead.js içindedir. Kaza ve mobil kamera verisi ücretsiz kaynakta yoktur.
import { getState, patch, effective, subscribe } from '../state.js';
import { t, locale } from '../i18n/index.js';
import { load, save } from '../utils/storage.js';
import { speak } from '../advisor/voice.js';
import { fetchCameras } from '../osm/cameras.js';
import { buildTrack, locate, pointAtKm } from './track.js';
import { steepSections, pickWarnings, dedupeCams, distText } from './warnLogic.js';
import { createRoadAlerts, stepRoadAlerts } from './roadAlerts.js';
import { mergeRoadModels } from './roadExtras.js';
import { roadExtrasFor } from '../osm/roadExtras.js';
import { sharpCurves, pickCurves, CURVE } from './curveLogic.js';

const $ = (id) => document.getElementById(id);
const CHECK_MS = 3000;
const MAX_OFF_KM = 0.12; // rotaya 120 m'den uzak kameralar bu yolda değildir

const on = { grade: load('warnGrade', true), camera: load('warnCam', true), curve: load('warnCurve', true), road: load('warnRoad', true) };
let planId = null;
let sections = [];
let curves = [];
let curvesFor = null; // sert virajlar bu rota için hesaplandı (rota başına bir kez; ayar sonradan açılırsa da hesaplanır)
let cams = [];
let said = new Set();
let camBusy = false;
let camTriedFor = null; // kameraları bu rota için denedik (başarısızsa sürekli yeniden denenmesin)
const roadSt = createRoadAlerts();
let roadTrack = { planId: null, track: null }; // olay anahtarı için rota izi (plan başına bir kez)
let extras = null; // OSM ekstraları { planId, model } (köprü/alt geçit/gişe)
let extrasBusy = false;
let extrasTriedFor = null; // ekstraları bu rota için denedik (başarısızsa sürekli yeniden denenmesin)

const setAhead = (part) => patch('nav', { ahead: { ...getState('nav').ahead, ...part } });

async function loadExtras(plan) {
  const coords = plan.route?.coords;
  if (extrasBusy || !on.road || !Array.isArray(coords) || coords.length < 2) return;
  extrasBusy = true;
  const id = plan.planId;
  try {
    const model = await roadExtrasFor(coords);
    if (getState('plan').planId === id) extras = { planId: id, model }; // araya yeni bir rota girdiyse atılır
  } catch (err) {
    console.warn('Köprü/alt geçit/gişe verisi alınamadı:', err.message);
  } finally {
    extrasBusy = false;
  }
}

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
    if (nav.ahead.grade || nav.ahead.cam || nav.ahead.road || nav.ahead.curve) setAhead({ grade: null, cam: null, road: null, roadSoon: false, curve: null, curveSoon: false });
    return;
  }
  if (plan.planId !== planId) { // yeni rota: kesimleri hesapla, kameraları (varsa) yükle
    planId = plan.planId;
    sections = steepSections(plan.profile.segs || []);
    curves = [];
    curvesFor = null;
    cams = [];
    said = new Set();
    camTriedFor = null;
    extras = null;
    extrasTriedFor = null;
    setAhead({ grade: null, cam: null, road: null, roadSoon: false, curve: null, curveSoon: false });
  }
  if (on.curve && curvesFor !== planId) { // sert virajlar rota geometrisinden (ağ yok); rota başına bir kez
    curvesFor = planId;
    try { curves = sharpCurves(plan.route?.coords, plan.steps); } catch (err) { curves = []; console.warn('Viraj uyarısı hesaplanamadı:', err.message); }
  }
  if (on.camera && camTriedFor !== planId && !camBusy) { // kamera uyarısı sonradan açıldıysa da yüklenir; rota başına bir deneme
    camTriedFor = planId;
    loadCams(plan);
  }
  if (on.road && extrasTriedFor !== planId && !extrasBusy) { // ayar sonradan açıldıysa da yüklenir; rota başına bir deneme
    extrasTriedFor = planId;
    loadExtras(plan);
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
  const cvr = pickCurves(km, curves, said, { enabled: on.curve });
  for (const s of cvr.speak) speak(curveSpeech(s), { key: s.key, cooldownMs: 60000 });
  const cvl = cvr.line ? curveLine(cvr.line) : null;
  const cvSoon = !!cvr.line && cvr.line.dKm <= CURVE.leadKm[1]; // 600 m'den yakınsa uyarı dönüşümde öne alınır
  const a = nav.ahead;
  if (a.grade !== gl || a.cam !== cl || a.curve !== cvl || !!a.curveSoon !== cvSoon) setAhead({ grade: gl, cam: cl, curve: cvl, curveSoon: cvSoon });
}

/** Yol olayı anonsu ve ekran satırı (çeviri dil başına tam cümle). */
const roadSpeech = (s) => {
  const where = distText(s.dM / 1000);
  if (s.kind === 'tunnel') return t('{0} ileride tünel, uzunluğu {1}.', where, distText(s.lenM / 1000));
  if (s.kind === 'bridge') return t('{0} ileride köprü, uzunluğu {1}.', where, distText(s.lenM / 1000));
  if (s.kind === 'underpass') return t('{0} ileride alt geçit.', where);
  return t('{0} ileride ücretli yol.', where);
};
const roadLine = (l) => {
  if (l.kind === 'tunnel') return t('🚇 Tünel {0} ileride ({1})', shortDist(l.dM), shortDist(l.lenM));
  if (l.kind === 'bridge') return t('🌉 Köprü {0} ileride ({1})', shortDist(l.dM), shortDist(l.lenM));
  if (l.kind === 'underpass') return t('⬇️ Alt geçit {0} ileride', shortDist(l.dM));
  return t('💰 Ücretli yol {0} ileride', shortDist(l.dM));
};

/** Sert viraj anonsu ve ekran satırı: yön ve keskinlik cümlede (çevirisi dil başına tam cümle). */
const curveSpeech = (s) => (s.hairpin
  ? t(s.dir === 'left' ? '{0} ileride keskin sol dönemeç, yavaşla.' : '{0} ileride keskin sağ dönemeç, yavaşla.', shortDist(s.dKm * 1000))
  : t(s.dir === 'left' ? '{0} ileride sert sol viraj, hızını {1} km/sa civarına düşür.' : '{0} ileride sert sağ viraj, hızını {1} km/sa civarına düşür.', shortDist(s.dKm * 1000), s.adviseKmh));
const curveLine = (c) => t(c.dir === 'left' ? '↰ Sert sol viraj {0} ileride' : '↱ Sert sağ viraj {0} ileride', shortDist(c.dKm * 1000));

/** Konuşma ve gösterim için kısa mesafe: 850 m, 1,2 km (ondalık ayırıcı seçili dile göre). */
const shortDist = (m) => (m < 950 ? `${Math.max(50, Math.round(m / 50) * 50)} m` : `${(m / 1000).toLocaleString(locale(), { maximumFractionDigits: m < 9950 ? 1 : 0 })} km`);

/** Yol olayları (tünel, ücretli yol/gişe, köprü, alt geçit): kalan mesafe her tick'te konumdan yeniden hesaplanır. Rotayı veren sağlayıcının kendi modeli
 *  yalnızca ona aitse kullanılır (başka sağlayıcının verisi bu rotaya bağlanmaz); OSM ekstraları (ayar açıksa) onu tamamlar (nav/roadExtras.js). */
function roadTick(plan, km) {
  const model = plan.route?.roadEvents;
  const own = model && model.provider && plan.route?.routeMeta?.provider === model.provider;
  const xm = on.road && extras?.planId === plan.planId ? extras.model : null;
  const merged = mergeRoadModels(own ? model : null, xm);
  const e = effective();
  const fresh = e.source !== 'live' || getState('live').gps === 'ok';
  if (merged && roadTrack.planId !== plan.planId) roadTrack = { planId: plan.planId, track: plan.route.coords?.length > 1 ? buildTrack(plan.route.coords) : null };
  const keyOf = (ev) => { // coğrafi anahtar: yeniden rota (yeni planId) aynı tüneli/gişeyi 10 dk içinde yeniden söyletmez
    if (roadTrack.planId !== plan.planId || !roadTrack.track) return null;
    const p = pointAtKm(roadTrack.track, (ev.fromM ?? ev.atM) / 1000);
    return `${ev.kind}@${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
  };
  const r = stepRoadAlerts(roadSt, { model: merged, planId: plan.planId, routeKm: km, offRouteKm: getState('engine').offRouteKm, fresh, now: Date.now(), keyOf });
  for (const s of r.speak) speak(roadSpeech(s), { key: 'road:' + s.key, cooldownMs: 10 * 60e3 });
  const l = r.line;
  const text = l ? roadLine(l) : null;
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
      if (key === 'road' && el.checked) extrasTriedFor = null;
      tick();
    });
  };
  bind('warn-grade', 'grade', 'warnGrade');
  bind('warn-cam', 'camera', 'warnCam');
  bind('warn-curve', 'curve', 'warnCurve');
  bind('warn-road', 'road', 'warnRoad');
  setInterval(tick, CHECK_MS);
  subscribe('engine', () => { // her konum güncellemesinde (rota km'si değişince) tünel/gişe mesafesi yenilenir
    const plan = getState('plan');
    if (getState('nav').active && plan.profile && plan.planId === planId) roadTick(plan, getState('engine').routeKm);
  });
}
