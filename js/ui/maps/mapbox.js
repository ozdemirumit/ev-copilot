// Harita bağdaştırıcısı: Mapbox GL JS (Mapbox'un kendi CDN'inden, sürümü sabit) + Mapbox koyu stili. Yalnızca sunucu Premium
// hesaba Mapbox seçip herkese açık "pk." belirteci verdiğinde kullanılır (js/net/mapConfig.js). Gövde ortak vektör-harita
// motorundadır (mapEngine.js); burada kütüphane yükleme, stil, Mapbox uydu stili ve kimlik hatası (401/403) algılama kalır.
// Mapbox şartları: Mapbox logosu (kütüphanenin varsayılanı) ve metin atfı görünür kalır; atıf motorda kompakt denetimdir (ⓘ).
import { createVectorMap, buildingsLayer } from './mapEngine.js';

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

/** 3B binalar (navigasyonda 3B): Mapbox stillerinin (dark-v11, satellite-streets-v12) 'composite' kaynağındaki bina yükseklikleri.
 *  Yalnızca extrude == 'true' olanlar yükseltilir; stil değişiminde (uydu aç/kapa) motor yeniden ekler. */
const BUILDINGS = {
  layer: buildingsLayer({ source: 'composite', filter: ['==', ['get', 'extrude'], 'true'], height: 'height', base: 'min_height' }),
  hide: ['building'],
};

const isAuthError = (e) => e?.error?.status === 401 || e?.error?.status === 403;

/**
 * @param {HTMLElement} container
 * @param {string} token herkese açık Mapbox belirteci ("pk."); yalnızca bellekte
 * @param {{ onAuthFail?: () => void, loadLib?: () => Promise<any>, libTimeoutMs?: number }} [o] onAuthFail: stil/karo/sprite
 *   isteği 401/403 alınca bir kez çağrılır (404 vb. çağrılmaz). Yükleme bitmeden gelirse ayrıca söz hemen reddedilir.
 *   loadLib: testler için yükleyici. libTimeoutMs: kütüphane yükleme süresi (varsayılan 25 sn; harita yüklemesi ayrıca 25 sn).
 */
export async function createMapboxMap(container, token, { onAuthFail, loadLib = loadMapboxGL, libTimeoutMs = 25000 } = {}) {
  // CDN yanıt vermeden asılı kalırsa betiğin onerror'ı dakikalarca gelmeyebilir: süre dolunca reddet (çağıran OpenFreeMap'e düşer).
  // Önbellekteki yükleme sözüne dokunulmaz: geç de olsa yüklenirse sonraki çağrı onu kullanır.
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Mapbox kütüphanesi zamanında yüklenemedi')), libTimeoutMs); });
  const mb = await Promise.race([loadLib(), deadline]).finally(() => clearTimeout(timer));
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
    buildings: BUILDINGS,
    onError,
    isFatal: isAuthError,
  });
}
