// Sağlayıcıdan bağımsız yol olayları modeli (BL-P2-03 F1; SAF, çevrimdışı). Modül hiçbir şey içe aktarmaz ve henüz
// hiçbir çalışma zamanı dosyası bu modülü içe aktarmaz: kullanıcıya yol uyarısı (tünel/köprü/gişe/çıkış/tabela) GÖSTERİLMEZ.
// Amaç: rotayı veren sağlayıcının bildirdiği yol olaylarını tek biçimde, kaynağıyla birlikte tutmak.
//
// Kurallar (rota üst verisi modeliyle — js/nav/routeMeta — aynı ilke):
// - Kaynak yalnızca modelin sağlayıcısı olabilir; başka/bilinmeyen sağlayıcıdan gelen olay reddedilir (denied listesine yazılır).
// - Olaylar ASLA GPS kaybından, hız düşüşünden, kameradan ya da OCR'dan çıkarılmaz; çıkarım kaynakları her zaman reddedilir.
// - Varsayılan yetenek tablosu: hiçbir sağlayıcı için hiçbir olay türü (bugün ayrıştırıcı yok). Yetenek yalnızca açık supports ile.
// - Aralık türleri (tunnel/bridge/underpass/overpass) fromM < toM (fromM ≥ 0); nokta türleri (toll/exit/sign) atM ≥ 0.
//   Gişe (toll) NOKTA olayıdır, ek alanı yoktur. exit.ref boş olmayan metin; sign.text boş olmayan metin dizisi.
// - Ağ, anahtar, ortam değişkeni, DOM, depolama, zaman kullanılmaz. Dönen tüm nesneler dondurulmuştur; girdiler değiştirilmez.
// PROVIDERS ve INFERRED_SOURCES rota üst verisi modelindekilerle aynıdır (bilerek içe aktarılmaz; eşleşme test-road-events.mjs'te denetlenir).

export const ROAD_EVENTS_VERSION = 1;
export const PROVIDERS = Object.freeze(['osm', 'mapbox', 'tomtom', 'here', 'google']);
export const INFERRED_SOURCES = Object.freeze(['gps', 'gps-loss', 'speed', 'camera', 'ocr', 'heuristic', 'inferred', 'guess']);
export const KINDS = Object.freeze(['tunnel', 'bridge', 'underpass', 'overpass', 'toll', 'exit', 'sign']);
export const SPAN_KINDS = Object.freeze(['tunnel', 'bridge', 'underpass', 'overpass']); // yol boyunca aralık (fromM–toM)
export const POINT_KINDS = Object.freeze(['toll', 'exit', 'sign']); // tek nokta (atM); gişe noktadır

const f = (o) => Object.freeze(o);
const isProvider = (p) => typeof p === 'string' && PROVIDERS.includes(p);
const isM = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const has = (o, k) => o[k] !== undefined;
const nonEmpty = (s) => typeof s === 'string' && s.trim() !== '';

function build(provider, supports, events, denied) {
  return f({ v: ROAD_EVENTS_VERSION, provider, supports, events: f(events), denied: f(denied) });
}

/**
 * Boş olay modeli. Bilinmeyen sağlayıcı → provider null, yetenek yok.
 * supports: isteğe bağlı açık yetenek listesi (ileride ayrıştırıcı eklenince); yalnızca bilinen KINDS, tekrarsız.
 */
export function emptyEvents(provider, { supports } = {}) {
  const p = isProvider(provider) ? provider : null;
  const caps = p && Array.isArray(supports) ? KINDS.filter((k) => supports.includes(k)) : [];
  return build(p, f(caps), [], []);
}

function checkModel(model) {
  if (!model || typeof model !== 'object' || !Array.isArray(model.events) || !Array.isArray(model.denied) || !Array.isArray(model.supports)) {
    throw new TypeError('roadEvents: geçersiz model (emptyEvents ile oluşturun)');
  }
}

/**
 * Bir olay ekler; yeni (dondurulmuş) model döner. Reddedilen olay events'i değiştirmez, yalnızca denied listesine eklenir.
 * Ret nedenleri (sırayla): unknown-kind, inferred-source, unknown-source, cross-provider, unsupported, bad-geometry, bad-props.
 */
export function addEvent(model, ev) {
  checkModel(model);
  const e = ev && typeof ev === 'object' ? ev : {};
  const kind = typeof e.kind === 'string' ? e.kind : null;
  const source = typeof e.source === 'string' ? e.source : null;
  const deny = (reason) => build(model.provider, model.supports, [...model.events], [...model.denied, f({ kind, source, reason })]);

  if (!KINDS.includes(kind)) return deny('unknown-kind');
  if (INFERRED_SOURCES.includes(source)) return deny('inferred-source');
  if (!isProvider(source)) return deny('unknown-source');
  if (source !== model.provider) return deny('cross-provider');
  if (!model.supports.includes(kind)) return deny('unsupported');

  let out;
  if (SPAN_KINDS.includes(kind)) {
    if (has(e, 'atM') || !isM(e.fromM) || !isM(e.toM) || !(e.fromM < e.toM)) return deny('bad-geometry');
    if (has(e, 'ref') || has(e, 'text')) return deny('bad-props');
    out = { kind, source, fromM: e.fromM, toM: e.toM };
  } else {
    if (has(e, 'fromM') || has(e, 'toM') || !isM(e.atM)) return deny('bad-geometry');
    if (kind === 'toll') {
      if (has(e, 'ref') || has(e, 'text')) return deny('bad-props');
      out = { kind, source, atM: e.atM };
    } else if (kind === 'exit') {
      if (!nonEmpty(e.ref) || has(e, 'text')) return deny('bad-props');
      out = { kind, source, atM: e.atM, ref: e.ref };
    } else {
      if (has(e, 'ref') || !Array.isArray(e.text) || !e.text.length || !e.text.every(nonEmpty)) return deny('bad-props');
      out = { kind, source, atM: e.atM, text: f([...e.text]) };
    }
  }
  return build(model.provider, model.supports, [...model.events, f(out)], [...model.denied]);
}

const startOf = (e) => (e.fromM !== undefined ? e.fromM : e.atM);
const endOf = (e) => (e.toM !== undefined ? e.toM : e.atM);

/**
 * routeM konumundan itibaren horizonM içinde başlayan olaylar (dondurulmuş dizi), başlangıca (eşitse bitişe) göre sıralı.
 * Geçmiş olaylar dışarıda: nokta atM < routeM, aralık toM ≤ routeM. İçinde bulunulan aralık dahildir.
 * horizonM verilmezse sınırsız. Geçersiz model/konum/ufuk → boş dizi.
 */
export function eventsAhead(model, routeM, horizonM = Infinity) {
  if (!model || !Array.isArray(model.events) || !isM(routeM)) return f([]);
  if (typeof horizonM !== 'number' || Number.isNaN(horizonM) || horizonM < 0) return f([]);
  const limit = routeM + horizonM;
  const list = model.events.filter((e) => {
    const isSpan = e.toM !== undefined;
    const past = isSpan ? endOf(e) <= routeM : endOf(e) < routeM;
    return !past && startOf(e) <= limit;
  });
  return f(list.sort((a, b) => startOf(a) - startOf(b) || endOf(a) - endOf(b)));
}
