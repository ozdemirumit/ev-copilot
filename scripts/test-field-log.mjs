// Saha testi raporu (js/diag/fieldLog.js + js/ui/fieldTest.js) testleri (bağımsız, düz node): node scripts/test-field-log.mjs
// Kurallar: yalnızca SAYILAR toplanır (konum, adres, konuşma metni, ham OCR değeri tutulmaz); rapor kullanıcının kendi cihazında üretilir
// (ağa gönderilmez); kayıt kapalıyken hiçbir şey toplanmaz; saklanan özet küçük ve sınırlı kalır.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}`); } }
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(ROOT + f, 'utf8');

const F = await import('../js/diag/fieldLog.js');
const T0 = 1_000_000;
const ocrS = (o = {}) => ({ readCount: 0, readAt: 0, rejected: null, status: 'idle', ...o });

// ---- A) kayıt kapalıyken hiçbir şey toplanmaz ----
{
  const log = F.createFieldLog();
  log.ocr(ocrS({ readCount: 5, readAt: 5 }), T0); log.gps('ok', T0); log.spoken('road:x', T0); log.error('x', T0); log.nav(true, T0);
  const s = log.snapshot(T0 + 1000);
  ok('A kapalıyken sayaçlar sıfır', !log.active() && s.ocr.reads === 0 && s.spoken.total === 0 && s.errors.total === 0 && s.nav.sessions === 0 && s.gps.transitions === 0);
}

// ---- B) OCR toplama ----
{
  const log = F.createFieldLog(); log.start(T0);
  log.ocr(ocrS({ readCount: 10, readAt: 100, status: 'ok' }), T0); // taban: sayılmaz
  log.ocr(ocrS({ readCount: 11, readAt: 200, status: 'ok' }), T0 + 10_000);
  log.ocr(ocrS({ readCount: 12, readAt: 200, status: 'rejected', rejected: { at: 300, reason: 'range', value: 77 } }), T0 + 20_000);
  log.ocr(ocrS({ readCount: 13, readAt: 200, status: 'rejected', rejected: { at: 301, reason: 'range', value: 78 } }), T0 + 30_000);
  log.ocr(ocrS({ readCount: 14, readAt: 200, status: 'unreadable', rejected: { at: 301, reason: 'range' } }), T0 + 40_000);
  log.ocr(ocrS({ readCount: 15, readAt: 400, status: 'ok' }), T0 + 70_000);
  log.ocr(ocrS({ readCount: 15, readAt: 400, status: 'error' }), T0 + 71_000);
  const s = log.snapshot(T0 + 80_000);
  ok('B okuma sayısı tabandan sonra artanlar (5)', s.ocr.reads === 5);
  ok('B geçerli okuma 2, oran okumaya göre', s.ocr.ok === 2 && s.ocr.okRate === 0.4);
  ok('B reddedilen 2 (aynı kayıt iki kez sayılmaz), neden bazında', s.ocr.rejected === 2 && s.ocr.rejectedByReason.range === 2);
  ok('B okunamadı 1, hata 1', s.ocr.unreadable === 1 && s.ocr.errors === 1);
  ok('B geçerli okumalar arası en uzun boşluk 60 sn', s.ocr.maxGapMs === 60_000 && s.ocr.meanGapMs === 60_000);
  ok('B hiç okuma yoksa okuma oranı null (sıfıra bölme yok)', F.createFieldLog().snapshot(0).ocr.okRate === null);
}

