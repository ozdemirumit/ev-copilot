// Mapbox REST çağrıları (isteğe bağlı: anahtar girilirse trafikli rota, trafik uyarısı ve istasyon araması Mapbox'tan gelir).
// Anahtar yalnızca bu cihazın LocalStorage'ında durur (`mbKey`); herkese açık "pk." anahtarı olmalı, gizli "sk." anahtarı kabul edilmez.
import { load } from '../utils/storage.js';

export const mapboxKey = () => load('mbKey', '');
export const MB_VALID = /^pk\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/;

export class MapboxError extends Error {
  constructor(message, { fatal = false, status = 0 } = {}) {
    super(message);
    this.fatal = fatal; // anahtar/izin sorunu: aynı istek tekrarlanmaz, tüm işlem Mapbox'sız sürer
    this.status = status;
  }
}

/** GET api.mapbox.com{path}?params. Anahtar sorguda gider (Mapbox başlıkla kabul etmez) ve hata iletilerine asla yazılmaz. */
export async function mbfetch(path, params = {}, { timeoutMs = 25000 } = {}) {
  const key = mapboxKey();
  if (!key) throw new MapboxError('Mapbox anahtarı yok', { fatal: true });
  const url = new URL('https://api.mapbox.com' + path);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  url.searchParams.set('access_token', key);
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new MapboxError(err.name === 'TimeoutError' ? 'Mapbox yanıt vermedi (zaman aşımı)' : "Mapbox'a ulaşılamadı (internet?)");
  }
  if (res.ok) return res.json();
  let msg = '';
  try { msg = (await res.json()).message || ''; } catch { /* gövde yok */ }
  if (res.status === 401) throw new MapboxError('Mapbox anahtarı geçersiz veya süresi dolmuş', { fatal: true, status: 401 });
  if (res.status === 403) throw new MapboxError('Mapbox erişimi reddetti: anahtarın kapsamını (Directions, Search) veya URL kısıtını kontrol et', { fatal: true, status: 403 });
  if (res.status === 429) throw new MapboxError('Mapbox istek sınırına ulaşıldı, biraz bekle', { status: 429 });
  throw new MapboxError(msg ? `Mapbox: ${msg}` : `Mapbox HTTP ${res.status}`, { status: res.status });
}
