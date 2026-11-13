// Şarj durağı erişim sorgusu (Valhalla, OpenStreetMap yol ağı; anahtarsız). Harita/rota sağlayıcısından bağımsız olarak hep Valhalla kullanılır:
// gidiş yönü (heading) ve "aynı taraf" (preferred_side) kısıtını destekler ve sonuç yalnızca sapma uzunluğudur (çizim için kullanılmaz).
// a ve b rota çizgisinin üzerindeki noktalardır; heading ile rotanın kendi şeridine bağlanırlar (bölünmüş yolda karşı şeride oturmaz).
// Dönüş: A → istasyon → B yol ağı uzunluğu (km). Hata fırlatabilir (ağ yok, sunucu sınırı).
import { valhalla } from './valhalla.js';

const TIMEOUT_MS = 15000;
const HEADING_TOL = 45;

export async function probeStopAccess({ a, station, b }) {
  const end = (p) => ({ lat: p.lat, lon: p.lon, type: 'break', ...(Number.isFinite(p.heading) ? { heading: p.heading, heading_tolerance: HEADING_TOL } : {}) });
  const json = await valhalla('/route', {
    locations: [end(a), { lat: station.lat, lon: station.lon, type: 'break', preferred_side: 'same' }, end(b)],
    costing: 'auto',
    directions_type: 'none',
  }, TIMEOUT_MS);
  const km = json?.trip?.summary?.length;
  if (!Number.isFinite(km)) throw new Error('Yol ağı yanıtı boş');
  return km;
}
