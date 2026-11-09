// TomTom Routing API v1 (canlı trafikli rota), ara sunucu üzerinden (GET /tomtom/route?pts=lat,lon:lat,lon; anahtar sunucuda kalır, yalnızca Premium).
// Yanıt, Mapbox rotasıyla AYNI biçime çevrilir: { coords [[lon,lat]], intervals [], distanceKm, durationH, trafficRatio, trafficSpans, live: true, steps, limitSpans }.
// Talimat metni Mapbox gibi burada Türkçe kurulur (trText); TomTom'un kendi "message" metni kullanılmaz (sözlük aynı kalsın).
import { cached, TTL } from '../utils/cache.js';
import { proxyFetch } from '../net/proxy.js';
import { trText } from '../mapbox/route.js';
import { mergeSegments } from '../nav/limitSpans.js';
import { haversineKm } from '../utils/geo.js';

export class TomTomError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

// TomTom manevra kodu → uygulamanın adım türü/değiştiricisi (Mapbox/Valhalla sözlüğü). Bilinmeyen kod "düz devam" olur.
const MAP = {
  DEPART: ['depart', null],
  ARRIVE: ['arrive', null], ARRIVE_LEFT: ['arrive', 'left'], ARRIVE_RIGHT: ['arrive', 'right'],
  TURN_LEFT: ['turn', 'left'], TURN_RIGHT: ['turn', 'right'],
  SHARP_LEFT: ['turn', 'sharp left'], SHARP_RIGHT: ['turn', 'sharp right'],
  BEAR_LEFT: ['turn', 'slight left'], BEAR_RIGHT: ['turn', 'slight right'],
  KEEP_LEFT: ['fork', 'left'], KEEP_RIGHT: ['fork', 'right'],
  SWITCH_PARALLEL_ROAD_LEFT: ['fork', 'left'], SWITCH_PARALLEL_ROAD_RIGHT: ['fork', 'right'],
  SWITCH_MAIN_ROAD_LEFT: ['fork', 'left'], SWITCH_MAIN_ROAD_RIGHT: ['fork', 'right'],
  STRAIGHT: ['continue', 'straight'], FOLLOW: ['continue', 'straight'],
  ENTER_MOTORWAY: ['on ramp', null], ENTER_FREEWAY: ['on ramp', null], ENTER_HIGHWAY: ['on ramp', null],
  TAKE_EXIT: ['off ramp', null], MOTORWAY_EXIT_LEFT: ['off ramp', 'left'], MOTORWAY_EXIT_RIGHT: ['off ramp', 'right'],
  ROUNDABOUT_CROSS: ['roundabout', null], ROUNDABOUT_LEFT: ['roundabout', null], ROUNDABOUT_RIGHT: ['roundabout', null], ROUNDABOUT_BACK: ['roundabout', null],
  MAKE_UTURN: ['turn', 'uturn'], TRY_MAKE_UTURN: ['turn', 'uturn'],
  WAYPOINT_LEFT: ['stop', null], WAYPOINT_RIGHT: ['stop', null], WAYPOINT_AHEAD: ['stop', null],
};
export const mapManeuver = (code) => MAP[code] || ['continue', 'straight'];

/** Rota noktaları (leg birleşimi): { pts [[lat,lon]] (tekrarlı, TomTom dizinleriyle aynı), keep (tekrarlı noktalar elenmiş çıktı dizinleri) }. */
function joinLegs(legs) {
  const pts = [];
  for (const l of legs) for (const p of l.points || []) pts.push([p.latitude, p.longitude]);
  return pts;
}

/** Ardışık aynı nokta (leg birleşimi) elenir: dönüş { coords [[lon,lat]], keepIdx (kalan noktaların özgün dizinleri) }. */
function dedupe(pts) {
  const coords = [];
  const keepIdx = [];
  pts.forEach((p, i) => {
    const q = pts[i - 1];
    if (q && q[0] === p[0] && q[1] === p[1]) return;
    coords.push([p[1], p[0]]);
    keepIdx.push(i);
  });
  return { coords, keepIdx };
}

/** Adımlar: talimat başına { type, modifier, text, road, distM, staticSec }; ara durak 'stop', son adım 'arrive' (Mapbox ile aynı kurallar). */
export function mapSteps(instructions, totalM, totalSec) {
  const ins = Array.isArray(instructions) ? instructions : [];
  const steps = [];
  ins.forEach((it, i) => {
    const [type, modifier] = mapManeuver(it.maneuver);
    if (type === 'arrive') return; // tek 'arrive' en sonda eklenir
    const next = ins[i + 1];
    const distM = Math.max(0, (next ? next.routeOffsetInMeters : totalM) - (it.routeOffsetInMeters || 0));
    const staticSec = Math.max(0, (next ? next.travelTimeInSeconds : totalSec) - (it.travelTimeInSeconds || 0));
    if (type === 'stop') { steps.push({ type: 'stop', modifier: null, text: 'Ara durağa ulaştınız', distM, staticSec, road: '' }); return; }
    steps.push({ type, modifier, text: trText(type, modifier, it.street || '', it.roundaboutExitNumber), road: it.street || '', distM, staticSec });
  });
  steps.push({ type: 'arrive', modifier: null, text: 'Varış noktasına ulaştınız', distM: 0 });
  return steps;
}

