// Sağlayıcı şerit verisi (Mapbox/OSRM lanes) ayrıştırma ve gösterim kuralı. Kullanım: node scripts/test-lanes.mjs
import { readFileSync } from 'node:fs';
import { parseLanes, lanesToShow, laneHint, addLaneHint, LANES_SHOW_M } from '../js/nav/lanes.js';
import { mapSteps } from '../js/mapbox/route.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const raw = [
  { indications: ['left'], valid: false },
  { indications: ['straight', 'right'], valid: true, valid_indication: 'right' },
  { indications: ['right'], valid: true },
];
const l = parseLanes(raw);
ok('3 şerit ayrışır', l?.length === 3, JSON.stringify(l));
ok('uygun olmayan şerit soluk', l && l[0].ok === false && l[0].arrow === '←');
ok('valid_indication okunur', l && l[1].ok && l[1].arrow === '→');
ok('veri yoksa null (uydurma yok)', parseLanes(undefined) === null && parseLanes([]) === null && parseLanes('x') === null);
ok('tek şerit null', parseLanes([{ indications: ['straight'], valid: true }]) === null);
ok('hepsi uygunsa gösterilmez', parseLanes([{ indications: ['straight'], valid: true }, { indications: ['straight'], valid: true }]) === null);
ok('hiçbiri uygun değilse gösterilmez', parseLanes([{ indications: ['left'], valid: false }, { indications: ['right'], valid: false }]) === null);
ok('bilinmeyen yön düz sayılır', parseLanes([{ indications: ['weird'], valid: true }, { indications: ['left'], valid: false }])?.[0].arrow === '↑');

ok('uzakta gösterilmez', lanesToShow({ lanes: l }, LANES_SHOW_M + 1) === null);
ok('yakında gösterilir', lanesToShow({ lanes: l }, 400) === l);
ok('adımda veri yoksa null', lanesToShow({}, 100) === null && lanesToShow(null, 100) === null);

const steps = mapSteps([{ steps: [
  { maneuver: { type: 'depart' }, name: 'A', distance: 100, duration: 10, intersections: [{}] },
  { maneuver: { type: 'turn', modifier: 'right' }, name: 'B', distance: 200, duration: 20, intersections: [{ lanes: raw }] },
  { maneuver: { type: 'arrive' }, name: 'B', distance: 0, duration: 0 },
] }]);
ok('Mapbox adımına lanes eklenir', steps[1].lanes?.length === 3, JSON.stringify(steps[1]));
ok('şeritsiz adım null', steps[0].lanes === null);

// Sesli şerit önerisi: yalnızca sağlayıcının valid bayraklarından, konum kesinse; adım başına bir kez, dönüş anonsuna eklenir
const L = (...v) => parseLanes(v.map((x) => ({ indications: [x ? 'right' : 'left'], valid: !!x })));
ok('sağdaki tek şerit', laneHint(L(0, 0, 1)) === 'En sağ şeridi kullanın.', laneHint(L(0, 0, 1)));
ok('soldaki tek şerit', laneHint(L(1, 0, 0)) === 'En sol şeridi kullanın.');
ok('sağdaki şeritler', laneHint(L(0, 1, 1)) === 'Sağ şeritleri kullanın.');
ok('soldaki şeritler', laneHint(L(1, 1, 0, 0)) === 'Sol şeritleri kullanın.');
ok('tam ortadaki şerit', laneHint(L(0, 1, 0)) === 'Orta şeridi kullanın.');
ok('tam ortadaki şeritler', laneHint(L(0, 1, 1, 0)) === 'Orta şeritleri kullanın.');
ok('ortada ama simetrik değil: söylenmez', laneHint(L(0, 1, 0, 0)) === null);
ok('bitişik olmayan uygun şeritler: söylenmez', laneHint(L(1, 0, 1)) === null);
ok('veri yok / seçim önemsiz: söylenmez', laneHint(null) === null && laneHint(undefined) === null && laneHint([]) === null);
ok('hepsi uygun (ayrıştırılmamış) söylenmez', laneHint([{ arrow: '↑', ok: true }, { arrow: '↑', ok: true }]) === null);

const step = { type: 'turn', modifier: 'right', lanes: L(0, 0, 1) };
const s1 = new Set();
ok('2 km eşiğinde anonsa eklenir', addLaneHint(s1, 4, step, 1900, '2 kilometre sonra sağa dönün.') === '2 kilometre sonra sağa dönün. En sağ şeridi kullanın.');
ok('aynı adımda tekrar söylenmez', addLaneHint(s1, 4, step, 480, '500 metre sonra sağa dönün.') === '500 metre sonra sağa dönün.');
ok('sonraki adım ayrı söylenir', addLaneHint(s1, 5, step, 480, 'X.') === 'X. En sağ şeridi kullanın.');
const s2 = new Set();
ok('son komutta (120 m) eklenmez, dönüş komutu aynen', addLaneHint(s2, 1, step, 100, 'Sağa dönün.') === 'Sağa dönün.' && !s2.size);
ok('şerit gösterim mesafesi dışında eklenmez', addLaneHint(new Set(), 1, step, LANES_SHOW_M + 1, 'X.') === 'X.');
ok('şerit verisi yoksa metin aynen', addLaneHint(new Set(), 1, { type: 'turn' }, 400, 'X.') === 'X.');
ok('kesin olmayan şeritte metin aynen', addLaneHint(new Set(), 1, { lanes: L(1, 0, 1) }, 400, 'X.') === 'X.');
const nav = read('js/nav/navigator.js');
ok('navigator şerit önerisini dönüş anonsuna ekler', nav.includes('addLaneHint(said, idx, st, distM, voiceNow.text)'));
ok('şerit önerisi yalnızca Türkçe seste (çeviri yok)', /startsWith\('tr'\)\s*\?\s*addLaneHint/.test(nav));

ok('panelde nav-lanes alanı', read('index.html').includes('id="nav-lanes"'));
ok('sw önbelleğinde lanes.js', read('sw.js').includes("'./js/nav/lanes.js'"));
ok('navigator şeritleri çizer', read('js/nav/navigator.js').includes('lanesToShow(st, distM)'));

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
