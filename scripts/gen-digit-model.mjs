// OCR 2 prototiplerini üretir: rakamları sistem yazı tiplerinde tarayıcıda çizer, uygulamanın kendi hattıyla 16×24 ızgaraya indirger.
// Çıktı: js/sensors/digitModel.js (yalnızca küçük ızgara verisi; yazı tipi dosyası içermez) ve scripts/fixtures/digits-heldout.json (modelde OLMAYAN yazı tipleriyle sınama sahneleri).
// Kullanım: node scripts/gen-digit-model.mjs <playwright-core yolu> <chromium.exe> <yerel önizleme adresi>   (uygulama çalışma zamanında gerekmez)
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [, , pwPath, exe, base] = process.argv;
if (!pwPath || !exe || !base) throw new Error('Kullanım: gen-digit-model.mjs <playwright-core> <chromium.exe> <adres>');
const { chromium } = createRequire(import.meta.url)(pwPath);
const FONTS = ['Arial', 'Arial:bold', 'Segoe UI', 'Segoe UI:bold', 'Segoe UI Light', 'Bahnschrift', 'Bahnschrift:bold', 'Tahoma', 'Verdana', 'Calibri', 'Calibri:bold', 'Trebuchet MS'];
const HELDOUT = ['Corbel', 'Candara', 'Franklin Gothic Medium', 'Century Gothic', 'Gill Sans MT', 'Leelawadee UI'];
const SCENES = ['42', '4', '2', '7', '10', '85', '100', '73'];

const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();
await page.goto(base, { waitUntil: 'domcontentloaded' });
const out = await page.evaluate(async ({ FONTS, HELDOUT, SCENES }) => {
  const R = await import('/js/sensors/digitRecognizer.js');
  const B = await import('/js/sensors/binarize.js');
  const render = (text, spec, H = 96) => {
    const [family, weight = 'normal'] = spec.split(':');
    const c = document.createElement('canvas');
    c.width = Math.max(120, text.length * 90);
    c.height = H + 24;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#000'; x.font = `${weight} ${Math.round(H * 0.95)}px "${family}"`; x.textBaseline = 'middle'; x.textAlign = 'center';
    x.fillText(text, c.width / 2, c.height / 2);
    const px = x.getImageData(0, 0, c.width, c.height).data;
    const g = new Uint8Array(c.width * c.height);
    for (let i = 0; i < g.length; i++) g[i] = px[i * 4];
    return { bw: B.binarize(g), w: c.width, h: c.height };
  };
  const labels = [];
  const bytes = [];
  for (const spec of FONTS) {
    for (let d = 0; d < 10; d++) {
      const { bw, w, h } = render(String(d), spec);
      const { labels: lab, boxes } = R.components(bw, w, h);
      const box = boxes.reduce((a, b) => ({ ids: [...a.ids, ...b.ids], x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), area: a.area + b.area }));
      const cells = R.normalizeGlyph(lab, w, box);
      labels.push(d);
      for (const v of cells) bytes.push(Math.round(v * 255));
    }
  }
  const b64 = (arr) => { let s = ''; for (let i = 0; i < arr.length; i += 8192) s += String.fromCharCode(...arr.slice(i, i + 8192)); return btoa(s); };
  const fixtures = [];
  for (const spec of HELDOUT) {
    for (const text of SCENES) {
      const { bw, w, h } = render(text, spec);
      const bits = Array.from(bw, (v) => (v === 0 ? 1 : 0));
      fixtures.push({ text, font: spec, w, h, rle: rle(bits) });
    }
  }
  function rle(bits) { const runs = []; let cur = 0, n = 0; for (const b of bits) { if (b === cur) n++; else { runs.push(n); cur = b; n = 1; } } runs.push(n); return runs; }
  return { labels: labels.join(''), data: b64(bytes), count: labels.length, fixtures };
}, { FONTS, HELDOUT, SCENES });
await browser.close();

const model = new URL('../js/sensors/digitModel.js', import.meta.url);
writeFileSync(model, `// Üretildi: scripts/gen-digit-model.mjs. ${out.count} prototip, ${FONTS.length} yazı stili, 16×24 gri ızgara (base64). Elle düzenleme.\nexport const DIGIT_MODEL = { labels: '${out.labels}', data: '${out.data}' };\n`);
const dir = new URL('./fixtures/', import.meta.url);
mkdirSync(fileURLToPath(dir), { recursive: true });
writeFileSync(new URL('digits-heldout.json', dir), JSON.stringify(out.fixtures));
console.log(`model: ${out.count} prototip, ${out.data.length} bayt; sınama sahnesi: ${out.fixtures.length}`);
