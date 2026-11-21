// Google Play dahili test otomatik yüklemesi (.github/workflows/play-internal.yml + scripts/play-whatsnew.mjs) testleri (bağımsız, düz node):
//   node scripts/test-play-ci.mjs
// Kurallar: yalnızca etiket (android-v*) ya da elle tetiklenir (PR/fork ile ASLA); gizli değerler yalnızca env:/with: eşlemesinde (run betiğinde yok);
// anahtar dosyası geçici klasöre yazılır ve iş bitince silinir; izinler en az; Play sürüm notu ≤ 500 karakter.
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}`); } }
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(ROOT + f, 'utf8');

const W = await import('../scripts/play-whatsnew.mjs');

// ---- A) sürüm notu ----
const log = [{ v: '0.99.200', date: '2026-12-01', notes: ['Yeni: kamera önizlemesi yakınlaştırılır.', "OCR'ın okuduğu bölge değişmez."] }, { v: '0.99.199', notes: ['Eski kayıt metni'] }];
{
  const t = W.whatsNew(log);
  ok('A en üst kaydın notları satır satır, eski kayıt yok', t.includes('kamera önizlemesi') && t.includes("OCR'ın") && !t.includes('Eski kayıt') && t.split('\n').length === 2);
  ok('A en çok 500 karakter; uzun not kelime sınırında kesilir, … ile biter', (() => { const long = W.whatsNew([{ v: '1', notes: ['kelime '.repeat(200)] }]); return long.length <= 500 && long.endsWith('…') && !/kelim…$/.test(long); })());
  ok('A tam 500 karakter olan not kesilmez', W.whatsNew([{ v: '1', notes: ['a'.repeat(500)] }]) === 'a'.repeat(500));
  ok('A boş / bozuk kayıt → varsayılan metin', [[], null, undefined, [{ v: '1' }], [{ v: '1', notes: [] }], [{ v: '1', notes: [5, null, ''] }]].every((x) => W.whatsNew(x) === W.FALLBACK) && W.FALLBACK.length > 0);
  ok('A HTML/denetim karakteri temizlenir', !/[<>]/.test(W.whatsNew([{ v: '1', notes: ['<b>kalın</b> metin\u0000'] }])) && W.whatsNew([{ v: '1', notes: ['<b>kalın</b> metin\u0000'] }]).includes('kalın metin'));
  ok('A Play sınırı sabit 500', W.MAX_CHARS === 500);
}
{
  const dir = mkdtempSync(join(tmpdir(), 'whatsnew-'));
  const r = spawnSync(process.execPath, [ROOT + 'scripts/play-whatsnew.mjs', dir], { encoding: 'utf8', timeout: 30000 });
  const f = join(dir, 'whatsnew-tr-TR');
  const body = existsSync(f) ? readFileSync(f) : Buffer.alloc(0);
  ok('A betik: gerçek version.js\'ten whatsnew-tr-TR yazar (≤ 500 karakter, BOM yok)', r.status === 0 && body.length > 0 && body.toString('utf8').length <= 500 && body[0] !== 0xEF);
  ok('A betik: çıktı en güncel sürümün notlarından', (() => { const v = /APP_VERSION = '([^']+)'/.exec(read('version.js'))[1]; return /\d+\.\d+\.\d+/.test(v) && body.toString('utf8').length > 10; })());
  rmSync(dir, { recursive: true, force: true });
}

// ---- B) workflow güvenliği ----
const wf = read('.github/workflows/play-internal.yml');
const lines = wf.split(/\r?\n/);
ok('B tetikleyici: yalnızca android-v* etiketi ve elle (workflow_dispatch)', /^on:\s*$/m.test(wf) && /tags:\s*\[\s*'android-v\*'\s*\]/.test(wf) && /workflow_dispatch:/.test(wf));
ok('B PR / fork / dal tetikleyicisi YOK (gizli değerler sızmaz)', !/pull_request|pull_request_target|^\s+branches:|workflow_run|issue_comment|schedule:/m.test(wf));
ok('B izinler en az: yalnız contents: read', /^permissions:\s*\n\s+contents:\s*read\s*$/m.test(wf) && !/write/.test(wf));
ok('B korumalı ortam (environment) ve eşzamanlılık kilidi', /^\s+environment:\s*play-internal\s*$/m.test(wf) && /^concurrency:/m.test(wf) && /cancel-in-progress:\s*false/.test(wf));
ok('B Windows koşucusu (build-aab.mjs cmd.exe/gradlew.bat/jarsigner.exe kullanır), zaman aşımı var', /runs-on:\s*windows-latest/.test(wf) && /timeout-minutes:\s*\d+/.test(wf));
ok('B üçüncü taraf eylemler sürüm etiketine bağlı (@vN), @main/@master yok', lines.filter((l) => /uses:/.test(l)).every((l) => /@v\d+\s*$/.test(l)) && lines.some((l) => /uses:\s*r0adkll\/upload-google-play@v1/.test(l)));
{
  const secretLines = lines.filter((l) => /secrets\./.test(l));
  const names = [...wf.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]);
  ok('B gizli değerler yalnızca "ANAHTAR: ${{ secrets.AD }}" eşlemesinde (run betiğinde/echo\'da yok)', secretLines.length > 0 && secretLines.every((l) => /^\s+[A-Za-z0-9_]+:\s*\$\{\{\s*secrets\.[A-Z0-9_]+\s*\}\}\s*$/.test(l)));
  ok('B tam 5 gizli değer adı', JSON.stringify([...new Set(names)].sort()) === JSON.stringify(['ANDROID_KEYSTORE_B64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD', 'PLAY_SERVICE_ACCOUNT_JSON']));
}
ok('B anahtar dosyası RUNNER_TEMP\'e yazılır (çalışma klasörüne değil), iş bitince silinir (if: always())', /RUNNER_TEMP/.test(wf) && /if:\s*always\(\)/.test(wf) && /Remove-Item[^\n]*keystore\.properties/.test(wf) && /Remove-Item[^\n]*upload\.jks/.test(wf));
ok('B gizli değer yazdıran komut yok (echo/Write-Host/printenv/env dökümü)', !/\becho\b[^\n]*(KS_|KEY_|PASS|SECRET)/i.test(wf) && !/Write-(Host|Output)[^\n]*(KS_|KEY_|PASS|SECRET)/i.test(wf) && !/printenv|Get-ChildItem env:|\bset\s*$/m.test(wf));
ok('B continue-on-error yok (başarısız imza/yükleme sessizce geçmez)', !/continue-on-error/.test(wf));
ok('B yükleme: dahili test kanalı, doğru paket, AAB yolu, sürüm notu klasörü', /track:\s*internal/.test(wf) && /packageName:\s*com\.evroutefinder\.app/.test(wf) && /releaseFiles:\s*android\/app\/build\/outputs\/bundle\/release\/app-release\.aab/.test(wf) && /whatsNewDirectory:\s*distribution\/whatsnew/.test(wf));
ok('B elle çalıştırmada durum seçilir (varsayılan draft: testçilere kendiliğinden çıkmaz)', /status:\s*\$\{\{\s*inputs\.status\s*\|\|\s*'completed'\s*\}\}/.test(wf) && /type:\s*choice/.test(wf) && /options:\s*\[\s*draft,\s*completed\s*\]/.test(wf) && /default:\s*draft/.test(wf));
ok('B kapı: check.mjs; sürüm notu betiği; npm run aab; AAB yedek çıktısı', /node scripts\/check\.mjs/.test(wf) && /node scripts\/play-whatsnew\.mjs distribution\/whatsnew/.test(wf) && /npm run aab/.test(wf) && /upload-artifact@v\d/.test(wf));
{
  const cap = JSON.parse(read('capacitor.config.json'));
  ok('B workflow paket adı capacitor appId ile aynı', cap.appId === 'com.evroutefinder.app' && /packageName:\s*com\.evroutefinder\.app/.test(wf));
  ok('B anahtar dosyaları .gitignore\'da (depoya girmez)', /keystore\.properties/.test(read('android/.gitignore')) && /\*\.jks/.test(read('android/.gitignore')));
}

// ---- C) belge ----
{
  const d = read('docs/android.md');
  const sec = d.slice(d.indexOf('Otomatik yükleme'));
  ok('C belge: otomatik yükleme bölümü, etiket komutu, 5 gizli değer adı, ilk yüklemenin elle olduğu', d.includes('Otomatik yükleme') && /android-v/.test(sec) && ['PLAY_SERVICE_ACCOUNT_JSON', 'ANDROID_KEYSTORE_B64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'].every((n) => sec.includes(n)) && /[İi]lk yükleme elle/.test(sec));
  ok('C belge: yalnız Android tarafı değişince gerekir; anahtar/şifre bana/sohbete yazılmaz uyarısı', /yalnızca Android tarafı|Android tarafı değişince/.test(sec) && /sohbet|kimseyle paylaşma|yalnızca GitHub/i.test(sec));
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
