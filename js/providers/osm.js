// Alternatif (açık kaynak) sağlayıcı: OpenStreetMap tabanlı servisler (docs/alternatif-kaynak.md). Harita (MapLibre) henüz yok:
// providers/index.js bu kaynağı `ready` olana kadar seçtirmez. Canlı trafik ve istasyon doluluğu bu kaynakta yoktur.
import { fetchRoute } from '../osm/route.js';
import { fetchChargers, fetchAround, fetchAvailability } from '../osm/chargers.js';
import { fetchSpeedLimit } from '../osm/speedLimit.js';
import { fetchWeather } from '../osm/weather.js';
import { fetchElevations } from '../osm/elevation.js';
import { searchPlaces, resolvePlace, reverseLabel } from '../osm/search.js';

export { fetchRoute, fetchChargers, fetchAround, fetchAvailability, fetchSpeedLimit, fetchWeather, fetchElevations, searchPlaces, resolvePlace, reverseLabel };

export const capabilities = { traffic: false, availability: false, speedLimit: true, speedCameras: false, offline: false };

export const fetchTrafficAhead = async () => null; // canlı trafik verisi yok
