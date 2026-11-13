// Premium sağlayıcı kataloğu (F1) — SAF, YAN ETKİSİZ, SALT OKUNUR. Ağ, ortam değişkeni, dosya, anahtar yok; çalışma zamanına HENÜZ BAĞLI DEĞİL.
// Amaç: kullanıcıya sunulabilecek harita/rota/trafik sağlayıcılarını (osm, mapbox, tomtom, google, here) GERÇEK bağlantı durumuyla tek yerde
// tanımlamak. "available" yalnızca kodda gerçekten bağlı + (Premium ise) yapılandırılmış yetenek içindir; lisans onayı anlamına GELMEZ.
//
// Gerçek bağlantı (HEAD kodundan):
//  - osm:    harita OpenFreeMap (js/net/mapConfig.js), rota Valhalla (js/providers/index.js). Canlı trafik YOK.
//  - mapbox: harita (server/maps.mjs), rota+trafik Mapbox Directions driving-traffic (js/mapbox/route.js); rota haritadan bağımsız kullanılır.
//  - tomtom: harita (server/maps.mjs), rota+trafik js/tomtom/route.js — yalnızca açık harita TomTom iken (tomtomRouteOn).
//  - google: YALNIZCA harita (server/maps.mjs). Google Routes bağlı DEĞİL: Google haritası seçilse bile rota Google'dan gelmez.
//  - here:   harita/rota/trafik bağlı DEĞİL (server/here.mjs yalnızca istasyon araması); providerPolicy'de de kapalı.
//
// Yapılandırma YALNIZCA boolean alır, yetenek bazında: { plan, configured: { mapbox: { map, route }, tomtom: { map, route }, google: { map } } }.
// Değer tam olarak `true` değilse yapılandırılmamış sayılır (fail-closed); değerler çıktıya asla kopyalanmaz. Çağıran tarafın eşlemesi
// (bağlanınca; şimdilik yok): mapbox.map ← maps.available().mapbox, mapbox.route ← MAPBOX var, tomtom.map ← maps.available().tomtom,
// tomtom.route ← TOMTOM_KEY var, google.map ← maps.available().google. Anahtarın kendisi bu modüle verilmez.
// Trafik yeteneği rota yapılandırmasından türetilir (ayrı bayrak yok). osm anahtarsızdır ve yapılandırmayla kapatılamaz.
//
// HUKUKİ NOT: Bu bir lisans incelemesi DEĞİLDİR. osm/tomtom/here lisans durumu providerPolicy.mjs'den okunur (tek kaynak).
// Mapbox ve Google için kayıtlı bir lisans/ToS incelemesi yok → "unverified"; varsayım yapılmaz. Yapılandırma lisansı yükseltemez.
import { getProvider as policyProvider } from './providerPolicy.mjs';

export const CATALOG_PROVIDER_IDS = Object.freeze(['osm', 'mapbox', 'tomtom', 'google', 'here']);
export const CATALOG_CAPABILITIES = Object.freeze(['map', 'route', 'traffic']);
export const CATALOG_STATUSES = Object.freeze(['available', 'not-configured', 'premium-required', 'coming-soon', 'unavailable']);

const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  return Object.freeze(o);
};

const licenseFromPolicy = (id) => policyProvider(id)?.licenseStatus === 'approved' ? 'approved' : 'unverified';

/**
 * Katalog. wired: kodda gerçekten bağlı yetenek. comingSoon: bağlı değil ama planlanan (seçilemez). needsConfig: Premium'da yapılandırma
 * gerekir. requiresMap: rota/trafik yalnızca aynı sağlayıcının haritası da kullanılabilirken çalışır (TomTom kuralı).
 */
const CATALOG = deepFreeze({
  osm: {
    id: 'osm', label: 'OpenStreetMap (OpenFreeMap + Valhalla)', tier: 'free',
    wired: { map: true, route: true, traffic: false }, comingSoon: [], needsConfig: false, requiresMap: false,
    licenseStatus: licenseFromPolicy('osm'),
    licenseNote: 'ODbL açık lisans, atıf zorunlu (© OpenStreetMap contributors); providerPolicy kaydından.',
    routeNote: 'Rota Valhalla (OSM); canlı trafik yok, süreler serbest akış.',
  },
  mapbox: {
    id: 'mapbox', label: 'Mapbox', tier: 'premium',
    wired: { map: true, route: true, traffic: true }, comingSoon: [], needsConfig: true, requiresMap: false,
    licenseStatus: 'unverified',
    licenseNote: 'Mapbox kullanım koşulları için kayıtlı bir inceleme yok: doğrulanmadı (unverified).',
    routeNote: 'Rota/trafik Mapbox Directions driving-traffic; harita seçiminden bağımsız kullanılır.',
  },
  tomtom: {
    id: 'tomtom', label: 'TomTom', tier: 'premium',
    wired: { map: true, route: true, traffic: true }, comingSoon: [], needsConfig: true, requiresMap: true,
    licenseStatus: licenseFromPolicy('tomtom'),
    licenseNote: 'TomTom API koşulları doğrulanmadı (unverified); providerPolicy kaydından. TomTom sonuçları yalnızca TomTom haritasında gösterilir.',
    routeNote: 'Rota/trafik TomTom; yalnızca açık harita TomTom iken kullanılır.',
  },
  google: {
    id: 'google', label: 'Google Maps', tier: 'premium',
    wired: { map: true, route: false, traffic: false }, comingSoon: ['route'], needsConfig: true, requiresMap: false,
    licenseStatus: 'unverified',
    licenseNote: 'Google Maps Platform koşulları için kayıtlı bir inceleme yok: doğrulanmadı (unverified).',
    routeNote: 'Google Routes henüz bağlı değil (coming-soon): Google haritası seçilse bile rota Google\'dan gelmez.',
  },
  here: {
    id: 'here', label: 'HERE', tier: 'premium',
    wired: { map: false, route: false, traffic: false }, comingSoon: ['map', 'route', 'traffic'], needsConfig: true, requiresMap: false,
    licenseStatus: licenseFromPolicy('here'),
    licenseNote: 'HERE tüketici navigasyonu ve karışık veri hakları doğrulanmadı (unverified); providerPolicy kaydından.',
    routeNote: 'HERE harita/rota/trafik henüz bağlı değil (coming-soon).',
  },
});

