// Navigasyon üst paneli (iki sütun), rota stili, durdurma, OCR/kamera sabitleri. Kullanım: node scripts/test-nav-top-panel.mjs
import { readFileSync } from 'node:fs';
import { pickAlert, pickSlot, speedOver, ALERT_MS } from '../js/nav/panelLogic.js';
import { OCR } from '../js/config.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html');
const css = read('css/styles.css');
const nav = read('js/nav/navigator.js');
const ahead = read('js/nav/ahead.js');
const engine = read('js/ui/maps/mapEngine.js');
const google = read('js/ui/maps/google.js');
const ctl = read('js/routing/controller.js');
const mapView = read('js/ui/mapView.js');

// --- dönüşümlü uyarı: 3 sn, gerçek veri yoksa hiçbir şey
ok('uyarı aralığı 3 sn', ALERT_MS === 3000);
ok('uyarı yoksa null (uydurma uyarı yok)', pickAlert([], 0) === null && pickAlert([null, '', '  ', undefined], 5) === null && pickAlert(null, 1) === null);
ok('tek uyarı sabit kalır', [0, 1, 2, 3].every((t) => pickAlert(['T'], t) === 'T'));
ok('iki uyarı sırayla döner (trafik, yağış, trafik…)', ['A', 'B', 'A', 'B'].every((x, t) => pickAlert(['A', 'B'], t) === x));
ok('boş olanlar atlanır, sıra korunur', pickAlert(['A', null, 'C'], 1) === 'C' && pickAlert([null, 'B'], 0) === 'B');
ok('bozuk sayaç güvenli', pickAlert(['A', 'B'], NaN) === 'A' && pickAlert(['A', 'B'], -3) === 'B');

// --- hız aşımı (tek hız kaynağı) ve dönüşümlü hücre
ok('hız yoksa aşım yok (sahte uyarı yok)', speedOver(null, 90, 0) === null && speedOver(undefined, 90, 0) === null);
ok('limit ve eşik yoksa aşım yok', speedOver(150, null, 0) === null);
ok('yol limiti + 5 tolerans: 95 değil, 96 aşım', speedOver(95, 90, 0) === null && speedOver(96, 90, 0)?.road === true);
ok('aşım metni güncel hızı taşır (72 ise 72)', speedOver(72.4, 60, 0).kph === 72 && speedOver(72.4, 60, 0).limit === 60);
ok('yol limiti yoksa kullanıcı eşiği (+3)', speedOver(83, null, 80) === null && speedOver(84, null, 80)?.road === false);
ok('yol limiti eşikten önceliklidir', speedOver(84, 90, 80) === null);
ok('aşım yoksa öğeler sırayla döner', ['soc', 'arrive', 'next', 'soc'].every((x, t) => pickSlot(['soc', 'arrive', 'next'], t, false) === x));
ok('boş öğeler atlanır, hiç yoksa null', pickSlot([false, 'next'], 0, false) === 'next' && pickSlot([false, null], 3, false) === null);
const seq = [0, 1, 2, 3, 4, 5].map((t) => pickSlot(['soc', 'alert:0'], t, true));
ok('aşım öncelikli ama diğerlerini engellemez', seq.join() === 'over,soc,over,alert:0,over,soc', seq.join());
ok('aşım ve başka öğe yoksa aşım sabit', [0, 1, 2].every((t) => pickSlot([], t, true) === 'over'));

