// YALNIZ TEST: check.mjs + tüm scripts/test-*.mjs dosyalarını scripts/netguard.mjs harici ağ engelleyicisi altında SIRAYLA koşar.
// 1) Ön denetim: test-netguard.mjs (tuzak katmanlı öz-sınama, gerçek ağ denemesi yok). Başarısızsa ya da ön denetim
//    sırasında BLOCK_ satırı oluşursa HİÇBİR test çalıştırılmaz (çıkış 2).
// 2) Her dosya NODE_OPTIONS=--import=<netguard> ve ortak NETGUARD_LOG ile çalışır; alt süreçlere engelleyici enjekte edilir.
// 3) Özet: geçen/başarısız dosya sayısı, dosya başına BLOCK_ satırları (ana makine adına göre), node olmayan çocuk komutlar.
//    Herhangi bir FAIL ya da BLOCK_ satırı varsa çıkış 1 (sızıntı denemesi engellenmiş olsa bile görünür kalır).
// 4) Tarayıcı (kullanıcı kararı 2026-11-16, köprü 6883b3a8): yalnız netguard BROWSER_SCRIPTS (test-station-card-layout)
//    Playwright Chromium/WebKit başlatabilir. EVRF_REQUIRE_BROWSER=1 verilir (tarayıcı bölümü atlanamaz); o dosyada
//    "atlandı" çıktısı ya da chromium+webkit için INFO_BROWSER satırı yoksa FAIL. Tarayıcının kendi ağ yığını Node
//    engelleyicisi dışındadır (tarayıcı ağı sıfır iddiası YOK); sayfa istekleri route ile yakalanır, özet bunları listeler.
// Kullanım: node scripts/run-tests-guarded.mjs [--out <dizin>]   (--out: dosya başına çıktı + blocked.log orada kalır)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUARD_URL = pathToFileURL(path.join(ROOT, 'scripts', 'netguard.mjs')).href;
// Tarayıcı izinli betik listesi netguard.mjs'ten metin olarak okunur (içe aktarmak koşucuyu da sarardı).
const BROWSER_SCRIPTS = new Set([...(fs.readFileSync(path.join(ROOT, 'scripts', 'netguard.mjs'), 'utf8')
  .match(/export const BROWSER_SCRIPTS = new Set\(\[([^\]]*)\]\)/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]));
if (!BROWSER_SCRIPTS.has('test-station-card-layout.mjs')) { console.error('netguard.mjs BROWSER_SCRIPTS okunamadı'); process.exit(2); }
const outIdx = process.argv.indexOf('--out');
const OUT = outIdx > 0 ? path.resolve(process.argv[outIdx + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'evrf-guarded-'));
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'blocked.log');
fs.writeFileSync(LOG, '');
const cur = process.env.NODE_OPTIONS || '';
const env = { ...process.env, NODE_OPTIONS: (cur.includes(GUARD_URL) ? cur : `${cur} --import=${GUARD_URL}`).trim(), NETGUARD_LOG: LOG, EVRF_REQUIRE_BROWSER: '1' };
const readLog = () => fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean);
const run = (rel) => spawnSync(process.execPath, [rel], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 20 * 60 * 1000 });
const tail = (s) => String(s || '').trim().split('\n').filter(Boolean).slice(-1)[0] || '';

// ---- 1) Ön denetim ----
{
  const r = run('scripts/test-netguard.mjs');
  fs.writeFileSync(path.join(OUT, 'preflight-test-netguard.out'), (r.stdout || '') + (r.stderr || ''));
  const blocks = readLog().filter((l) => l.startsWith('BLOCK_'));
  if (r.status !== 0 || blocks.length) {
    console.error(`ÖN DENETİM BAŞARISIZ (çıkış ${r.status}, ${blocks.length} BLOCK_): ${tail(r.stdout)}\nTestler ÇALIŞTIRILMADI. Ayrıntı: ${OUT}`);
    process.exit(2);
  }
  console.log(`ön denetim: test-netguard ${tail(r.stdout)}; günlük temiz`);
  fs.writeFileSync(LOG, '');
}

// ---- 2) check.mjs + tüm testler, sırayla ----
const files = ['scripts/check.mjs', ...fs.readdirSync(path.join(ROOT, 'scripts')).filter((f) => /^test-.*\.mjs$/.test(f)).sort().map((f) => `scripts/${f}`)];
const results = [];
for (const rel of files) {
  const before = readLog().length;
  const t0 = Date.now();
  const r = run(rel);
  const lines = readLog().slice(before);
  const blocks = lines.filter((l) => l.startsWith('BLOCK_'));
  const children = lines.filter((l) => l.startsWith('INFO_CHILD'));
  const browser = lines.filter((l) => l.startsWith('INFO_BROWSER'));
  fs.writeFileSync(path.join(OUT, path.basename(rel, '.mjs') + '.out'), (r.stdout || '') + (r.stderr || ''));
  let note = '';
  if (BROWSER_SCRIPTS.has(path.basename(rel))) {
    const kinds = ['chromium', 'webkit'].filter((k) => browser.some((l) => l.startsWith(`INFO_BROWSER ${k} `)));
    if (/atlandı/.test(r.stdout || '') || kinds.length !== 2) note = `  tarayıcı başlamadı/atlandı (başlayan: ${kinds.join(',') || 'yok'})`;
  } else if (browser.length) note = '  beklenmeyen tarayıcı';
  const passed = r.status === 0 && !r.error && !note;
  results.push({ rel, passed, blocks, children, browser, ms: Date.now() - t0, summary: tail(r.stdout) + note });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${rel}  blok=${blocks.length}  ${tail(r.stdout).slice(0, 90)}${note}${r.error ? '  ' + r.error.code : ''}`);
}

// ---- 3) Özet ----
const failed = results.filter((x) => !x.passed);
const allBlocks = results.flatMap((x) => x.blocks.map((b) => ({ rel: x.rel, b })));
const byHost = {};
for (const { b } of allBlocks) { const k = b.split(' ').slice(0, 2).join(' '); byHost[k] = (byHost[k] || 0) + 1; }
const childCmds = [...new Set(results.flatMap((x) => x.children.map((c) => c.split(' ')[1])))].sort();
console.log('\n==== ÖZET ====');
console.log(`dosya=${results.length} (check.mjs + ${results.length - 1} test) PASS=${results.length - failed.length} FAIL=${failed.length}`);
for (const f of failed) console.log(`  FAIL ${f.rel}: ${f.summary}`);
console.log(`BLOCK_ satırı=${allBlocks.length}${allBlocks.length ? ' ' + JSON.stringify(byHost) : ''}`);
for (const { rel, b } of allBlocks.slice(0, 20)) console.log(`  ${rel}: ${b}`);
console.log(`node olmayan çocuk komutlar: ${childCmds.length ? childCmds.join(', ') : '(yok)'}`);
const bl = results.flatMap((x) => x.browser.map((l) => ({ rel: x.rel, k: l.split(' pid=')[0] })));
const bc = {};
for (const { rel, k } of bl) { const key = `${path.basename(rel)}: ${k}`; bc[key] = (bc[key] || 0) + 1; }
console.log(`tarayıcı satırları (INFO_BROWSER*; tarayıcı ağı Node engelleyicisi dışında, sayfa istekleri route ile yakalandı): ${bl.length ? '' : '(yok)'}`);
for (const [k, n] of Object.entries(bc)) console.log(`  ${n}× ${k}`);
console.log(`günlük/çıktılar: ${OUT}`);
process.exit(failed.length || allBlocks.length ? 1 : 0);
