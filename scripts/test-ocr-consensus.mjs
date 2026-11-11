// OCR kare tutarlılığı (ocrConsensus.js) ve fiziksel makullük filtresi (outlierFilter.js).
// Kullanım: node scripts/test-ocr-consensus.mjs
import { consensus } from '../js/sensors/ocrConsensus.js';
import { createSocFilter, createSpeedFilter, confusable } from '../js/sensors/outlierFilter.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name); };
const s = (value, confidence = 85, quality = 1) => ({ value, confidence, quality });
const T = 1_000_000;
const SEC = 1000;

// --- Kare tutarlılığı ---
{
  const c = consensus([s(73), s(73), s(73)], { tol: 1 });
  ok('üç kare aynı: değer kabul', c.value === 73 && c.agree === 3 && c.score > 0.7);
  const one = consensus([s(13), s(73), s(73)], { tol: 1 });
  ok('tek kare sapması (13) çoğunluğu (73) bozmaz', one.value === 73 && one.agree === 2);
  ok('sapma güven skorunu düşürür', one.score < c.score);
  ok('tek geçerli kare asla yeterli değil', consensus([s(73), s(null, 0), s(null, 0)], { tol: 1 }).value === null);
  ok('tek geçerli kare ham değer olarak raporlanır', consensus([s(73), s(null, 0)], { tol: 1 }).raw === 73);
  ok('tamamen çelişen kareler kabul edilmez', consensus([s(13), s(73), s(40)], { tol: 1 }).value === null);
  ok('boş örnek listesi güvenli', consensus([], { tol: 1 }).value === null && consensus([], { tol: 1 }).score === 0);
  ok('tolerans içi kareler aynı kümede', consensus([s(72), s(73), s(73)], { tol: 1 }).value === 73);
  const low = consensus([s(73, 85, 0.3), s(73, 85, 0.3), s(73, 85, 0.3)], { tol: 1 });
  ok('düşük kalite skoru düşürür', low.score < c.score);
  const heavy = consensus([s(13, 90), s(73, 90), s(73, 90), s(13, 40)], { tol: 1 });
  ok('eşit oyda yüksek güvenli küme kazanır', heavy.raw === 73);
}

// --- Pil: ilk okuma ---
{
  const f = createSocFilter({ chargePctPerMin: 3 });
  ok('ilk tek çevrim kabul edilmez', f.accept(73, T, { score: 0.8 }).ok === false && f.last === null);
  const second = f.accept(73, T + 5 * SEC, { score: 0.8 });
  ok('ikinci tutarlı çevrim kabul', second.ok && second.reason === 'first' && f.last === 73);
}
{
  const f = createSocFilter({});
  let accepted = false;
  for (let i = 0; i < 12; i++) accepted = f.accept(i % 2 ? 13 : 73, T + i * 5 * SEC, { score: 0.8 }).ok || accepted;
  ok('ilk okumada dönüşümlü 73/13 hiç kabul edilmez', !accepted && f.last === null);
}
{
  const f = createSocFilter({});
  const r = [];
  for (let i = 0; i < 5; i++) r.push(f.accept(13, T + i * 5 * SEC, { score: 0.8, hint: 73 }).ok);
  ok('ipucuyla karışabilir ilk okuma (73→13): 5 çevrim gerekir', r.join() === 'false,false,false,false,true');
}
{
  const f = createSocFilter({});
  const r = [];
  for (let i = 0; i < 3; i++) r.push(f.accept(42, T + i * 5 * SEC, { score: 0.8, hint: 75 }).ok);
  ok('ipucundan uzak ama karışmayan ilk okuma: 3 çevrim', r.join() === 'false,false,true');
}
{
  const f = createSocFilter({});
  f.accept(73, T, { score: 0.2 });
  ok('düşük skorlu ilk okuma çevrim saymaz', f.accept(73, T + 5 * SEC, { score: 0.2 }).ok === false && f.last === null);
}

