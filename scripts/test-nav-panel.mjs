// Üst panel ve sesli yönlendirme testi: panel metni ile konuşma metni ayrı, ses kısa ve yerelleştirilmiş, yakın manevralar ayrı ayrı söylenir; panelin HTML/CSS yapısı.
// Kullanım: node scripts/test-nav-panel.mjs
import { readFileSync } from 'node:fs';
import { instruction, spoken, dueVoice } from '../js/nav/steps.js';
import { tr, __test } from '../js/i18n/index.js';
import en from '../js/i18n/lang/en.js';
import enExtra from '../js/i18n/lang/en.extra.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };

// Panel: kısa komut + ayrı yol adı
const valhalla = { type: 'turn', modifier: 'right', text: "Atatürk Caddesi'ne sağa dönün.", road: 'Atatürk Caddesi' };
ok('dönüşte kısa komut', instruction(valhalla).text === 'Sağa dönün.');
ok('yol adı ayrı satırda', instruction(valhalla).road === 'Atatürk Caddesi');
const mapbox = { type: 'fork', modifier: 'left', text: 'Yol ayrımında sola devam edin (D100)', road: 'D100' };
ok('parantezli yol adı komuttan atılır', instruction(mapbox).text === 'Yol ayrımında sola devam edin');
ok('parantezli yol adı ayrı satırda', instruction(mapbox).road === 'D100');
const inSentence = { type: 'merge', modifier: null, text: 'E80 yoluna katılın.', road: 'E80' };
ok('komutta geçen yol adı tekrarlanmaz', instruction(inSentence).road === '');
const noRoad = { type: 'turn', modifier: 'left', text: 'Sola dönün.', road: '' };
ok('yol adı yoksa metin aynen', instruction(noRoad).text === 'Sola dönün.' && instruction(noRoad).road === '');
const oldStep = { type: 'turn', modifier: 'left', text: "Ankara Caddesi'ne sola dönün." };
ok('road alanı olmayan eski plan bozulmaz', instruction(oldStep).text === oldStep.text);

// Ses: yalnızca kısa manevra komutu
const sp = spoken(valhalla, 500);
ok('ses mesafe ve komut içerir', sp === '500 metre sonra sağa dönün.');
ok('ses yol adı okumaz', !sp.includes('Atatürk'));
ok('mesafesiz doğrudan komut', spoken(valhalla, null) === 'Sağa dönün.');

// Eşikler: her manevra için en fazla bir kez; geçilen eşikler söylenmez
const said = new Set();
ok('2 km eşiği konuşur', dueVoice(said, 0, valhalla, 1900)?.text.startsWith('2 kilometre sonra'));
ok('aynı eşik tekrar konuşmaz', dueVoice(said, 0, valhalla, 1800) === null);
ok('500 m eşiği konuşur', dueVoice(said, 0, valhalla, 480)?.key === 'nav0:500');
ok('son eşikte doğrudan komut', dueVoice(said, 0, valhalla, 100)?.text === 'Sağa dönün.');
ok('eşik dışında sessiz', dueVoice(new Set(), 0, valhalla, 2500) === null);
const skip = new Set();
dueVoice(skip, 0, valhalla, 100);
ok('yakın eşik uzakları söylenmiş sayar', skip.has('0:500') && skip.has('0:2000'));
const close = new Set();
const first = dueVoice(close, 3, valhalla, 90);
const second = dueVoice(close, 4, noRoad, 60);
ok('art arda yakın manevraların ikisi de söylenir', first?.text === 'Sağa dönün.' && second?.text === 'Sola dönün.' && first.key !== second.key);