const LEVEL = { 1: 'moderate', 2: 'heavy', 3: 'severe', 4: 'severe' }; // magnitudeOfDelay: 1 küçük, 2 orta, 3 büyük, 4 tanımsız/kapalı

/** TRAFFIC bölümleri → rotada km aralıkları [{ from, to, lvl }] (Mapbox trafficSpans ile aynı biçim; < 150 m olanlar atılır). */
export function trafficSpans(sections, pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversineKm({ lat: pts[i - 1][0], lon: pts[i - 1][1] }, { lat: pts[i][0], lon: pts[i][1] }));
  const spans = [];
  for (const s of (sections || []).filter((x) => x.sectionType === 'TRAFFIC')) {
    const lvl = LEVEL[s.magnitudeOfDelay] || (s.simpleCategory === 'ROAD_CLOSURE' ? 'severe' : null);
    if (!lvl || !(s.delayInSeconds > 0 || s.simpleCategory === 'ROAD_CLOSURE')) continue;
    const from = cum[Math.max(0, s.startPointIndex)] ?? 0;
    const to = cum[Math.min(pts.length - 1, s.endPointIndex)] ?? from;
    const last = spans.at(-1);
    if (last && last.lvl === lvl && from - last.to < 0.05) last.to = to; else spans.push({ from, to, lvl });
  }
  return spans.filter((s) => s.to - s.from >= 0.15);
}

/** SPEED_LIMIT bölümleri → hız limiti kesimleri [[lat1, lon1, lat2, lon2, kph]] (nav/limitSpans.js biçimi). keepIdx: tekrarlı noktalar elendikten sonra kalan özgün dizinler. */
export function limitSpans(sections, pts, keepIdx) {
  const kphAt = new Array(Math.max(0, pts.length - 1)).fill(null); // özgün parça j: pts[j] → pts[j+1]
  for (const s of (sections || []).filter((x) => x.sectionType === 'SPEED_LIMIT')) {
    const kph = Number(s.maxSpeedLimitInKmh);
    if (!(kph >= 5 && kph <= 150)) continue; // bilinmeyen/anlamsız değer kesim üretmez
    for (let j = Math.max(0, s.startPointIndex); j < Math.min(kphAt.length, s.endPointIndex); j++) kphAt[j] = kph;
  }
  const kph = [];
  for (let k = 0; k < keepIdx.length - 1; k++) kph.push(kphAt[keepIdx[k + 1] - 1] ?? null); // kalan k → k+1 parçasının sonu özgün nokta keepIdx[k+1]: özgün parça keepIdx[k+1]-1 (tekrarlı nokta atlanmışsa gerçek parça)
  return mergeSegments(keepIdx.map((i) => pts[i]), kph);
}

/** TomTom yanıtı → uygulama rota biçimi. prem: hız limiti kesimleri eklenir. */
export function convertRoute(json, prem = true) {
  const r = json?.routes?.[0];
  if (!r?.legs?.length) throw new TomTomError('TomTom rota bulamadı');
  const pts = joinLegs(r.legs);
  if (pts.length < 2) throw new TomTomError('TomTom rota bulamadı');
  const { coords, keepIdx } = dedupe(pts);
  const s = r.summary || {};
  const typical = s.historicTrafficTravelTimeInSeconds;
  const out = {
    coords,
    intervals: [], // yavaşlama zaten adım sürelerinde
    distanceKm: (s.lengthInMeters || 0) / 1000,
    durationH: (s.travelTimeInSeconds || 0) / 3600,
    trafficRatio: typical > 0 ? Math.max(1, (s.travelTimeInSeconds || 0) / typical) : 1,
    trafficSpans: trafficSpans(r.sections, pts),
    live: true,
    steps: mapSteps(r.guidance?.instructions, s.lengthInMeters || 0, s.travelTimeInSeconds || 0),
  };
  if (prem) out.limitSpans = limitSpans(r.sections, pts, keepIdx);
  return out;
}

const pt = (p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;

/** Trafikli rota (Mapbox fetchRoute ile aynı imza). via: en çok 24 ara durak. Hata TomTomError (status: HTTP kodu ya da 0). */
export function fetchRoute(start, end, via = []) {
  const pts = [start, ...via.slice(0, 24), end].map(pt).join(':');
  return cached(`ttr:${pts}`, TTL.route, async () => {
    let res;
    try {
      res = await proxyFetch(`/tomtom/route?pts=${encodeURIComponent(pts)}`, { signal: AbortSignal.timeout(45000) });
    } catch (err) {
      throw new TomTomError(err.name === 'TimeoutError' ? 'TomTom yanıt vermedi (zaman aşımı)' : 'Ara sunucuya ulaşılamadı');
    }
    if (res.status === 402) throw new TomTomError('TomTom hakkı doldu ya da Premium gerekli', 402);
    if (res.status === 429) throw new TomTomError('TomTom günlük rota hakkı doldu', 429);
    if (!res.ok) throw new TomTomError(`TomTom HTTP ${res.status}`, res.status);
    return convertRoute(await res.json(), true);
  }, { persist: false });
}
