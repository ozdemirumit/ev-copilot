// Yol önü sesli uyarıları (dik eğim, hız kamerası). Navigasyon açıkken rotadaki konuma göre çalışır.
//  - Dik eğim: rota profilinden (rakım verisi) hesaplanır, internet gerekmez; kesime 0,5–2,2 km kala bir kez uyarır.
//  - Hız kamerası: OpenStreetMap'te işaretli kameralar (eksik olabilir); 1 km ve 300 m kala uyarır.
// Yağış, trafik ve hız eşiği uyarıları nav/ahead.js içindedir. Kaza ve mobil kamera verisi ücretsiz kaynakta yoktur.
import { getState, patch } from '../state.js';
import { load, save } from '../utils/storage.js';
import { speak } from '../advisor/voice.js';
import { fetchCameras } from '../osm/cameras.js';
import { buildTrack, locate } from './track.js';
import { steepSections, pickWarnings, dedupeCams, distText } from './warnLogic.js';

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
    if (nav.ahead.grade || nav.ahead.cam) setAhead({ grade: null, cam: null });
    return;
  }
  if (plan.planId !== planId) { // yeni rota: kesimleri hesapla, kameraları (varsa) yükle
    planId = plan.planId;
    sections = steepSections(plan.profile.segs || []);
    cams = [];
    said = new Set();
    camTriedFor = null;
    setAhead({ grade: null, cam: null });
  }
  if (on.camera && camTriedFor !== planId && !camBusy) { // kamera uyarısı sonradan açıldıysa da yüklenir; rota başına bir deneme
    camTriedFor = planId;
    loadCams(plan);
  }
  const km = getState('engine').routeKm;
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
}
