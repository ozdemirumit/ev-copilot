// Navigasyon üst barı (v0.99.91 tasarımı): TEK panel, iki yarı. Sol: büyük dönüş oku + canlı mesafe, altında talimat ve yol adı (aynı boy).
// Sağ: DÖRT SABİT temel metrik Hız (+limit levhası) | Pil (+menzil) / Varış saati (+varışta pil, kalan km) | Sonraki şarj;
// altında AYRI dönüşümlü uyarı alanı (trafik/yağış/eğim/plan/hız aşımı, 3 sn; boşsa gizli). Metrikler dönmez, gizlenmez.
// Pil güveni: live/manual/sim güvenilir, stale/estimate yaklaşık (≈), default/none ya da ocr.contested ise menzil '--'.
// Kullanım: node scripts/test-nav-topbar.mjs
import { readFileSync } from 'node:fs';
import { socTrust, topMetrics, nextChargeText, nextChargeView, pickSlot, NO_STOP } from '../js/nav/panelLogic.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html');
const css = read('css/styles.css');
const nav = read('js/nav/navigator.js');
const ahead = read('js/nav/ahead.js');
const limitJs = read('js/nav/speedLimit.js');
const state = read('js/state.js');

// --- 1. Pil güveni (saf)
ok('live/manual/sim güvenilir', ['live', 'manual', 'sim'].every((s) => socTrust(s, null) === 'trusted'));
ok('stale/estimate yaklaşık', ['stale', 'estimate'].every((s) => socTrust(s, null) === 'approx'));
ok('default/none/bilinmeyen güvenilmez', ['default', 'none', undefined, null, 'ocr', ''].every((s) => socTrust(s, null) === 'none'));
ok('kamera okuması çelişkiliyse (contested) canlı/eski kamera güvenilmez', socTrust('live', 47) === 'contested' && socTrust('stale', 47) === 'contested');
ok('elle girilen ve Test Modu değeri çelişkiden etkilenmez', socTrust('manual', 47) === 'trusted' && socTrust('sim', 47) === 'trusted');
ok('contested 0 da çelişkidir (null/undefined değil)', socTrust('live', 0) === 'contested' && socTrust('live', undefined) === 'trusted');

// --- 2. Üst bar pil / menzil / varışta pil (saf): mevcut hesap değerleri yalnızca süzülür, yeniden hesaplanmaz
const base = { soc: 54.6, rangeKm: 212.4, arriveSoc: 18.4 };
const tr = topMetrics({ ...base, source: 'live', contested: null });
ok('güvenilir: pil, menzil, varışta pil yuvarlanmış, ≈ yok', tr.soc === 55 && tr.range === 212 && tr.arrive === 18 && tr.approx === false && tr.trust === 'trusted', JSON.stringify(tr));
const ap = topMetrics({ ...base, source: 'estimate', contested: null });
ok('tahmin/eski kamera: değerler gösterilir ama yaklaşık (≈)', ap.soc === 55 && ap.range === 212 && ap.arrive === 18 && ap.approx === true, JSON.stringify(ap));
const df = topMetrics({ ...base, source: 'default', contested: null });
ok('varsayılan pil: pil, menzil, varışta pil --', df.soc === null && df.range === null && df.arrive === null, JSON.stringify(df));
ok('pil yok: hepsi --', Object.values(topMetrics({ ...base, source: 'none' })).filter((v) => typeof v === 'number').length === 0);
const ct = topMetrics({ ...base, source: 'live', contested: 47 });
ok('çelişkili kamera: pil ≈ ile, menzil ve varışta pil -- (yanlış pille yanlış menzil yok)', ct.soc === 55 && ct.approx === true && ct.range === null && ct.arrive === null, JSON.stringify(ct));
ok('menzil hesabı yoksa --', topMetrics({ ...base, rangeKm: null, source: 'live' }).range === null && topMetrics({ ...base, rangeKm: NaN, source: 'live' }).range === null);
ok('negatif menzil 0\'a kırpılır', topMetrics({ ...base, rangeKm: -3, source: 'live' }).range === 0);
ok('pil değeri yoksa menzil/varış da yok', (() => { const m = topMetrics({ ...base, soc: null, source: 'live' }); return m.soc === null && m.range === null && m.arrive === null; })());
ok('plan varış pili yoksa --; negatif varış pili korunur (ulaşamazsın bilgisi)', topMetrics({ ...base, arriveSoc: null, source: 'live' }).arrive === null && topMetrics({ ...base, arriveSoc: -4.4, source: 'live' }).arrive === -4);
ok('pil 0..100 aralığında', topMetrics({ ...base, soc: 104, source: 'live' }).soc === 100 && topMetrics({ ...base, soc: -1, source: 'live' }).soc === 0);

