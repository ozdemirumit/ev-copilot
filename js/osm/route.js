// Rota Valhalla'dan (OpenStreetMap yol verisi; FOSSGIS herkese açık sunucusu, anahtarsız). OSRM biçimi istenir:
// adım türleri/değiştiricileri uygulamanın talimat sözlüğüyle aynıdır, metinler Türkçe gelir. Canlı trafik YOKTUR: süreler serbest akış.
import { getLang, langInfo } from '../i18n/index.js';
import { cached, TTL } from '../utils/cache.js';
import { valhalla } from './valhalla.js';

/** Valhalla/OSRM kodlu çizgi (hassasiyet 1e6, [lat, lon]) → GeoJSON sırası [lon, lat] dizisi. */
export function decodePolyline6(str) {
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
    out.push([lon / 1e6, lat / 1e6]);
  }
  return out;
}

const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();

const BACK = { ne: 'na', nde: 'nda', ni: 'nı' }; // art ünlüde (a ı o u) ek kalınlaşır
const TURN_TR = {
  left: 'Sola dönün.', right: 'Sağa dönün.', 'slight left': 'Hafifçe sola dönün.', 'slight right': 'Hafifçe sağa dönün.',
  'sharp left': 'Keskin sola dönün.', 'sharp right': 'Keskin sağa dönün.', straight: 'Düz devam edin.', uturn: 'U dönüşü yapın.',
};

/**
 * Valhalla'nın Türkçe şablonu iki kusur bırakır: yol adı zaten "…Caddesi" ise sonuna ikinci bir "caddesi" ekler
 * ("Ankara Caddesi caddesine"), adı olmayan dönüşlerde yalnızca "sağ." yazar. İkisi burada düzeltilir.
 */
export function polishText(text, modifier) {
  let t = clean(text);
  if (getLang() !== 'tr') return t || 'Devam edin.'; // Türkçe düzeltmeler yalnızca Türkçe şablon için (öteki dillerde Valhalla metni olduğu gibi)
  t = t.replace(/(\p{L}*(?:Caddesi|Sokağı|Bulvarı|Yolu|Sokak|Cadde|Bulvar|Yol)) caddesi(ne|nde|ni)?(?=[\s.,]|$)/giu, (_, name, suf) => {
    if (!suf) return name;
    const vowel = [...name.toLocaleLowerCase('tr')].reverse().find((c) => 'aıoueiöü'.includes(c));
    return `${name}'${'aıou'.includes(vowel) ? BACK[suf] : suf}`;
  });
  if (t.split(' ').length < 2) t = TURN_TR[modifier] || 'Devam edin.';
  return t;
}

/**
 * Rota. Dönüş: { coords [[lon,lat]], intervals [], distanceKm, durationH, trafficRatio: 1, steps }.
 * via: [{lat, lon}] ara duraklar (ör. şarj istasyonu): her birinde 'stop' adımı eklenir, yalnızca son adım 'arrive' olur.
 */
export function fetchRoute(start, end, via = []) {
  const k = (p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
  return cached(`ort:${getLang()}:${k(start)}>${k(end)}|${via.map(k).join(';')}`, TTL.route, () => routeFromValhalla(start, end, via), { persist: false });
}

async function routeFromValhalla(start, end, via) {
  const loc = (p, type) => ({ lat: p.lat, lon: p.lon, type });
  const json = await valhalla('/route', {
    locations: [loc(start, 'break'), ...via.map((p) => loc(p, 'break')), loc(end, 'break')],
    costing: 'auto',
    format: 'osrm',
    shape_format: 'polyline6',
    banner_instructions: false,
    directions_options: { language: langInfo().route },
  });
  const r = json.routes?.[0];
  if (!r?.geometry) throw new Error('Rota bulunamadı (sunucu yanıtı boş)');
  const legs = r.legs || [];
  const steps = legs.flatMap((l, i) => {
    const mapped = (l.steps || []).map((st) => {
      const exitRound = st.maneuver?.type === 'exit roundabout'; // girişte "kaçıncı çıkış" zaten söylendi: ikinci duyuru gereksiz
      const modifier = exitRound ? 'straight' : st.maneuver?.modifier || null;
      return {
        type: exitRound ? 'continue' : st.maneuver?.type || 'continue',
        modifier,
        text: polishText(st.maneuver?.instruction, modifier),
        distM: st.distance || 0,
        staticSec: st.duration || 0, // serbest akış süresi
      };
    });
    if (i === legs.length - 1) return mapped;
    return [...mapped.filter((st) => st.type !== 'arrive'), { type: 'stop', modifier: null, text: 'Ara durağa ulaştınız', distM: 0 }];
  });
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i].type === 'arrive') steps.splice(i, 1);
  steps.push({ type: 'arrive', modifier: null, text: 'Varış noktasına ulaştınız', distM: 0 });
  return {
    coords: decodePolyline6(r.geometry),
    intervals: [], // trafik verisi yok
    distanceKm: (r.distance || 0) / 1000,
    durationH: (r.duration || 0) / 3600,
    trafficRatio: 1,
    steps,
  };
}
