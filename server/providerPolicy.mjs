// Sağlayıcı politika/yetenek kaydı (SAF, SALT OKUNUR). Ağ, anahtar, ortam değişkeni, içe aktarma yok; çalışma zamanına HENÜZ BAĞLI DEĞİL.
// Amaç: hangi sağlayıcının (osm/tomtom/here) hangi katmanda (Free/Premium) hangi yetenek (harita/rota/veri) için ve hangi
// harita-rota-veri birleşimiyle kullanılabileceğini muhafazakâr varsayılanlarla tek yerde tanımlamak.
//
// HUKUKİ NOT: Bu dosya bir lisans incelemesi DEĞİLDİR. HERE (tüketici navigasyonu / karışık veri hakları) ve TomTom API koşulları
// DOĞRULANMAMIŞTIR ("unverified"). HERE için "approved" yalnızca belgelenmiş bir hukuki incelemeden sonra, kod incelemesiyle
// bu dosyada değiştirilebilir; yapılandırma (resolvePolicy) lisans durumunu asla yükseltemez.
// OSM "approved": açık lisans (ODbL) tabanı, atıf zorunlu; mevcut Free davranışıdır, ayrı bir hukuki inceleme iddia edilmez.
//
// Kural özeti (varsayılan reddet):
//  - Bilinmeyen sağlayıcı, kapalı yetenek, Free plan için Premium sağlayıcı → denied.
//  - Sağlayıcılar arası karıştırma (ör. OSM haritada TomTom rotası, TomTom haritada HERE verisi) → denied; yalnızca ALLOWED_COMBINATIONS.
//  - Kurallar geçse bile birleşimdeki herhangi bir sağlayıcının lisansı "unverified" ise → status 'unverified', allowed false.

export const PROVIDER_IDS = Object.freeze(['osm', 'tomtom', 'here']);
export const CAPABILITIES = Object.freeze(['map', 'route', 'data']);
export const LICENSE_STATUSES = Object.freeze(['unverified', 'approved']);
export const PLANS = Object.freeze(['free', 'premium']);

const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  return Object.freeze(o);
};

/** Varsayılan kayıt. capabilities: sağlayıcının teknik olarak sunduğu; enabledByDefault: politika gereği açık olan. */
const REGISTRY = deepFreeze({
  osm: {
    id: 'osm',
    tier: 'free',
    licenseStatus: 'approved',
    provenance: 'OpenStreetMap katkıcıları (ODbL); karo OpenFreeMap, rota Valhalla (FOSSGIS), istasyon Overpass',
    capabilities: { map: true, route: true, data: true },
    enabledByDefault: { map: true, route: true, data: true },
    attribution: { required: true, text: '© OpenStreetMap contributors', note: 'ODbL; harita üzerinde görünür olmalı' },
  },
  tomtom: {
    id: 'tomtom',
    tier: 'premium',
    licenseStatus: 'unverified',
    provenance: 'TomTom Maps/Routing/Traffic API (ticari; API koşulları doğrulanmadı)',
    capabilities: { map: true, route: true, data: true },
    enabledByDefault: { map: true, route: true, data: true },
    attribution: { required: true, text: '© TomTom', note: 'TomTom sonuçları yalnızca TomTom haritasında gösterilir' },
  },
  here: {
    id: 'here',
    tier: 'premium',
    licenseStatus: 'unverified',
    provenance: 'HERE Location Services (ticari; tüketici navigasyonu ve karışık veri hakları doğrulanmadı)',
    capabilities: { map: true, route: true, data: true },
    enabledByDefault: { map: false, route: false, data: false },
    attribution: { required: true, text: '© HERE', note: 'HERE verisi başka sağlayıcının haritasında gösterilmez' },
  },
});

/** Açıkça izin verilen harita/rota/veri birleşimleri (data null = üçüncü taraf veri yok). Yalnızca tek sağlayıcılı birleşimler. */
export const ALLOWED_COMBINATIONS = deepFreeze(
  PROVIDER_IDS.flatMap((p) => [
    { map: p, route: p, data: p },
    { map: p, route: p, data: null },
    { map: p, route: null, data: null },
    { map: p, route: null, data: p },
  ]),
);

