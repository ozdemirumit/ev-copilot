// Gri görüntüyü OCR için siyah-beyaza çevirir (DOM'suz, saf; node ile test edilir).
// Sabit 128 eşiği + "ortalama koyuysa ters çevir" kuralı yalnızca koyu zeminde açık rakamda çalışırdı; zemin de açık renkliyse
// (ör. gündüz yansıması, açık gri kutu içinde beyaz rakam) tüm görüntü beyaza düşüp rakamlar kayboluyordu. Bu yüzden
// eşik her görüntüden Otsu yöntemiyle bulunur ve yazı = azınlık sınıfı sayılır (siyaha çevrilir).

/** Otsu eşiği (0..255): sınıflar arası varyansı en büyük yapan gri değer. */
export function otsu(g) {
  const hist = new Uint32Array(256);
  let sum = 0;
  for (let i = 0; i < g.length; i++) { hist[g[i]]++; sum += g[i]; }
  let wB = 0;
  let sB = 0;
  let best = -1;
  let thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = g.length - wB;
    if (!wF) break;
    sB += t * hist[t];
    const v = wB * wF * (sB / wB - (sum - sB) / wF) ** 2;
    if (v > best) { best = v; thr = t; }
  }
  return thr;
}

/**
 * "Parlak çekirdek" yöntemi: kamera pozlaması rakamı taşırıp etrafında ışıma (bloom) oluşturduğunda ışıma ile rakam
 * birleşir ve Otsu hepsini tek leke yapar. Burada eşik iki kez bulunur: önce zemin ayrılır, sonra kalan açık pikseller
 * (ışıma + rakam) kendi içinde ikiye bölünür; yalnızca en parlak çekirdek (rakam çizgileri) siyah olur.
 */
export function binarizeCore(gray, bias = 0) {
  const n = gray.length;
  const out = new Uint8Array(n).fill(255);
  let mn = 255;
  let mx = 0;
  for (let i = 0; i < n; i++) { if (gray[i] < mn) mn = gray[i]; if (gray[i] > mx) mx = gray[i]; }
  if (mx - mn < MIN_RANGE) return out;
  const t1 = otsu(gray);
  const bright = gray.filter((v) => v > t1);
  if (bright.length < 16) return out;
  const t2 = Math.min(254, Math.max(1, otsu(bright) + bias));
  for (let i = 0; i < n; i++) if (gray[i] > t2) out[i] = 0;
  return out;
}

/** Aralığı bu değerden dar görüntü düzdür (yazı yok): çıktı tamamen beyaz olur, gürültü rakam sanılmaz. */
export const MIN_RANGE = 24;

/**
 * gray: Uint8Array (0..255). bias: kullanıcı kaydırması (eşik sürgüsü − 128), otomatik eşiğe eklenir.
 * Dönüş: Uint8Array, yazı 0 (siyah), zemin 255 (beyaz).
 */
export function binarize(gray, bias = 0) {
  const n = gray.length;
  const out = new Uint8Array(n).fill(255);
  let mn = 255;
  let mx = 0;
  for (let i = 0; i < n; i++) { if (gray[i] < mn) mn = gray[i]; if (gray[i] > mx) mx = gray[i]; }
  if (mx - mn < MIN_RANGE) return out;
  const thr = Math.min(254, Math.max(1, otsu(gray) + bias));
  let dark = 0;
  for (let i = 0; i < n; i++) if (gray[i] <= thr) dark++;
  const inkDark = dark <= n / 2;
  for (let i = 0; i < n; i++) if ((gray[i] <= thr) === inkDark) out[i] = 0;
  return out;
}
