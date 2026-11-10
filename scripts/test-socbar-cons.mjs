// Pil hapı: iki tüketim (şimdi / rota ya da düz ortalama) ve toplam menzilin yanında eşik piline kadar menzil (kaynak denetimi).
// Kullanım: node scripts/test-socbar-cons.mjs
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const html = read('index.html');
const js = read('js/ui/socBar.js');
const css = read('css/styles.css');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const pill = html.slice(html.indexOf('id="socbar"') - 30, html.indexOf('</button>', html.indexOf('id="socbar"')));

ok('hapta iki tüketim alanı', ['socbar-cons', 'socbar-cons-lbl', 'socbar-cons2', 'socbar-cons2-lbl'].every((id) => pill.includes(`id="${id}"`)));
ok('birim bir kez ("kWh/100 km")', (pill.match(/kWh\/100 km/g) || []).length === 1);
ok('toplam menzilin yanında eşiğe kadar menzil', pill.includes('id="socbar-thr"') && pill.includes('id="socbar-thr-km"') && pill.indexOf('id="socbar-range"') < pill.indexOf('id="socbar-thr-km"'));
ok('pencerede eşiğe kadar menzil satırı', html.includes('id="soc-sheet-thr"'));
ok('birinci tüketim ölçülen yoksa model tahmini', /const cons = eng\.kwh100Measured \?\? eng\.kwh100Est;/.test(js));
ok('ikinci tüketim menzilin dayandığı ortalama (rangeKwh100)', /const avg = eng\.rangeKwh100;/.test(js) && /\$\('socbar-cons2'\)\.textContent = avg == null/.test(js));
ok('rota profili ise "rota", değilse "düz" etiketi', /tr\(route \? 'rota' : 'düz'\)/.test(js) && /eng\.rangeSrc === 'route'/.test(js));
ok('eşik menzili rangeKm (eşik piline kadar)', /const thr = eng\.rangeKm != null && v != null \? Math\.max\(0, Math\.round\(eng\.rangeKm\)\)/.test(js));
ok('toplam menzil totalRangeKm olarak duruyor', /eng\.totalRangeKm != null && v != null/.test(js));
ok('eşik değeri ayardan (varışta minimum pil)', /getState\('route'\)\.minArrivalSoc/.test(js));
ok('CSS: eşik alanı ayraçlı, tek satır', /\.socbar-thr \{[^}]*white-space: nowrap/.test(css));

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
