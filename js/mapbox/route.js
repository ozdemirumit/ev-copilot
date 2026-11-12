// Mapbox Directions (driving-traffic): canlı trafikli rota. Adım türleri/değiştiricileri OSRM ile aynıdır (Valhalla'yla aynı sözlük);
// talimat metni Mapbox'ın dil desteğine bağlı kalmamak için burada Türkçe kurulur. Süreler canlı trafiği içerir.
import { cached, TTL } from '../utils/cache.js';
import { decodePolyline6 } from '../osm/route.js';
import { mbfetch } from './api.js';
import { premiumAccess } from '../net/proxy.js';
import { kphFromMapbox, mergeSegments } from '../nav/limitSpans.js';
import { haversineKm } from '../utils/geo.js';
import { parseLanes } from '../nav/lanes.js';

const DIR = {
  left: 'sola', right: 'sağa', 'slight left': 'hafifçe sola', 'slight right': 'hafifçe sağa',
  'sharp left': 'keskin sola', 'sharp right': 'keskin sağa', straight: 'düz', uturn: 'geri',
};
const cap = (s) => s.charAt(0).toLocaleUpperCase('tr') + s.slice(1);
const KNOWN = new Set(['depart', 'arrive', 'turn', 'new name', 'continue', 'merge', 'on ramp', 'off ramp', 'fork', 'end of road', 'roundabout', 'rotary', 'notification']);

/** Mapbox manevrası → Türkçe talimat. */
export function trText(type, modifier, name, exit) {
  const road = name ? ` (${name})` : '';
  const dir = DIR[modifier];
  switch (type) {
    case 'depart': return `Yola çıkın${road}`;
    case 'arrive': return 'Varış noktasına ulaştınız';
    case 'turn':
      if (modifier === 'uturn') return `U dönüşü yapın${road}`;
      return (!dir || modifier === 'straight' ? 'Düz devam edin' : `${cap(dir)} dönün`) + road;
    case 'end of road': return `Yolun sonunda ${dir && modifier !== 'straight' ? dir + ' ' : ''}dönün${road}`;
    case 'fork': return `Yol ayrımında ${dir ? dir + ' ' : ''}devam edin${road}`;
    case 'merge': return `Yola katılın${road}`;
    case 'on ramp': return `${dir ? cap(dir) + ' ' : ''}bağlantı yoluna girin${road}`;
    case 'off ramp': return `Çıkıştan ayrılın${dir ? ` (${dir})` : ''}${road}`;
    case 'roundabout':
    case 'rotary': return exit ? `Kavşağa girin, ${exit}. çıkıştan çıkın` : 'Kavşağa girin';
    default: return `Düz devam edin${road}`;
  }
}

/** Adım dizisi (leg başına) → uygulamanın adım biçimi; ara duraklarda 'stop' adımı, yalnızca son adım 'arrive'. */
export function mapSteps(legs) {
  const steps = legs.flatMap((l, i) => {
    const mapped = (l.steps || []).map((st) => {
      const m = st.maneuver || {};
      const exitRound = m.type === 'exit roundabout' || m.type === 'exit rotary'; // girişte "kaçıncı çıkış" söylendi
      const type = exitRound ? 'continue' : KNOWN.has(m.type) ? m.type : 'continue';
      const modifier = exitRound ? 'straight' : m.modifier || null;
      return {
        type, modifier, text: trText(type, modifier, st.name, m.exit), road: st.name || '',
        distM: st.distance || 0,
        staticSec: st.duration || 0, // canlı trafikli süre: hız profili yavaş kesimleri buradan görür
        lanes: parseLanes(st.intersections?.[0]?.lanes), // sağlayıcı şerit verisi (yoksa null)
      };
    });
    if (i === legs.length - 1) return mapped;
    return [...mapped.filter((st) => st.type !== 'arrive'), { type: 'stop', modifier: null, text: 'Ara durağa ulaştınız', distM: 0 }];
  });
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i].type === 'arrive') steps.splice(i, 1);
  steps.push({ type: 'arrive', modifier: null, text: 'Varış noktasına ulaştınız', distM: 0 });
  return steps;
}

/** Mapbox yoğunluk (annotation) dizileri → rotada km aralıkları: [{ from, to, lvl: 'moderate' | 'heavy' | 'severe' }]. Uzunluğa göre eşlenir (koordinat sayısına bağlı değil). */
export function trafficSpans(legs) {
  const spans = [];
  let km = 0;
  for (const l of legs) {
    const dist = l.annotation?.distance || [];
    const cong = l.annotation?.congestion || [];
    for (let i = 0; i < dist.length; i++) {
      const from = km;
      km += (dist[i] || 0) / 1000;
      const lvl = cong[i];
      if (lvl !== 'moderate' && lvl !== 'heavy' && lvl !== 'severe') continue;
      const last = spans.at(-1);
      if (last && last.lvl === lvl && from - last.to < 0.05) last.to = km; else spans.push({ from, to: km, lvl });
    }
  }
  return spans.filter((s) => s.to - s.from >= 0.15);
}

