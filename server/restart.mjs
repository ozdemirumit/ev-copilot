// Çalışan ara sunucuyu yeniden başlatır (yönetici gerekmez): node server/restart.mjs
// Sunucu Windows hizmeti (NSSM) olarak çalışıyorsa süreç kapanınca hizmet 5 saniyede yenisini açar ve yeni kod yüklenir.
// Hizmet olarak çalışmıyorsa yalnızca kapanır. Yönetici kodu server/.env'den okunur.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const env = {};
const file = join(here, '.env');
if (existsSync(file)) for (const l of readFileSync(file, 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l); if (m && !l.trim().startsWith('#')) env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2'); }
const code = String(env.ACCESS_CODES || '').split(',')[0].trim();
if (!code) { console.error('server/.env içinde ACCESS_CODES yok.'); process.exit(1); }
const base = `http://127.0.0.1:${env.PORT || 8787}`;
const res = await fetch(`${base}/admin/restart`, { method: 'POST', headers: { 'X-Access-Code': code } }).catch((e) => { console.error('Sunucuya ulaşılamadı:', e.message); process.exit(1); });
if (!res.ok) { console.error('Hata:', res.status, await res.text()); process.exit(1); }
console.log('Yeniden başlatılıyor… bekleniyor');
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  try { const r = await fetch(`${base}/v1/config`, { signal: AbortSignal.timeout(2000) }); if (r.ok) { console.log('Sunucu yeniden ayakta:', JSON.stringify(await r.json())); process.exit(0); } } catch { /* henüz kalkmadı */ }
}
console.error('30 sn içinde yanıt gelmedi: hizmet çalışıyor mu? (server\service\status.ps1)');
process.exit(1);
