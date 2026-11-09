// OCR 2 çekirdeği (DOM'suz): modelde bulunmayan yazı tipleriyle okuma, hane kanıtı, küçük % işareti, yapışık/boş görüntü.
// Kullanım: node scripts/test-digit-ocr.mjs
import { readFileSync } from 'node:fs';
import { readDigits, digitMismatch } from '../js/sensors/digitRecognizer.js';

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
ok('42 görüntüsünde 4 okuma: hane eksik', digitMismatch(4, 2) === 'truncated');
ok('tek rakam görüntüsünde 42: fazla hane', digitMismatch(42, 1) === 'extra-digit');
ok('kanıt yoksa karar verilmez', digitMismatch(4, null) === null);
ok('gerçek tek hane serbest', digitMismatch(4, 1) === null);
ok('100 geçerli', digitMismatch(100, 3) === null);

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
