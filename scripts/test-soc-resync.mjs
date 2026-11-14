// DEF-02 / BL-P1-03: SOC 18'de takılıp gerçek 77'ye dönmüyordu ("77,77,4" deseni).
// Kök neden: 18→77 aynı hane sayısında ve çizgi kaybı değil (8→7), bu yüzden pencere kanıtı (latchGuard) devreye girmiyordu;
// yeniden eşitleme ARDIŞIK sayaçla (sürüşte 6×2=12 çevrim) yapılıyordu ve araya karışan her 4/7/18 okuması sayacı sıfırlıyordu.
// A kararı (kullanıcı onayı 2026-11-14): dönüş yalnız dururken/hız bilinmiyorken; sürüşte fiziksel olmayan yükseliş korunur.
// Bu test yukarı yönde pencere kanıtıyla dönüşü ve sahte okumalara/aşağı yöne karşı korumaları sınar (çevrimdışı, sahte veri).
// Kullanım: node scripts/test-soc-resync.mjs
import { createSocFilter } from '../js/sensors/outlierFilter.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };

const STEP = 5000; // ocrLoop intervalMs
const digitsOf = (v) => String(v).length;

/** held değerini normal çevrimlerle kabul ettirir; dönen t sonraki çevrimin zamanıdır. */
function settle(f, value, t, ctx) {
  for (let i = 0; i < 4; i++, t += STEP) f.accept(value, t, { score: 0.9, digits: digitsOf(value), ...ctx });
  return t;
}

/** seq okumalarını sırayla verir; target ilk kez kabul edilen değer olduğunda geçen süre (ms) ya da null. */
function feed(f, seq, t, ctx, target, score = 0.9) {
  const t0 = t;
  let at = null;
  const values = [];
  for (const v of seq) {
    const r = f.accept(v, t, { score, digits: digitsOf(v), ...ctx });
    values.push(r.value);
    if (at == null && r.value === target) at = t - t0 + STEP;
    t += STEP;
  }
  return { at, values, last: f.last };
}

const cycle = (pattern, n) => Array.from({ length: n }, (_, i) => pattern[i % pattern.length]);
const CTXS = [['sürüşte', { speedKmh: 60 }], ['dururken', { speedKmh: 0 }], ['hız yok', {}]];

// ---------- 1) Pozitif (A kararı): DURURKEN / HIZ BİLİNMİYORKEN 18 tutulurken gerçek 77, araya 4/18/7 karışıyor → 60 sn içinde 77 ----------
const REST = CTXS.filter(([label]) => label !== 'sürüşte');
for (const [label, ctx] of REST) {
  for (const x of [4, 18, 7]) {
    const f = createSocFilter();
    const t = settle(f, 18, 1_000_000, ctx);
    ok(`başlangıç 18 kabul (${label})`, f.last === 18, `last=${f.last}`);
    const r = feed(f, cycle([77, 77, x], 12), t, ctx, 77); // 12 çevrim = 60 sn
    ok(`77,77,${x} ${label}: 60 sn içinde 77`, r.at != null && r.at <= 60000, `at=${r.at} values=${r.values.join(',')}`);
    // Dönüşten sonra araya giren tek x okuması 77'yi bozmaz
    ok(`77,77,${x} ${label}: sonda 77 kalır`, r.last === 77, `last=${r.last}`);
  }
  // Faz kaydırılmış desen (77,4,77 / 4,77,77 / 18,77,77) de 60 sn içinde
  for (const pat of [[77, 4, 77], [4, 77, 77], [18, 77, 77]]) {
    const f = createSocFilter();
    const t = settle(f, 18, 2_000_000, ctx);
    const r = feed(f, cycle(pat, 12), t, ctx, 77);
    ok(`${pat.join(',')} ${label}: 60 sn içinde 77`, r.at != null && r.at <= 60000, `at=${r.at} values=${r.values.join(',')}`);
  }
}

// ---------- 1b) A kararı: SÜRÜŞTE fiziksel olmayan ani yükseliş (18→77) korunur/reddedilir ----------
// Sürüşte pil 60 sn'de 18'den 77'ye çıkamaz; mevcut sürüş koruması (test-ocr-consensus: ardışık resync kanıtı) aynen geçerli.
// Araya karışan okumalarla gelen 77'ler 60 sn boyunca kabul edilmez; tutulan 18 değişmez.
{
  const ctx = { speedKmh: 60 };
  for (const pat of [[77, 77, 4], [77, 77, 18], [77, 77, 7], [77, 4, 77], [4, 77, 77], [18, 77, 77]]) {
    const f = createSocFilter();
    const t = settle(f, 18, 2_500_000, ctx);
    const r = feed(f, cycle(pat, 12), t, ctx, 77); // 12 çevrim = 60 sn
    ok(`${pat.join(',')} sürüşte: 60 sn boyunca 77 reddedilir, 18 korunur`, r.at == null && r.last === 18 && r.values.every((v) => v === 18), `at=${r.at} values=${r.values.join(',')}`);
  }
}

