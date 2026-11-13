// Navigasyon üst barı (v0.99.59 tasarımı): 1) büyük dönüş oku + manevra + yol adı, sağda sabit varış saati; 2) ALTI SABİT metrik
// Hız | Hız limiti | Pil | Menzil | Sonraki şarj | Varışta pil; 3) dinamik uyarı satırı (trafik/yağış/eğim/diğer; boşsa gizli).
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
ok('limit yoksa (levha gizli) -- görünür, varsa gizlenir', /\.nb-limit \.limit-sign:not\(\.hidden\) \+ \.ne-nolim \{ display: none; \}/.test(css));

// --- 5. HTML yapısı: üç satır, altı sabit metrik, sıra
const banner = html.slice(html.indexOf('id="nav-banner"'), html.indexOf('id="near-alert"'));
const man = banner.slice(banner.indexOf('class="nb-man"'), banner.indexOf('id="nav-then"'));
ok('üst satır: ok, mesafe, manevra, yol adı, sağda varış saati', ['nav-arrow', 'nav-dist', 'nav-text', 'nav-road', 'ne-eta-box', 'nh-eta', 'nh-rem'].every((id) => man.includes(`id="${id}"`)) && man.indexOf('id="nav-road"') < man.indexOf('id="ne-eta-box"'));
ok('varış saati sabit: gizli değil, dönüşüm yuvası yok', /<div class="nb-eta" id="ne-eta-box"><small>Varış<\/small><b id="nh-eta">--:--<\/b><span class="ne-sub" id="nh-rem">—<\/span><\/div>/.test(man) && !/data-slot/.test(html));
const metrics = banner.slice(banner.indexOf('id="nb-metrics"'), banner.indexOf('id="nb-alert"'));
const cells = [...metrics.matchAll(/class="nb-cell[^"]*" id="([^"]+)"/g)].map((m) => m[1]);
ok('altı sabit metrik, sırayla: Hız | Limit | Pil | Menzil | Sonraki şarj | Varışta', cells.join() === 'nb-speed,ne-limit-box,ne-soc-btn,ne-range-box,ne-next-box,ne-arrive-box', cells.join());
ok('metrik hücreleri hiç gizlenmez (sabit)', !/class="nb-cell[^"]*hidden/.test(metrics));
ok('etiketler: Hız, Limit, Pil, Menzil, Sonraki şarj, Varışta', ['<small>Hız</small>', '<small>Limit</small>', '<small>Pil</small>', '<small>Menzil</small>', '<small>Sonraki şarj<span', '<small>Varışta</small>'].every((s) => metrics.includes(s)));
ok('değer kimlikleri tek: nh-speed, nh-limit, ne-soc, ne-range, ne-next, ne-arrive', ['nh-speed', 'nh-limit', 'ne-soc', 'ne-range', 'ne-next', 'ne-arrive'].every((id) => metrics.includes(`id="${id}"`) && (html.match(new RegExp(`id="${id}"`, 'g')) || []).length === 1));
ok('pil hücresi pil penceresini açan düğme', /<button type="button" class="nb-cell" id="ne-soc-btn" aria-haspopup="dialog" aria-controls="soc-sheet">/.test(metrics));
ok('uyarı satırı metriklerin altında, başta gizli', banner.indexOf('id="nb-metrics"') < banner.indexOf('id="nb-alert"') && /<div class="nb-alert hidden" id="nb-alert" role="status" aria-live="off"><\/div>/.test(banner));
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

// --- 8. Mobil okunurluk ve tema (360/375/390 px)
ok('altı sütun tek satır, sonraki şarj daha geniş', /\.nb-metrics \{ display: grid; grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\) minmax\(0, 1\.15fr\) minmax\(0, 1\.1fr\) minmax\(0, 1\.5fr\) minmax\(0, 1\.1fr\);/.test(css));
ok('metrik değerleri en az 18 px, hız en az 22 px', /\.nb-metrics \.ne-v b \{ font-size: clamp\(18px, 5\.4vw, 22px\);/.test(css) && /\.nb-metrics \.nb-speed \.ne-v b \{ font-size: clamp\(22px, 6\.6vw, 28px\);/.test(css));
ok('pil düğmesi dokunma hedefi ≥ 44 px', /\.nb-metrics \.nb-cell \{[^}]*min-height: 44px;/.test(css));
ok('taşan metin … ile kesilir (yarım rakam yok)', /\.nb-metrics \.nb-cell small \{[^}]*text-overflow: ellipsis;/.test(css));
ok('renkler tema değişkenlerinden (açık/koyu)', /\.nb-metrics \{[^}]*border-top: 1px solid var\(--line\);/.test(css) && /\.nb-eta small \{[^}]*color: var\(--muted\);/.test(css));
ok('harita alanı: en düşük yükseklik değişmedi (150 px)', /\.navbar, \.mapsoc \{ box-sizing: border-box; min-height: 150px; \}/.test(css));

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
