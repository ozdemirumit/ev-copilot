// OCR/SOC tutarsızlığı (canlı Beta): ham OCR 47 iken kabul edilen SOC 17'de kalıyordu; 47→17 ve 63→7 yanlış okumaları.
// Kök nedenler (bu dosya hepsini yeniden üretir):
//  1) Bölütleme: rakamların ALTINDA ayrı satırdaki küçük % işareti, dikey parçaları birleştiren adımda (mergeStacked) üstteki rakamla
//     tek kutuya giriyordu; rakam ezilip 4→1, 8→1/4, 7→1 okunuyordu (47→17). Gerçek tek hane 7 bile 1 okunuyordu.
//  2) Filtre: yanlış değer (17) bir kez kabul edilince doğru 47'ye dönmek için 12-24 ARDIŞIK çevrim gerekiyordu; araya karışan her
//     17 okuması 17'yi yeniden onaylayıp 47 kanıtını sıfırlıyordu → kilit kalıcı.
//  3) Elle düzeltme: 17 okumaları durumu 'ok' yaptığı anlarda pil sürgüsü kilitleniyordu; elle girişten sonra araya giren tek 17
//     ardışık sayımı bozduğu için kamera kullanıcının değerini doğrulayamıyordu.
// Kullanım: node scripts/test-ocr-latch.mjs
import { readFileSync } from 'node:fs';
import { readDigits, readCanvasDigits } from '../js/sensors/digitRecognizer.js';
import { createSocFilter, inkUpgrade } from '../js/sensors/outlierFilter.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };

