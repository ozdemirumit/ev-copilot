// ROI kare kalitesi (frameQuality.js) ve eğim önbelleği (preprocess.js).
// Kullanım: node scripts/test-frame-quality.mjs
import { measureFrame, variantOrder, exposureSignal } from '../js/sensors/frameQuality.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name); };

const W = 120, H = 48;
function digits(bg = 30, fg = 240) {
  const g = new Uint8Array(W * H).fill(bg);
  for (let y = 8; y < 40; y++) for (const x0 of [20, 44, 72, 96]) for (let x = x0; x < x0 + 6; x++) g[y * W + x] = fg;
  return g;
}
function blur(src, r) {
  let g = Uint8Array.from(src);
  for (let n = 0; n < 2; n++) {
    const out = new Uint8Array(g.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, c = 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
        s += g[yy * W + xx]; c++;
      }
      out[y * W + x] = s / c;
    }
    g = out;
  }
  return g;
}
{
  const q = measureFrame(digits(), W, H);
  ok('net rakam: kullanılabilir, netlik iyi', q.usable && !q.blurry && q.weight > 0.9);
  ok('net rakam: parlama yok (rakam çizgileri parlama sayılmaz)', q.glare < 0.05);
}
{
  const sharp = measureFrame(digits(), W, H);
  const b = measureFrame(blur(digits(), 3), W, H);
  ok('bulanık kare: netlik düşer ve işaretlenir', b.sharpness < sharp.sharpness / 2 && b.blurry);
  ok('bulanık kare atılmaz, ağırlığı düşer', b.usable && b.weight < sharp.weight);
}
{
  const g = digits();
  for (let y = 0; y < H; y++) for (let x = 0; x < W * 0.5; x++) g[y * W + x] = 255;
  const q = measureFrame(g, W, H);
  ok('geniş doygun bölge parlama olarak ölçülür', q.glare >= 0.4);
  ok('parlama ağırlığı düşürür', q.weight < 0.7);
}
{
  const q = measureFrame(new Uint8Array(W * H).fill(255), W, H);
  ok('tamamen doygun kare kullanılamaz', !q.usable && q.reason === 'glare');
}
{
  const q = measureFrame(new Uint8Array(W * H).fill(120), W, H);
  ok('düz kare (yazı yok) kullanılamaz', !q.usable && q.reason === 'flat');
}
ok('boş girdi güvenli', !measureFrame(new Uint8Array(0), 0, 0).usable);

const VARS = [0, 1, 3, 2];
ok('normal: Otsu önce', variantOrder({ glare: 0 }, VARS)[0] === 0);
ok('parlamada çekirdek yöntemi önce', variantOrder({ glare: 0.2 }, VARS)[0] === 1);
ok('başarılı yöntem öne alınır', variantOrder({ glare: 0 }, VARS, 3)[0] === 3);
ok('tüm yöntemler korunur', [...variantOrder({ glare: 0.2 }, VARS, 2)].sort().join() === '0,1,2,3');
ok('bilinmeyen tercih yok sayılır', variantOrder({ glare: 0 }, VARS, 9)[0] === 0);

ok('parlama: pozlama kıs', exposureSignal({ glare: 0.3, mean: 150 }) === -1);
ok('çok karanlık: pozlama aç', exposureSignal({ glare: 0, mean: 20, contrast: 30 }) === 1);
ok('normal kare: dokunma', exposureSignal({ glare: 0.01, mean: 90, contrast: 180 }) === 0);
ok('ölçüm yoksa: dokunma', exposureSignal(null) === 0);

// --- Eğim önbelleği (gerçek preprocess, sahte tuval) ---
let frame = null;
const pixels = (g, w, h) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = g[i]; d[i * 4 + 3] = 255; } return d; };
const makeCanvas = () => {
  const c = { width: 0, height: 0, dataset: {} };
  const ctx = {
    fillStyle: '', fillRect() {}, drawImage() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, translate() {}, rotate() {}, transform() {}, putImageData() {},
    getImageData: (x, y, w, h) => ({ data: pixels(frame(w, h), w, h) }),
  };
  c.getContext = () => ctx;
  return c;
};
globalThis.document = { createElement: () => makeCanvas() };
const { preprocess, invalidateSkew, measureRoi } = await import('../js/sensors/preprocess.js');
const upright = (w, h) => { const g = new Uint8Array(w * h).fill(20); for (let y = 8; y < 40; y++) for (const x0 of [20, 44, 72]) for (let x = x0; x < x0 + 6 && x < w; x++) g[y * w + x] = 240; return g; };
const slanted = (w, h) => { const g = new Uint8Array(w * h).fill(20); for (let y = 8; y < 40; y++) for (const x0 of [24, 48, 76]) { const sh = Math.round((y - 24) * 0.4); for (let x = x0 + sh; x < x0 + sh + 6 && x < w; x++) g[y * w + x] = 240; } return g; };
const video = { videoWidth: 1280, videoHeight: 720, dataset: {} };
const stage = { clientWidth: 320, clientHeight: 200 };
const out = makeCanvas();
const base = { roi: { x: 0.2, y: 0.2, w: 0.4, h: 0.2 }, contrast: 1.5, threshold: 128, useThreshold: true, autoSkew: true };
{
  frame = upright;
  ok('preprocess başarılı', !!preprocess(video, stage, base, out));
  const first = out.dataset.skew;
  frame = slanted;
  for (const variant of [0, 1, 3, 2]) preprocess(video, stage, { ...base, variant }, out);
  ok('aynı ROI: eğim her varyantta yeniden hesaplanmaz', out.dataset.skew === first);
  preprocess(video, stage, base, out, Date.now() + 1_000_000);
  ok('süre dolunca eğim yenilenir', out.dataset.skew !== first);
  const refreshed = out.dataset.skew;
  invalidateSkew();
  frame = upright;
  preprocess(video, stage, base, out);
  ok('invalidateSkew önbelleği temizler', out.dataset.skew !== refreshed);
  const q = measureRoi(video, stage, base);
  ok('measureRoi kalite döndürür', q && typeof q.glare === 'number' && q.usable);
}
{
  invalidateSkew();
  frame = (w, h) => new Uint8Array(w * h).fill(120);
  preprocess(video, stage, base, out);
  frame = slanted;
  preprocess(video, stage, base, out);
  ok('yazısız kare eğimi önbelleğe almaz', out.dataset.skew !== '0,0');
}
{
  invalidateSkew();
  frame = upright;
  preprocess(video, stage, base, out);
  const one = out.dataset.skew;
  frame = slanted;
  preprocess(video, stage, { ...base, roi: { x: 0.5, y: 0.5, w: 0.3, h: 0.2 } }, out);
  ok('farklı ROI ayrı hesaplanır', out.dataset.skew !== one);
}
{
  const noVideo = { videoWidth: 0, videoHeight: 0, dataset: {} };
  ok('video hazır değil: false', preprocess(noVideo, stage, base, out) === false && measureRoi(noVideo, stage, base) === null);
}

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
