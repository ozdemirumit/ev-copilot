// Google ile yer/adres arama: Places API (New) Autocomplete + Place Details (oturum belirteciyle: arama oturumu tek faturalanır),
// ters arama için Geocoding API. Sağlayıcı katmanı (providers/google.js) bunları ortak arayüze bağlar.
import { gfetch, GoogleError } from './api.js';
import { googleKey } from './loader.js';
import { record } from './usage.js';
import { cached, TTL } from '../utils/cache.js';

/** Öneriler: [{ label, sub, placeId }] (koordinat yok; seçilince resolvePlace ile alınır). */
export async function searchPlaces(q, token) {
  const json = await cached(`ac:${q.toLowerCase()}`, TTL.route, () => gfetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    body: { input: q, languageCode: 'tr', sessionToken: token },
  }), { persist: false }); // aynı metni tekrar yazınca/geri silince Google'a gidilmez
  return (json.suggestions || [])
    .filter((s) => s.placePrediction)
    .map((s) => {
      const p = s.placePrediction;
      const main = p.structuredFormat?.mainText?.text || p.text?.text || '?';
      return { label: main, sub: p.structuredFormat?.secondaryText?.text || '', placeId: p.placeId };
    })
    .slice(0, 8);
}

/** Seçilen önerinin koordinatı (Place Details: yalnızca konum alanı). */
export async function resolvePlace(s, token) {
  const j = await cached(`pd:${s.placeId}`, TTL.long, () => gfetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(s.placeId)}?languageCode=tr&sessionToken=${encodeURIComponent(token)}`, {
    mask: 'location', // yalnızca konum: Essentials fiyatı (ad alanı Pro'dur, adı zaten öneriden biliyoruz)
  }));
  if (j.location?.latitude == null) throw new GoogleError('Yerin konumu alınamadı');
  return { ...s, lat: j.location.latitude, lon: j.location.longitude };
}

/** Haritadan seçilen noktaya okunur ad (Geocoding API). Başarısızsa null. */
export async function reverseLabel(lat, lon) {
  const key = googleKey();
  if (!key) return null;
  try {
    return await cached(`rg:${lat.toFixed(4)},${lon.toFixed(4)}`, TTL.long, () => geocode(lat, lon, key));
  } catch {
    return null;
  }
}

async function geocode(lat, lon, key) {
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&language=tr&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(8000) });
    const j = await res.json();
    if (j.status === 'OK' || j.status === 'ZERO_RESULTS') record('geocode');
    if (j.status !== 'OK') return null;
    const r = j.results.find((x) => !x.types.includes('plus_code')) || j.results[0];
    return r.formatted_address.split(', ').slice(0, 3).join(', ');
  } catch {
    return null;
  }
}
