// Pil başlangıcı testi (physics/socEstimate.js): varsayılan %80 yalnızca hiç bilgi yokken ve dürüst etiketle; elle değer (0 dahil) korunur ve yeniden açılışta
// geri gelir; taze kamera önceliklidir, kamera sustuğunda %80'e dönülmez; varsayılan ve önceki oturum değeri ABRP'ye gitmez; Test Modu önceliklidir.
// Kullanım: node scripts/test-soc-default.mjs
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };

// Tarayıcı stubları: ocr.js modül yüklenirken tuval oluşturur; depolama gerçek localStorage arayüzüyle.
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.localStorage = storage;
globalThis.document = { createElement: () => ({ getContext: () => null }), body: { classList: { contains: () => false } } };

// Zaman denetimi: setInterval geri çağrısı elle tetiklenir, saat elle ilerletilir
const intervals = [];
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (fn, ms) => { intervals.push(fn); return 0; };
let clock = 1_000_000;
const realNow = Date.now;
Date.now = () => clock;
const tickAll = () => intervals.forEach((fn) => fn());

// Her senaryo sayfanın yeniden açılışı gibidir: state.js tekildir ve elle sıfırlanır, socEstimate kaynak kopyasından yeni bir örnek üretilir.
import { getState, patch, effective } from '../js/state.js';
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const stateUrl = pathToFileURL(join(repo, 'js/state.js')).href;
const configUrl = pathToFileURL(join(repo, 'js/config.js')).href;
const storageUrl = pathToFileURL(join(repo, 'js/utils/storage.js')).href;
const ocrUrl = pathToFileURL(join(repo, 'js/sensors/ocr.js')).href;
const historyUrl = pathToFileURL(join(repo, 'js/physics/history.js')).href;
const srcText = readFileSync(join(repo, 'js/physics/socEstimate.js'), 'utf8')
  .replace("'../state.js'", `'${stateUrl}'`).replace("'../config.js'", `'${configUrl}'`).replace("'../utils/storage.js'", `'${storageUrl}'`).replace("'../sensors/ocr.js'", `'${ocrUrl}'`).replace("'./history.js'", `'${historyUrl}'`);
const dir = mkdtempSync(join(tmpdir(), 'evrf-soc-'));
let n = 0;
async function fresh({ keep = false } = {}) {
  if (!keep) mem.clear();
  intervals.length = 0;
  patch('live', { soc: null, lat: null, lon: null });
  patch('sim', { enabled: false });
  patch('system', { camera: false, ocr: false });
  patch('ocr', { accepted: null, status: 'idle', lastOkAt: 0, readAt: 0 });
  patch('engine', { socSrc: undefined });
  const f = join(dir, `s${++n}.mjs`);
  writeFileSync(f, srcText);
  const soc = await import(pathToFileURL(f).href);
  soc.restoreSoc();
  soc.initSocEstimate();
  return soc;
}
const camera = (v) => { clock += 1; patch('ocr', { raw: v, accepted: v, status: 'ok', lastOkAt: clock, readAt: clock }); patch('live', { soc: v }); };

// 1) Temiz başlangıç: varsayılan
{
  const s = await fresh();
  ok('temiz başlangıç %80', effective().soc === 80);
  ok('kaynak Varsayılan', s.socSource() === 'default');
  ok('varsayılan canlı sayılmaz', !s.isOnline());
  ok('varsayılan raporlanmış sayılmaz (ABRP)', !s.socReported());
  ok('varsayılan kayda yazılmaz', load() === null);
  ok('varsayılan OCR zamanını değiştirmez', getState('ocr').lastOkAt === 0 && getState('ocr').status === 'idle');
  ok('varsayılan tahmin motoruna girer (tüketim öğrenmesine girmez)', s.isEstimating());
  s.consume(0); // yol alınmadı
  ok('yol alınmayınca %80 kalır', effective().soc === 80);
}
function load() { const r = storage.getItem('evcp.socLast'); return r === null ? null : JSON.parse(r); }

// Dışarı giden pil: varsayılan ve önceki oturum değeri gönderilmez (doluluk sorgusu, ABRP)
{
  let s = await fresh();
  ok('varsayılan dışarı gönderilmez', s.measuredSoc(effective()) === null);
  s.setManual(47);
  ok('elle değer gönderilir', s.measuredSoc(effective()) === 47);
  s = await fresh({ keep: true });
  ok('önceki oturum değeri gönderilmez', s.measuredSoc(effective()) === null);
  camera(58);
  ok('kamera değeri gönderilir', s.measuredSoc(effective()) === 58);
  patch('sim', { enabled: true, soc: 21 });
  ok('Test Modu sürgüsü gönderilir', s.measuredSoc(effective()) === 21);
  patch('sim', { enabled: false });
}

