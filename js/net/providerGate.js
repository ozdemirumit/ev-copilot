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
//
// YALNIZ ÜCRETSİZ MOD (v0.99.92, kapalı cihaz testi içindir, herkese açık yayın için DEĞİL): kaynakta PROVIDER_MODE_BUILD = 'paused'
// kalır. Yalnız `node scripts/build-beta.mjs --free-only <depo-dışı-klasör>` çıktısında bu satır 'free-only' olur. O modda küresel
// duraklatmanın yerine KESİN İZİN LİSTESİ (FREE_ENDPOINTS) uygulanır: yalnız https, standart port, kimlik bilgisiz adres, listedeki ana
// makine + yol + yöntem geçer. Ücretli sağlayıcılar (PAID_HOST_SUFFIXES), listede olmayan her köken ve ara sunucunun sağlayıcı yolları
// reddedilir. Ücretsiz servislerin adil kullanım sınırı için ana makine başına jeton kovası + saatlik tavan: sınır aşılınca istek
// KUYRUĞA ALINMAZ, reddedilir (fırtına/birikme yok). Belirsiz mod değeri → 'paused' (fail-closed). Harita Worker isteği için:
// freeMapRequest (MapLibre transformRequest) yalnız OpenFreeMap'i geçirir; Esri/ArcGIS uydu katmanı bu modda hiç eklenmez.
export const PROVIDER_REQUESTS_PAUSED_DEFAULT = true;
/** Derleme modu. KAYNAKTA DAİMA 'paused'. scripts/build-beta.mjs --free-only bu satırı (tam bir eşleşme) 'free-only' yapar. */
export const PROVIDER_MODE_BUILD = 'paused';
export const FREE_ONLY = 'free-only';
/** Yalnız tam 'free-only' dizgesi yalnız ücretsiz mod açar; başka her değer (boş, büyük harf, boşluklu, 'open'...) → 'paused'. */
export const parseProviderMode = (v) => (v === FREE_ONLY ? FREE_ONLY : 'paused');

let paused = PROVIDER_REQUESTS_PAUSED_DEFAULT;
let mode = parseProviderMode(PROVIDER_MODE_BUILD);
/** Yalnız ücretsiz izin listesi modu mu (kapalı cihaz testi derlemesi). */
export const freeOnlyMode = () => mode === FREE_ONLY;
/** Sağlayıcı istekleri (küresel olarak) duraklatılmış mı (kota koruması). Yalnız ücretsiz modda false: yerini izin listesi alır. */
export const providerRequestsPaused = () => paused && !freeOnlyMode();
/** 'paused' | 'free-only' | 'open' (open yalnız testlerde). */
export const providerMode = () => (freeOnlyMode() ? FREE_ONLY : paused ? 'paused' : 'open');
/** Yalnızca testler içindir; uygulama kodu çağırmaz. */
export function setProviderRequestsPaused(v) { paused = !!v; }
/** Yalnızca testler içindir; uygulama kodu çağırmaz. */
export function setProviderMode(v) { mode = parseProviderMode(v); }

/** Ara sunucuda (server/proxy.mjs) üst sağlayıcıya istek yapan / sağlayıcı anahtarı veren yollar. */
export const PAUSED_PROXY_PATHS = [
  /^\/mapbox\//, /^\/here\//, /^\/google\//, /^\/ocm\//, /^\/tomtom\//, /^\/overpass(?:\/|$)/,
  /^\/v1\/occupancy(?:\/|$)/, /^\/v1\/speedlimits(?:\/|$)/, /^\/v1\/tesla(?:\/|$)/, /^\/v1\/map\/config(?:\/|$)/,
];

/**
 * Yalnız ücretsiz modda izinli herkese açık servisler (anahtarsız). Ana makine adları şema öneki OLMADAN yazılır (çağrı grafiği köken kümesi değişmesin).
 * burst: aynı anda en çok istek; gapMs: bir jetonun dolma süresi (uzun dönem en çok 1 istek / gapMs); perHour: kayan 60 dk tavanı.
 * Sınırlar yayımlanmış adil kullanım kurallarının ALTINDA tutuldu; kurallar bu görevde çevrimiçi yeniden doğrulanmadı (terms notu).
 */
