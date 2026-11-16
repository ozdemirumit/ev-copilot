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
//
// HERKESE AÇIK ÜCRETSİZ BETA (v0.99.93, D6 kararı: yalnız ozdemirumit.github.io/EV-Route-Finder/): kaynakta yine 'paused'.
// Yalnız `node scripts/build-beta.mjs --public-free <klasör>` çıktısında 'public-free' olur. free-only'nin üstüne daha katı kurallar:
//   - PAYLAŞILAN CANLI SUNUCUYA SIFIR İSTEK: ara sunucu kökeni (proxyBase) ve SHARED_SERVER_HOSTS hangi yol olursa olsun
//     ('shared-server'): /v1/config, giriş, eşitleme, telemetri, istasyon bilgisi, fiyat, tarife dahil. proxy.js ayrıca ağa hiç çıkmaz.
//   - Daraltılmış izin listesi (PUBLIC_FREE_ENDPOINTS): Nominatim YOK (OSMF politikası sınırı uygulamanın TÜM kullanıcılarının toplamına
//     koyar, istemci kotası bunu garanti edemez); overpass-api.de YOK (toplam kullanıcı sayılır, uygulama arka ucu olarak kullanımı
//     sorunlu); Valhalla /locate YOK (sürüşte 20 sn'lik arka plan yoklaması demo sunucuya yük bindirir); daha düşük saatlik + GÜNLÜK tavan.
//   - Yanıt tabanlı ana makine geri çekilmesi: 429 / 5xx / ağ hatası / zaman aşımı → o ana makine üstel bekler (15–30 sn → en çok 10 dk,
//     Retry-After en çok 1 sa); bekleme süresince istek ağa çıkmaz ('backoff'). Başarı sıfırlar. Fırtınayı çağıran koddan bağımsız keser.
// İstemci tavanları TOPLAM (tüm kullanıcılar) trafiği SINIRLAYAMAZ; bu yüzden yayın kapısı ayrıca belgelenir (docs/public-beta-release-gate.md).
//
// TAM BETA (v0.99.95, kullanıcı kararı 2026-11-16: public-free ile kapatılan mevcut özellikler Beta'da geri gelir): kaynakta yine 'paused'.
// Yalnız `node scripts/build-beta.mjs --beta-full [klasör]` çıktısında 'beta-full' olur. Küresel duraklatma ve public-free kesme/gizleme YOK:
// hesap, Premium, sağlayıcı bağdaştırıcıları, uydu, canlı trafik/doluluk/fiyat, eşitleme, telemetri ve kimlikli sunucu 0.99.61 Beta'daki gibi
// çalışır; Free/Premium yetkisi, kullanıcı başı günlük hak ve aylık tavanlar paylaşılan sunucuda (server/proxy.mjs) kalır, anahtarlar sunucuda.
// Korunan istemci koruması: topluluk servislerine (FREE_ENDPOINTS) cihaz başı jeton kovası + saatlik tavan + yanıt geri çekilmesi; sınırda
// istek reddedilir (kuyruk yok). Ücretli/sunucu yolları bu kovaya girmez (karar sunucuda).
export const PROVIDER_REQUESTS_PAUSED_DEFAULT = true;
/** Derleme modu. KAYNAKTA DAİMA 'paused'. scripts/build-beta.mjs --free-only bu satırı (tam bir eşleşme) 'free-only' yapar. */
export const PROVIDER_MODE_BUILD = 'paused';
export const FREE_ONLY = 'free-only';
export const PUBLIC_FREE = 'public-free';
export const BETA_FULL = 'beta-full';
/** Yalnız tam 'free-only' / 'public-free' / 'beta-full' dizgesi o modu açar; başka her değer (boş, büyük harf, boşluklu, 'open'...) → 'paused'. */
export const parseProviderMode = (v) => (v === FREE_ONLY || v === PUBLIC_FREE || v === BETA_FULL ? v : 'paused');

