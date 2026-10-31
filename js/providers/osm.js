// Alternatif (açık kaynak) sağlayıcı: henüz yazılmadı (docs/alternatif-kaynak.md, Faz 2-6).
// providers/index.js bu kaynağı `ready` olana kadar seçtirmez; arayüz şimdiden aynı ada ve imzaya sahiptir.
import { fetchRoute } from '../osm/route.js';
import { fetchWeather } from '../osm/weather.js';
import { fetchElevations } from '../osm/elevation.js';
import { searchPlaces, resolvePlace, reverseLabel } from '../osm/search.js';

const notReady = () => { throw new Error('Alternatif kaynak henüz hazır değil'); };

export { fetchRoute, fetchWeather, fetchElevations, searchPlaces, resolvePlace, reverseLabel };

export const capabilities = { traffic: false, availability: false, speedLimit: false, speedCameras: false, offline: false };

export const fetchChargers = notReady;
export const fetchAround = notReady;
export const fetchAvailability = notReady;
export const fetchSpeedLimit = notReady;
export const fetchTrafficAhead = notReady;
