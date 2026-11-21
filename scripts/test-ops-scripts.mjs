// Sunucu işletme araçları testleri (bağımsız, düz node): node scripts/test-ops-scripts.mjs
// 1) scripts/verify-backup.mjs: geçerli/bozuk yedek, e-posta/belirteç ÇIKTIYA basılmaz, --boot gerçek sunucuyu geçici veriyle (anahtarsız) açar.
// 2) server/service/{deploy-live,migrate-data,backup}.ps1: ASCII, güvenlik işaretleri (DryRun, yönetici denetimi, geri alma), yıkıcı komut YOK.
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}`); } }
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(ROOT + f, 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'ops-test-'));
const run = (...args) => spawnSync(process.execPath, [ROOT + 'scripts/verify-backup.mjs', ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, BACKUP_DIR: '' } });

const now = Date.now();
const good = {
  users: { u1: { id: 'u1', email: 'gizli.kisi@example.invalid', name: 'GizliAd', createdAt: now }, u2: { id: 'u2', email: 'ikinci@example.invalid', createdAt: now, premiumUntil: now + 86400e3 } },
  invites: { i1: { code: 'DAVETKODU-GIZLI-123' } },
  sessions: { abc123hash: { uid: 'u1', exp: now + 1000 } },
  docs: {},
};
const f1 = join(dir, 'db-20261121-0330.json'); writeFileSync(f1, JSON.stringify(good));
const bad1 = join(dir, 'db-bozuk.json'); writeFileSync(bad1, '{"users": {"u1": ');
const bad2 = join(dir, 'db-sema.json'); writeFileSync(bad2, JSON.stringify({ users: [1, 2], sessions: 'x' }));
const empty = join(dir, 'db-bos.json'); writeFileSync(empty, '');

try {
  // ---- 1) verify-backup ----
  let r = run(f1);
  ok('geçerli yedek: çıkış 0, kullanıcı/oturum/davet sayıları', r.status === 0 && /2 kullanıcı/.test(r.stdout) && /1 oturum/.test(r.stdout) && /1 davet/.test(r.stdout) && /1 premium/.test(r.stdout));
  ok('çıktıda e-posta, ad, davet kodu, oturum özeti yok', !/gizli|example\.invalid|DAVETKODU|abc123hash/i.test(r.stdout + r.stderr));
  r = run(bad1);
  ok('bozuk JSON → çıkış 1, anlaşılır ileti', r.status === 1 && /geçersiz JSON|bozuk/i.test(r.stdout + r.stderr));
  r = run(bad2);
  ok('şema bozuk (users dizi) → çıkış 1', r.status === 1 && /users/.test(r.stdout + r.stderr));
  r = run(empty);
  ok('boş dosya → çıkış 1', r.status === 1);
  r = run(join(dir, 'yok.json'));
  ok('olmayan dosya → çıkış 1', r.status === 1 && /bulunamadı/.test(r.stdout + r.stderr));
  const dir2 = mkdtempSync(join(tmpdir(), 'ops-dir-'));
  const oldBad = join(dir2, 'db-eski-bozuk.json'); writeFileSync(oldBad, '{bozuk');
  const newGood = join(dir2, 'db-yeni.json'); writeFileSync(newGood, JSON.stringify(good));
  utimesSync(oldBad, new Date(now - 86400e3), new Date(now - 86400e3));
  r = spawnSync(process.execPath, [ROOT + 'scripts/verify-backup.mjs', '--dir', dir2], { encoding: 'utf8', timeout: 60000 });
  ok('--dir: mtime\'a göre EN YENİ db-*.json seçilir (eski bozuk dosya yok sayılır) ve doğrulanır', r.status === 0 && /db-yeni\.json/.test(r.stdout) && !/db-eski-bozuk/.test(r.stdout));
  utimesSync(newGood, new Date(now - 2 * 86400e3), new Date(now - 2 * 86400e3));
  r = spawnSync(process.execPath, [ROOT + 'scripts/verify-backup.mjs', '--dir', dir2], { encoding: 'utf8', timeout: 60000 });
  ok('--dir: en yeni dosya bozuksa çıkış 1 (eski sağlam yedeğe sessizce düşmez)', r.status === 1 && /geçersiz JSON/.test(r.stdout));
  rmSync(dir2, { recursive: true, force: true });
  r = run(f1, '--boot');
  ok('--boot: yedek geçici klasörde gerçek sunucuyu açar, /v1/config 200 (anahtarsız, ücretli çağrı yok)', r.status === 0 && /sunucu açıldı/.test(r.stdout) && /\/v1\/config 200/.test(r.stdout), (r.stdout + r.stderr).slice(-300));
  ok('--boot: geçici veri klasörü temizlendi (çıktı yolu yok)', !/ops-boot-/.test(r.stdout) || /temizlendi/.test(r.stdout));

  // ---- 2) PowerShell betikleri: statik güvenlik ----
  const files = ['server/service/deploy-live.ps1', 'server/service/migrate-data.ps1', 'server/service/backup.ps1'];
  for (const f of files) {
    const s = read(f);
    ok(`${f}: yalnız ASCII (Windows PowerShell 5.1 BOM'suz UTF-8'i bozar)`, !/[^\x00-\x7F]/.test(s));
    ok(`${f}: gizli değer/anahtar deseni yok`, !/(sk\.|pk\.|AIza|ghp_|xox[bp]-)[A-Za-z0-9]/.test(s) && !/ACCESS_CODES\s*=\s*\S+/.test(s));
    ok(`${f}: yıkıcı komut yok (veri silme, zorla push/reset, süreç öldürme)`, !/Remove-Item[^\n]*(data|\.env)/i.test(s) && !/git[^\n]*\b(reset --hard|push|clean|stash)\b/.test(s) && !/Stop-Process|taskkill/i.test(s));
  }
  const dep = read('server/service/deploy-live.ps1'), mig = read('server/service/migrate-data.ps1'), bak = read('server/service/backup.ps1');
  ok('deploy-live: -DryRun, -Ref, -IgnoreLegacyTask, kirli klasör reddi, restart.mjs, geri alma', /\[switch\]\$DryRun/.test(dep) && /\$Ref = 'origin\/main'/.test(dep) && /IgnoreLegacyTask/.test(dep) && /status --porcelain/.test(dep) && /restart\.mjs/.test(dep) && /Geri al/i.test(dep) && /checkout --detach/.test(dep));
  ok('deploy-live: eski zamanlanmış görev etkinse durur (port çalma tuzağı)', /Get-ScheduledTask[^\n]*EVCoPilotProxy/.test(dep) && /Disabled/.test(dep));
  ok('deploy-live: yoklama /v1/config + /v1/providers (404 olmamalı)', /\/v1\/config/.test(dep) && /\/v1\/providers/.test(dep));
  ok('migrate-data: yönetici denetimi, -DryRun, yedek, hash doğrulama, .env yedeği, geri alma', /IsInRole/.test(mig) && /\[switch\]\$DryRun/.test(mig) && /Get-FileHash/.test(mig) && /\.env\.bak/.test(mig) && /Geri al/i.test(mig));
  ok('migrate-data: eski veri klasörüne DOKUNMAZ (kopyalar, silmez/taşımaz)', /Copy-Item/.test(mig) && !/Move-Item[^\n]*\$old|Rename-Item[^\n]*\$old/i.test(mig));
  ok('migrate-data: LocalService yazma izni + görevleri yeni betik yollarına günceller', /S-1-5-19/.test(mig) && /Set-ScheduledTask/.test(mig) && /EVCoPilotBackup/.test(mig) && /EVCoPilotWatchdog/.test(mig));
  ok('backup.ps1: kaynak DATA_DIR\'den çözülür (.env), yedek dosyası geçerli JSON mu denetlenir', /DATA_DIR/.test(bak) && /ConvertFrom-Json|Test-Json/.test(bak));
  ok('README: canlı klasör modeli, deploy ve veri taşıma anlatılır', /deploy-live\.ps1/.test(read('server/README.md')) && /migrate-data\.ps1/.test(read('server/README.md')) && /verify-backup/.test(read('server/README.md')));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