/** Katalog girdisi (salt okunur); bilinmeyen ad → null. */
export function catalogEntry(id) {
  return typeof id === 'string' && Object.hasOwn(CATALOG, id) ? CATALOG[id] : null;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const planOf = (cfg) => (isObj(cfg) && cfg.plan === 'premium' ? 'premium' : 'free'); // tanınmayan plan Free (harf esnetilmez)

/** Yalnızca kendi alanlardaki `true` değerleri okunur. Boolean olmayan değerlerin YALNIZCA yolu (değeri değil) ignored'a yazılır. */
function readFlags(cfg, ignored) {
  const out = {};
  const conf = isObj(cfg) && isObj(cfg.configured) ? cfg.configured : {};
  for (const id of CATALOG_PROVIDER_IDS) {
    const flags = { map: false, route: false };
    const src = Object.hasOwn(conf, id) ? conf[id] : undefined;
    if (src !== undefined && !isObj(src)) ignored.push(id);
    else if (isObj(src)) {
      for (const c of ['map', 'route']) {
        if (!Object.hasOwn(src, c)) continue;
        if (typeof src[c] === 'boolean') flags[c] = src[c];
        else ignored.push(`${id}.${c}`);
      }
    }
    out[id] = flags;
  }
  return out;
}

function capStatus(e, c, plan, flags) {
  if (!e.wired[c]) return e.comingSoon.includes(c) ? { status: 'coming-soon', reason: 'not-wired' } : { status: 'unavailable', reason: 'not-wired' };
  if (e.tier === 'premium' && plan !== 'premium') return { status: 'premium-required', reason: 'premium-required' };
  if (!e.needsConfig) return { status: 'available', reason: null };
  const own = c === 'map' ? flags.map : flags.route; // trafik rota yapılandırmasından türer
  if (!own) return { status: 'not-configured', reason: 'not-configured' };
  if (c !== 'map' && e.requiresMap && !flags.map) return { status: 'not-configured', reason: 'requires-map' };
  return { status: 'available', reason: null };
}

/**
 * Katalog görünümü üretir. Girdi: { plan: 'free'|'premium', configured: { <id>: { map?: boolean, route?: boolean } } }.
 * Dönüş (derin dondurulmuş): { plan, providers: [{ id, label, status, selectable, routeAvailable, routeNote, capabilities: { map|route|traffic:
 * { status, reason } }, licenseStatus, licenseVerified, licenseNote, warnings[] }], ignoredConfig[] }.
 * status/selectable harita seçimine göredir (Premium seçicide sağlayıcı = harita); rota ayrıca routeAvailable ile açıkça belirtilir.
 * Free'de yalnızca osm available. Girdi değiştirilmez, asla atmaz.
 */
export function buildCatalog(cfg) {
  const plan = planOf(cfg);
  const ignored = [];
  const flags = readFlags(cfg, ignored);
  const providers = CATALOG_PROVIDER_IDS.map((id) => {
    const e = CATALOG[id];
    const capabilities = {};
    for (const c of CATALOG_CAPABILITIES) capabilities[c] = capStatus(e, c, plan, flags[id]);
    const status = e.wired.map ? capabilities.map.status : (e.comingSoon.includes('map') ? 'coming-soon' : 'unavailable');
    const licenseVerified = e.licenseStatus === 'approved';
    const warnings = [];
    if (!licenseVerified) warnings.push('license-unverified');
    if (e.comingSoon.includes('route')) warnings.push('route-coming-soon');
    return {
      id, label: e.label, status, selectable: status === 'available',
      routeAvailable: capabilities.route.status === 'available', routeNote: e.routeNote,
      capabilities, licenseStatus: e.licenseStatus, licenseVerified, licenseNote: e.licenseNote, warnings,
    };
  });
  return deepFreeze({ plan, providers, ignoredConfig: ignored });
}
