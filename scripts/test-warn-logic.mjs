// Yol önü uyarı mantığı testi (BL-P2-02): js/nav/warnLogic.js gerçek modülü, çevrimdışı, sahte rota verisiyle.
// steepSections (%5 eşik/yön/birleştirme), distText (0.95 km sınırı, 100 m alt sınır, 100 m yuvarlama),
// pickWarnings (eğim 0.5–2.2 km, kamera uzak 0.7–1.3 / yakın 0.12–0.45 km, said tekilleştirme, geçmiş/uzak filtre,
// grade:false / camera:false, ekrandaki en yakın uyarı, maxspeed null), dedupeCams (100 m birleştirme + sıralama).
// Kullanım: node scripts/test-warn-logic.mjs
import {
  STEEP, GRADE_LEAD, CAM_FAR, CAM_NEAR,
  steepSections, distText, pickWarnings, dedupeCams,
} from '../js/nav/warnLogic.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const near = (a, b, tol = 1e-9) => a != null && Math.abs(a - b) <= tol;
const J = (v) => JSON.stringify(v);
const seg = (km0, km1, grade) => ({ km0, km1, dKm: km1 - km0, grade });

// ---------- sabitler ----------
ok('STEEP = 0.05', STEEP === 0.05, STEEP);
ok('GRADE_LEAD = [0.5, 2.2]', J(GRADE_LEAD) === J([0.5, 2.2]), J(GRADE_LEAD));
ok('CAM_FAR = [0.7, 1.3]', J(CAM_FAR) === J([0.7, 1.3]), J(CAM_FAR));
ok('CAM_NEAR = [0.12, 0.45]', J(CAM_NEAR) === J([0.12, 0.45]), J(CAM_NEAR));

// ---------- steepSections ----------
{
  ok('boş dilim listesi → []', J(steepSections([])) === '[]');
  ok('düz yol → kesim yok', steepSections([seg(0, 2, 0), seg(2, 4, 0.02), seg(4, 6, -0.03)]).length === 0);

  // %5 eşiği: tam 0.05 dik sayılır, 0.0499 sayılmaz (iki yönde)
  const up5 = steepSections([seg(0, 2, 0.05)]);
  ok('eğim tam %5 → yokuş (dir +1)', up5.length === 1 && up5[0].dir === 1, J(up5));
  ok('eğim %4.99 → dik değil', steepSections([seg(0, 2, 0.0499)]).length === 0);
  const dn5 = steepSections([seg(0, 2, -0.05)]);
  ok('eğim tam -%5 → iniş (dir -1)', dn5.length === 1 && dn5[0].dir === -1, J(dn5));
  ok('eğim -%4.99 → dik değil', steepSections([seg(0, 2, -0.0499)]).length === 0);

  // aynı yönlü ardışık dilimler birleşir; eğim mesafe ağırlıklı ortalama
  const m = steepSections([seg(0, 2, 0.06), seg(2, 3, 0.08)]);
  ok('ardışık yokuşlar tek kesim', m.length === 1, J(m));
  ok('birleşik kesim from/to/lenKm', m[0].from === 0 && m[0].to === 3 && near(m[0].lenKm, 3), J(m[0]));
  ok('birleşik eğim ağırlıklı ortalama (0.2/3)', near(m[0].grade, 0.2 / 3), m[0].grade);

  // iniş: grade mutlak değer, dir -1
  const d = steepSections([seg(10, 12, -0.07), seg(12, 14, -0.05)]);
  ok('ardışık inişler tek kesim, dir -1', d.length === 1 && d[0].dir === -1 && d[0].from === 10 && d[0].to === 14, J(d));
  ok('iniş eğimi pozitif (mutlak) 0.06', near(d[0].grade, 0.06), d[0].grade);

  // yön değişimi böler; düz dilim böler
  const flip = steepSections([seg(0, 2, 0.06), seg(2, 4, -0.06)]);
  ok('yokuş→iniş iki ayrı kesim', flip.length === 2 && flip[0].dir === 1 && flip[1].dir === -1
    && flip[0].to === 2 && flip[1].from === 2, J(flip));
  const gap = steepSections([seg(0, 2, 0.06), seg(2, 4, 0.01), seg(4, 6, 0.07)]);
  ok('arada düz dilim → iki yokuş kesimi', gap.length === 2 && gap[0].to === 2 && gap[1].from === 4 && gap[1].to === 6, J(gap));
  ok('ikinci kesim kendi eğimiyle', near(gap[1].grade, 0.07), gap[1].grade);

  // sondaki açık kesim de çıktıya girer; sıra rota sırasıdır
  const tail = steepSections([seg(0, 2, 0), seg(2, 4, 0.09)]);
  ok('sonda biten dik kesim eklenir', tail.length === 1 && tail[0].from === 2 && tail[0].to === 4, J(tail));

  // özel eşik
  ok('thr=0.08 → %6 dik değil', steepSections([seg(0, 2, 0.06)], 0.08).length === 0);
  ok('thr=0.03 → %4 dik', steepSections([seg(0, 2, 0.04)], 0.03).length === 1);

  // çıktı biçimi: yalnız dir/from/to/lenKm/grade
  ok('kesim alanları dir,from,to,lenKm,grade', J(Object.keys(m[0]).sort()) === J(['dir', 'from', 'grade', 'lenKm', 'to']), J(Object.keys(m[0])));
}

