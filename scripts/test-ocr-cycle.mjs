// Gerçek ocr.js + preprocess + filtre uçtan uca (sahte Tesseract/tuval/video): çok kareli kabul, 73→13, stale, sabit aralık, paralel döngü, zaman aşımı.
// Kullanım: node scripts/test-ocr-cycle.mjs
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Sabit gerçek-zaman uykuları CPU yükünde kırılgandı (14/9, 19/4): bekleyişler çevrim sayısına/koşula bağlı ve süre sınırlıdır.
// Koşul hiç gerçekleşmezse sınır dolar ve ardından gelen doğrulama gerçek hata olarak FAIL verir.
const MAX_WAIT_MS = 5000;

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
const { getState, patch, subscribe } = await import('../js/state.js');
const { startCamera, stopCamera } = await import('../js/sensors/camera.js');
const { startOcr, stopOcr } = await import('../js/sensors/ocr.js');

// Çevrim sayaçları (salt gözlem): her pil kararı ocr.trace'e 'soc' girdisi yazar; kare gelmeyen çevrim (donmuş/mute) tek bir
// 'Kameradan yeni görüntü gelmiyor' yaması yapar. Bekleyişler duvar saati yerine bu sayaçlarla ölçülür.
const NO_FRAME_NOTE = 'Kameradan yeni görüntü gelmiyor';
let decisions = 0, noFrameTicks = 0, lastTrace = null, firstDecision = null;
subscribe('ocr', (s) => {
  const top = s.trace?.[0];
  if (top && top !== lastTrace) {
    lastTrace = top;
    if (top.kind === 'soc') {
      decisions++;
      if (decisions === 1) firstDecision = { accepted: s.accepted, liveSoc: getState('live').soc, status: s.status };
    }
  } else if (s.note === NO_FRAME_NOTE && s.status === 'unreadable' && s.reliability === 0) noFrameTicks++;
});
/** cond() doğru olana dek (ya da `cycles` yeni pil kararı / `ms` süre dolana dek) yoklar; sonuç cond() değeridir. */
async function until(cond, { cycles = Infinity, ms = MAX_WAIT_MS } = {}) {
  const t0 = Date.now(), d0 = decisions;
  while (!cond() && decisions - d0 < cycles && Date.now() - t0 < ms) await wait(2);
  return cond();
}
/** En az n yeni pil kararı (tam çevrim) bekle: eski sabit uykuların ölçtüğü “birkaç çevrim sonra” penceresi. */
const cyclesPass = (n) => { const d0 = decisions; return until(() => decisions - d0 >= n); };
/** En az n yeni kare-gelmeyen çevrim bekle (donmuş/mute). */
const noFrameCyclesPass = (n) => { const t0 = noFrameTicks; return until(() => noFrameTicks - t0 >= n); };

ok('15 sn seyrek okuma ayarı kaldırıldı', OCR.intervalMs === 5000 && OCR.idleIntervalMs === undefined);
Object.assign(OCR, { intervalMs: 60, sampleGapMs: 1, cycleBudgetMs: 40, cycleTimeoutMs: 400 });

let frozen = false, ct = 0;
const video = { videoWidth: 1280, videoHeight: 720, dataset: {}, style: {}, srcObject: null, paused: false, play: async () => {}, get currentTime() { if (!frozen) ct += 0.04; return ct; } };
const stage = { clientWidth: 320, clientHeight: 200 };
patch('ocr', { roi: { x: 0.05, y: 0.1, w: 0.6, h: 0.2 }, roiSpeed: { x: 0.7, y: 0.1, w: 0.15, h: 0.2 }, autoSkew: false, useThreshold: true, speedOn: true });
patch('live', { soc: null, speed: null });
await startCamera(video);

