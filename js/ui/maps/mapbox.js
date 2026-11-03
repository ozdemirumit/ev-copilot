// Harita bağdaştırıcısı: Mapbox GL JS (Mapbox'un kendi CDN'inden, sürümü sabit) + Mapbox koyu stili. Yalnızca sunucu Premium
// hesaba Mapbox seçip herkese açık "pk." belirteci verdiğinde kullanılır (js/net/mapConfig.js). Gövde ortak vektör-harita
// motorundadır (mapEngine.js); burada kütüphane yükleme, stil, Mapbox uydu stili ve kimlik hatası (401/403) algılama kalır.
// Mapbox şartları: Mapbox logosu (kütüphanenin varsayılanı) ve metin atfı görünür kalır; atıf motorda kompakt denetimdir (ⓘ).
import { createVectorMap } from './mapEngine.js';

const VERSION = 'v3.16.0'; // sabit sürüm (@latest yok); yükseltirken api.mapbox.com/mapbox-gl-js/<sürüm>/ adresini doğrula
const CDN = `https://api.mapbox.com/mapbox-gl-js/${VERSION}/`;
const DARK = 'mapbox://styles/mapbox/dark-v11';
const SATELLITE = 'mapbox://styles/mapbox/satellite-streets-v12';

let loading = null;
let cssAdded = false;
/** Mapbox GL JS'i bir kez yükler (window.mapboxgl). Betik yüklenemezse reddeder ve sonraki çağrı yeniden dener. */
export function loadMapboxGL() {
  if (window.mapboxgl) return Promise.resolve(window.mapboxgl);
  loading ??= new Promise((resolve, reject) => {
    if (!cssAdded) {
      cssAdded = true;
      document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: CDN + 'mapbox-gl.css' }));
    }
    const s = Object.assign(document.createElement('script'), { src: CDN + 'mapbox-gl.js', async: true });
    const fail = () => { loading = null; s.remove(); reject(new Error('Mapbox kütüphanesi yüklenemedi')); };
    s.onload = () => (window.mapboxgl ? resolve(window.mapboxgl) : fail());
    s.onerror = fail;
    document.head.append(s);
  });
  return loading;
}

/** Mapbox'un kendi uydu stili (Esri karıştırılmaz). Stil değişimi setStyle(..., { diff: false }) ile yapılır: 'style.load'
 *  gelince motorun installLayers()'ı rota ve trafik katmanlarını son verileriyle geri koyar. */
function mapboxSatellite() {
  let on = false;
  return {
    install() {},
    set(map, want) {
      if (!!want === on) return; // açılıştaki setSatellite(false) stili yeniden yüklemez
      on = !!want;
      map.setStyle(on ? SATELLITE : DARK, { diff: false });
    },
  };
}

const isAuthError = (e) => e?.error?.status === 401 || e?.error?.status === 403;

/**
 * @param {HTMLElement} container
 * @param {string} token herkese açık Mapbox belirteci ("pk."); yalnızca bellekte
 * @param {{ onAuthFail?: () => void, loadLib?: () => Promise<any> }} [o] onAuthFail: stil/karo/sprite isteği 401/403 alınca
 *   bir kez çağrılır (404 vb. çağrılmaz). Yükleme bitmeden gelirse ayrıca söz hemen reddedilir. loadLib: testler için yükleyici.
 */
export async function createMapboxMap(container, token, { onAuthFail, loadLib = loadMapboxGL } = {}) {
  const mb = await loadLib();
  mb.accessToken = token;
  let authFailed = false;
  const onError = (e) => {
    if (isAuthError(e)) {
      if (authFailed) return;
      authFailed = true;
      onAuthFail?.();
    } else console.error(e?.error || e); // dinleyici varken kütüphane konsola yazmaz: bugünkü günlük korunur
  };
  return createVectorMap(mb, container, {
    mapOptions: { style: DARK, projection: 'mercator' }, // küre değil: zoom/kamera davranışı OpenFreeMap ile aynı
    name: 'mapbox',
    satellite: mapboxSatellite(),
    onError,
    isFatal: isAuthError,
  });
}
