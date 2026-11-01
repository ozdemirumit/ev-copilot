// Ara sunucu (server/proxy.mjs). Hesapla giriş yapılmışsa (davet + Google) oturum belirteci uygulamada kendiliğinden saklanır, kullanıcı hiçbir şey yazmaz;
// Mapbox, OpenChargeMap ve Overpass istekleri sunucudan geçer, anahtarlar sunucuda durur. Eski yöntem (yönetici erişim kodu) gelişmiş ayar olarak durur.
// Hesap yoksa ya da sunucuya ulaşılamazsa uygulama servislere doğrudan gider.
import { load, save } from '../utils/storage.js';

export const DEFAULT_SERVER = 'https://evcopilot.duckdns.org'; // herkese açık adres (gizli değil); gelişmiş ayardan değiştirilebilir

export const proxyBase = () => (String(load('proxyUrl', '') || '').trim() || DEFAULT_SERVER).replace(/\/+$/, '');
export const proxyCode = () => String(load('proxyCode', '') || '').trim();
export const getSession = () => { const s = load('session', null); return s?.token ? s : null; };
export const setSession = (s) => { save('session', s); document.dispatchEvent(new Event('account-changed')); };
let caps = load('proxyCaps', null); // sunucunun bildirdiği özellikler: { mapbox, ocm, overpass, occupancy (kullanıcı Premium ise), occupancyLocked (sunucuda var ama Premium değil) }
let plan = load('proxyPlan', null); // hesap planı: { premium, until }

const hasCreds = () => !!(getSession() || proxyCode());

/** Sunucu kullanılabilir mi ve istenen özelliği (mapbox | ocm | overpass) sağlıyor mu. */
export const proxyHas = (what) => !!(hasCreds() && caps?.[what]);
export const getPlan = () => (getSession() ? plan : null);

export function proxyFetch(path, init = {}) {
  const headers = new Headers(init.headers || {});
  const s = getSession();
  if (s) headers.set('Authorization', 'Bearer ' + s.token);
  else if (proxyCode()) headers.set('X-Access-Code', proxyCode());
  return fetch(proxyBase() + path, { ...init, headers });
}

/** Herkese açık yapılandırma (giriş sağlayıcıları). Sunucuya ulaşılamazsa null. */
export async function serverConfig() {
  try {
    const r = await fetch(proxyBase() + '/v1/config', { signal: AbortSignal.timeout(8000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/** Sunucunun özelliklerini yenile (oturum varsa /v1/me, yoksa yönetici kodu varsa /health). 401'de oturum silinir. Dönüş: { ok, text, caps }. */
export async function refreshCaps() {
  if (!hasCreds()) { caps = null; save('proxyCaps', null); return { ok: false, text: '', caps: null }; }
  try {
    const sess = getSession();
    const res = await proxyFetch(sess ? '/v1/me' : '/health', { signal: AbortSignal.timeout(10000) });
    if (res.status === 401) {
      if (sess) setSession(null); // oturum geçersiz (yönetici kapattı ya da hesap silindi)
      throw new Error('Erişim kodu reddedildi');
    }
    if (!res.ok) throw new Error(`Sunucu HTTP ${res.status}`);
    const j = await res.json();
    const c = sess ? j.caps : j;
    const prem = !sess || !!j.user?.premium; // Premium özellikler yalnızca Premium (ya da yönetici) hesapta açılır
    caps = { mapbox: !!c?.mapbox, ocm: !!c?.ocm, overpass: !!c?.overpass, occupancy: !!c?.occupancy && prem, occupancyLocked: !!c?.occupancy && !prem };
    plan = sess ? { premium: !!j.user?.premium, until: j.user?.premiumUntil || null } : null;
    save('proxyCaps', caps);
    save('proxyPlan', plan);
    document.dispatchEvent(new Event('plan-changed'));
    return { ok: true, text: '', caps, user: j.user || null };
  } catch (err) {
    caps = null;
    save('proxyCaps', null);
    return { ok: false, text: err.message === 'Erişim kodu reddedildi' ? err.message : 'Sunucuya ulaşılamadı', caps: null };
  }
}

/** Hesap planı ve sunucu özelliklerini açılışta, uygulamaya dönünce (en çok 5 dakikada bir) ve her 30 dakikada tazele. */
export function watchCaps() {
  let last = 0;
  const run = () => { if (Date.now() - last > 5 * 60e3) { last = Date.now(); refreshCaps(); } };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
  setInterval(run, 30 * 60e3);
  run();
}

/** Gelişmiş ayar: sunucu adresi ve yönetici kodu kaydedilir ve sunucu sınanır. Dönüş: { ok, text, caps }. */
export async function testProxy(url, code) {
  save('proxyUrl', String(url || '').trim().replace(/\/+$/, ''));
  save('proxyCode', String(code || '').trim());
  return refreshCaps();
}