// --- Pil: sıçrama ve fiziksel sınırlar ---
const verified = (v, t = T) => {
  const f = createSocFilter({ chargePctPerMin: 3 });
  f.reset(v, t);
  return f;
};
// Pil: makul değişim de tek çevrimle kabul edilmez (tek farklı okuma geçerli değeri değiştirmez); aynı değer bir sonraki çevrimde teyit eder.
const confirmed = (f, value, t, ctx) => {
  const first = f.accept(value, t, ctx);
  const second = f.accept(value, t + 5 * SEC, ctx);
  return !first.ok && first.reason === 'confirming' && second.ok && f.last === value;
};
const okAtCycle = (f, value, speedKmh, limit = 60, score = 0.9) => {
  for (let i = 1; i <= limit; i++) if (f.accept(value, T + i * 5 * SEC, { score, speedKmh }).ok) return i;
  return -1;
};
{
  const f = verified(73);
  const r = f.accept(13, T + 5 * SEC, { score: 0.9 });
  ok('73→13 reddedilir, son değer korunur', !r.ok && r.reason === 'jump' && r.value === 73 && f.last === 73);
  ok('küçük değişim ikinci çevrimde kabul', confirmed(verified(73), 72, T + 5 * SEC, { score: 0.8, speedKmh: 90 }));
}
ok('karışabilir kalıcı 73→13: 12 çevrimden önce kabul edilmez', okAtCycle(verified(73), 13, 0) === 12);
ok('karışabilir sapma sürüşte de 12 çevrim', okAtCycle(verified(73), 13, 90) === 12);
ok('sürüşte fiziksel olmayan yükseliş: yeniden eşitleme iki kat (12)', okAtCycle(verified(40), 62, 90) === 12);
ok('duruşta uzak değer (karışmayan): 6 çevrimde yeniden eşitlenir', okAtCycle(verified(40), 62, 0) === 6);
ok('tolerans süreyle sınırsız büyümez (6 saat, sürüş, 73→40)', !verified(73).accept(40, T + 6 * 3600 * SEC, { score: 0.9, speedKmh: 90 }).ok);
ok('tolerans süreyle sınırsız büyümez (6 saat, duruş, 20→90)', !verified(20).accept(90, T + 6 * 3600 * SEC, { score: 0.9, speedKmh: 0 }).ok);
ok('kamera kapalıyken makul şarj (duruş, 20 dk, +20) teyitle kabul', confirmed(verified(40), 60, T + 20 * 60 * SEC, { score: 0.9, speedKmh: 0 }));
ok('duruşta 60 sn +4 (şarj) teyitle kabul', confirmed(verified(50), 54, T + 60 * SEC, { score: 0.9, speedKmh: 0 }));
ok('sürüşte 60 sn +4 reddedilir', !verified(50).accept(54, T + 60 * SEC, { score: 0.9, speedKmh: 90 }).ok);
ok('sürüşte 60 sn −3 (deşarj) teyitle kabul', confirmed(verified(50), 47, T + 60 * SEC, { score: 0.9, speedKmh: 90 }));
ok('duruşta 60 sn −5 reddedilir', !verified(50).accept(45, T + 60 * SEC, { score: 0.9, speedKmh: 0 }).ok);
ok('hız bilinmiyorsa 60 sn +4 teyitle kabul (şarj olabilir)', confirmed(verified(50), 54, T + 60 * SEC, { score: 0.9 }));
ok('sürüşte 5 sn +2 reddedilir, −2 teyitle kabul', verified(50).accept(52, T + 5 * SEC, { score: 0.9, speedKmh: 90 }).reason === 'jump' && confirmed(verified(50), 48, T + 5 * SEC, { score: 0.9, speedKmh: 90 }));
{
  const f = verified(73);
  ok('düşük skorlu çevrimler yeniden eşitlemeye sayılmaz', okAtCycle(f, 13, 0, 30, 0.4) === -1 && f.last === 73);
}
{
  const f = verified(40);
  for (let i = 1; i <= 5; i++) f.accept(62, T + i * 5 * SEC, { score: 0.9, speedKmh: 0 });
  ok('uzun aradan sonra birikmiş aday düşer', !f.accept(62, T + 200 * SEC, { score: 0.9, speedKmh: 0 }).ok && f.last === 40);
}
{
  const f = verified(40);
  for (let i = 1; i <= 5; i++) f.accept(62, T + i * 5 * SEC, { score: 0.9, speedKmh: 0 });
  f.accept(41, T + 30 * SEC, { score: 0.9, speedKmh: 0 });
  ok('geçerli okuma birikmiş adayı temizler', !f.accept(62, T + 35 * SEC, { score: 0.9, speedKmh: 0 }).ok);
}
ok('aralık dışı değer reddedilir', createSocFilter({}).accept(130, T, { score: 0.9 }).reason === 'range');
{
  const f = verified(73);
  f.reset(null);
  ok('reset(null) referansı bırakır', f.last === null);
}

// --- Hız ---
{
  const f = createSpeedFilter();
  ok('hız: ilk çevrim bekler', !f.accept(90, T, { score: 0.8 }).ok);
  ok('hız: ikinci çevrim kabul', f.accept(92, T + 5 * SEC, { score: 0.8 }).ok && f.last === 92);
}
{
  const f = createSpeedFilter();
  f.reset(50, T);
  ok('hız: 5 sn +40 kabul', f.accept(90, T + 5 * SEC, { score: 0.8 }).ok);
  f.reset(50, T);
  ok('hız: 5 sn +80 reddedilir', !f.accept(130, T + 5 * SEC, { score: 0.8 }).ok);
  f.reset(50, T);
  ok('hız toleransı üst sınırlı (1 saat, +150)', !f.accept(200, T + 3600 * SEC, { score: 0.8 }).ok);
}
{
  const f = createSpeedFilter();
  f.reset(130, T);
  ok('hız: ani duruş (130→0) 3 çevrimde yeniden eşitlenir', okAtCycle(f, 0, null, 10, 0.8) === 3);
}
{
  const f = createSpeedFilter();
  f.reset(73, T);
  ok('hız: karışabilir okuma (73→173) 6 çevrim', okAtCycle(f, 173, null, 10, 0.8) === 6);
}

