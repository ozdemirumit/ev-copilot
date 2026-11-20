// Sert viraj uyarısı (js/nav/curveLogic.js): rota geometrisinden yarıçap, kavşak elemesi, kaba geometri, uyarı zamanlaması.
// Kullanım: node scripts/test-curve-warn.mjs  — düz Node, ağ yok, sahte (sentetik) rota çizgileri.
import { readFileSync } from 'node:fs';
import { sharpCurves, pickCurves, CURVE } from '../js/nav/curveLogic.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ---- sentetik rota: "kaplumbağa" çizimi. segs: [{ len (m), turn (derece; sol +) }]; arc yarıçapı = len / turn(rad). Çıktı: [lon, lat] dizisi.
const LAT0 = 40, LON0 = 30;
function route(segs, stepM = 10) {
  let x = 0, y = 0, th = 0;
  const pts = [[x, y]];
  for (const { len, turn = 0 } of segs) {
    const n = Math.max(1, Math.ceil(len / stepM));
    const dth = (turn * Math.PI) / 180 / n;
    const ds = len / n;
    for (let i = 0; i < n; i++) { th += dth / 2; x += ds * Math.cos(th); y += ds * Math.sin(th); th += dth / 2; pts.push([x, y]); }
  }
  return pts.map(([px, py]) => [LON0 + px / (111320 * Math.cos((LAT0 * Math.PI) / 180)), LAT0 + py / 110574]);
}
const arc = (R, deg) => ({ len: (R * Math.abs(deg) * Math.PI) / 180, turn: deg });
const near = (v, t, tol) => Math.abs(v - t) <= tol;

// 1) Düz yol: viraj yok
ok('düz 3 km yolda viraj yok', sharpCurves(route([{ len: 3000 }])).length === 0);

// 2) 90° sol, R=40 m: tek sert viraj, sol, ~40 m, ~90°
{
  const cv = sharpCurves(route([{ len: 500 }, arc(40, 90), { len: 500 }]));
  ok('90° sol R=40: tek viraj', cv.length === 1, JSON.stringify(cv));
  const c = cv[0] || {};
  ok('yön sol', c.dir === 'left');
  ok('yarıçap ≈ 40 m (±12)', near(c.minR, 40, 12), `minR ${c.minR}`);
  ok('dönüş ≈ 90° (±15)', near(c.turnDeg, 90, 15), `turn ${c.turnDeg}`);
  ok('başlangıç km virajdan hemen önce (0,40–0,52)', c.km0 >= 0.4 && c.km0 <= 0.52, `km0 ${c.km0}`);
  ok('keskin dönemeç DEĞİL (90° < 120°)', c.hairpin === false);
  ok('önerilen hız 30 km/sa (R=40)', c.adviseKmh === 30, `${c.adviseKmh}`);
}

// 3) Sağ viraj yönü
{
  const c = sharpCurves(route([{ len: 400 }, arc(60, -80), { len: 400 }]))[0];
  ok('sağ viraj: yön right', c?.dir === 'right', JSON.stringify(c));
}

// 4) Hafif viraj (R=300 m, 90°): uyarı yok
ok('hafif viraj R=300: uyarı yok', sharpCurves(route([{ len: 500 }, arc(300, 90), { len: 500 }])).length === 0);

// 5) Çok hafif dönüş (R=60 ama yalnız 30°): minTurnDeg altında, uyarı yok
ok('kısa/ hafif dönüş (30°): uyarı yok', sharpCurves(route([{ len: 500 }, arc(60, 30), { len: 500 }])).length === 0);

// 6) Saç tokası: R=25, 180°
{
  const c = sharpCurves(route([{ len: 400 }, arc(25, 180), { len: 400 }]))[0];
  ok('saç tokası: hairpin true, dönüş ≥ 150°', c?.hairpin === true && c.turnDeg >= 150, JSON.stringify(c));
  ok('saç tokası önerilen hız en az 20 km/sa', c?.adviseKmh >= 20 && c.adviseKmh <= 30, `${c?.adviseKmh}`);
}

// 7) S virajı: sol + sağ, iki ayrı kayıt
{
  const cv = sharpCurves(route([{ len: 400 }, arc(50, 70), { len: 150 }, arc(50, -70), { len: 400 }]));
  ok('S virajı: iki ayrı viraj (sol sonra sağ)', cv.length === 2 && cv[0].dir === 'left' && cv[1].dir === 'right', JSON.stringify(cv));
  ok('viraj listesi km sıralı', cv.length === 2 && cv[0].km0 < cv[1].km0);
}

