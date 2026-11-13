// v0.99.45: yalnızca boşluktan oluşan TOMTOM_MAP_KEY yapılandırılmamış sayılır (çevrimdışı; ağ yok, gerçek .env okunmaz, yalnızca yer tutucular).
// Geçerli anahtar baytları değiştirilmeden (kırpılmadan) iletilir; sunucu anahtarı TOMTOM_KEY hiçbir çıktıda yer almaz; osm geri düşüşü aynen.
import { createMaps } from '../server/maps.mjs';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.error('BAŞARISIZ:', name); } };
const mk = (env, settings = {}) => createMaps({ data: { users: {}, settings }, save() {} }, env);
const SRV = 'PLACEHOLDER-tt-server';

// ---- Yalnızca boşluk → kullanılamaz, osm ----
for (const ws of [' ', '   ', '\t', '\n', '\r\n', ' \t \n ', ' ', '　 ']) {
  for (const env of [{ TOMTOM_MAP_KEY: ws }, { TOMTOM_KEY: SRV, TOMTOM_MAP_KEY: ws }]) {
    const m = mk(env);
    const tag = JSON.stringify(env.TOMTOM_MAP_KEY) + (env.TOMTOM_KEY ? '+srv' : '');
    ok('boşluk anahtar → available.tomtom false ' + tag, m.available().tomtom === false);
    ok('boşluk anahtar → varsayılan osm ' + tag, m.getDefault() === 'osm');
    ok('boşluk anahtar → Premium TomTom seçimi osm ' + tag, JSON.stringify(m.config({ mapProvider: 'tomtom' }, true)) === '{"provider":"osm"}');
    ok('boşluk anahtar → effective osm ' + tag, m.effective({ mapProvider: 'tomtom' }, true) === 'osm');
    let t1 = false; try { m.setUser({}, 'tomtom'); } catch { t1 = true; }
    ok('boşluk anahtar → kullanıcı TomTom seçemez ' + tag, t1);
    let t2 = false; try { m.setDefault('tomtom'); } catch { t2 = true; }
    ok('boşluk anahtar → yönetici varsayılanı TomTom yapamaz ' + tag, t2);
    // Yönetici önceden tomtom seçmişse bile Premium osm'ye düşer
    const m2 = mk(env, { mapDefault: 'tomtom' });
    ok('boşluk anahtar + mapDefault=tomtom → Premium osm ' + tag, JSON.stringify(m2.config({}, true)) === '{"provider":"osm"}');
    const all = JSON.stringify([m.available(), m.getDefault(), m.config({ mapProvider: 'tomtom' }, true), m2.config({}, true)]);
    ok('boşluk anahtar → sunucu anahtarı hiçbir çıktıda yok ' + tag, !all.includes(SRV));
  }
}

// ---- Geçerli anahtar → baytlar aynen ----
for (const key of ['PLACEHOLDER-tt-map', ' PLACEHOLDER-tt-map-padded ', 'PH\tinner']) {
  const m = mk({ TOMTOM_KEY: SRV, TOMTOM_MAP_KEY: key });
  const tag = JSON.stringify(key);
  ok('geçerli anahtar → available.tomtom true ' + tag, m.available().tomtom === true);
  ok('geçerli anahtar → varsayılan tomtom ' + tag, m.getDefault() === 'tomtom');
  const cfg = m.config({ mapProvider: 'tomtom' }, true);
  ok('geçerli anahtar → config anahtarı bayt bayt aynı ' + tag, cfg.provider === 'tomtom' && cfg.key === key);
  ok('geçerli anahtar → sunucu anahtarı config içinde yok ' + tag, !JSON.stringify(cfg).includes(SRV));
  ok('geçerli anahtar → Premium olmayan osm ' + tag, JSON.stringify(m.config({ mapProvider: 'tomtom' }, false)) === '{"provider":"osm"}');
  let threw = false; try { m.setUser({}, 'tomtom'); } catch { threw = true; }
  ok('geçerli anahtar → kullanıcı TomTom seçebilir ' + tag, !threw);
}

// ---- Diğer sağlayıcılar etkilenmedi ----
{
  const m = mk({ TOMTOM_MAP_KEY: '  ', MAPBOX_MAP_TOKEN: 'pk.PLACEHOLDER', GOOGLE_MAPS_BROWSER_KEY: 'PLACEHOLDER-g' });
  ok('mapbox/google aynen kullanılabilir', JSON.stringify(m.available()) === '{"mapbox":true,"google":true,"tomtom":false}');
}

console.log(`map-key-whitespace: ${pass} geçti, ${fail} başarısız`);
if (fail) process.exit(1);
