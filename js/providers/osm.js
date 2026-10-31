// Alternatif (açık kaynak) sağlayıcı: henüz yazılmadı (docs/alternatif-kaynak.md, Faz 2-6).
// providers/index.js bu kaynağı `ready` olana kadar seçtirmez; arayüz şimdiden aynı ada ve imzaya sahiptir.
const notReady = () => { throw new Error('Alternatif kaynak henüz hazır değil'); };

export const capabilities = { traffic: false, availability: false, speedLimit: false, speedCameras: false, offline: false };

export const fetchRoute = notReady;
export const fetchChargers = notReady;
export const fetchAround = notReady;
export const fetchAvailability = notReady;
export const fetchWeather = notReady;
export const fetchElevations = notReady;
export const searchPlaces = notReady;
export const resolvePlace = notReady;
export const reverseLabel = notReady;
export const fetchSpeedLimit = notReady;
export const fetchTrafficAhead = notReady;