// 8) Manevra adımına yakın kesim viraj sayılmaz (kavşak/dönüş: talimat zaten söyleniyor); uzak adım etkilemez
{
  const coords = route([{ len: 500 }, arc(40, 90), { len: 500 }]);
  const turnStep = (km) => ({ type: 'turn', modifier: 'left', text: 'Sola dön', km });
  ok('dönüş adımı virajın içinde: viraj sayılmaz', sharpCurves(coords, [turnStep(0.52)]).length === 0);
  ok('dönüş adımı 100 m önde: viraj sayılmaz (120 m temizlik)', sharpCurves(coords, [turnStep(0.40)]).length === 0);
  ok('dönüş adımı 1 km geride: viraj sürer', sharpCurves(coords, [turnStep(0.0)]).length === 1 || sharpCurves(coords, [turnStep(0.01)]).length === 1);
  ok('düz devam/yol adı değişimi (küçük adım) elemez', sharpCurves(coords, [{ type: 'new name', modifier: 'straight', text: 'X yolu', km: 0.5 }, { type: 'depart', text: 'Başla', km: 0 }]).length === 1);
  ok('döner kavşak adımı eleme yapar', sharpCurves(coords, [{ type: 'roundabout', modifier: 'right', text: 'Döner kavşak', km: 0.5 }]).length === 0);
}

// 9) Kaba geometri (köşe aralığı 200 m): güvenilmez, hiç uyarı üretilmez
ok('kaba geometri (200 m aralık): uyarı yok', sharpCurves(route([{ len: 1000 }, arc(40, 90), { len: 1000 }], 200)).length === 0);

// 10) Girdi sağlamlığı
ok('boş/kısa girdi güvenli', sharpCurves(null).length === 0 && sharpCurves([]).length === 0 && sharpCurves([[30, 40], [30.001, 40]]).length === 0);
ok('önerilen hız formülü: R=90 → 50', (() => { const c = sharpCurves(route([{ len: 400 }, arc(85, 80), { len: 400 }]))[0]; return c ? c.adviseKmh === 45 || c.adviseKmh === 50 : false; })());

// 11) Uyarı zamanlaması
{
  const cv = [{ km0: 5, km1: 5.1, minR: 40, turnDeg: 90, dir: 'left', adviseKmh: 30, hairpin: false }, { km0: 9, km1: 9.1, minR: 30, turnDeg: 100, dir: 'right', adviseKmh: 30, hairpin: false }];
  const said = new Set();
  ok('uzakta (3 km) uyarı yok', pickCurves(2, cv, said).speak.length === 0 && pickCurves(2, cv, said).line === null);
  ok('1 km içinde ekranda gösterilir, sesli değil (lead dışı)', (() => { const r = pickCurves(4.2, cv, said); return r.speak.length === 0 && r.line?.dir === 'left' && near(r.line.dKm, 0.8, 0.001); })());
  const r1 = pickCurves(4.6, cv, said);
  ok('400 m kala bir kez sesli uyarı', r1.speak.length === 1 && r1.speak[0].dir === 'left' && near(r1.speak[0].dKm, 0.4, 0.001));
  ok('aynı viraj için tekrar sesli uyarı yok', pickCurves(4.65, cv, said).speak.length === 0 && pickCurves(4.7, cv, said).speak.length === 0);
  ok('virajın içinde/sonrasında satır yok, sıradaki virajı gösterir ancak uzaksa göstermez', pickCurves(5.05, cv, said).line === null);
  ok('kapalıyken (ayar) hiçbir şey üretmez', (() => { const r = pickCurves(4.6, cv, new Set(), { enabled: false }); return r.speak.length === 0 && r.line === null; })());
  ok('geçersiz km (null) güvenli', (() => { const r = pickCurves(null, cv, new Set()); return r.speak.length === 0 && r.line === null; })());
  ok('ikinci virajın ayrı anahtarı var', pickCurves(8.6, cv, said).speak.length === 1);
}

// 11b) Yarıçap kalibrasyonu: kısa yaylarda tahmin gerçeğin ±%20'si içinde ve tehlikeli yönde (büyük) sapmaz
for (const R of [25, 40, 60, 85]) {
  const c = sharpCurves(route([{ len: 500 }, arc(R, 90), { len: 500 }]))[0];
  ok(`kalibrasyon: gerçek R=${R} m → tahmin ${c?.minR} m (±%20)`, !!c && Math.abs(c.minR - R) <= R * 0.2, JSON.stringify(c));
}

