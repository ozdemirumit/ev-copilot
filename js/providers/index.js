// Veri kaynağı katmanı. Seçilen kaynak (Google veya Alternatif) harita dışındaki tüm veriyi (rota, istasyon, arama, hava, rakım,
// trafik, hız limiti) BİRLİKTE sağlar; karışık kullanım yoktur. Uygulamanın geri kalanı yalnızca bu dosyayı içe aktarır.
// Yeni bir kaynak eklemek: providers/<ad>.js aynı adlı işlevleri dışa aktarsın, SOURCES'a eklensin.
import { load, save } from '../utils/storage.js';
import * as google from './google.js';
import * as osm from './osm.js';

/** ready: kaynak kullanıma hazır mı (hazır değilse seçilemez, Google'a düşülür). */
export const SOURCES = [
  { id: 'google', label: 'Google', ready: true, impl: google },
  { id: 'osm', label: 'Alternatif (açık kaynak)', ready: true, impl: osm },
];

/** Kayıtlı seçim; bilinmiyor veya hazır değilse Google. */
export function getSource() {
  const id = load('source', 'google');
  return SOURCES.find((s) => s.id === id && s.ready)?.id ?? 'google';
}

/** Kaynağı değiştir. Harita ve önbellekler kaynağa göre kurulduğu için sayfa yeniden yüklenir. */
export function setSource(id) {
  if (!SOURCES.some((s) => s.id === id && s.ready)) return false;
  save('source', id);
  location.reload();
  return true;
}

const cur = () => SOURCES.find((s) => s.id === getSource()).impl;

export const capabilities = () => cur().capabilities;

/** Kısa ad (arayüz metinlerinde): 'Google' veya 'Alternatif'. */
export const sourceName = () => (getSource() === 'google' ? 'Google' : 'Alternatif');

export const fetchRoute = (...a) => cur().fetchRoute(...a);
export const fetchChargers = (...a) => cur().fetchChargers(...a);
export const fetchAround = (...a) => cur().fetchAround(...a);
export const fetchAvailability = (...a) => cur().fetchAvailability(...a);
export const fetchWeather = (...a) => cur().fetchWeather(...a);
export const fetchElevations = (...a) => cur().fetchElevations(...a);
export const searchPlaces = (...a) => cur().searchPlaces(...a);
export const resolvePlace = (...a) => cur().resolvePlace(...a);
export const reverseLabel = (...a) => cur().reverseLabel(...a);
export const fetchSpeedLimit = (...a) => cur().fetchSpeedLimit(...a);
export const fetchTrafficAhead = (...a) => cur().fetchTrafficAhead(...a);
