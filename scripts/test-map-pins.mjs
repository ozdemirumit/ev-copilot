// Harita iğneleri: araç konumuyla aynı yerdeki "Konumum" başlangıç iğnesi çizilmez (araç işareti zaten orada).
// Araç konumu bilinmiyorsa, başka bir başlangıç seçilmişse ya da varış/ara durak iğnelerinde iğne korunur.
import { pointPinShown } from '../js/ui/mapView.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const me = { lat: 39.9, lon: 32.8 };

ok(pointPinShown('start', { lat: 39.9, lon: 32.8, label: 'Konumum', auto: true }, me) === false, 'otomatik Konumum başlangıcı gizli');
ok(pointPinShown('start', { lat: 39.9, lon: 32.8, label: 'Konumum' }, me) === false, 'yeniden rota/Konumum başlangıcı gizli');
ok(pointPinShown('start', { lat: 39.95, lon: 32.8, label: 'Konumum' }, me) === false, 'araç Konumum başlangıcından uzaklaşsa da gizli (aktif rota çizgisi korunur)');
ok(pointPinShown('start', { lat: 39.9, lon: 32.8, label: 'Konumum', auto: true }, null) === true, 'araç konumu bilinmiyorsa iğne kalır');
ok(pointPinShown('start', { lat: 39.9, lon: 32.8, label: 'Konumum' }, { lat: null, lon: null }) === true, 'araç konumu null ise iğne kalır');
ok(pointPinShown('start', { lat: 41.0, lon: 29.0, label: 'Kadıköy' }, me) === true, 'kullanıcının seçtiği başlangıç iğnesi kalır');
ok(pointPinShown('start', { lat: 39.9, lon: 32.8 }, me) === true, 'etiketsiz haritadan seçilen başlangıç kalır');
ok(pointPinShown('end', { lat: 39.9, lon: 32.8, label: 'Konumum' }, me) === true, 'varış iğnesi her zaman kalır');
ok(pointPinShown('via', { lat: 40, lon: 33, label: 'Ara' }, me) === true, 'ara durak iğnesi kalır');
ok(pointPinShown('start', null, me) === false, 'nokta yoksa iğne yok');

console.log(`test-map-pins: ${pass} geçti, ${fail} başarısız`);
if (fail) process.exit(1);
