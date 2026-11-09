// TomTom rota dönüştürücüsü (istemci): TomTom Routing v1 yanıtı → uygulamanın rota biçimi. Sahte (elle yazılmış) yanıtla, ağ ve anahtar yok.
// Kullanım: node scripts/test-tomtom-route.mjs
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Tarayıcı nesneleri sahte (modül zinciri localStorage/document ister)
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() }; };
globalThis.localStorage = mem();
globalThis.sessionStorage = mem();
globalThis.document = { dispatchEvent() {}, addEventListener() {} };
const R = await import('../js/tomtom/route.js');

const P = (lat, lon) => ({ latitude: lat, longitude: lon });
// İki bacak (ara durak 41.0,29.0): bacak sonu ile sonraki bacak başı AYNI nokta (TomTom böyle verir); dizinler birleşik (tekrarlı) dizi içindir.
const fixture = {
  routes: [{
    summary: { lengthInMeters: 6000, travelTimeInSeconds: 660, noTrafficTravelTimeInSeconds: 600, historicTrafficTravelTimeInSeconds: 600 },
    legs: [
      { summary: { lengthInMeters: 3000 }, points: [P(40.0, 28.0), P(40.01, 28.0), P(40.02, 28.0), P(40.03, 28.0)] }, // 0..3
      { summary: { lengthInMeters: 3000 }, points: [P(40.03, 28.0), P(40.04, 28.0), P(40.05, 28.0), P(40.06, 28.0)] }, // 4..7 (4 = tekrar)
    ],
    sections: [
      { sectionType: 'SPEED_LIMIT', maxSpeedLimitInKmh: 50, startPointIndex: 0, endPointIndex: 3 },
      { sectionType: 'SPEED_LIMIT', maxSpeedLimitInKmh: 90, startPointIndex: 3, endPointIndex: 7 },
      { sectionType: 'TRAFFIC', simpleCategory: 'JAM', magnitudeOfDelay: 2, delayInSeconds: 120, startPointIndex: 1, endPointIndex: 3 },
      { sectionType: 'TRAFFIC', simpleCategory: 'JAM', magnitudeOfDelay: 0, delayInSeconds: 0, startPointIndex: 5, endPointIndex: 6 }, // gecikmesiz: atlanır
    ],
    guidance: {
      instructions: [
        { routeOffsetInMeters: 0, travelTimeInSeconds: 0, maneuver: 'DEPART', street: 'Ana Cadde' },
        { routeOffsetInMeters: 1000, travelTimeInSeconds: 100, maneuver: 'TURN_RIGHT', street: 'Gül Sokak' },
        { routeOffsetInMeters: 2000, travelTimeInSeconds: 220, maneuver: 'ROUNDABOUT_CROSS', street: 'Kavşak Yolu', roundaboutExitNumber: 2 },
        { routeOffsetInMeters: 3000, travelTimeInSeconds: 330, maneuver: 'WAYPOINT_RIGHT', street: 'Ara Cadde' },
        { routeOffsetInMeters: 4500, travelTimeInSeconds: 480, maneuver: 'MOTORWAY_EXIT_LEFT', street: 'D-100' },
        { routeOffsetInMeters: 6000, travelTimeInSeconds: 660, maneuver: 'ARRIVE', street: 'Varış Caddesi' },
      ],
    },
  }],
};

const r = R.convertRoute(fixture, true);
ok('geometri: bacak birleşimindeki tekrarlı nokta elenir, [lon,lat] sırası', r.coords.length === 7 && eq(r.coords[0], [28.0, 40.0]) && eq(r.coords.at(-1), [28.0, 40.06]));
ok('uzunluk ve süre özetten (km, saat)', r.distanceKm === 6 && Math.abs(r.durationH - 660 / 3600) < 1e-9);
ok('trafik oranı = canlı süre / olağan süre (≥ 1)', Math.abs(r.trafficRatio - 1.1) < 1e-9 && R.convertRoute({ routes: [{ ...fixture.routes[0], summary: { ...fixture.routes[0].summary, travelTimeInSeconds: 500 } }] }).trafficRatio === 1);
ok('canlı rota, aralık boş (Mapbox ile aynı biçim)', r.live === true && eq(r.intervals, []));
ok('adımlar: yola çık, dön, kavşak, ara durak, çıkış, varış; son adım arrive', eq(r.steps.map((s) => s.type), ['depart', 'turn', 'roundabout', 'stop', 'off ramp', 'arrive']));
ok('dönüş değiştiricisi: sağa dönüş → turn right; çıkış soldan', r.steps[1].modifier === 'right' && r.steps[4].modifier === 'left');
ok('Türkçe talimat (yol adı ve kavşak çıkışı)', r.steps[0].text === 'Yola çıkın (Ana Cadde)' && r.steps[1].text === 'Sağa dönün (Gül Sokak)' && r.steps[2].text === 'Kavşağa girin, 2. çıkıştan çıkın');
ok('adım mesafesi/süresi bir sonraki talimatla farktan', r.steps[1].distM === 1000 && r.steps[1].staticSec === 120 && r.steps[4].distM === 1500 && r.steps[4].staticSec === 180);
ok('ara durak adımı (stop) ve yalnızca son adım arrive', r.steps[3].type === 'stop' && r.steps.filter((s) => s.type === 'arrive').length === 1 && r.steps.at(-1).distM === 0);
ok('trafik kesimleri: orta gecikme → heavy, km aralığı; gecikmesiz atlanır', r.trafficSpans.length === 1 && r.trafficSpans[0].lvl === 'heavy' && Math.abs(r.trafficSpans[0].from - 1.11) < 0.05 && Math.abs(r.trafficSpans[0].to - 3.33) < 0.05);
ok('hız limiti kesimleri [lat1,lon1,lat2,lon2,kph]; 50 sonra 90', r.limitSpans.length >= 2 && r.limitSpans[0][4] === 50 && r.limitSpans.at(-1)[4] === 90 && r.limitSpans[0].length === 5);
ok('hız limiti Premium değilse eklenmez', !('limitSpans' in R.convertRoute(fixture, false)));

