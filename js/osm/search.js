// Yer arama ve ters adres Photon'dan (OpenStreetMap verisi, anahtarsız). Öneri yanıtı koordinatı da taşır,
// bu yüzden ayrı bir ayrıntı çağrısı gerekmez (resolvePlace yalnızca arayüz uyumu içindir).
import { cached, TTL } from '../utils/cache.js';

const BASE = 'https://photon.komoot.io';

/** Photon özellik alanlarından okunur ad ve alt satır. */
function describe(p) {
  const main = p.name || [p.street, p.housenumber].filter(Boolean).join(' ') || p.city || p.state || '?';
  const sub = [p.street && p.name ? p.street : null, p.district, p.city, p.state, p.country].filter((x) => x && x !== main);
  return { label: main, sub: [...new Set(sub)].slice(0, 3).join(', ') };
}

async function photon(path) {
  const res = await fetch(BASE + path, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(res.status === 429 ? 'Photon: istek sınırı, biraz bekle' : `Photon HTTP ${res.status}`);
  return res.json();
}

/** Öneriler: [{ label, sub, lat, lon }] (koordinat öneriyle gelir). Konum verilirse yakın sonuçlar öne çıkar. */
export async function searchPlaces(q, _token, near = null) {
  const bias = near ? `&lat=${near.lat.toFixed(2)}&lon=${near.lon.toFixed(2)}` : '';
  const json = await cached(`oac:${q.toLowerCase()}:${bias}`, TTL.route, () => photon(`/api/?q=${encodeURIComponent(q)}&limit=8${bias}`), { persist: false });
  return (json.features || []).filter((f) => f.geometry?.coordinates).map((f) => ({
    ...describe(f.properties || {}),
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  })).slice(0, 8);
}

/** Öneri zaten koordinat taşır. */
export async function resolvePlace(s) {
  if (s.lat == null) throw new Error('Yerin konumu alınamadı');
  return s;
}

/** Haritadan seçilen noktaya okunur ad. Başarısızsa null. */
export async function reverseLabel(lat, lon) {
  try {
    return await cached(`org:${lat.toFixed(4)},${lon.toFixed(4)}`, TTL.long, async () => {
      const json = await photon(`/reverse?lat=${lat}&lon=${lon}`);
      const p = json.features?.[0]?.properties;
      if (!p) return null;
      const d = describe(p);
      return [d.label, d.sub.split(', ')[0]].filter(Boolean).join(', ');
    });
  } catch {
    return null;
  }
}
