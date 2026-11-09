// Harita üç nokta yığını, Rota planla / Git, Araç ve menzil sayfası, alt gezinme (kaynak denetimi).
// Kullanım: node scripts/test-map-menu.mjs
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const html = read('index.html');
const css = read('css/styles.css');
const shell = read('js/ui/shell.js');
const panel = read('js/ui/routePanel.js');
const nearby = read('js/nav/nearby.js');
const controller = read('js/routing/controller.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const between = (a, b, from = 0) => { const i = html.indexOf(a, from); return html.slice(i, html.indexOf(b, i)); };
const tag = (src, id) => src.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))?.[0] || '';

// Üç nokta yığını: küçük simgeler, yukarı açılır, açılır pencere değil
const stack = between('id="fabs-more"', '</div>');
const fabs = between('id="fabs"', 'id="navhud"');
const rule = css.match(/\n\.fabs-more \{[^}]*\}/)?.[0] || '';
ok('yığın dikey ve üç noktanın üstünde', /bottom: calc\(100% \+/.test(rule) && /flex-flow: column/.test(rule) && !/width: 208px/.test(rule), rule);
ok('üç nokta sütunun en üstünde, yığın hemen üzerinde', /id="fabs-more"[\s\S]*<\/div>\s*<button[^>]*id="fab-tools"/.test(fabs));
ok('simgeler küçük (normal düğmeden dar)', /\.fabs \.fabs-more button \{[^}]*width: 40px; height: 40px/.test(css));
ok('yığın dialog/menü rolü taşımaz', !/role="(dialog|menu)"/.test(tag(html, 'fab-tools') + html.slice(html.indexOf('id="fabs-more"') - 40, html.indexOf('id="fabs-more"') + 80)));
const targets = { favs: 'Favoriler', range: 'Araç ve menzil', test: 'Test Modu', camera: 'Kamera', abrp: 'ABRP' };
for (const [t, label] of Object.entries(targets)) {
  const b = stack.match(new RegExp(`<button[^>]*data-tab="${t}"[^>]*>`))?.[0] || '';
  ok(`yığında ${label}`, b.includes(`aria-label="${label}"`) && b.includes(`title="${label}"`), b);
}
for (const t of ['test', 'camera', 'abrp']) ok(`${t} Premium kısıtını korur`, new RegExp(`data-tab="${t}"[^>]*data-premium-only`).test(stack));
const stop = tag(fabs, 'fab-stopnav');
ok('Navigasyonu durdur yalnızca navigasyonda, sağ sütunda', stop.includes('nav-only') && stop.includes('aria-label="Navigasyonu durdur"') && !stack.includes('fab-stopnav'), stop);
ok('durdur önce onay ister', /\$\('fab-stopnav'\)\.addEventListener\('click', \(\) => \{ setMore\(false\); stopDlg\.showModal\(\); \}\)/.test(shell));
ok('harita kontrolleri yığında duruyor', ['fab-sat', 'fab-3d', 'fab-route', 'nh-limitbtn', 'nh-voice', 'nh-overview', 'nh-search'].every((id) => stack.includes(`id="${id}"`)));
ok('navigasyonda tüm rota düğmesi tekrarlanmaz', /body\.navmode #fab-route \{ display: none; \}/.test(css));
ok('sayfa açılınca yığın kapanır', /addEventListener\('tabchange', \(\) => setMore\(false\)\)/.test(shell));
ok('yığın üst paneli aşmaz: yükseklik açılışta ölçülür', /more\.style\.maxHeight = /.test(shell) && /hud\.getBoundingClientRect\(\)\.bottom/.test(shell));

// Rota planla ve Git
ok('Rota sayfasında Rota planla görünür', /<button[^>]*id="btn-plan"[^>]*>Rota planla<\/button>/.test(html) && !tag(html, 'btn-plan').includes('hidden'));
ok('Rota planla yalnızca planlar', /\$\('btn-plan'\)\.addEventListener\('click', \(\) => \{ if \(prepareRoute\(\)\) planTrip\(\); \}\)/.test(panel));
ok('tek dinleyici: controller btn-plan dinlemez', !controller.includes("'btn-plan'"));
ok('Git ve Rota planla aynı hazırlığı kullanır', /if \(!prepareRoute\(\)\) return;/.test(panel));
const search = between('id="searchrow"', 'id="station-card"');
ok('haritada Rota planla sayfayı açar', /id="fab-plan"[^>]*data-tab="route"[\s\S]*?<span>Rota planla<\/span>/.test(search));
ok('haritada Git var olan fab-nav, arama satırında', /id="fab-nav"[\s\S]*?<span>Git<\/span>/.test(search) && !fabs.includes('id="fab-nav"'));
ok('harita Git navigasyon dışında görünür', /navBtn\.classList\.toggle\('hidden', !!getState\('nav'\)\.active\)/.test(shell));
ok('Git düğmesi kopyalanmadı', (html.match(/>Git</g) || []).length === 2 && (html.match(/<span>Git<\/span>/g) || []).length === 1);

// Araç ve menzil
const range = between('id="tab-range"', 'id="tab-camera"');
const more = html.slice(html.indexOf('id="tab-more"'), html.indexOf('</main>'));
ok('sayfa başlığı Araç ve menzil', /id="tab-range" data-title="Araç ve menzil"/.test(html));
ok('araç kartı sayfanın başında, menzil verilerinin üstünde', range.indexOf('id="vehicle-card"') > 0 && range.indexOf('id="vehicle-card"') < range.indexOf('id="c-range"'));
ok('araç seçimi ve tüketim taşındı', ['veh-brand', 'veh-model', 'veh-pack', 'veh-apply', 'cons-target', 'cons-adj', 'max-charge', 'allow-slow'].every((id) => range.includes(`id="${id}"`)));
ok('Daha fazla sayfasında araç kartı kalmadı', !more.includes('id="vehicle-card"') && !more.includes('id="veh-brand"'));
ok('kimlikler bir kez', ['vehicle-card', 'veh-brand', 'cons-target'].every((id) => html.split(`id="${id}"`).length === 2));
ok('kapalı kartta kayıtlı araç görünür', /\.card\.collapsed > #veh-saved \{[^}]*display: block !important/.test(css));
ok('Daha fazla menüsünden de erişilir', /class="menu-item"[^>]*data-tab="range"[\s\S]*?<b>Araç ve menzil<\/b>/.test(html));

// Alt gezinme ve yinelenen satır
const nav = between('class="bottomnav"', '</nav>');
ok('alt gezinme yalnızca Harita, İstasyonlar, Daha fazla', (nav.match(/data-tab="/g) || []).length === 3 && ['Harita', 'İstasyonlar', 'Daha fazla'].every((t) => nav.includes(t)));
ok('Şarj istasyonları satırı kalktı', !html.includes('near-summary') && !css.includes('near-summary') && !nearby.includes('near-summary'));
ok('istasyon sayfası duruyor', html.includes('id="tab-stations"') && html.includes('id="badge-stations"'));

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
