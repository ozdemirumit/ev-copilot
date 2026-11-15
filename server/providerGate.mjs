// Sunucu: sağlayıcı istekleri DURAKLATILDI (ücretsiz kota koruması) — tek merkezli devre kesici (v0.99.78).
// Varsayılan AÇIK: PROVIDER_REQUESTS_PAUSED tanımsız ya da '0'/'false'/'off'/'no' DIŞINDA bir değerse duraklatılmıştır.
// İki katman (proxy.mjs ikisini de İLK iş olarak kurar):
//  1) installServerFetchGuard: süreç genelindeki fetch'i sarar; döngü-içi (127.0.0.1/localhost/::1) dışındaki her adres
//     ağa çıkmadan ProviderPausedError ile reddedilir. Modüllerin çoğu `fetchImpl = fetch` varsayılanıyla global fetch'i çağrı
//     anında okur (tesla/veriapi yaratılırken yakalar); korumacı onlardan önce kurulduğu için arka plan işleri (Tesla listesi,
//     VeriApi günlük tarifesi, NDW tarifesi) de kapsanır. Tek istisna: Google ile GİRİŞ (OAuth belirteç değişimi, kota/ücret yok).
//  2) pausedRoute: sağlayıcıya giden ara sunucu yolları 503 { error: 'provider_paused' } döner (sayaç/maliyet artmaz,
//     harita anahtarı verilmez). Önbellekteki veriyi canlıymış gibi sunan yol açılmaz.
// Geri açma: .env'de PROVIDER_REQUESTS_PAUSED=0 + sunucuyu yeniden başlatma (kullanıcı onayıyla). Anahtar/kimlik bilgisi değişmez.
export const PAUSED_ROUTES = [
  /^\/mapbox\//, /^\/here\//, /^\/google\//, /^\/ocm\//, /^\/tomtom\//, /^\/overpass(?:\/|$)/,
  /^\/v1\/occupancy(?:\/|$)/, /^\/v1\/speedlimits(?:\/|$)/, /^\/v1\/tesla(?:\/|$)/, /^\/v1\/map\/config(?:\/|$)/,
];
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const LOGIN_HOSTS = new Set(['oauth2.googleapis.com']); // giriş (Google OAuth belirteç değişimi): sağlayıcı verisi/kota değil

/** Ortamdan duraklatma durumu: varsayılan duraklatılmış (fail-closed). */
export function providerPaused(env = {}) {
  const v = String(env.PROVIDER_REQUESTS_PAUSED ?? '').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(v);
}

export class ProviderPausedError extends Error {
  constructor(host) {
    super('Sağlayıcı istekleri duraklatıldı (kota koruması)');
    this.name = 'ProviderPausedError';
    this.code = 'provider_paused';
    this.host = host || '';
  }
}

/** Bu adres duraklatmada engellenir mi? Çözümlenemeyen adres engellenir (fail-closed). */
export function serverBlocked(input) {
  let u;
  try { u = new URL(typeof input === 'string' ? input : input?.url ?? input?.href ?? String(input)); } catch { return true; }
  if (LOOPBACK.has(u.hostname)) return false;
  if (u.protocol === 'https:' && LOGIN_HOSTS.has(u.hostname)) return false;
  return true;
}

/** Sağlayıcıya giden ara sunucu yolu mu? */
export const pausedRoute = (pathname) => PAUSED_ROUTES.some((re) => re.test(String(pathname || '')));

/** target.fetch'i sarar (bir kez). paused false ise hiçbir şey yapmaz. Engellenen istek alttaki fetch'e ulaşmaz. */
export function installServerFetchGuard(target = globalThis, { paused = true, onBlock } = {}) {
  const inner = target.fetch;
  if (!paused || typeof inner !== 'function' || inner.__providerGate) return inner;
  const guarded = function providerGatedFetch(input, init) {
    if (serverBlocked(input)) {
      let host = '';
      try { host = new URL(typeof input === 'string' ? input : input?.url ?? input?.href).host; } catch { /* yoksay */ }
      try { onBlock?.(host); } catch { /* yoksay */ }
      return Promise.reject(new ProviderPausedError(host));
    }
    return inner.call(target, input, init);
  };
  guarded.__providerGate = true;
  target.fetch = guarded;
  return guarded;
}
