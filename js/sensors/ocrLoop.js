// OCR zamanlayıcısı (DOM'suz, saf; node ile test edilir). Aynı anda en fazla bir çevrim çalışır; durdur/başlat yarışında eski çevrim
// bitmeden yenisi başlamaz ve eski çevrimin sonucu yazılmaz. Takılan çevrim zaman aşımıyla düşürülür, döngü sürer.

/**
 * runCycle(isCurrent): isCurrent() false dönerse çevrim sonuç yazmamalıdır.
 * onCycle(startedAt, durationMs, timedOut, { session }): isteğe bağlı tanılama (RM-05 ritim); yalnız geçerli oturumun biten
 * çevrimleri için çağrılır, hatası döngüyü etkilemez. Zamanlamayı ve çevrim sonucunu değiştirmez.
 */
export function createOcrLoop({
  runCycle, intervalMs = 5000, minGapMs = 50, cycleTimeoutMs = 12000,
  onError = () => {}, onTimeout = () => {}, onCycle = null,
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
    if (timedOut) { cycleId++; onTimeout({ current: running && mySession === session }); }
    if (onCycle && running && mySession === session) {
      try { onCycle(t0, now() - t0, timedOut, { session: mySession }); } catch { /* tanılama döngüyü kırmaz */ }
    }
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

/** RM-05 ritim tanılaması: son `capacity` (varsayılan 120) çevrimin halka tamponu; snapshot() dondurulmuş kopyalar döner. */
export function createCadenceLog(capacity = 120) {
  const cap = Math.max(1, Math.floor(capacity) || 120);
  const buf = [];
  return {
    push({ startedAt, durationMs, timedOut = false, session = null } = {}) {
      buf.push(Object.freeze({ startedAt, durationMs, timedOut: !!timedOut, session }));
      if (buf.length > cap) buf.splice(0, buf.length - cap);
    },
    snapshot() { return buf.slice(); },
    get size() { return buf.length; },
  };
}

/**
 * Saf ritim özeti: ardışık çevrim başlangıçları arasındaki aralıkların medyanı, p95 (en yakın sıra), en büyüğü ve
 * hedef±tolerans (varsayılan 5±1 sn) içindeki oranı. Farklı oturumlar (durdur/başlat, arka plan) arası boşluk aralık sayılmaz.
 */
export function cadenceStats(entries, { targetMs = 5000, toleranceMs = 1000 } = {}) {
  const list = (Array.isArray(entries) ? entries : []).filter((e) => e && Number.isFinite(e.startedAt));
  const intervals = [];
  for (let i = 1; i < list.length; i++) {
    if ((list[i].session ?? null) !== (list[i - 1].session ?? null)) continue;
    const d = list[i].startedAt - list[i - 1].startedAt;
    if (d >= 0) intervals.push(d);
  }
  const sorted = intervals.slice().sort((a, b) => a - b);
  const n = sorted.length;
  const median = n ? (n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2) : null;
  const within = intervals.filter((d) => Math.abs(d - targetMs) <= toleranceMs).length;
  return {
    cycles: list.length,
    intervals: n,
    medianMs: median,
    p95Ms: n ? sorted[Math.min(n - 1, Math.ceil(0.95 * n) - 1)] : null,
    maxMs: n ? sorted[n - 1] : null,
    within5s1Ratio: n ? within / n : null,
    timeouts: list.filter((e) => e.timedOut).length,
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
