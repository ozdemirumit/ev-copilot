// BETA beyaz kart tasarımı: hava rozeti veri uydurmaz, şarj hedefi girişi, üç ekranın yapısı, örnek değerlerin koda yazılmaması, kontrast.
// Kullanım: node scripts/test-white-ui.mjs
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { getElementById: () => null, addEventListener() {}, createElement: () => ({ getContext: () => null }), documentElement: { lang: 'tr', classList: { add() {} } }, body: { classList: { contains: () => false, toggle() {} } } };
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true, writable: true });

const { weatherBadge, weatherKind } = await import('../js/ui/statusBadges.js');
const now = 1_000_000_000;
const W = (o) => ({ temp: null, rain: null, code: null, at: 0, known: undefined, ...o });

// Hava rozeti: yalnızca gerçek veri
ok('veri hiç gelmediyse bilinmiyor', weatherBadge({ weather: W({}), now }).text === 'Hava: —' && weatherBadge({ weather: W({}), now }).known === false);
const fresh = weatherBadge({ weather: W({ temp: 11.6, rain: 0, code: 3, at: now - 60e3, known: true }), now });
ok('gerçek sıcaklık yuvarlanır', fresh.text === '12°C' && fresh.known, JSON.stringify(fresh));
ok('kaynak sıcaklık vermediyse hesap varsayılanı gösterilmez', weatherBadge({ weather: W({ temp: 15, at: now - 60e3, known: false }), now }).known === false);
ok('bir saatten eski veri bilinmiyor', weatherBadge({ weather: W({ temp: 20, at: now - 61 * 60e3, known: true }), now }).known === false);
ok('Test Modu kendi değerini gösterir', weatherBadge({ sim: { temp: -3.2, rain: 2 }, weather: W({}), now }).text === '-3°C');
ok('kod yoksa ve yağış yoksa güneşli denmez', weatherKind(null, 0) === 'thermo');
ok('kod yokken yağış ölçümü', weatherKind(null, 1.2) === 'rain');
const kinds = { 0: 'sun', 1: 'sun', 2: 'cloud', 3: 'cloud', 45: 'cloud', 51: 'rain', 63: 'rain', 71: 'snow', 86: 'snow', 95: 'storm', 99: 'storm', 80: 'rain' };
for (const [c, k] of Object.entries(kinds)) ok(`WMO ${c} → ${k}`, weatherKind(Number(c), 0) === k, weatherKind(Number(c), 0));

// Hava kaynağı: gerçek kod ve sıcaklık; eksik sıcaklık "bilinmiyor" işaretlenir
{
  const urls = [];
  const series = (temp, code) => ({ time: [Math.floor(now / 1000)], temperature_2m: [temp], precipitation: [0], wind_speed_10m: [5], wind_direction_10m: [90], ...(code === undefined ? {} : { weather_code: [code] }) });
  let body = series(7.4, 61);
  globalThis.fetch = async (u) => { urls.push(String(u)); return { ok: true, json: async () => ({ hourly: body }) }; };
  const { fetchWeather } = await import('../js/osm/weather.js');
  const [a] = await fetchWeather([{ lat: 10.5, lon: 20.5, t: now }]);
  ok('Open-Meteo isteği hava kodunu ister', urls[0].includes('weather_code'), urls[0]);
  ok('gerçek sıcaklık ve kod döner', a.temp === 7.4 && a.code === 61 && a.known === true, JSON.stringify(a));
  body = series(null, undefined);
  const [b] = await fetchWeather([{ lat: 30.5, lon: 40.5, t: now }]);
  ok('kaynakta sıcaklık yoksa known=false, kod null', b.known === false && b.code === null, JSON.stringify(b));
  ok('eksik sıcaklık rozette gösterilmez', weatherBadge({ weather: { ...b, at: now - 1000 }, now }).known === false);
}

// Şarj hedefi girişi
const { clampTarget } = await import('../js/ui/routeForm.js');
ok('hedef 5\'lik adıma yuvarlanır', clampTarget('83') === 85 && clampTarget(82) === 80);
ok('hedef sınırları', clampTarget('10') === 50 && clampTarget('140') === 100);
ok('boş/geçersiz hedef değer değiştirmez', clampTarget('') === null && clampTarget('abc') === null && clampTarget(null) === null);

const html = read('index.html');
const css = read('css/styles.css');
const shell = read('js/ui/shell.js');
const nav = read('js/nav/navigator.js');
const panel = read('js/ui/routePanel.js');
const ctrl = read('js/routing/controller.js');
const between = (a, b) => { const i = html.indexOf(a); return html.slice(i, html.indexOf(b, i)); };

