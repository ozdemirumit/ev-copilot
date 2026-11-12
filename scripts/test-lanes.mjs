// Sağlayıcı şerit verisi (Mapbox/OSRM lanes) ayrıştırma ve gösterim kuralı. Kullanım: node scripts/test-lanes.mjs
import { readFileSync } from 'node:fs';
import { parseLanes, lanesToShow, LANES_SHOW_M } from '../js/nav/lanes.js';
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

ok('panelde nav-lanes alanı', read('index.html').includes('id="nav-lanes"'));
ok('sw önbelleğinde lanes.js', read('sw.js').includes("'./js/nav/lanes.js'"));
ok('navigator şeritleri çizer', read('js/nav/navigator.js').includes('lanesToShow(st, distM)'));

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
