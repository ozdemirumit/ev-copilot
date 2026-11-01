// Mapbox Directions (driving-traffic): canlı trafikli rota. Adım türleri/değiştiricileri OSRM ile aynıdır (Valhalla'yla aynı sözlük);
// talimat metni Mapbox'ın dil desteğine bağlı kalmamak için burada Türkçe kurulur. Süreler canlı trafiği içerir.
import { cached, TTL } from '../utils/cache.js';
import { decodePolyline6 } from '../osm/route.js';
import { mbfetch } from './api.js';

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
function mapSteps(legs) {
  const steps = legs.flatMap((l, i) => {
    const mapped = (l.steps || []).map((st) => {
      const m = st.maneuver || {};
      const exitRound = m.type === 'exit roundabout' || m.type === 'exit rotary'; // girişte "kaçıncı çıkış" söylendi
      const type = exitRound ? 'continue' : KNOWN.has(m.type) ? m.type : 'continue';
      const modifier = exitRound ? 'straight' : m.modifier || null;
      return {
        type, modifier, text: trText(type, modifier, st.name, m.exit),
        distM: st.distance || 0,
        staticSec: st.duration || 0, // canlı trafikli süre: hız profili yavaş kesimleri buradan görür
      };
    });
    if (i === legs.length - 1) return mapped;
    return [...mapped.filter((st) => st.type !== 'arrive'), { type: 'stop', modifier: null, text: 'Ara durağa ulaştınız', distM: 0 }];
  });
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i].type === 'arrive') steps.splice(i, 1);
  steps.push({ type: 'arrive', modifier: null, text: 'Varış noktasına ulaştınız', distM: 0 });
  return steps;
}

const lonlat = (p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`;

/**
 * Trafikli rota. Dönüş: { coords [[lon,lat]], intervals [], distanceKm, durationH, trafficRatio (canlı / olağan süre, ≥ 1), live: true, steps }.
 * via: [{lat, lon}] ara duraklar (Mapbox en çok 25 nokta kabul eder).
 */
export function fetchRoute(start, end, via = []) {
  const k = (p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
  return cached(`mrt:${k(start)}>${k(end)}|${via.map(k).join(';')}`, TTL.route, () => routeFromMapbox(start, end, via), { persist: false });
}

async function routeFromMapbox(start, end, via) {
  const coords = [start, ...via, end].map(lonlat).join(';');
  const json = await mbfetch(`/directions/v5/mapbox/driving-traffic/${coords}`, {
    geometries: 'polyline6', overview: 'full', steps: 'true', roundabout_exits: 'true', alternatives: 'false',
  }, { timeoutMs: 40000 });
  const r = json.routes?.[0];
  if (!r?.geometry) throw new Error('Mapbox rota bulamadı');
  const typical = r.duration_typical;
  return {
    coords: decodePolyline6(r.geometry),
    intervals: [], // yavaşlama zaten adım sürelerinde
    distanceKm: (r.distance || 0) / 1000,
    durationH: (r.duration || 0) / 3600,
    trafficRatio: typical > 0 ? Math.max(1, r.duration / typical) : 1,
    live: true,
    steps: mapSteps(r.legs || []),
  };
}

/** Bitişik yoğun/yavaş kesimlerin ilk önemli kümesi (km, konumdan itibaren): { from, to, jam }. */
export function findJam(distances, congestion, maxAheadKm = 150) {
  const spans = [];
  let km = 0;
  for (let i = 0; i < distances.length; i++) {
    const from = km;
    km += (distances[i] || 0) / 1000;
    const c = congestion[i];
    if (c !== 'moderate' && c !== 'heavy' && c !== 'severe') continue;
    const jam = c === 'heavy' || c === 'severe';
    const last = spans.at(-1);
    if (last && from - last.to < 0.5) { last.to = km; last.jam ||= jam; } else spans.push({ from, to: km, jam });
  }
  // Önemli: sıkışık ≥ 0,5 km ya da yavaş ≥ 3 km
  return spans.find((s) => s.from <= maxAheadKm && s.to - s.from >= (s.jam ? 0.5 : 3)) || null;
}

/** Konumdan varışa canlı trafik: { jam: {from,to,jam}|null, delayMin, remainH } veya rota yoksa null. */
export async function fetchTrafficAhead(from, to) {
  const json = await mbfetch(`/directions/v5/mapbox/driving-traffic/${lonlat(from)};${lonlat(to)}`, {
    overview: 'false', annotations: 'distance,congestion', alternatives: 'false',
  }, { timeoutMs: 30000 });
  const r = json.routes?.[0];
  if (!r) return null;
  const dist = [];
  const cong = [];
  for (const l of r.legs || []) { dist.push(...(l.annotation?.distance || [])); cong.push(...(l.annotation?.congestion || [])); }
  return {
    jam: findJam(dist, cong),
    delayMin: r.duration_typical > 0 ? Math.max(0, Math.round((r.duration - r.duration_typical) / 60)) : 0,
    remainH: r.duration / 3600,
  };
}
