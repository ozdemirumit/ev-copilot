// Bir OCR çevriminde alınan karelerin ortak kararı (DOM'suz, saf; node ile test edilir).
// Tek kare asla yeterli değildir: en az iki kare aynı değerde (± tol) birleşmeli ve güven skoru eşiği geçmelidir.

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const weightOf = (s) => clamp01((s.confidence ?? 0) / 100) * clamp01(s.quality ?? 1);

/**
 * samples: [{ value: tamsayı|null, confidence: 0..100, quality: 0..1 }]. Okunamayan kareler de listede kalır, skoru düşürür.
 * Dönüş: { value: doğrulanmış değer|null, raw: en güçlü aday|null, score: 0..1, agree, total, digits: görüntüdeki hane sayısı kanıtı|null }.
 */
export function consensus(samples, { tol = 0, minAgree = 2, minScore = 0.4 } = {}) {
  const total = samples.length;
  const valid = samples.filter((s) => s.value != null);
  if (!valid.length) return { value: null, raw: null, score: 0, agree: 0, total, digits: null };

  const totalWeight = valid.reduce((a, s) => a + weightOf(s), 0);
  let best = null;
  for (const center of new Set(valid.map((s) => s.value))) {
    const members = valid.filter((s) => Math.abs(s.value - center) <= tol);
    const weight = members.reduce((a, s) => a + weightOf(s), 0);
    if (!best || weight > best.weight || (weight === best.weight && members.length > best.members.length)) best = { members, weight };
  }

  // Küme içinde en ağır tam değer (son kare eşitliği bozar)
  const byValue = new Map();
  best.members.forEach((s) => byValue.set(s.value, (byValue.get(s.value) || 0) + weightOf(s)));
  let raw = best.members.at(-1).value;
  for (const [v, w] of byValue) if (w > byValue.get(raw)) raw = v;

  const agree = best.members.length;
  const purity = totalWeight > 0 ? best.weight / totalWeight : 0; // çelişen kareler düşürür
  const strength = best.weight / agree; // ortalama güven × kalite
  const coverage = 0.5 + 0.5 * (agree / total); // okunamayan kareler hafifçe düşürür
  const score = clamp01(purity * strength * coverage);
  const counts = new Map();
  best.members.forEach((s) => { if (s.digits != null) counts.set(s.digits, (counts.get(s.digits) || 0) + 1); });
  const digits = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { value: agree >= minAgree && score >= minScore ? raw : null, raw, score, agree, total, digits };
}