// 11c) Bağlantı: roadWarnings, ayar anahtarı, çevrimdışı liste, uyarı satırı, durum varsayılanı, çeviriler
{
  const rw = read('js/nav/roadWarnings.js');
  ok('roadWarnings curveLogic\'i içe aktarır ve warnCurve ayarını okur/kaydeder (varsayılan açık)', /from '\.\/curveLogic\.js'/.test(rw) && /curve: load\('warnCurve', true\)/.test(rw) && /bind\('warn-curve', 'curve', 'warnCurve'\)/.test(rw));
  ok('rota başına bir kez hesap, hata olursa uyarı yok ve çökmez (try/catch), ağ isteği yok', /curvesFor !== planId/.test(rw) && /try \{ curves = sharpCurves\(plan\.route\?\.coords, plan\.steps\); \} catch/.test(rw) && !/fetch/.test(read('js/nav/curveLogic.js')));
  ok('anons ve satır t() ile çevrilir, mesafe dile uygun (shortDist)', /const curveSpeech = \(s\) => \(s\.hairpin\s*\? t\(/.test(rw) && /const curveLine = \(c\) => t\(/.test(rw) && /shortDist\(s\.dKm \* 1000\)/.test(rw));
  ok('ekran: nav.ahead.curve / curveSoon yazılır ve nav kapanınca temizlenir', /curve: cvl, curveSoon: cvSoon/.test(rw) && /nav\.ahead\.curve\) setAhead\(\{[^}]*curve: null, curveSoon: false/.test(rw));
  ok('index.html: Ayarlar\'da "Sert viraj uyarısı" anahtarı (varsayılan açık)', /<label for="warn-curve">Sert viraj uyarısı<\/label>\s*<label class="switch"><input type="checkbox" id="warn-curve" checked>/.test(read('index.html')));
  ok('sw.js SHELL curveLogic.js içerir (çevrimdışı)', read('sw.js').includes("'./js/nav/curveLogic.js'"));
  const nav = read('js/nav/navigator.js');
  ok('navigator: viraj ≤ 600 m ise uyarı satırında en başta, uzaktaysa sonda; tünel/ücretli yol sıralaması korunur', /const cv = nav\.active && typeof a\.curve === 'string'/.test(nav) && /const base = cv && !a\.curveSoon \? \[\.\.\.rest, cv\] : rest;/.test(nav) && /orderAlerts\(base, a\.road, !!a\.roadSoon\)/.test(nav) && /const alerts = cv && a\.curveSoon \? \[cv, \.\.\.ordered\] : ordered;/.test(nav));
  ok('state: nav.ahead varsayılanında curve/curveSoon var', /ahead: \{[^}]*curve: null, curveSoon: false/.test(read('js/state.js')));
  const KEYS = ['{0} ileride sert sağ viraj, hızını {1} km/sa civarına düşür.', '{0} ileride sert sol viraj, hızını {1} km/sa civarına düşür.', '{0} ileride keskin sağ dönemeç, yavaşla.', '{0} ileride keskin sol dönemeç, yavaşla.', '↱ Sert sağ viraj {0} ileride', '↰ Sert sol viraj {0} ileride', 'Sert viraj uyarısı'];
  const extra = JSON.parse(read('i18n/keys.extra.json'));
  ok('7 çeviri anahtarı keys.extra.json içinde (tekil)', KEYS.every((k) => extra.filter((x) => x === k).length === 1));
  const LANGS = ['bg', 'de', 'el', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'ro'];
  const ph = (s) => (s.match(/\{\d\}/g) || []).sort().join('');
  let all = true; let why = '';
  for (const l of LANGS) {
    const src = read(`js/i18n/lang/${l}.extra.js`);
    for (const k of KEYS) {
      const m = src.match(new RegExp('^  ' + JSON.stringify(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ': (".*"),$', 'm'));
      if (!m) { all = false; why = `${l}: ${k}`; break; }
      const v = JSON.parse(m[1]);
      if (ph(v) !== ph(k) || v === k) { all = false; why = `${l}: yer tutucu/kopya ${k}`; break; }
    }
    if (!all) break;
  }
  ok('11 dilde 7 çeviri var, yer tutucular aynı ({0},{1}), Türkçe kopya değil', all, why);
}

// 12) Sabitler (yanlışlıkla gevşetilmesin)
ok('sabitler: R ≤ 90 m, dönüş ≥ 45°, uyarı 200–600 m, ekranda 1 km, temizlik 120 m, kaba eşik 60 m', CURVE.maxRadiusM === 90 && CURVE.minTurnDeg === 45 && CURVE.leadKm[0] === 0.2 && CURVE.leadKm[1] === 0.6 && CURVE.showKm === 1.0 && CURVE.clearM === 120 && CURVE.maxSpacingM === 60);

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
