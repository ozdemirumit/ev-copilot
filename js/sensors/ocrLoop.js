// OCR zamanlayıcısı (DOM'suz, saf; node ile test edilir). Aynı anda en fazla bir çevrim çalışır; durdur/başlat yarışında eski çevrim
// bitmeden yenisi başlamaz ve eski çevrimin sonucu yazılmaz. Takılan çevrim zaman aşımıyla düşürülür, döngü sürer.

/** runCycle(isCurrent): isCurrent() false dönerse çevrim sonuç yazmamalıdır. */
export function createOcrLoop({
  runCycle, intervalMs = 5000, minGapMs = 50, cycleTimeoutMs = 12000,
  onError = () => {}, onTimeout = () => {},
  now = Date.now, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
}) {
  let running = false;
  let session = 0;
  let cycleId = 0;
  let timer = null;
  let inFlight = Promise.resolve();

  async function runOne(mySession) {
    const t0 = now();
    const id = ++cycleId;
    const isCurrent = () => running && mySession === session && id === cycleId;
    let timedOut = false;
    let watchdog = null;
    const work = Promise.resolve().then(() => runCycle(isCurrent)).catch((err) => { if (isCurrent()) onError(err); });
    const guard = new Promise((resolve) => { watchdog = setTimer(() => { timedOut = true; resolve(); }, cycleTimeoutMs); });
    const done = Promise.race([work, guard]).then(() => clearTimer(watchdog));
    inFlight = done;
    await done;
    if (timedOut) { cycleId++; onTimeout(); }
    if (running && mySession === session) timer = setTimer(() => runOne(mySession), Math.max(minGapMs, intervalMs - (now() - t0)));
  }

  return {
    start() {
      if (running) return;
      running = true;
      const my = ++session;
      inFlight.then(() => { if (running && my === session) runOne(my); });
    },
    stop() {
      running = false;
      session++;
      clearTimer(timer);
      timer = null;
    },
    get running() { return running; },
  };
}

/** Bir çevrimde kısa aralıklarla kare okur: en az minFrames, kararsızsa en çok maxFrames; bütçe dolunca yeni kare alınmaz. */
export async function collectSamples({
  minFrames, maxFrames, gapMs, budgetMs, readFrame, enough, isCurrent,
  now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const t0 = now();
  let frames = 0;
  while (frames < maxFrames && isCurrent()) {
    await readFrame(frames);
    frames++;
    if (!isCurrent() || (frames >= minFrames && enough())) break;
    if (frames >= maxFrames || now() - t0 >= budgetMs) break;
    await sleep(gapMs);
    if (now() - t0 >= budgetMs) break;
  }
  return { frames };
}
