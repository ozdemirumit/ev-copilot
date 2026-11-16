// D3-T1: SAF doluluk KARAR modülü (yan etkisiz; DOM, ağ, depolama, saat okuması yok). Görüntü değil, veri kararıdır.
// Girdi: server/availability.mjs ortak biçimi (StationAvailability) ya da onu `availability` alanında taşıyan slots nesnesi.
// Çıktı: { trusted, state, reason, source, ageMin } — trusted:false ise state DAİMA 'unknown' (arayüzde "Bilinmiyor").
//
// Onaylı D3 alt kararları (docs/beta-task-registry.json decisions[D3].sub_decisions, 2026-11-16):
//  - K1: sağlayıcı zaman damgası zorunlu. timestampKind 'provider' + sonlu `at` yoksa → unknown ('no-timestamp').
//  - K4: ingest edilen veri (TomTom/NDW 'fetched'; `at` = okuma anı) doğrulanmış canlı doluluk DEĞİLDİR → unknown.
//        Kaynak verisini almak/normalize etmek gösterim doğrulaması sayılmaz; `checked` (okuma anı) tazelik sayılmaz.
//  - K2: NDW 0/N (hiç boş yok) doğrulanmamışsa → unknown ('ndw-zero-unverified'); ayrıntısız sayı "dolu" kanıtı değildir.
//        Bugün NDW için doğrulama yolu yoktur; bu modülde NDW 0/N her zaman unknown'dır.
//  - AGE: 15 dakikadan eski (now - at > 15 dk) → unknown ('aged' ≤ 2 sa, 'stale' > 2 sa). Tam 15 dk dahil güncel sayılır.
// Kurallar js/routing/occupancyLabel.js formatOccupancy üzerine kurulur (aynı sayı doğrulaması, kaynak listesi, saat kayması
// toleransı); trusted ⇔ biçimlendiricinin confirmed'i (fresh + sağlayıcı zamanı) VE K2 engeli yok.
// Uygulamaya bağlı DEĞİLDİR (D3-T1): hiçbir modül içe aktarmaz, sw.js SHELL listesinde yok. Bağlama D3-T2/T4 işidir.

import { formatOccupancy, OCC_THRESHOLDS } from './occupancyLabel.js';

/** AGE kararı: doluluk verisi en fazla 15 dk eski olabilir. */
export const OCC_DECISION_MAX_AGE_MS = 15 * 60e3;

const THRESHOLDS = Object.freeze({ ...OCC_THRESHOLDS, freshMs: OCC_DECISION_MAX_AGE_MS });
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

const unknown = (reason, source = null) => Object.freeze({ trusted: false, state: 'unknown', reason, source, ageMin: null });

/**
 * Doluluk kararı. Saf: aynı girdi + now → aynı çıktı; girdiyi değiştirmez; saat okumaz.
 * @param {object|null} input StationAvailability ya da { availability } taşıyan slots
 * @param {{ now: number }} opts now ZORUNLU (ms); yoksa/geçersizse karar 'unknown' ('no-now')
 * @returns {{ trusted:boolean, state:'free'|'busy'|'out'|'unknown', reason:string|null, source:string|null, ageMin:number|null }}
 */
export function occupancyDecision(input, { now } = {}) {
  if (typeof now !== 'number' || !Number.isFinite(now)) return unknown('no-now');
  let a = input;
  if (isObj(a) && a.source === undefined && isObj(a.availability)) a = a.availability;
  if (!isObj(a) || a.source === undefined) return unknown('no-data');

  const d = formatOccupancy(a, { now, thresholds: THRESHOLDS });
  if (d.freshness === 'unverified' && d.reason === 'unverified-time') return unknown('no-timestamp', d.source);
  if (d.freshness === 'stale') return unknown('stale', d.source);
  if (d.freshness === 'aging') return unknown('aged', d.source);
  if (d.reason) return unknown(d.reason, d.source);
  if (d.confirmed !== true || d.freshness !== 'fresh') return unknown('unverified', d.source);
  if (d.source === 'NDW' && d.available === 0) return unknown('ndw-zero-unverified', d.source);
  return Object.freeze({ trusted: true, state: d.state, reason: null, source: d.source, ageMin: d.ageMin });
}
