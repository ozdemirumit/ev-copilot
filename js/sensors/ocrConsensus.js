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

/**
 * Çevrimler arası ortak karar (pil): tek çevrimde kareler karışınca (gerçek 38, kareler 38/33/38 → çevrim skoru eşiğin altında)
 * kanıt çöpe gitmesin diye son birkaç çevrimin karelerine birlikte bakılır. Tek çevrim asla yetmez:
 *  - aday kümesi en az minCycles ayrı çevrimin çoğunluk okuması (raw) olmalı ve EN SON çevrim de bu kümede olmalı,
 *  - pencerede geçerli karelerin ağırlıkça en az minShare'i bu kümede olmalı (33/38 yarı yarıya ise karar yok),
 *  - en az minFrames kare ve kümenin ortalama güven × kalitesi en az minStrength olmalı.
 * cycles: [{ t, raw, samples }] (eskiden yeniye). Dönüş: { value|null, raw, share, strength, frames, cycles, score }.
 */
export function windowConsensus(cycles, { tol = 0, now = Date.now(), maxAgeMs = 30000, minCycles = 2, minShare = 0.6, minFrames = 4, minStrength = 0.4 } = {}) {
  const recent = cycles.filter((c) => now - c.t <= maxAgeMs);
  const none = { value: null, raw: null, share: 0, strength: 0, frames: 0, cycles: 0, score: 0 };
  const latest = recent.at(-1);
  if (!latest || latest.raw == null) return none;
  const valid = recent.flatMap((c) => c.samples.filter((s) => s.value != null));
  const totalWeight = valid.reduce((a, s) => a + weightOf(s), 0);
  // Küme merkezi: son çevrimin çoğunluk okuması (eski çevrimlere dayanarak son çevrimle çelişen değer kabul edilmez)
  const center = latest.raw;
  const members = valid.filter((s) => Math.abs(s.value - center) <= tol);
  const weight = members.reduce((a, s) => a + weightOf(s), 0);
  const share = totalWeight > 0 ? weight / totalWeight : 0;
  const strength = members.length ? weight / members.length : 0;
  const agreeing = recent.filter((c) => c.raw != null && Math.abs(c.raw - center) <= tol).length;
  const res = { value: null, raw: center, share, strength, frames: members.length, cycles: agreeing, score: clamp01(share * strength) };
  if (agreeing >= minCycles && share >= minShare && members.length >= minFrames && strength >= minStrength) res.value = center;
  return res;
}
