import { gfetch } from '../google/api.js';

/** Google kodlu çoklu çizgi (hassasiyet 5) → GeoJSON sırası [lon, lat] dizisi. */
export function decodePolyline(str) {
  const out = [];
  let i = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let shift = 0;
    let result = 0;
    let b;
    do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) {
    lat += next();
    lon += next();
    out.push([lon / 1e5, lat / 1e5]);
  }
  return out;
}

// Routes API manevra adı → [type, modifier] (steps.js okları ve küçük adım ayrımı için)
const MANEUVER = {
  DEPART: ['depart', null],
  NAME_CHANGE: ['new name', 'straight'],
  STRAIGHT: ['continue', 'straight'],
  TURN_LEFT: ['turn', 'left'],
  TURN_RIGHT: ['turn', 'right'],
  TURN_SLIGHT_LEFT: ['turn', 'slight left'],
  TURN_SLIGHT_RIGHT: ['turn', 'slight right'],
  TURN_SHARP_LEFT: ['turn', 'sharp left'],
  TURN_SHARP_RIGHT: ['turn', 'sharp right'],
  UTURN_LEFT: ['turn', 'uturn'],
  UTURN_RIGHT: ['turn', 'uturn'],
  RAMP_LEFT: ['on ramp', 'left'],
  RAMP_RIGHT: ['on ramp', 'right'],
  MERGE: ['merge', null],
  FORK_LEFT: ['fork', 'left'],
  FORK_RIGHT: ['fork', 'right'],
  ROUNDABOUT_LEFT: ['roundabout', 'left'],
  ROUNDABOUT_RIGHT: ['roundabout', 'right'],
  FERRY: ['ferry', null],
  FERRY_TRAIN: ['ferry', null],
  DESTINATION: ['arrive', null],
};

const clean = (t) => String(t || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** Google Routes API (trafik farkında). Dönüş: { coords [[lon,lat]], distanceKm, durationH, steps }. */
/** via: [{lat, lon}] ara duraklar (ör. şarj istasyonu). Her ara noktada 'stop' adımı eklenir; yalnızca son adım 'arrive' olur. */
export async function fetchRoute(start, end, via = []) {
  const wp = (p) => ({ location: { latLng: { latitude: p.lat, longitude: p.lon } } });
  const json = await gfetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    mask: 'routes.distanceMeters,routes.duration,routes.staticDuration,routes.polyline.encodedPolyline,routes.legs.steps.distanceMeters,routes.legs.steps.navigationInstruction',
    body: {
      origin: wp(start),
      destination: wp(end),
      ...(via.length ? { intermediates: via.map(wp) } : {}),
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      polylineQuality: 'HIGH_QUALITY',
      languageCode: 'tr-TR',
      units: 'METRIC',
    },
    timeoutMs: 30000,
  });
  const r = json.routes?.[0];
  if (!r?.polyline?.encodedPolyline) throw new Error('Rota bulunamadı (Google yanıtı boş)');
  const legs = r.legs || [];
  const steps = legs.flatMap((l, i) => {
    const mapped = (l.steps || []).map((st) => {
      const [type, modifier] = MANEUVER[st.navigationInstruction?.maneuver] || ['continue', 'straight'];
      return { type, modifier, text: clean(st.navigationInstruction?.instructions), distM: st.distanceMeters || 0 };
    });
    if (i === legs.length - 1) return mapped;
    // ara nokta: Google'ın "varış" adımını at, yerine kendi 'stop' adımımızı koy (navigasyon burada bitmesin)
    return [...mapped.filter((st) => st.type !== 'arrive'), { type: 'stop', modifier: null, text: 'Ara durağa ulaştınız', distM: 0 }];
  });
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i].type === 'arrive') steps.splice(i, 1); // Google'ın varış adımı yerine tek, kendi adımımız
  steps.push({ type: 'arrive', modifier: null, text: 'Varış noktasına ulaştınız', distM: 0 });
  return {
    coords: decodePolyline(r.polyline.encodedPolyline),
    distanceKm: (r.distanceMeters || 0) / 1000,
    durationH: parseFloat(r.duration) / 3600,
    // trafikli süre / trafiksiz süre (≥ 1): rotanın ortalama yavaşlaması
    trafficRatio: r.staticDuration ? Math.max(1, parseFloat(r.duration) / parseFloat(r.staticDuration)) : 1,
    steps,
  };
}
