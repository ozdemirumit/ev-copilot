// Tesla Supercharger istasyonları: ara sunucu supercharge.info topluluk verisinden yalnızca Togg'un kullanabildiklerini (açık, diğer markalara açık, CCS2)
// süzüp verir (/v1/tesla, günlük). Burada rota/çevre kutusuna göre seçilip aday istasyona çevrilir. Sunucu yoksa ya da hesapla giriş yapılmadıysa liste boştur.
// Fiyat: Tesla'nın "diğer markalar" tarifesi operatör tablosundadır (Tesla uygulaması gerekir); gerçek tarife istasyona göre değişebilir.
import { proxyFetch, proxyReady } from '../net/proxy.js';
import { cached } from '../utils/cache.js';
import { candidate } from './chargerSource.js';

const DAY = 24 * 3600e3;
const MARGIN_DEG = 0.1; // ≈ 11 km: koridor süzmesi finalize()'da yapılır, burada yalnızca kaba kutu

/** Sunucudaki Tesla listesi: [[id, ad, lat, lon, kW, soket], …]; alınamazsa []. */
export async function teslaSites() {
  if (!proxyReady()) return [];
  try {
    const sites = await cached('tesla:list', DAY, async () => {
      const r = await proxyFetch('/v1/tesla', { signal: AbortSignal.timeout(20000) });
      if (!r.ok) return null; // saklanmaz, sonra yeniden denenir
      const j = await r.json();
      return Array.isArray(j.sites) ? j.sites : null;
    });
    return sites || [];
  } catch { return []; }
}

export function fromTesla([id, name, lat, lon, kw]) {
  return candidate({ id: 'tsl' + id, name: /tesla/i.test(name) ? name : 'Tesla · ' + name, lat, lon, opId: 'tesla', src: 'Tesla', hasDc: true, dcKw: kw || 250, anyInfo: true });
}

const inBox = (b) => (s) => s[2] >= b.minLat && s[2] <= b.maxLat && s[3] >= b.minLon && s[3] <= b.maxLon;

/** Rota noktalarının (kaba) kutusu içindeki Tesla istasyonları. */
export async function teslaAlong(pts) {
  const sites = await teslaSites();
  if (!sites.length || !pts.length) return [];
  const lats = pts.map((p) => p.lat);
  const lons = pts.map((p) => p.lon);
  const box = { minLat: Math.min(...lats) - MARGIN_DEG, maxLat: Math.max(...lats) + MARGIN_DEG, minLon: Math.min(...lons) - MARGIN_DEG * 1.4, maxLon: Math.max(...lons) + MARGIN_DEG * 1.4 };
  return sites.filter(inBox(box)).map(fromTesla);
}

/** Bir noktanın etrafında (yarıçap km) Tesla istasyonları (kutu; kesin uzaklık çağıranda). */
export async function teslaAround(lat, lon, km) {
  const sites = await teslaSites();
  const d = km / 111 + 0.02;
  const box = { minLat: lat - d, maxLat: lat + d, minLon: lon - d * 1.5, maxLon: lon + d * 1.5 };
  return sites.filter(inBox(box)).map(fromTesla);
}
