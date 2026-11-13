// OCR 2: çevrimdışı, bağımlılıksız rakam tanıyıcı (DOM'suz çekirdek, node ile test edilir). Akış: ikili görüntü → bağlı bileşenler →
// rakam adayları (boy/alan süzgeci, kopuk parçaları birleştirme, yapışık rakamları ayırma) → 16×24 normalleştirme → çok yazı tipli
// prototiplerle normalize çapraz korelasyon. Aynı bölütleme OCR 1 için "kaç hane var" kanıtı üretir (42 → 4 hane kaybını yakalar).
import { binarize } from './binarize.js';
import { DIGIT_MODEL } from './digitModel.js';

export const GLYPH_W = 16;
export const GLYPH_H = 24;
const MIN_TALLEST = 0.25; // en uzun aday görüntü yüksekliğinin en az bu oranı olmalı
const MIN_REL_HEIGHT = 0.6; // küçük % işareti ve gürültü rakam sayılmaz
const MIN_FILL = 0.05;
const MAX_FLAT = 3; // en/boy üstü yatay çizgi: pil çubuğu vb.
const WIDE = 1.1; // tek rakam için fazla geniş: yapışık rakam şüphesi
const NON_DIGIT = 0.35; // bu benzerliğin altındaki leke rakam sayılmaz
const RESIDUE_REL_HEIGHT = 0.18; // elenen ama bu boydan büyük parça: kısmen silinmiş/kırpılmış rakam olabilir
const RESIDUE_FILL = 0.04; // kısa artık için en az bu kadar mürekkep (küçük leke sayılmaz)
const RESIDUE_TALL = 0.35; // uzun ama ince artık (sağı silinmiş rakamın sol kenarı) daha az mürekkeple de sayılır
const RESIDUE_TALL_FILL = 0.01;

/** 8-komşulu bağlı bileşenler. Dönüş: { labels, boxes: [{ ids:[label], x0, y0, x1, y1, area }] } (yazı = 0). */
export function components(bw, w, h) {
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const boxes = [];
  let next = 0;
  for (let start = 0; start < bw.length; start++) {
    if (bw[start] !== 0 || labels[start]) continue;
    const id = ++next;
    const b = { ids: [id], x0: w, y0: h, x1: 0, y1: 0, area: 0 };
    let top = 0;
    stack[top++] = start;
    labels[start] = id;
    while (top) {
      const p = stack[--top];
      const x = p % w;
      const y = (p - x) / w;
      b.area++;
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(h - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(w - 1, x + 1); nx++) {
          const q = ny * w + nx;
          if (bw[q] === 0 && !labels[q]) { labels[q] = id; stack[top++] = q; }
        }
      }
    }
    boxes.push(b);
  }
  return { labels, boxes };
}

const boxW = (b) => b.x1 - b.x0 + 1;
const boxH = (b) => b.y1 - b.y0 + 1;

/** Yatayda örtüşen parçaları (kopuk rakam çizgileri) tek adayda toplar. */
function mergeStacked(boxes) {
  const out = [...boxes].sort((a, b) => a.x0 - b.x0);
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length;) {
      const a = out[i];
      const b = out[j];
      const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1;
      if (overlap >= 0.5 * Math.min(boxW(a), boxW(b))) {
        out[i] = { ids: [...a.ids, ...b.ids], x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), area: a.area + b.area };
        out.splice(j, 1);
      } else j++;
    }
  }
  return out;
}

const inBox = (labels, w, box, x, y) => box.ids.includes(labels[y * w + x]);

