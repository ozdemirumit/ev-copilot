// Navigasyon durunca harita konuma dönüşü (RM-12, v0.99.65): güvenilir konum varsa normal sürüş zoom'uyla (zoomForSpeed) ortalar;
// konum yok/güvenilmez ise harita olduğu yerde kalır; kullanıcı haritayı elle geziyorsa yeniden ortalamaz.
// Kullanım: node scripts/test-nav-stop-recenter.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopRecenter, zoomForSpeed, STOP_FIX_ACC_M } from '../js/nav/freeDrive.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name); };

const live = { source: 'live', gps: 'ok', lat: 41.01, lon: 28.97, acc: 12, speed: 0, panned: false };

// --- Güvenilir konum: ortala + normal sürüş zoom'u ---
{
  const r = stopRecenter(live);
  ok('canlı GPS (ok, 12 m): konuma ortalar', r && r.lat === 41.01 && r.lon === 28.97);
  ok('duran araç: zoom 17 (zoomForSpeed(0))', r?.zoom === 17 && r.zoom === zoomForSpeed(0));
  ok('60 km/s: zoom 16', stopRecenter({ ...live, speed: 60 })?.zoom === 16);
  ok('110 km/s: zoom 15', stopRecenter({ ...live, speed: 110 })?.zoom === 15);
  ok('hız bilinmiyor (null): zoom 17', stopRecenter({ ...live, speed: null })?.zoom === 17);
  ok('doğruluk bilinmiyor (acc null): yine ortalar', !!stopRecenter({ ...live, acc: null }));
  ok(`doğruluk tam eşikte (${STOP_FIX_ACC_M} m): ortalar`, !!stopRecenter({ ...live, acc: STOP_FIX_ACC_M }));
  ok('Test Modu (sim) konumu: ortalar', !!stopRecenter({ source: 'sim', gps: 'off', lat: 40, lon: 29, speed: 50, panned: false }));
}
// --- GPS yok / güvenilmez: güvenli geri dönüş (harita yerinde kalır) ---
{
  ok('konum yok (lat null): ortalamaz', stopRecenter({ ...live, lat: null, lon: null }) === null);
  ok('GPS kapalı (off, eski konum duruyor): ortalamaz', stopRecenter({ ...live, gps: 'off' }) === null);
  ok('GPS hata: ortalamaz', stopRecenter({ ...live, gps: 'error' }) === null);
  ok('GPS aranıyor: ortalamaz', stopRecenter({ ...live, gps: 'searching' }) === null);
  ok(`kaba konum (acc ${STOP_FIX_ACC_M + 1} m): ortalamaz`, stopRecenter({ ...live, acc: STOP_FIX_ACC_M + 1 }) === null);
  ok('NaN koordinat: ortalamaz', stopRecenter({ ...live, lat: NaN }) === null);
  ok('girdi yok: ortalamaz, hata atmaz', stopRecenter() === null);
}
// --- Elle gezinme: gereksiz yeniden ortalama yok ---
{
  ok('kullanıcı haritayı kaydırmış: ortalamaz', stopRecenter({ ...live, panned: true }) === null);
  ok('Test Modu + kaydırılmış: ortalamaz', stopRecenter({ source: 'sim', lat: 40, lon: 29, panned: true }) === null);
}
// --- Bağlantı (kaynak denetimi): endNav kaydırmayı navView(false) sıfırlamadan önce okur, kararı stopRecenter verir ---
{
  const src = read('js/nav/navigator.js');
  const body = src.slice(src.indexOf('function endNav'), src.indexOf('export function stopNav'));
  const iDrag = body.indexOf('mapApi.dragged?.()');
  const iView = body.indexOf('mapApi.navView(false)');
  ok('endNav mapApi.dragged?.() okur (harita yüklenmeden de güvenli)', iDrag > 0);
  ok('dragged() navView(false)\'dan önce (navPan sıfırlanmadan)', iDrag > 0 && iView > 0 && iDrag < iView);
  ok('endNav stopRecenter kullanır', /stopRecenter\(/.test(body));
  ok('endNav sabit zoom 17 ile koşulsuz follow etmez', !/follow\(e\.lat, e\.lon, 17, true/.test(body));
  ok('stopNav endNav çağırır', /export function stopNav\(\)\s*\{\s*endNav\(\)/.test(src));
  const mv = read('js/ui/mapView.js');
  ok('navView(false) navPan sıfırlar (karar öncesi okunmalı)', /if \(!on\) navPan = false/.test(mv));
}
console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