// ---------- 1) Bölütleme: ayrı satırdaki % ----------
const scenes = JSON.parse(readFileSync(new URL('./fixtures/digits-heldout.json', import.meta.url), 'utf8'));
const bwOf = (s) => { const bw = new Uint8Array(s.w * s.h).fill(255); let i = 0, cur = 0; for (const run of s.rle) { if (cur) bw.fill(0, i, i + run); i += run; cur = 1 - cur; } return bw; };
const inkBox = (bw, w, h) => { let x0 = w, x1 = 0, y0 = h, y1 = 0; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!bw[y * w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return { x0, x1, y0, y1 }; };
/** Küçük % işareti: iki halka + eğik çizgi (size: yükseklik px). */
const drawPct = (bw, w, cx, cy, size) => {
  const r = size / 5;
  const ring = (x0, y0) => { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) { const d = Math.hypot(x, y); if (d <= r && d >= r * 0.45) bw[Math.round(y0 + y) * w + Math.round(x0 + x)] = 0; } };
  ring(cx - size / 3, cy - size / 3); ring(cx + size / 3, cy + size / 3);
  for (let t = -size / 2; t <= size / 2; t += 0.5) for (let k = -1; k <= 1; k++) bw[Math.round(cy - t) * w + Math.round(cx + t * 0.8 + k)] = 0;
};
/** Sahneyi alta % sığacak şekilde uzatır; % rakamların altında, ortada (ayrı satır). */
const withPctBelow = (s, rel = 0.38, gap = 8) => {
  const base = bwOf(s); const b = inkBox(base, s.w, s.h); const size = Math.round((b.y1 - b.y0 + 1) * rel);
  const h = s.h + size + 2 * gap; const bw = new Uint8Array(s.w * h).fill(255); bw.set(base);
  drawPct(bw, s.w, Math.round((b.x0 + b.x1) / 2), b.y1 + gap + size / 2, size);
  return { bw, w: s.w, h };
};
const picks = scenes.filter((s) => ['42', '4', '7', '85', '73', '10'].includes(s.text));
{
  const bad = [];
  for (const s of picks) {
    const plain = readDigits(bwOf(s), s.w, s.h, 12);
    const { bw, w, h } = withPctBelow(s);
    const r = readDigits(bw, w, h, 12);
    if (r.text !== plain.text || r.n !== plain.n) bad.push(`${s.font}:${s.text} yalın ${plain.text}/${plain.n} → altta% ${r.text}/${r.n}`);
  }
  ok('% ayrı satırda (altta): okuma ve hane sayısı % yokmuş gibi (6 yazı tipi × 42/4/7/85/73/10)', !bad.length, bad.join(' | '));
}
{
  const sevens = scenes.filter((s) => s.text === '7');
  const bad = sevens.map((s) => { const { bw, w, h } = withPctBelow(s); const r = readDigits(bw, w, h, 12); return r.text === '7' && r.n === 1 ? null : `${s.font}:${r.text}/${r.n}`; }).filter(Boolean);
  ok('gerçek tek hane 7 + altta %: 7 ve n=1 (tek hane korunur)', !bad.length, bad.join(' '));
  const fours = scenes.filter((s) => s.text === '4');
  const bad4 = fours.map((s) => { const { bw, w, h } = withPctBelow(s); const r = readDigits(bw, w, h, 12); return r.text === '4' && r.n === 1 ? null : `${s.font}:${r.text}/${r.n}`; }).filter(Boolean);
  ok('gerçek tek hane 4 + altta %: 1 okunmaz', !bad4.length, bad4.join(' '));
}
{
  // Üstte ayrı satır (ör. küçük birim/simge) da aynı kural: bant dışında kalan küçük parça rakama eklenmez
  const bad = [];
  for (const s of picks) {
    const base = bwOf(s); const b = inkBox(base, s.w, s.h); const size = Math.round((b.y1 - b.y0 + 1) * 0.38);
    const h = s.h + size + 16; const bw = new Uint8Array(s.w * h).fill(255); bw.set(base, (size + 16) * s.w);
    drawPct(bw, s.w, Math.round((b.x0 + b.x1) / 2), 8 + size / 2, size);
    const plain = readDigits(base, s.w, s.h, 12); const r = readDigits(bw, s.w, h, 12);
    if (r.text !== plain.text || r.n !== plain.n) bad.push(`${s.font}:${s.text} ${plain.text}→${r.text}/${r.n}`);
  }
  ok('% ayrı satırda (üstte): okuma değişmez', !bad.length, bad.join(' | '));
}
{
  // Kopuk rakam hâlâ birleşir: 85'in 8'i ortadan yatay kesilince (parlama çizgisi) iki parça tek rakam kalır
  const bad = [];
  for (const s of scenes.filter((x) => x.text === '85')) {
    const bw = bwOf(s); const plain = readDigits(bw, s.w, s.h, 12); const b = inkBox(bw, s.w, s.h);
    const mid = Math.round((b.y0 + b.y1) / 2); const half = Math.round((b.x0 + b.x1) / 2);
    for (let y = mid - 1; y <= mid + 1; y++) for (let x = b.x0; x <= half; x++) bw[y * s.w + x] = 255;
    const r = readDigits(bw, s.w, s.h, 12);
    if (plain.text === '85' && (r.text !== '85' || r.n !== 2)) bad.push(`${s.font}:${r.text}/${r.n}`);
  }
  ok('yatay kesilmiş 8 (kopuk parçalar) yine tek rakam: 85', !bad.length, bad.join(' '));
}
{
  // OCR 1 (Tesseract) aynı tuvali okur: ayrı satırdaki % tuvalden silinir, rakamlara dokunulmaz
  const s = scenes.find((x) => x.text === '42');
  const { bw, w, h } = withPctBelow(s);
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < bw.length; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = bw[i]; rgba[i * 4 + 3] = 255; }
  let put = null;
  const canvas = { width: w, height: h, getContext: () => ({ getImageData: () => ({ data: rgba }), putImageData: (img) => { put = img.data; } }) };
  const r = readCanvasDigits(canvas, 12, { clearOffLine: true });
  const after = put ? Uint8Array.from({ length: w * h }, (_, i) => put[i * 4]) : bw;
  const plain = readDigits(bwOf(s), s.w, s.h, 12);
  const digitsKept = (() => { const p = bwOf(s); for (let i = 0; i < p.length; i++) if (p[i] === 0 && after[i] !== 0) return false; return true; })();
  const below = inkBox(bwOf(s), s.w, s.h).y1 + 3;
  let left = 0; for (let y = below; y < h; y++) for (let x = 0; x < w; x++) if (after[y * w + x] === 0) left++;
  ok('Tesseract tuvali: altta % silinir, rakam pikselleri korunur', put && digitsKept && left === 0 && r.text === plain.text, `put=${!!put} kept=${digitsKept} kalan=${left} text=${r.text}`);
  const plainCanvas = { width: s.w, height: s.h, getContext: () => ({ getImageData: () => { const d = new Uint8ClampedArray(s.w * s.h * 4); const p = bwOf(s); for (let i = 0; i < p.length; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = p[i]; d[i * 4 + 3] = 255; } return { data: d }; }, putImageData: () => { throw new Error('gereksiz yazma'); } }) };
  let wrote = false; try { readCanvasDigits(plainCanvas, 12, { clearOffLine: true }); } catch { wrote = true; }
  ok('ayrı satırda bir şey yoksa tuvale yazılmaz', !wrote);
}

// ---------- 2) Filtre: yanlış kilitten kurtulma ----------
const SEC = 1000;
const T = 1_000_000;
const run = (held, seq, { speed = 0, digitsOf = (v) => String(v).length, score = 0.8 } = {}) => {
  const f = createSocFilter({ chargePctPerMin: 3, maxJump: 2 });
  f.reset(held, T);
  const res = seq.map((v, i) => f.accept(v, T + (i + 1) * 5 * SEC, { score, speedKmh: speed, digits: digitsOf(v) }));
  return { f, res, firstAt: (want) => res.findIndex((r) => r.ok && r.value === want) + 1 };
};
const mix = (good, bad, n, every = 4) => Array.from({ length: n }, (_, i) => ((i + 1) % every === 0 ? bad : good));

