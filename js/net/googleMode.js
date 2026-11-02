// Premium "Google modu": harita Google Maps, istasyon ayrıntıları Google Places UI Kit, doluluk Google verisi (haritada gösterilebilir).
// Sunucu, Google tarayıcı anahtarını yalnızca Premium hesaba verir; telefona yazılmaz. Mod hesap değil cihaz ayarıdır (değişince sayfa yenilenir).
import { load, save } from '../utils/storage.js';
import { proxyFetch, proxyHas } from './proxy.js';

/** Sunucuda Google harita anahtarı tanımlı ve hesap Premium mu (önbellekteki yetenekler; açılışta eşzamanlı okunur). */
export const googleModeAvailable = () => proxyHas('googleMap');
export const googleModeOn = () => !!load('googleMode', false) && googleModeAvailable();
export const setGoogleMode = (on) => save('googleMode', !!on);

/** Harita anahtarı ve harita kimliği: her çağrı bir harita yüklemesi sayılır (kullanıcı başına günlük sınır). */
export async function fetchMapKey() {
  const r = await proxyFetch('/v1/google/map-key', { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(r.status === 402 ? 'Google modu Premium üyelere özeldir' : r.status === 429 ? 'Günlük Google harita hakkı doldu' : 'Google harita anahtarı alınamadı');
  const j = await r.json();
  return { key: j.key, mapId: j.mapId || 'DEMO_MAP_ID' };
}

/** İstasyon için Google Places UI Kit kartı (gmp-place-details-compact); Google yer kimliği bulunamazsa null. Google Maps yüklüyken çağrılır. */
export async function googlePlaceCard(s) {
  if (!window.google?.maps?.importLibrary) return null;
  const r = await proxyFetch('/v1/google/place', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat: s.lat, lon: s.lon }), signal: AbortSignal.timeout(10000) });
  if (!r.ok) return null;
  const { placeId } = await r.json();
  if (!placeId) return null;
  await google.maps.importLibrary('places');
  const card = document.createElement('gmp-place-details-compact');
  card.setAttribute('orientation', 'vertical');
  const req = document.createElement('gmp-place-details-place-request');
  req.setAttribute('place', placeId);
  card.append(req, document.createElement('gmp-place-standard-content'));
  return card;
}
