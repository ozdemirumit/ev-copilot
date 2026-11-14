// OCR döngüsü (ocrLoop.js): sabit 5 sn, tek çalışan döngü, durdur/başlat yarışları, zaman aşımı, kare örnekleme.
// Kullanım: node scripts/test-ocr-loop.mjs
import { createOcrLoop, collectSamples, createCadenceLog, cadenceStats } from '../js/sensors/ocrLoop.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name); };

// Elle ilerletilen saat
function fakeClock() {
  let t = 0, id = 0;
  const q = new Map();
  const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
  return {
    now: () => t,
    setTimer: (fn, ms) => { q.set(++id, { fn, at: t + ms }); return id; },
    clearTimer: (i) => q.delete(i),
    pending: () => q.size,
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        await flush();
        const due = [...q.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        q.delete(due[0]);
        t = due[1].at;
        due[1].fn();
      }
      t = end;
      await flush();
    },
  };
}
const deferred = () => { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };
const timers = (c) => ({ now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });

{
  const c = fakeClock();
  const starts = [];
  const loop = createOcrLoop({ intervalMs: 5000, ...timers(c), runCycle: async () => { starts.push(c.now()); } });
  loop.start();
  await c.advance(60000);
  loop.stop();
  const gaps = starts.slice(1).map((v, i) => v - starts[i]);
  ok('60 sn boyunca 5 sn aralık sabit (15 sn yok)', starts.length === 13 && gaps.every((g) => g === 5000));
  await c.advance(30000);
  ok('stop sonrası çevrim yok', starts.length === 13 && c.pending() === 0);
}
{
  const c = fakeClock();
  const starts = [];
  let d = null;
  const loop = createOcrLoop({ intervalMs: 5000, ...timers(c), runCycle: async () => { starts.push(c.now()); d = deferred(); await d.p; } });
  loop.start();
  await c.advance(3000);
  d.resolve();
  await c.advance(1999);
  ok('çevrim süresi aralıktan düşülür', starts.length === 1);
  await c.advance(1);
  ok('çevrim başlangıçları 5 sn', starts.length === 2 && starts[1] === 5000);
  loop.stop();
  d.resolve();
}
{
  const c = fakeClock();
  let active = 0, peak = 0, count = 0;
  const gates = [];
  const loop = createOcrLoop({ intervalMs: 5000, cycleTimeoutMs: 60000, ...timers(c), runCycle: async () => { active++; count++; peak = Math.max(peak, active); const g = deferred(); gates.push(g); await g.p; active--; } });
  loop.start();
  await c.advance(100);
  loop.stop();
  loop.start();
  loop.stop();
  loop.start();
  await c.advance(100);
  ok('devam eden çevrim bitmeden yeni çevrim başlamaz', count === 1 && peak === 1);
  gates[0].resolve();
  await c.advance(100);
  ok('eski çevrim bitince tek yeni döngü başlar', count === 2 && peak === 1);
  gates[1].resolve();
  await c.advance(5000);
  ok('döngü tektir (çift zamanlayıcı yok)', count === 3 && peak === 1);
  loop.stop();
  gates.forEach((g) => g.resolve());
}
{
  const c = fakeClock();
  let sawCurrent = null;
  let d;
  const loop = createOcrLoop({ intervalMs: 5000, ...timers(c), runCycle: async (isCurrent) => { d = deferred(); await d.p; sawCurrent = isCurrent(); } });
  loop.start();
  await c.advance(10);
  loop.stop();
  d.resolve();
  await c.advance(10);
  ok('durdurulan çevrim sonucunu yazmaz (isCurrent false)', sawCurrent === false);
}
{
  const c = fakeClock();
  let n = 0, timeouts = 0, firstCurrent;
  const loop = createOcrLoop({ intervalMs: 5000, cycleTimeoutMs: 12000, ...timers(c), onTimeout: () => timeouts++, runCycle: async (isCurrent) => { n++; if (n === 1) { firstCurrent = isCurrent; await new Promise(() => {}); } } });
  loop.start();
  await c.advance(12000);
  ok('takılan çevrim zaman aşımına uğrar', timeouts === 1 && firstCurrent() === false);
  await c.advance(1000);
  ok('zaman aşımından sonra döngü sürer', n === 2);
  loop.stop();
}
{
  const c = fakeClock();
  let n = 0;
  const errs = [];
  const loop = createOcrLoop({ intervalMs: 5000, ...timers(c), onError: (e) => errs.push(e.message), runCycle: async () => { n++; throw new Error('x'); } });
  loop.start();
  await c.advance(10000);
  loop.stop();
  ok('hata döngüyü kırmaz', n === 3 && errs.length === 3);
}
{
  const c = fakeClock();
  let n = 0;
  const loop = createOcrLoop({ intervalMs: 5000, ...timers(c), runCycle: async () => { n++; } });
  loop.start(); loop.start(); loop.start();
  await c.advance(1);
  ok('üst üste start tek döngü', n === 1 && loop.running);
  loop.stop();
  ok('stop running=false', !loop.running);
}

