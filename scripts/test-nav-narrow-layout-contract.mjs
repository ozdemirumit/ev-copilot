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
  navbarFinal: '.navbar { grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 6px 10px; padding: 8px 8px 6px; align-items: start; }',
  right: '.nb-right { display: flex; flex-direction: column; gap: 6px; min-width: 0; }',
  manCol: '.nb-man { flex-direction: column; align-items: stretch; gap: 2px; }',
  head: '.nb-head { display: flex; align-items: center; gap: 6px; min-width: 0; }',
  arrow: '.nb-man .nav-arrow { flex: none; font-size: 38px; width: 46px; padding-right: 8px; }',
  dist30: '.nb-man .nav-dist { font-size: 30px; }',
  navbarMinH: '.navbar, .mapsoc { box-sizing: border-box; min-height: 150px; }',
  grid: '.nb-metrics { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); row-gap: 4px; align-items: stretch; }',
  cell: '.nb-metrics .nb-cell { align-items: center; justify-content: flex-start; min-height: 44px; padding: 0 2px; border-left: 1px solid var(--line); text-align: center; }',
  cellFirst: '.nb-metrics .nb-cell:nth-child(odd) { border-left: 0; }',
  cellRow2: '.nb-metrics .nb-cell:nth-child(n+3) { padding-top: 3px; border-top: 1px solid var(--line); }',
  small: '.nb-metrics .nb-cell small { max-width: 100%; overflow: hidden; color: var(--muted); font-size: 11px; font-weight: 600; white-space: nowrap; text-overflow: ellipsis; }',
  neV: '.nb-metrics .ne-v { display: flex; flex-direction: column; align-items: center; max-width: 100%; line-height: 1.1; }',
  valB: '.nb-metrics .ne-v b { font-size: clamp(18px, 5.4vw, 22px); font-weight: 800; letter-spacing: -.3px; }',
  speedB: '.nb-metrics .nb-speed .ne-v b { font-size: clamp(22px, 6.6vw, 28px); line-height: 1; }',
  sub: '.nb-metrics .ne-sub { max-width: 100%; overflow: hidden; color: var(--muted); font-size: 11px; font-weight: 600; white-space: nowrap; text-overflow: ellipsis; }',
  subB: '.nb-metrics .ne-sub b { font-size: 14px; font-weight: 800; color: var(--text); letter-spacing: 0; }',
  speedRow: '.nb-speed .ne-v { flex-direction: row; align-items: center; justify-content: center; gap: 4px; }',
  limitSign: '.nb-limit .limit-sign { width: 38px; height: 38px; border-width: 4px; font-size: 15px; letter-spacing: -.5px; }',
  noLim: '.nb-speed .ne-nolim { display: grid; place-items: center; width: 30px; height: 30px; border: 2px dashed var(--line); border-radius: 50%; color: var(--muted); }',
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
};
for (const [k, s] of Object.entries(CSS_RULES)) ok(`kaynak: css ${k} kuralı birebir yerinde`, css.includes(s), REVIEW);