const o = () => getState('ocr');
try {
await startOcr(video, stage);
// İlk çevrimin kararı yazıldığı anda alınan anlık görüntü denetlenir (sonraki çevrimler bu arada kabul etmiş olabilir).
await until(() => firstDecision != null);
ok('tek çevrimde ilk okuma kabul edilmez', firstDecision != null && firstDecision.accepted == null && firstDecision.liveSoc == null, JSON.stringify(firstDecision));
await until(() => o().accepted === 73 && o().status === 'ok' && o().speedStatus === 'ok', { cycles: 8 });
ok('sonraki çevrimlerde tutarlı değer kabul', o().accepted === 73 && getState('live').soc === 73 && o().status === 'ok', JSON.stringify(o()));
ok('taze: stale false, güvenilirlik > 0, okuma zamanı var', o().stale === false && o().reliability > 0 && o().readAt > 0, JSON.stringify(o()));
ok('hız da doğrulanır', getState('live').speedScr === 88 && o().speedStatus === 'ok' && o().speedStale === false && o().speedAt > 0);
ok('çok kare örneklenir', calls >= 6, String(calls));

// Yanlış sıçrama
socText = '13';
// O an sürmekte olan çevrim henüz 73 kareleriyle başarıyla bitebilir (readAt meşru olarak değişir): referans, ilk başarısız çevrimden sonra alınır.
await until(() => o().status !== 'ok');
const readAt = o().readAt;
await cyclesPass(3); // eski 200 ms ≈ 3 çevrim: bu çevrimler boyunca 13 kabul edilmemeli
ok('73→13 reddedilir, değer korunur', o().accepted === 73 && getState('live').soc === 73 && o().status === 'rejected', JSON.stringify(o()));
ok('reddedilince stale gösterilir, okuma zamanı değişmez', o().stale === true && o().readAt === readAt);

// Okunamama
socText = ''; spdText = '';
await cyclesPass(2); // ilk karar karışık kareli olabilir; ikincisi tamamen okunamaz karelerle
ok('okunamayınca son doğrulanmış değer + stale', o().accepted === 73 && o().status === 'unreadable' && o().stale === true && getState('live').speedScr === 88 && o().speedStale === true, JSON.stringify(o()));

// Düşük güvenli çoğunluk
socText = '73'; spdText = '88'; conf = 10;
await cyclesPass(2);
ok('düşük güvenli okuma doğrulanmaz', o().status === 'unreadable' && o().stale === true, JSON.stringify(o()));

// Toparlanma
conf = 85;
await until(() => o().status === 'ok' && o().stale === false, { cycles: 8 });
ok('doğru değer gelince toparlanır', o().status === 'ok' && o().stale === false && o().accepted === 73, JSON.stringify(o()));

// Değer sabitken aralık seyrekleşmez
{
  // Eski: 600 ms'de ≥6 çevrim (yükte kırılgan). Şimdi: 6 çevrim, aralığın (60 ms) ~10 katı süre içinde; seyrek mod saniyeler sürerdi.
  const c0 = calls, t0 = Date.now();
  const perCycle = 6; // 3 kare × 2 ROI
  await until(() => (calls - c0) / perCycle >= 6, { ms: 3600 });
  const cycles = (calls - c0) / perCycle;
  ok('sabit değerde çevrim sıklığı düşmez (seyrek moda geçmez)', cycles >= 6, `${cycles} çevrim / ${Date.now() - t0} ms`);
}

// Donmuş kare
{
  frozen = true;
  await noFrameCyclesPass(1); // sürmekte olan çevrim bitti; kare gelmediği görüldü
  const c0 = calls;
  await noFrameCyclesPass(2); // donmuşken en az iki tam çevrim daha
  ok('donmuş görüntüde OCR çalışmaz', calls === c0, `${calls - c0}`);
  ok('donmuş görüntü stale', o().stale === true && o().status === 'unreadable', JSON.stringify(o()));
  frozen = false;
  await until(() => o().stale === false, { cycles: 6 });
  ok('görüntü dönünce devam', o().stale === false, JSON.stringify(o()));
}

// Mute
{
  track.muted = true;
  track.dispatchEvent(new Event('mute'));
  await noFrameCyclesPass(1);
  const c0 = calls;
  await noFrameCyclesPass(2);
  ok('mute: OCR çalışmaz ve stale', calls === c0 && o().stale === true, JSON.stringify(o()));
  track.muted = false;
  track.dispatchEvent(new Event('unmute'));
  await until(() => o().stale === false, { cycles: 6 });
  ok('unmute: devam', o().stale === false, JSON.stringify(o()));
}

// Durdur/başlat yarışı: paralel recognize olmaz
{
  peak = 0; delay = 8;
  // 4 ms'lik aralar sonuç beklemesi değil, yarışı tetikleyen uyarandır: her gerçek süre geçerli bir yarış üretir.
  for (let i = 0; i < 6; i++) { stopOcr(); await startOcr(video, stage); await wait(4); }
  await cyclesPass(3);
  ok('hızlı durdur/başlat: aynı anda tek recognize', peak === 1, String(peak));
  delay = 0;
}

// Takılan işçi
{
  const before = created, term0 = terminated;
  hang = true;
  await until(() => terminated > term0); // zaman aşımı (400 ms) işçiyi düşürene dek
  ok('takılan işçi sonlandırılır', terminated >= 1, String(terminated));
  ok('takılma stale olarak görünür', o().stale === true, JSON.stringify(o()));
  hang = false;
  await until(() => created > before && o().status === 'ok' && o().stale === false);
  ok('yeni işçi kurulur ve okuma sürer', created > before && o().status === 'ok' && o().stale === false, JSON.stringify(o()));
}

stopOcr();
ok('durdurunca idle + stale', o().status === 'idle' && o().stale === true);
const c0 = calls;
// Yokluk denetimi koşulla beklenemez: sabit pencere (≈5 aralık). Yük altında yalnızca gevşer, yanlış FAIL üretmez.
await wait(300);
ok('durdurunca çağrı yok', calls === c0);
} catch (err) {
  fail++; console.log('FAIL beklenmeyen istisna', String(err?.stack || err));
} finally {
  // Sağlam temizlik: ara adımda istisna olsa da döngü/kamera durur, takılı işçi bırakılır, süreç asılı kalmaz.
  hang = false; frozen = false; track.muted = false; delay = 0;
  try { stopOcr(); } catch (err) { fail++; console.log('FAIL temizlik stopOcr', String(err)); }
  try { stopCamera(video); } catch (err) { fail++; console.log('FAIL temizlik stopCamera', String(err)); }
}

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
