// "Yarım kalan navigasyonu sürdür" (js/nav/resumePlan.js + js/ui/resumeNav.js) testleri (bağımsız, düz node): node scripts/test-resume-plan.mjs
// Amaç: uygulama sürüş ortasında kapanırsa (bellek baskısı, bağlantısız bölge) kayıtlı rotayla, AĞSIZ ve yalnız kullanıcı dokunuşuyla sürdürmek.
// Kurallar: yalnız bu cihazda saklanır; kendiliğinden başlamaz; 12 saatten eski, farklı sürümde üretilmiş ya da bozuk kayıt reddedilir (fail-closed);
// navigasyon bitince kayıt silinir; çok büyük plan kaydedilmez.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}`); } }
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(ROOT + f, 'utf8');

const R = await import('../js/nav/resumePlan.js');
const NOW = 1_800_000_000_000;
const V = '0.99.121';
const coords = Array.from({ length: 400 }, (_, i) => [30 + i * 0.001234567, 40 + i * 0.000765432]);
const stationA = { id: 's1', name: 'İstasyon A', lat: 40.1, lon: 30.2, kw: 180 };
const plan = {
  status: 'ready', text: 'Plan hazır', mode: 'opt', planId: 'p-123',
  route: { coords, steps: [{ type: 'depart', text: 'Başla', distM: 100 }, { type: 'arrive', text: 'Vardın', distM: 0 }], distanceKm: 55, durationH: 0.8, trafficRatio: 1, intervals: [], roadEvents: { v: 1, provider: 'osm', supports: ['tunnel'], events: [], denied: [] }, routeMeta: { provider: 'osm' } },
  profile: { segs: [{ km: 0, soc: 80 }, { km: 55, soc: 40 }], wx: [] },
  steps: [{ type: 'depart', text: 'Başla', distM: 100, km: 0 }, { type: 'arrive', text: 'Vardın', distM: 0, km: 55 }],
  wxInfo: { source: 'open-meteo' },
  stations: Array.from({ length: 300 }, (_, i) => ({ id: 'x' + i, name: 'İst ' + i, lat: 40, lon: 30 })).concat([stationA]),
  stationInfo: { errors: [], summary: 'çok uzun metin '.repeat(50) },
  ranking: Array.from({ length: 50 }, (_, i) => ({ id: i })),
  stops: [{ station: stationA, km: 20, arriveSoc: 25, leaveSoc: 80, cost: 120 }],
  pinIds: ['s1'], banIds: [], totals: { minutes: 90, cost: 120 }, fromKm: 0, fromSoc: 80,
};
const route = { start: { lat: 40, lon: 30, label: 'Başlangıç' }, end: { lat: 40.3, lon: 30.4, label: 'Hedef Mah.' }, via: null };

// ---- A) anlık görüntü ----
const snap = R.buildSnapshot({ plan, route, version: V, now: NOW });
ok('A sabitler', R.MAX_AGE_MS === 12 * 3600e3 && R.MAX_BYTES === 1_500_000 && R.SCHEMA === 1);
ok('A geçerli plan → anlık görüntü (şema, sürüm, zaman, hedef etiketi)', snap && snap.v === 1 && snap.appVersion === V && snap.savedAt === NOW && snap.label === 'Hedef Mah.');
ok('A rota, profil, adımlar, duraklar, toplamlar korunur', snap.plan.route.coords.length === 400 && snap.plan.profile.segs.length === 2 && snap.plan.steps.length === 2 && snap.plan.stops.length === 1 && snap.plan.totals.cost === 120 && snap.plan.planId === 'p-123' && snap.plan.mode === 'opt');
ok('A ağır/gereksiz alanlar atılır: istasyon listesi yalnız duraklardakiler, ranking/stationInfo yok', snap.plan.stations.length === 1 && snap.plan.stations[0].id === 's1' && !('ranking' in snap.plan) && snap.plan.stationInfo === null);
ok('A koordinatlar 5 ondalığa yuvarlanır (≈1 m; boyut küçülür)', snap.plan.route.coords.every((c) => (String(c[0]).split('.')[1] || '').length <= 5 && (String(c[1]).split('.')[1] || '').length <= 5) && Math.abs(snap.plan.route.coords[399][0] - coords[399][0]) < 1e-5);
ok('A hedef/başlangıç/ara durak kaydedilir', snap.route.end.label === 'Hedef Mah.' && snap.route.start.lat === 40 && snap.route.via === null);
ok('A girdi nesneleri değişmez (plan/route aynen)', plan.stations.length === 301 && plan.route.coords[0][0] === 30 && 'ranking' in plan);
ok('A rota/profil/adım yoksa kaydedilmez', [{ ...plan, route: null }, { ...plan, profile: null }, { ...plan, steps: [] }, { ...plan, status: 'error' }, null, undefined].every((p) => R.buildSnapshot({ plan: p, route, version: V, now: NOW }) === null));
ok('A hedef yoksa kaydedilmez', R.buildSnapshot({ plan, route: { start: route.start, end: null }, version: V, now: NOW }) === null && R.buildSnapshot({ plan, route: null, version: V, now: NOW }) === null);
{
  const huge = { ...plan, route: { ...plan.route, coords: Array.from({ length: 120000 }, (_, i) => [30 + i * 1e-4, 40 + i * 1e-4]) } };
  ok('A çok büyük plan (> MAX_BYTES) kaydedilmez', R.buildSnapshot({ plan: huge, route, version: V, now: NOW }) === null);
  ok('A tipik plan boyutu makul (< 150 KB)', JSON.stringify(snap).length < 150_000);
}

