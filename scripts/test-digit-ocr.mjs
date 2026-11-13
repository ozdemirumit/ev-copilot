// OCR 2 çekirdeği (DOM'suz): modelde bulunmayan yazı tipleriyle okuma, hane kanıtı, küçük % işareti, yapışık/boş görüntü.
// Kullanım: node scripts/test-digit-ocr.mjs
import { readFileSync } from 'node:fs';
import { readDigits, digitMismatch, components } from '../js/sensors/digitRecognizer.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const scenes = JSON.parse(readFileSync(new URL('./fixtures/digits-heldout.json', import.meta.url), 'utf8'));
const bwOf = (s) => {
  const bw = new Uint8Array(s.w * s.h).fill(255);
  let i = 0, cur = 0;
  for (const run of s.rle) { if (cur) bw.fill(0, i, i + run); i += run; cur = 1 - cur; }
  return bw;
};

let right = 0, count = 0;
const wrong = [];
for (const s of scenes) {
  const r = readDigits(bwOf(s), s.w, s.h, 12);
  count++;
  if (r.text === s.text) right++; else wrong.push(`${s.font}:${s.text}→${r.text}`);
}
console.log(`modelde olmayan yazı tipleri: ${right}/${count} doğru`, wrong.slice(0, 14).join(' '));
ok('modelde olmayan yazı tiplerinde en az %85 doğru', right / count >= 0.85, `${right}/${count}`);
const f42 = scenes.filter((s) => s.text === '42');
ok('42 iki hane olarak bölütlenir (tüm yazı tipleri)', f42.every((s) => readDigits(bwOf(s), s.w, s.h, 12).n === 2));
ok('4 tek hane olarak bölütlenir', scenes.filter((s) => s.text === '4').every((s) => readDigits(bwOf(s), s.w, s.h, 12).n === 1));
ok('100 üç hane', scenes.filter((s) => s.text === '100').every((s) => readDigits(bwOf(s), s.w, s.h, 12).n === 3));

{
  const s = f42[0];
  const bw = bwOf(s);
  const stamp = (x0, y0, size) => { for (let y = y0; y < y0 + size; y++) for (let x = x0; x < x0 + size; x++) bw[y * s.w + x] = 0; };
  stamp(s.w - 16, s.h - 28, 8);
  ok('küçük leke/% hane sayısını değiştirmez', readDigits(bw, s.w, s.h, 12).n === 2);
}
ok('boş görüntü: kanıt yok', readDigits(new Uint8Array(200 * 100).fill(255), 200, 100, 12).n === null);
{
  const W = 200, H = 100;
  const bw = new Uint8Array(W * H).fill(255);
  for (let y = 0; y < H; y++) for (let x = 0; x < 34; x++) bw[y * W + x] = 0;
  ok('ROI kenarındaki rakam işaretlenir', readDigits(bw, W, H, 0).clipped === true);
}

// 63 sınama sahnesi (gen-digit-fixture-63.mjs; modelde olmayan yazı tipleri) + tek hane 6 ve 3
const s63 = JSON.parse(readFileSync(new URL('./fixtures/digits-63.json', import.meta.url), 'utf8'));
const f63 = s63.filter((s) => s.text === '63');
ok('63 fikstürü 6 yazı tipinde mevcut', f63.length === 6);
ok('63 her yazı tipinde 63 okunur ve iki hane', f63.every((s) => { const r = readDigits(bwOf(s), s.w, s.h, 12); return r.text === '63' && r.n === 2; }),
  f63.map((s) => { const r = readDigits(bwOf(s), s.w, s.h, 12); return `${s.font}:${r.text}/${r.n}`; }).join(' '));
ok('gerçek tek hane 6 ve 3: n=1 korunur', s63.filter((s) => s.text.length === 1).every((s) => { const r = readDigits(bwOf(s), s.w, s.h, 12); return r.text === s.text && r.n === 1; }));
ok('gerçek tek hane 4/2/7 (+ küçük leke): n=1 korunur', scenes.filter((s) => ['4', '2', '7'].includes(s.text)).every((s) => {
  const bw = bwOf(s);
  for (let y = s.h - 28; y < s.h - 20; y++) for (let x = s.w - 16; x < s.w - 8; x++) bw[y * s.w + x] = 0;
  return readDigits(bw, s.w, s.h, 12).n === 1;
}));