let paused = PROVIDER_REQUESTS_PAUSED_DEFAULT;
let mode = parseProviderMode(PROVIDER_MODE_BUILD);
/** Yalnız ücretsiz izin listesi modu mu (kapalı cihaz testi ya da herkese açık ücretsiz Beta derlemesi; ikisinde de ücretli yol yok). */
export const freeOnlyMode = () => mode === FREE_ONLY || mode === PUBLIC_FREE;
/** Herkese açık ücretsiz Beta mı (paylaşılan sunucuya sıfır istek, daraltılmış izin listesi, geri çekilme). */
export const publicFreeMode = () => mode === PUBLIC_FREE;
/** Tam Beta mı (duraklatma yok, tüm mevcut özellikler; topluluk servislerine cihaz başı tavan + geri çekilme korunur). */
export const betaFullMode = () => mode === BETA_FULL;
/** İstemci topluluk servisi kovası/geri çekilmesi etkin mi (yalnız ücretsiz modlar ve tam Beta). */
const limitedMode = () => freeOnlyMode() || betaFullMode();
/** Yanıt tabanlı ana makine geri çekilmesi etkin mi (herkese açık ücretsiz Beta ve tam Beta). */
const backoffMode = () => publicFreeMode() || betaFullMode();
/** Sağlayıcı istekleri (küresel olarak) duraklatılmış mı (kota koruması). Yalnız ücretsiz modda false: yerini izin listesi alır. */
export const providerRequestsPaused = () => paused && !freeOnlyMode() && !betaFullMode();
/** 'paused' | 'free-only' | 'public-free' | 'beta-full' | 'open' (open yalnız testlerde). */
export const providerMode = () => (freeOnlyMode() || betaFullMode() ? mode : paused ? 'paused' : 'open');
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
/** Paylaşılan canlı sunucu (üretime de hizmet eder). public-free modda proxyBase ne olursa olsun bu ana makineye istek gitmez. */
export const SHARED_SERVER_HOSTS = Object.freeze(['evcopilot.duckdns.org']);
/**
 * public-free modda paylaşılan sunucuda İZİNLİ tek yollar (v0.99.94, kullanıcı kararı: herkese açık Beta'da hesap/Google girişi geri gelir).
 * Yalnız hesap ve hesaba bağlı, üst sağlayıcıya GİTMEYEN yollar: giriş yoklaması/çıkış, hesap (plan), ayar/geçmiş eşitleme, fiyat ve varlık bildirimi.
 * /v1/config (anonim cihaz sayımı), /health, istasyon bilgisi/fotoğraf, tarife ve TÜM sağlayıcı yolları (PAUSED_PROXY_PATHS) kesik kalır.
 * Ücretli sağlayıcılar giriş yapılsa da kapalıdır (freeOnlyMode → proxyHas false). Google girişi tarayıcı sekmesinde açılır (fetch değil).
 */
export const PUBLIC_FREE_ACCOUNT_PATHS = Object.freeze([
  /^\/v1\/auth\/(?:poll|logout)$/, /^\/v1\/me$/, /^\/v1\/sync(?:\/[A-Za-z0-9_.-]{1,64})?$/, /^\/v1\/history\/[A-Za-z0-9_-]{1,32}$/, /^\/v1\/price$/, /^\/v1\/presence$/,
]);
/** Yol (sorgu hariç) public-free modda paylaşılan sunucuya gidebilir mi. */
export const publicFreeAccountPath = (path) => { const p = String(path || '').split('?')[0]; return PUBLIC_FREE_ACCOUNT_PATHS.some((re) => re.test(p)); };
/** Valhalla demo sunucusu, son kullanıcıya yayımlanan uygulamalardan tanıtıcı X-Client-Id başlığı ister (valhalla/valhalla README). */
export const PUBLIC_CLIENT_ID = 'EV-Route-Finder-Beta (ozdemirumit.github.io/EV-Route-Finder)';
const byId = (id) => FREE_ENDPOINTS.find((e) => e.id === id);
/**
 * Herkese açık ücretsiz Beta izin listesi (FREE_ENDPOINTS'in daraltılmışı). perDay: yerel gün tavanı (cihazda kalıcı, yeniden yüklemeyle sıfırlanmaz).
 * Sınırlar CİHAZ BAŞINADIR; toplam (tüm kullanıcılar) trafiği istemciden sınırlanamaz → yayın kapısı (docs/public-beta-release-gate.md).
 */
