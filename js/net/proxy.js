// İsteğe bağlı ara sunucu (server/proxy.mjs). Adres ve erişim kodu girilirse Mapbox, OpenChargeMap ve Overpass istekleri ondan geçer;
// anahtarlar sunucuda durur. Adres boşsa ya da sunucuya ulaşılamazsa uygulama servislere doğrudan gider.
import { load, save } from '../utils/storage.js';

export const proxyBase = () => String(load('proxyUrl', '') || '').trim().replace(/\/+$/, '');
export const proxyCode = () => String(load('proxyCode', '') || '').trim();
let caps = load('proxyCaps', null); // son sınamada sunucunun bildirdiği özellikler: { mapbox, ocm, overpass }

/** Sunucu kullanılabilir mi ve istenen özelliği (mapbox | ocm | overpass) sağlıyor mu. */
export const proxyHas = (what) => !!(proxyBase() && proxyCode() && caps?.[what]);

export function proxyFetch(path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('X-Access-Code', proxyCode());
  return fetch(proxyBase() + path, { ...init, headers });
}

/** Adres ve kodu kaydet, sunucuyu sına, özellikleri sakla. Dönüş: { ok, text, caps }. */
export async function testProxy(url, code) {
  const base = String(url || '').trim().replace(/\/+$/, '');
  save('proxyUrl', base);
  save('proxyCode', String(code || '').trim());
  if (!base) { caps = null; save('proxyCaps', null); return { ok: true, text: '', caps: null }; }
  try {
    const res = await proxyFetch('/health', { signal: AbortSignal.timeout(10000) });
    if (res.status === 401) throw new Error('Erişim kodu reddedildi');
    if (!res.ok) throw new Error(`Sunucu HTTP ${res.status}`);
    const j = await res.json();
    caps = { mapbox: !!j.mapbox, ocm: !!j.ocm, overpass: !!j.overpass };
    save('proxyCaps', caps);
    return { ok: true, text: '', caps };
  } catch (err) {
    caps = null;
    save('proxyCaps', null);
    return { ok: false, text: err.message === 'Erişim kodu reddedildi' ? err.message : 'Sunucuya ulaşılamadı', caps: null };
  }
}