// Kısmi silinme: ikinci hanenin bir kısmı parlama (beyaz bant) ya da kırpma ile yok olur. Hane kanıtı belirsizdir: n=null veya 2 olmalı, ASLA 1.
const lastDigitBox = (s, bw) => components(bw, s.w, s.h).boxes.filter((b) => b.y1 - b.y0 > 0.3 * s.h).sort((a, b) => a.x0 - b.x0).pop();
const ERASE = [
  ['parlama üst %50', (b, x, y, W, H) => y <= b.y0 + 0.5 * H],
  ['parlama üst %70', (b, x, y, W, H) => y <= b.y0 + 0.7 * H],
  ['parlama alt %50', (b, x, y, W, H) => y >= b.y1 - 0.5 * H],
  ['parlama alt %70', (b, x, y, W, H) => y >= b.y1 - 0.7 * H],
  ['parlama orta bant %40', (b, x, y, W, H) => y >= b.y0 + 0.3 * H && y <= b.y0 + 0.7 * H],
  ['sağ %60 silik', (b, x, y, W, H) => x >= b.x1 - 0.6 * W],
  ['sağ %70 silik', (b, x, y, W, H) => x >= b.x1 - 0.7 * W],
];
const multi = [...f42, ...scenes.filter((s) => s.text === '73'), ...f63];
for (const [name, erase] of ERASE) {
  const bad = [];
  for (const s of multi) {
    const bw = bwOf(s);
    const b = lastDigitBox(s, bw);
    const W = b.x1 - b.x0 + 1, H = b.y1 - b.y0 + 1;
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) if (erase(b, x, y, W, H)) bw[y * s.w + x] = 255;
    const r = readDigits(bw, s.w, s.h, 12);
    if (r.n === 1) bad.push(`${s.font}:${s.text}→${r.text}`);
  }
  ok(`42/73/63 ${name}: tek hane kanıtı üretilmez`, !bad.length, bad.join(' '));
}
// ROI kırpması: görüntünün sağ kenarı ikinci hanenin içinden geçer (kenar boşluğu yok)
{
  const bad = [];
  for (const s of multi) for (const keep of [0.3, 0.5]) {
    const full = bwOf(s);
    const b = lastDigitBox(s, full);
    const w2 = b.x0 + Math.round(keep * (b.x1 - b.x0 + 1));
    const bw = new Uint8Array(w2 * s.h);
    for (let y = 0; y < s.h; y++) bw.set(full.subarray(y * s.w, y * s.w + w2), y * w2);
    const r = readDigits(bw, w2, s.h, 12);
    if (r.n === 1) bad.push(`${s.font}:${s.text}@${keep}→${r.text}`);
  }
  ok('42/73/63 ROI kenarında kırpılmış ikinci hane: tek hane kanıtı üretilmez', !bad.length, bad.join(' '));
}
// Kabul koruması: belirsiz kanıtla tek hane okuması (63 → 6) tek hane kanıtıyla doğrulanmış sayılmaz.
{
  const s = f63[0];
  const bw = bwOf(s);
  const b = lastDigitBox(s, bw);
  for (let y = b.y0; y <= b.y0 + 0.5 * (b.y1 - b.y0 + 1); y++) for (let x = b.x0; x <= b.x1; x++) bw[y * s.w + x] = 255;
  const r = readDigits(bw, s.w, s.h, 12);
  ok('silinmiş 63 okuması 6: n=1 değil (null ya da 2 → hane eksik)', r.n !== 1 && (r.n == null || digitMismatch(6, r.n) === 'truncated'), `n=${r.n} text=${r.text}`);
}

ok('42 görüntüsünde 4 okuma: hane eksik', digitMismatch(4, 2) === 'truncated');
ok('tek rakam görüntüsünde 42: fazla hane', digitMismatch(42, 1) === 'extra-digit');
ok('kanıt yoksa karar verilmez', digitMismatch(4, null) === null);
ok('gerçek tek hane serbest', digitMismatch(4, 1) === null);
ok('100 geçerli', digitMismatch(100, 3) === null);

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
