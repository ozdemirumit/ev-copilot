// Valhalla (OSM, ücretsiz rota) OSRM biçimli yanıttan yol olayları (v0.99.102; SAF, çevrimdışı). Yalnızca gerçek kayıtla
// doğrulanan iki alan okunur (scripts/fixtures/road-events/osm-valhalla-bolu-recorded.json, 2026-11-17, Bolu Dağı Tüneli):
//   routes[0].legs[].steps[].intersections[].classes  → 'tunnel' (tünel aralığı), 'toll' (ücretli yola giriş noktası)
//   routes[0].legs[].steps[].intersections[].toll_collection → gişe noktası (type 'toll_booth' | 'toll_gantry')
// Sınıf, kavşaktan ÇIKAN yol parçasına aittir; Valhalla sınıf değişen her parça sınırında kavşak yazar (kayıtta tünel içinde
// 7 kavşak, tünel sonu sınıfsız kavşakla kapanır). Köprü / alt geçit / üst geçit için yanıtta alan YOKTUR: bu türler üretilmez.
// Çıkış / tabela alanları bu sürümde okunmaz.
//
// Rotaya bağlama: her kavşağın location'ı rota çizgisinin bir köşesiyle birebir aynıdır (kayıtta 168/168). Köşe yalnızca İLERİ
// yönde (bir önceki eşleşmeden sonra) ve ≤ MATCH_M uzaklıkta aranır: aynı yolun karşı şeridinden (gidiş-dönüş rotası) ya da
// rotanın daha önceki bir kısmından eşleşme olmaz. Eşleşmeyen kavşak atlanır; açık kalan tünel (sonu bulunamadı) üretilmez.
// Mesafe ekseni navigasyonla aynıdır (track.js buildTrack: aynı koordinatların yay uzunluğu, metre).
import { emptyEvents, addEvent } from './roadEvents.js';
import { buildTrack } from './track.js';

export const VALHALLA_SUPPORTS = Object.freeze(['tunnel', 'toll']);
export const MATCH_M = 3; // kavşak konumu ↔ rota köşesi en çok bu kadar uzak olabilir
const TOLL_MERGE_M = 500; // ücretli yola giriş ve hemen ardındaki gişe tek uyarı sayılır

const near = (coords, i, loc) => {
  const [lon, lat] = coords[i];
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  return Math.hypot((loc[0] - lon) * kx, (loc[1] - lat) * 110570) <= MATCH_M;
};

/**
 * json: Valhalla /route (format osrm) yanıtı; coords: aynı yanıttan çözülen rota çizgisi [[lon,lat]] (osm/route.js).
 * Dönüş: yol olayları modeli (provider 'osm', supports tunnel+toll). Geçersiz girdi → boş osm modeli (yetenek yok).
 */
export function fromValhallaOsrm(json, coords) {
  const legs = json?.routes?.[0]?.legs;
  if (!Array.isArray(legs) || !Array.isArray(coords) || coords.length < 2) return emptyEvents('osm');
  const track = buildTrack(coords);
  const atM = (i) => Math.round(track.cum[i] * 1000);
  let model = emptyEvents('osm', { supports: VALHALLA_SUPPORTS });
  let idx = 0; // ileri arama başlangıcı
  let tunnelFrom = null;
  let prevToll = null; // ilk kavşakta zaten ücretli yoldaysak giriş uyarısı yok
  const tolls = [];
  for (const leg of legs) {
    for (const st of (Array.isArray(leg?.steps) ? leg.steps : [])) {
      for (const it of (Array.isArray(st?.intersections) ? st.intersections : [])) {
        const loc = it?.location;
        if (!Array.isArray(loc) || !Number.isFinite(loc[0]) || !Number.isFinite(loc[1])) continue;
        let j = idx;
        while (j < coords.length && !near(coords, j, loc)) j++;
        if (j >= coords.length) continue; // rotada değil: atla (konum uydurulmaz)
        idx = j;
        const cls = Array.isArray(it.classes) ? it.classes : [];
        const tunnel = cls.includes('tunnel');
        const toll = cls.includes('toll');
        if (tunnel && tunnelFrom == null) tunnelFrom = j;
        else if (!tunnel && tunnelFrom != null) {
          if (j > tunnelFrom) model = addEvent(model, { kind: 'tunnel', source: 'osm', fromM: atM(tunnelFrom), toM: atM(j) });
          tunnelFrom = null;
        }
        if (toll && prevToll === false) tolls.push(atM(j));
        if (it.toll_collection && typeof it.toll_collection === 'object') tolls.push(atM(j));
        prevToll = toll;
      }
    }
  }
  let last = -Infinity;
  for (const m of tolls.sort((a, b) => a - b)) {
    if (m - last < TOLL_MERGE_M) continue;
    model = addEvent(model, { kind: 'toll', source: 'osm', atM: m });
    last = m;
  }
  return model;
}
