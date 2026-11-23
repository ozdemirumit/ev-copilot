// RM-07 dar ekran navigasyon üst barı: ÇEVRİMDIŞI YAKLAŞIK yerleşim risk sözleşmesi (yalnızca test; uygulama kodu değişmez).
// Kullanım: node scripts/test-nav-narrow-layout-contract.mjs
//
// ÖNEMLİ — bu test bir tarayıcı ölçümü DEĞİLDİR:
//  - Gerçek DOM yok, gerçek yazı tipi yok, gerçek düzen motoru yok. Genişlik/yükseklik değerleri css/styles.css kurallarından
//    elle türetilmiş bir modelle ve karakter başına yaklaşık em katsayılarıyla TAHMİN edilir.
//  - Sonuçlar "risk sınıfı"dır (SIĞAR / SINIRDA / KESİLME-RİSKİ, SIĞAR / KAYAR-RİSKİ). Hiçbir sınıf "hata düzeltildi" anlamına gelmez.
//  - Bilinen boşluklar bilerek SABİTLENDİ: test bugünkü durumu belgeler ve geçer; seçici/kural/hesap değişirse kırılır ve
//    docs/nav-narrow-layout-contract.md ile birlikte gözden geçirme ister. Gerçek kabul yalnızca fiziksel cihazda yapılır.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const css = read('css/styles.css');
const html = read('index.html');
const nav = read('js/nav/navigator.js');
const panel = read('js/nav/panelLogic.js');
const REVIEW = ' → kaynak değişti: docs/nav-narrow-layout-contract.md ve bu testteki model/sabitler gözden geçirilmeli';

