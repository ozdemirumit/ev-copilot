// OCR → SOC veri akışı (canlı test hatası: ham 33/38 değişirken geçerli 39 donuyor, "Eski (doğrulanmadı)", hesaplama "Tahmin").
// Kök neden: çevrim içinde kareler karışınca (38/33/38) çevrim skoru eşiğin altında kalıyor, çevrimler arası kanıt birikmiyordu;
// ayrıca tolerans içi farklı değer tek çevrimle kabul ediliyordu. Gerçek ocr.js + camera.js + socEstimate.js, sahte Tesseract/video ile.
// Kullanım: node scripts/test-ocr-soc-sync.mjs
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, ms = 5000) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await wait(5); return cond(); };

// --- Saf katman: çevrimler arası karar ve filtre teyidi ---
const { consensus, windowConsensus } = await import('../js/sensors/ocrConsensus.js');
const { createSocFilter } = await import('../js/sensors/outlierFilter.js');
{
  const s = (v, c = 70, q = 0.8) => ({ value: v, confidence: c, quality: q });
  const T = 1_000_000;
  const cyc = (t, vals) => { const samples = vals.map((v) => s(v)); return { t, raw: consensus(samples, { tol: 1 }).raw, samples }; };
  ok('hata yeniden üretildi: 38/33/38 çevrimi tek başına doğrulanmıyor', consensus([s(38), s(33), s(38)], { tol: 1 }).value === null);
  ok('pencere: tek çevrim asla yetmez', windowConsensus([cyc(T, [38, 33, 38])], { now: T }).value === null);
  ok('pencere: iki çevrimde çoğunluk 38 → 38', windowConsensus([cyc(T, [38, 33, 38]), cyc(T + 5000, [38, 38, 33])], { now: T + 5000 }).value === 38);
  ok('pencere: 33/38 yarı yarıya → karar yok', windowConsensus([cyc(T, [38, 33, 38]), cyc(T + 5000, [33, 38, 33])], { now: T + 5000 }).value === null);
  ok('pencere: son çevrimle çelişen eski çoğunluk kabul edilmez', windowConsensus([cyc(T, [38, 38, 33]), cyc(T + 5000, [38, 33, 38]), cyc(T + 10000, [33, 33, 38])], { now: T + 10000 }).value === null);
  ok('pencere: 30 sn\'den eski çevrim sayılmaz', windowConsensus([cyc(T, [38, 33, 38]), cyc(T + 40000, [38, 33, 38])], { now: T + 40000 }).value === null);
  ok('pencere: düşük güvenli kareler yetmez', windowConsensus([0, 5000].map((d) => ({ t: T + d, raw: 38, samples: [s(38, 20), s(38, 20), s(33, 20)] })), { now: T + 5000 }).value === null);

  const f = createSocFilter({ chargePctPerMin: 3, maxJump: 2 });
  f.reset(39, T);
  const r1 = f.accept(33, T + 180_000, { score: 0.7, digits: 2 });
  ok('3 dk aradan sonra tek 33 okuması 39\'u değiştirmez', !r1.ok && r1.reason === 'confirming' && f.last === 39, JSON.stringify(r1));
  const r2 = f.accept(33, T + 185_000, { score: 0.7, digits: 2 });
  ok('karışabilir 39→33 iki çevrimle de yetmez (3 ister)', !r2.ok && r2.need === 3 && f.last === 39, JSON.stringify(r2));
  ok('üçüncü tutarlı çevrimde kabul', f.accept(33, T + 190_000, { score: 0.7, digits: 2 }).ok && f.last === 33);
  const g = createSocFilter({ chargePctPerMin: 3, maxJump: 2 });
  g.reset(39, T);
  let changed = false;
  for (let i = 1; i <= 20; i++) changed = g.accept(i % 2 ? 33 : 38, T + i * 5000, { score: 0.7, digits: 2, speedKmh: 0 }).ok || changed;
  ok('dönüşümlü 33/38 tek tek gelince geçerli değer değişmez', !changed && g.last === 39);
  const h = createSocFilter({ chargePctPerMin: 3, maxJump: 2 });
  h.reset(39, T);
  ok('aynı değer referansı hemen tazeler', h.accept(39, T + 5000, { score: 0.5 }).ok);
  ok('39→38: ilk çevrim teyit bekler', h.accept(38, T + 10000, { score: 0.5 }).reason === 'confirming');
  ok('39→38: ikinci çevrimde kabul', h.accept(38, T + 15000, { score: 0.5 }).reason === 'confirmed' && h.last === 38);
}

