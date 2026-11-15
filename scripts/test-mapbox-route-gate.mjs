// BL-P3-01 TANI SÖZLEŞMESİ (salt okunur): node scripts/test-mapbox-route-gate.mjs
// Sunucu Mapbox vekili (server/proxy.mjs mapbox()) bugün hangi kapılardan geçiyor, hangilerinden geçmiyor — deterministik, çevrimdışı.
// Hiçbir davranışı DEĞİŞTİRMEZ, server/proxy.mjs içe AKTARILMAZ (sunucu başlatır), ağa çıkmaz (fetch engellenir), anahtar kullanmaz.
// Yöntem: kaynak metin statik denetimi + MB_PATHS izin listesinin kaynaktan çıkarılıp sahte yollarla sınanması.
//
// KNOWN-GAP satırları bugünkü (istenmeyen olabilecek) davranışı sabitler: boşluk varsa test GEÇER; boşluk kendiliğinden kapanırsa
// "GAP CLOSED" ile BAŞARISIZ olur. BL-P3-01'i düzelten görev ilgili knownGap(...) satırını ok(...) kabul denetimine çevirmelidir;
// satır silinmez/gevşetilmez. Free'nin Mapbox rotası alıp almayacağı kullanıcı/ürün kararıdır (maliyet; "Free = açık kaynak"), bu test karar vermez.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0, gaps = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); } };
const knownGap = (id, name, present) => {
  if (present) { pass++; gaps++; console.log(`ok  KNOWN-GAP ${id}: ${name}`); } else { fail++; console.log(`FAIL GAP CLOSED ${id}: ${name} — knownGap satırını kabul denetimine (ok) çevirin`); }
};

let fetchCalls = 0;
globalThis.fetch = () => { fetchCalls++; throw new Error('ağ yasak'); };

const src = (rel) => readFileSync(fileURLToPath(new URL('../' + rel, import.meta.url)), 'utf8');
/** `function name(` ile başlayan gövdeyi bir sonraki üst düzey tanıma kadar döndürür; yoksa ''. (test-provider-policy-compat ile aynı yöntem) */
function fnBody(text, name) {
  const i = text.indexOf(`function ${name}(`);
  if (i < 0) return '';
  const rest = text.slice(i + 1);
  const j = rest.search(/\n(?:async )?function |\nexport |\nconst [A-Za-z_]+ = /);
  return j < 0 ? rest : rest.slice(0, j);
}

const PROXY = src('server/proxy.mjs');
const mb = fnBody(PROXY, 'mapbox');
const tt = fnBody(PROXY, 'tomtomRouteRoute');
const gs = fnBody(PROXY, 'googleStationsRoute');
const dispatch = PROXY.split('\n').find((l) => l.includes("p.startsWith('/mapbox/')")) || '';

// ---- 0) Bulunabilirlik (kaynak yeniden düzenlenirse tanı sessizce boşa düşmesin) ----
ok('mapbox() gövdesi bulundu', mb.length > 200 && /async function mapbox\(req, res, url, id\)/.test(PROXY));
ok('dağıtıcı /mapbox/ satırı bulundu', /return await mapbox\(req, res, url, id\)/.test(dispatch), dispatch.trim());
ok('karşılaştırma gövdeleri bulundu (tomtomRouteRoute, googleStationsRoute)', tt.length > 0 && gs.length > 0);