// Eşleme ve sınırlar
ok('manevra eşlemesi: KEEP_LEFT→fork, ENTER_MOTORWAY→on ramp, MAKE_UTURN→uturn', eq(R.mapManeuver('KEEP_LEFT'), ['fork', 'left']) && eq(R.mapManeuver('ENTER_MOTORWAY'), ['on ramp', null]) && eq(R.mapManeuver('MAKE_UTURN'), ['turn', 'uturn']));
ok('bilinmeyen manevra → düz devam (çökmez)', eq(R.mapManeuver('NEW_UNKNOWN_CODE'), ['continue', 'straight']));
ok('rota yoksa TomTomError', (() => { try { R.convertRoute({ routes: [] }); return false; } catch (e) { return e instanceof R.TomTomError; } })());
ok('geçersiz hız limiti (0, 999) kesim üretmez', R.limitSpans([{ sectionType: 'SPEED_LIMIT', maxSpeedLimitInKmh: 999, startPointIndex: 0, endPointIndex: 2 }], [[40, 28], [40.01, 28], [40.02, 28]], [0, 1, 2]).length === 0);
ok('yol kapanışı (ROAD_CLOSURE) en yoğun düzeyde', R.trafficSpans([{ sectionType: 'TRAFFIC', simpleCategory: 'ROAD_CLOSURE', magnitudeOfDelay: 4, delayInSeconds: 0, startPointIndex: 0, endPointIndex: 3 }], [[40, 28], [40.01, 28], [40.02, 28], [40.03, 28]])[0]?.lvl === 'severe');

// Kaynak sözleşmeleri: sağlayıcı sırası, harita koşulu, anahtar sızmaz
const prov = readFileSync(new URL('../js/providers/index.js', import.meta.url), 'utf8');
const rt = readFileSync(new URL('../js/tomtom/route.js', import.meta.url), 'utf8');
ok('rota sırası: TomTom (Premium + TomTom haritası) → Mapbox → Valhalla', /proxyHas\('tomtom'\) && premiumAccess\(\) && activeMap\(\) === 'tomtom'/.test(prov) && prov.indexOf('tomtomRoute(...a)') < prov.indexOf('mapboxRoute(...a)') && prov.indexOf('mapboxRoute(...a)') < prov.lastIndexOf('osmRoute(...a)'));
ok('TomTom hatasında sessiz düşüş, nedeni not olarak yazılır', /TomTom rotası alınamadı \(/.test(prov));
ok('istemci TomTom anahtarını bilmez: yalnızca /tomtom/route', /\/tomtom\/route\?pts=/.test(rt) && !/key=|apiKey|TOMTOM_KEY/.test(rt));
ok('402/429 durumları ayrı hata olarak', /res\.status === 402/.test(rt) && /res\.status === 429/.test(rt));
ok('harita adı yalnızca harita hazır olunca yazılır, hata/yenilemede silinir', /setActiveMap\(adapter\.name \|\| 'osm'\)/.test(readFileSync(new URL('../js/ui/mapView.js', import.meta.url), 'utf8')) && /setActiveMap\(null\)/.test(readFileSync(new URL('../js/ui/mapView.js', import.meta.url), 'utf8')));
const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
ok('yeni modüller çevrimdışı kabukta', ['./js/ui/maps/tomtom.js', './js/net/activeMap.js', './js/tomtom/route.js'].every((f) => sw.includes(`'${f}'`)));

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
