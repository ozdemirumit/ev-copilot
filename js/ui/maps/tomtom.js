// Harita bağdaştırıcısı: TomTom Orbis vektör haritası (Maps Display API) MapLibre GL JS ile. Yalnızca sunucu Premium hesaba TomTom seçip
// anahtarı verdiğinde kullanılır (js/net/mapConfig.js). Gövde ortak vektör-harita motorundadır (mapEngine.js); burada stil adresi, TomTom'un kendi
// uydu stili ve kimlik hatası (401/403) algılama kalır. Atıf (© OpenStreetMap | © TomTom) stil kaynağından gelir ve motorun kompakt atıf denetiminde (ⓘ) görünür.
// Not: 3B bina katmanı bu sağlayıcıda yok (stilin kendi 3B katmanı kullanılmaz); navigasyon 3B görünümü düz harita üzerinde eğimle çalışır.
import { createVectorMap } from './mapEngine.js';
import { loadMapLibre } from './maplibre.js';

const STYLES = 'https://api.tomtom.com/maps/orbis/assets/styles/0.*/style.json';
const DARK = 'basic_street-dark';
const SATELLITE = 'basic_street-satellite';

/** Stil adresi: anahtar yalnızca bellekteki adreste (localStorage'a yazılmaz); stil içindeki karo/yazı tipi/simge adresleri anahtarı kendisi taşır. */
export const styleUrl = (key, name = DARK) => `${STYLES}?apiVersion=1&map=${name}&key=${encodeURIComponent(key)}`;

/** TomTom'un kendi uydu stili (başka sağlayıcının görüntüsü karıştırılmaz). Stil değişimi setStyle(..., { diff: false }) ile yapılır:
 *  'style.load' gelince motorun installLayers()'ı rota ve trafik katmanlarını son verileriyle geri koyar. */
function tomtomSatellite(key) {
  let on = false;
  return {
    install() {},
    set(map, want) {
      if (!!want === on) return; // açılıştaki setSatellite(false) stili yeniden yüklemez
      on = !!want;
      map.setStyle(styleUrl(key, on ? SATELLITE : DARK), { diff: false });
    },
  };
}

const isAuthError = (e) => e?.error?.status === 401 || e?.error?.status === 403;

/**
 * @param {HTMLElement} container
 * @param {string} key TomTom anahtarı; yalnızca bellekte
 * @param {{ onAuthFail?: () => void, loadLib?: () => Promise<any> }} [o] onAuthFail: stil/karo isteği 401/403 alınca bir kez çağrılır.
 */
export async function createTomTomMap(container, key, { onAuthFail, loadLib = loadMapLibre } = {}) {
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
    mapOptions: { style: styleUrl(key) },
    name: 'tomtom',
    satellite: tomtomSatellite(key),
    onError,
    isFatal: isAuthError,
  });
}
