// readRoi çevrimdışı testleri (BL-P1-02): sahte Tesseract (OCR 1) + sahte hane okuyucu (OCR 2) ile kare kararı ve OCR1/OCR2 çapraz denetimi.
// Ayrıca readRoi çıktıları ortak karar + fiziksel filtreden geçirilerek 42→4, 63→7, gerçek tek haneye düşüş ve 5 sn'lik güncelleme sınanır.
// Kullanım: node scripts/test-ocr-readroi.mjs
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.document = { createElement: () => ({ width: 0, height: 0, dataset: {}, getContext: () => ({}) }), body: { classList: { contains: () => false } }, head: { append() {} } };
globalThis.window = {};

const { patch } = await import('../js/state.js');
const { __test } = await import('../js/sensors/ocr.js');
const { consensus } = await import('../js/sensors/ocrConsensus.js');
const { createSocFilter } = await import('../js/sensors/outlierFilter.js');
const { readRoi, deps } = __test;

// Kare başına: OCR 1 metni (Tesseract) ve OCR 2 sonucu (readCanvasDigits). Kalite/ön işleme sahte: her kare okunabilir.
let ocr1 = { text: '63', confidence: 85 };
let ocr2 = { text: '63', confidence: 80, n: 2 };
deps.measureRoi = () => ({ usable: true, weight: 1 });
deps.preprocess = () => true;
deps.readCanvasDigits = () => ({ merged: false, clipped: false, glyphs: [], ...ocr2 });
const worker = { recognize: async () => ({ data: { ...ocr1 } }) };
patch('ocr', { useThreshold: false, roi: { x: 0, y: 0, w: 1, h: 1 } });

const { parseSoc } = await import('../js/sensors/ocr.js');
const read = (engine = 'tess') => readRoi(worker, {}, {}, 'soc', { x: 0, y: 0, w: 1, h: 1 }, parseSoc,
  { timeLeft: () => 1000, isCurrent: () => true, parsedKeys: new Set(), engine });
const frame = async (t1, t2, n, engine) => { ocr1 = { text: t1, confidence: 85 }; ocr2 = { text: t2, confidence: 80, n }; return read(engine); };

// --- Kare kararı: OCR1/OCR2 çapraz denetim ---
let s = await frame('7', '63', null);
ok('OCR1 "7", OCR2 n=null metin "63": kare geçersiz', s.value === null && s.raw === 7, JSON.stringify(s));
ok('  gerekçe hane eksik (truncated)', s.reason === 'truncated', s.reason);
s = await frame('4', '42', null);
ok('OCR1 "4", OCR2 n=null metin "42": kare geçersiz (42→4)', s.value === null && s.reason === 'truncated', JSON.stringify(s));
s = await frame('10', '100', null);
ok('OCR1 "10", OCR2 "100": kare geçersiz', s.value === null, JSON.stringify(s));
s = await frame('4', '42', 2);
ok('OCR2 n=2 iken 4: kare geçersiz (mevcut hane kanıtı korunur)', s.value === null && s.reason === 'truncated', JSON.stringify(s));
s = await frame('42', '4', 1);
ok('OCR2 n=1 iken 42: fazla hane (mevcut davranış)', s.value === null && s.reason === 'extra-digit', JSON.stringify(s));
s = await frame('7', '7', 1);
ok('gerçek tek hane: OCR1 7, OCR2 7 n=1 → 7', s.value === 7 && s.reason === null, JSON.stringify(s));
s = await frame('7', '', null);
ok('OCR2 boş/kanıtsız: OCR1 7 kare değeri kalır (karar filtrede)', s.value === 7, JSON.stringify(s));
s = await frame('63', '6', null);
ok('OCR2 hane kaçırdı (63/6, n=null): iyi 63 karesi reddedilmez', s.value === 63, JSON.stringify(s));
s = await frame('63', '68', 2);
ok('aynı hane sayısında küçük fark (63/68): OCR1 değeri kalır', s.value === 63, JSON.stringify(s));
s = await frame('63', '63', 2);
ok('uyumlu 63/63 → 63', s.value === 63 && s.confidence === 85 && s.digits === 2, JSON.stringify(s));
s = await frame('85%', '859', null);
ok('% simgesi 3. hane sanılırsa (859 → 85) çelişki sayılmaz', s.value === 85, JSON.stringify(s));
s = await frame('', '63', null);
ok('OCR1 okuyamadı: değer yok, gerekçe no-digits', s.value === null && s.reason === 'no-digits', JSON.stringify(s));
ocr2 = { text: '63', confidence: 80, n: 2 };
s = await read('digit');
ok('OCR 2 motoru seçiliyken kendi metni geçerli (63)', s.value === 63, JSON.stringify(s));
ocr2 = { text: '7', confidence: 80, n: 1 };
s = await read('digit');
ok('OCR 2 motorunda gerçek tek hane (7)', s.value === 7, JSON.stringify(s));
ocr1 = { text: '7', confidence: 30 }; ocr2 = { text: '63', confidence: 80, n: null };
s = await read();
ok('düşük güven + çelişki: değer yok', s.value === null, JSON.stringify(s));

