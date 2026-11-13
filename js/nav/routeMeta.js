// Sağlayıcıdan bağımsız rota üst verisi modeli (SAF, çevrimdışı). Modülün kendisi hiçbir şey içe aktarmaz. v0.99.47'den beri yalnızca
// js/providers/index.js (rota sağlayıcı seçimi) seçilen rotaya routeMeta ekler; arayüz/ses/uyarılar bu alanı henüz okumaz.
// Amaç: rota özniteliklerinin (şerit, tünel, köprü) hangi sağlayıcıdan geldiğini (kaynak/provenance) kayıt altına almak ve
// "veri var / yok / istenmedi / sağlayıcı desteklemiyor" durumlarını birbirinden ayırmak.
//
// Kurallar:
// - Kaynak yalnızca rotayı veren sağlayıcının kendisi olabilir; bilinmeyen ya da başka sağlayıcıdan gelen veri reddedilir (denied listesine yazılır).
// - Köprü/tünel/alt geçit/üst geçit ASLA GPS kaybından, hız düşüşünden ya da kameradan çıkarılmaz; çıkarım kaynakları her zaman reddedilir.
// - Mevcut adım şerit verisine (step.lanes) dokunulmaz; yalnızca okunur.
// - Varsayılan yetenek tablosu uygulamanın BUGÜN ayrıştırdığı veriyi yansıtır: yalnızca Mapbox şerit verisi. Tünel/köprü kaynağı yok.
// - Ağ, anahtar, ortam değişkeni, DOM, depolama kullanılmaz. Dönen tüm nesneler dondurulmuştur; girdiler değiştirilmez.

export const ROUTE_META_VERSION = 1;
export const PROVIDERS = Object.freeze(['osm', 'mapbox', 'tomtom', 'here', 'google']);
export const ATTRS = Object.freeze(['lanes', 'tunnel', 'bridge']);
export const SPAN_ATTRS = Object.freeze(['tunnel', 'bridge']); // yol boyunca aralık (fromM–toM) olarak tutulanlar
export const STATUSES = Object.freeze(['present', 'absent', 'unrequested', 'unsupported']);
// Çıkarım tabanlı kaynaklar: bunlar sağlayıcı verisi değildir, her zaman reddedilir.
export const INFERRED_SOURCES = Object.freeze(['gps', 'gps-loss', 'speed', 'camera', 'ocr', 'heuristic', 'inferred', 'guess']);

const f = (o) => Object.freeze(o);
const NONE = f({});
// Uygulamanın bugün gerçekten ayrıştırdığı veriler (js/mapbox/route.js → parseLanes). Diğer her şey 'unsupported'.
export const DEFAULT_CAPS = f({
  osm: f([]), mapbox: f(['lanes']), tomtom: f([]), here: f([]), google: f([]),
});

const isProvider = (p) => typeof p === 'string' && PROVIDERS.includes(p);

function build(provider, attrs, roadSpans, denied) {
  return f({ v: ROUTE_META_VERSION, provider, attrs: f(attrs), roadSpans: f(roadSpans), denied: f(denied) });
}

/**
 * Boş üst veri. Bilinmeyen sağlayıcı → provider null, tüm öznitelikler 'unsupported'.
 * supports: isteğe bağlı açık yetenek listesi (ileride yeni ayrıştırıcı eklenince); yalnızca bilinen ATTRS kabul edilir.
 */
export function emptyMeta(provider, { supports } = {}) {
  const p = isProvider(provider) ? provider : null;
  const caps = p ? (Array.isArray(supports) ? supports.filter((a) => ATTRS.includes(a)) : DEFAULT_CAPS[p]) : [];
  const attrs = {};
  for (const a of ATTRS) attrs[a] = f({ status: caps.includes(a) ? 'unrequested' : 'unsupported', source: null });
  return build(p, attrs, [], []);
}

function validSpans(attr, spans) {
  if (!Array.isArray(spans)) return null;
  const out = [];
  for (const s of spans) {
    const from = s?.fromM, to = s?.toM;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from) return null;
    out.push({ attr, fromM: from, toM: to });
  }
  return out;
}

/**
 * Bir özniteliği kaynağıyla birlikte kaydeder. status: 'present' | 'absent'.
 * Tünel/köprü için 'present' en az bir aralık (spans: [{fromM,toM}]) ister; 'absent' aralık kabul etmez; lanes aralık almaz
 * (şerit verisi adımlarda kalır). Reddedilen kayıt veriyi değiştirmez, yalnızca denied listesine eklenir.
 */
export function withProvenance(meta, attr, { source, status, spans } = {}) {
  const deny = (reason) => build(meta.provider, { ...meta.attrs }, [...meta.roadSpans],
    [...meta.denied, f({ attr: String(attr), source: typeof source === 'string' ? source : null, reason })]);
  if (!ATTRS.includes(attr)) return deny('unknown-attr');
  if (typeof source === 'string' && INFERRED_SOURCES.includes(source)) return deny('inferred-source');
  if (!isProvider(source)) return deny('unknown-source');
  if (source !== meta.provider) return deny('cross-provider');
  if (meta.attrs[attr]?.status === 'unsupported') return deny('unsupported');
  if (status !== 'present' && status !== 'absent') return deny('bad-status');
  let add = [];
  if (SPAN_ATTRS.includes(attr)) {
    const list = spans === undefined ? [] : validSpans(attr, spans);
    if (!list) return deny('bad-spans');
    if (status === 'present' && !list.length) return deny('bad-spans');
    if (status === 'absent' && list.length) return deny('bad-spans');
    add = list.map((s) => f({ ...s, source }));
  } else if (spans !== undefined) return deny('bad-spans');
  const roadSpans = [...meta.roadSpans.filter((s) => s.attr !== attr), ...add].sort((a, b) => a.fromM - b.fromM || a.toM - b.toM);
  return build(meta.provider, { ...meta.attrs, [attr]: f({ status, source }) }, roadSpans, [...meta.denied]);
}

/** Yalnızca verilen kaynaktan gelen öznitelik ve aralıklar; diğerleri ATLANIR (anahtar olarak bile yer almaz). Bilinmeyen kaynak → boş. */
export function filterBySource(meta, source) {
  if (!isProvider(source)) return f({ source: null, attrs: NONE, roadSpans: f([]) });
  const attrs = {};
  for (const a of ATTRS) if (meta.attrs[a]?.source === source) attrs[a] = meta.attrs[a];
  return f({ source, attrs: f(attrs), roadSpans: f(meta.roadSpans.filter((s) => s.source === source)) });
}

/** Öznitelik durumu; bilinmeyen öznitelik (ör. 'underpass', 'overpass') → 'unsupported'. */
export function attrStatus(meta, attr) {
  return ATTRS.includes(attr) ? (meta?.attrs?.[attr]?.status || 'unsupported') : 'unsupported';
}

/** Adımlardaki mevcut şerit verisinden durum (yalnızca okur): en az bir adımda dolu step.lanes → 'present', yoksa 'absent'. */
export function lanesStatusFromSteps(steps) {
  if (!Array.isArray(steps)) return 'absent';
  return steps.some((s) => Array.isArray(s?.lanes) && s.lanes.length > 0) ? 'present' : 'absent';
}
