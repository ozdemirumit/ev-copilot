// Çevrimdışı paket eşliği (Beta) testi: node scripts/test-package-parity.mjs
// scripts/build-beta.mjs'i işletim sisteminin geçici klasöründe YENİ ve BENZERSİZ bir klasöre üretir (proje, www/, android/,
// ../ev-copilot-beta veya herhangi bir git deposu içinde değil) ve çıktının kaynakla eşliğini doğrular:
// sürüm, sw.js SHELL dosyaları, beta depolama/önbellek ad değişiklikleri, js dosyalarının içerik eşliği (trafficGuard/routeMeta/ahead/navigator dahil),
// üretimle çakışan ad kalmaması. build-beta.mjs değiştirilmez. Ağ, anahtar, .env, cap sync, APK/AAB, yayın yoktur.
// Yalnızca bu testin oluşturduğu geçici klasör silinir.
import { mkdtempSync, realpathSync, readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, relative, sep, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const warns = [];
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond || !extra ? '' : '— ' + extra); };

const root = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'));
const BUILDER = join(root, 'scripts', 'build-beta.mjs');
const DEPLOY_REPO = resolve(root, '..', 'ev-copilot-beta'); // build-beta.mjs varsayılan çıktısı: ASLA kullanılmaz
const PREFIX = 'evrf-beta-parity-';
const inside = (p, dir) => { const r = relative(dir, p); return r === '' || (!!r && !r.startsWith('..') && !isAbsolute(r)); };

// ---------------------------------------------------------------- Korunan klasörlerin parmak izi (salt okunur: ad, boyut, mtime)
function fingerprint(dir, deep) {
  if (!existsSync(dir)) return 'yok';
  const out = [];
  const walk = (d, depth) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      let st; try { st = statSync(p); } catch { continue; }
      out.push(`${relative(dir, p)}|${st.isDirectory() ? 'd' : st.size}|${st.mtimeMs}`);
      if (st.isDirectory() && depth < deep) walk(p, depth + 1);
    }
  };
  walk(dir, 0);
  return out.join('\n');
}
const GUARDED = [
  ['www/', join(root, 'www'), 50],
  ['android/ (üst düzey)', join(root, 'android'), 1],
  ['../ev-copilot-beta (üst düzey)', DEPLOY_REPO, 1],
];
const before = GUARDED.map(([, d, deep]) => fingerprint(d, deep));
const gitStatus = () => execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' });
const gitBefore = gitStatus();