// Varsayılan şarj hedefi 80, kullanıcı değeri korunur
ok('şarj hedefi varsayılanı %80, kayıtlı değer okunur', /maxChargeTo: load\('maxChargeTo', 80\)/.test(read('js/state.js')) && /maxChargeTo: load\('maxChargeTo', 80\)/.test(read('js/config.js')));
ok('mevcut pil ve şarj hedefi ayrı etiketli', html.includes('<label for="cur-soc">Pil</label>') && html.includes('Şarj hedefi (istasyonda bu seviyeye kadar)'));
ok('iki sürgünün sayısal girişi var', ['cur-soc-num', 'charge-target-num'].every((id) => new RegExp(`<input type="number" id="${id}"[^>]*aria-label=`).test(html)));
ok('hedef tek kaynağa yazar (max-charge)', /master\.dispatchEvent\(new Event\('input'\)\)/.test(read('js/ui/routeForm.js')));

// Harita öncesi
const socCard = between('id="mapsoc"', 'id="banners"') + between('id="mapsoc"', '</main>').slice(0, 1800);
ok('haritada pil, menzil, tüketim, sürgü', ['socbar-val', 'socbar-range', 'socbar-cons', 'map-soc'].every((id) => socCard.includes(`id="${id}"`)));
const row = between('id="searchrow"', 'id="station-card"');
ok('haritada Rota planla ve Git', row.includes('id="fab-plan"') && row.includes('id="fab-nav"'));
ok('Git yalnızca navigasyonda gizli, plan yoksa varış sorar', /navBtn\.classList\.toggle\('hidden', !!getState\('nav'\)\.active\)/.test(shell) && /toast\('Önce varış seç'\)/.test(shell));
ok('harita sürgüsü kamera canlıyken kilitli', /mapSlider\.disabled = locked/.test(read('js/ui/socBar.js')));

// Rota sayfası
const route = between('id="tab-route"', '</section>');
const order = ['id="cur-soc"', 'id="route-start"', 'id="route-via"', 'id="route-end"', 'id="charge-target"', 'id="sum-dist"', 'id="sum-time"', 'id="sum-stops"', 'id="sum-arrive"', 'id="route-adv"', 'id="rp-veh"', 'id="rp-cons"', 'id="rp-range"'];
const idx = order.map((s) => route.indexOf(s));
ok('sıra: pil, başlangıç, ara durak, varış, hedef, önizleme, gelişmiş (araç özeti gelişmişte)', idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1])), idx.join());