// --- Rakam karışıklığı ---
// --- Hane kaybı: gerçek 42, OCR 42→4→2→42→4 ---
{
  const feed = (f, seq, digits) => { let t = 0; return seq.map((v) => { t += 5000; const d = typeof digits === 'function' ? digits(v) : digits; return f.accept(v, t, { score: 0.8, speedKmh: null, digits: d }); }); };
  const twoDigits = (v) => (v >= 10 ? 2 : null);
  {
    const f = createSocFilter({ chargePctPerMin: 3, maxJump: 2 });
    feed(f, [4, 4, 42, 4, 42], twoDigits);
    ok('hatalı 4 kabul edilmişse araya 4 karışsa da 42 geri alınır', f.last === 42, String(f.last));
  }
  {
    const f = createSocFilter({ chargePctPerMin: 3, maxJump: 2 });
    feed(f, [4, 4, 42, 2, 42], twoDigits);
    ok('araya 2 karışsa da 42 geri alınır', f.last === 42, String(f.last));
  }
  {
    const f = createSocFilter({ chargePctPerMin: 3, maxJump: 2 });
    const res = feed(f, [4, 4, 42, 4, 42, 2, 42, 4, 42], null);
    ok('kanıt yoksa da kilit kalmaz (pencere içinde 4 okuma)', f.last === 42, JSON.stringify(res.map((r) => r.reason)));
  }
  {
    const f = createSocFilter({ chargePctPerMin: 3, maxJump: 2 });
    f.reset(42, 0);
    const res = feed(f, [4, 2, 42, 4, 42, 2, 42], null);
    ok('doğru 42 tutulurken 4/2 kabul edilmez', f.last === 42 && res[0].reason === 'fragment' && res[1].reason === 'fragment', JSON.stringify(res));
  }
  {
    const f = createSocFilter({ chargePctPerMin: 3, maxJump: 2 });
    f.reset(12, 0);
    const r = f.accept(1, 30 * 60000, { score: 0.8, speedKmh: null, digits: null });
    ok('uzun süre sonra da 12→1 hane kaybı doğrudan kabul edilmez', !r.ok && r.reason === 'fragment' && f.last === 12, JSON.stringify(r));
  }
  {
    const f = createSocFilter({ chargePctPerMin: 3, maxJump: 2 });
    f.reset(10, 0);
    const r = f.accept(9, 5000, { score: 0.8, speedKmh: null, digits: 1 });
    const r2 = f.accept(9, 10000, { score: 0.8, speedKmh: null, digits: 1 });
    ok('gerçek 10→9 geçişi teyitle serbest', !r.ok && r2.ok && f.last === 9);
  }
  {
    const f = createSocFilter({ chargePctPerMin: 3, maxJump: 2 });
    const res = feed(f, [7, 7], 1);
    ok('ilk okuma gerçek tek hane kabul edilir', res[1].ok && f.last === 7);
  }
  {
    const f = createSocFilter({ chargePctPerMin: 3, maxJump: 2 });
    f.reset(42, 0);
    const res = feed(f, [4, 4, 4, 4, 4, 4], 1);
    ok('görüntüde tek rakam sürüyorsa gerçek düşüş kabul edilir (6 çevrim)', res[5].ok && f.last === 4, JSON.stringify(res));
  }
  {
    const f = createSocFilter({ chargePctPerMin: 3, maxJump: 2 });
    f.reset(42, 0);
    const res = feed(f, [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4], null);
    ok('kanıtsız sürekli 4 daha uzun sürer', f.last === 42 && !res.at(-1).ok);
    feed(f, [4], null);
    ok('kanıtsız olsa da 12. çevrimde kabul edilir (kilit yok)', f.last === 4, String(f.last));
  }
  {
    const f = createSocFilter({ chargePctPerMin: 3, maxJump: 2 });
    f.reset(4, 0);
    feed(f, [42], 2);
    f.clearEvidence();
    const r = f.accept(42, 10000, { score: 0.8, speedKmh: null, digits: 2 });
    ok('motor değişince birikmiş kanıt silinir, değer korunur', !r.ok && f.last === 4);
  }
}

ok('7↔1 karışır', confusable(73, 13));
ok('3↔8 karışır', confusable(83, 88) && confusable(38, 88));
ok('hane düşmesi karışır', confusable(73, 3));
ok('iki hane farklı: karışmaz', !confusable(73, 42));
ok('0 karışıklık sayılmaz', !confusable(130, 0));

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
