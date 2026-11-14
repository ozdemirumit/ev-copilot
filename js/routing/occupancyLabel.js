// BL-P2-09 aşama 1: istasyon doluluğu için SAF görüntü biçimlendirici (yan etkisiz; DOM, ağ, depolama, saat okuması yok).
// Girdi: server/availability.mjs ortak biçimi (StationAvailability) ya da onu `availability` alanında taşıyan slots nesnesi
// (js/routing/occupancyClient.js). Çıktı: durum + kaynak + tazelik ve Türkçe kaynak şablonları ({ template, params }).
// Çeviri çağıran tarafta mevcut t() ile yapılır; kullanılan şablonların hepsi i18n/keys.json'da zaten var (11 dil).
//
// Güvenlik kuralları (kabul ölçütü: "Tazelik + kaynak etiketi; UNKNOWN 'dolu' gösterilmez"):
//  - UNKNOWN, eski (stale), tazeliği doğrulanmamış (timestampKind 'fetched', zaman yok/gelecekte), simüle (mock),
//    tanınmayan kaynak ya da tutarsız sayılar → state 'unknown'. Asla 'free'/'busy'/'out' ve asla confirmed:true değildir.
//  - 'busy' yalnızca hiç UNKNOWN EVSE yokken ve hiç boş EVSE yokken verilir (bilinmeyen EVSE boş olabilir).
//  - confirmed (canlı teyit) yalnızca tazelik 'fresh' ve zaman sağlayıcıdan geldiğinde true olur.
//  - Ham sağlayıcı metni/sayısı dışarı aynen taşınmaz; kaynak etiketi yalnızca bilinen listeden gelir.
// Uygulamaya bağlı DEĞİLDİR (aşama 1): sw.js SHELL listesinde yok, hiçbir modül içe aktarmaz.

/** Tazelik eşikleri: server/availability.mjs STALENESS ile aynı (15 dk / 2 sa). Saat kayması toleransı 2 dk. */
export const OCC_THRESHOLDS = Object.freeze({ freshMs: 15 * 60e3, staleMs: 2 * 3600e3, futureSkewMs: 2 * 60e3 });

/** Bilinen kaynak kimliği → görünen ad (marka adları çevrilmez). mock/simüle burada YOKTUR. */
export const OCC_SOURCES = Object.freeze({ ndw: 'NDW', ocpi: 'OCPI', here: 'HERE', tomtom: 'TomTom', google: 'Google' });

/** Kullanılan Türkçe kaynak şablonları (hepsi i18n/keys.json'da mevcut). */
export const OCC_TEMPLATES = Object.freeze({
  free: '🟢 {0}/{1} boş',
  busy: '🔴 dolu (0/{0})',
  out: '⚫ arızalı',
  unknown: '· doluluk bilgisi yok',
  stale: '· eski bilgi',
  age: '· {0} dk önce',
  source: '· kaynak: {0}{1}',
  live: 'canlı',
});

const STATUSES = ['AVAILABLE', 'CHARGING', 'RESERVED', 'BLOCKED', 'OUTOFORDER', 'INOPERATIVE', 'UNKNOWN'];
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const isCount = (v) => Number.isInteger(v) && v >= 0 && v <= 10000;

/** Sayıları doğrular; tutarsızsa null. total verilmişse sayı toplamına eşit olmalı; available verilmişse AVAILABLE'a eşit olmalı. */
function readCounts(a) {
  if (!isObj(a.counts)) return null;
  const c = {};
  for (const s of STATUSES) {
    const v = a.counts[s] ?? 0;
    if (!isCount(v)) return null;
    c[s] = v;
  }
  const sum = STATUSES.reduce((n, s) => n + c[s], 0);
  if (sum <= 0) return null;
  if (a.total != null && a.total !== sum) return null;
  if (a.available != null && a.available !== c.AVAILABLE) return null;
  return { ...c, total: sum };
}

/** Tazelik: 'fresh' | 'aging' | 'stale' | 'unverified'. Zamanı sağlayıcı vermediyse ('fetched') ya da zaman geçersiz/gelecekteyse 'unverified'. */
function readFreshness(a, now, th) {
  if (a.timestampKind !== 'provider') return { freshness: 'unverified', ageMin: null };
  if (typeof a.at !== 'number' || !Number.isFinite(a.at) || !Number.isFinite(now)) return { freshness: 'unverified', ageMin: null };
  const age = now - a.at;
  if (age < -th.futureSkewMs) return { freshness: 'unverified', ageMin: null };
  const ageMs = Math.max(0, age);
  const freshness = ageMs <= th.freshMs ? 'fresh' : ageMs <= th.staleMs ? 'aging' : 'stale';
  return { freshness, ageMin: Math.floor(ageMs / 60e3) };
}

