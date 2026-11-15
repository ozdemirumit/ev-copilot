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
  navbarFinal: '.navbar { grid-template-columns: minmax(0, 1fr); gap: 6px; padding: 8px 8px 6px; }',
  navbarMinH: '.navbar, .mapsoc { box-sizing: border-box; min-height: 150px; }',
  grid: '.nb-metrics { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.15fr) minmax(0, 1.1fr) minmax(0, 1.5fr) minmax(0, 1.1fr); align-items: stretch; padding-top: 5px; border-top: 1px solid var(--line); }',
  cell: '.nb-metrics .nb-cell { align-items: center; justify-content: flex-start; min-height: 44px; padding: 0 2px; border-left: 1px solid var(--line); text-align: center; }',
  cellFirst: '.nb-metrics .nb-cell:first-child { border-left: 0; }',
  small: '.nb-metrics .nb-cell small { max-width: 100%; overflow: hidden; color: var(--muted); font-size: 11px; font-weight: 600; white-space: nowrap; text-overflow: ellipsis; }',
  neV: '.nb-metrics .ne-v { display: flex; flex-direction: column; align-items: center; max-width: 100%; line-height: 1.1; }',
  valB: '.nb-metrics .ne-v b { font-size: clamp(18px, 5.4vw, 22px); font-weight: 800; letter-spacing: -.3px; }',
  speedB: '.nb-metrics .nb-speed .ne-v b { font-size: clamp(22px, 6.6vw, 28px); line-height: 1; }',
  sub: '.nb-metrics .ne-sub { max-width: 100%; overflow: hidden; color: var(--muted); font-size: 11px; font-weight: 600; white-space: nowrap; text-overflow: ellipsis; }',
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
ok('kaynak: "#near-alert-close" css\'te ayrıca boyutlanmıyor', count(/#near-alert-close/g) === 0, REVIEW);
ok('kaynak: "nb-alert" css geçişi sayısı 8', count(/nb-alert/g) === 8, `${count(/nb-alert/g)}${REVIEW}`);
ok('kaynak: "nb-metrics" css geçişi sayısı 16', count(/nb-metrics/g) === 16, `${count(/nb-metrics/g)}${REVIEW}`);

const HTML_FRAGS = [
  '<div class="nb-metrics" id="nb-metrics">',
  '<div class="nb-cell nb-speed" id="nb-speed"><small>Hız</small><span class="ne-v"><b id="nh-speed">0</b></span><span class="nh-avg" id="nh-avg" title="Ortalama hız"><small data-i18n-skip>Ø</small><b id="nh-avg-v">--</b></span></div>',
  '<div class="nb-cell nb-limit" id="ne-limit-box" title="Yol hız limiti">',
  '<button type="button" class="nb-cell" id="ne-soc-btn" aria-haspopup="dialog" aria-controls="soc-sheet"><small>Pil</small><span class="ne-v"><b id="ne-soc">--</b></span></button>',
  '<div class="nb-cell" id="ne-range-box"><small>Menzil</small>',
  '<div class="nb-cell nb-next" id="ne-next-box"><small>Sonraki şarj<span class="ne-name" id="ne-next-n" data-i18n-skip></span></small><span class="ne-v"><b id="ne-next">--</b><span class="ne-sub" id="ne-next-t"></span></span></div>',
  '<div class="nb-cell" id="ne-arrive-box"><small>Varışta</small>',
  '<div class="nb-alert hidden" id="nb-alert" role="status" aria-live="off"></div>',
  '<button class="tog" id="near-alert-close" type="button" aria-label="Uyarıyı kapat (10 dk)">',
];
HTML_FRAGS.forEach((s, i) => ok(`kaynak: index.html parça #${i + 1} birebir yerinde`, html.includes(s), REVIEW));
// Altı metrik hücresinin sırası (ızgara sütunu ↔ hücre eşleşmesi buna dayanır)
const order = ['id="nb-speed"', 'id="ne-limit-box"', 'id="ne-soc-btn"', 'id="ne-range-box"', 'id="ne-next-box"', 'id="ne-arrive-box"'].map((s) => html.indexOf(s));
ok('kaynak: metrik hücre sırası Hız|Limit|Pil|Menzil|Sonraki şarj|Varışta', order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), REVIEW);

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
const FR = [1, 1, 1.15, 1.1, 1.5, 1.1];
const FRSUM = FR.reduce((a, b) => a + b, 0);
// İçerik genişliği: W − #banners>* yatay kenar (2×10) − kenarlık (2×1) − .navbar dolgu (2×8)
const contentW = (W) => W - 20 - 2 - 16;
const cellInner = (W, i) => (contentW(W) * FR[i]) / FRSUM - 4 - (i === 0 ? 0 : 1);
const classify = (need, avail) => (need <= avail ? 'SIĞAR' : need * OPTIMISTIC <= avail ? 'SINIRDA' : 'KESİLME-RİSKİ');

const WIDTHS = [360, 375, 399, 412];
const CASES = {
  // Pil hücresi (sütun 2): b.approx::before '≈' .7em + "%100" (tahmini/eski pil, en uzun yüzde)
  battery: (W) => { const px = clamp(18, 5.4, 22, W); return { need: textW('≈', px * 0.7) + textW('%100', px, -0.3), avail: cellInner(W, 2), px }; },
  // Hız hücresi (sütun 0): "199"
  speed: (W) => { const px = clamp(22, 6.6, 28, W); return { need: textW('199', px, -0.3), avail: cellInner(W, 0), px }; },
  // Hız hücresi ortalama: "Ø199" 11px
  speedAvg: (W) => ({ need: textW('Ø199', 11) + 1, avail: cellInner(W, 0), px: 11 }),
  // Sonraki şarj değeri (sütun 4): uzun km "1234 km"
  nextValue: (W) => { const px = clamp(18, 5.4, 22, W); return { need: textW('1234 km', px, -0.3), avail: cellInner(W, 4), px }; },
  // Sonraki şarj alt satırı: "%100 · 1 sa 59 dk" 11px (… ile kesilir)
  nextSub: (W) => ({ need: textW('%100 · 1 sa 59 dk', 11), avail: cellInner(W, 4), px: 11 }),
};
// Bugünkü model çıktısı SABİTLENDİ (bilinen boşluklar dahil). Değişirse: model/CSS değişti → belgeyi gözden geçir.
const EXPECTED = {
  battery: { 360: 'KESİLME-RİSKİ', 375: 'KESİLME-RİSKİ', 399: 'KESİLME-RİSKİ', 412: 'KESİLME-RİSKİ' },
  speed: { 360: 'SIĞAR', 375: 'SIĞAR', 399: 'SIĞAR', 412: 'SIĞAR' },
  speedAvg: { 360: 'SIĞAR', 375: 'SIĞAR', 399: 'SIĞAR', 412: 'SIĞAR' },
  nextValue: { 360: 'SINIRDA', 375: 'SINIRDA', 399: 'SINIRDA', 412: 'SINIRDA' },
  nextSub: { 360: 'KESİLME-RİSKİ', 375: 'KESİLME-RİSKİ', 399: 'KESİLME-RİSKİ', 412: 'KESİLME-RİSKİ' },
};
const table = [];
for (const [name, fn] of Object.entries(CASES)) {
  for (const W of WIDTHS) {
    const { need, avail, px } = fn(W);
    const got = classify(need, avail);
    table.push(`${name.padEnd(9)} ${W}px  yazı ${px.toFixed(2)}px  gereken≈${need.toFixed(1)}  kullanılabilir≈${avail.toFixed(1)}  → ${got}`);
    ok(`TAHMİN ${name} @${W}px = ${EXPECTED[name][W]}`, got === EXPECTED[name][W], `model: ${got} (gereken ${need.toFixed(1)}, kullanılabilir ${avail.toFixed(1)})${REVIEW}`);
  }
}
// Kesilme olursa davranış: taşma komşu hücreye geçmez, … ile kırpılır (CSS kanıtı; görsel sonuç cihazda doğrulanmalı)
ok('taşma koruması: .ne-v b overflow:hidden + ellipsis, .ne-v nowrap, hücre minmax(0, …)', css.includes(CSS_RULES.neVBBase) && css.includes(CSS_RULES.neVBase) && css.includes(CSS_RULES.grid));

// ---------------------------------------------------------------------------------------------------------------------------
// 3) 360×640 yükseklik modeli (TAHMİN): #banners max-height 34dvh = 217.6px; uyarı 1→3 satır
// ---------------------------------------------------------------------------------------------------------------------------
{
  const W = 360, H = 640;
  const maxBanners = 0.34 * H;
  const budget = maxBanners - 6 /* #banners>* alt kenar */ - 2 /* .toppanel kenarlık */;
  const navDist = 26 * 1.1, line16 = 16 * 1.2, lanes = 4 + 16 * 1.3 + 2;
  const valPx = clamp(18, 5.4, 22, W), spdPx = clamp(22, 6.6, 28, W);
  const speedCell = 11 * 1.4 + spdPx * 1 + 11 * 1.4;
  const nextCell = 11 * 1.4 + valPx * 1.1 + 11 * 1.1;
  const metrics = 1 + 5 + Math.max(44, speedCell, nextCell);
  const alert = (lines) => (lines ? 6 + 8 + lines * 14 * 1.2 : 0);
  const navbar = ({ textL, roadL, lane, alertL }) => Math.max(150, 8 + Math.max(38, navDist + textL * line16 + roadL * line16 + (lane ? lanes : 0)) + 6 + metrics + alert(alertL) + 6);
  const SCEN = {
    'en az (1 satır manevra, yol yok, uyarı yok)': [{ textL: 1, roadL: 0, lane: false, alertL: 0 }, 'SIĞAR'],
    'tipik + uyarı 1 satır': [{ textL: 1, roadL: 1, lane: false, alertL: 1 }, 'SIĞAR'],
    'tipik + uyarı 3 satır': [{ textL: 1, roadL: 1, lane: false, alertL: 3 }, 'KAYAR-RİSKİ'],
    'en kötü (2+2 satır, şerit, uyarı 3 satır)': [{ textL: 2, roadL: 2, lane: true, alertL: 3 }, 'KAYAR-RİSKİ'],
  };
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
// 4) Kapat (X) 36px: near-alert-close .tog → .tp-head .tog 36×36 (statik). 44px dokunma önerisinin altında: bilinen boşluk.
// ---------------------------------------------------------------------------------------------------------------------------
{
  const tp = css.indexOf(CSS_RULES.tpTog), base = css.indexOf(CSS_RULES.tog);
  ok('kapat X: .tp-head .tog (36px) temel .tog (30px) kuralından sonra', tp > base && base >= 0, REVIEW);
  ok('kapat X: tahmini dokunma alanı 36×36 ≥ WCAG 2.5.8 en az 24×24', 36 >= 24);
  ok('BİLİNEN BOŞLUK sabit: kapat X 36px < 44px (Apple HIG / Material 48dp önerisi) — düzeltilmedi', 36 < 44);
}

console.log('\n— Yaklaşık model tablosu (TAHMİN, tarayıcı ölçümü değil) —');
for (const l of table) console.log('  ' + l);
console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