// ---------------------------------------------------------------------------------------------------------------------------
// 1) Kaynak kayması koruması: modelin dayandığı kurallar birebir yerinde mi? (biri değişirse model geçersizdir → gözden geçir)
// ---------------------------------------------------------------------------------------------------------------------------
const CSS_RULES = {
  bannersMargin: '#banners > * { margin: 0 10px 6px; border-radius: 14px; border: 1px solid var(--line); box-shadow: 0 4px 18px #0009; }',
  bannersMargin2: '#banners > * { margin: 0 10px 6px; }',
  bannersTop: '#banners { margin-top: 6px; }',
  bannersBase: '#banners { flex: 0 1 auto; min-height: 0; max-height: 38dvh; overflow-y: auto; }',
  banners34: '@media (min-height: 521px) and (max-height: 640px) {\n  #banners { max-height: 34dvh; }',
  arrow: '.nb-man .nav-arrow { flex: none; font-size: 38px; width: 46px; padding-right: 8px; }',
  dist30: '.nb-man .nav-dist { font-size: 30px; }',
  avg: '.nb-metrics .nh-avg { display: inline-flex; align-items: baseline; gap: 1px; max-width: 100%; overflow: hidden; color: var(--muted); font-size: 11px; font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums; }',
  approx: ".nb-metrics b.approx::before { content: '≈'; font-size: .7em; font-weight: 600; color: var(--muted); }",
  neVBase: '.ne-v { display: flex; flex-direction: column; align-items: center; max-width: 100%; white-space: nowrap; line-height: 1.15; }',
  neVBBase: '.ne-v b { overflow: hidden; max-width: 100%; text-overflow: ellipsis; font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; }',
  nextNone: '#ne-next.none { font-size: 13px; font-weight: 700; line-height: 1.15; white-space: normal; }',
  alertBase: '.nb-alert { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; padding: 0 6px; border-block: 4px solid transparent; border-radius: 8px; background: rgba(255, 145, 0, .16); font-size: 12px; font-weight: 600; line-height: 1.25; }',
  alertBig: '.nb-alert { font-size: 15px; line-height: 1.2; }',
  narrow380: '@media (max-width: 380px) {\n  .nb-man .nav-dist { font-size: 26px; }\n  .nb-man .nav-text, .nb-man .nav-road { font-size: 16px; }\n  .nb-cell .ne-v b { font-size: 21px; }\n  .nb-cell .ne-sub, .nb-alert { font-size: 14px; }',
  manText: '.nb-man .nav-text, .nb-man .nav-road { font-size: 18px; font-weight: 700; line-height: 1.2; color: var(--text); white-space: normal; overflow: hidden; text-overflow: clip; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }',
  navDist: '.nav-dist { font-size: 30px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.1; }',
  lanes: '.nav-lanes { display: flex; gap: 3px; margin-top: 4px; }',
  laneItem: '.nav-lanes .ln { min-width: 22px; padding: 1px 3px; border-radius: 5px; text-align: center; font-size: 16px; font-weight: 700; line-height: 1.3;',
  body: 'font: 15px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;',
  tog: '.tog { flex: none; width: 30px; height: 30px; padding: 0; border-radius: 8px;',
  tpTog: '.tp-head .tog { width: 36px; height: 36px; }',
  closePos: '#near-alert-close { position: relative; }',
  closeHit: '#near-alert-close::after { content: ""; position: absolute; inset: -5px; }',
  boxSizing: '* { box-sizing: border-box;',
  togBorder: 'border: 1px solid var(--line); background: var(--card-2); color: var(--muted); font-size: 18px; line-height: 1; }',
  tpHead: '.tp-head { display: flex; align-items: center; gap: 6px; }',
  tpList: '.tp-head .tog-list { display: inline-flex; align-items: center; justify-content: center; gap: 2px; width: auto; min-width: 66px; height: 40px;',
  nearBodyGap: '.tp-charge .near-body { margin-top: 4px; }',
  toppanel: '.toppanel { background: rgba(22, 27, 35, .97); overflow: hidden; }',
  // v0.99.113 B tasarımı (mavi manevra bloğu + üç eşit metrik sütunu + hız kutusu haritada; rotasız panel de aynı dil)
  bNav: ".navbar { --nav-blue: #2f6bd9; display: flex; flex-direction: column; gap: 0; padding: 0; overflow: hidden; align-items: stretch; }",
  bLeft: ".nb-left { gap: 0; padding: 10px 14px; background: var(--nav-blue); color: #fff; justify-content: center; }",
  bMan: ".nb-man { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: 12px; row-gap: 0; align-items: center; }",
  bHead: ".nb-head { display: contents; }",
  bArrow: ".nb-man .nav-arrow { grid-column: 1; grid-row: 1 / span 2; align-self: center; font-size: 46px; width: 52px; padding: 0; border: 0; color: #fff; }",
  bDist: ".nb-man .nav-dist { grid-column: 2; font-size: 38px; font-weight: 800; line-height: 1.05; color: #fff; }",
  bText: ".nb-man .nav-text { color: rgba(255, 255, 255, .9); font-size: 15px; font-weight: 600; line-height: 1.2; -webkit-line-clamp: 2; overflow-wrap: anywhere; word-break: normal; }",
  bRoad: ".nb-man .nav-road { color: #fff; font-size: 20px; font-weight: 800; line-height: 1.2; -webkit-line-clamp: 2; overflow-wrap: anywhere; word-break: normal; }",
  bRight: ".nb-right { display: flex; flex-direction: column; gap: 8px; min-width: 0; padding: 8px 12px 10px; }",
  bGrid: ".nb-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: stretch; }",
  bCell: ".nb-metrics .nb-cell { container-type: inline-size; align-items: flex-start; justify-content: flex-start; min-height: 44px; padding: 0 0 0 10px; border: 0; border-left: 1px solid var(--line); text-align: left; }",
  bCellFirst: ".nb-metrics .nb-speed + .nb-cell { padding-left: 0; border-left: 0; }",
  bSmall: ".nb-metrics .nb-cell small { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; max-width: 100%; overflow: hidden; color: var(--muted); font-size: 11px; font-weight: 600; line-height: 1.15; text-overflow: ellipsis; word-break: break-word; }",
  bNeV: ".nb-metrics .ne-v { display: flex; flex-direction: column; align-items: flex-start; max-width: 100%; line-height: 1.1; }",
  bVal: ".nb-metrics .ne-v b { font-size: min(22px, max(15px, 22cqi)); font-weight: 800; letter-spacing: -.3px; white-space: normal; overflow-wrap: anywhere; text-overflow: clip; } /* değer hücre genişliğine göre küçülür, … ile kesilmez */",
  bNext: ".nb-metrics .nb-next .ne-v b { font-size: min(22px, max(15px, 19cqi)); } /* \"1234 km\" yüzdeden uzun: tek satıra sığsın */",
  bSub: ".nb-metrics .ne-sub, #ne-next-t { max-width: 100%; color: var(--muted); font-size: 12px; font-weight: 600; line-height: 1.15; white-space: normal; overflow-wrap: anywhere; text-overflow: clip; }",
  bSubB: ".nb-metrics .ne-sub b { font-size: 14px; font-weight: 800; color: var(--text); letter-spacing: 0; }",
  bAlert: ".nb-alert { margin: 0; padding: 7px 10px; border: 0; border-radius: 10px; -webkit-line-clamp: 2; font-size: 15px; font-weight: 600; line-height: 1.25; overflow-wrap: anywhere; }",
  bSpeedBox: ".nb-metrics .nb-speed { position: absolute; z-index: 1; top: 8px; right: 10px; width: 112px; box-sizing: border-box; padding: 4px 6px 5px; align-items: center; border: 1px solid var(--line); border-radius: 14px; background: var(--card); box-shadow: 0 2px 10px #0006; text-align: center; }",
  bSpeedRow: ".nb-metrics .nb-speed .ne-v { flex-direction: row; align-items: center; justify-content: center; gap: 6px; }",
  bSpeedVal: ".nb-metrics .nb-speed .ne-v b { font-size: 28px; line-height: 1; font-weight: 800; letter-spacing: -.5px; }",
  bSpeedOver: ".nb-speed.over { border-color: #e53935; }",
  bLimit: ".nb-limit { display: flex; align-items: center; }",
  bLimitSign: ".nb-limit .limit-sign { width: 40px; height: 40px; border-width: 4px; font-size: 15px; letter-spacing: -.5px; }",
  bNoLim: ".nb-limit .ne-nolim { display: none; }",
  bN360: "@media (max-width: 360px) {\n  .nb-left { padding: 8px 10px; }\n  .nb-man { column-gap: 8px; }\n  .nb-man .nav-arrow { font-size: 40px; width: 44px; }\n  .nb-man .nav-dist { font-size: 32px; }\n  .nb-man .nav-road { font-size: 18px; }\n  .nb-right { padding: 6px 8px 8px; }\n  .nb-metrics .nb-cell { padding-left: 6px; }\n}",
  bMaxH: "@media (max-height: 520px) {\n  .nb-left { padding: 6px 12px; }\n  .nb-man .nav-arrow { font-size: 34px; width: 40px; }\n  .nb-man .nav-dist { font-size: 28px; }\n  .nb-man .nav-text { display: none; }\n  .nb-man .nav-road { font-size: 16px; -webkit-line-clamp: 1; }\n  .nb-right { gap: 6px; padding: 6px 10px 8px; }\n  .nb-metrics .ne-v b { font-size: 17px; }\n  .nb-metrics .nb-speed { top: 6px; }\n  .nb-metrics .nb-speed .ne-v b { font-size: 22px; }\n}",
  bMapsocBase: ".navbar, .mapsoc { --nav-blue: #2f6bd9; }",
  bMapsoc: "  .mapsoc { padding: 0; overflow: hidden; }",
  bMapsocBar: "  .mapsoc .socbar { padding: 10px 14px; background: var(--nav-blue); color: #fff; }",
  bMapsocLow: "  .mapsoc .socbar.low { background: #b45f06; }",
  bMapsocLowBatt: "  .mapsoc .socbar.low .socbar-batt { color: #fff; border-color: #fff; }",
  bMapsocVal: "  .mapsoc #socbar-val { font-size: clamp(26px, 8vw, 32px); }",
  bMapsocMain: "  .mapsoc .socbar-main { height: 36px; }",
  bMapsocSlider: "  .mapsoc-slider { padding: 8px 14px 10px; }",
  navbarBox: "  .navbar, .mapsoc { box-sizing: border-box; }",
};
for (const [k, s] of Object.entries(CSS_RULES)) ok(`kaynak: css ${k} kuralı birebir yerinde`, css.includes(s), REVIEW);