// --- HTML: iki sütun, alttaki tekrarlanan paneller kalktı
const banner = html.slice(html.indexOf('id="nav-banner"'), html.indexOf('id="near-alert"'));
ok('üst panel iki sütun: sol manevra, sağ bilgi', banner.includes('class="nb-left"') && banner.includes('class="nb-right"'));
ok('sol: sonraki manevra ve mesafe', ['nav-arrow', 'nav-dist', 'nav-text'].every((id) => banner.slice(0, banner.indexOf('nb-right')).includes(`id="${id}"`)));
ok('sağ: hız, pil, varış pili, şarj durağı', ['nh-speed', 'ne-soc', 'ne-arrive', 'ne-next'].every((id) => banner.slice(banner.indexOf('nb-right')).includes(`id="${id}"`)));
ok('sağ: dönüşümlü uyarı alanı, başlangıçta gizli', /id="nb-alert"/.test(banner) && /class="nb-alert hidden"/.test(banner));
ok('ince hız çubuğu kalktı', !html.includes('nav-speedbar') && !/sb-track|sb-fill/.test(css));
ok('sağda hız sınırı levhası ve hız yan yana, sürekli görünür', /class="nb-speedrow"[^>]*>\s*<div class="limit-sign hidden" id="nh-limit"[^>]*><\/div>\s*<div class="nb-cell nb-speed" id="nb-speed">/.test(banner));
ok('levha belirgin büyük (≥ 46 px)', /\.nb-speedrow \.limit-sign \{ width: 58px; height: 58px;/.test(css));
ok('aşımda hız kırmızı', /\.nb-speed\.over \.ne-v b \{ color: #e53935; \}/.test(css) && /classList\.toggle\('over', !!overNow\(e\)\)/.test(nav));
ok('pil, varış, durak ve uyarı tek dönüşümlü hücrede', ['ne-soc-btn', 'ne-arrive-box', 'ne-next-box'].every((id) => new RegExp(`id="${id}"[^>]*data-slot=`).test(banner)) && banner.indexOf('id="nb-rot"') < banner.indexOf('id="ne-soc-btn"'));
ok('ayrı advisor bandı gösterilmez', !/subscribe\('advisor'/.test(read('js/ui/statusBadges.js')) && /class="advisor hidden" id="advisor-banner"/.test(html));
ok('alttaki hız/pil paneli (navhud, nav-ev) kalktı', !html.includes('id="navhud"') && !html.includes('id="nav-ev"'));
ok('kalan süre/yol/varış saati yalnızca bir yerde', (html.match(/id="nh-eta"/g) || []).length === 1 && (html.match(/id="nh-rem"/g) || []).length === 1 && (html.match(/id="ne-arrive"/g) || []).length === 1);
ok('ikincil satırda şarj durağı tekrarı yok', !/\$\{nextStop\.station\.name\} · /.test(nav));
ok('kamera düğmesi korunur', /<button[^>]*data-tab="camera"[^>]*data-premium-only/.test(html));

// --- uyarılar yalnızca panelde, gerçek veriden
ok('hız aşımı/trafik/yağış sarı yol uyarısı şeridinde yok', /\[a\.cam, a\.grade\]/.test(ahead) && !/a\.speed, a\.cam/.test(ahead) && /setAhead\(\{ speed: true \}\)/.test(ahead));
ok('panel uyarıları gerçek veriden (plan uyarısı, trafik, yağış)', /adv\.text : null, a\.traffic, a\.rain\]/.test(nav) && /pickSlot\(slots, alertTick, !!over\)/.test(nav));
ok('aşım metni büyük hızla aynı kaynaktan (effective().speed)', /speedOver\(e\.speed, currentLimit\(\)/.test(nav) && /aştın: \$\{over\.kph\} km\/s/.test(nav));
ok('uyarı 3 sn aralıkla döner', /setInterval\(\(\) => paintAlert\(true\), ALERT_MS\)/.test(nav));

// --- rota stili ve trafik
ok('rota: sarı dış çerçeve + kalın mavi çizgi', /id: 'route-casing'[^\n]*'line-color': '#ffd600'/.test(engine) && /id: 'route-line'[^\n]*'line-color': '#1a73e8'/.test(engine));
ok('çerçeve çizginin altında (3B binalar çerçevenin altında kalmaz)', engine.indexOf("id: 'route-casing'") < engine.indexOf("id: 'route-line'") && /id: BUILDINGS_3D \}, 'route-casing'/.test(engine));
ok('trafik: yavaş turuncu, yoğun kırmızı', /'moderate', '#ff9100', 'heavy', '#e53935', 'severe', '#b71c1c'/.test(engine));
ok('Google altlığı da aynı çerçeve ve renkler', /#ffd600/.test(google) && /moderate: '#ff9100', heavy: '#e53935'/.test(google));
ok('rota yeniden hesaplanmadan trafik renkleri', /mapApi\.setTraffic\(t\.rt\.coords/.test(ahead) && /mapApi\.setTraffic = /.test(mapView) && /sameRoad\(/.test(ahead));

// --- harita ve durdurma
ok('gidiş yönü yukarı varsayılan', /headingUp: load\('headingUp', true\)/.test(read('js/state.js')));
ok('yakın zoom: başlangıç 18, yavaş 18, kavşak 19', /zoomNow = 18;/.test(nav) && /junction \? 19 : speedAvg < 40 \? 18 : speedAvg < 80 \? 17 : 16/.test(nav));
ok('durdurma: rota/plan temizlenir ve konuma yakınlaşılır', /function endNav\([^)]*\) \{[\s\S]*?clearTrip\(\);[\s\S]*?mapApi\.follow\(e\.lat, e\.lon, 17, true, null\)/.test(nav) && /export function stopNav\(\) \{\s*endNav\(\);/.test(nav));
ok('varışta da aynı temizlik (sesi kesmeden)', /endNav\(true\);\s*toast\('Varış noktasına ulaştınız'\)/.test(nav));
ok('clearTrip: plan sıfırlanır, çizgi ve işaretler kalkar', /export function clearTrip\(\)/.test(ctl) && /mapApi\.clearRoute\(\)/.test(ctl) && /setPoint\(k, null/.test(ctl));

// --- v0.99.34 okunabilirlik: sol ikincil satır yok, yol adı talimatla aynı boyda, sağ hücreler büyük
ok('sol ikincil satır (sonra/kalan süre/varış) gizli', /class="nav-then hidden" id="nav-then"/.test(banner) && /class="nb-trip hidden"/.test(banner));
ok('yol adı talimatla aynı boy/ağırlık, en çok 2 satır', /\.nb-man \.nav-text, \.nb-man \.nav-road \{ font-size: 18px; font-weight: 700;[^}]*-webkit-line-clamp: 2; \}/.test(css));
ok('sağ dönüşümlü değerler büyük (≥ 20 px)', /\.nb-cell \.ne-v b \{ font-size: 24px;/.test(css) && /\.nb-alert \{ font-size: 15px;/.test(css));

// --- normal sürüş paneli ile aynı ölçü
ok('rotasız sürüş paneli ve navigasyon paneli aynı en düşük yükseklikte', /.navbar, .mapsoc { box-sizing: border-box; min-height: 150px; }/.test(css));

// --- OCR ve kamera sabitleri (değişmeden korunur)
ok('OCR güncelleme aralığı 5 sn', OCR.intervalMs === 5000);
ok('OCR-1 / OCR-2 seçimi korunur', /data-ocr-engine="tess"/.test(html) && /data-ocr-engine="digit"/.test(html));
ok('kamera seçimi arayüzü yok (tek sabit geniş açı)', !/cam-(device|select|switch|lens)|<select[^>]*cam/i.test(html.slice(html.indexOf('id="cam-stage"') - 200, html.indexOf('id="cam-stage"') + 3000)));
ok('geniş açılı kamera otomatik seçilir', /pickWideDevice\(devices, cur\)/.test(read('js/sensors/camera.js')));

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
