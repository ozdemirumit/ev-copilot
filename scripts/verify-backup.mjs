// Yedek doğrulama aracı (v0.99.120 sonrası işletme aracı; uygulama sürümünü etkilemez):
//   node scripts/verify-backup.mjs [dosya.json]            geçerli mi? (JSON + şema + sayılar)
//   node scripts/verify-backup.mjs --dir <klasör>          klasördeki en yeni db-*.json (varsayılan: BACKUP_DIR ya da C:\ProgramData\EVCoPilot\backup)
//   node scripts/verify-backup.mjs <dosya> --boot          ayrıca yedeği GEÇİCİ klasörde gerçek sunucuyla açar (anahtarsız, ücretli çağrı yok) ve /v1/config'i yoklar
// Çıktıya e-posta, ad, davet kodu ya da oturum özeti BASILMAZ; yalnız sayılar. Çıkış 0 = geçerli, 1 = sorun.
import { readFileSync, readdirSync, statSync, mkdtempSync, copyFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const fail = (m) => { console.log('SORUN: ' + m); process.exit(1); };
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

function pickFile() {
  const direct = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--dir');
  if (direct) return direct;
  const dir = val('--dir') || process.env.BACKUP_DIR || 'C:\\ProgramData\\EVCoPilot\\backup';
  if (!existsSync(dir)) fail(`yedek klasörü bulunamadı: ${dir}`);
  const list = readdirSync(dir).filter((f) => /^db-.*\.json$/.test(f)).map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  if (!list.length) fail(`klasörde db-*.json yok: ${dir}`);
  return join(dir, list[0].f);
}

const file = pickFile();
if (!existsSync(file)) fail(`dosya bulunamadı: ${file}`);
const st = statSync(file);
if (!st.size) fail('dosya boş');
let db;
try { db = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { fail(`geçersiz JSON (bozuk yedek): ${String(e.message).slice(0, 80)}`); }
if (!isObj(db)) fail('en üst düzey nesne değil');
if (!isObj(db.users)) fail('users nesne olmalı (dizi/boş olamaz)');
for (const k of ['sessions', 'invites', 'docs']) if (db[k] !== undefined && !isObj(db[k])) fail(`${k} nesne olmalı`);

const now = Date.now();
const users = Object.values(db.users);
const premium = users.filter((u) => isObj(u) && typeof u.premiumUntil === 'number' && u.premiumUntil > now).length;
const sessions = Object.keys(db.sessions || {}).length;
const invites = Object.keys(db.invites || {}).length;
console.log(`Yedek: ${basename(file)} (${(st.size / 1024).toFixed(1)} KB, ${new Date(st.mtimeMs).toISOString().slice(0, 16).replace('T', ' ')})`);
console.log(`içerik: ${users.length} kullanıcı (${premium} premium), ${sessions} oturum, ${invites} davet`);
if (users.length === 0) console.log('UYARI: yedekte hiç kullanıcı yok (yeni kurulum olabilir; canlıdaki sayıyla karşılaştır).');

if (!flag('--boot')) { console.log('geçerli'); process.exit(0); }

// ---- --boot: gerçek sunucu, geçici veri, anahtarsız ----
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const port = await freePort();
const tmp = mkdtempSync(join(tmpdir(), 'ops-boot-'));
copyFileSync(file, join(tmp, 'db.json'));
writeFileSync(join(tmp, 'tesla.json'), JSON.stringify({ at: Date.now(), sites: [] })); // açılışta dış servise gitmesin
const BLANK = Object.fromEntries(['MAPBOX_TOKEN', 'MAPBOX_MAP_TOKEN', 'TOMTOM_KEY', 'TOMTOM_MAP_KEY', 'HERE_API_KEY', 'HERE_MAP_KEY', 'OCM_KEY', 'GOOGLE_PLACES_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_MAPS_BROWSER_KEY', 'GOOGLE_MAP_ID', 'SMTP_USER', 'SMTP_PASS', 'PUBLIC_URL', 'ADMIN_EMAILS', 'ADMIN_TOTP_SECRET', 'VERIAPI_KEY', 'MAP_DAILY_PER_USER', 'MAP_DAILY_TOTAL', 'TRUST_PROXY'].map((k) => [k, '']));
const SINK = 'http://127.0.0.1:9'; // dış sağlayıcı adresleri yerel boşluğa: istek atılsa bile çıkamaz
const child = spawn(process.execPath, ['server/proxy.mjs'], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ...BLANK, PROVIDER_REQUESTS_PAUSED: '0', PORT: String(port), HOST: '127.0.0.1', DATA_DIR: tmp, ACCESS_CODES: 'yedek-dogrulama-gecici-kod-0123456789',
    MAPBOX_BASE: SINK, OCM_BASE: SINK, TOMTOM_BASE: SINK, HERE_BASE: SINK, HERE_ROUTER_BASE: SINK, OVERPASS_URLS: SINK },
});
let out = '';
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { out += d; });
let up = false;
for (let i = 0; i < 100 && !up; i++) { await new Promise((r) => setTimeout(r, 100)); up = out.includes('ara sunucusu'); }
let status = 0;
if (up) { try { status = (await fetch(`http://127.0.0.1:${port}/v1/config`)).status; } catch { status = 0; } }
child.kill();
await new Promise((r) => setTimeout(r, 300));
rmSync(tmp, { recursive: true, force: true });
if (!up) fail('yedek geçici sunucuda açılmadı (sunucu başlamadı)');
console.log(`sunucu açıldı (geçici veri) · /v1/config ${status} · geçici klasör temizlendi`);
if (status !== 200) fail(`/v1/config ${status} döndü`);
console.log('geçerli (yedek sunucuyla açıldı)');
process.exit(0);
