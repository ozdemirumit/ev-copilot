// Yol hız limiti Valhalla /locate'ten (OpenStreetMap maxspeed etiketi, anahtarsız, ücretsiz).
// Konuma yakın yol parçaları döner (iki yön ayrı); gidiş yönüne en uygun olan seçilir. OSM'de etiketi olmayan yolda (Türkiye'de
// şehir içi/ikincil yollarda sık) limit bilinmez: null döner ve uygulama kullanıcının hız eşiğine düşer, tahmin YAPILMAZ.
import { valhalla } from './valhalla.js';

const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/** Yol hız limiti (km/s) veya OSM'de etiketi yoksa null. heading: derece (bilinmiyorsa en yakın yol parçası). */
export async function fetchSpeedLimit(lat, lon, heading = null) {
  const res = await valhalla('/locate', { locations: [{ lat, lon }], costing: 'auto', verbose: true }, 15000);
  const edges = (res?.[0]?.edges || []).filter((e) => e.edge_info);
  if (!edges.length) return null;
  // 40 m'den uzak parçalar (paralel yol, hizmet yolu) ve gidiş yönüne ters olanlar elenir; kalanlar arasında en yakın
  const near = edges.filter((e) => (e.distance ?? 0) <= 40);
  const fwd = heading == null ? near : near.filter((e) => e.heading == null || angDiff(e.heading, heading) <= 70);
  const best = [...(fwd.length ? fwd : near)].sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0))[0];
  const kph = best?.edge_info?.speed_limit;
  return kph > 0 ? Math.round(kph) : null; // 0: etiket yok
}
