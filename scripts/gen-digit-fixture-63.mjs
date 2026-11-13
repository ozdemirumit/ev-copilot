// 63 (ve tek hane 6, 3) sınama sahnelerini modelde OLMAYAN yazı tipleriyle üretir; mevcut model ve digits-heldout.json'a dokunmaz.
// Çizim gen-digit-model.mjs ile aynıdır (96 px, ortalı, siyah yazı/beyaz zemin); ikilileştirme node'da uygulamanın binarize.js'iyle yapılır.
// Yalnızca sentetik çizim; kamera karesi kaydedilmez, dış servis yok.
// Kullanım: node scripts/gen-digit-fixture-63.mjs <playwright-core yolu> <chromium.exe>
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { binarize } from '../js/sensors/binarize.js';

const [, , pwPath, exe] = process.argv;
if (!pwPath || !exe) throw new Error('Kullanım: gen-digit-fixture-63.mjs <playwright-core> <chromium.exe>');
const { chromium } = createRequire(import.meta.url)(pwPath);
const HELDOUT = ['Corbel', 'Candara', 'Franklin Gothic Medium', 'Century Gothic', 'Gill Sans MT', 'Leelawadee UI'];
const SCENES = ['63', '6', '3'];

const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();
const grays = await page.evaluate(({ HELDOUT, SCENES }) => {
  const out = [];
  for (const spec of HELDOUT) for (const text of SCENES) {
    const [family, weight = 'normal'] = spec.split(':');
    const H = 96;
    const c = document.createElement('canvas');
    c.width = Math.max(120, text.length * 90);
    c.height = H + 24;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#000'; x.font = `${weight} ${Math.round(H * 0.95)}px "${family}"`; x.textBaseline = 'middle'; x.textAlign = 'center';
    x.fillText(text, c.width / 2, c.height / 2);
    const px = x.getImageData(0, 0, c.width, c.height).data;
    const g = new Array(c.width * c.height);
    for (let i = 0; i < g.length; i++) g[i] = px[i * 4];
    out.push({ text, font: spec, w: c.width, h: c.height, g });
  }
  return out;
}, { HELDOUT, SCENES });
await browser.close();

function rle(bits) { const runs = []; let cur = 0, n = 0; for (const b of bits) { if (b === cur) n++; else { runs.push(n); cur = b; n = 1; } } runs.push(n); return runs; }
const fixtures = grays.map(({ text, font, w, h, g }) => {
  const bw = binarize(Uint8Array.from(g));
  return { text, font, w, h, rle: rle(Array.from(bw, (v) => (v === 0 ? 1 : 0))) };
});
writeFileSync(new URL('./fixtures/digits-63.json', import.meta.url), JSON.stringify(fixtures));
console.log(`sınama sahnesi: ${fixtures.length}`);