const tpl = (template, ...params) => ({ template, params });

function unknown(reason, source, freshness, ageMin) {
  const parts = [tpl(OCC_TEMPLATES.unknown)];
  if (freshness === 'stale') parts.push(tpl(OCC_TEMPLATES.stale));
  if (source) parts.push(tpl(OCC_TEMPLATES.source, source, ''));
  return Object.freeze({ state: 'unknown', confirmed: false, reason, source: source || null, freshness, ageMin: freshness === 'stale' ? ageMin : null, available: null, total: null, tone: 'muted', parts: Object.freeze(parts) });
}

/**
 * Doluluk görüntü tanımı üretir. Saf: aynı girdi + now → aynı çıktı; girdiyi değiştirmez.
 * @param {object|null} input StationAvailability ya da { availability } taşıyan slots
 * @param {{ now: number, thresholds?: object }} opts now ZORUNLU (saat okunmaz)
 * @returns {{ state:'free'|'busy'|'out'|'unknown', confirmed:boolean, reason:string|null, source:string|null,
 *   freshness:'fresh'|'aging'|'stale'|'unverified', ageMin:number|null, available:number|null, total:number|null,
 *   tone:'ok'|'busy'|'out'|'muted', parts: Array<{template:string, params:Array}> }}
 */
export function formatOccupancy(input, { now, thresholds = OCC_THRESHOLDS } = {}) {
  let a = input;
  if (isObj(a) && a.source === undefined && isObj(a.availability)) a = a.availability;
  if (!isObj(a)) return unknown('no-data', null, 'unverified', null);

  const src = typeof a.source === 'string' ? a.source.trim().toLowerCase() : '';
  const source = Object.prototype.hasOwnProperty.call(OCC_SOURCES, src) ? OCC_SOURCES[src] : null;
  if (a.simulated !== false) return unknown(a.simulated === true ? 'simulated' : 'malformed', null, 'unverified', null);
  if (!source) return unknown('unknown-source', null, 'unverified', null);

  const { freshness, ageMin } = readFreshness(a, now, thresholds);
  if (freshness === 'unverified') return unknown('unverified-time', source, freshness, null);
  if (freshness === 'stale') return unknown('stale', source, freshness, ageMin);

  const c = readCounts(a);
  if (!c) return unknown('malformed', source, freshness, null);

  const busy = c.CHARGING + c.RESERVED + c.BLOCKED;
  const out = c.OUTOFORDER + c.INOPERATIVE;
  let state, tone, head;
  if (c.AVAILABLE > 0) { state = 'free'; tone = 'ok'; head = tpl(OCC_TEMPLATES.free, c.AVAILABLE, c.total); }
  else if (c.UNKNOWN > 0) return unknown('unknown-evse', source, freshness, null);
  else if (busy > 0) { state = 'busy'; tone = 'busy'; head = tpl(OCC_TEMPLATES.busy, c.total); }
  else if (out === c.total) { state = 'out'; tone = 'out'; head = tpl(OCC_TEMPLATES.out); }
  else return unknown('malformed', source, freshness, null);

  const confirmed = freshness === 'fresh';
  const parts = [head, tpl(OCC_TEMPLATES.age, ageMin), tpl(OCC_TEMPLATES.source, source, '')];
  if (confirmed) parts.push(tpl(OCC_TEMPLATES.live));
  return Object.freeze({ state, confirmed, reason: null, source, freshness, ageMin, available: c.AVAILABLE, total: c.total, tone, parts: Object.freeze(parts) });
}

/** Görüntü tanımını metne çevirir. translate: (template, ...params) → string (uygulamada i18n t()); verilmezse Türkçe kaynak doldurulur. */
export function occupancyText(desc, translate = null) {
  const fill = translate || ((s, ...p) => p.reduce((o, v, i) => o.split(`{${i}}`).join(String(v)), s));
  const parts = isObj(desc) && Array.isArray(desc.parts) ? desc.parts : [tpl(OCC_TEMPLATES.unknown)];
  return parts.map((p) => fill(p.template, ...p.params)).join(' ').replace(/^·\s*/, '');
}
