// Harita sağlayıcısı çözümü (OpenFreeMap / Mapbox / Google). Sağlayıcıyı sunucu seçer (GET /v1/map/config, yalnızca Premium'a
// anahtar verir); istemci yalnızca son etkin sağlayıcının ADINI cihazda saklar (evcp.mapProvider). Anahtar/belirteç yalnızca
// dönüş değerinde, bellekte kalır: localStorage'a ya da sessionStorage'a asla yazılmaz.
// Açılış harita için bekletilmez: oturum yoksa ya da saklı ad osm ise hemen osm (arka planda yalnızca ad tazelenir);
// saklı ad mapbox/google ise yanıt en çok timeoutMs beklenir. Hata, 429, zaman aşımı ya da bozuk yanıt → osm.
import { load, save } from '../utils/storage.js';
import { proxyFetch, proxyReady as hasCreds } from './proxy.js';

const NAMES = ['osm', 'mapbox', 'google'];
const FORCE_KEY = 'mapForceOsm'; // sessionStorage: sağlayıcı bu cihaz oturumunda çalışmadı, OpenFreeMap zorlanır
const OSM = Object.freeze({ provider: 'osm' });

/** Son etkin sağlayıcının adı (anahtar değil). Bilinmeyen değer osm sayılır. */
export function savedProvider() {
  const p = load('mapProvider', 'osm');
  return NAMES.includes(p) ? p : 'osm';
}

/** Sağlayıcı çalışmadı: bu cihaz oturumu boyunca OpenFreeMap kullanılır (yenilemede döngü olmaz). */
export function forceOsm() {
  try { sessionStorage.setItem(FORCE_KEY, '1'); } catch { /* özel pencere: yoksay */ }
}
export const osmForced = () => { try { return sessionStorage.getItem(FORCE_KEY) === '1'; } catch { return false; } };

/** Sunucu yanıtını doğrula ve yalnızca gereken alanları al; geçersizse null. */
function parse(j) {
  if (j?.provider === 'osm') return { provider: 'osm' };
  if (j?.provider === 'mapbox' && typeof j.token === 'string' && j.token) return { provider: 'mapbox', token: j.token };
  if (j?.provider === 'google' && typeof j.key === 'string' && j.key) return { provider: 'google', key: j.key, mapId: typeof j.mapId === 'string' && j.mapId ? j.mapId : 'DEMO_MAP_ID' };
  return null;
}

/** /v1/map/config: geçerli yanıt gelirse sağlayıcı ADI saklanır (Premium bittiyse osm) ve yanıt döner; aksi halde null. */
async function fetchConfig(signal) {
  try {
    const res = await proxyFetch('/v1/map/config', { signal, cache: 'no-store' });
    if (!res.ok) return null; // 401, 429 (günlük hak doldu), 5xx: saklı ad değişmez, bu açılış osm
    const cfg = parse(await res.json());
    if (cfg) save('mapProvider', cfg.provider); // yalnızca ad; anahtar asla
    return cfg;
  } catch { return null; }
}

/**
 * Bu açılışta kullanılacak sağlayıcı. Asla reddetmez.
 * @returns {Promise<{provider:'osm'} | {provider:'mapbox', token:string} | {provider:'google', key:string, mapId:string}>}
 */
export async function resolveProvider({ timeoutMs = 3000 } = {}) {
  if (osmForced() || !hasCreds()) return { ...OSM }; // oturumsuz/anonim cihaz sunucuya sorulmaz
  const ctl = new AbortController();
  if (savedProvider() === 'osm') {
    // Harita beklemeden açılır; arka planda yalnızca ad tazelenir (yeni sağlayıcı sonraki açılışta). Dönen anahtar atılır.
    const t = setTimeout(() => ctl.abort(), 15000);
    fetchConfig(ctl.signal).finally(() => clearTimeout(t));
    return { ...OSM };
  }
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
  // Zaman aşımında istek hemen kesilmez: geç gelen yanıt adı yine kaydeder (sonraki açılış için); en çok 15 sn sonra kesilir.
  const abortT = setTimeout(() => ctl.abort(), Math.max(15000, timeoutMs));
  const req = fetchConfig(ctl.signal).finally(() => clearTimeout(abortT));
  const cfg = await Promise.race([req, late]);
  clearTimeout(timer);
  return cfg || { ...OSM };
}
