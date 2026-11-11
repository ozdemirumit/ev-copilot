// Araç uygulaması/widget ekran görüntüsünden (ör. Trumore: "%52", "205km", "9 Kasım 2026 16:33") okunan OCR metnini ayrıştırır.
// Saf fonksiyonlar: OCR ve DOM yok, testte doğrudan çalışır.

const MONTHS = { oca: 0, sub: 1, mar: 2, nis: 3, may: 4, haz: 5, tem: 6, agu: 7, eyl: 8, eki: 9, kas: 10, ara: 11 };
const ASCII = { ş: 's', ı: 'i', ğ: 'g', ü: 'u', ö: 'o', ç: 'c', İ: 'i' };
const fold = (s) => String(s).replace(/[şığüöçİ]/gi, (c) => ASCII[c] ?? ASCII[c.toLowerCase()] ?? c).toLowerCase();

const PCT = /(?:%\s*(\d{1,3})(?!\d))|(?:(?<!\d)(\d{1,3})\s*%)/g;
const KM = /(?<!\d)(\d{2,4})\s*km/gi;
const STAMP = /(\d{1,2})\s+([a-zşığüöç]{3,9})\.?\s+(\d{4})\s+(\d{1,2})[:.](\d{2})/i;
const STAMP_NUM = /(\d{1,2})[./](\d{1,2})[./](\d{4})\s+(\d{1,2})[:.](\d{2})/;

/** Satırdaki tüm % değerleri (0..100). */
function pcts(line) {
  const out = [];
  for (const m of line.matchAll(PCT)) {
    const v = Number(m[1] ?? m[2]);
    if (v >= 0 && v <= 100) out.push(v);
  }
  return out;
}

const kms = (line) => [...line.matchAll(KM)].map((m) => Number(m[1])).filter((v) => v >= 10 && v <= 1500);

/**
 * Zaman damgası: "9 Kasım 2026 16:33" ya da "09.11.2026 16:33" → yerel saat Date; bulunamazsa null.
 * OCR (eng dili) Türkçe harfleri bozabilir; ay adı ilk 3 harfinden eşlenir.
 */
export function parseStamp(text) {
  const s = String(text);
  let m = STAMP.exec(s);
  if (m) {
    const mon = MONTHS[fold(m[2]).slice(0, 3)];
    if (mon != null) return validDate(Number(m[3]), mon, Number(m[1]), Number(m[4]), Number(m[5]));
  }
  m = STAMP_NUM.exec(s);
  if (m) return validDate(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]));
  return null;
}

function validDate(y, mo, d, h, mi) {
  if (y < 2020 || y > 2100 || mo < 0 || mo > 11 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const dt = new Date(y, mo, d, h, mi);
  return dt.getMonth() === mo ? dt : null;
}

/**
 * Metinden pil yüzdesi, menzil ve zaman damgası. Pil yalnızca "%" ile birlikte okunur (durum çubuğundaki pil rakamı karışmasın).
 * Birden çok % varsa "km" ile aynı satırdaki tercih edilir; yine belirsizse ambiguous=true.
 * Dönüş: { soc, rangeKm, at, ambiguous } — soc yoksa null.
 */
export function parseShot(text) {
  const lines = String(text).split(/\r?\n/);
  const found = [];
  lines.forEach((line, i) => pcts(line).forEach((v) => found.push({ v, i, withKm: kms(line).length > 0 })));
  const all = lines.flatMap(kms);
  const at = parseStamp(text);
  if (!found.length) return { soc: null, rangeKm: all[0] ?? null, at, ambiguous: false };
  const near = found.filter((f) => f.withKm);
  const pick = near[0] ?? found[0];
  const distinct = new Set(found.map((f) => f.v));
  const rangeSameLine = kms(lines[pick.i])[0];
  return { soc: pick.v, rangeKm: rangeSameLine ?? all[0] ?? null, at, ambiguous: !near.length && distinct.size > 1 };
}

/** Okumanın yaşı (saat): damga yoksa null; gelecekteki damga 0 sayılır. */
export function ageHours(at, now = Date.now()) {
  if (!(at instanceof Date)) return null;
  return Math.max(0, (now - at.getTime()) / 3600000);
}

/** Uyarı gerektirecek kadar eski mi (saat eşiği). */
export const STALE_HOURS = 1;
export const isStale = (at, now = Date.now()) => { const h = ageHours(at, now); return h != null && h > STALE_HOURS; };
