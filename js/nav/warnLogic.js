// Yol önü uyarılarının saf hesabı (tarayıcıya bağımlı değil, Node'da denenebilir): dik kesimleri bul, hangi uyarı ne zaman çalsın.
export const STEEP = 0.05; // 2 km'lik dilimlerin ortalama eğimi: %5 ve üstü dik sayılır
export const GRADE_LEAD = [0.5, 2.2]; // dik kesime bu kadar km kala (aralık) bir kez uyar
export const CAM_FAR = [0.7, 1.3]; // hız kamerasına 1 km kala
export const CAM_NEAR = [0.12, 0.45]; // ve 300 m kala

const fin = (c) => ({ dir: c.dir, from: c.from, to: c.to, lenKm: c.len, grade: Math.abs(c.sum / c.len) });

/** Rota dilimlerinden (segs: { km0, km1, dKm, grade }) ardışık, aynı yönlü, |eğim| ≥ eşik olan dik kesimler. dir: -1 iniş, +1 yokuş. */
export function steepSections(segs, thr = STEEP) {
  const out = [];
  let cur = null;
  for (const s of segs) {
    const dir = s.grade >= thr ? 1 : s.grade <= -thr ? -1 : 0;
    if (dir && cur && cur.dir === dir) {
      cur.to = s.km1;
      cur.sum += s.grade * s.dKm;
      cur.len += s.dKm;
    } else {
      if (cur) out.push(fin(cur));
      cur = dir ? { dir, from: s.km0, to: s.km1, sum: s.grade * s.dKm, len: s.dKm } : null;
    }
  }
  if (cur) out.push(fin(cur));
  return out;
}

/** Konuşma/ekran için mesafe metni ("1 kilometre", "300 metre"); çeviri sözlüğündeki "{0} kilometre" / "{0} metre" kalıplarına uyar. */
export const distText = (km) => (km >= 0.95 ? `${Math.round(km)} kilometre` : `${Math.max(100, Math.round(km * 10) * 100)} metre`);

/**
 * Şu anki rota km'sine göre çalacak uyarılar. said: daha önce söylenenlerin anahtarları (Set; burada güncellenir).
 * Dönüş: { speak: [{ kind, key, ... }], gradeLine, camLine } — çizgiler ekranda gösterilecek en yakın uyarı (yoksa null).
 */
export function pickWarnings(km, sections, cams, said, { grade = true, camera = true } = {}) {
  const speak = [];
  let gradeLine = null;
  let camLine = null;
  if (grade) {
    for (const s of sections) {
      const d = s.from - km;
      if (d > GRADE_LEAD[1] || d < 0) continue; // çok uzakta ya da içindeyiz/geçtik
      if (!gradeLine) gradeLine = { dir: s.dir, grade: s.grade, lenKm: s.lenKm, dKm: d };
      const key = `g${s.from.toFixed(1)}`;
      if (d >= GRADE_LEAD[0] && !said.has(key)) {
        said.add(key);
        speak.push({ kind: 'grade', key, dir: s.dir, grade: s.grade, lenKm: s.lenKm, dKm: d });
      }
    }
  }
  if (camera) {
    for (const c of cams) {
      const d = c.km - km;
      if (d > CAM_FAR[1] || d < 0) continue;
      if (!camLine) camLine = { dKm: d, maxspeed: c.maxspeed ?? null };
      for (const [name, [lo, hi]] of [['far', CAM_FAR], ['near', CAM_NEAR]]) {
        const key = `c${c.km.toFixed(2)}${name}`;
        if (d >= lo && d <= hi && !said.has(key)) {
          said.add(key);
          speak.push({ kind: 'camera', key, dKm: d, maxspeed: c.maxspeed ?? null });
        }
      }
    }
  }
  return { speak, gradeLine, camLine };
}

/** Aynı yerdeki yinelenen kameraları (100 m içinde) tek say; km'ye göre sırala. */
export function dedupeCams(cams) {
  const sorted = [...cams].sort((a, b) => a.km - b.km);
  const out = [];
  for (const c of sorted) if (!out.length || c.km - out.at(-1).km > 0.1) out.push(c);
  return out;
}