{
  const before = run(17, mix(47, 17, 40), { speed: 0 });
  ok('hata yeniden üretildi önceki davranışın tersine: 47 (araya 17 karışsa da) 17 kilidini çözer (duruş)', before.f.last === 47 && before.firstAt(47) > 0 && before.firstAt(47) <= 10,
    `last=${before.f.last} at=${before.firstAt(47)} ${before.res.slice(0, 10).map((r) => r.reason).join(',')}`);
  const drive = run(17, mix(47, 17, 40), { speed: 80 });
  ok('sürüşte de 47 kilidi çözer (≤10 çevrim ≈ 50 sn)', drive.f.last === 47 && drive.firstAt(47) <= 10, `last=${drive.f.last} at=${drive.firstAt(47)}`);
  const clean = run(17, Array(12).fill(47), { speed: 80 });
  ok('temiz 47 akışı: 6 çevrimde (≈30 sn) kurtulur, eskisi 24', clean.firstAt(47) === 6, `at=${clean.firstAt(47)}`);
  const stay = run(17, mix(47, 17, 40), { speed: 0 });
  const after = stay.res.slice(stay.firstAt(47));
  ok('kurtulduktan sonra araya karışan 17 değeri geri çevirmez', after.every((r) => r.value === 47) && stay.f.last === 47);
}
{
  // Ters yön korunur: doğru 47 tutulurken yanlış 17 akışı (çizgi kaybı: 4→1) eskisi gibi en az 12 ardışık çevrim ister
  const down = run(47, mix(17, 47, 40), { speed: 0 });
  ok('doğru 47 tutulurken araya 47 karışan 17 akışı kabul edilmez', down.f.last === 47 && down.firstAt(17) === 0);
  const down2 = run(73, Array(30).fill(13), { speed: 0 });
  ok('kalıcı 73→13 (çizgi kaybı) yine 12 çevrim', down2.firstAt(13) === 12, `at=${down2.firstAt(13)}`);
  const half = run(17, Array.from({ length: 40 }, (_, i) => (i % 2 ? 17 : 47)), { speed: 0 });
  ok('17/47 yarı yarıya: kanıt yetersiz, değer değişmez (elle düzeltme gerekir)', half.f.last === 17);
}
{
  // 63→7 kilidi: hane sayısı artışı yalnızca görüntüde iki hane kanıtıyla (digits=2) kurtarılır
  const up = run(7, mix(63, 7, 40), { speed: 0 });
  ok('7 kilidi: iki hane kanıtlı 63 (araya 7 karışsa da) kilidi çözer', up.f.last === 63 && up.firstAt(63) <= 10, `last=${up.f.last} at=${up.firstAt(63)}`);
  const noEv = run(7, mix(63, 7, 40), { speed: 0, digitsOf: () => null });
  ok('hane kanıtı yoksa 63 kurtarma yolunu kullanamaz', noEv.firstAt(63) === 0 || noEv.firstAt(63) > 10, `at=${noEv.firstAt(63)}`);
  // Gerçek tek hane korunur: gerçek 7 tutulurken ara sıra 63/67 gibi okumalar değeri değiştirmez
  const legit = run(7, mix(7, 63, 60, 3), { speed: 0 });
  ok('gerçek tek hane 7: ara sıra iki haneli okuma (3\'te 1) değeri değiştirmez', legit.f.last === 7 && legit.firstAt(63) === 0);
  const legit2 = run(9, [9, 8, 8, 8, 7, 7, 7], { speed: 80 });
  ok('gerçek tek haneli düşüş (9→8→7) normal teyitle ilerler', legit2.f.last === 7, String(legit2.f.last));
}
ok('çizgi ekleme yönü: 17→47, 13→73, 3→8 yükseltme; ters yön değil', inkUpgrade(17, 47) && inkUpgrade(13, 73) && inkUpgrade(35, 85) && !inkUpgrade(47, 17) && !inkUpgrade(73, 13) && !inkUpgrade(42, 73));

// ---------- 3) Elle düzeltme ve itiraz durumu ----------
{
  const f = createSocFilter({ chargePctPerMin: 3, maxJump: 2 });
  f.reset(null, T);
  const seq = [47, 17, 47];
  const res = seq.map((v, i) => f.accept(v, T + (i + 1) * 5 * SEC, { score: 0.8, hint: 47, digits: 2 }));
  ok('elle 47 girildi: araya 17 karışsa da iki 47 okuması kullanıcı değerini doğrular', res[2].ok && f.last === 47, res.map((r) => r.reason).join(','));
  const g = createSocFilter({ chargePctPerMin: 3, maxJump: 2 });
  g.reset(null, T);
  const r2 = [17, 47, 17].map((v, i) => g.accept(v, T + (i + 1) * 5 * SEC, { score: 0.8, hint: 47, digits: 2 }));
  ok('elle 47 varken araya karışan 17 hızlıca kabul edilmez', !r2.some((r) => r.ok && r.value === 17));
}
{
  const { f } = run(17, [47, 17, 47], { speed: 0 });
  ok('itiraz: 17 tutulurken iki kez 47 okunduysa contested = 47', f.contested(T + 20 * SEC) === 47, String(f.contested(T + 20 * SEC)));
  const quiet = run(47, [47, 47, 17], { speed: 0 }).f;
  ok('tek sapma itiraz sayılmaz', quiet.contested(T + 20 * SEC) == null);
}

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
