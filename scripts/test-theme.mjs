// RM-02 aşama 1: Açık/Koyu/Otomatik tema. Saf mantık, kalıcılık, sistem değişikliğinin canlı izlenmesi, erken betik eşliği,
// ayar seçicisi, CSS kapsamı (açık görünüm aynen) ve iki modda kontrast.
// Kullanım: node scripts/test-theme.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const { THEME_KEY, normalizePref, resolveTheme, createTheme } = await import('../js/ui/theme.js');

// Saf mantık
ok('anahtar evcp. önekli (Beta yapımı ayırır)', THEME_KEY === 'evcp.theme');
ok('bilinmeyen/boş tercih → açık', normalizePref(null) === 'light' && normalizePref('') === 'light' && normalizePref('blue') === 'light');
ok('açık her zaman açık', resolveTheme('light', true) === 'light' && resolveTheme('light', false) === 'light');
ok('koyu her zaman koyu', resolveTheme('dark', false) === 'dark' && resolveTheme('dark', true) === 'dark');
ok('otomatik sistemi izler', resolveTheme('auto', true) === 'dark' && resolveTheme('auto', false) === 'light');

// Sahte ortam
const mkStore = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
const mkMql = (matches) => { const ls = new Set(); return { matches, addEventListener: (t, f) => t === 'change' && ls.add(f), fire(v) { this.matches = v; for (const f of ls) f({ matches: v }); }, ls }; };
const mkRoot = () => ({ dataset: {} });

{
  const store = mkStore(), mql = mkMql(true), root = mkRoot();
  const t = createTheme({ storage: store, matchMedia: () => mql, root });
  ok('kayıt yoksa varsayılan açık (sistem koyu olsa bile)', t.pref === 'light' && root.dataset.theme === 'light');
  ok('varsayılanda depoya bir şey yazılmaz', !store.m.has(THEME_KEY));
  t.set('dark');
  ok('Koyu seçilir, kaydedilir, uygulanır', store.getItem(THEME_KEY) === 'dark' && root.dataset.theme === 'dark' && root.dataset.themePref === 'dark');
  mql.fire(false);
  ok('Koyu seçiliyken sistem değişikliği etkisiz', root.dataset.theme === 'dark');
  t.set('auto');
  ok('Otomatik: sistem açık → açık', root.dataset.theme === 'light');
  mql.fire(true);
  ok('Otomatik: sistem koyuya geçince canlı koyu', root.dataset.theme === 'dark');
  mql.fire(false);
  ok('Otomatik: sistem açığa dönünce canlı açık', root.dataset.theme === 'light');
  t.set('bogus');
  ok('geçersiz değer açık olarak kaydedilir', store.getItem(THEME_KEY) === 'light' && root.dataset.theme === 'light');
  let seen = null; t.onChange((th, p) => { seen = [th, p]; }); t.set('dark');
  ok('değişiklik dinleyicisi çağrılır', seen?.[0] === 'dark' && seen?.[1] === 'dark');
}
{
  const t = createTheme({ storage: mkStore({ [THEME_KEY]: 'auto' }), matchMedia: () => mkMql(true), root: mkRoot() });
  ok('kayıtlı Otomatik yeniden açılışta korunur', t.pref === 'auto' && t.theme === 'dark');
  const thrower = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  const r = mkRoot();
  const t2 = createTheme({ storage: thrower, matchMedia: undefined, root: r });
  ok('depo/matchMedia yoksa çökmez, açık kalır', t2.pref === 'light' && r.dataset.theme === 'light');
  t2.set('dark');
  ok('depo yazılamasa da oturumda uygulanır', r.dataset.theme === 'dark');
  const legacy = { matches: true, ls: [], addListener(f) { this.ls.push(f); } };
  const r3 = mkRoot();
  createTheme({ storage: mkStore({ [THEME_KEY]: 'auto' }), matchMedia: () => legacy, root: r3 });
  legacy.matches = false; legacy.ls.forEach((f) => f());
  ok('eski Safari addListener ile de canlı izlenir', r3.dataset.theme === 'light');
}

// Erken betik (themeBoot.js) aynı sonucu verir
const boot = read('js/ui/themeBoot.js');
for (const [pref, sys, want] of [[null, true, 'light'], ['light', true, 'light'], ['dark', false, 'dark'], ['auto', true, 'dark'], ['auto', false, 'light'], ['xx', true, 'light']]) {
  const attrs = {};
  const ctx = { localStorage: mkStore(pref === null ? {} : { [THEME_KEY]: pref }), window: { matchMedia: () => ({ matches: sys }) }, document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } } };
  vm.runInNewContext(boot, ctx);
  ok(`erken betik ${pref}/${sys ? 'sistem koyu' : 'sistem açık'} → ${want}`, attrs['data-theme'] === want && attrs['data-theme'] === resolveTheme(pref, sys), JSON.stringify(attrs));
}
{
  const attrs = {};
  vm.runInNewContext(boot, { localStorage: { getItem() { throw new Error('x'); } }, window: {}, document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } } });
  ok('erken betik hata verirse öznitelik yazmaz (CSS açık kalır)', !attrs['data-theme']);
}
ok('erken betik aynı anahtarı kullanır', boot.includes(`'${THEME_KEY}'`));