/**
 * Mapbox maxspeed ek açıklaması → hız limiti kesimleri [[lat1, lon1, lat2, lon2, kph]] (nav/limitSpans.js biçimi; Premium navigasyonda HERE'den sonra 2. kaynak).
 * Ek açıklamanın i. öğesi rota çizgisinin i. parçasıdır; sayı tutmazsa (bacak birleşimi vb.) parçalar birikimli mesafeyle eşlenir.
 * Bilinmeyen ({unknown}/{none}) ya da 5..150 dışı değerler kesim üretmez.
 */
export function maxspeedSpans(coords, legs) {
  const ms = (legs || []).flatMap((l) => l.annotation?.maxspeed || []);
  if (!ms.length || !Array.isArray(coords) || coords.length < 2) return [];
  const pts = coords.map(([lon, lat]) => [lat, lon]);
  const ann = ms.map(kphFromMapbox);
  if (ann.length === pts.length - 1) return mergeSegments(pts, ann);
  const dist = (legs || []).flatMap((l) => l.annotation?.distance || []);
  if (dist.length !== ann.length) return [];
  const annCum = [0];
  for (const d of dist) annCum.push(annCum.at(-1) + (Number(d) || 0) / 1000);
  const segKm = pts.slice(1).map((p, i) => haversineKm({ lat: pts[i][0], lon: pts[i][1] }, { lat: p[0], lon: p[1] }));
  const total = segKm.reduce((a, b) => a + b, 0);
  const scale = total > 0 ? annCum.at(-1) / total : 1; // iki uzunluk ölçümü arasındaki küçük farkı dengele
  const kph = [];
  let km = 0;
  let a = 0;
  for (const len of segKm) {
    const mid = (km + len / 2) * scale; // parçanın orta noktası hangi ek açıklama aralığında
    while (a < ann.length - 1 && annCum[a + 1] <= mid) a++;
    kph.push(ann[a]);
    km += len;
  }
  return mergeSegments(pts, kph);
}

const lonlat = (p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`;

/**
 * Trafikli rota. Dönüş: { coords [[lon,lat]], intervals [], distanceKm, durationH, trafficRatio (canlı / olağan süre, ≥ 1), live: true, steps }.
 * via: [{lat, lon}] ara duraklar (Mapbox en çok 25 nokta kabul eder).
 */
export function fetchRoute(start, end, via = []) {
  const k = (p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
  const prem = premiumAccess(); // hız limiti (maxspeed) yalnızca Premium'da istenir; önbellek anahtarında plan ayrı (ücretsiz rota Premium'a verilmez, tersi de)
  return cached(`mrt:${prem ? 'p' : 'f'}:${k(start)}>${k(end)}|${via.map(k).join(';')}`, TTL.route, () => routeFromMapbox(start, end, via, prem), { persist: false });
}

async function routeFromMapbox(start, end, via, prem = false) {
  const coords = [start, ...via, end].map(lonlat).join(';');
  const json = await mbfetch(`/directions/v5/mapbox/driving-traffic/${coords}`, {
    geometries: 'polyline6', overview: 'full', steps: 'true', roundabout_exits: 'true', alternatives: 'false', annotations: prem ? 'distance,congestion,maxspeed' : 'distance,congestion',
  }, { timeoutMs: 40000 });
  const r = json.routes?.[0];
  if (!r?.geometry) throw new Error('Mapbox rota bulamadı');
  const typical = r.duration_typical;
  const line = decodePolyline6(r.geometry);
  const out = {
    coords: line,
    intervals: [], // yavaşlama zaten adım sürelerinde
    distanceKm: (r.distance || 0) / 1000,
    durationH: (r.duration || 0) / 3600,
    trafficRatio: typical > 0 ? Math.max(1, r.duration / typical) : 1,
    trafficSpans: trafficSpans(r.legs || []), // rota çizgisinin renklendirilmesi için (yavaş sarı, yoğun kırmızı)
    live: true,
    steps: mapSteps(r.legs || []),
  };
  if (prem) out.limitSpans = maxspeedSpans(line, r.legs || []); // Premium navigasyonda yol hız limiti (HERE bilmeyen yerde); ücretsizde alan yok (eski biçim)
  return out;
}
