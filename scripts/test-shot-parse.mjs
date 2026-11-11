// Ekran görüntüsü okuma: OCR metninden pil/menzil/zaman damgası ayrıştırma + arayüz bağlantıları.
import fs from 'node:fs';
import { parseShot, parseStamp, ageHours, isStale } from '../js/sensors/shotParse.js';

let fail = 0;
const ok = (n, c) => { console.log((c ? 'ok   ' : 'FAIL ') + n); if (!c) fail++; };
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

// Trumore widget'ı (kullanıcının ekran görüntüsü): "%52", "205km", "9 Kasım 2026 16:33"
const widget = 'Togg\nTrumore\n9 Kasım 2026 16:33\nAkT10x\n%52 205km\n';
const w = parseShot(widget);
ok('Widget: pil 52', w.soc === 52);
ok('Widget: menzil 205', w.rangeKm === 205);
ok('Widget: damga 9 Kasım 2026 16:33', w.at?.getFullYear() === 2026 && w.at.getMonth() === 10 && w.at.getDate() === 9 && w.at.getHours() === 16 && w.at.getMinutes() === 33);
ok('Widget: belirsiz değil', w.ambiguous === false);

ok('52% biçimi', parseShot('Battery 52% 205 km').soc === 52);
ok('"% 52" boşluklu', parseShot('% 52').soc === 52);
ok('% yoksa pil yok (durum çubuğu rakamı karışmasın)', parseShot('03:58 46 İstanbul 9°').soc === null);
ok('% yoksa menzil yine okunur', parseShot('205 km').rangeKm === 205);
ok('100 geçerli', parseShot('%100').soc === 100);
ok('101 geçersiz', parseShot('%101').soc === null);
ok('0 geçerli', parseShot('%0').soc === 0);

const multi = parseShot('Diğer %46\nAkT10x %52 205km');
ok('Birden çok %: km ile aynı satırdaki seçilir', multi.soc === 52 && multi.ambiguous === false);
const amb = parseShot('%46\n%52');
ok('Birden çok %, km yok: ilk + belirsiz', amb.soc === 46 && amb.ambiguous === true);
ok('Aynı değer iki kez: belirsiz değil', parseShot('%52\n%52').ambiguous === false);
ok('Menzil aralığı dışı (5 km) yok sayılır', parseShot('%52 5 km').rangeKm === null);

// Zaman damgası
const d = (s) => parseStamp(s);
ok('Ay adı Türkçe harfsiz (Subat)', d('3 Subat 2026 08:05')?.getMonth() === 1);
ok('Ay adı bozuk harfle (Şubat → Subat/Sub)', d('3 Sub 2026 08:05')?.getMonth() === 1);
ok('Ağustos → agu', d('1 Ağustos 2026 10:00')?.getMonth() === 7);
ok('Sayısal 09.11.2026 16:33', d('09.11.2026 16:33')?.getMonth() === 10);
ok('Geçersiz gün (31 Şubat) null', d('31 Şubat 2026 10:00') === null);
ok('Saat 25 geçersiz', d('9 Kasım 2026 25:10') === null);
ok('Damga yok null', d('%52 205km') === null);
ok('Saat ayracı nokta (16.33)', d('9 Kasım 2026 16.33')?.getMinutes() === 33);

// Yaş
const at = new Date(2026, 10, 9, 16, 33);
const now = new Date(2026, 10, 11, 4, 0).getTime();
ok('Yaş ≈ 35.5 saat', Math.abs(ageHours(at, now) - 35.45) < 0.1);
ok('36 saatlik veri eski', isStale(at, now) === true);
ok('10 dk önceki güncel', isStale(new Date(now - 600000), now) === false);
ok('Gelecek damga 0 saat', ageHours(new Date(now + 3600000), now) === 0);
ok('Damga yoksa eski sayılmaz', isStale(null, now) === false && ageHours(null) === null);

// Arayüz bağlantıları
const html = read('index.html');
const sw = read('sw.js');
const app = read('js/app.js');
ok('Rota sayfası pil kartında ek düğme yok (iki denetim kuralı); düğme Pil durumu penceresinde', !/id="btn-soc-shot"/.test(html) && /id="soc-sheet-shot"/.test(html));
ok('index.html: pencere ve dosya seçici', true && /id="shot-dialog"/.test(html) && /id="shot-file"[^>]*accept="image\/\*"/.test(html));
ok('index.html: onay alanları', ['shot-soc', 'shot-apply', 'shot-minus', 'shot-plus', 'shot-extra', 'shot-warn', 'shot-other', 'shot-close', 'shot-x', 'shot-status', 'shot-result'].every((i) => html.includes(`id="${i}"`)));
ok('app.js başlatıyor', /import \{ initShotScan \}/.test(app) && /initShotScan\(\)/.test(app));
ok('Çevrimdışı kabukta yeni dosyalar', ['shotScan.js', 'shotOcr.js', 'shotParse.js'].every((f) => sw.includes(f)));
const ui = read('js/ui/shotScan.js');
ok('Görüntü cihazda okunur (ağ çağrısı yok)', !/fetch\(|XMLHttpRequest|sendBeacon/.test(ui + read('js/sensors/shotOcr.js')));
ok('Elle pil yoluyla uygulanır (setManual + setStartSoc, sim ayrı)', /setManual\(next\)/.test(ui) && /setStartSoc\(next\)/.test(ui) && /patch\('sim', \{ soc: next \}\)/.test(ui));
ok('Eski veri uyarısı ve "Yine de uygula"', /Yine de uygula/.test(ui) && /isStale\(last\.at\)/.test(ui));
ok('Kamera canlı okurken seçici açılmaz', /manualLocked\(\)/.test(ui));

process.exit(fail ? 1 : 0);
