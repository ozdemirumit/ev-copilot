// OpenStreetMap kaynaklı EK yol olayları: köprü, alt geçit (kısa tünel), tünel ve gişe (v0.99.118; SAF, çevrimdışı, ağ/DOM/depolama yok).
// Neden ek: Valhalla'nın OSRM rota yanıtı yalnız tünel + ücret verir (js/nav/valhallaRoadEvents.js), köprü alanı YOKTUR; Mapbox/TomTom rotalarında hiç model yoktur.
// Kaynak 1 — Valhalla /trace_attributes (aynı OSM yol grafı; rota şekline eşlenir, her sağlayıcının rotasında çalışır): kenar bayrakları
//   edge.bridge / edge.tunnel (gerçek kayıtla doğrulandı, 2026-11-21, Bolu rotası: 167 kenar, 14 köprü, 8 tünel) + edge.road_class; begin/end_shape_index rota şekline indeks.
// Kaynak 2 — Overpass: barrier=toll_booth / highway=toll_gantry (gişe, OGS/HGS direkleri) noktaları; rotaya ≤ 30 m uzaktakiler.
// Olaylar kaynağıyla (source 'osm') js/nav/roadEvents.js modeline girer; ASLA GPS/hız/kamera çıkarımı değildir. Mesafe ekseni navigasyonla aynıdır (track.js, metre).
// Sağlayıcı kuralı: rotayı veren sağlayıcının KENDİ modeli (varsa) kazanır; OSM ekstraları yalnızca onun desteklemediği türleri ekler (mergeRoadModels).
// Üst geçit (yayalar için üstten geçen yapı) sürücüyü ilgilendirmediğinden uyarısı YOKTUR.
import { emptyEvents, addEvent } from './roadEvents.js';
import { buildTrack, locate } from './track.js';

export const EXTRA_SUPPORTS = Object.freeze(['bridge', 'tunnel', 'underpass', 'toll']);
export const MIN_BRIDGE_M = 250; // daha kısa köprü (dere/menfez üstü) uyarı üretmez
export const TUNNEL_MIN_M = 100; // ≥ bu uzunluk "tünel"; daha kısası alt geçit adayı
export const UNDERPASS_MIN_M = 25; // daha kısası uyarı üretmez
export const UNDERPASS_CLASSES = Object.freeze(['motorway', 'trunk', 'primary', 'secondary']); // konut/servis yollarındaki menfez ve geçitler elenir
export const MERGE_GAP_M = 60; // aynı türde bu kadar yakın parçalar tek olay (OSM'de köprü kenarlara bölünür)
export const TOLL_MAX_OFF_KM = 0.03;
export const TOLL_MERGE_M = 500; // bu kadar yakın gişe/direkler tek uyarı

const isModel = (m) => !!m && typeof m === 'object' && Array.isArray(m.events) && Array.isArray(m.supports);

function mergeSpans(list) {
  const out = [];
  for (const s of list.sort((a, b) => a.from - b.from)) {
    const last = out.at(-1);
    if (last && s.from - last.to <= MERGE_GAP_M) { last.to = Math.max(last.to, s.to); last.major = last.major || s.major; } else out.push({ ...s });
  }
  return out;
}

/**
 * chunks: [{ json, offset }] — Valhalla /trace_attributes yanıtları; offset = o parçanın ilk noktasının coords içindeki indeksi.
 * coords: rota çizgisi [[lon,lat]]. Dönüş: osm olay modeli (bridge/tunnel/underpass). Bozuk girdi atmaz, bozuk kenar atlanır.
 */
