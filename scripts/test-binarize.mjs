// OCR siyah-beyaz çevirme (js/sensors/binarize.js) testi: açık zeminde açık rakam (gerçek bir Togg fotoğrafında okunamayan durum),
// koyu zeminde açık rakam (klasik durum), koyu zeminde koyu rakam, düz görüntü ve eşik kaydırması.
// Kullanım: node scripts/test-binarize.mjs
import { binarize, binarizeCore, otsu, MIN_RANGE } from '../js/sensors/binarize.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name); };

// 40x30 görüntü: zemin bg, ortada 10x14'lük "rakam" bloğu fg; küçük gürültü için hafif oynatma.
const make = (bg, fg, extra = () => {}) => {
  const w = 40, h = 30, g = new Uint8Array(w * h).fill(bg);
  for (let y = 8; y < 22; y++) for (let x = 15; x < 25; x++) g[y * w + x] = fg;
  extra(g, w, h);
  return { g, w, h, inside: (x, y) => x >= 15 && x < 25 && y >= 8 && y < 22 };
};
const check = ({ g, w, h, inside }, out) => {
  let good = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((out[y * w + x] === 0) === inside(x, y)) good++;
  return good / (w * h);
};

// 1) Açık gri zeminde beyaz rakam (ortalama > 128): eski sabit eşik hepsini beyaz yapıyordu
{
  const img = make(190, 255);
  const old = img.g.map((v) => (v >= 128 ? 255 : 0)); // eski davranış (ters çevirme yok, eşik 128)
  ok('açık zemin + açık rakam: eski yöntem rakamı siler (hepsi beyaz)', old.every((v) => v === 255));
  ok('açık zemin + açık rakam: yeni yöntem rakamı siyah, zemini beyaz yapar', check(img, binarize(img.g)) === 1);
}
// 2) Koyu zeminde beyaz rakam (klasik Togg ekranı)
{
  const img = make(60, 240);
  ok('koyu zemin + açık rakam: rakam siyah, zemin beyaz', check(img, binarize(img.g)) === 1);
}
// 3) Açık zeminde koyu rakam
{
  const img = make(220, 30);
  ok('açık zemin + koyu rakam: rakam siyah kalır', check(img, binarize(img.g)) === 1);
}
// 4) Hafif gürültüyle (JPEG benzeri) bile doğru ayrım
{
  let s = 7; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 20;
  const img = make(180, 250, (g) => { for (let i = 0; i < g.length; i++) g[i] = Math.max(0, Math.min(255, g[i] + rnd())); });
  ok('gürültülü açık zemin + açık rakam: ≥ %97 doğru piksel', check(img, binarize(img.g)) >= 0.97);
}
// 5) Düz görüntü (yazı yok): tamamen beyaz, rakam uydurulmaz
{
  const flat = new Uint8Array(1200).fill(140);
  ok('düz görüntü: hepsi beyaz', binarize(flat).every((v) => v === 255));
  const faint = new Uint8Array(1200).fill(140); for (let i = 0; i < 100; i++) faint[i] = 140 + MIN_RANGE - 2;
  ok('çok düşük aralıklı görüntü: hepsi beyaz', binarize(faint).every((v) => v === 255));
}
// 6) Eşik kaydırması: bias eşiği taşır, sonuç değişebilir ama çıktı hep 0/255
{
  const img = make(190, 255);
  const t = otsu(img.g);
  ok('otsu zemin ile rakam arasında', t >= 190 && t < 255);
  const out = binarize(img.g, -5);
  ok('bias ile de yalnızca 0/255 üretilir', out.every((v) => v === 0 || v === 255));
}
// 7) Yazı çoğunluktaysa bile (rakam görüntüyü kaplar) azınlık/çoğunluk yerine yazı = azınlık: kaplama %50'yi geçince ters olabilir; en az bir sınıf siyah kalır
{
  const w = 20, h = 20, g = new Uint8Array(w * h).fill(200);
  for (let i = 0; i < 120; i++) g[i] = 250; // %30 açık
  const out = binarize(g);
  ok('yazı azınlıksa siyah olur (%30 açık → siyah)', out.filter((v) => v === 0).length === 120);
}

// 8) Işıma (bloom): rakam çekirdeği 250, çevresindeki ışıma 205, zemin 60. Otsu ışıma+rakamı tek leke yapar; çekirdek yöntemi yalnızca rakamı siyah yapar
{
  const w = 40, h = 30, g = new Uint8Array(w * h).fill(60);
  const inHalo = (x, y) => x >= 8 && x < 32 && y >= 4 && y < 26;
  const inCore = (x, y) => (x >= 15 && x < 18 && y >= 8 && y < 22) || (x >= 22 && x < 25 && y >= 8 && y < 22);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = inCore(x, y) ? 250 : inHalo(x, y) ? 205 : 60;
  const a = binarize(g);
  const b = binarizeCore(g);
  ok('ışıma: Otsu yöntemi rakamı ışımadan ayıramaz (çekirdek sonucundan farklı)', a.some((v, i) => v !== b[i]));
  let good = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((b[y * w + x] === 0) === inCore(x, y)) good++;
  ok('ışıma: çekirdek yöntemi yalnızca rakam çekirdeğini siyah yapar', good === w * h);
  ok('çekirdek yöntemi: düz görüntü hepsi beyaz', binarizeCore(new Uint8Array(1200).fill(140)).every((v) => v === 255));
  ok('çekirdek yöntemi: yalnızca 0/255', [...binarizeCore(g, 10)].every((v) => v === 0 || v === 255));
}

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