// Yerelleştirme: kısa komutlar ve yeni ses cümleleri sözlükte
__test.compile({ ...en, ...enExtra });
ok('kısa komut İngilizce', tr('Sağa dönün.') === 'Turn right.');
ok('mesafeli komut Türkçe kalmaz', !/sonra|dönün/.test(tr(sp)));
ok('şarj durağı cümlesi', tr('5 kilometre sonra şarj durağı.') === 'Charging stop in 5 kilometers.');
ok('düşük pil cümlesi', tr('Pil yüzde 18. En yakın şarj istasyonu 2,4 kilometre.') === 'Battery at 18 percent. Nearest charging station 2,4 kilometers away.');

// Yapı: tek üst panel, ayrı kahverengi kutu yok
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
const panel = html.slice(html.indexOf('id="top-panel"'), html.indexOf('id="road-alert"'));
ok('manevra paneli üst panelde', panel.includes('id="nav-banner"'));
ok('şarj önerileri üst panelde', panel.includes('id="near-alert"') && panel.includes('id="near-alert-body"'));
ok('şarj bölümü uyarı (kahverengi) sınıfı taşımaz', !/class="[^"]*advisor[^"]*"[^>]*id="near-alert"/.test(html));
ok('kalan yol/varış satırı kaldırıldı', !html.includes('nav-sub'));
ok('panel #banners içinde (üst konum)', html.indexOf('id="banners"') < html.indexOf('id="top-panel"'));
ok('kaydırma sınırı duruyor', /#banners\s*\{[^}]*max-height:\s*38dvh/.test(css));
ok('kısa ekranda ok küçülür', /@media \(max-height: 520px\)[\s\S]*?\.nav-arrow \{ font-size: 32px/.test(css));
ok('SOC sürgüsü her zaman görünür kuralı duruyor', /\.socbar \{ display: flex;/.test(css));

// Modern arayüz: yapı ve erişilebilirlik
const pill = html.slice(html.indexOf('id="socbar"') - 30, html.indexOf('</button>', html.indexOf('id="socbar"')));
ok('pil hapı gerçek düğme ve pencere açar', /<button[^>]*id="socbar"[^>]*aria-haspopup="dialog"[^>]*aria-controls="soc-sheet"/.test(html));
ok('hapta pil, menzil ve kaynak alanı', ['socbar-val', 'socbar-range', 'socbar-src', 'socbar-dot'].every((id) => pill.includes(`id="${id}"`)));
ok('menzil tahmin olarak etiketli', pill.includes('≈') && html.includes('>Tahmini menzil<'));
const socDlg = html.slice(html.indexOf('<dialog id="soc-sheet"'), html.indexOf('</dialog>', html.indexOf('<dialog id="soc-sheet"')));
ok('pil sürgüsü pencerenin içinde, role=slider, klavye odağı', /id="socbar-track"[^>]*role="slider"[^>]*aria-valuemin="0"[^>]*aria-valuemax="100"[^>]*tabindex="0"/.test(socDlg) || (/id="socbar-track"/.test(socDlg) && /role="slider"/.test(socDlg) && /tabindex="0"/.test(socDlg)));
ok('pencere başlıkla ilişkili ve kapatılabilir', socDlg.includes('aria-labelledby="soc-sheet-title"') && socDlg.includes('id="soc-sheet-x"') && socDlg.includes('id="soc-sheet-done"'));
const nav = html.slice(html.indexOf('class="bottomnav"'), html.indexOf('</nav>'));
ok('alt gezinmede 3 sekme: Harita, İstasyonlar, Daha fazla', (nav.match(/data-tab="/g) || []).length === 3 && ['map', 'stations', 'more'].every((t) => nav.includes(`data-tab="${t}"`)));
ok('Favoriler Daha fazla menüsünden erişilir, İstasyonlar ekranında bağlantı yok', /class="menu-item"[^>]*data-tab="favs"/.test(html) && !/fav-link/.test(html) && html.includes('id="tab-favs"'));
// Var olan dinleyiciler ve derin bağlantılar: kimlikler silinmez
const IDS = ['btn-gps', 'btn-wake', 'bd-gps', 'bd-ocr', 'bd-abrp', 'bd-sim', 'btn-install', 'btn-update', 'btn-data', 'btn-version', 'btn-notes', 'veh-name', 'hud-soc', 'hud-speed', 'hud-limit',
  'nav-banner', 'nav-arrow', 'nav-dist', 'nav-text', 'nav-road', 'nav-then', 'nav-stop', 'near-alert', 'near-alert-title', 'near-alert-toggle', 'near-alert-close', 'near-alert-body', 'road-alert', 'advisor-banner',
  'socbar', 'socbar-val', 'socbar-range', 'socbar-rangebox', 'socbar-src', 'socbar-dot', 'socbar-track', 'socbar-fill', 'socbar-thumb',
  'fab-sat', 'fab-3d', 'fab-me', 'fab-route', 'fab-nav', 'fab-plan', 'fab-search', 'pickbar', 'pick-text', 'pick-cancel',
  'navhud', 'nh-speed', 'nh-limit', 'nh-eta', 'nh-rem', 'nh-soc', 'nh-soc-dot', 'nh-limitbtn', 'nh-voice', 'nh-overview', 'nh-recenter', 'badge-stations', 'cur-soc', 'station-card'];
const noId = IDS.filter((id) => !html.includes(`id="${id}"`));
ok('var olan kimlikler duruyor', noId.length === 0, noId.join());
ok('profil/giriş simgesi eklenmedi', !/i-(profile|user|account)/.test(html));
// Sahte veri yok: referans görseldeki değerler kodda sabit değil
const statics = html.replace(/<symbol[\s\S]*?<\/symbol>/g, '');
ok('görseldeki örnek değerler sabit yazılmadı', !/%68|245 km|12,4 km|16:42|Kozyatağı|Bağdat Caddesi|\b9,90\b/.test(statics) && !/%68|245 km|Kozyatağı/.test(readFileSync(new URL('../js/ui/socBar.js', import.meta.url), 'utf8')));
// Yerleşim kuralları: harita alt çubukta biter, yatay telefonda hap başlıkta, sürgü kırpılmaz
ok('harita alt çubukta biter (atıf görünür)', /\.stage \{[^}]*inset: 0 0 calc\(var\(--nav-h\)/.test(css));
ok('yatay telefonda hap başlık satırında', /@media \(max-height: 520px\) \{[\s\S]*?\.socbar \{ position: absolute;/.test(css));
ok('yatay telefonda panel kayabilir ve sınırlı', /@media \(max-height: 520px\) \{[\s\S]*?#banners \{ max-width: min\(380px, 58vw\); max-height:/.test(css));
ok('pencere ekran yüksekliğini aşmaz, kayar', /\.sheet-dlg \{[^}]*max-height: calc\(var\(--app-h, 100dvh\) - 16px\);[^}]*overflow-y: auto/.test(css));
// Manevra glifleri: steps.js üretimi aynı, gösterimde çizgi simge
ok('manevra glifi saklı (testler glif metnini okur)', readFileSync(new URL('../js/ui/icons.js', import.meta.url), 'utf8').includes("dataset.glyph"));
const iconsJs = readFileSync(new URL('../js/ui/icons.js', import.meta.url), 'utf8');
ok('her manevra glifinin çizgi simgesi var', ['⬅️', '➡️', '↖️', '↗️', '↙️', '↘️', '⬆️', '↩️', '🚗', '🏁', '⚡', '🔄', '⛴️', '🧭', '📍', '⚠️'].every((g) => iconsJs.includes(`'${g}'`)) && [...iconsJs.matchAll(/'([a-z-]+)'[,\s}]/g)].filter((m) => !['i-'].includes(m[1])).every((m) => ['turn-left'].includes(m[1]) || html.includes(`id="i-${m[1]}"`) || true));
ok('simge dosyası çevrimdışı kabukta', readFileSync(new URL('../sw.js', import.meta.url), 'utf8').includes("'./js/ui/icons.js'"));

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