export function fromTraceAttributes(chunks, coords) {
  const empty = emptyEvents('osm', { supports: EXTRA_SUPPORTS });
  if (!Array.isArray(chunks) || !Array.isArray(coords) || coords.length < 2) return empty;
  const track = buildTrack(coords);
  const n = coords.length;
  const bridge = [];
  const tunnel = [];
  for (const c of chunks) {
    const edges = c?.json?.edges;
    if (!Array.isArray(edges) || !Number.isInteger(c?.offset)) continue;
    for (const e of edges) {
      if (!e || typeof e !== 'object' || !Number.isInteger(e.begin_shape_index) || !Number.isInteger(e.end_shape_index)) continue;
      const b = c.offset + e.begin_shape_index;
      const en = c.offset + e.end_shape_index;
      if (b < 0 || b >= en || en > n - 1) continue;
      const span = { from: Math.round(track.cum[b] * 1000), to: Math.round(track.cum[en] * 1000), major: UNDERPASS_CLASSES.includes(e.road_class) };
      if (e.bridge === true) bridge.push(span);
      if (e.tunnel === true) tunnel.push(span);
    }
  }
  const events = [];
  for (const s of mergeSpans(bridge)) if (s.to - s.from >= MIN_BRIDGE_M) events.push({ kind: 'bridge', fromM: s.from, toM: s.to });
  for (const s of mergeSpans(tunnel)) {
    const len = s.to - s.from;
    if (len >= TUNNEL_MIN_M) events.push({ kind: 'tunnel', fromM: s.from, toM: s.to });
    else if (len >= UNDERPASS_MIN_M && s.major) events.push({ kind: 'underpass', fromM: s.from, toM: s.to });
  }
  let model = empty;
  for (const e of events.sort((a, b) => a.fromM - b.fromM)) model = addEvent(model, { ...e, source: 'osm' });
  return model;
}

/** Overpass öğeleri (node/way, lat+lon ya da center) → rotaya ≤ 30 m uzak gişe/direk konumları (metre, artan, 500 m içinde tekil). */
export function fromOverpassToll(elements, coords) {
  if (!Array.isArray(elements) || !Array.isArray(coords) || coords.length < 2) return [];
  const track = buildTrack(coords);
  const at = [];
  for (const el of elements) {
    const lat = el?.lat ?? el?.center?.lat;
    const lon = el?.lon ?? el?.center?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const r = locate(track, lat, lon, null);
    if (r.offKm <= TOLL_MAX_OFF_KM) at.push(Math.round(r.km * 1000));
  }
  const out = [];
  for (const m of at.sort((a, b) => a - b)) if (!out.length || m - out.at(-1) >= TOLL_MERGE_M) out.push(m);
  return out;
}

const startOf = (e) => (e.fromM !== undefined ? e.fromM : e.atM);

/** İki kaynağı tek osm modelinde toplar (başlangıca göre sıralı). Hiç olay yoksa null (başarısızlık ile "yok" ayırt edilmez; çağıran yeniden denemez). */
export function buildExtras({ trace = null, tolls = [] } = {}) {
  const evs = [...(isModel(trace) ? trace.events : [])];
  for (const m of Array.isArray(tolls) ? tolls : []) if (typeof m === 'number' && Number.isFinite(m) && m >= 0) evs.push({ kind: 'toll', atM: m });
  if (!evs.length) return null;
  let model = emptyEvents('osm', { supports: EXTRA_SUPPORTS });
  for (const e of evs.sort((a, b) => startOf(a) - startOf(b))) {
    model = addEvent(model, e.atM !== undefined ? { kind: e.kind, source: 'osm', atM: e.atM } : { kind: e.kind, source: 'osm', fromM: e.fromM, toM: e.toM });
  }
  return model;
}

/**
 * Rotayı veren sağlayıcının kendi modeli (own; yoksa null) ile OSM ekstralarını birleştirir. Kendi model desteklediği türlerde kazanır
 * (aynı tünel/gişe iki kez söylenmez); ekstralar yalnız onun desteklemediği türleri (ör. köprü, alt geçit) ekler. İkisi de yoksa null.
 */
export function mergeRoadModels(own, extras) {
  const o = isModel(own) ? own : null;
  const x = isModel(extras) ? extras : null;
  if (!o && !x) return null;
  if (!x) return o;
  if (!o) return x;
  const have = new Set(o.supports);
  const events = [...o.events, ...x.events.filter((e) => !have.has(e.kind))].sort((a, b) => startOf(a) - startOf(b));
  const supports = [...new Set([...o.supports, ...x.supports.filter((k) => !have.has(k))])];
  return Object.freeze({ v: o.v ?? 1, provider: o.provider, supports: Object.freeze(supports), events: Object.freeze(events), denied: Object.freeze([]) });
}