// ---------- distText ----------
{
  const cases = [
    [0.95, '1 kilometre'],   // sınır: 0.95 km ve üstü kilometre
    [0.949, '900 metre'],    // sınırın hemen altı metre, 100 m'ye yuvarlanır (9.49 → 9)
    [0.94, '900 metre'],
    [1, '1 kilometre'],
    [1.4, '1 kilometre'],
    [1.5, '2 kilometre'],
    [2.2, '2 kilometre'],
    [0, '100 metre'],        // alt sınır 100 m
    [0.04, '100 metre'],
    [0.049, '100 metre'],
    [0.06, '100 metre'],     // 0.6 → 1 → 100
    [0.12, '100 metre'],
    [0.15, '200 metre'],     // 1.5 → 2
    [0.25, '300 metre'],     // 2.5 → 3 (yukarı yuvarlama)
    [0.3, '300 metre'],
    [0.34, '300 metre'],
    [0.45, '500 metre'],     // 4.5 → 5
    [0.7, '700 metre'],
  ];
  for (const [km, want] of cases) {
    const got = distText(km);
    ok(`distText(${km}) = "${want}"`, got === want, `got "${got}"`);
  }
  ok('distText metre çıktısı daima 100\'ün katı', [0.01, 0.17, 0.33, 0.51, 0.88].every((k) => /^\d+00 metre$/.test(distText(k))));
}

