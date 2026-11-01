// Yer arama: Photon (yazarken hızlı öneri, kısmi yazıya dayanıklı) + Nominatim (Türkçe/yabancı adlar: "Selanik", "Münih"
// gibi OSM'de name:tr olarak kayıtlı adlarla da bulur). Photon önce gelir; Nominatim biraz sonra eklenir (kullanım politikası:
// en çok saniyede 1 istek, yazarken sürekli sorgu yok: yazma durunca bir kez). Ters adres Photon'dan. Anahtarsız, OpenStreetMap verisi.
// Öneri yanıtı koordinatı da taşır, bu yüzden ayrı bir ayrıntı çağrısı gerekmez (resolvePlace yalnızca arayüz uyumu içindir).
import { getLang, langInfo } from '../i18n/index.js';
import { cached, TTL } from '../utils/cache.js';
import { haversineKm } from '../utils/geo.js';

const BASE = 'https://photon.komoot.io';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const NOM_QUIET_MS = 600; // yazma bu kadar durmadan Nominatim'e gidilmez
const NOM_GAP_MS = 1100; // iki Nominatim isteği arası en az
let nomSeq = 0;
let nomLast = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** Nominatim sonucu → öneri (Türkçe ad; alt satır: şehir/il/ülke). */
function describeNominatim(r) {
  const a = r.address || {};
  const main = r.name || (r.display_name || '').split(',')[0] || '?';
  const place = a.city || a.town || a.village || a.municipality || a.county;
  const sub = [place, a.state, a.country].filter((x) => x && x !== main);
  return { label: main, sub: [...new Set(sub)].slice(0, 3).join(', '), lat: Number(r.lat), lon: Number(r.lon), importance: r.importance || 0 };
}

async function nominatim(q) {
  const wait = nomLast + NOM_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  nomLast = Date.now();
  const res = await fetch(`${NOMINATIM}/search?q=${encodeURIComponent(q)}&format=jsonv2&accept-language=${getLang()}&addressdetails=1&limit=5`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  return (await res.json()).map(describeNominatim).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon));
}

/** İki listeyi birleştir: Nominatim sonucu önemliyse (şehir/yer adı) başa, değilse Photon'un ardına; ~300 m içindeki kopyalar atılır. */
export function mergeResults(photonList, nomList) {
  const dup = (x, list) => list.some((y) => haversineKm(x, y) < 0.3);
  const nomFirst = nomList[0]?.importance >= 0.4;
  const out = nomFirst ? [...nomList, ...photonList.filter((p) => !dup(p, nomList))] : [...photonList, ...nomList.filter((n) => !dup(n, photonList))];
  return out.slice(0, 8).map(({ importance, ...r }) => r);
}

/**
 * Öneriler: [{ label, sub, lat, lon }] (koordinat öneriyle gelir). Konum verilirse yakın sonuçlar öne çıkar.
 * Photon sonucu hemen döner; Nominatim sonucu hazır olunca onMore(birleşik liste) çağrılır (yazma sürüyorsa çağrılmaz).
 */
export async function searchPlaces(q, _token, near = null, onMore = null) {
  const pl = langInfo().photon;
  const bias = (near ? `&lat=${near.lat.toFixed(2)}&lon=${near.lon.toFixed(2)}` : '') + (pl !== 'default' ? `&lang=${pl}` : ''); // Photon yalnızca en, de, fr, varsayılan(yerel ad) destekler
  const json = await cached(`oac:${q.toLowerCase()}:${bias}`, TTL.route, () => photon(`/api/?q=${encodeURIComponent(q)}&limit=8${bias}`), { persist: false });
  const first = (json.features || []).filter((f) => f.geometry?.coordinates).map((f) => ({
    ...describe(f.properties || {}),
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  })).slice(0, 8);

  if (onMore) {
    const seq = ++nomSeq;
    (async () => {
      await sleep(NOM_QUIET_MS);
      if (seq !== nomSeq) return; // daha yeni bir arama başladı
      const nom = await cached(`nom:${q.toLowerCase()}`, TTL.route, () => nominatim(q), { persist: false });
      if (seq === nomSeq) onMore(mergeResults(first, nom));
    })().catch(() => { if (seq === nomSeq) onMore(first); }); // Nominatim yoksa Photon sonucu yeterli
  }
  return first;
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