/** Yapışık rakamları dikey izdüşümdeki en derin vadiden ikiye ayırır; vadi yoksa null. */
function splitWide(labels, w, box) {
  const bw2 = boxW(box);
  const cols = new Uint32Array(bw2);
  let total = 0;
  for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) if (inBox(labels, w, box, x, y)) { cols[x - box.x0]++; total++; }
  const from = Math.floor(bw2 * 0.3);
  const to = Math.ceil(bw2 * 0.7);
  let cut = -1;
  let min = Infinity;
  for (let i = from; i < to; i++) if (cols[i] < min) { min = cols[i]; cut = i; }
  if (cut < 0 || min > 0.35 * (total / bw2)) return null;
  const areaOf = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += cols[i]; return s; };
  return [
    { ...box, x1: box.x0 + cut - 1, area: areaOf(0, cut), split: true },
    { ...box, x0: box.x0 + cut, area: areaOf(cut, bw2), split: true },
  ];
}

/** Adayı 16×24 ızgaraya taşır: boya göre ölçeklenir, ortalanır, hafif bulanıklaştırılır (ince/kalın yazı farkını tolere eder). */
export function normalizeGlyph(labels, w, box) {
  const bh = boxH(box);
  const bw2 = boxW(box);
  const scale = GLYPH_H / bh;
  const tw = Math.max(1, Math.min(GLYPH_W, Math.round(bw2 * scale)));
  const left = Math.floor((GLYPH_W - tw) / 2);
  const cells = new Float32Array(GLYPH_W * GLYPH_H);
  const SS = 3; // hücre başına alt örnek
  for (let gy = 0; gy < GLYPH_H; gy++) {
    for (let gx = 0; gx < tw; gx++) {
      let ink = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = box.x0 + Math.min(bw2 - 1, Math.floor(((gx + (sx + 0.5) / SS) / tw) * bw2));
          const y = box.y0 + Math.min(bh - 1, Math.floor(((gy + (sy + 0.5) / SS) / GLYPH_H) * bh));
          if (inBox(labels, w, box, x, y)) ink++;
        }
      }
      cells[gy * GLYPH_W + gx + left] = ink / (SS * SS);
    }
  }
  const out = new Float32Array(cells.length);
  for (let y = 0; y < GLYPH_H; y++) {
    for (let x = 0; x < GLYPH_W; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GLYPH_W || ny >= GLYPH_H) continue;
        const k = dx || dy ? 1 : 2;
        s += cells[ny * GLYPH_W + nx] * k;
        n += k;
      }
      out[y * GLYPH_W + x] = s / n;
    }
  }
  return out;
}

/** Ortalaması çıkarılmış birim vektör: iç çarpım = normalize çapraz korelasyon. */
function unit(v) {
  const u = new Float32Array(v.length);
  let mean = 0;
  for (let i = 0; i < v.length; i++) mean += v[i];
  mean /= v.length;
  let norm = 0;
  for (let i = 0; i < v.length; i++) { u[i] = v[i] - mean; norm += u[i] * u[i]; }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) u[i] /= norm;
  return u;
}

let protos = null;
function loadProtos() {
  if (protos) return protos;
  const size = GLYPH_W * GLYPH_H;
  const bytes = typeof atob === 'function'
    ? Uint8Array.from(atob(DIGIT_MODEL.data), (c) => c.charCodeAt(0))
    : new Uint8Array(Buffer.from(DIGIT_MODEL.data, 'base64'));
  protos = [];
  for (let i = 0; i * size < bytes.length; i++) {
    const v = new Float32Array(size);
    for (let k = 0; k < size; k++) v[k] = bytes[i * size + k] / 255;
    protos.push({ digit: Number(DIGIT_MODEL.labels[i]), vec: unit(v) });
  }
  return protos;
}

/** Bir rakam ızgarasını sınıflar. Dönüş: { digit, similarity, margin, confidence 0..100 }. */
export function classifyGlyph(cells) {
  const u = unit(cells);
  const best = new Array(10).fill(-1);
  for (const p of loadProtos()) {
    let s = 0;
    for (let i = 0; i < u.length; i++) s += u[i] * p.vec[i];
    if (s > best[p.digit]) best[p.digit] = s;
  }
  let digit = 0;
  for (let d = 1; d < 10; d++) if (best[d] > best[digit]) digit = d;
  let second = -1;
  for (let d = 0; d < 10; d++) if (d !== digit && best[d] > second) second = best[d];
  const similarity = best[digit];
  const margin = similarity - second;
  const conf = Math.min(1, Math.max(0, (similarity - 0.45) / 0.4)) * Math.min(1, 0.6 + margin * 6);
  return { digit, similarity, margin, confidence: Math.round(conf * 100) };
}

