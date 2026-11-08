// Üst panel ve sesli yönlendirme testi: panel metni ile konuşma metni ayrı, ses kısa ve yerelleştirilmiş, yakın manevralar ayrı ayrı söylenir; panelin HTML/CSS yapısı.
// Kullanım: node scripts/test-nav-panel.mjs
import { readFileSync } from 'node:fs';
import { instruction, spoken, dueVoice } from '../js/nav/steps.js';
import { tr, __test } from '../js/i18n/index.js';
import en from '../js/i18n/lang/en.js';
import enExtra from '../js/i18n/lang/en.extra.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name); };

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

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