// Kademe (cascade) varsayımları: aynı özgüllükte sonraki kural kazanır → model bu sırayı varsayar
const at = (s) => css.indexOf(s);
ok('kaynak: .nb-metrics .ne-v b clamp kuralı ≤380 px 21px kuralından SONRA (clamp kazanır)', at(CSS_RULES.valB) > at(CSS_RULES.narrow380), REVIEW);
ok('kaynak: son .navbar dolgu kuralı önceki .navbar kurallarından sonra', at(CSS_RULES.navbarFinal) > at('.navbar { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 6px 10px; padding: 8px 10px 6px; align-items: stretch; }'), REVIEW);
ok('kaynak: .nb-alert 15px kuralı ≤380 px 14px kuralından önce (dar ekranda 14px)', at(CSS_RULES.alertBig) < at(CSS_RULES.narrow380), REVIEW);
// Dar ekranda bu öğeleri etkileyen yeni bir @media eklenmiş mi? (sayım sabit; değişirse gözden geçir)
const count = (re) => (css.match(re) || []).length;
ok('kaynak: "#ne-soc" css geçişi sayısı 1 (renk)', count(/#ne-soc\b/g) === 1, `${count(/#ne-soc\b/g)}${REVIEW}`);
ok('kaynak: "#ne-next" (.none) ve "#ne-next-t" css\'te birer kez', count(/#ne-next(?![-\w])/g) === 1 && count(/#ne-next-t(?![-\w])/g) === 1, REVIEW);
ok('kaynak: "#near-alert-close" css\'te yalnızca dokunma alanı için 2 kez (position + ::after; görünür boyut .tp-head .tog)', count(/#near-alert-close/g) === 2, `${count(/#near-alert-close/g)}${REVIEW}`);
ok('kaynak: "nb-alert" css geçişi sayısı 7', count(/nb-alert/g) === 7, `${count(/nb-alert/g)}${REVIEW}`);
ok('kaynak: "nb-metrics" css geçişi sayısı 18', count(/nb-metrics/g) === 18, `${count(/nb-metrics/g)}${REVIEW}`);
ok('kaynak: ".nb-right" css\'te bir kez, ".nb-head" bir kez (iki yarı modeli)', count(/\.nb-right\b/g) === 1 && count(/\.nb-head\b/g) === 1, REVIEW);

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
// 2) Yaklaşık genişlik modeli (TAHMİN). Karakter genişlikleri em cinsinden, kalın sistem yazı tipi için TUTUCU üst değerler;
//    "iyimser" = ×0.88. Gerçek yazı tipi (Roboto / SF / Samsung One) farklıdır; gerçek değer bilinmiyor.
// ---------------------------------------------------------------------------------------------------------------------------
const EM = { digit: 0.60, '%': 0.95, ' ': 0.27, '·': 0.30, '≈': 0.62, Ø: 0.78, '-': 0.36, letter: 0.60 };
const OPTIMISTIC = 0.88;
const charEm = (c) => (/[0-9]/.test(c) ? EM.digit : EM[c] ?? EM.letter);
const textW = (txt, px, ls = 0) => [...txt].reduce((w, c) => w + charEm(c) * px + ls, 0);
const clamp = (min, vw, max, W) => Math.min(max, Math.max(min, (vw * W) / 100));
// İçerik genişliği: W − #banners>* yatay kenar (2×10) − kenarlık (2×1) − .navbar dolgu (2×8)
const contentW = (W) => W - 20 - 2 - 16;
// İki yarı: sütun boşluğu 10px, sol 1fr / sağ 1.2fr. Sağda 2×2 metrik: sütun 0 (Hız, Varış) 1.1fr, sütun 1 (Pil, Sonraki şarj) 1fr.
const HALF = [1, 1.2], GAP = 10;
const halfW = (W, i) => ((contentW(W) - GAP) * HALF[i]) / (HALF[0] + HALF[1]);
const FR = [1.1, 1];
const FRSUM = FR.reduce((a, b) => a + b, 0);
const cellInner = (W, i) => (halfW(W, 1) * FR[i]) / FRSUM - 4 - (i === 0 ? 0 : 1);
const classify = (need, avail) => (need <= avail ? 'SIĞAR' : need * OPTIMISTIC <= avail ? 'SINIRDA' : 'KESİLME-RİSKİ');

const WIDTHS = [360, 375, 399, 412];
const distPx = (W) => (W <= 380 ? 26 : 30); // .nb-man .nav-dist 30px, @media (max-width: 380px) 26px
const CASES = {
  // Pil hücresi (sütun 1): b.approx::before '≈' .7em + "%100" (tahmini/eski pil, en uzun yüzde)
  battery: (W) => { const px = clamp(18, 5.4, 22, W); return { need: textW('≈', px * 0.7) + textW('%100', px, -0.3), avail: cellInner(W, 1), px }; },
  // Hız hücresi (sütun 0): "199" + 4px boşluk + 38px limit levhası aynı satırda
  speed: (W) => { const px = clamp(22, 6.6, 28, W); return { need: textW('199', px, -0.3) + 4 + 38, avail: cellInner(W, 0), px }; },
  // Hız hücresi ortalama: "Ø199" 11px
  speedAvg: (W) => ({ need: textW('Ø199', 11) + 1, avail: cellInner(W, 0), px: 11 }),
  // Varış saati (sütun 0): "23:59"
  eta: (W) => { const px = clamp(18, 5.4, 22, W); return { need: textW('23:59', px, -0.3), avail: cellInner(W, 0), px }; },
  // Varış alt satırı (sütun 0): varışta pil "≈%100" 14px kalın + " · 1234 km" 11px (kalan km sondadır; kesilirse önce o … olur)
  etaSub: (W) => ({ need: textW('≈', 14 * 0.7) + textW('%100', 14) + textW(' · 1234 km', 11), avail: cellInner(W, 0), px: 14 }),
  // Varış alt satırının yalnız varışta pil kısmı "≈%100 ·" (asıl bilgi) sığmalı
  etaSubSoc: (W) => ({ need: textW('≈', 14 * 0.7) + textW('%100', 14) + textW(' ·', 11), avail: cellInner(W, 0), px: 14 }),
  // Menzil alt satırı (Pil hücresi, sütun 1): "≈999" 14px kalın + " km" 11px
  rangeSub: (W) => ({ need: textW('≈', 14 * 0.7) + textW('999', 14) + textW(' km', 11), avail: cellInner(W, 1), px: 14 }),
  // Sonraki şarj değeri (sütun 1): uzun km "1234 km"
  nextValue: (W) => { const px = clamp(18, 5.4, 22, W); return { need: textW('1234 km', px, -0.3), avail: cellInner(W, 1), px }; },
  // Sonraki şarj alt satırı: "%100 · 1 sa 59 dk" 11px (… ile kesilir)
  nextSub: (W) => ({ need: textW('%100 · 1 sa 59 dk', 11), avail: cellInner(W, 1), px: 11 }),
  // Sol yarı üst satır: ok (46px) + 6px + canlı mesafe "850 m" (kısa, tipik)
  distShort: (W) => ({ need: 46 + 6 + textW('850 m', distPx(W)), avail: halfW(W, 0), px: distPx(W) }),
  // Sol yarı üst satır: ok + "12,5 km" (uzun). Sığmazsa KESİLMEZ: boşlukta ikinci satıra kayar (nowrap/ellipsis yok) → yükseklik riski
  distLong: (W) => ({ need: 46 + 6 + textW('12,5 km', distPx(W)), avail: halfW(W, 0), px: distPx(W) }),
};
// v0.99.91 (iki yarı) model çıktısı SABİTLENDİ (bilinen boşluklar dahil). Değişirse: model/CSS değişti → belgeyi gözden geçir.
const EXPECTED = {
  battery: { 360: 'SIĞAR', 375: 'SIĞAR', 399: 'SIĞAR', 412: 'SIĞAR' },
  speed: { 360: 'SIĞAR', 375: 'SIĞAR', 399: 'SIĞAR', 412: 'SIĞAR' },
  speedAvg: { 360: 'SIĞAR', 375: 'SIĞAR', 399: 'SIĞAR', 412: 'SIĞAR' },
  eta: { 360: 'SIĞAR', 375: 'SIĞAR', 399: 'SIĞAR', 412: 'SIĞAR' },
  etaSub: { 360: 'SINIRDA', 375: 'SINIRDA', 399: 'SINIRDA', 412: 'SIĞAR' },
  etaSubSoc: { 360: 'SIĞAR', 375: 'SIĞAR', 399: 'SIĞAR', 412: 'SIĞAR' },
  rangeSub: { 360: 'SIĞAR', 375: 'SIĞAR', 399: 'SIĞAR', 412: 'SIĞAR' },
  nextValue: { 360: 'SIĞAR', 375: 'SIĞAR', 399: 'SIĞAR', 412: 'SIĞAR' },
  nextSub: { 360: 'KESİLME-RİSKİ', 375: 'KESİLME-RİSKİ', 399: 'SINIRDA', 412: 'SINIRDA' },
  distShort: { 360: 'SIĞAR', 375: 'SIĞAR', 399: 'SIĞAR', 412: 'SIĞAR' },
  distLong: { 360: 'SINIRDA', 375: 'SINIRDA', 399: 'SINIRDA', 412: 'SINIRDA' },
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
// Kesilme olursa davranış: taşma komşu hücreye geçmez, … ile kırpılır (CSS kanıtı; görsel sonuç cihazda doğrulanmalı)
ok('taşma koruması: .ne-v b overflow:hidden + ellipsis, .ne-v nowrap, hücre ve yarılar minmax(0, …)', css.includes(CSS_RULES.neVBBase) && css.includes(CSS_RULES.neVBase) && css.includes(CSS_RULES.grid) && css.includes(CSS_RULES.navbarFinal));
ok('canlı mesafe kesilmez: .nav-dist için nowrap/ellipsis/overflow kuralı yok (uzun değer ikinci satıra kayar)', !/\.nav-dist[^{]*\{[^}]*(white-space: nowrap|text-overflow|overflow: hidden)/.test(css), REVIEW);

// ---------------------------------------------------------------------------------------------------------------------------
// 3) 360×640 yükseklik modeli (TAHMİN): #banners max-height 34dvh = 217.6px; uyarı 1→3 satır
// ---------------------------------------------------------------------------------------------------------------------------
{
  const W = 360, H = 640;
  const maxBanners = 0.34 * H;
  const budget = maxBanners - 6 /* #banners>* alt kenar */ - 2 /* .toppanel kenarlık */;
  // v0.99.91: iki yarı yan yana → panel yüksekliği = max(sol, sağ) (eskiden manevra + metrik + uyarı üst üste toplanırdı)
  const navDist = 26 * 1.1, line16 = 16 * 1.2, lanes = 4 + 16 * 1.3 + 2;
  const head = (distL) => Math.max(38, distL * navDist); // ok 38px (line-height 1) ile mesafe aynı satırda; uzun mesafe 2 satıra kayabilir
  const valPx = clamp(18, 5.4, 22, W), spdPx = clamp(22, 6.6, 28, W);
  const label = 11 * 1.4;
  const speedCell = label + Math.max(spdPx * 1, 38) + 11 * 1.4; // Hız + 38px levha aynı satırda, altında Ø
  const subCell = label + valPx * 1.1 + 14 * 1.1; // Pil/Varış: değer + 14px kalın alt satır
  const nextCell = label + valPx * 1.1 + 11 * 1.1;
  const metrics = Math.max(44, speedCell, subCell) + 4 + 3 + 1 + Math.max(44, subCell, nextCell); // satır arası 4 + 2. satır üst dolgu 3 + çizgi 1
  const alert = (lines) => (lines ? 6 + 8 + lines * 14 * 1.2 : 0);
  const left = ({ textL, roadL, lane, distL = 1 }) => head(distL) + 2 + textL * line16 + roadL * line16 + (lane ? lanes : 0);
  const navbar = (s) => Math.max(150, 8 + Math.max(left(s), metrics + alert(s.alertL)) + 6);
  const SCEN = {
    'en az (1 satır manevra, yol yok, uyarı yok)': [{ textL: 1, roadL: 0, lane: false, alertL: 0 }, 'SIĞAR'],
    'tipik + uyarı 1 satır': [{ textL: 1, roadL: 1, lane: false, alertL: 1 }, 'SIĞAR'],
    'tipik + uyarı 3 satır': [{ textL: 1, roadL: 1, lane: false, alertL: 3 }, 'SIĞAR'],
    'en kötü (2+2 satır, şerit, uyarı 3 satır)': [{ textL: 2, roadL: 2, lane: true, alertL: 3 }, 'SIĞAR'],
    'en kötü + uzun mesafe 2 satır (sol yarı)': [{ textL: 2, roadL: 2, lane: true, alertL: 3, distL: 2 }, 'SIĞAR'],
  };
  table.push(`  sağ yarı metrikleri ≈${metrics.toFixed(1)}px (uyarısız)`);
  table.push(`yükseklik 360x640: #banners en çok ${maxBanners.toFixed(1)}px, gezinme çubuğu bütçesi≈${budget.toFixed(1)}px`);
  for (const [name, [s, exp]] of Object.entries(SCEN)) {
    const h = navbar(s);
    const got = h <= budget ? 'SIĞAR' : 'KAYAR-RİSKİ';
    table.push(`  ${name}: ≈${h.toFixed(1)}px → ${got}`);
    ok(`TAHMİN 360x640 ${name} = ${exp}`, got === exp, `model ≈${h.toFixed(1)}px / bütçe ${budget.toFixed(1)}px${REVIEW}`);
  }
  // Uyarı 1→3 satır büyümesi: 3 satırda kırpılır (line-clamp 3), 4. satır gösterilmez
  ok('uyarı satır tavanı 3 (line-clamp) ve dar ekranda 14px/1.2', css.includes(CSS_RULES.alertBase) && css.includes(CSS_RULES.alertBig) && css.includes(CSS_RULES.narrow380));
  ok('TAHMİN uyarı 1→3 satır büyümesi ≈33.6px', Math.abs(alert(3) - alert(1) - 33.6) < 0.01);
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