export const PUBLIC_FREE_ENDPOINTS = Object.freeze([
  Object.freeze({ ...byId('openfreemap'), perDay: 20000,
    terms: 'OpenFreeMap (openfreemap.org, 2026-11-16 okundu): istek/harita görüntüleme sınırı yok, ticari kullanım serbest; atıf zorunlu (MapLibre atıf denetimi).' }),
  Object.freeze({ ...byId('valhalla'), paths: [/^\/(?:route|height)$/], burst: 4, gapMs: 1500, perHour: 240, perDay: 1200,
    terms: 'Valhalla demo (github.com/valhalla/valhalla README, 2026-11-16): OSRM/Nominatim adil kullanımı; kullanıcı başına 1 çağrı/sn, toplam 100/sn (2021); son kullanıcı uygulaması X-Client-Id başlığı + bakımcılara bildirim ister (YAYIN KAPISI).' }),
  Object.freeze({ ...byId('open-meteo'), burst: 6, gapMs: 2000, perHour: 120, perDay: 600,
    terms: 'Open-Meteo (open-meteo.com/en/terms): yalnız ticari olmayan kullanım (abonelik/reklam yok), <10.000/gün, <5.000/sa, <600/dk; sınır IP ve uygulama başına; CC BY 4.0 atıf.' }),
  Object.freeze({ ...byId('photon'), perHour: 120, perDay: 500,
    terms: 'Photon (photon.komoot.io): "please be fair - extensive usage will be throttled"; sayısal sınır yayımlanmamış.' }),
  Object.freeze({ ...byId('overpass'), hosts: ['overpass.private.coffee'], burst: 2, gapMs: 3000, perHour: 40, perDay: 150,
    terms: 'overpass.private.coffee (OSM wiki): hız sınırı yok, her projede kullanılabilir; büyük ölçekli kullanım önceden bildirilmeli (YAYIN KAPISI). overpass-api.de toplam kullanıcıyı sayar ve uygulama arka ucu olarak sorunlu sayar → kapalı; overpass.kumi.systems aynı hizmetin eski adı → kapalı.' }),
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
  'shared-server': 'Herkese açık Beta paylaşılan sunucuya bağlanmaz',
  'backoff': 'Ücretsiz servis geçici olarak yanıt vermedi, biraz sonra yeniden denenecek',
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
  return (publicFreeMode() ? PUBLIC_FREE_ENDPOINTS : FREE_ENDPOINTS).find((e) => e.hosts.includes(u.hostname) && e.methods.includes(m) && e.paths.some((re) => re.test(u.pathname))) || null;
}

/**
 * İstek engellenmeli mi? null: izinli; 'external': harici sağlayıcı kökeni (duraklatma); 'proxy-provider': ara sunucunun sağlayıcı yolu;
 * 'paid-provider' / 'not-allowlisted': yalnız ücretsiz modda ücretli ya da listede olmayan adres; 'invalid': çözümlenemeyen adres (fail-closed);
 * 'shared-server': public-free modda paylaşılan canlı sunucu (proxyBase kökeni ya da SHARED_SERVER_HOSTS), yol fark etmez.
 * @param {RequestInfo|URL|string} input
 * @param {{origin?: string, proxyBase?: string, method?: string}} ctx origin: uygulamanın kökeni; proxyBase: ara sunucu taban adresi
 */
export function blockedReason(input, { origin = 'http://localhost', proxyBase = '', method = 'GET' } = {}) {
  const free = freeOnlyMode();
  if (betaFullMode() || (!paused && !free)) return null; // tam Beta: istemci hiçbir mevcut özelliği kesmez (kova/geri çekilme limiter'da)
  const u = toUrl(input, origin);
  if (!u) return 'invalid';
  if (u.protocol === 'data:' || u.protocol === 'blob:') return null;
  let pb = null;
  try { pb = proxyBase ? new URL(proxyBase) : null; } catch { pb = null; }
  if (publicFreeMode() && (SHARED_SERVER_HOSTS.includes(u.hostname) || (pb && u.origin === pb.origin && u.origin !== new URL(origin).origin))) {
    // v0.99.94: hesap/giriş geri geldi — yalnız paylaşılan sunucunun (https, standart port) HESAP yolları geçer; sağlayıcı/diğer yollar kesik kalır
    const acct = u.protocol === 'https:' && u.port === '' && !u.username && !u.password && SHARED_SERVER_HOSTS.includes(u.hostname) && publicFreeAccountPath(u.pathname);
    return acct ? null : 'shared-server';
  }
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

export const BACKOFF = Object.freeze({ netMs: 15e3, httpMs: 30e3, maxMs: 10 * 60e3, retryAfterMaxMs: 3600e3 });
/** Yanıt geri çekilmesi süresi: n. ardışık hata (1'den), Retry-After (ms, varsa) — üstel kısım en çok BACKOFF.maxMs; Retry-After en çok 1 sa. */
export function backoffMs(n, { http = false, retryAfterMs = 0 } = {}) {
  const base = Math.min(BACKOFF.maxMs, (http ? BACKOFF.httpMs : BACKOFF.netMs) * 2 ** Math.max(0, n - 1));
  return Math.max(base, Math.min(BACKOFF.retryAfterMaxMs, Number(retryAfterMs) || 0));
}
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);

/**
 * Ücretsiz uç başına (ana makine) jeton kovası + kayan saatlik tavan (+ public-free: günlük tavan ve yanıt geri çekilmesi). take(): izinliyse
 * jetonu harcar ve null döner; sınırdaysa 'rate-limit', geri çekilmedeyse 'backoff' (istek bekletilmez, reddedilir). Yalnız ücretsiz modda ve
 * izin listesindeki uçlarda sayar; başka her istek null.
 * @param {{now?: () => number, store?: Storage}} opts now: saat (testte sanal); store: günlük sayaç deposu (yalnız sayılar)
 */
export function createFreeLimiter({ now = () => Date.now(), store = globalThis.localStorage } = {}) {
  const buckets = new Map();
  const cool = new Map(); // ana makine → { n: ardışık hata, until }
  const DAY_KEY = 'evcp.freeDay'; // build-beta Beta öneki (evcpb) alır; yalnız sayılar (adres/konum yok)
  let day = null;
  const loadDay = (t) => {
    const k = dayKey(t);
    if (day?.d === k) return day;
    try { const j = JSON.parse(store?.getItem(DAY_KEY) || 'null'); day = j && j.d === k && j.n && typeof j.n === 'object' ? j : { d: k, n: {} }; } catch { day = { d: k, n: {} }; }
    return day;
  };
  const saveDay = () => { try { store?.setItem(DAY_KEY, JSON.stringify(day)); } catch { /* depolama yok: bellek içi sayar */ } };
  return {
    take(input, method = 'GET', origin = 'http://localhost') {
      if (!limitedMode()) return null;
      const u = toUrl(input, origin);
      const e = u && matchFree(u, method);
      if (!e) return null;
      const t = now();
      const c = cool.get(u.hostname);
      if (backoffMode() && c && t < c.until) return 'backoff';
      let b = buckets.get(u.hostname);
      if (!b) { b = { tokens: e.burst, at: t, hour: [] }; buckets.set(u.hostname, b); }
      b.tokens = Math.min(e.burst, b.tokens + Math.max(0, t - b.at) / e.gapMs);
      b.at = t;
      while (b.hour.length && t - b.hour[0] >= 3600e3) b.hour.shift();
      if (b.tokens < 1 || b.hour.length >= e.perHour) return 'rate-limit';
      if (publicFreeMode() && e.perDay) {
        const d = loadDay(t);
        if ((d.n[e.id] || 0) >= e.perDay) return 'rate-limit';
        d.n[e.id] = (d.n[e.id] || 0) + 1;
        saveDay();
      }
      b.tokens -= 1;
      b.hour.push(t);
      return null;
    },
    /** public-free: isteğin sonucu. ok: başarı (sayaç sıfır); değilse ana makine geri çekilir. Başka modda / listede olmayan uçta etkisiz. */
    result(input, method = 'GET', origin = 'http://localhost', { ok = true, http = false, retryAfterMs = 0 } = {}) {
      if (!backoffMode()) return;
      const u = toUrl(input, origin);
      if (!u || !matchFree(u, method)) return;
      if (ok) { cool.delete(u.hostname); return; }
      const n = (cool.get(u.hostname)?.n || 0) + 1;
      cool.set(u.hostname, { n, until: now() + backoffMs(n, { http, retryAfterMs }) });
    },
    /** Testler ve tanı içindir: ana makinenin geri çekilme durumu. */
    cooling(host) { const c = cool.get(host); return c ? { n: c.n, until: c.until } : null; },
  };
}

/** Retry-After başlığı → ms (saniye ya da HTTP tarihi). Okunamazsa 0. */
function retryAfterOf(res, t) {
  const v = res?.headers?.get?.('retry-after');
  if (!v) return 0;
  if (/^\d+$/.test(v.trim())) return Number(v.trim()) * 1000;
  const d = Date.parse(v);
  return Number.isFinite(d) ? Math.max(0, d - t) : 0;
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
 * @param {{getOrigin?: () => string, getProxyBase?: () => string, onBlock?: (reason:string, url:string) => void, now?: () => number, store?: Storage}} opts (store: günlük sayaç deposu; testte ayrı)
 */
export function installProviderGate(target = globalThis, { getOrigin = () => target.location?.origin || 'http://localhost', getProxyBase = () => '', onBlock, now, store } = {}) {
  const raw = target.fetch;
  if (typeof raw !== 'function' || raw.__providerGate) return raw;
  const limiter = createFreeLimiter({ ...(now ? { now } : {}), ...(store ? { store } : {}) });
  // Alttaki fetch + public-free yanıt gözlemcisi (çağıranın yeniden deneme mantığından bağımsız fırtına kesici). Yalnız İZİNLİ istek buraya gelir.
  const inner = function observedFetch(input, init) {
    const p = raw.call(this, input, init);
    if (!backoffMode()) return p;
    const method = String(init?.method || input?.method || 'GET').toUpperCase();
    const origin = getOrigin();
    const clock = now || (() => Date.now());
    return Promise.resolve(p).then((res) => {
      const bad = !!res && (res.status === 429 || res.status >= 500);
      try { limiter.result(input, method, origin, bad ? { ok: false, http: true, retryAfterMs: retryAfterOf(res, clock()) } : { ok: true }); } catch { /* sayaç hatası yanıtı bozmaz */ }
      return res;
    }, (err) => {
      if (err?.name !== 'AbortError') { try { limiter.result(input, method, origin, { ok: false }); } catch { /* yoksay */ } } // çağıranın iptali hata sayılmaz
      throw err;
    });
  };
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
