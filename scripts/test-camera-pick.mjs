// Geniş açılı arka kamera seçimi (js/sensors/camera.js pickWideDevice)
import { pickWideDevice } from '../js/sensors/camera.js';
let ok = 0, bad = 0;
const t = (n, c) => { if (c) ok++; else { bad++; console.log('BAŞARISIZ:', n); } };
const d = (id, label, kind = 'videoinput') => ({ kind, deviceId: id, label });
const iphone = [d('f', 'Front Camera'), d('b', 'Back Camera'), d('u', 'Back Ultra Wide Camera'), d('t', 'Back Telephoto Camera'), d('m', 'Mikrofon', 'audioinput')];
t('iPhone: ultra geniş seçilir', pickWideDevice(iphone, 'b')?.deviceId === 'u');
t('zaten ultra genişte: null', pickWideDevice(iphone, 'u') === null);
t('telefoto seçilmez', pickWideDevice([d('b', 'Back Camera'), d('t', 'Back Telephoto Camera')], 'b') === null);
t('ön kamera seçilmez', pickWideDevice([d('f', 'Front Ultra Wide Camera'), d('b', 'Back Camera')], 'b') === null);
t('Android 0.5x etiketi', pickWideDevice([d('a', 'camera2 0, facing back'), d('w', 'camera2 2, facing back 0.5x')], 'a')?.deviceId === 'w');
t('etiket yok (izin yok): null', pickWideDevice([d('a', ''), d('b', '')], 'a') === null);
t('tek kamera: null', pickWideDevice([d('a', 'camera2 0, facing back')], 'a') === null);
t('boş/hatalı girdi', pickWideDevice(null, 'x') === null && pickWideDevice([null, {}], 'x') === null);
console.log(`${ok} geçti, ${bad} kaldı`);
process.exit(bad ? 1 : 0);