// ---------- 2) Negatif: gerçek 18 korunur ----------
for (const [label, ctx] of CTXS) {
  // a) gerçek 18, 60 sn'de en çok 2 sahte 77
  {
    const f = createSocFilter();
    const t = settle(f, 18, 3_000_000, ctx);
    const seq = [18, 77, 18, 18, 18, 77, 18, 18, 18, 18, 18, 18];
    const r = feed(f, seq, t, ctx, 77);
    ok(`gerçek 18 + 2 sahte 77 (${label}): 18 kalır`, r.at == null && r.last === 18, `values=${r.values.join(',')}`);
  }
  // a2) art arda 2 sahte 77
  {
    const f = createSocFilter();
    const t = settle(f, 18, 3_500_000, ctx);
    const r = feed(f, [18, 18, 77, 77, 18, 18, 18, 18, 18, 18, 18, 18], t, ctx, 77);
    ok(`gerçek 18 + art arda 2 sahte 77 (${label}): 18 kalır`, r.at == null && r.last === 18, `values=${r.values.join(',')}`);
  }
  // b) 50/50 karışım: karar yok, 18 korunur
  {
    const f = createSocFilter();
    const t = settle(f, 18, 4_000_000, ctx);
    const r = feed(f, cycle([77, 18], 24), t, ctx, 77);
    ok(`50/50 karışım 77/18 (${label}): 18 kalır`, r.at == null && r.last === 18, `values=${r.values.join(',')}`);
  }
  // c) düşük skor (<0.6): sürekli 77 bile kabul edilmez
  {
    const f = createSocFilter();
    const t = settle(f, 18, 5_000_000, ctx);
    const r = feed(f, cycle([77], 24), t, ctx, 77, 0.55);
    ok(`düşük skor 0.55 sürekli 77 (${label}): 18 kalır`, r.at == null && r.last === 18, `values=${r.values.join(',')}`);
  }
  // c2) düşük skorlu 77'ler sonradan gelen tek yüksek skorlu 77'ye kanıt olarak sayılmaz
  {
    const f = createSocFilter();
    const t = settle(f, 18, 5_500_000, ctx);
    const r = feed(f, [77, 77, 77, 77, 77, 77], t, ctx, 77, 0.55);
    const r2 = feed(f, [77], t + 6 * STEP, ctx, 77, 0.9);
    ok(`düşük skorlu 77'ler + tek iyi 77 (${label}): 18 kalır`, r.at == null && r2.at == null && f.last === 18, `last=${f.last}`);
  }
}

// ---------- 3) Aşağı yön korumaları değişmedi ----------
for (const [label, ctx] of CTXS) {
  // 77 tutulurken sahte 18'ler (77,18,77 ve art arda 2 adet) 77'yi düşürmez
  {
    const f = createSocFilter();
    const t = settle(f, 77, 6_000_000, ctx);
    const r = feed(f, [77, 18, 77, 18, 18, 77, 77, 18, 77, 77, 18, 77], t, ctx, 18);
    ok(`77 tutulurken araya 18 (${label}): 77 kalır`, r.at == null && r.last === 77, `values=${r.values.join(',')}`);
  }
  // 77 tutulurken 77/18 karışımı (pencere çoğunluğu 18 olsa bile) ardışık kanıt olmadan düşmez
  {
    const f = createSocFilter();
    const t = settle(f, 77, 6_500_000, ctx);
    const r = feed(f, cycle([18, 18, 77], 12), t, ctx, 18);
    ok(`77 tutulurken 18,18,77 deseni (${label}): 77 kalır`, r.at == null && r.last === 77, `values=${r.values.join(',')}`);
  }
}
{
  // 39→33: uzun aradan sonra tek hatalı okuma değeri değiştirmez
  const f = createSocFilter();
  let t = settle(f, 39, 7_000_000, { speedKmh: 0 });
  t += 10 * 60000;
  const r = f.accept(33, t, { score: 0.9, digits: 2, speedKmh: 0 });
  ok('39→33 uzun aradan sonra tek okuma: 39 kalır', r.value === 39 && f.last === 39, JSON.stringify(r));
  const r2 = f.accept(39, t + STEP, { score: 0.9, digits: 2, speedKmh: 0 });
  ok('39→33 ardından 39: 39', r2.value === 39, JSON.stringify(r2));
}
{
  // 63→7: görüntüde iki hane varken (hane kaybı) okunan 7'ler 63'ü düşürmez
  const f = createSocFilter();
  const t = settle(f, 63, 8_000_000, { speedKmh: 60 });
  const seq = cycle([7], 12);
  let tt = t, moved = false;
  for (const v of seq) { const r = f.accept(v, tt, { score: 0.9, digits: 2, speedKmh: 60 }); if (r.value !== 63) moved = true; tt += STEP; }
  ok('63→7 hane kaybı (digits=2): 63 kalır', !moved && f.last === 63, `last=${f.last}`);
}
{
  // 63 tutulurken 7,7,63 deseni (tek rakam görülse bile) yukarı yol aşağı yönde çalışmaz
  const f = createSocFilter();
  const t = settle(f, 63, 9_000_000, { speedKmh: 60 });
  const r = feed(f, cycle([7, 7, 63], 12), t, { speedKmh: 60 }, 7);
  ok('63 tutulurken 7,7,63: 63 kalır', r.at == null && r.last === 63, `values=${r.values.join(',')}`);
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