// Rota sayfası üst kartı: kalıcı olarak yalnızca pil sürgüsü ve sayısal değeri
const socCardHtml = between('id="rp-soc-card"', 'id="route-start"').split('<h2>')[0];
ok('üst kartta yalnızca iki denetim: sürgü ve sayı', (socCardHtml.match(/<(input|select|button|textarea)\b/g) || []).length === 2 && socCardHtml.includes('id="cur-soc"') && socCardHtml.includes('id="cur-soc-num"'), socCardHtml);
ok('üst kartta araç, tüketim, menzil yok', !/rp-veh|rp-cons|rp-range|rp-soc"|data-tab=/.test(socCardHtml));
ok('pil sürgüsünün görünür etiketi çevrili "Pil" anahtarı', /<label for="cur-soc">Pil<\/label>/.test(socCardHtml) && JSON.parse(read('i18n/keys.json')).includes('Pil'));
ok('araç ve tüketim gelişmişten açılır', /id="route-adv"[\s\S]*id="rp-car"[\s\S]*data-tab="range"[^>]*>Araç ve tüketim</.test(route));
ok('araç ve tüketim denetimleri Araç ve menzil sayfasında', ['veh-brand', 'veh-model', 'veh-pack', 'cons-target', 'cons-adj'].every((id) => between('id="tab-range"', 'id="charger-min"').includes(`id="${id}"`) && html.split(`id="${id}"`).length === 2));
{
  const si = read('js/ui/socInput.js');
  ok('pil notu yalnızca varsayım, kilit ve Test Modunda görünür', /note\.classList\.toggle\('hidden', !\(e\.source === 'sim' \|\| v == null \|\| src === 'default' \|\| online\)\)/.test(si));
}
ok('dar ekranda taşmaz (esnek sürgü)', /\.rp-soc-compact \{[^}]*display: flex/.test(css) && /\.soc-input-row input\[type=range\] \{[^}]*min-width: 0/.test(css));
ok('gelişmiş seçenekler kapalı details', /<details class="[^"]*" id="route-adv">/.test(route) && !/id="route-adv" open/.test(route));
ok('ara durak varsayılan gizli', /class="row hidden" id="via-row"/.test(route));
ok('ara durak rotaya girer, yeniden rotada korunur', /fetchRoute\(start, end, tripWaypoints\(route\.via, via\)\)/.test(ctrl));
ok('ulaşılan ara durak düşer', /VIA_REACHED_KM/.test(nav) && /setPoint\('via', null, \{ fit: false \}\)/.test(nav));
ok('varışta pil plandan', /\$\('sum-arrive'\)\.textContent = new Intl\.NumberFormat/.test(panel));
ok('kimlikler bir kez', ['cur-soc', 'min-arrival', 'min-kw', 'nav-voice', 'plan-status', 'route-via', 'charge-target'].every((id) => html.split(`id="${id}"`).length === 2));

// Navigasyon
const fabs = between('id="fabs"', 'id="nav-ev"');
const stack = between('id="fabs-more"', '</div>');
ok('durdur yığının dışında, her zaman görünür', fabs.includes('id="fab-stopnav"') && !stack.includes('id="fab-stopnav"'));
ok('durdur onay penceresi açar', /\$\('fab-stopnav'\)\.addEventListener\('click', \(\) => \{ setMore\(false\); stopDlg\.showModal\(\); \}\)/.test(shell));
ok('stopNav yalnızca onaydan sonra', /\$\('stop-nav-yes'\)\.addEventListener\('click', \(\) => \{ stopDlg\.close\(\); stopNav\(\); \}\)/.test(shell));
ok('üst paneldeki ✕ ve Rota sayfasındaki büyük durdur kalktı', !html.includes('id="nav-stop"') && !/Navigasyonu durdur'? : 'Git'/.test(panel) && !/stopNav/.test(panel));
ok('varsayılan odak Devam et', /id="stop-nav-no"[^>]*autofocus/.test(html));
ok('navigasyon şeridi: pil, menzil, varış, sonraki şarj', ['ne-soc', 'ne-range', 'ne-arrive', 'ne-next', 'ne-next-t'].every((id) => html.includes(`id="${id}"`)));
ok('şerit değerleri gerçek kaynaktan', /plan\.totals \? pct\(plan\.totals\.arriveSoc\)/.test(nav) && /totalRangeKm/.test(nav) && /timeBetween\(km, nextStop\.km\)/.test(nav));

// Örnek değerler yok
const statics = html.replace(/<symbol[\s\S]*?<\/symbol>/g, '');
const sources = [statics, panel, nav, shell, read('js/ui/routeForm.js'), read('js/ui/socBar.js'), read('js/ui/statusBadges.js')].join('\n');
for (const bad of ['%73', '73%', '18°C', '18 °C', '95 km/h', '305 km', '305km']) ok(`örnek değer yok: ${bad}`, !sources.includes(bad));

// Görsel: lacivert bar, beyaz kart, mavi rota
ok('lacivert üst bar', /\.topbar, \.statusrow \{[^}]*background: var\(--navy\)/.test(css));
ok('kartlar beyaz', /--card: #fff/.test(css));
ok('rota mavi', read('js/ui/maps/mapEngine.js').includes("'line-color': '#1a73e8'") && read('js/ui/maps/google.js').includes("strokeColor: '#1a73e8'"));
ok('navigasyonda durum satırı ve BETA kalır', /body\.navmode \.topbar \{ display: none; \}/.test(css) && !/body\.navmode \.statusrow \{ display: none/.test(css));

// WCAG kontrast (beyaz zeminde)
const lum = (hex) => { const n = hex.replace('#', ''); const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const root = css.slice(css.lastIndexOf(':root {'));
for (const v of ['text', 'muted', 'accent', 'warn', 'bad', 'info']) {
  const hex = root.match(new RegExp(`--${v}: (#[0-9a-f]{6})`))?.[1];
  ok(`--${v} beyazda ≥ 4.5:1`, hex && ratio(hex, '#ffffff') >= 4.5, `${hex} ${hex && ratio(hex, '#ffffff').toFixed(2)}`);
}
const bar = css.match(/\.topbar, \.statusrow \{([^}]*)\}/)[1];
for (const v of ['muted', 'accent', 'warn', 'bad']) {
  const hex = bar.match(new RegExp(`--${v}: (#[0-9a-f]{6})`))?.[1];
  ok(`üst bar --${v} lacivertte ≥ 4.5:1`, hex && ratio(hex, '#0f2744') >= 4.5, hex);
}

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
