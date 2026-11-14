// Navigasyon üst paneli (v0.99.59: üst satır manevra + sabit varış saati, #nb-metrics altı sabit metrik, #nb-alert dönüşümlü uyarı satırı),
// rota stili, durdurma, OCR/kamera sabitleri. Kullanım: node scripts/test-nav-top-panel.mjs
import { readFileSync } from 'node:fs';
import { pickAlert, pickSlot, speedOver, etaShown, nextChargeView, nextChargeText, NO_STOP, ALERT_MS } from '../js/nav/panelLogic.js';
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

// --- HTML: üst satır manevra (nb-left), altında sabit metrikler (#nb-metrics), en altta uyarı satırı; alttaki tekrarlanan paneller kalktı
const banner = html.slice(html.indexOf('id="nav-banner"'), html.indexOf('id="near-alert"'));
const left = banner.slice(banner.indexOf('class="nb-left"'), banner.indexOf('id="nb-metrics"'));
const metrics = banner.slice(banner.indexOf('id="nb-metrics"'), banner.indexOf('id="nb-alert"'));
ok('üst panel: üstte manevra (nb-left), altında sabit metrikler (#nb-metrics), en altta uyarı', banner.includes('class="nb-left"') && /<div class="nb-metrics" id="nb-metrics">/.test(banner)
  && banner.indexOf('class="nb-left"') < banner.indexOf('id="nb-metrics"') && banner.indexOf('id="nb-metrics"') < banner.indexOf('id="nb-alert"'));
ok('sol: sonraki manevra ve mesafe', ['nav-arrow', 'nav-dist', 'nav-text'].every((id) => left.includes(`id="${id}"`) && !metrics.includes(`id="${id}"`)));
ok('metrikler: hız, pil, varış pili, şarj durağı', ['nh-speed', 'ne-soc', 'ne-arrive', 'ne-next'].every((id) => metrics.includes(`id="${id}"`) && !left.includes(`id="${id}"`)));
ok('sağ: dönüşümlü uyarı alanı, başlangıçta gizli', /id="nb-alert"/.test(banner) && /class="nb-alert hidden"/.test(banner));
ok('ince hız çubuğu kalktı', !html.includes('nav-speedbar') && !/sb-track|sb-fill/.test(css));
ok('hız ve hız sınırı levhası yan yana (ayrı hücreler), sürekli görünür', /<div class="nb-cell nb-speed" id="nb-speed">[\s\S]*?<\/span><\/div>\s*<div class="nb-cell nb-limit" id="ne-limit-box"[^>]*><small>Limit<\/small><div class="ne-v"><div class="limit-sign hidden" id="nh-limit"[^>]*><\/div>/.test(metrics)
  && !/id="nb-speed"[^>]*hidden|id="ne-limit-box"[^>]*hidden|class="nb-cell[^"]*hidden"/.test(metrics));