// ---------- pickWarnings: eğim ----------
{
  const sec = (from, dir = 1, grade = 0.07, lenKm = 2) => ({ dir, from, to: from + lenKm, lenKm, grade });

  // uzak: d > 2.2 → ne konuşma ne çizgi
  let said = new Set();
  let r = pickWarnings(0, [sec(2.25)], [], said);
  ok('eğim 2.25 km uzakta → konuşma yok', r.speak.length === 0, J(r.speak));
  ok('eğim 2.25 km uzakta → gradeLine null', r.gradeLine === null, J(r.gradeLine));
  ok('uzak kesim said\'e eklenmez', said.size === 0);

  // üst sınır 2.2 dahil
  said = new Set();
  r = pickWarnings(0, [sec(2.2)], [], said);
  ok('eğim tam 2.2 km → konuşur', r.speak.length === 1 && r.speak[0].kind === 'grade', J(r.speak));
  ok('eğim anahtarı g2.2', r.speak[0]?.key === 'g2.2' && said.has('g2.2'), J(r.speak[0]));
  ok('eğim konuşma alanları', r.speak[0]?.dir === 1 && r.speak[0]?.grade === 0.07 && r.speak[0]?.lenKm === 2 && near(r.speak[0]?.dKm, 2.2), J(r.speak[0]));
  ok('gradeLine dolu (2.2 km)', r.gradeLine && near(r.gradeLine.dKm, 2.2) && r.gradeLine.dir === 1 && r.gradeLine.grade === 0.07 && r.gradeLine.lenKm === 2, J(r.gradeLine));

  // said dedup: ikinci çağrıda konuşma yok ama çizgi sürer
  r = pickWarnings(0.5, [sec(2.2)], [], said);
  ok('aynı kesim ikinci kez konuşulmaz (said)', r.speak.length === 0, J(r.speak));
  ok('dedup sonrası gradeLine sürer', r.gradeLine && near(r.gradeLine.dKm, 1.7), J(r.gradeLine));

  // alt sınır 0.5 dahil; altı konuşmaz ama çizgi gösterir
  said = new Set();
  r = pickWarnings(0, [sec(0.5)], [], said);
  ok('eğim tam 0.5 km → konuşur', r.speak.length === 1, J(r.speak));
  said = new Set();
  r = pickWarnings(0, [sec(0.4)], [], said);
  ok('eğim 0.4 km (geç) → konuşma yok', r.speak.length === 0 && said.size === 0, J(r.speak));
  ok('eğim 0.4 km → gradeLine yine gösterilir', r.gradeLine && near(r.gradeLine.dKm, 0.4), J(r.gradeLine));
  r = pickWarnings(0.5, [sec(0.5)], [], said);
  ok('kesim başında (d=0) → konuşma yok, gradeLine d=0', r.speak.length === 0 && r.gradeLine && r.gradeLine.dKm === 0, J(r));

  // geçmiş: d < 0 → filtre
  r = pickWarnings(3, [sec(2)], [], new Set());
  ok('geçilmiş/içindeki kesim → gradeLine null, konuşma yok', r.gradeLine === null && r.speak.length === 0, J(r));

  // iniş yönü taşınır
  r = pickWarnings(0, [sec(1, -1, 0.08)], [], new Set());
  ok('iniş uyarısı dir -1', r.speak[0]?.dir === -1 && r.gradeLine?.dir === -1, J(r));

  // en yakın ekran uyarısı: geçilen kesim atlanır, sıradaki en yakın gradeLine olur
  said = new Set();
  r = pickWarnings(1, [sec(0.5), sec(1.75, -1), sec(3)], [], said);
  ok('gradeLine geçilen değil, en yakın ilerideki kesim', r.gradeLine && r.gradeLine.dir === -1 && near(r.gradeLine.dKm, 0.75), J(r.gradeLine));
  ok('2.2 km ötesi (d=2) içeride, ikisi de konuşur', r.speak.length === 2 && r.speak[0].key === 'g1.8' && r.speak[1].key === 'g3.0', J(r.speak));

  // grade:false
  said = new Set();
  r = pickWarnings(0, [sec(1)], [], said, { grade: false });
  ok('grade:false → eğim konuşması yok', r.speak.length === 0, J(r.speak));
  ok('grade:false → gradeLine null', r.gradeLine === null);
  ok('grade:false → said değişmez', said.size === 0);
  r = pickWarnings(0, [sec(1)], [], said, { grade: true });
  ok('grade:false sonrası açılınca konuşur (said kirlenmedi)', r.speak.length === 1, J(r.speak));

  // seçenek verilmezse ikisi de açık
  r = pickWarnings(0, [sec(1)], [{ km: 1 }], new Set());
  ok('varsayılan seçenekler: eğim + kamera açık', r.speak.some((s) => s.kind === 'grade') && r.speak.some((s) => s.kind === 'camera'), J(r.speak));
}

