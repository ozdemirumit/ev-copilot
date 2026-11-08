// Git düğmesi ve işaret testi (kaynak denetimi): A/B harfleri yok, Git tek adımda planlar + navigasyonu başlatır, eski düğme kimlikleri durur.
// Kullanım: node scripts/test-go-button.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name); };

const map = read('js/ui/mapView.js');
const html = read('index.html');
const panel = read('js/ui/routePanel.js');

ok("harita işaretlerinde 'A'/'B' harfi yok", !/'A'\s*:\s*'B'/.test(map) && !/pinEl\([^)]*'[AB]'/.test(map));
ok('başlangıç işareti nokta, varış işareti bayrak', /kind === 'end'\)\s*d\.innerHTML = icon\('flag'\)/.test(map) && /kind === 'start'\)\s*d\.append\(el\('i', 'dot'\)\)/.test(map));
ok('favori yer işareti simgesini yazar (değişmedi)', /pinEl\('place', p\.icon\)/.test(map));

ok('Git düğmesi görünür', /<button[^>]*id="btn-go"[^>]*>Git<\/button>/.test(html) && !/id="btn-go"[^>]*hidden/.test(html));
ok('Rotayı Planla düğmesi gizli ama kimliği duruyor', /<button[^>]*id="btn-plan"[^>]*class="[^"]*hidden|<button[^>]*class="[^"]*hidden[^"]*"[^>]*id="btn-plan"/.test(html));
ok('Navigasyonu başlat düğmesi gizli ama kimliği duruyor', /<button[^>]*class="[^"]*hidden[^"]*"[^>]*id="btn-nav"/.test(html));

ok('Git önce planlar, başarılıysa navigasyonu başlatır', /if \(await planTrip\(\)\) await startNav\(\)/.test(panel));
ok('Git başlangıç yoksa şu anki konumu kullanır', /effective\(\)/.test(panel) && /'Konumum'/.test(panel));
ok('varış yoksa uyarır ve planlamaz', /if \(!r\.end\) return toast\(/.test(panel));
ok('navigasyon sürerken aynı varışta durdurur', /if \(stopMode\(\)\) return stopNav\(\)/.test(panel));
ok('ipucu metni Git anlatır', !/Rotayı Planla'ya dokun/.test(panel) && !/Rotayı Planla'ya dokun/.test(html.replace(/id="btn-plan"[^>]*>[^<]*/, '')));

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
