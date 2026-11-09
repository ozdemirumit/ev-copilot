// OCR döngüsü (ocrLoop.js): sabit 5 sn, tek çalışan döngü, durdur/başlat yarışları, zaman aşımı, kare örnekleme.
// Kullanım: node scripts/test-ocr-loop.mjs
import { createOcrLoop, collectSamples } from '../js/sensors/ocrLoop.js';

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

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