// ---------- pickWarnings: kamera ----------
{
  const cam = (km, maxspeed) => (maxspeed === undefined ? { km } : { km, maxspeed });
  const camAt = (dist, opts) => pickWarnings(0, [], [cam(dist, 90)], new Set(), opts);

  // uzak pencere 0.7–1.3
  let r = camAt(1.31);
  ok('kamera 1.31 km → konuşma yok, camLine null', r.speak.length === 0 && r.camLine === null, J(r));
  r = camAt(1.3);
  ok('kamera tam 1.3 km → far konuşur', r.speak.length === 1 && r.speak[0].key === 'c1.30far', J(r.speak));
  ok('kamera konuşma alanları', r.speak[0]?.kind === 'camera' && near(r.speak[0]?.dKm, 1.3) && r.speak[0]?.maxspeed === 90, J(r.speak[0]));
  ok('camLine 1.3 km + maxspeed', r.camLine && near(r.camLine.dKm, 1.3) && r.camLine.maxspeed === 90, J(r.camLine));
  r = camAt(1);
  ok('kamera 1 km → far', r.speak.length === 1 && r.speak[0].key === 'c1.00far', J(r.speak));
  r = camAt(0.7);
  ok('kamera tam 0.7 km → far', r.speak.length === 1 && r.speak[0].key === 'c0.70far', J(r.speak));

  // pencereler arası boşluk: konuşma yok, camLine var
  for (const d of [0.69, 0.5, 0.46]) {
    r = camAt(d);
    ok(`kamera ${d} km (pencereler arası) → konuşma yok, camLine var`, r.speak.length === 0 && r.camLine && near(r.camLine.dKm, d), J(r));
  }

  // yakın pencere 0.12–0.45
  r = camAt(0.45);
  ok('kamera tam 0.45 km → near', r.speak.length === 1 && r.speak[0].key === 'c0.45near', J(r.speak));
  r = camAt(0.3);
  ok('kamera 0.3 km → near', r.speak.length === 1 && r.speak[0].key === 'c0.30near', J(r.speak));
  r = camAt(0.12);
  ok('kamera tam 0.12 km → near', r.speak.length === 1 && r.speak[0].key === 'c0.12near', J(r.speak));
  r = camAt(0.11);
  ok('kamera 0.11 km → konuşma yok, camLine var', r.speak.length === 0 && r.camLine && near(r.camLine.dKm, 0.11), J(r));
  r = camAt(0);
  ok('kamera üstünde (d=0) → konuşma yok, camLine d=0', r.speak.length === 0 && r.camLine?.dKm === 0, J(r));

  // geçmiş kamera filtrelenir
  r = pickWarnings(5, [], [cam(4.9, 50)], new Set());
  ok('geçilmiş kamera → camLine null, konuşma yok', r.camLine === null && r.speak.length === 0, J(r));

  // aynı kamera: far bir kez, sonra near bir kez (ayrı anahtarlar), tekrar yok
  const said = new Set();
  const cams = [cam(10, 70)];
  const seq = [8.9, 9.0, 9.2, 9.5, 9.6, 9.7, 9.88, 9.95].map((km) => pickWarnings(km, [], cams, said).speak.map((s) => s.key));
  ok('kamera yaklaşırken: 1.1 km far, 0.4 km near, başka yok',
    J(seq) === J([['c10.00far'], [], [], [], ['c10.00near'], [], [], []]), J(seq));
  ok('said içinde far + near anahtarı', said.has('c10.00far') && said.has('c10.00near') && said.size === 2, J([...said]));

  // maxspeed yok → null; 0 korunur (?? null)
  r = pickWarnings(0, [], [cam(1)], new Set());
  ok('maxspeed yok → konuşmada null', r.speak[0]?.maxspeed === null, J(r.speak[0]));
  ok('maxspeed yok → camLine.maxspeed null', r.camLine && r.camLine.maxspeed === null, J(r.camLine));
  r = pickWarnings(0, [], [{ km: 1, maxspeed: null }], new Set());
  ok('maxspeed null → null', r.speak[0]?.maxspeed === null && r.camLine?.maxspeed === null, J(r));

  // camera:false
  const s2 = new Set();
  r = pickWarnings(0, [], [cam(1, 90)], s2, { camera: false });
  ok('camera:false → kamera konuşması yok, camLine null', r.speak.length === 0 && r.camLine === null, J(r));
  ok('camera:false → said değişmez', s2.size === 0);
  // camera:false eğimi etkilemez, grade:false kamerayı etkilemez
  r = pickWarnings(0, [{ dir: 1, from: 1, to: 3, lenKm: 2, grade: 0.06 }], [cam(1, 90)], new Set(), { camera: false });
  ok('camera:false iken eğim uyarısı sürer', r.speak.length === 1 && r.speak[0].kind === 'grade' && r.gradeLine && r.camLine === null, J(r));
  r = pickWarnings(0, [{ dir: 1, from: 1, to: 3, lenKm: 2, grade: 0.06 }], [cam(1, 90)], new Set(), { grade: false });
  ok('grade:false iken kamera uyarısı sürer', r.speak.length === 1 && r.speak[0].kind === 'camera' && r.camLine && r.gradeLine === null, J(r));
  r = pickWarnings(0, [{ dir: 1, from: 1, to: 3, lenKm: 2, grade: 0.06 }], [cam(1, 90)], new Set(), { grade: false, camera: false });
  ok('ikisi de kapalı → boş sonuç', r.speak.length === 0 && r.gradeLine === null && r.camLine === null, J(r));

  // en yakın ekran kamerası: geçilen atlanır, ilk ilerideki (sıralı liste) camLine olur; uzak olan konuşmaz
  r = pickWarnings(2, [], [cam(1.9, 30), cam(2.3, 50), cam(3.0, 110), cam(3.5, 120)], new Set());
  ok('camLine en yakın ilerideki kamera (0.3 km, 50)', r.camLine && near(r.camLine.dKm, 0.3) && r.camLine.maxspeed === 50, J(r.camLine));
  ok('iki kamera aynı anda: near(2.30) + far(3.00); 3.5 km uzak', J(r.speak.map((s) => s.key)) === J(['c2.30near', 'c3.00far']), J(r.speak));

  // sonuç biçimi
  ok('dönüş alanları speak/gradeLine/camLine', J(Object.keys(r).sort()) === J(['camLine', 'gradeLine', 'speak']), J(Object.keys(r)));
}

