// Google Maps Platform REST çağrıları (Routes, Places (New), Weather, Geocoding). Tek hizmet sağlayıcı: Google.
import { googleKey, loadGoogle, googleAuthError } from './loader.js';

export class GoogleError extends Error {
  constructor(message, { fatal = false, status = 0 } = {}) {
    super(message);
    this.fatal = fatal; // anahtar/etkin-API sorunu: aynı istek tekrarlanmaz, tüm işlem durur
    this.status = status;
  }
}

function explain(status, msg) {
  if (/API key not valid|API_KEY_INVALID/i.test(msg)) return ['Google anahtarı geçersiz: yanlış karakter olabilir, Rota sekmesinde tekrar gir', true];
  if (/has not been used in project|is disabled|SERVICE_DISABLED/i.test(msg)) return ["Google: bu API projede etkin değil (Cloud Console > API Kitaplığı'ndan etkinleştir, etkinleştirdiysen birkaç dakika bekle)", true];
  if (/enable Billing|BILLING/i.test(msg)) return ['Google: projeye faturalandırma hesabı bağlı değil (Cloud Console > Faturalandırma)', true];
  if (status === 403) return [`Google erişimi reddetti: ilgili API etkin değil veya anahtar kısıtlı (${msg || 'HTTP 403'})`, true];
  if (status === 429) return ['Google istek sınırı/kota doldu (biraz bekle veya kotayı artır)', false];
  return [msg ? `Google: ${msg}` : `Google HTTP ${status}`, false];
}

/**
 * Google REST çağrısı. Anahtar X-Goog-Api-Key başlığında gider (`keyInQuery`: URL'de, başlıksız GET → CORS ön isteği yok).
 * mask: X-Goog-FieldMask (yalnızca gereken alanlar: faturalama alan düzeyine göre değişir).
 */
export async function gfetch(url, { method = 'GET', body, mask, keyInQuery = false, timeoutMs = 20000 } = {}) {
  const key = googleKey();
  if (!key) throw new GoogleError('Google anahtarı yok: Rota sekmesinden gir', { fatal: true });
  const headers = {};
  if (keyInQuery) url += (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(key);
  else headers['X-Goog-Api-Key'] = key;
  if (body) headers['Content-Type'] = 'application/json';
  if (mask) headers['X-Goog-FieldMask'] = mask;
  let res;
  try {
    res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new GoogleError(err.name === 'TimeoutError' ? 'Google yanıt vermedi (zaman aşımı)' : 'Google\'a ulaşılamadı (internet?)');
  }
  if (res.ok) return res.json();
  let msg = '';
  try { msg = (await res.json()).error?.message || ''; } catch { /* gövde yok */ }
  const [text, fatal] = explain(res.status, msg);
  throw new GoogleError(text, { fatal, status: res.status });
}

/** Anahtarın hangi Google API'lerinde çalıştığını sına: her biri için en küçük istek. Dönüş: [{ name, ok, text }]. */
export async function testGoogleKey() {
  const A = { latitude: 39.9208, longitude: 32.8541 };
  const B = { latitude: 39.9300, longitude: 32.8700 };
  const wp = (p) => ({ location: { latLng: p } });
  const checks = [
    ['Maps JavaScript API (harita, rakım)', async () => {
      await loadGoogle();
      await new Promise((r) => setTimeout(r, 1200));
      if (googleAuthError()) throw new Error(googleAuthError());
      const { ElevationService } = await google.maps.importLibrary('elevation');
      await new ElevationService().getElevationForLocations({ locations: [{ lat: A.latitude, lng: A.longitude }] });
    }],
    ['Routes API (rota)', () => gfetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST', mask: 'routes.distanceMeters',
      body: { origin: wp(A), destination: wp(B), travelMode: 'DRIVE' },
    })],
    ['Places API (New) (istasyon, arama)', () => gfetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST', mask: 'places.id',
      body: { includedTypes: ['electric_vehicle_charging_station'], maxResultCount: 1, locationRestriction: { circle: { center: A, radius: 1000 } } },
    })],
    ['Weather API (hava)', () => gfetch(`https://weather.googleapis.com/v1/forecast/hours:lookup?location.latitude=${A.latitude}&location.longitude=${A.longitude}&hours=1`, { keyInQuery: true })],
    ['Geocoding API (adres adı)', async () => {
      const j = await (await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${A.latitude},${A.longitude}&key=${encodeURIComponent(googleKey())}`)).json();
      if (j.status !== 'OK' && j.status !== 'ZERO_RESULTS') throw new Error(j.error_message || j.status);
    }],
  ];
  return Promise.all(checks.map(async ([name, fn]) => {
    try { await fn(); return { name, ok: true, text: 'çalışıyor' }; } catch (err) { return { name, ok: false, text: err.message || String(err) }; }
  }));
}
