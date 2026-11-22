// OpenStreetMap ek yol olayları — ağ katmanı (v0.99.118): Valhalla /trace_attributes (köprü/tünel/alt geçit) + Overpass (gişe/direk).
// Çevirme/olay mantığı js/nav/roadExtras.js'te (saf). Burada yalnız istekler var; ikisi bağımsız: biri başarısız olursa öteki yine kullanılır.
// Kota/adil kullanım: rota başına bir kez (çağıran önbelleğe alır); Valhalla parçaları (≤ 2500 nokta ≈ 100–180 km) sıralı ve aralıklı gider, Overpass
// rota koridorunda (cameras.js ile aynı yardımcılar) gişe/direk arar. Anahtar yok; her iki sunucu da ücretsiz herkese açık servistir. Hata/ret → olay uydurulmaz.
import { fromTraceAttributes, fromOverpassToll, buildExtras, traceRanges, TOLL_MAX_OFF_KM, TRACE_MAX_POINTS, TRACE_OVERLAP } from '../nav/roadExtras.js';

export const CHUNK_POINTS = TRACE_MAX_POINTS; // parça en çok bu kadar nokta VE en çok 150 km (Valhalla 200 km sınırı; traceRanges)
export const OVERLAP_POINTS = TRACE_OVERLAP; // parçalar arasında köprü/tünel bölünmesin: örtüşen kısım birleştirmede tekilleşir
export const PAUSE_MS = 1100; // ardışık Valhalla istekleri arası (demo sunucu: ≤ 1 istek/sn)
const TRACE_ATTRS = ['edge.bridge', 'edge.tunnel', 'edge.begin_shape_index', 'edge.end_shape_index', 'edge.road_class', 'edge.length', 'node.type']; // node.type: gişe/direk düğümleri (edge.end_node.type)
const TOLL_RADIUS_M = Math.round(TOLL_MAX_OFF_KM * 1000) + 10;
const TOLL_CHUNK = 150; // Overpass sorgusu başına koridor noktası (≈ 60 km; cameras.js ile aynı)

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
const fmt = (p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;

/** Varsayılan Valhalla çağrısı (tembel içe aktarma: testlerde ağ modülü yüklenmez). */
const defaultTrace = async (body) => (await import('./valhalla.js')).valhalla('/trace_attributes', body, 30000);

/** Varsayılan Overpass gişe/direk araması: rota koridorunda barrier=toll_booth ve highway=toll_gantry. Dönüş: ham öğeler. */
async function defaultTolls(coords) {
  const [{ spaced }, { overpass }] = await Promise.all([import('./cameras.js'), import('./chargers.js')]);
  const pts = spaced(coords);
  const out = [];
  for (let i = 0; i < pts.length; i += TOLL_CHUNK) {
    const part = pts.slice(Math.max(0, i - 1), i + TOLL_CHUNK);
    if (part.length < 2) continue;
    const around = `(around:${TOLL_RADIUS_M},${part.map(fmt).join(',')})`;
    out.push(...(await overpass(`[out:json][timeout:60];(nwr["barrier"="toll_booth"]${around};nwr["highway"="toll_gantry"]${around};);out tags center;`)));
  }
  return out;
}

async function traceChunks(coords, trace, pauseMs) {
  const chunks = [];
  const ranges = traceRanges(coords);
  for (const [i, r] of ranges.entries()) {
    const s = r.start;
    const part = coords.slice(r.start, r.end + 1);
    if (part.length < 2) break;
    const body = {
      shape: part.map(([lon, lat]) => ({ lat: +lat.toFixed(5), lon: +lon.toFixed(5) })),
      costing: 'auto',
      shape_match: 'map_snap', // her sağlayıcının rotasına (Mapbox/TomTom dahil) eşler; Valhalla'nın kendi rotasında da aynı sonucu verdi (ölçüldü)
      filters: { attributes: TRACE_ATTRS, action: 'include' },
    };
    try { chunks.push({ json: await trace(body), offset: s }); } catch (err) { console.warn('Köprü/alt geçit verisi (Valhalla) alınamadı:', err?.message || err); }
    if (i < ranges.length - 1) await sleep(pauseMs);
  }
  return chunks;
}

/**
 * Rota çizgisi için OSM ek yol olayları. Dönüş: osm olay modeli (köprü/tünel/alt geçit/gişe) ya da null (rota bozuk, iki kaynak da başarısız
 * ya da hiç olay yok). Test için trace(body)/tolls(coords)/pauseMs enjekte edilebilir.
 */
export async function fetchRoadExtras(coords, { trace = defaultTrace, tolls = defaultTolls, pauseMs = PAUSE_MS } = {}) {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const [tr, tl] = await Promise.allSettled([traceChunks(coords, trace, pauseMs), tolls(coords)]);
  const chunks = tr.status === 'fulfilled' ? tr.value : [];
  if (tl.status === 'rejected') console.warn('Gişe verisi (Overpass) alınamadı:', tl.reason?.message || tl.reason);
  return buildExtras({
    trace: chunks.length ? fromTraceAttributes(chunks, coords) : null,
    tolls: tl.status === 'fulfilled' ? fromOverpassToll(tl.value, coords) : [],
  });
}

/** Önbellekli sürüm (bellek; aynı rota yeniden planlanınca istek tekrarlanmaz). Sonuç yoksa reddeder (boş sonuç önbelleğe girmez). */
export async function roadExtrasFor(coords) {
  const { cached, TTL } = await import('../utils/cache.js');
  const f = coords[0], m = coords[coords.length >> 1], l = coords.at(-1);
  const key = `rex:${coords.length}:${[f, m, l].map((c) => `${c[1].toFixed(3)},${c[0].toFixed(3)}`).join('>')}`;
  return cached(key, TTL.long, async () => {
    const r = await fetchRoadExtras(coords);
    if (!r) throw new Error('Köprü/alt geçit/gişe verisi yok');
    return r;
  }, { persist: false });
}