export const FREE_ENDPOINTS = Object.freeze([
  Object.freeze({ id: 'openfreemap', hosts: ['tiles.openfreemap.org'], paths: [/^\/(?:styles|planet|fonts|sprites|natural_earth)(?:\/|$)/], methods: ['GET'], burst: 20, gapMs: 100, perHour: 3000,
    terms: 'OpenFreeMap: anahtarsız, kayıtsız ücretsiz karo; OSM atfı zorunlu (harita atıf denetimi açık). Karolar Worker\'dan: yalnız freeMapRequest ile ana makine denetlenir, sayılmaz.' }),
  Object.freeze({ id: 'valhalla', hosts: ['valhalla1.openstreetmap.de'], paths: [/^\/(?:route|height|locate)$/], methods: ['POST'], burst: 5, gapMs: 1000, perHour: 600,
    terms: 'FOSSGIS herkese açık Valhalla: adil kullanım, garanti yok; yoğun/toplu kullanım yasak. Uzun dönem en çok 1 istek/sn.' }),
  Object.freeze({ id: 'open-meteo', hosts: ['api.open-meteo.com'], paths: [/^\/v1\/(?:forecast|elevation)$/], methods: ['GET'], burst: 10, gapMs: 500, perHour: 600,
    terms: 'Open-Meteo ücretsiz uç: ticari olmayan kullanım, günde 10.000 / saatte 5.000 / dakikada 600 çağrı altı; CC BY 4.0 atıf. Ticari customer-api uç izinli DEĞİL.' }),
  Object.freeze({ id: 'photon', hosts: ['photon.komoot.io'], paths: [/^\/api\/?$/, /^\/reverse\/?$/], methods: ['GET'], burst: 3, gapMs: 1000, perHour: 300,
    terms: 'Photon (komoot) herkese açık demo: adil kullanım, yoğun kullanım yasak; uygulama yazarken 350 ms bekler.' }),
  Object.freeze({ id: 'nominatim', hosts: ['nominatim.openstreetmap.org'], paths: [/^\/search\/?$/, /^\/reverse\/?$/], methods: ['GET'], burst: 1, gapMs: 1100, perHour: 60,
    terms: 'OSMF Nominatim kullanım politikası: en çok 1 istek/sn, otomatik tamamlama yok (uygulama yazma durunca 600 ms sonra bir kez), Referer gönderilir, atıf zorunlu.' }),
  Object.freeze({ id: 'overpass', hosts: ['overpass-api.de', 'overpass.private.coffee', 'overpass.kumi.systems'], paths: [/^\/api\/interpreter$/], methods: ['POST', 'GET'], burst: 2, gapMs: 2000, perHour: 60,
    terms: 'Overpass herkese açık örnekler: overpass-api.de günde ~10.000 sorgu ve IP başına 2 eşzamanlı yuva; ayna başına ayrı kova, paralel fırtına yok.' }),
]);
/** Yalnız ücretsiz modda daima reddedilen ücretli/anahtarlı sağlayıcı alan adları (ana makine bu adın kendisi ya da alt alan adı). */
export const PAID_HOST_SUFFIXES = Object.freeze(['mapbox.com', 'googleapis.com', 'google.com', 'gstatic.com', 'tomtom.com', 'hereapi.com', 'here.com',
  'iternio.com', 'abetterrouteplanner.com', 'arcgisonline.com', 'arcgis.com', 'openchargemap.io']);
/** freeMapRequest'in engellediği harita isteğinin yerine konan boş, yerel adres (ağa çıkmaz; boş vektör karo). */
export const BLOCKED_MAP_URL = 'data:application/x-protobuf;base64,';

const REASON_TEXT = {
  'rate-limit': 'Ücretsiz servis istek sınırı (yerel koruma), biraz bekle',
  'paid-provider': 'Ücretli sağlayıcı bu derlemede kapalı (yalnız ücretsiz mod)',
  'not-allowlisted': 'Adres izin listesinde değil (yalnız ücretsiz mod)',
};
export class ProviderPausedError extends Error {
  constructor(url, reason = '') {
    super(REASON_TEXT[reason] || 'Sağlayıcı istekleri duraklatıldı (kota koruması)');
    this.name = 'ProviderPausedError';
    this.code = 'provider_paused';
    this.reason = String(reason || '');
    this.url = String(url || '').split('?')[0]; // sorgu (anahtar olabilir) saklanmaz
  }
}

function toUrl(input, origin) {
  const raw = typeof input === 'string' ? input : input?.url ?? input?.href ?? String(input);
  try { return new URL(raw, origin); } catch { return null; }
}

const isPaidHost = (host) => PAID_HOST_SUFFIXES.some((s) => host === s || host.endsWith('.' + s));
/** URL izin listesindeki bir ücretsiz uca birebir uyuyor mu (https, standart port, kimlik bilgisi yok, ana makine + yol + yöntem). */
function matchFree(u, method = 'GET') {
  if (u.protocol !== 'https:' || u.port !== '' || u.username || u.password) return null;
  const m = String(method || 'GET').toUpperCase();
  return FREE_ENDPOINTS.find((e) => e.hosts.includes(u.hostname) && e.methods.includes(m) && e.paths.some((re) => re.test(u.pathname))) || null;
}

