// Gerçek ocr.js + preprocess + filtre uçtan uca (sahte Tesseract/tuval/video): çok kareli kabul, 73→13, stale, sabit aralık, paralel döngü, zaman aşımı.
// Kullanım: node scripts/test-ocr-cycle.mjs
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const frameData = (w, h) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = x % 12 < 4 && y > h * 0.2 && y < h * 0.8 ? 240 : 25;
    const i = (y * w + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  return d;
};
const makeCanvas = () => {
  const c = { width: 0, height: 0, dataset: {} };
  const ctx = { fillStyle: '', fillRect() {}, drawImage() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, translate() {}, rotate() {}, transform() {}, putImageData() {}, getImageData: (x, y, w, h) => ({ data: frameData(w, h) }) };
  c.getContext = () => ctx;
  return c;
};
globalThis.document = { createElement: () => makeCanvas(), body: { classList: { contains: () => false } }, head: { append() {} } };

let socText = '73', spdText = '88', conf = 85, active = 0, peak = 0, calls = 0, hang = false, created = 0, terminated = 0, delay = 0;
const makeWorker = () => ({
  setParameters: async () => {},
  terminate: async () => { terminated++; },
  recognize: async (canvas) => {
    calls++; active++; peak = Math.max(peak, active);
    try {
      if (hang) await new Promise(() => {});
      if (delay) await wait(delay);
      const text = canvas.width > 200 ? socText : spdText;
      return { data: { text, confidence: conf } };
    } finally { active--; }
  },
});
globalThis.window = { Tesseract: { createWorker: async () => { created++; return makeWorker(); }, OEM: { LSTM_ONLY: 1 }, PSM: { SINGLE_LINE: 7 } } };

const track = Object.assign(new EventTarget(), { readyState: 'live', muted: false, stop() {}, getSettings: () => ({ deviceId: 'b' }), getCapabilities: () => ({}), applyConstraints: async () => {} });
Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: {
  getUserMedia: async () => ({ getTracks: () => [track], getVideoTracks: () => [track] }),
  enumerateDevices: async () => [],
} }, configurable: true });

const { OCR } = await import('../js/config.js');
const { getState, patch } = await import('../js/state.js');
const { startCamera, stopCamera } = await import('../js/sensors/camera.js');
const { startOcr, stopOcr } = await import('../js/sensors/ocr.js');

ok('15 sn seyrek okuma ayarı kaldırıldı', OCR.intervalMs === 5000 && OCR.idleIntervalMs === undefined);
Object.assign(OCR, { intervalMs: 60, sampleGapMs: 1, cycleBudgetMs: 40, cycleTimeoutMs: 400 });

let frozen = false, ct = 0;
const video = { videoWidth: 1280, videoHeight: 720, dataset: {}, style: {}, srcObject: null, paused: false, play: async () => {}, get currentTime() { if (!frozen) ct += 0.04; return ct; } };
const stage = { clientWidth: 320, clientHeight: 200 };
patch('ocr', { roi: { x: 0.05, y: 0.1, w: 0.6, h: 0.2 }, roiSpeed: { x: 0.7, y: 0.1, w: 0.15, h: 0.2 }, autoSkew: false, useThreshold: true, speedOn: true });
patch('live', { soc: null, speed: null });
await startCamera(video);

const o = () => getState('ocr');
await startOcr(video, stage);
await wait(25);
ok('tek çevrimde ilk okuma kabul edilmez', o().accepted == null && getState('live').soc == null, JSON.stringify(o()));
await wait(180);
ok('sonraki çevrimlerde tutarlı değer kabul', o().accepted === 73 && getState('live').soc === 73 && o().status === 'ok', JSON.stringify(o()));
ok('taze: stale false, güvenilirlik > 0, okuma zamanı var', o().stale === false && o().reliability > 0 && o().readAt > 0, JSON.stringify(o()));
ok('hız da doğrulanır', getState('live').speedScr === 88 && o().speedStatus === 'ok' && o().speedStale === false && o().speedAt > 0);
ok('çok kare örneklenir', calls >= 6, String(calls));

// Yanlış sıçrama
socText = '13';
// O an sürmekte olan çevrim henüz 73 kareleriyle başarıyla bitebilir (readAt meşru olarak değişir): referans, ilk başarısız çevrimden sonra alınır.
for (let i = 0; i < 200 && o().status === 'ok'; i++) await wait(2);
const readAt = o().readAt;
await wait(200);
ok('73→13 reddedilir, değer korunur', o().accepted === 73 && getState('live').soc === 73 && o().status === 'rejected', JSON.stringify(o()));
ok('reddedilince stale gösterilir, okuma zamanı değişmez', o().stale === true && o().readAt === readAt);

// Okunamama
socText = ''; spdText = '';
await wait(150);
ok('okunamayınca son doğrulanmış değer + stale', o().accepted === 73 && o().status === 'unreadable' && o().stale === true && getState('live').speedScr === 88 && o().speedStale === true, JSON.stringify(o()));

// Düşük güvenli çoğunluk
socText = '73'; spdText = '88'; conf = 10;
await wait(150);
ok('düşük güvenli okuma doğrulanmaz', o().status === 'unreadable' && o().stale === true, JSON.stringify(o()));

// Toparlanma
conf = 85;
await wait(200);
ok('doğru değer gelince toparlanır', o().status === 'ok' && o().stale === false && o().accepted === 73, JSON.stringify(o()));

// Değer sabitken aralık seyrekleşmez
{
  const c0 = calls;
  await wait(600);
  const perCycle = 6; // 3 kare × 2 ROI
  const cycles = (calls - c0) / perCycle;
  ok('sabit değerde çevrim sıklığı düşmez (seyrek moda geçmez)', cycles >= 6, String(cycles));
}

// Donmuş kare
{
  frozen = true;
  await wait(120);
  const c0 = calls;
  await wait(150);
  ok('donmuş görüntüde OCR çalışmaz', calls === c0, `${calls - c0}`);
  ok('donmuş görüntü stale', o().stale === true && o().status === 'unreadable', JSON.stringify(o()));
  frozen = false;
  await wait(150);
  ok('görüntü dönünce devam', o().stale === false, JSON.stringify(o()));
}

// Mute
{
  track.muted = true;
  track.dispatchEvent(new Event('mute'));
  await wait(120);
  const c0 = calls;
  await wait(150);
  ok('mute: OCR çalışmaz ve stale', calls === c0 && o().stale === true, JSON.stringify(o()));
  track.muted = false;
  track.dispatchEvent(new Event('unmute'));
  await wait(150);
  ok('unmute: devam', o().stale === false, JSON.stringify(o()));
}

// Durdur/başlat yarışı: paralel recognize olmaz
{
  peak = 0; delay = 8;
  for (let i = 0; i < 6; i++) { stopOcr(); await startOcr(video, stage); await wait(4); }
  await wait(250);
  ok('hızlı durdur/başlat: aynı anda tek recognize', peak === 1, String(peak));
  delay = 0;
}

// Takılan işçi
{
  const before = created;
  hang = true;
  await wait(600);
  ok('takılan işçi sonlandırılır', terminated >= 1, String(terminated));
  ok('takılma stale olarak görünür', o().stale === true, JSON.stringify(o()));
  hang = false;
  await wait(600);
  ok('yeni işçi kurulur ve okuma sürer', created > before && o().status === 'ok' && o().stale === false, JSON.stringify(o()));
}

stopOcr();
ok('durdurunca idle + stale', o().status === 'idle' && o().stale === true);
const c0 = calls;
await wait(150);
ok('durdurunca çağrı yok', calls === c0);
stopCamera(video);

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
