// Çevrimdışı yapılandırma hazırlığı (yalnızca test; ağ yok, gerçek .env okunmaz, gerçek anahtar yok — yalnızca yer tutucular).
// test-secret-hardening.mjs'yi tamamlar; orada olmayanlar:
//  1) .env'deki BOŞ satır (TOMTOM_MAP_KEY=) → TomTom haritası kapalı, osm; boş TOMTOM_MAP_KEY + dolu TOMTOM_KEY de osm.
//  2) Tüm anahtarlar doluyken tam matris: her tarayıcı anahtarı YALNIZCA kendi sağlayıcısının config'inde, yalnızca Premium'da;
//     sunucu içi anahtarlar (TOMTOM_KEY, HERE_API_KEY, MAPBOX_TOKEN, ...) hiçbir config/available/getDefault çıktısında yok.
//  3) Tarayıcıya paketlenen dosyalar (index.html, offline.html, sw.js, js/) sunucu .env adlarına hiç başvurmaz.
//  4) Sağlayıcı politika atıfları ve lisans durumları birebir aynı (anlık görüntü); maps.mjs PROVIDERS aynı.
//  5) server/.env.example: gizli değişkenlerin hiçbirinde değer yok; operatör kurulum listesi mevcut.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createMaps, PROVIDERS } from '../server/maps.mjs';
import { SECRET_ENV_NAMES, SECRET_LIST_ENV_NAMES } from '../server/scrub.mjs';
import { listProviders, getProvider } from '../server/providerPolicy.mjs';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.error('BAŞARISIZ:', name); } };
const mk = (env, settings = {}) => createMaps({ data: { users: {}, settings }, save() {} }, env);
const root = new URL('../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf8');

// ---- 1) Boş TOMTOM_MAP_KEY satırı ----
{
  const SRV = 'PLACEHOLDER-tt-server';
  for (const env of [{ TOMTOM_MAP_KEY: '' }, { TOMTOM_KEY: SRV, TOMTOM_MAP_KEY: '' }, { TOMTOM_KEY: SRV, TOMTOM_MAP_KEY: undefined }]) {
    const m = mk(env);
    const tag = JSON.stringify(Object.keys(env));
    ok('boş TOMTOM_MAP_KEY → tomtom kullanılamaz ' + tag, m.available().tomtom === false && m.getDefault() === 'osm');
    ok('boş TOMTOM_MAP_KEY → Premium TomTom seçimi osm ' + tag, JSON.stringify(m.config({ mapProvider: 'tomtom' }, true)) === '{"provider":"osm"}');
    let threw = false; try { m.setUser({}, 'tomtom'); } catch { threw = true; }
    ok('boş TOMTOM_MAP_KEY → kullanıcı TomTom seçemez ' + tag, threw);
  }
}

// ---- 2) Tüm anahtarlar dolu: tam sızıntı matrisi ----
{
  const ENV = Object.fromEntries(SECRET_ENV_NAMES.map((n) => [n, `PH-${n}-placeholder`]));
  ENV.MAPBOX_MAP_TOKEN = 'pk.PH-MAPBOX_MAP_TOKEN-placeholder';
  ENV.ACCESS_CODES = 'PH-code-one-placeholder-aaaa,PH-code-two-placeholder-bbbb';
  ENV.GOOGLE_MAP_ID = 'PH-map-id';
  // Tarayıcı anahtarı → yalnızca bu sağlayıcının config'inde görünebilir
  const BROWSER = { MAPBOX_MAP_TOKEN: 'mapbox', GOOGLE_MAPS_BROWSER_KEY: 'google', TOMTOM_MAP_KEY: 'tomtom' };
  const serverOnly = [...SECRET_ENV_NAMES.filter((n) => !(n in BROWSER)), ...SECRET_LIST_ENV_NAMES];
  ok('sunucu içi adlar listesi TOMTOM_KEY ve HERE_API_KEY içerir', serverOnly.includes('TOMTOM_KEY') && serverOnly.includes('HERE_API_KEY'));
  const serverVals = [...serverOnly.flatMap((n) => String(ENV[n]).split(','))];
  for (const mapDefault of [undefined, ...PROVIDERS]) {
    const m = mk(ENV, mapDefault ? { mapDefault } : {});
    const meta = JSON.stringify({ a: m.available(), d: m.getDefault() });
    ok(`available/getDefault anahtar içermez (mapDefault=${mapDefault})`, !Object.values(ENV).some((v) => meta.includes(v)));
    for (const premium of [true, false]) for (const sel of [null, undefined, ...PROVIDERS, 'here', 'bogus']) {
      const u = sel === undefined ? null : sel === null ? {} : { mapProvider: sel };
      const cfg = m.config(u, premium), s = JSON.stringify(cfg);
      const tag = `(premium=${premium}, sel=${sel}, def=${mapDefault})`;
      ok('sunucu içi anahtar yok ' + tag, serverVals.every((v) => !s.includes(v)));
      for (const [name, prov] of Object.entries(BROWSER)) {
        if (s.includes(ENV[name])) ok(`${name} yalnızca ${prov} config'inde ve Premium'da ${tag}`, cfg.provider === prov && premium);
      }
      if (!premium) ok('Free → yalnızca {provider:osm} ' + tag, s === '{"provider":"osm"}');
    }
  }
  // Varsayılan davranış değişmedi: TOMTOM_MAP_KEY varken yönetici seçmediyse Premium varsayılanı TomTom, anahtar = TOMTOM_MAP_KEY
  const m = mk(ENV);
  ok('TOMTOM_MAP_KEY varken varsayılan tomtom', m.getDefault() === 'tomtom');
  ok('varsayılan TomTom config yalnızca harita anahtarını taşır', JSON.stringify(m.config({}, true)) === JSON.stringify({ provider: 'tomtom', key: ENV.TOMTOM_MAP_KEY }));
  ok('yönetici varsayılanı (osm) korunur', JSON.stringify(mk(ENV, { mapDefault: 'osm' }).config({}, true)) === '{"provider":"osm"}');
}