// ---- C) GPS, navigasyon, kamera, plan, ses ----
{
  const log = F.createFieldLog(); log.start(T0);
  log.gps('ok', T0); log.gps('lost', T0 + 30_000); log.gps('ok', T0 + 40_000);
  const g = log.snapshot(T0 + 100_000).gps;
  ok('C GPS süreleri: ok 90 sn, lost 10 sn, taze oran 0,9, 2 geçiş', g.msByState.ok === 90_000 && g.msByState.lost === 10_000 && g.freshRate === 0.9 && g.transitions === 2);
  log.nav(true, T0 + 5000); log.nav(false, T0 + 65_000); log.nav(true, T0 + 70_000);
  const n = log.snapshot(T0 + 100_000).nav;
  ok('C navigasyon: 2 oturum, süre açık oturum dahil (60 + 30 sn)', n.sessions === 2 && n.ms === 90_000);
  log.camera('recovered', T0); log.camera('lost', T0); log.camera('live', T0);
  ok('C kamera yalnız recovered/lost sayılır', log.snapshot(T0).camera.recovered === 1 && log.snapshot(T0).camera.lost === 1);
  log.plan('a', T0); log.plan('a', T0); log.plan('b', T0);
  ok('C yeniden planlama: yalnız plan kimliği değişince', log.snapshot(T0).plans === 1); // ilk kimlik taban
}
{
  ok('C spokenKind: gerçek anahtar biçimlerinden tür; koordinat/ad taşımaz', ['road:tunnel@40.123,31.456:far', 'c12.34Ankara', 'v5.20', 'g1.5', 'traffic@12', 'traffic?', 'rain@3', 'speed', 'reroute', 'rerouted', 'stop:abc:3', 'nav4:300', 'navstart', 'arrived', 'zzz'].map(F.spokenKind).join() === 'road,camera,curve,grade,traffic,traffic,rain,speed,reroute,reroute,stop,maneuver,nav,nav,other');
  const log = F.createFieldLog(); log.start(T0);
  for (const k of ['road:tunnel@40.123,31.456:far', 'road:toll@41.5,32.1:near', 'v5.20', 'Ankara Caddesi sağa dön']) log.spoken(k, T0);
  const sp = log.snapshot(T0).spoken;
  ok('C konuşma: türe göre sayım, serbest metin "other"', sp.total === 4 && sp.byKind.road === 2 && sp.byKind.curve === 1 && sp.byKind.other === 1);
}

// ---- D) hata iletileri: temizleme ve sınır ----
{
  const dirty = 'Failed to fetch https://api.example.com/v1/map?key=SECRETKEY123&q=1 at 40.12345,32.12345 for user@mail.com';
  const clean = F.sanitizeMessage(dirty);
  ok('D iletiden URL, anahtar, koordinat, e-posta çıkar', !/https?:|SECRET|40\.12345|32\.12345|@mail/.test(clean) && /Failed to fetch/.test(clean));
  ok('D ileti 160 karaktere kesilir; boş/bozuk → "(boş)"', F.sanitizeMessage('x'.repeat(500)).length <= 160 && F.sanitizeMessage('') === '(boş)' && F.sanitizeMessage(null) === '(boş)');
  const log = F.createFieldLog(); log.start(T0);
  for (let i = 0; i < 40; i++) log.error('hata türü ' + i, T0);
  for (let i = 0; i < 5; i++) log.error('hata türü 0', T0);
  const e = log.snapshot(T0).errors;
  ok('D hata türleri en çok 12, toplam doğru, tekrarlar sayılır', e.total === 45 && e.top.length <= 12 && e.top[0].message === 'hata türü 0' && e.top[0].count === 6);
}

