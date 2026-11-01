// Mapbox REST çağrıları (isteğe bağlı: anahtar girilirse trafikli rota, trafik uyarısı ve istasyon araması Mapbox'tan gelir).
// Anahtar yalnızca bu cihazın LocalStorage'ında durur (`mbKey`); herkese açık "pk." anahtarı olmalı, gizli "sk." anahtarı kabul edilmez.
import { load } from '../utils/storage.js';
import { proxyBase, proxyFetch, proxyHas } from '../net/proxy.js';

export const mapboxKey = () => (proxyHas('mapbox') ? 'proxy' : load('mbKey', '')); // ara sunucuda anahtar varsa o kullanılır (anahtar telefona yazılmaz)
export const MB_VALID = /^pk\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/;

export class MapboxError extends Error {
  constructor(message, { fatal = false, status = 0 } = {}) {
    super(message);
    this.fatal = fatal; // anahtar/izin sorunu: aynı istek tekrarlanmaz, tüm işlem Mapbox'sız sürer
    this.status = status;
    this.retryAfterMs = null; // 429'da Mapbox'ın istediği bekleme
  }
}

/** GET api.mapbox.com{path}?params. Anahtar sorguda gider (Mapbox başlıkla kabul etmez) ve hata iletilerine asla yazılmaz. */
export async function mbfetch(path, params = {}, { timeoutMs = 25000 } = {}) {
  const key = mapboxKey();
  if (!key) throw new MapboxError('Mapbox anahtarı yok', { fatal: true });
  const viaProxy = proxyHas('mapbox');
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null) q.set(k, String(v));
  let res;
  try {
    if (viaProxy) {
      res = await proxyFetch(`/mapbox${path}?${q}`, { signal: AbortSignal.timeout(timeoutMs) }); // anahtarı sunucu ekler
    } else {
      q.set('access_token', key);
      res = await fetch(`https://api.mapbox.com${path}?${q}`, { signal: AbortSignal.timeout(timeoutMs) });
    }
  } catch (err) {
    const msg = err.name === 'TimeoutError' ? 'Mapbox yanıt vermedi (zaman aşımı)' : "Mapbox'a ulaşılamadı (internet?)";
    throw new MapboxError(viaProxy ? 'Ara sunucuya ulaşılamadı' : msg, { fatal: viaProxy }); // sunucu yanıt vermezse Mapbox'sız (Valhalla/Overpass) sürer
  }
  if (res.ok) return res.json();
  let msg = '';
  try { msg = (await res.json()).message || ''; } catch { /* gövde yok */ }
  if (viaProxy && res.status === 401) throw new MapboxError('Sunucu erişim kodu geçersiz', { fatal: true, status: 401 });
  if (viaProxy && res.status === 501) throw new MapboxError('Sunucuda Mapbox anahtarı yok', { fatal: true, status: 501 });
  if (res.status === 401) throw new MapboxError('Mapbox anahtarı geçersiz veya süresi dolmuş', { fatal: true, status: 401 });
  if (res.status === 403) throw new MapboxError('Mapbox erişimi reddetti: anahtarın kapsamını (Directions, Search) veya URL kısıtını kontrol et', { fatal: true, status: 403 });
  if (res.status === 429) {
    const err = new MapboxError('Mapbox istek sınırına ulaşıldı, biraz bekle', { status: 429 });
    const ra = Number(res.headers.get('retry-after'));
    const reset = Number(res.headers.get('x-rate-limit-reset')); // epoch saniye
    err.retryAfterMs = Math.min(15000, Math.max(1000, ra > 0 ? ra * 1000 : reset > 0 ? reset * 1000 - Date.now() : 3000));
    throw err;
  }
  throw new MapboxError(msg ? `Mapbox: ${msg}` : `Mapbox HTTP ${res.status}`, { status: res.status });
}