// --- Uçtan uca: tarayıcı stubları ---
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
const doc = Object.assign(new EventTarget(), { hidden: false, createElement: () => makeCanvas(), body: { classList: { contains: () => false } }, head: { append() {} } });
globalThis.document = doc;

// Kare metni: sıra listesi döner (her recognize çağrısı bir kare)
let seq = ['39'], idx = 0, conf = 60, calls = 0, active = 0, peak = 0;
const makeWorker = () => ({
  setParameters: async () => {},
  terminate: async () => {},
  recognize: async () => {
    calls++; active++; peak = Math.max(peak, active);
    try { await wait(1); return { data: { text: seq[idx++ % seq.length], confidence: conf } }; } finally { active--; }
  },
});
const win = Object.assign(new EventTarget(), { Tesseract: { createWorker: async () => makeWorker(), OEM: { LSTM_ONLY: 1 }, PSM: { SINGLE_LINE: 7 } } });
globalThis.window = win;

const track = Object.assign(new EventTarget(), { readyState: 'live', muted: false, stop() {}, getSettings: () => ({ deviceId: 'b' }), getCapabilities: () => ({}), applyConstraints: async () => {} });
Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: {
  getUserMedia: async () => ({ getTracks: () => [track], getVideoTracks: () => [track] }),
  enumerateDevices: async () => [],
} }, configurable: true });

const { OCR } = await import('../js/config.js');
const { getState, patch, effective } = await import('../js/state.js');
const { startCamera, stopCamera, isCameraLive } = await import('../js/sensors/camera.js');
const { startOcr, stopOcr } = await import('../js/sensors/ocr.js');
const soc = await import('../js/physics/socEstimate.js');

ok('5 sn güncelleme düzeni korunur', OCR.intervalMs === 5000);
// Çevrim başına kare sayısı sabit (3) olmalı: eskiden 100 ms bütçe kare sayısını duvar saatine bağlıyordu (Windows'ta ~15,6 ms
// zamanlayıcı → kare başına ~31 ms → 3/4/5 kare). Sahte kareler küresel sırayla döndüğünden 4 karede faz kayıp her 3. çevrim
// [33,38,38,33] beraberliği (pencere merkezi 33 → stale), 5 karede [38,38,33,38,38] (çevrimden doğrulama) oluşuyor ve test
// rastgele düşüyordu. 3 karede 38/33/38'in her dönüşümü 2/3 → senaryo çalıştırmadan bağımsız. Bütçe kare sayısını kesmesin diye
// 3 karenin süresinin çok üstünde; okunamayan karelerde yöntem denemelerini yine sınırlar.
Object.assign(OCR, { intervalMs: 120, sampleGapMs: 1, samples: 3, maxSamples: 3, cycleBudgetMs: 400, cycleTimeoutMs: 800 });

let ct = 0;
const video = { videoWidth: 1280, videoHeight: 720, dataset: {}, style: {}, srcObject: null, paused: false, play: async () => {}, get currentTime() { ct += 0.04; return ct; } };
const stage = { clientWidth: 320, clientHeight: 200 };
patch('ocr', { roi: { x: 0.05, y: 0.1, w: 0.6, h: 0.2 }, autoSkew: false, useThreshold: true, speedOn: false });
patch('live', { soc: null, speed: null });
soc.initSocEstimate();
await startCamera(video);
await startOcr(video, stage);
const o = () => getState('ocr');