// ---- E) rapor ve kalıcılık ----
{
  const log = F.createFieldLog(); log.start(T0);
  log.ocr(ocrS({ readCount: 0 }), T0); log.ocr(ocrS({ readCount: 4, readAt: 9, status: 'ok' }), T0 + 5000);
  log.gps('ok', T0); log.nav(true, T0); log.spoken('road:tunnel@40.1,31.2:far', T0 + 100);
  const meta = { version: '0.99.999', platform: 'Android', standalone: true, at: '2026-11-21T10:00:00Z' };
  const s = log.snapshot(T0 + 600_000);
  const txt = F.formatReport(s, meta);
  ok('E metin raporu: sürüm, platform, süre, OCR, GPS, ses, hata satırları', /0\.99\.999/.test(txt) && /Android/.test(txt) && /10 dk/.test(txt) && /OCR/.test(txt) && /GPS/.test(txt) && /yol/i.test(txt) && /Hata/.test(txt));
  ok('E metin raporunda koordinat/URL/e-posta yok (sürüm numarası koordinat değildir)', !/-?\d{1,3}\.\d{4,}/.test(txt) && !/https?:/.test(txt) && !/@/.test(txt));
  const js = F.reportJson(s, meta);
  ok('E JSON rapor: şema, meta, özet; tam kullanıcı-ajanı dizesi yok', js.schema === 'evrf-field-report/1' && js.meta.version === '0.99.999' && js.summary.ocr.reads === 4 && !('userAgent' in js.meta) && JSON.stringify(js).length < 4000);
  ok('E deviceFamily: UA\'dan yalnız aile', F.deviceFamily('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit') === 'Android' && F.deviceFamily('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)') === 'iOS' && F.deviceFamily('Mozilla/5.0 (Windows NT 10.0; Win64)') === 'Windows' && F.deviceFamily('') === 'bilinmiyor');
  const saved = log.save();
  const b = F.createFieldLog();
  ok('E kayıt/yükleme gidiş-dönüş: sayaçlar korunur', b.load(saved, T0 + 700_000) === true && b.snapshot(T0 + 700_000).ocr.reads === 4 && b.snapshot(T0 + 700_000).spoken.total === 1);
  ok('E yüklenen kayıt etkin sayılmaz (kullanıcı kararı UI\'da)', b.active() === false);
  const c = F.createFieldLog();
  ok('E bozuk/yabancı kayıt reddedilir, sayaçlar sıfır', [null, 'x', 5, {}, { v: 99 }, { v: 1, ocr: 'x' }].every((x) => c.load(x, T0) === false) && c.snapshot(T0).ocr.reads === 0);
  ok('E saklanan özet küçük (< 3 KB)', JSON.stringify(saved).length < 3000);
  log.reset(T0 + 800_000);
  ok('E sıfırla: her şey sıfır, kayıt etkin kalır', log.snapshot(T0 + 800_000).ocr.reads === 0 && log.snapshot(T0 + 800_000).spoken.total === 0 && log.active() === true);
  log.stop(T0 + 900_000);
  ok('E durdur: etkin değil, özet korunur', !log.active() && log.snapshot(T0 + 900_000).durationMs === 100_000);
}

// ---- F) kablolama ve gizlilik ----
{
  const html = read('index.html'), sw = read('sw.js'), app = read('js/app.js'), voice = read('js/advisor/voice.js'), ui = read('js/ui/fieldTest.js'), pure = read('js/diag/fieldLog.js'), ver = read('version.js');
  ok('F index.html: saha testi kartı ve düğmeleri', ['ft-card', 'ft-toggle', 'ft-live', 'ft-show', 'ft-copy', 'ft-download', 'ft-reset', 'ft-out'].every((id) => html.includes(`id="${id}"`)));
  ok('F sw.js kabuğunda iki yeni dosya', sw.includes("'./js/diag/fieldLog.js'") && sw.includes("'./js/ui/fieldTest.js'"));
  ok('F app.js: initFieldTest çağrılır', /import \{ initFieldTest \} from '\.\/ui\/fieldTest\.js'/.test(app) && /^initFieldTest\(\);/m.test(app));
  ok('F voice.js: konuşulduğunda dinleyicilere haber (onSpoken); metin değil yalnız anahtar', /export (const|function) onSpoken/.test(voice) && /spoken\(key\)/.test(voice));
  ok('F ağa/konuma dokunmaz: fetch/XHR/beacon/geolocation/lat/lon yok', ![pure, ui].some((s) => /fetch\(|XMLHttpRequest|sendBeacon|geolocation|\.lat\b|\.lon\b|live\.(lat|lon)/.test(s)));
  ok('F rapor yalnız kullanıcı eylemiyle dışarı çıkar (kopyala/indir/paylaş); kendiliğinden gönderim yok', /clipboard|navigator\.share|createObjectURL/.test(ui) && !/(setInterval|setTimeout)\([^)]*(share|copy|download)/.test(ui));
  ok('F kayıt varsayılan kapalı (load fieldTestOn false)', /load\('fieldTestOn', false\)/.test(ui));
  ok('F sürüm 0.99.120', /self\.APP_VERSION = '0\.99\.120';/.test(ver) && /v: '0\.99\.120'/.test(ver));
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