// ---------- dedupeCams ----------
{
  ok('boş liste → []', J(dedupeCams([])) === '[]');
  const input = [{ km: 5, id: 'e' }, { km: 1, id: 'a' }, { km: 1.05, id: 'b' }, { km: 1.2, id: 'c' }, { km: 4.92, id: 'd' }];
  const before = J(input);
  const out = dedupeCams(input);
  ok('km\'ye göre sıralı', out.every((c, i) => i === 0 || out[i - 1].km <= c.km), J(out));
  ok('100 m içindekiler birleşir, ilk (en küçük km) kalır', J(out.map((c) => c.id)) === J(['a', 'c', 'd']), J(out));
  ok('giriş dizisi değiştirilmez', J(input) === before, J(input));
  ok('kamera nesneleri aynı referans', out[0] === input[1]);

  ok('0.09 km aralık → birleşir', dedupeCams([{ km: 2 }, { km: 2.09 }]).length === 1);
  ok('0.11 km aralık → ayrı', dedupeCams([{ km: 2 }, { km: 2.11 }]).length === 2);
  // karşılaştırma son tutulan kameraya göre: 1, 1.08, 1.16 → 1 ve 1.16
  const chain = dedupeCams([{ km: 1.16 }, { km: 1 }, { km: 1.08 }]);
  ok('zincir: son tutulana göre (1, 1.16)', J(chain.map((c) => c.km)) === J([1, 1.16]), J(chain));
  const dup = dedupeCams([{ km: 3, maxspeed: 90 }, { km: 3, maxspeed: 70 }]);
  ok('aynı km iki kayıt → tek (ilk gelen, kararlı sıralama)', dup.length === 1 && dup[0].maxspeed === 90, J(dup));
  ok('tek kamera aynen döner', J(dedupeCams([{ km: 7 }])) === J([{ km: 7 }]));
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
if (fail) process.exit(1);