// ---- 1) Bugün VAR olan korumalar (değişirse tanı güncellenmeli) ----
ok('anahtar yoksa 501', /if \(!MAPBOX\) return json\(res, 501/.test(mb));
ok('yalnızca GET ve izin listesindeki yollar (404)', /if \(!rule \|\| req\.method !== 'GET'\) return json\(res, 404/.test(mb));
ok('istemcinin access_token parametresi silinir (sunucu anahtarı ekler)', /q\.delete\('access_token'\)/.test(mb) && /real\.set\('access_token', MAPBOX\)/.test(mb));
ok('günlük kullanıcı hakkı: overQuota(id, \'mapbox\') → 429', /if \(overQuota\(id, 'mapbox'\)\) return json\(res, 429/.test(mb));
ok('DAILY.mapbox varsayılanı 400 (MAPBOX_DAILY_PER_USER)', /mapbox: Number\(env\.MAPBOX_DAILY_PER_USER \|\| 400\)/.test(PROXY));
ok('her üst sunucu isteği maliyete yazılır (mapbox / mapbox_search)', /costs\.add\(id, isSearch \? 'mapbox_search' : 'mapbox'\)/.test(mb));
ok('dağıtıcıdan önce kimlik zorunlu (giriş yoksa 401)', PROXY.indexOf("json(res, 401, { error: 'giriş gerekli' })") > 0 && PROXY.indexOf("json(res, 401, { error: 'giriş gerekli' })") < PROXY.indexOf(dispatch));

// ---- 2) MB_PATHS izin listesi: kaynaktan çıkarılıp sahte yollarla sınanır (ağ yok) ----
const m = PROXY.match(/const MB_PATHS = (\[[\s\S]*?\n\]);/);
ok('MB_PATHS dizisi kaynakta bulundu', !!m);
const MB_PATHS = m ? new Function(`return ${m[1].replace(/\/\/[^\n]*/g, '')};`)() : [];
const ruleOf = (p) => MB_PATHS.find(([re]) => re.test(p));
const DIR = '/directions/v5/mapbox/driving-traffic/29.01,41.02;29.10,41.11';
ok('izin listesinde 3 kural', MB_PATHS.length === 3, String(MB_PATHS.length));
ok('trafikli rota (driving-traffic) izinli, önbellek 0', ruleOf(DIR)?.[1] === 0);
ok('trafiksiz rota (driving) izinli, önbellek 0', ruleOf('/directions/v5/mapbox/driving/29.01,41.02;29.10,41.11')?.[1] === 0);
ok('walking/cycling rotası izinli değil', !ruleOf('/directions/v5/mapbox/walking/29.01,41.02;29.10,41.11') && !ruleOf('/directions/v5/mapbox/cycling/29.01,41.02;29.10,41.11'));
ok('geocoding / tiles / matrix izinli değil', !ruleOf('/geocoding/v5/mapbox.places/x.json') && !ruleOf('/styles/v1/mapbox/streets-v12') && !ruleOf('/directions-matrix/v1/mapbox/driving/1,2;3,4'));
ok('koordinat dışı karakterli rota yolu izinli değil', !ruleOf('/directions/v5/mapbox/driving/29.01,41.02;29.10,41.11.json') && !ruleOf('/directions/v5/mapbox/driving/abc'));
ok('kategori araması 1 sa, kategori listesi 24 sa önbellek', ruleOf('/search/searchbox/v1/category/ev_charging_station')?.[1] === 3600e3 && ruleOf('/search/searchbox/v1/list/category')?.[1] === 24 * 3600e3);

// ---- 3) BL-P3-01 bilinen boşluklar (bugünkü davranış; düzeltme ayrı görev + kullanıcı kararı) ----
knownGap('M1', 'mapbox() Premium kapısı yok (premiumOk/isPremium çağrılmıyor) → Free hesap trafikli Mapbox rotası alabilir', !/premiumOk\(|isPremium\(/.test(mb));
knownGap('M1b', "dağıtıcı /mapbox/ satırında da Premium kapısı yok", !/premiumOk\(|isPremium\(/.test(dispatch));
knownGap('M2', 'aylık MB_CAP (402) yalnızca aramaya uygulanır; rota istekleri aylık sınırsız (yalnız günlük kullanıcı hakkı)', /if \(isSearch && mbUsage\(\)\.n >= MB_CAP\)/.test(mb) && !/!isSearch[^\n]*MB_CAP/.test(mb));
knownGap('M2b', 'aylık sayaç (mbUsage().n++) yalnızca aramada artar; rota sayılmaz', /if \(isSearch\) \{ mbUsage\(\)\.n\+\+/.test(mb) && (mb.match(/mbUsage\(\)\.n\+\+/g) || []).length === 1);
// Karşılaştırma: aynı dosyadaki diğer ücretli rota/veri yolları Premium kapılı (tutarsızlığın kanıtı; bunlar değişirse tanı güncellenmeli).
ok('karşılaştırma: tomtomRouteRoute premiumOk(id) ile kapılı', /premiumOk\(id\)/.test(tt));
ok('karşılaştırma: googleStationsRoute premiumOk(id) ile kapılı', /premiumOk\(id\)/.test(gs));
ok('premiumOk tanımı: hesapsız eski erişim kodu Premium, hesaplı kullanıcı isPremium', /const premiumOk = \(id\) => id\.kind !== 'user' \|\| accounts\.isPremium\(id\.user\);/.test(PROXY));

ok('ağ çağrısı yapılmadı', fetchCalls === 0, String(fetchCalls));

console.log(`\nözet: bilinen boşluk ${gaps} (BL-P3-01, açık)`);
console.log(`${pass} geçti, ${fail} kaldı`);
if (fail) process.exit(1);
