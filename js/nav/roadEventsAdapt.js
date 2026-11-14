// Sağlayıcı yol olayları bağdaştırıcı İSKELETİ (BL-P2-05a; SAF, çevrimdışı, FAIL-CLOSED). Modül hiçbir şey içe aktarmaz ve
// hiçbir çalışma zamanı dosyası bu modülü içe aktarmaz: kullanıcıya yol uyarısı GÖSTERİLMEZ, rota/arayüz davranışı değişmez.
//
// fromOsm / fromMapbox / fromTomTom bugün sağlayıcı yanıtını HİÇ OKUMAZ ve yalnızca o sağlayıcıya ait BOŞ yol olayları modelini
// döndürür: yol olayları modelindeki (BL-P2-03, js/nav/ altında) emptyEvents(p, { supports: [] }) ile birebir aynı biçim
// (v, provider, supports, events, denied). Yanıtta tünel sınıfı, gişe, çıkış ya da tabela alanı bulunsa bile 0 olay ve 0 yetenek.
// Gerekçe: aşağıdaki alanların anlamı ve güvenilirliği gerçek kayıtla doğrulanmadı; doğrulanmamış veriden uyarı üretilmez.
// - Sağlayıcı kaynağı (provenance) yalnızca çağrılan bağdaştırıcıdan gelir; girdideki provider/supports/events iddiası yok sayılır.
// - Girdi değiştirilmez (okunmaz bile); çıktılar derin dondurulmuştur.
// - FIELD_EVIDENCE: aday alanların değişmez listesi; TÜMÜ unverified, records 0, evidence null (gerçek kayıt yok).
// - adaptEvidence: _synthetic girdi ASLA verified olamaz; bugün hiçbir girdi verified olamaz.
// - Ağ, anahtar, ortam değişkeni, DOM, depolama, zaman kullanılmaz.
// MODEL_VERSION ve boş model biçiminin yol olayları modeliyle eşleşmesi scripts/test-road-events-adapt.mjs'te denetlenir
// (bilerek içe aktarılmaz: o model hiçbir çalışma zamanı dosyasına bağlı olmamalıdır).

export const ADAPT_VERSION = 1;
export const MODEL_VERSION = 1;
export const ADAPTER_PROVIDERS = Object.freeze(['osm', 'mapbox', 'tomtom']);

const f = (o) => Object.freeze(o);
const field = (name) => f({ field: name, status: 'unverified', records: 0, evidence: null });

// Aday alan adları (yanıt yolları). Değerleri okunmaz; yalnızca ileride doğrulanacak alanların kaydıdır.
export const FIELD_EVIDENCE = f({
  osm: f([
    field('routes[].legs[].steps[].intersections[].classes'),
    field('routes[].legs[].steps[].exits'),
    field('routes[].legs[].steps[].destinations'),
  ]),
  mapbox: f([
    field('routes[].legs[].steps[].intersections[].classes'),
    field('routes[].legs[].steps[].intersections[].toll_collection'),
    field('routes[].legs[].steps[].exits'),
    field('routes[].legs[].steps[].bannerInstructions[].primary.components'),
  ]),
  tomtom: f([
    field('routes[].sections[].sectionType'),
    field('routes[].guidance.instructions[].exitNumber'),
    field('routes[].guidance.instructions[].signpostText'),
  ]),
});

const empty = (provider) => f({ v: MODEL_VERSION, provider, supports: f([]), events: f([]), denied: f([]) });

/** OSM (OSRM) rota yanıtı → boş osm modeli (fail-closed; yanıt okunmaz). */
export function fromOsm(_response) { return empty('osm'); }
/** Mapbox Directions yanıtı → boş mapbox modeli (fail-closed; yanıt okunmaz). */
export function fromMapbox(_response) { return empty('mapbox'); }
/** TomTom Routing yanıtı → boş tomtom modeli (fail-closed; yanıt okunmaz). */
export function fromTomTom(_response) { return empty('tomtom'); }

/**
 * Bağdaştırıcının kanıt durumu. status her zaman 'unverified', records 0. synthetic yalnızca girdi._synthetic === true ise true;
 * girdideki status/verified/records iddiaları yok sayılır. Bilinmeyen/bağdaştırıcısız sağlayıcı → provider null, alan yok.
 */
export function adaptEvidence(provider, response) {
  const p = ADAPTER_PROVIDERS.includes(provider) ? provider : null;
  const synthetic = response !== null && typeof response === 'object' && response._synthetic === true;
  return f({ provider: p, status: 'unverified', synthetic, records: 0, fields: p ? FIELD_EVIDENCE[p] : f([]) });
}