// 2) Elle değer ve 0
{
  const s = await fresh();
  s.setManual(42);
  ok('elle değer uygulanır', effective().soc === 42 && s.socSource() === 'manual');
  ok('elle değer raporlanır', s.socReported());
  ok('elle değer hemen kaydedilir', load()?.v === 42 && load()?.o === 'user');
  s.setManual(0);
  ok('0 geçerli değerdir', effective().soc === 0 && s.socSource() === 'manual');
  ok('0 kaydedilir', load()?.v === 0);
  for (let i = 0; i < 6; i++) { tickAll(); clock += 5000; }
  ok('tekrarlı yenilemede %80\'e dönmez', effective().soc === 0);
}

// 3) Yeniden açılış: elle değer (0 dahil) geri gelir
{
  let s = await fresh();
  s.setManual(0);
  s = await fresh({ keep: true });
  ok('0 yeniden açılışta korunur', effective().soc === 0 && s.socSource() === 'manual');
  s.setManual(55);
  s = await fresh({ keep: true });
  ok('55 yeniden açılışta korunur', effective().soc === 55 && s.socSource() === 'manual');
  ok('önceki oturum değeri ABRP\'ye gitmez', !s.socReported());
}

// 4) Geçersiz kayıt yok sayılır
{
  mem.clear();
  for (const bad of ['{"v":120,"o":"user"}', '{"v":"x"}', 'null', '{bozuk']) {
    mem.set('evcp.socLast', bad);
    const s = await fresh({ keep: true });
    ok(`geçersiz kayıt (${bad}) → varsayılan`, effective().soc === 80 && s.socSource() === 'default');
  }
}

// 5) Taze kamera önceliklidir ve Canlı görünür; bayatlayınca Canlı değildir; %80'e dönmez
{
  const s = await fresh();
  camera(63);
  ok('kamera varsayılanı geçersiz kılar', effective().soc === 63 && s.socSource() === 'live');
  patch('system', { camera: true, ocr: true });
  ok('taze kamerada elle kilit', s.manualLocked());
  // kamera kapandı, 46 sn geçti: eski
  patch('system', { camera: false, ocr: false });
  ok('kamera kapanınca kilit açılır', !s.manualLocked());
  clock += 46_000;
  ok('eski okuma Canlı değil', s.socSource() === 'stale' && !s.isOnline());
  ok('kamera kapanınca değer korunur', effective().soc === 63);
  clock += 20_000; tickAll();
  ok('süre dolunca tahmine geçer', s.socSource() === 'estimate');
  ok('tahminde de %80\'e dönmez', effective().soc === 63);
  s.setManual(30);
  ok('kamera kapalıyken elle ayarlanır', effective().soc === 30 && s.socSource() === 'manual');
  camera(61);
  ok('yeni kamera okuması elle değeri geçersiz kılar', effective().soc === 61 && s.socSource() === 'live');
}

// 6) Kameradan gelen son değer yeniden açılışta canlı görünmez
{
  let s = await fresh();
  camera(70);
  clock += 20_000; camera(70); // kayıt aralığı dolsun
  s = await fresh({ keep: true });
  ok('kamera değeri geri gelir', effective().soc === 70);
  ok('yeniden açılışta Canlı değil, tahmin', s.socSource() === 'estimate');
}

// 7) Tüketim: varsayılan ve elle değer yolda düşer, kamera modunda düşmez
{
  const s = await fresh();
  const before = effective().soc;
  s.consume(5);
  ok('varsayılan yolda düşer', effective().soc < before && s.socSource() === 'default');
  ok('düşen varsayılan kaynağını korur', load()?.o === 'default');
  const again = await fresh({ keep: true });
  ok('düşmüş varsayılan yeniden açılışta sürer ve Varsayılan kalır', effective().soc < 80 && again.socSource() === 'default');
  camera(50);
  again.consume(5);
  ok('kamera modunda tahmin düşmez', effective().soc === 50);
}

// 8) Test Modu önceliği
{
  const s = await fresh();
  s.setManual(33);
  patch('sim', { enabled: true, soc: 12 });
  ok('Test Modu değeri geçerli', effective().soc === 12 && effective().source === 'sim');
  ok('Test Modu kayıt yazmaz', (s.consume(1), load()?.v) === 33);
  patch('sim', { enabled: false });
  ok('Test Modu kapanınca elle değer döner', effective().soc === 33);
}

rmSync(dir, { recursive: true, force: true });
Date.now = realNow;
globalThis.setInterval = realSetInterval;
console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