// --- Kare örnekleme ---
const opts = (c, extra) => ({ now: c.now, sleep: (ms) => new Promise((r) => c.setTimer(r, ms)), isCurrent: () => true, ...extra });
{
  const c = fakeClock();
  const at = [];
  const p = collectSamples(opts(c, { minFrames: 3, maxFrames: 5, gapMs: 300, budgetMs: 3800, readFrame: async () => { at.push(c.now()); }, enough: () => true }));
  await c.advance(5000);
  const r = await p;
  ok('en az 3 kare, kısa aralıkla', at.join() === '0,300,600' && r.frames === 3);
}
{
  const c = fakeClock();
  let n = 0;
  const p = collectSamples(opts(c, { minFrames: 3, maxFrames: 5, gapMs: 300, budgetMs: 3800, readFrame: async () => { n++; }, enough: () => false }));
  await c.advance(5000);
  await p;
  ok('tutarsızsa en çok 5 kare', n === 5);
}
{
  const c = fakeClock();
  let n = 0;
  const p = collectSamples(opts(c, { minFrames: 3, maxFrames: 9, gapMs: 300, budgetMs: 1000, readFrame: async () => { n++; await new Promise((r) => c.setTimer(r, 600)); }, enough: () => false }));
  await c.advance(6000);
  const r = await p;
  ok('bütçe aşılınca yeni kare alınmaz', n === 2 && r.frames === 2);
}
{
  const c = fakeClock();
  let n = 0, cur = true;
  const p = collectSamples(opts(c, { isCurrent: () => cur, minFrames: 3, maxFrames: 5, gapMs: 300, budgetMs: 3800, readFrame: async () => { n++; cur = false; }, enough: () => false }));
  await c.advance(5000);
  await p;
  ok('iptal edilen çevrim kare almayı bırakır', n === 1);
}

