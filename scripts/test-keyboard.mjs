// Ekran klavyesi: klavye yüksekliği hesabı, odaklı alanı sayfanın üstüne kaydırma, CSS/kabuk bağlantıları (kaynak denetimi).
// Kullanım: node scripts/test-keyboard.mjs
import { readFileSync } from 'node:fs';
import { keyboardInset, revealTop, KB_MIN } from '../js/ui/keyboard.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// Klavye yüksekliği
ok('iPhone: yerleşim 844, görsel 540 → klavye 304', keyboardInset({ innerHeight: 844, vvHeight: 540, vvOffsetTop: 0 }) === 304);
ok('görsel üst kayma (sayfa kaydı) klavyeden düşülür', keyboardInset({ innerHeight: 844, vvHeight: 500, vvOffsetTop: 40 }) === 304);
ok('adres çubuğu farkı (küçük) klavye sayılmaz', keyboardInset({ innerHeight: 844, vvHeight: 790, vvOffsetTop: 0 }) === 0);
ok('klavye yok: 0', keyboardInset({ innerHeight: 844, vvHeight: 844 }) === 0);
ok('eşik sınırı', keyboardInset({ innerHeight: 800, vvHeight: 800 - KB_MIN }) === KB_MIN && keyboardInset({ innerHeight: 800, vvHeight: 800 - KB_MIN + 1 }) === 0);
ok('Android (yerleşim küçülür): fark yok → 0', keyboardInset({ innerHeight: 540, vvHeight: 540 }) === 0);

// Alanı gövdenin üstüne kaydır
ok('alan gövdenin 300 px altında, kaydırma 0 → scrollTop 294', revealTop({ fieldTop: 400, bodyTop: 100, scrollTop: 0 }) === 294);
ok('zaten kaydırılmışsa birikir', revealTop({ fieldTop: 150, bodyTop: 100, scrollTop: 200 }) === 244);
ok('negatif olmaz', revealTop({ fieldTop: 100, bodyTop: 100, scrollTop: 0 }) === 0);

// Bağlantılar
const css = read('css/styles.css');
const kb = read('js/ui/keyboard.js');
ok('sayfa alt kenarı klavyenin üstünde (--kb)', /body\.kbd-open main \{ bottom: calc\(var\(--kb, 0px\) \+ 6px\); \}/.test(css));
ok('klavye açıkken alt menü gizli', /body\.kbd-open \.dock \{ display: none; \}/.test(css));
ok('yazarken pil kartı ve Planla/Git gizli (kompakt form)', /body\.typing #rp-soc-card, body\.typing #plan-actions \{ display: none; \}/.test(css));
ok('öneri listesi klavyenin üstündeki alana sığar', /body\.typing \.suggest \{ max-height: calc\(var\(--app-h/.test(css));
ok('--kb ve kbd-open görsel görünümden yazılır', /visualViewport/.test(kb) && /setProperty\('--kb'/.test(kb) && /classList\.toggle\('kbd-open'/.test(kb));
ok('rota metin alanlarında typing ve kaydırma', /#tab-route input\[type=text\]/.test(kb) && /classList\.add\('typing'\)/.test(kb) && /classList\.remove\('typing'\)/.test(kb));
ok('başlatılır ve çevrimdışı kabukta', /initKeyboard\(\)/.test(read('js/app.js')) && read('sw.js').includes("'./js/ui/keyboard.js'"));
ok('pil kartı kimliği duruyor', read('index.html').includes('id="rp-soc-card"') && read('index.html').includes('id="plan-actions"'));

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