ok('levha belirgin (hücrede 38 px, 4 px kenar; temel levhadan küçük değil)', /\.nb-limit \.limit-sign \{ width: 38px; height: 38px; border-width: 4px;/.test(css) && /^\.limit-sign \{ flex: none; width: 38px; height: 38px;[^}]*border: 4px solid #e53935;/m.test(css));
ok('aşımda hız kırmızı', /\.nb-speed\.over \.ne-v b \{ color: #e53935; \}/.test(css) && /classList\.toggle\('over', !!overNow\(e\)\)/.test(nav));
ok('pil, varışta, durak sabit metrik hücrelerinde (dönüşüm yuvası yok); uyarı ayrı satırda', ['ne-soc-btn', 'ne-arrive-box', 'ne-next-box'].every((id) => new RegExp(`class="nb-cell[^"]*" id="${id}"`).test(metrics))
  && !/data-slot=/.test(html) && !html.includes('id="nb-rot"') && !metrics.includes('id="nb-alert"'));
ok('ayrı advisor bandı gösterilmez', !/subscribe\('advisor'/.test(read('js/ui/statusBadges.js')) && /class="advisor hidden" id="advisor-banner"/.test(html));
ok('alttaki hız/pil paneli (navhud, nav-ev) kalktı', !html.includes('id="navhud"') && !html.includes('id="nav-ev"'));
ok('kalan süre/yol/varış saati yalnızca bir yerde', (html.match(/id="nh-eta"/g) || []).length === 1 && (html.match(/id="nh-rem"/g) || []).length === 1 && (html.match(/id="ne-arrive"/g) || []).length === 1);
ok('ikincil satırda şarj durağı tekrarı yok', !/\$\{nextStop\.station\.name\} · /.test(nav));
ok('kamera düğmesi korunur', /<button[^>]*data-tab="camera"[^>]*data-premium-only/.test(html));

// --- uyarılar yalnızca panelde, gerçek veriden
ok('hız aşımı/trafik/yağış/eğim sarı yol uyarısı şeridinde yok (yalnızca hız kamerası)', /const lines = \[a\.cam\]\.filter\(Boolean\);/.test(ahead) && !/a\.speed, a\.cam/.test(ahead) && !/a\.cam, a\.grade/.test(ahead) && /setAhead\(\{ speed: true \}\)/.test(ahead));
ok('panel uyarıları gerçek veriden (plan uyarısı, trafik, yağış, eğim)', /adv\.text : null, a\.traffic, a\.rain, a\.grade\]\.filter\(\(x\) => typeof x === 'string' && x\.trim\(\)\)/.test(nav) && /pickSlot\(slots, alertTick, !!over\)/.test(nav));
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
ok('durdurma: rota/plan temizlenir ve güvenilir konuma normal sürüş zoom\'uyla dönülür (RM-12, test-nav-stop-recenter)', /function endNav\([^)]*\) \{[\s\S]*?clearTrip\(\);[\s\S]*?const to = stopRecenter\(\{[^}]*panned \}\);\s*if \(to\) mapApi\.follow\(to\.lat, to\.lon, to\.zoom, true, null\)/.test(nav) && /export function stopNav\(\) \{\s*endNav\(\);/.test(nav));
ok('varışta da aynı temizlik (sesi kesmeden)', /endNav\(true\);\s*toast\('Varış noktasına ulaştınız'\)/.test(nav));
ok('clearTrip: plan sıfırlanır, çizgi ve işaretler kalkar', /export function clearTrip\(\)/.test(ctl) && /mapApi\.clearRoute\(\)/.test(ctl) && /setPoint\(k, null/.test(ctl));

// --- v0.99.34 okunabilirlik: sol ikincil satır yok, yol adı talimatla aynı boyda, sağ hücreler büyük
ok('sol ikincil satır (sonra/kalan süre/varış) gizli', /class="nav-then hidden" id="nav-then"/.test(banner) && /class="nb-trip hidden"/.test(banner));
ok('yol adı talimatla aynı boy/ağırlık, en çok 2 satır', /\.nb-man \.nav-text, \.nb-man \.nav-road \{ font-size: 18px; font-weight: 700;[^}]*-webkit-line-clamp: 2; \}/.test(css));
ok('sağ dönüşümlü değerler büyük (≥ 20 px)', /\.nb-cell \.ne-v b \{ font-size: 24px;/.test(css) && /\.nb-alert \{ font-size: 15px;/.test(css));

// --- v0.99.51 → v0.99.59: varış saati (ETA) üst satırın sağında sabit hücrede (dönüşüm yok); etaShown saf işlevi korunur
const man = banner.slice(banner.indexOf('class="nb-man"'), banner.indexOf('id="nav-then"'));
const etaBox = man.slice(man.indexOf('id="ne-eta-box"'));
const trip = banner.slice(banner.indexOf('class="nb-trip hidden"'), banner.indexOf('id="nb-metrics"'));
ok('ETA: geçerli değer gösterilir, --:--/boş/Invalid Date/NaN atlanır', etaShown('14:05') && etaShown(' 2:05 PM ') && ![ '--:--', '', '  ', null, undefined, 'Invalid Date', 'NaN:NaN', '--'].some((x) => etaShown(x)));
ok('ETA: dönüşüm sırası pil, varışta, varış, sonraki şarj, uyarı', ['soc', 'arrive', 'eta', 'next', 'alert:0', 'soc'].every((x, t) => pickSlot(['soc', 'arrive', 'eta', 'next', 'alert:0'], t, false) === x));
ok('ETA yoksa adım atlanır (boş hücre gösterilmez)', ['soc', 'arrive', 'next', 'soc'].every((x, t) => pickSlot(['soc', 'arrive', etaShown('--:--') && 'eta', 'next'], t, false) === x));
const seqEta = [0, 1, 2, 3, 4, 5, 6, 7].map((t) => pickSlot(['soc', 'arrive', 'eta', 'next'], t, true)).join();
ok('ETA: hız aşımı önceliği korunur (her ikinci adım)', seqEta === 'over,soc,over,arrive,over,eta,over,next', seqEta);
ok('navigator: varış saati dönüşümde değil; paintHud yazar, geçersizde blankTrip --:-- yazar, hücre gizlenmez', !/etaShown|'eta'/.test(nav) && !/ne-eta-box'\)\.classList/.test(nav)
  && /\$\('nh-eta'\)\.textContent = eta;/.test(nav) && /\$\('nh-eta'\)\.textContent = '--:--';/.test(nav));
ok('ETA hücresi tek: #ne-eta-box üst satırda (nb-man), "Varış" etiketli, gizli değil, dönüşüm yuvası yok', (html.match(/id="ne-eta-box"/g) || []).length === 1 && !/data-slot/.test(html)
  && /<div class="nb-eta" id="ne-eta-box"><small>Varış<\/small><b id="nh-eta">--:--<\/b><span class="ne-sub" id="nh-rem">—<\/span><\/div>/.test(man) && !/id="ne-eta-box"[^>]*hidden/.test(html));
ok('ETA hücresi sırası: manevra/yol adı → varış saati (üst satır) → metrikler: sonraki şarj → varışta pil', man.indexOf('id="nav-road"') < man.indexOf('id="ne-eta-box"')
  && banner.indexOf('id="ne-eta-box"') < banner.indexOf('id="nb-metrics"') && metrics.indexOf('id="ne-next-box"') < metrics.indexOf('id="ne-arrive-box"'));
ok('nh-eta/nh-rem taşındı (çoğaltılmadı): yalnızca ETA hücresinde, gizli satırda ve metriklerde yok', etaBox.includes('id="nh-eta"') && etaBox.includes('id="nh-rem"') && !trip.includes('id="nh-eta"') && !trip.includes('id="nh-rem"')
  && !metrics.includes('id="nh-eta"') && !metrics.includes('id="nh-rem"'));
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
ok('index.html kimlikleri benzersiz', dup.length === 0, dup.join());
ok('eski gizli satır: .nb-trip gizli kalır, #nh-dur gizli satırda ve tek', /<div class="nb-trip hidden"><b id="nh-dur">--<\/b><\/div>/.test(banner) && (html.match(/id="nh-dur"/g) || []).length === 1 && /\.nb-left \.nav-then, \.nb-left \.nb-trip \{ display: none; \}/.test(css));
ok('paintHud aynı değerleri her saniye yazar (nh-eta, nh-rem, nh-dur)', /\$\('nh-eta'\)\.textContent = eta;/.test(nav) && /\$\('nh-rem'\)\.textContent = `\$\{remainKm\.toFixed\(0\)\} km`;/.test(nav) && /\$\('nh-dur'\)\.textContent = /.test(nav));

// --- Sonraki PLANLI şarj durağı: ad, rota boyunca kalan km, durakta varış pili (yalnızca güvenilir pil kaynağında)
const stopA = { km: 142.6, arriveSoc: 23.4, station: { id: 's1', name: '  Örnek Tesis  ' } };
ok('durak yoksa görünüm yok (satır gizlenir)', nextChargeView(null, 10, 'live') === null && nextChargeView(undefined, 10, 'live') === null);
ok('bozuk durak/konum: görünüm yok', nextChargeView({ km: NaN }, 10, 'live') === null && nextChargeView(stopA, null, 'live') === null);
const vLive = nextChargeView(stopA, 100, 'live');
ok('kalan km = durağın rota km\'si − araç rota km\'si', Math.abs(vLive.km - 42.6) < 1e-9, JSON.stringify(vLive));
ok('araç ilerledikçe mesafe azalır', nextChargeView(stopA, 130, 'live').km < vLive.km && Math.abs(nextChargeView(stopA, 130, 'live').km - 12.6) < 1e-9);
ok('durak geçildiyse mesafe 0\'ın altına inmez', nextChargeView(stopA, 150, 'live').km === 0);
ok('ad plandaki istasyondan (kırpılmış)', vLive.name === 'Örnek Tesis');
ok('ad yoksa boş (uydurma ad yok)', nextChargeView({ km: 5, arriveSoc: 30, station: {} }, 0, 'live').name === '' && nextChargeView({ km: 5, arriveSoc: 30 }, 0, 'live').name === '');
ok('güvenilir kaynakta (canlı/elle/test) varış pili plandan, yuvarlanmış', ['live', 'manual', 'sim'].every((s) => nextChargeView(stopA, 100, s).soc === 23));
ok('güvenilmeyen kaynakta varış pili yok (--)', ['stale', 'estimate', 'default', 'none', undefined, null, 'ocr'].every((s) => nextChargeView(stopA, 100, s).soc === null));
ok('plan varış pili yoksa/bozuksa yok (--)', nextChargeView({ ...stopA, arriveSoc: null }, 100, 'live').soc === null && nextChargeView({ ...stopA, arriveSoc: NaN }, 100, 'live').soc === null);
ok('negatif plan varış pili 0\'a kırpılır', nextChargeView({ ...stopA, arriveSoc: -2.2 }, 100, 'live').soc === 0);
const nextBox = banner.slice(banner.indexOf('id="ne-next-box"'), banner.indexOf('id="nb-alert"'));
ok('sonraki şarj ayrı satır değil: sabit metrik hücresinde (#nb-metrics, .nb-next), tek', metrics.includes('id="ne-next-box"') && /<div class="nb-cell nb-next" id="ne-next-box">/.test(metrics) && (html.match(/id="ne-next-box"/g) || []).length === 1);
ok('istasyon adı etiket satırında, çevrilmez, tek', /<small>Sonraki şarj<span class="ne-name" id="ne-next-n" data-i18n-skip><\/span><\/small>/.test(nextBox) && (html.match(/id="ne-next-n"/g) || []).length === 1);
ok('ad ve alt satır taşmaz (… ile kesilir)', /#ne-next-t \{[^}]*text-overflow: ellipsis;[^}]*\}/.test(css));
ok('navigator: görünüm nextChargeView + pil kaynağı (socSource / Test Modu) ile', /nextChargeView\(nextStop, km, e\.source === 'sim' \? 'sim' : socSource\(\)\)/.test(nav) && /import \{ socSource \} from '\.\.\/physics\/socEstimate\.js';/.test(nav));
ok('navigator: durak yoksa yalnızca plan hazır + güvenilirse "Durak yok" (çevrilir), aksi halde "--"; metin sabit kodlanmaz', !/t\('Durak yok'\)/.test(nav) && /\$\('ne-next'\)\.textContent = txt === NO_STOP \? t\(NO_STOP\) : txt;/.test(nav)
  && nextChargeText(null, { ready: true, reliable: true }) === NO_STOP && nextChargeText(null, { ready: false, reliable: true }) === '--' && nextChargeText(null, { ready: true, reliable: false }) === '--');
ok('navigator: varış pili güvenilmezse --, mesafe her tick yenilenir', /v\.soc == null \? '--' : pct\(v\.soc\)/.test(nav) && /paintCharge\(plan, km, nextStop, e\)/.test(nav));
ok('trafik/yağış uyarıları dönüşümde korunur (şarj hücresi onları kapatmaz: dönüşümde yalnızca uyarılar)', /const slots = alerts\.map\(\(_, i\) => 'alert:' \+ i\);/.test(nav)
  && ['alert:0', 'alert:1', 'alert:0'].every((x, t) => pickSlot(['alert:0', 'alert:1'], t, false) === x) && !metrics.includes('id="nb-alert"'));

// --- normal sürüş paneli ile aynı ölçü
ok('rotasız sürüş paneli ve navigasyon paneli aynı en düşük yükseklikte', /.navbar, .mapsoc { box-sizing: border-box; min-height: 150px; }/.test(css));

// --- OCR ve kamera sabitleri (değişmeden korunur)
ok('OCR güncelleme aralığı 5 sn', OCR.intervalMs === 5000);
ok('OCR-1 / OCR-2 seçimi korunur', /data-ocr-engine="tess"/.test(html) && /data-ocr-engine="digit"/.test(html));
ok('kamera seçimi arayüzü yok (tek sabit geniş açı)', !/cam-(device|select|switch|lens)|<select[^>]*cam/i.test(html.slice(html.indexOf('id="cam-stage"') - 200, html.indexOf('id="cam-stage"') + 3000)));
ok('geniş açılı kamera otomatik seçilir', /pickWideDevice\(devices, cur\)/.test(read('js/sensors/camera.js')));

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