// --- RM-05 çevrim ritmi tanılaması: onCycle, halka tampon, cadenceStats ---
{
  const c = fakeClock();
  const rec = [];
  const loop = createOcrLoop({ intervalMs: 5000, ...timers(c), onCycle: (...a) => rec.push(a),
    runCycle: async () => { await new Promise((r) => c.setTimer(r, 1200)); } });
  loop.start();
  await c.advance(15000);
  loop.stop();
  ok('onCycle her çevrimde (başlangıç, süre, zaman aşımı yok) çağrılır',
    rec.length === 3 && rec.map((a) => a[0]).join() === '0,5000,10000' && rec.every((a) => a[1] === 1200 && a[2] === false));
  ok('onCycle 4. bağımsız değişkende oturum verir', rec.every((a) => a[3] && a[3].session === rec[0][3].session));
}
{
  const c = fakeClock();
  const rec = [];
  let n = 0;
  const loop = createOcrLoop({ intervalMs: 5000, cycleTimeoutMs: 12000, ...timers(c), onCycle: (...a) => rec.push(a),
    runCycle: async () => { n++; if (n === 1) await new Promise(() => {}); } });
  loop.start();
  await c.advance(12000);
  loop.stop();
  ok('zaman aşımına uğrayan çevrim timedOut=true ve süre 12000 ile kaydedilir', rec.length === 1 && rec[0][0] === 0 && rec[0][1] === 12000 && rec[0][2] === true);
}
{
  const c = fakeClock();
  const rec = [];
  const gates = [];
  const loop = createOcrLoop({ intervalMs: 5000, cycleTimeoutMs: 60000, ...timers(c), onCycle: (...a) => rec.push(a),
    runCycle: async () => { const g = deferred(); gates.push(g); await g.p; } });
  loop.start();
  await c.advance(100);
  loop.stop();
  loop.start();
  await c.advance(100);
  gates[0].resolve(); // eski oturumun çevrimi yeni oturum başladıktan sonra biter
  await c.advance(100);
  ok('stop/start yarışında eski oturum çevrimi onCycle yazmaz', rec.length === 0);
  gates[1].resolve();
  await c.advance(100);
  ok('yeni oturum çevrimi yazılır', rec.length === 1 && rec[0][0] === 200);
  loop.stop();
  gates.forEach((g) => g.resolve());
  await c.advance(100);
  ok('stop sonrası biten çevrim yazılmaz', rec.length === 1);
}
{
  const c = fakeClock();
  let n = 0;
  const loop = createOcrLoop({ intervalMs: 5000, ...timers(c), onCycle: () => { throw new Error('tanı'); }, runCycle: async () => { n++; } });
  loop.start();
  await c.advance(10000);
  loop.stop();
  ok('onCycle hatası döngüyü kırmaz', n === 3);
}
{
  const log = createCadenceLog();
  for (let i = 0; i < 130; i++) log.push({ startedAt: i * 5000, durationMs: 1000, timedOut: false, session: 1 });
  const snap = log.snapshot();
  ok('halka tampon son 120 çevrimi tutar', snap.length === 120 && snap[0].startedAt === 10 * 5000 && snap[119].startedAt === 129 * 5000);
  snap.pop();
  let frozen = false;
  try { snap[0].startedAt = -1; } catch { frozen = true; }
  ok('snapshot kopyadır, kayıtlar değiştirilemez', log.snapshot().length === 120 && log.snapshot()[0].startedAt === 50000 && (frozen || Object.isFrozen(snap[0])));
  const small = createCadenceLog(3);
  [1, 2, 3, 4].forEach((s) => small.push({ startedAt: s, durationMs: 0, timedOut: false }));
  ok('kapasite ayarlanabilir', small.snapshot().map((e) => e.startedAt).join() === '2,3,4');
}
{
  const e = (startedAt, session = 1, timedOut = false, durationMs = 1000) => ({ startedAt, durationMs, timedOut, session });
  const input = [e(0), e(5000), e(10000), e(16000), e(21000), e(30000, 1, true, 12000)];
  const copy = JSON.stringify(input);
  const s = cadenceStats(input);
  ok('cadenceStats medyan/p95/max', s.cycles === 6 && s.intervals === 5 && s.medianMs === 5000 && s.p95Ms === 9000 && s.maxMs === 9000);
  ok('cadenceStats 5±1 sn oranı ve zaman aşımı sayısı', s.within5s1Ratio === 0.8 && s.timeouts === 1);
  ok('cadenceStats girdiyi değiştirmez', JSON.stringify(input) === copy);
  const seg = cadenceStats([e(0, 1), e(5000, 1), e(60000, 2), e(65000, 2)]);
  ok('oturumlar arası boşluk aralık sayılmaz', seg.intervals === 2 && seg.maxMs === 5000 && seg.within5s1Ratio === 1);
  const empty = cadenceStats([]);
  ok('boş girdi: değerler null', empty.cycles === 0 && empty.intervals === 0 && empty.medianMs === null && empty.p95Ms === null && empty.maxMs === null && empty.within5s1Ratio === null);
  const even = cadenceStats([e(0), e(4000), e(10500)]);
  ok('çift sayıda aralıkta medyan ortalamadır', even.medianMs === 5250 && even.within5s1Ratio === 0.5);
  const bad = cadenceStats([e(0), { startedAt: NaN }, null, e(5000)]);
  ok('geçersiz kayıtlar yok sayılır', bad.cycles === 2 && bad.intervals === 1 && bad.medianMs === 5000);
}

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
