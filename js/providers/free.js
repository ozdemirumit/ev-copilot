// Ücretsiz açık servisler (anahtarsız): hava Open-Meteo, rakım Valhalla (yedek Open-Meteo), yol hız limiti OpenStreetMap maxspeed (Valhalla).
// Herkese açık sunucular: adil kullanım, garanti yok. Etiketi olmayan yolda hız limiti bilinmez (tahmin yapılmaz).
export { fetchWeather } from '../osm/weather.js';
export { fetchElevations } from '../osm/elevation.js';
export { fetchSpeedLimit } from '../osm/speedLimit.js';
