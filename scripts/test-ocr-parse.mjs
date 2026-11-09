// OCR metin ayrıştırma (gerçek ocr.js): boşlukla bölünen rakamlar, % gürültüsü, tek hane.
// Kullanım: node scripts/test-ocr-parse.mjs
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { createElement: () => ({ getContext: () => ({}) }), body: { classList: { contains: () => false } }, head: { append() {} } };
globalThis.window = {};
const { parseSoc, parseSpeed } = await import('../js/sensors/ocr.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
for (const [text, want] of [['42', 42], ['4 2', 42], ['4 2\n', 42], [' 42 ', 42], ['42%', 42], ['4', 4], ['4%', 4], ['859', 85], ['100', 100], ['1 00', 100], ['0', 0], ['', null], ['abc', null], ['1234', null], ['%42', 42]]) {
  ok(`SoC ${JSON.stringify(text)} → ${want}`, parseSoc(text) === want, String(parseSoc(text)));
}
ok('iki satırda yalnızca ilk satır alınır', parseSoc('4\n2') === 4);
ok('hız boşluklu', parseSpeed('1 20') === 120);
ok('hız sınırı', parseSpeed('300') === null);
console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
