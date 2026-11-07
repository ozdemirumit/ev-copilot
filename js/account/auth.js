// Hesap: davet + Google ile giriş. Telefona hiçbir anahtar yazılmaz: sunucunun giriş sayfası tarayıcıda açılır (Google istemci gizlisi yalnızca
// sunucudadır), uygulama rastgele bir "nonce" ile sonucu yoklar ve oturum belirtecini kendiliğinden saklar.
import { load, save, remove } from '../utils/storage.js';
import { deviceId, getSession, proxyBase, proxyFetch, refreshCaps, serverConfig, setSession } from '../net/proxy.js';

const POLL_MS = 2000;
const WAIT_MS = 10 * 60e3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const currentUser = () => getSession()?.user || null;
export const isSignedIn = () => !!getSession();

// Davet kodu: bağlantıdan (?invite=KOD ya da evcopilot://invite?code=KOD) gelir, girişte kullanılır.
export const pendingInvite = () => String(load('pendingInvite', '') || '');
export function setPendingInvite(code) {
  const c = String(code || '').trim();
  if (/^[A-Za-z0-9_-]{8,64}$/.test(c)) { save('pendingInvite', c); document.dispatchEvent(new Event('account-changed')); return true; }
  return false;
}

/** Açılışta adres çubuğundaki ?invite=KOD davetini al ve adresten temizle. */
export function captureInviteFromUrl() {
  try {
    const u = new URL(location.href);
    const c = u.searchParams.get('invite');
    if (!c) return;
    setPendingInvite(c);
    u.searchParams.delete('invite');
    history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
  } catch { /* adres okunamadı */ }
}

/** Android uygulaması: evroutefinder://invite?code=KOD (eski: evcopilot://) bağlantısı uygulamayı açar (Capacitor App eklentisi). */
export function listenInviteDeepLink() {
  const App = globalThis.Capacitor?.Plugins?.App;
  if (!App?.addListener) return;
  const take = (url) => {
    try {
      const u = new URL(url);
      if ((u.protocol === 'evroutefinder:' || u.protocol === 'evcopilot:') && u.hostname === 'invite') setPendingInvite(u.searchParams.get('code'));
    } catch { /* geçersiz adres */ }
  };
  App.addListener('appUrlOpen', (e) => take(e.url));
  App.getLaunchUrl?.().then((r) => r?.url && take(r.url)).catch(() => {});
}

/** Giriş onay kodu (4 hane): nonce'tan türetilir (server/accounts.mjs loginCode ile aynı işlev); tarayıcıdaki sayfa bu kodu ister. */
export function loginCode(nonce) {
  let h = 0x811c9dc5;
  for (let i = 0; i < nonce.length; i++) { h ^= nonce.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return String(h % 10000).padStart(4, '0');
}

function newNonce() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Girişi hazırla: kod (tarayıcıda girilecek 4 hane) hemen gösterilebilir, tarayıcı start() ile açılır. start() bir tıklama işleyicisinde, ilk iş olarak çağrılmalı
 * (tarayıcı sekmesi açılabilsin). Kod önce ekranda görünsün diye iki adım: kod gösterilir, kullanıcı "Tarayıcıda devam et"e basınca tarayıcı açılır.
 * Dönüş: { url, code, start(): Promise<user> }.
 */
export function prepareGoogleSignIn(invite = pendingInvite()) {
  const nonce = newNonce();
  const url = `${proxyBase()}/auth/google?nonce=${nonce}${invite ? '&invite=' + encodeURIComponent(invite) : ''}`;
  let started = null;
  const start = () => {
    if (started) return started;
    window.open(url, '_blank');
    started = waitForLogin(nonce);
    return started;
  };
  return { url, code: loginCode(nonce), start };
}

/** Tek adımlı eski kullanım: hemen tarayıcıyı açar. Dönüş: { url, code, done: Promise<user> }. */
export function startGoogleSignIn(invite = pendingInvite()) {
  const p = prepareGoogleSignIn(invite);
  return { url: p.url, code: p.code, done: p.start() };
}

function waitForLogin(nonce) {
  return (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < WAIT_MS) {
      await sleep(POLL_MS);
      let j;
      try {
        const r = await fetch(`${proxyBase()}/v1/auth/poll?nonce=${nonce}`, { headers: { 'X-Device-Id': deviceId() }, signal: AbortSignal.timeout(8000) });
        j = await r.json();
      } catch { continue; } // ağ kesildi: yoklamaya devam
      if (j.status === 'pending' || (j.status === 'expired' && Date.now() - t0 < 120e3)) continue; // tarayıcı sayfayı açana kadar sunucu nonce'u henüz görmemiş olabilir
      if (j.status === 'ok') {
        setSession({ token: j.session, user: j.user });
        remove('pendingInvite');
        await refreshCaps();
        document.dispatchEvent(new Event('account-changed'));
        return j.user;
      }
      throw Object.assign(new Error(j.error || j.status), { code: j.error || j.status });
    }
    throw Object.assign(new Error('timeout'), { code: 'timeout' });
  })();
}

export async function signOut() {
  try { await proxyFetch('/v1/auth/logout', { method: 'POST', signal: AbortSignal.timeout(8000) }); } catch { /* sunucuya ulaşılamadı: yerel oturum yine de silinir */ }
  setSession(null);
  refreshCaps();
}

/** Hesabı ve sunucudaki tüm verisini sil. Başarılıysa true. */
export async function deleteAccount() {
  try {
    const r = await proxyFetch('/v1/me', { method: 'DELETE', signal: AbortSignal.timeout(15000) });
    if (!r.ok) return false;
  } catch { return false; }
  setSession(null);
  remove('syncMeta');
  remove('histUp');
  refreshCaps();
  return true;
}

export { serverConfig };