// Kademe (cascade) varsayımları: aynı özgüllükte sonraki kural kazanır → model bu sırayı varsayar
const at = (s) => css.indexOf(s);
ok('kaynak: B bloğu eski iki yarılı ızgara kurallarından SONRA (dikey yığın kazanır)', at(CSS_RULES.bNav) > at('.navbar { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 6px 10px; padding: 8px 10px 6px; align-items: stretch; }'), REVIEW);
ok('kaynak: .nb-alert 15px kuralı ≤380 px 14px kuralından önce (dar ekranda 14px)', at(CSS_RULES.alertBig) < at(CSS_RULES.narrow380) && css.includes('@media (max-width: 380px) { .nb-alert { font-size: 14px; } }'), REVIEW);
// Dar ekranda bu öğeleri etkileyen yeni bir @media eklenmiş mi? (sayım sabit; değişirse gözden geçir)
const count = (re) => (css.match(re) || []).length;
ok('kaynak: "#ne-soc" css geçişi sayısı 1 (renk)', count(/#ne-soc\b/g) === 1, `${count(/#ne-soc\b/g)}${REVIEW}`);
ok('kaynak: "#ne-next" (.none) css\'te bir kez, "#ne-next-t" iki kez (v0.99.103 sarma kuralı)', count(/#ne-next(?![-\w])/g) === 1 && count(/#ne-next-t(?![-\w])/g) === 2, REVIEW);
ok('kaynak: "#near-alert-close" css\'te yalnızca dokunma alanı için 2 kez (position + ::after; görünür boyut .tp-head .tog)', count(/#near-alert-close/g) === 2, `${count(/#near-alert-close/g)}${REVIEW}`);
ok('kaynak: "nb-alert" css geçişi sayısı 9 (v0.99.113)', count(/nb-alert/g) === 9, `${count(/nb-alert/g)}${REVIEW}`);
ok('kaynak: "nb-metrics" css geçişi sayısı 23 (v0.99.113)', count(/nb-metrics/g) === 23, `${count(/nb-metrics/g)}${REVIEW}`);
ok('kaynak: ".nb-right" css\'te 3 kez, ".nb-head" 1 kez (v0.99.113 B: dikey yığın)', count(/\.nb-right\b/g) === 3 && count(/\.nb-head\b/g) === 1, REVIEW);

const HTML_FRAGS = [
  '<div class="nb-metrics" id="nb-metrics">',
  '<div class="nb-cell nb-speed" id="nb-speed"><small>Hız</small><div class="ne-v"><b id="nh-speed">0</b><div class="nb-limit" id="ne-limit-box" title="Yol hız limiti"><div class="limit-sign hidden" id="nh-limit" title="Yol hız limiti"></div><small class="ne-nolim">--</small></div></div><span class="nh-avg" id="nh-avg" title="Ortalama hız"><small data-i18n-skip>Ø</small><b id="nh-avg-v">--</b></span></div>',
  '<div class="nb-head">',
  '<button type="button" class="nb-cell" id="ne-soc-btn" aria-haspopup="dialog" aria-controls="soc-sheet"><small>Pil</small><span class="ne-v"><b id="ne-soc">--</b><span class="ne-sub" id="ne-range-box" title="Menzil"><b id="ne-range">--</b> km</span></span></button>',
  '<div class="nb-right">',
  '<div class="nb-cell nb-next" id="ne-next-box"><small>Sonraki şarj<span class="ne-name" id="ne-next-n" data-i18n-skip></span></small><span class="ne-v"><b id="ne-next">--</b><span class="ne-sub" id="ne-next-t"></span></span></div>',
  '<div class="nb-cell" id="ne-eta-box"><small>Varış</small><span class="ne-v"><b id="nh-eta">--:--</b><span class="ne-sub"><b id="ne-arrive">--</b> · <span id="nh-rem">—</span></span></span></div>',
  '<div class="nb-alert hidden" id="nb-alert" role="status" aria-live="off"></div>',
  '<button class="tog" id="near-alert-close" type="button" aria-label="Uyarıyı kapat (10 dk)">',
];
HTML_FRAGS.forEach((s, i) => ok(`kaynak: index.html parça #${i + 1} birebir yerinde`, html.includes(s), REVIEW));
// İki yarı ve dört metrik hücresinin sırası (2×2 ızgara sütunu ↔ hücre eşleşmesi buna dayanır: sütun 0 = Hız, Varış; sütun 1 = Pil, Sonraki şarj)
const order = ['class="nb-left"', 'id="nav-dist"', 'class="nb-right"', 'id="nb-speed"', 'id="ne-soc-btn"', 'id="ne-eta-box"', 'id="ne-next-box"', 'id="nb-alert"'].map((s) => html.indexOf(s));
ok('kaynak: sol yarı → sağ yarı; hücre sırası Hız|Pil / Varış|Sonraki şarj; uyarı en altta', order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), REVIEW);

ok("kaynak: pil metni Intl yüzde biçimi (tr: '%100')", nav.includes("const pct = (v) => new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(v / 100);"), REVIEW);
ok("kaynak: ne-soc 'approx' sınıfı ≈ öneki için açılır", nav.includes("el.classList.toggle('approx', m.approx && m.soc != null && v != null);") && nav.includes("put('ne-soc', m.soc, pct(m.soc));"), REVIEW);
ok('kaynak: sonraki şarj değeri "<km> km" biçiminde', panel.includes('return view ? `${view.km.toFixed(0)} km` : NO_STOP;'), REVIEW);
ok('kaynak: sonraki şarj alt satırı "pil · süre"', nav.includes("const sub = v ? `${v.soc == null ? '--' : pct(v.soc)} · ${fmtMin("), REVIEW);
ok("kaynak: tr yüzde biçimi '%100' (bu Node'un Intl'i)", new Intl.NumberFormat('tr', { style: 'percent', maximumFractionDigits: 0 }).format(1) === '%100');

// ---------------------------------------------------------------------------------------------------------------------------
// 2) Yaklaşık genişlik modeli (TAHMİN) — v0.99.113 B tasarımı: mavi manevra bloğu + altında üç EŞİT metrik sütunu (pil | varış | sonraki şarj).
//    Karakter genişlikleri em cinsinden, kalın sistem yazı tipi için TUTUCU üst değerler; "iyimser" = ×0.88.
//    Gerçek yazı tipi (Roboto / SF / Samsung One) farklıdır; gerçek değer bilinmiyor.
// ---------------------------------------------------------------------------------------------------------------------------
const EM = { digit: 0.60, '%': 0.95, ' ': 0.27, '·': 0.30, '≈': 0.62, Ø: 0.78, '-': 0.36, letter: 0.60 };
const OPTIMISTIC = 0.88;
const charEm = (c) => (/[0-9]/.test(c) ? EM.digit : EM[c] ?? EM.letter);
const textW = (txt, px, ls = 0) => [...txt].reduce((w, c) => w + charEm(c) * px + ls, 0);
const N360 = (W) => W <= 360;
// Panel genişliği: W − #banners>* yatay kenar (2×10, çentiksiz) − kenarlık (2×1); .navbar dolgusuz (blok ve şerit kendi dolgusunu taşır)
const panelW = (W) => W - 20 - 2;
// Mavi blok: yatay dolgu 2×14 (≤360 px 2×10); ok sütunu 52 + 12 boşluk (≤360 px 44 + 8)
const blueInner = (W) => panelW(W) - (N360(W) ? 20 : 28);
const arrowCol = (W) => (N360(W) ? 44 + 8 : 52 + 12);
// Metrik şeridi: yatay dolgu 2×12 (≤360 px 2×8), üç eşit sütun; hücre sol dolgusu 10 px (≤360 px 6) + 1 px sol çizgi (ilk hücrede ikisi de yok)
const colW = (W) => (panelW(W) - (N360(W) ? 16 : 24)) / 3;
const cellInner = (W, i) => colW(W) - (i === 0 ? 0 : (N360(W) ? 6 : 10) + 1);
// Değer yazısı hücre genişliğine bağlı (cqi ≈ hücre iç genişliği): min(22, max(15, 0.22·hücre)); sonraki şarj min(22, max(15, 0.19·hücre))
const valPx = (W, i) => Math.min(22, Math.max(15, 0.22 * cellInner(W, i)));
const nextPx = (W) => Math.min(22, Math.max(15, 0.19 * cellInner(W, 2)));
// Hız kutusu (haritada, sabit 76 px): iç genişlik = 76 − 2×4 dolgu − 2×1 kenarlık
const SPEED_BOX = 76 - 8 - 2;
const classify = (need, avail) => (need <= avail ? 'SIĞAR' : need * OPTIMISTIC <= avail ? 'SINIRDA' : 'KESİLME-RİSKİ');

const WIDTHS = [360, 375, 399, 412];
const distPx = (W) => (N360(W) ? 32 : 38); // v0.99.113: mesafe 38px; ≤360 px 32px
const CASES = {
  // Pil (sütun 0): b.approx::before '≈' .7em + "%100" (tahmini/eski pil, en uzun yüzde)
  battery: (W) => { const px = valPx(W, 0); return { need: textW('≈', px * 0.7) + textW('%100', px, -0.3), avail: cellInner(W, 0), px }; },
  // Varış saati (sütun 1): "23:59"
  eta: (W) => { const px = valPx(W, 1); return { need: textW('23:59', px, -0.3), avail: cellInner(W, 1), px }; },
  // Varış alt satırı (sütun 1): varışta pil "≈%100" 14px kalın + " · 1234 km" 12px (kesilmez, SARAR)
  etaSub: (W) => ({ need: textW('≈', 14 * 0.7) + textW('%100', 14) + textW(' · 1234 km', 12), avail: cellInner(W, 1), px: 14 }),
  // Varış alt satırının yalnız varışta pil kısmı "≈%100 ·" (asıl bilgi) sığmalı
  etaSubSoc: (W) => ({ need: textW('≈', 14 * 0.7) + textW('%100', 14) + textW(' ·', 12), avail: cellInner(W, 1), px: 14 }),
  // Menzil alt satırı (Pil hücresi, sütun 0): "≈999" 14px kalın + " km" 12px
  rangeSub: (W) => ({ need: textW('≈', 14 * 0.7) + textW('999', 14) + textW(' km', 12), avail: cellInner(W, 0), px: 14 }),
  // Sonraki şarj değeri (sütun 2): uzun km "1234 km"
  nextValue: (W) => { const px = nextPx(W); return { need: textW('1234 km', px, -0.3), avail: cellInner(W, 2), px }; },
  // Sonraki şarj alt satırı: "%100 · 1 sa 59 dk" 12px (sığmazsa SARAR, … ile kesilmez)
  nextSub: (W) => ({ need: textW('%100 · 1 sa 59 dk', 12), avail: cellInner(W, 2), px: 12 }),
  // Hız kutusu (haritada): "199" 28px ve "Ø199" 11px; limit levhası köşede rozet (ayrı, kutuya sığma sınavı değil)
  speedBox: () => ({ need: textW('199', 28, -0.5), avail: SPEED_BOX, px: 28 }),
  speedAvg: () => ({ need: textW('Ø199', 11) + 1, avail: SPEED_BOX, px: 11 }),
  // Mavi blok: ok sütunu + canlı mesafe "850 m" (kısa, tipik) ve "12,5 km" (uzun). Sığmazsa KESİLMEZ, ikinci satıra kayar
  distShort: (W) => ({ need: arrowCol(W) + textW('850 m', distPx(W)), avail: blueInner(W), px: distPx(W) }),
  distLong: (W) => ({ need: arrowCol(W) + textW('12,5 km', distPx(W)), avail: blueInner(W), px: distPx(W) }),
};
// v0.99.113 (B) model çıktısı SABİTLENDİ (bilinen boşluklar dahil). Değişirse: model/CSS değişti → belgeyi gözden geçir.
// "KESİLME-RİSKİ"/"SINIRDA" = tek satıra SIĞMAYABİLİR → metin ikinci satıra SARAR (… ile kesilmez). Yükseklik bedeli tarayıcıda ölçülür:
// scripts/test-nav-toppanel-layout.mjs (EVRF_NAV_BROWSER=1).
const EXPECTED = {
  battery: { 360: 'SIĞAR', 375: 'SIĞAR', 399: 'SIĞAR', 412: 'SIĞAR' },
  eta: { 360: 'SIĞAR', 375: 'SIĞAR', 399: 'SIĞAR', 412: 'SIĞAR' },
  etaSub: { 360: 'SINIRDA', 375: 'SINIRDA', 399: 'SIĞAR', 412: 'SIĞAR' }, // dar ekranda ikinci satıra sarar (… ile kesilmez)
  etaSubSoc: { 360: 'SIĞAR', 375: 'SIĞAR', 399: 'SIĞAR', 412: 'SIĞAR' },
  rangeSub: { 360: 'SIĞAR', 375: 'SIĞAR', 399: 'SIĞAR', 412: 'SIĞAR' },
  nextValue: { 360: 'SIĞAR', 375: 'SIĞAR', 399: 'SIĞAR', 412: 'SIĞAR' },
  nextSub: { 360: 'SINIRDA', 375: 'SINIRDA', 399: 'SIĞAR', 412: 'SIĞAR' }, // dar ekranda ikinci satıra sarar (… ile kesilmez)
  speedBox: { 360: 'SIĞAR', 375: 'SIĞAR', 399: 'SIĞAR', 412: 'SIĞAR' },
  speedAvg: { 360: 'SIĞAR', 375: 'SIĞAR', 399: 'SIĞAR', 412: 'SIĞAR' },
  distShort: { 360: 'SIĞAR', 375: 'SIĞAR', 399: 'SIĞAR', 412: 'SIĞAR' },
  distLong: { 360: 'SIĞAR', 375: 'SIĞAR', 399: 'SIĞAR', 412: 'SIĞAR' },
};
const table = [];
for (const [name, fn] of Object.entries(CASES)) {
  for (const W of WIDTHS) {
    const { need, avail, px } = fn(W);
    const got = classify(need, avail);
    table.push(`${name.padEnd(10)} ${W}px  yazı ${px.toFixed(2)}px  gereken≈${need.toFixed(1)}  kullanılabilir≈${avail.toFixed(1)}  → ${got}`);
    ok(`TAHMİN ${name} @${W}px = ${EXPECTED[name][W]}`, got === EXPECTED[name][W], `model: ${got} (gereken ${need.toFixed(1)}, kullanılabilir ${avail.toFixed(1)})${REVIEW}`);
  }
}
// Kesilme olursa davranış: değerler hücreye göre küçülür ve sarar, … ile kesilmez; yol adı en çok 2 satır (CSS kanıtı; görsel sonuç cihazda doğrulanmalı)
ok('taşma koruması: .ne-v b hücre cqi ile küçülür ve sarar, hücreler minmax(0, 1fr), yol adı satır kırpar, base .ne-v nowrap/ellipsis kuralları yerinde', css.includes(CSS_RULES.bVal) && css.includes(CSS_RULES.bGrid) && css.includes(CSS_RULES.bRoad) && css.includes(CSS_RULES.neVBBase) && css.includes(CSS_RULES.neVBase) && css.includes(CSS_RULES.bNav));
ok('v0.99.113 sarma: metrik değerleri ve alt satırlar … ile kesilmez (white-space: normal, overflow-wrap: anywhere, text-overflow: clip; base kurallardan SONRA)', css.includes(CSS_RULES.bVal) && css.includes(CSS_RULES.bSub) && at(CSS_RULES.bVal) > at(CSS_RULES.neVBBase) && at(CSS_RULES.bSub) > at(CSS_RULES.neVBBase), REVIEW);
ok('canlı mesafe kesilmez: .nav-dist için nowrap/ellipsis/overflow kuralı yok (uzun değer ikinci satıra kayar)', !/\.nav-dist[^{]*\{[^}]*(white-space: nowrap|text-overflow|overflow: hidden)/.test(css), REVIEW);
ok('hız kutusu: #nb-speed DOM\'da #nb-metrics içinde kalır (kimlikler/JS değişmez), CSS ile sol altta fixed, alt çubuğun 40 px üstünde; limit rozeti köşede', /<div class="nb-metrics" id="nb-metrics">[\s\S]*?<div class="nb-cell nb-speed" id="nb-speed">/.test(html) && css.includes(CSS_RULES.bSpeedBox) && css.includes(CSS_RULES.bLimit) && css.includes(CSS_RULES.bNoLim), REVIEW);
ok('rotasız panel (.mapsoc) aynı B dili: mavi başlık + beyaz sürgü şeridi; düşük pilde amber; 150 px alt sınır kalktı', css.includes(CSS_RULES.bMapsocBar) && css.includes(CSS_RULES.bMapsocLow) && css.includes(CSS_RULES.bMapsocLowBatt) && css.includes(CSS_RULES.bMapsocSlider) && css.includes(CSS_RULES.navbarBox) && !/\.navbar, \.mapsoc \{[^}]*min-height: 150px/.test(css), REVIEW);

// ---------------------------------------------------------------------------------------------------------------------------
// 3) 360×640 yükseklik modeli (TAHMİN): #banners max-height 34dvh = 217.6px; uyarı 1→2 satır (satır tavanı 2)
// ---------------------------------------------------------------------------------------------------------------------------
{
  const H = 640;
  const maxBanners = 0.34 * H;
  const budget = maxBanners - 6 /* #banners>* alt kenar */ - 2 /* .toppanel kenarlık */;
  // B: dikey yığın (≤360 px). Mavi blok = dolgu 8+8 + max(ok 40, mesafe 32px/1.05 + talimat satırları 15px/1.2 + yol adı satırları 18px/1.2 + şerit)
  const dist = 32 * 1.05, textLine = 15 * 1.2, roadLine = 18 * 1.2, lanes = 4 + 16 * 1.3 + 2;
  const blue = (s) => 16 + Math.max(40, dist + s.textL * textLine + s.roadL * roadLine + (s.lane ? lanes : 0));
  // Metrik şeridi: dolgu 6+8 + hücre (etiket 1–2 satır 11px/1.15 + değer 22px/1.1 + alt satır 1–2 satır 12px/1.15); en az 44 (dokunma hedefi)
  const label = 11 * 1.15, val = 22 * 1.1, subLine = 12 * 1.15;
  const cell = (labelL, subL) => Math.max(44, labelL * label + val + subL * subLine);
  const alert = (lines) => (lines ? 8 + 14 + lines * 15 * 1.25 : 0); // satır arası 8 + dikey dolgu 2×7 + satırlar (15px/1.25)
  const right = (s) => 6 + cell(s.labelL, s.subL) + alert(s.alertL) + 8;
  const navbar = (s) => blue(s) + right(s);
  const SCEN = {
    'en az (1 satır manevra, yol yok, uyarı yok)': [{ textL: 1, roadL: 0, lane: false, labelL: 1, subL: 1, alertL: 0 }, 'SIĞAR'],
    'tipik + uyarı 1 satır': [{ textL: 1, roadL: 1, lane: false, labelL: 1, subL: 1, alertL: 1 }, 'SIĞAR'],
    // Uyarı tavanı 2 satır: tipik panelde 2 satırlık uyarı bütçeyi biraz aşar → #banners kendi içinde kayabilir (bilinen boşluk, belge §3)
    'tipik + uyarı 2 satır (tavan)': [{ textL: 1, roadL: 1, lane: false, labelL: 1, subL: 1, alertL: 2 }, 'KAYAR-RİSKİ'],
    'en kötü (2+2 satır, şerit, etiket 2 + alt satır 2, uyarı 2 satır)': [{ textL: 2, roadL: 2, lane: true, labelL: 2, subL: 2, alertL: 2 }, 'KAYAR-RİSKİ'],
  };
  table.push(`yükseklik 360x640: #banners en çok ${maxBanners.toFixed(1)}px, gezinme çubuğu bütçesi≈${budget.toFixed(1)}px`);
  for (const [name, [s, exp]] of Object.entries(SCEN)) {
    const h = navbar(s);
    const got = h <= budget ? 'SIĞAR' : 'KAYAR-RİSKİ';
    table.push(`  ${name}: ≈${h.toFixed(1)}px → ${got}`);
    ok(`TAHMİN 360x640 ${name} = ${exp}`, got === exp, `model ≈${h.toFixed(1)}px / bütçe ${budget.toFixed(1)}px${REVIEW}`);
  }
  // Uyarı 1→2 satır büyümesi: 2 satırda kırpılır (line-clamp 2), 3. satır gösterilmez
  ok('uyarı satır tavanı 2 (line-clamp), 15px/1.25 ve dar ekranda 14px', css.includes(CSS_RULES.bAlert) && css.includes(CSS_RULES.alertBig) && css.includes(CSS_RULES.narrow380) && css.includes('@media (max-width: 380px) { .nb-alert { font-size: 14px; } }'));
  ok('TAHMİN uyarı 1→2 satır büyümesi ≈18.75px', Math.abs(alert(2) - alert(1) - 18.75) < 0.01);
  ok('TAHMİN tipik panel + 1 satır uyarı ≈194px (tarayıcıda 360×740\'ta 194px ölçüldü)', Math.abs(navbar(SCEN['tipik + uyarı 1 satır'][0]) - 194.6) < 1);
  ok('kayma olursa #banners kendi içinde kayar (overflow-y:auto), sayfa taşmaz', css.includes(CSS_RULES.bannersBase));
}

// ---------------------------------------------------------------------------------------------------------------------------
// 4) Kapat (X): görünür 36×36 (.tp-head .tog) DEĞİŞMEZ; görünmez ::after dokunma alanı ≥ 44×44 (RM-07 A1).
//    Hesap kaynaktan okunur: border-box → dolgu kutusu = 36 − 2×kenarlık; ::after inset −N → etkin = dolgu kutusu + 2N.
//    Komşu "Liste" (.tog-list) ile çakışma ve üst kutu dolgusunda kırpılma da denetlenir. Gerçek cihazda doğrulanmadı.
// ---------------------------------------------------------------------------------------------------------------------------
{
  const tp = css.indexOf(CSS_RULES.tpTog), base = css.indexOf(CSS_RULES.tog);
  ok('kapat X: .tp-head .tog (36px) temel .tog (30px) kuralından sonra', tp > base && base >= 0, REVIEW);
  const num = (re) => { const m = css.match(re); return m ? Number(m[1]) : NaN; };
  const visW = num(/\.tp-head \.tog \{ width: (\d+)px; height: \d+px; \}/), visH = num(/\.tp-head \.tog \{ width: \d+px; height: (\d+)px; \}/);
  const border = num(/\.tog \{ flex: none;[^}]*border: (\d+)px solid/);
  const inset = num(/#near-alert-close::after \{[^}]*inset: -(\d+)px;/);
  ok('kapat X: görünür boyut 36×36 korunuyor (görsel geometri değişmedi)', visW === 36 && visH === 36, `${visW}×${visH}`);
  ok('kapat X: kenarlık 1px ve box-sizing border-box (dolgu kutusu 34px)', border === 1 && css.includes(CSS_RULES.boxSizing) && css.includes(CSS_RULES.togBorder), REVIEW);
  ok('kapat X: görünür boyut ≥ WCAG 2.5.8 en az 24×24', visW >= 24 && visH >= 24);
  const effW = visW - 2 * border + 2 * inset, effH = visH - 2 * border + 2 * inset;
  table.push(`kapat X: görünür ${visW}×${visH}, kenarlık ${border}px, ::after inset −${inset}px → etkin dokunma alanı ${effW}×${effH}`);
  ok('KABUL: kapat X etkin dokunma alanı ≥ 44×44 (Apple HIG 44pt)', effW >= 44 && effH >= 44, `etkin ${effW}×${effH}`);
  ok('kapat X: ::after görünmez (yalnız content/position/inset; arka plan/kenarlık yok), kapsayıcı butonun kendisi (position: relative önce)',
    css.includes(CSS_RULES.closeHit) && css.includes(CSS_RULES.closePos) && css.indexOf(CSS_RULES.closeHit) > css.indexOf(CSS_RULES.closePos), REVIEW);
  const spill = inset - border; // görünür kenarlık kutusunun dışına her yönde taşma
  const headGap = num(/\.tp-head \{ display: flex; align-items: center; gap: (\d+)px; \}/);
  const iToggle = html.indexOf('id="near-alert-toggle"'), iClose = html.indexOf('id="near-alert-close"');
  ok('kapat X: komşu "Liste" ile çakışma yok (taşma 4px < .tp-head gap 6px; Liste kapat\'tan önce)',
    css.includes(CSS_RULES.tpHead) && css.includes(CSS_RULES.tpList) && spill === 4 && spill < headGap && iToggle > 0 && iToggle < iClose, `taşma ${spill}, gap ${headGap}${REVIEW}`);
  // Kırpılma: .toppanel overflow:hidden → taşma .tp-charge dolgusu içinde kalmalı (tüm .tp-charge dolgu kuralları)
  const pads = [...css.matchAll(/\.tp-charge \{ padding: ([\d px]+);/g)].map((m) => {
    const [t, r = t, b = t] = m[1].trim().split(/\s+/).map((x) => parseFloat(x));
    return { t, r, b };
  });
  ok('kaynak: .tp-charge dolgu kuralı sayısı 3 (6/12/8, 10/12, 6/10)', pads.length === 3, `${pads.length}${REVIEW}`);
  const minTB = Math.min(...pads.map((p) => Math.min(p.t, p.b))), minR = Math.min(...pads.map((p) => p.r));
  ok('kapat X: taşma .tp-charge dolgusu içinde (üst/alt ≥6px, sağ ≥10px) → .toppanel overflow:hidden kırpmaz',
    minTB === 6 && minR === 10 && spill <= minTB && spill <= minR, `taşma ${spill}, üst/alt ${minTB}, sağ ${minR}${REVIEW}`);
  ok('kapat X: .toppanel yükseklik sınırı yok (kaymaz → yapışkan başlık üstten kırpılmaz)', css.includes(CSS_RULES.toppanel) && !/\.toppanel[^{]*\{[^}]*max-height/.test(css), REVIEW);
  ok('kapat X: alt taşma liste gövdesine binmez (≤ .near-body margin-top 4px)', css.includes(CSS_RULES.nearBodyGap) && spill <= 4, REVIEW);
  ok('kapat X: tıklama işleyicisi butonda (::after dokunuşu butona gider)', read('js/nav/nearby.js').includes("$('near-alert-close').addEventListener('click',"), REVIEW);
}

console.log('\n— Yaklaşık model tablosu (TAHMİN, tarayıcı ölçümü değil) —');
for (const l of table) console.log('  ' + l);
console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