// ---- B) doğrulama (fail-closed) ----
ok('B taze ve aynı sürüm → ok', R.checkSnapshot(snap, { version: V, now: NOW + 60_000 }).ok === true);
ok('B 12 saatten eski → age', R.checkSnapshot(snap, { version: V, now: NOW + 12 * 3600e3 + 1 }).reason === 'age' && R.checkSnapshot(snap, { version: V, now: NOW + 12 * 3600e3 - 1000 }).ok === true);
ok('B gelecekteki kayıt (saat kayması > 5 dk) → age', R.checkSnapshot({ ...snap, savedAt: NOW + 10 * 60e3 }, { version: V, now: NOW }).reason === 'age');
ok('B farklı uygulama sürümü → version (plan şekli değişmiş olabilir)', R.checkSnapshot(snap, { version: '0.99.999', now: NOW }).reason === 'version');
ok('B bozuk/yabancı kayıt → format', [null, undefined, 'x', 5, {}, { v: 2 }, { ...snap, plan: null }, { ...snap, route: {} }, { ...snap, plan: { ...snap.plan, route: { coords: [] } } }, { ...snap, plan: { ...snap.plan, steps: 'x' } }].every((s) => R.checkSnapshot(s, { version: V, now: NOW }).reason === 'format'));
ok('B yaş metni: dk / sa', R.ageMinutes(snap, NOW + 5 * 60e3) === 5 && R.ageMinutes(snap, NOW + 90 * 60e3) === 90 && R.ageMinutes(null, NOW) === null);

// ---- C) geri yükleme ----
{
  const parts = R.restoreParts(snap);
  ok('C route dilimi: başlangıç, hedef, ara durak', parts.route.end.label === 'Hedef Mah.' && parts.route.start.lat === 40 && 'via' in parts.route);
  ok('C plan dilimi: durum ok, rota/profil/adım/durak aynen; kayıtlı plan kimliği korunur', parts.plan.status === 'ready' && parts.plan.route.coords.length === 400 && parts.plan.stops[0].station.id === 's1' && parts.plan.planId === 'p-123');
  ok('C geri yüklenen plan, kayıttan bağımsız kopya (kayıt değişmez)', (() => { parts.plan.route.coords.length = 0; return snap.plan.route.coords.length === 400; })());
  ok('C yüklenen metin kullanıcıya "kayıtlı rota" olduğunu söyler', /kayıtlı/i.test(R.restoreParts(snap).plan.text));
}

// ---- D) kablolama ----
{
  const html = read('index.html'), sw = read('sw.js'), app = read('js/app.js'), ui = read('js/ui/resumeNav.js'), pure = read('js/nav/resumePlan.js'), ver = read('version.js');
  ok('D index.html: sürdür kartı ve düğmeleri (varsayılan gizli)', /id="resume-card"[^>]*class="[^"]*hidden/.test(html) || /class="[^"]*hidden[^"]*"[^>]*id="resume-card"/.test(html));
  ok('D index.html: Sürdür / Sil düğmeleri ve metin alanı', ['resume-go', 'resume-drop', 'resume-text'].every((id) => html.includes(`id="${id}"`)));
  ok('D sw.js kabuğunda iki yeni dosya', sw.includes("'./js/nav/resumePlan.js'") && sw.includes("'./js/ui/resumeNav.js'"));
  ok('D app.js: initResumeNav çağrılır', /import \{ initResumeNav \} from '\.\/ui\/resumeNav\.js'/.test(app) && /^initResumeNav\(\);/m.test(app));
  ok('D kendiliğinden başlamaz: startNav yalnız Sürdür tıklamasında', /resume-go'\)\.addEventListener\('click'/.test(ui) && (ui.match(/startNav\(/g) || []).length === 1);
  ok('D navigasyon bitince (active true→false) kayıt silinir; durdururken de', /subscribe\('nav'/.test(ui) && /remove\(KEY\)|clearSaved\(/.test(ui));
  ok('D ağ yok: ağ/konum/kamera API\'si çağrılmaz', ![pure, ui].some((s) => /fetch\(|XMLHttpRequest|sendBeacon|geolocation|proxyFetch/.test(s)));
  ok('D saf modül depolama/DOM/zaman okumaz', !/localStorage|sessionStorage|document\.|Date\.now|window\./.test(pure));
  ok('D sürüm 0.99.121 kaydı changelog\'da', /self\.APP_VERSION = '0\.99\.\d+';/.test(ver) && /v: '0\.99\.121'/.test(ver));
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