// ---------------------------------------------------------------- Kaynak beklentileri
const evalVersion = (file) => { const self = {}; new Function('self', readFileSync(file, 'utf8'))(self); return self.APP_VERSION; };
const srcVersion = evalVersion(join(root, 'version.js'));
// build-beta.mjs ile aynı ad değişiklikleri (yalnızca beklenen çıktıyı hesaplamak için; derleyici değiştirilmez)
const RENAMES = [[/'evcp\./g, "'evcpb."], [/'evcp-kv'/g, "'evcpb-kv'"], [/'ev-copilot-/g, "'ev-copilot-beta-"]];
const LEFTOVER = /'evcp\.|'evcp-kv'|'ev-copilot-(?!beta-)/; // build-beta.mjs'in kendi doğrulamasıyla aynı desen
const applyRenames = (s) => RENAMES.reduce((acc, [re, to]) => acc.replace(re, to), s);
const ITEMS = ['index.html', 'offline.html', 'manifest.webmanifest', 'version.js', 'sw.js', 'css', 'js', 'vendor', 'icons'];
const PROD_URL = 'ozdemirumit.github.io/ev-copilot/';

const listFiles = (dir, skip = new Set()) => {
  const out = [];
  const walk = (d) => { for (const n of readdirSync(d)) { if (skip.has(n)) continue; const p = join(d, n); statSync(p).isDirectory() ? walk(p) : out.push(p); } };
  walk(dir);
  return out;
};

// ---------------------------------------------------------------- 0) Derleyici proje içine yazmayı reddeder (hiçbir şey oluşturmadan)
{
  const probe = join(root, 'local-test', `parity-probe-${process.pid}-${Date.now()}`);
  let threw = false;
  try { execFileSync(process.execPath, [BUILDER, probe], { cwd: root, stdio: 'pipe', env: { PATH: process.env.PATH || '', SystemRoot: process.env.SystemRoot || '' } }); }
  catch { threw = true; }
  ok('derleyici proje içi çıktıyı reddeder', threw);
  ok('reddedilen çıktı klasörü oluşturulmadı', !existsSync(probe));
}

// ---------------------------------------------------------------- 1) Güvenli, benzersiz geçici çıktı klasörü
const tmpBase = realpathSync(tmpdir());
const out = realpathSync(mkdtempSync(join(tmpBase, PREFIX)));
let hasGitAncestor = false;
for (let d = dirname(out); ; d = dirname(d)) { if (existsSync(join(d, '.git'))) { hasGitAncestor = true; break; } if (dirname(d) === d) break; }
const safe = inside(out, tmpBase) && basename(out).startsWith(PREFIX) && !inside(out, root) && !inside(root, out)
  && !inside(out, DEPLOY_REPO) && !inside(DEPLOY_REPO, out) && !hasGitAncestor && readdirSync(out).length === 0;
ok('geçici çıktı klasörü güvenli (tmp içinde, proje/deploy deposu/git deposu dışında, boş)', safe, out);
if (!safe) { console.error('Güvensiz çıktı klasörü; derleme çalıştırılmadı:', out); try { if (readdirSync(out).length === 0) rmSync(out, { recursive: false, force: true }); } catch {} process.exit(1); }

try {
  // build-beta.mjs çıktıyı temizlerken yalnızca .git ve README.md'yi korur; temizliğin klasör dışına taşmadığını ve
  // korunanları koruduğunu görmek için bu testin kendi klasörüne nöbetçi dosyalar konur (kullanıcı dosyası değil).
  mkdirSync(join(out, '.git'));
  writeFileSync(join(out, '.git', 'SENTINEL'), 'keep');
  writeFileSync(join(out, 'README.md'), 'keep');
  writeFileSync(join(out, 'stray.txt'), 'remove');

  execFileSync(process.execPath, [BUILDER, out], { cwd: root, stdio: 'pipe', env: { PATH: process.env.PATH || '', SystemRoot: process.env.SystemRoot || '' } });
  ok('derleme geçici klasöre tamamlandı', true);
  ok('temizlik korunanları korudu (.git, README.md)', readFileSync(join(out, '.git', 'SENTINEL'), 'utf8') === 'keep' && readFileSync(join(out, 'README.md'), 'utf8') === 'keep');
  ok('temizlik yalnızca çıktı klasörü içini sildi (stray.txt)', !existsSync(join(out, 'stray.txt')));

  // ---------------------------------------------------------------- 2) Üst düzey içerik: yalnızca beklenen öğeler (sır yok)
  const top = readdirSync(out).sort();
  const expectTop = [...ITEMS, '.nojekyll', '.git', 'README.md'].sort();
  ok('üst düzey öğeler beklenen küme', JSON.stringify(top) === JSON.stringify(expectTop), top.join(','));
  const all = listFiles(out, new Set(['.git']));
  const forbidden = all.filter((p) => /(^|[\\/])(\.env[^\\/]*|server|node_modules|android|www|package(-lock)?\.json)([\\/]|$)/.test(relative(out, p)));
  ok('server/.env/node_modules/android/www/package dosyası yok', forbidden.length === 0, forbidden.slice(0, 5).join(', '));

  // ---------------------------------------------------------------- 3) Sürüm
  const outVersion = evalVersion(join(out, 'version.js'));
  ok(`Beta sürümü kaynakla aynı (${srcVersion})`, outVersion === srcVersion, `beta=${outVersion}`);
  ok('version.js bayt bayt aynı', readFileSync(join(out, 'version.js'), 'utf8') === readFileSync(join(root, 'version.js'), 'utf8'));

  // ---------------------------------------------------------------- 4) sw.js SHELL
  const sw = readFileSync(join(out, 'sw.js'), 'utf8');
  const m = sw.match(/const SHELL = \[([\s\S]*?)\];/);
  const shell = m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
  ok('SHELL listesi okundu', shell.length > 50, String(shell.length));
  const missing = shell.filter((u) => { const rel = u === './' ? 'index.html' : u.replace(/^\.\//, ''); return !existsSync(join(out, rel)) || statSync(join(out, rel)).isDirectory(); });
  ok('SHELL dosyalarının tümü Beta çıktısında var', missing.length === 0, missing.join(', '));
  ok('SHELL yinelenen giriş içermez', new Set(shell).size === shell.length);
  for (const req of ['./js/nav/trafficGuard.js', './js/nav/routeMeta.js', './js/nav/ahead.js', './js/nav/navigator.js', './js/providers/index.js', './version.js'])
    ok(`SHELL içerir: ${req}`, shell.includes(req));
  ok('sw.js version.js içe aktarır', sw.includes("importScripts('./version.js')"));

  // ---------------------------------------------------------------- 5) Beta ad değişiklikleri
  ok("sw.js önbellek adı 'ev-copilot-beta-' + sürüm", sw.includes("const CACHE = 'ev-copilot-beta-' + self.APP_VERSION;"));
  ok("sw.js vendor önbelleği 'ev-copilot-beta-vendor-'", /const VENDOR_CACHE = 'ev-copilot-beta-vendor-v\d+'/.test(sw));
  const jsOut = [join(out, 'sw.js'), ...listFiles(join(out, 'js'))].filter((p) => p.endsWith('.js'));
  const left = jsOut.filter((p) => LEFTOVER.test(readFileSync(p, 'utf8')));
  ok('üretimle çakışan ad kalmadı (builder deseni)', left.length === 0, left.map((p) => relative(out, p)).join(', '));
  const count = (files, re) => files.reduce((n, p) => n + (readFileSync(p, 'utf8').match(re) || []).length, 0);
  const jsSrc = [join(root, 'sw.js'), ...listFiles(join(root, 'js'))].filter((p) => p.endsWith('.js'));
  for (const [srcRe, outRe, label] of [
    [/'evcp\./g, /'evcpb\./g, 'localStorage öneki evcp. → evcpb.'],
    [/'evcp-kv'/g, /'evcpb-kv'/g, 'IndexedDB evcp-kv → evcpb-kv'],
    [/'ev-copilot-/g, /'ev-copilot-beta-/g, 'önbellek ev-copilot- → ev-copilot-beta-'],
  ]) {
    const a = count(jsSrc, srcRe), b = count(jsOut, outRe);
    ok(`${label} (${a} adet)`, a > 0 && a === b, `kaynak=${a} beta=${b}`);
  }
  ok("idb.js 'evcpb-kv' kullanır", readFileSync(join(out, 'js', 'utils', 'idb.js'), 'utf8').includes("'evcpb-kv'"));
  ok("versionInfo.js önbellek temizliği 'ev-copilot-beta-'", readFileSync(join(out, 'js', 'ui', 'versionInfo.js'), 'utf8').includes("'ev-copilot-beta-'"));

  // ---------------------------------------------------------------- 6) İçerik eşliği: her .js = kaynak + ad değişikliği; diğerleri bayt bayt aynı
  const srcFiles = ITEMS.flatMap((it) => { const p = join(root, it); return statSync(p).isDirectory() ? listFiles(p) : [p]; });
  const outRel = new Set(all.map((p) => relative(out, p)));
  const srcRel = new Set(srcFiles.map((p) => relative(root, p)));
  const extra = [...outRel].filter((r) => !srcRel.has(r) && !['.nojekyll', 'README.md'].includes(r));
  const lost = [...srcRel].filter((r) => !outRel.has(r));
  ok('kaynak dosyalarının tümü kopyalandı', lost.length === 0, lost.slice(0, 5).join(', '));
  ok('fazladan dosya yok', extra.length === 0, extra.slice(0, 5).join(', '));
  const isVendor = (r) => r.split(sep)[0] === 'vendor';
  const renamedSet = new Set(['sw.js', ...[...srcRel].filter((r) => r.split(sep)[0] === 'js' && r.endsWith('.js'))]);
  const diff = [];
  for (const r of srcRel) {
    if (!outRel.has(r) || r === 'index.html' || r === 'manifest.webmanifest') continue;
    const a = readFileSync(join(root, r)), b = readFileSync(join(out, r));
    const same = renamedSet.has(r) && !isVendor(r) ? applyRenames(a.toString('utf8')) === b.toString('utf8') : a.equals(b);
    if (!same) diff.push(r);
  }
  ok('tüm dosyalar kaynakla eşleşiyor (js: ad değişikliği sonrası)', diff.length === 0, diff.slice(0, 5).join(', '));
  for (const [rel, needles] of [
    [join('js', 'nav', 'trafficGuard.js'), ['export function trafficUse', 'export function liveRemainH', 'LIVE_REMAIN_MAX_MS']],
    [join('js', 'nav', 'routeMeta.js'), ['ROUTE_META_VERSION', 'PROVIDERS']],
    [join('js', 'nav', 'ahead.js'), ["from './trafficGuard.js'", 'trafficUse', 'fetchTrafficAhead']],
    [join('js', 'nav', 'navigator.js'), ["from './trafficGuard.js'", 'liveRemainH']],
  ]) {
    const p = join(out, rel);
    const s = existsSync(p) ? readFileSync(p, 'utf8') : '';
    const miss = needles.filter((n) => !s.includes(n));
    ok(`${rel} kopyalandı ve beklenen içeriği taşıyor`, !!s && miss.length === 0, miss.join(', '));
    ok(`${rel} söz dizimi geçerli`, (() => { try { execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' }); return true; } catch { return false; } })());
  }

  // ---------------------------------------------------------------- 7) Manifest / başlık / .nojekyll
  const man = JSON.parse(readFileSync(join(out, 'manifest.webmanifest'), 'utf8'));
  const srcMan = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
  ok('manifest adı Beta', man.name === 'EV Route Finder (Beta)' && man.short_name === 'EV RF Beta');
  ok('manifest göreli kapsam/başlangıç (üretim adresine bağlı değil)', man.scope === srcMan.scope && man.start_url === srcMan.start_url && man.id === srcMan.id && !/^https?:/.test(man.start_url + man.scope));
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  ok('index.html başlığı Beta', html.includes('<title>EV Route Finder (Beta)</title>') && !html.includes('<title>EV Route Finder</title>'));
  ok('index.html yalnızca başlıkta farklı', html === readFileSync(join(root, 'index.html'), 'utf8').replace('<title>EV Route Finder</title>', '<title>EV Route Finder (Beta)</title>'));
  ok('.nojekyll var', existsSync(join(out, '.nojekyll')));

  // ---------------------------------------------------------------- 8) Üretim adresi sızıntısı (derleyici bunu denetlemez: bilinen tek yer uyarı olarak raporlanır)
  const prodHits = all.filter((p) => !isVendor(relative(out, p)) && /\.(js|html|webmanifest|css)$/.test(p) && readFileSync(p, 'utf8').includes(PROD_URL)).map((p) => relative(out, p));
  const unknownHits = prodHits.filter((r) => r !== 'offline.html');
  ok('bilinen dışında üretim adresi yok', unknownHits.length === 0, unknownHits.join(', '));
  if (prodHits.includes('offline.html')) warns.push(`offline.html "Tekrar dene" düğmesi üretim adresine (https://${PROD_URL}) gider; build-beta.mjs bunu değiştirmez (bilinen eksik, davranış değiştirilmedi)`);
} finally {
  // Yalnızca bu testin oluşturduğu klasör silinir (önek + tmp içi yeniden doğrulanır)
  if (inside(out, tmpBase) && out !== tmpBase && basename(out).startsWith(PREFIX)) rmSync(out, { recursive: true, force: true });
  ok('geçici klasör silindi', !existsSync(out));
}

// ---------------------------------------------------------------- 9) Korunan yerler değişmedi
const after = GUARDED.map(([, d, deep]) => fingerprint(d, deep));
GUARDED.forEach(([label], i) => ok(`${label} değişmedi`, before[i] === after[i]));
ok('izlenen çalışma ağacı değişmedi (git status)', gitStatus() === gitBefore);

for (const w of warns) console.log('UYARI', w);
console.log(`\n${pass} geçti, ${fail} kaldı`);
if (fail) process.exit(1);
