// İstasyonlar ekranı düzeni (kaynak denetimi): Rotadakiler, Yakındakiler (otomatik yarıçap), Filtre, Şarj markaları, Ücretler sırası;
// listeler ve markalar kapalıyken 3 satır, "+" ile tümü. Kullanım: node scripts/test-stations-list.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name); };

const html = read('index.html');
const sv = read('js/ui/stationsView.js');
const nb = read('js/nav/nearby.js');
const sw = read('sw.js');
const css = read('css/styles.css');

const sec = html.slice(html.indexOf('id="tab-stations"'), html.indexOf('id="tab-abrp"'));
const pos = (id) => sec.indexOf(`id="${id}"`);
const order = ['route-stations-card', 'near-card', 'filter-card', 'brand-card', 'op-body', 'custom-card'].map(pos);
ok('sıra: Rotadakiler, Yakındakiler, Filtre, Şarj markaları, Ücretler, Kendi istasyonlarım', order.every((p) => p >= 0) && order.every((p, i) => i === 0 || order[i - 1] < p));
ok('Rotadakiler kartı varsayılan gizli (rota yoksa görünmez)', /id="route-stations-card"/.test(sec) && /class="card hidden" id="route-stations-card"/.test(sec));
ok('Filtre kartında sıralama, yarıçap, Ara ve AC anahtarı var', ['data-sort="fast"', 'id="near-radius"', 'id="near-refresh"', 'id="near-ac"'].every((s) => sec.slice(pos('filter-card'), pos('brand-card')).includes(s)));
ok('yarıçap seçeneği Otomatik ilk', /<select id="near-radius"[^>]*>\s*<option value="auto">/.test(sec));
ok('üç listede de "+" düğmesi var', ['station-more', 'near-more', 'brand-more'].every((id) => sec.includes(`id="${id}"`)));

ok('Rotadakiler en çok 3 satır', /const ROUTE_LIMIT = 3;/.test(sv) && /allRows\.slice\(0, ROUTE_LIMIT\)/.test(sv));
ok('Yakındakiler en çok 3 satır', /const NEAR_LIMIT = 3;/.test(nb) && /shown\.slice\(0, NEAR_LIMIT\)/.test(nb));
ok('otomatik yarıçap 1 → 10 → 25 → 50 km', /RADIUS_STEPS = \[1, 10, 25, 50\]/.test(nb) && /load\('nearRadiusMode', 'auto'\)/.test(nb));
ok('boş çıkınca yarıçap genişler, hata varsa durur', /visible\(\)\.length \|\| res\.errors\.length\) break/.test(nb));
ok('İstasyonlar sekmesi açılınca kendiliğinden arar', /addEventListener\('tabchange'/.test(nb) && /ev\.detail !== 'stations'/.test(nb));
ok('Şarj markaları kapalıyken 3 satır', /3 \* h \+ 2 \* gap/.test(sv) && /clamped/.test(sv) && /#brand-chips\.clamped/.test(css));
ok('seçili markalar önce (gizli satırda kalmaz)', /ops\.filter\(\(o\) => sel\.includes\(o\.id\)\), \.\.\.ops\.filter\(\(o\) => !sel\.includes\(o\.id\)\)/.test(sv));
ok('+ düğmesi modülü çevrimdışı kabukta', sw.includes("'./js/ui/moreToggle.js'") && read('js/ui/moreToggle.js').includes("aria-expanded"));

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
