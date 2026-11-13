// v0.99.44 güvenlik sertleştirmesi (çevrimdışı, ağ yok, gerçek anahtar yok — yalnızca yer tutucular):
//  1) Sunucu anahtarı TOMTOM_KEY hiçbir harita yapılandırmasında tarayıcıya gitmez; TOMTOM_MAP_KEY yoksa TomTom → osm.
//  2) Diğer sağlayıcıların davranışı değişmedi.
//  3) Günlük temizleyicisi (server/scrub.mjs) tüm gizli .env adlarını maskeler.
import { readFileSync } from 'node:fs';
import { createMaps, PROVIDERS } from '../server/maps.mjs';
import { makeScrub, secretValues, SECRET_ENV_NAMES } from '../server/scrub.mjs';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.error('BAŞARISIZ:', name); } };
const mk = (env, settings = {}) => createMaps({ data: { users: {}, settings }, save() {} }, env);

// ---- 1) TomTom sunucu anahtarı tarayıcıya gitmez ----
const SRV = 'PLACEHOLDER-server-tomtom-key-not-real';
const MAP = 'PLACEHOLDER-map-tomtom-key-not-real';
{
  const m = mk({ TOMTOM_KEY: SRV });
  const all = [];
  for (const premium of [true, false]) for (const p of [undefined, null, ...PROVIDERS, 'here', 'bogus']) all.push(JSON.stringify(m.config(p === undefined ? null : { mapProvider: p }, premium)));
  ok('yalnızca TOMTOM_KEY: hiçbir config sunucu anahtarını içermez', all.every((s) => !s.includes(SRV)));
  ok('yalnızca TOMTOM_KEY: Premium TomTom seçimi osm’ye düşer', JSON.stringify(m.config({ mapProvider: 'tomtom' }, true)) === '{"provider":"osm"}');
  ok('yalnızca TOMTOM_KEY: varsayılan osm, tomtom haritası kullanılamaz', m.getDefault() === 'osm' && m.available().tomtom === false);
  ok('yalnızca TOMTOM_KEY: available/getDefault çıktısında anahtar yok', !JSON.stringify({ a: m.available(), d: m.getDefault() }).includes(SRV));
  let threw = false; try { m.setDefault('tomtom'); } catch { threw = true; }
  ok('yalnızca TOMTOM_KEY: yönetici TomTom haritasını varsayılan yapamaz', threw);
  // Yönetici önceden tomtom seçmişse (db.json) bile anahtar sızmaz
  const m2 = mk({ TOMTOM_KEY: SRV }, { mapDefault: 'tomtom' });
  ok('kayıtlı mapDefault=tomtom + yalnızca TOMTOM_KEY → osm, anahtar yok', JSON.stringify(m2.config({}, true)) === '{"provider":"osm"}');
}
{
  const m = mk({ TOMTOM_KEY: SRV, TOMTOM_MAP_KEY: MAP });
  const cfg = JSON.stringify(m.config({ mapProvider: 'tomtom' }, true));
  ok('TOMTOM_MAP_KEY varsa TomTom haritası onunla çalışır', cfg === JSON.stringify({ provider: 'tomtom', key: MAP }));
  ok('TOMTOM_MAP_KEY varken de sunucu anahtarı gitmez', !cfg.includes(SRV));
  ok('Free kullanıcıya harita anahtarı gitmez', JSON.stringify(m.config({ mapProvider: 'tomtom' }, false)) === '{"provider":"osm"}');
}
// Kaynak sözleşmesi: maps.mjs TOMTOM_KEY'e hiç dokunmaz (yorum satırları hariç)
{
  const code = readFileSync(new URL('../server/maps.mjs', import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/\/\/.*$/gm, '');
  ok('maps.mjs kodu env.TOMTOM_KEY okumaz', !/env\.TOMTOM_KEY\b/.test(code));
}

// ---- 2) Diğer sağlayıcılar değişmedi ----
{
  const E = { MAPBOX_MAP_TOKEN: 'pk.PLACEHOLDER', GOOGLE_MAPS_BROWSER_KEY: 'PLACEHOLDER-g', GOOGLE_MAP_ID: 'mid', TOMTOM_KEY: SRV };
  const m = mk(E);
  ok('mapbox aynen', JSON.stringify(m.config({ mapProvider: 'mapbox' }, true)) === '{"provider":"mapbox","token":"pk.PLACEHOLDER"}');
  ok('google aynen', JSON.stringify(m.config({ mapProvider: 'google' }, true)) === '{"provider":"google","key":"PLACEHOLDER-g","mapId":"mid"}');
  ok('mapbox sk. gizli belirteci hâlâ reddedilir', mk({ MAPBOX_MAP_TOKEN: 'sk.PLACEHOLDER' }).available().mapbox === false);
  ok('osm aynen', JSON.stringify(m.config({ mapProvider: 'osm' }, true)) === '{"provider":"osm"}');
}

// ---- 3) Günlük temizleyicisi ----
{
  const names = ['GOOGLE_CLIENT_SECRET', 'SMTP_PASS', 'ACCESS_CODES', 'HERE_ACCESS_KEY_ID', 'HERE_ACCESS_KEY_SECRET', 'TOMTOM_KEY', 'TOMTOM_MAP_KEY', 'MAPBOX_TOKEN', 'MAPBOX_MAP_TOKEN',
    'OCM_KEY', 'GOOGLE_PLACES_KEY', 'GOOGLE_MAPS_BROWSER_KEY', 'HERE_API_KEY', 'VERIAPI_KEY', 'ADMIN_TOTP_SECRET'];
  const env = Object.fromEntries(names.map((n) => [n, `PH_${n}_placeholder`]));
  env.ACCESS_CODES = 'PH_code_one_placeholder_aaaa, PH_code_two_placeholder_bbbb';
  const scrub = makeScrub(env);
  const placeholders = [...names.filter((n) => n !== 'ACCESS_CODES').map((n) => env[n]), 'PH_code_one_placeholder_aaaa', 'PH_code_two_placeholder_bbbb'];
  const text = 'hata: ' + placeholders.map((v, i) => `k${i}=${v}`).join('&');
  const out = scrub(text);
  for (const v of placeholders) ok('scrub maskeler: ' + v.replace(/^PH_|_placeholder.*$/g, ''), !out.includes(v));
  ok('scrub maske işareti koyar', (out.match(/\*\*\*/g) || []).length === placeholders.length);
  ok('scrub gizli olmayan metni korur', scrub('rota 41.0,29.0 tamam') === 'rota 41.0,29.0 tamam');
  ok('scrub boş env’de metni değiştirmez', makeScrub({})('abc ***') === 'abc ***');
  ok('scrub boş değerleri yok sayar', secretValues({ SMTP_PASS: '', ACCESS_CODES: ' , ' }).length === 0);
  ok('scrub: içeren uzun değer önce maskelenir', makeScrub({ TOMTOM_KEY: 'PHabc', TOMTOM_MAP_KEY: 'PHabcdef' })('x PHabcdef y') === 'x *** y');
  ok('scrub string olmayan girdide çökmez', makeScrub(env)(new Error('e ' + env.SMTP_PASS)) === 'Error: e ***');
  for (const n of ['GOOGLE_CLIENT_SECRET', 'SMTP_PASS', 'HERE_ACCESS_KEY_ID', 'HERE_ACCESS_KEY_SECRET', 'VERIAPI_KEY', 'ADMIN_TOTP_SECRET']) ok('SECRET_ENV_NAMES içerir: ' + n, SECRET_ENV_NAMES.includes(n));
  const proxy = readFileSync(new URL('../server/proxy.mjs', import.meta.url), 'utf8');
  ok('proxy.mjs tek scrub kaynağını kullanır', /import \{ makeScrub \} from '\.\/scrub\.mjs'/.test(proxy) && /const scrub = makeScrub\(env\)/.test(proxy));
}

// ---- 4) .gitignore ve .env.example ----
{
  const gi = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8').split(/\r?\n/);
  ok('.gitignore: .claude-flow/ ve .swarm/', gi.includes('.claude-flow/') && gi.includes('.swarm/'));
  const ex = readFileSync(new URL('../server/.env.example', import.meta.url), 'utf8');
  ok('.env.example: TOMTOM_KEY yerine kullanılmaz notu', /TOMTOM_KEY yerine kullanılmaz/.test(ex) && !/yoksa TOMTOM_KEY kullanılır/.test(ex));
}

console.log(`test-secret-hardening: ${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