// 1) Başlangıç: 39 doğrulanır
ok('başlangıç: 39 doğrulanır ve canlı', await until(() => o().accepted === 39 && o().status === 'ok') && soc.socSource() === 'live', JSON.stringify(o().trace?.[0]));

// 2) Kareler 38/33/38 karışık (gerçek 38): ham değer SOC'a doğrudan geçmez ama birkaç çevrimde 38 doğrulanır ve hesaplamaya canlı akar
{
  seq = ['38', '33', '38'];
  idx = 0;
  const t0 = Date.now();
  await until(() => o().trace?.[0]?.kind === 'soc' && o().trace[0].at > t0 && o().trace[0].frames.includes(33));
  const firstMixed = o().trace[0];
  ok('ilk karışık çevrim geçerli değeri değiştirmez', o().accepted === 39 && effective().soc === 39, JSON.stringify(firstMixed));
  ok('karışık çevrim tek başına doğrulanmaz (çevrim skoru düşük)', firstMixed.cycle.value === null, JSON.stringify(firstMixed));
  const got = await until(() => o().accepted === 38, 8000);
  ok('çevrimler arası kanıtla 38 doğrulanır (hata giderildi)', got && getState('live').soc === 38 && effective().soc === 38, JSON.stringify(o().trace?.slice(0, 4)));
  ok('38 çevrimler arası yoldan ve teyitle geldi', o().trace.some((e) => e.via === 'window' && e.result === 'confirmed'), JSON.stringify(o().trace?.slice(0, 4)));
  ok('kaynak canlı (tahmin değil), kilitli', soc.socSource() === 'live' && soc.isOnline());
  const r0 = o().readAt;
  await wait(800);
  ok('aynı karışık okuma sürdükçe geçerli değer tazelenir (readAt ilerler, stale değil)', o().readAt > r0 && o().stale === false && o().status === 'ok', JSON.stringify(o().trace?.[0]));
  const sizes = o().trace.filter((e) => e.kind === 'soc' && e.at > t0).map((e) => e.frames.length);
  ok('karışık çevrimler sabit 3 kare (kare sayısı zamanlayıcıya bağlı değil)', sizes.length > 0 && sizes.every((n) => n === 3), JSON.stringify(sizes));
}

// 3) Tek farklı çevrim (tüm kareler 33): geçerli değer değişmez
{
  seq = ['33'];
  idx = 0;
  const t0 = Date.now();
  await until(() => o().trace?.[0]?.at > t0 && o().trace[0].candidate === 33);
  ok('tek farklı çevrim (33) geçerli 38\'i değiştirmez', o().accepted === 38 && getState('live').soc === 38 && o().status !== 'ok' && o().stale === true, JSON.stringify(o().trace?.[0]));
  seq = ['38'];
  idx = 0;
  await until(() => o().status === 'ok');
  ok('38 geri gelince geçerli ve taze', o().accepted === 38 && o().stale === false);
}

// 4) Gerçekten belirsiz (33/38 eşit): değer değişmez, eski olduğu açıkça işaretlenir
{
  seq = ['33', '38'];
  idx = 0;
  const t0 = Date.now();
  await until(() => o().trace?.[0]?.at > t0 && o().trace[0].frames.includes(33));
  await wait(1500);
  const changes = o().trace.filter((e) => e.at > t0 && e.accepted !== 38);
  ok('33/38 eşit dağılımda geçerli değer 38 kalır', o().accepted === 38 && changes.length === 0, JSON.stringify(o().trace.slice(0, 3)));
  ok('belirsizlik eski olarak işaretlenir', o().stale === true && o().status !== 'ok', JSON.stringify({ status: o().status, stale: o().stale }));
  ok('tanılama izi kareleri ve kararı içerir', Array.isArray(o().trace[0].frames) && 'result' in o().trace[0] && 'accepted' in o().trace[0]);
  seq = ['38'];
  idx = 0;
  await until(() => o().status === 'ok');
}

