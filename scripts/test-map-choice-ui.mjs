// Premium harita sağlayıcısı seçici (istemci) testleri (bağımsız, düz node): node scripts/test-map-choice-ui.mjs
// Saf mantık (choiceOptions, rememberProvider) + kablolama denetimi (index.html, app.js, sw.js, anahtar sızıntısı yok). Ağ/ücretli çağrı yok.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}`); } }
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(ROOT + f, 'utf8');

// Tarayıcı depoları için en küçük taklit (mapConfig.js storage.js üzerinden localStorage, forceOsm için sessionStorage kullanır)
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear(), dump: () => [...m.entries()] }; };
globalThis.localStorage = mem();
globalThis.sessionStorage = mem();

const { choiceOptions, NOTES } = await import('../js/ui/mapChoice.js');
const { rememberProvider, savedProvider, forceOsm, osmForced } = await import('../js/net/mapConfig.js');
const { buildCatalog } = await import('../server/providerCatalog.mjs');

const ids = (j) => JSON.stringify(choiceOptions(j).map((o) => o.id));
const ALL = { mapbox: { map: true, route: true }, tomtom: { map: true, route: true }, google: { map: true } };

// ---- choiceOptions ----
ok('Premium + tüm anahtarlar: osm, mapbox, tomtom, google (here seçilemez)', ids(buildCatalog({ plan: 'premium', configured: ALL })) === '["osm","mapbox","tomtom","google"]');
ok('Premium + yalnızca mapbox: osm, mapbox', ids(buildCatalog({ plan: 'premium', configured: { mapbox: { map: true } } })) === '["osm","mapbox"]');
ok('Premium anahtarsız: yalnızca osm', ids(buildCatalog({ plan: 'premium', configured: {} })) === '["osm"]');
ok('Free (anahtarlar olsa da): yalnızca osm', ids(buildCatalog({ plan: 'free', configured: ALL })) === '["osm"]');
ok('bozuk yanıt → []', ids(null) === '[]' && ids({}) === '[]' && ids({ providers: 'x' }) === '[]' && ids({ providers: [null, 5, {}] }) === '[]');
ok('bilinmeyen sağlayıcı kimliği atılır', ids({ providers: [{ id: 'bing', label: 'Bing', selectable: true }, { id: 'osm', label: 'OSM', selectable: true }] }) === '["osm"]');
ok('selectable true değilse atılır (dize "true" sayılmaz)', ids({ providers: [{ id: 'mapbox', label: 'M', selectable: 'true' }, { id: 'tomtom', label: 'T', selectable: false }] }) === '[]');
ok('etiket yoksa kimlik kullanılır', choiceOptions({ providers: [{ id: 'osm', selectable: true }] })[0]?.label === 'osm');
ok('NOTES: seçilebilir her kimlik için not var', ['osm', 'mapbox', 'tomtom', 'google'].every((id) => typeof NOTES[id] === 'string' && NOTES[id].length > 0));
ok('NOTES dondurulmuş', Object.isFrozen(NOTES));

// ---- rememberProvider ----
rememberProvider('tomtom');
ok('rememberProvider: ad saklanır (tomtom)', savedProvider() === 'tomtom');
rememberProvider('google');
ok('rememberProvider: google', savedProvider() === 'google');
rememberProvider('bing');
ok('rememberProvider: bilinmeyen ad osm sayılır', savedProvider() === 'osm');
forceOsm();
ok('forceOsm sonrası osm zorlanır', osmForced() === true);
rememberProvider('mapbox');
ok('rememberProvider OpenFreeMap zorlamasını kaldırır', osmForced() === false && savedProvider() === 'mapbox');
ok('depoda yalnızca sağlayıcı adı var (anahtar/belirteç yok)', localStorage.dump().length === 1 && /mapProvider$/.test(localStorage.dump()[0][0]) && JSON.parse(localStorage.dump()[0][1]) === 'mapbox');

// ---- kablolama ----
const html = read('index.html'), app = read('js/app.js'), sw = read('sw.js'), mod = read('js/ui/mapChoice.js'), ver = read('version.js');
ok('index.html: kart yalnızca Premium (data-premium-only)', /id="mapchoice-card"[^>]*data-premium-only/.test(html));
ok('index.html: seçici/not/çıktı/uygula kimlikleri', ['mc-select', 'mc-note', 'mc-out', 'mc-apply'].every((i) => html.includes(`id="${i}"`)));
ok('app.js: initMapChoice içe aktarılır ve çağrılır', /import \{ initMapChoice \} from '\.\/ui\/mapChoice\.js'/.test(app) && /^initMapChoice\(\);/m.test(app));
ok('sw.js: mapChoice.js önbellek kabuğunda', sw.includes("'./js/ui/mapChoice.js'"));
ok('mapChoice.js: seçim POST /v1/map/choice, katalog GET /v1/providers', mod.includes("'/v1/map/choice'") && mod.includes("'/v1/providers'") && /method: 'POST'/.test(mod));
ok('mapChoice.js: sağlayıcı istekleri kapalıyken/yalnız ücretsiz modda sunucuya sormaz', /freeOnlyMode\(\)/.test(mod) && /providerRequestsPaused\(\)/.test(mod));
ok('mapChoice.js: Premium + oturum yoksa sormaz', /isPremium\(\)/.test(mod) && /getSession\(\)/.test(mod));
ok('mapChoice.js: anahtar/belirteç saklamaz (yalnızca rememberProvider)', !/localStorage|sessionStorage|\.token|\.key\b/.test(mod) && mod.includes('rememberProvider('));
ok('mapChoice.js: navigasyon sürerken yenileme düğmesi kapalı', /nav'\)\?\.active/.test(mod) && /apply\.disabled = navOn/.test(mod));
ok('sürüm 0.99.117 kaydı changelog\'da', /self\.APP_VERSION = '0\.99\.\d+';/.test(ver) && /v: '0\.99\.117'/.test(ver));

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
