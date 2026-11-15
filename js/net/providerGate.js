// Sağlayıcı istekleri DURAKLATILDI (ücretsiz kota koruması) — tek merkezli devre kesici (v0.99.78).
// Varsayılan AÇIK (duraklatılmış): uygulama hiçbir harici sağlayıcıya (rota, harita karosu, arama/geocoding, hava, yükselti,
// şarj istasyonu/doluluk/fiyat, ABRP telemetri...) istek GÖNDERMEZ. Engellenen istek ağa hiç çıkmaz: fetch, ProviderPausedError ile
// reddedilir (TypeError DEĞİL → proxy.js yeniden deneme turu başlamaz). Çağıranlar bugünkü hata yolundan "veri yok / bilinmiyor"a düşer.
// İzinli olanlar: aynı köken (uygulama dosyaları, version.js, i18n), data:/blob:, ve ara sunucunun SAĞLAYICIYA GİTMEYEN yolları
// (giriş/hesap/eşitleme/istasyon bilgisi/topluluk fiyatı/önbellekteki tarifeler). Ara sunucunun sağlayıcıya giden yolları (aşağıdaki
// PAUSED_PROXY_PATHS) istemcide de kesilir: canlı sunucu bu sürümle güncellenmese bile Beta istemcisi kota harcatmaz.
// Harita: MapLibre karoları Web Worker'dan istendiği için bu sarmalayıcı onları göremez; harita bu yüzden duraklatmada yerel boş
// stille açılır (js/ui/maps/maplibre.js OFFLINE_STYLE) ve Mapbox/Google/TomTom harita betikleri hiç yüklenmez (js/ui/mapView.js).
// Geri açma: PROVIDER_REQUESTS_PAUSED_DEFAULT = false + sürüm artırımı + yayın (sunucu tarafı ayrıca: server/providerGate.mjs).
export const PROVIDER_REQUESTS_PAUSED_DEFAULT = true;

let paused = PROVIDER_REQUESTS_PAUSED_DEFAULT;
/** Sağlayıcı istekleri duraklatılmış mı (kota koruması). */
export const providerRequestsPaused = () => paused;
/** Yalnızca testler içindir; uygulama kodu çağırmaz. */
export function setProviderRequestsPaused(v) { paused = !!v; }

/** Ara sunucuda (server/proxy.mjs) üst sağlayıcıya istek yapan / sağlayıcı anahtarı veren yollar. */
export const PAUSED_PROXY_PATHS = [
  /^\/mapbox\//, /^\/here\//, /^\/google\//, /^\/ocm\//, /^\/tomtom\//, /^\/overpass(?:\/|$)/,
  /^\/v1\/occupancy(?:\/|$)/, /^\/v1\/speedlimits(?:\/|$)/, /^\/v1\/tesla(?:\/|$)/, /^\/v1\/map\/config(?:\/|$)/,
];

export class ProviderPausedError extends Error {
  constructor(url) {
    super('Sağlayıcı istekleri duraklatıldı (kota koruması)');
    this.name = 'ProviderPausedError';
    this.code = 'provider_paused';
    this.url = String(url || '').split('?')[0]; // sorgu (anahtar olabilir) saklanmaz
  }
}

function toUrl(input, origin) {
  const raw = typeof input === 'string' ? input : input?.url ?? input?.href ?? String(input);
  try { return new URL(raw, origin); } catch { return null; }
}

/**
 * İstek engellenmeli mi? null: izinli; 'external': harici sağlayıcı kökeni; 'proxy-provider': ara sunucunun sağlayıcı yolu;
 * 'invalid': çözümlenemeyen adres (fail-closed).
 * @param {RequestInfo|URL|string} input
 * @param {{origin?: string, proxyBase?: string}} ctx origin: uygulamanın kökeni; proxyBase: ara sunucu taban adresi
 */
export function blockedReason(input, { origin = 'http://localhost', proxyBase = '' } = {}) {
  if (!paused) return null;
  const u = toUrl(input, origin);
  if (!u) return 'invalid';
  if (u.protocol === 'data:' || u.protocol === 'blob:') return null;
  let pb = null;
  try { pb = proxyBase ? new URL(proxyBase) : null; } catch { pb = null; }
  if (pb && u.origin === pb.origin) {
    const base = pb.pathname.replace(/\/+$/, '');
    const path = base && u.pathname.startsWith(base) ? u.pathname.slice(base.length) || '/' : u.pathname;
    return PAUSED_PROXY_PATHS.some((re) => re.test(path)) ? 'proxy-provider' : null;
  }
  if (u.origin === new URL(origin).origin) return null; // uygulamanın kendi dosyaları
  return 'external';
}

/**
 * target.fetch'i saran korumacıyı kurar (bir kez). Duraklatmada engellenen istek alttaki fetch'e HİÇ ulaşmaz.
 * @param {object} target genelde globalThis/window
 * @param {{getOrigin?: () => string, getProxyBase?: () => string, onBlock?: (reason:string, url:string) => void}} opts
 */
export function installProviderGate(target = globalThis, { getOrigin = () => target.location?.origin || 'http://localhost', getProxyBase = () => '', onBlock } = {}) {
  const inner = target.fetch;
  if (typeof inner !== 'function' || inner.__providerGate) return inner;
  const guarded = function providerGatedFetch(input, init) {
    let reason;
    try { reason = blockedReason(input, { origin: getOrigin(), proxyBase: getProxyBase() }); } catch { reason = 'invalid'; }
    if (reason) {
      const err = new ProviderPausedError(typeof input === 'string' ? input : input?.url ?? input?.href);
      try { onBlock?.(reason, err.url); } catch { /* bildirim hatası isteği açmaz */ }
      return Promise.reject(err);
    }
    return inner.call(target, input, init);
  };
  guarded.__providerGate = true;
  target.fetch = guarded;
  return guarded;
}