// 5) Arka plan / ön plan (visibilitychange, pageshow, focus)
{
  doc.hidden = true;
  doc.dispatchEvent(new Event('visibilitychange'));
  ok('arka plana geçince OCR duraklar ve eski işaretlenir', o().status === 'paused' && o().stale === true && o().trace[0].result === 'paused');
  await wait(100);
  const c0 = calls;
  await wait(200);
  ok('arka planda tanıma çağrısı yapılmaz', calls === c0, String(calls - c0));
  // iOS: arka planda iz susturuldu, dönüşte unmute olayı gelmedi
  track.muted = true;
  track.dispatchEvent(new Event('mute'));
  track.muted = false;
  ok('arka planda mute: kamera canlı sayılmaz', !isCameraLive());
  seq = ['38'];
  doc.hidden = false;
  doc.dispatchEvent(new Event('visibilitychange'));
  win.dispatchEvent(new Event('pageshow'));
  win.dispatchEvent(new Event('focus'));
  ok('dönüşte kaçırılan unmute senkronlanır', isCameraLive());
  ok('dönüş izlenir', o().trace.some((e) => e.result === 'resumed' && e.event === 'visibilitychange'), JSON.stringify(o().trace.slice(0, 2)));
  peak = 0;
  ok('dönüşte OCR kendiliğinden sürer, 38 yeniden doğrulanır', await until(() => o().status === 'ok' && o().stale === false, 2000), JSON.stringify(o().trace.slice(0, 3)));
  await wait(200);
  ok('pageshow/focus döngüyü ikinci kez başlatmaz (aynı anda tek tanıma)', peak === 1, String(peak));
}

// 6) Arka planda dönüşte tek hatalı okuma değeri değiştirmez (zaman toleransı büyümüş olsa da)
{
  doc.hidden = true;
  doc.dispatchEvent(new Event('visibilitychange'));
  await wait(50);
  seq = ['30'];
  idx = 0;
  doc.hidden = false;
  win.dispatchEvent(new Event('pageshow'));
  doc.dispatchEvent(new Event('visibilitychange'));
  const t0 = Date.now();
  await until(() => o().trace?.[0]?.kind === 'soc' && o().trace[0].at > t0);
  ok('dönüşteki ilk farklı okuma (30) geçerli değeri değiştirmez', o().accepted === 38 && getState('live').soc === 38, JSON.stringify(o().trace[0]));
  seq = ['38'];
  idx = 0;
  await until(() => o().status === 'ok');
}

// 7) Kamera açık ama okunamıyor: önce "eski", sonra güvenli tahmin (son doğrulanan değerden), değer %80'e dönmez
{
  const realNow = Date.now;
  seq = [''];
  await until(() => o().status === 'unreadable');
  let shift = 50_000;
  Date.now = () => realNow() + shift;
  ok('45 sn sonra kaynak "eski" ve yaşı biliniyor', soc.socSource() === 'stale' && soc.ocrAgeMs() >= 45_000);
  stopOcr();
  shift = 70_000;
  patch('system', { ocr: true }); // OCR açık görünür (kamera okuyamıyor)
  Date.now = realNow;
  ok('stale değer aynen korunur', effective().soc === 38);
  Date.now = () => realNow() + 70_000;
  // socEstimate'in 5 sn'lik denetimi gerçek zamanlayıcıda; doğrudan beklemek yerine süreyi ilerletip bir tur bekle
  await new Promise((r) => setTimeout(r, 5100));
  ok('60 sn sonra güvenli tahmine geçer (son doğrulanan değerden)', soc.socSource() === 'estimate' && effective().soc === 38, soc.socSource());
  Date.now = realNow;
  patch('system', { ocr: false });
}

stopCamera(video);
console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