/**
 * İstek engellenmeli mi? null: izinli; 'external': harici sağlayıcı kökeni (duraklatma); 'proxy-provider': ara sunucunun sağlayıcı yolu;
 * 'paid-provider' / 'not-allowlisted': yalnız ücretsiz modda ücretli ya da listede olmayan adres; 'invalid': çözümlenemeyen adres (fail-closed).
 * @param {RequestInfo|URL|string} input
 * @param {{origin?: string, proxyBase?: string, method?: string}} ctx origin: uygulamanın kökeni; proxyBase: ara sunucu taban adresi
 */
export function blockedReason(input, { origin = 'http://localhost', proxyBase = '', method = 'GET' } = {}) {
  const free = freeOnlyMode();
  if (!paused && !free) return null;
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
  if (!free) return 'external';
  if (isPaidHost(u.hostname)) return 'paid-provider';
  return matchFree(u, method) ? null : 'not-allowlisted';
}

/**
 * Ücretsiz uç başına (ana makine) jeton kovası + kayan saatlik tavan. take(): izinliyse jetonu harcar ve null döner; sınırdaysa
 * 'rate-limit' (istek bekletilmez, reddedilir). Yalnız ücretsiz modda ve izin listesindeki uçlarda sayar; başka her istek null.
 * @param {{now?: () => number}} opts now: saat (testte sanal)
 */
export function createFreeLimiter({ now = () => Date.now() } = {}) {
  const buckets = new Map();
  return {
    take(input, method = 'GET', origin = 'http://localhost') {
      if (!freeOnlyMode()) return null;
      const u = toUrl(input, origin);
      const e = u && matchFree(u, method);
      if (!e) return null;
      const t = now();
      let b = buckets.get(u.hostname);
      if (!b) { b = { tokens: e.burst, at: t, hour: [] }; buckets.set(u.hostname, b); }
      b.tokens = Math.min(e.burst, b.tokens + Math.max(0, t - b.at) / e.gapMs);
      b.at = t;
      while (b.hour.length && t - b.hour[0] >= 3600e3) b.hour.shift();
      if (b.tokens < 1 || b.hour.length >= e.perHour) return 'rate-limit';
      b.tokens -= 1;
      b.hour.push(t);
      return null;
    },
  };
}

/**
 * MapLibre transformRequest (harita Worker isteklerini fetch sarmalayıcısı görmez): yalnız ücretsiz modda kullanılır. Yalnız OpenFreeMap
 * (https) ile data:/blob: aynen geçer; başka her adres (Esri/ArcGIS, Mapbox, TomTom, OSM karo sunucusu, http...) BLOCKED_MAP_URL olur.
 */
export function freeMapRequest(url) {
  const u = toUrl(url, 'http://localhost');
  if (u && (u.protocol === 'data:' || u.protocol === 'blob:')) return { url: String(url) };
  const e = u && matchFree(u, 'GET');
  return e && e.id === 'openfreemap' ? { url: String(url) } : { url: BLOCKED_MAP_URL };
}

/**
 * target.fetch'i saran korumacıyı kurar (bir kez). Duraklatmada engellenen istek alttaki fetch'e HİÇ ulaşmaz.
 * @param {object} target genelde globalThis/window
 * @param {{getOrigin?: () => string, getProxyBase?: () => string, onBlock?: (reason:string, url:string) => void, now?: () => number}} opts
 */
export function installProviderGate(target = globalThis, { getOrigin = () => target.location?.origin || 'http://localhost', getProxyBase = () => '', onBlock, now } = {}) {
  const inner = target.fetch;
  if (typeof inner !== 'function' || inner.__providerGate) return inner;
  const limiter = createFreeLimiter(now ? { now } : {});
  const guarded = function providerGatedFetch(input, init) {
    let reason;
    try {
      const method = String(init?.method || input?.method || 'GET').toUpperCase();
      const origin = getOrigin();
      reason = blockedReason(input, { origin, proxyBase: getProxyBase(), method }) || limiter.take(input, method, origin);
    } catch { reason = 'invalid'; }
    if (reason) {
      const err = new ProviderPausedError(typeof input === 'string' ? input : input?.url ?? input?.href, reason);
      try { onBlock?.(reason, err.url); } catch { /* bildirim hatası isteği açmaz */ }
      return Promise.reject(err);
    }
    return inner.call(target, input, init);
  };
  guarded.__providerGate = true;
  target.fetch = guarded;
  return guarded;
}
