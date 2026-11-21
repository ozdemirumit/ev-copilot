// Harita bağdaştırıcısı: HERE Raster Tile API v3 (maps.hereapi.com) karoları MapLibre GL JS ile. Yalnızca sunucu Premium hesaba HERE seçip ayrı tarayıcı
// anahtarını verdiğinde kullanılır (js/net/mapConfig.js). Gövde ortak harita motorundadır (mapEngine.js); burada yalnızca karo adresi, HERE'in kendi uydu stili
// ve kimlik hatası (401/403) algılama kalır. Karolar raster olduğundan 3B bina katmanı yok (navigasyon 3B görünümü düz harita üzerinde eğimle çalışır).
// Rota/trafik HERE'den gelmez (Valhalla); yalnızca harita. Atıf "© HERE" kaynak atfı olarak motorun kompakt atıf denetiminde (ⓘ) görünür.
// Not: HERE'in zorunlu telif/atıf metni ve tüketici navigasyonu kullanım hakları doğrulanmadı (providerPolicy: unverified).
import { createVectorMap } from './mapEngine.js';
import { loadMapLibre } from './maplibre.js';

const TILES = 'https://maps.hereapi.com/v3/base/mc/{z}/{x}/{y}';
const NIGHT = 'png8?style=explore.night';
const SATELLITE = 'jpeg?style=explore.satellite.day'; // uydu görüntüsü jpeg ister (belge: png8 uydu stilinde desteklenmez)
const ATTRIBUTION = '© HERE';

/** Karo adresi şablonu: anahtar yalnızca bellekteki adreste (localStorage'a yazılmaz); {z}/{x}/{y} kütüphanede doldurulur. */
export const tileUrl = (key, sat = false) => `${TILES}/${sat ? SATELLITE : NIGHT}&apiKey=${encodeURIComponent(key)}`;

/** Tek raster kaynaklı MapLibre stili (glif/sprite yok: yalnızca karo katmanı; rota ve trafik katmanları motorda eklenir). */
export const hereStyle = (key, sat = false) => ({
  version: 8,
  name: 'here',
  sources: { here: { type: 'raster', tiles: [tileUrl(key, sat)], tileSize: 256, maxzoom: 20, attribution: ATTRIBUTION } },
  layers: [{ id: 'here-base', type: 'raster', source: 'here' }],
});

/** HERE'in kendi uydu stili (başka sağlayıcının görüntüsü karıştırılmaz). Stil değişimi setStyle(..., { diff: false }) ile yapılır:
 *  'style.load' gelince motorun installLayers()'ı rota ve trafik katmanlarını son verileriyle geri koyar. */
export function hereSatellite(key) {
  let on = false;
  return {
    install() {},
    set(map, want) {
      if (!!want === on) return; // açılıştaki setSatellite(false) stili yeniden yüklemez
      on = !!want;
      map.setStyle(hereStyle(key, on), { diff: false });
    },
  };
}

export const isAuthError = (e) => e?.error?.status === 401 || e?.error?.status === 403;

/**
 * @param {HTMLElement} container
 * @param {string} key HERE harita anahtarı; yalnızca bellekte
 * @param {{ onAuthFail?: () => void, loadLib?: () => Promise<any> }} [o] onAuthFail: karo isteği 401/403 alınca bir kez çağrılır.
 */
export async function createHereMap(container, key, { onAuthFail, loadLib = loadMapLibre } = {}) {
  const ml = await loadLib();
  let authFailed = false;
  const onError = (e) => {
    if (isAuthError(e)) {
      if (authFailed) return;
      authFailed = true;
      onAuthFail?.();
    } else console.error(e?.error || e);
  };
  return createVectorMap(ml, container, {
    mapOptions: { style: hereStyle(key) },
    name: 'here',
    satellite: hereSatellite(key),
    onError,
    isFatal: isAuthError,
  });
}