const norm = (v) => (v === undefined || v === '' ? null : v);
const planOf = (plan) => (plan === 'premium' ? 'premium' : 'free'); // tanınmayan/eksik plan Free sayılır (büyük/küçük harf esnetilmez)

/** Birleşim ALLOWED_COMBINATIONS içinde mi (saf karşılaştırma). */
export function isCombinationAllowed({ map, route, data } = {}) {
  const c = { map: norm(map), route: norm(route), data: norm(data) };
  return ALLOWED_COMBINATIONS.some((a) => a.map === c.map && a.route === c.route && a.data === c.data);
}

/** Verilen sağlayıcıların tekrarsız atıf listesi (bilinmeyen/null atlanır). */
export function attributionFor(ids = []) {
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    const p = REGISTRY[id];
    if (!p || !Object.hasOwn(REGISTRY, id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ provider: id, ...p.attribution });
  }
  return out;
}

/**
 * Yapılandırmadan bir politika görünümü üretir. config.enable = { here: { map: true } } gibi YALNIZCA etkinlik bayraklarını değiştirebilir;
 * lisans durumu, katman ve yetenekler değiştirilemez (config.licenseStatus vb. yok sayılır). Varsayılan kayıt asla değişmez.
 */
export function resolvePolicy(config = {}) {
  const providers = {};
  for (const id of PROVIDER_IDS) {
    const base = REGISTRY[id];
    const over = config?.enable && Object.hasOwn(config.enable, id) ? config.enable[id] : null;
    const enabled = {};
    for (const cap of CAPABILITIES) {
      const want = over && typeof over[cap] === 'boolean' ? over[cap] : base.enabledByDefault[cap];
      enabled[cap] = base.capabilities[cap] === true && want === true;
    }
    providers[id] = deepFreeze({ ...base, enabled });
  }
  Object.freeze(providers);

  const get = (id) => (typeof id === 'string' && Object.hasOwn(providers, id) ? providers[id] : null);

  /**
   * İstek: { plan: 'free'|'premium', map, route?, data? }. Dönüş: { allowed, status: 'allowed'|'denied'|'unverified', reasons[], attributions[] }.
   * reasons biçimi: '<sağlayıcı>:<neden>' ya da 'cross-provider-mix' / 'map:missing'. Girdi değiştirilmez.
   */
  function evaluate(req = {}) {
    const plan = planOf(req?.plan);
    const sel = { map: norm(req?.map), route: norm(req?.route), data: norm(req?.data) };
    const reasons = [];
    const used = [];
    if (sel.map === null) reasons.push('map:missing');
    for (const cap of CAPABILITIES) {
      const id = sel[cap];
      if (id === null) continue;
      const p = get(id);
      if (!p) { if (!reasons.includes(`${id}:unknown-provider`)) reasons.push(`${id}:unknown-provider`); continue; }
      if (!used.includes(id)) used.push(id);
      if (!p.enabled[cap]) reasons.push(`${id}:${cap}:disabled`);
      if (p.tier === 'premium' && plan !== 'premium' && !reasons.includes(`${id}:premium-required`)) reasons.push(`${id}:premium-required`);
    }
    if (!isCombinationAllowed(sel)) reasons.push('cross-provider-mix');
    const attributions = attributionFor(used);
    if (reasons.length) return { allowed: false, status: 'denied', reasons, attributions };
    const unverified = used.filter((id) => get(id).licenseStatus !== 'approved');
    if (unverified.length) return { allowed: false, status: 'unverified', reasons: unverified.map((id) => `${id}:license-unverified`), attributions };
    return { allowed: true, status: 'allowed', reasons: [], attributions };
  }

  return Object.freeze({ getProvider: get, listProviders: () => PROVIDER_IDS.map(get), evaluate, isCombinationAllowed, attributionFor });
}

const DEFAULT = resolvePolicy();

/** Varsayılan (salt okunur) kayıt girdisi; bilinmeyen ad → null. */
export function getProvider(id) {
  return typeof id === 'string' && Object.hasOwn(REGISTRY, id) ? REGISTRY[id] : null;
}
export function listProviders() {
  return PROVIDER_IDS.map((id) => REGISTRY[id]);
}
/** Varsayılan politikaya göre değerlendirme (HERE kapalı, TomTom/HERE lisansı doğrulanmamış). */
export const evaluate = DEFAULT.evaluate;