/**
 * İkili görüntüden rakamları okur. pad: görüntünün çevresindeki boş kenar (preprocess PAD).
 * Dönüş: { text, confidence, n: hane kanıtı 1..3 | null (belirsiz), merged, clipped, glyphs }.
 */
export function readDigits(bw, w, h, pad = 0) {
  return readParts(bw, w, h, pad).result;
}

/**
 * Rakam satırının dışındaki küçük parçalar (ayrı satırdaki % işareti, birim): rakamlarla dikeyde hiç örtüşmeyen ve rakam boyunun
 * OFF_LINE_REL katından kısa bileşenler. Togg ekranında küçük % iri rakamların altında durur; eskiden mergeStacked onu üstteki
 * rakamla aynı kutuya katıyor, rakam dikeyde ezilip 4→1, 8→1, 7→1 okunuyordu (47→17). Rakam bandı, bandı belirleyecek kadar uzun
 * bileşenlerden (en uzunun en az %60'ı) kurulur; kopuk rakam parçaları bandın içinde kaldığı için birleşmeye devam eder.
 */
const OFF_LINE_REL = 0.6;
function offLineIds(boxes, contentW, h) {
  const tall = boxes.filter((b) => boxW(b) < 0.8 * contentW || boxH(b) > 0.3 * h);
  const tallest = tall.reduce((m, b) => Math.max(m, boxH(b)), 0);
  if (!tallest) return new Set();
  const band = tall.filter((b) => boxH(b) >= OFF_LINE_REL * tallest);
  const y0 = Math.min(...band.map((b) => b.y0));
  const y1 = Math.max(...band.map((b) => b.y1));
  const bandH = y1 - y0 + 1;
  // Yalnızca bir rakamın tam altında/üstünde duran parça: yanda kalan artık (eski stil yazıda taban altına inen 3'ün parlamadan
  // kalan alt ucu) ayrı satır sayılmaz, hane kaybı kanıtı olarak kalır.
  const under = (b) => band.some((d) => Math.min(b.x1, d.x1) >= Math.max(b.x0, d.x0));
  return new Set(boxes.filter((b) => (b.y0 > y1 || b.y1 < y0) && boxH(b) < OFF_LINE_REL * bandH && under(b)).flatMap((b) => b.ids));
}

function readParts(bw, w, h, pad) {
  const { labels, boxes: raw } = components(bw, w, h);
  const contentW = w - 2 * pad;
  const off = offLineIds(raw, contentW, h);
  const boxes = off.size ? raw.filter((b) => !off.has(b.ids[0])) : raw;
  return { labels, off, result: readBoxes(labels, boxes, w, h, pad, contentW) };
}