// --- 3. Sonraki şarj metni (saf): rota üstü km, 'Durak yok', güvenilmezse --
const stop = { km: 142.6, arriveSoc: 23, station: { id: 's1', name: 'Örnek' } };
ok('rota üstü kalan km (kuş uçuşu değil: durak km − araç rota km)', nextChargeText(nextChargeView(stop, 100.2, 'live'), { ready: true, reliable: true }) === '42 km');
ok('konum ilerledikçe azalır', nextChargeText(nextChargeView(stop, 130, 'live'), { ready: true, reliable: true }) === '13 km');
ok('plan hazır ve sıradaki durak yok: Durak yok', nextChargeText(null, { ready: true, reliable: true }) === NO_STOP && NO_STOP === 'Durak yok');
ok('plan hesaplanıyorsa --', nextChargeText(null, { ready: false, reliable: true }) === '--' && nextChargeText(nextChargeView(stop, 100, 'live'), { ready: false, reliable: true }) === '--');
ok('rota/konum güvenilmezse (rotadan çıkış, konum yok) --', nextChargeText(nextChargeView(stop, 100, 'live'), { ready: true, reliable: false }) === '--' && nextChargeText(null, { ready: true, reliable: false }) === '--');
ok('navigator: sıradaki durak 300 m kuralı korunur', /const nextStop = plan\.stops\.find\(\(s\) => s\.km > km \+ 0\.3\);/.test(nav));
ok('navigator: konum rota üstü locate(track) km\'sinden', /const loc = locate\(track, e\.lat, e\.lon, trackKm\);\s*const km = loc\.km;/.test(nav));
ok('navigator: sonraki şarj nextChargeText ile, ready = plan.status === \'ready\'', /nextChargeText\(v, \{ ready: plan\.status === 'ready', reliable \}\)/.test(nav));
for (const [why, re] of [
  ['rota hesaplanıyor', /plan\.status === 'loading'\) \{\s*blankTrip\(plan, e\);/],
  ['plan yok', /if \(!plan\.profile \|\| !plan\.steps\?\.length\) \{ blankTrip\(plan, e\);/],
  ['konum yok', /if \(!track \|\| e\.lat == null\) \{ blankTrip\(plan, e\);/],
  ['rotadan çıkış', /if \(loc\.offKm > lim\) \{\s*blankTrip\(plan, e\);/],
]) ok(`güvenilmez durumda (${why}) sonraki şarj/varış eski değerde kalmaz`, re.test(nav));
ok('blankTrip: sonraki şarj güvenilmez (--) ve varış saati --:--', /function blankTrip\(plan, e\) \{[\s\S]*?paintCharge\(plan, null, null, e, false\);[\s\S]*?\$\('nh-eta'\)\.textContent = '--:--';/.test(nav));
ok('navigator: durak yoksa "Durak yok" çevrilerek yazılır', /t\(NO_STOP\)/.test(nav));

// --- 4. Hız limiti: yoksa --, sorgu varsayılan kapalı (ücretli API maliyeti), speedLimit.js boyar
ok('limit sorgusu varsayılan KAPALI', /limitOn: load\('limitOn', false\)/.test(state));
ok('levha speedLimit.js tarafından nh-limit\'e boyanır (yeniden yazılmadı)', /for \(const id of \['hud-limit', 'nh-limit'\]\)/.test(limitJs));
ok('limit yoksa kesik çizgili boş daire gösterilmez (v0.99.113); limit varsa rozet hız kutusunun sağ üstünde', /\.nb-limit \.ne-nolim \{ display: none; \}/.test(css) && /\.nb-limit \{ position: absolute; top: -16px; right: -18px;/.test(css));

// --- 5. HTML yapısı (v0.99.91): TEK panel, iki yarı. Sol: ok + canlı mesafe, talimat, yol adı. Sağ: dört sabit temel metrik + ayrı uyarı alanı.
const banner = html.slice(html.indexOf('id="nav-banner"'), html.indexOf('id="near-alert"'));
const left = banner.slice(banner.indexOf('class="nb-left"'), banner.indexOf('class="nb-right"'));
const right = banner.slice(banner.indexOf('class="nb-right"'));
const metrics = banner.slice(banner.indexOf('id="nb-metrics"'), banner.indexOf('id="nb-alert"'));
ok('tek panel iki yarı: nav-banner içinde önce .nb-left sonra .nb-right', banner.includes('<div class="nb-left">') && banner.includes('<div class="nb-right">') && banner.indexOf('class="nb-left"') < banner.indexOf('class="nb-right"'));
ok('sol yarı: ok, canlı mesafe, talimat, yol adı, şerit; metrik yok', ['nav-arrow', 'nav-dist', 'nav-text', 'nav-road', 'nav-lanes'].every((id) => left.includes(`id="${id}"`))
  && !['nh-speed', 'ne-soc', 'nh-eta', 'ne-next', 'ne-arrive', 'nb-alert'].some((id) => left.includes(`id="${id}"`)));
ok('sol yarı: ok ile mesafe üst satırda (.nb-head), talimat ve yol adı altında', /<div class="nb-head">\s*<div class="nav-arrow" id="nav-arrow"[\s\S]*?<div class="nav-dist" id="nav-dist"><\/div>\s*<\/div>/.test(left)
  && left.indexOf('id="nav-dist"') < left.indexOf('id="nav-text"') && left.indexOf('id="nav-text"') < left.indexOf('id="nav-road"'));
ok('sağ yarı: önce sabit metrikler (#nb-metrics), altında ayrı uyarı alanı (#nb-alert)', right.includes('<div class="nb-metrics" id="nb-metrics">') && right.indexOf('id="nb-metrics"') < right.indexOf('id="nb-alert"'));
const cells = [...metrics.matchAll(/class="nb-cell[^"]*" id="([^"]+)"/g)].map((m) => m[1]);
ok('dört sabit temel metrik, sırayla: Hız | Pil / Varış | Sonraki şarj', cells.join() === 'nb-speed,ne-soc-btn,ne-eta-box,ne-next-box', cells.join());
ok('metrik hücreleri hiç gizlenmez (sabit)', !/class="nb-cell[^"]*hidden/.test(metrics) && !/id="(nb-speed|ne-soc-btn|ne-eta-box|ne-next-box)"[^>]*hidden/.test(metrics));
const cell = (id) => { const i = metrics.indexOf(`id="${id}"`); const nx = cells.map((c) => metrics.indexOf(`id="${c}"`)).filter((j) => j > i); return metrics.slice(i, nx.length ? Math.min(...nx) : metrics.length); };
ok('Hız hücresi: hız, hız limiti levhası (yoksa --), ortalama hız', ['nh-speed', 'ne-limit-box', 'nh-limit', 'nh-avg', 'nh-avg-v'].every((id) => cell('nb-speed').includes(`id="${id}"`)) && /class="ne-nolim">--</.test(cell('nb-speed')));
ok('Pil hücresi: pil ve menzil (km)', ['ne-soc', 'ne-range'].every((id) => cell('ne-soc-btn').includes(`id="${id}"`)) && /<b id="ne-range">--<\/b> km<\/span>/.test(cell('ne-soc-btn')));
ok('Varış hücresi: varış saati, varışta pil, kalan km', /<small>Varış<\/small>/.test(cell('ne-eta-box')) && ['nh-eta', 'ne-arrive', 'nh-rem'].every((id) => cell('ne-eta-box').includes(`id="${id}"`))
  && cell('ne-eta-box').indexOf('id="nh-eta"') < cell('ne-eta-box').indexOf('id="ne-arrive"'));
ok('Sonraki şarj hücresi: ad, km, alt satır', ['ne-next-n', 'ne-next', 'ne-next-t'].every((id) => cell('ne-next-box').includes(`id="${id}"`)));
ok('etiketler: Hız, Pil, Varış, Sonraki şarj', ['<small>Hız</small>', '<small>Pil</small>', '<small>Varış</small>', '<small>Sonraki şarj<span'].every((s) => metrics.includes(s)));
ok('değer kimlikleri tek: nh-speed, nh-limit, ne-soc, ne-range, nh-eta, nh-rem, ne-arrive, ne-next', ['nh-speed', 'nh-limit', 'ne-soc', 'ne-range', 'nh-eta', 'nh-rem', 'ne-arrive', 'ne-next'].every((id) => metrics.includes(`id="${id}"`) && (html.match(new RegExp(`id="${id}"`, 'g')) || []).length === 1));
ok('pil hücresi pil penceresini açan düğme', /<button type="button" class="nb-cell" id="ne-soc-btn" aria-haspopup="dialog" aria-controls="soc-sheet">/.test(metrics));
ok('uyarı alanı sağ yarıda metriklerin altında, başta gizli', /<div class="nb-alert hidden" id="nb-alert" role="status" aria-live="off"><\/div>/.test(right) && !left.includes('nb-alert'));
ok('ayrı ikinci tam genişlik metrik satırı yok: #nb-metrics yalnız .nb-right içinde, kenar çizgili tam genişlik kuralı yok',
  banner.indexOf('id="nb-metrics"') > banner.indexOf('class="nb-right"') && !/\.nb-metrics \{[^}]*border-top/.test(css) && !/\.navbar > \.nb-alert \{ grid-column: 1 \/ -1; \}/.test(css));
ok('eski gizli alt satır (.nb-trip / #nh-dur) kaldırıldı, JS de yazmıyor', !html.includes('nb-trip') && !html.includes('id="nh-dur"') && !/nh-dur/.test(nav) && !/\.nb-trip/.test(css));
ok('eski üst satır varış kutusu (.nb-eta) kaldırıldı (varış sağ yarıdaki hücrede)', !/class="nb-eta"/.test(html) && !/\.nb-eta[ .{]/.test(css));
ok('canlı mesafe sayacı korunur (paint nav-dist yazar)', /\$\('nav-dist'\)\.textContent = dist;/.test(nav));
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
ok('index.html kimlikleri benzersiz', ids.length === new Set(ids).size);

// --- 6. Uyarı satırı: yalnızca gerçek uyarılar dönüşümlü (trafik, yağış, eğim, plan uyarısı, hız aşımı); boşsa gizli
ok('uyarı kaynakları: plan uyarısı, trafik, yağış, eğim', /adv\.text : null, a\.traffic, a\.rain, a\.grade\]/.test(nav));
ok('eğim uyarısı sarı şeritte tekrar gösterilmez (yalnızca hız kamerası)', /const lines = \[a\.cam\]\.filter\(Boolean\);/.test(ahead));
ok('uyarı yoksa satır gizli (pickSlot null)', pickSlot([], 0, false) === null && /el\.classList\.toggle\('hidden', !text\);/.test(nav));
ok('metrikler dönüşümde değil (data-slot gizleme döngüsü yok)', !/querySelectorAll\('\[data-slot\]'\)/.test(nav));

// --- 7. Pil güveninin navigator'a bağlanması
ok('navigator: üst bar topMetrics ile, kaynak socSource()/Test Modu ve ocr.contested', /topMetrics\(\{ soc: e\.soc, source: src, contested: getState\('ocr'\)\.contested, rangeKm: getState\('engine'\)\.totalRangeKm, arriveSoc: plan\.totals\?\.arriveSoc \}\)/.test(nav) && /const src = e\.source === 'sim' \? 'sim' : socSource\(\);/.test(nav));
ok('yaklaşık değerler ≈ ile işaretlenir', /classList\.toggle\('approx', m\.approx && m\.soc != null && v != null\)/.test(nav) && /b\.approx::before \{ content: '≈';/.test(css));

// --- 8. Mobil okunurluk ve tema (360/375/390 px): iki yarı, sağda 2×2 metrik
const lastIdx = (re) => { let i = -1, m; const g = new RegExp(re.source, 'g'); while ((m = g.exec(css))) i = m.index; return i; };
const stack = '.navbar { --nav-blue: #2f6bd9; display: flex; flex-direction: column; gap: 0; padding: 0; overflow: hidden; align-items: stretch; }'; // v0.99.113: B tasarımı, dikey yığın
ok('panel dikey yığın (v0.99.113 B: mavi manevra bloğu + beyaz metrik şeridi) ve eski iki yarı ızgara kurallarından SONRA', css.includes(stack) && css.indexOf(stack) > lastIdx(/(?<![ \t])\.navbar \{ grid-template-columns:/));
ok('alt bölüm: metrikler üstte, uyarı altta (sütun)', /\.nb-right \{ display: flex; flex-direction: column; gap: 8px; min-width: 0; padding: 8px 12px 10px; \}/.test(css));
ok('metrikler tek satırda üç eşit sütun', /\.nb-metrics \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/.test(css));
ok('metrik değerleri en az 15 px (hücreye göre 22 px üst sınır), hız kutusunda 28 px', /\.nb-metrics \.ne-v b \{ font-size: min\(22px, max\(15px, 22cqi\)\);/.test(css) && /\.nb-metrics \.nb-speed \.ne-v b \{ font-size: 28px;/.test(css));
ok('hız kutusu panelden çıkar: #nb-speed DOM\'da #nb-metrics içinde (kimlikler korunur), konumu fixed, sol altta alt çubuğun üstünde', /<div class="nb-metrics" id="nb-metrics">[\s\S]*?<div class="nb-cell nb-speed" id="nb-speed">/.test(html) && /\.nb-metrics \.nb-speed \{ position: fixed; z-index: 1; left: max\(10px, env\(safe-area-inset-left, 0px\)\); bottom: calc\(var\(--nav-h\) \+ var\(--safe-b\) \+ 40px\);/.test(css));
ok('hız aşımı: kutu kenarı ve rakam kırmızı', /\.nb-speed\.over \{ border-color: #e53935; \}/.test(css) && /\.nb-speed\.over \.ne-v b \{ color: #e53935; \}/.test(css));
ok('varışta pil ve menzil alt satırda da okunur (≥ 14 px, kalın)', /\.nb-metrics \.ne-sub b \{ font-size: 14px; font-weight: 800; color: var\(--text\);/.test(css) && css.indexOf('.nb-metrics .ne-sub b {') > css.indexOf('.nb-metrics .ne-v b {'));
ok('pil düğmesi dokunma hedefi ≥ 44 px', /\.nb-metrics \.nb-cell \{[^}]*min-height: 44px;/.test(css));
ok('taşan metin … ile kesilir (yarım rakam yok)', /\.nb-metrics \.nb-cell small \{[^}]*text-overflow: ellipsis;/.test(css));
ok('yol adı 20 px kalın, talimat 15 px (B: yol adı öne çıkar); ≤ 360 px yol adı 18 px', /\.nb-man \.nav-road \{ color: #fff; font-size: 20px; font-weight: 800;/.test(css) && /\.nb-man \.nav-text \{[^}]*font-size: 15px;/.test(css)
  && /\.nb-man \.nav-road \{ font-size: 18px; \}/.test(css));
ok('renkler tema değişkenlerinden (açık/koyu); mavi manevra bloğu sabit --nav-blue + beyaz yazı (iki temada okunur)', /\.nb-metrics \.nb-cell \{[^}]*border-left: 1px solid var\(--line\);/.test(css) && /\.nb-metrics \.nb-cell small \{[^}]*color: var\(--muted\);/.test(css) && /\.nb-metrics \.nb-speed \{[^}]*border: 1px solid var\(--line\);[^}]*background: var\(--card\);/.test(css) && /\.nb-left \{[^}]*background: var\(--nav-blue\); color: #fff;/.test(css));
ok('harita alanı: eski 150 px en düşük yükseklik kalktı, panel içeriği kadar (v0.99.113)', /\.navbar, \.mapsoc \{ box-sizing: border-box; \}/.test(css) && !/\.navbar, \.mapsoc \{[^}]*min-height: 150px/.test(css));
ok('sağ dikey kontroller ve ortala düğmesi duruyor (panelin dışında)', ['nh-limitbtn', 'nh-voice', 'nh-overview', 'nh-search', 'nh-recenter'].every((id) => (html.match(new RegExp(`id="${id}"`, 'g')) || []).length === 1) && !banner.includes('id="nh-voice"'));

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