// ---- 3) Tarayıcıya giden dosyalar sunucu .env adlarına başvurmaz ----
{
  const files = ['index.html', 'offline.html', 'sw.js'];
  const walk = (rel) => { for (const n of readdirSync(new URL(rel, root))) { const p = rel + n; if (statSync(new URL(p, root)).isDirectory()) walk(p + '/'); else if (/\.(m?js|html)$/.test(n)) files.push(p); } };
  walk('js/');
  const names = [...SECRET_ENV_NAMES, ...SECRET_LIST_ENV_NAMES];
  const hits = files.filter((f) => { const t = read(f); return names.some((n) => new RegExp(`\\b${n}\\b`).test(t)); });
  ok(`istemci dosyaları (${files.length}) .env gizli adlarına başvurmaz` + (hits.length ? ': ' + hits.join(', ') : ''), files.length > 5 && hits.length === 0);
}

// ---- 4) Politika/atıf anlık görüntüsü ----
{
  const snap = JSON.stringify(listProviders().map((p) => [p.id, p.tier, p.licenseStatus, p.attribution.text, p.attribution.required, p.enabledByDefault]));
  ok('politika atıf/lisans/etkinlik anlık görüntüsü aynı', snap === JSON.stringify([
    ['osm', 'free', 'approved', '© OpenStreetMap contributors', true, { map: true, route: true, data: true }],
    ['tomtom', 'premium', 'unverified', '© TomTom', true, { map: true, route: true, data: true }],
    ['here', 'premium', 'unverified', '© HERE', true, { map: false, route: false, data: false }],
  ]));
  ok('HERE ve TomTom lisansı onaylanmış sayılmaz', getProvider('here').licenseStatus === 'unverified' && getProvider('tomtom').licenseStatus === 'unverified');
  ok('maps.mjs PROVIDERS aynı', JSON.stringify(PROVIDERS) === '["osm","mapbox","google","tomtom"]');
}

// ---- 5) .env.example: değer yok + operatör kurulum listesi ----
{
  const ex = read('server/.env.example');
  const lines = ex.split(/\r?\n/);
  for (const n of [...SECRET_ENV_NAMES, ...SECRET_LIST_ENV_NAMES]) {
    const set = lines.filter((l) => new RegExp(`^\\s*#?\\s*${n}=`).test(l));
    ok(`.env.example ${n}: değer yok`, set.every((l) => new RegExp(`^\\s*#?\\s*${n}=\\s*(#.*)?$`).test(l)));
  }
  ok('.env.example TOMTOM_KEY ve HERE_API_KEY satırları var', lines.some((l) => /^TOMTOM_KEY=/.test(l)) && lines.some((l) => /^HERE_API_KEY=/.test(l)));
  const cl = ex.slice(ex.indexOf('KURULUM LİSTESİ'));
  ok('.env.example operatör kurulum listesi var', ex.includes('KURULUM LİSTESİ'));
  ok('kurulum listesi: TOMTOM_MAP_KEY Allowed Origins ile kısıtlı', /TOMTOM_MAP_KEY[^\n]*\n?[^\n]*Allowed Origins/.test(cl));
  ok('kurulum listesi: TOMTOM_KEY ayrı sunucu anahtarı', /TOMTOM_KEY[^\n]*sunucu/.test(cl));
  ok('kurulum listesi: HERE_API_KEY yalnızca sunucu', /HERE_API_KEY[^\n]*yalnızca sunucu/.test(cl));
  ok('kurulum listesi: lisans onayı bekliyor', /lisans[^\n]*(bekliyor|doğrulanmadı)/i.test(cl));
}

console.log(`test-config-readiness: ${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