function readBoxes(labels, boxes, w, h, pad, contentW) {
  let cands = mergeStacked(boxes).filter((b) => boxW(b) < 0.8 * contentW || boxH(b) > 0.3 * h);
  const tallest = cands.reduce((m, b) => Math.max(m, boxH(b)), 0);
  const empty = { text: '', confidence: 0, n: null, merged: false, clipped: false, glyphs: [] };
  if (!tallest || tallest < MIN_TALLEST * (h - 2 * pad)) return empty;
  const all = cands;
  cands = cands.filter((b) => boxH(b) >= MIN_REL_HEIGHT * tallest && b.area >= MIN_FILL * tallest * tallest && boxW(b) / boxH(b) <= MAX_FLAT);
  // Parlama/kırpma bir rakamın bir kısmını sildiyse kalan parça kısa kalıp elenir; bu artık 'tek rakam var' kanıtı sayılamaz.
  // Küçük leke ve yatay çubuk (pil göstergesi) artık sayılmaz; % işareti büyükse tek hane kanıtı belirsizleşir (değer reddedilmez).
  const residue = all.some((b) => !cands.includes(b) && boxH(b) >= RESIDUE_REL_HEIGHT * tallest && boxW(b) / boxH(b) <= MAX_FLAT
    && b.area >= (boxH(b) >= RESIDUE_TALL * tallest ? RESIDUE_TALL_FILL : RESIDUE_FILL) * tallest * tallest);

  let merged = false;
  const split = [];
  for (const b of cands) {
    let parts = [b];
    for (let round = 0; round < 2 && parts.some((p) => boxW(p) / boxH(p) > WIDE); round++) {
      parts = parts.flatMap((p) => {
        if (boxW(p) / boxH(p) <= WIDE) return [p];
        const two = splitWide(labels, w, p);
        if (!two) { merged = true; return [p]; }
        return two;
      });
    }
    split.push(...parts);
  }
  split.sort((a, b) => a.x0 - b.x0);
  if (!split.length || split.length > 4) return { ...empty, n: null, merged };

  const glyphs = split.map((box) => ({ box, ...classifyGlyph(normalizeGlyph(labels, w, box)) }));
  const digits = glyphs.filter((g) => g.similarity >= NON_DIGIT);
  const clipped = split.some((b) => b.x0 <= pad + 1 || b.x1 >= w - pad - 2);
  const text = digits.map((g) => g.digit).join('');
  // Ayrılamayan yapışık rakamlar tek rakam sanılırsa hane kaybı olurdu: bu okuma güvenilmez sayılır
  const confidence = digits.length && !merged ? Math.min(...digits.map((g) => g.confidence)) : 0;
  // Tek rakam kanıtı yalnızca başka rakam izi yoksa verilir: elenen artık parça, benzerliği düşük (silik) aday ya da ROI kenarına
  // değen aday varsa ikinci hane kaybolmuş olabilir → n=null (belirsiz). Çok haneli sayımda n alt sınır olarak kalır.
  const uncertainSingle = digits.length === 1 && (residue || digits.length < glyphs.length || clipped);
  const n = merged || !digits.length || digits.length > 3 || uncertainSingle ? null : digits.length;
  return { text, confidence, n, merged, clipped, glyphs };
}

/**
 * Ön işlenmiş tuvalden okur (yazı rengi fark etmez: binarize azınlık sınıfını yazı sayar).
 * clearOffLine: rakam satırı dışındaki parçalar (ayrı satırdaki %) tuvalde zemin rengine boyanır; aynı tuvali okuyan OCR 1 (Tesseract)
 * de % işaretini rakam sanmaz. Silinecek bir şey yoksa tuvale yazılmaz. Dönüş readDigits ile aynı, ek olarak offLine: silinen parça sayısı.
 */
export function readCanvasDigits(canvas, pad = 0, { clearOffLine = false } = {}) {
  const { width: w, height: h } = canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) gray[i] = px[i * 4];
  const bw = binarize(gray);
  const { labels, off, result } = readParts(bw, w, h, pad);
  if (clearOffLine && off.size) {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < bw.length; i++) if (bw[i] !== 0) { sum += gray[i]; n++; }
    const bg = n ? Math.round(sum / n) : 255;
    for (let i = 0; i < labels.length; i++) if (off.has(labels[i])) { px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = bg; px[i * 4 + 3] = 255; }
    ctx.putImageData(img, 0, 0);
  }
  return { ...result, offLine: off.size };
}

/** Okunan değerin hane sayısı görüntüdeki rakam sayısıyla çelişiyor mu? null | 'truncated' (hane eksik) | 'extra-digit' (fazla hane). */
export function digitMismatch(value, n) {
  if (value == null || n == null) return null;
  const len = String(value).length;
  if (n > len) return 'truncated';
  if (n === 1 && len > 1) return 'extra-digit';
  return null;
}