// Bağlantılar
const html = read('index.html');
ok('erken betik stil dosyasından hemen sonra, modül değil', /href="css\/styles\.css">\s*<script src="js\/ui\/themeBoot\.js"><\/script>/.test(html));
const sel = html.slice(html.indexOf('id="theme-card"'), html.indexOf('id="account-card"'));
ok('Daha Fazla sayfasında Görünüm seçicisi: Açık/Koyu/Otomatik', ['value="light"', 'value="dark"', 'value="auto"'].every((v) => sel.includes(v)) && sel.includes('id="theme-select"'));
ok('seçici dil kartından sonra, hesap kartından önce', html.indexOf('id="lang-card"') < html.indexOf('id="theme-card"') && html.indexOf('id="theme-card"') < html.indexOf('id="account-card"'));
const app = read('js/app.js');
ok('app.js initTheme çağırır', app.includes("import { initTheme } from './ui/theme.js';") && /\ninitTheme\(\);/.test(app));
const sw = read('sw.js');
ok('sw.js SHELL listesinde iki dosya', sw.includes("'./js/ui/theme.js'") && sw.includes("'./js/ui/themeBoot.js'"));

// CSS
const css = read('css/styles.css');
const white = css.slice(css.indexOf('/* ===== BETA beyaz kart'), css.indexOf('/* ===== RM-02 Koyu tema'));
const lightRoot = white.slice(white.indexOf(':root {'), white.indexOf('}', white.indexOf(':root {')));
const want = { bg: '#f2f5f9', card: '#fff', text: '#12233b', muted: '#56657a', accent: '#0a7d44', line: '#d3dbe6', navy: '#0f2744', surface: '#fff' };
for (const [k, v] of Object.entries(want)) ok(`açık tema --${k} aynen ${v}`, lightRoot.includes(`--${k}: ${v};`));
ok('açık blokta sabit beyaz zemin kalmadı (hepsi --surface)', !/background: #fff\b(?![0-9a-f])/i.test(white));
ok('açık blokta renk-şeması light', /color-scheme: light/.test(lightRoot));
const darkPart = css.slice(css.indexOf('/* ===== RM-02 Koyu tema'));
const darkRules = darkPart.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+\{/g).map((s) => s.trim());
ok('koyu kurallar yalnızca data-theme="dark" kapsamında', darkRules.length > 3 && darkRules.every((sel) => sel.split(',').every((p) => p.trim().startsWith(':root[data-theme="dark"]'))), darkRules.join(' | '));
ok('prefers-color-scheme CSS ile zorlanmaz (tercih JS ile)', !/@media[^{]*prefers-color-scheme/.test(css));
const darkRoot = darkPart.slice(darkPart.indexOf(':root[data-theme="dark"] {'));
const dv = (k) => darkRoot.match(new RegExp(`--${k}: (#[0-9a-f]{6})`))?.[1];
ok('koyu blokta renk-şeması dark', /color-scheme: dark/.test(darkRoot.slice(0, darkRoot.indexOf('}'))));

const lum = (hex) => { const n = hex.replace('#', ''); const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
for (const bg of ['surface', 'bg', 'card', 'card-2']) {
  for (const v of ['text', 'muted', 'accent', 'warn', 'bad', 'info']) {
    const a = dv(v), b = dv(bg);
    ok(`koyu --${v} / --${bg} ≥ 4.5:1`, a && b && ratio(a, b) >= 4.5, `${a} ${b} ${a && b && ratio(a, b).toFixed(2)}`);
  }
}
for (const t of ['tint-warn', 'tint-bad', 'tint-ok', 'tint-info']) ok(`koyu --text / --${t} ≥ 4.5:1`, ratio(dv('text'), dv(t)) >= 4.5);
ok('koyu birincil düğme yazısı yeşilde ≥ 4.5:1', ratio('#06210f', dv('accent')) >= 4.5);
ok('navigasyon/rota/istasyon panelleri --surface kullanır', /\.navhud, \.station-card, \.toppanel[^{]*\{ background: var\(--surface\)/.test(white) && /\.nav-ev \{[^}]*background: var\(--surface\)/.test(white));
ok('harita karo stili tema ile değişmez (bu aşama)', !/data-theme|themePref/.test(read('js/ui/maps/mapEngine.js') + read('js/ui/mapView.js')));

console.log(`\n${pass} geçti, ${fail} kaldı`);
if (fail) process.exit(1);