// --- Uçtan uca karar: readRoi kareleri → ortak karar → fiziksel filtre, 5 sn aralıklı çevrimler ---
const cycleOf = async (frames) => { const out = []; for (const f of frames) out.push(await frame(...f)); return out; };
const run = async (filter, t, frames) => {
  const samples = await cycleOf(frames);
  const c = consensus(samples, { tol: 1 });
  if (c.value == null) return { ok: false, reason: 'no-candidate' };
  return filter.accept(c.value, t, { score: c.score, speedKmh: 0, hint: null, digits: c.digits });
};
const STEP = 5000; // OCR.intervalMs: 5 sn'lik çevrim
const settle = async (filter, value, t0) => {
  let t = t0, last = null;
  const txt = String(value);
  for (let i = 0; i < 4; i++) { t += STEP; last = await run(filter, t, [[txt, txt, txt.length], [txt, txt, txt.length], [txt, txt, txt.length]]); }
  return { t, last };
};

// 5 sn'lik güncelleme: tutarlı okumada her çevrim kabul edilir, değer değiştikçe izlenir
{
  const f = createSocFilter({ chargePctPerMin: 3, maxJump: 15 });
  let { t, last } = await settle(f, 63, 0);
  ok('5 sn: tutarlı 63 kabul edilir', last.ok && last.value === 63, JSON.stringify(last));
  const cyc = (v) => { const x = String(v); return [[x, x, x.length], [x, x, x.length], [x, x, x.length]]; };
  let okCount = 0;
  for (let i = 0; i < 5; i++) { t += STEP; const r = await run(f, t, cyc(63)); if (r.ok && r.value === 63) okCount++; }
  ok('5 sn: sabit 63 her çevrimde (5/5) yazılır', okCount === 5, String(okCount));
  let at = null;
  for (let i = 1; i <= 2 && at == null; i++) { t += STEP; const r = await run(f, t, cyc(62)); if (r.ok && r.value === 62) at = i; }
  ok('5 sn: 63→62 en geç 2. çevrimde (≤10 sn) kabul', at != null, String(at));
}

// 63→7: OCR1 7, OCR2 metni 63 (n=null) — 63 korunur
{
  const f = createSocFilter({ chargePctPerMin: 3, maxJump: 15 });
  let { t } = await settle(f, 63, 0);
  let held = true;
  for (let i = 0; i < 15; i++) { t += STEP; const r = await run(f, t, [['7', '63', null], ['7', '63', null], ['7', '63', null]]); if (r.ok && r.value !== 63) held = false; }
  ok('63→7 (OCR2 "63"): 15 çevrimde 7 kabul edilmez', held);
  t += STEP;
  const back = await run(f, t, [['63', '63', 2], ['63', '63', 2], ['63', '63', 2]]);
  ok('63→7 sonrası 63 okuması geçerli', back.ok && back.value === 63, JSON.stringify(back));
}

// 63→7: OCR2 kanıtsız (boş, n=null) — BL-P1-01 kilidi korunur
{
  const f = createSocFilter({ chargePctPerMin: 3, maxJump: 15 });
  let { t } = await settle(f, 63, 0);
  let dropped = false;
  for (let i = 0; i < 15; i++) { t += STEP; const r = await run(f, t, [['7', '', null], ['7', '', null], ['7', '', null]]); if (r.ok && r.value === 7) dropped = true; }
  ok('63→7 (OCR2 kanıtsız): BL-P1-01 kilidi, 7 kabul edilmez', !dropped);
}

// 42→4: OCR2 metni 42 — 42 korunur
{
  const f = createSocFilter({ chargePctPerMin: 3, maxJump: 15 });
  let { t } = await settle(f, 42, 0);
  let dropped = false;
  for (let i = 0; i < 15; i++) { t += STEP; const r = await run(f, t, [['4', '42', null], ['4', '42', null], ['4', '42', null]]); if (r.ok && r.value === 4) dropped = true; }
  ok('42→4 (OCR2 "42"): 4 kabul edilmez', !dropped);
}

// Gerçek tek haneye düşüş: görüntüde tek rakam (OCR2 "7", n=1) → kabul edilir
{
  const f = createSocFilter({ chargePctPerMin: 3, maxJump: 15 });
  let { t } = await settle(f, 12, 0);
  let acceptedAt = null;
  for (let i = 1; i <= 20 && acceptedAt == null; i++) { t += STEP; const r = await run(f, t, [['7', '7', 1], ['7', '7', 1], ['7', '7', 1]]); if (r.ok && r.value === 7) acceptedAt = i; }
  ok('gerçek düşüş 12→7 (n=1) kabul edilir', acceptedAt != null, String(acceptedAt));
  ok('  en çok 12 çevrimde (≤60 sn)', acceptedAt != null && acceptedAt <= 12, String(acceptedAt));
}
{
  const f = createSocFilter({ chargePctPerMin: 3, maxJump: 15 });
  let { t } = await settle(f, 63, 0);
  let acceptedAt = null;
  for (let i = 1; i <= 30 && acceptedAt == null; i++) { t += STEP; const r = await run(f, t, [['7', '7', 1], ['7', '7', 1], ['7', '7', 1]]); if (r.ok && r.value === 7) acceptedAt = i; }
  ok('tek rakam kanıtıyla 63→7 yeniden eşitlenir (BL-P1-01 davranışı)', acceptedAt != null, String(acceptedAt));
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
